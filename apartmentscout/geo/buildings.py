"""Building footprints with heights, for the 3D site model and the sun/view analysis.

Sources:

* ``nyc``  NYC Building Footprints (dataset 5zhs-2jue: photogrammetric roof height and ground
           elevation per building, BIN, BBL, construction year). Missing roof heights are filled
           from PLUTO's number of floors, and only then from a default, and the source of every
           height is recorded per building (``bmeta``).
* ``osm``  OpenStreetMap via the Overpass API. Works anywhere; height comes from ``height``,
           else ``building:levels`` x 3.2 m + 2 m, else a default (recorded as such). Building
           multipolygon relations keep their inner rings (courtyards).

Inner rings (light courts, courtyards) are kept: they are emitted as ``holes`` and treated as open
air by the skyline and party-wall tests.

NYC footprint metadata is kept per building (``bmeta``): the footprint ``name`` (296 named towers
within 1 km of Midtown, e.g. "Empire State Building"; used before the PLUTO address for landmark
labels), ``geom_src`` (``photogrammetric`` or ``manual``: about 15% of outlines were drawn by hand),
``edited`` (year the record was last edited: most heights date from the 2017 capture) and ``fcode``
(feature code: 2100 building, 5100 building under construction, 1003 construction placeholder,
1006 cantilevered building...). PLUTO ``floors`` is kept so the floor height can be calibrated.
"""
from __future__ import annotations

import ast
import json
import math
from pathlib import Path

from . import LocalFrame, haversine_m
from .fetch import overpass, socrata
from .shapes import clean_ring, dist_to_ring, point_in_ring, ring_area, simplify_ring, stitch

FT = 0.3048
LEVEL_M = 3.2
DEFAULT_H = 10.0

__all__ = ["fetch_nyc", "fetch_osm", "parse_nyc_rows", "parse_osm_elements", "fill_heights", "nyc_pluto",
           "build_site", "pick_target", "nyc_landmark_names", "point_in_ring"]


# --------------------------------------------------------------------------- geometry parsing

def _geom(geom) -> dict:
    if isinstance(geom, str):
        try:
            geom = json.loads(geom)
        except json.JSONDecodeError:
            geom = ast.literal_eval(geom)
    return geom


def _polys(geom) -> list[list[list[tuple[float, float]]]]:
    """Polygons as [outer, hole, hole, ...] rings of (lon, lat)."""
    g = _geom(geom)
    t = g.get("type")
    polys = g["coordinates"] if t == "MultiPolygon" else [g["coordinates"]]
    return [[[tuple(p[:2]) for p in ring] for ring in poly] for poly in polys if poly]


def _rings(geom) -> list[list[tuple[float, float]]]:
    """Outer rings only (kept for callers of the v1 API)."""
    return [poly[0] for poly in _polys(geom)]


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _bin(v) -> str | None:
    """A real BIN (not a borough "million" placeholder such as 1000000)."""
    if v in (None, ""):
        return None
    s = str(v).split(".")[0].strip()
    return s if s.isdigit() and len(s) == 7 and s[1:] != "000000" else None


def _name(v) -> str | None:
    """Footprint names worth showing (the dataset also holds junk such as "1")."""
    s = " ".join(str(v or "").split())
    return s if len(s) >= 3 and sum(c.isalpha() for c in s) >= 3 else None


def _geom_src(v) -> str | None:
    s = str(v or "").strip().lower()
    if not s:
        return None
    if s.startswith("photogram"):
        return "photogrammetric"
    if "manual" in s:
        return "manual"
    return s.split()[0]


def _bbl(v) -> str | None:
    if v in (None, ""):
        return None
    s = str(v).split(".")[0].strip()
    return s if s.isdigit() and int(s) > 0 else None


# --------------------------------------------------------------------------- NYC

def parse_nyc_rows(rows: list[dict]) -> list[dict]:
    """NYC footprint rows -> building dicts. Missing roof heights stay ``None`` (filled later)."""
    out: dict = {}
    for b in rows:
        h_ft = _num(b.get("height_roof"))
        if h_ft is not None and h_ft * FT < 3:
            continue  # sheds, kiosks and zero-height records
        try:
            polys = _polys(b["the_geom"])
        except (KeyError, ValueError, SyntaxError, TypeError):
            continue
        yr = _num(b.get("construction_year") or b.get("cnstrct_yr"))
        edited = _year(b.get("last_edited_date") or b.get("lstmoddate"))
        extra = {k: v for k, v in (("name", _name(b.get("name"))),
                                   ("geom_src", _geom_src(b.get("geom_source") or b.get("geomsource"))),
                                   ("edited", edited),
                                   ("fcode", str(b.get("feature_code") or b.get("feat_code") or "") or None))
                 if v is not None}
        for poly in polys:
            outer = poly[0]
            if len(outer) < 4:
                continue
            key = (b.get("bin"), outer[0])
            out[key] = {
                "id": b.get("bin"), "bin": b.get("bin"),
                "bbl": _bbl(b.get("mappluto_bbl")) or _bbl(b.get("base_bbl")),
                "height": h_ft * FT if h_ft is not None else None,
                "height_src": "roof" if h_ft is not None else None,
                "ground": (_num(b.get("ground_elevation")) or 0.0) * FT,
                "ring": outer, "holes": [h for h in poly[1:] if len(h) >= 4],
                "year": int(yr) if yr and yr > 1600 else None, "src": "nyc-footprints", **extra,
            }
    return list(out.values())


def fetch_nyc(lat: float, lon: float, radius_m: float = 600, tall_radius_m: float = 3500,
              tall_min_ft: float = 500, cache_dir: Path | None = None, refresh: bool = False) -> list[dict]:
    sel = ("bin,base_bbl,mappluto_bbl,height_roof,ground_elevation,construction_year,name,geom_source,"
           "last_edited_date,feature_code,the_geom")
    rows: list[dict] = []
    for where in (f"within_circle(the_geom,{lat},{lon},{radius_m})",
                  f"within_circle(the_geom,{lat},{lon},{tall_radius_m}) AND height_roof > {tall_min_ft}"):
        rows += socrata("5zhs-2jue", {"$where": where, "$select": sel, "$limit": 50000}, cache_dir,
                        refresh=refresh)
    return parse_nyc_rows(rows)


def nyc_pluto(bbls: list[str], cache_dir: Path | None = None, refresh: bool = False) -> dict[str, dict]:
    """PLUTO address, number of floors and year built per BBL (best effort, batched)."""
    out: dict[str, dict] = {}
    want = sorted({b for b in bbls if b})
    for i in range(0, len(want), 80):
        chunk = ",".join(f"'{b}'" for b in want[i:i + 80])
        try:
            rows = socrata("64uk-42ks", {"$where": f"bbl in ({chunk})", "$select": "bbl,address,numfloors,yearbuilt",
                                         "$limit": 1000}, cache_dir, refresh=refresh)
        except RuntimeError:
            continue
        for r in rows:
            k = _bbl(r.get("bbl"))
            if k:
                out[k] = {"address": (r.get("address") or "").title() or None, "numfloors": _num(r.get("numfloors")),
                          "yearbuilt": _num(r.get("yearbuilt"))}
    return out


def nyc_landmark_names(bbls: list[str], cache_dir: Path | None = None) -> dict:
    """Best-effort addresses for tall buildings via PLUTO."""
    return {k: v["address"] for k, v in nyc_pluto(bbls, cache_dir).items() if v.get("address")}


def fill_heights(buildings: list[dict], pluto: dict[str, dict] | None = None,
                 default_h: float = DEFAULT_H) -> list[dict]:
    """Fill missing heights from PLUTO floors, then a default, recording the source; add address/year."""
    pluto = pluto or {}
    for b in buildings:
        p = pluto.get(b.get("bbl") or "") or {}
        if b.get("height") is None:
            nf = p.get("numfloors")
            if nf and nf > 0:
                b["height"], b["height_src"] = nf * LEVEL_M + 2, "pluto-floors"
            else:
                b["height"], b["height_src"] = default_h, "default"
        if p.get("address") and not b.get("address"):
            b["address"] = p["address"]
        if not b.get("year") and p.get("yearbuilt") and p["yearbuilt"] > 1600:
            b["year"] = int(p["yearbuilt"])
        if p.get("numfloors") and p["numfloors"] > 0 and not b.get("floors"):
            b["floors"] = int(round(p["numfloors"]))
    return buildings


# --------------------------------------------------------------------------- OpenStreetMap

def _osm_height(tags: dict) -> tuple[float | None, str | None]:
    for k in ("height", "building:height"):
        raw = tags.get(k)
        if raw:
            s = str(raw).lower().strip()
            ft = "ft" in s or "'" in s
            v = _num(s.replace("ft", "").replace("'", "").replace("m", "").strip())
            if v is not None and v > 0:
                return v * (FT if ft else 1), "osm-height"
    lv = _num(tags.get("building:levels"))
    if lv and lv > 0:
        return lv * LEVEL_M + 2, "osm-levels"
    return None, None


def parse_osm_elements(els: list[dict], lat: float, lon: float, radius_m: float, tall_min_m: float = 120,
                       default_h: float = DEFAULT_H) -> list[dict]:
    """Overpass ``out geom`` ways and building relations -> building dicts (with courtyards)."""
    out = []
    for e in els:
        tags = e.get("tags", {})
        polys: list[tuple[list, list]] = []
        if e.get("type") == "way":
            g = e.get("geometry") or []
            if len(g) < 4:
                continue
            polys.append(([(p["lon"], p["lat"]) for p in g], []))
        elif e.get("type") == "relation":
            mem = [m for m in e.get("members", []) if m.get("type") == "way" and m.get("geometry")]
            outers = stitch([[(p["lon"], p["lat"]) for p in m["geometry"]] for m in mem if m.get("role") != "inner"])
            inners = stitch([[(p["lon"], p["lat"]) for p in m["geometry"]] for m in mem if m.get("role") == "inner"])
            for o in outers:
                polys.append((o, [h for h in inners if point_in_ring(h[0][0], h[0][1], o)]))
        else:
            continue
        h, src = _osm_height(tags)
        for ring, holes in polys:
            far = haversine_m(lat, lon, ring[0][1], ring[0][0]) > radius_m
            if far and (h is None or h < tall_min_m):
                continue
            out.append({"id": f"osm{e.get('type', 'w')[0]}{e['id']}", "bin": None, "bbl": None,
                        "height": h if h is not None else default_h, "height_src": src or "default",
                        "ground": 0.0, "ring": ring, "holes": holes, "name": tags.get("name"),
                        "address": _osm_addr(tags), "year": _year(tags.get("start_date")), "src": "osm",
                        "floors": int(_num(tags.get("building:levels")) or 0) or None,
                        "estimated_height": h is None})
    return out


def _osm_addr(tags: dict) -> str | None:
    n, s = tags.get("addr:housenumber"), tags.get("addr:street")
    return f"{n} {s}" if n and s else None


def _year(v) -> int | None:
    try:
        y = int(str(v)[:4])
    except (TypeError, ValueError):
        return None
    return y if 1600 < y < 2100 else None


def fetch_osm(lat: float, lon: float, radius_m: float = 600, tall_radius_m: float = 3000,
              tall_min_m: float = 120, default_h: float = DEFAULT_H, cache_dir: Path | None = None,
              refresh: bool = False) -> list[dict]:
    q = f"""[out:json][timeout:120];
(way["building"](around:{radius_m},{lat},{lon});
 relation["building"]["type"="multipolygon"](around:{radius_m},{lat},{lon});
 way["building"]["height"](around:{tall_radius_m},{lat},{lon});
 way["building"]["building:levels"](around:{tall_radius_m},{lat},{lon}););
out geom tags;"""
    return parse_osm_elements(overpass(q, cache_dir, refresh=refresh), lat, lon, radius_m, tall_min_m, default_h)


# --------------------------------------------------------------------------- site model

def _local(F: LocalFrame, ring, tol: float = 0.3) -> list[tuple[float, float]]:
    """Ring in local metres, de-duplicated and with collinear vertices merged (within ``tol`` m)."""
    return simplify_ring(clean_ring([F.to_xy(lo, la) for lo, la in ring]), tol)


def build_site(listing: dict, buildings: list[dict], source: str, landmark_names: dict | None = None,
               named_points: list | None = None) -> dict:
    """Convert footprints to a compact local-metre model centred on the listing (site JSON v2).

    ``bmeta`` is aligned with ``b``; keys whose value is unknown are omitted (absent = null).
    """
    lat0, lon0 = listing["lat"], listing["lon"]
    F = LocalFrame(lat0, lon0)
    rows = []
    for b in buildings:
        if b.get("height") is None:
            b = {**b, "height": DEFAULT_H, "height_src": "default"}
        clean = _local(F, b["ring"])
        if len(clean) < 3:
            continue
        holes = [h for h in (_local(F, r) for r in b.get("holes") or []) if len(h) >= 3 and abs(ring_area(h)) > 4]
        rows.append((b, clean, holes))
    target_idx, how = pick_target(rows, listing)
    g0 = rows[target_idx][0]["ground"] if target_idx is not None else 0
    out, holes_out, meta = [], {}, []
    for i, (b, pts, holes) in enumerate(rows):
        top = b["ground"] - g0 + b["height"]
        out.append([round(top, 1), round(b["ground"] - g0, 1), 1 if i == target_idx else 0,
                    [round(v, 1) for p in pts for v in p]])
        if holes:
            holes_out[str(i)] = [[[round(x, 1), round(y, 1)] for x, y in h] for h in holes]
        m = {"bin": b.get("bin"), "bbl": b.get("bbl"), "address": b.get("address"), "name": b.get("name"),
             "year": b.get("year"), "floors": b.get("floors"), "height_src": b.get("height_src") or "default",
             "src": b.get("src") or ("osm" if str(b.get("id", "")).startswith("osm") else "nyc-footprints"),
             "geom_src": b.get("geom_src"), "edited": b.get("edited"), "fcode": b.get("fcode")}
        meta.append({k: v for k, v in m.items() if v is not None})
    lm = _landmarks(rows, target_idx, g0, F, landmark_names, named_points)
    site = {"version": 2, "source": source, "origin": {"lat": lat0, "lon": lon0},
            "listing": {k: listing.get(k) for k in ("id", "building", "unit", "address", "floor", "exposure")},
            "floor_height_m": LEVEL_M, "b": out, "lm": lm, "target": target_idx, "bmeta": meta}
    if holes_out:
        site["holes"] = holes_out
    if target_idx is not None:
        off = dist_to_ring(0, 0, rows[target_idx][1])
        site["target_match"] = {"by": how, "point_offset_m": round(off, 1)}
    return site


def pick_target(rows: list, listing: dict, near_m: float = 45) -> tuple[int | None, str | None]:
    """Index of the listing's building among ``rows`` ((building, local ring, holes)) and how it was found.

    1. ``bin``: footprints with the listing's BIN (the tallest when a BIN has several polygons);
    2. ``bbl``: footprints on the listing's tax lot (the one containing the point, else the tallest);
    3. ``point``: the footprint containing the geocoded point, if tall enough for the listing's floor;
    4. ``nearest``: the nearest footprint within ``near_m`` that is tall enough (else the nearest).

    Address points often fall in the street or on a neighbour, so the city's own identifiers win.
    """
    lb, ll = _bin(listing.get("bin")), _bbl(listing.get("bbl"))
    if lb:
        hits = [i for i, (b, _p, _h) in enumerate(rows) if _bin(b.get("bin")) == lb]
        if hits:
            return max(hits, key=lambda i: rows[i][0]["height"]), "bin"
    if ll:
        hits = [i for i, (b, _p, _h) in enumerate(rows) if _bbl(b.get("bbl")) == ll]
        if hits:
            inside = [i for i in hits if point_in_ring(0, 0, rows[i][1])]
            return (inside[0] if inside else max(hits, key=lambda i: rows[i][0]["height"])), "bbl"
    need = ((listing.get("floor") or 1) - 1) * LEVEL_M + 2
    for i, (b, pts, _) in enumerate(rows):
        if point_in_ring(0, 0, pts) and b["height"] >= need:
            return i, "point"
    cands = sorted((b["height"] < need, dist_to_ring(0, 0, pts), i) for i, (b, pts, _) in enumerate(rows)
                   if dist_to_ring(0, 0, pts) < near_m)
    if cands:
        return cands[0][2], ("point" if cands[0][1] == 0 else "nearest")
    return None, None


def _landmarks(rows, target_idx, g0, F, landmark_names, named_points) -> list:
    """Every named tower in range, then the tallest others, up to 14."""
    def centroid(pts):
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    lm: list = []
    cands = []
    for nm, la, lo in named_points or []:
        px, py = F.to_xy(lo, la)
        for i, (b, pts, _) in enumerate(rows):
            cx, cy = centroid(pts)
            d = 0.0 if point_in_ring(px, py, pts) else math.hypot(px - cx, py - cy)
            if i != target_idx and b["height"] >= 60 and d < 120:
                cands.append((d, -b["height"], nm, i))
    named, used = {}, set()
    for d, _, nm, i in sorted(cands):
        if nm in used or i in named:
            continue
        named[i] = nm
        used.add(nm)
    order = sorted(named, key=lambda i: -rows[i][0]["height"]) + \
        [i for i in sorted(range(len(rows)), key=lambda i: -rows[i][0]["height"]) if i not in named]
    for i in order:
        if len(lm) >= 14:
            break
        b, pts, _ = rows[i]
        if i == target_idx or (i not in named and b["height"] < 100):
            continue
        cx, cy = centroid(pts)
        if any(math.hypot(cx - lx, cy - ly) < 90 for _, _, lx, ly, _ in lm):
            continue
        name = named.get(i) or b.get("name") or (landmark_names or {}).get(b.get("bbl")) or b.get("address") \
            or f"{b['height']:.0f} m tower"
        lm.append([name, i, round(cx, 1), round(cy, 1), round(b["height"] + b["ground"] - g0, 1)])
    return lm
