"""Door-to-door transit commute times from public GTFS feeds.

Method: a reverse Connection Scan (CSA). For a destination and an arrive-by
time, it scans every scheduled vehicle hop of the chosen weekday backwards and
finds, for every stop, the latest you can leave that stop and still arrive on
time. A home's commute is then

    arrive_by - max over nearby stops (latest_departure(stop) - walk(home -> stop))

compared with simply walking. Walking uses straight-line distance times a detour
factor (1.25 by default, right for a street grid) at your walking speed.

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
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import requests

from ..geo import haversine_m

NEG = -10**9


def _secs(t: str) -> int:
    h, m, s = t.strip().split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _hhmm(t: str) -> int:
    parts = t.strip().split(":")
    return int(parts[0]) * 3600 + int(parts[1]) * 60


def download_feed(url: str, dest: Path, max_age_days: int = 14) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and (dt.datetime.now().timestamp() - dest.stat().st_mtime) < max_age_days * 86400:
        return dest
    r = requests.get(url, timeout=120, headers={"User-Agent": "ApartmentScout/0.1"})
    r.raise_for_status()
    dest.write_bytes(r.content)
    return dest


@dataclass
class Network:
    stop_ids: list[str] = field(default_factory=list)
    stop_name: list[str] = field(default_factory=list)
    lat: list[float] = field(default_factory=list)
    lon: list[float] = field(default_factory=list)
    # connections: (dep, arr, from_stop, to_stop, trip_idx), sorted by dep descending
    conns: list[tuple[int, int, int, int, int]] = field(default_factory=list)
    trip_route: list[str] = field(default_factory=list)
    foot: dict[int, list[tuple[int, int]]] = field(default_factory=lambda: defaultdict(list))


def _read(z: zipfile.ZipFile, name: str):
    try:
        with z.open(name) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
    except KeyError:
        return


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
    """Closest Tuesday-Thursday with service, for feeds whose calendar does not cover `day`."""
    lo, hi = feed_dates(z)
    try:
        a, b = dt.datetime.strptime(lo, "%Y%m%d").date(), dt.datetime.strptime(hi, "%Y%m%d").date()
    except ValueError:
        return None
    cands = [a + dt.timedelta(days=i) for i in range((b - a).days + 1)]
    cands = [c for c in cands if c.weekday() in (1, 2, 3)]
    for c in sorted(cands, key=lambda c: abs((c - day).days)):
        if active_services(z, c):
            return c
    return None


def feed_dates(z: zipfile.ZipFile) -> tuple[str, str]:
    lo, hi = "99999999", "00000000"
    for r in _read(z, "calendar.txt"):
        lo, hi = min(lo, r["start_date"]), max(hi, r["end_date"])
    return lo, hi


def load_network(feeds: list[tuple[str, Path]], day: dt.date, t_lo: int, t_hi: int,
                 walk_speed_ms: float, detour: float, transfer_radius_m: float = 250) -> Network:
    """Load all connections departing in [t_lo, t_hi] seconds after midnight on `day`."""
    net = Network()
    sidx: dict[str, int] = {}
    for prefix, path in feeds:
        z = zipfile.ZipFile(path)
        services = active_services(z, day)
        if not services:
            alt = nearest_service_day(z, day)
            if alt is None:
                lo, hi = feed_dates(z)
                raise ValueError(f"Feed {prefix} has no service on {day} (calendar {lo}-{hi}); "
                                 f"set commute.transit.service_date to a weekday in that range.")
            print(f"  note: feed {prefix} has no service on {day}; using {alt} (same weekday pattern)")
            services = active_services(z, alt)
        routes = {r["route_id"]: (r.get("route_short_name") or r.get("route_long_name") or r["route_id"])
                  for r in _read(z, "routes.txt")}
        for r in _read(z, "stops.txt"):
            if r.get("location_type") not in (None, "", "0"):
                continue
            key = f"{prefix}:{r['stop_id']}"
            sidx[key] = len(net.stop_ids)
            net.stop_ids.append(key)
            net.stop_name.append(r.get("stop_name", ""))
            net.lat.append(float(r["stop_lat"]))
            net.lon.append(float(r["stop_lon"]))
        trips = {}
        for r in _read(z, "trips.txt"):
            if r["service_id"] in services:
                trips[r["trip_id"]] = routes.get(r["route_id"], r["route_id"])
        tidx: dict[str, int] = {}
        by_trip: dict[str, list[tuple[int, int, int, int]]] = defaultdict(list)
        for r in _read(z, "stop_times.txt"):
            tid = r["trip_id"]
            if tid not in trips:
                continue
            a, d = r.get("arrival_time") or r.get("departure_time"), r.get("departure_time") or r.get("arrival_time")
            if not a:
                continue
            si = sidx.get(f"{prefix}:{r['stop_id']}")
            if si is None:
                continue
            by_trip[tid].append((int(r["stop_sequence"]), _secs(a), _secs(d), si))
        for tid, st in by_trip.items():
            st.sort()
            if st[-1][1] < t_lo or st[0][2] > t_hi:
                continue
            ti = tidx.setdefault(tid, len(net.trip_route))
            if ti == len(net.trip_route):
                net.trip_route.append(trips[tid])
            for (s1, _a1, d1, u), (s2, a2, _d2, v) in zip(st, st[1:]):
                if t_lo <= d1 <= t_hi and u != v:
                    net.conns.append((d1, a2, u, v, ti))
        for r in _read(z, "transfers.txt"):
            u, v = sidx.get(f"{prefix}:{r['from_stop_id']}"), sidx.get(f"{prefix}:{r['to_stop_id']}")
            if u is None or v is None or u == v:
                continue
            t = int(r.get("min_transfer_time") or 180)
            net.foot[v].append((u, t))
    net.conns.sort(key=lambda c: -c[0])
    # proximity footpaths (station complexes, nearby platforms, cross-feed transfers)
    cell = transfer_radius_m / 111000
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (la, lo) in enumerate(zip(net.lat, net.lon)):
        grid[(int(la / cell), int(lo / cell))].append(i)
    for i, (la, lo) in enumerate(zip(net.lat, net.lon)):
        gi, gj = int(la / cell), int(lo / cell)
        for di in (-1, 0, 1):
            for dj in (-2, -1, 0, 1, 2):
                for j in grid.get((gi + di, gj + dj), ()):
                    if j == i:
                        continue
                    d = haversine_m(la, lo, net.lat[j], net.lon[j])
                    if d <= transfer_radius_m:
                        net.foot[i].append((j, int(60 + d * detour / walk_speed_ms)))
    return net


@dataclass
class Profile:
    """Latest departure from every stop that still reaches the destination on time."""

    arrive_by: int
    ld: list[int]
    ptr: list[tuple | None]


def reverse_scan(net: Network, dest_lat: float, dest_lon: float, arrive_by: int,
                 walk_speed_ms: float, detour: float, max_egress_m: float = 1200,
                 transfer_buffer_s: int = 60) -> Profile:
    n = len(net.stop_ids)
    ld = [NEG] * n
    ptr: list[tuple | None] = [None] * n
    for i in range(n):
        d = haversine_m(net.lat[i], net.lon[i], dest_lat, dest_lon)
        if d <= max_egress_m:
            ld[i] = arrive_by - int(d * detour / walk_speed_ms)
            ptr[i] = ("dest", int(d * detour / walk_speed_ms))
    trip_exit: dict[int, int] = {}

    def relax_foot(u: int) -> None:
        stack = [u]
        while stack:
            x = stack.pop()
            for w, t in net.foot.get(x, ()):
                if ld[x] - t > ld[w]:
                    ld[w] = ld[x] - t
                    ptr[w] = ("walk", x, t)
                    stack.append(w)

    for i in range(n):
        if ld[i] > NEG:
            relax_foot(i)
    for dep, arr, u, v, ti in net.conns:
        if ti in trip_exit:
            ok = True
        elif ld[v] > NEG and arr + (0 if ptr[v] and ptr[v][0] == "dest" else transfer_buffer_s) <= ld[v]:
            trip_exit[ti] = v
            ok = True
        else:
            ok = False
        if ok and dep > ld[u]:
            ld[u] = dep
            ptr[u] = ("ride", ti, trip_exit[ti])
            relax_foot(u)
    return Profile(arrive_by, ld, ptr)


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
    """Minutes from a home to the destination and a short route description."""
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


def describe_route(net: Network, prof: Profile, start_stop: int, access_min: float) -> str:
    steps = [f"walk {access_min:.0f} min to {net.stop_name[start_stop]}"]
    s, guard = start_stop, 0
    last_route = None
    while s is not None and guard < 30:
        guard += 1
        p = prof.ptr[s]
        if p is None:
            break
        if p[0] == "dest":
            steps.append(f"walk {p[1] / 60:.0f} min to destination")
            break
        if p[0] == "walk":
            s = p[1]
            continue
        if p[0] == "ride":
            route, exit_stop = net.trip_route[p[1]], p[2]
            if route != last_route:
                steps.append(f"{route} to {net.stop_name[exit_stop]}")
            last_route = route
            s = exit_stop
    return " → ".join(steps)
