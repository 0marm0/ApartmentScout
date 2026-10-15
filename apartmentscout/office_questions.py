"""Questions for a building's leasing office: one polite, specific, deduplicated draft per building.

``apartmentscout/questions.py`` writes the questions for one unit from its missing and stale facts. This module sits on
top of it and adds what a leasing office can settle that a unit's fact list cannot:

* **disagreeing prices**: the unit's ``claims[]`` hold a reading that differs from ``price`` (a building page shows
  $5,300 with 0.75 months free, the quote was $5,250 with one month free). The question names both readings, with
  where each came from, and asks which is right in writing;
* **doubtful facts** named by the score: ``unverified:fees``, ``unverified:in_unit_wd``, ``unverified:price``, an
  estimated size, a floor read off the unit number;
* **the building's side**: fees, move-in costs and amenities are asked once for the whole building, and the same
  question for several units ("the concession, for 6B and 7BA") is merged.

The units asked about are the renter's units of interest: shortlisted, touring or applied, favourites, the top-ranked
few, and any unit named explicitly. Nothing here sends anything. Drafts carry no renter detail: the sign-off is the
placeholder ``[Your name]`` and every text goes through the privacy patterns in ``handoff/safety.py``.

    from apartmentscout.office_questions import building_drafts, render_text
    for draft in building_drafts(listings, criteria):
        print(render_text(draft))

The dashboard reads the same questions from ``questions.json`` (``apartmentscout build``) and assembles the draft
in ``dashboard/js/features/office-model.js``; ``tests/test_office_questions.py`` and ``tests/js/office-model.test.mjs`` hold
both to the same output.
"""
from __future__ import annotations

import hashlib
import re
import urllib.parse
from typing import Any, Iterable

from .handoff.facts import FOCUS_STATUSES
from .handoff.safety import compile_patterns, privacy_hits
from .listings import PRICE_BASES, price_basis, price_unverified
from .quality.common import building_key, crit_today, is_active, norm_unit, num, parse_date, source_name
from .questions import AMENITY_QUESTIONS, FLAG_QUESTIONS, questions as fact_questions

SCHEMA = "apartmentscout-office-questions/1"
SIGNOFF = "[Your name]"
PRICE_FIELDS = ("gross", "net_effective", "free_months", "lease_months", "fees_monthly", "fees_one_time")
DEFAULT_TOP = 10

# topic -> (sort priority, default scope, listing fields an answer informs). Unit-scope questions with the same text
# for several units are merged into one; building-scope questions are asked once.
TOPICS: dict[str, tuple[int, str, tuple[str, ...]]] = {
    "identity": (0, "unit", ()),
    "price": (10, "unit", ("price.gross", "price.free_months", "price.lease_months", "price.net_effective")),
    "concession": (20, "unit", ("price.free_months", "price.lease_months")),
    "availability": (30, "unit", ("available", "status")),
    "fees": (40, "building", ("price.fees_monthly",)),
    "move_in": (50, "building", ("price.fees_one_time",)),
    "start": (60, "building", ("available",)),
    "in_unit_wd": (70, "unit", ("amenities.in_unit_wd",)),
    "amenity": (75, "building", ()),
    "size": (80, "unit", ("sqft",)),
    "floor": (90, "unit", ("floor",)),
    "exposure": (100, "unit", ("exposure",)),
    "plan": (110, "unit", ()),
    "media": (120, "unit", ()),
    "bedroom": (130, "unit", ()),
    "terms": (200, "building", ()),
}
BUILDING_AMENITIES = {"elevator", "doorman", "gym", "pool", "roof_deck", "bike_room", "package_room", "lounge",
                      "coworking", "game_room", "parking"}
FACT_KEY_TOPIC = {"rent": "price", "concession": "concession", "status": "availability", "fees": "fees",
                  "move_in_costs": "move_in", "start_date": "start", "size": "size", "plan": "plan",
                  "bedroom": "bedroom", "floor": "floor", "exposure": "exposure", "media": "media",
                  "laundry": "in_unit_wd", "identity": "identity", "doorman": "amenity:doorman"}

# Worth asking of any building, but not open in the data: offered unchecked, never added unless asked for.
STANDARD_TERMS: tuple[tuple[str, str], ...] = (
    ("renewal", "What rent increase have residents typically been offered at renewal, and how much notice is given?"),
    ("early_exit", "What are the early-termination and sublet policies, and is there a fee or a reletting rule?"),
    ("utilities", "Which utilities are included in the rent, how are heat and cooling billed, and what do residents "
                  "typically pay per month?"),
    ("regulated", "Is the unit rent-stabilised or covered by any regulatory agreement or lease rider? If so, please "
                  "share the legal rent and the renewal terms."),
)

FEES_ASK = ("Please list every required monthly charge on top of rent (amenity, utilities, internet, pet, storage) "
            "with amounts.")
_PRIVACY = compile_patterns()
_QUOTE_WORDS = re.compile(r"quote|call|phone|leasing office|agent|e-?mail|told|offer|reply|answer", re.I)
_LABEL_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,&'()/#+-]{1,56}$")


# --------------------------------------------------------------------------- small formatters
def _usd(x: float) -> str:
    return f"${x:,.0f}" if abs(x - round(x)) < 0.005 else f"${x:,.2f}"


def _months(x: float) -> str:
    return f"{x:g} month{'' if x == 1 else 's'} free"


def _day(v: Any) -> str | None:
    d = parse_date(v)
    return f"{d:%B} {d.day}" if d else None


_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _plain_dates(text: str) -> str:
    """'between 2026-10-15 and 2026-11-01' -> 'between October 15 and November 1'."""
    return _ISO.sub(lambda m: _day(m.group(0)) or m.group(0), text)


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _unit_label(L: dict) -> str:
    return str(L.get("unit") or "").strip() or str(L.get("id"))


def _building_name(L: dict) -> str:
    return str(L.get("building") or "").strip() or str(L.get("address") or "").split(",")[0].strip() or "the building"


def scrub(text: str) -> str:
    """Remove anything the privacy patterns catch (local paths, e-mail addresses) from a draft."""
    for _, hit in privacy_hits(text, _PRIVACY):
        text = text.replace(hit, "[removed]")
    return text


def _label(source: Any) -> str | None:
    """A source named well enough to say to a leasing office: a short clean label, else the site of a link."""
    s = str(source or "").strip()
    if not s:
        return None
    if re.match(r"^https?://", s, re.I):
        return source_name(s)
    return s if _LABEL_OK.match(s) and not privacy_hits(s, _PRIVACY) else None


def _reading(p: dict) -> str:
    """'$5,300 a month with 0.75 months free on a 10-month lease' from whatever the source stated."""
    g, ne = num(p.get("gross")), num(p.get("net_effective"))
    fm, lm = num(p.get("free_months")), num(p.get("lease_months"))
    if g is not None:
        out = f"{_usd(g)} a month"
    elif ne is not None:
        out = f"{_usd(ne)} a month net effective"
    else:
        out = ""
    if fm:
        out += (" with " if out else "") + _months(fm)
    if lm:
        out += (" " if out else "") + f"on {'an' if f'{lm:g}'.startswith(('8', '11', '18')) else 'a'} {lm:g}-month lease"
    return out or "no figures"


# --------------------------------------------------------------------------- where a reading came from
def _site(L: dict) -> str | None:
    return source_name((L.get("links") or {}).get("listing"))


def _primary_clause(L: dict, p: dict) -> str:
    """How the unit's recorded price was read, as a clause: 'I was quoted ... on September 29'."""
    basis, r = price_basis(L), _reading(p)
    day = _day(p.get("checked"))
    on, seen = (f" ({day})" if day else ""), (f" (seen {day})" if day else "")
    site = _site(L)
    if basis in ("leasing_office", "renter_quote"):
        return f"I was quoted {r}{on}"
    if basis == "unit_page":
        return f"the {site + ' ' if site else ''}unit page shows {r}{seen}"
    if basis == "owner_page":
        return f"your website shows {r}{seen}"
    if basis == "broker_card":
        return f"the broker's listing shows {r}{seen}"
    if basis == "building_page":
        return f"the {site + ' ' if site else ''}building page shows {r}{seen}"
    if basis == "search_snippet":
        return f"a search-result listing showed {r}{seen}"
    if basis in ("received", "stale"):
        return f"an earlier listing showed {r}{seen}"
    if basis == "estimate":
        return f"my estimate is {r}{seen}"
    return f"my notes show {r}{seen}"


def _claim_clause(c: dict) -> str:
    r, day = _reading(c["price"]), _day(c.get("observed_at"))
    on, seen = (f" ({day})" if day else ""), (f" (seen {day})" if day else "")
    label = _label(c.get("source"))
    if label and _QUOTE_WORDS.search(label):
        return f"I was quoted {r}{on}"
    if label:
        return f"{'' if label.lower().startswith(('the ', 'a ', 'an ')) else 'the '}{label} shows {r}{seen}"
    return f"another source shows {r}{seen}"


def _evidence_line(who: str, r: str, day: str | None) -> str:
    return f"{who}: {r}" + (f" ({day})" if day else "")


def live_disagreements(L: dict) -> list[dict]:
    """Live ``claims[]`` readings of the price that differ from ``price``: {source, observed_at, price, fields}."""
    p = L.get("price") or {}
    out: list[dict] = []
    for c in L.get("claims") or []:
        if not isinstance(c, dict) or str(c.get("status") or "live").lower() in ("superseded", "withdrawn", "stale"):
            continue
        if isinstance(c.get("price"), dict):
            cp = dict(c["price"])
        else:
            f = str(c.get("field") or "").removeprefix("price.")
            if f not in PRICE_FIELDS or num(c.get("value")) is None:
                continue
            cp = {f: c["value"]}
        diff = [k for k in PRICE_FIELDS if k in cp and num(cp[k]) != num(p.get(k))]
        if diff:
            out.append({"source": c.get("source"), "observed_at": c.get("observed_at") or c.get("checked"),
                        "price": cp, "fields": diff})
    return out


# --------------------------------------------------------------------------- the questions for one unit
def _flag_codes(flags: Iterable[Any] | None) -> set[str]:
    return {(f.get("code") if isinstance(f, dict) else getattr(f, "code", None)) for f in flags or []}


def unit_questions(L: dict, crit: dict, flags: Iterable[Any] | None = None, today: Any = None) -> list[dict]:
    """Open questions for one unit, most decisive first.

    Each is ``{id, topic, kind, scope, mk, priority, text, evidence, fields, default_on}``. ``kind`` is ``dispute``
    (two readings disagree), ``verify`` (a value we hold but doubt), ``missing`` or ``flag`` (a lint finding).
    ``mk`` is the merge key: equal keys across units are one question for the building."""
    from .quality.lint import lint_listing
    from .quality.standard import assess

    t = crit_today(crit, today)
    uid, unit = str(L["id"]), _unit_label(L)
    fl = list(flags) if flags is not None else lint_listing(L, crit, {"today": t, "gross_claims": [], "snapshots": [], "plan": None})
    codes = _flag_codes(fl)
    a = assess(L, crit, t, flag_codes=codes)
    p = L.get("price") or {}
    score = L.get("score") or {}
    gates, sflags = set(score.get("gates") or []), set(score.get("flags") or [])
    flag_keys = {FLAG_QUESTIONS[c][0] for c in codes if c in FLAG_QUESTIONS}
    found: dict[str, dict] = {}

    def put(topic: str, text: str, kind: str, scope: str | None = None, evidence: Iterable[str] = (), fields: Iterable[str] | None = None) -> None:
        base = topic.split(":")[0]
        pr, sc, fs = TOPICS[base]
        if topic in found:
            return
        key = topic.split(":", 1)[1] if ":" in topic else None
        if base == "amenity":
            sc = "building" if key in BUILDING_AMENITIES else "unit"
        found[topic] = {"topic": topic, "kind": kind, "scope": scope or sc,
                        "priority": pr, "text": scrub(_plain_dates(text)), "evidence": [scrub(e) for e in evidence],
                        "fields": list(fields if fields is not None else (f"amenities.{key}",) if key else fs)}

    # 1. two readings of the price disagree: ask which is right, naming both
    disputes = live_disagreements(L)
    if disputes:
        mine = _primary_clause(L, p)
        theirs = "; ".join(_claim_clause(c) for c in disputes[:2])
        ask = "Could you confirm the correct rent, free months and lease length in writing, and that the unit is still available?"
        put("price", f"{_cap(theirs)}, and {mine}. {ask}", "dispute",
            evidence=[_evidence_line("Recorded", _reading(p), _day(p.get("checked"))),
                      *[_evidence_line(_label(c.get("source")) or "Other source", _reading(c["price"]), _day(c.get("observed_at"))) for c in disputes[:2]]])

    # 2. the unit's own open facts (missing, stale, flagged), from the one-unit question generator
    base_qs = fact_questions(L, crit, missing=a["missing"], stale=a["stale"], flags=fl, today=t)
    for q in base_qs:
        if q["group"] == "tour test":
            continue
        key = q["key"]
        topic = FACT_KEY_TOPIC.get(key) or (("amenity:" + key.split(":", 1)[1]) if key.startswith("must_have:") else None)
        if topic is None:
            continue
        if topic.startswith("amenity:") and topic.split(":")[1] == "in_unit_wd":
            topic = "in_unit_wd"
        if disputes and topic in ("price", "concession", "availability"):
            continue
        if topic == "concession" and "price" in found and found["price"]["kind"] == "verify" \
                and num(p.get("free_months")) is not None and num(p.get("lease_months")) is not None:
            continue                          # the price question already asks for the free months and the lease length
        text, ev = q["text"], []
        kind = "flag" if key in flag_keys else "verify" if key in a["stale"] else "missing"
        if topic == "price" and not (key == "rent" and "fee_is_price_drop" in codes):
            g = num(p.get("gross") or p.get("net_effective"))
            if g is not None and ("rent" in a["stale"] or price_unverified(L)):
                text = f"{_cap(_primary_clause(L, p))}. Is it still available at that rent, and can you confirm the rent, free months and lease length in writing?"
                kind, ev = "verify", [_evidence_line("Recorded", _reading(p), _day(p.get("checked"))),
                                      "Source: " + PRICE_BASES[price_basis(L)][0] if price_basis(L) else "Source: not recorded"]
        elif topic == "availability" and "price" in found:
            continue
        elif topic == "fees":
            fm = num(p.get("fees_monthly"))
            if fm is not None and fm > 0:
                text = (f"I have required monthly fees of {_usd(fm)}. Is that the complete list and amount, including any "
                        "amenity, water, utility, internet, pet or storage charge?")
                put("fees", text, "verify", "unit", [f"Recorded: {_usd(fm)} a month"], ("price.fees_monthly",))
                continue
        elif topic == "size":
            rng = (L.get("size") or {}).get("range") if isinstance(L.get("size"), dict) else None
            est = "size_estimated" in sflags or "size_imputed" in sflags
            if est:
                text = f"What is the square footage of unit {unit}, and is it measured from the floor plan? I only have an estimate."
                ev = [f"Estimated range: {rng[0]:g} to {rng[1]:g} ft²"] if isinstance(rng, (list, tuple)) and len(rng) == 2 else ["Size is estimated, not stated"]
        elif topic == "floor" and (L.get("floor_inferred") or "floor_inferred" in sflags):
            fl_no = num(L.get("floor"))
            text = f"Which floor is unit {unit} on?" + (f" I have floor {fl_no:g}, taken from the unit number." if fl_no else "")
            ev = ["Floor is inferred from the unit number"]
        put(topic, text, kind, evidence=ev)

    # 3. gates the score raised that the fact list may not cover
    for g in sorted(gates):
        if g.startswith("unverified:"):
            for k in g.split(":", 1)[1].split(","):
                if k == "in_unit_wd" and "in_unit_wd" not in found:
                    put("in_unit_wd", AMENITY_QUESTIONS["in_unit_wd"], "verify", evidence=["Score gate: in-unit washer/dryer unverified"])
                elif k in AMENITY_QUESTIONS and k != "in_unit_wd" and f"amenity:{k}" not in found:
                    put(f"amenity:{k}", AMENITY_QUESTIONS[k], "verify", evidence=[f"Score gate: {k.replace('_', ' ')} unverified"])
                elif k == "fees" and "fees" not in found:
                    put("fees", FEES_ASK, "missing", evidence=["Score gate: monthly fees unverified"])

    out = []
    for topic, q in sorted(found.items(), key=lambda kv: (kv[1]["priority"], kv[0])):
        digest = hashlib.sha1(q["text"].encode()).hexdigest()[:6]
        out.append({"id": f"{uid}:{topic}", "topic": topic, "kind": q["kind"], "scope": q["scope"], "mk": f"{topic}:{digest}",
                    "priority": q["priority"], "text": q["text"], "evidence": q["evidence"], "fields": q["fields"],
                    "default_on": True})
    return out


# --------------------------------------------------------------------------- units of interest and buildings
def interest_reasons(L: dict, top: int = DEFAULT_TOP, selected: Iterable[str] = ()) -> list[str]:
    """Why a unit is one of the renter's units of interest (empty when it is not)."""
    if not is_active(L):
        return []
    out = []
    if L.get("id") in set(selected):
        out.append("selected")
    if L.get("status") in FOCUS_STATUSES:
        out.append(str(L["status"]))
    if L.get("favorite"):
        out.append("favorite")
    rank = (L.get("score") or {}).get("rank")
    if rank and top and rank <= top:
        out.append("top-ranked")
    return out


def unit_matches(L: dict, wanted: Iterable[str]) -> bool:
    """True when a unit is named by id or by unit number (``6B``, ``06b``, ``unit 6B``)."""
    w = {x.strip().lower() for x in wanted if x and x.strip()}
    return str(L.get("id", "")).lower() in w or (bool(L.get("unit")) and norm_unit(L["unit"]) in {norm_unit(x) for x in w})


def building_matches(L: dict, query: str) -> bool:
    q = re.sub(r"[^a-z0-9]+", " ", query.lower()).strip()
    hay = re.sub(r"[^a-z0-9]+", " ", f"{L.get('building') or ''} {L.get('address') or ''} {building_key(L)}".lower())
    return bool(q) and q in hay


def _units_phrase(labels: list[str]) -> str:
    head = "unit " if len(labels) == 1 else "units "
    if len(labels) <= 2:
        return head + " and ".join(labels)
    return head + ", ".join(labels[:-1]) + " and " + labels[-1]


def _join_units(labels: list[str]) -> str:
    return " and ".join(labels) if len(labels) <= 2 else ", ".join(labels[:-1]) + " and " + labels[-1]


def building_drafts(listings: list[dict], crit: dict, *, building: str | None = None, units: Iterable[str] = (),
                    top: int = DEFAULT_TOP, all_units: bool = False, standard: bool = False,
                    flags: dict[str, list] | None = None, today: Any = None) -> list[dict]:
    """One draft per building that has units of interest with open questions.

    ``units`` names the units to ask about (id or number): only those, within ``building`` when that is given; ``building`` limits the result
    to buildings whose name, address or key contains the text; ``all_units`` asks about every active unit of the
    matched buildings; ``standard`` also selects the standard lease-term questions."""
    t = crit_today(crit, today)
    wanted = list(units)
    groups: dict[str, list[dict]] = {}
    for L in listings:
        if not is_active(L) or (building and not building_matches(L, building)):
            continue
        reasons = interest_reasons(L, top, ())
        if wanted and unit_matches(L, wanted):
            reasons = ["selected", *reasons]
        elif wanted:
            continue                    # named units only (inside --building when that is given too)
        if reasons or all_units:
            groups.setdefault(building_key(L), []).append({"L": L, "interest": reasons or ["active"]})
    drafts = []
    for key, members in groups.items():
        draft = _assemble(key, members, crit, t, flags, standard)
        if draft["units"]:
            drafts.append(draft)
    drafts.sort(key=lambda d: (min((u["rank"] or 10 ** 6) for u in d["units"]), d["building"]))
    return drafts


def _unit_order(m: dict) -> tuple:
    L = m["L"]
    return ((L.get("score") or {}).get("rank") or 10 ** 6, _unit_label(L))


def _assemble(key: str, members: list[dict], crit: dict, t: Any, flags: dict[str, list] | None, standard: bool) -> dict:
    members = sorted(members, key=_unit_order)
    first = members[0]["L"]
    per_unit = []
    for m in members:
        L = m["L"]
        qs = unit_questions(L, crit, (flags or {}).get(L["id"]) if flags else None, t)
        per_unit.append({"id": L["id"], "unit": _unit_label(L), "status": L.get("status"),
                         "rank": (L.get("score") or {}).get("rank"), "interest": m["interest"], "questions": qs})
    return assemble_units(key, _building_name(first), str(first.get("address") or ""), per_unit, standard=standard)


def assemble_units(key: str, name: str, address: str, units: list[dict], *, answered: Iterable[str] = (),
                   standard: bool = False) -> dict:
    """Group unit questions into a draft: building-wide first, then one block per unit.

    ``units`` are ``{id, unit, rank, ..., questions}`` already in the order to show. A question whose ``mk`` appears
    for several units, or whose scope is ``building``, is asked once; ids in ``answered`` are left out."""
    skip = set(answered)
    buckets: dict[str, list[tuple[dict, dict]]] = {}
    for u in units:
        for q in u["questions"]:
            if q["id"] not in skip:
                buckets.setdefault(q["mk"], []).append((u, q))
    shared, by_unit = [], {u["id"]: [] for u in units}
    for mk, items in buckets.items():
        u0, q0 = items[0]
        if q0["scope"] == "building" or len(items) > 1:
            names = [u["unit"] for u, _ in items]
            shared.append({"id": f"shared:{mk}", "topic": q0["topic"], "kind": q0["kind"], "priority": q0["priority"],
                           "text": q0["text"], "evidence": q0["evidence"], "fields": q0["fields"],
                           "unit_ids": [u["id"] for u, _ in items],
                           "units": names if q0["scope"] != "building" else [], "default_on": q0["default_on"]})
        else:
            by_unit[u0["id"]].append(q0)
    shared.sort(key=lambda s: s["priority"])           # stable: ties keep the order the units were asked in
    extra = [{"id": f"standard:{k}", "topic": "terms", "kind": "standard", "priority": 200, "text": txt, "evidence": [],
              "fields": [], "unit_ids": [], "units": [], "default_on": False} for k, txt in STANDARD_TERMS]
    draft = {
        "schema": SCHEMA, "building": name, "address": address, "building_key": key,
        "units": [{k: u[k] for k in ("id", "unit", "status", "rank", "interest") if k in u} for u in units],
        "shared": shared,
        "by_unit": [{"unit_id": u["id"], "unit": u["unit"], "questions": by_unit[u["id"]]} for u in units if by_unit[u["id"]]],
        "standard": extra,
    }
    draft["selected"] = default_selection(draft, standard)
    draft["subject"] = subject(draft)
    draft["text"] = render_text(draft)
    draft["markdown"] = render_markdown(draft)
    draft["mailto"] = mailto(draft)
    return draft


def default_selection(draft: dict, standard: bool = False) -> list[str]:
    ids = [s["id"] for s in draft["shared"] if s["default_on"]]
    ids += [q["id"] for b in draft["by_unit"] for q in b["questions"] if q["default_on"]]
    if standard:
        ids += [s["id"] for s in draft["standard"]]
    return ids


# --------------------------------------------------------------------------- rendering (mirrored in office-model.js)
def _chosen(draft: dict, selected: Iterable[str] | None) -> tuple[list[dict], list[tuple[str, list[dict]]]]:
    sel = set(draft["selected"] if selected is None else selected)
    shared = [s for s in draft["shared"] if s["id"] in sel] + [s for s in draft["standard"] if s["id"] in sel]
    blocks = [(b["unit"], [q for q in b["questions"] if q["id"] in sel]) for b in draft["by_unit"]]
    return shared, [(u, qs) for u, qs in blocks if qs]


def subject(draft: dict, selected: Iterable[str] | None = None) -> str:
    labels = _asked_units(draft, selected)
    return f"Questions about {_units_phrase(labels)} at {draft['building']}" if labels else f"Questions about {draft['building']}"


def _asked_units(draft: dict, selected: Iterable[str] | None) -> list[str]:
    """Units the chosen questions are about, in the draft's unit order (all units when only building questions remain)."""
    shared, blocks = _chosen(draft, selected)
    ids = {b for b, _ in blocks}
    for s in shared:
        ids.update(s["units"])
    labels = [u["unit"] for u in draft["units"] if u["unit"] in ids]
    return labels or [u["unit"] for u in draft["units"]]


def _body_sections(draft: dict, selected: Iterable[str] | None) -> tuple[str, list[tuple[str | None, list[str]]]]:
    shared, blocks = _chosen(draft, selected)
    labels = _asked_units(draft, selected)
    n = 0
    sections: list[tuple[str | None, list[str]]] = []
    if shared:
        lines = []
        for s in shared:
            n += 1
            prefix = f"For {_join_units(s['units'])}: " if s["units"] else ""
            lines.append(f"{n}. {prefix}{s['text']}")
        sections.append(("About the building" if len(labels) == 1 else "Across these units", lines))
    for unit, qs in blocks:
        lines = []
        for q in qs:
            n += 1
            lines.append(f"{n}. {q['text']}")
        sections.append((f"Unit {unit}", lines))
    street = draft["address"].split(",")[0].strip()
    where = f"{draft['building']} ({street})" if street and street.lower() not in draft["building"].lower() else draft["building"]
    intro = (f"I'm interested in {_units_phrase(labels)} at {where}. Could you help with the questions below? "
             "Written answers are easiest for me to keep track of.")
    return intro, sections


def render_text(draft: dict, selected: Iterable[str] | None = None) -> str:
    """The email body for the chosen questions (all default ones when ``selected`` is None)."""
    intro, sections = _body_sections(draft, selected)
    if not sections:
        return ""
    parts = ["Hello,", "", intro, ""]
    for head, lines in sections:
        parts += [head, *lines, ""]
    parts += ["Thank you,", SIGNOFF]
    return scrub("\n".join(parts)) + "\n"


def render_markdown(draft: dict, selected: Iterable[str] | None = None) -> str:
    intro, sections = _body_sections(draft, selected)
    if not sections:
        return ""
    parts = [f"## {subject(draft, selected)}", "", "Hello,", "", intro, ""]
    for head, lines in sections:
        parts += [f"**{head}**", "", *lines, ""]
    parts += ["Thank you,  ", SIGNOFF]
    return scrub("\n".join(parts)) + "\n"


def mailto(draft: dict, selected: Iterable[str] | None = None) -> str:
    """A mailto: link with no recipient: it opens the renter's own mail app with the subject and body filled in."""
    body = render_text(draft, selected).replace("\n", "\r\n")
    q = urllib.parse.urlencode({"subject": subject(draft, selected), "body": body}, quote_via=urllib.parse.quote)
    return "mailto:?" + q


# --------------------------------------------------------------------------- the dashboard's data file
def export_document(listings: list[dict], crit: dict, flags: dict[str, list] | None = None, today: Any = None,
                    top: int = DEFAULT_TOP) -> dict:
    """``questions.json``: every active unit's open questions, so the dashboard can draft for whichever units the
    renter picks (the Python side marks its own units of interest in ``interest``).

    The wording of a question is stored once in ``defs`` under its merge key and each unit lists only
    ``{topic, kind, mk, ev}``; :func:`expand_document` (and ``office-model.js``) put the full questions back."""
    t = crit_today(crit, today)
    defs: dict[str, dict] = {}
    units: dict[str, dict] = {}
    for L in listings:
        if not is_active(L):
            continue
        qs = unit_questions(L, crit, (flags or {}).get(L["id"]) if flags else None, t)
        if not qs:
            continue
        rows = []
        for q in qs:
            defs.setdefault(q["mk"], {"text": q["text"], "scope": q["scope"], "priority": q["priority"], "fields": q["fields"]})
            rows.append({"topic": q["topic"], "kind": q["kind"], "mk": q["mk"], **({"ev": q["evidence"]} if q["evidence"] else {})})
        units[L["id"]] = {"building_key": building_key(L), "building": _building_name(L), "address": L.get("address") or "",
                          "unit": _unit_label(L), "status": L.get("status"), "rank": (L.get("score") or {}).get("rank"),
                          "interest": interest_reasons(L, top), "q": rows}
    return {"schema": SCHEMA, "generated": t.isoformat(), "signoff": SIGNOFF, "top": top, "defs": defs, "units": units,
            "standard": [{"id": f"standard:{k}", "topic": "terms", "text": txt} for k, txt in STANDARD_TERMS]}


def expand_document(doc: dict) -> dict[str, dict]:
    """Unit entries of :func:`export_document` with the full question objects back: {unit id: {..., questions}}."""
    out = {}
    for uid, u in doc["units"].items():
        qs = []
        for r in u["q"]:
            d = doc["defs"][r["mk"]]
            qs.append({"id": f"{uid}:{r['topic']}", "topic": r["topic"], "kind": r["kind"], "scope": d["scope"], "mk": r["mk"],
                       "priority": d["priority"], "text": d["text"], "evidence": r.get("ev", []), "fields": d["fields"],
                       "default_on": True})
        out[uid] = {"id": uid, **{k: v for k, v in u.items() if k != "q"}, "questions": qs}
    return out
