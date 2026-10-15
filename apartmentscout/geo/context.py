"""The city context the 3D views draw around a site, assembled from its separate sources.

* ``green``: parks, lawns and mapped trees from OpenStreetMap (``geo/green.py``) plus, for New York, the street trees
  of the NYC Street Tree Census with their trunk diameters (``geo/trees.py``);
* ``water``: rivers, harbour and ponds (``geo/water.py``).

Each source fails on its own: an unreachable Overpass leaves the census trees, a missing water dataset leaves the
parks. Context only, none of it enters the sun or view numbers. Used by ``make_site`` and by ``apartmentscout site
<id> --green-only`` / ``--context-only`` (``geo/site.py``).
"""
from __future__ import annotations

from typing import Callable

from . import green as green_mod
from . import trees as trees_mod
from . import water as water_mod


def build_green(lat: float, lon: float, radius: float, city: str | None, cache_dir=None, refresh: bool = False,
                say: Callable[..., None] = lambda *a: None, census: bool = True, keep: dict | None = None) -> dict | None:
    """The ``green`` block: OpenStreetMap parks and trees, plus the census trees in New York. None if nothing loaded.

    ``keep``: an existing ``green`` block whose OpenStreetMap parks and trees are kept as they are (no Overpass call),
    so only the census is added or refreshed (``--keep-osm``; Overpass is slow and rate-limited).
    """
    block = None
    if keep is not None and keep.get("polys") is not None:
        block = {k: v for k, v in keep.items() if k != "census"}
        block["counts"] = {k: v for k, v in (keep.get("counts") or {}).items() if k != "census_trees"}
    else:
        try:
            block = green_mod.fetch_green(lat, lon, radius, cache_dir, refresh)
        except RuntimeError as e:
            say(f"  green space unavailable: {e}")
    if census and city == "nyc":
        try:
            c = trees_mod.fetch_census(lat, lon, radius, cache_dir, refresh)
        except RuntimeError as e:
            say(f"  street tree census unavailable: {e}")
        else:
            block = block or green_mod.empty_green(radius)
            block["census"] = c
            block["counts"]["census_trees"] = c["n"]
    if block is None:
        return None
    gc = block["counts"]
    say(f"  green space: {gc['polys']} parks / lawns, {gc['trees']} mapped trees"
        + (f", {gc['census_trees']} street trees from the census" if "census_trees" in gc else ""))
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
