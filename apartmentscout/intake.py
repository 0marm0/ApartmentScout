"""The intake questionnaire (config/intake.yaml) as code: load it, ask it on a terminal, and turn answers into criteria.yaml.

``apartmentscout init --interactive`` calls :func:`interview`; :func:`render_criteria` is the one place a criteria
mapping becomes a criteria.yaml file (the dashboard's JavaScript emitter writes the same layout), and :func:`init_search`
creates a search folder for the CLI and for the dashboard's local API.
"""
from __future__ import annotations

import datetime as dt
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .config import DIMENSION_LABELS, PRESETS
from .criteria_check import check_text, known_cities

REPO = Path(__file__).resolve().parent.parent
INTAKE_PATH = REPO / "config" / "intake.yaml"
TEMPLATE_PATH = REPO / "config" / "criteria.example.yaml"
MAX_NAME = 80


def load_intake(path: Path = INTAKE_PATH) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def city_profile(city: str | None) -> dict[str, Any]:
    p = REPO / "config" / "cities" / f"{city}.yaml"
    return (yaml.safe_load(p.read_text(encoding="utf-8")) or {}) if city and re.fullmatch(r"[a-z0-9_-]+", city) and p.exists() else {}


# --------------------------------------------------------------------------- taste -> weights
def taste_weights(levels: dict[str, int | None], intake: dict[str, Any] | None = None,
                  dimensions: list[str] | None = None) -> dict[str, float]:
    """Weight per dimension from the importance levels (0-3) a renter gave for luxury, renovated, appliances, view,
    light and quiet. Items left unanswered change nothing. A dimension the scorer does not have (``interior`` before it
    ships) folds into ``building``."""
    intake = intake or load_intake()
    dims = dimensions or list(DIMENSION_LABELS)
    out: dict[str, float] = {}
    step = next(s for s in intake["steps"] if s["id"] == "taste")
    for q in step["questions"]:
        if q.get("type") != "level" or levels.get(q["id"]) is None:
            continue
        d = q["dimension"] if q["dimension"] in dims else "building"
        out[d] = out.get(d, 0) + q["weights"][int(levels[q["id"]])]
    return out


def resolve_weights(preset: str | None, taste: dict[str, float], overrides: dict[str, float] | None = None,
                    dimensions: list[str] | None = None) -> dict[str, float]:
    """Full weights: the preset (or the balanced defaults), then taste, then explicit overrides."""
    dims = dimensions or list(DIMENSION_LABELS)
    base = dict(PRESETS.get(preset or "balanced", PRESETS["balanced"])["weights"])
    w = {k: float(base.get(k, 0)) for k in dims}
    w.update(taste)
    w.update(overrides or {})
    return w


# --------------------------------------------------------------------------- writing criteria.yaml
class _Flow(dict):
    pass


class _FlowList(list):
    pass


class _Quoted(str):
    """A string that is always written in double quotes (times such as "09:00" must stay text)."""


class _Dumper(yaml.SafeDumper):
    def increase_indent(self, flow: bool = False, indentless: bool = False):   # indent list items under their key
        return super().increase_indent(flow, False)


_Dumper.add_representer(_Quoted, lambda d, v: d.represent_scalar("tag:yaml.org,2002:str", str(v), style='"'))
_Dumper.add_representer(_Flow, lambda d, v: d.represent_mapping("tag:yaml.org,2002:map", v, flow_style=True))
_Dumper.add_representer(_FlowList, lambda d, v: d.represent_sequence("tag:yaml.org,2002:seq", v, flow_style=True))


def _clean(v: Any) -> Any:
    """Drop None and empty values the renter did not set; wrap short lists and mappings in flow style."""
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items() if x is not None and x != {}}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def _as_date(v: Any) -> Any:
    if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        try:
            return dt.date.fromisoformat(v)
        except ValueError:
            return v
    return v


def render_criteria(c: dict[str, Any], note: str = "") -> str:
    """criteria.yaml text for a criteria mapping: sections in the template's order, short lists in flow style, a blank
    line between sections. Unknown keys are kept at the end."""
    c = dict(c)
    s = _clean(c.get("search") or {})
    if isinstance(s.get("move_in"), dict):
        s["move_in"] = {k: _as_date(v) for k, v in s["move_in"].items()}
    if isinstance(s.get("map_center"), list):
        s["map_center"] = _FlowList(s["map_center"])
    b = _clean(c.get("budget") or {})
    if isinstance(b.get("tiers"), list):
        b["tiers"] = [_Flow(t) for t in b["tiers"]]
    com = _clean(c.get("commute") or {})
    if isinstance(com.get("transit"), dict):
        t = com["transit"]
        if isinstance(t.get("feeds"), list):
            t["feeds"] = [_Flow(f) for f in t["feeds"]]
        if "service_date" in t:
            t["service_date"] = _as_date(t["service_date"])
    for d in com.get("destinations") or []:
        for k in ("lat", "lon"):
            if isinstance(d.get(k), float):
                d[k] = round(d[k], 6)
        if isinstance(d.get("arrive_by"), str):
            d["arrive_by"] = _Quoted(d["arrive_by"])
    out: dict[str, Any] = {"search": s}
    out["budget"] = b
    out["unit"] = _clean(c.get("unit") or {})
    for k in ("must_have", "strongly_prefer", "nice_to_have"):
        if c.get(k) is not None:
            out[k] = _FlowList(c[k])
    out["commute"] = com
    if c.get("scoring"):
        out["scoring"] = _clean(c["scoring"])
    if c.get("weights"):
        out["weights"] = {k: (int(v) if float(v).is_integer() else v) for k, v in c["weights"].items()}
    if c.get("building_ratings"):
        out["building_ratings"] = {str(k): (int(v) if float(v).is_integer() else v) for k, v in c["building_ratings"].items()}
    out["favorites_first"] = c.get("favorites_first", True)
    for k, v in c.items():
        if k not in out and v is not None:
            out[k] = _clean(v)
    out = {k: v for k, v in out.items() if v != {} or k == "commute"}
    body = yaml.dump(out, Dumper=_Dumper, sort_keys=False, default_flow_style=False, allow_unicode=True, width=10_000)
    body = re.sub(r"\n(?=[A-Za-z_])", "\n\n", body)   # a blank line before each top-level key
    body = re.sub(r"\n\n(?=(strongly_prefer|nice_to_have):)", "\n", body)   # the three amenity lists stay together
    name = (s.get("name") or "").strip()
    head = [f"# ApartmentScout criteria{' for ' + name if name else ''}.",
            f"# {(note or 'Written by apartmentscout').rstrip('.')}. Edit freely, then check it: apartmentscout criteria --check criteria.yaml", ""]
    return "\n".join(head) + "\n" + body


# --------------------------------------------------------------------------- creating a search folder
def _fill_city_defaults(c: dict[str, Any], city: str | None, info: Any = None) -> bool:
    """Timezone and transit feeds from the city profile (and, for a looked-up city without one, its name, time zone and map
    centre) when the file has none. True when anything was added."""
    prof, changed = city_profile(city), False
    s = c.setdefault("search", {})
    if city and s.get("city") != city:
        s["city"] = city
        changed = True
    if info is not None and not prof:
        for k, v in (("city_name", info.name if info.id != "generic" else None), ("timezone", info.timezone), ("map_center", info.center)):
            if v and not s.get(k):
                s[k] = v
                changed = True
    if prof.get("timezone") and not s.get("timezone"):
        s["timezone"] = prof["timezone"]
        changed = True
    tr = c.setdefault("commute", {}).setdefault("transit", {})
    if prof.get("transit_feeds") and not tr.get("feeds"):
        tr["feeds"] = [dict(f) for f in prof["transit_feeds"]]
        changed = True
    return changed


def _next_service_day(today: dt.date) -> dt.date:
    """A Tuesday-to-Thursday at least a week away: a normal weekday for the transit router."""
    d = today + dt.timedelta(days=7)
    while d.weekday() not in (1, 2, 3):
        d += dt.timedelta(days=1)
    return d


def template_text(city: str | None, info: Any = None, today: dt.date | None = None) -> str:
    """The commented template with dates counted from today, the city profile's timezone and transit feeds filled in, and,
    for a city without a profile that was looked up (``info``, a cities.CityInfo), its name, time zone and map centre.
    Nothing in a new search should still say New York unless the search is there."""
    today = today or dt.date.today()
    text = TEMPLATE_PATH.read_text(encoding="utf-8")
    text = text.replace("earliest: 2026-11-01", f"earliest: {today + dt.timedelta(days=14)}")
    text = text.replace("latest: 2026-12-01", f"latest: {today + dt.timedelta(days=60)}")
    text = text.replace("service_date: 2026-11-04", f"service_date: {_next_service_day(today)}")
    if city:
        text = text.replace("city: generic", f"city: {city}")
        prof = city_profile(city)
        tz = prof.get("timezone") or (info.timezone if info is not None else None)
        if tz:
            text = text.replace("timezone: America/New_York", f"timezone: {tz}")
        elif not prof:
            text = text.replace("timezone: America/New_York # IANA zone for sun times",
                                "timezone: America/New_York # TEMPLATE DEFAULT: set your own IANA zone (apartmentscout city \"<city>\" does it)")
        center = prof.get("center") or (info.center if info is not None else None)
        if center:
            text = text.replace("map_center: [40.7549, -73.9840]", f"map_center: [{center[0]}, {center[1]}]")
        if info is not None and not prof and info.name:
            text = text.replace(f"  city: {city}", f"  city: {city}\n  city_name: {yaml.safe_dump(info.name, width=10_000).split(chr(10))[0]}", 1)
        if prof.get("transit_feeds"):
            # each feed whole (name, url, mode, exclude_routes, map_lines ...), one flow mapping per line
            feeds = "\n".join("      - " + yaml.safe_dump(dict(f), default_flow_style=True, sort_keys=False,
                                                          width=10_000).strip() for f in prof["transit_feeds"])
            text = text.replace("    feeds: []                # add GTFS feeds: - {name: City Metro, url: https://.../gtfs.zip}",
                                "    feeds:\n" + feeds)
    return text


def init_search(root: Path, city: str | None = None, criteria_text: str | None = None, force: bool = False,
                info: Any = None) -> str:
    """Create a search folder (criteria.yaml, research/, plans/, listings.json, listings.template.csv).

    Without `criteria_text` the commented template is used. With it, the text is validated first (ValueError listing
    every problem), and the city profile's timezone and transit feeds are added when it has none. Returns the city used.
    Never overwrites an existing criteria.yaml unless `force`."""
    from .listings import CSV_TEMPLATE_COLUMNS, save
    if (root / "criteria.yaml").exists() and not force:
        raise FileExistsError(f"{root} already has a criteria.yaml (use --force to overwrite).")
    if criteria_text is None:
        text, used = template_text(city, info), city
    else:
        rep = check_text(criteria_text)
        if not rep.ok:
            raise ValueError("\n".join(rep.errors))
        c = yaml.safe_load(criteria_text) or {}
        used = city or (c.get("search") or {}).get("city")
        text = render_criteria(c, "Written by apartmentscout init.") if _fill_city_defaults(c, used, info) else criteria_text
    root.mkdir(parents=True, exist_ok=True)
    (root / "criteria.yaml").write_text(text, encoding="utf-8")
    (root / "research").mkdir(exist_ok=True)
    (root / "plans").mkdir(exist_ok=True)
    if not (root / "listings.json").exists():
        save([], root / "listings.json")
    with (root / "listings.template.csv").open("w", encoding="utf-8") as f:
        f.write(",".join(CSV_TEMPLATE_COLUMNS) + "\n")
    return used or "generic"


# --------------------------------------------------------------------------- the interview
class Quit(Exception):
    """Raised when the input ends before the interview does; the answers so far are kept as defaults."""


def _money(s: str) -> float:
    return float(re.sub(r"[$,\s]", "", s))


def _rel_date(s: str, today: dt.date) -> dt.date:
    m = re.fullmatch(r"\+(\d+)d", s.strip())
    return today + dt.timedelta(days=int(m.group(1))) if m else dt.date.fromisoformat(s.strip())


def _pairs(s: str) -> list[tuple[str, str]]:
    out = []
    for part in re.split(r"[;,]", s):
        if "=" in part:
            k, _, v = part.partition("=")
            if k.strip():
                out.append((k.strip(), v.strip()))
    return out


@dataclass
class Online:
    """What the interview may look up on the network. Each is injected so tests and offline runs never reach it; without an
    ``Online`` the interview asks everything and looks nothing up. [onboarding]"""
    resolve_city: Callable[[str], Any]                  # name -> cities.CityInfo | None
    geocode: Callable[[str, Any], dict | None]          # (address, CityInfo | None) -> {lat, lon, label} | None
    check_feed: Callable[[str], Any]                    # url -> cities.FeedCheck


def live_online() -> Online:
    """The real lookups: OpenStreetMap Nominatim for the city, the geocoder chain for addresses, a first-bytes check for feeds."""
    from . import cities as C
    from .geocode import Geocoder

    def geocode(address: str, info: Any) -> dict | None:
        g = Geocoder(None, info.id if info is not None and info.profile else None)
        tries = [address]
        if info is not None and info.name and C._norm(info.name.split(",")[0]) not in C._norm(address):
            tries.insert(0, f"{address}, {info.name}")
        for t in tries:
            res = g.geocode(t)
            if res:
                return res
        return None

    return Online(C.resolve_city, geocode, C.check_feed)


class Interview:
    """Asks the questionnaire through `ask`/`say` callables, so tests (and notebooks) can script it."""

    def __init__(self, ask: Callable[[str], str], say: Callable[[str], None], today: dt.date | None = None,
                 intake: dict[str, Any] | None = None, online: Online | None = None, city: Any = None) -> None:
        self.ask_fn, self.say, self.today = ask, say, today or dt.date.today()
        self.intake = intake or load_intake()
        self.amen = {a["key"]: a["label"] for a in self.intake["amenities"]}
        self.a: dict[str, Any] = {}
        self.online = online
        self.city_info: Any = None   # cities.CityInfo once the renter has named a city
        self.preset_city = city      # a CityInfo or name given on the command line (--city): the question is not asked

    # -- primitives
    def prompt(self, q: dict[str, Any], default_text: str, hint: str = "") -> str:
        self.say(f"\n{q['ask']}")
        if q.get("why"):
            self.say(f"  ({' '.join(str(q['why']).split())})")
        if hint:
            self.say(f"  {hint}")
        try:
            return self.ask_fn(f"  [{default_text}] > " if default_text != "" else "  > ").strip()
        except EOFError as e:
            raise Quit from e

    def loop(self, q: dict[str, Any], default_text: str, parse: Callable[[str], Any], hint: str = "") -> Any:
        while True:
            raw = self.prompt(q, default_text, hint)
            try:
                return parse(raw)
            except (ValueError, KeyError) as e:
                self.say(f"  That did not work: {e}")

    # -- types
    def text(self, q: dict[str, Any], default: Any) -> Any:
        return self.loop(q, str(default or ""), lambda s: s or default)

    def choice(self, q: dict[str, Any], default: Any, choices: list[str]) -> Any:
        def parse(s: str) -> str:
            if not s:
                return default
            if s.isdigit() and 1 <= int(s) <= len(choices):
                return choices[int(s) - 1]
            if s in choices:
                return s
            raise ValueError(f"choose one of {', '.join(choices)}")
        return self.loop(q, str(default), parse, "Options: " + ", ".join(f"{i + 1}={c}" for i, c in enumerate(choices)))

    def date(self, q: dict[str, Any], default: Any) -> Any:
        d0 = _rel_date(default, self.today) if isinstance(default, str) else default

        def parse(s: str) -> dt.date | None:
            if not s:
                return d0
            if s in ("-", "skip"):
                return None
            try:
                return _rel_date(s, self.today)
            except ValueError as e:
                raise ValueError("use YYYY-MM-DD, +30d for 30 days from today, or - to skip") from e
        return self.loop(q, d0.isoformat() if d0 else "none", parse)

    def boolean(self, q: dict[str, Any], default: Any) -> bool:
        def parse(s: str) -> bool:
            if not s:
                return bool(default)
            if s.lower() in ("y", "yes", "true", "1"):
                return True
            if s.lower() in ("n", "no", "false", "0"):
                return False
            raise ValueError("answer y or n")
        return self.loop(q, "y" if default else "n", parse)

    def number(self, q: dict[str, Any], default: Any, integer: bool = False, optional: bool = False) -> Any:
        lo, hi = q.get("min"), q.get("max")

        def parse(s: str) -> Any:
            if not s:
                return default
            if s in ("-", "skip") and optional:
                return None
            v = _money(s)
            if integer:
                v = int(round(v))
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                raise ValueError(f"use a value between {lo if lo is not None else '-'} and {hi if hi is not None else '-'}")
            return v
        return self.loop(q, "none" if default is None else f"{default:g}" if isinstance(default, float) else str(default), parse)

    def latlon(self, q: dict[str, Any], default: Any) -> list[float] | None:
        def parse(s: str) -> list[float] | None:
            if not s:
                return default
            if s in ("-", "skip"):
                return None
            lat, lon = (float(x) for x in re.split(r"[,\s]+", s.strip(), maxsplit=1))
            if abs(lat) > 90 or abs(lon) > 180:
                raise ValueError("latitude is within 90 and longitude within 180")
            return [lat, lon]
        return self.loop(q, f"{default[0]:g}, {default[1]:g}" if default else "skip", parse,
                         "Enter latitude, longitude; - to leave it out." if default else "")

    def timezone(self, q: dict[str, Any], info: Any) -> str:
        """The IANA zone: the city's (profile or lookup) as the default, checked, with the template default only as a last resort."""
        from . import cities as C
        known = info.timezone or city_profile(info.id).get("timezone")
        default = known or q["default"]

        def parse(s: str) -> str:
            if not s:
                return default
            if not C.valid_timezone(s):
                raise ValueError("use an IANA name such as America/Chicago or Europe/Lisbon")
            return s
        hint = "" if known else (f"I could not tell the zone for {info.name}. " if info.id != "generic" else "") + \
            "Use an IANA name such as America/Chicago, Europe/Lisbon or Asia/Tokyo."
        return self.loop(q, default, parse, hint)

    def preset(self, given: Any) -> Any:
        """The city named with --city: no question, just a line saying what was understood."""
        from . import cities as C
        if isinstance(given, C.CityInfo):
            info = given
        elif given == "generic":
            info = C.CityInfo(id="generic", name="generic", lat=None, lon=None, timezone=None)
        elif C.load_profile(given):
            info = C.from_profile(given)
        else:
            info = (self.online.resolve_city(given) if self.online else None) or C.typed_city(str(given))
        self.say(f"\nCity: {info.name}" + (f" (time zone {info.timezone})" if info.timezone else ""))
        return info

    def city(self, q: dict[str, Any], profiles: list[str]) -> Any:
        """The city question: a profile id, its number in the list, `generic`, or any city name (looked up). Returns a
        cities.CityInfo (id ``generic`` when the renter has not decided)."""
        from . import cities as C
        generic = C.CityInfo(id="generic", name="generic", lat=None, lon=None, timezone=None)
        options = ", ".join(f"{i + 1}={c}" for i, c in enumerate(profiles))
        hint = f"Profiles with built-in open data: {options}. Or type any city name; Enter keeps generic."
        while True:
            raw = self.prompt(q, "generic", hint)
            if raw in ("", "generic", "0"):
                return generic
            if raw.isdigit() and 1 <= int(raw) <= len(profiles):
                raw = profiles[int(raw) - 1]
            info = C.from_profile(raw) if raw in profiles else (self.online.resolve_city(raw) if self.online else None)
            if info is None and self.online is None:
                info = C.typed_city(raw)   # nothing to look it up with: keep the name, ask for the time zone next
                self.say(f"  Keeping {info.name!r} as the city name (no lookup here), so I will ask for its time zone.")
                return info
            if info is None:
                self.say(f"  I could not find {raw!r} (no match, or the network is unavailable). Try \"City, State\" or "
                         "\"City, Country\", or press Enter to decide later.")
                continue
            self.say(f"  Found {info.name}" + (f"; time zone {info.timezone}" if info.timezone else "; time zone not recognised")
                     + (f"; the map opens at {info.center[0]:g}, {info.center[1]:g}" if info.center else "")
                     + ("; a city profile with open data is built in" if info.profile else
                        "; no built-in city data, so buildings and heights come from OpenStreetMap"))
            if self.boolean({**q, "ask": "Is that the right city?", "why": ""}, True):
                return info

    def tiers(self, q: dict[str, Any], default: list[dict[str, Any]]) -> list[dict[str, Any]]:
        d = ", ".join(f"{t['name']}={t['max']:g}" for t in default)

        def parse(s: str) -> list[dict[str, Any]]:
            if not s:
                return [dict(t) for t in default]
            ps = _pairs(s)
            if not ps or len(ps) > q.get("max_items", 4):
                raise ValueError("give 1 to 4 pairs like Target=3000, Stretch=3300")
            tiers = [{"name": k, "max": _money(v)} for k, v in ps]
            if any(t["max"] <= 0 for t in tiers) or any(b["max"] <= a["max"] for a, b in zip(tiers, tiers[1:])):
                raise ValueError("amounts must be positive and rise from one tier to the next")
            if len({t["name"] for t in tiers}) != len(tiers):
                raise ValueError("tier names must differ")
            return [{"name": t["name"], "max": int(t["max"]) if float(t["max"]).is_integer() else t["max"]} for t in tiers]
        return self.loop(q, d, parse, "Format: Name=amount, Name=amount (cheapest first)")

    def amenity_list(self, q: dict[str, Any], default: list[str], taken: set[str]) -> list[str]:
        def parse(s: str) -> list[str]:
            if not s:
                return [k for k in default if k not in taken]
            if s in ("-", "none"):
                return []
            keys = [k.strip().lower().replace(" ", "_") for k in re.split(r"[,;]", s) if k.strip()]
            for k in keys:
                if k in taken:
                    raise ValueError(f"{k} is already in an earlier group")
            if len(set(keys)) != len(keys):
                raise ValueError("an amenity can only be listed once")
            return keys
        return self.loop(q, ", ".join(default) or "none", parse, "Comma-separated keys, or - for none")

    def level(self, q: dict[str, Any], levels: list[str]) -> int | None:
        def parse(s: str) -> int | None:
            if not s or s in ("-", "skip"):
                return None
            v = int(s)
            if not 0 <= v < len(levels):
                raise ValueError("answer 0 to 3")
            return v
        return self.loop(q, "skip", parse, "  ".join(f"{i}={t}" for i, t in enumerate(levels)))

    def ratings(self, q: dict[str, Any]) -> dict[str, float]:
        def parse(s: str) -> dict[str, float]:
            if not s or s in ("-", "skip"):
                return {}
            out = {}
            for k, v in _pairs(s):
                r = float(v)
                if not q["min"] <= r <= q["max"]:
                    raise ValueError(f"{k}: rate from {q['min']} to {q['max']}")
                out[k] = int(r) if r.is_integer() else r
            if not out:
                raise ValueError("format: Building name=4, Other building=2")
            return out
        return self.loop(q, "skip", parse, "Format: Building name=4, Other building=2")

    def destinations(self, q: dict[str, Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        item = {f["id"]: f for f in q["item"]}
        while len(out) < q.get("max_items", 4):
            if not self.boolean({**q, "ask": "Add a destination?" if not out else "Add another destination?", "why": ""}, not out):
                break
            d: dict[str, Any] = {"name": self.loop(item["name"], f"Place {len(out) + 1}", lambda s: s or f"Place {len(out) + 1}")}
            addr = self.loop(item["address"], "", lambda s: s)
            if addr:
                d["address"] = addr
                d.update(self._locate(addr, item["address"]))
            d["arrive_by"] = self.loop(item["arrive_by"], item["arrive_by"]["default"], lambda s: self._time(s, item["arrive_by"]["default"]))
            d["max_minutes"] = self.number(item["max_minutes"], item["max_minutes"]["default"], integer=True)
            d["weight"] = self.number(item["weight"], item["weight"]["default"])
            m = self.choice(item["mode"], "best", item["mode"]["choices"])
            if m != "best":
                d["mode"] = m
            if d["name"] in {x["name"] for x in out}:
                self.say("  That name is already used; renaming it.")
                d["name"] += f" {len(out) + 1}"
            out.append(d)
        return out

    def _locate(self, addr: str, q: dict[str, Any]) -> dict[str, Any]:
        """Find an address on the map and let the renter confirm it: {"lat", "lon"} or nothing. Without a lookup, nothing:
        `apartmentscout geocode` finds it later and saves it."""
        if self.online is None:
            return {}
        for _ in range(3):
            res = self.online.geocode(addr, self.city_info)
            if not res:
                self.say("  I could not find that address on the map; it is kept as typed and `apartmentscout geocode` will "
                         "try again. Adding the city and state helps.")
                return {}
            lat, lon = round(float(res["lat"]), 6), round(float(res["lon"]), 6)
            self.say(f"  Found: {res.get('label') or addr} ({lat}, {lon})")
            if self.boolean({**q, "ask": "Is that the place?", "why": ""}, True):
                return {"lat": lat, "lon": lon}
            addr = self.loop(q, "", lambda s: s)
            if not addr:
                return {}
        return {}

    def transit_feeds(self, q: dict[str, Any], info: Any) -> list[dict[str, Any]]:
        """Which GTFS feeds the commute uses: the city profile's (added by init), a starter feed, or ones the renter pastes."""
        from . import cities as C
        if info is not None and info.profile:
            n = len(C.starter_feeds(info))
            self.say(f"\nTransit: the {info.name} profile brings its {n} timetable feed{'s' if n != 1 else ''}; nothing to add.")
            return []
        feeds: list[dict[str, Any]] = []
        starters = C.starter_feeds(info) if info is not None else []
        if starters:
            self.say("\nTransit: starter timetable feeds for this city (each was fetched and checked when it was added):")
            for f in starters:
                self.say(f"    {f['name']}: {f['url']}")
            if self.boolean({**q, "ask": "Use these?", "why": ""}, True):
                feeds += [dict(f) for f in starters]
        elif info is not None and info.id != "generic":
            self.say("\nTransit: no starter feed is listed for this city. Find your transit agency's GTFS zip at:")
            for label, url in C.search_links(info):
                self.say(f"    {label}" + (f": {url}" if url else ""))
        item = {f["id"]: f for f in q["item"]}
        while len(feeds) < 6:
            again = bool(feeds)
            url = self.loop({**q, "ask": "Another feed? Paste its address, or press Enter to continue." if again else q["ask"],
                             "why": "" if again else q.get("why", "")}, "skip", lambda s: s.strip())
            if url in ("", "skip", "-"):
                break
            chk = self.online.check_feed(url) if self.online else None
            if chk is not None and not chk.ok:
                self.say(f"  {chk.detail}. Check the address and try again, or press Enter to skip.")
                continue
            if chk is not None:
                self.say(f"  {chk.detail}" + (f", {chk.size_mb} MB" if chk.size_mb else ""))
            default_name = C.feed_entry(url)["name"]
            name = self.loop(item["name"], default_name, lambda s, d=default_name: s or d)
            feeds.append(C.feed_entry(url, name))
        if not feeds:
            self.say("  No transit feed: commute times will be walking only until you add one "
                     "(`apartmentscout city --feed URL`, or `--starter` where one is listed).")
        return feeds

    @staticmethod
    def _time(s: str, default: str) -> str:
        if not s:
            return default
        if not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", s):
            raise ValueError("use a 24-hour time like 09:00")
        return s if len(s) == 5 else "0" + s

    def weights(self, q: dict[str, Any], dims: list[str]) -> dict[str, float]:
        def parse(s: str) -> dict[str, float]:
            if not s or s in ("-", "skip"):
                return {}
            out = {}
            for k, v in _pairs(s):
                if k not in dims:
                    raise ValueError(f"unknown dimension {k!r}; choose from {', '.join(dims)}")
                n = float(v)
                if n < 0:
                    raise ValueError("weights cannot be negative")
                out[k] = n
            if not out:
                raise ValueError("format: commute=30, cost=10")
            return out
        return self.loop(q, "keep", parse, "Dimensions: " + ", ".join(dims))

    # -- the whole interview
    def run(self) -> dict[str, Any]:
        """Ask every step in order and return a criteria mapping."""
        say, I = self.say, self.intake
        say("ApartmentScout intake. Press Enter to accept the value in brackets; nothing is final until the end.")
        cities = sorted(set(known_cities()))
        c: dict[str, Any] = {}
        qs = {s["id"]: {q["id"]: q for q in s["questions"]} for s in I["steps"]}
        titles = {s["id"]: s for s in I["steps"]}

        def head(i: str) -> None:
            say(f"\n== {titles[i]['title']}: {titles[i]['blurb']}")

        head("basics")
        b = qs["basics"]
        search: dict[str, Any] = {"name": self.text(b["name"], b["name"]["default"])}
        info = self.city_info = self.preset(self.preset_city) if self.preset_city else self.city(b["city"], [c for c in cities if c != "generic"])
        search["city"] = info.id
        if info.id != "generic" and not info.profile:
            search["city_name"] = info.name
        search["timezone"] = self.timezone(b["timezone"], info)
        mi = {"earliest": self.date(b["move_in_earliest"], b["move_in_earliest"]["default"]),
              "latest": self.date(b["move_in_latest"], b["move_in_latest"]["default"])}
        if mi["earliest"] and mi["latest"] and mi["latest"] < mi["earliest"]:
            say("  Latest was before earliest; using the earliest for both.")
            mi["latest"] = mi["earliest"]
        if self.boolean(b["move_in_hard"], False):
            mi["hard"] = True
        search["move_in"] = {k: (v.isoformat() if isinstance(v, dt.date) else v) for k, v in mi.items() if v is not None}
        if (mc := self.latlon(b["map_center"], info.center)):
            search["map_center"] = mc
        c["search"] = search

        head("places")
        c["commute"] = {"destinations": self.destinations(qs["places"]["destinations"])}
        feeds = self.transit_feeds(qs["places"]["transit_feeds"], info)
        if feeds:
            c["commute"]["transit"] = {"feeds": feeds}

        head("money")
        m = qs["money"]
        basis = self.choice(m["budget_basis"], "monthly_cost", m["budget_basis"]["choices"])
        tiers = self.tiers(m["budget_tiers"], m["budget_tiers"]["default"])
        hm = self.number({**m["hard_max"], "min": tiers[-1]["max"]}, max(m["hard_max"]["default"], tiers[-1]["max"]))
        c["budget"] = {"basis": basis, "tiers": tiers, "hard_max": int(hm) if float(hm).is_integer() else hm}

        head("home")
        h = qs["home"]
        beds = self.number(h["min_beds"], h["min_beds"]["default"], integer=True)
        while True:
            fl = self.number(h["sqft_floor"], h["sqft_floor"]["default"], integer=True)
            gd = self.number(h["sqft_good"], max(h["sqft_good"]["default"], fl + 1), integer=True)
            gr = self.number(h["sqft_great"], max(h["sqft_great"]["default"], gd + 1), integer=True)
            if fl < gd < gr:
                break
            say("  Sizes must rise: floor < good < great. Let us try those three again.")
        c["unit"] = {"min_beds": beds, "sqft_floor": fl, "sqft_good": gd, "sqft_great": gr}

        head("amenities")
        say("Amenity keys: " + ", ".join(f"{k} ({v})" for k, v in self.amen.items()))
        a = qs["amenities"]
        taken: set[str] = set()
        for key in ("must_have", "strongly_prefer", "nice_to_have"):
            c[key] = self.amenity_list(a[key], a[key]["default"], taken)
            taken |= set(c[key])

        head("taste")
        t = qs["taste"]
        levels = {qid: self.level(q, titles["taste"]["levels"]) for qid, q in t.items() if q["type"] == "level"}
        ratings = self.ratings(t["building_ratings"])
        if ratings:
            c["building_ratings"] = ratings

        head("weights")
        w = qs["weights"]
        preset = self.choice(w["preset"], "balanced", w["preset"]["choices"])
        dims = list(DIMENSION_LABELS)
        taste = taste_weights(levels, I, dims)
        over = self.weights(w["weights"], dims)
        base = resolve_weights(preset, {}, None, dims)
        final = resolve_weights(preset, taste, over, dims)
        c["scoring"] = {"preset": preset}
        diff = {k: v for k, v in final.items() if v != base.get(k)}
        if diff:
            c["weights"] = diff
        if taste or over:
            say("\nWeights now: " + ", ".join(f"{k} {v:g}" for k, v in final.items() if v))
        return c


def interview(ask: Callable[[str], str] = input, say: Callable[[str], None] = print, today: dt.date | None = None,
              online: Online | None = None, city: Any = None) -> dict[str, Any]:
    return Interview(ask, say, today, online=online, city=city).run()


def next_steps(search: str, intake: dict[str, Any] | None = None) -> list[dict[str, str]]:
    """The questionnaire's `after` list with {search} filled in: id, title, command and why for each step."""
    return [{k: " ".join(str(v).split()).replace("{search}", search) for k, v in a.items()}
            for a in (intake or load_intake()).get("after") or []]
