"""`apartmentscout lint`: listing traps, the mistakes that make a unit look better than it is.

Each rule reads the structured fields plus the free text an agent captured (notes, features, description)
and returns a Flag with a stable code, a severity (high / med / low), a message and the field it is about.
The rules are deliberately conservative: a flag is a reason to look, not a verdict.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

from .common import (crit_today, is_active, listing_text, move_in, norm_address, norm_unit, num, parse_date,
                     stale_days)

SEVERITY_ORDER = {"high": 0, "med": 1, "low": 2}


@dataclass(frozen=True)
class Flag:
    code: str
    severity: str     # high | med | low
    message: str
    field: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------- text helpers
CHALLENGE_PATTERNS = [
    r"just a moment\.\.\.", r"checking your browser", r"cf-chl", r"attention required!? \| cloudflare",
    r"verify (?:that )?you are (?:a )?human", r"are you a robot", r"px-captcha", r"pardon our interruption",
    r"please enable js and disable any ad blocker", r"access to this page has been denied", r"enable javascript and cookies to continue",
    r"request unsuccessful\. incapsula", r"/cdn-cgi/challenge-platform/",
]
_CHALLENGE = re.compile("|".join(CHALLENGE_PATTERNS), re.I)


def is_challenge_page(text: str) -> bool:
    """True when saved page text is a bot wall or CAPTCHA interstitial, not the listing.

    Fetchers and agents should call this before storing a page as evidence; a challenge page proves nothing."""
    return bool(_CHALLENGE.search(text or ""))


MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _dates_in(text: str, year: int) -> list[dt.date]:
    """Dates written as 9/15, 9/15/26, Sep 15, September 15th or 2026-09-15."""
    out = []
    for m in re.finditer(r"\b(\d{4})-(\d{2})-(\d{2})\b", text):
        try:
            out.append(dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass
    for m in re.finditer(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", text):
        y = int(m.group(3)) if m.group(3) else year
        y = y + 2000 if y < 100 else y
        try:
            out.append(dt.date(y, int(m.group(1)), int(m.group(2))))
        except ValueError:
            pass
    for m in re.finditer(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b", text, re.I):
        try:
            out.append(dt.date(year, MONTHS[m.group(1).lower()], int(m.group(2))))
        except ValueError:
            pass
    return out


# --------------------------------------------------------------------------- rules
Rule = Callable[[dict, dict, str, dict], list[Flag]]
RULES: list[tuple[str, Rule]] = []


def rule(code: str) -> Callable[[Rule], Rule]:
    def deco(fn: Rule) -> Rule:
        RULES.append((code, fn))
        return fn
    return deco


_NEG_BEFORE = re.compile(r"(?:\bno|\bnot|\bnever|\bwithout|\bisn't|\bnor)\b[^.;]{0,24}$", re.I)
_NEG_AFTER = re.compile(r"^[^.;]{0,16}\b(?:not allowed|are not allowed|prohibited|banned)\b", re.I)


def affirmed(rx: re.Pattern, text: str) -> re.Match | None:
    """First match of ``rx`` that is not negated ('no flex walls', 'flex walls are not allowed')."""
    for m in rx.finditer(text):
        if _NEG_BEFORE.search(text[max(0, m.start() - 30):m.start()]) or _NEG_AFTER.search(text[m.end():m.end() + 30]):
            continue
        return m
    return None


# Junior 1 = a studio with an alcove. (A classic "junior 4" is a real one-bedroom plus a small room, so not a trap.)
_JUNIOR = re.compile(r"\b(?:jr\.?|junior)[\s-]*(?:1|one)(?:[\s-]*(?:br|bed(?:room)?))?\b", re.I)
# A flex/convertible room counted as a bedroom: "flex 1", "flexed one-bedroom", "convertible 1BR", pressurised walls.
_FLEX_ONE = re.compile(r"\bflex(?:ed)?[\s-]*(?:1|one)(?:[\s-]*(?:br|bed(?:room)?))?\b|\bconvertible[\s-]*(?:1|one|junior)\b|"
                       r"\bflex(?:ed)? one[- ]bedroom\b|\bpressuri[sz]ed wall|\bflex wall", re.I)
# "Flex 2" / "convertible 2": a one-bedroom whose living room can take a wall. Only a trap if counted as 2 beds.
_FLEX_TWO = re.compile(r"\bflex(?:ed)?[\s-]*(?:2|two)\b|\bconvertible(?: to)?[\s-]*(?:2|two)\b", re.I)
_STUDIO = re.compile(r"\b(?:converted|large|oversized|jumbo|convertible|alcove)\s+studio\b|\bstudio\s*(?:\+|/|with|and)\s*"
                     r"(?:alcove|home office|sleeping)|\bstudio-like\b|\balcove[- ](?:studio|style)\b|"
                     r"\b(?:says|lists it as|listed as|classif\w+ as|classification:?)\s+(?:a\s+)?['\"]?studio\b", re.I)


@rule("junior_or_flex_1br")
def _junior(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    beds = num(L.get("beds"))
    if beds is None or beds < 1:
        return []
    need = (crit.get("unit") or {}).get("min_beds", 0) or 0
    sev = "high" if need >= 1 else "med"
    out = []
    if affirmed(_JUNIOR, text) or affirmed(_FLEX_ONE, text) or (beds >= 2 and affirmed(_FLEX_TWO, text)):
        out.append(Flag("junior_or_flex_1br", sev, "Junior, flex or convertible layout counted as a bedroom: check the plan "
                        "for a real enclosed bedroom with a door and a window", "beds"))
    elif affirmed(_STUDIO, text):
        out.append(Flag("junior_or_flex_1br", "med", "Text calls it a studio or alcove while beds says 1+: confirm an "
                        "enclosed bedroom", "beds"))
    if re.search(r"\b1\s*room\b", text, re.I) and beds >= 1:
        out.append(Flag("junior_or_flex_1br", "med", "Portal says '1 room' for a one-bedroom: the bedroom may not be a "
                        "separate room", "beds"))
    return out[:1]


_BLDG_LAUNDRY = re.compile(r"laundry (?:room|facilit\w+|in (?:the )?building|on (?:every|each|site)|in basement)|"
                           r"(?:shared|common|building|on-site|onsite|central|coin|basement)[ -]laundry|"
                           r"laundry is building-level|w/d in (?:the )?building", re.I)
_UNIT_LAUNDRY = re.compile(r"in[- ](?:unit|home|residence|apartment)\s+(?:w/d|washer|laundry)|(?:w/d|washer[ /&-]*dryer|laundry)\s+in[- ](?:unit|home|residence|apartment|the unit)|"
                           r"\bwasher/dryer\b(?! (?:in|on) (?:the )?building)", re.I)


@rule("building_laundry_as_in_unit")
def _laundry(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if (L.get("amenities") or {}).get("in_unit_wd") is not True:
        return []
    if affirmed(_BLDG_LAUNDRY, text):
        weak = not affirmed(_UNIT_LAUNDRY, _BLDG_LAUNDRY.sub(" ", text))
        return [Flag("building_laundry_as_in_unit", "high" if weak else "med",
                     "In-unit W/D is marked yes but the text describes building laundry" +
                     (" and never states in-unit laundry" if weak else ": confirm the washer is in the unit"),
                     "amenities.in_unit_wd")]
    if re.search(r"w/?d hook-?ups?|washer[- ]dryer hook-?ups?", text, re.I):
        return [Flag("building_laundry_as_in_unit", "med", "W/D hookups are not a washer and dryer: confirm the machines "
                     "are included", "amenities.in_unit_wd")]
    return []


def _price_drops(L: dict, text: str, ctx: dict) -> list[float]:
    p = L.get("price") or {}
    g = num(p.get("gross"))
    drops: list[float] = []
    hist = [num(h.get("gross")) for h in (L.get("price_history") or []) if isinstance(h, dict)]
    hist += [num(v) for v in ctx.get("gross_claims", [])]
    hist += [num(c.get("value")) for c in L.get("claims") or [] if isinstance(c, dict)
             and str(c.get("field") or "").replace("price.", "") == "gross"]
    hist += [num((c.get("price") or {}).get("gross")) for c in L.get("claims") or []
             if isinstance(c, dict) and isinstance(c.get("price"), dict)]
    hist = [h for h in hist if h]
    if g:
        drops += [h - g for h in hist if h > g]
    for a, b in zip(hist, hist[1:]):
        if a > b:
            drops.append(a - b)
    for m in re.finditer(r"(?:was|from|previously|reduced from|down from)\s*\$\s?([\d,]{3,})", text, re.I):
        old = num(m.group(1))
        if old and g and old > g:
            drops.append(old - g)
    for m in re.finditer(r"(?:price (?:drop|cut|reduction)|reduced|lowered|dropped)(?: by| of)?\s*\$\s?([\d,]{2,})", text, re.I):
        d = num(m.group(1))
        if d:
            drops.append(d)
    return [round(d, 2) for d in drops if d > 0]


@rule("fee_is_price_drop")
def _fee_drop(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    p = L.get("price") or {}
    drops = _price_drops(L, text, ctx)
    for k in ("fees_monthly", "fees_one_time", "broker_fee"):
        v = num(p.get(k))
        if v and any(abs(v - d) <= 1 for d in drops):
            return [Flag("fee_is_price_drop", "high", f"The ${v:,.0f} recorded as {k.replace('_', ' ')} equals a recent "
                         "price drop: it is probably the old-minus-new price, not a fee", f"price.{k}")]
    return []


_CACHED = re.compile(r"\bcached\b|\bcrawl(?:ed)?\b|indexed snapshot|search snapshot|google cache|web reader|archive\.org|"
                     r"wayback|older (?:exact )?(?:owner )?page", re.I)


@rule("stale_or_cached_page")
def _stale(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if not is_active(L):
        return []
    out = []
    ck = parse_date(L.get("checked"))
    today, days = ctx["today"], stale_days(crit)
    if ck is None:
        out.append(Flag("stale_or_cached_page", "med", "Never checked: no date on which the price and status were seen", "checked"))
    elif (today - ck).days > days:
        out.append(Flag("stale_or_cached_page", "med", f"Last checked {ck} ({(today - ck).days} days ago): price and "
                        "status may have changed", "checked"))
    ca = num(L.get("crawl_age_days"))
    if (ca is not None and ca > days) or _CACHED.search(text):
        out.append(Flag("stale_or_cached_page", "med", "Evidence comes from a cached or crawled copy: an older crawl is "
                        "not a fresh check; reopen the live unit page", "links.listing"))
    av = parse_date(L.get("available"))
    if av and ck and av < ck - dt.timedelta(days=30) and L.get("status") in ("new", "researching"):
        out.append(Flag("stale_or_cached_page", "low", f"Available date {av} is long past: the listing may be stale or "
                        "already leased", "available"))
    return out


_ADDR_IN_URL = re.compile(r"(?<![a-z0-9])(\d{1,5})-((?:[a-z0-9]+-){0,3}?)(street|st|avenue|ave|place|pl|road|rd|boulevard|blvd|"
                          r"drive|dr|lane|ln|way|terrace|ter|square|sq|parkway|pkwy)(?![a-z])")


def _url_address(url: str) -> tuple[str, str] | None:
    """(house number, street core) named in a URL path, e.g. .../416-west-52nd-street-new_york/507 -> ('416', 'w 52 st')."""
    path = re.sub(r"^https?://[^/]+", "", url.lower())
    m = _ADDR_IN_URL.search(path.replace("_", "-"))
    if not m or not m.group(2):   # '93-street' is a street, not a house number
        return None
    street = norm_address(" ".join([m.group(2).replace("-", " "), m.group(3)]))
    return m.group(1), street


@rule("url_names_other_building")
def _url_building(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    url = (L.get("links") or {}).get("listing")
    if not isinstance(url, str):
        return []
    ua = _url_address(url)
    addr = norm_address(L.get("address"))
    m = re.match(r"^(\d+)\s+(.*)$", addr)
    out = []
    if ua and m:
        num_u, street_u = ua
        num_a, street_a = m.group(1), m.group(2)
        aliases = [norm_address(a) for a in (L.get("address_aliases") or [])]
        core = lambda s: [w for w in s.split() if w not in ("w", "e", "n", "s")]  # noqa: E731
        same_street = core(street_u)[:1] == core(street_a)[:1] or street_u in street_a or street_a in street_u
        if num_u != num_a and not any(a.startswith(f"{num_u} ") for a in aliases):
            # same street, different number: the classic 1510 vs 1460 mix-up. Different street too: maybe an alias.
            out.append(Flag("url_names_other_building", "high" if same_street else "med",
                            f"Listing URL names {num_u} {street_u}, but the address is {num_a} {street_a}: confirm the page "
                            "is this building (or record it under address_aliases)", "links.listing"))
    seg = re.search(r"/(?:building|buildings)/[^/?#]+/([a-z0-9-]{1,8})/?(?:[?#].*)?$", url.lower())
    if seg and L.get("unit") and norm_unit(seg.group(1)) != norm_unit(L.get("unit")):
        out.append(Flag("url_names_other_building", "med", f"Listing URL is for unit {seg.group(1).upper()}, not "
                        f"{L.get('unit')}", "links.listing"))
    return out


_SALE_URL = re.compile(r"/(?:sale|sales|for-sale|forsale|buy|homes-for-sale)(?:/|$)|for_sale|/sale-listing|listing_type=sale", re.I)
_SALE_TEXT = re.compile(r"\bfor sale\b|\basking price\b|\bcommon charges\b|\bclosing costs\b|\bmortgage\b|\bco-?op maintenance\b", re.I)


@rule("sale_not_rental")
def _sale(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    url = str((L.get("links") or {}).get("listing") or "")
    g = num((L.get("price") or {}).get("gross"))
    if _SALE_URL.search(url):
        return [Flag("sale_not_rental", "high", "The listing URL is a for-sale page: this may be a sale, not a rental",
                     "links.listing")]
    if g and g > 60000:
        return [Flag("sale_not_rental", "high", f"Price ${g:,.0f} is a purchase price, not a monthly rent", "price.gross")]
    if _SALE_TEXT.search(text) and not re.search(r"\brental\b|\bfor rent\b|\blease\b", text, re.I):
        return [Flag("sale_not_rental", "med", "Text reads like a sale listing (asking price, common charges): confirm "
                     "it is for rent", "links.listing")]
    return []


@rule("challenge_page_evidence")
def _challenge(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if is_challenge_page(text):
        return [Flag("challenge_page_evidence", "high", "Captured text is a bot-check or CAPTCHA page, not the listing: "
                     "discard it and capture the real page (ask the renter if the site blocks you)", "notes")]
    for name, body in ctx.get("snapshots", []):
        if is_challenge_page(body):
            return [Flag("challenge_page_evidence", "high", f"Saved evidence {name} is a bot-check page, not the listing",
                         "research/snapshots")]
    return []


_START_BY = re.compile(r"(?:only (?:for|with)?\s*(?:leases?|move[- ]ins?|starts?)?\s*(?:before|by)|(?:lease|move[- ]in|start)s?"
                       r"(?: date)?(?: must)?(?: be)?(?: start(?:ing)?)?\s*(?:by|before|no later than)|requires? (?:a )?"
                       r"(?:lease|start|move[- ]in) (?:by|before)|if (?:you )?(?:sign|move in|start) (?:by|before)|expire[sd]? (?:on )?)"
                       r"\s*([^.;,]{3,24})", re.I)


@rule("concession_expired_by_start")
def _expired(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    p = L.get("price") or {}
    earliest, _ = move_in(crit)
    if earliest is None:
        return []
    deadlines: list[dt.date] = []
    conc = p.get("concession") if isinstance(p.get("concession"), dict) else {}
    offer_ends: list[dt.date] = []
    for c in conc.get("conditions") or []:
        if not isinstance(c, dict):
            continue
        d = parse_date(c.get("value"))
        if d and c.get("type") in ("start_before", "lease_start_by"):
            deadlines.append(d)
        elif d and c.get("type") in ("expires", "sign_by"):
            offer_ends.append(d)
    if offer_ends and min(offer_ends) < ctx["today"]:
        return [Flag("concession_expired_by_start", "high", f"The concession offer ended {min(offer_ends)}: price the unit "
                     "at gross unless it is renewed in writing", "price.concession")]
    if num(p.get("free_months")) or num(p.get("net_effective")) or conc or re.search(r"free|concession|net", text, re.I):
        for m in _START_BY.finditer(text):
            deadlines += _dates_in(m.group(1), earliest.year)
    late = [d for d in deadlines if d < earliest]
    if late:
        return [Flag("concession_expired_by_start", "high", f"The concession needs a lease start by {min(late)}, before the "
                     f"earliest move-in {earliest}: price the unit at gross unless the offer is extended in writing",
                     "price.free_months")]
    return []


_LABELLED = re.compile(r"(?:plan|floor ?plan|floorplan)[^.]{0,60}?\blabel(?:l)?ed\s+(?:as\s+)?(?:unit\s+|residence\s+|apt\.?\s+|#)?"
                       r"([0-9]{1,4}[a-z]{0,2}\d?|[a-z]{1,2}[0-9]{1,3})\b", re.I)


@rule("plan_label_mismatch")
def _plan(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    unit = norm_unit(L.get("unit"))
    labels = []
    for src in (L.get("plan") or {}, (ctx.get("plan") or {}).get("provenance") or {}):
        if isinstance(src, dict):
            if src.get("match") == "mismatch":
                return [Flag("plan_label_mismatch", "high", "The floor plan is marked as belonging to another unit: it cannot "
                             "verify this unit's layout", "links.floorplan")]
            if src.get("printed_label"):
                labels.append(str(src["printed_label"]))
    labels += [m.group(1) for m in _LABELLED.finditer(text)]
    for lab in labels:
        n = norm_unit(lab)
        if unit and n and n != unit:
            if re.fullmatch(r"[a-z]{1,2}", n) and unit.endswith(n):
                return [Flag("plan_label_mismatch", "low", f"Plan is the {lab.upper()} line, not unit {L.get('unit')} itself: "
                             "a representative plan, not proof of this unit's layout", "links.floorplan")]
            return [Flag("plan_label_mismatch", "high", f"Floor plan is labelled {lab.upper()}, not {L.get('unit')}: it "
                         "cannot verify this unit's size, door or W/D", "links.floorplan")]
    return []


@rule("zero_fee_asserted")
def _zero_fee(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if not is_active(L):
        return []
    p = L.get("price") or {}
    basis = str(p.get("fees_basis") or "").lower()
    if basis in {"fee_schedule", "lease_rider", "written", "owner_schedule"} or p.get("fees_source"):
        return []
    zero = [k for k in ("fees_monthly", "fees_one_time") if p.get(k) is not None and num(p.get(k)) == 0]
    if zero:
        return [Flag("zero_fee_asserted", "med", "A $0 fee with no fee schedule behind it means 'unknown', not 'none': ask "
                     "for the full fee list (or record price.fees_source)", f"price.{zero[0]}")]
    return []


_CONCESSION_STATED = re.compile(r"\b(?:\d+(?:\.\d+)?|one|two|three|half a|a)\s+(?:free\s+months?|months?\s+free)\b|"
                                r"\bnet[- ]effective (?:rent )?(?:of |is )?\$", re.I)


@rule("concession_term_unstated")
def _term(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if not is_active(L):
        return []
    p = L.get("price") or {}
    fm, lm, ne = num(p.get("free_months")), num(p.get("lease_months")), num(p.get("net_effective"))
    if fm and fm > 0 and lm is None:
        return [Flag("concession_term_unstated", "high", f"{fm:g} free month(s) with no lease term: the net rent is unknown "
                     "(the scorer assumes 12 months); get the term in writing", "price.lease_months")]
    if fm is None and ne is None and affirmed(_CONCESSION_STATED, text):
        return [Flag("concession_term_unstated", "med", "The text mentions a concession that is not recorded: the net rent "
                     "is unknown until free months and term are captured", "price.free_months")]
    return []


_SECURITY = re.compile(r"\bsecurity (?:guard|desk|staff)\b|\bvirtual (?:doorman|concierge)\b|\bpart[- ]time doorman\b", re.I)


@rule("doorman_overstated")
def _doorman(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if (L.get("amenities") or {}).get("doorman") == "full-time" and _SECURITY.search(text) \
            and not re.search(r"24[- ]?(?:hour|hr|h|/7)|full[- ]time", text, re.I):
        return [Flag("doorman_overstated", "med", "Doorman is marked full-time but the text describes security, virtual or "
                     "part-time staff", "amenities.doorman")]
    return []


_STAGED = re.compile(r"virtually staged|model (?:unit|home|residence|apartment)|sample (?:unit|video|photos?)|"
                     r"representative (?:photos?|images?|unit)|photos? (?:are|of) (?:a )?similar unit|rendering", re.I)


@rule("photos_not_this_unit")
def _staged(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if _STAGED.search(text):
        return [Flag("photos_not_this_unit", "low", "Photos are staged, a model or a similar unit: they do not show this "
                     "unit's view, light or finishes", "photos")]
    return []


@rule("no_unit_number")
def _no_unit(L: dict, crit: dict, text: str, ctx: dict) -> list[Flag]:
    if is_active(L) and not str(L.get("unit") or "").strip():
        return [Flag("no_unit_number", "med", "No unit number: an 'indicative' ad cannot be verified, toured or compared",
                     "unit")]
    return []


def lint_listing(L: dict, crit: dict, ctx: dict | None = None) -> list[Flag]:
    ctx = dict(ctx or {})
    ctx.setdefault("today", crit_today(crit))
    text = listing_text(L)
    flags: list[Flag] = []
    seen = set()
    for _, fn in RULES:
        for f in fn(L, crit, text, ctx):
            if (f.code, f.field) not in seen:
                seen.add((f.code, f.field))
                flags.append(f)
    return sorted(flags, key=lambda f: SEVERITY_ORDER[f.severity])


def snapshots_for(root: Path | None, lid: str, max_bytes: int = 400_000) -> list[tuple[str, str]]:
    """Saved page captures under research/snapshots/<id>/ (text and HTML only)."""
    if root is None:
        return []
    d = root / "research" / "snapshots" / lid
    out = []
    if d.is_dir():
        for p in sorted(d.iterdir()):
            if p.suffix.lower() in (".txt", ".html", ".htm", ".md") and p.is_file():
                out.append((f"research/snapshots/{lid}/{p.name}", p.read_text(errors="replace")[:max_bytes]))
    return out


def lint_all(listings: list[dict], crit: dict, root: Path | None = None, claims: list[dict] | None = None,
             today: Any = None) -> dict[str, list[Flag]]:
    """Flags for every listing, keyed by id. ``claims`` (history log) feeds the price-drop rule."""
    t = crit_today(crit, today)
    gross_by_id: dict[str, list[Any]] = {}
    for c in claims or []:
        if c.get("field") in ("gross", "price.gross"):
            gross_by_id.setdefault(c.get("id"), []).append(c.get("value"))
    out = {}
    for L in listings:
        plan = None
        if root is not None:
            pp = root / "plans" / f"{L.get('id')}.json"
            if pp.exists():
                try:
                    import json
                    plan = json.loads(pp.read_text())
                except ValueError:
                    plan = None
        ctx = {"today": t, "gross_claims": gross_by_id.get(L.get("id"), []), "snapshots": snapshots_for(root, str(L.get("id"))),
               "plan": plan}
        out[L.get("id")] = lint_listing(L, crit, ctx)
    return out


def rule_codes() -> list[str]:
    return [c for c, _ in RULES]
