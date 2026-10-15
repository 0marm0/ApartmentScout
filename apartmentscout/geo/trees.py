"""Street trees around a site from the NYC Street Tree Census, as compact points with a trunk diameter.

OpenStreetMap maps only a few percent of the street trees (a Midtown site has 100-300 mapped trees where the
census counts 800-2,000), so the 3D views looked bare. For New York the city's own census is a far better source:
NYC Parks' *2015 Street Tree Census* (NYC Open Data ``uvpi-gqnh``) surveyed every street tree, with its trunk
diameter at breast height (DBH, inches), species and condition. It is read through the same cached, receipted
Socrata helper as the footprints, so a re-run does not hit the network.

Site JSON ``green["census"]``::

    {"source": "NYC Street Tree Census 2015 (NYC Parks, uvpi-gqnh)", "dataset": "uvpi-gqnh", "date": "2015",
     "fetched": "2026-10-14", "q_m": 0.5, "groups": ["other", "plane", ...], "n": 1796,
     "pts": [x, y, dbh_in, group, x, y, dbh_in, group, ...], "note": "..."}

``x`` and ``y`` are integer multiples of ``q_m`` metres (east, north) in the same local frame as the footprints,
``dbh_in`` is the trunk diameter in whole inches (1-60) and ``group`` indexes ``groups`` (a crown-colour class
taken from the genus). Only live trees within the site radius are kept, nearest first, capped at ``MAX_TREES``.

Canopy size is NOT stored: the 3D views derive it from the diameter with the allometry below (``crown_radius_m``,
``tree_height_m``), so one rule serves the dashboard and the tests. It is the usual urban-forestry shape of the
relationship (crown spread and height grow with DBH, then level off), fitted to rounded typical values for open-grown
urban trees from urban-forestry crown tables (the i-Tree urban tree database, McPherson et al.): roughly a 4.5 m crown
and 7.5 m height for a Callery pear of 8 in, 7.5 m and 12 m for a honeylocust of 12 in, 13.5 m and 18 m for a London
plane of 24 in. The census records no crown size, so this is a typical value, not a per-tree measurement:

* crown diameter = 1.2 m + 0.19 m per cm of DBH, capped at 16 m (a 20 cm / 8 in trunk carries a ~5 m crown, a 30 cm /
  12 in trunk ~7 m, a 61 cm / 24 in trunk ~12.8 m);
* height = 1.3 m + 0.62 x DBH(cm)^0.82, capped at 24 m (a 20 cm trunk is ~8.5 m tall, a 30 cm trunk ~11.5 m, a 61 cm trunk ~19 m).

An earlier rule (2.0 m + 0.24 m/cm, +2 in of growth) drew street crowns 35-45 % too wide (about twice the crown area); its growth term was also double what the data shows (below).

The census is from 2015. Comparing 1,195 census trees of a Midtown site with the same trees in the live NYC Parks
inventory (``geo/forestry.py``), the trunk grew by a median of 1.0 in (mean 0.85 in, 10th-90th percentile 0-3 in) in
about a decade, so the views size a census tree from its surveyed diameter plus ``GROWTH_IN`` (1 in):
``grown_dbh_in``. Mapped OpenStreetMap trees carry no size and are drawn as a typical street tree (``MAPPED_DBH_IN``,
in the 3D code). Census trees the current inventory records as removed are dropped (``geo/forestry.prune_census``).

Trees are context only: they are never counted as obstructions in the sun hours (canopies are seasonal and porous).
"""
from __future__ import annotations

import datetime as dt
import math
from pathlib import Path

from . import LocalFrame
from .fetch import socrata

DATASET = "uvpi-gqnh"
SOURCE = "NYC Street Tree Census 2015 (NYC Parks, uvpi-gqnh)"
DATE = "2015"
Q_M = 0.5            # coordinates are integer multiples of this many metres
MAX_TREES = 6000
MAX_DBH_IN = 60      # larger values in the census are data-entry errors for street trees
GROWTH_IN = 1.0      # median trunk growth between the 2015 survey and the live inventory (1,195 matched trees, ~10 years)
CM_PER_IN = 2.54
CROWN_BASE_M, CROWN_PER_CM, CROWN_MAX_M = 1.2, 0.19, 16.0
HEIGHT_BASE_M, HEIGHT_COEF, HEIGHT_EXP, HEIGHT_MAX_M = 1.3, 0.62, 0.82, 24.0
NOTE = ("Context only: street trees are drawn from the NYC Street Tree Census (2015) and are not counted as "
        "obstructions in the sun hours (canopies are seasonal and porous). Canopy size is estimated from trunk "
        "diameter; the census does not record crown size.")

# crown-colour classes by genus; the index is what the site file stores
GROUPS = ("other", "plane", "oak", "maple", "locust", "linden", "ornamental", "elm", "ginkgo", "conifer")
_GENUS = {
    "platanus": "plane",
    "quercus": "oak",
    "acer": "maple",
    "gleditsia": "locust", "styphnolobium": "locust", "sophora": "locust", "gymnocladus": "locust", "robinia": "locust",
    "albizia": "locust",
    "tilia": "linden",
    "pyrus": "ornamental", "prunus": "ornamental", "malus": "ornamental", "cercis": "ornamental",
    "cornus": "ornamental", "magnolia": "ornamental", "crataegus": "ornamental", "amelanchier": "ornamental",
    "syringa": "ornamental", "lagerstroemia": "ornamental", "koelreuteria": "ornamental",
    "ulmus": "elm", "zelkova": "elm", "celtis": "elm",
    "ginkgo": "ginkgo",
    "pinus": "conifer", "picea": "conifer", "thuja": "conifer", "cedrus": "conifer", "juniperus": "conifer",
    "taxodium": "conifer", "metasequoia": "conifer", "tsuga": "conifer", "abies": "conifer", "chamaecyparis": "conifer",
}


def species_group(latin: str | None) -> int:
    """Index into ``GROUPS`` for a Latin name ("Platanus x acerifolia" -> plane); unknown or blank -> ``other``."""
    genus = (latin or "").strip().split(" ")[0].lower() if latin else ""
    name = _GENUS.get(genus, "other")
    return GROUPS.index(name)


def crown_radius_m(dbh_in: float) -> float:
    """Crown radius in metres from trunk diameter in inches (see the module docstring)."""
    cm = max(0.0, float(dbh_in)) * CM_PER_IN
    return min(CROWN_MAX_M, CROWN_BASE_M + CROWN_PER_CM * cm) / 2.0


def tree_height_m(dbh_in: float) -> float:
    """Tree height in metres from trunk diameter in inches (see the module docstring)."""
    cm = max(0.0, float(dbh_in)) * CM_PER_IN
    return min(HEIGHT_MAX_M, HEIGHT_BASE_M + HEIGHT_COEF * cm ** HEIGHT_EXP)


def grown_dbh_in(dbh_in: float) -> float:
    """The surveyed trunk diameter plus the growth since the 2015 survey (what the views size the crown from)."""
    return max(0.0, float(dbh_in)) + GROWTH_IN


def census_query(lat: float, lon: float, radius_m: float) -> dict:
    """The Socrata parameters for live trees in the bounding box of a circle (the circle is applied on parse)."""
    dlat = radius_m / 110574.0
    dlon = radius_m / (111320.0 * math.cos(math.radians(lat)))
    where = (f"status='Alive' AND latitude between {lat - dlat:.6f} and {lat + dlat:.6f} "
             f"AND longitude between {lon - dlon:.6f} and {lon + dlon:.6f}")
    return {"$where": where, "$select": "latitude,longitude,tree_dbh,spc_latin", "$limit": 50000}


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def parse_census(rows: list[dict], frame: LocalFrame, radius_m: float, fetched: str | None = None,
                 max_trees: int = MAX_TREES) -> dict:
    """Census rows -> the compact ``census`` block (see the module docstring)."""
    kept: list[tuple[float, int, int, int, int]] = []
    seen: set[tuple[int, int]] = set()
    for r in rows:
        lat, lon = _num(r.get("latitude")), _num(r.get("longitude"))
        if lat is None or lon is None:
            continue
        x, y = frame.to_xy(lon, lat)
        d = math.hypot(x, y)
        if d > radius_m:
            continue
        qx, qy = round(x / Q_M), round(y / Q_M)
        if (qx, qy) in seen:        # the census holds a few duplicate points at one spot
            continue
        seen.add((qx, qy))
        dbh = _num(r.get("tree_dbh"))
        dbh_i = int(min(MAX_DBH_IN, max(1, round(dbh)))) if dbh is not None else 6
        kept.append((d, qx, qy, dbh_i, species_group(r.get("spc_latin"))))
    kept.sort()
    kept = kept[:max_trees]
    pts = [v for _, qx, qy, dbh, grp in kept for v in (qx, qy, dbh, grp)]
    return {"source": SOURCE, "dataset": DATASET, "date": DATE, "fetched": fetched or dt.date.today().isoformat(),
            "q_m": Q_M, "groups": list(GROUPS), "n": len(kept), "pts": pts, "note": NOTE}


def fetch_census(lat: float, lon: float, radius_m: float = 600, cache_dir: Path | None = None,
                 refresh: bool = False) -> dict:
    """Live street trees around a point in local metres (cached Socrata download; New York only)."""
    rows = socrata(DATASET, census_query(lat, lon, radius_m), cache_dir, refresh=refresh)
    return parse_census(rows, LocalFrame(lat, lon), radius_m)


def census_stats(block: dict) -> dict:
    """Counts and the share of ground the crowns cover (for the build log and the site note)."""
    pts = block.get("pts") or []
    n = len(pts) // 4
    area = sum(math.pi * crown_radius_m(pts[4 * i + 2]) ** 2 for i in range(n))
    return {"n": n, "crown_m2": round(area)}
