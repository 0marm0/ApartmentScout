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
            rows = socrata("64uk-42ks", {"$where": f"bbl in ({chunk})", "$select": "bbl,address,numfloors,yearbuilt,bldgclass",
                                         "$limit": 1000}, cache_dir, refresh=refresh)
        except RuntimeError:
            continue
        for r in rows:
            k = _bbl(r.get("bbl"))
            if k:
                out[k] = {"address": (r.get("address") or "").title() or None, "numfloors": _num(r.get("numfloors")),
                          "yearbuilt": _num(r.get("yearbuilt")), "bldgclass": (r.get("bldgclass") or "").strip().upper() or None}
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
        if p.get("bldgclass") and not b.get("cls"):
            b["cls"] = p["bldgclass"]     # PLUTO building class (D8 elevator co-op, O4 tall office ...): picks the 3D facade style
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
out geom;"""
    return parse_osm_elements(overpass(q, cache_dir, refresh=refresh), lat, lon, radius_m, tall_min_m, default_h)


# --------------------------------------------------------------------------- site model

def height_confidence(b: dict) -> str:
    """How far the roof height can be trusted: ``high``, ``medium`` or ``low``.

    A roof height measured on the aerial survey (outline photogrammetric) is high; one recorded on a hand-drawn
    outline or in OpenStreetMap is medium; one built from a floor count, from levels or from the default is low, and so
    is any height of a building the footprints mark as under construction (it will change).
    """
    src = b.get("height_src") or "default"
    if str(b.get("fcode") or "") in ("5100", "1003"):
        return "low"
    if src == "roof":
        return "medium" if b.get("geom_src") == "manual" else "high"
    if src in ("osm-height",):
        return "medium"
    return "low"


FLOOR_RATIO_M = (2.2, 5.2)       # a roof height per floor outside this is not a storey height: the footprint or the floor count is off


def floors_disagree(b: dict) -> bool:
    """A measured roof height that cannot belong to the PLUTO floor count (a 36-floor tower on an 18 m footprint is a podium's)."""
    f, h = b.get("floors"), b.get("height")
    if b.get("height_src") != "roof" or not f or f < 4 or not h:
        return False
    return not FLOOR_RATIO_M[0] <= h / f <= FLOOR_RATIO_M[1]


def stable_id(b: dict, index: int) -> str:
    """The building's id in every view: its BIN, else its OpenStreetMap element (``osmw123``), else ``b<index>``."""
    for k in ("bin", "id"):
        v = b.get(k)
        if v not in (None, ""):
            return str(v)
    return f"b{index}"


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
        sid = stable_id(b, i)
        m = {"id": sid if sid != str(b.get("bin")) else None, "bin": b.get("bin"), "bbl": b.get("bbl"), "address": b.get("address"),
             "name": b.get("name"), "year": b.get("year"), "floors": b.get("floors"), "cls": b.get("cls"),
             "height_src": b.get("height_src") or "default",
             "hconf": "low" if floors_disagree(b) else None, "hflag": "floors" if floors_disagree(b) else None,   # otherwise the rule reads height_src, geom_src, fcode
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


# --------------------------------------------------------------------------- matching the listing's building by name and address

NAME_RADIUS_M = 250.0          # a building matched by name or address must lie this close to the geocoded point
_GENERIC = {"the", "a", "an", "of", "and", "at", "on", "tower", "towers", "apartment", "apartments", "residence", "residences", "building",
            "condominium", "condominiums", "condo", "house", "court", "place", "plaza", "lofts", "loft", "hotel", "club"}
_ABBR = {"street": "st", "avenue": "ave", "drive": "dr", "road": "rd", "boulevard": "blvd", "place": "pl", "court": "ct", "lane": "ln",
         "parkway": "pkwy", "north": "n", "south": "s", "east": "e", "west": "w", "highway": "hwy", "square": "sq", "terrace": "ter"}


def _tokens(text) -> list[str]:
    s = "".join(c if c.isalnum() else " " for c in str(text or "").casefold())
    return [t for t in s.split() if t]


def name_matches(listing_name, osm_name) -> bool:
    """The listing's building name against an OpenStreetMap / footprint name: one name's words contain the other's, and the shared
    words include one that is not generic ("Tower", "Apartments", "The" alone never match: "Aqua" matches "Aqua at Lakeshore East")."""
    a, b = set(_tokens(listing_name)), set(_tokens(osm_name))
    if not a or not b:
        return False
    shared = a & b
    return (a <= b or b <= a) and any(t not in _GENERIC and len(t) >= 3 for t in shared)


def split_address(text) -> tuple[str | None, str]:
    """"225 N Columbus Dr, Chicago, IL 60601" -> ("225", "n columbus dr"): house number and street with the usual abbreviations."""
    first = str(text or "").split(",")[0]
    toks = _tokens(first)
    if not toks or not toks[0][0].isdigit():
        return None, " ".join(_ABBR.get(t, t) for t in toks)
    return toks[0], " ".join(_ABBR.get(t, t) for t in toks[1:])


def address_matches(listing_address, osm_address) -> bool:
    n1, s1 = split_address(listing_address)
    n2, s2 = split_address(osm_address)
    return bool(n1 and n1 == n2 and s1 and s2 and (s1 == s2 or set(s1.split()) <= set(s2.split()) or set(s2.split()) <= set(s1.split())))


def _closest(hits: list[int], rows: list) -> int:
    """Of several buildings that match: the one holding the geocoded point, else the nearest, else the tallest."""
    return min(hits, key=lambda i: (dist_to_ring(0, 0, rows[i][1]), -rows[i][0]["height"]))


def pick_target(rows: list, listing: dict, near_m: float = 45) -> tuple[int | None, str | None]:
    """Index of the listing's building among ``rows`` ((building, local ring, holes)) and how it was found.

    1. ``bin``: footprints with the listing's BIN (the tallest when a BIN has several polygons);
    2. ``bbl``: footprints on the listing's tax lot (the one containing the point, else the tallest);
    3. ``name``: a footprint named like the listing's building (OpenStreetMap ``name``, the city's footprint name) within 250 m of the
       point; of several (the four Presidential Towers) the one holding the point, else the nearest;
    4. ``address``: a footprint with the listing's house number and street (``addr:housenumber`` + ``addr:street``) within 250 m;
    5. ``point``: the footprint containing the geocoded point, if tall enough for the listing's floor;
    6. ``nearest``: the nearest footprint within ``near_m`` that is tall enough (else the nearest).

    Address points often fall in the street or on a neighbour (in Chicago the nearest footprint to Aqua's point was the Fairmont Hotel across the
    street, and to Presidential Towers' 540 West Madison), so identifiers and names win over distance; ``point`` and ``nearest`` are the guess.
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
    close = [i for i, (_b, pts, _h) in enumerate(rows) if dist_to_ring(0, 0, pts) <= NAME_RADIUS_M]
    lname = listing.get("building") or listing.get("name")
    if lname:
        hits = [i for i in close if name_matches(lname, rows[i][0].get("name"))]
        if hits:
            if len(hits) > 1 and listing.get("address"):      # several towers share a name: the one with the street number first
                by_addr = [i for i in hits if address_matches(listing.get("address"), rows[i][0].get("address"))]
                hits = by_addr or hits
            return _closest(hits, rows), "name"
    if listing.get("address"):
        hits = [i for i in close if address_matches(listing.get("address"), rows[i][0].get("address"))]
        if hits:
            return _closest(hits, rows), "address"
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
