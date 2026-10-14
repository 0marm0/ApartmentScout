"""One question generator for call sheets, leasing inquiries, coverage.json and the landlord template.

Questions come only from what is actually unknown or doubtful for a unit: missing or stale facts from the
completion standard, must-haves nobody has confirmed, and listing-trap flags from ``apartmentscout lint``.
A fact that is already known never produces a question. Wording is neutral (it works for any renter and
any city) and every question can be sent as written.

    from apartmentscout.questions import questions, inquiry
    questions(listing, criteria)          # [{"key", "group", "text"}], most decisive first
    inquiry(listing, criteria)            # a ready-to-send message built from the same list
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Iterable

from .quality.common import crit_today, move_in, num, parse_date

GROUPS = ("confirm in writing", "show me", "tour test")

AMENITY_QUESTIONS = {
    "in_unit_wd": "Is there a washer and dryer inside the unit itself (not a building laundry room)?",
    "elevator": "Does the building have an elevator serving this floor?",
    "doorman": "Is there a doorman, and are the hours full-time, part-time or virtual?",
    "gym": "Is there a gym, and is it included in the rent or a separate fee?",
    "pets": "Are pets allowed in this unit, and with what size or breed limits and fees?",
    "dishwasher": "Does the unit have a dishwasher?",
    "central_ac": "How is the unit cooled: central air, through-wall units or window units?",
    "outdoor_space": "Does the unit have private outdoor space?",
    "parking": "Is parking available, and at what monthly cost?",
}

# lint code -> (question key it adds or sharpens, group, text). {unit}, {start} are filled in.
FLAG_QUESTIONS = {
    "building_laundry_as_in_unit": ("laundry", "confirm in writing",
                                    "Is the washer and dryer inside unit {unit}, or is laundry in the building?"),
    "fee_is_price_drop": ("rent", "confirm in writing",
                          "Was the rent on unit {unit} recently reduced? Please confirm the current rent and list any "
                          "monthly fees separately."),
    "url_names_other_building": ("identity", "confirm in writing",
                                 "Can you confirm the building address for unit {unit}? The listing page names a different "
                                 "address or unit."),
    "sale_not_rental": ("identity", "confirm in writing", "Is unit {unit} for rent (not for sale), and on what lease terms?"),
    "concession_expired_by_start": ("concession", "confirm in writing",
                                    "The offer mentions a start-by date before {start}. Would the concession still apply to "
                                    "a lease starting {start}?"),
    "doorman_overstated": ("doorman", "confirm in writing",
                           "Is the front desk staffed around the clock, and by a doorman or by security? Is it ever virtual?"),
    "no_unit_number": ("identity", "confirm in writing", "Which exact unit number is this listing for?"),
    "challenge_page_evidence": ("status", "confirm in writing", "Is unit {unit} still available, and at what rent?"),
}


def _fill(t: str, L: dict, crit: dict) -> str:
    earliest, _ = move_in(crit)
    return t.format(unit=L.get("unit") or "this unit", start=earliest.strftime("%B %-d") if earliest else "my move-in date")


def _money(v: Any) -> str:
    x = num(v)
    return f"${x:,.0f}" if x is not None else "the listed rent"


def _fact_question(k: str, L: dict, crit: dict, stale: bool, flag_codes: set[str], today: dt.date) -> tuple[str, str] | None:
    p = L.get("price") or {}
    unit = L.get("unit") or "this unit"
    earliest, latest = move_in(crit)
    start = earliest.strftime("%B %-d") if earliest else "my move-in date"
    ck = parse_date(L.get("checked"))
    seen = f" (last seen {ck.isoformat()})" if ck else ""
    if k == "rent":
        if stale:
            return "confirm in writing", f"Is unit {unit} still available at {_money(p.get('gross') or p.get('net_effective'))}?{seen}"
        return "confirm in writing", f"What is the current gross monthly rent for unit {unit}?"
    if k == "concession":
        fm, lm = num(p.get("free_months")), num(p.get("lease_months"))
        if fm and lm is None:
            return "confirm in writing", (f"The {fm:g} free month(s): on what lease length, are they given as free months or "
                                          f"spread across the lease, and do they apply to a lease starting {start}?")
        return "confirm in writing", (f"Is there a concession on unit {unit}? If so, how many free months, on what lease "
                                      f"length, and does it apply to a lease starting {start}?")
    if k == "fees":
        tail = " If there are none, please confirm that in writing." if "zero_fee_asserted" in flag_codes or num(p.get("fees_monthly")) == 0 else ""
        return "confirm in writing", ("Please list every required monthly charge on top of rent (amenity, utilities, internet, "
                                      f"pet, storage) with amounts.{tail}")
    if k == "move_in_costs":
        return "confirm in writing", ("What does it cost to move in (application, move-in, board or broker fees, deposits), "
                                      "and which of those are refundable?")
    if k == "start_date":
        win = f" between {earliest.isoformat()} and {latest.isoformat()}" if earliest and latest else ""
        return "confirm in writing", f"Can the lease start on {start}? What start dates can you offer{win}?"
    if k == "size":
        return "confirm in writing", f"What is the square footage of unit {unit}, and is it measured or estimated?"
    if k == "plan":
        extra = " The plan we have is labelled for another unit." if "plan_label_mismatch" in flag_codes else ""
        return "show me", f"Could you send the floor plan for unit {unit} itself, not the line or a similar unit?{extra}"
    if k == "bedroom":
        return "show me", ("Is the bedroom a separate room with its own door and a window? Is the layout original, or does it "
                           "rely on a flex or pressurised wall?")
    if k == "floor":
        return "confirm in writing", f"Which floor is unit {unit} on?"
    if k == "exposure":
        return "show me", "Which way do the main windows face, and what do they look out on?"
    if k == "media":
        extra = " The photos we have look staged or from a similar unit." if "photos_not_this_unit" in flag_codes else ""
        return "show me", f"Do you have current photos or a video of unit {unit} itself?{extra}"
    if k == "status":
        if stale or "stale_or_cached_page" in flag_codes:
            return "confirm in writing", f"Is unit {unit} still available at {_money(p.get('gross') or p.get('net_effective'))}?{seen}"
        return "confirm in writing", f"Is unit {unit} still available?"
    return None   # commute and building records are research, not questions for the landlord


def questions(L: dict, crit: dict, missing: Iterable[str] | None = None, stale: Iterable[str] | None = None,
              flags: Iterable[Any] | None = None, today: Any = None) -> list[dict[str, str]]:
    """Questions for one unit, most decisive first: [{"key", "group", "text"}].

    ``missing``/``stale`` default to the completion standard's assessment; ``flags`` are lint Flags or dicts."""
    from .quality.standard import assess, KEYS
    t = crit_today(crit, today)
    flag_list = [f if isinstance(f, dict) else f.as_dict() for f in (flags or [])]
    codes = {f.get("code") for f in flag_list}
    if missing is None or stale is None:
        a = assess(L, crit, t, flag_codes=codes)
        missing = a["missing"] if missing is None else missing
        stale = a["stale"] if stale is None else stale
    missing, stale = list(missing), list(stale)
    out: list[dict[str, str]] = []
    seen: set[str] = set()

    def push(key: str, group: str, text: str) -> None:
        if key not in seen and text not in seen:
            seen.update((key, text))
            out.append({"key": key, "group": group, "text": text})

    # 1. identity problems first: no point asking anything else about the wrong unit
    for f in flag_list:
        q = FLAG_QUESTIONS.get(f.get("code"))
        if q and q[0] == "identity":
            push(q[0], q[1], _fill(q[2], L, crit))
    # 2. unconfirmed must-haves (open gates), one question each
    am = L.get("amenities") or {}
    if "must_haves" in missing:
        for k in crit.get("must_have") or []:
            if am.get(k) is None:
                push(f"must_have:{k}", "confirm in writing",
                     AMENITY_QUESTIONS.get(k, f"Please confirm in writing whether the unit has {k.replace('_', ' ')}."))
    # 3. flags that sharpen a specific fact
    for f in flag_list:
        q = FLAG_QUESTIONS.get(f.get("code"))
        if q and q[0] != "identity":
            push(q[0], q[1], _fill(q[2], L, crit))
    # 4. missing facts in standard order, then stale ones
    for k in KEYS:
        if k in missing or k in stale:
            q = _fact_question(k, L, crit, k in stale, codes, t)
            if q:
                push(k, *q)
    if "bedroom" not in seen and "junior_or_flex_1br" in codes:
        q = _fact_question("bedroom", L, crit, False, codes, t)
        push("bedroom", *q)
    # tour tests for things only a visit settles
    if "junior_or_flex_1br" in codes or "bedroom" in missing:
        push("tour:bedroom", "tour test", "On the visit: check the bedroom door closes fully and the room has its own window.")
    if "exposure" in missing:
        push("tour:exposure", "tour test", "On the visit: note the compass direction at the main window and what blocks the view.")
    return out


def question_texts(L: dict, crit: dict, **kw: Any) -> list[str]:
    return [q["text"] for q in questions(L, crit, **kw)]


def inquiry(L: dict, crit: dict, sender: str = "<Name>", **kw: Any) -> str:
    """A complete, polite leasing inquiry built from :func:`questions` (written-confirmation items only)."""
    qs = [q for q in questions(L, crit, **kw) if q["group"] != "tour test"]
    p = L.get("price") or {}
    rent = num(p.get("gross") or p.get("net_effective"))
    head = f"Hello, I'm interested in unit {L.get('unit') or '(unit number?)'} at {L.get('building') or L.get('address') or 'your building'}"
    head += f" (listed at ${rent:,.0f})." if rent else "."
    body = "\n".join(f"{i}. {q['text']}" for i, q in enumerate(qs, 1)) or "1. Is the unit still available?"
    return f"{head} Before I tour or apply, could you confirm the following?\n\n{body}\n\nThank you,\n{sender}\n"
