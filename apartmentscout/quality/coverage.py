"""`apartmentscout coverage`: how complete the research is, what each gap could do to the ranking, and what to ask.

Coverage describes the listings this search has captured. It is not a census of the market: a source
counted here was searched, not exhausted, unless its sweep receipts reconcile (research/sweeps.jsonl).
"""
from __future__ import annotations

import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

from ..score import score_listing
from . import SCHEMA_VERSION
from .common import crit_today, is_active, iso, num, parse_date, source_name, stale_days
from .lint import lint_all
from .standard import LABELS, assess, plan_ids, standard_for

FINALIST_STATUSES = ("shortlist", "touring", "applied")
MAX_QUESTIONS = 8
CLAIM = ("Coverage of the listings this search has captured. It is not a market census: a source counted here "
         "was searched, not exhausted, unless its sweep receipts reconcile.")

# Decision-impact sentences for the summary. {n} = active listings missing it, {of} = active listings.
IMPACT = {
    "rent": "{n} of {of} active listings have no rent: they cannot be ranked on cost.",
    "concession": "{n} of {of} lack a concession and term: their net rent is a guess, and renewals are priced on gross.",
    "fees": "{n} of {of} have no fee schedule: budget tiers are a discovery filter until fee sheets arrive.",
    "move_in_costs": "{n} of {of} have no move-in costs: first-lease cost is a floor, not a total.",
    "start_date": "{n} of {of} have no start date: they may not fit the move-in window.",
    "size": "{n} of {of} have no square footage: size scores as neutral, so small units can rank too high.",
    "plan": "{n} of {of} have no plan of the unit itself: layout, door and laundry closet are unproved.",
    "bedroom": "{n} of {of} have no confirmed enclosed bedroom: junior and flex layouts may be hiding among them.",
    "must_haves": "{n} of {of} have an unconfirmed must-have: they pass the gate only provisionally.",
    "floor": "{n} of {of} have no stated floor (some are guessed from the unit number).",
    "exposure": "{n} of {of} have no window direction: light and view are estimates.",
    "media": "{n} of {of} have no photos or video of the unit itself.",
    "commute": "{n} of {of} have no commute time for every destination.",
    "building": "{n} of {of} have no building records or reviews.",
    "status": "{n} of {of} have never been checked on a dated visit to the source.",
}

Patch = Callable[[dict, dict, bool], dict | None]


def _with(L: dict, **parts: dict) -> dict:
    """Shallow copy of a listing with some sub-objects merged (no deep copy: listings are large)."""
    out = dict(L)
    for k, v in parts.items():
        out[k] = {**(L.get(k) or {}), **v}
    return out


def _patches(crit: dict) -> dict[str, Patch]:
    """Per-gap (listing, crit, best) -> the listing with the gap filled pessimistically (best=False) or optimistically."""
    b = crit.get("budget") or {}
    tiers = b.get("tiers") or []
    lo_budget = tiers[0]["max"] if tiers else b.get("hard_max")
    hi_budget = b.get("hard_max") or (tiers[-1]["max"] if tiers else None)
    u = crit.get("unit") or {}
    q = crit.get("quality") or {}
    fee_hi = float(q.get("assumed_fee_monthly_max", 200))
    once_hi = float(q.get("assumed_move_in_max", 2000))

    def rent(L: dict, c: dict, best: bool) -> dict | None:
        if not (lo_budget and hi_budget):
            return None
        return _with(L, price={"gross": float(lo_budget) * 0.9 if best else float(hi_budget) * 1.1, "net_effective": None})

    def concession(L: dict, c: dict, best: bool) -> dict | None:
        p = L.get("price") or {}
        if num(p.get("gross")) is None:
            return None
        return _with(L, price={"free_months": 1.0 if best else 0.0, "lease_months": 12.0, "net_effective": None})

    def fees(L: dict, c: dict, best: bool) -> dict:
        return _with(L, price={"fees_monthly": 0.0 if best else fee_hi})

    def move_in_costs(L: dict, c: dict, best: bool) -> dict:
        return _with(L, price={"fees_one_time": 0.0 if best else once_hi})

    def size(L: dict, c: dict, best: bool) -> dict:
        out = dict(L)
        out["sqft"] = float(u.get("sqft_great", 1050) if best else u.get("sqft_floor", 450))
        return out

    def must_haves(L: dict, c: dict, best: bool) -> dict:
        am = L.get("amenities") or {}
        return _with(L, amenities={k: best for k in c.get("must_have") or [] if am.get(k) is None})

    def floor(L: dict, c: dict, best: bool) -> dict | None:
        if (L.get("site") or {}).get("sun_hours"):
            return None
        out = dict(L)
        out["floor"], out["floor_inferred"] = (30.0 if best else 2.0), False
        return out

    def exposure(L: dict, c: dict, best: bool) -> dict | None:
        if (L.get("site") or {}).get("sun_hours"):
            return None
        out = dict(L)
        out["exposure"] = ["S"] if best else ["N"]
        return out

    def commute(L: dict, c: dict, best: bool) -> dict:
        cm = dict(L.get("commute") or {})
        for d in (c.get("commute") or {}).get("destinations") or []:
            if (cm.get(d["name"]) or {}).get("minutes") is None:
                mx = d.get("max_minutes", 30)
                cm[d["name"]] = {"minutes": mx * 0.5 if best else mx * 2}
        out = dict(L)
        out["commute"] = cm
        return out

    def building(L: dict, c: dict, best: bool) -> dict:
        return _with(L, reviews={"risk_score": 90 if best else 20})

    return {"rent": rent, "concession": concession, "fees": fees, "move_in_costs": move_in_costs, "size": size,
            "must_haves": must_haves, "floor": floor, "exposure": exposure, "commute": commute, "building": building}


def _overall(L: dict, crit: dict, today: Any = None) -> tuple[float | None, bool]:
    s = score_listing(L, crit, today)
    return s["overall"], s["eligible"]


def _rank_at(score: float | None, others: list[float]) -> int | None:
    return None if score is None else 1 + sum(1 for o in others if o > score)


def read_sweeps(root: Path | None) -> list[dict]:
    """research/sweeps.jsonl: one receipt per portal query (see docs/guides/research-quality.md)."""
    p = root / "research" / "sweeps.jsonl" if root else None
    if not p or not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def receipt_reconciles(r: dict) -> bool:
    """A sweep receipt is complete when every page was captured and every observed card is accounted for."""
    obs = num(r.get("observed_count"))
    parts = [num(r.get(k)) or 0 for k in ("unique_ids", "duplicates", "excluded", "failed")]
    pages, got = num(r.get("pages")), num(r.get("pages_captured"))
    pages_ok = pages is None or (got is not None and got >= pages)
    return obs is not None and abs(sum(parts) - obs) < 0.5 and pages_ok


def _sources(listings: list[dict], sweeps: list[dict]) -> list[dict]:
    count: Counter = Counter()
    active: Counter = Counter()
    checked: dict[str, Any] = {}
    for L in listings:
        names = set()
        for k, u in (L.get("links") or {}).items():
            if k in ("floorplan", "video"):
                continue
            n = source_name(u)
            if n:
                names.add(n)
        for n in names:
            count[n] += 1
            if is_active(L):
                active[n] += 1
            d = parse_date(L.get("checked"))
            if d and (checked.get(n) is None or d > checked[n]):
                checked[n] = d
    by_src: dict[str, list[dict]] = defaultdict(list)
    for r in sweeps:
        n = r.get("source") or source_name(r.get("url")) or "unknown"
        by_src[n].append(r)
        d = parse_date(r.get("checked"))
        if d and (checked.get(n) is None or d > checked[n]):
            checked[n] = d
    out = []
    for n in sorted(set(count) | set(by_src), key=lambda n: (-count[n], n)):
        rs = by_src.get(n, [])
        state = "no receipts" if not rs else ("complete" if all(receipt_reconciles(r) for r in rs) else
                                             "partial" if any(receipt_reconciles(r) for r in rs) else "incomplete")
        out.append({"name": n, "listings": count[n], "active": active[n], "checked": iso(checked.get(n)),
                    "sweeps": len(rs), "state": state})
    return out


def coverage(listings: list[dict], crit: dict, root: Path | None = None, claims: list[dict] | None = None,
             today: Any = None, flags: dict[str, list] | None = None) -> dict:
    """The coverage.json document (see docs/guides/data-model.md#coverage)."""
    t = crit_today(crit, today)
    std = standard_for(crit)
    plans = plan_ids(root)
    flags = flags if flags is not None else lint_all(listings, crit, root, claims, today=t)
    patches = _patches(crit)
    q = crit.get("quality") or {}
    n_final = int(q.get("finalists", 10))
    from ..questions import questions

    base: dict[str, tuple[float | None, bool]] = {L["id"]: _overall(L, crit, t) for L in listings}

    rows: dict[str, dict] = {}
    for L in listings:
        lid = L["id"]
        fl = flags.get(lid, [])
        codes = {f.code for f in fl}
        a = assess(L, crit, t, plans, codes)
        now, elig = base[lid]
        others = [s for i, (s, e) in base.items() if i != lid and e and s is not None]
        gaps = []
        worst, best = L, L
        for k in a["missing"]:
            fn = patches.get(k)
            if fn is None:
                gaps.append({"key": k, "impact": 0.0})
                continue
            w, b = fn(L, crit, False), fn(L, crit, True)
            if w is None or b is None:
                gaps.append({"key": k, "impact": 0.0})
                continue
            (sw, ew), (sb, eb) = _overall(w, crit, t), _overall(b, crit, t)
            g = {"key": k, "impact": round((sb or 0) - (sw or 0), 1) if sw is not None and sb is not None else 0.0}
            if not ew and eb:
                g["gate"] = True   # the pessimistic answer fails a gate
            gaps.append(g)
            worst, best = fn(worst, crit, False) or worst, fn(best, crit, True) or best
        lo, elo = _overall(worst, crit, t)
        hi, ehi = _overall(best, crit, t)
        active = is_active(L)
        rank_best = _rank_at(hi, others) if active and ehi else None
        rank_worst = _rank_at(lo, others) if active and elo else None
        gaps.sort(key=lambda g: -g["impact"])
        rows[lid] = {
            "have": a["have"], "missing": a["missing"], "stale": a["stale"],
            "score_impact": round((hi or 0) - (lo or 0), 1) if hi is not None and lo is not None else 0.0,
            "rank": (L.get("score") or {}).get("rank") if active else None,
            "rank_range": [rank_best, rank_worst],
            # only gaps that move the score or a gate; the rest are already listed in "missing"
            "gaps": [g for g in gaps if g["impact"] or g.get("gate")] if active else [],
            "active": active,
            "finalist": active and (L.get("status") in FINALIST_STATUSES or bool(L.get("favorite"))
                                    or ((L.get("score") or {}).get("rank") or 10 ** 9) <= n_final),
            "lint": [f.as_dict() for f in fl],
            # gone and rejected rows keep their facts but get no research queue
            "questions": [x["text"] for x in questions(L, crit, missing=a["missing"], stale=a["stale"], flags=fl,
                                                       today=t)][:MAX_QUESTIONS] if active else [],
            "_sort": now if now is not None else -1,
        }

    # priority: 1 = research first
    def tier(r: dict) -> int:
        open_ = bool(r["missing"] or r["stale"])
        if not r["active"]:
            return 4
        if r["finalist"] and open_:
            return 0
        if open_ and r["rank_range"][0] is not None and r["rank_range"][0] <= n_final:
            return 1
        return 2 if open_ else 3
    reasons = {0: "finalist with open facts", 1: "could reach the top {n} if gaps resolve well".format(n=n_final),
               2: "open facts, unlikely to reach the top {n}".format(n=n_final), 3: "complete", 4: "gone or rejected"}
    order = sorted(rows, key=lambda i: (tier(rows[i]), -rows[i]["score_impact"] if tier(rows[i]) < 2 else 0, -rows[i]["_sort"], i))
    for p, i in enumerate(order, 1):
        rows[i]["priority"] = p
        rows[i]["priority_reason"] = reasons[tier(rows[i])]
        del rows[i]["_sort"]

    act = [L for L in listings if is_active(L)]
    keys = [s["key"] for s in std]
    miss_count = {k: sum(1 for L in act if k in rows[L["id"]]["missing"]) for k in keys}
    stale_count = {k: sum(1 for L in act if k in rows[L["id"]]["stale"]) for k in keys}
    finalists = [L for L in act if rows[L["id"]]["finalist"]]
    complete = [L for L in act if not rows[L["id"]]["missing"] and not rows[L["id"]]["stale"]]
    impacts = [{"key": k, "label": LABELS[k], "missing": miss_count[k], "stale": stale_count[k], "of": len(act),
                "impact": IMPACT[k].format(n=miss_count[k], of=len(act))}
               for k in keys if miss_count[k]]
    impacts.sort(key=lambda d: -d["missing"])
    sweeps = read_sweeps(root)
    flagged = Counter(f.code for L in act for f in flags.get(L["id"], []))
    medians = [r["score_impact"] for L in act for r in [rows[L["id"]]] if r["score_impact"]]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated": t.isoformat(),
        "claim": CLAIM,
        "stale_days": stale_days(crit),
        "standard": std,
        "listings": rows,
        "sources": _sources(listings, sweeps),
        "summary": {
            "listings": len(listings),
            "active": len(act),
            "complete": len(complete),
            "finalists": len(finalists),
            "finalists_complete": sum(1 for L in finalists if L in complete),
            "missing_size": miss_count.get("size", 0),
            "missing_fees": miss_count.get("fees", 0),
            "missing_media": miss_count.get("media", 0),
            "stale": sum(1 for L in act if rows[L["id"]]["stale"]),
            "statuses": dict(Counter(L.get("status") or "new" for L in listings)),
            "flags": dict(flagged),
            "median_score_impact": round(statistics.median(medians), 1) if medians else 0.0,
        },
        "gaps": impacts,
    }


def format_report(doc: dict, listings: list[dict], top: int = 15) -> str:
    s = doc["summary"]
    lines = [doc["claim"], "",
             f"{s['active']} active of {s['listings']} listings: {s['complete']} complete on the standard, "
             f"{s['finalists']} finalists ({s['finalists_complete']} complete), {s['stale']} with stale facts "
             f"(older than {doc['stale_days']} days)."]
    if doc["gaps"]:
        lines += ["", "Gaps (active listings):"]
        lines += [f"  {g['label']:<30} {g['missing']:>4} missing  {g['impact'].split(': ', 1)[-1]}" for g in doc["gaps"]]
    if doc["sources"]:
        lines += ["", "Sources (listings / active / last checked / sweep state):"]
        lines += [f"  {x['name']:<22} {x['listings']:>4} {x['active']:>4}  {x['checked'] or '-':<10}  {x['state']}"
                  for x in doc["sources"][:12]]
    byid = {L["id"]: L for L in listings}
    order = sorted((i for i, r in doc["listings"].items() if r["active"] and (r["missing"] or r["stale"])),
                   key=lambda i: doc["listings"][i]["priority"])[:top]
    if order:
        lines += ["", f"Research queue (top {len(order)}): priority, score swing, rank range, gaps"]
        for i in order:
            r, L = doc["listings"][i], byid[i]
            rr = r["rank_range"]
            rng = f"{rr[0] or '-'}..{rr[1] or 'out'}" if rr[0] else "-"
            gaps = ", ".join(LABELS.get(k, k).lower() for k in r["missing"][:4]) + (" +stale" if r["stale"] else "")
            lines.append(f"  {r['priority']:>3}. {L.get('building', '')} {L.get('unit', '')}  ±{r['score_impact']:.1f} pts  "
                         f"rank {rng}  {gaps}")
            if r["questions"]:
                lines.append(f"       ask: {r['questions'][0]}")
    return "\n".join(lines)
