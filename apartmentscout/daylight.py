"""Relative daylight: sky components per window, a sensor grid in a room and an annual summary.

A RELATIVE MODEL, not photometry. Nothing here is a measured illuminance, nothing has been calibrated against a
light meter, a weather file or a simulation engine (Radiance is not run), and the inputs (glass, frames, blinds,
surface reflectance) are assumptions unless a source is recorded next to them. Use the numbers to compare windows,
floors, rooms and settings, never to promise a lux level.

The browser (dashboard/js/features/daylight-core.js) runs the same method; tests/fixtures/daylight_parity.json pins
both to the same values (tests/test_daylight_parity.py, tests/js/daylight-parity.test.mjs).

Method, in the order it is used:

* **Sky luminance.** CIE standard overcast sky, L(alt) = (1 + 2 sin alt) / 3, or the CIE standard clear sky (ISO 15469
  / CIE S 011 type 12: gradation phi(z) = 1 + a exp(b / cos z), indicatrix f(chi) = 1 + c (exp(d chi) - exp(d pi/2)) +
  e cos^2 chi, a = -1, b = -0.32, c = 10, d = -3, e = 0.45) for a given sun position. Clear sky here means the
  *diffuse* sky only; direct sun is the separate ``sun_study`` number.
* **Vertical sky component (VSC).** The share of the horizontal illuminance of the whole unobstructed sky that
  a vertical window receives from the part of the sky its skyline leaves visible (the BRE / UK "VSC"; an unobstructed
  window under the overcast sky gets 39.6 %). Per window, from the same skyline the direct-sun model uses.
* **Sensor grid.** For a point at working-plane height in a room, the sky component through each window of that room:
  the window rectangle is sampled, each sample sends the sky luminance of its direction (zero below the window's
  skyline) with the cosines to the horizontal plane and the window plane over r^2. The skyline is the window point's,
  shared by every ray through that window (parallax is ignored), and the room is open air between sensor and glass.
* **Inter-reflected light.** Mean inter-reflected component by flux transfer: rho / (A (1 - rho)) x the flux the
  windows admit, with rho the area-weighted reflectance of floor, walls and ceiling. It is one number for the room.
* **Relative daylight** at a sensor = T x sky component + inter-reflected component, with T = glazing visible
  transmittance x glazed fraction of the opening (frame factor) x blinds. Percent of the unobstructed horizontal
  sky illuminance, i.e. a daylight-factor-like number for the chosen sky.
* **Annual summary.** Per month (the 15th): direct sun hours (possible, and expected with NOAA's monthly sunshine
  share when the city has one), sky visibility (the share of an unobstructed window's sky light, the existing
  ``sky_view``) and relative daylight (the window's VSC under the overcast sky and, per month, under the clear
  diffuse sky). They stay three separate quantities, and the two skies are never averaged.

Not modelled: ground and facade reflections, trees, glare, thermal gain, weather beyond the monthly sunshine share,
interior walls between sensor and window, parallax of the skyline across a wide window.
"""
from __future__ import annotations

import datetime as dt
import math
from functools import lru_cache
from typing import Sequence

import numpy as np

from .sun import at, at_many, day_track, pane_facings

RAD = math.pi / 180
FIELD_DEG = 90.0          # the window's field in azimuth either side of a pane normal
CLEAR_STEP = 3.0          # degrees: altitude and azimuth bins for the clear-sky integrals
OVERCAST_STEP = 1.0       # degrees of azimuth for the closed-form overcast integral
SENSOR_HEIGHT_M = 0.76    # working plane
SAMPLES_U, SAMPLES_Z = 8, 6   # samples across and up one window rectangle
E_H_OVERCAST = 7 * math.pi / 9   # horizontal illuminance of the unobstructed overcast sky, L(alt) = (1 + 2 sin alt) / 3

MODEL_LABEL = "relative daylight model (modelled, not measured, not calibrated)"

# ---------------------------------------------------------------------------------------------- input presets
# Typical values, ASSUMED unless a source is recorded. (id, label, value)
GLAZING_PRESETS = (
    ("default", "Model default", 0.60),
    ("single-clear", "Single clear", 0.88),
    ("double-clear", "Double clear", 0.78),
    ("double-low-e", "Double low-E", 0.70),
    ("triple-low-e", "Triple low-E", 0.62),
    ("tinted", "Tinted double", 0.45),
    ("solar-control", "Reflective / solar control", 0.30),
)
FRAME_PRESETS = (  # glazed share of the opening
    ("default", "Model default", 0.80),
    ("curtain-wall", "Curtain wall, slim frame", 0.90),
    ("aluminium", "Aluminium", 0.85),
    ("wood-vinyl", "Wood or vinyl", 0.75),
    ("multi-lite", "Multi-lite / heavy mullions", 0.65),
)
BLINDS = {"open": 1.0, "sheer": 0.55, "half": 0.5, "closed": 0.1}
SURFACE_PRESETS = {
    "floor": (("dark", "Dark wood or carpet", 0.15), ("medium", "Medium wood", 0.25), ("light", "Light wood or tile", 0.45)),
    "walls": (("white", "White", 0.80), ("light", "Light", 0.65), ("typical", "Typical", 0.55), ("mid", "Mid tone", 0.40),
              ("dark", "Dark", 0.15)),
    "ceiling": (("white", "White", 0.85), ("off-white", "Off-white", 0.75), ("mid", "Mid tone", 0.50)),
}
SURFACE_DEFAULT = {"floor": 0.25, "walls": 0.55, "ceiling": 0.75}


def reflectance_mean(floor_m2: float, wall_m2: float, ceiling_m2: float, rho_floor: float, rho_walls: float,
                     rho_ceiling: float) -> float:
    """Area-weighted mean reflectance of the room surfaces."""
    a = floor_m2 + wall_m2 + ceiling_m2
    return (floor_m2 * rho_floor + wall_m2 * rho_walls + ceiling_m2 * rho_ceiling) / a if a > 0 else 0.0


# ---------------------------------------------------------------------------------------------- sky luminance
def cie_overcast(alt_deg: float) -> float:
    """Relative luminance of the CIE standard overcast sky (zenith = 1) at altitude ``alt_deg``."""
    return (1 + 2 * math.sin(alt_deg * RAD)) / 3


def _cie_F(a: float) -> float:
    return (a / 2 + math.sin(2 * a) / 4 - (2 / 3) * math.cos(a) ** 3) / 3


_CIE_TOP = _cie_F(math.pi / 2)


def cie_above(h_deg: float) -> float:
    """Overcast-sky light on a vertical window from altitudes above ``h_deg`` (per radian of azimuth, cosine weighted)."""
    h = min(90.0, max(0.0, float(h_deg))) * RAD
    return _CIE_TOP - _cie_F(h)


_CLEAR = (-1.0, -0.32, 10.0, -3.0, 0.45)  # a, b, c, d, e: CIE standard clear sky (type 12)


def _gradation(zenith: float) -> float:
    c = math.cos(zenith)
    return 1.0 if c < 1e-6 else 1 + _CLEAR[0] * math.exp(_CLEAR[1] / c)


def _indicatrix(chi):
    _, _, c, d, e = _CLEAR
    return 1 + c * (np.exp(d * chi) - math.exp(d * math.pi / 2)) + e * np.cos(chi) ** 2


def cie_clear(alt_deg, az_deg, sun_alt_deg: float, sun_az_deg: float):
    """Relative luminance of the CIE standard clear sky (zenith = 1) at (az, alt) for a sun at (sun_az, sun_alt).
    ``alt_deg`` and ``az_deg`` may be numbers or numpy arrays."""
    alt, az = np.asarray(alt_deg, dtype=float), np.asarray(az_deg, dtype=float)
    cz = np.sin(alt * RAD)                      # cos of the zenith angle
    cos_chi = cz * math.sin(sun_alt_deg * RAD) + np.cos(alt * RAD) * math.cos(sun_alt_deg * RAD) * np.cos((az - sun_az_deg) * RAD)
    chi = np.arccos(np.clip(cos_chi, -1.0, 1.0))
    grad = np.where(cz < 1e-6, 1.0, 1 + _CLEAR[0] * np.exp(_CLEAR[1] / np.maximum(cz, 1e-6)))
    norm = float(_indicatrix(math.radians(90 - sun_alt_deg))) * _gradation(0.0)
    out = _indicatrix(chi) * grad / norm
    return float(out) if out.ndim == 0 else out


def is_clear(sky: dict | None) -> bool:
    return bool(sky) and sky.get("kind") == "clear"


def sky_luminance(alt_deg: float, az_deg: float, sky: dict | None) -> float:
    """Luminance for a sky spec: ``None`` or {"kind": "overcast"}, or {"kind": "clear", "sun_az", "sun_alt"}."""
    if is_clear(sky):
        return cie_clear(alt_deg, az_deg, sky["sun_alt"], sky["sun_az"])
    return cie_overcast(alt_deg)


_ALT_LO = np.arange(int(round(90 / CLEAR_STEP))) * CLEAR_STEP
_ALT_MID = _ALT_LO + CLEAR_STEP / 2
_AZ_MID = (np.arange(int(round(360 / CLEAR_STEP))) + 0.5) * CLEAR_STEP


@lru_cache(maxsize=512)
def _e_h_clear(sun_az: float, sun_alt: float) -> float:
    L = cie_clear(_ALT_MID[None, :], _AZ_MID[:, None], sun_alt, sun_az)
    w = np.sin(_ALT_MID * RAD) * np.cos(_ALT_MID * RAD) * (CLEAR_STEP * RAD) ** 2
    return float((L * w[None, :]).sum())


def horizontal_illuminance(sky: dict | None) -> float:
    """Horizontal illuminance of the unobstructed sky (same luminance units as ``sky_luminance``)."""
    return _e_h_clear(round(float(sky["sun_az"]), 6), round(float(sky["sun_alt"]), 6)) if is_clear(sky) else E_H_OVERCAST


def vertical_sky_component(profile, facing: float, panes: Sequence[float] | None = None, sky: dict | None = None,
                           field: float = FIELD_DEG) -> float:
    """VSC as a fraction (0.396 for an unobstructed window under the overcast sky): vertical illuminance on the window
    from the sky above its skyline, over the horizontal illuminance of the same unobstructed sky. Under the clear sky
    a window facing the sun can exceed 0.396 because that sky's horizontal illuminance is lower. A bay takes the
    union of its panes' fields."""
    fs = pane_facings(facing, panes)
    if not is_clear(sky):
        step = OVERCAST_STEP
        az = (np.arange(int(round(360 / step))) + 0.5) * step
        d = np.min(np.abs((az[:, None] - np.array(fs)[None, :] + 540) % 360 - 180), axis=1)
        ok = d < field
        h = at_many(np.asarray(profile, dtype=float), az[ok])
        F = (np.radians(np.clip(h, 0.0, 90.0)) / 2 + np.sin(2 * np.radians(np.clip(h, 0.0, 90.0))) / 4
             - (2 / 3) * np.cos(np.radians(np.clip(h, 0.0, 90.0))) ** 3) / 3
        return float((np.cos(d[ok] * RAD) * (_CIE_TOP - F)).sum() * step * RAD / E_H_OVERCAST)
    step = CLEAR_STEP
    d = np.min(np.abs((_AZ_MID[:, None] - np.array(fs)[None, :] + 540) % 360 - 180), axis=1)
    ok = d < field
    az, cd = _AZ_MID[ok], np.cos(d[ok] * RAD)
    h = at_many(np.asarray(profile, dtype=float), az)
    cover = np.clip((_ALT_LO[None, :] + step - np.maximum(h[:, None], _ALT_LO[None, :])) / step, 0.0, 1.0)
    L = cie_clear(_ALT_MID[None, :], az[:, None], sky["sun_alt"], sky["sun_az"])
    w = np.cos(_ALT_MID * RAD) ** 2
    num = (L * w[None, :] * cover * cd[:, None]).sum() * (step * RAD) ** 2
    return float(num / horizontal_illuminance(sky))


# ---------------------------------------------------------------------------------------------- sensor points
def point_in_poly(x: float, y: float, poly: Sequence[Sequence[float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def sensor_sky_component(p: Sequence[float], win: dict, profile, up_bearing: float, sky: dict | None = None,
                         nu: int = SAMPLES_U, nz: int = SAMPLES_Z) -> float:
    """Sky component (fraction of the unobstructed horizontal illuminance) at sensor ``p`` = (x, y, z) metres, from
    one window. ``win``: a, b (plan metres), normal (outward unit vector), sill, head (metres above the floor)."""
    ax, ay = win["a"]
    bx, by = win["b"]
    nx, ny = win["normal"]
    px, py, pz = p
    if (px - ax) * nx + (py - ay) * ny >= 0:   # the sensor must be on the room side of the glass
        return 0.0
    da = math.hypot(bx - ax, by - ay) * (win["head"] - win["sill"]) / (nu * nz)
    total = 0.0
    for i in range(nu):
        u = (i + 0.5) / nu
        sx, sy = ax + (bx - ax) * u, ay + (by - ay) * u
        for j in range(nz):
            sz = win["sill"] + (win["head"] - win["sill"]) * (j + 0.5) / nz
            vx, vy, vz = sx - px, sy - py, sz - pz
            r2 = vx * vx + vy * vy + vz * vz
            r = math.sqrt(r2)
            cos_w = (vx * nx + vy * ny) / r
            hor = math.hypot(vx, vy)
            if cos_w <= 0 or vz <= 0 or hor <= 0:
                continue
            alt = math.degrees(math.atan2(vz, hor))
            az = (up_bearing + math.degrees(math.atan2(vx, vy))) % 360
            if alt <= at(profile, az):
                continue
            total += sky_luminance(alt, az, sky) * (vz / r) * cos_w * da / r2
    return total / horizontal_illuminance(sky)


def transmission(vt: float, glazed: float, blinds: str | float) -> float:
    """Light passed by glass, frame (glazed share of the opening) and blinds: a product of three assumed numbers."""
    b = blinds if isinstance(blinds, (int, float)) else BLINDS.get(blinds, 1.0)
    return vt * glazed * b


def bearing_of(normal: Sequence[float], up_bearing: float) -> float:
    """Compass bearing of a plan-frame vector when the plan's up direction has bearing ``up_bearing``."""
    return (up_bearing + math.degrees(math.atan2(normal[0], normal[1]))) % 360


def edge_distance(x: float, y: float, poly: Sequence[Sequence[float]]) -> float:
    best = math.inf
    for i in range(len(poly)):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % len(poly)]
        ex, ey = bx - ax, by - ay
        ll = ex * ex + ey * ey
        t = max(0.0, min(1.0, ((x - ax) * ex + (y - ay) * ey) / ll)) if ll else 0.0
        best = min(best, math.hypot(x - ax - ex * t, y - ay - ey * t))
    return best


def grid_stats(vals: Sequence[float]) -> dict | None:
    """Mean, min, max, median and uniformity (min / mean) of grid values (percent)."""
    if not vals:
        return None
    s = sorted(vals)
    n = len(s)
    mean = sum(s) / n
    mid = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    return {"mean": mean, "min": s[0], "max": s[-1], "median": mid, "uniformity": s[0] / mean if mean else None, "n": n}


def room_grid(poly: Sequence[Sequence[float]], ceiling_m: float, windows: Sequence[dict], up_bearing: float,
              vt: float = 0.6, glazed: float = 0.8, blinds: str | float = "open", surfaces: dict | None = None,
              sky: dict | None = None, step_m: float = 0.3, sensor_z: float = SENSOR_HEIGHT_M,
              inset_m: float = 0.15) -> dict:
    """Relative daylight on a sensor grid in one room (plan metres; ``poly`` is the room outline).

    ``windows`` are the room's own openings: dicts with a, b, normal, sill, head and ``profile`` (the skyline of that
    window, 720 bins of 0.5 degrees). Returns x0, y0, step, nx, ny, values (percent; None outside the room or inside
    the inset from its walls, row by row from y0), stats, the mean sky component, the inter-reflected part, rho and T.
    """
    s = {**SURFACE_DEFAULT, **(surfaces or {})}
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    x0, y0 = min(xs), min(ys)
    nx, ny = int(math.ceil((max(xs) - x0) / step_m)), int(math.ceil((max(ys) - y0) / step_m))
    t = transmission(vt, glazed, blinds)
    floor_m2 = abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                       for i in range(len(poly)))) / 2
    wall_m2 = sum(math.dist(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))) * ceiling_m
    rho = reflectance_mean(floor_m2, wall_m2, floor_m2, s["floor"], s["walls"], s["ceiling"])
    total_area = 2 * floor_m2 + wall_m2
    flux = 0.0   # sum over windows of opening area x VSC (T is applied once below)
    for w in windows:
        vsc = vertical_sky_component(w["profile"], bearing_of(w["normal"], up_bearing), None, sky)
        flux += math.hypot(w["b"][0] - w["a"][0], w["b"][1] - w["a"][1]) * (w["head"] - w["sill"]) * vsc
    reflected = t * flux * rho / (total_area * (1 - rho)) if total_area > 0 and rho < 1 else 0.0
    values: list[float | None] = []
    inside_vals: list[float] = []
    sc_vals: list[float] = []
    for j in range(ny):
        for i in range(nx):
            x, y = x0 + (i + 0.5) * step_m, y0 + (j + 0.5) * step_m
            if not point_in_poly(x, y, poly) or edge_distance(x, y, poly) < inset_m:
                values.append(None)
                continue
            sc = sum(sensor_sky_component((x, y, sensor_z), w, w["profile"], up_bearing, sky) for w in windows)
            sc_vals.append(sc * t * 100)
            values.append((sc * t + reflected) * 100)
            inside_vals.append(values[-1])
    return {"x0": x0, "y0": y0, "step": step_m, "nx": nx, "ny": ny, "values": values, "t": t, "rho": rho,
            "reflected": reflected * 100, "sky_component_mean": sum(sc_vals) / len(sc_vals) if sc_vals else None,
            "stats": grid_stats(inside_vals)}


# ---------------------------------------------------------------------------------------------- annual summary
def monthly_clear_component(profile, facing: float, panes: Sequence[float] | None, year: int, lat: float, lon: float,
                            tz: str, day: int = 15, step_min: int = 60) -> list[float]:
    """Clear-sky VSC (fraction) per month: the mean over the day's hourly sun positions, weighted by sin(altitude)."""
    out = []
    for mo in range(1, 13):
        num = den = 0.0
        for _m, saz, salt in day_track(dt.date(year, mo, day), lat, lon, tz, step_min):
            w = math.sin(salt * RAD)
            num += w * vertical_sky_component(profile, facing, panes, {"kind": "clear", "sun_az": saz, "sun_alt": salt})
            den += w
        out.append(num / den if den else 0.0)
    return out


def annual_daylight(profile, facing: float, panes: Sequence[float] | None, year: int, lat: float, lon: float, tz: str,
                    possible: Sequence[float], sky_view_share: float, fraction: Sequence[float] | None = None) -> dict:
    """Per-month direct sun, sky visibility and relative daylight for one window: three separate quantities.

    ``possible`` is direct sun hours per day by month (clear sky), ``sky_view_share`` the window's existing
    ``sky_view`` (0-1), ``fraction`` NOAA's monthly sunshine share (or None; it scales direct sun only). Relative
    daylight is the window's VSC, in percent of the horizontal illuminance of the same unobstructed sky: under the
    overcast sky (one number) and the clear diffuse sky (per month, which depends on where the sun stands). The two
    skies have different absolute brightness, so they are shown side by side and never averaged.
    """
    oc = vertical_sky_component(profile, facing, panes, None)
    cl = monthly_clear_component(profile, facing, panes, year, lat, lon, tz)
    have = bool(fraction) and len(fraction) == 12
    expected = [h * f for h, f in zip(possible, fraction)] if have else None
    return {
        "model": MODEL_LABEL,
        "direct_sun": {"possible_h_per_day": [round(float(h), 2) for h in possible],
                       "expected_h_per_day": [round(h, 2) for h in expected] if expected else None, "kind": "modelled"},
        "sky_visibility": {"share": round(float(sky_view_share), 3), "kind": "modelled"},
        "relative_daylight": {"overcast_pct": round(oc * 100, 2), "clear_pct": [round(c * 100, 2) for c in cl],
                              "kind": "modelled", "unit": "percent of the same sky's open horizontal illuminance"},
    }
