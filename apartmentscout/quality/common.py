"""Small shared helpers: dates, listing text, hosts and source names, building keys, search area."""
from __future__ import annotations

import datetime as dt
import math
import re
import urllib.parse
from typing import Any, Iterable

INACTIVE = ("gone", "rejected")
DEFAULT_STALE_DAYS = 7

# Hosts we know by name; anything else is shown as its bare host.
SOURCE_NAMES = {
    "streeteasy.com": "StreetEasy", "zillow.com": "Zillow", "apartments.com": "Apartments.com",
    "renthop.com": "RentHop", "corcoran.com": "Corcoran", "cityrealty.com": "CityRealty",
    "leasebreak.com": "Leasebreak", "apartmentlist.com": "Apartment List", "craigslist.org": "Craigslist",
    "compass.com": "Compass", "elliman.com": "Douglas Elliman", "trulia.com": "Trulia",
    "hotpads.com": "HotPads", "rent.com": "Rent.com", "realtor.com": "Realtor.com",
    "nakedapartments.com": "Naked Apartments", "furnishedfinder.com": "Furnished Finder",
}


def parse_date(v: Any) -> dt.date | None:
    """Date from a date/datetime, 'YYYY-MM-DD' or an ISO timestamp. Anything else (``Now``, ``Lease signed``) is None."""
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.match(r"^\s*(\d{4})-(\d{2})-(\d{2})", str(v))
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def iso(d: dt.date | None) -> str | None:
    return d.isoformat() if d else None


def as_of(v: Any = None) -> dt.date:
    return parse_date(v) or dt.date.today()


def crit_today(crit: dict, today: Any = None) -> dt.date:
    """The date to judge freshness against: an explicit date, else criteria ``scoring.as_of``, else today."""
    return parse_date(today) or parse_date((crit.get("scoring") or {}).get("as_of")) or dt.date.today()


def num(v: Any) -> float | None:
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(float(v)) else None
    m = re.search(r"-?\d[\d,]*\.?\d*", str(v))
    return float(m.group(0).replace(",", "")) if m else None


def is_active(L: dict) -> bool:
    return (L.get("status") or "new") not in INACTIVE


def listing_text(L: dict) -> str:
    """The free text an agent captured from the source: notes, features, description. Not resident reviews."""
    parts: list[str] = []
    for k in ("title", "description", "raw_text", "notes", "stage"):
        v = L.get(k)
        if isinstance(v, str):
            parts.append(v)
    feats = L.get("features") or {}
    if isinstance(feats, dict):
        parts += [str(v) for v in feats.values() if isinstance(v, str)]
    return "\n".join(parts)


def host(url: Any) -> str:
    try:
        h = urllib.parse.urlsplit(str(url or "").strip()).hostname or ""
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def source_name(url: Any) -> str | None:
    h = host(url)
    if not h:
        return None
    for dom, name in SOURCE_NAMES.items():
        if h == dom or h.endswith("." + dom):
            return name
    return h


_STREET_WORDS = {"street": "st", "avenue": "ave", "av": "ave", "place": "pl", "road": "rd", "boulevard": "blvd",
                 "drive": "dr", "lane": "ln", "terrace": "ter", "square": "sq", "west": "w", "east": "e",
                 "north": "n", "south": "s", "lex": "lexington", "first": "1", "second": "2", "third": "3",
                 "fourth": "4", "fifth": "5", "sixth": "6", "seventh": "7", "eighth": "8", "ninth": "9", "tenth": "10",
                 "eleventh": "11", "twelfth": "12"}


def norm_address(addr: Any) -> str:
    """'416 West 52nd Street, New York, NY' -> '416 w 52 st'."""
    a = str(addr or "").split(",")[0].lower()
    a = re.sub(r"[^a-z0-9 ]+", " ", a)
    a = re.sub(r"\b(\d+)(st|nd|rd|th)\b", r"\1", a)
    return " ".join(_STREET_WORDS.get(w, w) for w in a.split())


def norm_unit(u: Any) -> str:
    u = re.sub(r"[^a-z0-9]+", "", str(u or "").lower())
    u = re.sub(r"^(apt|unit|no|ste|suite|rm)", "", u)
    return u.lstrip("0") or u


def building_key(L: dict) -> str:
    """Stable key for a building: normalised street address when it has a house number, else the name."""
    a = norm_address(L.get("address"))
    if re.match(r"^\d", a):
        return re.sub(r"\s+", "-", a)
    b = re.sub(r"[^a-z0-9]+", "-", str(L.get("building") or L.get("address") or "").lower()).strip("-")
    return b or "unknown"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = math.pi / 180
    a = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def search_area(crit: dict) -> dict | None:
    """The search area from criteria: ``search.bbox`` [lon0, lat0, lon1, lat1] or ``search.map_center`` with
    ``search.radius_km`` (default 25 km). None when neither is set."""
    s = crit.get("search") or {}
    bb = s.get("bbox")
    if isinstance(bb, (list, tuple)) and len(bb) == 4:
        return {"bbox": [float(x) for x in bb]}
    c = s.get("map_center")
    if isinstance(c, (list, tuple)) and len(c) == 2:
        return {"center": [float(c[0]), float(c[1])], "radius_km": float(s.get("radius_km") or 25)}
    return None


def in_area(lat: float, lon: float, area: dict) -> bool:
    if "bbox" in area:
        lon0, lat0, lon1, lat1 = area["bbox"]
        return lon0 <= lon <= lon1 and lat0 <= lat <= lat1
    clat, clon = area["center"]
    return haversine_km(lat, lon, clat, clon) <= area["radius_km"]


def stale_days(crit: dict) -> int:
    return int((crit.get("quality") or {}).get("stale_days") or DEFAULT_STALE_DAYS)


def move_in(crit: dict) -> tuple[dt.date | None, dt.date | None]:
    m = (crit.get("search") or {}).get("move_in") or {}
    return parse_date(m.get("earliest")), parse_date(m.get("latest"))


def urls_of(L: dict) -> Iterable[tuple[str, str]]:
    """(field, url) for every URL-ish value a listing carries."""
    for k, v in (L.get("links") or {}).items():
        if isinstance(v, str):
            yield f"links.{k}", v
    for i, v in enumerate(L.get("photos") or []):
        if isinstance(v, str):
            yield f"photos[{i}]", v
    for i, v in enumerate(L.get("photos_local") or []):
        if isinstance(v, str):
            yield f"photos_local[{i}]", v
    for i, p in enumerate(L.get("building_photos") or []):
        if isinstance(p, dict):
            for k in ("url", "page"):
                if isinstance(p.get(k), str):
                    yield f"building_photos[{i}].{k}", p[k]
    for i, v in enumerate(L.get("sources") or []):
        if isinstance(v, str):
            yield f"sources[{i}]", v
        elif isinstance(v, dict) and isinstance(v.get("url"), str):
            yield f"sources[{i}].url", v["url"]
