"""The completion standard: the facts a finalist needs before a renter can decide, and which of them a listing has."""
from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

from ..listings import price_unverified
from .common import num, parse_date, stale_days

# key, label, why it matters. Order is the order questions are asked in.
STANDARD: list[dict[str, str]] = [
    {"key": "rent", "label": "Gross rent", "why": "Every cost comparison starts from the gross rent."},
    {"key": "concession", "label": "Concession and lease term",
     "why": "Free months without a term give no real net rent; renewals are priced on gross."},
    {"key": "fees", "label": "Required monthly fees",
     "why": "Amenity, utility and service charges move the true monthly cost; unknown is not zero."},
    {"key": "move_in_costs", "label": "One-time move-in costs",
     "why": "Application, move-in and board fees change the first-lease cost."},
    {"key": "start_date", "label": "Lease start date", "why": "A unit that cannot start in the move-in window is not an option."},
    {"key": "size", "label": "Square footage", "why": "Size is a heavily weighted dimension and unknown size scores as neutral."},
    {"key": "plan", "label": "Floor plan of this unit", "why": "Only the unit's own plan proves the layout, door and laundry closet."},
    {"key": "bedroom", "label": "Enclosed bedroom", "why": "Junior, flex and alcove layouts are often listed as one-bedrooms."},
    {"key": "must_haves", "label": "Must-haves confirmed", "why": "An unconfirmed must-have is an open gate, not a pass."},
    {"key": "floor", "label": "Floor (stated, not guessed)", "why": "Light, view and noise depend on the floor."},
    {"key": "exposure", "label": "Window direction", "why": "Direct sun and view depend on which way the windows face."},
    {"key": "media", "label": "Photos or video of this unit", "why": "Model and building photos do not show this unit's condition or view."},
    {"key": "commute", "label": "Commute time", "why": "Door-to-door time to every destination."},
    {"key": "building", "label": "Building records or reviews", "why": "Management, repairs and noise history."},
    {"key": "status", "label": "Availability checked recently", "why": "Listings go fast; an old check is not a fresh one."},
]
KEYS = [s["key"] for s in STANDARD]
LABELS = {s["key"]: s["label"] for s in STANDARD}
# facts that age: a known value from an old check counts as stale
TIME_SENSITIVE = {"rent", "concession", "fees", "start_date", "status"}


def standard_for(crit: dict) -> list[dict[str, str]]:
    """The standard for this search: the bedroom check applies only when criteria ask for a bedroom,
    the commute only when there are destinations."""
    need_bed = ((crit.get("unit") or {}).get("min_beds") or 0) >= 1
    has_dest = bool((crit.get("commute") or {}).get("destinations"))
    return [s for s in STANDARD if (s["key"] != "bedroom" or need_bed) and (s["key"] != "commute" or has_dest)]


def fee_known(p: dict, key: str) -> bool:
    """A fee total is known when it is stated (0 included: the data model's way to say "no fees"; lint flags an
    unsourced $0 so someone confirms it) or when the itemised ``fees[]`` schedule has items for that period."""
    if p.get(key) is not None:
        return True
    period = "monthly" if key == "fees_monthly" else "one_time"
    return any(isinstance(f, dict) and f.get("period", "monthly") == period for f in p.get("fees") or [])


def size_known(L: dict) -> bool:
    if num(L.get("sqft")):
        return True
    s = L.get("size")
    return isinstance(s, dict) and any(s.get(k) for k in ("sqft", "range", "main_rooms_sqft"))


def known_facts(L: dict, crit: dict, plans: set[str] | None = None, flag_codes: set[str] | None = None) -> dict[str, bool]:
    """Which standard facts the listing has evidence for (regardless of how old the evidence is)."""
    p = L.get("price") or {}
    am = L.get("amenities") or {}
    flag_codes = flag_codes or set()
    g, ne = num(p.get("gross")), num(p.get("net_effective"))
    fm, lm = num(p.get("free_months")), num(p.get("lease_months"))
    av = L.get("available")
    links = L.get("links") or {}
    plan_ok = bool(links.get("floorplan") or L.get("floorplan_images") or (plans and L.get("id") in plans)) \
        and "plan_label_mismatch" not in flag_codes
    bed = L.get("bedroom_enclosed")
    commute = L.get("commute") or {}
    dests = [d.get("name") for d in (crit.get("commute") or {}).get("destinations") or []]
    unit_media = bool(L.get("photos") or L.get("photos_local") or links.get("video")
                      or any(isinstance(b, dict) and b.get("scope") == "exact-unit" for b in L.get("building_photos") or []))
    return {
        "rent": g is not None or ne is not None,
        "concession": (fm == 0) or (bool(fm) and lm is not None) or (g is not None and ne is not None and abs(g - ne) < 1),
        "fees": fee_known(p, "fees_monthly"),
        "move_in_costs": fee_known(p, "fees_one_time") or any(p.get(k) is not None for k in
                                                              ("broker_fee", "application_fee", "upfront")),
        "start_date": parse_date(av) is not None or str(av or "").strip().lower() in ("now", "immediate", "immediately"),
        "size": size_known(L),
        "plan": plan_ok,
        "bedroom": isinstance(bed, bool) and "junior_or_flex_1br" not in flag_codes,
        "must_haves": all(am.get(k) is not None for k in crit.get("must_have") or []),
        "floor": L.get("floor") is not None and not L.get("floor_inferred"),
        "exposure": bool(L.get("exposure")),
        "media": unit_media,
        "commute": bool(dests) and all((commute.get(d) or {}).get("minutes") is not None for d in dests),
        "building": bool(L.get("records") or (L.get("reviews") or {}).get("summary") or L.get("dossier")),
        "status": parse_date(L.get("checked")) is not None,
    }


def assess(L: dict, crit: dict, today: dt.date, plans: set[str] | None = None,
           flag_codes: set[str] | None = None) -> dict[str, list[str]]:
    """have / missing / stale lists (disjoint) against the search's standard."""
    facts = known_facts(L, crit, plans, flag_codes)
    ck = parse_date(L.get("checked"))
    old = ck is None or (today - ck).days > stale_days(crit)
    have, missing, stale = [], [], []
    for s in standard_for(crit):
        k = s["key"]
        if not facts[k]:
            missing.append(k)
        elif k in TIME_SENSITIVE and (old or (k == "rent" and price_unverified(L))):
            stale.append(k)       # a rent read from a weak source (snippet, building page, undated copy) is never "fresh"
        else:
            have.append(k)
    return {"have": have, "missing": missing, "stale": stale}


def plan_ids(root: Path | None) -> set[str]:
    if root is None or not (root / "plans").is_dir():
        return set()
    return {p.stem for p in (root / "plans").glob("*.json")}


def label(key: Any) -> str:
    return LABELS.get(str(key), str(key))
