"""Open water around a site (rivers, harbour, lakes, ponds), so the 3D views can show where the water is.

Sources, in order of preference:

* New York: the city's *Planimetric Database: Hydrography* (NYC Open Data ``pjs3-c3z5``), surveyed water
  polygons with the real shoreline, piers and the islands left as holes (Roosevelt Island is a hole in the East
  River). It is read through the cached, receipted Socrata helper. This is better than deriving water from the
  commute router's land mask (``commute/land.py``, borough boundaries rasterised at 25 m): that mask cannot tell
  water from land outside the five boroughs (New Jersey would read as river) and its 25 m cells blur the quay line.
* Elsewhere: OpenStreetMap ``natural=water`` / ``water=*`` / ``waterway=riverbank`` / ``landuse=reservoir`` areas
  (ways and multipolygon relations) through Overpass. Open sea is not mapped as a polygon in OpenStreetMap (it is
  whatever lies beyond ``natural=coastline``), so a coastal site outside New York may show no sea.

Site JSON ``"water"``::

    {"source", "fetched", "half_m": 1600, "q_m": 0.5, "polys": [{"name"?, "kind", "rings": [[x, y, x, y, ...], ...]}],
     "labels": [{"name", "x", "y"}], "counts": {"polys", "rings", "points"}, "note"}

Rings are flat lists of integer multiples of ``q_m`` metres (east, north, in the footprints' local frame), clipped
to the square of half-side ``half_m`` (plus a small margin), simplified to about a metre and meant to be filled with
the even-odd rule (a ring inside another is a hole: an island). The 3D views paint them into a mask texture.
"""
from __future__ import annotations

import datetime as dt
import math
from pathlib import Path

from . import LocalFrame
from .fetch import overpass, socrata
from .shapes import point_in_ring, ring_area, stitch

HYDRO_DATASET = "pjs3-c3z5"
SOURCE_NYC = "NYC Planimetric Database: Hydrography (NYC Open Data, pjs3-c3z5)"
SOURCE_OSM = "OpenStreetMap contributors (ODbL), Overpass API"
HALF_M = 1600.0      # half the side of the square window the 3D views paint: it reaches past the far shore of the East River
PAD_M = 40.0         # rings are clipped a little beyond the window so the clip edges never show
Q_M = 0.5
SIMPLIFY_M = 0.8
MIN_AREA_M2 = 150.0
MAX_POLYS = 80
NOTE = ("Context only: water is drawn from surveyed hydrography polygons (or OpenStreetMap outside New York) "
        "to show where the rivers and ponds are. It carries no tide, depth or current, and no sun or view number "
        "depends on it.")

_OSM_WATER = ("water", "bay")


def _title(name: str | None) -> str | None:
    if not name or str(name).strip().lower() in ("unset", "unknown", "none"):
        return None
    s = " ".join(str(name).split())
    return s.title() if s.isupper() else s


def nyc_params(lat: float, lon: float, half_m: float = HALF_M) -> dict:
    """Socrata parameters for hydrography polygons touching the window. The box is snapped outward to a 0.01 degree
    grid so neighbouring sites share one cached download."""
    dlat = (half_m + PAD_M) / 110574.0
    dlon = (half_m + PAD_M) / (111320.0 * math.cos(math.radians(lat)))
    g = 0.01
    lo_lat, hi_lat = math.floor((lat - dlat) / g) * g, math.ceil((lat + dlat) / g) * g
    lo_lon, hi_lon = math.floor((lon - dlon) / g) * g, math.ceil((lon + dlon) / g) * g
    box = (f"POLYGON(({lo_lon:.2f} {lo_lat:.2f},{hi_lon:.2f} {lo_lat:.2f},{hi_lon:.2f} {hi_lat:.2f},"
           f"{lo_lon:.2f} {hi_lat:.2f},{lo_lon:.2f} {lo_lat:.2f}))")
    return {"$where": f"intersects(the_geom,'{box}')", "$select": "the_geom,name,feat_code", "$limit": 500}


def osm_query(lat: float, lon: float, half_m: float = HALF_M) -> str:
    r = (half_m + PAD_M) * math.sqrt(2)
    a = f"(around:{r:g},{lat},{lon})"
    return f"""[out:json][timeout:120];
(way["natural"~"^(water|bay)$"]{a};
 relation["natural"~"^(water|bay)$"]["type"="multipolygon"]{a};
 way["waterway"="riverbank"]{a};
 relation["waterway"="riverbank"]{a};
 way["landuse"~"^(reservoir|basin)$"]["water"!="pool"]{a};
);
out geom tags;"""


# ---------------------------------------------------------------------------- geometry

def clip_ring(ring: list[tuple[float, float]], lo: float, hi: float) -> list[tuple[float, float]]:
    """Sutherland-Hodgman clip of a ring to the square [lo, hi]^2. A concave ring cut into several pieces comes back
    as one ring joined along the square's edge, which is harmless for an even-odd fill inside the square."""
    pts = list(ring)
    for axis, bound, keep_below in ((0, hi, True), (0, lo, False), (1, hi, True), (1, lo, False)):
        if not pts:
            break
        out: list[tuple[float, float]] = []
        n = len(pts)

        def inside(p, axis=axis, bound=bound, keep_below=keep_below):
            return p[axis] <= bound if keep_below else p[axis] >= bound

        for i in range(n):
            cur, prev = pts[i], pts[i - 1]
            ci, pi = inside(cur), inside(prev)
            if ci != pi:
                t = (bound - prev[axis]) / (cur[axis] - prev[axis])
                out.append((prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])))
            if ci:
                out.append(cur)
        pts = out
    return pts


def dp_simplify(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on a closed ring (the ring is cut at its two most distant extreme points)."""
    n = len(pts)
    if n <= 4:
        return pts
    a = min(range(n), key=lambda i: (pts[i][0], pts[i][1]))
    b = max(range(n), key=lambda i: (pts[i][0] - pts[a][0]) ** 2 + (pts[i][1] - pts[a][1]) ** 2)
    if a == b:
        return pts
    i, j = sorted((a, b))
    first, second = pts[i:j + 1], pts[j:] + pts[:i + 1]
    keep = _dp(first, tol)[:-1] + _dp(second, tol)[:-1]
    return keep if len(keep) >= 3 else pts


def _dp(line: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(line) < 3:
        return line
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        s, e = stack.pop()
        (ax, ay), (bx, by) = line[s], line[e]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for k in range(s + 1, e):
            px, py = line[k]
            d = math.hypot(px - ax, py - ay) if ln < 1e-9 else abs((px - ax) * dy - (py - ay) * dx) / ln
            if d > best:
                best, bi = d, k
        if best > tol and bi > 0:
            keep[bi] = True
            stack.append((s, bi))
            stack.append((bi, e))
    return [p for p, k in zip(line, keep) if k]


def _quantise(ring: list[tuple[float, float]]) -> list[int]:
    out: list[int] = []
    last: tuple[int, int] | None = None
    for x, y in ring:
        q = (round(x / Q_M), round(y / Q_M))
        if q != last:
            out.extend(q)
            last = q
    if len(out) >= 4 and out[0] == out[-2] and out[1] == out[-1]:
        out = out[:-2]
    return out


def _tidy_rings(rings: list[list[tuple[float, float]]], half_m: float) -> list[list[int]]:
    lim = half_m + PAD_M
    out = []
    for ring in rings:
        if len(ring) < 3:
            continue
        clipped = clip_ring(ring, -lim, lim)
        if len(clipped) < 3 or abs(ring_area(clipped)) < MIN_AREA_M2:
            continue
        q = _quantise(dp_simplify(clipped, SIMPLIFY_M))
        if len(q) >= 6:
            out.append(q)
    return out


def _flat_to_pts(flat: list[int]) -> list[tuple[float, float]]:
    return [(flat[i] * Q_M, flat[i + 1] * Q_M) for i in range(0, len(flat) - 1, 2)]


def label_point(rings: list[list[int]], half_m: float = HALF_M, near: tuple[float, float] = (0.0, 0.0),
                step: float = 40.0) -> tuple[float, float] | None:
    """A spot well inside the water (even-odd over ``rings``), preferring one near ``near`` (the site)."""
    polys = [_flat_to_pts(r) for r in rings]
    verts = [p for r in polys for p in r]
    if not verts:
        return None
    best, best_s = None, -1e9
    n = int(half_m * 0.9 / step)
    for ix in range(-n, n + 1):
        for iy in range(-n, n + 1):
            x, y = ix * step, iy * step
            if sum(1 for r in polys if point_in_ring(x, y, r)) % 2 == 0:
                continue
            shore = min(math.hypot(x - vx, y - vy) for vx, vy in verts)
            s = min(shore, 120.0) - 0.06 * math.hypot(x - near[0], y - near[1])
            if s > best_s:
                best, best_s = (x, y), s
    return best


# ---------------------------------------------------------------------------- parsing

def _geojson_rings(geom: dict | None, frame: LocalFrame) -> list[list[tuple[float, float]]]:
    if not geom:
        return []
    polys = geom.get("coordinates") or []
    if geom.get("type") == "Polygon":
        polys = [polys]
    elif geom.get("type") != "MultiPolygon":
        return []
    rings = []
    for poly in polys:
        for ring in poly:
            pts = [frame.to_xy(p[0], p[1]) for p in ring if len(p) >= 2]
            if len(pts) >= 4:
                rings.append(pts[:-1] if pts[0] == pts[-1] else pts)
    return rings


def _finish(polys: list[dict], source: str, half_m: float, fetched: str | None, near: tuple[float, float]) -> dict:
    polys = polys[:MAX_POLYS]
    labels = []
    seen: set[str] = set()
    for p in polys:
        name = p.get("name")
        if not name or name in seen:
            continue
        seen.add(name)
        lp = label_point(p["rings"], half_m, near)
        if lp:
            labels.append({"name": name, "x": round(lp[0] / Q_M) * Q_M, "y": round(lp[1] / Q_M) * Q_M})
    nr = sum(len(p["rings"]) for p in polys)
    npts = sum(len(r) // 2 for p in polys for r in p["rings"])
    return {"source": source, "fetched": fetched or dt.date.today().isoformat(), "half_m": half_m, "q_m": Q_M,
            "polys": polys, "labels": labels, "counts": {"polys": len(polys), "rings": nr, "points": npts},
            "note": NOTE}


def parse_hydro(rows: list[dict], frame: LocalFrame, half_m: float = HALF_M, fetched: str | None = None) -> dict:
    """NYC hydrography rows (GeoJSON geometry in ``the_geom``) -> the compact ``water`` block."""
    polys = []
    for r in rows:
        rings = _tidy_rings(_geojson_rings(r.get("the_geom"), frame), half_m)
        if rings:
            polys.append({"name": _title(r.get("name")), "kind": "water", "rings": rings})
    polys.sort(key=lambda p: -sum(len(r) for r in p["rings"]))
    return _finish([{k: v for k, v in p.items() if v is not None} for p in polys], SOURCE_NYC, half_m, fetched, (0.0, 0.0))


def parse_osm_water(els: list[dict], frame: LocalFrame, half_m: float = HALF_M, fetched: str | None = None) -> dict:
    """Overpass elements (``out geom``) -> the compact ``water`` block."""
    def xy(geom):
        return [frame.to_xy(p["lon"], p["lat"]) for p in geom if "lon" in p and "lat" in p]

    polys = []
    for e in els:
        tags = e.get("tags") or {}
        if tags.get("water") in ("pool", "wastewater", "basin") or tags.get("leisure") == "swimming_pool":
            continue
        rings = []
        if e.get("type") == "way":
            g = e.get("geometry") or []
            if len(g) >= 4 and g[0] == g[-1]:
                rings.append(xy(g)[:-1])
        elif e.get("type") == "relation":
            mem = [m for m in e.get("members", []) if m.get("type") == "way" and m.get("geometry")]
            rings += [r[:-1] for r in stitch([xy(m["geometry"]) for m in mem], tol=0.05)]
        rings = _tidy_rings(rings, half_m)
        if rings:
            polys.append({"name": _title(tags.get("name")), "kind": "water", "rings": rings})
    polys.sort(key=lambda p: -sum(len(r) for r in p["rings"]))
    return _finish([{k: v for k, v in p.items() if v is not None} for p in polys], SOURCE_OSM, half_m, fetched, (0.0, 0.0))


def fetch_water(lat: float, lon: float, city: str | None = None, half_m: float = HALF_M,
                cache_dir: Path | None = None, refresh: bool = False) -> dict:
    """Water polygons around a point in local metres (cached downloads; NYC hydrography, else OpenStreetMap)."""
    frame = LocalFrame(lat, lon)
    if city == "nyc":
        try:
            rows = socrata(HYDRO_DATASET, nyc_params(lat, lon, half_m), cache_dir, refresh=refresh)
            return parse_hydro(rows, frame, half_m)
        except RuntimeError:
            pass   # fall back to OpenStreetMap below
    return parse_osm_water(overpass(osm_query(lat, lon, half_m), cache_dir, refresh=refresh), frame, half_m)
