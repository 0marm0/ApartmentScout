"""Street centrelines around a site, for orientation (which street does the window face?).

* NYC: CSCL Street Centerline (NYC Open Data ``inkn-q76z``), the city's official roadbed
  centreline with ``stname_label`` and ``streetwidth`` (feet). Only constructed (status 2),
  street-level roadways are kept; tunnels, ferry routes, paths and non-physical segments are dropped.
* Elsewhere: OpenStreetMap ``highway=*`` ways from Overpass, with ``width`` when tagged.

Lines are centrelines, not street edges or kerbs.
"""
from __future__ import annotations

import math
from pathlib import Path

from . import LocalFrame
from .fetch import overpass, socrata

FT = 0.3048
# CSCL roadway types: 1 street, 2 highway, 3 bridge, 9 ramp, 10 alley, 13 U-turn
CSCL_KEEP = {"1", "2", "3", "9", "10", "13"}
OSM_KEEP = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
            "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
            "pedestrian"}


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


def _lines(geom: dict) -> list[list]:
    if not geom:
        return []
    if geom.get("type") == "LineString":
        return [geom.get("coordinates") or []]
    if geom.get("type") == "MultiLineString":
        return geom.get("coordinates") or []
    return []


def _clip(pts: list[tuple[float, float]], r: float) -> list[tuple[float, float]]:
    """Keep the run of points from the first to the last vertex within r (plus one either side)."""
    inside = [k for k, (x, y) in enumerate(pts) if math.hypot(x, y) <= r]
    if not inside:
        return []
    a, b = max(0, inside[0] - 1), min(len(pts), inside[-1] + 2)
    return pts[a:b]


def _title(name: str) -> str:
    s = " ".join(str(name).split())
    return s.title() if s.isupper() else s


def parse_cscl(rows: list[dict], frame: LocalFrame, radius_m: float) -> list[dict]:
    out = []
    for r in rows:
        if str(r.get("status", "2")) != "2" or str(r.get("rw_type", "1")) not in CSCL_KEEP:
            continue
        lv = {str(r.get("from_level_code") or "13"), str(r.get("to_level_code") or "13")}
        if all(v.isdigit() and int(v) < 13 for v in lv):
            continue  # below grade
        w = _num(r.get("streetwidth"))
        name = r.get("stname_label") or r.get("full_street_name") or None
        for line in _lines(r.get("the_geom") or {}):
            pts = _clip([frame.to_xy(p[0], p[1]) for p in line], radius_m)
            if len(pts) >= 2:
                out.append({"name": _title(name) if name else None,
                            "pts": [[round(x, 1), round(y, 1)] for x, y in pts],
                            "width_m": round(w * FT, 1) if w else None})
    return _merge(out)


def parse_osm_streets(els: list[dict], frame: LocalFrame, radius_m: float) -> list[dict]:
    out = []
    for e in els:
        tags = e.get("tags", {})
        if e.get("type") != "way" or tags.get("highway") not in OSM_KEEP or tags.get("tunnel") in ("yes", "building_passage"):
            continue
        pts = _clip([frame.to_xy(p["lon"], p["lat"]) for p in e.get("geometry") or []], radius_m)
        if len(pts) < 2:
            continue
        w = _num(str(tags.get("width", "")).replace("m", "").strip())
        out.append({"name": tags.get("name"), "pts": [[round(x, 1), round(y, 1)] for x, y in pts],
                    "width_m": round(w, 1) if w else None})
    return _merge(out)


def _merge(segs: list[dict], tol: float = 0.6) -> list[dict]:
    """Join consecutive segments of the same street end to end (fewer, longer polylines)."""
    pool = list(segs)
    out = []
    while pool:
        cur = pool.pop(0)
        grown = True
        while grown:
            grown = False
            for k, s in enumerate(pool):
                if s["name"] != cur["name"] or s["width_m"] != cur["width_m"]:
                    continue
                a, b = cur["pts"], s["pts"]
                if math.dist(a[-1], b[0]) <= tol:
                    cur = {**cur, "pts": a + b[1:]}
                elif math.dist(b[-1], a[0]) <= tol:
                    cur = {**cur, "pts": b + a[1:]}
                else:
                    continue
                pool.pop(k)
                grown = True
                break
        out.append(cur)
    return out


def fetch_streets(lat: float, lon: float, radius_m: float, city: str | None, cache_dir: Path | None = None,
                  refresh: bool = False) -> tuple[list[dict], str]:
    """(streets in local metres, source label). Falls back to OSM when NYC data is unavailable."""
    frame = LocalFrame(lat, lon)
    if city == "nyc":
        dlat = radius_m / 110574.0
        dlon = radius_m / (111320.0 * math.cos(math.radians(lat)))
        poly = (f"POLYGON(({lon - dlon} {lat - dlat},{lon + dlon} {lat - dlat},{lon + dlon} {lat + dlat},"
                f"{lon - dlon} {lat + dlat},{lon - dlon} {lat - dlat}))")
        sel = "the_geom,stname_label,full_street_name,streetwidth,rw_type,status,from_level_code,to_level_code"
        try:
            rows = socrata("inkn-q76z", {"$where": f"intersects(the_geom,'{poly}')", "$select": sel, "$limit": 5000},
                           cache_dir, refresh=refresh)
            return parse_cscl(rows, frame, radius_m), "NYC CSCL Street Centerline (inkn-q76z)"
        except RuntimeError:
            pass
    q = f"""[out:json][timeout:90];
way["highway"](around:{radius_m},{lat},{lon});
out geom tags;"""
    return parse_osm_streets(overpass(q, cache_dir, refresh=refresh), frame, radius_m), \
        "OpenStreetMap contributors (ODbL)"
