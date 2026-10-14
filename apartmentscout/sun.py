"""Solar position, obstruction skylines and direct-sun hours for a window.

The math matches the dashboard's 3D view (dashboard/js/sun.js), so numbers in
reports and on screen agree; tests/fixtures/sun_parity.json pins both to the same values.

Geometry rules (site JSON v2):

* every footprint edge is a wall from the ground to the roof (``top``), including the edges of
  inner rings (``holes``: light courts and courtyards), so a court is open air bounded by walls;
* target-building facades whose outside lies inside another footprint are party walls
  (``shared``) and are never chosen for the window;
* the skyline for a point is, per 0.5 degree of azimuth, the highest angle subtended by the first
  wall crossed in that direction for each building.
"""
from __future__ import annotations

import datetime as dt
import math
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo

import numpy as np

from .geo.shapes import bbox, point_in_poly

RAD = math.pi / 180
NB = 720  # skyline bins (0.5 degree)
STEP_MIN = 6
POSITIONS = (0.2, 0.5, 0.8)


def sun_position(when: dt.datetime, lat: float, lon: float) -> tuple[float, float]:
    """(azimuth clockwise from north, altitude) in degrees for an aware datetime."""
    ms = when.timestamp() * 1000
    return sun_position_ms(ms, lat, lon)


def sun_position_ms(ms: float, lat: float, lon: float) -> tuple[float, float]:
    d = ms / 864e5 - 0.5 + 2440588 - 2451545
    lw, phi = RAD * -lon, RAD * lat
    M = RAD * (357.5291 + 0.98560028 * d)
    C = RAD * (1.9148 * math.sin(M) + 0.02 * math.sin(2 * M) + 0.0003 * math.sin(3 * M))
    L = M + C + RAD * 102.9372 + math.pi
    e = RAD * 23.4397
    dec = math.asin(math.sin(L) * math.sin(e))
    ra = math.atan2(math.sin(L) * math.cos(e), math.cos(L))
    H = RAD * (280.16 + 360.9856235 * d) - lw - ra
    az = math.atan2(math.sin(H), math.cos(H) * math.sin(phi) - math.tan(dec) * math.cos(phi))
    alt = math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(H))
    return ((az / RAD + 180) % 360, alt / RAD)


def day_track(date: dt.date, lat: float, lon: float, tz: str, step_min: int = STEP_MIN) -> list[tuple[int, float, float]]:
    z = ZoneInfo(tz)
    out = []
    for m in range(0, 1440, step_min):
        t = dt.datetime(date.year, date.month, date.day, m // 60, m % 60, tzinfo=z)
        az, alt = sun_position(t, lat, lon)
        if alt > 0:
            out.append((m, az, alt))
    return out


def month_tracks(year: int, lat: float, lon: float, tz: str, day: int = 15) -> list[list[tuple[int, float, float]]]:
    return [day_track(dt.date(year, m, day), lat, lon, tz) for m in range(1, 13)]


# --------------------------------------------------------------------------- skyline

def _site_rings(site: dict, include_future: bool = False) -> list[tuple[float, list[tuple[float, float]]]]:
    """(top, ring) for every wall ring: outer rings, hole rings and (optionally) future buildings."""
    out = []
    holes = site.get("holes") or {}
    for i, (top, _g, _t, flat) in enumerate(site["b"]):
        out.append((top, list(zip(flat[0::2], flat[1::2]))))
        for h in holes.get(str(i), []):
            out.append((top, [tuple(p) for p in h]))
    if include_future:
        for f in site.get("future") or []:
            if f.get("ring") and f.get("h"):
                out.append((float(f["h"]), [tuple(p) for p in f["ring"]]))
    return out


class Skyline:
    """Obstruction angle (degrees above horizon) in 0.5 degree azimuth bins.

    All wall edges are held in flat numpy arrays so one profile is a few vectorised passes.
    """

    def __init__(self, site: dict, include_future: bool = False, chunk: int = 1500):
        pts, edges, tops = [], [], []
        for t, ring in _site_rings(site, include_future):
            p = np.asarray(ring, dtype=float)
            if len(p) < 2:
                continue
            pts.append(p)
            edges.append(np.roll(p, -1, axis=0) - p)
            tops.append(np.full(len(p), float(t)))
        P = np.concatenate(pts) if pts else np.zeros((0, 2))
        E = np.concatenate(edges) if edges else np.zeros((0, 2))
        self.ax, self.ay, self.ex, self.ey = P[:, 0], P[:, 1], E[:, 0], E[:, 1]
        self.top = np.concatenate(tops) if tops else np.zeros(0)
        az = np.arange(NB) * 0.5 * RAD
        self.ux, self.uy = np.sin(az)[:, None], np.cos(az)[:, None]
        self.chunk = chunk

    def profile(self, px: float, py: float, pz: float) -> np.ndarray:
        best = np.zeros(NB)
        m = self.top > pz
        if not m.any():
            return best
        ax, ay, ex, ey, sl = self.ax[m] - px, self.ay[m] - py, self.ex[m], self.ey[m], self.top[m] - pz
        ux, uy = self.ux, self.uy
        for k in range(0, len(sl), self.chunk):
            s_ = slice(k, k + self.chunk)
            wx, wy, e_x, e_y = ax[s_], ay[s_], ex[s_], ey[s_]
            den = ux * e_y - uy * e_x
            with np.errstate(divide="ignore", invalid="ignore"):
                t = (wx * e_y - wy * e_x) / den
                s = (wx * uy - wy * ux) / den
                ok = (np.abs(den) >= 1e-9) & (t > 0.01) & (s >= 0) & (s <= 1)
                q = np.where(ok, sl[s_] / t, 0.0)
            best = np.maximum(best, q.max(axis=1))
        return np.degrees(np.arctan(best))


def at(profile: np.ndarray, az: float) -> float:
    f = (az % 360) / 0.5
    i = int(f) % NB
    j = (i + 1) % NB
    w = f - int(f)
    return float(profile[i] * (1 - w) + profile[j] * w)


def at_many(profile: np.ndarray, az: np.ndarray) -> np.ndarray:
    f = (np.asarray(az) % 360) / 0.5
    fl = np.floor(f)
    i = fl.astype(int) % NB
    j = (i + 1) % NB
    w = f - fl
    return profile[i] * (1 - w) + profile[j] * w


def lit_minutes(track, profile, facing: float, step_min: int = STEP_MIN) -> tuple[int, list[tuple[int, int]]]:
    total, segs, cur = 0, [], None
    for m, az, alt in track:
        diff = (az - facing + 540) % 360 - 180
        if abs(diff) < 90 and alt > at(profile, az):
            total += step_min
            if cur is None:
                cur = [m, m + step_min]
                segs.append(cur)
            else:
                cur[1] = m + step_min
        else:
            cur = None
    return total, [tuple(s) for s in segs]


class _Tracks:
    """Month tracks as arrays for fast lit-minute sums."""

    def __init__(self, tracks: list[list[tuple[int, float, float]]], step_min: int = STEP_MIN):
        self.az = [np.array([a for _, a, _ in tr]) for tr in tracks]
        self.alt = [np.array([h for _, _, h in tr]) for tr in tracks]
        self.step = step_min

    def hours(self, profile: np.ndarray, facing: float) -> list[float]:
        out = []
        for az, alt in zip(self.az, self.alt):
            if not len(az):
                out.append(0.0)
                continue
            diff = (az - facing + 540) % 360 - 180
            lit = (np.abs(diff) < 90) & (alt > at_many(profile, az))
            out.append(round(int(lit.sum()) * self.step / 60, 2))
        return out


# --------------------------------------------------------------------------- facades

def _others(site: dict) -> list[tuple[tuple, list, list, float]]:
    """(bbox, outer, holes, top) for every footprint except the target."""
    holes = site.get("holes") or {}
    out = []
    for i, (top, _g, _t, flat) in enumerate(site["b"]):
        if i == site.get("target"):
            continue
        ring = list(zip(flat[0::2], flat[1::2]))
        out.append((bbox(ring), ring, [[tuple(p) for p in h] for h in holes.get(str(i), [])], top))
    return out


def blocked_samples(face: dict, others, n: int = 24, offsets: Sequence[float] = (0.5, 1.0, 1.5)) -> list[float | None]:
    """For n points along the face: the roof height of a neighbour footprint found just outside, else None."""
    (x1, y1), (x2, y2) = face["a"], face["b"]
    b = face["bearing"] * RAD
    nx, ny = math.sin(b), math.cos(b)
    out: list[float | None] = []
    for k in range(n):
        t = (k + 0.5) / n
        x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        hit = None
        for d in offsets:
            px, py = x + nx * d, y + ny * d
            for (bx0, by0, bx1, by1), ring, holes, top in others:
                if bx0 <= px <= bx1 and by0 <= py <= by1 and point_in_poly(px, py, ring, holes):
                    hit = max(hit or 0.0, top)
        out.append(hit)
    return out


def _open_span(blocked: list[float | None]) -> tuple[float, float] | None:
    n = len(blocked)
    best, cur = None, None
    for k, b in enumerate(blocked):
        if b is None:
            cur = (cur[0], k + 1) if cur else (k, k + 1)
            if best is None or cur[1] - cur[0] > best[1] - best[0]:
                best = cur
        else:
            cur = None
    return (best[0] / n, best[1] / n) if best else None


def target_faces(site: dict, min_len: float = 8.0, party_walls: bool = True,
                 min_open_m: float = 4.0) -> list[dict]:
    """Facades of the target building: midpoint, outward bearing, length and party-wall status.

    A face gets ``shared: True`` when points 0.5-1.5 m outside it fall inside another footprint
    along all but less than ``min_open_m`` of its length. A partly shared face keeps ``open`` = the
    longest unobstructed stretch as [t0, t1] (0..1 along a->b) and ``shared_frac``.
    """
    if site.get("target") is None:
        return []
    flat = site["b"][site["target"]][3]
    p = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
    area = sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2
    others = _others(site) if party_walls else []
    faces = []
    for i in range(len(p)):
        (x1, y1), (x2, y2) = p[i], p[(i + 1) % len(p)]
        ex, ey = x2 - x1, y2 - y1
        ln = math.hypot(ex, ey)
        if ln < min_len:
            continue
        # outward normal: right of the edge for counter-clockwise rings
        nx, ny = (ey, -ex) if area > 0 else (-ey, ex)
        brg = (math.degrees(math.atan2(nx, ny)) + 360) % 360
        f = {"i": i, "mid": ((x1 + x2) / 2, (y1 + y2) / 2), "a": (x1, y1), "b": (x2, y2),
             "bearing": round(brg, 1), "length": round(ln, 1)}
        if others:
            bl = blocked_samples(f, others)
            frac = sum(b is not None for b in bl) / len(bl)
            if frac > 0:
                span = _open_span(bl)
                open_m = (span[1] - span[0]) * ln if span else 0.0
                f["shared_frac"] = round(frac, 2)
                f["shared_h"] = round(max(b for b in bl if b is not None), 1)
                if open_m < min_open_m:
                    f["shared"] = True
                else:
                    f["open"] = [round(span[0], 3), round(span[1], 3)]
        faces.append(f)
    return faces


def face_span(face: dict) -> tuple[float, float]:
    return tuple(face.get("open") or (0.0, 1.0))  # type: ignore[return-value]


def window_t(face: dict) -> float:
    """Default window position: the middle of the face's open (non-party-wall) stretch."""
    t0, t1 = face_span(face)
    return round((t0 + t1) / 2, 3)


def window_point(face: dict, t: float, floor: float, floor_h: float = 3.2, out_m: float = 0.4):
    (x1, y1), (x2, y2) = face["a"], face["b"]
    x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
    b = face["bearing"] * RAD
    return x + math.sin(b) * out_m, y + math.cos(b) * out_m, (floor - 1) * floor_h + 1.6


EXPOSURE_DEG = {"N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
                "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5}


def _open_len(f: dict) -> float:
    t0, t1 = face_span(f)
    return f["length"] * (t1 - t0)


def pick_face(faces: list[dict], exposure: Iterable[str] | None, tol: float = 30) -> dict | None:
    """The facade matching the listing's exposure (first listed direction that matches).

    Party walls (``shared``) are never chosen. Among faces with the same bearing (to the degree)
    the one with the longest open stretch wins.
    """
    cands = [f for f in faces if not f.get("shared")]
    if not cands:
        return None
    for ex in exposure or []:
        want = EXPOSURE_DEG.get(str(ex).upper().strip())
        if want is None:
            continue
        best = min(cands, key=lambda f: (round(abs((f["bearing"] - want + 540) % 360 - 180)), -_open_len(f)))
        if abs((best["bearing"] - want + 540) % 360 - 180) <= tol:
            return best
    return None


def face_by_bearing(faces: list[dict], bearing: float) -> dict | None:
    cands = [f for f in faces if not f.get("shared")]
    if not cands:
        return None
    return min(cands, key=lambda f: (round(abs((f["bearing"] - bearing + 540) % 360 - 180)), -_open_len(f)))


# --------------------------------------------------------------------------- studies

def _target_height(site: dict) -> float:
    if site.get("target") is None:
        return 30
    return site["b"][site["target"]][0] - site["b"][site["target"]][1]


def max_floor(site: dict) -> int:
    return max(2, int(_target_height(site) / site.get("floor_height_m", 3.2)))


def sun_study(site: dict, face: dict, floor: int, tz: str, year: int, t: float | None = None,
              floors: range | None = None, sky: Skyline | None = None, tracks: _Tracks | None = None) -> dict:
    lat, lon = site["origin"]["lat"], site["origin"]["lon"]
    t = window_t(face) if t is None else t
    fh = site.get("floor_height_m", 3.2)
    sky = sky or Skyline(site)
    tracks = tracks or _Tracks(month_tracks(year, lat, lon, tz))
    floors = floors or range(2, max_floor(site) + 1)
    table = {f: tracks.hours(sky.profile(*window_point(face, t, f, fh)), face["bearing"]) for f in floors}
    prof = sky.profile(*window_point(face, t, floor, fh))
    ahead = at(prof, face["bearing"])
    open_sky = float(np.mean([60 - min(60, at(prof, face["bearing"] + d)) for d in range(-60, 61)]) / 60)
    return {"face_bearing": face["bearing"], "floor": floor, "t": t,
            "sun_hours": table.get(floor) or tracks.hours(prof, face["bearing"]),
            "floors_table": table, "skyline_ahead_deg": round(ahead, 1), "open_sky_share": round(open_sky, 3),
            "profile": [round(float(v), 1) for v in prof]}


def sun_hours_range(site: dict, face: dict, floor: int, tz: str, year: int,
                    positions: Sequence[float] = POSITIONS, floor_delta: int = 2,
                    sky: Skyline | None = None, tracks: _Tracks | None = None) -> dict:
    """Min and max direct-sun hours per month over window positions along the facade and nearby floors.

    Positions are fractions of the face's open (non-party-wall) stretch, reported as t along the
    whole face. Floors are ``floor - floor_delta .. floor + floor_delta`` clipped to the building.
    """
    lat, lon = site["origin"]["lat"], site["origin"]["lon"]
    fh = site.get("floor_height_m", 3.2)
    sky = sky or Skyline(site)
    tracks = tracks or _Tracks(month_tracks(year, lat, lon, tz))
    t0, t1 = face_span(face)
    ts = [round(t0 + (t1 - t0) * p, 3) for p in positions]
    fl = [f for f in range(floor - floor_delta, floor + floor_delta + 1) if 2 <= f <= max_floor(site)] or [floor]
    grid = np.array([[tracks.hours(sky.profile(*window_point(face, t, f, fh)), face["bearing"]) for t in ts]
                     for f in fl])  # floors x positions x 12
    return {"lo": [round(float(v), 2) for v in grid.min(axis=(0, 1))],
            "hi": [round(float(v), 2) for v in grid.max(axis=(0, 1))],
            "positions": ts, "floors": fl}


def future_sun_hours(site: dict, face: dict, floor: int, t: float, tz: str, year: int,
                     tracks: _Tracks | None = None) -> list[float] | None:
    """Sun hours with filed / under-construction buildings added (None if there are none)."""
    if not site.get("future"):
        return None
    lat, lon = site["origin"]["lat"], site["origin"]["lon"]
    tracks = tracks or _Tracks(month_tracks(year, lat, lon, tz))
    sky = Skyline(site, include_future=True)
    return tracks.hours(sky.profile(*window_point(face, t, floor, site.get("floor_height_m", 3.2))), face["bearing"])
