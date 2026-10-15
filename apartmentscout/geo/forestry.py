"""The NYC Parks Forestry Tree Points inventory around a site: the trees inside parks and on park property.

The Street Tree Census (``geo/trees.py``) records curbside trees only. NYC Parks' *Forestry Tree Points* (NYC Open Data
``hn5i-inap``, the ForMS 2.0 inventory, updated continuously) is the city's live inventory of every tree it manages:
the street trees and the trees inside parks and on park property, each with a trunk diameter (DBH, inches), species,
structure and condition. It has no park/street flag, so this module sorts the points itself and joins them to the census:

* **live** points are ``tpstructure = 'Full'`` that are not ``tpcondition = 'Dead'``; ``Retired``, ``Stump`` and dead
  points are trees the city has since removed;
* a live point within ``MATCH_M`` (3 m) of a census tree is *that* tree: dropped here (the census already draws it);
* of the rest, a point standing inside a park polygon (Parks Properties, Greenstreets or OpenStreetMap) is a **park tree**
  (``loc`` 0); one outside every park polygon is a **street tree planted since the census** (``loc`` 1);
* a census tree with a removed point within ``MATCH_M`` and no live point is gone: ``prune_census`` drops it, so the
  street trees are those the city still lists.

Site JSON ``green["forestry"]``::

    {"source": "NYC Parks Forestry Tree Points (hn5i-inap)", "dataset": "hn5i-inap", "date": "2026-10-07", "fetched": ...,
     "q_m": 0.5, "groups": [...], "n": 940, "n_park": 610, "n_street": 330,
     "pts": [x, y, dbh_in, group, loc, x, y, dbh_in, group, loc, ...], "note": "..."}

``x``, ``y`` are integer multiples of ``q_m`` metres in the footprints' local frame, ``dbh_in`` whole inches (1-60),
``group`` indexes ``groups`` (same crown-colour classes as the census), ``loc`` is 0 park / 1 street. Parks inventory
trees are sized from their *current* diameter (the inventory is live): no growth is added, unlike the 2015 census.
"""
from __future__ import annotations

import datetime as dt
import math
from pathlib import Path

from . import LocalFrame
from .fetch import rows_updated, socrata
from .parks import inside_any, prep
from .trees import GROUPS, MAX_DBH_IN, Q_M, species_group

DATASET = "hn5i-inap"
SOURCE = "NYC Parks Forestry Tree Points (NYC Open Data, hn5i-inap)"
MATCH_M = 3.0          # two points this close are one tree (GPS error of both surveys is of that order)
EDGE_M = 60.0          # live trees are kept this far past the site radius, so a park that straddles the edge is not drawn as empty (the views draw to 640 m)
MAX_TREES = 6000
GONE_STRUCTURES = {"retired", "stump", "stump - uprooted"}
NOTE = ("Context only: park trees are drawn from the NYC Parks forestry inventory and are not counted as obstructions "
        "in the sun hours. Canopy size is estimated from trunk diameter; the inventory does not record crown size.")


def forestry_query(lat: float, lon: float, radius_m: float) -> dict:
    """Socrata parameters for every tree point in the box around a point (live and removed: removed ones prune the census)."""
    dlat = radius_m / 110574.0
    dlon = radius_m / (111320.0 * math.cos(math.radians(lat)))
    where = f"within_box(location, {lat - dlat:.6f}, {lon - dlon:.6f}, {lat + dlat:.6f}, {lon + dlon:.6f})"
    return {"$where": where, "$select": "dbh,tpstructure,tpcondition,genusspecies,location", "$limit": 50000}


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _lonlat(r: dict) -> tuple[float, float] | None:
    loc = r.get("location")
    c = loc.get("coordinates") if isinstance(loc, dict) else None
    if isinstance(c, (list, tuple)) and len(c) >= 2:
        lon, lat = _num(c[0]), _num(c[1])
        if lon is not None and lat is not None:
            return lon, lat
    return None


def is_live(r: dict) -> bool:
    return str(r.get("tpstructure") or "").strip().lower() == "full" and str(r.get("tpcondition") or "").strip().lower() != "dead"


def is_gone(r: dict) -> bool:
    return str(r.get("tpstructure") or "").strip().lower() in GONE_STRUCTURES or (
        str(r.get("tpcondition") or "").strip().lower() == "dead")


class _Grid:
    """Points bucketed on a grid, for 'is there one within r metres' and 'the nearest one'."""

    def __init__(self, cell: float = 6.0):
        self.cell = cell
        self.g: dict[tuple[int, int], list[tuple[float, float, int]]] = {}

    def add(self, x: float, y: float, i: int) -> None:
        self.g.setdefault((int(x // self.cell), int(y // self.cell)), []).append((x, y, i))

    def nearest(self, x: float, y: float, r: float, skip: set[int] | None = None) -> tuple[int, float] | None:
        cx, cy, best = int(x // self.cell), int(y // self.cell), None
        for i in range(cx - 1, cx + 2):
            for j in range(cy - 1, cy + 2):
                for px, py, k in self.g.get((i, j), ()):
                    if skip and k in skip:
                        continue
                    d = math.hypot(px - x, py - y)
                    if d < r and (best is None or d < best[1]):
                        best = (k, d)
        return best


def read_points(rows: list[dict], frame: LocalFrame, radius_m: float) -> tuple[list[dict], list[tuple[float, float]]]:
    """Rows -> (live trees [{x, y, dbh, grp}] within the radius plus ``EDGE_M``, positions of removed trees)."""
    live: list[dict] = []
    gone: list[tuple[float, float]] = []
    for r in rows:
        ll = _lonlat(r)
        if ll is None:
            continue
        x, y = frame.to_xy(*ll)
        if math.hypot(x, y) > radius_m + EDGE_M:
            continue
        if is_live(r):
            dbh = _num(r.get("dbh"))
            dbh_i = int(min(MAX_DBH_IN, max(1, round(dbh)))) if dbh is not None else 6
            latin = str(r.get("genusspecies") or "").split(" - ")[0]
            live.append({"x": x, "y": y, "dbh": dbh_i, "grp": species_group(latin)})
        elif is_gone(r):
            gone.append((x, y))
    return live, gone


def prune_census(block: dict, live: list[dict], gone: list[tuple[float, float]]) -> dict:
    """The census block without the trees the current inventory records as removed (no live point within ``MATCH_M``).

    ``removed`` on the result counts the dropped trees; the census's own number ``n`` is the trees kept.
    """
    q = float(block.get("q_m") or Q_M)
    pts = block.get("pts") or []
    live_g, gone_g = _Grid(), _Grid()
    for i, t in enumerate(live):
        live_g.add(t["x"], t["y"], i)
    for i, (x, y) in enumerate(gone):
        gone_g.add(x, y, i)
    kept: list = []
    removed = 0
    for i in range(len(pts) // 4):
        x, y = pts[4 * i] * q, pts[4 * i + 1] * q
        if live_g.nearest(x, y, MATCH_M) is None and gone_g.nearest(x, y, MATCH_M) is not None:
            removed += 1
            continue
        kept.extend(pts[4 * i: 4 * i + 4])
    out = {**block, "pts": kept, "n": len(kept) // 4, "removed": removed}
    out["note"] = (block.get("note") or "") + (f" {removed} census trees that the current NYC Parks inventory lists as "
                                               "removed (stump, retired or dead) are left out." if removed else "")
    return out


def parse_forestry(live: list[dict], census_pts: list[tuple[float, float]], polys: list[dict], radius_m: float,
                   fetched: str | None = None, rows_updated_at: str | None = None, max_trees: int = MAX_TREES) -> dict:
    """Live inventory trees -> the compact ``forestry`` block, deduped against the (pruned) census (see the module docstring).

    ``census_pts`` are the census trees' local positions in metres; ``polys`` the ``green["polys"]`` (any kind) that decide
    park (inside one) or street (outside all).
    """
    cen = _Grid()
    for i, (x, y) in enumerate(census_pts):
        cen.add(x, y, i)
    matched: set[int] = set()
    kept: list[tuple[float, int, int, int, int, int]] = []     # (distance, qx, qy, dbh, group, loc)
    prepared = prep(polys)
    seen: set[tuple[int, int]] = set()
    for t in sorted(live, key=lambda t: math.hypot(t["x"], t["y"])):
        hit = cen.nearest(t["x"], t["y"], MATCH_M, matched)
        if hit is not None:                       # the same tree as a census one (each census tree absorbs one point)
            matched.add(hit[0])
            continue
        qx, qy = round(t["x"] / Q_M), round(t["y"] / Q_M)
        if (qx, qy) in seen:
            continue
        seen.add((qx, qy))
        loc = 0 if inside_any(t["x"], t["y"], prepared) else 1
        kept.append((math.hypot(t["x"], t["y"]), qx, qy, t["dbh"], t["grp"], loc))
    kept.sort()
    kept = kept[:max_trees]
    pts = [v for _, qx, qy, dbh, grp, loc in kept for v in (qx, qy, dbh, grp, loc)]
    n_park = sum(1 for k in kept if k[5] == 0)
    return {"source": SOURCE, "dataset": DATASET, "date": (rows_updated_at or "")[:10] or None,
            "fetched": fetched or dt.date.today().isoformat(), "q_m": Q_M, "groups": list(GROUPS), "n": len(kept),
            "n_park": n_park, "n_street": len(kept) - n_park, "matched_census": len(matched), "pts": pts, "note": NOTE}


def census_positions(block: dict) -> list[tuple[float, float]]:
    q = float(block.get("q_m") or Q_M)
    p = block.get("pts") or []
    return [(p[4 * i] * q, p[4 * i + 1] * q) for i in range(len(p) // 4)]


def count_in_polys(block: dict, polys: list[dict]) -> None:
    """Set ``inv`` on every polygon that stands on NYC Parks property: the living inventory trees (forestry park trees plus
    census trees) inside it, which the 3D views use to decide where the canopy fill is not needed."""
    q = float(block.get("q_m") or Q_M)
    p = block.get("pts") or []
    pts = [(p[5 * i] * q, p[5 * i + 1] * q) for i in range(len(p) // 5) if p[5 * i + 4] == 0]
    for poly in polys:
        if not poly.get("on_parks"):
            continue
        one = prep([poly])
        poly["inv"] = sum(1 for x, y in pts if inside_any(x, y, one))


def fetch_rows(lat: float, lon: float, radius_m: float = 600, cache_dir: Path | None = None,
               refresh: bool = False) -> tuple[list[dict], str | None]:
    """The raw tree-point rows around a point (cached Socrata download) and the dataset's 'rows updated' date."""
    rows = socrata(DATASET, forestry_query(lat, lon, radius_m + EDGE_M + 20), cache_dir, refresh=refresh)
    return rows, rows_updated(DATASET, cache_dir)
