"""The decision report: a typeset, print-ready document comparing two to four homes.

The page is ``dashboard/report/report.html``, one template shared by this module and by the dashboard's "Make a report" button
(``dashboard/js/features/report-model.js`` fills the same template in the browser). The template carries an ``as-schema`` block
listing exactly which fields may travel and an ``as-data`` block this module fills with a payload; the script on the page draws a
cover with the recommendation, a side-by-side table, one page per home and a final checklist from that payload. Every rule (which
home leads and why, what is still unknown) lives in the page's ``as-core`` script, so the two builders only prune and attach.

It reuses the shortlist page's pruning, scoring and photo code (``share.py``): same schema mechanism, same privacy rules. The
renter's own notes (their pick notes, visit notes and decision trail) are included only with ``include_notes``; tour times never are.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

from . import share as sh
from . import tours as tours_mod
from .mediabase import media_base_url

DASH = sh.DASH
TEMPLATE = DASH / "report" / "report.html"
FONT_FILE = DASH / "vendor" / "fonts" / "Geist-Variable.woff2"
FONTS_RE = re.compile(r"(<style id=\"as-fonts\">)/\*as-fonts\*/(</style>)")
SOURCE = "Made with ApartmentScout (apartmentscout report)"
MIN_HOMES, MAX_HOMES = 1, 4   # the CLI and the dashboard ask for two to four; one is allowed so a single home can be printed
RENEWAL_DIMS = {"renewal": "renewal_risk", "move": "move_date"}
PLAN_KEYS = ("name", "kind", "poly")


class ReportError(ValueError):
    """The report cannot be made; the message says why."""


# --------------------------------------------------------------------------- template, fonts
def load_template(path: Path | None = None) -> str:
    return (path or TEMPLATE).read_text(encoding="utf-8")


def font_css(path: Path | None = None) -> str:
    """The Geist variable font as a base64 @font-face (the dashboard's own typeface), or "" when the file is missing."""
    f = path or FONT_FILE
    if not f.is_file():
        return ""
    b64 = base64.b64encode(f.read_bytes()).decode()
    return (f'@font-face{{font-family:"Geist";src:url("data:font/woff2;base64,{b64}") format("woff2");'
            "font-weight:100 900;font-style:normal;font-display:block}")


def inline_fonts(template: str, css: str | None = None) -> str:
    css = font_css() if css is None else css
    return FONTS_RE.sub(lambda m: m.group(1) + css + m.group(2), template, count=1)


# --------------------------------------------------------------------------- pieces of a home
def _tail(text: str) -> str:
    text = str(text or "")
    return text[text.index(": ") + 2:] if ": " in text else text


def lease_lines(L: dict) -> dict[str, str]:
    """The scorer's sentences about renewal risk and the move date, for the table's "Renewal risk" row."""
    out = {}
    for r in (L.get("score") or {}).get("reasons") or []:
        for key, dim in RENEWAL_DIMS.items():
            if r.get("dim") == dim and r.get("text"):
                out[key] = _tail(r["text"])
    return out


def prune_plan(plan: Any, schema: dict) -> dict | None:
    """The plan reduced to what the thumbnail draws: rooms (name, kind, polygon), windows and doors, in the plan's own units."""
    if not isinstance(plan, dict) or not isinstance(plan.get("rooms"), list):
        return None
    rooms = [{k: r[k] for k in PLAN_KEYS if k in r} for r in plan["rooms"] if isinstance(r, dict) and isinstance(r.get("poly"), list)]
    if not rooms:
        return None

    def seg(o: Any) -> dict | None:
        if not isinstance(o, dict):
            return None
        if all(isinstance(o.get(k), (int, float)) for k in ("x1", "y1", "x2", "y2")):
            return {k: sh._rnd(float(o[k]), 1) for k in ("x1", "y1", "x2", "y2")}
        a, b = o.get("a"), o.get("b")
        if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)) and len(a) == 2 and len(b) == 2:
            return {"a": [sh._rnd(float(a[0]), 1), sh._rnd(float(a[1]), 1)], "b": [sh._rnd(float(b[0]), 1), sh._rnd(float(b[1]), 1)]}
        return None

    for r in rooms:
        r["poly"] = [[sh._rnd(float(p[0]), 1), sh._rnd(float(p[1]), 1)] for p in r["poly"] if isinstance(p, (list, tuple)) and len(p) == 2]
    out: dict[str, Any] = {"units": plan.get("units") if plan.get("units") in ("ft", "in", "m") else "in", "rooms": rooms,
                           "windows": [s for s in map(seg, plan.get("windows") or []) if s],
                           "doors": [s for s in map(seg, plan.get("doors") or []) if s]}
    if isinstance(plan.get("up_bearing"), (int, float)):
        out["up_bearing"] = sh._rnd(float(plan["up_bearing"]), 1)
    return {k: v for k, v in out.items() if v not in (None, [], {})}


def load_plan(root: Path | None, listing_id: str) -> dict | None:
    if root is None or not re.match(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$", listing_id):
        return None
    f = root / "plans" / f"{listing_id}.json"
    try:
        return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else None
    except (OSError, ValueError):
        return None


def open_questions(L: dict, crit: dict, limit: int = 8, schema: dict | None = None) -> list[dict]:
    """The leasing-office questions still open for a home (what `apartmentscout questions` would draft), as [{text, kind}]."""
    from . import office_questions as oq
    cap = ((schema or {}).get("text_max") or {}).get("question", 260)
    try:
        qs = oq.unit_questions(L, crit)
    except Exception:   # noqa: BLE001 - a home whose questions cannot be built is still reported, without them
        return []
    return [{"text": sh._cut(q["text"], cap), "kind": q["kind"]} for q in qs[:limit]]


# --------------------------------------------------------------------------- the payload
def build_payload(listings: list[dict], crit: dict, ids: list[str], *, picks: dict[str, dict] | None = None, weights: dict | None = None,
                  include_notes: bool = False, tour_photos: bool = False, root: Path | None = None, with_photos: bool = True,
                  photo_budget_kb: float | None = None, findings: dict[str, dict] | None = None, trail: list[dict] | None = None,
                  stills: dict[str, dict] | None = None, title: str | None = None, generated: str | None = None, paper: str | None = None,
                  template: str | None = None) -> dict:
    """The payload the report template draws, for the homes ``ids`` (their order is irrelevant: the page ranks them)."""
    template = template or load_template()
    schema = sh.load_schema(template)
    cap = schema.get("max_homes", MAX_HOMES)
    byid = {L["id"]: L for L in listings if L.get("id")}
    unknown = [i for i in ids if i not in byid]
    if unknown:
        raise ReportError(f"No listing with id {', '.join(unknown)} in this search.")
    ids = list(dict.fromkeys(ids))
    if not (MIN_HOMES <= len(ids) <= cap):
        raise ReportError(f"A report compares {MIN_HOMES} to {cap} homes; {len(ids)} were given.")
    picks = picks or {}
    dims = sh.dim_list(crit)
    w = {**(crit.get("weights") or {}), **(weights or {})}
    chosen = sorted((byid[i] for i in ids), key=lambda L: sh.order_key(L, w, dims))
    extras = tours_mod.share_extras(byid, [L["id"] for L in chosen], findings or {}, trail or [], notes=include_notes, photos=tour_photos,
                                    root=root, cfg=schema.get("tour_photos")) if (findings or trail) else {}
    dests = (crit.get("commute") or {}).get("destinations") or []
    homes = []
    for L in chosen:
        h = sh.prune_home(L, schema, None, picks.get(L["id"]), include_notes)
        h["reasons"] = sh.reasons_for(L, w, dims)
        fit = sh.weighted_score(L, w, dims)
        if fit is not None:
            h["fit"] = sh._rnd(fit, 1)
        cm = {d["name"]: c for d in dests if d.get("name") and (c := sh.prune_commute((L.get("commute") or {}).get(d["name"]), schema))}
        if cm:
            h["commutes"] = sh._tidy(cm)
        lease = lease_lines(L)
        if lease:
            h["lease"] = lease
        plan = prune_plan(load_plan(root, L["id"]), schema)
        if plan:
            h["plan"] = plan
        qs = open_questions(L, crit, schema=schema)
        if qs:
            h["questions"] = qs
        x = extras.get(L["id"]) or {}
        if x.get("tour"):
            h["tour"] = sh.pick_keys(x["tour"], schema["tour"])
        if x.get("trail"):
            h["trail"] = [sh.pick_keys(t, schema["trail"]) for t in x["trail"]]
        if (stills or {}).get(L["id"]):
            h["still"] = stills[L["id"]]
        homes.append(h)
    sh.attach_photos(homes, chosen, root, schema, enabled=with_photos, budget_kb=photo_budget_kb, media_base=media_base_url(crit))
    s = crit.get("search") or {}
    mi = s.get("move_in") or {}
    payload: dict[str, Any] = {
        "v": schema["version"], "generated": generated or dt.date.today().isoformat(), "source": SOURCE, "notes": bool(include_notes),
        "paper": paper if paper in ("letter", "a4") else "letter", "search": {"name": s.get("name"), "city": s.get("city")},
        "dests": [{"name": d["name"]} for d in dests[:3] if d.get("name")], "weights": sh.weight_rows(w, dims),
        "move_in": {k: str(mi[k])[:10] for k in ("earliest", "latest") if mi.get(k)}, "homes": homes,
    }
    if title:
        payload["title"] = title
    return payload


def render(listings: list[dict], crit: dict, ids: list[str], **kw: Any) -> str:
    """The finished HTML for the homes ``ids`` (see build_payload for the options)."""
    template = load_template()
    html = sh.inline_payload(template, build_payload(listings, crit, ids, template=template, **kw))
    return inline_fonts(html)
