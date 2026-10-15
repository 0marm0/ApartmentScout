"""Named places for plain-language search: streets, parks and neighbourhoods as small polylines and polygons.

``apartmentscout places`` writes ``<search>/places.json``; ``apartmentscout build`` copies it to the dashboard, which
tests "east of 3rd Ave", "between 30th and 45th Street", "near Bryant Park" or "in Murray Hill" in the browser, with
no network and no geocoder.

Where the geometry comes from (nothing is guessed):

* **Streets**: OpenStreetMap named ``highway=*`` ways (Overpass, cached like the site model's). Ways with the same
  canonical name are chained into polylines and simplified. Kept: every numbered street, every street at least
  ``min_street_m`` long, and any street the city profile gives an alias for ("Avenue of the Americas" is also
  "6th Avenue").
* **Parks**: OpenStreetMap ``leisure=park`` ways and multipolygon relations with a name.
* **Neighbourhoods**: a city profile may name a Socrata dataset of neighbourhood polygons (NYC: the 2020 Neighborhood
  Tabulation Areas). Compound names ("Murray Hill-Kips Bay") answer to each part, and a part shared by several areas
  ("Upper East Side") answers with their union.

File layout (``places.json``), coordinates as integer micro-steps of 1e-5 degrees, delta-encoded
(``[lon0, lat0, dlon1, dlat1, ...]``; ``decode_line``)::

    {"version": 1, "city", "generated", "bbox", "grid": {"name", "north_bearing"}, "enc": "e5-delta",
     "streets": [{"name", "keys", "axis", "lines": [line, ...]}],
     "areas":   [{"id", "name", "kind": "park" | "hood", "keys", "polys": [[ring, hole, ...], ...]}],
     "groups":  [{"name", "keys", "members": [area id, ...]}], "sources": [...], "attribution"}

``axis`` is the street's own direction in degrees from true north, taken forward (towards the grid's north, or its
east for a crosstown street). The browser decides "east of an avenue" from the street's local geometry, never from the
compass; ``grid.north_bearing`` (29 for the Manhattan street grid) only says which way "north" runs.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable, Iterable

from . import LocalFrame
from .fetch import collect_receipts, overpass, socrata, summarise_receipts

Point = tuple[float, float]  # (lon, lat)

ORD_WORDS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8,
             "ninth": 9, "tenth": 10, "eleventh": 11, "twelfth": 12}
STREET_TYPES = {"st": "street", "str": "street", "street": "street", "ave": "avenue", "av": "avenue",
                "avenue": "avenue", "blvd": "boulevard", "boulevard": "boulevard", "rd": "road", "road": "road",
                "dr": "drive", "drive": "drive", "pl": "place", "place": "place", "pkwy": "parkway",
                "parkway": "parkway", "ln": "lane", "lane": "lane", "ct": "court", "court": "court",
                "ter": "terrace", "terrace": "terrace", "hwy": "highway", "highway": "highway", "sq": "square",
                "square": "square", "expy": "expressway", "expressway": "expressway"}
DIRECTIONS = {"e", "w", "n", "s", "east", "west", "north", "south"}
OSM_CLASSES = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian"
DEFAULTS = {"min_street_m": 1500.0, "min_chain_m": 120.0, "street_tol_m": 3.0, "area_tol_m": 6.0, "park_min_m2": 25000.0,
            "park_notable_m2": 6000.0, "pad_m": 300.0}
# playgrounds, courts, piers and pools are not what anyone means by "near the park"
PARK_SKIP = re.compile(r"playground|ball ?field|basketball|handball|\bpier \d|recreation center|\bpool\b|\bwalk\b|"
                       r"dog (?:park|run)|\bplaza$|\besplanade$|\bparcel\b", re.I)
ATTRIBUTION = "Street and park geometry (c) OpenStreetMap contributors, ODbL."


# ------------------------------------------------------------------ names
def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _is_num(tok: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:st|nd|rd|th)?", tok)) or tok in ORD_WORDS


def area_key(name: str) -> str:
    """Lower-case words with accents and apostrophes dropped: "Hell's Kitchen" -> "hells kitchen"."""
    s = re.sub(r"['’‘`´]", "", _ascii(name))
    return " ".join(re.findall(r"[a-z0-9]+", s))


def street_key(name: str) -> str:
    """The canonical street key shared with the dashboard (places-geo.js streetKey): "East 30th Street" -> "30th street",
    "Third Ave." -> "3rd avenue", "Avenue A" stays. A direction before a number is dropped (the street is one street)."""
    toks = re.findall(r"[a-z0-9]+", re.sub(r"['’‘`´]", "", _ascii(name)))
    if len(toks) >= 2 and toks[0] in DIRECTIONS and _is_num(toks[1]):
        toks = toks[1:]
    out: list[str] = []
    for i, t in enumerate(toks):
        if t in ORD_WORDS:
            out.append(_ordinal(ORD_WORDS[t]))
        elif re.fullmatch(r"\d+", t):
            out.append(_ordinal(int(t)))
        elif t == "st" and i == 0 and len(toks) > 1 and toks[1] not in STREET_TYPES:
            out.append("saint")
        elif t in STREET_TYPES:
            out.append(STREET_TYPES[t])
        else:
            out.append(t)
    return " ".join(out)


def title_street(key: str) -> str:
    return " ".join(w if re.fullmatch(r"\d+(?:st|nd|rd|th)", w) else w.capitalize() for w in key.split())


# ------------------------------------------------------------------ geometry
def _frame_for(bbox: tuple[float, float, float, float]) -> LocalFrame:
    return LocalFrame((bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2)


def simplify(pts: list[Point], tol_m: float, fr: LocalFrame) -> list[Point]:
    """Douglas-Peucker in metres, iterative (long streets)."""
    n = len(pts)
    if n <= 2:
        return list(pts)
    xy = [fr.to_xy(*p) for p in pts]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        far, at = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > far:
                far, at = d, i
        if far > tol_m and at > 0:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(pts, keep) if k]


def self_intersects(ring: list[Point], fr: LocalFrame) -> bool:
    """True when two non-adjacent edges of a closed ring cross (a bow-tie). Rings longer than 3,000 points are not checked."""
    import numpy as np
    n = len(ring) - 1
    if n < 4 or n > 3000:
        return False
    xy = np.array([fr.to_xy(*p) for p in ring])
    a, b = xy[:-1], xy[1:]

    def orient(p, q, r):
        return (q[..., 0] - p[..., 0]) * (r[..., 1] - p[..., 1]) - (q[..., 1] - p[..., 1]) * (r[..., 0] - p[..., 0])

    A, B, C, D = a[:, None, :], b[:, None, :], a[None, :, :], b[None, :, :]
    cross = (orient(A, B, C) * orient(A, B, D) < 0) & (orient(C, D, A) * orient(C, D, B) < 0)
    i, j = np.indices(cross.shape)
    cross &= (j > i + 1) & ~((i == 0) & (j == n - 1))   # edges that share a vertex do not count
    return bool(cross.any())


def simplify_ring(ring: list[Point], tol_m: float, fr: LocalFrame) -> list[Point]:
    """Douglas-Peucker for a polygon ring that never makes it cross itself: a narrow channel can fold over on itself when
    its two sides are simplified separately, and a self-crossing polygon draws wrongly in the browser. The tolerance is
    halved until the result is a simple ring (down to 0.4 m, then the ring as it came)."""
    pts = _dedupe(ring)
    t = tol_m
    while t >= 0.4:
        out = simplify(pts, t, fr)
        if len(out) >= 4 and not self_intersects(out, fr):
            return out
        t /= 2
    return pts


def length_m(pts: list[Point], fr: LocalFrame) -> float:
    xy = [fr.to_xy(*p) for p in pts]
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(xy, xy[1:]))


def ring_area_m2(ring: list[Point], fr: LocalFrame) -> float:
    xy = [fr.to_xy(*p) for p in ring]
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(xy, xy[1:] + xy[:1]))) / 2


def point_in_ring(pt: Point, ring: list[Point]) -> bool:
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def chain_lines(lines: list[list[Point]], nd: int = 6) -> list[list[Point]]:
    """Join lines that share an end point into longer ones (any direction)."""
    chains = [list(l) for l in lines if len(l) >= 2]
    key = lambda p: (round(p[0], nd), round(p[1], nd))  # noqa: E731
    changed = True
    while changed:
        changed = False
        ends: dict[tuple, list[int]] = defaultdict(list)
        for i, c in enumerate(chains):
            ends[key(c[0])].append(i)
            ends[key(c[-1])].append(i)
        for i, c in enumerate(chains):
            if c is None:
                continue
            for end in (key(c[-1]), key(c[0])):
                j = next((j for j in ends.get(end, []) if j != i and chains[j] is not None), None)
                if j is None:
                    continue
                o = chains[j]
                if key(c[-1]) == end:
                    new = c + (o[1:] if key(o[0]) == end else o[::-1][1:])
                else:
                    new = (o[:-1] if key(o[-1]) == end else o[::-1][:-1]) + c
                chains[i], chains[j] = new, None
                changed = True
                break
            if changed:
                break
        chains = [c for c in chains if c is not None]
    return chains


def assemble_rings(segments: list[list[Point]], nd: int = 6) -> list[list[Point]]:
    """Closed rings from the pieces of a multipolygon's outer (or inner) members."""
    rings = []
    for c in chain_lines(segments, nd):
        if len(c) >= 4 and (round(c[0][0], nd), round(c[0][1], nd)) == (round(c[-1][0], nd), round(c[-1][1], nd)):
            rings.append(c)
    return rings


def encode_line(pts: Iterable[Point]) -> list[int]:
    """[lon0, lat0, dlon, dlat, ...] in 1e-5 degree steps (about a metre)."""
    out: list[int] = []
    px = py = 0
    for k, (lon, lat) in enumerate(pts):
        x, y = round(lon * 1e5), round(lat * 1e5)
        out += [x, y] if k == 0 else [x - px, y - py]
        px, py = x, y
    return out


def decode_line(flat: list[int]) -> list[Point]:
    pts, x, y = [], 0, 0
    for i in range(0, len(flat), 2):
        x = flat[i] if i == 0 else x + flat[i]
        y = flat[i + 1] if i == 0 else y + flat[i + 1]
        pts.append((x / 1e5, y / 1e5))
    return pts


def _dedupe(pts: list[Point]) -> list[Point]:
    out: list[Point] = []
    for p in pts:
        q = (round(p[0], 5), round(p[1], 5))
        if not out or out[-1] != q:
            out.append(q)
    return out


# ------------------------------------------------------------------ OpenStreetMap
def _geom(el: dict) -> list[Point]:
    return [(g["lon"], g["lat"]) for g in el.get("geometry") or [] if "lat" in g]


def fetch_streets(bbox: tuple[float, float, float, float], cache_dir: Path | None, refresh: bool = False) -> list[dict]:
    w, s, e, n = bbox
    q = (f'[out:json][timeout:240];way["highway"~"^({OSM_CLASSES})$"]["name"]["area"!="yes"]'
         f"({s:.5f},{w:.5f},{n:.5f},{e:.5f});out geom;")
    return overpass(q, cache_dir, max_age_days=30, refresh=refresh)


def fetch_parks(bbox: tuple[float, float, float, float], cache_dir: Path | None, refresh: bool = False) -> list[dict]:
    w, s, e, n = bbox
    b = f"({s:.5f},{w:.5f},{n:.5f},{e:.5f})"
    q = f'[out:json][timeout:240];(way["leisure"="park"]["name"]{b};relation["leisure"="park"]["name"]{b};);out geom;'
    return overpass(q, cache_dir, max_age_days=30, refresh=refresh)


def group_streets(els: list[dict]) -> dict[str, dict]:
    """{street key: {"names": Counter, "alts": set of keys, "lines": [..]}} from Overpass ways."""
    out: dict[str, dict] = {}
    for e in els:
        tags = e.get("tags") or {}
        name = tags.get("name")
        pts = _geom(e)
        if not name or len(pts) < 2:
            continue
        k = street_key(name)
        if not k:
            continue
        g = out.setdefault(k, {"names": Counter(), "alts": set(), "lines": []})
        g["names"][name] += 1
        g["lines"].append(pts)
        for tag in ("alt_name", "official_name", "loc_name", "short_name"):
            for alt in str(tags.get(tag) or "").split(";"):
                ak = street_key(alt)
                if ak and ak != k and (ak.split()[-1] in STREET_TYPES.values() or len(ak.split()) > 1):
                    g["alts"].add(ak)
    return out


def street_axis(lines: list[list[Point]], fr: LocalFrame, north_bearing: float) -> float:
    """The street's own direction in degrees, forward = towards the grid's north (a crosstown street: towards its east)."""
    nb = math.radians(north_bearing)
    nx, ny = math.sin(nb), math.cos(nb)       # grid north as (east, north) components
    ex, ey = ny, -nx                           # grid east
    sx = sy = 0.0
    for l in lines:
        for a, b in zip(l, l[1:]):
            (ax, ay), (bx, by) = fr.to_xy(*a), fr.to_xy(*b)
            dx, dy = bx - ax, by - ay
            along = dx * nx + dy * ny
            h = math.hypot(dx, dy)
            if h == 0:
                continue
            flip = along < 0 if abs(along) >= 0.15 * h else (dx * ex + dy * ey) < 0
            if flip:
                dx, dy = -dx, -dy
            sx, sy = sx + dx, sy + dy
    return round((math.degrees(math.atan2(sx, sy)) + 360) % 360, 1)


def build_streets(els: list[dict], bbox: tuple[float, float, float, float], north_bearing: float, cfg: dict,
                  region: Callable[[Point], bool] | None = None) -> list[dict]:
    fr = _frame_for(bbox)
    opt = {**DEFAULTS, **{k: v for k, v in cfg.items() if k in DEFAULTS}}
    aliases = {street_key(k): [street_key(a) for a in v] for k, v in (cfg.get("street_aliases") or {}).items()}
    wanted = set(aliases) | {street_key(k) for k in cfg.get("street_keep") or []}   # kept however short
    streets = []
    groups = group_streets(els)
    for merge in cfg.get("street_merge") or []:   # one avenue under several names (8th Avenue = Central Park West = Frederick Douglass Blvd)
        ks = [street_key(x) for x in merge]
        head = groups.setdefault(ks[0], {"names": Counter(), "alts": set(), "lines": []})
        for other in ks[1:]:
            o = groups.pop(other, None)
            head["alts"].add(other)
            if o:
                head["lines"] += o["lines"]
                head["alts"] |= o["alts"]
                if not head["names"]:
                    head["names"] = o["names"]
        if not head["lines"]:
            groups.pop(ks[0])
    for k, g in groups.items():
        lines = g["lines"]
        if region is not None:  # drop pieces mostly outside the study area (a same-named street in another borough)
            lines = [l for l in lines if sum(region(p) for p in l) * 2 >= len(l)]
        chains = [simplify(_dedupe(c), opt["street_tol_m"], fr) for c in chain_lines(lines)]
        chains = [c for c in chains if len(c) >= 2 and length_m(c, fr) >= opt["min_chain_m"]]
        if not chains:
            continue
        total = sum(length_m(c, fr) for c in chains)
        numbered = bool(re.match(r"^\d+(st|nd|rd|th) ", k))
        if not (numbered or total >= opt["min_street_m"] or k in wanted):
            continue
        keys = [k, *sorted(g["alts"]), *aliases.get(k, [])]
        streets.append({"name": g["names"].most_common(1)[0][0] if not numbered else title_street(k),
                        "keys": list(dict.fromkeys(keys)), "axis": street_axis(chains, fr, north_bearing),
                        "lines": [encode_line(c) for c in sorted(chains, key=lambda c: -length_m(c, fr))],
                        "_len": total})
    # a street's own name is never taken away; an alias (alt_name, profile alias) goes to the longer of its claimants
    claimed: dict[str, dict] = {s["keys"][0]: s for s in streets}
    for s in sorted(streets, key=lambda s: -s["_len"]):
        s["keys"] = [s["keys"][0]] + [x for x in s["keys"][1:] if claimed.setdefault(x, s) is s]
    for s in streets:
        s.pop("_len")
    return sorted(streets, key=lambda s: s["keys"][0])


def build_parks(els: list[dict], bbox: tuple[float, float, float, float], cfg: dict) -> list[dict]:
    fr = _frame_for(bbox)
    opt = {**DEFAULTS, **{k: v for k, v in cfg.items() if k in DEFAULTS}}
    by_name: dict[str, list[list[list[Point]]]] = defaultdict(list)
    names: dict[str, str] = {}
    notable: set[str] = set()   # tagged wikipedia / wikidata: kept at a lower size limit (Gramercy Park is 3,600 m2)
    skip = re.compile(cfg["park_exclude"], re.I) if cfg.get("park_exclude") else PARK_SKIP
    for e in els:
        tags = e.get("tags") or {}
        name = tags.get("name")
        if not name or skip.search(name):
            continue
        if e["type"] == "way":
            pts = _geom(e)
            polys = [[pts]] if len(pts) >= 4 and pts[0] == pts[-1] else []
        else:
            outer = [_geom(m) for m in e.get("members", []) if m.get("role") == "outer" and m.get("type") == "way"]
            inner = [_geom(m) for m in e.get("members", []) if m.get("role") == "inner" and m.get("type") == "way"]
            polys = [[o] for o in assemble_rings(outer)]
            holes = assemble_rings(inner)
            for h in holes:  # a hole goes with the outer ring that contains it
                for p in polys:
                    if point_in_ring(h[0], p[0]):
                        p.append(h)
                        break
        if polys:
            k = area_key(name)
            names.setdefault(k, name)
            by_name[k] += polys
            if tags.get("wikipedia") or tags.get("wikidata"):
                notable.add(k)
    out = []
    for k, polys in by_name.items():
        polys = [p for p in polys if ring_area_m2(p[0], fr) >= 1]
        if sum(ring_area_m2(p[0], fr) for p in polys) < (opt["park_notable_m2"] if k in notable else opt["park_min_m2"]):
            continue
        out.append({"id": "park-" + k.replace(" ", "-"), "name": names[k], "kind": "park", "keys": [k],
                    "polys": [[encode_line(simplify_ring(r, opt["area_tol_m"], fr)) for r in p] for p in polys]})
    return sorted(out, key=lambda a: a["id"])


# ------------------------------------------------------------------ neighbourhoods
def _geojson_polys(geom: dict) -> list[list[list[Point]]]:
    if not geom:
        return []
    if geom.get("type") == "Polygon":
        return [[[(x, y) for x, y, *_ in ring] for ring in geom["coordinates"]]]
    if geom.get("type") == "MultiPolygon":
        return [[[(x, y) for x, y, *_ in ring] for ring in poly] for poly in geom["coordinates"]]
    return []


def _mid(poly: list[list[Point]]) -> Point:
    """Middle of a polygon's outer ring's bounding box."""
    xs, ys = [q[0] for q in poly[0]], [q[1] for q in poly[0]]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def fetch_hoods(spec: dict, bbox: tuple[float, float, float, float], cache_dir: Path | None, refresh: bool = False) -> list[dict]:
    w, s, e, n = bbox
    wkt = f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"
    geom = spec.get("geom", "the_geom")
    where = f"intersects({geom}, '{wkt}')" + (f" AND ({spec['where']})" if spec.get("where") else "")
    sel = ",".join([spec.get("name", "ntaname"), spec.get("id", "nta2020"), geom])
    return socrata(spec["socrata"], {"$where": where, "$select": sel, "$limit": 2000}, cache_dir, max_age_days=365,
                   refresh=refresh)


def build_hoods(rows: list[dict], bbox: tuple[float, float, float, float], spec: dict, cfg: dict) -> list[dict]:
    """Neighbourhood polygons whose middle lies in the bbox, split and renamed as the city profile asks."""
    fr = _frame_for(bbox)
    opt = {**DEFAULTS, **{k: v for k, v in cfg.items() if k in DEFAULTS}}
    nk, ik, gk = spec.get("name", "ntaname"), spec.get("id", "nta2020"), spec.get("geom", "the_geom")
    w, s, e, n = bbox
    out = []
    splits = {street_free(x["from"]): x for x in (spec.get("split") or [])}
    for r in rows:
        polys = _geojson_polys(r.get(gk) or {})
        if not polys:
            continue
        name = r[nk]
        ident = str(r.get(ik) or area_key(name)).lower()
        pieces = [(ident, name, polys)]
        sp = splits.get(street_free(name))
        if sp:  # the part that contains this point becomes its own area (Roosevelt Island out of an Upper East Side area)
            pt = tuple(sp["contains"])
            hit = [p for p in polys if point_in_ring(pt, p[0])]
            rest = [p for p in polys if p not in hit]
            pieces = ([(ident + "-" + area_key(sp["name"]).replace(" ", "-"), sp["name"], hit)] if hit else []) + \
                     ([(ident, sp.get("rest_name") or name, rest)] if rest else [])
        for pid, pname, pp in pieces:
            cx, cy = sum(_mid(p)[0] for p in pp) / len(pp), sum(_mid(p)[1] for p in pp) / len(pp)
            if not (w <= cx <= e and s <= cy <= n):
                continue
            out.append({"id": pid, "name": pname, "kind": "hood", "keys": [],
                        "polys": [[encode_line(simplify_ring(r_, opt["area_tol_m"], fr)) for r_ in p] for p in pp]})
    return out


def street_free(name: str) -> str:
    return area_key(name)


def name_areas(areas: list[dict], cfg: dict, log: Callable[..., Any] = print) -> list[dict]:
    """Fill in each neighbourhood's keys (full name, then each part of a compound name) and build the groups: a part
    shared by several areas ("Upper East Side") answers with their union; the profile adds aliases and groups."""
    hoods = [a for a in areas if a["kind"] == "hood"]
    park_keys = {k for a in areas if a["kind"] == "park" for k in a["keys"]}
    parts: dict[str, set[str]] = defaultdict(set)
    label: dict[str, str] = {}
    for a in hoods:
        base = re.sub(r"\s*\([^)]*\)", "", a["name"]).strip()
        for p in [base, *re.split(r"[-/–]", base)]:
            k = area_key(p)
            if len(k) >= 4 and k not in park_keys:   # an exact park name stays the park
                parts[k].add(a["id"])
                label.setdefault(k, p.strip())
    groups: list[dict] = []
    for k, ids in sorted(parts.items()):
        if len(ids) == 1:
            a = next(a for a in hoods if a["id"] in ids)
            a["keys"].append(k)
        else:
            groups.append({"name": label[k], "keys": [k], "members": sorted(ids)})
    for a in hoods:
        k = area_key(a["name"])
        if k not in a["keys"]:
            a["keys"].insert(0, k)
    byname = {k: ("area", a) for a in areas for k in a["keys"]}
    byname.update({k: ("group", g) for g in groups for k in g["keys"]})
    for gname, members in (cfg.get("groups") or {}).items():
        ids = []
        for m in members:
            hit = byname.get(area_key(m))
            if hit and hit[0] == "area":
                ids.append(hit[1]["id"])
            elif hit:
                ids += hit[1]["members"]
            else:
                log(f"  places: group {gname}: no area called {m!r}; skipped")
        if ids:
            groups = [g for g in groups if area_key(gname) not in g["keys"]]
            groups.append({"name": gname, "keys": [area_key(gname)], "members": sorted(set(ids))})
    byname = {k: ("area", a) for a in areas for k in a["keys"]}
    byname.update({k: ("group", g) for g in groups for k in g["keys"]})
    for alias, target in (cfg.get("aliases") or {}).items():
        hit = byname.get(area_key(target))
        if not hit:
            log(f"  places: alias {alias!r} -> {target!r}: no such area; skipped")
            continue
        ak = area_key(alias)
        if ak not in hit[1]["keys"]:
            hit[1]["keys"].append(ak)
    for a in areas:
        a["keys"] = list(dict.fromkeys(a["keys"]))
    return groups


# ------------------------------------------------------------------ the whole file
def _region(profile: dict) -> tuple[Callable[[Point], bool] | None, float | None, str | None]:
    """(is a point inside the study area, grid north bearing, grid name) from the profile's street-grid polygons."""
    cfg = profile.get("places") or {}
    grids = profile.get("walk_grids") or []
    rings = [[tuple(p) for p in g["polygon"]] for g in grids if g.get("polygon")]
    north = cfg.get("north_bearing", grids[0].get("bearing_deg") if grids else None)
    if cfg.get("region", "walk_grids") == "walk_grids" and rings:
        return (lambda p: any(point_in_ring(p, r) for r in rings)), north, (grids[0].get("name") if grids else None)
    return None, north, (grids[0].get("name") if grids else None)


def build_places(bbox: tuple[float, float, float, float], profile: dict, cache_dir: Path | None, city: str | None = None,
                 refresh: bool = False, log: Callable[..., Any] = print) -> dict:
    cfg = profile.get("places") or {}
    region, north, grid_name = _region(profile)
    north = float(north or 0)
    pad = float(cfg.get("pad_m", DEFAULTS["pad_m"]))
    fr = _frame_for(bbox)
    dlat, dlon = pad / 110574, pad / (111320 * math.cos(math.radians(fr.lat0)))
    box = (bbox[0] - dlon, bbox[1] - dlat, bbox[2] + dlon, bbox[3] + dlat)
    with collect_receipts() as rc:
        streets = build_streets(fetch_streets(box, cache_dir, refresh), box, north, cfg, region)
        log(f"  streets: {len(streets)} kept")
        areas = build_parks(fetch_parks(box, cache_dir, refresh), box, cfg)
        log(f"  parks: {len(areas)} kept")
        hspec = cfg.get("neighbourhoods")
        if hspec:
            hoods = build_hoods(fetch_hoods(hspec, box, cache_dir, refresh), box, hspec, cfg)
            log(f"  neighbourhoods: {len(hoods)} kept")
            areas = hoods + areas
        groups = name_areas(areas, cfg, log)
    doc: dict[str, Any] = {
        "version": 1, "city": city, "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "bbox": [round(v, 5) for v in box], "enc": "e5-delta",
        "grid": {"name": grid_name, "north_bearing": north},
        "streets": streets, "areas": areas, "groups": groups,
        "sources": [{k: v for k, v in q.items() if k != "queries"} for q in summarise_receipts(rc)],
        "attribution": ATTRIBUTION,
    }
    return doc


def write_places(doc: dict, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    path.write_text(blob)
    return len(blob.encode())
