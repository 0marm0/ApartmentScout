"""Planar polygon helpers for footprints with holes (light courts), in local metres or lon/lat."""
from __future__ import annotations

import math
from typing import Sequence

Pt = tuple[float, float]
Ring = Sequence[Pt]


def ring_area(ring: Ring) -> float:
    """Signed area (positive = counter-clockwise)."""
    n = len(ring)
    return sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n)) / 2


def point_in_ring(x: float, y: float, ring: Ring) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


def point_in_poly(x: float, y: float, outer: Ring, holes: Sequence[Ring] = ()) -> bool:
    """Inside the outer ring and not inside any hole (a light court counts as open air)."""
    return point_in_ring(x, y, outer) and not any(point_in_ring(x, y, h) for h in holes)


def bbox(ring: Ring) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def dist_to_ring(x: float, y: float, ring: Ring) -> float:
    """Distance to the ring's boundary (0 when inside)."""
    if point_in_ring(x, y, ring):
        return 0.0
    best = math.inf
    n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy + 1e-12)))
        best = min(best, math.hypot(x - x1 - t * dx, y - y1 - t * dy))
    return best


def clean_ring(pts: Sequence[Pt], min_step: float = 0.3) -> list[Pt]:
    """Drop the closing vertex and vertices closer than ``min_step`` to the previous one."""
    pts = list(pts)
    if len(pts) > 3 and pts[0] == pts[-1]:
        pts = pts[:-1]
    out: list[Pt] = []
    for p in pts:
        if not out or math.dist(p, out[-1]) > min_step:
            out.append(p)
    if len(out) > 3 and math.dist(out[0], out[-1]) <= min_step:
        out.pop()
    return out


def simplify_ring(pts: Sequence[Pt], tol: float = 0.3) -> list[Pt]:
    """Drop vertices lying within ``tol`` metres of the line through their neighbours.

    Footprints often split one straight wall into several collinear edges (and draw corners as
    short arcs); merging them makes a facade one face, as it is on the building.
    """
    out = list(pts)
    while len(out) > 3:
        n = len(out)
        best_k, best_d = -1, tol
        for k in range(n):
            (ax, ay), (px, py), (bx, by) = out[k - 1], out[k], out[(k + 1) % n]
            dx, dy = bx - ax, by - ay
            ln = math.hypot(dx, dy)
            d = math.hypot(px - ax, py - ay) if ln < 1e-9 else abs((px - ax) * dy - (py - ay) * dx) / ln
            if d < best_d:
                best_k, best_d = k, d
        if best_k < 0:
            break
        out.pop(best_k)
    return out


def stitch(ways: list[list[Pt]], tol: float = 1e-9) -> list[list[Pt]]:
    """Join open way segments end to end into closed rings (OSM multipolygon members)."""
    rings: list[list[Pt]] = []
    pool = [list(w) for w in ways if len(w) >= 2]
    while pool:
        cur = pool.pop(0)
        changed = True
        while not _closed(cur, tol) and changed:
            changed = False
            for k, w in enumerate(pool):
                if _same(cur[-1], w[0], tol):
                    cur += w[1:]
                elif _same(cur[-1], w[-1], tol):
                    cur += w[-2::-1]
                elif _same(cur[0], w[-1], tol):
                    cur = w[:-1] + cur
                elif _same(cur[0], w[0], tol):
                    cur = w[:0:-1] + cur
                else:
                    continue
                pool.pop(k)
                changed = True
                break
        if _closed(cur, tol) and len(cur) >= 4:
            rings.append(cur)
    return rings


def _same(a: Pt, b: Pt, tol: float) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def _closed(r: list[Pt], tol: float) -> bool:
    return len(r) >= 4 and _same(r[0], r[-1], tol)
