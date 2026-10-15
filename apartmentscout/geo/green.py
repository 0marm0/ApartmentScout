"""Green space around a site: parks, lawns, playgrounds, woods and street trees from OpenStreetMap.

The 3D views draw them as green ground patches plus low-poly tree canopies, so a window that looks
over a park shows one. Only context: trees are NOT counted as obstructions in the sun hours (a tree
canopy is seasonal, porous and its height is a guess), the site keeps a note saying so.

Source: Overpass API (cached and receipted like every other download, see ``fetch.overpass``):

* areas: ``leisure=park|garden|common|dog_park|playground|nature_reserve``,
  ``landuse=grass|meadow|village_green|recreation_ground|forest|orchard|cemetery``,
  ``natural=wood|scrub|grassland`` as closed ways and multipolygon relations;
* trees: ``natural=tree`` nodes and ``natural=tree_row`` lines (one tree every ``ROW_STEP_M``).

Site JSON ``"green"``: ``{"source", "fetched", "radius_m", "polys": [{"kind", "name"?, "osm", "ring":
[[x, y], ...], "holes"?: [...]}], "trees": [x0, y0, x1, y1, ...], "counts", "note"}`` in the site's local
metre frame (x east, y north), the same frame as the footprints. ``kind`` is park | play | grass | wood;
``hard: 1`` marks plazas, courts and playgrounds (OSM ``surface`` paved or rubber), which get a ground patch but no scattered canopies.
New York sites also carry ``"census"``: the street trees of the NYC Street Tree Census with their trunk diameters
(see ``geo/trees.py``), because OpenStreetMap maps only a few percent of them; open water is the separate ``"water"`` block
(``geo/water.py``).
"""
from __future__ import annotations

import datetime as dt
import math
from pathlib import Path

from . import LocalFrame
from .fetch import overpass
from .shapes import clean_ring, point_in_ring, ring_area, simplify_ring, stitch

SOURCE = "OpenStreetMap contributors (ODbL), Overpass API"
ROW_STEP_M = 8.0
MIN_AREA_M2 = 60.0
MAX_POLYS = 600
MAX_TREES = 6000
NOTE = ("Context only: trees and lawns are drawn from OpenStreetMap and are not counted as obstructions in the "
        "sun hours (canopies are seasonal and their heights are not surveyed).")

LEISURE = {"park": "park", "garden": "park", "common": "park", "dog_park": "park", "playground": "play",
           "nature_reserve": "wood"}
LANDUSE = {"grass": "grass", "meadow": "grass", "village_green": "grass", "recreation_ground": "grass",
           "forest": "wood", "orchard": "wood", "cemetery": "park"}
NATURAL = {"wood": "wood", "scrub": "wood", "grassland": "grass"}
KINDS = ("park", "play", "grass", "wood")
# surfaces that carry no trees: a plaza or court drawn as a park gets its patch but no scattered canopies
HARD_SURFACES = {"concrete", "asphalt", "paved", "paving_stones", "sett", "tartan", "rubber", "artificial_turf",
                 "clay", "gravel", "compacted", "metal", "wood", "unpaved"}


def green_query(lat: float, lon: float, radius_m: float) -> str:
    """The Overpass QL query for areas and trees within ``radius_m`` (``out geom`` so no second call)."""
    a = f"(around:{radius_m:g},{lat},{lon})"
    lei = "|".join(LEISURE)
    lan = "|".join(LANDUSE)
    nat = "|".join(NATURAL)
    return f"""[out:json][timeout:180];
(way["leisure"~"^({lei})$"]{a};
 relation["leisure"~"^({lei})$"]["type"="multipolygon"]{a};
 way["landuse"~"^({lan})$"]{a};
 relation["landuse"~"^({lan})$"]["type"="multipolygon"]{a};
 way["natural"~"^({nat})$"]{a};
 relation["natural"~"^({nat})$"]["type"="multipolygon"]{a};
 way["natural"="tree_row"]{a};
 node["natural"="tree"]{a};
);
out geom tags;"""


def _kind(tags: dict) -> str | None:
    for key, table in (("leisure", LEISURE), ("landuse", LANDUSE), ("natural", NATURAL)):
        k = table.get(str(tags.get(key, "")).lower())
        if k:
            return k
    return None


def _round(pts) -> list[list[float]]:
    return [[round(x, 1), round(y, 1)] for x, y in pts]


def _ring_xy(geom: list[dict], frame: LocalFrame) -> list[tuple[float, float]]:
    return [frame.to_xy(p["lon"], p["lat"]) for p in geom if "lon" in p and "lat" in p]


def _tidy(ring: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    r = simplify_ring(clean_ring(ring), tol)
    return r if len(r) >= 3 else []


def line_samples(pts: list[tuple[float, float]], step: float = ROW_STEP_M) -> list[tuple[float, float]]:
    """Points every ``step`` metres along a polyline (including its first vertex)."""
    out: list[tuple[float, float]] = []
    carry = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        ln = math.hypot(x2 - x1, y2 - y1)
        if ln < 1e-6:
            continue
        d = carry
        while d <= ln:
            out.append((x1 + (x2 - x1) * d / ln, y1 + (y2 - y1) * d / ln))
            d += step
        carry = d - ln
    return out


def parse_green(els: list[dict], frame: LocalFrame, radius_m: float, fetched: str | None = None,
                simplify_tol: float = 0.6) -> dict:
    """Overpass elements -> the compact ``green`` block (see the module docstring)."""
    polys: list[dict] = []
    trees: list[tuple[float, float]] = []
    n_node = n_row = 0
    for e in els:
        tags = e.get("tags") or {}
        typ = e.get("type")
        if typ == "node":
            if tags.get("natural") == "tree" and "lon" in e and "lat" in e:
                x, y = frame.to_xy(e["lon"], e["lat"])
                if math.hypot(x, y) <= radius_m:
                    trees.append((x, y))
                    n_node += 1
            continue
        if tags.get("natural") == "tree_row":
            pts = _ring_xy(e.get("geometry") or [], frame)
            for p in line_samples(pts):
                if math.hypot(*p) <= radius_m:
                    trees.append(p)
                    n_row += 1
            continue
        kind = _kind(tags)
        if kind is None:
            continue
        rings: list[tuple[list, list]] = []
        if typ == "way":
            g = e.get("geometry") or []
            if len(g) >= 4 and g[0] == g[-1]:
                rings.append((_ring_xy(g, frame), []))
        elif typ == "relation":
            mem = [m for m in e.get("members", []) if m.get("type") == "way" and m.get("geometry")]
            outers = stitch([_ring_xy(m["geometry"], frame) for m in mem if m.get("role") != "inner"], tol=0.05)
            inners = stitch([_ring_xy(m["geometry"], frame) for m in mem if m.get("role") == "inner"], tol=0.05)
            for o in outers:
                rings.append((o, [h for h in inners if point_in_ring(h[0][0], h[0][1], o)]))
        for outer, holes in rings:
            ring = _tidy(outer, simplify_tol)
            if not ring or abs(ring_area(ring)) < MIN_AREA_M2:
                continue
            p = {"kind": kind, "osm": f"{typ}/{e.get('id')}", "ring": _round(ring)}
            if tags.get("name"):
                p["name"] = str(tags["name"])
            if kind == "play" or str(tags.get("surface", "")).lower() in HARD_SURFACES:
                p["hard"] = 1
            tidy_holes = (_tidy(h, simplify_tol) for h in holes)
            hs = [_round(h2) for h2 in tidy_holes if h2 and abs(ring_area(h2)) >= MIN_AREA_M2]
            if hs:
                p["holes"] = hs
            polys.append(p)
    polys.sort(key=lambda p: -abs(ring_area(p["ring"])))
    polys = polys[:MAX_POLYS]
    trees = _thin(trees, 1.5)[:MAX_TREES]
    return {"source": SOURCE, "fetched": fetched or dt.date.today().isoformat(), "radius_m": radius_m,
            "polys": polys, "trees": [round(v, 1) for p in trees for v in p],
            "counts": {"polys": len(polys), "trees": len(trees), "tree_nodes": n_node, "tree_row_points": n_row},
            "note": NOTE}


def _thin(pts: list[tuple[float, float]], min_gap: float) -> list[tuple[float, float]]:
    """Drop points closer than ``min_gap`` to an earlier one (duplicates from overlapping tree rows)."""
    seen: dict[tuple[int, int], list[tuple[float, float]]] = {}
    out = []
    for x, y in pts:
        cx, cy = int(x // min_gap), int(y // min_gap)
        if any(math.hypot(x - qx, y - qy) < min_gap
               for i in (cx - 1, cx, cx + 1) for j in (cy - 1, cy, cy + 1) for qx, qy in seen.get((i, j), [])):
            continue
        seen.setdefault((cx, cy), []).append((x, y))
        out.append((x, y))
    return out


def empty_green(radius_m: float = 600, fetched: str | None = None) -> dict:
    """A green block with no OpenStreetMap content, for a site whose street trees came from the census alone."""
    return {"source": SOURCE, "fetched": fetched or dt.date.today().isoformat(), "radius_m": radius_m, "polys": [],
            "trees": [], "counts": {"polys": 0, "trees": 0, "tree_nodes": 0, "tree_row_points": 0}, "note": NOTE}


def fetch_green(lat: float, lon: float, radius_m: float = 600, cache_dir: Path | None = None,
                refresh: bool = False) -> dict:
    """Parks, lawns, woods and trees around a point, in local metres (cached Overpass download)."""
    els = overpass(green_query(lat, lon, radius_m), cache_dir, refresh=refresh)
    return parse_green(els, LocalFrame(lat, lon), radius_m)
