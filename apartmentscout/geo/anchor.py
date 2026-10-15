"""The shared model anchor: one record that ties the floor plan, the window and the city together.

Unit 3D (Inside camera) and the Floor plan studio must put the same plan, at the same place, on the same
facade, at the same height. This module is the Python half of that contract (the dashboard half is
``dashboard/js/unit/anchor.js``; ``tests/fixtures/model_anchor.json`` pins both to the same numbers). It holds

* ``vertical_calibration``: a measured slab (or window-eye) height kept apart from the floor-count estimate;
* ``solid_at`` / ``open_air_at`` / ``window_open_air``: a height-aware test that a point (the air just outside
  a window) is not inside the host building or a neighbour, components included;
* ``window_anchor``: origin, rotation, slab datum, host facade, window position and what is assumed;
* ``validate_components``, ``podium_tower`` and ``assume_components``: strict checking of optional component
  buildings and a labelled "assumed" override that every obstruction calculation and the 3D drawing consume.

Frames: site metres (x east, y north, origin = the geocoded address point), z up from the target's ground.
Nothing here downloads anything or changes a site file on disk.
"""
from __future__ import annotations

import copy
import math
from typing import Sequence

from ..sun import components_of
from .shapes import point_in_ring, ring_area

EYE_M = 1.6
OUT_M = 0.4                       # the observation point sits this far outside the glass
KINDS = ("podium", "tower", "setback", "bulkhead", "spire")
CONFIDENCE = ("high", "medium", "low", "assumed")
MAX_PARTS = 200
MAX_COORD_M = 5000.0
MAX_HEIGHT_M = 900.0
ASSUMED_SOURCE = "assumed: "


def _flat_ring(flat: Sequence[float]) -> list[tuple[float, float]]:
    return list(zip(flat[0::2], flat[1::2]))


# --------------------------------------------------------------------------- vertical calibration

def estimated_floor_height(site: dict, floor: int | None = None) -> tuple[float, str]:
    """The floor-count estimate of the storey height (roof / PLUTO floors, else 3.2 m), ignoring any measurement."""
    from .site import calibrate_floor_height
    return calibrate_floor_height(site, floor, None, None)


def vertical_calibration(site: dict, floor: int, slab_m: float | None = None, eye_m: float | None = None,
                         spread: str = "scale", src: str | None = None) -> dict:
    """What height the window is at, and how it is known.

    ``estimated_slab_m`` is always the floor-count estimate (``base + (floor - 1) * estimated storey``).
    A measured ``slab_m`` (or ``eye_m``, the window-eye height: slab + 1.6 m) replaces it as the datum
    but never overwrites it, so the two stay side by side. ``spread`` says how a measurement at one floor
    reaches the others: ``scale`` (every storey is taller or shorter, floor 1 stays at the street) or
    ``offset`` (a constant shift, e.g. a tall lobby). ``state`` is ``measured`` or ``estimated``.
    """
    ti = site.get("target")
    base = max(float(site["b"][ti][1]), 0.0) if ti is not None else 0.0
    est_fh, est_src = estimated_floor_height(site, floor)
    estimated = base + (floor - 1) * est_fh
    measured = None
    if slab_m is not None or eye_m is not None:
        kind, val = ("slab", float(slab_m)) if slab_m is not None else ("eye", float(eye_m))
        slab = val if kind == "slab" else val - EYE_M
        if not (math.isfinite(slab) and 0 <= slab <= 700):
            raise ValueError("a measured height must be between 0 and 700 m above the street")
        measured = {"kind": kind, "value_m": round(val, 2), "floor": int(floor),
                    "spread": spread if spread in ("scale", "offset") else "scale"}
        if src:
            measured["src"] = str(src)[:200]
    else:
        slab = estimated
    fh = est_fh
    if measured and measured["spread"] == "scale" and floor > 1:
        fh = (slab - base) / (floor - 1)
    return {"state": "measured" if measured else "estimated", "floor": int(floor), "ground_m": round(base, 2),
            "slab_m": round(slab, 2), "eye_m": round(slab + EYE_M, 2), "estimated_slab_m": round(estimated, 2),
            "delta_m": round(slab - estimated, 2), "floor_height_m": round(fh, 3),
            "estimated_floor_height_m": round(est_fh, 3), "estimated_floor_height_src": est_src,
            "measured": measured}


def slab_at(cal: dict, floor: int) -> float:
    """Slab height of any floor under a calibration record from ``vertical_calibration``."""
    base, est = cal["ground_m"], cal["estimated_floor_height_m"]
    m = cal.get("measured")
    if not m:
        return base + (floor - 1) * est
    anchor = cal["slab_m"]
    if m["spread"] == "offset":
        return base + (floor - 1) * est + (anchor - (base + (m["floor"] - 1) * est))
    fh = cal["floor_height_m"]
    return base + (floor - 1) * fh


# --------------------------------------------------------------------------- open air

def _solids(site: dict, i: int):
    """(ring, holes, z_lo, z_hi) for each solid of building i, heights in the site's z (target ground = 0)."""
    top, g, _t, flat = site["b"][i]
    comps = components_of(site).get(i)
    if comps:
        for c in comps:
            yield ([(float(p[0]), float(p[1])) for p in c["ring"]],
                   [[(float(p[0]), float(p[1])) for p in h] for h in c.get("holes") or []],
                   float(g) + float(c.get("base_m") or 0), float(g) + float(c["top_m"]))
        return
    holes = [[tuple(p) for p in h] for h in (site.get("holes") or {}).get(str(i), [])]
    yield _flat_ring(flat), holes, float(g) - 1.5, float(top)


def solid_at(site: dict, x: float, y: float, z: float, skip: int | None = None) -> int | None:
    """Index of the building whose solid contains the point (x, y, z), else None.

    Height-aware: a podium roof below ``z`` is open air above it, a light court is open air, and a
    building with components is the union of its parts, each between its own base and top.
    """
    for i in range(len(site["b"])):
        if i == skip:
            continue
        for ring, holes, lo, hi in _solids(site, i):
            if lo <= z <= hi and point_in_ring(x, y, ring) and not any(point_in_ring(x, y, h) for h in holes):
                return i
    return None


def open_air_at(site: dict, x: float, y: float, z: float) -> dict:
    """``{"open": bool, "host": bool, "other": int | None}`` for a point outside a window."""
    hit = solid_at(site, x, y, z)
    return {"open": hit is None, "host": hit is not None and hit == site.get("target"),
            "other": hit if hit is not None and hit != site.get("target") else None}


def window_open_air(site: dict, face: dict, t: float, z_lo: float, z_hi: float, out: Sequence[float] = (OUT_M, 1.0),
                    bearing: float | None = None) -> dict:
    """Is the air just outside a window (``out`` metres from the glass, at ``z_lo``, the middle and ``z_hi``) open?

    ``{"ok": bool, "reason": None | "host" | "neighbour", "building": index or None}``. A window whose outside
    lies inside its own host (a facade chosen through a setback, a plan pushed through the wall) or inside a
    neighbour (a party wall) is not a window: sun and view conclusions for it must be withheld.
    """
    (x1, y1), (x2, y2) = face["a"], face["b"]
    x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
    b = math.radians(face["bearing"] if bearing is None else bearing)
    nx, ny = math.sin(b), math.cos(b)
    for z in (z_lo, (z_lo + z_hi) / 2, z_hi):
        for d in out:
            r = open_air_at(site, x + nx * d, y + ny * d, z)
            if not r["open"]:
                return {"ok": False, "reason": "host" if r["host"] else "neighbour",
                        "building": site.get("target") if r["host"] else r["other"]}
    return {"ok": True, "reason": None, "building": None}


# --------------------------------------------------------------------------- the anchor record

def window_anchor(site: dict, face: dict, t: float, floor: int, az: float | None = None, panes: list | None = None,
                  cal: dict | None = None, plan_up_bearing: float | None = None) -> dict:
    """The shared anchor for the site's window: origin, rotation, slab datum, host facade, open-air check.

    ``cal`` is a ``vertical_calibration`` record (default: the estimate for ``floor``). The plan part
    (window correspondence) is added by the dashboard, which owns plan geometry.
    """
    ti = site["target"]
    top, g, _t, _flat = site["b"][ti]
    meta = (site.get("bmeta") or [None] * (ti + 1))[ti] or {}
    comps = components_of(site).get(ti)
    cal = cal or vertical_calibration(site, floor)
    (x1, y1), (x2, y2) = face["a"], face["b"]
    fx, fy = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
    az = face["bearing"] if az is None else az
    slab = cal["slab_m"]
    air = window_open_air(site, face, t, slab + 0.6, slab + 2.2, bearing=az)
    prov = site.get("provenance") or {}
    sources = {"exposure": prov.get("exposure") or "assumed", "position": prov.get("window_position") or "assumed",
               "floor": prov.get("floor") or "assumed", "datum": cal["state"],
               "plan_north": "stated" if plan_up_bearing is not None else "unknown"}
    assumed = [k for k, v in sources.items() if v in ("assumed", "inferred", "estimated", "unknown", "manual")]
    return {
        "schema": 1, "kind": "apartmentscout-model-anchor",
        "frame": "site metres: x east, y north, origin at the geocoded address point; z up from the target's ground",
        "origin": {"lat": site["origin"]["lat"], "lon": site["origin"]["lon"]},
        "host": {"index": ti, "name": meta.get("name") or meta.get("address") or None,
                 "model": "components" if comps else "prism", "parts": len(comps) if comps else 1,
                 "height_m": round(float(top) - float(g), 1), "ground_m": round(float(g), 2)},
        "facade": {"index": face["i"], "bearing_deg": face["bearing"], "length_m": face["length"],
                   "shared": bool(face.get("shared")), "clear": list(face["open"]) if face.get("open") else None,
                   "a": [round(x1, 2), round(y1, 2)], "b": [round(x2, 2), round(y2, 2)]},
        "window": {"t": round(t, 3), "point_m": [round(fx, 2), round(fy, 2)], "faces_deg": round(az, 1),
                   "panes": list(panes) if panes else None, "floor": int(floor)},
        "north": {"facade_normal_deg": face["bearing"], "rotation_deg": round(az, 1),
                  "plan_up_bearing_deg": plan_up_bearing,
                  "mismatch_deg": None if plan_up_bearing is None
                  else round(abs((az - plan_up_bearing + 540) % 360 - 180), 1)},
        "datum": {k: cal[k] for k in ("state", "ground_m", "slab_m", "eye_m", "estimated_slab_m", "delta_m",
                                       "floor_height_m", "estimated_floor_height_m", "estimated_floor_height_src",
                                       "measured")},
        "air": {"ok": air["ok"], "reason": air["reason"], "building": air["building"], "out_m": [OUT_M, 1.0]},
        "sources": sources, "assumed": assumed,
    }


# --------------------------------------------------------------------------- component buildings

def validate_components(raw, n_buildings: int | None = None) -> tuple[dict, list[str]]:
    """Check a components map ``{"<index>": [component, ...]}`` (or a bare list, meaning the target).

    Returns (clean map, problems). A component needs a ring of 3+ finite points within 5 km, 0 <= base_m <
    top_m <= 900, a known kind, a confidence from CONFIDENCE and a non-empty ``source``. Anything wrong is
    dropped and named; nothing is repaired silently.
    """
    problems: list[str] = []
    if isinstance(raw, list):
        raw = {"target": raw}
    if not isinstance(raw, dict):
        return {}, ["components must be a list or a map of building index to a list"]
    out: dict[str, list[dict]] = {}
    for key, lst in raw.items():
        if key != "target":
            try:
                i = int(key)
            except (TypeError, ValueError):
                problems.append(f"building {key!r}: not an index")
                continue
            if i < 0 or (n_buildings is not None and i >= n_buildings):
                problems.append(f"building {key}: no such building")
                continue
        if not isinstance(lst, list) or not lst:
            problems.append(f"building {key}: needs a non-empty list")
            continue
        if len(lst) > MAX_PARTS:
            problems.append(f"building {key}: more than {MAX_PARTS} parts")
            continue
        clean = []
        for j, c in enumerate(lst):
            where = f"building {key} part {j + 1}"
            if not isinstance(c, dict):
                problems.append(f"{where}: not an object")
                continue
            ring = c.get("ring")
            try:
                pts = [(float(p[0]), float(p[1])) for p in ring]
            except (TypeError, ValueError, IndexError):
                problems.append(f"{where}: ring must be [[x, y], ...]")
                continue
            if len(pts) < 3 or not all(math.isfinite(v) and abs(v) <= MAX_COORD_M for p in pts for v in p):
                problems.append(f"{where}: ring needs 3+ finite points within {MAX_COORD_M:.0f} m")
                continue
            try:
                base, top = float(c.get("base_m", 0)), float(c["top_m"])
            except (KeyError, TypeError, ValueError):
                problems.append(f"{where}: base_m and top_m must be numbers")
                continue
            if not (math.isfinite(base) and math.isfinite(top) and 0 <= base < top <= MAX_HEIGHT_M):
                problems.append(f"{where}: needs 0 <= base_m < top_m <= {MAX_HEIGHT_M:.0f}")
                continue
            src = str(c.get("source") or "").strip()
            if not src:
                problems.append(f"{where}: source is required")
                continue
            kind = str(c.get("kind") or "").lower()
            conf = str(c.get("confidence") or "assumed").lower()
            item = {"ring": [[round(x, 2), round(y, 2)] for x, y in pts], "base_m": round(base, 2),
                    "top_m": round(top, 2), "kind": kind if kind in KINDS else ("setback" if base > 0 else "podium"),
                    "source": src[:200], "confidence": conf if conf in CONFIDENCE else "assumed"}
            if c.get("ref"):
                item["ref"] = str(c["ref"])[:400]
            clean.append(item)
        if clean:
            out[key] = clean
    return out, problems


def _clip(ring: list[tuple[float, float]], ax: float, ay: float, limit: float) -> list[tuple[float, float]]:
    """Keep the part of ``ring`` with ax*x + ay*y <= limit (one Sutherland-Hodgman pass)."""
    out = []
    n = len(ring)
    for i in range(n):
        p, q = ring[i], ring[(i + 1) % n]
        dp, dq = ax * p[0] + ay * p[1] - limit, ax * q[0] + ay * q[1] - limit
        if dp <= 0:
            out.append(p)
        if (dp < 0 < dq) or (dq < 0 < dp):
            s = dp / (dp - dq)
            out.append((p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s))
    return out


def podium_tower(site: dict, index: int, podium_m: float, setback_m: float, out_deg: float,
                 side_m: float = 0.0) -> list[dict]:
    """A podium under a tower, assumed for building ``index``.

    The podium is the whole footprint up to ``podium_m``. The tower is the footprint held back ``setback_m``
    from the facade that faces ``out_deg`` (and ``side_m`` from its two sides), from the podium roof to the
    building's own roof. Raises ValueError when the numbers leave no podium or no tower.
    """
    top, g, _t, flat = site["b"][index]
    ring = _flat_ring(flat)
    roof = float(top) - float(g)
    if not (0 < podium_m < roof):
        raise ValueError(f"podium height must be between 0 and the {roof:.0f} m roof")
    if setback_m < 0 or side_m < 0:
        raise ValueError("setbacks cannot be negative")
    u = (math.sin(math.radians(out_deg)), math.cos(math.radians(out_deg)))
    r = (u[1], -u[0])
    tower = _clip(ring, u[0], u[1], max(u[0] * x + u[1] * y for x, y in ring) - setback_m)
    if side_m > 0 and len(tower) >= 3:
        tower = _clip(tower, r[0], r[1], max(r[0] * x + r[1] * y for x, y in tower) - side_m)
        tower = _clip(tower, -r[0], -r[1], max(-r[0] * x - r[1] * y for x, y in tower) - side_m)
    if len(tower) < 3 or abs(ring_area(tower)) < 20:
        raise ValueError("that setback leaves no tower on the lot")
    sides = f" and {side_m:g} m at the sides" if side_m else ""
    label = f"podium {podium_m:g} m, tower set back {setback_m:g} m{sides} from the {out_deg:.0f}° facade"
    base = {"source": ASSUMED_SOURCE + label, "confidence": "assumed"}
    return [{"ring": [list(p) for p in ring], "base_m": 0.0, "top_m": float(podium_m), "kind": "podium", **base},
            {"ring": [[round(x, 2), round(y, 2)] for x, y in tower], "base_m": float(podium_m), "top_m": round(roof, 2),
             "kind": "tower", **base}]


def assume_components(site: dict, override: dict) -> tuple[dict, list[str]]:
    """A copy of ``site`` whose component map has ``override`` laid over it ("target" means the target).

    Every obstruction calculation (``Skyline``, ``sun_study``, the floors table, the range, sky view) reads
    ``site["components"]``, so the copy answers "what if the building were built like this". The override's
    entries are labelled assumed; ``components_info.assumed`` counts them. The input site is not modified.
    """
    clean, problems = validate_components(override, len(site["b"]))
    out = copy.deepcopy(site)
    comps = dict(out.get("components") or {})
    for k, lst in clean.items():
        comps[str(site["target"] if k == "target" else int(k))] = lst
    if comps:
        out["components"] = comps
    info = dict(out.get("components_info") or {})
    info["assumed"] = len(clean)
    out["components_info"] = info
    return out, problems


__all__ = ["vertical_calibration", "slab_at", "solid_at", "open_air_at", "window_open_air", "window_anchor",
           "validate_components", "podium_tower", "assume_components"]
