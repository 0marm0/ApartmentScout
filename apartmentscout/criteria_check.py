"""Validate criteria.yaml text: the rules `config.load_criteria` enforces, plus the sanity checks a renter would want.

Used by ``apartmentscout criteria --check``, ``init --criteria`` and the local dashboard API, so a file the dashboard
saves is always one the scorer can load. ``errors`` block a save; ``warnings`` are worth a look but never block.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .config import DIMENSION_LABELS, load_criteria_text

BASES = ("monthly_cost", "net", "gross")
MODES = ("best", "subway", "bus", "walk")
_TIME = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
_CITIES = Path(__file__).resolve().parent.parent / "config" / "cities"


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    criteria: dict[str, Any] | None = None

    @property
    def ok(self) -> bool:
        return not self.errors


def known_cities() -> list[str]:
    """`generic` plus every profile in config/cities."""
    return ["generic"] + sorted(p.stem for p in _CITIES.glob("*.yaml"))


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _date(v: Any) -> dt.date | None:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str):
        try:
            return dt.date.fromisoformat(v.strip())
        except ValueError:
            return None
    return None


def _mapping(raw: dict[str, Any], key: str, errors: list[str]) -> dict[str, Any]:
    v = raw.get(key)
    if v is None:
        return {}
    if not isinstance(v, dict):
        errors.append(f"{key}: must be a mapping, not {type(v).__name__}.")
        return {}
    return v


def _check_search(raw: dict[str, Any], r: Report) -> None:
    s = _mapping(raw, "search", r.errors)
    name = s.get("name")
    if not isinstance(name, str) or not name.strip():
        r.errors.append("search.name: give the search a name.")
    elif len(name) > 80:
        r.errors.append("search.name: keep it under 80 characters.")
    city = s.get("city")
    if city is not None and (not isinstance(city, str) or not re.fullmatch(r"[a-z0-9_-]+", city)):
        r.errors.append("search.city: use a lowercase city id such as nyc, or generic.")
    elif isinstance(city, str) and city not in known_cities():
        r.warnings.append(f"search.city: no profile for {city!r} in config/cities (known: {', '.join(known_cities())}); it will run as generic.")
    tz = s.get("timezone")
    if tz is not None:
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo(str(tz))
        except Exception:  # noqa: BLE001 - any failure to resolve the zone is the same message
            r.errors.append(f"search.timezone: {tz!r} is not an IANA time zone (for example America/New_York).")
    mi = s.get("move_in")
    if mi is not None and not isinstance(mi, dict):
        r.errors.append("search.move_in: must have earliest and latest dates.")
    elif isinstance(mi, dict):
        d = {k: _date(mi.get(k)) for k in ("earliest", "latest")}
        for k, v in d.items():
            if mi.get(k) not in (None, "") and v is None:
                r.errors.append(f"search.move_in.{k}: {mi.get(k)!r} is not a date (use YYYY-MM-DD).")
        if d["earliest"] and d["latest"] and d["latest"] < d["earliest"]:
            r.errors.append("search.move_in: latest is before earliest.")
        if "hard" in mi and not isinstance(mi["hard"], bool):
            r.errors.append("search.move_in.hard: use true or false.")
    mc = s.get("map_center")
    if mc is not None:
        ok = isinstance(mc, (list, tuple)) and len(mc) == 2 and all(_num(x) is not None for x in mc)
        if not ok or abs(mc[0]) > 90 or abs(mc[1]) > 180:
            r.errors.append("search.map_center: use [latitude, longitude].")
    mz = s.get("map_zoom")
    if mz is not None and (_num(mz) is None or not 1 <= mz <= 20):
        r.errors.append("search.map_zoom: use a number between 1 and 20.")


def _check_budget(raw: dict[str, Any], r: Report) -> None:
    b = _mapping(raw, "budget", r.errors)
    basis = b.get("basis")
    if basis is not None and basis not in BASES:
        r.errors.append(f"budget.basis: choose one of {', '.join(BASES)}.")
    tiers = b.get("tiers")
    last = None
    if tiers is not None:
        if not isinstance(tiers, list) or not all(isinstance(t, dict) for t in tiers):
            r.errors.append("budget.tiers: a list of {name, max} entries, cheapest first.")
        else:
            names = [str(t.get("name", "")).strip() for t in tiers]
            for i, t in enumerate(tiers):
                m = _num(t.get("max"))
                if not names[i]:
                    r.errors.append(f"budget.tiers[{i + 1}]: needs a name.")
                if m is None or m <= 0:
                    r.errors.append(f"budget.tiers[{i + 1}] ({names[i] or 'unnamed'}): max must be a positive number.")
                    continue
                if last is not None and m <= last:
                    r.errors.append(f"budget.tiers: {names[i] or i + 1} ({m:g}) must be above the tier before it ({last:g}).")
                last = m
            if len(set(names)) != len(names):
                r.errors.append("budget.tiers: tier names must differ.")
            if len(tiers) > 4:
                r.warnings.append("budget.tiers: the dashboard colours four tiers; more will share a colour.")
    hm = b.get("hard_max")
    if hm is not None:
        if _num(hm) is None or hm <= 0:
            r.errors.append("budget.hard_max: must be a positive number.")
        elif last is not None and hm < last:
            r.errors.append(f"budget.hard_max: {hm:g} is below the last tier ({last:g}).")
    if not tiers and hm is None:
        r.warnings.append("budget: no tiers or hard_max, so cost cannot gate or score units.")


def _check_unit(raw: dict[str, Any], r: Report) -> None:
    u = _mapping(raw, "unit", r.errors)
    mb = u.get("min_beds")
    if mb is not None and (_num(mb) is None or mb < 0 or mb > 10):
        r.errors.append("unit.min_beds: use a number from 0 (studio) up.")
    trio = [u.get(k) for k in ("sqft_floor", "sqft_good", "sqft_great")]
    given = [(k, _num(u.get(k))) for k in ("sqft_floor", "sqft_good", "sqft_great") if u.get(k) is not None]
    for k, v in given:
        if v is None or v <= 0:
            r.errors.append(f"unit.{k}: must be a positive number of square feet.")
    if all(_num(x) is not None and x > 0 for x in trio) and not (trio[0] < trio[1] < trio[2]):
        r.errors.append("unit: sizes must rise, sqft_floor < sqft_good < sqft_great.")


def _check_amenities(raw: dict[str, Any], r: Report) -> None:
    seen: dict[str, str] = {}
    for key in ("must_have", "strongly_prefer", "nice_to_have"):
        v = raw.get(key)
        if v is None:
            continue
        if not isinstance(v, list) or not all(isinstance(x, str) and x.strip() for x in v):
            r.errors.append(f"{key}: a list of amenity keys such as [in_unit_wd, elevator].")
            continue
        for x in v:
            if x in seen:
                r.errors.append(f"{key}: {x} is already in {seen[x]}; an amenity can only sit in one group.")
            seen[x] = key
    if len(raw.get("must_have") or []) > 5:
        r.warnings.append("must_have: more than five deal-breakers will remove most units; consider strongly_prefer.")


def _check_commute(raw: dict[str, Any], r: Report) -> None:
    c = _mapping(raw, "commute", r.errors)
    ds = c.get("destinations")
    if ds is not None and (not isinstance(ds, list) or not all(isinstance(d, dict) for d in ds)):
        r.errors.append("commute.destinations: a list of destinations, each with a name and an address or lat/lon.")
        ds = []
    names: list[str] = []
    for i, d in enumerate(ds or []):
        n = str(d.get("name") or "").strip()
        tag = f"commute.destinations[{i + 1}]" + (f" ({n})" if n else "")
        if not n:
            r.errors.append(f"{tag}: needs a name.")
        names.append(n)
        lat, lon = d.get("lat"), d.get("lon")
        has = lat is not None and lon is not None
        if (lat is None) != (lon is None):
            r.errors.append(f"{tag}: give both lat and lon, or neither.")
        elif has and (_num(lat) is None or _num(lon) is None or abs(lat) > 90 or abs(lon) > 180):
            r.errors.append(f"{tag}: latitude or longitude is out of range.")
        if not has and not str(d.get("address") or "").strip():
            r.errors.append(f"{tag}: give an address or lat/lon.")
        ab = d.get("arrive_by")
        if ab is not None and not _TIME.match(str(ab)):
            r.errors.append(f"{tag}: arrive_by should look like \"09:00\".")
        mm = d.get("max_minutes")
        if mm is not None and (_num(mm) is None or mm <= 0):
            r.errors.append(f"{tag}: max_minutes must be positive.")
        w = d.get("weight")
        if w is not None and (_num(w) is None or w < 0):
            r.errors.append(f"{tag}: weight cannot be negative.")
        m = d.get("mode")
        if m is not None and m not in MODES:
            r.errors.append(f"{tag}: mode must be one of {', '.join(MODES)}.")
    if len({n for n in names if n}) != len([n for n in names if n]):
        r.errors.append("commute.destinations: names must differ.")
    tr = c.get("transit")
    if tr is not None and not isinstance(tr, dict):
        r.errors.append("commute.transit: must be a mapping (feeds, service_date, ...).")
    elif isinstance(tr, dict):
        feeds = tr.get("feeds")
        if feeds is not None and (not isinstance(feeds, list) or not all(isinstance(f, dict) and f.get("url") for f in feeds)):
            r.errors.append("commute.transit.feeds: a list of {name, url} entries.")
        if tr.get("service_date") is not None and _date(tr["service_date"]) is None:
            r.errors.append("commute.transit.service_date: use YYYY-MM-DD.")


def _check_scoring(raw: dict[str, Any], r: Report) -> None:
    w = raw.get("weights")
    if w is not None:
        if not isinstance(w, dict):
            r.errors.append("weights: a mapping of dimension to number.")
        else:
            for k, v in w.items():
                if k not in DIMENSION_LABELS:
                    r.warnings.append(f"weights.{k}: not a scoring dimension ({', '.join(DIMENSION_LABELS)}); it is ignored.")
                if _num(v) is None or v < 0:
                    r.errors.append(f"weights.{k}: use a number of zero or more.")
    sc = raw.get("scoring")
    if sc is not None and not isinstance(sc, dict):
        r.errors.append("scoring: a mapping (preset, stale_days, ...).")
    br = raw.get("building_ratings")
    if br is not None:
        if not isinstance(br, dict):
            r.errors.append("building_ratings: a mapping of building name to a rating from 1 to 5.")
        else:
            for k, v in br.items():
                if not str(k).strip():
                    r.errors.append("building_ratings: a building needs a name.")
                if _num(v) is None or not 1 <= v <= 5:
                    r.errors.append(f"building_ratings.{k}: rate from 1 to 5.")


def check_text(text: str) -> Report:
    """Validate criteria.yaml text. On success `report.criteria` is what `load_criteria` returns."""
    r = Report()
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark else ""
        r.errors.append(f"Not valid YAML{where}: {getattr(e, 'problem', None) or e}")
        return r
    if raw is None:
        r.errors.append("The file is empty.")
        return r
    if not isinstance(raw, dict):
        r.errors.append("criteria.yaml must be a mapping of sections (search, budget, unit, ...).")
        return r
    for fn in (_check_search, _check_budget, _check_unit, _check_amenities, _check_commute, _check_scoring):
        fn(raw, r)
    known = {"search", "budget", "unit", "must_have", "strongly_prefer", "nice_to_have", "commute", "scoring", "weights",
             "favorites_first", "landmarks", "watchlist", "building_ratings"}
    for k in raw:
        if k not in known:
            r.warnings.append(f"{k}: not a criteria section the tools read; check the spelling.")
    try:
        r.criteria = load_criteria_text(text)
    except (ValueError, TypeError, AttributeError) as e:
        r.errors.append(f"scoring: {e}")
    return r


def check_file(path: str | Path) -> Report:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        r = Report()
        r.errors.append(f"Cannot read {path}: {e}")
        return r
    return check_text(text)


def summary_lines(c: dict[str, Any]) -> list[str]:
    """A few readable lines about a loaded criteria mapping."""
    s, b, u = c.get("search", {}), c.get("budget", {}), c.get("unit", {})
    mi = s.get("move_in") or {}
    out = [f"Search      {s.get('name', '?')}  ({s.get('city') or 'generic'}, {s.get('timezone') or 'no time zone'})"]
    if mi:
        out.append(f"Move-in     {mi.get('earliest', '?')} to {mi.get('latest', '?')}{' (hard deadline)' if mi.get('hard') else ''}")
    tiers = ", ".join(f"{t.get('name')} ${t.get('max'):,.0f}" for t in b.get("tiers") or [] if _num(t.get("max")) is not None)
    out.append(f"Budget      {tiers or 'no tiers'}" + (f", cap ${b['hard_max']:,.0f}" if _num(b.get("hard_max")) else "") + f"  (basis: {b.get('basis') or 'monthly_cost'})")
    if u:
        out.append(f"Home        {u.get('min_beds', 0):g}+ bd, {u.get('sqft_floor', '?')} / {u.get('sqft_good', '?')} / {u.get('sqft_great', '?')} ft2 (floor / good / great)")
    for key, label in (("must_have", "Must"), ("strongly_prefer", "Strongly"), ("nice_to_have", "Nice")):
        if c.get(key):
            out.append(f"{label:<11} {', '.join(c[key])}")
    for d in (c.get("commute") or {}).get("destinations") or []:
        spot = f"{d['lat']:.4f}, {d['lon']:.4f}" if d.get("lat") is not None and d.get("lon") is not None else (d.get("address") or "no location")
        out.append(f"Commute     {d.get('name')}: {spot}, arrive {d.get('arrive_by', '?')}, up to {d.get('max_minutes', '?')} min, weight {d.get('weight', 1)}")
    w = c.get("weights") or {}
    tot = sum(v for v in w.values() if _num(v) is not None) or 1
    shares = ", ".join(f"{k} {100 * v / tot:.0f}%" for k, v in sorted(w.items(), key=lambda kv: -kv[1]) if _num(v) and v > 0)
    preset = (c.get("scoring") or {}).get("preset")
    out.append(f"Weights     {shares or 'none'}" + (f"  (preset: {preset})" if preset else ""))
    if c.get("building_ratings"):
        out.append("Rated       " + ", ".join(f"{k} {v:g}" for k, v in c["building_ratings"].items()))
    return out
