"""Finding and describing the city a search is in. [onboarding]

A new renter in Boston, Chicago or Lisbon has no city profile in ``config/cities/``. This module turns what they type
("Chicago, IL") into the handful of facts every module needs (a city id, a display name, where the map opens, the IANA
time zone), offers starter transit feeds from ``config/transit-feeds.yaml`` and the places to look for others, and checks
that a feed URL really is a GTFS zip. Nothing here needs an API key. Network calls go through small injectable
functions so tests and offline runs never reach the internet.

``resolve_city`` tries, in order: a profile in ``config/cities`` (by id, name or alias; no network), then OpenStreetMap
Nominatim. ``tz_for`` picks the nearest entry of ``config/city-timezones.csv``.
"""
from __future__ import annotations

import csv
import math
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import requests
import yaml

REPO = Path(__file__).resolve().parent.parent
CITIES_DIR = REPO / "config" / "cities"
FEEDS_PATH = REPO / "config" / "transit-feeds.yaml"
TZ_PATH = REPO / "config" / "city-timezones.csv"
UA = {"User-Agent": "ApartmentScout/0.1 (apartment research toolkit; city lookup)"}
NOMINATIM = "https://nominatim.openstreetmap.org/search"
TZ_MAX_KM = 350.0   # a reference city farther than this away says nothing about the zone

# where to look for a transit agency's GTFS feed; {q} is the city name
SEARCH_LINKS = (
    ("Mobility Database (the open catalogue of GTFS feeds)", "https://mobilitydatabase.org/feeds"),
    ("Transitland (operators and feeds on a map)", "https://www.transit.land/operators"),
    ("Your transit agency's own site: search for \"{q} transit GTFS\" or \"{q} developers\"", ""),
)

Fetch = Callable[[str, dict[str, Any]], Any]   # (url, params) -> parsed JSON


@dataclass(frozen=True)
class CityInfo:
    id: str                       # lowercase slug, the value of search.city
    name: str                     # display name, for example "Chicago, Illinois"
    lat: float | None
    lon: float | None
    timezone: str | None
    country: str | None = None    # ISO 3166 alpha-2, lowercase
    state: str | None = None
    bbox: tuple[float, float, float, float] | None = None   # west, south, east, north
    osm: str | None = None        # "relation/122604"
    profile: bool = False         # config/cities/<id>.yaml exists: the city has open-data modules
    source: str = "typed"         # profile | nominatim | typed
    zoom: float = 12.5

    @property
    def center(self) -> list[float] | None:
        return [round(self.lat, 5), round(self.lon, 5)] if self.lat is not None and self.lon is not None else None


# --------------------------------------------------------------------------- names
def slugify_city(text: str) -> str:
    """'São Paulo, Brazil' -> 'sao-paulo'. Only the part before the first comma is used."""
    head = unicodedata.normalize("NFKD", str(text).split(",")[0]).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", head.lower()).strip("-")[:40].strip("-")


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()).strip()


# --------------------------------------------------------------------------- profiles
def profile_ids() -> list[str]:
    return sorted(p.stem for p in CITIES_DIR.glob("*.yaml"))


def load_profile(city_id: str | None) -> dict[str, Any]:
    p = CITIES_DIR / f"{city_id}.yaml"
    if not city_id or not re.fullmatch(r"[a-z0-9_-]+", city_id) or not p.exists():
        return {}
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def match_profile(query: str) -> str | None:
    """The profile id a typed name refers to: its id, its name, or one of its `aliases`."""
    q = _norm(query)
    if not q:
        return None
    for cid in profile_ids():
        prof = load_profile(cid)
        names = {_norm(cid), _norm(prof.get("name") or ""), *(_norm(a) for a in prof.get("aliases") or [])}
        if q in names or _norm(query.split(",")[0]) in names:
            return cid
    return None


def from_profile(city_id: str) -> CityInfo:
    prof = load_profile(city_id)
    c = prof.get("center")
    return CityInfo(id=city_id, name=prof.get("name") or city_id, lat=c[0] if c else None, lon=c[1] if c else None,
                    timezone=prof.get("timezone"), country=prof.get("country"), profile=True, source="profile",
                    zoom=float(prof.get("zoom") or 12.5))


# --------------------------------------------------------------------------- time zone from a place
def _tz_rows() -> list[tuple[str, float, float, str]]:
    with TZ_PATH.open(encoding="utf-8", newline="") as f:
        return [(r["city"], float(r["lat"]), float(r["lon"]), r["timezone"]) for r in csv.DictReader(f)]


def _km(a: float, b: float, c: float, d: float) -> float:
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def tz_for(lat: float, lon: float) -> str | None:
    """IANA zone of the nearest reference city within TZ_MAX_KM, else None. A best guess to confirm, not a boundary lookup."""
    best = min(((_km(lat, lon, la, lo), tz) for _, la, lo, tz in _tz_rows()), default=None)
    return best[1] if best and best[0] <= TZ_MAX_KM else None


def valid_timezone(name: str) -> bool:
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(str(name))
        return True
    except Exception:  # noqa: BLE001 - any failure to resolve the zone means it is not usable
        return False


# --------------------------------------------------------------------------- Nominatim
def _http_json(url: str, params: dict[str, Any]) -> Any:
    r = requests.get(url, params=params, headers=UA, timeout=20)
    r.raise_for_status()
    return r.json()


def lookup(query: str, fetch: Fetch | None = None) -> CityInfo | None:
    """Look a place name up on OpenStreetMap Nominatim; None when nothing matches or the network is unavailable."""
    q = query.strip()
    if not q:
        return None
    try:
        rows = (fetch or _http_json)(NOMINATIM, {"q": q, "format": "jsonv2", "limit": 5, "addressdetails": 1, "accept-language": "en"})
    except (requests.RequestException, ValueError):
        return None
    rows = [r for r in rows or [] if isinstance(r, dict) and "lat" in r and "lon" in r]
    if not rows:
        return None
    pick = next((r for r in rows if r.get("category") in ("place", "boundary") and r.get("addresstype", r.get("type")) in
                 ("city", "town", "village", "municipality", "borough", "suburb", "administrative", "county", "state_district")), rows[0])
    a = pick.get("address") or {}
    name = pick.get("name") or a.get("city") or a.get("town") or a.get("village") or q.split(",")[0].strip()
    region = a.get("state") or a.get("region")
    country = (a.get("country_code") or "").lower() or None
    shown = f"{name}, {region}" if region and country in ("us", "ca", "au") else f"{name}, {a.get('country')}" if a.get("country") else name
    bb = pick.get("boundingbox")
    bbox = (float(bb[2]), float(bb[0]), float(bb[3]), float(bb[1])) if isinstance(bb, list) and len(bb) == 4 else None
    lat, lon = float(pick["lat"]), float(pick["lon"])
    osm = f"{pick['osm_type']}/{pick['osm_id']}" if pick.get("osm_type") and pick.get("osm_id") else None
    return CityInfo(id=slugify_city(name) or "city", name=shown, lat=lat, lon=lon, timezone=tz_for(lat, lon), country=country,
                    state=region, bbox=bbox, osm=osm, source="nominatim")


def resolve_city(query: str, fetch: Fetch | None = None) -> CityInfo | None:
    """A profile city from its name (no network), else an OpenStreetMap lookup. None when neither knows the place."""
    cid = match_profile(query)
    if cid:
        info = from_profile(cid)
        if info.lat is None:   # a profile without a map centre: take it from the lookup
            found = lookup(info.name, fetch)
            if found:
                info = replace(info, lat=found.lat, lon=found.lon, bbox=found.bbox, osm=found.osm,
                               timezone=info.timezone or found.timezone)
        return info
    return lookup(query, fetch)


def typed_city(name: str, timezone: str | None = None) -> CityInfo:
    """A city the renter typed that could not be looked up: id and name from the text, nothing else known."""
    return CityInfo(id=slugify_city(name) or "city", name=name.strip(), lat=None, lon=None, timezone=timezone, source="typed")


# --------------------------------------------------------------------------- transit feeds
def starter_feeds(info: CityInfo) -> list[dict[str, str]]:
    """Feeds listed in config/transit-feeds.yaml for this city (empty for a profile city: its profile has them)."""
    if info.profile:
        return [dict(f) for f in load_profile(info.id).get("transit_feeds") or []]
    data = (yaml.safe_load(FEEDS_PATH.read_text(encoding="utf-8")) or {}).get("cities") or {} if FEEDS_PATH.exists() else {}
    entry = data.get(info.id)
    if isinstance(entry, dict):
        states = [s.lower() for s in entry.get("states") or []]
        if states and (info.state or "").lower() not in states:
            return []
        entry = entry.get("feeds")
    return [dict(f) for f in entry or []]


def search_links(info: CityInfo | str) -> list[tuple[str, str]]:
    """(label, url) pairs for finding a GTFS feed: catalogues, then advice for the agency's own site."""
    name = (info if isinstance(info, str) else info.name).split(",")[0]
    return [(label.format(q=name), url) for label, url in SEARCH_LINKS]


@dataclass(frozen=True)
class FeedCheck:
    ok: bool
    detail: str
    size_mb: float | None = None
    checked: bool = True


def check_feed(url: str, get: Callable[..., Any] | None = None) -> FeedCheck:
    """Is this URL a zip file? Reads the first bytes only. `checked=False` means we could not reach it (offline), which is
    not the same as it being wrong."""
    u = str(url).strip()
    if not re.match(r"https?://", u, re.I):
        p = Path(u).expanduser()
        if p.is_file():
            with p.open("rb") as fh:
                zipped = fh.read(2) == b"PK"
            return FeedCheck(zipped, "a local file" if zipped else "that file is not a zip", round(p.stat().st_size / 1e6, 1))
        return FeedCheck(False, "not a web address (https://...) and not a file on this computer")
    try:
        r = (get or requests.get)(u, stream=True, timeout=30, headers=UA)
        try:
            head = next(r.iter_content(8), b"")
            size = r.headers.get("content-length")
            status = r.status_code
        finally:
            r.close()
    except requests.RequestException:
        return FeedCheck(True, "could not reach it from here (offline?); kept as typed", None, checked=False)
    if status != 200:
        return FeedCheck(False, f"the server answered {status}")
    if head[:2] != b"PK":
        return FeedCheck(False, "that address is a web page, not a GTFS zip (look for a link ending in .zip)")
    return FeedCheck(True, "a zip file", round(int(size) / 1e6, 1) if size and size.isdigit() else None)


def feed_entry(url: str, name: str | None = None, mode: str | None = None) -> dict[str, str]:
    """A commute.transit.feeds entry from a URL or file path."""
    u = str(url).strip()
    out: dict[str, str] = {"name": (name or "").strip() or _feed_name(u)}
    out["url" if re.match(r"https?://", u, re.I) else "path"] = u if re.match(r"https?://", u, re.I) else str(Path(u).expanduser())
    if mode:
        out["mode"] = mode
    return out


def _feed_name(url: str) -> str:
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    return host.split(".")[0].upper() if host and not url.startswith(("/", "~")) else Path(url).stem


# --------------------------------------------------------------------------- criteria fields
def search_fields(info: CityInfo) -> dict[str, Any]:
    """The `search:` keys a resolved city sets in criteria.yaml. A profile city needs only its id (the profile supplies the
    rest); any other city also gets a display name so the dashboard and agents know what it is."""
    f: dict[str, Any] = {"city": info.id}
    if not info.profile:
        f["city_name"] = info.name
    if info.timezone:
        f["timezone"] = info.timezone
    if info.center:
        f["map_center"] = info.center
    return f


@dataclass
class CityPlan:
    """What a new search in this city will and will not have, in words the renter can act on."""
    info: CityInfo
    have: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


def coverage_notes(info: CityInfo, feeds: list[dict] | None) -> CityPlan:
    """The honest list: what works anywhere, what this city's profile adds, and what is missing for a city without one."""
    plan = CityPlan(info)
    plan.have += ["Geocoding (US Census, then OpenStreetMap)", "Buildings and heights from OpenStreetMap (3D, sun, view)",
                  "Streets and parks for place filters", "Floor plans and the studio"]
    if info.profile:
        plan.have += [f"City open data from the {info.name} profile (records, footprints, noise layer)"]
    else:
        plan.missing += ["City open data: building records, violations, 311/noise and filed new buildings are not built in for this city. "
                         "The building-dossier skill shows where to look, and docs/guides/new-city.md how to add a module.",
                         "Building heights come from OpenStreetMap tags, so buildings without a height or levels tag get a default; "
                         "apartmentscout surroundings tells you how many."]
    if feeds:
        plan.have.append(f"Transit commutes from {len(feeds)} GTFS feed{'s' if len(feeds) != 1 else ''}")
    else:
        plan.missing.append("Transit feeds: commute times are walking only until you add your agency's GTFS zip (apartmentscout city --feed URL).")
    if not info.timezone:
        plan.missing.append("Time zone: not recognised, so sun hours need search.timezone set by hand (for example Europe/Lisbon).")
    return plan
