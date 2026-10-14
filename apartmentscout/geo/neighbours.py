"""What surrounds a window: every building within 300 m (the neighbours table) and, per compass
sector, how the nearby roofs compare with the eye height of each floor (the roofs chart data).

Distances are from the window point (0.4 m outside the chosen facade at the listing's floor), or
from the site origin when no facade is chosen, to the nearest point of each footprint. Bearings
point at that nearest point, so a long building across the street reads as "ahead", not as the
bearing of its far-away centroid. Heights are roof tops relative to the target's ground (``top``)
and the building's own height above its ground (``h``), both in metres.
"""
from __future__ import annotations

import math
from typing import Iterable

from . import compass
from .shapes import point_in_poly

EYE_M = 1.6
SECTORS = tuple(range(0, 360, 45))


def _ring(flat: list[float]) -> list[tuple[float, float]]:
    return list(zip(flat[0::2], flat[1::2]))


def nearest_point(x: float, y: float, ring: list[tuple[float, float]]) -> tuple[float, float, float]:
    """(distance, nx, ny): the closest point of the ring's boundary (distance 0 when inside)."""
    best = (math.inf, x, y)
    n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy + 1e-12)))
        px, py = x1 + t * dx, y1 + t * dy
        d = math.hypot(x - px, y - py)
        if d < best[0]:
            best = (d, px, py)
    return best


def _bearing(dx: float, dy: float) -> float:
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def _ang(a: float, b: float) -> float:
    return abs((a - b + 540) % 360 - 180)


def reference_point(site: dict, face: dict | None = None) -> tuple[float, float, float, str]:
    """(x, y, z, label): the window point when a facade is chosen, else the origin at street level."""
    if face is not None and site.get("window"):
        from ..sun import window_point
        w = site["window"]
        x, y, z = window_point(face, w["t"], w["floor"], site.get("floor_height_m", 3.2))
        return x, y, z, "window"
    return 0.0, 0.0, EYE_M, "origin"


def _items(site: dict, include_future: bool = True) -> Iterable[tuple[int, list, float, float]]:
    """(owner, ring, top, own height) for every building except the target, then future ones."""
    for i, (top, g, _t, flat) in enumerate(site["b"]):
        if i != site.get("target"):
            yield i, _ring(flat), float(top), float(top) - float(g)
    if include_future:
        for k, f in enumerate(site.get("future") or []):
            if f.get("ring") and f.get("h"):
                yield -(k + 1), [tuple(p) for p in f["ring"]], float(f["h"]), float(f["h"])


def neighbours(site: dict, face: dict | None = None, radius_m: float = 300) -> dict:
    """Every building whose footprint comes within ``radius_m`` of the window, nearest first.

    Compact form for the site JSON: ``rows`` of [b, dist, bearing, h, top] where ``b`` indexes
    ``site.b`` / ``site.bmeta`` (negative = ``site.future[-b - 1]``); names, floors and sources
    stay in ``bmeta`` so nothing is duplicated.
    """
    x, y, _z, ref = reference_point(site, face)
    rows = []
    for owner, ring, top, h in _items(site):
        d, nx, ny = nearest_point(x, y, ring)
        if d > radius_m:
            continue
        brg = _bearing(nx - x, ny - y) if d > 0.05 else _bearing(*_centroid_offset(ring, x, y))
        rows.append([owner, round(d, 1), round(brg, 1), round(h, 1), round(top, 1)])
    rows.sort(key=lambda r: (r[1], r[0]))
    return {"radius_m": radius_m, "from": ref, "cols": ["b", "dist", "bearing", "h", "top"], "rows": rows}


def _centroid_offset(ring, x, y):
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    return cx - x, cy - y


def clears_floor(top: float, floor_h: float, max_floor: int | None = None) -> int | None:
    """The lowest floor whose eye height (slab + 1.6 m) is above ``top``; None if no floor of the
    building gets there."""
    f = max(1, math.floor((top - EYE_M) / floor_h) + 2)
    return None if max_floor is not None and f > max_floor else f


def roofs(site: dict, face: dict | None = None, radius_m: float = 150, per_sector: int = 6,
          facing_n: int = 8, facing_half: float = 45) -> dict:
    """Neighbouring roof heights against eye height, for the "floor vs neighbouring roofs" chart.

    * ``sectors``: eight 45 degree sectors (centred on N, NE, ...) with the nearest ``per_sector``
      buildings within ``radius_m`` as [b, dist, top], the tallest top and the floor that clears it;
    * ``facing``: the window's own sector (bearing +/- ``facing_half``) with up to ``facing_n``
      nearest buildings as [b, dist, top, clears_floor] and the floor from which the view clears
      every one of them (``clears_floor``; null when even the top floor does not).
    """
    from ..sun import max_floor as _max_floor
    fh = site.get("floor_height_m", 3.2)
    top_floor = _max_floor(site) if site.get("target") is not None else None
    x, y, _z, ref = reference_point(site, face)
    near = []
    for owner, ring, top, _h in _items(site):
        d, nx, ny = nearest_point(x, y, ring)
        if d <= radius_m and top > 0:
            near.append((d, owner, _bearing(nx - x, ny - y), top))
    near.sort()
    sectors = []
    for c in SECTORS:
        rows = [[o, round(d, 1), round(t, 1)] for d, o, b, t in near if _ang(b, c) <= 22.5][:per_sector]
        mt = max((r[2] for r in rows), default=None)
        sectors.append({"bearing": c, "label": compass(c), "rows": rows, "max_top": mt,
                        "clears_floor": clears_floor(mt, fh, top_floor) if mt is not None else 1})
    out = {"radius_m": radius_m, "from": ref, "floor_height_m": fh, "eye_offset_m": EYE_M,
           "top_floor": top_floor, "sectors": sectors}
    w = site.get("window")
    if w:
        out["floor"] = w["floor"]
        out["eye_m"] = round((w["floor"] - 1) * fh + EYE_M, 1)
        rows = [[o, round(d, 1), round(t, 1), clears_floor(t, fh, top_floor)]
                for d, o, b, t in near if _ang(b, w["bearing"]) <= facing_half][:facing_n]
        cl = [r[3] for r in rows]
        out["facing"] = {"bearing": w["bearing"], "half": facing_half, "rows": rows,
                         "clears_floor": (None if any(c is None for c in cl) else max(cl, default=1))}
    return out


def neighbour_records(site: dict, face: dict | None = None, radius_m: float = 300) -> list[dict]:
    """Full rows for the neighbours CSV (one per building within the radius, nearest first)."""
    nb = neighbours(site, face, radius_m)
    meta = site.get("bmeta") or []
    fut = site.get("future") or []
    w = site.get("window")
    out = []
    for b, d, brg, h, top in nb["rows"]:
        if b >= 0:
            m = meta[b] if b < len(meta) and meta[b] else {}
            kind = "standing"
        else:
            f = fut[-b - 1]
            m = {"name": f.get("name"), "bin": f.get("bin"), "bbl": f.get("bbl"), "floors": f.get("stories"),
                 "height_src": f.get("h_src"), "src": f.get("source"), "status": f.get("status")}
            kind = "future:" + str(f.get("status"))
        out.append({
            "b": b, "kind": kind, "name": m.get("name") or "", "address": m.get("address") or "",
            "bin": m.get("bin") or "", "bbl": m.get("bbl") or "", "dist_m": d, "bearing": brg,
            "compass": compass(brg), "in_front": "" if not w else ("yes" if _ang(brg, w["bearing"]) < 90 else "no"),
            "height_m": h, "height_ft": round(h / 0.3048), "top_rel_m": top, "floors": m.get("floors") or "",
            "height_src": m.get("height_src") or "", "geom_src": m.get("geom_src") or "", "edited": m.get("edited") or "",
            "year": m.get("year") or "", "source": m.get("src") or "",
        })
    return out


def inside_other(site: dict, x: float, y: float) -> int | None:
    """Index of a non-target footprint containing the point (holes are open air), else None."""
    holes = site.get("holes") or {}
    for i, (_top, _g, _t, flat) in enumerate(site["b"]):
        if i == site.get("target"):
            continue
        if point_in_poly(x, y, _ring(flat), [[tuple(p) for p in h] for h in holes.get(str(i), [])]):
            return i
    return None
