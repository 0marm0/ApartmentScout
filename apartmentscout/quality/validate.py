"""`apartmentscout validate`: schema and sanity checks on listings.json.

Errors mean the data is wrong or unsafe to show (duplicate ids, impossible prices, javascript: URLs).
Warnings mean something is probably wrong and worth a look (a geocode far outside the search area,
a stated net that does not match its own concession). Info lines are bookkeeping.
"""
from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from ..listings import AMENITY_KEYS, STATUSES
from . import SCHEMA_VERSION
from .common import (crit_today, building_key, host, in_area, is_active, norm_unit, num, parse_date, search_area,
                     urls_of)

SEVERITIES = ("error", "warn", "info")
DOORMAN = {"full-time", "part-time", "virtual", "none"}
COMPASS = {"N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"}
PHOTO_SCOPES = {"exact-unit", "same-line", "building", "street", "aerial"}
AVAILABILITY = {"potential", "conditional", "unverified", "over_budget", "late", "rejected", "gone", "status_dispute"}
LOCAL_PREFIXES = ("media/", "photos/", "plans/", "research/")

# (field, low, high, severity outside) -- plausible ranges, not rules of nature
RANGES = [
    ("beds", 0, 8, "warn"), ("baths", 0.5, 8, "warn"), ("sqft", 150, 6000, "warn"), ("floor", -2, 110, "warn"),
]


@dataclass(frozen=True)
class Issue:
    severity: str          # error | warn | info
    code: str              # stable machine code, e.g. duplicate_id
    id: str | None         # listing id (None for file-level issues)
    field: str | None
    message: str

    def as_dict(self) -> dict:
        return asdict(self)


def _url_problem(url: str) -> str | None:
    """Mirror of the dashboard's safeUrl(): http(s) URLs or relative media paths without '..'."""
    v = url.strip()
    if re.match(r"^https?://", v, re.I):
        return None if host(v) else "URL has no host"
    if re.match(r"^[a-z][a-z0-9+.-]*:", v, re.I):
        return f"unsafe URL scheme '{v.split(':', 1)[0]}:' (only http and https are shown)"
    if ".." in v or v.startswith("/"):
        return "local path must be relative to the search folder and must not contain '..'"
    if not v.startswith(LOCAL_PREFIXES):
        return "not a URL and not a media/ path"
    return None


def validate_document(doc: Any) -> list[Issue]:
    """Checks on the top-level shape of listings.json (a list, or {"schema_version", "listings"})."""
    out: list[Issue] = []
    if isinstance(doc, list):
        return out
    if not isinstance(doc, dict) or not isinstance(doc.get("listings"), list):
        return [Issue("error", "bad_document", None, None, "listings.json must be a list of listings or "
                      "an object with a 'listings' list")]
    v = doc.get("schema_version")
    if v is None:
        out.append(Issue("info", "schema_version_missing", None, "schema_version",
                         f"no schema_version; version {SCHEMA_VERSION} assumed"))
    elif not isinstance(v, int) or v < 1:
        out.append(Issue("error", "schema_version_invalid", None, "schema_version", f"schema_version {v!r} is not a positive integer"))
    elif v > SCHEMA_VERSION:
        out.append(Issue("error", "schema_version_newer", None, "schema_version",
                         f"schema_version {v} is newer than this ApartmentScout understands ({SCHEMA_VERSION}); upgrade"))
    return out


def validate(listings: list[dict], crit: dict, root: Path | None = None, today: Any = None) -> list[Issue]:
    """Validate normalised listings against the data model. ``root`` (the search folder) enables local file checks."""
    out: list[Issue] = []
    add = lambda sev, code, L, field, msg: out.append(Issue(sev, code, (L or {}).get("id"), field, msg))  # noqa: E731
    now = crit_today(crit, today)
    area = search_area(crit)
    hard = (crit.get("budget") or {}).get("hard_max")

    ids: dict[str, int] = defaultdict(int)
    for L in listings:
        ids[str(L.get("id"))] += 1
    for i, n in ids.items():
        if n > 1:
            out.append(Issue("error", "duplicate_id", i, "id", f"id appears {n} times; ids must be unique"))

    # declared aliases (listings.alias_groups): other listing ids for the same unit; duplicates inside one group
    # are intended and folded by listings.merge_aliases()
    group_of: dict[str, str] = {}
    try:
        from ..listings import alias_groups
        for canon, members in alias_groups([L for L in listings if L.get("id")]).items():
            for m in [canon, *members]:
                group_of[str(m)] = str(canon)
    except (ImportError, KeyError):
        pass
    unit_owner: dict[tuple[str, str], list[str]] = defaultdict(list)
    url_owner: dict[str, list[str]] = defaultdict(list)
    for L in listings:
        lid = str(L.get("id") or "")
        al = L.get("aliases")
        if al is not None and not (isinstance(al, list) and all(isinstance(a, str) for a in al)):
            add("error", "bad_aliases", L, "aliases", "aliases must be a list of listing ids")
        else:
            for a in al or []:
                if a == lid:
                    add("info", "self_alias", L, "aliases", "a listing does not need itself as an alias")
                elif a not in ids:
                    add("info", "alias_unknown_id", L, "aliases", f"alias '{a}' is not the id of any listing")
        if L.get("unit"):
            unit_owner[(building_key(L), norm_unit(L["unit"]))].append(lid)
        u = (L.get("links") or {}).get("listing")
        if isinstance(u, str) and u.strip():
            url_owner[u.strip().rstrip("/").lower()].append(lid)
    same_group = lambda owners: len({group_of.get(o, o) for o in owners}) == 1  # noqa: E731
    for (bk, u), owners in unit_owner.items():
        if len(owners) > 1 and not same_group(owners):
            out.append(Issue("warn", "duplicate_unit", owners[1], "unit",
                             f"same building and unit as {', '.join(owners[:1] + owners[2:])}: if it is one unit, "
                             "declare the other id in 'aliases'"))
    unit_of = {str(L.get("id") or ""): norm_unit(L.get("unit")) for L in listings}
    for url, owners in url_owner.items():
        # only a URL that names a unit identifies one; building, availability and search pages are shared on purpose
        names_unit = any(unit_of.get(o) and re.search(rf"(?<![a-z0-9])0*{re.escape(unit_of[o])}(?![a-z0-9])", url)
                         for o in owners)
        if len(owners) > 1 and names_unit and not same_group(owners):
            out.append(Issue("warn", "duplicate_url", owners[1], "links.listing",
                             f"same listing URL as {', '.join(o for o in owners if o != owners[1])}"))

    for L in listings:
        if not L.get("id"):
            add("error", "missing_id", L, "id", "listing has no id")
        if not (L.get("building") or L.get("address")):
            add("error", "missing_identity", L, "building", "needs a building name or an address")
        if not L.get("address"):
            add("warn", "missing_address", L, "address", "no street address: geocoding and records lookups cannot run")
        st = L.get("status")
        if st not in STATUSES:
            add("error", "bad_status", L, "status", f"status {st!r} is not one of {', '.join(STATUSES)}")
        av = L.get("availability")
        if isinstance(av, dict) and av.get("state") not in AVAILABILITY:
            add("error", "bad_availability", L, "availability.state",
                f"availability state {av.get('state')!r} is not one of {', '.join(sorted(AVAILABILITY))}")

        cl = L.get("claims")
        if cl is not None and not (isinstance(cl, list) and all(isinstance(c, dict) and c.get("source")
                                                                and ("field" in c or "price" in c) for c in cl)):
            add("error", "bad_claims", L, "claims", "claims must be objects with a source and a field/value or a price")

        # amenities
        am = L.get("amenities") or {}
        if not isinstance(am, dict):
            add("error", "bad_amenities", L, "amenities", "amenities must be an object")
            am = {}
        for k, v in am.items():
            if k == "doorman":
                if v is not None and v not in DOORMAN:
                    add("error", "bad_doorman", L, "amenities.doorman", f"doorman {v!r} is not one of {', '.join(sorted(DOORMAN))}")
            elif v is not None and not isinstance(v, bool):
                add("warn", "amenity_not_bool", L, f"amenities.{k}", f"{k} should be true, false or null, not {v!r}")
            elif k not in AMENITY_KEYS and k not in (crit.get("must_have") or []) + (crit.get("strongly_prefer") or []) \
                    + (crit.get("nice_to_have") or []):
                add("info", "unknown_amenity", L, f"amenities.{k}", f"'{k}' is not a known amenity key and no criterion uses it")

        exp = L.get("exposure")
        if exp is not None:
            bad = [e for e in (exp if isinstance(exp, list) else [exp]) if str(e).upper() not in COMPASS]
            if bad:
                add("error", "bad_exposure", L, "exposure", f"not compass points: {bad}")

        for f, lo, hi, sev in RANGES:
            v = L.get(f)
            if v is None:
                continue
            x = num(v)
            if x is None:
                add("error", "not_a_number", L, f, f"{f} {v!r} is not a number")
            elif not lo <= x <= hi:
                add(sev, "out_of_range", L, f, f"{f} {x:g} is outside the plausible range {lo:g}-{hi:g}")

        # prices
        p = L.get("price") or {}
        g, ne = num(p.get("gross")), num(p.get("net_effective"))
        fm, lm = num(p.get("free_months")), num(p.get("lease_months"))
        if g is None and ne is None:
            add("warn" if is_active(L) else "info", "missing_price", L, "price.gross", "no gross or net rent")
        for k, v in (("gross", g), ("net_effective", ne)):
            if v is None:
                continue
            if v <= 0:
                add("error", "impossible_price", L, f"price.{k}", f"{k} ${v:,.0f} is not a rent")
            elif v < 300:
                add("error", "impossible_price", L, f"price.{k}", f"{k} ${v:,.0f} a month is implausibly low (weekly or a typo?)")
            elif v > 60000:
                add("error", "impossible_price", L, f"price.{k}", f"{k} ${v:,.0f} looks like a sale price, not a monthly rent")
            elif hard and v > float(hard) * 4:
                add("warn", "implausible_price", L, f"price.{k}", f"{k} ${v:,.0f} is more than four times the budget cap")
        if g and ne and ne > g + 1:
            add("error", "net_above_gross", L, "price.net_effective", f"net ${ne:,.0f} is above gross ${g:,.0f}")
        if g and ne and ne < g * 0.6:
            add("warn", "deep_concession", L, "price.net_effective", f"net ${ne:,.0f} is under 60% of gross ${g:,.0f}: check the term")
        if lm is not None and not 1 <= lm <= 36:
            add("error", "bad_lease_months", L, "price.lease_months", f"lease of {lm:g} months")
        if fm is not None and (fm < 0 or (lm and fm >= lm)):
            add("error", "bad_free_months", L, "price.free_months", f"{fm:g} free months on a {lm or '?'}-month lease")
        if g and fm and lm and ne and 1 <= lm <= 36 and 0 <= fm < lm:
            calc = g * (lm - fm) / lm
            if abs(calc - ne) > 2:
                add("warn", "net_mismatch", L, "price.net_effective",
                    f"stated net ${ne:,.2f} but ${g:,.0f} x ({lm:g}-{fm:g})/{lm:g} = ${calc:,.2f}")
        for k in ("fees_monthly", "fees_one_time", "broker_fee"):
            v = num(p.get(k))
            if v is not None and v < 0:
                add("error", "negative_fee", L, f"price.{k}", f"{k} is negative")
            if k == "fees_monthly" and v and g and v > g * 0.5:
                add("warn", "implausible_fee", L, f"price.{k}", f"monthly fees ${v:,.0f} are over half the rent")

        # location
        lat, lon = num(L.get("lat")), num(L.get("lon"))
        if (lat is None) != (lon is None):
            add("error", "half_coordinates", L, "lat", "lat and lon must be set together")
        elif lat is not None and lon is not None:
            if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (abs(lat) < 1e-6 and abs(lon) < 1e-6):
                add("error", "bad_coordinates", L, "lat", f"({lat}, {lon}) is not a real location")
            elif area and not in_area(lat, lon, area):
                add("warn", "outside_search_area", L, "lat",
                    f"({lat:.5f}, {lon:.5f}) is outside the search area: probably a bad geocode")
        elif is_active(L):
            add("info", "no_coordinates", L, "lat", "not geocoded yet (run apartmentscout geocode)")

        # dates
        ck = L.get("checked")
        if ck not in (None, ""):
            d = parse_date(ck)
            if d is None:
                add("warn", "bad_date", L, "checked", f"checked {ck!r} is not a YYYY-MM-DD date")
            elif d > now + dt.timedelta(days=1):
                add("error", "future_check", L, "checked", f"checked {d} is in the future")

        # URLs and local files
        for field, u in urls_of(L):
            prob = _url_problem(u)
            if prob:
                add("error" if "scheme" in prob or ".." in prob else "warn", "bad_url", L, field, prob)
            elif root is not None and not re.match(r"^https?://", u, re.I) and not (root / u).exists():
                add("warn", "missing_file", L, field, f"local file {u} does not exist in the search folder")
        for i, ph in enumerate(L.get("building_photos") or []):
            if isinstance(ph, dict) and ph.get("scope") not in PHOTO_SCOPES:
                add("warn", "bad_photo_scope", L, f"building_photos[{i}].scope",
                    f"scope {ph.get('scope')!r} is not one of {', '.join(sorted(PHOTO_SCOPES))}")

        # score bookkeeping
        sc = L.get("score") or {}
        if sc.get("rank") is not None and not is_active(L):
            add("warn", "inactive_ranked", L, "score.rank", f"{L.get('status')} listing still has rank {sc['rank']}: rerun apartmentscout score")

    ranks = sorted(int(L["score"]["rank"]) for L in listings if (L.get("score") or {}).get("rank") is not None)
    if ranks and ranks != list(range(1, len(ranks) + 1)):
        out.append(Issue("warn", "ranks_not_contiguous", None, "score.rank",
                         "ranks are not 1..N without gaps or repeats: rerun apartmentscout score"))
    return out


def summarise(issues: list[Issue]) -> dict[str, int]:
    return {s: sum(1 for i in issues if i.severity == s) for s in SEVERITIES}


def format_report(issues: list[Issue], n_listings: int, limit: int = 40) -> str:
    """Readable report: counts, then issues grouped by code with up to ``limit`` lines per severity."""
    c = summarise(issues)
    lines = [f"Checked {n_listings} listings: {c['error']} errors, {c['warn']} warnings, {c['info']} notes."]
    for sev in SEVERITIES:
        group = [i for i in issues if i.severity == sev]
        if not group:
            continue
        codes: dict[str, int] = defaultdict(int)
        for i in group:
            codes[i.code] += 1
        lines.append(f"\n{sev.upper()}S  " + "  ".join(f"{k} x{v}" for k, v in sorted(codes.items(), key=lambda kv: -kv[1])))
        if sev == "info":
            continue
        for i in group[:limit]:
            where = f"{i.id or '(file)'}" + (f"  {i.field}" if i.field else "")
            lines.append(f"  {where}: {i.message}")
        if len(group) > limit:
            lines.append(f"  ... and {len(group) - limit} more (use --json or --all)")
    if not c["error"] and not c["warn"]:
        lines.append("All good.")
    return "\n".join(lines)
