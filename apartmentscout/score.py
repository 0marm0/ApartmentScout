"""Criteria-driven scoring (version 2).

Every listing gets one 0-100 score per dimension (``DIMENSIONS``). Unknown dimensions count as a
neutral 50 in the overall score and are reported in ``confidence`` (share of the weight that is
known) and ``range`` (the overall score if every unknown turned out worst or best, and every
estimated input sat at the far end of its own range), so missing facts neither inflate nor sink a
listing.

Gates are separate from the score: a listing can score well and still fail a must-have or the hard
budget cap. Three ranks answer three questions:

- ``ranks.fit``: how good is this home, whatever its status (gone and over-budget homes included);
- ``ranks.action`` (also ``rank``): which homes can I act on, best first (eligible only);
- ``ranks.budget``: the best homes inside the first budget tier.

Every dimension carries a plain-language reason (``reasons``) with the points it adds or removes
against a neutral listing under the current weights, so the ranking can always be explained.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any

from . import tours as tours_mod
from .config import DIMENSION_LABELS
from .listings import (cost_model, headroom, is_studio, normalise_laundry, normalise_service, parse_date,
                       price_per_sqft, size_info)

SCORE_VERSION = "2.1"

GOOD_EXPOSURE = {"S": 20, "SSW": 20, "SSE": 18, "SW": 16, "SE": 16, "W": 10, "E": 10,
                 "WSW": 13, "ESE": 13, "WNW": 4, "ENE": 4, "NW": 0, "NE": 0, "N": -10,
                 "NNW": -8, "NNE": -8}

DIMENSIONS = list(DIMENSION_LABELS)
EXACT_SCOPES = {"exact-unit", "exact_unit", "exact", "unit", "this-unit"}
SERVICE_LEVEL = {"full-time": 1, "part-time": 0.6, "virtual": 0.35, "none": 0}
AMENITY_NAMES = {"in_unit_wd": "in-unit W/D", "elevator": "elevator", "doorman": "doorman", "gym": "gym",
                 "pool": "pool", "roof_deck": "roof deck", "outdoor_space": "private outdoor space",
                 "dishwasher": "dishwasher", "central_ac": "central air", "pets": "pets allowed",
                 "parking": "parking", "bike_room": "bike room", "package_room": "package room",
                 "lounge": "lounge", "coworking": "coworking", "game_room": "game room"}
WALK_LINES_MIN = 10        # transit access counts lines within this walk


@dataclass
class Part:
    """One dimension: 0-100 value (None = unknown), a one-line summary and itemised evidence."""

    value: float | None
    summary: str
    items: list[str] = field(default_factory=list)
    range: tuple[float, float] | None = None
    flags: list[str] = field(default_factory=list)


def _lin(x: float, x0: float, y0: float, x1: float, y1: float) -> float:
    if x <= x0:
        return y0
    if x >= x1:
        return y1
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def _money(x: float | None) -> str:
    return "?" if x is None else f"${x:,.0f}"


def _day(d: dt.date) -> str:
    return f"{d:%b} {d.day}"


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


# ---------------------------------------------------------------------- cost

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


def _tier_phrase(cm: dict, crit: dict) -> str:
    rows = cm.get("headroom") or []
    inside = [r for r in rows if r["room"] >= 0]
    if inside:
        r = inside[0]
        return f"inside {r['tier']} ({_money(r['room'])} headroom)" if r["tier"] != "Hard cap" else \
            f"under the hard cap ({_money(r['room'])} headroom)"
    if rows:
        r = rows[-1]
        return f"over the {_money(r['max'])} cap by {_money(-r['room'])}"
    return ""


def part_cost(cm: dict, crit: dict) -> Part:
    amount = cm.get("budget_amount")
    if amount is None:
        return Part(None, "monthly cost unknown, counted as neutral", flags=["cost_unknown"])
    v = score_cost(amount, crit)
    rent = cm.get("rent") or {}
    items: list[str] = []
    flags: list[str] = []
    basis = rent.get("basis")
    if basis == "computed":
        items.append(f"net {_money(rent['net'])}: {_money(rent['gross'])} gross with {rent['free_months']:g} of "
                     f"{rent['lease_months']:g} months free")
    elif basis == "stated":
        items.append(f"net {_money(rent['net'])} as stated by the source")
    elif basis == "conditional":
        ill = ", ".join(f"{_money(x['net'])} on {x['lease_months']:g} months" for x in rent.get("illustrations") or [])
        items.append(f"ranked on the {_money(rent['gross'])} paid-month rent: the free months come without a "
                     f"lease term (net would be {ill})")
        flags.append("net_conditional")
    elif basis == "gross":
        items.append(f"gross rent {_money(rent['gross'])}, no concession")
    if cm.get("fees_known"):
        f = cm.get("fees_monthly")
        fee_txt = f"{_money(f[0])}-{_money(f[1])}" if isinstance(f, list) else _money(f)
        items.append(f"monthly fees {fee_txt}" if f else "monthly fees: none")
    else:
        flags.append("fees_unknown")
    est = cm.get("fees_estimate")
    if est:
        items += [f"estimated {x}" for x in est["parts"]]
        items.append(f"ranked on {_money(cm['monthly_expected'])}/mo with these estimates; "
                     f"{_money(cm['monthly'])} documented")
        flags.append("fees_estimated")
    elif not cm.get("fees_known"):
        items.append("monthly fees unknown: nothing comparable to estimate from")
    if cm.get("one_time_spread"):
        items.append(f"one-time fees add {_money(cm['one_time_spread'])}/mo over the lease")
    conc = cm.get("concession") or {}
    if conc.get("excluded"):
        items.append(f"concession not applied: {conc['excluded']}")
    for n in conc.get("notes") or []:
        items.append(f"concession condition: {n}")
    for a in cm.get("assumptions") or []:
        items.append(a)
        if "lease term" in a:
            flags.append("lease_term_assumed")
    if cm.get("dispute"):
        items.append("sources disagree; ranked on the higher price: " +
                     "; ".join(f"{s['label']} {_money(s['monthly'])}" for s in cm["scenarios"]))
        flags.append("price_dispute")
    lo, hi = (cm.get("monthly_range") or [None, None])[:2]
    rng = None
    if lo is not None and (lo != amount or (hi is not None and hi != amount)):
        best = score_cost(lo, crit)
        worst = score_cost(hi, crit) if hi is not None else v
        rng = (round(min(worst, v), 1), round(max(best, v), 1))
    summ = f"{_money(amount)}/mo first-lease equivalent"
    tp = _tier_phrase(cm, crit)
    if tp:
        summ += ", " + tp
    if not cm.get("fees_known"):
        summ += ", fees unknown"
    if basis == "conditional":
        summ += ", free months need a lease term"
    if cm.get("dispute"):
        summ += ", sources disagree"
    return Part(v, summ, items, rng, flags)


# ---------------------------------------------------------------------- space

def _space_value(sq: float, u: dict) -> float:
    f, g, gr = u.get("sqft_floor", 450), u.get("sqft_good", 750), u.get("sqft_great", 1050)
    return _lin(sq, f, 0, g, 50) if sq < g else _lin(sq, g, 50, gr, 100)


# ---------------------------------------------------------------------- comparables

def _q(vals: list[float] | tuple[float, ...], p: float) -> float:
    """Linear-interpolated quantile of a non-empty list."""
    v = sorted(vals)
    i = p * (len(v) - 1)
    lo = int(i)
    return v[lo] + (v[min(lo + 1, len(v) - 1)] - v[lo]) * (i - lo)


def _median(vals: list[float] | tuple[float, ...]) -> float:
    return _q(vals, 0.5)


def is_condo(L: dict) -> bool:
    return bool(re.search(r"\bcondo(minium)?s?\b", f"{L.get('building', '')} {L.get('ownership', '')}", re.I))


@dataclass(frozen=True)
class Comps:
    """What the rest of the search knows, used to estimate one listing's unknown size and fees.

    Unknowns are estimated from comparable listings instead of counting as a neutral 50 or as $0, so a
    listing that documents a modest size or a small fee is not ranked below one that documents nothing.
    """

    sizes_building: dict[tuple[str, float], tuple[float, ...]] = field(default_factory=dict)
    sizes_beds: dict[float, tuple[float, ...]] = field(default_factory=dict)
    fees_service: dict[str, tuple[float, ...]] = field(default_factory=dict)
    fees_all: tuple[float, ...] = ()
    condo_one_time: tuple[float, ...] = ()


def build_comps(listings: list[dict]) -> Comps:
    by_b: dict[tuple[str, float], list[float]] = {}
    by_beds: dict[float, list[float]] = {}
    by_service: dict[str, list[float]] = {}
    fees: list[float] = []
    condo: list[float] = []
    for L in listings:
        si = size_info(L)
        beds = L.get("beds")
        if si and si["exact"] or (si and si["basis"] in ("line_band_plan", "main_rooms_sum")):
            if beds is not None:
                by_b.setdefault((_building_key(L), float(beds)), []).append(float(si["sqft"]))
                by_beds.setdefault(float(beds), []).append(float(si["sqft"]))
        pr = L.get("price") or {}
        fm = pr.get("fees_monthly")
        if isinstance(fm, (int, float)) and fm >= 0:
            fees.append(float(fm))
            svc = normalise_service((L.get("amenities") or {}).get("doorman")) if isinstance(
                (L.get("amenities") or {}).get("doorman"), str) else None
            by_service.setdefault(str(svc), []).append(float(fm))
        ot = pr.get("fees_one_time")
        if is_condo(L) and isinstance(ot, (int, float)) and ot > 50:
            condo.append(float(ot))
    return Comps({k: tuple(v) for k, v in by_b.items()}, {k: tuple(v) for k, v in by_beds.items()},
                 {k: tuple(v) for k, v in by_service.items()}, tuple(fees), tuple(condo))


def estimated_size(L: dict, comps: Comps | None) -> dict[str, Any] | None:
    """A size for a listing that states none: the same building's units with the same bedrooms, else the
    search's lower-middle (40th percentile) for that bedroom count. Listings that hide their size tend
    to be the smaller ones, so the estimate leans low and keeps a wide range."""
    beds = L.get("beds")
    if comps is None or beds is None:
        return None
    same = comps.sizes_building.get((_building_key(L), float(beds)))
    if same:
        mid = _median(same)
        return {"sqft": round(mid), "range": [round(min(same) * 0.95), round(max(same) * 1.05)],
                "label": f"the building's other {beds:g}-bed units ({len(same)} known)"}
    pool = comps.sizes_beds.get(float(beds)) or ()
    if len(pool) < 8:
        return None
    return {"sqft": round(_q(pool, 0.4)), "range": [round(_q(pool, 0.15)), round(_q(pool, 0.65))],
            "label": f"{len(pool)} known {beds:g}-bed sizes in this search (40th percentile)"}


def estimated_fees(L: dict, cm: dict, comps: Comps | None) -> dict[str, Any] | None:
    """Expected unknown fees: the median known monthly fee in buildings with the same service level,
    plus, for condo rentals with no fee sheet, the median known condo move-in/application package
    spread over the lease. None when the fees are documented or nothing comparable is known."""
    if comps is None or cm.get("monthly") is None:
        return None
    pr = L.get("price") or {}
    out: dict[str, Any] = {"monthly": 0.0, "parts": []}
    hi = 0.0
    if not cm.get("fees_known"):
        d = (L.get("amenities") or {}).get("doorman")
        svc = str(normalise_service(d)) if isinstance(d, str) else "None"
        pool = comps.fees_service.get(svc) or ()
        if len(pool) < 5:
            pool = comps.fees_all
        if len(pool) >= 5:
            m = _median(pool)
            out["monthly"] += m
            hi += _q(pool, 0.9)
            out["parts"].append(f"monthly fees ~${m:,.0f} (median of {len(pool)} known fee sheets)")
    if is_condo(L) and not pr.get("fees_one_time") and len(comps.condo_one_time) >= 3:
        months = float(pr.get("lease_months") or 12)
        ot = _median(comps.condo_one_time) / months
        out["monthly"] += ot
        hi += max(comps.condo_one_time) / months
        out["parts"].append(f"condo move-in and application fees ~${ot * months:,.0f} once "
                            f"(median of {len(comps.condo_one_time)} known), ${ot:,.0f}/mo over {months:g} months")
    if not out["parts"]:
        return None
    out["monthly"] = round(out["monthly"])
    out["high"] = round(hi)
    return out


def apply_fee_estimate(cm: dict, est: dict, crit: dict) -> dict:
    """The money model with expected fees added to the amount the budget reads; known parts unchanged."""
    out = dict(cm)
    out["fees_estimate"] = est
    out["monthly_expected"] = round(cm["monthly"] + est["monthly"], 2)
    out["monthly_range"] = [cm["monthly"], round(cm["monthly"] + est["high"], 2)]
    basis = ((crit or {}).get("budget") or {}).get("basis", "monthly_cost")
    if basis == "monthly_cost":
        out["budget_amount"] = out["monthly_expected"]
        out["headroom"] = headroom(out["budget_amount"], crit)
    return out


def part_space(L: dict, crit: dict, comps: Comps | None = None) -> Part:
    u = crit.get("unit", {})
    si = size_info(L)
    items: list[str] = []
    flags: list[str] = []
    if not si:
        est = estimated_size(L, comps)
        if not est:
            return Part(None, "size unknown, counted as neutral")
        si = {**est, "exact": False, "ppsf_ok": False, "label": "estimated"}
        items.append(f"no size stated: estimated from {est['label']}")
        flags.append("size_imputed")
    v = _space_value(si["sqft"], u)
    lo, hi = (_space_value(x, u) for x in si["range"])
    if si["exact"]:
        summ = f"{si['sqft']:,} ft² ({si['label']})"
    else:
        summ = f"~{si['range'][0]:,}-{si['range'][1]:,} ft² ({si['label']})"
        items.append(f"scored at the {si['sqft']:,} ft² middle; the range is kept in the score range")
        flags.append("size_estimated")
        if not si["ppsf_ok"] and "size_imputed" not in flags:
            items.append("no $/ft² from a ratio estimate")
            flags.append("size_proxy")
    beds = L.get("beds")
    if beds is None and is_studio(L):
        beds = 0
        flags.append("studio_from_text")
    min_beds = u.get("min_beds", 0)
    if beds is not None and beds < min_beds:
        v, lo, hi = v * 0.5, lo * 0.5, hi * 0.5
        items.append(f"{'studio' if beds == 0 else f'{beds:g} bedroom'}, below your {min_beds}-bedroom minimum: halved")
        summ += ", below the bedroom minimum"
    return Part(v, summ, items, (round(lo, 1), round(hi, 1)) if (lo, hi) != (v, v) else None, flags)


# ---------------------------------------------------------------------- commute

def _rides(route: str) -> list[str]:
    return [s.strip() for s in route.split("→") if s.strip() and not s.strip().startswith("walk")]


def _mode_phrase(entry: dict, city: str | None) -> str:
    modes = entry.get("modes") or {}
    via = entry.get("via") or (modes.get("transit") or {}).get("via")
    route = str(entry.get("route") or "")
    if not via:
        rides = _rides(route)
        if entry.get("mode") == "walk" or (route.startswith("walk") and not rides):
            via = "walk"
        elif rides:
            buses = [r for r in rides if r.startswith("bus ")]
            rail = "subway" if city == "nyc" else "transit"
            via = "bus" if len(buses) == len(rides) else ("mixed" if buses else rail)
    return {"walk": "on foot", "mixed": "by transit", None: "", "": ""}.get(via, f"by {via}")


def _transfers(entry: dict) -> int | None:
    t = entry.get("transfers")
    if t is None:
        t = ((entry.get("modes") or {}).get("transit") or {}).get("transfers")
    if t is None and entry.get("route"):
        rides = _rides(str(entry["route"]))
        t = max(0, len(rides) - 1) if rides else None
    return t


def part_commute(L: dict, crit: dict) -> Part:
    dests = crit.get("commute", {}).get("destinations") or []
    cm = L.get("commute") or {}
    city = (crit.get("search") or {}).get("city")
    tot, wsum = 0.0, 0.0
    items: list[tuple[float, str]] = []
    for d in dests:
        e = cm.get(d["name"]) or {}
        m = e.get("minutes")
        if m is None:
            continue
        mx = d.get("max_minutes", 30)
        s = _lin(m, mx * 0.5, 100, mx, 50) if m <= mx else _lin(m, mx, 50, mx * 2, 0)
        w = d.get("weight", 1.0)
        tot += s * w
        wsum += w
        phrase = " ".join(x for x in (f"{m:.0f} min to {d['name']}", _mode_phrase(e, city)) if x)
        items.append((w, phrase + (f" (limit {mx})" if m > mx else "")))
    if not wsum:
        return Part(None, "commute not computed, counted as neutral")
    summ = max(items, key=lambda x: x[0])[1]
    if len(items) > 1:
        summ += f" (+{len(items) - 1} more)"
    return Part(tot / wsum, summ, [t for _, t in items])


# ---------------------------------------------------------------------- amenities

def _amenity_value(k: str, v: Any, flags: list[str]) -> Any:
    """Free-text amenity values through the wording normalisers (flagged when it changes anything)."""
    if isinstance(v, str):
        if k == "doorman" and v not in SERVICE_LEVEL:
            flags.append("service_wording")
            return normalise_service(v)
        if k == "in_unit_wd":
            flags.append("service_wording")
            return normalise_laundry(v)
        if k != "doorman":
            t = v.strip().lower()
            return True if t.startswith(("yes", "true")) else False if t.startswith(("no", "false")) else None
    return v


def part_amenities(L: dict, crit: dict) -> tuple[Part, list[str], list[str]]:
    raw = L.get("amenities") or {}
    flags: list[str] = []
    am = {k: _amenity_value(k, v, flags) for k, v in raw.items()}
    fails, unknown = [], []
    waived = set(L.get("waived_must_have") or [])   # the renter accepted this unit without it: scored, not gated
    for k in crit.get("must_have", []):
        v = am.get(k)
        if v is False or v == "none":
            if k not in waived:
                fails.append(k)
        elif v is None:
            unknown.append(k)
    pts, tot, known, have, wanted = 0.0, 0.0, 0, 0, 0
    items: list[str] = []
    for keys, w, tag in ((crit.get("must_have", []), 3, "must-have"), (crit.get("strongly_prefer", []), 2, "strong"),
                         (crit.get("nice_to_have", []), 1, "nice")):
        for k in keys:
            v = am.get(k)
            name = AMENITY_NAMES.get(k, k.replace("_", " "))
            tot += w
            wanted += 1
            if v is None:
                pts += w * 0.5
                items.append(f"{name} unknown ({tag}, counted half)")
                continue
            known += 1
            if k == "doorman":
                lvl = SERVICE_LEVEL.get(v, 0.5)
                pts += w * lvl
                have += lvl > 0
                items.append(f"doorman: {v if isinstance(v, str) else 'yes'} ({tag})")
            else:
                pts += w * (1 if v else 0)
                have += bool(v)
                items.append(f"{'has' if v else 'no'} {name} ({tag})")
    if not tot or not known:
        return Part(None, "amenities unknown, counted as neutral", items, flags=sorted(set(flags))), fails, unknown
    summ = f"{have} of {wanted} wanted amenities confirmed"
    if fails:
        summ += "; missing must-have: " + ", ".join(AMENITY_NAMES.get(k, k) for k in fails)
    if waived & set(crit.get("must_have", [])):
        summ += "; waived by you: " + ", ".join(AMENITY_NAMES.get(k, k) for k in sorted(waived) if k in crit.get("must_have", []))
    elif unknown:
        summ += "; unverified must-have: " + ", ".join(AMENITY_NAMES.get(k, k) for k in unknown)
    return Part(100 * pts / tot, summ, items, flags=sorted(set(flags))), fails, unknown


# ---------------------------------------------------------------------- light and view

def _scope_ok(L: dict, key: str) -> bool:
    sc = L.get("features_scope", L.get("evidence_scope"))
    if isinstance(sc, dict):
        sc = sc.get(key, sc.get("default"))
    return sc is None or str(sc).lower() in EXACT_SCOPES


def exposure_assumed(L: dict) -> bool:
    """True when nothing says which way the windows face: the listing's ``exposure_source`` (or the one the
    3D site study recorded in ``site.exposure_source``, from the site file's provenance) is ``assumed``."""
    src = L.get("exposure_source") or (L.get("site") or {}).get("exposure_source")
    return str(src or "").strip().lower() == "assumed"


ASSUMED_EXPOSURE_WEIGHT = 0.5   # how much of a light result counts when the facing is only a guess


def _discount_assumed(L: dict, p: Part) -> Part:
    """Pull a light result that rests on an assumed facing halfway to neutral, and say so."""
    if p.value is None or not exposure_assumed(L):
        return p
    w = ASSUMED_EXPOSURE_WEIGHT
    item = (f"exposure is only assumed (no listing, plan or photo says which way the windows face): "
            f"counted at {w:.0%} strength, {p.value:.0f} -> {50 + w * (p.value - 50):.0f}")
    rng = tuple(50 + w * (x - 50) for x in p.range) if p.range else None
    return Part(50 + w * (p.value - 50), p.summary + "; exposure assumed", p.items + [item], rng,
                sorted(set([*p.flags, "exposure_assumed"])))


def _light_model(L: dict) -> Part:
    return _discount_assumed(L, _light_model_raw(L))


def _light_model_raw(L: dict) -> Part:
    sun = (L.get("site") or {}).get("sun_hours")
    if sun:
        mean = sum(sun) / len(sun)
        winter = (sun[11] + sun[0]) / 2
        return Part(min(100.0, mean * 11 + winter * 4),
                    f"3D sun study: {mean:.1f} h of direct sun a day on average, {winter:.1f} h in Dec-Jan",
                    [f"annual mean {mean:.1f} h x 11", f"winter {winter:.1f} h x 4"])
    exp = L.get("exposure") or []
    floor = L.get("floor")
    feats = L.get("features") or {}
    flags: list[str] = []
    items: list[str] = []
    texts = []
    for k, v in feats.items():
        if _scope_ok(L, k):
            texts.append(str(v))
        else:
            flags.append("visual_not_exact")
    text = " ".join(texts).lower()
    if "visual_not_exact" in flags:
        items.append("view and light wording that comes from building or representative media is not scored")
    if not exp and floor is None and not text:
        return Part(None, "light and view unknown, counted as neutral", items, flags=sorted(set(flags)))
    s = 45.0
    bits = []
    if exp:
        best = max(GOOD_EXPOSURE.get(str(e).upper(), 0) for e in exp)
        s += best
        items.append(f"{'/'.join(exp)} exposure ({best:+g})")
        bits.append(f"{'/'.join(exp)} exposure")
        if len(exp) > 1:
            s += 8
            items.append("corner unit (+8)")
    if floor is not None:
        f_pts = min(20.0, floor * 0.8)
        s += f_pts
        inferred = bool(L.get("floor_inferred"))
        if inferred:
            flags.append("floor_inferred")
        items.append(f"floor {floor:g} ({f_pts:+.0f}{', inferred from the unit number' if inferred else ''})")
        bits.append(f"floor {floor:g}{'?' if inferred else ''}")
    for word, pts in (("panoram", 12), ("skyline", 8), ("river", 8), ("park view", 8), ("sunny", 6),
                      ("excellent", 6), ("bright", 5), ("open view", 6), ("courtyard", -4),
                      ("airshaft", -12), ("brick wall", -12), ("facade", -6), ("dark", -8)):
        if word in text:
            s += pts
            items.append(f"listing says '{word}' ({pts:+d})")
    summ = ", ".join(bits) if bits else "from listing wording only"
    return Part(_clamp(s), summ, items, flags=sorted(set(flags)))


def _photo_review(L: dict) -> dict:
    """Graded listing photos (``photo_review``), unless they only show the building."""
    pr = L.get("photo_review") or {}
    return {} if pr.get("scope") == "building-only" else pr


def _grade(v: Any) -> float | None:
    return (float(v) - 1) / 4 * 100 if isinstance(v, (int, float)) else None


def part_light(L: dict) -> Part:
    """The sun and floor model, blended half and half with what the unit's own photos show (light
    through the windows and the view out of them) when they were graded."""
    p = _light_model(L)
    pr = _photo_review(L)
    view, light = _grade(pr.get("view")), _grade(pr.get("natural_light"))
    if view is None and light is None:
        return p
    pv = view if light is None else light if view is None else 0.6 * view + 0.4 * light
    bits = [f"view {pr['view']}/5" + (f" ({pr['view_note']})" if pr.get("view_note") else "") if view is not None else None,
            f"light {pr['natural_light']}/5" if light is not None else None]
    item = "unit photos: " + ", ".join(b for b in bits if b)
    if p.value is None:
        return Part(pv, item, [item], flags=p.flags)
    v = 0.5 * p.value + 0.5 * pv
    rng = (min(v, *(0.5 * x + 0.5 * pv for x in p.range)), max(v, *(0.5 * x + 0.5 * pv for x in p.range))) if p.range else None
    return Part(v, f"{p.summary}; {item}", p.items + [item], rng, p.flags)


# ---------------------------------------------------------------------- building and quiet

def _norm_building(name: Any) -> str:
    t = re.sub(r"\(.*?\)", " ", str(name or "").lower())
    t = re.sub(r"\b(the|condominiums?|condo|apartments?|residences?|tower|nyc)\b", " ", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def renter_rating(L: dict, crit: dict) -> tuple[float, str] | None:
    """The renter's own 1-5 rating of this building (``building_ratings`` in the criteria)."""
    ratings = crit.get("building_ratings") or {}
    if not ratings:
        return None
    b = _norm_building(L.get("building"))
    for name, r in ratings.items():
        n = _norm_building(name)
        if n and (b == n or b.startswith(n + " ") or n.startswith(b + " ")) and isinstance(r, (int, float)):
            return float(r), str(name)
    return None


QUALITY_AMENITIES = ("gym", "pool", "roof_deck", "lounge", "game_room", "outdoor_space", "parking")


def building_quality(L: dict) -> tuple[float | None, list[str]]:
    """How nice the building is, from what is known: age and height (PLUTO), service level, the breadth
    of shared amenities, residents' star ratings and graded lobby or amenity photos."""
    vals: list[float] = []
    items: list[str] = []
    bf = L.get("building_facts") or {}
    year = bf.get("year_built")
    if isinstance(year, (int, float)) and year > 1800:
        v = _clamp((year - 1960) / 60 * 100)
        vals.append(v)
        items.append(f"built {year:.0f} ({v:.0f})")
    floors = bf.get("floors")
    if isinstance(floors, (int, float)) and floors > 0:
        v = _clamp((floors - 5) / 35 * 100)
        vals.append(v)
        items.append(f"{floors:.0f} floors ({v:.0f})")
    am = L.get("amenities") or {}
    d = am.get("doorman")
    lvl = normalise_service(d) if isinstance(d, str) and d not in SERVICE_LEVEL else d
    if lvl in SERVICE_LEVEL:
        v = 100 * SERVICE_LEVEL[lvl]
        vals.append(v)
        items.append(f"{lvl} doorman ({v:.0f})")
    known = [k for k in QUALITY_AMENITIES if am.get(k) is not None]
    if len(known) >= 2:
        n = sum(1 for k in known if am.get(k) not in (False, "none", "no"))
        v = _clamp(n / 4 * 100)
        vals.append(v)
        items.append(f"{n} shared amenities ({v:.0f})")
    for r in (L.get("reviews") or {}).get("ratings") or []:
        m = re.search(r"(\d(?:\.\d)?)\s*/\s*5", str(r.get("value", "")))
        if m:
            v = (float(m.group(1)) - 1) / 4 * 100
            vals.append(v)
            items.append(f"{r.get('label') or 'rating'} {m.group(1)}/5 ({v:.0f})")
    lux = _grade((L.get("photo_review") or {}).get("building_luxury"))
    if lux is not None:
        vals.append(lux)
        items.append(f"lobby and amenity photos {L['photo_review']['building_luxury']}/5 ({lux:.0f})")
    return (sum(vals) / len(vals) if vals else None), items


def building_risk(L: dict) -> tuple[float | None, list[str]]:
    """Review and public-records risk scores (complaints and violations per 100 units): a coarse signal."""
    vals: list[float] = []
    items: list[str] = []
    rv = L.get("reviews") or {}
    if rv.get("risk_score") is not None:
        vals.append(float(rv["risk_score"]))
        items.append(f"review risk score {float(rv['risk_score']):.0f}")
    rec = L.get("records") or {}
    if rec.get("risk_score") is not None:
        vals.append(float(rec["risk_score"]))
        items.append(f"public records {float(rec['risk_score']):.0f}")
    return (sum(vals) / len(vals) if vals else None), items


def part_building(L: dict, crit: dict | None = None) -> Part:
    """Your rating of the building leads (60%), then its quality (30%), then records risk (10%);
    without a rating, quality 75% and risk 25%. Missing pieces drop out and the rest are reweighted."""
    crit = crit or {}
    rr = renter_rating(L, crit)
    q, q_items = building_quality(L)
    r, r_items = building_risk(L)
    pieces = [(rr and (rr[0] - 1) / 4 * 100, 0.6 if rr else 0.0), (q, 0.3 if rr else 0.75), (r, 0.1 if rr else 0.25)]
    num = sum(v * w for v, w in pieces if v is not None)
    den = sum(w for v, w in pieces if v is not None)
    if not den:
        return Part(None, "no rating, quality facts, reviews or records yet, counted as neutral")
    v = num / den
    items = ([f"your rating {rr[0]:g}/5"] if rr else []) + q_items + r_items
    bits = ([f"your rating {rr[0]:g}/5"] if rr else []) + ([f"quality {q:.0f}"] if q is not None else []) + \
        ([f"records {r:.0f}"] if r is not None else [])
    return Part(v, ", ".join(bits), items, flags=["renter_rated"] if rr else [])


# ---------------------------------------------------------------------- interior

PREMIUM_WORDS = (("sub-zero", 10), ("subzero", 10), ("miele", 10), ("wolf", 8), ("gaggenau", 10),
                 ("bosch", 6), ("bertazzoni", 6), ("fisher", 5), ("thermador", 8), ("viking", 6),
                 ("newly renovated", 10), ("renovated", 6), ("brand new", 8), ("new appliances", 8),
                 ("quartz", 5), ("marble", 5), ("caesarstone", 6), ("stainless", 3), ("hardwood", 3),
                 ("wide plank", 5), ("floor-to-ceiling", 4), ("custom", 3), ("dated", -10),
                 ("original condition", -12), ("as-is", -10), ("carpet", -5), ("formica", -10))


def part_interior(L: dict) -> Part:
    """Finish quality: graded unit photos when there are any (overall, kitchen and bath, renovation,
    appliances), else the listing's own wording about finishes and appliances."""
    pr = _photo_review(L)
    g = _grade(pr.get("interior"))
    if g is not None:
        rooms = [x for x in (_grade(pr.get("kitchen")), _grade(pr.get("bath"))) if x is not None]
        v = 0.5 * g + 0.5 * (sum(rooms) / len(rooms)) if rooms else g
        items = [f"interior {pr['interior']}/5" + "".join(f", {k} {pr[k]}/5" for k in ("kitchen", "bath") if pr.get(k))]
        adj = {"new-or-recent": 6, "updated": 2, "dated": -8}.get(pr.get("renovation"), 0) + \
            {"premium": 6, "modern-stainless": 2, "dated": -8}.get(pr.get("appliances"), 0)
        if adj:
            v += adj
            items.append(f"renovation {pr.get('renovation')}, appliances {pr.get('appliances')} ({adj:+d})")
        flags = []
        if pr.get("scope") == "staged-or-rendered" or pr.get("confidence") == "low":
            v = 0.7 * v + 0.3 * 50
            items.append("staged, rendered or low-confidence photos: pulled 30% toward neutral")
            flags.append("interior_staged")
        if pr.get("evidence"):
            items.append(str(pr["evidence"]))
        return Part(_clamp(v), f"from the unit's photos: {pr['interior']}/5", items, flags=flags)
    text = " ".join(str(x) for x in [*(L.get("features") or {}).values(), L.get("notes") or ""]).lower()
    hits = [(w, pts) for w, pts in PREMIUM_WORDS if w in text]
    if not hits:
        return Part(None, "finishes unknown, counted as neutral")
    v = _clamp(50 + sum(pts for _, pts in hits))
    return Part(v, "from the listing's wording", [f"listing says '{w}' ({pts:+d})" for w, pts in hits],
                flags=["interior_from_text"])


def part_quiet(L: dict) -> Part:
    rec = L.get("records") or {}
    if rec.get("noise_score") is not None:
        v = float(rec["noise_score"])
        return Part(v, f"street-noise score {v:.0f} from public records", [f"records noise score {v:.0f}"])
    rv = " ".join(str(v) for v in (L.get("reviews") or {}).values() if isinstance(v, str)).lower()
    if not rv:
        return Part(None, "noise unknown, counted as neutral")
    s = 60.0
    items = []
    for w, p in (("noise", -12), ("thin wall", -10), ("loud", -8), ("quiet", 10), ("construction", -6),
                 ("truck", -5), ("nightlife", -6), ("bar", -3)):
        if w in rv:
            s += p
            items.append(f"reviews mention '{w}' ({p:+d})")
    return Part(_clamp(s), "from review wording" + (f": {len(items)} noise signals" if items else ", nothing flagged"),
                items)


# ---------------------------------------------------------------------- move date

def part_move_date(L: dict, crit: dict, today: dt.date) -> tuple[Part, str | None]:
    """100 inside the move-in window; early availability costs overlap rent, late leaves a gap."""
    mi = (crit.get("search") or {}).get("move_in") or {}
    earliest, latest = parse_date(mi.get("earliest")), parse_date(mi.get("latest"))
    if not earliest and not latest:
        return Part(None, "no move-in window in the criteria"), None
    avail = parse_date(L.get("available"), today)
    if avail is None:
        return Part(None, "availability unknown, counted as neutral"), None
    earliest = earliest or latest
    latest = latest or earliest
    when = "now" if str(L.get("available") or "").strip().lower().startswith(("now", "immediate")) else _day(avail)
    window = f"{_day(earliest)}-{_day(latest)}"
    if avail < earliest:
        early = (earliest - avail).days
        v = 100.0 if early <= 14 else _lin(early, 14, 100, 45, 40) if early <= 45 else _lin(early, 45, 40, 90, 0)
        note = ", landlords often hold that long" if early <= 14 else ", expect to pay overlapping rent"
        return Part(v, f"available {when}, {early} days before your earliest move-in{note}",
                    [f"move-in window {window}"]), None
    if avail > latest:
        late = (avail - latest).days
        v = _lin(late, 0, 100, 14, 50) if late <= 14 else _lin(late, 14, 50, 30, 0)
        gate = "fails:move_date" if mi.get("hard") else "move_date:after_window"
        return Part(v, f"available {when}, {late} days after your latest move-in", [f"move-in window {window}"]), gate
    return Part(100.0, f"available {when}, inside your {window} window"), None


# ---------------------------------------------------------------------- renewal risk

def part_renewal(cm: dict) -> Part:
    """Deep first-lease concessions usually renew from the gross: 100 - 9 x concession %."""
    rent = cm.get("rent") or {}
    gross = rent.get("gross")
    if gross is None:
        return Part(None, "gross rent unknown, counted as neutral")
    net = rent.get("net")
    if rent.get("basis") == "conditional" and rent.get("illustrations"):
        net = min(x["net"] for x in rent["illustrations"])
    conc = cm.get("concession") or {}
    if net is None or net >= gross or (conc and not conc.get("applies", True)):
        return Part(100.0, "no concession: renewal starts from the rent you pay")
    pct = 100 * (gross - net) / gross
    v = max(0.0, 100 - 9 * pct)
    return Part(v, f"renewal likely priced from the {_money(gross)} gross, {pct:.0f}% above the {_money(net)} net",
                [f"concession worth {pct:.1f}% of the rent (score 100 - 9 x {pct:.1f})"])


# ---------------------------------------------------------------------- transit access

def _split_lines(v: Any) -> list[str]:
    if isinstance(v, (list, tuple)):
        return [str(x).strip() for x in v if str(x).strip()]
    s = str(v or "").strip()
    if not s:
        return []
    if re.search(r"[,/;\s]", s):
        return [x for x in re.split(r"[,/;\s]+", s) if x]
    return list(s) if len(s) <= 6 and s.isalnum() else [s]


def part_transit_access(L: dict, crit: dict) -> Part:
    """Distinct lines within a 10-minute walk, a one-seat ride to the main destination, a close station."""
    st = L.get("stations") or []
    if not st:
        return Part(None, "nearby stations not mapped, counted as neutral")
    lines: list[str] = []
    nearest = None
    for s in st:
        if isinstance(s, (list, tuple)) and len(s) >= 3:      # compact form: [walk minutes, name, lines]
            s = {"walkMinutes": s[0], "name": s[1], "lines": s[2]}
        if not isinstance(s, dict):
            continue
        wm = s.get("walkMinutes", s.get("walk_min"))
        if not isinstance(wm, (int, float)):
            continue
        nearest = wm if nearest is None else min(nearest, wm)
        if wm <= WALK_LINES_MIN:
            for ln in _split_lines(s.get("lines")):
                if ln not in lines:
                    lines.append(ln)
    dests = crit.get("commute", {}).get("destinations") or []
    one_seat = None
    if dests:
        main = max(dests, key=lambda d: d.get("weight", 1.0))
        e = (L.get("commute") or {}).get(main["name"]) or {}
        t = _transfers(e) if e else None
        rides_known = bool(_rides(str(e.get("route") or ""))) or bool((e.get("modes") or {}).get("transit"))
        if t is not None and rides_known:
            one_seat = (t == 0, main["name"])
    v = min(70.0, 14.0 * len(lines))
    items = [f"{len(lines)} line{'s' if len(lines) != 1 else ''} within a {WALK_LINES_MIN}-min walk"
             + (f": {', '.join(lines)}" if lines else "") + f" (+{min(70, 14 * len(lines))})"]
    summ = items[0].split(" (+")[0]
    if one_seat and one_seat[0]:
        v += 20
        items.append(f"one-seat ride to {one_seat[1]} (+20)")
        summ += f"; one-seat ride to {one_seat[1]}"
    if nearest is not None and nearest <= 5:
        v += 10
        items.append(f"nearest station {nearest:g} min away (+10)")
    return Part(min(100.0, v), summ, items)


# ---------------------------------------------------------------------- legacy single-value helpers

def score_space(L: dict, crit: dict) -> float | None:
    return part_space(L, crit).value


def score_commute(L: dict, crit: dict) -> float | None:
    return part_commute(L, crit).value


def score_amenities(L: dict, crit: dict) -> tuple[float | None, list[str], list[str]]:
    p, fails, unknown = part_amenities(L, crit)
    return p.value, fails, unknown


def score_light(L: dict) -> float | None:
    return part_light(L).value


def score_building(L: dict) -> float | None:
    return part_building(L).value


def score_quiet(L: dict) -> float | None:
    return part_quiet(L).value


# ---------------------------------------------------------------------- one listing

def _today(crit: dict, today: dt.date | None) -> dt.date:
    if today:
        return today
    return parse_date((crit.get("scoring") or {}).get("as_of")) or dt.date.today()


def _signed(pts: float) -> str:
    r = round(pts)
    return f"+{r}" if r > 0 else (str(r) if r < 0 else "0")


def score_listing(L: dict, crit: dict, today: dt.date | None = None, comps: Comps | None = None) -> dict[str, Any]:
    today = _today(crit, today)
    cm = cost_model(L, crit, today)
    est = estimated_fees(L, cm, comps)
    if est:
        cm = apply_fee_estimate(cm, est, crit)
    cost = cm.get("budget_amount")
    am, fails, unknown = part_amenities(L, crit)
    move, move_gate = part_move_date(L, crit, today)
    parts_full: dict[str, Part] = {
        "cost": part_cost(cm, crit),
        "space": part_space(L, crit, comps),
        "commute": part_commute(L, crit),
        "amenities": am,
        "light_view": part_light(L),
        "building": part_building(L, crit),
        "interior": part_interior(L),
        "quiet": part_quiet(L),
        "move_date": move,
        "renewal_risk": part_renewal(cm),
        "transit_access": part_transit_access(L, crit),
    }
    parts = {k: p.value for k, p in parts_full.items()}
    w = crit["weights"]
    wtot = sum(w.get(k, 0) for k in DIMENSIONS) or 1
    known_w = sum(w.get(k, 0) for k in DIMENSIONS if parts[k] is not None)

    def bound(k: str, end: int) -> float:
        p = parts_full[k]
        if p.value is None:
            return 100.0 * end
        return p.range[end] if p.range else p.value

    lo = sum(w.get(k, 0) * bound(k, 0) for k in DIMENSIONS) / wtot
    hi = sum(w.get(k, 0) * bound(k, 1) for k in DIMENSIONS) / wtot
    # Unknown dimensions count as a neutral 50 in the point estimate, so missing facts neither help nor
    # sink a listing; `range` shows how far the truth could move it.
    overall = (sum(w.get(k, 0) * (parts[k] if parts[k] is not None else 50) for k in DIMENSIONS) / wtot) if known_w else None
    active = L.get("status") not in ("gone", "rejected")
    gates = []
    hard = crit.get("budget", {}).get("hard_max")
    if cost is not None and hard and cost > hard:
        gates.append("over_budget")
    if fails:
        gates.append("fails:" + ",".join(fails))
    if move_gate == "fails:move_date":
        gates.append(move_gate)
    if unknown:
        gates.append("unverified:" + ",".join(unknown))
    if cost is None:
        gates.append("unknown_cost")
    elif active:
        if not cm.get("fees_known"):
            gates.append("unverified:fees")
        if (cm.get("rent") or {}).get("basis") == "conditional":
            gates.append("unverified:lease_term")
        if (cm.get("concession") or {}).get("excluded"):
            gates.append("concession:not_applied")
        if cm.get("dispute"):
            gates.append("price_dispute")
    if active and move_gate == "move_date:after_window":
        gates.append(move_gate)
    checked = parse_date(L.get("checked"))
    stale_days = int((crit.get("scoring") or {}).get("stale_days") or 21)
    if active and checked and (today - checked).days > stale_days:
        gates.append(f"stale:checked_{(today - checked).days}_days_ago")
    eligible = not any(g.startswith(("over_budget", "fails")) for g in gates) and active

    reasons = []
    flags: set[str] = set()
    for k in DIMENSIONS:
        p = parts_full[k]
        flags.update(p.flags)
        pts = 0.0 if p.value is None else (p.value - 50) * w.get(k, 0) / wtot
        # text = "<signed points> <label>: <summary>"; the dashboard rebuilds the prefix for live weights
        r = {"dim": k, "pts": round(pts, 1), "text": f"{_signed(pts)} {DIMENSION_LABELS[k].lower()}: {p.summary}"}
        if p.items and p.items != [p.summary]:
            r["items"] = p.items
        reasons.append(r)
    if L.get("floor_inferred"):
        flags.add("floor_inferred")
    confidence = round(100 * known_w / wtot)
    tags = []
    if confidence < 60:
        tags.append("thin data")
    if cm.get("dispute") or L.get("conflicts"):
        tags.append("source conflict")
    ppsf = price_per_sqft(L, cm.get("monthly"))
    return {
        "version": SCORE_VERSION,
        "overall": round(overall, 1) if overall is not None else None,
        "parts": {k: (round(v, 1) if v is not None else None) for k, v in parts.items()},
        "part_ranges": {k: list(p.range) for k, p in parts_full.items() if p.range},
        "confidence": confidence,
        "range": [round(lo, 1), round(hi, 1)],
        "monthly_cost": cm.get("monthly_expected", cm.get("monthly")),
        "budget_tier": budget_tier(cost, crit),
        "gates": gates,
        "eligible": eligible,
        "reasons": reasons,
        "flags": sorted(flags),
        "tags": tags,
        "ppsf": ppsf,
        "cost": _compact_cost(cm),
        "preset": (crit.get("scoring") or {}).get("preset"),
    }


def _compact_cost(cm: dict) -> dict:
    """The money model without empty keys or values repeated elsewhere, to keep listings.json small."""
    out = {}
    for k, v in cm.items():
        if v in (None, [], {}, False) and k not in ("fees_known",):
            continue
        if k == "budget_amount" and v == cm.get("monthly"):
            continue
        if k == "renewal_base" and v == (cm.get("rent") or {}).get("gross"):
            continue
        if k == "headroom":
            v = {r["tier"]: r["room"] for r in v}
        if isinstance(v, dict) and k != "headroom":
            v = {kk: vv for kk, vv in v.items() if vv not in (None, [], {}, False)}
        out[k] = v
    return out


# ---------------------------------------------------------------------- ranking

def _key(L: dict) -> tuple:
    s = L["score"]
    mc = s.get("monthly_cost")
    return (-s["overall"], -s.get("confidence", 0), mc if mc is not None else float("inf"), str(L.get("id")))


def _building_key(L: dict) -> str:
    return str(L.get("bin") or "").split(".")[0] or str(L.get("building") or L.get("address") or L.get("id")).lower()


def score_all(listings: list[dict], crit: dict, today: dt.date | None = None, tours: dict[str, dict] | None = None) -> list[dict]:
    """Score every listing and write ``rank`` (= ``ranks.action``) and ``ranks`` (fit / action / budget /
    building). Ties break on confidence, then lower cost, then id.

    ``tours`` maps a listing id to the renter's tour findings (``tours.load_all``). A finding the renter promoted is read
    as a fact (the listing itself is not changed); one that contradicts the listing and was not promoted only adds a
    ``contradicted:<field>`` gate, a "differs on tour" tag and a line in the reasons."""
    today = _today(crit, today)
    comps = build_comps(listings)
    for L in listings:
        f = (tours or {}).get(L.get("id"))
        if f:
            L["score"] = tours_mod.annotate_score(score_listing(tours_mod.overlay(L, f), crit, today, comps), tours_mod.flags_for(L, f))
        else:
            L["score"] = score_listing(L, crit, today, comps)
    scored = [L for L in listings if L["score"]["overall"] is not None]
    for L in listings:
        L["score"]["ranks"] = {"fit": None, "action": None, "budget": None, "building": None}
        L["score"].pop("rank", None)
    for i, L in enumerate(sorted(scored, key=_key), 1):
        L["score"]["ranks"]["fit"] = i
    action = sorted((L for L in scored if L["score"]["eligible"]), key=_key)
    for i, L in enumerate(action, 1):
        L["score"]["ranks"]["action"] = i
        L["score"]["rank"] = i
    tiers = crit.get("budget", {}).get("tiers") or []
    cap = tiers[0]["max"] if tiers else crit.get("budget", {}).get("hard_max")
    if cap:
        pool = [L for L in action if (L["score"]["cost"].get("budget_amount", L["score"]["monthly_cost"])
                                      or float("inf")) <= cap]
        for i, L in enumerate(pool, 1):
            L["score"]["ranks"]["budget"] = i
    best: dict[str, dict] = {}
    for L in action:
        best.setdefault(_building_key(L), L)
    order = {k: i for i, k in enumerate(best, 1)}
    for L in listings:
        L["score"]["ranks"]["building"] = order.get(_building_key(L))
    return listings
