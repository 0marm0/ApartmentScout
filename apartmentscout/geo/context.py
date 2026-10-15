"""The city context the 3D views draw around a site, assembled from its separate sources.

* ``green``: parks, lawns and mapped trees from OpenStreetMap (``geo/green.py``) plus, for New York, NYC Parks
  Properties and Greenstreets polygons (``geo/parks.py``), the street trees of the NYC Street Tree Census with their
  trunk diameters (``geo/trees.py``) and the NYC Parks Forestry Tree Points: trees in parks and street trees planted
  since the census (``geo/forestry.py``);
* ``water``: rivers, harbour and ponds (``geo/water.py``).

Each source fails on its own: an unreachable Overpass leaves the census trees, a missing water dataset leaves the
parks. Context only, none of it enters the sun or view numbers. Used by ``make_site`` and by ``apartmentscout site
<id> --green-only`` / ``--context-only`` (``geo/site.py``).
"""
from __future__ import annotations

from typing import Callable

from . import LocalFrame
from . import forestry as forestry_mod
from . import green as green_mod
from . import parks as parks_mod
from . import trees as trees_mod
from . import water as water_mod


def build_green(lat: float, lon: float, radius: float, city: str | None, cache_dir=None, refresh: bool = False,
                say: Callable[..., None] = lambda *a: None, census: bool = True, keep: dict | None = None) -> dict | None:
    """The ``green`` block: OpenStreetMap parks and trees, plus in New York the city's own layers. None if nothing loaded.

    New York adds, each failing on its own: NYC Parks Properties and Greenstreets polygons (``geo/parks.py``), the Street
    Tree Census (``geo/trees.py``) pruned of the trees the current inventory lists as removed, and the NYC Parks Forestry
    Tree Points (``geo/forestry.py``): park trees, and street trees planted since the census.

    ``keep``: an existing ``green`` block whose OpenStreetMap parks and trees are kept as they are (no Overpass call),
    so only the city layers are added or refreshed (``--keep-osm``; Overpass is slow and rate-limited).
    """
    block = None
    if keep is not None and keep.get("polys") is not None:
        block = {k: v for k, v in keep.items() if k not in ("census", "forestry")}
        block["counts"] = {k: v for k, v in (keep.get("counts") or {}).items()
                           if k not in ("census_trees", "forestry_trees", "parks_polys", "greenstreet_polys", "census_removed")}
        block["polys"] = parks_mod.strip_nyc(block["polys"])
    else:
        try:
            block = green_mod.fetch_green(lat, lon, radius, cache_dir, refresh)
        except RuntimeError as e:
            say(f"  green space unavailable: {e}")
    if city == "nyc":
        block = _nyc_layers(block, lat, lon, radius, cache_dir, refresh, say, census)
    if block is None:
        return None
    gc = block["counts"]
    say(f"  green space: {gc['polys']} parks / lawns, {gc['trees']} mapped trees"
        + (f", {gc['census_trees']} street trees from the census" if "census_trees" in gc else "")
        + (f", {gc['forestry_trees']} from the Parks inventory" if "forestry_trees" in gc else ""))
    return block


def _nyc_layers(block: dict | None, lat: float, lon: float, radius: float, cache_dir, refresh: bool, say,
                census: bool) -> dict | None:
    """Add the New York city layers to a ``green`` block (or to an empty one): see ``build_green``."""
    frame = LocalFrame(lat, lon)
    nyc: list[dict] = []
    try:
        nyc = parks_mod.fetch_parks(lat, lon, radius, cache_dir, refresh)
    except RuntimeError as e:
        say(f"  NYC Parks properties unavailable: {e}")
    c = None
    if census:
        try:
            c = trees_mod.fetch_census(lat, lon, radius, cache_dir, refresh)
        except RuntimeError as e:
            say(f"  street tree census unavailable: {e}")
    live: list[dict] = []
    gone: list[tuple[float, float]] = []
    updated = None
    try:
        rows, updated = forestry_mod.fetch_rows(lat, lon, radius, cache_dir, refresh)
        live, gone = forestry_mod.read_points(rows, frame, radius)
    except RuntimeError as e:
        say(f"  NYC Parks tree inventory unavailable: {e}")
    if block is None and not (nyc or c or live):
        return None
    block = block or green_mod.empty_green(radius)
    block["polys"] = parks_mod.merge_polys(block.get("polys") or [], nyc)
    counts = block["counts"]
    counts["polys"] = len(block["polys"])
    if nyc:
        counts["parks_polys"] = sum(1 for p in nyc if p["src"] == "parks")
        counts["greenstreet_polys"] = sum(1 for p in nyc if p["src"] == "greenstreet")
    if c is not None:
        if live or gone:
            c = forestry_mod.prune_census(c, live, gone)
            counts["census_removed"] = c.get("removed", 0)
        block["census"] = c
        counts["census_trees"] = c["n"]
    if live:
        f = forestry_mod.parse_forestry(live, forestry_mod.census_positions(c) if c else [], block["polys"], radius,
                                        rows_updated_at=updated)
        forestry_mod.count_in_polys(f, block["polys"])
        block["forestry"] = f
        counts["forestry_trees"] = f["n"]
    return block


def build_water(lat: float, lon: float, city: str | None, cache_dir=None, refresh: bool = False,
                say: Callable[..., None] = lambda *a: None) -> dict | None:
    """The ``water`` block, or None when there is no water in the window or the sources are unreachable."""
    try:
        w = water_mod.fetch_water(lat, lon, city, water_mod.HALF_M, cache_dir, refresh)
    except RuntimeError as e:
        say(f"  water unavailable: {e}")
        return None
    c = w["counts"]
    say(f"  water: {c['polys']} water bodies, {c['points']} shoreline points"
        + (f" ({', '.join(lb['name'] for lb in w['labels'])})" if w["labels"] else ""))
    return w if w["polys"] else None
