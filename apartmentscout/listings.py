"""Listing schema, normalisation and file I/O.

A *listing* is one rentable unit. Everything in ApartmentScout reads and writes
the same JSON shape (see ``docs/guides/data-model.md``). Agents may add any extra
keys they like; unknown keys are preserved.

Minimal valid listing::

    {"id": "emerald-green-1211", "building": "Emerald Green", "unit": "1211",
     "address": "320 W 38th St, New York, NY", "price": {"gross": 5021}}
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable

# Amenity keys the scorer understands. Values are True / False / None (unknown),
# except ``doorman`` which is one of: "full-time", "part-time", "virtual", "none", None.
AMENITY_KEYS = [
    "in_unit_wd", "elevator", "doorman", "gym", "pool", "roof_deck", "outdoor_space",
    "dishwasher", "central_ac", "pets", "parking", "bike_room", "package_room",
    "lounge", "coworking", "game_room",
]

STATUSES = ["new", "researching", "shortlist", "touring", "applied", "rejected", "gone"]


def slugify(*parts: Any) -> str:
    s = "-".join(str(p) for p in parts if p not in (None, ""))
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "listing"


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d[\d,]*\.?\d*", str(v))
    return float(m.group(0).replace(",", "")) if m else None


def _tri(v: Any) -> bool | None:
    """Parse yes/no/unknown text into True/False/None."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    t = str(v).strip().lower()
    if t.startswith(("yes", "y ", "true", "in unit", "in-unit")) or t in {"y", "1"}:
        return True
    if t.startswith(("no", "none", "false", "n ")) or t in {"n", "0"}:
        return False
    return None


# ---------------------------------------------------------------------- wording normalisers

_NEG_SERVICE = re.compile(r"\b(no|without|not|lacks?)\b[^.;,]*\b"
                          r"(door\s*(man|person|staff|attendant)|concierge|attended)|"
                          r"\b(door\s*(man|person|staff|attendant)|concierge)\W+(no|none)\b")
_FULL_SERVICE = re.compile(r"24\s*(?:-|/|\s)?\s*(?:hours?|hrs?|h\b|7|/7)|round[- ]the[- ]clock|around[- ]the[- ]clock|"
                           r"full[- ]?time|full[- ]service|\bstaffed\b|attended lobby")
_PART_SERVICE = re.compile(r"part[- ]?time|evening|overnight only|night only|weekday|limited hours|"
                           r"\b\d{1,2}\s*(?:am|pm)\b")
_DOOR_WORDS = re.compile(r"door\s*(?:man|men|person|staff|attendant)|concierge|lobby attendant|front desk")


def normalise_service(v: Any) -> str | None:
    """Door-service wording to ``full-time | part-time | virtual | none`` (None = unknown).

    "24-hour concierge", "24 hr doorman", "24/7 staffed lobby", "full-time doorman" -> full-time; a
    concierge counts as a doorman unless it is virtual. A live-in super or a security camera is not a
    doorman and stays unknown.
    """
    if v is None or v == "" or isinstance(v, bool):
        return None
    t = str(v).strip().lower()
    if t in {"full-time", "part-time", "virtual", "none"}:
        return t
    if t in {"no", "n", "none", "false", "0", "-"} or _NEG_SERVICE.search(t):
        return "none"
    if "virtual" in t or "video intercom" in t or "remote" in t:
        return "virtual"
    if _FULL_SERVICE.search(t):
        return "full-time"
    if _PART_SERVICE.search(t):
        return "part-time"
    if _DOOR_WORDS.search(t) or t.startswith(("yes", "y ")):
        return "full-time"
    return None


def parse_doorman(v: Any) -> str | None:
    """Backward-compatible name for :func:`normalise_service`."""
    return normalise_service(v)


_LAUNDRY_SHARED = re.compile(r"laundry (?:room|in (?:the )?(?:building|basement)|on (?:each|every|the) floor)|"
                             r"in[- ]building laundry|building laundry|common laundry|shared|basement|"
                             r"laundromat|hook-?ups?|hookups only")
_LAUNDRY_UNIT = re.compile(r"in[- ]?(?:unit|apartment|residence|home)|washer\s*(?:/|and|&)\s*dryer|\bw\s*/\s*d\b|"
                           r"washer-dryer")


def normalise_laundry(v: Any) -> bool | None:
    """In-unit washer/dryer from wording: "laundry in building" is *not* in-unit (False)."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    t = str(v).strip().lower()
    if t.startswith(("no", "none", "false")) or t in {"n", "0"}:
        return False
    if _LAUNDRY_SHARED.search(t) and not re.search(r"in[- ]?(?:unit|apartment|residence)", t):
        return False
    if _LAUNDRY_UNIT.search(t) or t.startswith(("yes", "y ", "true")) or t in {"y", "1"}:
        return True
    return None


_STUDIO = re.compile(r"\bstudio\b")
_NOT_APT_STUDIO = re.compile(r"\b(fitness|yoga|pilates|art|artist|recording|music|dance|photo|podcast|media|"
                             r"spin|cycling|wellness|cycle|barre|boxing)\s+studios?\b|\bstudio\s+(?:space|room)s?\b|"
                             r"not an? studio|isn'?t an? studio|no studios?\b")


def is_studio(L: dict) -> bool | None:
    """True for an explicit studio (0 bedrooms or "studio" as the unit type), False for a known
    bedroom count, None when unknown. A "fitness studio" amenity never makes a studio apartment."""
    beds = L.get("beds")
    if beds is not None:
        try:
            return float(beds) == 0
        except (TypeError, ValueError):
            pass
    text = " ".join(str(L.get(k) or "") for k in ("type", "layout", "unit_type", "title")).lower()
    if not text.strip():
        return None
    cleaned = _NOT_APT_STUDIO.sub(" ", text)
    return True if _STUDIO.search(cleaned) else None


# ---------------------------------------------------------------------- money

DEFAULT_TERM = 12                 # months, only ever used to spread one-time fees, and flagged
ILLUSTRATION_TERMS = (12, 14)     # lease terms shown when free months come without a term
DEFAULT_PRICE_BAND = 0.05         # how far an unverified price may sit above what was seen (``scoring.unverified_price_band``)

# Where a price was read (``price.basis``): label and whether the number is weak. A weak price (a search-result
# snippet, a building page, a copy with no dated check, a listing known to be old) is ranked on the paid-month rent,
# never on a net it quotes, gets a cost range and the ``unverified:price`` gate; the listing stays visible.
PRICE_BASES: dict[str, tuple[str, bool]] = {
    "unit_page": ("the exact unit page", False),
    "owner_page": ("the owner's or building's own site", False),
    "leasing_office": ("a quote from the leasing office or agent", False),
    "renter_quote": ("a quote the renter received", False),
    "broker_card": ("the listing broker's own card", False),
    "building_page": ("a building inventory page, unit page not read", True),
    "search_snippet": ("a search-result snippet, listing not opened", True),
    "received": ("a copy received from another source, no dated check of the unit", True),
    "stale": ("a page known to be old, delisted or history only", True),
    "estimate": ("an estimate, not a quote", True),
}
PRICE_TEXT_FIELDS = ("basis", "source", "checked", "note")   # price.* keys that are text, not numbers (CSV import)
_PRICE_BASIS_ALIASES = {
    "unit": "unit_page", "exact_unit": "unit_page", "listing_page": "unit_page", "exact_listing": "unit_page",
    "owner": "owner_page", "building_site": "owner_page", "official": "owner_page", "official_site": "owner_page",
    "leasing": "leasing_office", "agent": "leasing_office", "quote": "leasing_office", "phone": "leasing_office",
    "renter": "renter_quote", "user": "renter_quote",
    "broker": "broker_card", "card": "broker_card", "broker_search_card": "broker_card",
    "building": "building_page", "building_list": "building_page", "inventory": "building_page",
    "snippet": "search_snippet", "search": "search_snippet", "search_result": "search_snippet",
    "search_title": "search_snippet", "portal_search": "search_snippet",
    "copy": "received", "unchecked": "received", "unverified": "received", "workbook": "received",
    "old": "stale", "delisted": "stale", "history": "stale", "cached": "stale",
    "estimated": "estimate", "assumed": "estimate",
}
_NOW_WORDS = ("now", "immediate", "immediately", "asap", "available now", "vacant")


def _range(v: Any) -> tuple[float, float] | None:
    """A number, ``[lo, hi]``, ``{"min", "max"}`` or text like "$50-100" as (lo, hi); None if unknown."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return (float(v), float(v))
    if isinstance(v, dict):
        xs = [_num(v.get(k)) for k in ("min", "lo", "max", "hi")]
        xs = [x for x in xs if x is not None]
        return (min(xs), max(xs)) if xs else None
    if isinstance(v, (list, tuple)):
        xs = [x for x in (_num(i) for i in v) if x is not None]
        return (min(xs), max(xs)) if xs else None
    xs = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.?\d*", str(v))[:2]]
    return (min(xs), max(xs)) if xs else None


def parse_date(v: Any, today: dt.date | None = None) -> dt.date | None:
    """ISO dates, m/d/yyyy, date objects; "Now"/"Immediately" become ``today`` when given."""
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    if s.lower() in _NOW_WORDS or s.lower().startswith("now"):
        return today
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        pass
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
    if m:
        y = int(m.group(3))
        try:
            return dt.date(y + 2000 if y < 100 else y, int(m.group(1)), int(m.group(2)))
        except ValueError:
            return None
    return None


def _round(x: float | None) -> float | None:
    return None if x is None else round(x, 2)


def price_basis(listing: dict) -> str | None:
    """Canonical ``price.basis`` (or the listing-level ``price_basis``), None when it is absent or not recognised."""
    p = listing.get("price") or {}
    raw = p.get("basis", listing.get("price_basis"))
    if raw in (None, ""):
        return None
    key = re.sub(r"[^a-z]+", "_", str(raw).strip().lower()).strip("_")
    key = _PRICE_BASIS_ALIASES.get(key, key)
    return key if key in PRICE_BASES else None


def price_unverified(listing: dict) -> bool:
    """True when the rent was read from a weak source (see :data:`PRICE_BASES`)."""
    b = price_basis(listing)
    return bool(b and PRICE_BASES[b][1])


def net_effective(price: dict) -> float | None:
    """Monthly net-effective rent: gross spread over the lease after free months.

    Never invents a term: free months without ``lease_months`` give None (see :func:`cost_model`
    for the illustrations at 12 and 14 months). No free months means net = gross.
    """
    if not price:
        return None
    if price.get("net_effective") is not None:
        return _num(price["net_effective"])
    gross = _num(price.get("gross"))
    if gross is None:
        return None
    conc = price.get("concession") if isinstance(price.get("concession"), dict) else {}
    free = _range(conc.get("free_months", price.get("free_months")))
    if not free or free[1] == 0:
        return gross
    lease = _num(conc.get("lease_months", price.get("lease_months")))
    if not lease or free[0] != free[1]:
        return None
    return round(gross * (lease - free[0]) / lease, 2)


def _move_window(crit: dict | None) -> tuple[dt.date | None, dt.date | None]:
    mi = ((crit or {}).get("search") or {}).get("move_in") or {}
    return parse_date(mi.get("earliest")), parse_date(mi.get("latest"))


def concession_terms(listing: dict, crit: dict | None = None, today: dt.date | None = None) -> dict[str, Any]:
    """Free months, lease term and whether the concession applies to this renter.

    ``price.concession = {free_months, lease_months, conditions: [{type, value}]}`` (flat
    ``price.free_months`` / ``lease_months`` / ``concession_conditions`` also work). Condition types:

    - ``start_before`` / ``lease_start_by`` (date): only for leases starting by then. Excluded when the
      renter's earliest move-in (or the unit's availability) is later.
    - ``expires`` / ``sign_by`` (date): the offer itself ends; excluded after that date.
    - ``unit_not_named`` (a building banner not attached to this unit): never used for ranking.
    - ``min_lease_months`` (number): the concession needs this term; it supplies a missing term.
    - ``new_residents_only``, ``immediate_only`` and anything else: kept as a note to confirm.
    """
    today = today or dt.date.today()
    p = listing.get("price") or {}
    c = p.get("concession") if isinstance(p.get("concession"), dict) else {}
    free = _range(c.get("free_months", p.get("free_months")))
    lease = _num(c.get("lease_months", p.get("lease_months")))
    conds = list(c.get("conditions") or p.get("concession_conditions") or [])
    out: dict[str, Any] = {"free_months": None if not free else (free[0] if free[0] == free[1] else list(free)),
                           "lease_months": lease, "conditions": conds, "applies": True,
                           "excluded": None, "notes": [], "term_from_condition": False}
    earliest, _ = _move_window(crit)
    avail = parse_date(listing.get("available"), today)
    start = max(d for d in (earliest, avail, today) if d is not None)
    for cond in conds:
        kind = str((cond or {}).get("type") or "").lower() if isinstance(cond, dict) else str(cond).lower()
        val = cond.get("value") if isinstance(cond, dict) else None
        if kind in ("start_before", "lease_start_by", "move_in_by"):
            d = parse_date(val)
            if d and start > d:
                out["applies"], out["excluded"] = False, f"only for leases starting by {d.isoformat()}"
            elif d:
                out["notes"].append(f"only for leases starting by {d.isoformat()}")
        elif kind in ("expires", "sign_by", "offer_expires", "lease_by"):
            d = parse_date(val)
            if d and today > d:
                out["applies"], out["excluded"] = False, f"offer ended {d.isoformat()}"
            elif d:
                out["notes"].append(f"offer ends {d.isoformat()}")
        elif kind in ("unit_not_named", "building_banner", "not_attached"):
            out["applies"], out["excluded"] = False, "building-wide offer not tied to this unit"
        elif kind in ("min_lease_months", "requires_lease_months"):
            m = _num(val)
            if m and not lease:
                out["lease_months"], out["term_from_condition"] = m, True
            if m:
                out["notes"].append(f"needs a {m:g}-month lease")
        elif kind:
            out["notes"].append(kind.replace("_", " ") + (f" ({val})" if val not in (None, "", True) else ""))
    return out


def _fee_items(p: dict) -> tuple[tuple[float, float] | None, float, float, list[str]]:
    """(monthly fee range or None if unknown, nonrefundable one-time, refundable one-time, labels).

    ``fees_monthly`` is the total of required monthly fees (a number, ``[lo, hi]`` or "50-100");
    0 means "none", absent or null means unknown. An itemised ``fees`` list
    (``[{name, amount, period: monthly|one_time, refundable, optional}]``) fills in when
    ``fees_monthly`` is absent; optional items (parking, storage) never count.
    """
    monthly = _range(p.get("fees_monthly"))
    one = sum(x for x in (_num(p.get(k)) for k in ("fees_one_time", "broker_fee", "application_fee"))
              if x is not None)
    up = p.get("upfront") if isinstance(p.get("upfront"), dict) else {}
    one += _num(up.get("nonrefundable")) or 0
    refundable = sum(x for x in (_num(p.get("deposit", p.get("security_deposit"))), _num(up.get("refundable")))
                     if x is not None)
    labels: list[str] = []
    item_lo = item_hi = 0.0
    items_monthly = False
    for f in p.get("fees") or []:
        if not isinstance(f, dict) or f.get("optional"):
            continue
        r = _range(f.get("amount", f.get("range")))
        if r is None:
            continue
        name = str(f.get("name") or "fee")
        amount = f"${r[0]:,.0f}" + (f"-{r[1]:,.0f}" if r[1] != r[0] else "")
        if str(f.get("period") or "monthly").lower().startswith("month"):
            item_lo, item_hi, items_monthly = item_lo + r[0], item_hi + r[1], True
            labels.append(f"{name} {amount}/mo")
        elif f.get("refundable"):
            refundable += r[1]
            labels.append(f"{name} {amount} refundable")
        elif p.get("fees_one_time") is None:
            one += r[1]
            labels.append(f"{name} {amount} once")
    if monthly is None and items_monthly:
        monthly = (item_lo, item_hi)
    return monthly, one, refundable, labels


def _scenario(listing: dict, crit: dict | None, today: dt.date) -> dict[str, Any]:
    """Money for one price capture (the listing's own, or one received claim)."""
    p = listing.get("price") or {}
    gross = _num(p.get("gross"))
    stated = _num(p.get("net_effective"))
    shown = _range(p.get("range"))          # an advertised range such as RentHop's "$4,318-$4,652": no term, no net
    if gross is None and shown is not None:
        gross = shown[1]
    basis_name = price_basis(listing)
    weak = price_unverified(listing)
    conc = concession_terms(listing, crit, today)
    free, lease = conc["free_months"], conc["lease_months"]
    has_free = free not in (None, 0, [0, 0])
    illus: list[dict[str, float]] | None = None
    assumptions: list[str] = []
    unknown: list[str] = []
    if not conc["applies"]:
        net, basis = (gross, "gross") if gross is not None else (stated, "stated")
        if gross is None:
            assumptions.append("concession may not apply, but no gross rent is known")
    elif stated is not None and (has_free or gross is None or stated != gross):
        net, basis = stated, "stated"
    elif has_free and gross is not None:
        if isinstance(free, list) or not lease:
            terms = [int(lease)] if lease else list(ILLUSTRATION_TERMS)
            frees = free if isinstance(free, list) else [free]
            illus = [{"lease_months": t, "free_months": f, "net": round(gross * (t - f) / t, 2)}
                     for t in terms for f in frees if t > f]
            net, basis = None, "conditional"
            unknown.append("lease term" if not lease else "free months")
        else:
            net, basis = round(gross * (lease - free) / lease, 2), "computed"
    else:
        net, basis = (gross, "gross") if gross is not None else (stated, "stated")
    net_unverified = None
    if weak and gross is not None and net is not None and basis in ("stated", "computed") and net < gross - 0.5:
        # a weak source's net (a snippet, an estimate, a copy nobody dated) is not a price to rank on
        net_unverified, net, basis = net, gross, "gross"
    rent = net if net is not None else gross
    best_rent = min(x["net"] for x in illus) if illus else rent
    if net_unverified is not None and best_rent is not None:
        best_rent = min(best_rent, net_unverified)
    if shown is not None and best_rent is not None and shown[0] < best_rent:
        best_rent = shown[0]
    monthly_fees, one, refundable, fee_labels = _fee_items(p)
    fees_known = monthly_fees is not None
    if not fees_known:
        unknown.append("monthly fees")
    term = lease or DEFAULT_TERM
    if one and not lease:
        assumptions.append(f"lease term not stated: one-time fees spread over {DEFAULT_TERM} months")
    spread = one / term if one else 0.0
    if rent is None:
        return {"monthly": None, "monthly_range": [None, None], "fees_known": fees_known, "unknown": unknown,
                "rent": {"gross": gross, "net": stated, "basis": "unknown"}, "assumptions": assumptions}
    lo_fee = monthly_fees[0] if monthly_fees else 0.0
    hi_fee = monthly_fees[1] if monthly_fees else None
    monthly = rent + lo_fee + spread
    hi = rent + hi_fee + spread if hi_fee is not None else None
    lo = (best_rent if best_rent is not None else rent) + lo_fee + spread
    paid = gross + lo_fee if gross is not None else None
    deposit = _num(p.get("deposit", p.get("security_deposit")))
    first_month = gross if gross is not None else rent
    upfront = {"first_month": _round(first_month + (lo_fee if fees_known else 0)),
               "deposit": deposit, "one_time_fees": _round(one) if one else (0.0 if _known_one_time(p) else None),
               "other_refundable": _round(refundable - (deposit or 0)) if refundable - (deposit or 0) else None}
    up_unknown = [k for k, v in (("deposit", deposit), ("one-time fees", upfront["one_time_fees"])) if v is None]
    move_in = first_month + (lo_fee if fees_known else 0) + max(refundable, deposit or 0) + one
    out = {
        "monthly": _round(monthly),
        "monthly_range": [_round(lo), _round(hi)],
        "fees_known": fees_known,
        "all_in": _round(monthly) if fees_known and hi == monthly and basis != "conditional" and not weak else None,
        "unknown": unknown,
        "rent": {"gross": gross, "net": _round(net), "basis": basis, "lease_months": lease,
                 "free_months": free, "illustrations": illus, "net_unverified": _round(net_unverified),
                 "range": list(shown) if shown and shown[0] != shown[1] else None},
        "paid_month": _round(paid),
        "fees_monthly": None if not monthly_fees else (monthly_fees[0] if monthly_fees[0] == monthly_fees[1]
                                                       else [monthly_fees[0], monthly_fees[1]]),
        "fee_items": fee_labels or None,
        "one_time_spread": _round(spread) if spread else 0.0,
        "upfront": upfront,
        "move_in_min": _round(move_in),
        "move_in_unknown": up_unknown,
        "renewal_base": gross,
        "concession": ({k: conc[k] for k in ("free_months", "lease_months", "applies", "excluded", "notes",
                                             "term_from_condition")} if (has_free or conc["conditions"]) else None),
        "assumptions": assumptions,
    }
    if basis_name:
        out["price_basis"] = basis_name
    if weak:
        out["price_unverified"] = True
        band = float(((crit or {}).get("scoring") or {}).get("unverified_price_band", DEFAULT_PRICE_BAND) or 0)
        out["price_range"] = [_round(lo), _round(max(monthly, rent * (1 + band) + lo_fee + spread))]
    return out


def _known_one_time(p: dict) -> bool:
    return any(p.get(k) is not None for k in ("fees_one_time", "broker_fee", "application_fee", "upfront"))


_PRICE_FIELDS = ("gross", "net_effective", "free_months", "lease_months", "fees_monthly", "fees_one_time")


def _claim_prices(listing: dict) -> list[tuple[str, dict]]:
    """Alternative price captures from ``claims[]`` that disagree with ``price``: (label, price)."""
    p = listing.get("price") or {}
    out: list[tuple[str, dict]] = []
    for c in listing.get("claims") or []:
        if not isinstance(c, dict) or str(c.get("status") or "live").lower() in ("superseded", "withdrawn", "stale"):
            continue
        src = str(c.get("source") or "another source")
        when = str(c.get("observed_at") or c.get("checked") or "")[:10]
        if isinstance(c.get("price"), dict):
            alt = {k: v for k, v in p.items() if k not in ("gross", "net_effective", "free_months", "lease_months",
                                                          "concession")}
            alt.update(c["price"])
            diff = [k for k in _PRICE_FIELDS if k in c["price"] and _num(c["price"][k]) != _num(p.get(k))]
        else:
            f = str(c.get("field") or "").removeprefix("price.")
            if f not in _PRICE_FIELDS or _num(c.get("value")) is None:
                continue
            alt = dict(p)
            alt[f] = _num(c["value"])
            if f == "gross" and "net_effective" in alt:
                alt.pop("net_effective")  # never mix one source's gross with another's net
            diff = [f] if _num(c["value"]) != _num(p.get(f)) else []
        if diff:
            what = ", ".join(f"{k.replace('_', ' ')} {alt.get(k)}" for k in diff)
            out.append((f"{src}{' ' + when if when else ''}: {what}", alt))
    return out


def concession_needed(gross: float, target: float, lease_months: float = 12, fees: float = 0.0) -> float | None:
    """Free months needed so net-effective rent plus monthly ``fees`` reaches ``target``.

    ``concession_needed(6300, 5100, 12)`` is about 2.29; with $135/mo of fees about 2.54. Returns 0
    when the rent already fits and None when fees alone exceed the target.
    """
    room = target - fees
    if room <= 0 or gross <= 0 or lease_months <= 0:
        return None
    if gross <= room:
        return 0.0
    return lease_months * (1 - room / gross)


def concession_ask(gross: float, target: float, fees: float = 0.0, terms: Iterable[int] = (12, 18),
                   step: float = 0.5) -> dict[str, dict[str, float | None]]:
    """Free months to ask for, per lease term, with and without monthly fees: exact and rounded up to ``step``."""
    out: dict[str, dict[str, float | None]] = {}
    for t in terms:
        for label, f in (("rent_only", 0.0), ("with_fees", fees)):
            x = concession_needed(gross, target, t, f)
            if label == "with_fees" and not fees:
                continue
            out.setdefault(f"{t}", {})[label] = None if x is None else round(x, 2)
            out[f"{t}"][label + "_ask"] = None if x is None else math.ceil(round(x / step, 6)) * step
    return out


def headroom(monthly: float | None, crit: dict | None) -> list[dict[str, Any]]:
    """Room left under each budget tier and the hard cap (negative = over)."""
    if monthly is None or not crit:
        return []
    b = crit.get("budget") or {}
    rows = [{"tier": t["name"], "max": t["max"], "room": round(t["max"] - monthly, 2)} for t in b.get("tiers") or []]
    hard = b.get("hard_max")
    if hard and not any(r["max"] == hard for r in rows):
        rows.append({"tier": "Hard cap", "max": hard, "room": round(hard - monthly, 2)})
    return rows


def cost_model(listing: dict, crit: dict | None = None, today: dt.date | None = None) -> dict[str, Any]:
    """The honest money picture for one listing.

    - Unknown monthly fees stay unknown: ``monthly`` is the *known part* and ``monthly_range[1]`` is
      None (open) until the fee sheet arrives. No fee buffer is invented.
    - Free months without a lease term give no single net: ``rent.basis = "conditional"``, with
      ``rent.illustrations`` at 12 and 14 months, and ranking uses the paid-month (gross) rent.
    - ``monthly`` is the first-lease monthly equivalent: rent the renter actually owes over the lease
      (net when known) + known monthly fees + known nonrefundable one-time fees spread over the term.
    - Received claims (``claims[]``) that disagree give ``scenarios``; ranking uses the most expensive.
    """
    today = today or dt.date.today()
    base = _scenario(listing, crit, today)
    alts = [(label, _scenario({**listing, "price": price}, crit, today)) for label, price in _claim_prices(listing)]
    out = dict(base)
    if out.get("price_basis"):
        p = listing.get("price") or {}
        seen = str(p.get("checked") or listing.get("checked") or "")[:10]
        out["price_checked"] = seen if re.match(r"^\d{4}-\d{2}-\d{2}$", seen) else None
        if p.get("source"):
            out["price_source"] = str(p["source"])
    if alts and base["monthly"] is not None:
        scen = [{"label": "listing price", "monthly": base["monthly"]}] + \
               [{"label": lab, "monthly": s["monthly"]} for lab, s in alts if s["monthly"] is not None]
        out["scenarios"] = scen
        worst = max(s["monthly"] for s in scen)
        best = min(s["monthly"] for s in scen)
        out["dispute"] = worst - best > 1
        if out["dispute"]:
            out["monthly"] = worst
            lo, hi = out["monthly_range"]
            out["monthly_range"] = [best if lo is None else min(lo, best), None if hi is None else max(hi, worst)]
    else:
        out["scenarios"], out["dispute"] = None, False
    basis = ((crit or {}).get("budget") or {}).get("basis", "monthly_cost")
    if basis == "gross" and out.get("paid_month") is not None:
        out["budget_amount"] = out["paid_month"]
    elif basis == "net" and (out.get("rent") or {}).get("net") is not None:
        out["budget_amount"] = out["rent"]["net"]
    else:
        out["budget_amount"] = out["monthly"]
    out["headroom"] = headroom(out["budget_amount"], crit)
    tiers = ((crit or {}).get("budget") or {}).get("tiers") or []
    gross = (out.get("rent") or {}).get("gross")
    if tiers and gross is not None and out["monthly"] is not None and out["monthly"] > tiers[0]["max"]:
        lease = (out.get("rent") or {}).get("lease_months")
        fees = out["fees_monthly"] if isinstance(out.get("fees_monthly"), (int, float)) else 0.0
        out["concession_needed"] = {"target": tiers[0]["max"],
                                    **concession_ask(gross, tiers[0]["max"], fees,
                                                     terms=sorted({int(lease)} | {12, 18}) if lease else (12, 18))}
    return out


def monthly_cost(listing: dict, crit: dict | None = None, today: dt.date | None = None) -> float | None:
    """First-lease monthly equivalent from the parts that are known (see :func:`cost_model`).

    Unknown fees add nothing *and* are reported as unknown by ``cost_model``; free months without a
    lease term are not applied (paid-month rent is used); disputed prices use the higher capture.
    """
    return cost_model(listing, crit, today)["monthly"]


# ---------------------------------------------------------------------- size

SIZE_BASES = ("reported", "exact_plan", "line_band_plan", "main_rooms_sum", "ratio_proxy")
SIZE_BASIS_LABELS = {"reported": "reported", "exact_plan": "exact plan", "line_band_plan": "same-line plan",
                     "main_rooms_sum": "main rooms sum", "ratio_proxy": "ratio estimate"}
# Half-width of the default range when only a point estimate is given, as a share of it.
SIZE_BAND = {"reported": 0.0, "exact_plan": 0.03, "line_band_plan": 0.08, "main_rooms_sum": 0.12, "ratio_proxy": 0.2}
_SIZE_ALIASES = {
    "advertised": "reported", "published": "reported", "listed": "reported", "measured": "reported",
    "listing": "reported", "stated": "reported",
    "plan": "exact_plan", "exact": "exact_plan", "plan_calibrated": "exact_plan", "calibrated_plan": "exact_plan",
    "line_floor_band": "line_band_plan", "line_and_floor_band": "line_band_plan", "line_band": "line_band_plan",
    "tier_plan": "line_band_plan", "line_band_estimate": "line_band_plan", "same_line": "line_band_plan",
    "main_rooms": "main_rooms_sum", "stated_rooms": "main_rooms_sum", "rooms_sum": "main_rooms_sum",
    "ratio": "ratio_proxy", "proxy": "ratio_proxy", "estimate": "ratio_proxy", "estimated": "ratio_proxy",
    "tier_inferred": "ratio_proxy", "representative": "ratio_proxy",
}
MAIN_ROOMS_SHARE = (0.55, 0.65, 0.75)   # main rooms as a share of the whole unit: low, typical, high


def size_basis(v: Any) -> str | None:
    if not v:
        return None
    k = re.sub(r"[^a-z]+", "_", str(v).lower()).strip("_")
    return k if k in SIZE_BASES else _SIZE_ALIASES.get(k, "ratio_proxy")


def size_info(L: dict) -> dict[str, Any] | None:
    """Best estimate, range and basis of a unit's size, or None when nothing is known.

    ``size = {sqft, basis, range: [lo, hi], main_rooms_sqft, source, checked}``; a bare ``sqft`` is
    treated as reported. ``exact`` is True only for reported sizes and exact plans; ``ppsf_ok`` is False
    for ratio proxies (no $/ft² from a guess).
    """
    sz = L.get("size") if isinstance(L.get("size"), dict) else {}
    basis = size_basis(sz.get("basis") or L.get("sqft_basis"))
    sq = _num(sz.get("sqft"))
    rng = _range(sz.get("range") or L.get("sqft_estimate") or L.get("sqft_range"))
    if sz and basis == "main_rooms_sum" and sq is None and rng is None and _num(sz.get("main_rooms_sqft")):
        rooms = _num(sz.get("main_rooms_sqft")) or 0.0
        lo_s, mid_s, hi_s = MAIN_ROOMS_SHARE
        sq, rng = round(rooms / mid_s), (round(rooms / hi_s), round(rooms / lo_s))
    if sq is None and rng is None:
        sq = _num(L.get("sqft"))
        if sq is None:
            return None
        basis = basis or "reported"
    basis = basis or ("ratio_proxy" if sq is None else "reported")
    if sq is None and rng:
        sq = (rng[0] + rng[1]) / 2
    if rng is None:
        band = SIZE_BAND.get(basis, 0.2) * sq
        rng = (sq - band, sq + band)
    return {"sqft": round(sq), "basis": basis, "range": [round(rng[0]), round(rng[1])],
            "exact": basis in ("reported", "exact_plan"), "ppsf_ok": basis != "ratio_proxy",
            "label": SIZE_BASIS_LABELS.get(basis, basis), "source": sz.get("source")}


def price_per_sqft(L: dict, monthly: float | None) -> dict[str, Any] | None:
    """$/ft² from the first-lease monthly cost; None for unknown or proxy sizes."""
    si = size_info(L)
    if monthly is None or not si or not si["ppsf_ok"] or not si["sqft"]:
        return None
    lo, hi = si["range"]
    return {"value": round(monthly / si["sqft"], 2), "range": [round(monthly / hi, 2), round(monthly / lo, 2)]
            if lo and hi else None, "basis": si["basis"]}


def infer_floor(unit: Any) -> float | None:
    """Best guess of the floor from a unit label: 1211 -> 12, 35D -> 35, 7B -> 7, PH -> None."""
    u = str(unit or "").strip().upper()
    m = re.match(r"^(\d{1,2})[A-Z]{1,2}$", u)
    if m:
        return float(m.group(1))
    m = re.match(r"^(\d{3,4})[A-Z]?$", u)
    if m:
        return float(m.group(1)[:-2])
    return None


def normalize(raw: dict) -> dict:
    """Return a listing in canonical shape. Unknown keys are kept."""
    L = dict(raw)
    L.setdefault("building", raw.get("building_name") or "")
    L.setdefault("unit", "")
    L["id"] = raw.get("id") or slugify(L.get("building") or L.get("address"), L.get("unit"))
    price = dict(raw.get("price") or {})
    for k_flat, k in (("rent", "gross"), ("gross", "gross"), ("net", "net_effective"),
                      ("free_months", "free_months"), ("lease_months", "lease_months"),
                      ("fees_monthly", "fees_monthly"), ("fees_one_time", "fees_one_time"),
                      ("broker_fee", "broker_fee")):
        if k_flat in raw and k not in price and raw[k_flat] not in (None, ""):
            price[k] = _num(raw[k_flat])
    if raw.get("price_basis") not in (None, "") and "basis" not in price:
        price["basis"] = raw["price_basis"]
    L["price"] = price
    am = dict(raw.get("amenities") or {})
    for k in AMENITY_KEYS:
        if k in raw and k not in am:
            am[k] = (normalise_service(raw[k]) if k == "doorman" else
                     normalise_laundry(raw[k]) if k == "in_unit_wd" else _tri(raw[k]))
    L["amenities"] = am
    for k in ("beds", "baths", "sqft", "floor", "lat", "lon"):
        if k in L and L[k] not in (None, ""):
            L[k] = _num(L[k])
    if isinstance(L.get("size"), dict):
        sz = dict(L["size"])
        if sz.get("basis"):
            sz["basis"] = size_basis(sz["basis"])
        # `sqft` holds a reported or exact-plan size only, so estimates never produce $/ft²
        if sz.get("basis") in ("reported", "exact_plan") and L.get("sqft") in (None, "") and _num(sz.get("sqft")):
            L["sqft"] = _num(sz["sqft"])
        L["size"] = sz
    if L.get("floor") in (None, "") and L.get("unit"):
        f = infer_floor(L["unit"])
        if f:
            L["floor"] = f
            L["floor_inferred"] = True
    if isinstance(L.get("exposure"), str):
        L["exposure"] = [e.strip().upper() for e in re.split(r"[,/ ]+", L["exposure"]) if e.strip()]
    L.setdefault("status", "new")
    L.setdefault("links", {})
    if raw.get("url") and "listing" not in L["links"]:
        L["links"]["listing"] = raw["url"]
    return L


def load(path: str | Path) -> list[dict]:
    path = Path(path)
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        return [normalize(_unflatten(r)) for r in rows]
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("listings", [])
    return [normalize(d) for d in data]


def save(listings: Iterable[dict], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(list(listings), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def _unflatten(row: dict) -> dict:
    """CSV columns like ``price.gross`` or ``amenities.gym`` become nested keys."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if k is None:
            continue
        v = v.strip() if isinstance(v, str) else v
        if v == "":
            continue
        cur = out
        parts = k.strip().split(".")
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = v
    for k in ("price",):
        if k in out:
            out[k] = {kk: (vv if kk in PRICE_TEXT_FIELDS else
                           list(_range(vv) or ()) if kk in ("fees_monthly", "range") and re.search(r"\d\s*-\s*\$?\d", str(vv))
                           else _num(vv)) for kk, vv in out[k].items()}
    if "amenities" in out:
        out["amenities"] = {kk: (normalise_service(vv) if kk == "doorman" else
                                 normalise_laundry(vv) if kk == "in_unit_wd" else _tri(vv))
                            for kk, vv in out["amenities"].items()}
    return out


CSV_TEMPLATE_COLUMNS = [
    "building", "unit", "address", "neighborhood", "beds", "baths", "sqft", "floor", "exposure",
    "price.gross", "price.free_months", "price.lease_months", "price.fees_monthly",
    "price.fees_one_time", "price.broker_fee", "available",
    "amenities.in_unit_wd", "amenities.elevator", "amenities.doorman", "amenities.gym",
    "amenities.pool", "amenities.roof_deck", "amenities.outdoor_space", "amenities.dishwasher",
    "amenities.pets", "status", "links.listing", "notes",
]


# --------------------------------------------------------------------------- unit aliases

def unit_label(unit: Any) -> str:
    """Canonical spelling of a unit label: '#13-C', 'Apt 13c', 'unit 13 C' -> '13C'."""
    u = str(unit or "").upper()
    u = re.sub(r"^\s*(APT\.?|APARTMENT|UNIT|RESIDENCE|NO\.?)\s*", "", u)
    return re.sub(r"[^A-Z0-9]", "", u)


def alias_groups(listings: Iterable[dict]) -> dict[str, list[str]]:
    """Listing ids that describe the same unit, as {canonical id: [alias ids]}.

    Aliases are only ever *declared*, never guessed from the label: a listing names other listing
    ids in ``aliases`` or other spellings of its unit in ``unit_aliases`` (e.g. the same unit
    advertised as 13C and 13CA, confirmed by the leasing office). Unit-label aliases match other
    listings in the same building (same BIN, else the same building name). The canonical listing
    is the first of the group in input order.
    """
    Ls = list(listings)
    order = {L["id"]: k for k, L in enumerate(Ls)}
    parent = {L["id"]: L["id"] for L in Ls}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            keep, drop = (ra, rb) if order[ra] <= order[rb] else (rb, ra)
            parent[drop] = keep

    def bkey(L: dict) -> str:
        return str(L.get("bin") or "").split(".")[0] or slugify(L.get("building"))

    by_unit: dict[tuple[str, str], list[str]] = {}
    for L in Ls:
        by_unit.setdefault((bkey(L), unit_label(L.get("unit"))), []).append(L["id"])
    for L in Ls:
        for other in L.get("aliases") or []:
            if other in parent:
                union(L["id"], other)
        for u in L.get("unit_aliases") or []:
            for other in by_unit.get((bkey(L), unit_label(u)), []):
                union(L["id"], other)
    groups: dict[str, list[str]] = {}
    for L in Ls:
        r = find(L["id"])
        if r != L["id"]:
            groups.setdefault(r, []).append(L["id"])
    return groups


def merge_aliases(listings: Iterable[dict]) -> list[dict]:
    """Fold declared aliases into their canonical listing (see ``alias_groups``); returns new dicts.

    The canonical listing keeps its own values; fields it lacks are filled from its aliases, and it
    records ``alias_ids``. Alias listings are dropped from the result, so scoring and the
    dashboard show the unit once. Nothing is written to disk.
    """
    Ls = [dict(L) for L in listings]
    groups = alias_groups(Ls)
    if not groups:
        return Ls
    by_id = {L["id"]: L for L in Ls}
    dropped = {a for al in groups.values() for a in al}
    out = []
    for L in Ls:
        if L["id"] in dropped:
            continue
        if L["id"] in groups:
            for a in groups[L["id"]]:
                for k, v in by_id[a].items():
                    if L.get(k) in (None, "", [], {}) and v not in (None, "", [], {}):
                        L[k] = v
            L["alias_ids"] = list(groups[L["id"]])
        out.append(L)
    return out
