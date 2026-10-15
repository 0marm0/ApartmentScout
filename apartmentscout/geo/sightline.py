"""Which parks and trees can a window on each candidate facade see?

When nothing says which way a unit faces, a photo or video from inside can: it shows a park, a river or
a landmark at a known place. This module turns the site model into the other half of that argument. For
every facade of the target at the eye height of a floor it asks, for each mapped green area (the site's
``green`` block) and for the mapped street trees, how much of it a window on that facade sees within a
field of view, and what stands in the way, then reports where in the frame it appears (left or right of
the facade's centre line, how far down) and which tall buildings sit near the edges of the frame.

Visibility is a straight line from the eye to a ground sample (or a tree crown at ``TREE_H_M``) that
no wall rises above: the same wall list as the sun model (``sun._site_rings``, footprints or their
components, at heights relative to the target's ground). It is a flat-ground model: terraces such as
Tudor City's bluff, trees, and glass reflectance are not in it, so read the numbers as "could be seen",
not as a rendering.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np

from ..sun import Skyline, _site_rings, valid_component
from .shapes import point_in_ring

FOV_DEG = 90.0
CELL_M = 6.0
TREE_H_M = 10.0
EYE_OUT_M = 0.6
MIN_RAY_M = 0.5
FRAME_SR = math.radians(FOV_DEG) * 1.0  # a 90 x 60 degree frame: width (rad) x (sin 30 - sin -30)


def angle_diff(a: float, b: float) -> float:
    """Signed difference a - b in degrees, in (-180, 180]."""
    return (a - b + 540.0) % 360.0 - 180.0


def bearing_to(dx: float, dy: float) -> float:
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


# --------------------------------------------------------------------------- green samples

def _bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def green_cells(green: dict, cell_m: float = CELL_M) -> list[dict]:
    """Grid samples inside each green polygon (holes excluded): [{x, y, area, poly}].

    Polygons smaller than a cell still get one sample at their centroid so a small garden is not lost.
    Paved polygons (``hard``: playgrounds, courts) are not green and are skipped; where polygons overlap (a city park
    property and the OpenStreetMap park inside it) a ground cell counts once, for the larger polygon.
    """
    out = []
    taken: set[tuple[int, int]] = set()      # [city context] one sample per ground cell, however many polygons cover it
    for k, p in enumerate((green or {}).get("polys") or []):
        if p.get("hard"):
            continue
        ring = [tuple(q) for q in p["ring"]]
        holes = [[tuple(q) for q in h] for h in p.get("holes") or []]
        x0, y0, x1, y1 = _bbox(ring)
        pts = []
        gx = x0 + cell_m / 2
        while gx < x1:
            gy = y0 + cell_m / 2
            while gy < y1:
                if point_in_ring(gx, gy, ring) and not any(point_in_ring(gx, gy, h) for h in holes):
                    pts.append((gx, gy))
                gy += cell_m
            gx += cell_m
        if not pts:
            cx, cy = sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring)
            if point_in_ring(cx, cy, ring):
                pts = [(cx, cy)]
        for x, y in pts:
            key = (int(x // cell_m), int(y // cell_m))
            if key in taken:
                continue
            taken.add(key)
            out.append({"x": x, "y": y, "area": cell_m * cell_m, "poly": k})
    return out


def drop_covered(cells: list[dict], site: dict) -> list[dict]:
    """Remove samples that lie inside a building footprint (lawns mapped on podium roofs or overlapping a lot):
    from a window they are the building itself, not ground."""
    if not cells:
        return cells
    pts = np.array([[c["x"], c["y"]] for c in cells])
    covered = np.zeros(len(cells), dtype=bool)
    for top, _g, _t, flat in site["b"]:
        ring = list(zip(flat[0::2], flat[1::2]))
        x0, y0, x1, y1 = _bbox(ring)
        near = np.where(~covered & (pts[:, 0] >= x0) & (pts[:, 0] <= x1) & (pts[:, 1] >= y0) & (pts[:, 1] <= y1))[0]
        for k in near:
            if point_in_ring(pts[k, 0], pts[k, 1], ring):
                covered[k] = True
    return [c for c, hide in zip(cells, covered) if not hide]


# --------------------------------------------------------------------------- occlusion

class Walls:
    """Wall edges of every footprint / component with their tops, for line-of-sight tests."""

    def __init__(self, site: dict, skip_owner: int | None = None):
        ax, ay, ex, ey, top, own = [], [], [], [], [], []
        for t, ring, owner in _site_rings(site):
            if skip_owner is not None and owner == skip_owner:
                continue
            p = np.asarray(ring, dtype=float)
            if len(p) < 2:
                continue
            e = np.roll(p, -1, axis=0) - p
            ax.append(p[:, 0]); ay.append(p[:, 1]); ex.append(e[:, 0]); ey.append(e[:, 1])
            top.append(np.full(len(p), float(t))); own.append(np.full(len(p), owner, dtype=int))
        cat = (lambda v: np.concatenate(v) if v else np.zeros(0))
        self.ax, self.ay, self.ex, self.ey = cat(ax), cat(ay), cat(ex), cat(ey)
        self.top, self.owner = cat(top), cat(own).astype(int)

    def visible(self, eye: tuple[float, float, float], pts: np.ndarray, z_target: float,
                chunk: int = 400) -> np.ndarray:
        """Boolean per target point: no wall edge crosses the sight line below the wall's top."""
        px, py, pz = eye
        n = len(pts)
        out = np.ones(n, dtype=bool)
        if n == 0 or not len(self.top):
            return out
        ax, ay, ex, ey, top = self.ax - px, self.ay - py, self.ex, self.ey, self.top
        for k in range(0, n, chunk):
            q = pts[k:k + chunk]
            dx = (q[:, 0] - px)[:, None]
            dy = (q[:, 1] - py)[:, None]
            with np.errstate(divide="ignore", invalid="ignore"):
                den = dx * ey - dy * ex
                u = (ax * ey - ay * ex) / den           # along the sight line, 0 = eye, 1 = target
                s = (ax * dy - ay * dx) / den           # along the wall edge
                ray_z = pz + (z_target - pz) * u
                dist = u * np.hypot(dx, dy)
                hit = (np.abs(den) > 1e-9) & (u > 0) & (u < 1) & (dist > MIN_RAY_M) & (s >= 0) & (s <= 1) \
                    & (top[None, :] > ray_z)
            out[k:k + chunk] = ~hit.any(axis=1)
        return out


# --------------------------------------------------------------------------- candidate facades

def exterior_edges(site: dict, z: float, min_len: float = 4.0) -> list[dict]:
    """Open exterior wall edges of the target at height ``z`` (metres above its ground).

    Uses the target's valid components whose vertical span contains ``z`` (a tower above a podium),
    else its footprint. An edge is dropped when 1 m outside it is inside the target's other parts or
    another building (a party wall). Each edge: a, b, mid, bearing (outward), length, owner part.
    """
    ti = site.get("target")
    if ti is None:
        return []
    top, g, _t, flat = site["b"][ti]
    comps = [c for c in (site.get("components") or {}).get(str(ti), []) if valid_component(c)
             and float(c.get("base_m") or 0) + g <= z <= float(c["top_m"]) + g]
    rings = [[(float(p[0]), float(p[1])) for p in c["ring"]] for c in comps] or [list(zip(flat[0::2], flat[1::2]))]
    others = [(t, [tuple(r) for r in ring]) for t, ring, owner in _site_rings(site) if owner != ti and t > z]
    out = []
    for ri, ring in enumerate(rings):
        area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]
                   for i in range(len(ring))) / 2
        for i in range(len(ring)):
            (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % len(ring)]
            ln = math.hypot(x2 - x1, y2 - y1)
            if ln < min_len:
                continue
            nx, ny = ((y2 - y1), -(x2 - x1)) if area > 0 else (-(y2 - y1), (x2 - x1))
            nl = math.hypot(nx, ny)
            nx, ny = nx / nl, ny / nl
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            probe = (mx + nx * 1.0, my + ny * 1.0)
            if any(point_in_ring(probe[0], probe[1], r) for k, r in enumerate(rings) if k != ri):
                continue
            if any(point_in_ring(probe[0], probe[1], r) for t, r in others):
                continue
            out.append({"a": (x1, y1), "b": (x2, y2), "mid": (mx, my), "length": round(ln, 1),
                        "bearing": round(bearing_to(nx, ny), 1), "part": ri})
    return out


def facade_groups(edges: Sequence[dict], tol: float = 12.0, min_total: float = 8.0) -> list[dict]:
    """Cluster exterior edges by outward bearing (within ``tol`` degrees of the cluster's own mean)."""
    groups: list[list[dict]] = []
    for e in sorted(edges, key=lambda e: -e["length"]):
        for g in groups:
            mean = bearing_to(sum(x["length"] * math.sin(math.radians(x["bearing"])) for x in g),
                              sum(x["length"] * math.cos(math.radians(x["bearing"])) for x in g))
            if abs(angle_diff(e["bearing"], mean)) <= tol:
                g.append(e)
                break
        else:
            groups.append([e])
    out = []
    for g in groups:
        tot = sum(x["length"] for x in g)
        if tot < min_total:
            continue
        brg = bearing_to(sum(x["length"] * math.sin(math.radians(x["bearing"])) for x in g),
                         sum(x["length"] * math.cos(math.radians(x["bearing"])) for x in g))
        out.append({"bearing": round(brg, 1), "length": round(tot, 1), "edges": g})
    return sorted(out, key=lambda g: g["bearing"])


def eye_on(edge: dict, floor_z: float, t: float = 0.5, out_m: float = EYE_OUT_M) -> tuple[float, float, float]:
    (x1, y1), (x2, y2) = edge["a"], edge["b"]
    b = math.radians(edge["bearing"])
    return (x1 + (x2 - x1) * t + math.sin(b) * out_m, y1 + (y2 - y1) * t + math.cos(b) * out_m, floor_z)


# --------------------------------------------------------------------------- survey of one view

def _percentile(vals: np.ndarray, w: np.ndarray, q: float) -> float:
    o = np.argsort(vals)
    c = np.cumsum(w[o])
    return float(vals[o][min(len(o) - 1, int(np.searchsorted(c, q * c[-1])))])


def openness(profile: np.ndarray, facing: float, fov: float = FOV_DEG) -> dict:
    """How much of the frame is wall: the obstruction angle (degrees above the horizon, from the sun
    model's skyline profile) averaged over the field of view, and the share of the frame blocked above
    10 and 30 degrees."""
    az = np.arange(len(profile)) * 0.5
    off = (az - facing + 540.0) % 360.0 - 180.0
    p = profile[np.abs(off) <= fov / 2]
    return {"mean_obstruction_deg": round(float(p.mean()), 1), "share_above_10_deg": round(float(np.mean(p > 10)), 2),
            "share_above_30_deg": round(float(np.mean(p > 30)), 2)}


def survey(site: dict, eye: tuple[float, float, float], facing: float, fov: float = FOV_DEG,
           cells: list[dict] | None = None, walls: Walls | None = None, tower_range_m: float = 220.0,
           sky: Skyline | None = None) -> dict:
    """What a window at ``eye`` looking along ``facing`` sees of the site's green space.

    Returns the visible green per polygon (area, where in the frame, how far, how far down), the
    visible mapped trees, the share of a 90 x 60 degree frame the visible green fills, and the tall
    buildings (rising above the eye) that stand near the frame's left and right edges.
    """
    green = site.get("green") or {}
    cells = drop_covered(green_cells(green), site) if cells is None else cells
    walls = walls or Walls(site)
    ex, ey, ez = eye
    half = fov / 2
    polys = green.get("polys") or []

    xs = np.array([[c["x"], c["y"]] for c in cells]) if cells else np.zeros((0, 2))
    dx, dy = (xs[:, 0] - ex, xs[:, 1] - ey) if len(xs) else (np.zeros(0), np.zeros(0))
    brg = (np.degrees(np.arctan2(dx, dy)) + 360.0) % 360.0
    off = (brg - facing + 540.0) % 360.0 - 180.0
    dist = np.hypot(dx, dy)
    infov = np.abs(off) <= half
    vis = np.zeros(len(xs), dtype=bool)
    if infov.any():
        vis[infov] = walls.visible(eye, xs[infov], 0.0)
    area = np.array([c["area"] for c in cells], dtype=float) if cells else np.zeros(0)
    owner = np.array([c["poly"] for c in cells], dtype=int) if cells else np.zeros(0, dtype=int)
    depr = np.degrees(np.arctan2(ez, np.maximum(dist, 1.0)))
    omega = area * ez / np.hypot(dist, ez) ** 3  # solid angle (sr) of a flat ground patch seen from height ez

    rows = []
    for k, p in enumerate(polys):
        m = owner == k
        inf = m & infov
        if not inf.any():
            continue
        v = m & vis
        row = {"poly": k, "kind": p["kind"], "name": p.get("name"), "osm": p.get("osm"),
               "in_fov_m2": round(float(area[inf].sum())), "visible_m2": round(float(area[v].sum())),
               "visible_share": round(float(area[v].sum() / area[inf].sum()), 2)}
        if v.any():
            w = area[v]
            row.update({"offset_deg": [round(_percentile(off[v], w, 0.05)), round(_percentile(off[v], w, 0.95))],
                        "dist_m": [round(float(dist[v].min())), round(float(dist[v].max()))],
                        "below_horizon_deg": [round(float(depr[v].min())), round(float(depr[v].max()))],
                        "frame_pct": round(float(omega[v].sum() / FRAME_SR * 100), 2)})
        rows.append(row)
    rows.sort(key=lambda r: -r["visible_m2"])

    # mapped trees: crown height TREE_H_M
    tr = green.get("trees") or []
    tp = np.array(tr, dtype=float).reshape(-1, 2) if tr else np.zeros((0, 2))
    t_vis = t_in = 0
    t_off: list[float] = []
    if len(tp):
        tdx, tdy = tp[:, 0] - ex, tp[:, 1] - ey
        toff = (np.degrees(np.arctan2(tdx, tdy)) + 360.0 - facing + 540.0) % 360.0 - 180.0
        tin = (np.abs(toff) <= half) & (np.hypot(tdx, tdy) <= 400)
        t_in = int(tin.sum())
        if t_in:
            tv = walls.visible(eye, tp[tin], TREE_H_M)
            t_vis = int(tv.sum())
            t_off = [round(float(v)) for v in np.percentile(toff[tin][tv], [5, 95])] if tv.any() else []

    cover_pct = round(float(omega[vis].sum() / FRAME_SR * 100), 2) if vis.any() else 0.0
    out = {"facing": round(facing, 1), "fov": fov, "eye": [round(ex, 1), round(ey, 1), round(ez, 1)],
           "green": rows, "visible_m2": round(float(area[vis].sum())), "frame_pct": cover_pct,
           "trees": {"in_fov": t_in, "visible": t_vis, "offset_deg": t_off},
           "towers": tall_near_edges(site, eye, facing, half, tower_range_m)}
    if sky is not None:
        out["openness"] = openness(sky.profile(ex, ey, ez), facing, fov)
    return out


def tall_near_edges(site: dict, eye: tuple[float, float, float], facing: float, half: float,
                    range_m: float = 220.0, edge_band: float = 18.0, limit: int = 4) -> dict:
    """Buildings that rise above the eye, within ``range_m``, near the left and right edges of the frame.

    The site has no facade material, so "dark glass" cannot be read from the data: this lists the
    tall neighbours (name, distance, offset from the centre line, top above the eye) that would sit
    there, for a person to compare with a photo.
    """
    ex, ey, ez = eye
    meta = site.get("bmeta") or []
    ti = site.get("target")
    left, right = [], []
    for i, (top, _g, _t, flat) in enumerate(site["b"]):
        if i == ti or top <= ez:
            continue
        ring = list(zip(flat[0::2], flat[1::2]))
        d, nx, ny = _nearest(ex, ey, ring)
        if d > range_m:
            continue
        off = angle_diff(bearing_to(nx - ex, ny - ey), facing)
        if abs(off) > half + 6:
            continue
        m = meta[i] if i < len(meta) and meta[i] else {}
        row = {"b": i, "name": m.get("name") or m.get("address"), "dist_m": round(d), "offset_deg": round(off),
               "top_above_eye_m": round(top - ez), "elev_deg": round(math.degrees(math.atan2(top - ez, max(d, 1.0))))}
        if off <= -(half - edge_band):
            left.append(row)
        elif off >= half - edge_band:
            right.append(row)
    key = lambda r: r["dist_m"]  # noqa: E731
    return {"left_edge": sorted(left, key=key)[:limit], "right_edge": sorted(right, key=key)[:limit]}


def _nearest(x: float, y: float, ring: Sequence[tuple[float, float]]) -> tuple[float, float, float]:
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


# --------------------------------------------------------------------------- compare facades

def compare_facades(site: dict, floor: int, floor_h: float | None = None, fov: float = FOV_DEG,
                    bearings: Iterable[float] | None = None) -> list[dict]:
    """Survey every open facade of the target at the eye height of ``floor``.

    A facade is a group of exterior edges with nearly the same outward bearing (see ``facade_groups``);
    ``bearings`` limits the result to the groups closest to each given bearing. The eye is placed at the
    middle of the group's longest edge. Returns one row per facade: bearing, length, eye, the
    ``survey`` result and a short ``verdict`` string.
    """
    fh = floor_h or site.get("floor_height_m") or 3.2
    z = (floor - 1) * fh + 1.6
    groups = facade_groups(exterior_edges(site, z))
    if bearings is not None:
        want = list(bearings)
        groups = [min(groups, key=lambda g: abs(angle_diff(g["bearing"], b))) for b in want] if groups else []
    walls = Walls(site)
    sky = Skyline(site)
    cells = drop_covered(green_cells(site.get("green") or {}), site)
    rows = []
    for g in groups:
        e = max(g["edges"], key=lambda x: x["length"])
        eye = eye_on(e, z)
        s = survey(site, eye, g["bearing"], fov, cells, walls, sky=sky)
        rows.append({"bearing": g["bearing"], "length_m": g["length"], "floor": floor, "eye_z": round(z, 1),
                     **s, "verdict": verdict(s)})
    return rows


def verdict(s: dict) -> str:
    """One line: the visible green that matters, where it sits in the frame, and the trees."""
    top = [r for r in s["green"] if r["visible_m2"] >= 150][:3]
    bits = []
    for r in top:
        name = r.get("name") or f"unnamed {r['kind']}"
        where = r.get("offset_deg")
        bits.append(f"{name} {r['visible_m2']} m2 at {where[0]:+d}..{where[1]:+d} deg, "
                    f"{r['dist_m'][0]}-{r['dist_m'][1]} m" if where else name)
    t = s["trees"]
    tail = f"; {t['visible']}/{t['in_fov']} mapped trees in view" if t["in_fov"] else ""
    head = "; ".join(bits) if bits else "no mapped green in view"
    return head + tail + f"; green fills {s['frame_pct']}% of a 90x60 frame"


def compact(row: dict, top: int = 5, towers: int = 2) -> dict:
    """A facade row trimmed for the site JSON: the biggest visible green areas and the nearest edge towers."""
    keep = ("poly", "kind", "name", "osm", "visible_m2", "in_fov_m2", "offset_deg", "dist_m", "below_horizon_deg")
    out = {k: row[k] for k in ("bearing", "length_m", "floor", "eye", "frame_pct", "visible_m2", "trees", "openness",
                               "verdict") if k in row}
    out["green"] = [{k: r[k] for k in keep if k in r} for r in row["green"] if r["visible_m2"] > 0][:top]
    out["towers"] = {k: v[:towers] for k, v in row["towers"].items()}
    return out


def sightline_block(site: dict, floor: int, chosen_bearing: float | None = None, fov: float = FOV_DEG) -> dict:
    """The ``sightline`` block of the site JSON: every open facade of the target surveyed at ``floor``.

    ``chosen`` is the index (in ``facades``) of the facade closest to ``chosen_bearing``. Offsets are
    degrees from the facade's centre line (negative = left of it, looking out); ``below_horizon_deg`` is
    the depression angle of the visible parts of an area; ``frame_pct`` is the visible green's share of a
    90 x 60 degree frame (solid angle, flat ground).
    """
    rows = compare_facades(site, floor, fov=fov)
    out = {"floor": floor, "fov_deg": fov, "model": "straight sight lines over the site's walls (components where "
           "known), flat ground, trees as 10 m crowns; no terrain, no facade colour",
           "green_fetched": (site.get("green") or {}).get("fetched"), "facades": [compact(r) for r in rows]}
    if chosen_bearing is not None and rows:
        out["chosen"] = min(range(len(rows)), key=lambda k: abs(angle_diff(rows[k]["bearing"], chosen_bearing)))
    return out


def green_view(site: dict, face: dict, t: float, floor: int, floor_h: float, fov: float = FOV_DEG) -> dict:
    """What the chosen window sees of the green space (see ``survey``), for ``study.green_view``."""
    x1, y1 = face["a"]
    x2, y2 = face["b"]
    b = math.radians(face["bearing"])
    eye = (x1 + (x2 - x1) * t + math.sin(b) * EYE_OUT_M, y1 + (y2 - y1) * t + math.cos(b) * EYE_OUT_M,
           (floor - 1) * floor_h + 1.6)
    s = survey(site, eye, face["bearing"], fov, sky=Skyline(site))
    return {**compact({**s, "bearing": face["bearing"], "floor": floor, "verdict": verdict(s)}), "fov_deg": fov}
