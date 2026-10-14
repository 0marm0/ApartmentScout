"""Door-to-door transit commute times from public GTFS feeds, by mode.

Method: a reverse Connection Scan (CSA). For a destination and an arrive-by
time, it scans every scheduled vehicle hop of the chosen weekday backwards and
finds, for every stop, the latest you can leave that stop and still arrive on
time. A home's commute is then

    arrive_by - max over nearby stops (latest_departure(stop) - access(home -> stop))

compared with simply walking. Walking (see walk.py) is straight-line distance times a detour
factor (1.25 by default), or a street-grid metric inside a city's grid area, at your walking speed;
the same function serves walks to stops, transfers, walks from stops and the walk-only time. Access
adds a street-to-vehicle time per mode (stairs and fare gates for the subway,
nothing much for a kerbside bus stop).

Every feed, route and stop carries a mode (subway, bus, rail, ferry). One network
holds all feeds; a scan can be limited to a set of modes, so the same network
answers "subway only", "bus only" and "any combination, with subway-bus transfers".

This is a schedule-based estimate. It ignores delays and crowding, and it uses
the timetable of one weekday. It is good for comparing neighbourhoods and
listings, which is what the heatmap is for. Check the shortlist in a live
trip planner before you sign.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import math
import re
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import requests

from ..geo import haversine_m
from .walk import Walker

NEG = -10**9
MODES = ("subway", "bus", "rail", "ferry")
MODE_BIT = {m: 1 << i for i, m in enumerate(MODES)}
ALL_MODES = sum(MODE_BIT.values())
# street-to-vehicle time per mode, seconds (stairs, fare gates, platform walk; a bus stop is at the kerb)
DEFAULT_ACCESS_S = {"subway": 120, "bus": 30, "rail": 180, "ferry": 180}


def _secs(t: str) -> int:
    h, m, s = t.strip().split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _hhmm(t: str) -> int:
    parts = t.strip().split(":")
    return int(parts[0]) * 3600 + int(parts[1]) * 60


def clock(s: float) -> str:
    """Seconds after midnight as HH:MM."""
    s = int(round(s / 60))
    return f"{s // 60:02d}:{s % 60:02d}"


def route_mode(route_type: str | int | None) -> str:
    """GTFS route_type (basic or extended) to subway | bus | rail | ferry."""
    try:
        t = int(route_type or 3)
    except ValueError:
        return "bus"
    if t == 1 or 400 <= t < 500:
        return "subway"
    if t in (3, 11) or 200 <= t < 300 or 700 <= t < 800 or 800 <= t < 900:
        return "bus"
    if t == 4 or 1000 <= t < 1100 or 1200 <= t < 1300:
        return "ferry"
    return "rail"


def pretty_stop(name: str) -> str:
    """'1 AV/E 43 ST' -> '1 Av/E 43 St' (bus feeds shout); mixed-case names pass through."""
    if not name or name != name.upper() or not re.search(r"[A-Z]{2}", name):
        return name
    s = re.sub(r"(?<![0-9])[A-Z]+", lambda m: m.group(0).capitalize(), name)
    return re.sub(r"(\d)(ST|ND|RD|TH)\b", lambda m: m.group(1) + m.group(2).lower(), s)


def download_feed(url: str, dest: Path, max_age_days: int = 14) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and (dt.datetime.now().timestamp() - dest.stat().st_mtime) < max_age_days * 86400:
        return dest
    r = requests.get(url, timeout=300, headers={"User-Agent": "ApartmentScout/0.1"})
    r.raise_for_status()
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.replace(dest)
    return dest


@dataclass
class Network:
    stop_ids: list[str] = field(default_factory=list)
    stop_name: list[str] = field(default_factory=list)
    lat: list[float] = field(default_factory=list)
    lon: list[float] = field(default_factory=list)
    stop_mask: list[int] = field(default_factory=list)  # bit set of the modes that serve each stop
    # connections: (dep, arr, from_stop, to_stop, trip_idx), sorted by dep descending
    conns: list[tuple[int, int, int, int, int]] = field(default_factory=list)
    trip_route: list[str] = field(default_factory=list)
    trip_mode: list[str] = field(default_factory=list)
    foot: dict[int, list[tuple[int, int]]] = field(default_factory=lambda: defaultdict(list))
    access_s: dict[str, int] = field(default_factory=lambda: dict(DEFAULT_ACCESS_S))
    _by_mask: dict[int, list] = field(default_factory=dict, repr=False)
    _np: tuple | None = field(default=None, repr=False)
    walker: Walker = field(default_factory=Walker)
    _areas: np.ndarray | None = field(default=None, repr=False)
    land: object | None = field(default=None, repr=False)  # land.Land: no walking across water when set
    _stop_land: np.ndarray | None = field(default=None, repr=False)

    def set_land(self, land) -> None:
        self.land, self._stop_land = land, None

    def stop_land(self) -> np.ndarray | None:
        """Landmass label of every stop (0 = unknown), or None without a land model."""
        if self.land is None:
            return None
        if self._stop_land is None:
            self._stop_land = self.land.at(np.asarray(self.lat, dtype=float), np.asarray(self.lon, dtype=float))
        return self._stop_land

    def same_land(self, lat: float, lon: float, js: np.ndarray) -> np.ndarray:
        """Which of the stops js can be walked to from (lat, lon) without crossing water."""
        sl = self.stop_land()
        if sl is None or not len(js):
            return np.ones(len(js), dtype=bool)
        here = int(self.land.at(lat, lon))
        if here == 0:
            return np.ones(len(js), dtype=bool)
        there = sl[js]
        return (there == 0) | (there == here)

    def areas(self) -> np.ndarray:
        """Walking-grid area of every stop (-1 = none)."""
        if self._areas is None:
            self._areas = self.walker.area(np.asarray(self.lat, dtype=float), np.asarray(self.lon, dtype=float))
        return self._areas

    def walk_m(self, lat: float, lon: float, js: np.ndarray) -> np.ndarray:
        """Walking metres from a point to the stops js (the router's one walking function)."""
        return self.walker.metres_many(lat, lon, np.asarray(self.lat)[js], np.asarray(self.lon)[js],
                                       areas=self.areas()[js])

    def modes_present(self) -> list[str]:
        have = set(self.trip_mode)
        return [m for m in MODES if m in have]

    def conns_for(self, mask: int) -> list[tuple[int, int, int, int, int]]:
        """Connections whose trip runs in one of the modes in `mask` (cached)."""
        if mask not in self._by_mask:
            tb = [MODE_BIT[m] for m in self.trip_mode]
            self._by_mask[mask] = self.conns if all(b & mask for b in tb) else \
                [c for c in self.conns if tb[c[4]] & mask]
        return self._by_mask[mask]

    def stop_access(self, i: int) -> int:
        """Street-to-vehicle seconds at stop i: the slowest mode that serves it."""
        m = self.stop_mask[i]
        return max((self.access_s.get(k, 0) for k in MODES if m & MODE_BIT[k]), default=0)

    def arrays(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        if self._np is None:
            self._np = (np.radians(np.asarray(self.lat, dtype=float)), np.radians(np.asarray(self.lon, dtype=float)),
                        np.asarray(self.stop_mask, dtype=np.int64),
                        np.asarray([self.stop_access(i) for i in range(len(self.lat))], dtype=float))
        return self._np


def _read(z: zipfile.ZipFile, name: str):
    try:
        with z.open(name) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
    except KeyError:
        return


def _rows(z: zipfile.ZipFile, name: str, cols: list[str]):
    """Fast reader: yields tuples of the named columns ('' when a column is missing)."""
    try:
        f = z.open(name)
    except KeyError:
        return
    with f:
        r = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        head = [h.strip() for h in next(r, [])]
        ix = [head.index(c) if c in head else None for c in cols]
        n = len(head)
        for row in r:
            if len(row) < n:
                row = row + [""] * (n - len(row))
            yield tuple(row[i] if i is not None else "" for i in ix)


def active_services(z: zipfile.ZipFile, day: dt.date) -> set[str]:
    wd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][day.weekday()]
    ymd = day.strftime("%Y%m%d")
    s = set()
    for r in _read(z, "calendar.txt"):
        if r["start_date"] <= ymd <= r["end_date"] and r.get(wd) == "1":
            s.add(r["service_id"])
    for r in _read(z, "calendar_dates.txt"):
        if r["date"] == ymd:
            (s.add if r["exception_type"] == "1" else s.discard)(r["service_id"])
    return s


def nearest_service_day(z: zipfile.ZipFile, day: dt.date) -> dt.date | None:
    """Closest day with service and the same weekday type, for feeds whose calendar does not cover `day`."""
    lo, hi = feed_dates(z)
    try:
        a, b = dt.datetime.strptime(lo, "%Y%m%d").date(), dt.datetime.strptime(hi, "%Y%m%d").date()
    except ValueError:
        return None
    want = (1, 2, 3) if day.weekday() < 5 else (day.weekday(),)
    cands = [a + dt.timedelta(days=i) for i in range((b - a).days + 1)]
    cands = [c for c in cands if c.weekday() in want]
    for c in sorted(cands, key=lambda c: abs((c - day).days)):
        if active_services(z, c):
            return c
    return None


def feed_dates(z: zipfile.ZipFile) -> tuple[str, str]:
    lo, hi = "99999999", "00000000"
    for r in _read(z, "calendar.txt"):
        lo, hi = min(lo, r["start_date"]), max(hi, r["end_date"])
    if lo > hi:
        for r in _read(z, "calendar_dates.txt"):
            lo, hi = min(lo, r["date"]), max(hi, r["date"])
    return lo, hi


def load_network(feeds: list[tuple], day: dt.date, t_lo: int, t_hi: int,
                 walk_speed_ms: float, detour: float, transfer_radius_m: float = 250,
                 bbox: tuple[float, float, float, float] | None = None,
                 access_s: dict[str, int] | None = None, log=print, walker: Walker | None = None) -> Network:
    """Load all connections departing in [t_lo, t_hi] seconds after midnight on `day`.

    feeds: (name, path), (name, path, mode) or (name, path, mode, exclude_route_patterns). With a mode
    every route of the feed gets it; without one each route's GTFS route_type decides. Routes whose
    short name matches an exclude pattern (regex) are dropped, e.g. premium-fare express buses. bbox (lon0, lat0, lon1, lat1) drops stops
    outside it; a vehicle that passes through them still connects the stops either side.
    """
    net = Network(walker=walker or Walker(walk_speed_ms, detour))
    if access_s:
        net.access_s.update(access_s)
    sidx: dict[str, int] = {}
    given: set[tuple[int, int]] = set()  # walks the feed publishes a transfer time for
    for spec in feeds:
        prefix, path = spec[0], Path(spec[1])
        feed_mode = spec[2] if len(spec) > 2 and spec[2] else None
        skip = re.compile("|".join(spec[3])) if len(spec) > 3 and spec[3] else None
        z = zipfile.ZipFile(path)
        services = active_services(z, day)
        if not services:
            alt = nearest_service_day(z, day)
            if alt is None:
                lo, hi = feed_dates(z)
                raise ValueError(f"Feed {prefix} has no service on {day} (calendar {lo}-{hi}); "
                                 f"set commute.transit.service_date to a weekday in that range.")
            log(f"  note: feed {prefix} has no service on {day}; using {alt} (same weekday pattern)")
            services = active_services(z, alt)
        routes = {}
        for rid, short, long_, rtype in _rows(z, "routes.txt", ["route_id", "route_short_name", "route_long_name",
                                                                "route_type"]):
            name = short or long_ or rid
            if skip and skip.search(name):
                continue
            routes[rid] = (name, feed_mode or route_mode(rtype))
        first_stop = len(net.stop_ids)
        children: dict[str, list[str]] = defaultdict(list)
        for sid, name, la, lo, ltype, parent in _rows(z, "stops.txt", ["stop_id", "stop_name", "stop_lat",
                                                                       "stop_lon", "location_type", "parent_station"]):
            if parent:
                children[parent].append(sid)
            if ltype not in ("", "0") or not la:
                continue
            la, lo = float(la), float(lo)
            if bbox and not (bbox[0] <= lo <= bbox[2] and bbox[1] <= la <= bbox[3]):
                continue
            sidx[f"{prefix}:{sid}"] = len(net.stop_ids)
            net.stop_ids.append(f"{prefix}:{sid}")
            net.stop_name.append(pretty_stop(name))
            net.lat.append(la)
            net.lon.append(lo)
            net.stop_mask.append(0)
        trips: dict[str, tuple[str, str]] = {}
        for rid, sid, tid in _rows(z, "trips.txt", ["route_id", "service_id", "trip_id"]):
            if sid in services and rid in routes:
                trips[tid] = routes[rid]
        by_trip: dict[str, list[tuple[int, int, int, int]]] = defaultdict(list)
        for tid, a, d, sid, seq in _rows(z, "stop_times.txt", ["trip_id", "arrival_time", "departure_time",
                                                                "stop_id", "stop_sequence"]):
            if tid not in trips:
                continue
            si = sidx.get(f"{prefix}:{sid}")
            if si is None:
                continue
            a, d = a or d, d or a
            if not a:
                continue  # untimed stop; the vehicle still links the timed stops either side
            by_trip[tid].append((int(seq), _secs(a), _secs(d), si))
        n_before = len(net.conns)
        for tid, st in by_trip.items():
            if len(st) < 2:
                continue
            st.sort()
            if st[-1][1] < t_lo or st[0][2] > t_hi:
                continue
            route, mode = trips[tid]
            ti = len(net.trip_route)
            added = False
            bit = MODE_BIT[mode]
            for (_s1, _a1, d1, u), (_s2, a2, _d2, v) in zip(st, st[1:]):
                if t_lo <= d1 <= t_hi and u != v:
                    net.conns.append((d1, a2, u, v, ti))
                    net.stop_mask[u] |= bit
                    net.stop_mask[v] |= bit
                    added = True
            if added:
                net.trip_route.append(route)
                net.trip_mode.append(mode)
        # transfers.txt often names parent stations (MTA subway does): apply them to every platform
        for fr, to, ttype, t in _rows(z, "transfers.txt", ["from_stop_id", "to_stop_id", "transfer_type",
                                                            "min_transfer_time"]):
            if ttype == "3":
                continue  # transfer not possible
            for a in children.get(fr) or [fr]:
                for b in children.get(to) or [to]:
                    u, v = sidx.get(f"{prefix}:{a}"), sidx.get(f"{prefix}:{b}")
                    if u is None or v is None or u == v:
                        continue
                    net.foot[v].append((u, int(t or 180)))
                    given.add((u, v))
        if log:
            log(f"  feed {prefix}: {len(net.stop_ids) - first_stop:,} stops, {len(net.conns) - n_before:,} hops "
                f"in the time window")
        z.close()
    net.conns.sort(key=lambda c: -c[0])
    # proximity footpaths (station complexes, nearby platforms, bus <-> subway, cross-feed transfers);
    # changing level between a platform and the street costs the difference in access time
    acc = [net.stop_access(i) for i in range(len(net.lat))]
    speed = net.walker.speed_ms
    cell = transfer_radius_m / 111000
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (la, lo) in enumerate(zip(net.lat, net.lon)):
        if net.stop_mask[i]:
            grid[(int(la / cell), int(lo / cell))].append(i)
    for i, (la, lo) in enumerate(zip(net.lat, net.lon)):
        if not net.stop_mask[i]:
            continue
        gi, gj = int(la / cell), int(lo / cell)
        js = [j for di in (-1, 0, 1) for dj in (-2, -1, 0, 1, 2) for j in grid.get((gi + di, gj + dj), ())
              if j != i and (j, i) not in given and haversine_m(la, lo, net.lat[j], net.lon[j]) <= transfer_radius_m]
        if js:
            for j, m in zip(js, net.walk_m(la, lo, np.asarray(js))):
                net.foot[i].append((j, int(60 + m / speed + abs(acc[i] - acc[j]))))
    return net


def mode_mask(modes) -> int:
    """Bit mask for an iterable of mode names; None or empty means every mode."""
    if not modes:
        return ALL_MODES
    return sum(MODE_BIT[m] for m in set(modes))


@dataclass
class Profile:
    """Latest departure from every stop that still reaches the destination on time."""

    arrive_by: int
    ld: list[int]
    ptr: list[tuple | None]
    mask: int = ALL_MODES
    _np: np.ndarray | None = field(default=None, repr=False)

    def ld_array(self) -> np.ndarray:
        if self._np is None:
            self._np = np.asarray(self.ld, dtype=np.int64)
        return self._np


def reverse_scan(net: Network, dest_lat: float, dest_lon: float, arrive_by: int,
                 walk_speed_ms: float, detour: float, max_egress_m: float = 1200,
                 transfer_buffer_s: int = 60, modes=None, egress_access: float = 0.0,
                 egress: dict[int, float] | None = None) -> Profile:
    """Latest departure from every stop to reach (dest_lat, dest_lon) by arrive_by, riding only `modes`.

    ptr[stop] records the first step of that journey: ("dest", walk_s, metres), ("walk", next_stop, s)
    or ("ride", trip, exit_stop, board_time, alight_time). Each trip keeps the exit with the most slack,
    so a ride does not overshoot and walk back. egress_access is the share of the stop's street-to-vehicle
    time also charged on the way out at the destination end (0 = none, 1 = the same as on the way in).
    egress: walking metres from each stop to the destination measured elsewhere (the street network,
    walknet.py); when given it replaces the walker and the max_egress_m / landmass filters.
    """
    mask = mode_mask(modes)
    n = len(net.stop_ids)
    ok = [bool(m & mask) for m in net.stop_mask]
    ld = [NEG] * n
    ptr: list[tuple | None] = [None] * n
    if egress is not None:
        near = [i for i in egress if 0 <= i < n and ok[i]]
        walked = [egress[i] for i in near]
    else:
        near = [i for i in range(n) if ok[i] and haversine_m(net.lat[i], net.lon[i], dest_lat, dest_lon) <= max_egress_m]
        if near:
            near = [i for i, k in zip(near, net.same_land(dest_lat, dest_lon, np.asarray(near))) if k]
        walked = net.walk_m(dest_lat, dest_lon, np.asarray(near)) if near else []
    if near:
        for i, m in zip(near, walked):
            w = int(m / net.walker.speed_ms + net.stop_access(i) * float(egress_access))
            ld[i] = arrive_by - w
            ptr[i] = ("dest", w, int(round(m)))
    trip_exit: dict[int, tuple[int, int, int]] = {}
    foot = net.foot

    def relax_foot(x: int) -> None:
        # one hop only: footpaths join stops within transfer_radius_m, so chaining them would be a long
        # walk made of short ones (and, on a dense bus-stop graph, a very slow flood fill)
        lx = ld[x]
        for w, t in foot.get(x, ()):
            if ok[w] and lx - t > ld[w]:
                ld[w] = lx - t
                ptr[w] = ("walk", x, t)

    for i in range(n):
        if ld[i] > NEG:
            relax_foot(i)
    for dep, arr, u, v, ti in net.conns_for(mask):
        ex = trip_exit.get(ti)
        lv = ld[v]
        if lv > NEG:
            pv = ptr[v]
            if not (pv[0] == "ride" and pv[1] == ti):
                slack = lv - arr - (0 if pv[0] == "dest" else transfer_buffer_s)
                if slack >= 0 and (ex is None or slack > ex[2]):
                    ex = trip_exit[ti] = (v, arr, slack)
        if ex is not None and dep > ld[u]:
            ld[u] = dep
            ptr[u] = ("ride", ti, ex[0], dep, ex[1])
            relax_foot(u)
    return Profile(arrive_by, ld, ptr, mask)


class StopIndex:
    def __init__(self, net: Network, cell_m: float = 400):
        self.net = net
        self.c = cell_m / 111000
        self.grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, (la, lo) in enumerate(zip(net.lat, net.lon)):
            self.grid[(int(la / self.c), int(lo / self.c))].append(i)

    def near(self, lat: float, lon: float, radius_m: float):
        r = int(math.ceil(radius_m / 111000 / self.c)) + 1
        gi, gj = int(lat / self.c), int(lon / self.c)
        for di in range(-r, r + 1):
            for dj in range(-2 * r, 2 * r + 1):
                for j in self.grid.get((gi + di, gj + dj), ()):
                    d = haversine_m(lat, lon, self.net.lat[j], self.net.lon[j])
                    if d <= radius_m:
                        yield j, d


def door_to_door(lat: float, lon: float, prof: Profile, idx: StopIndex, dest: tuple[float, float],
                 walk_speed_ms: float, detour: float, max_access_m: float,
                 station_access_s: float = 120) -> tuple[float, dict]:
    """Minutes from a home to the destination and a short route description (single-profile helper)."""
    walk_s = haversine_m(lat, lon, dest[0], dest[1]) * detour / walk_speed_ms
    best_dep, best = prof.arrive_by - walk_s, {"mode": "walk", "access_min": round(walk_s / 60, 1)}
    for j, d in idx.near(lat, lon, max_access_m):
        if prof.ld[j] <= NEG:
            continue
        acc = d * detour / walk_speed_ms + station_access_s
        dep = prof.ld[j] - acc
        if dep > best_dep:
            best_dep = dep
            best = {"mode": "transit", "stop": j, "access_min": round(acc / 60, 1)}
    minutes = (prof.arrive_by - best_dep) / 60
    return minutes, best


# ---------------------------------------------------------------- vectorised access for many points


@dataclass
class Access:
    """Stops within walking range of one point: index, access seconds (walk + street-to-vehicle), metres walked."""

    js: np.ndarray
    acc: np.ndarray
    dist: np.ndarray
    mask: np.ndarray


def access_points(net: Network, lat: float, lon: float, max_access_m: float, walk_speed_ms: float,
                  detour: float) -> Access:
    rlat, rlon, smask, sacc = net.arrays()
    phi, lam = math.radians(lat), math.radians(lon)
    a = np.sin((rlat - phi) / 2) ** 2 + math.cos(phi) * np.cos(rlat) * np.sin((rlon - lam) / 2) ** 2
    d = 2 * 6371008.8 * np.arcsin(np.sqrt(a))
    js = np.nonzero((d <= max_access_m) & (smask > 0))[0]
    js = js[net.same_land(lat, lon, js)]
    walked = net.walk_m(lat, lon, js)
    return Access(js, walked / net.walker.speed_ms + sacc[js], walked, smask[js])


def best_from(prof: Profile, acc: Access, walk_s: float) -> tuple[float, int, float]:
    """(minutes, stop index or -1 for walking, access seconds) for one point and profile."""
    best_dep, stop, a = prof.arrive_by - walk_s, -1, walk_s
    if len(acc.js):
        ldv = prof.ld_array()[acc.js]
        vals = np.where((ldv > NEG) & ((acc.mask & prof.mask) > 0), ldv - acc.acc, -np.inf)
        k = int(np.argmax(vals))
        if vals[k] > best_dep:
            best_dep, stop, a = float(vals[k]), int(acc.js[k]), float(acc.acc[k])
    return (prof.arrive_by - best_dep) / 60, stop, a


# ---------------------------------------------------------------- journeys: legs and route text


def journey(net: Network, prof: Profile, start: int, access_s: float, access_m: float,
            detour: float = 1.25) -> list[dict]:
    """Legs of the trip that boards at `start`: walk, rides (with board/alight clock times), transfers, walk."""
    t = prof.ld[start] - access_s  # leave home
    legs: list[dict] = [{"mode": "walk", "min": round(access_s / 60, 1), "m": int(round(access_m)),
                         "to": net.stop_name[start]}]
    t += access_s
    s, guard, last_ti = start, 0, None
    while guard < 60:
        guard += 1
        p = prof.ptr[s]
        if p is None:
            break
        if p[0] == "dest":
            w = legs[-1]
            if w["mode"] == "transfer" and len(legs) > 1:  # a footpath straight into the final walk
                legs.pop()
                legs.append({"mode": "walk", "min": round(w["min"] + p[1] / 60, 1),
                             "m": int(p[2] + w.get("m", 0)), "from": w["at"], "to": "destination"})
            else:
                legs.append({"mode": "walk", "min": round(p[1] / 60, 1), "m": int(p[2]),
                             "from": net.stop_name[s], "to": "destination"})
            break
        if p[0] == "walk":
            nxt, ft = p[1], p[2]
            dm = int(round(net.walker.metres(net.lat[s], net.lon[s], net.lat[nxt], net.lon[nxt])))
            last = legs[-1]
            if last["mode"] == "walk" and len(legs) == 1:  # still on the way to the first stop
                last.update(min=round(last["min"] + ft / 60, 1), m=last["m"] + dm, to=net.stop_name[nxt])
            elif last["mode"] == "transfer":
                last.update(min=round(last["min"] + ft / 60, 1), m=last.get("m", 0) + dm, to=net.stop_name[nxt])
            else:
                legs.append({"mode": "transfer", "min": round(ft / 60, 1), "m": dm, "at": net.stop_name[s],
                             "to": net.stop_name[nxt]})
            if legs[-1].get("to") == legs[-1].get("at"):
                legs[-1].pop("to")  # a change of platform inside one station
            t += ft
            s = nxt
            continue
        _, ti, ex, dep, arr = p
        last = legs[-1]
        if last_ti == ti and last.get("route") == net.trip_route[ti]:
            last.update(to=net.stop_name[ex], alight=clock(arr), min=round((arr - _clock_s(last["board"])) / 60, 1))
        else:
            wait = max(0, dep - t)
            leg = {"mode": net.trip_mode[ti], "route": net.trip_route[ti], "from": net.stop_name[s],
                   "to": net.stop_name[ex], "board": clock(dep), "alight": clock(arr),
                   "min": round((arr - dep) / 60, 1)}
            if wait >= 30 and len(legs) > 1:
                leg["wait"] = round(wait / 60, 1)
            legs.append(leg)
        last_ti, t, s = ti, arr, ex
    return legs


def _clock_s(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 3600 + int(m) * 60


def legs_summary(legs: list[dict]) -> dict:
    rides = [x for x in legs if x["mode"] not in ("walk", "transfer")]
    kinds = {x["mode"] for x in rides}
    return {"via": "walk" if not rides else (kinds.pop() if len(kinds) == 1 else "mixed"),
            "transfers": max(0, len(rides) - 1),
            "ride_min": round(sum(x["min"] for x in rides), 1),
            "walk_min": round(sum(x["min"] for x in legs if x["mode"] in ("walk", "transfer")), 1),
            "wait_min": round(sum(x.get("wait", 0) for x in rides), 1)}


def route_text(legs: list[dict]) -> str:
    """'walk 10 min to 50 St → 1 to Times Sq-42 St → 7 to Grand Central-42 St → walk 2 min to destination'.

    Subway and rail rides read '<route> to <stop>'; buses read 'bus <route> to <stop>'.
    """
    steps = []
    for x in legs:
        if x["mode"] == "walk":
            steps.append(f"walk {x['min']:.0f} min to {x['to']}")
        elif x["mode"] == "transfer":
            continue
        elif x["mode"] == "bus":
            steps.append(f"bus {x['route']} to {x['to']}")
        elif x["mode"] == "ferry":
            steps.append(f"ferry {x['route']} to {x['to']}")
        else:
            steps.append(f"{x['route']} to {x['to']}")
    return " → ".join(steps)


def describe_route(net: Network, prof: Profile, start_stop: int, access_min: float) -> str:
    """Route text for the journey boarding at start_stop (kept for callers of the single-mode API)."""
    return route_text(journey(net, prof, start_stop, access_min * 60, 0))
