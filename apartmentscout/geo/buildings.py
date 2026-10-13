"""Building footprints with heights, for the 3D site model and the sun/view analysis.

Sources:

* ``nyc``  NYC Building Footprints (roof height and ground elevation per building,
           photogrammetric, very good).
* ``osm``  OpenStreetMap via the Overpass API. Works anywhere; height comes from
           ``height`` or ``building:levels`` x 3.2 m, else a default. Coverage of heights
           varies a lot by city, so check the result and fix key neighbours by hand
           in the site JSON if needed.
"""
from __future__ import annotations

import ast
import json
import math

import requests

from . import LocalFrame, haversine_m

FT = 0.3048
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]


def _rings(geom) -> list[list[tuple[float, float]]]:
    if isinstance(geom, str):
        try:
            geom = json.loads(geom)
        except json.JSONDecodeError:
            geom = ast.literal_eval(geom)
    t = geom.get("type")
    polys = geom["coordinates"] if t == "MultiPolygon" else [geom["coordinates"]]
    return [[tuple(p) for p in poly[0]] for poly in polys]


def fetch_nyc(lat: float, lon: float, radius_m: float = 600, tall_radius_m: float = 3500,
              tall_min_ft: float = 500) -> list[dict]:
    url = "https://data.cityofnewyork.us/resource/5zhs-2jue.json"
    sel = "bin,base_bbl,height_roof,ground_elevation,the_geom"
    out = {}
    for where in (f"within_circle(the_geom,{lat},{lon},{radius_m})",
                  f"within_circle(the_geom,{lat},{lon},{tall_radius_m}) AND height_roof > {tall_min_ft}"):
        r = requests.get(url, params={"$where": where, "$select": sel, "$limit": 50000}, timeout=120)
        r.raise_for_status()
        for b in r.json():
            try:
                h = float(b["height_roof"]) * FT
            except (KeyError, TypeError, ValueError):
                continue
            if h < 3:
                continue
            for ring in _rings(b["the_geom"]):
                out[(b["bin"], ring[0])] = {"id": b["bin"], "bbl": str(b.get("base_bbl", "")).split(".")[0],
                                            "height": h, "ground": float(b.get("ground_elevation") or 0) * FT,
                                            "ring": ring}
    return list(out.values())


def fetch_osm(lat: float, lon: float, radius_m: float = 600, tall_radius_m: float = 3000,
              tall_min_m: float = 120, default_h: float = 10.0) -> list[dict]:
    q = f"""[out:json][timeout:90];
(way["building"](around:{radius_m},{lat},{lon});
 way["building"]["height"](around:{tall_radius_m},{lat},{lon});
 way["building"]["building:levels"](around:{tall_radius_m},{lat},{lon}););
out geom tags;"""
    last = None
    for ep in OVERPASS:
        try:
            r = requests.post(ep, data={"data": q}, timeout=(15, 120), headers={"User-Agent": "ApartmentScout/0.1"})
            r.raise_for_status()
            els = r.json().get("elements", [])
            break
        except requests.RequestException as e:
            last = e
    else:
        raise RuntimeError(f"Overpass unavailable: {last}")
    out = []
    for e in els:
        g = e.get("geometry")
        if not g or len(g) < 4:
            continue
        tags = e.get("tags", {})
        h = _osm_height(tags)
        ring = [(p["lon"], p["lat"]) for p in g]
        far = haversine_m(lat, lon, ring[0][1], ring[0][0]) > radius_m
        if far and (h is None or h < tall_min_m):
            continue
        out.append({"id": f"osm{e['id']}", "height": h or default_h, "ground": 0.0, "ring": ring,
                    "name": tags.get("name"), "estimated_height": h is None})
    return out


def _osm_height(tags: dict) -> float | None:
    for k in ("height", "building:height"):
        if tags.get(k):
            try:
                v = tags[k].lower().replace("m", "").strip()
                return float(v.replace("ft", "")) * (FT if "ft" in tags[k] else 1)
            except ValueError:
                pass
    if tags.get("building:levels"):
        try:
            return float(tags["building:levels"]) * 3.2 + 2
        except ValueError:
            pass
    return None


def _dist_to_ring(x: float, y: float, ring) -> float:
    best = 1e18
    n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy + 1e-12)))
        best = min(best, math.hypot(x - x1 - t * dx, y - y1 - t * dy))
    return 0.0 if point_in_ring(x, y, ring) else best


def point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


def build_site(listing: dict, buildings: list[dict], source: str, landmark_names: dict | None = None,
               named_points: list | None = None) -> dict:
    """Convert footprints to a compact local-metre model centred on the listing."""
    lat0, lon0 = listing["lat"], listing["lon"]
    F = LocalFrame(lat0, lon0)
    target_idx = None
    rows = []
    for b in buildings:
        pts = [F.to_xy(lo, la) for lo, la in b["ring"]]
        if len(pts) > 3 and pts[0] == pts[-1]:
            pts = pts[:-1]
        clean = []
        for p in pts:
            if not clean or math.dist(p, clean[-1]) > 0.3:
                clean.append(p)
        if len(clean) < 3:
            continue
        rows.append((b, clean))
    # target building: the footprint containing the listing point; otherwise the nearest one
    # within 45 m that is tall enough to have the listing's floor
    need = ((listing.get("floor") or 1) - 1) * 3.2 + 2
    for i, (b, pts) in enumerate(rows):
        if point_in_ring(0, 0, pts):
            target_idx = i
            break
    if target_idx is None or rows[target_idx][0]["height"] < need:
        cands = []
        for i, (b, pts) in enumerate(rows):
            d = _dist_to_ring(0, 0, pts)
            if d < 45:
                cands.append((b["height"] < need, d, i))
        if cands:
            target_idx = sorted(cands)[0][2]
    g0 = rows[target_idx][0]["ground"] if target_idx is not None else 0
    out = []
    for i, (b, pts) in enumerate(rows):
        top = b["ground"] - g0 + b["height"]
        out.append([round(top, 1), round(b["ground"] - g0, 1), 1 if i == target_idx else 0,
                    [round(v, 1) for p in pts for v in p]])
    # landmarks: every named tower in range, then the tallest others, up to 14
    lm = []
    def centroid(pts):
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    cands = []
    for nm, la, lo in named_points or []:
        px, py = F.to_xy(lo, la)
        for i, (b, pts) in enumerate(rows):
            cx, cy = centroid(pts)
            d = 0.0 if point_in_ring(px, py, pts) else math.hypot(px - cx, py - cy)
            if i != target_idx and b["height"] >= 60 and d < 120:
                cands.append((d, -b["height"], nm, i))
    named, used = {}, set()
    for d, _, nm, i in sorted(cands):
        if nm in used or i in named:
            continue
        named[i] = (nm, i)
        used.add(nm)
    order = sorted(named, key=lambda i: -rows[i][0]["height"]) + [i for i in sorted(range(len(rows)), key=lambda i: -rows[i][0]["height"]) if i not in named]
    for i in order:
        if len(lm) >= 14:
            break
        b, pts = rows[i]
        if i == target_idx or (i not in named and b["height"] < 100):
            continue
        cx, cy = centroid(pts)
        if any(math.hypot(cx - l[2], cy - l[3]) < 90 for l in lm):
            continue
        name = named[i][0] if i in named else ((landmark_names or {}).get(b.get("bbl")) or b.get("name") or f"{b['height']:.0f} m tower")
        lm.append([name, i, round(cx, 1), round(cy, 1), round(b["height"] + b["ground"] - g0, 1)])
    return {"version": 1, "source": source, "origin": {"lat": lat0, "lon": lon0},
            "listing": {k: listing.get(k) for k in ("id", "building", "unit", "address", "floor", "exposure")},
            "floor_height_m": 3.2, "b": out, "lm": lm, "target": target_idx}


def nyc_landmark_names(bbls: list[str]) -> dict:
    """Best-effort addresses for tall buildings via PLUTO."""
    names = {}
    bbls = [b for b in bbls if b]
    for i in range(0, len(bbls), 40):
        chunk = ",".join(f"'{b}'" for b in bbls[i:i + 40])
        try:
            r = requests.get("https://data.cityofnewyork.us/resource/64uk-42ks.json",
                             params={"$where": f"bbl in ({chunk})", "$select": "bbl,address,ownername"}, timeout=60)
            for row in r.json():
                names[str(row["bbl"]).split(".")[0]] = row.get("address", "").title()
        except requests.RequestException:
            pass
    return names
