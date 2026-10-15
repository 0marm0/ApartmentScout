"""City-owned green space around a New York site: NYC Parks Properties and NYC Greenstreets.

OpenStreetMap maps many parks only in part (St. Vartan Park is 2,000 m2 there and 11,000 m2 in the city's own records)
and misses small city plots altogether. For New York two official polygon datasets fill the gap, read through the same
cached, receipted Socrata helper as the footprints:

* **NYC Parks Properties** (NYC Open Data ``enfh-gkve``): every property NYC Parks manages, with a ``typecategory``
  (Neighborhood Park, Playground, Triangle/Plaza, Mall, Strip, Garden, Nature Area, Recreational Field/Courts, ...);
* **NYC Greenstreets** (``mk9u-qu7i``): the planted triangles, medians and bump-outs that were street space.

Each polygon becomes an entry of the site's ``green["polys"]`` list, in the same compact form as the OpenStreetMap ones
(``geo/green.py``) with ``"src": "parks"`` or ``"greenstreet"`` and the city's ``"ref"`` (property number) in place of
``"osm"``. Playgrounds, courts and fields are marked ``hard`` (paved: no lawn, no scattered canopies); the planted
categories are lawns. ``merge_polys`` then lays the two sources over each other:

* an OpenStreetMap park that lies (mostly) inside a city *playground or court* property is marked ``hard`` too, unless
  OpenStreetMap says its surface is grass (``why`` records the reason);
* every polygon inside NYC Parks property gets ``inv`` = the living trees of the Parks inventory standing in it
  (``geo/forestry.py``): the inventory covers every Parks property, so the 3D views draw those real trees and add
  nothing, except where an area is clearly under-recorded. Polygons outside Parks property (the private Tudor City
  Greens, plazas) carry no ``inv`` and get the denser blue-noise fill instead.

Context only, like all of the green layer.
"""
from __future__ import annotations

import math
from pathlib import Path

from . import LocalFrame
from .fetch import socrata
from .shapes import bbox, clean_ring, point_in_poly, point_in_ring, ring_area, simplify_ring

PARKS = "enfh-gkve"
GREENSTREETS = "mk9u-qu7i"
PARKS_SOURCE = "NYC Parks Properties (NYC Open Data, enfh-gkve)"
GREENSTREETS_SOURCE = "NYC Greenstreets (NYC Open Data, mk9u-qu7i)"
MIN_AREA_M2 = 40.0
MAX_TOTAL = 1000            # polygons kept in all (largest first)
MAX_RING_PTS = 400          # a ring is simplified harder until it fits (a flagship park has thousands of vertices)
COVER_MIN = 0.5             # an OpenStreetMap polygon is "inside" a city property when this share of it is

# typecategory -> (kind, hard). hard = paved: a playground, court, field or pier, drawn as paved ground, no scattered trees.
_PARK = ("park", False)
_PAVED = ("play", True)
TYPE_KIND: dict[str, tuple[str, bool]] = {
    "Neighborhood Park": _PARK, "Community Park": _PARK, "Flagship Park": _PARK, "Garden": _PARK, "Mall": _PARK,
    "Strip": _PARK, "Parkway": _PARK, "Historic House Park": _PARK, "Cemetery": _PARK, "Triangle/Plaza": _PARK,
    "Nature Area": ("wood", False), "Undeveloped": ("grass", False),
    "Playground": _PAVED, "Jointly Operated Playground": _PAVED, "Recreational Field/Courts": _PAVED,
    "Waterfront Facility": ("park", True),
}
SKIP_TYPES = {"Buildings/Institutions", "Managed Sites", "Operations", "Lot"}


def _bbox_polygon(lat: float, lon: float, radius_m: float) -> str:
    dlat = radius_m / 110574.0
    dlon = radius_m / (111320.0 * math.cos(math.radians(lat)))
    s, n, w, e = lat - dlat, lat + dlat, lon - dlon, lon + dlon
    return f"POLYGON(({w:.6f} {s:.6f},{e:.6f} {s:.6f},{e:.6f} {n:.6f},{w:.6f} {n:.6f},{w:.6f} {s:.6f}))"


def parks_query(lat: float, lon: float, radius_m: float) -> dict:
    """Socrata parameters for the Parks properties that touch the box around a point (not retired)."""
    where = f"intersects(multipolygon,'{_bbox_polygon(lat, lon, radius_m)}') AND retired = false"
    sel = "signname,name311,typecategory,subcategory,gispropnum,acres,multipolygon"
    return {"$where": where, "$select": sel, "$limit": 2000}


def greenstreets_query(lat: float, lon: float, radius_m: float) -> dict:
    where = f"intersects(multipolygon,'{_bbox_polygon(lat, lon, radius_m)}')"
    sel = "sitename,description,gstype,featurestatus,gispropnum,location,multipolygon"
    return {"$where": where, "$select": sel, "$limit": 2000}


def _rings(geom: dict | None, frame: LocalFrame) -> list[tuple[list, list[list]]]:
    """GeoJSON (Multi)Polygon -> [(outer, [holes])] in local metres."""
    if not isinstance(geom, dict):
        return []
    coords = geom.get("coordinates") or []
    polys = coords if geom.get("type") == "MultiPolygon" else [coords] if geom.get("type") == "Polygon" else []
    out = []
    for poly in polys:
        rings = [[frame.to_xy(float(p[0]), float(p[1])) for p in ring if len(p) >= 2] for ring in poly or []]
        if rings and len(rings[0]) >= 4:
            out.append((rings[0], rings[1:]))
    return out


def _tidy(ring, tol: float) -> list:
    r = simplify_ring(clean_ring(ring), tol)
    while len(r) > MAX_RING_PTS and tol < 8:
        tol *= 1.6
        r = simplify_ring(clean_ring(ring), tol)
    return r if len(r) >= 3 else []


def _round(pts) -> list[list[float]]:
    return [[round(x, 1), round(y, 1)] for x, y in pts]


def _entry(kind: str, hard: bool, src: str, ref: str | None, name: str | None, cat: str | None, outer, holes,
           tol: float) -> dict | None:
    ring = _tidy(outer, tol)
    if not ring or abs(ring_area(ring)) < MIN_AREA_M2:
        return None
    p: dict = {"kind": kind, "src": src, "ring": _round(ring)}
    if ref:
        p["ref"] = ref
    if name:
        p["name"] = name
    if cat:
        p["cat"] = cat
    if hard:
        p["hard"] = 1
    hs = [_round(h2) for h in holes if (h2 := _tidy(h, tol)) and abs(ring_area(h2)) >= MIN_AREA_M2]
    if hs:
        p["holes"] = hs
    return p


def parse_parks(rows: list[dict], frame: LocalFrame, radius_m: float, tol: float = 0.8) -> list[dict]:
    """Parks Properties rows -> polygons (see the module docstring). Polygons farther than the radius are dropped."""
    out: list[dict] = []
    for r in rows:
        cat = str(r.get("typecategory") or "").strip()
        if cat in SKIP_TYPES or str(r.get("retired", "")).lower() == "true":
            continue
        kind, hard = TYPE_KIND.get(cat, _PARK)
        name = (r.get("signname") or r.get("name311") or "").strip() or None
        for outer, holes in _rings(r.get("multipolygon"), frame):
            if not _near(outer, radius_m):
                continue
            e = _entry(kind, hard, "parks", r.get("gispropnum"), name, cat or None, outer, holes, tol)
            if e:
                out.append(e)
    return out


def parse_greenstreets(rows: list[dict], frame: LocalFrame, radius_m: float, tol: float = 0.6) -> list[dict]:
    """Greenstreets rows (active ones) -> planted polygons."""
    out: list[dict] = []
    for r in rows:
        if str(r.get("featurestatus") or "").strip().lower() == "inactive":
            continue
        for outer, holes in _rings(r.get("multipolygon"), frame):
            if not _near(outer, radius_m):
                continue
            e = _entry("park", False, "greenstreet", r.get("gispropnum"), None, "Greenstreet", outer, holes, tol)
            if e:
                out.append(e)
    return out


def _near(ring, radius_m: float) -> bool:
    x0, y0, x1, y1 = bbox(ring)
    dx, dy = max(x0, 0.0, -x1), max(y0, 0.0, -y1)
    return math.hypot(dx, dy) <= radius_m


# --------------------------------------------------------------------------- overlaying the two sources

def _samples(poly: dict, n: int = 7) -> list[tuple[float, float]]:
    """A grid of points inside a polygon (its bounding box sampled n x n, kept when inside), plus its first vertices if it is thin."""
    ring = [tuple(q) for q in poly["ring"]]
    holes = [[tuple(q) for q in h] for h in poly.get("holes") or []]
    x0, y0, x1, y1 = bbox(ring)
    pts = [(x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n) for i in range(n) for j in range(n)]
    pts = [p for p in pts if point_in_poly(p[0], p[1], ring, holes)]
    return pts or [((x0 + x1) / 2, (y0 + y1) / 2)]


def inside_any(x: float, y: float, polys: list[dict]) -> bool:
    for p in polys:
        x0, y0, x1, y1 = p["_bb"]
        if x0 <= x <= x1 and y0 <= y <= y1 and point_in_poly(x, y, p["_ring"], p["_holes"]):
            return True
    return False


def prep(polys: list[dict]) -> list[dict]:
    return [{"_bb": bbox([tuple(q) for q in p["ring"]]), "_ring": [tuple(q) for q in p["ring"]],
             "_holes": [[tuple(q) for q in h] for h in p.get("holes") or []]} for p in polys]


def cover(poly: dict, others: list[dict]) -> float:
    """The share (0-1) of ``poly`` that lies inside the union of ``others`` (sampled on a grid)."""
    if not others:
        return 0.0
    pts = _samples(poly)
    prepared = prep(others)
    return sum(1 for x, y in pts if inside_any(x, y, prepared)) / len(pts)



def merge_polys(osm_polys: list[dict], nyc_polys: list[dict]) -> list[dict]:
    """Lay the city polygons over the OpenStreetMap ones (see the module docstring); returns one list, largest first."""
    paved = [p for p in nyc_polys if p.get("hard") and p.get("cat") != "Waterfront Facility"]
    parks_like = [p for p in nyc_polys if p["src"] in ("parks", "greenstreet")]
    out: list[dict] = []
    for p in osm_polys:
        q = {k: v for k, v in p.items() if k != "inv"}
        if q.get("why", "").startswith("NYC Parks"):       # a flag from an earlier run: recompute from scratch
            q.pop("why", None)
            q.pop("hard", None)
        if not q.get("hard") and q["kind"] in ("park", "wood") and not q.get("lawn") and cover(q, paved) >= COVER_MIN:
            q["hard"] = 1
            q["why"] = "NYC Parks property is a playground, court or field"
        out.append(q)
    out.extend(nyc_polys)
    # which polygons stand on NYC Parks property: the Parks inventory is complete there
    for q in out:
        if q.get("src") in ("parks", "greenstreet") or cover(q, parks_like) >= COVER_MIN:
            q["on_parks"] = 1
    out.sort(key=lambda q: -abs(ring_area(q["ring"])))
    return out[:MAX_TOTAL]


def strip_nyc(polys: list[dict]) -> list[dict]:
    """The OpenStreetMap polygons of an existing ``green`` block, without the city ones and the flags this module adds."""
    out = []
    for p in polys:
        if p.get("src") in ("parks", "greenstreet"):
            continue
        q = {k: v for k, v in p.items() if k not in ("inv", "on_parks")}
        if str(q.get("why", "")).startswith("NYC Parks"):
            q.pop("why", None)
            q.pop("hard", None)
        out.append(q)
    return out


def fetch_parks(lat: float, lon: float, radius_m: float = 600, cache_dir: Path | None = None,
                refresh: bool = False) -> list[dict]:
    """Parks Properties and Greenstreets polygons around a point, in local metres (cached Socrata downloads)."""
    frame = LocalFrame(lat, lon)
    margin = radius_m + 60
    rows = socrata(PARKS, parks_query(lat, lon, margin), cache_dir, refresh=refresh)
    polys = parse_parks(rows, frame, radius_m)
    try:
        gs = socrata(GREENSTREETS, greenstreets_query(lat, lon, margin), cache_dir, refresh=refresh)
    except RuntimeError:
        gs = []
    polys += parse_greenstreets(gs, frame, radius_m)
    return polys
