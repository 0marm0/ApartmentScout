"""`apartmentscout places`: street, park and neighbourhood geometry for plain-language search.

    apartmentscout places [--refresh]      write <search>/places.json (the dashboard build copies it)

The geometry covers the area of the search's listings and destinations plus a margin. It comes from OpenStreetMap
(streets, parks) and, where the city profile names one, an open neighbourhood dataset; responses are cached under
<search>/cache/. See apartmentscout/geo/places.py for the file layout and docs/guides/dashboard.md for what the
search box understands.
"""
from __future__ import annotations

import argparse
import sys

from ..quality.workspace import load_listings, search_from


def study_bbox(ws, crit: dict) -> tuple[float, float, float, float]:
    """(lon0, lat0, lon1, lat1) of the geocoded, still-open listings and the destinations."""
    pts = [(L["lat"], L["lon"]) for L in load_listings(ws) if L.get("lat") is not None and L.get("status") != "gone"]
    pts += [(d["lat"], d["lon"]) for d in (crit.get("commute") or {}).get("destinations") or [] if d.get("lat") is not None]
    if not pts:
        sys.exit("No geocoded listings or destinations to size the map data from. Run `apartmentscout geocode` first.")
    lats, lons = [p[0] for p in pts], [p[1] for p in pts]
    return min(lons), min(lats), max(lons), max(lats)


def cmd_places(args: argparse.Namespace) -> None:
    from ..cli import city_profile
    from ..geo.places import build_places, write_places
    ws = search_from(args)
    crit = ws.criteria()
    city = (crit.get("search") or {}).get("city")
    print("Building street, park and neighbourhood geometry ...", flush=True)
    doc = build_places(study_bbox(ws, crit), city_profile(city), ws.cache_dir / "places", city,
                       refresh=getattr(args, "refresh", False), log=lambda *a: print(*a, flush=True))
    out = ws.root / "places.json"
    n = write_places(doc, out)
    print(f"Wrote {out}  ({n / 1024:.0f} KB: {len(doc['streets'])} streets, "
          f"{sum(a['kind'] == 'park' for a in doc['areas'])} parks, {sum(a['kind'] == 'hood' for a in doc['areas'])} "
          f"neighbourhoods, {len(doc['groups'])} groups)")


def register(add) -> None:
    s = add("places", cmd_places, "street, park and neighbourhood geometry for plain-language place filters "
                                  "(east of 3rd Ave, near Bryant Park, in Murray Hill)")
    s.add_argument("--refresh", action="store_true", help="ignore cached downloads")
