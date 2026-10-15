"""Component buildings: podiums, towers, setbacks and bulkheads instead of one footprint prism.

NYC footprints carry one roof height per outline, so a podium with a slim tower on it is drawn as the
whole lot pushed up to the tower's roof, which overstates the shade it casts. Two optional sources
split such a building into stacked prisms ("components"):

* ``osm``     OpenStreetMap ``building:part`` outlines with ``height`` / ``min_height`` (or
              ``building:levels`` / ``building:min_level`` x 3.2 m), read through Overpass (cached,
              with receipts like every other download). Each part is assigned to the footprint that
              contains its centroid. A footprint takes its parts only when they cover at least
              ``MIN_COVER`` of its area (sampled on a grid) and their tallest top agrees with the
              footprint's own roof height (within ``max(8 m, 20%)``); otherwise it keeps its prism and
              the reason is counted in ``components_info``.
* ``manual``  ``<search>/sites/<id>.components.yaml`` for the target and nearby blockers (see
              ``load_overrides``). Manual entries replace OSM-derived ones for the same building.

Site JSON: ``"components": {"<b index>": [{"ring": [[x, y], ...], "base_m", "top_m", "kind",
"source", "confidence", "ref"?}]}`` with heights in metres above the building's own ground and rings
in the site's local metre frame. ``kind`` is podium | tower | setback | bulkhead.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

from . import LocalFrame
from .buildings import LEVEL_M, _num, _osm_height
from .fetch import overpass
from .shapes import bbox, clean_ring, point_in_poly, point_in_ring, ring_area, simplify_ring, stitch

MIN_COVER = 0.9
HEIGHT_TOL_M = 8.0
HEIGHT_TOL_FRAC = 0.2
PARTS_RADIUS_M = 600.0
TALL_PARTS_M = 120.0              # footprints at least this tall beyond the radius get their parts read too (the skyline)
TALL_PARTS_MAX = 40               # ... for at most this many landmarks, tallest first
KINDS = ("podium", "tower", "setback", "bulkhead", "spire")
CONFIDENCE = ("high", "medium", "low", "assumed")
OSM_SOURCE = "OpenStreetMap contributors (ODbL), building:part"


# --------------------------------------------------------------------------- OpenStreetMap parts

def _min_height(tags: dict) -> tuple[float | None, str | None]:
    raw = tags.get("min_height") or tags.get("building:min_height")
    if raw:
        s = str(raw).lower().strip()
        ft = "ft" in s or "'" in s
        v = _num(s.replace("ft", "").replace("'", "").replace("m", "").strip())
        if v is not None and v >= 0:
            return v * (0.3048 if ft else 1), "osm-height"
    lv = _num(tags.get("building:min_level"))
    if lv is not None and lv >= 0:
        return lv * LEVEL_M, "osm-levels"
    return None, None


ROOF_SHAPES = {"flat": "flat", "pyramidal": "pyramid", "hipped": "hip", "half-hipped": "hip", "gabled": "gable",
               "dome": "dome", "cone": "pyramid", "skillion": "slope", "round": "dome", "onion": "dome"}
MATERIALS = {"glass": "glass", "brick": "brick", "stone": "stone", "limestone": "stone", "granite": "stone",
             "concrete": "concrete", "cement_block": "concrete", "metal": "metal", "steel": "metal", "copper": "metal",
             "plaster": "plaster", "stucco": "plaster"}
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_NAMED = {"white": "#f0f0f0", "grey": "#9a9a9a", "gray": "#9a9a9a", "black": "#2a2a2a", "red": "#a8483a",
          "brown": "#8a6a52", "beige": "#d6c7a1", "tan": "#c9b28a", "blue": "#5b7fa6", "green": "#5f8a78",
          "yellow": "#d8c47a", "silver": "#b8bec6", "cream": "#e8dcc0", "orange": "#c9803f"}


def _colour(v) -> str | None:
    s = str(v or "").strip().lower()
    return s if _HEX.match(s) else _NAMED.get(s)


def _roof(tags: dict, top: float, base: float) -> dict:
    """``roof:shape`` / ``roof:height`` (OSM: ``height`` includes the roof) -> {"roof": shape, "eave_m": wall top}.

    Only non-flat shapes are kept; ``roof:levels`` x 3.2 m stands in for a missing ``roof:height``.
    """
    shape = ROOF_SHAPES.get(str(tags.get("roof:shape") or "").lower())
    if shape in (None, "flat"):
        return {}
    rh = _num(tags.get("roof:height"))
    if rh is None:
        lv = _num(tags.get("roof:levels"))
        rh = lv * LEVEL_M if lv else None
    if rh is None or rh <= 0.5:
        return {}
    eave = top - rh
    out = {"roof": shape, "eave_m": round(max(eave, base), 1)}
    if shape == "slope":      # skillion: the bearing the roof falls toward
        d = _num(tags.get("roof:direction"))
        if d is None:
            from . import COMPASS_DEG
            d = COMPASS_DEG.get(str(tags.get("roof:direction") or "").upper())
        if d is not None:
            out["dir"] = int(round(d)) % 360
    return out


def parse_osm_parts(els: list[dict]) -> list[dict]:
    """Overpass ``out geom`` ways and relations tagged ``building:part`` -> parts with (lon, lat) rings.

    Parts without a usable top (no height and no levels) are skipped rather than guessed. Appearance tags that exist
    are kept for the 3D drawing only (``roof``/``eave_m`` from ``roof:shape``, ``mat`` from ``building:material``,
    ``col`` from ``building:colour``): none of them changes an obstruction.
    """
    out = []
    for e in els:
        tags = e.get("tags", {})
        if str(tags.get("building:part", "")).lower() in ("", "no"):
            continue
        top, top_src = _osm_height(tags)
        if top is None or top <= 0:
            continue
        base, base_src = _min_height(tags)
        base = base or 0.0
        if base >= top:
            continue
        polys: list[tuple[list, list]] = []
        if e.get("type") == "way":
            g = e.get("geometry") or []
            if len(g) >= 4:
                polys.append(([(p["lon"], p["lat"]) for p in g], []))
        elif e.get("type") == "relation":
            mem = [m for m in e.get("members", []) if m.get("type") == "way" and m.get("geometry")]
            outers = stitch([[(p["lon"], p["lat"]) for p in m["geometry"]] for m in mem if m.get("role") != "inner"])
            inners = stitch([[(p["lon"], p["lat"]) for p in m["geometry"]] for m in mem if m.get("role") == "inner"])
            for o in outers:
                polys.append((o, [h for h in inners if point_in_ring(h[0][0], h[0][1], o)]))
        levels = "osm-levels" in (top_src, base_src)
        look = _roof(tags, float(top), float(base))
        mat = MATERIALS.get(str(tags.get("building:material") or tags.get("material") or "").lower())
        col = _colour(tags.get("building:colour") or tags.get("colour"))
        if mat:
            look["mat"] = mat
        if col:
            look["col"] = col
        for ring, holes in polys:
            out.append({"osm": f"{e.get('type', 'way')}/{e['id']}", "ring": ring, "holes": holes,
                        "base_m": float(base), "top_m": float(top), "levels": levels, **look})
    return out


def parts_query(lat: float, lon: float, radius_m: float, tall: list[tuple[float, float, float]] | None = None) -> str:
    """Overpass query: every ``building:part`` within ``radius_m``, plus those around each tall building
    ``(lat, lon, radius)`` further out, which is where the skyline's landmarks stand (400 m reached only the
    near blocks, so the Empire State Building was one prism 380 m tall)."""
    around = [f'way["building:part"](around:{radius_m},{lat},{lon});',
              f'relation["building:part"]["type"="multipolygon"](around:{radius_m},{lat},{lon});']
    for tlat, tlon, tr in tall or []:
        around.append(f'way["building:part"](around:{tr:.0f},{tlat:.6f},{tlon:.6f});')
        around.append(f'relation["building:part"]["type"="multipolygon"](around:{tr:.0f},{tlat:.6f},{tlon:.6f});')
    return "[out:json][timeout:120];\n(" + "\n ".join(around) + ");\nout geom;"


def tall_query(tall: list[tuple[float, float, float]]) -> str:
    """Overpass query for the parts around some tall buildings only (one request per chunk of landmarks)."""
    around = []
    for tlat, tlon, tr in tall:
        around.append(f'way["building:part"](around:{tr:.0f},{tlat:.6f},{tlon:.6f});')
        around.append(f'relation["building:part"]["type"="multipolygon"](around:{tr:.0f},{tlat:.6f},{tlon:.6f});')
    return "[out:json][timeout:120];\n(" + "\n ".join(around) + ");\nout geom;"


TALL_CHUNK = 10


def fetch_osm_parts(lat: float, lon: float, radius_m: float = PARTS_RADIUS_M, cache_dir: Path | None = None,
                    refresh: bool = False, tall: list[tuple[float, float, float]] | None = None,
                    problems: list[str] | None = None) -> list[dict]:
    """Parts within ``radius_m`` (one request, as before: a failure raises) and around the tall landmarks (chunks of
    ``TALL_CHUNK``: a failed chunk is reported in ``problems`` and skipped, so the near blocks keep their parts)."""
    els = overpass(parts_query(lat, lon, radius_m), cache_dir, refresh=refresh)
    seen = {(e.get("type"), e.get("id")) for e in els}
    tall = tall or []
    for i in range(0, len(tall), TALL_CHUNK):
        try:
            more = overpass(tall_query(tall[i:i + TALL_CHUNK]), cache_dir, refresh=refresh)
        except RuntimeError as e:
            if problems is not None:
                problems.append(f"landmarks {i + 1}-{min(i + TALL_CHUNK, len(tall))}: {e}")
            continue
        for e in more:
            k = (e.get("type"), e.get("id"))
            if k not in seen:
                seen.add(k)
                els.append(e)
    return parse_osm_parts(els)


def tall_centres(site: dict, radius_m: float, min_h: float = TALL_PARTS_M, limit: int = TALL_PARTS_MAX
                 ) -> list[tuple[float, float, float]]:
    """(lat, lon, search radius) around the tallest footprints beyond ``radius_m`` of the origin (their parts are read)."""
    F = LocalFrame(site["origin"]["lat"], site["origin"]["lon"])
    rows = []
    for top, g, _t, flat in site["b"]:
        if top - g < min_h:
            continue
        ring = _ring_xy(flat)
        if len(ring) < 3:
            continue
        cx, cy = _centroid(ring)
        if math.hypot(cx, cy) <= radius_m:
            continue
        x0, y0, x1, y1 = bbox(ring)
        r = max(25.0, 0.5 * math.hypot(x1 - x0, y1 - y0) + 12.0)
        lon, lat = F.to_lonlat(cx, cy)
        rows.append((top - g, lat, lon, r))
    rows.sort(reverse=True)
    return [(lat, lon, r) for _h, lat, lon, r in rows[:limit]]


# --------------------------------------------------------------------------- assigning parts to footprints

def _ring_xy(flat: list[float]) -> list[tuple[float, float]]:
    return list(zip(flat[0::2], flat[1::2]))


def _centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    a = cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        c = x1 * y2 - x2 * y1
        a += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    if abs(a) < 1e-9:
        return sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n
    return cx / (3 * a), cy / (3 * a)


def _rep_point(ring: list[tuple[float, float]]) -> tuple[float, float]:
    """A point inside the ring: the centroid, else the middle of the first interior horizontal chord."""
    cx, cy = _centroid(ring)
    if point_in_ring(cx, cy, ring):
        return cx, cy
    xs = []
    n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        if (y1 > cy) != (y2 > cy):
            xs.append(x1 + (cy - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    return ((xs[0] + xs[1]) / 2, cy) if len(xs) >= 2 else (cx, cy)


def coverage(outer: list, holes: list, parts: list[list]) -> float:
    """Share of a footprint (outer minus holes) covered by the union of part rings, on a sample grid."""
    x0, y0, x1, y1 = bbox(outer)
    area = abs(ring_area(outer)) or 1.0
    step = max(0.75, math.sqrt(area / 900))
    boxes = [(bbox(p), p) for p in parts]
    inside = covered = 0
    y = y0 + step / 2
    while y < y1:
        x = x0 + step / 2
        while x < x1:
            if point_in_poly(x, y, outer, holes):
                inside += 1
                for (bx0, by0, bx1, by1), p in boxes:
                    if bx0 <= x <= bx1 and by0 <= y <= by1 and point_in_ring(x, y, p):
                        covered += 1
                        break
            x += step
        y += step
    return covered / inside if inside else 0.0


def _is_spire(p: dict) -> bool:
    return p["base_m"] > 1.0 and abs(ring_area(p["ring"])) < 60 and p["top_m"] - p["base_m"] >= 15


def classify(parts: list[dict]) -> list[str]:
    """podium / tower / setback / bulkhead / spire for stacked parts of one building.

    spire: a slim mast or finial (< 60 m2, at least 15 m tall, raised); bulkhead: small (< 150 m2), short (<= 12 m)
    and raised; tower: reaches 85% of the building's top (spires not counted); podium: from the ground to at most
    half the top; setback: any other stepped mass.
    """
    spire = [_is_spire(p) for p in parts]
    top = max((p["top_m"] for p, sp in zip(parts, spire) if not sp), default=max(p["top_m"] for p in parts))
    out = []
    for p, sp in zip(parts, spire):
        area = abs(ring_area(p["ring"]))
        if sp:
            out.append("spire")
        elif p["base_m"] > 1.0 and area < 150 and p["top_m"] - p["base_m"] <= 12:
            out.append("bulkhead")
        elif p["top_m"] >= 0.85 * top:
            out.append("tower")
        elif p["base_m"] <= 1.0 and p["top_m"] <= 0.5 * top:
            out.append("podium")
        else:
            out.append("setback")
    return out


def _local(F: LocalFrame, ring, tol: float = 0.3) -> list[tuple[float, float]]:
    return simplify_ring(clean_ring([F.to_xy(lo, la) for lo, la in ring]), tol)


def _r(ring) -> list[list[float]]:
    return [[round(float(x), 1), round(float(y), 1)] for x, y in ring]


def derive_components(site: dict, parts: list[dict], min_cover: float = MIN_COVER) -> tuple[dict, dict]:
    """OSM parts -> site components per footprint. Returns (components, info).

    info: {"parts": n parts read, "buildings": n footprints split, "partial": n footprints whose parts
    cover less than ``min_cover``, "height_mismatch": n footprints whose parts disagree with the roof}.
    """
    F = LocalFrame(site["origin"]["lat"], site["origin"]["lon"])
    holes_all = site.get("holes") or {}
    rows = []
    for i, (top, g, _t, flat) in enumerate(site["b"]):
        ring = _ring_xy(flat)
        rows.append((bbox(ring), ring, [[tuple(p) for p in h] for h in holes_all.get(str(i), [])], top - g))
    meta = site.get("bmeta") or []
    groups: dict[int, list[dict]] = {}
    for p in parts:
        ring = _local(F, p["ring"])
        if len(ring) < 3 or abs(ring_area(ring)) < 2:
            continue
        holes = [h for h in (_local(F, r) for r in p.get("holes") or []) if len(h) >= 3]
        px, py = _rep_point(ring)
        for i, ((bx0, by0, bx1, by1), outer, bh, _h) in enumerate(rows):
            if bx0 - 1 <= px <= bx1 + 1 and by0 - 1 <= py <= by1 + 1 and point_in_ring(px, py, outer):
                groups.setdefault(i, []).append({**p, "ring": ring, "holes": holes})
                break
    comps: dict[str, list[dict]] = {}
    info = {"parts": len(parts), "buildings": 0, "partial": 0, "height_mismatch": 0}
    for i, ps in sorted(groups.items()):
        _bb, outer, bh, h = rows[i]
        cov = coverage(outer, bh, [p["ring"] for p in ps])
        if cov < min_cover:
            info["partial"] += 1
            continue
        top = max((p["top_m"] for p in ps if not _is_spire(p)), default=max(p["top_m"] for p in ps))
        hsrc = (meta[i] if i < len(meta) and meta[i] else {}).get("height_src")
        if hsrc != "default" and abs(top - h) > max(HEIGHT_TOL_M, HEIGHT_TOL_FRAC * h):
            info["height_mismatch"] += 1
            continue
        kinds = classify(ps)
        out = []
        for p, k in sorted(zip(ps, kinds), key=lambda pk: (pk[0]["base_m"], -pk[0]["top_m"])):
            typ, oid = p["osm"].split("/", 1)
            c = {"ring": _r(p["ring"]), "base_m": round(p["base_m"], 1), "top_m": round(p["top_m"], 1), "kind": k,
                 "source": f"osm {typ} {oid}", "confidence": "low" if p["levels"] else "medium"}   # the link is rebuilt from the source
            if p["holes"]:
                c["holes"] = [_r(hh) for hh in p["holes"]]
            for key in ("roof", "eave_m", "dir", "mat", "col"):   # appearance tags: drawn, never used in an obstruction
                if p.get(key) is not None:
                    c[key] = p[key]
            out.append(c)
        comps[str(i)] = out
        info["buildings"] += 1
    return comps, info


# --------------------------------------------------------------------------- manual overrides

def _select(site: dict, sel, F: LocalFrame, lonlat: bool) -> int | None:
    """Building index for a selector: "target", {"b": i}, {"bin": str}, {"bbl": str} or {"at": [x, y]}."""
    if sel == "target" or (isinstance(sel, dict) and sel.get("target")):
        return site.get("target")
    if not isinstance(sel, dict):
        return None
    n = len(site["b"])
    if "b" in sel:
        try:
            i = int(sel["b"])
        except (TypeError, ValueError):
            return None
        return i if 0 <= i < n else None
    meta = site.get("bmeta") or []
    for key in ("bin", "bbl"):
        if key in sel:
            want = str(sel[key]).split(".")[0].strip()
            hits = [i for i, m in enumerate(meta) if m and str(m.get(key) or "") == want]
            return max(hits, key=lambda i: site["b"][i][0]) if hits else None
    if "at" in sel:
        try:
            x, y = (float(v) for v in sel["at"][:2])
        except (TypeError, ValueError):
            return None
        if lonlat:
            x, y = F.to_xy(x, y)
        for i, (_top, _g, _t, flat) in enumerate(site["b"]):
            if point_in_ring(x, y, _ring_xy(flat)):
                return i
    return None


def load_overrides(path: Path, site: dict) -> tuple[dict, list[str]]:
    """Manual components from ``<search>/sites/<id>.components.yaml``. Returns (components, problems).

    Format::

        lonlat: false              # true: rings and "at" are [lon, lat] instead of local metres
        buildings:
          - select: target         # or {bin: "1012345"}, {bbl: "1008350001"}, {b: 12}, {at: [x, y]}
            components:
              - kind: podium       # podium | tower | setback | bulkhead
                ring: footprint    # the building's own outline, or [[x, y], ...]
                base_m: 0          # metres above the building's own ground
                top_m: 24
                source: "DOB zoning diagram, job 123456789"   # required: where the numbers come from
                confidence: high   # high | medium | low (default medium)
                ref: https://...   # optional link
    """
    import yaml

    try:
        doc = yaml.safe_load(Path(path).read_text()) or {}
    except (OSError, yaml.YAMLError) as e:
        return {}, [f"could not read {Path(path).name}: {e}"]
    F = LocalFrame(site["origin"]["lat"], site["origin"]["lon"])
    lonlat = bool(doc.get("lonlat"))
    out: dict[str, list[dict]] = {}
    problems: list[str] = []
    for k, entry in enumerate(doc.get("buildings") or []):
        if not isinstance(entry, dict):
            problems.append(f"entry {k + 1}: not a mapping")
            continue
        i = _select(site, entry.get("select", "target"), F, lonlat)
        if i is None:
            problems.append(f"entry {k + 1}: no building matches {entry.get('select')!r}")
            continue
        top, g, _t, flat = site["b"][i]
        comps = []
        for j, c in enumerate(entry.get("components") or []):
            where = f"entry {k + 1} component {j + 1}"
            if not isinstance(c, dict):
                problems.append(f"{where}: not a mapping")
                continue
            ring = c.get("ring")
            if ring == "footprint":
                ring = _ring_xy(flat)
            elif isinstance(ring, list):
                try:
                    ring = [(float(p[0]), float(p[1])) for p in ring]
                except (TypeError, ValueError, IndexError):
                    ring = None
                if ring and lonlat:
                    ring = [F.to_xy(x, y) for x, y in ring]
            else:
                ring = None
            base, topm = _num(c.get("base_m", 0)), _num(c.get("top_m"))
            if not ring or len(ring) < 3:
                problems.append(f"{where}: ring needs 3 or more points (or 'footprint')")
                continue
            if base is None or topm is None or not 0 <= base < topm:
                problems.append(f"{where}: needs 0 <= base_m < top_m")
                continue
            if not str(c.get("source") or "").strip():
                problems.append(f"{where}: source is required")
                continue
            kind = str(c.get("kind") or "").lower()
            conf = str(c.get("confidence") or "medium").lower()
            item = {"ring": _r(ring), "base_m": round(base, 1), "top_m": round(topm, 1),
                    "kind": kind if kind in KINDS else "setback" if base > 0 else "podium",
                    "source": "manual: " + str(c["source"]).strip()[:200],
                    "confidence": conf if conf in CONFIDENCE else "medium"}
            if c.get("ref"):
                item["ref"] = str(c["ref"])[:400]
            comps.append(item)
        if comps:
            out[str(i)] = comps
    return out, problems


def build_components(site: dict, parts: list[dict] | None, overrides: Path | None = None) -> tuple[dict, dict]:
    """OSM-derived components, then manual overrides on top. Returns (components, info)."""
    comps, info = derive_components(site, parts) if parts else ({}, {"parts": 0, "buildings": 0, "partial": 0,
                                                                      "height_mismatch": 0})
    info["radius_m"] = PARTS_RADIUS_M
    if overrides is not None and Path(overrides).exists():
        man, problems = load_overrides(overrides, site)
        comps.update(man)
        info["manual"] = len(man)
        if problems:
            info["problems"] = problems
    return comps, info
