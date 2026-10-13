"""Solar position, obstruction skylines and direct-sun hours for a window.

The math matches the dashboard's 3D view (dashboard/js/sun.js), so numbers in
reports and on screen agree.
"""
from __future__ import annotations

import datetime as dt
import math
from zoneinfo import ZoneInfo

import numpy as np

RAD = math.pi / 180
NB = 720  # skyline bins (0.5 degree)


def sun_position(when: dt.datetime, lat: float, lon: float) -> tuple[float, float]:
    """(azimuth clockwise from north, altitude) in degrees for an aware datetime."""
    ms = when.timestamp() * 1000
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


def day_track(date: dt.date, lat: float, lon: float, tz: str, step_min: int = 6) -> list[tuple[int, float, float]]:
    z = ZoneInfo(tz)
    out = []
    for m in range(0, 1440, step_min):
        t = dt.datetime(date.year, date.month, date.day, m // 60, m % 60, tzinfo=z)
        az, alt = sun_position(t, lat, lon)
        if alt > 0:
            out.append((m, az, alt))
    return out


class Skyline:
    """Obstruction angle (degrees above horizon) in 0.5 degree azimuth bins."""

    def __init__(self, site: dict):
        self.B = []
        for top, ground, is_t, flat in site["b"]:
            p = np.array(flat, dtype=float).reshape(-1, 2)
            self.B.append((top, p, np.roll(p, -1, axis=0) - p))
        az = np.arange(NB) * 0.5 * RAD
        self.ux, self.uy = np.sin(az), np.cos(az)

    def profile(self, px: float, py: float, pz: float) -> np.ndarray:
        best = np.zeros(NB)
        ux, uy = self.ux[:, None], self.uy[:, None]
        for top, p, e in self.B:
            sl = top - pz
            if sl <= 0:
                continue
            wx, wy = p[:, 0] - px, p[:, 1] - py
            den = ux * e[:, 1] - uy * e[:, 0]
            with np.errstate(divide="ignore", invalid="ignore"):
                t = (wx * e[:, 1] - wy * e[:, 0]) / den
                s = (wx * uy - wy * ux) / den
            ok = (t > 0.01) & (s >= 0) & (s <= 1) & np.isfinite(t)
            tm = np.where(ok, t, np.inf).min(axis=1)
            q = np.where(np.isfinite(tm), sl / tm, 0)
            best = np.maximum(best, q)
        return np.degrees(np.arctan(best))


def at(profile: np.ndarray, az: float) -> float:
    f = (az % 360) / 0.5
    i = int(f) % NB
    j = (i + 1) % NB
    w = f - int(f)
    return float(profile[i] * (1 - w) + profile[j] * w)


def lit_minutes(track, profile, facing: float, step_min: int = 6) -> tuple[int, list[tuple[int, int]]]:
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


def target_faces(site: dict, min_len: float = 8.0) -> list[dict]:
    """Facades of the target building: midpoint, outward bearing and length."""
    if site.get("target") is None:
        return []
    flat = site["b"][site["target"]][3]
    p = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
    area = sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2
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
        faces.append({"i": i, "mid": ((x1 + x2) / 2, (y1 + y2) / 2), "a": (x1, y1), "b": (x2, y2),
                      "bearing": round(brg, 1), "length": round(ln, 1)})
    return faces


def window_point(face: dict, t: float, floor: float, floor_h: float = 3.2, out_m: float = 0.4):
    (x1, y1), (x2, y2) = face["a"], face["b"]
    x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
    b = face["bearing"] * RAD
    return x + math.sin(b) * out_m, y + math.cos(b) * out_m, (floor - 1) * floor_h + 1.6


def sun_study(site: dict, face: dict, floor: int, tz: str, year: int, t: float = 0.5,
              floors: range | None = None) -> dict:
    lat, lon = site["origin"]["lat"], site["origin"]["lon"]
    sky = Skyline(site)
    tracks = [day_track(dt.date(year, m, 15), lat, lon, tz) for m in range(1, 13)]
    floors = floors or range(2, max(3, int(_target_height(site) / site.get("floor_height_m", 3.2))) + 1)
    table = {}
    for f in floors:
        prof = sky.profile(*window_point(face, t, f, site.get("floor_height_m", 3.2)))
        table[f] = [round(lit_minutes(tr, prof, face["bearing"])[0] / 60, 2) for tr in tracks]
    prof = sky.profile(*window_point(face, t, floor, site.get("floor_height_m", 3.2)))
    ahead = at(prof, face["bearing"])
    open_sky = float(np.mean([60 - min(60, at(prof, face["bearing"] + d)) for d in range(-60, 61)]) / 60)
    return {"face_bearing": face["bearing"], "floor": floor, "sun_hours": table.get(floor) or
            [round(lit_minutes(tr, prof, face["bearing"])[0] / 60, 2) for tr in tracks],
            "floors_table": table, "skyline_ahead_deg": round(ahead, 1), "open_sky_share": round(open_sky, 3),
            "profile": [round(float(v), 1) for v in prof]}


def _target_height(site: dict) -> float:
    if site.get("target") is None:
        return 30
    return site["b"][site["target"]][0] - site["b"][site["target"]][1]


EXPOSURE_DEG = {"N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
                "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5}


def pick_face(faces: list[dict], exposure: list[str] | None) -> dict | None:
    if not faces:
        return None
    if exposure:
        want = EXPOSURE_DEG.get(str(exposure[0]).upper())
        if want is not None:
            best = min(faces, key=lambda f: (round(abs((f["bearing"] - want + 540) % 360 - 180)), -f["length"]))
            if abs((best["bearing"] - want + 540) % 360 - 180) <= 30:
                return best
    return None
