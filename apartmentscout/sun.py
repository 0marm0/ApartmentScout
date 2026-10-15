"""Solar position, obstruction skylines and direct-sun hours for a window.

The math matches the dashboard's 3D view (dashboard/js/sun.js), so numbers in
reports and on screen agree; tests/fixtures/sun_parity.json pins both to the same values.

Geometry rules (site JSON v2):

* every footprint edge is a wall from the ground to the roof (``top``), including the edges of
  inner rings (``holes``: light courts and courtyards), so a court is open air bounded by walls;
* target-building facades whose outside lies inside another footprint are party walls
  (``shared``) and are never chosen for the window;
* the skyline for a point is, per 0.5 degree of azimuth, the highest angle subtended by the first
  wall crossed in that direction for each building;
* a window may have several panes (a bay): ``panes`` are bearing offsets from the facade normal
  (default ``[0]``; a 45 degree bay is ``[-45, 0, 45]``). The sun is in the room when it is above
  the skyline at the window and in front of at least one pane (the union over panes). All panes
  share the window point's skyline;
* a building may carry ``components`` (site JSON ``"components": {"<b index>": [...]}``): podium,
  tower, setback and bulkhead prisms, each a ring with ``base_m`` and ``top_m`` above the building's
  own ground. When present they replace the single footprint prism in every obstruction calculation
  (skyline, blockers, sun hours, floors table, range). The skyline keeps one obstruction angle per
  direction, so each component counts from the ground up (``base_m`` is kept for the renderer and
  the record): the open gap under an overhang is not modelled;
* diffuse light is a relative model, not photometry: ``sky_view`` weights the visible sky by a CIE
  standard overcast sky as seen by a vertical window (see ``sky_view`` and ``daylight_factor_est``).
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

COMPONENT_KINDS = ("podium", "tower", "setback", "bulkhead", "spire")


def _ring_ok(ring) -> bool:
    try:
        return len(ring) >= 3 and all(len(p) >= 2 and math.isfinite(float(p[0])) and math.isfinite(float(p[1]))
                                      for p in ring)
    except (TypeError, ValueError):
        return False


def valid_component(c) -> bool:
    """A usable component: a ring of >= 3 finite points and 0 <= base_m < top_m."""
    if not isinstance(c, dict) or not _ring_ok(c.get("ring")):
        return False
    try:
        base, top = float(c.get("base_m") or 0), float(c["top_m"])
    except (KeyError, TypeError, ValueError):
        return False
    return math.isfinite(base) and math.isfinite(top) and 0 <= base < top


def components_of(site: dict) -> dict[int, list[dict]]:
    """Valid components per building index (buildings without any keep their single prism)."""
    out: dict[int, list[dict]] = {}
    n = len(site.get("b") or [])
    for k, lst in (site.get("components") or {}).items():
        try:
            i = int(k)
        except (TypeError, ValueError):
            continue
        ok = [c for c in lst or [] if valid_component(c)] if 0 <= i < n else []
        if ok:
            out[i] = ok
    return out


def _site_rings(site: dict, include_future: bool = False) -> list[tuple[float, list[tuple[float, float]], int]]:
    """(top, ring, owner) for every wall ring: outer rings, hole rings and (optionally) future buildings.

    ``owner`` is the index in ``site["b"]``, or ``-(k + 1)`` for ``site["future"][k]``. A building with
    ``components`` contributes each component's ring (and its own holes) at its own top
    (ground + ``top_m``) instead of the footprint prism.
    """
    out = []
    holes = site.get("holes") or {}
    comps = components_of(site)
    for i, (top, g, _t, flat) in enumerate(site["b"]):
        if i in comps:
            for c in comps[i]:
                ct = float(g) + float(c["top_m"])
                out.append((ct, [(float(p[0]), float(p[1])) for p in c["ring"]], i))
                for h in c.get("holes") or []:
                    if _ring_ok(h):
                        out.append((ct, [(float(p[0]), float(p[1])) for p in h], i))
            continue
        out.append((top, list(zip(flat[0::2], flat[1::2])), i))
        for h in holes.get(str(i), []):
            out.append((top, [tuple(p) for p in h], i))
    if include_future:
        for k, f in enumerate(site.get("future") or []):
            if f.get("ring") and f.get("h"):
                out.append((float(f["h"]), [tuple(p) for p in f["ring"]], -(k + 1)))
    return out


class Skyline:
    """Obstruction angle (degrees above horizon) in 0.5 degree azimuth bins.

    All wall edges are held in flat numpy arrays so one profile is a few vectorised passes.
    """

    def __init__(self, site: dict, include_future: bool = False, chunk: int = 1500):
        pts, edges, tops, owners = [], [], [], []
        for t, ring, owner in _site_rings(site, include_future):
            p = np.asarray(ring, dtype=float)
            if len(p) < 2:
                continue
            pts.append(p)
            edges.append(np.roll(p, -1, axis=0) - p)
            tops.append(np.full(len(p), float(t)))
            owners.append(np.full(len(p), owner, dtype=int))
        P = np.concatenate(pts) if pts else np.zeros((0, 2))
        E = np.concatenate(edges) if edges else np.zeros((0, 2))
        self.ax, self.ay, self.ex, self.ey = P[:, 0], P[:, 1], E[:, 0], E[:, 1]
        self.top = np.concatenate(tops) if tops else np.zeros(0)
        self.owner = np.concatenate(owners) if owners else np.zeros(0, dtype=int)
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

    def blocker(self, px: float, py: float, pz: float, az: float, alt: float) -> tuple[int, float] | None:
        """The building that hides the sun at (az, alt) from a point: (owner, distance in metres).

        The first wall along the ray whose top is above the sun line, so the nearest of several
        blockers. ``owner`` follows ``_site_rings`` (negative = a future building). None if clear.
        """
        tan_alt = math.tan(max(alt, 0.0) * RAD)
        m = self.top > pz
        if not m.any():
            return None
        ux, uy = math.sin(az * RAD), math.cos(az * RAD)
        wx, wy, ex, ey = self.ax[m] - px, self.ay[m] - py, self.ex[m], self.ey[m]
        den = ux * ey - uy * ex
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (wx * ey - wy * ex) / den
            s = (wx * uy - wy * ux) / den
            ok = (np.abs(den) >= 1e-9) & (t > 0.01) & (s >= 0) & (s <= 1) & ((self.top[m] - pz) > t * tan_alt)
        if not ok.any():
            return None
        k = int(np.argmin(np.where(ok, t, np.inf)))
        return int(self.owner[m][k]), float(t[k])


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


def pane_facings(facing: float, panes: Sequence[float] | None = None) -> list[float]:
    """Outward bearings of a window's panes (``panes`` = offsets from the facade normal, default [0])."""
    return [(facing + float(o)) % 360 for o in (panes if panes else (0,))]


def in_front(az: float, facing: float, panes: Sequence[float] | None = None) -> bool:
    """True when the sun's azimuth is in front of at least one pane (within 90 degrees of its normal)."""
    return any(abs((az - f + 540) % 360 - 180) < 90 for f in pane_facings(facing, panes))


def lit_minutes(track, profile, facing: float, step_min: int = STEP_MIN,
                panes: Sequence[float] | None = None) -> tuple[int, list[tuple[int, int]]]:
    """Direct-sun minutes and lit segments for one day; with ``panes`` the union over panes."""
    total, segs, cur = 0, [], None
    for m, az, alt in track:
        if in_front(az, facing, panes) and alt > at(profile, az):
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

    def hours(self, profile: np.ndarray, facing: float, panes: Sequence[float] | None = None) -> list[float]:
        """Direct-sun hours per month; with ``panes`` the union over panes."""
        out = []
        for az, alt in zip(self.az, self.alt):
            if not len(az):
                out.append(0.0)
                continue
            front = np.zeros(len(az), dtype=bool)
            for f in pane_facings(facing, panes):
                front |= np.abs((az - f + 540) % 360 - 180) < 90
            lit = front & (alt > at_many(profile, az))
            out.append(round(int(lit.sum()) * self.step / 60, 2))
        return out

    def hours_by_pane(self, profile: np.ndarray, facing: float, panes: Sequence[float]) -> list[list[float]]:
        """Direct-sun hours per month through each pane on its own."""
        return [self.hours(profile, (facing + float(o)) % 360) for o in panes]


# --------------------------------------------------------------------------- diffuse sky (relative model)
#
# A vertical window under a CIE standard overcast sky (luminance L(alt) = Lz (1 + 2 sin alt) / 3): the light
# from a sky patch on the glass goes as L(alt) * cos(incidence) * dOmega with cos(incidence) = cos(alt) cos(d)
# (d = azimuth off the window normal) and dOmega = cos(alt) dalt dd. Integrated in altitude in closed form:
#   G(h) = integral_h^90 (1 + 2 sin a) / 3 * cos^2 a da = F(90) - F(h),
#   F(a) = (a / 2 + sin(2a) / 4 - (2 / 3) cos^3 a) / 3.
# sky_view = sum over azimuths within FIELD_DEG of a pane normal of cos(d) * G(skyline(az)), divided by the
# same sum for an unobstructed window: 1.0 = nothing above the horizon in the window's field.
# It is a relative measure of diffuse sky light, NOT illuminance (lux).

FIELD_DEG = 80.0
SKY_STEP = 1.0
DAYLIGHT_DEFAULTS = {"transmittance": 0.6, "glazed_area_m2": 3.0, "room_surface_m2": 88.6, "reflectance": 0.5}
DAYLIGHT_FORMULA = ("DF_est % = T x Aw x theta / (A x (1 - R^2)) with theta = 90 deg x sky_view (BRE average "
                    "daylight factor, Littlefair 1988; theta is the visible sky angle); defaults T 0.6, Aw 3.0 m2 "
                    "glazing, A 88.6 m2 room surfaces (4 x 5 m, 2.7 m ceiling), R 0.5")


def _cie_F(a: float) -> float:
    return (a / 2 + math.sin(2 * a) / 4 - (2 / 3) * math.cos(a) ** 3) / 3


_CIE_TOP = _cie_F(math.pi / 2)


def _cie_above(h_deg: float) -> float:
    """CIE-overcast, cosine-weighted sky light on a vertical window from altitudes above h (per radian of azimuth)."""
    h = min(90.0, max(0.0, float(h_deg))) * RAD
    return _CIE_TOP - _cie_F(h)


def sky_view(profile, facing: float, panes: Sequence[float] | None = None, field: float = FIELD_DEG,
             step: float = SKY_STEP) -> float:
    """Visible-sky share for a window (0-1) under a CIE overcast sky, relative to an unobstructed window.

    Azimuths are sampled at the middle of each ``step`` degree bin; one counts when it is within
    ``field`` degrees of a pane normal and is weighted by the cosine of that angle (the nearest pane).
    """
    fs = pane_facings(facing, panes)
    num = den = 0.0
    full = _cie_above(0.0)
    for k in range(int(round(360 / step))):
        az = (k + 0.5) * step
        d = min(abs((az - f + 540) % 360 - 180) for f in fs)
        if d >= field:
            continue
        w = math.cos(d * RAD)
        num += w * _cie_above(at(profile, az))
        den += w * full
    return num / den if den else 0.0


def daylight_factor_est(sv: float, transmittance: float | None = None, glazed_area_m2: float | None = None,
                        room_surface_m2: float | None = None, reflectance: float | None = None) -> float:
    """Indicative average daylight factor (%) from a sky view share: an estimate, never a measurement.

    BRE average daylight factor, T * Aw * theta / (A * (1 - R^2)), with the visible sky angle theta taken
    as 90 degrees x ``sv``. Defaults (``DAYLIGHT_DEFAULTS``) describe a typical 4 x 5 m room.
    """
    d = DAYLIGHT_DEFAULTS
    T = d["transmittance"] if transmittance is None else transmittance
    Aw = d["glazed_area_m2"] if glazed_area_m2 is None else glazed_area_m2
    A = d["room_surface_m2"] if room_surface_m2 is None else room_surface_m2
    R = d["reflectance"] if reflectance is None else reflectance
    return T * Aw * 90.0 * max(0.0, min(1.0, sv)) / (A * (1 - R * R))


# Percent of possible sunshine by month: NOAA, New York Central Park climate normals 1961-1990.
SUNSHINE = {
    "nyc": {"fraction": [0.54, 0.55, 0.57, 0.57, 0.57, 0.57, 0.59, 0.63, 0.59, 0.61, 0.51, 0.48],
            "place": "New York Central Park",
            "source": "NOAA climate normals 1961-1990, percent of possible sunshine"},
}
DAYS_IN_MONTH = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def sunshine(city: str | None) -> dict | None:
    """Monthly clear-sky probability (sunshine fraction) for a city profile, or None when unknown."""
    return SUNSHINE.get(str(city or "").lower()) if city else None


def expected_sun(possible: Sequence[float], fraction: Sequence[float] | None) -> dict:
    """Expected direct sun = possible (clear-sky) hours x the month's sunshine fraction, by month and for
    the year (sum of hours per day x days in each month)."""
    year_possible = sum(h * n for h, n in zip(possible, DAYS_IN_MONTH))
    out = {"possible": round(year_possible), "expected": None, "monthly": None}
    if fraction and len(fraction) == 12:
        monthly = [round(h * f, 2) for h, f in zip(possible, fraction)]
        out["monthly"] = monthly
        out["expected"] = round(sum(h * f * n for h, f, n in zip(possible, fraction, DAYS_IN_MONTH)))
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
              floors: range | None = None, sky: Skyline | None = None, tracks: _Tracks | None = None,
              panes: Sequence[float] | None = None) -> dict:
    """Sun hours by month at one window (union over ``panes``), the floors table, skyline ahead and
    open sky share. With more than one pane, ``sun_hours_panes`` holds each pane on its own."""
    lat, lon = site["origin"]["lat"], site["origin"]["lon"]
    t = window_t(face) if t is None else t
    fh = site.get("floor_height_m", 3.2)
    sky = sky or Skyline(site)
    tracks = tracks or _Tracks(month_tracks(year, lat, lon, tz))
    floors = floors or range(2, max_floor(site) + 1)
    table, light = {}, {}
    for f in floors:
        pf = sky.profile(*window_point(face, t, f, fh))
        table[f] = tracks.hours(pf, face["bearing"], panes)
        sv = sky_view(pf, face["bearing"], panes)
        light[f] = [round(sv, 3), round(daylight_factor_est(sv), 2)]
    prof = sky.profile(*window_point(face, t, floor, fh))
    ahead = at(prof, face["bearing"])
    open_sky = float(np.mean([60 - min(60, at(prof, face["bearing"] + d)) for d in range(-60, 61)]) / 60)
    sv = sky_view(prof, face["bearing"], panes)
    out = {"face_bearing": face["bearing"], "floor": floor, "t": t,
           "sun_hours": table.get(floor) or tracks.hours(prof, face["bearing"], panes),
           "floors_table": table, "skyline_ahead_deg": round(ahead, 1), "open_sky_share": round(open_sky, 3),
           "sky_view": round(sv, 3), "daylight_factor_est": round(daylight_factor_est(sv), 2),
           "daylight_floors": light, "profile": [round(float(v), 1) for v in prof]}
    if panes and len(panes) > 1:
        out["sun_hours_panes"] = tracks.hours_by_pane(prof, face["bearing"], panes)
    return out


def sun_hours_range(site: dict, face: dict, floor: int, tz: str, year: int,
                    positions: Sequence[float] = POSITIONS, floor_delta: int = 2,
                    sky: Skyline | None = None, tracks: _Tracks | None = None,
                    panes: Sequence[float] | None = None) -> dict:
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
    grid = np.array([[tracks.hours(sky.profile(*window_point(face, t, f, fh)), face["bearing"], panes) for t in ts]
                     for f in fl])  # floors x positions x 12
    return {"lo": [round(float(v), 2) for v in grid.min(axis=(0, 1))],
            "hi": [round(float(v), 2) for v in grid.max(axis=(0, 1))],
            "positions": ts, "floors": fl}


def future_sun_hours(site: dict, face: dict, floor: int, t: float, tz: str, year: int,
                     tracks: _Tracks | None = None, panes: Sequence[float] | None = None) -> list[float] | None:
    """Sun hours with filed / under-construction buildings added (None if there are none)."""
    if not site.get("future"):
        return None
    lat, lon = site["origin"]["lat"], site["origin"]["lon"]
    tracks = tracks or _Tracks(month_tracks(year, lat, lon, tz))
    sky = Skyline(site, include_future=True)
    return tracks.hours(sky.profile(*window_point(face, t, floor, site.get("floor_height_m", 3.2))),
                        face["bearing"], panes)


# --------------------------------------------------------------------------- who shades the window

def sample_states(sky: Skyline, point: tuple[float, float, float], facing: float, date: dt.date,
                  lat: float, lon: float, tz: str, panes: Sequence[float] | None = None,
                  step_min: int = STEP_MIN) -> list[dict]:
    """Every ``step_min`` slot of one local day at a window point.

    state: ``night`` (sun below the horizon), ``behind`` (sun behind every pane), ``lit`` or
    ``shaded``; shaded slots carry ``blocker`` (owner index, see ``_site_rings``) and ``dist`` (m).
    """
    z = ZoneInfo(tz)
    prof = sky.profile(*point)
    out = []
    for m in range(0, 1440, step_min):
        when = dt.datetime(date.year, date.month, date.day, m // 60, m % 60, tzinfo=z)
        az, alt = sun_position(when, lat, lon)
        row = {"minute": m, "az": round(az, 2), "alt": round(alt, 2)}
        if alt <= 0:
            row["state"] = "night"
        elif not in_front(az, facing, panes):
            row["state"] = "behind"
        elif alt > at(prof, az):
            row["state"] = "lit"
        else:
            row["state"] = "shaded"
            # the skyline is interpolated between 0.5 degree bins: if the exact ray slips past a
            # corner, the wall that raised the neighbouring bin is the blocker
            b0 = math.floor(az / 0.5) * 0.5
            hit = sky.blocker(*point, az, alt) or sky.blocker(*point, b0, alt) or sky.blocker(*point, b0 + 0.5, alt)
            if hit is not None:
                row["blocker"], row["dist"] = hit[0], round(hit[1], 1)
        out.append(row)
    return out


def main_blockers(sky: Skyline, point: tuple[float, float, float], facing: float, year: int,
                  lat: float, lon: float, tz: str, panes: Sequence[float] | None = None,
                  day: int = 15, top: int = 6) -> list[dict]:
    """Buildings that hide the sun from the window, with minutes shaded on the ``day`` of each month.

    Only slots when the sun is up and in front of a pane count. Sorted by minutes over the year.
    """
    tally: dict[int, list[int]] = {}
    dist: dict[int, float] = {}
    for mo in range(12):
        for r in sample_states(sky, point, facing, dt.date(year, mo + 1, day), lat, lon, tz, panes):
            b = r.get("blocker")
            if b is None:
                continue
            tally.setdefault(b, [0] * 12)[mo] += STEP_MIN
            dist[b] = min(dist.get(b, math.inf), r["dist"])
    rows = sorted(tally.items(), key=lambda kv: -sum(kv[1]))[:top]
    return [{"b": b, "min": mins, "dist": round(dist[b], 1)} for b, mins in rows]
