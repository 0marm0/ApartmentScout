"""Shareable shortlist and decision memo: one read-only HTML file built from the renter's saved picks.

The page itself is ``dashboard/share/snapshot.html``, a single template shared by this module and by the dashboard's
"Share shortlist" and "Decision memo" buttons (``dashboard/js/features/share-model.js`` fills the same template in the
browser). The template carries an ``as-schema`` block listing exactly which fields may travel, and an ``as-data`` block
this module fills with a payload; a small script on the page draws the cards, the map and the memo from that payload.
Nothing is fetched at view time.

Privacy: only schema fields are copied (no research notes, no commute grids, no dossiers). The renter's own notes are
included only on request, and tour times never are.
"""
from __future__ import annotations

import base64
import io
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable

DASH = Path(__file__).resolve().parent.parent / "dashboard"
TEMPLATE = DASH / "share" / "snapshot.html"
SCHEMA_RE = re.compile(r'<script type="application/json" id="as-schema">\s*(.*?)\s*</script>', re.S)
DATA_RE = re.compile(r'(<script type="application/json" id="as-data">)null(</script>)')
DEFAULT_DIMS = [["cost", "Cost"], ["space", "Space"], ["commute", "Commute"], ["amenities", "Amenities"], ["light_view", "Light & view"],
                ["building", "Building"], ["interior", "Interior"], ["quiet", "Quiet"]]
TIERS = ("S", "A", "B", "C", "Pass")
SOURCE = "Made with ApartmentScout (apartmentscout share)"


# --------------------------------------------------------------------------- template and schema
def load_template(path: Path | None = None) -> str:
    return (path or TEMPLATE).read_text(encoding="utf-8")


def load_schema(template: str) -> dict:
    m = SCHEMA_RE.search(template)
    if not m:
        raise ValueError("the share template has no as-schema block")
    return json.loads(m.group(1))


def inline_payload(template: str, payload: dict) -> str:
    """The template with the payload in its as-data block ('</' and the line separators escaped so it cannot end the tag)."""
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
    blob = blob.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    out, n = DATA_RE.subn(lambda m: m.group(1) + blob + m.group(2), template, count=1)
    if n != 1:
        raise ValueError("the share template has no empty as-data block")
    return out


# --------------------------------------------------------------------------- pruning
def _num(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _rnd(x: float, d: int) -> float:
    f = 10 ** d
    return math.floor(x * f + 0.5) / f   # round half up, like the browser's builder


def _cut(s: Any, n: int) -> Any:
    if isinstance(s, str) and len(s) > n:
        return s[: max(0, n - 1)].rstrip() + "\u2026"
    return s


def _tidy(v: Any) -> Any:
    """Round floats (5 decimals, 2 for big numbers; half up, like the browser's builder). The schema already chose the keys."""
    if isinstance(v, float) and v != int(v):
        return _rnd(v, 5) if abs(v) < 1000 else _rnd(v, 2)
    if isinstance(v, dict):
        return {k: _tidy(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_tidy(x) for x in v]
    return v


def pick_keys(obj: Any, keys: Iterable[str]) -> dict:
    if not isinstance(obj, dict):
        return {}
    return {k: obj[k] for k in keys if k in obj and obj[k] is not None}


def prune_commute(entry: Any, schema: dict) -> dict | None:
    """One destination's commute entry reduced to what the page shows: minutes per mode and the legs of the ride."""
    if not isinstance(entry, dict):
        return None
    out = pick_keys(entry, [k for k in schema["commute"] if k != "modes"])
    modes: dict = {}
    for mode in schema["commute_modes"]:
        m = (entry.get("modes") or {}).get(mode)
        if isinstance(m, dict):
            mm = pick_keys(m, [k for k in schema["commute_mode"] if k != "legs"])
            if isinstance(m.get("legs"), list):
                mm["legs"] = [pick_keys(leg, schema["commute_leg"]) for leg in m["legs"] if isinstance(leg, dict)]
            modes[mode] = mm
    if modes:
        out["modes"] = modes
    return out or None


def prune_home(L: dict, schema: dict, dest_name: str | None, pick: dict | None, include_notes: bool) -> dict:
    """The listing reduced to the schema's fields (nested fields too). ``pick`` is the renter's tier and note."""
    tm = schema["text_max"]
    h = pick_keys(L, schema["listing"])
    for key, sub in (("price", "price"), ("score", "score"), ("size", "size"), ("site", "site"), ("records", "records"), ("reviews", "reviews"),
                     ("photo_review", "photo_review"), ("building_facts", "building_facts"), ("links", "links")):
        if key in h:
            h[key] = pick_keys(h[key], schema[sub])
    h["notes"] = _cut(h.get("notes"), tm["notes"]) if h.get("notes") else None
    if h.get("reviews"):
        r = h["reviews"]
        r["summary"] = _cut(r.get("summary"), tm["summary"])
        r["questions"] = _cut(r.get("questions"), tm["questions"])
    if h.get("photo_review") and h["photo_review"].get("evidence"):
        h["photo_review"]["evidence"] = _cut(h["photo_review"]["evidence"], tm["evidence"])
    if h.get("records") and h["records"].get("flags"):
        h["records"]["flags"] = [_cut(f, tm["flag"]) for f in h["records"]["flags"][:5]]
    if h.get("links"):
        h["links"] = {k: v for k, v in h["links"].items() if isinstance(v, str) and re.match(r"https?://", v)}
    c = prune_commute((L.get("commute") or {}).get(dest_name), schema) if dest_name else None
    if c:
        h["commute"] = c
    p = {}
    if pick:
        if pick.get("tier") in TIERS:
            p["tier"] = pick["tier"]
        if include_notes and pick.get("note"):
            p["note"] = _cut(str(pick["note"]), tm["pick_note"])
    h["pick"] = p
    return {k: _tidy(v) for k, v in h.items() if v not in (None, {}, [])} | {"pick": p}


# --------------------------------------------------------------------------- scores and reasons
def dim_list(crit: dict) -> list[list[str]]:
    d = (crit.get("scoring") or {}).get("dimensions")
    return [list(x) for x in d] if d else DEFAULT_DIMS


def weighted_score(L: dict, weights: dict, dims: list[list[str]]) -> float | None:
    """The overall score under ``weights``: dimension scores weighted, an unknown one counting as a neutral 50 (the same
    formula as rescore() in dashboard/js/app.js)."""
    parts = (L.get("score") or {}).get("parts") or {}
    tot = sum(_num(weights.get(k)) or 0 for k, _ in dims) or 1
    if parts:
        return sum((_num(weights.get(k)) or 0) * (parts.get(k) if parts.get(k) is not None else 50) for k, _ in dims) / tot
    return (L.get("score") or {}).get("overall")


def order_key(L: dict, weights: dict, dims: list[list[str]]):
    """score desc, then confidence desc, lower monthly cost, then id: the scorer's tie-break (and the dashboard's)."""
    s = weighted_score(L, weights, dims)
    sc = L.get("score") or {}
    return (-(s if s is not None else -1), -(sc.get("confidence") or 0), sc.get("monthly_cost") if sc.get("monthly_cost") is not None else 1e9, L.get("id") or "")


def reasons_for(L: dict, weights: dict, dims: list[list[str]]) -> list[dict]:
    """"Why it ranks here": the scorer's sentences with points recomputed under ``weights`` (as reasons() in app.js)."""
    labels = dict(dims)
    sc = L.get("score") or {}
    parts = sc.get("parts") or {}
    tot = sum(_num(weights.get(k)) or 0 for k, _ in dims) or 1
    src = sc.get("reasons") or [
        {"dim": k, "text": f"{labels[k]}: " + ("unknown, counted as neutral" if parts.get(k) is None else f"{round(parts[k])} / 100")} for k, _ in dims]
    out = []
    for r in src:
        w = _num(weights.get(r.get("dim"))) or 0
        if w <= 0:
            continue
        pts = ((parts.get(r.get("dim")) if parts.get(r.get("dim")) is not None else 50) - 50) * w / tot
        text = str(r.get("text") or "")
        tail = text[text.index(": ") + 2:] if ": " in text else text
        out.append({"label": labels.get(r.get("dim"), r.get("dim")), "pts": _rnd(pts, 2), "sentence": tail, "weight": w})
    return sorted(out, key=lambda x: -abs(x["pts"]))


def weight_rows(weights: dict, dims: list[list[str]]) -> list[dict]:
    tot = sum(_num(weights.get(k)) or 0 for k, _ in dims)
    return [{"k": k, "label": lab, "w": _num(weights.get(k)) or 0, "pct": round(((_num(weights.get(k)) or 0) / tot) * 100) if tot else 0} for k, lab in dims]


# --------------------------------------------------------------------------- the map
def _metres(a: list[float], b: list[float]) -> float:
    return math.hypot((b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2)) * 111320, (b[1] - a[1]) * 110574)


def simplify_lines(features: Iterable[dict], bbox: list[float], opts: dict) -> list[dict]:
    """Subway line geometry reduced for the page: only what crosses ``bbox`` (west, south, east, north), vertices closer
    than ``min_spacing_m`` thinned out, coordinates rounded, and grouped by colour. If the result is too big the spacing
    doubles until it fits ``max_points``. The same algorithm runs in share-model.js (a shared fixture tests both)."""
    d, spacing = opts["decimals"], float(opts["min_spacing_m"])
    w, s, e, n = bbox

    def inside(p: list[float]) -> bool:
        return w <= p[0] <= e and s <= p[1] <= n

    def runs_of(line: list[list[float]], spc: float) -> list[list[list[float]]]:
        flags = [inside(p) for p in line]
        keep = [flags[i] or (i > 0 and flags[i - 1]) or (i + 1 < len(line) and flags[i + 1]) for i in range(len(line))]
        runs, cur = [], []
        for i, p in enumerate(line):
            if keep[i]:
                cur.append(p)
            elif cur:
                runs.append(cur)
                cur = []
        if cur:
            runs.append(cur)
        out = []
        for run in runs:
            thin = [run[0]]
            for p in run[1:-1]:
                if _metres(thin[-1], p) >= spc:
                    thin.append(p)
            if len(run) > 1:
                thin.append(run[-1])
            if len(thin) >= 2:
                out.append([[_rnd(p[0], d), _rnd(p[1], d)] for p in thin])
        return out

    lines = []
    for f in features:
        pr = f.get("properties") or {}
        g = f.get("geometry") or {}
        if pr.get("kind") != "line":
            continue
        ls = g.get("coordinates") if g.get("type") == "MultiLineString" else [g.get("coordinates")] if g.get("type") == "LineString" else []
        lines.append((str(pr.get("color") or ""), [ln for ln in ls if ln]))
    for _ in range(6):
        groups: dict[str, list] = {}
        total = 0
        for color, ls in lines:
            for ln in ls:
                for run in runs_of(ln, spacing):
                    groups.setdefault(color, []).append(run)
                    total += len(run)
        if total <= opts["max_points"]:
            break
        spacing *= 2
    return [{"c": c, "d": runs} for c, runs in groups.items()]


def home_bbox(points: list[tuple[float, float]], pad: float) -> list[float]:
    """(west, south, east, north) around the points, padded by ``pad`` of the larger span (at least 0.006 degrees)."""
    lons, lats = [p[0] for p in points], [p[1] for p in points]
    span = max(max(lons) - min(lons), max(lats) - min(lats), 0.006)
    m = span * pad * 1.6   # the page pads by `pad` of the span; the lines get a little more so none stops short of the frame
    return [min(lons) - m, min(lats) - m, max(lons) + m, max(lats) + m]


# --------------------------------------------------------------------------- photos
def _thumb_data_uri(path: Path, px: int, quality: float) -> str | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            if im.width > px:
                im = im.resize((px, max(1, round(im.height * px / im.width))))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=int(quality * 100), optimize=True, progressive=True)
    except Exception:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def photo_candidates(L: dict) -> list[dict]:
    """The home's own photos first, then licensed building photos: [{local, ref, credit}]. ``local`` is a path under the
    search's media/ folder, ``ref`` an http(s) link to the original."""
    loc = [u for u in (L.get("photos_local") or []) if isinstance(u, str)]
    web = [u for u in (L.get("photos") or []) if isinstance(u, str)]
    out: list[dict] = []
    for i in range(max(len(loc), len(web))):
        w = web[i] if i < len(web) else None
        local = loc[i] if i < len(loc) else (w if w and w.startswith("media/") else None)
        ref = w if w and w.startswith(("http://", "https://")) else None
        if local or ref:
            out.append({"local": local, "ref": ref, "credit": None})
    for b in L.get("building_photos") or []:
        if not isinstance(b, dict):
            continue
        u = b.get("url") if isinstance(b.get("url"), str) else None
        local = b.get("local") if isinstance(b.get("local"), str) and b["local"].startswith("media/") else (u if u and u.startswith("media/") else None)
        ref = u if u and u.startswith(("http://", "https://")) else None
        credit = " · ".join(x for x in [b.get("author"), b.get("license")] if x) if (b.get("author") or b.get("license_url")) else None
        if local or ref:
            out.append({"local": local, "ref": ref, "credit": credit})
    seen, uniq = set(), []
    for c in out:
        k = c["local"] or c["ref"]
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    return uniq


def attach_photos(homes: list[dict], listings: list[dict], root: Path | None, schema: dict, enabled: bool = True,
                  budget_kb: float | None = None) -> int:
    """Give each home up to ``max_per_home`` photos: an embedded thumbnail from the saved local copy while the byte
    budget lasts (the first photo of every home before anyone's second), else a link. Returns the bytes embedded."""
    cfg = schema["photos"]
    if not enabled:
        return 0
    budget = (budget_kb if budget_kb is not None else cfg["budget_kb"]) * 1024
    used = 0
    cands = [photo_candidates(L) for L in listings]
    chosen: list[list[dict]] = [[] for _ in homes]
    for rnd in range(cfg["max_per_home"]):
        for hi, cs in enumerate(cands):
            if len(chosen[hi]) > rnd:
                continue
            for c in cs:
                if c.get("done"):
                    continue
                c["done"] = True
                src = None
                if c["local"] and root is not None and (root / c["local"]).is_file() and used < budget:
                    uri = _thumb_data_uri(root / c["local"], cfg["thumb_px"], cfg["quality"])
                    if uri and used + len(uri) <= budget:
                        src, used = uri, used + len(uri)
                if src is None and c["ref"]:
                    src = c["ref"]
                if src:
                    chosen[hi].append({"src": src, **({"credit": c["credit"]} if c["credit"] else {})})
                    break
    for h, ph in zip(homes, chosen):
        if ph:
            h["photos"] = ph
    return used


# --------------------------------------------------------------------------- the payload
def read_picks(raw: Any) -> tuple[dict[str, dict], dict | None]:
    """Picks as {id: {tier, note, saved}} and the weights they were made with, from a dashboard backup
    ({version, search, picks: {...}, weights}), a plain list of ids, or {"ids": [...]}."""
    if isinstance(raw, list):
        return {str(i): {"saved": True} for i in raw if isinstance(i, str)}, None
    if not isinstance(raw, dict):
        raise ValueError("picks file must hold a picks backup from the dashboard or a list of listing ids")
    if isinstance(raw.get("ids"), list):
        return {str(i): {"saved": True} for i in raw["ids"] if isinstance(i, str)}, raw.get("weights") if isinstance(raw.get("weights"), dict) else None
    picks = raw.get("picks")
    if not isinstance(picks, dict):
        raise ValueError("picks file has no 'picks' object: use the dashboard's Back up picks file")
    out = {str(k): v for k, v in picks.items() if isinstance(v, dict)}
    return out, raw.get("weights") if isinstance(raw.get("weights"), dict) else None


def chosen_ids(picks: dict[str, dict], known: set[str]) -> tuple[list[str], list[str]]:
    """Saved or tiered picks that exist in the listings (Pass excluded), and the ids the listings do not know."""
    ids = [i for i, p in picks.items() if (p.get("saved") or p.get("tier")) and p.get("tier") != "Pass"]
    return [i for i in ids if i in known], [i for i in ids if i not in known]


def build_payload(listings: list[dict], crit: dict, picks: dict[str, dict], *, weights: dict | None = None, include_notes: bool = False,
                  view: str = "cards", title: str | None = None, root: Path | None = None, with_photos: bool = True,
                  photo_budget_kb: float | None = None, transit_features: list[dict] | None = None, generated: str | None = None,
                  template: str | None = None, findings: dict[str, dict] | None = None, trail: list[dict] | None = None,
                  tour_photos: bool = False) -> dict:
    import datetime as dt
    from . import tours as tours_mod   # tour findings and the decision trail ride along when there are any
    template = template or load_template()
    schema = load_schema(template)
    dims = dim_list(crit)
    w = {**(crit.get("weights") or {}), **(weights or {})}
    byid = {L["id"]: L for L in listings if L.get("id")}
    ids, _ = chosen_ids(picks, set(byid))
    dests = (crit.get("commute") or {}).get("destinations") or []
    d0 = dests[0] if dests else None
    chosen = sorted((byid[i] for i in ids), key=lambda L: order_key(L, w, dims))
    homes = []
    extras = tours_mod.share_extras(byid, [L["id"] for L in chosen], findings or {}, trail or [], notes=include_notes, photos=tour_photos,
                                    root=root, cfg=schema.get("tour_photos")) if (findings or trail) else {}
    for L in chosen:
        h = prune_home(L, schema, d0.get("name") if d0 else None, picks.get(L["id"]), include_notes)
        h["reasons"] = reasons_for(L, w, dims)
        x = extras.get(L["id"]) or {}
        if x.get("tour"):
            h["tour"] = pick_keys(x["tour"], schema["tour"])
        if x.get("trail"):
            h["trail"] = [pick_keys(t, schema["trail"]) for t in x["trail"]]
        homes.append(h)
    dest = {"name": d0["name"], "lat": d0.get("lat"), "lon": d0.get("lon"), "arrive_by": d0.get("arrive_by")} if d0 and d0.get("lat") is not None else None
    pts = [(h["lon"], h["lat"]) for h in homes if h.get("lat") is not None and h.get("lon") is not None] + ([(dest["lon"], dest["lat"])] if dest else [])
    mp: dict = {}
    if pts and transit_features:
        mp["lines"] = simplify_lines(transit_features, home_bbox(pts, schema["map"]["pad"]), schema["map"])
    embedded = attach_photos(homes, chosen, root, schema, enabled=with_photos, budget_kb=photo_budget_kb)
    s = crit.get("search") or {}
    payload = {
        "v": schema["version"], "view": view, "generated": generated or dt.date.today().isoformat(), "source": SOURCE, "notes": bool(include_notes),
        "search": {"name": s.get("name"), "city": s.get("city")}, "dest": dest, "commute": {"mode": "best"}, "weights": weight_rows(w, dims),
        "homes": homes, "map": mp, "photo_bytes": embedded,
    }
    if title:
        payload["title"] = title
    return payload


def transit_lines(root: Path) -> list[dict]:
    """The subway-lines layer of a search folder (layers/transit*.json), or []."""
    d = root / "layers"
    for p in sorted(d.glob("transit*.json")) if d.is_dir() else []:
        try:
            g = json.loads(p.read_text())
        except ValueError:
            continue
        if isinstance(g, dict) and isinstance(g.get("features"), list):
            return g["features"]
    return []


def render(listings: list[dict], crit: dict, picks: dict[str, dict], **kw: Any) -> str:
    """The finished HTML for a set of picks (see build_payload for the options)."""
    template = load_template()
    return inline_payload(template, build_payload(listings, crit, picks, template=template, **kw))
