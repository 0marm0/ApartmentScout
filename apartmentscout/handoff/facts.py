"""What is known and what is missing for each listing: missing facts, landlord questions and coverage counts.

Shared by `apartmentscout export` (To verify and Outreach sheets) and `apartmentscout handoff pack` (manifest
coverage and the paste-ready message). Pure functions over listings and criteria; nothing is written.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Iterable

INACTIVE = ("gone", "rejected")
FOCUS_STATUSES = ("shortlist", "touring", "applied")
PRICE_FEE_KEYS = ("fees_monthly", "fees_one_time")
AMENITY_LABELS = {
    "in_unit_wd": "an in-unit washer/dryer", "elevator": "an elevator", "doorman": "a doorman (and what hours)",
    "gym": "a gym", "pool": "a pool", "roof_deck": "a roof deck", "outdoor_space": "private outdoor space",
    "dishwasher": "a dishwasher", "central_ac": "central air", "pets": "pets allowed", "parking": "parking",
    "bike_room": "a bike room", "package_room": "a package room", "lounge": "a lounge",
    "coworking": "a co-working space", "game_room": "a game room",
}


def is_active(L: dict) -> bool:
    return L.get("status") not in INACTIVE


def parse_date(v: Any) -> dt.date | None:
    """ISO date or datetime (``2026-10-04``, ``2026-10-04T09:30``) -> date; anything else (``Now``) -> None."""
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.match(r"^\s*(\d{4})-(\d{2})-(\d{2})", str(v or ""))
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def unverified(L: dict) -> list[str]:
    """Every fact a gate marks unverified (must-have amenities, and with newer scorers fees or lease term)."""
    out: list[str] = []
    for g in (L.get("score") or {}).get("gates") or []:
        if g.startswith("unverified:"):
            out += [k for k in g.split(":", 1)[1].split(",") if k and k not in out]
    return out


def unverified_must_haves(L: dict) -> list[str]:
    return [k for k in unverified(L) if k in AMENITY_LABELS]


def missing_facts(L: dict, crit: dict) -> list[str]:
    """Short labels for the facts a finalist needs that this listing lacks (see AGENTS.md quality bar)."""
    p = L.get("price") or {}
    out: list[str] = []
    if p.get("gross") is None and p.get("net_effective") is None:
        out.append("rent")
    if all(p.get(k) is None for k in PRICE_FEE_KEYS):
        out.append("fees")
    if not L.get("sqft"):
        out.append("size (sq ft)")
    if L.get("floor") is None:
        out.append("floor")
    elif L.get("floor_inferred"):
        out.append("floor (inferred from unit number)")
    if not L.get("exposure") and not (L.get("site") or {}).get("bearing"):
        out.append("exposure")
    if not L.get("available"):
        out.append("move-in date")
    cm = L.get("commute") or {}
    for d in (crit.get("commute") or {}).get("destinations") or []:
        if (cm.get(d.get("name")) or {}).get("minutes") is None:
            out.append(f"commute: {d.get('name')}")
    parts = (L.get("score") or {}).get("parts") or {}
    if parts and parts.get("building") is None:
        out.append("reviews or building records")
    if parts and parts.get("quiet") is None:
        out.append("noise evidence")
    for k in unverified(L):
        if k == "fees" and "fees" in out:
            continue
        out.append(f"must-have: {k}" if k in AMENITY_LABELS else f"unverified: {k.replace('_', ' ')}")
    if not (L.get("links") or {}).get("listing") and not L.get("sources"):
        out.append("source link")
    return out


def questions_for(L: dict, crit: dict) -> list[str]:
    """Plain questions for the leasing office, renter-neutral, generated from the missing facts."""
    p = L.get("price") or {}
    unit = f"unit {L['unit']}" if L.get("unit") else "the unit"
    q: list[str] = []
    if p.get("gross") is None:
        q.append(f"What is the current gross rent for {unit}, and is any concession offered?")
    elif p.get("free_months") is None and p.get("net_effective") is None:
        q.append(f"Is there a concession on {unit} (free months, lease length), and is it tied to a start date?")
    if all(p.get(k) is None for k in PRICE_FEE_KEYS):
        q.append("What are all monthly fees (amenity, utilities, pets) and one-time fees (application, move-in)?")
    if p.get("broker_fee") is None:
        q.append("Is there a broker fee, and who pays it?")
    if not L.get("sqft"):
        q.append(f"What is the square footage of {unit}, and can you send the floor plan?")
    if L.get("floor") is None or L.get("floor_inferred"):
        q.append(f"Which floor is {unit} on?")
    if not L.get("exposure") and not (L.get("site") or {}).get("bearing"):
        q.append(f"Which direction do the main windows of {unit} face?")
    if not L.get("available"):
        q.append(f"When is {unit} available, and how flexible is the start date?")
    for k in unverified_must_haves(L):
        q.append(f"Does {unit} have {AMENITY_LABELS.get(k, k.replace('_', ' '))}?")
    rq = (L.get("reviews") or {}).get("questions")
    if isinstance(rq, str) and rq.strip():
        q.append(rq.strip())
    elif isinstance(rq, list):
        q += [str(x).strip() for x in rq if str(x).strip()]
    return q


def focus_listings(listings: Iterable[dict], top: int = 25) -> list[dict]:
    """Listings worth contacting: shortlisted, touring, applied or favourite, plus the top ranked eligible ones."""
    Ls = [L for L in listings if is_active(L)]
    picked = {L["id"]: L for L in Ls if L.get("status") in FOCUS_STATUSES or L.get("favorite")}
    ranked = sorted((L for L in Ls if (L.get("score") or {}).get("rank")), key=lambda L: L["score"]["rank"])
    for L in ranked[:top]:
        picked.setdefault(L["id"], L)
    return sorted(picked.values(), key=lambda L: ((L.get("score") or {}).get("rank") or 10 ** 6, L["id"]))


def coverage(listings: list[dict], crit: dict, files: dict[str, int] | None = None) -> dict[str, int]:
    """Counts for the handoff manifest: how complete the search is and how much is still open."""
    active = [L for L in listings if is_active(L)]
    sc = [L.get("score") or {} for L in listings]
    out = {
        "listings": len(listings),
        "active": len(active),
        "gone": sum(L.get("status") == "gone" for L in listings),
        "rejected": sum(L.get("status") == "rejected" for L in listings),
        "shortlist": sum(L.get("status") in FOCUS_STATUSES for L in listings),
        "eligible": sum(bool(s.get("eligible")) for s in sc),
        "ranked": sum(bool(s.get("rank")) for s in sc),
        "with_sqft": sum(bool(L.get("sqft")) for L in active),
        "with_fees": sum(any((L.get("price") or {}).get(k) is not None for k in PRICE_FEE_KEYS) for L in active),
        "with_exposure": sum(bool(L.get("exposure") or (L.get("site") or {}).get("bearing")) for L in active),
        "with_site": sum(bool(L.get("site")) for L in listings),
        "open_questions": sum(bool(missing_facts(L, crit)) for L in active),
    }
    out.update(files or {})
    return out
