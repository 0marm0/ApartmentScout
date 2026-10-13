"""Criteria-driven scoring.

Every listing gets seven 0-100 dimension scores. Unknown dimensions count as a
neutral 50 in the overall score and are reported in ``confidence`` (share of the
weight that is known) and ``range`` (the overall score if every unknown turned
out worst or best), so missing facts neither inflate nor sink a listing.

Gates are separate from the score: a listing can score well and still fail a
must-have or the hard budget cap. The dashboard shows both.
"""
from __future__ import annotations

import re
from typing import Any

from .listings import monthly_cost

GOOD_EXPOSURE = {"S": 20, "SSW": 20, "SSE": 18, "SW": 16, "SE": 16, "W": 10, "E": 10,
                 "WSW": 13, "ESE": 13, "WNW": 4, "ENE": 4, "NW": 0, "NE": 0, "N": -10,
                 "NNW": -8, "NNE": -8}

DIMENSIONS = ["cost", "space", "commute", "amenities", "light_view", "building", "quiet"]


def _lin(x: float, x0: float, y0: float, x1: float, y1: float) -> float:
    if x <= x0:
        return y0
    if x >= x1:
        return y1
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def budget_tier(cost: float | None, crit: dict) -> str | None:
    if cost is None:
        return None
    tiers = crit.get("budget", {}).get("tiers") or []
    for t in tiers:
        if cost <= t["max"]:
            return t["name"]
    hard = crit.get("budget", {}).get("hard_max")
    if hard and cost <= hard and tiers:
        return f"Above {tiers[-1]['name']}"
    return "Over budget"


def score_cost(cost: float | None, crit: dict) -> float | None:
    if cost is None:
        return None
    b = crit.get("budget", {})
    tiers = b.get("tiers") or []
    lo = tiers[0]["max"] if tiers else (b.get("hard_max") or cost)
    hi = b.get("hard_max") or (tiers[-1]["max"] if tiers else lo * 1.1)
    if cost <= lo:
        # cheaper than target earns a little, never a lot: you are shopping for fit
        return _lin(cost, lo * 0.8, 100, lo, 85)
    if cost <= hi:
        return _lin(cost, lo, 85, hi, 35)
    return max(0.0, _lin(cost, hi, 35, hi * 1.15, 0))


def score_space(L: dict, crit: dict) -> float | None:
    u = crit.get("unit", {})
    sq = L.get("sqft")
    if not sq:
        return None
    f, g, gr = u.get("sqft_floor", 450), u.get("sqft_good", 750), u.get("sqft_great", 1050)
    s = _lin(sq, f, 0, g, 50) if sq < g else _lin(sq, g, 50, gr, 100)
    beds = L.get("beds")
    if beds is not None and beds < u.get("min_beds", 0):
        s *= 0.5
    return s


def score_commute(L: dict, crit: dict) -> float | None:
    dests = crit.get("commute", {}).get("destinations") or []
    cm = L.get("commute") or {}
    tot, wsum = 0.0, 0.0
    for d in dests:
        m = (cm.get(d["name"]) or {}).get("minutes")
        if m is None:
            continue
        mx = d.get("max_minutes", 30)
        s = _lin(m, mx * 0.5, 100, mx, 50) if m <= mx else _lin(m, mx, 50, mx * 2, 0)
        w = d.get("weight", 1.0)
        tot += s * w
        wsum += w
    return tot / wsum if wsum else None


def score_amenities(L: dict, crit: dict) -> tuple[float | None, list[str], list[str]]:
    am = L.get("amenities") or {}
    fails, unknown = [], []
    for k in crit.get("must_have", []):
        v = am.get(k)
        if v is False or v == "none":
            fails.append(k)
        elif v is None:
            unknown.append(k)
    pts, tot, known = 0.0, 0.0, 0
    for keys, w in ((crit.get("must_have", []), 3), (crit.get("strongly_prefer", []), 2),
                    (crit.get("nice_to_have", []), 1)):
        for k in keys:
            v = am.get(k)
            tot += w
            if v is None:
                pts += w * 0.5
                continue
            known += 1
            if k == "doorman":
                pts += w * {"full-time": 1, "part-time": 0.6, "virtual": 0.35, "none": 0}.get(v, 0.5)
            else:
                pts += w * (1 if v else 0)
    if not tot or not known:
        return None, fails, unknown
    return 100 * pts / tot, fails, unknown


def score_light(L: dict) -> float | None:
    sun = (L.get("site") or {}).get("sun_hours")
    if sun:
        # annual mean and winter (Dec/Jan) direct sun hours from the 3D model
        mean = sum(sun) / len(sun)
        winter = (sun[11] + sun[0]) / 2
        return min(100.0, mean * 11 + winter * 4)
    exp = L.get("exposure") or []
    floor = L.get("floor")
    text = " ".join(str(v) for v in (L.get("features") or {}).values()).lower()
    if not exp and floor is None and not text:
        return None
    s = 45.0
    if exp:
        s += max(GOOD_EXPOSURE.get(str(e).upper(), 0) for e in exp)
        if len(exp) > 1:
            s += 8  # corner unit
    if floor is not None:
        s += min(20.0, floor * 0.8)
    for word, pts in (("panoram", 12), ("skyline", 8), ("river", 8), ("park view", 8), ("sunny", 6),
                      ("excellent", 6), ("bright", 5), ("open view", 6), ("courtyard", -4),
                      ("airshaft", -12), ("brick wall", -12), ("facade", -6), ("dark", -8)):
        if word in text:
            s += pts
    return max(0.0, min(100.0, s))


def score_building(L: dict) -> float | None:
    vals = []
    rv = L.get("reviews") or {}
    if rv.get("risk_score") is not None:
        vals.append(float(rv["risk_score"]))
    for r in rv.get("ratings") or []:
        m = re.search(r"(\d(?:\.\d)?)\s*/\s*5", str(r.get("value", "")))
        if m:
            vals.append((float(m.group(1)) - 1) / 4 * 100)
    rec = L.get("records") or {}
    if rec.get("risk_score") is not None:
        vals.append(float(rec["risk_score"]))
    return sum(vals) / len(vals) if vals else None


def score_quiet(L: dict) -> float | None:
    rec = L.get("records") or {}
    if rec.get("noise_score") is not None:
        return float(rec["noise_score"])
    rv = " ".join(str(v) for v in (L.get("reviews") or {}).values() if isinstance(v, str)).lower()
    if not rv:
        return None
    s = 60.0
    for w, p in (("noise", -12), ("thin wall", -10), ("loud", -8), ("quiet", 10), ("construction", -6),
                 ("truck", -5), ("nightlife", -6), ("bar", -3)):
        if w in rv:
            s += p
    return max(0.0, min(100.0, s))


def score_listing(L: dict, crit: dict) -> dict[str, Any]:
    cost = monthly_cost(L)
    am, fails, unknown = score_amenities(L, crit)
    parts = {
        "cost": score_cost(cost, crit),
        "space": score_space(L, crit),
        "commute": score_commute(L, crit),
        "amenities": am,
        "light_view": score_light(L),
        "building": score_building(L),
        "quiet": score_quiet(L),
    }
    w = crit["weights"]
    wtot = sum(w.get(k, 0) for k in DIMENSIONS) or 1
    known_w = sum(w.get(k, 0) for k in DIMENSIONS if parts[k] is not None)
    lo = sum(w.get(k, 0) * (parts[k] if parts[k] is not None else 0) for k in DIMENSIONS) / wtot
    hi = sum(w.get(k, 0) * (parts[k] if parts[k] is not None else 100) for k in DIMENSIONS) / wtot
    # Unknown dimensions count as a neutral 50 in the point estimate, so missing facts neither
    # help nor sink a listing; `range` shows how far the truth could move it.
    overall = (sum(w.get(k, 0) * (parts[k] if parts[k] is not None else 50) for k in DIMENSIONS) / wtot) if known_w else None
    gates = []
    hard = crit.get("budget", {}).get("hard_max")
    if cost is not None and hard and cost > hard:
        gates.append("over_budget")
    if fails:
        gates.append("fails:" + ",".join(fails))
    if unknown:
        gates.append("unverified:" + ",".join(unknown))
    if cost is None:
        gates.append("unknown_cost")
    eligible = not any(g.startswith(("over_budget", "fails")) for g in gates) and L.get("status") not in ("gone", "rejected")
    return {
        "overall": round(overall, 1) if overall is not None else None,
        "parts": {k: (round(v, 1) if v is not None else None) for k, v in parts.items()},
        "confidence": round(100 * known_w / wtot),
        "range": [round(lo, 1), round(hi, 1)],
        "monthly_cost": cost,
        "budget_tier": budget_tier(cost, crit),
        "gates": gates,
        "eligible": eligible,
    }


def score_all(listings: list[dict], crit: dict) -> list[dict]:
    for L in listings:
        L["score"] = score_listing(L, crit)
    ranked = sorted((L for L in listings if L["score"]["eligible"] and L["score"]["overall"] is not None),
                    key=lambda L: -L["score"]["overall"])
    for i, L in enumerate(ranked, 1):
        L["score"]["rank"] = i
    return listings
