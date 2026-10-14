"""Building photos from Wikimedia Commons, and local copies of listing photos.

Two jobs, both behind ``apartmentscout photos``:

1. **Commons building photos.** For every building (listings grouped by location, so a tower with
   twenty units is looked up once) the MediaWiki API is asked for freely licensed files taken near
   the listing (``geosearch``) and for nearby files that mention the house number or the building's
   name (CirrusSearch ``nearcoord:``). Each candidate is kept only when its title, description or
   categories tie it to *this* building (house number on the right street, or the building's name)
   or, failing that, to *this* street within ``radius`` metres. Maps, logos, interiors, people,
   vehicles, signs, small images and photos that name a different address are dropped: no photo is
   better than a wrong one. Results land in ``listing["building_photos"]`` with author, licence and
   a link back to the file page, ready for a credit line.

2. **Local copies** (private searches only). Listing photos are usually hot-linked portal images
   that die when the listing goes. ``cache_media`` saves them, and the Commons thumbnails, under
   ``<search>/media/<listing-id>/`` and records ``photos_local`` so the dashboard can fall back to
   them. Listing photos are copyrighted by their owners: they stay in the git-ignored search folder
   and are never committed or published.

Every API response is cached under ``<search>/cache/photos/``; reruns are free.
"""
from __future__ import annotations

import hashlib
import html
import json
import logging
import mimetypes
import os
import re
import shutil
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

import requests

from .geo import haversine_m

log = logging.getLogger(__name__)

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "ApartmentScout/0.1 (open-source apartment research)"
SOURCE = "Wikimedia Commons"
SCOPES = ("exact-unit", "same-line", "building", "street", "aerial")
THUMB_WIDTH = 800  # Wikimedia rounds this up to its nearest standard step (960 px today)
MIN_WIDTH, MIN_HEIGHT = 600, 400
MAX_BYTES = 5 * 1024 * 1024
NAME_RADIUS_M = 400  # a named building can be photographed from across an avenue
NUMBER_RADIUS_M = 250
WEAK_EVIDENCE_SINCE = 2012  # category- or description-only matches older than this are dropped
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/tiff", "image/gif"}
EXT_METADATA = "ImageDescription|ObjectName|Artist|Credit|LicenseShortName|LicenseUrl|Categories|UsageTerms"


def user_agent() -> str:
    """Wikimedia asks API clients for a way to reach the operator: set APARTMENTSCOUT_CONTACT
    (an email or URL) and it is added to the User-Agent."""
    contact = os.environ.get("APARTMENTSCOUT_CONTACT", "").strip()
    return USER_AGENT[:-1] + f"; {contact})" if contact else USER_AGENT


# --------------------------------------------------------------------------- address matching
_ORD = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth", 7: "seventh",
        8: "eighth", 9: "ninth", 10: "tenth", 11: "eleventh", 12: "twelfth"}
_WORD_NUM = {v: k for k, v in _ORD.items()} | {"one": 1, "two": 2, "three": 3}
_TYPES = {
    "street": r"(?:street|str|st)\b\.?", "st": r"(?:street|str|st)\b\.?",
    "avenue": r"(?:avenue|ave|av)\b\.?", "ave": r"(?:avenue|ave|av)\b\.?", "av": r"(?:avenue|ave|av)\b\.?",
    "place": r"(?:place|pl)\b\.?", "pl": r"(?:place|pl)\b\.?",
    "lane": r"(?:lane|ln)\b\.?", "ln": r"(?:lane|ln)\b\.?",
    "square": r"(?:square|sq)\b\.?", "sq": r"(?:square|sq)\b\.?",
    "boulevard": r"(?:boulevard|blvd)\b\.?", "blvd": r"(?:boulevard|blvd)\b\.?",
    "road": r"(?:road|rd)\b\.?", "rd": r"(?:road|rd)\b\.?",
    "drive": r"(?:drive|dr)\b\.?", "dr": r"(?:drive|dr)\b\.?",
    "terrace": r"(?:terrace|ter)\b\.?", "plaza": r"(?:plaza)\b",
}
_DIRS = {"west": "w", "w": "w", "east": "e", "e": "e", "north": "n", "n": "n", "south": "s", "s": "s"}
_OPPOSITE = {"w": "e", "e": "w", "n": "s", "s": "n"}


@dataclass(frozen=True)
class Address:
    """A parsed street address: house numbers plus a regex that finds the street in free text.

    ``street_re`` may capture a compass word in group ``dir``; a match whose compass word is the
    opposite of ``direction`` ("East 52nd" for a West 52nd address) does not count."""

    numbers: tuple[str, ...]
    street: str                    # human label, e.g. "W 52 St"
    street_re: str                 # case-insensitive regex for the street in any common spelling
    direction: str | None = None   # "w", "e", "n" or "s" for numbered streets

    def _ok(self, m: re.Match) -> bool:
        d = m.groupdict().get("dir")
        return not (d and self.direction and _DIRS.get(d.lower()) == _OPPOSITE[self.direction])

    def street_in(self, text: str) -> bool:
        return any(self._ok(m) for m in re.finditer(self.street_re, text, re.I))

    def number_on_street(self, text: str) -> str | None:
        """The house number (or range) written right before this street in ``text``, if any."""
        rx = r"(?<![\d/.,:])(?P<num>\d{1,5}[a-z]?(?:[-\u2013]\d{1,5})?)\s*,?\s*" + self.street_re
        for m in re.finditer(rx, text, re.I):
            if self._ok(m):
                return m.group("num")
        return None

    def matches_number(self, found: str) -> bool:
        """True when ``found`` ("416", "414-418", "416A") overlaps this address's number or range."""
        lo, _, hi = re.sub(r"\s", "", found).replace("\u2013", "-").partition("-")
        lo = re.sub(r"[a-z]$", "", lo, flags=re.I)
        ours = [int(n) for n in self.numbers if n.isdigit()]
        try:
            a, b = int(lo), int(hi) if hi else int(lo)
        except ValueError:
            return False
        if not ours:
            return False
        return max(a, min(ours)) <= min(max(a, b), max(ours))


def _ordinal_re(n: int) -> str:
    word = _ORD.get(n)
    alt = rf"(?<!\d){n}(?:st|nd|rd|th|d)?\b"
    return rf"(?:{alt}|{word})" if word else alt


def parse_address(text: str | None) -> Address | None:
    """Parse '416 West 52nd Street', '626 1 Ave', '445W35', '222 B'Way', '82-86 Washington Place'."""
    if not text:
        return None
    t = re.sub(r"\(.*?\)", "", text.split(",")[0]).strip()
    m = re.match(r"^(\d{1,5})\s*([EW])\s*(\d{1,3})$", t, re.I)  # 445W35
    if m:
        t = f"{m.group(1)} {'West' if m.group(2).upper() == 'W' else 'East'} {m.group(3)} Street"
    m = re.match(r"^(\d{1,5})(?:\s*[-\u2013]\s*(\d{1,5}))?\s+(.+)$", t)
    if not m:
        return None
    numbers = tuple(n for n in (m.group(1), m.group(2)) if n)
    words = [w for w in re.split(r"\s+", m.group(3).replace(".", "").strip()) if w]
    if not words:
        return None
    low = [w.lower() for w in words]
    if low in (["b'way"], ["bway"], ["broadway"]):
        return Address(numbers, "Broadway", r"\b(?:broadway|b'way)\b")
    if " ".join(low) in ("central park west", "cpw"):
        return Address(numbers, "Central Park West", r"\b(?:central park west|cpw)\b")
    direction = None
    if len(low) >= 2 and low[0] in _DIRS and re.match(r"^\d", low[1]):
        direction, low, words = _DIRS[low[0]], low[1:], words[1:]
    kind = low[-1] if len(low) > 1 and low[-1] in _TYPES else None
    core = low[:-1] if kind else low
    num = None
    if len(core) == 1:
        m2 = re.match(r"^(\d{1,3})(?:st|nd|rd|th|d)?$", core[0])
        num = int(m2.group(1)) if m2 else _WORD_NUM.get(core[0])
    if num is not None:
        is_street = kind in (None, "street", "st")
        type_re = _TYPES["street" if is_street else kind]
        pre = r"(?:\b(?P<dir>east|west|north|south|e|w|n|s)(?:\b\.?\s*|(?=\d)))?"
        street_re = pre + _ordinal_re(num) + r"\s*" + type_re
        if num == 6 and not is_street:
            street_re = rf"(?:{street_re}|avenue of the americas)"
        label = f"{(direction or '').upper()} {num} {'St' if is_street else 'Ave'}".strip()
        return Address(numbers, label, street_re, direction if is_street else None)
    type_re = _TYPES.get(kind or "")
    name = r"\s+".join(re.escape(w) for w in core)
    street_re = rf"\b{name}\s+{type_re}" if type_re else rf"\b{name}\b"
    return Address(numbers, " ".join(words), street_re)


# --------------------------------------------------------------------------- building names
_NAME_NOISE = {"the", "condominium", "condo", "condop", "apartments", "apartment", "residences", "residence",
               "rentals", "building", "buildings", "tower", "towers", "house", "lofts", "at", "of", "and", "&"}
_NAME_TAIL = {"condominium", "condo", "condop", "apartments", "residences", "rentals"}
_NAME_GENERIC = {"east", "west", "north", "south", "street", "avenue", "park", "place", "square", "plaza",
                 "court", "gardens", "manhattan", "new", "york", "city", "nyc", "owner", "exact", "december",
                 "via", "one", "two", "three", "club", "select", "high", "line", "end"}
_MGMT = re.compile(r"\b(udr|equity residential|stellar management|windsor|essex crossing|alvaro siza condo|"
                   r"condo|condop)\b", re.I)


@dataclass(frozen=True)
class NamePattern:
    regex: str        # case-insensitive pattern for the name
    free_text: bool   # may match titles and descriptions, not only categories
    phrase: str       # plain text for the API search


def name_patterns(name: str | None) -> list[NamePattern]:
    """Regexes for a building's name, each with a flag: True = a name specific enough to match free
    text ("Gotham West", "VIA 57 West"); False = a one-word name ("The Cole", "Atlas") that may only
    match a Commons category, because the bare word turns up in far too many unrelated captions."""
    if not name:
        return []
    alts = [name] + re.findall(r"\(([^)]*)\)", name)
    out: list[NamePattern] = []
    for a in alts:
        a = re.sub(r"\(.*?\)", "", a).strip()
        if not a or _MGMT.fullmatch(a) or re.match(r"^\d", a):
            continue  # addresses are matched as addresses
        words = re.findall(r"[A-Za-z0-9'&\u00C0-\u017F-]+", a)
        while words and words[-1].lower() in _NAME_TAIL:
            words = words[:-1]
        core = words[1:] if words and words[0].lower() == "the" else words
        meaningful = [w for w in core if w.lower() not in _NAME_NOISE]
        distinct = [w for w in meaningful if w.lower() not in _NAME_GENERIC and not re.search(r"\d", w)]
        if len(core) >= 2 and (distinct or len(core) >= 3) and len("".join(core)) >= 6:
            out.append(NamePattern(r"\b" + r"[\s_-]+".join(re.escape(w) for w in core) + r"\b", True, " ".join(core)))
        elif len(distinct) == 1 and len(distinct[0]) >= 4:
            out.append(NamePattern(r"\b" + r"[\s_-]+".join(re.escape(w) for w in words) + r"\b", False, distinct[0]))
    return out


# --------------------------------------------------------------------------- candidate filtering
_EXCLUDE = re.compile(
    r"\b(maps?|logos?|diagrams?|plans?|floor ?plans?|seals?|flags?|coat of arms|documents?|letters?|posters?|"
    r"menus?|interiors?|lobby|lobbies|foods?|dishes|meals?|portraits?|people|persons?|men|women|crowds?|"
    r"selfies?|screenshots?|signs?|signage|vehicles?|cars?|trucks?|taxis?|taxicabs?|buses|bus|bicycles?|"
    r"bikes?|citi ?bikes?|scooters?|motorcycles?|dogs?|cats?|birds?|pigeons?|squirrels?|animals?|graffiti|"
    r"murals?|street art|stickers?|protests?|parades?|demonstrations?|rally|rallies|festivals?|concerts?|"
    r"performances?|hydrants?|manholes?|trash|garbage|sculptures?|statues?|plaques?|flowers?|wiki\w*|"
    r"meetups?|edit-a-thon|salon|events?|weddings?|fashion|actors?|actresses|musicians?|politicians?|"
    r"police|fire trucks?|ambulances?|subway cars?|trains?|platforms?|stations?|tunnels?|"
    r"paintings?|drawings?|illustrations?|engravings?|prints?|postcards?|newspapers?|books?|"
    r"aerial|satellite|panorama of new york|skyline from|night sky|fireworks|"
    r"view ?from (?:the )?(?:roof|top|terrace|balcony|apartment|window|floor|fl)|viewfrom\w*|fl\d+|"
    r"rope access|workers?|window washers?|"
    r"from (?:the )?\d+(?:st|nd|rd|th)? floor|"
    r"children|kids|band|guitars?|halloween|christmas|thanksgiving|marathon|closed sign|for rent sign|"
    r"under construction|construction site|demolition)\b", re.I)
# a photo whose categories say it shows a specific other kind of place is about that place
_OTHER_PLACE = re.compile(r"^(?:churches|schools|theatres|theaters|restaurants|bars|cafés|cafes|coffee shops|"
                          r"shops|stores|hotels|museums|hospitals|garages|parking|gas stations|delis|"
                          r"bakeries|pharmacies|banks|post offices|playgrounds|community gardens)\b", re.I)


_STREET_WORDS = set("""
looking look looks view views seen from along across toward towards at on in of and the a an to between
corner intersection north south east west northeast northwest southeast southwest northbound southbound
eastbound westbound up down street streets st str avenue avenues ave av sq square block blocks
night day morning evening afternoon sunset sunrise dusk dawn winter summer spring fall autumn snow snowy
rain rainy sunny cloudy by jeh td vc panoramio nyc ny new york manhattan city us usa lower upper midtown
downtown uptown january february march april may june july august september october november december jan feb
mar apr jun jul aug sep sept oct nov dec with near past e w n s
broadway lexington madison park columbus amsterdam lenox bowery york americas riverside first second third
fourth fifth sixth seventh eighth ninth tenth eleventh twelfth
""".split())
# neighbourhood names: never a building's name, and fine in a street photo's title
NEIGHBORHOODS = (
    "murray hill", "hell's kitchen", "clinton", "chelsea", "gramercy", "gramercy park", "kips bay", "tribeca",
    "soho", "noho", "nolita", "lower east side", "east village", "west village", "greenwich village",
    "battery park city", "financial district", "fidi", "midtown east", "midtown west", "upper east side",
    "upper west side", "yorkville", "harlem", "east harlem", "hudson yards", "lincoln square", "carnegie hill",
    "sutton place", "turtle bay", "roosevelt island", "lenox hill", "flatiron", "nomad", "koreatown",
    "garment district", "theater district", "times square", "union square", "stuyvesant town", "chinatown",
    "little italy", "two bridges", "seaport", "south street seaport", "manhattan valley", "morningside heights",
    "hamilton heights", "washington heights", "inwood", "sugar hill", "manhattanville", "lincoln center",
    "columbus circle", "alphabet city", "hudson square", "meatpacking district", "west chelsea", "nolita",
)


def _strip_html(s: str | None) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def _meta(info: dict, key: str) -> str:
    v = (info.get("extmetadata") or {}).get(key) or {}
    return str(v.get("value") or "")


@dataclass(frozen=True)
class Target:
    """One building to look up: where it is and every way it might be written."""

    key: str
    lat: float
    lon: float
    addresses: tuple[Address, ...]
    names: tuple[NamePattern, ...]
    label: str
    place_words: frozenset[str] = frozenset()   # neighbourhood words allowed in a street photo's title


def targets_for(listings: Iterable[dict]) -> dict[str, Target]:
    """Group listings into buildings by location (about 10 m), gathering every address and name.

    A point shared by many different addresses is a geocoder fallback rather than a building, and is
    skipped: photos found there would be of somewhere else."""
    listings = list(listings)
    places = {n.lower() for n in NEIGHBORHOODS} | {str(L["neighborhood"]).strip().lower()
                                                     for L in listings if L.get("neighborhood")}
    place_words = frozenset(w for n in places for w in re.findall(r"[a-z][a-z']*", n))
    groups: dict[str, list[dict]] = {}
    for L in listings:
        if L.get("lat") is None or L.get("lon") is None:
            continue
        groups.setdefault(group_key(L), []).append(L)
    out = {}
    for k, Ls in groups.items():
        addrs: dict[str, Address] = {}
        names: dict[str, NamePattern] = {}
        for L in Ls:
            for src in (L.get("address"), L.get("building")):
                a = parse_address(src)
                if a:
                    addrs.setdefault(a.street_re + "|" + ",".join(a.numbers), a)
            for p in name_patterns(L.get("building")):
                if p.phrase.lower() in places:  # "The Murray Hill" is named after its neighbourhood
                    p = NamePattern(p.regex, False, p.phrase)
                names.setdefault(p.regex, p)
        streets = {(a.street_re, a.numbers) for a in addrs.values()}
        if len(streets) > 2 or len(names) > 3:
            # many different buildings share one point: a fallback geocode (city centre), not a building
            continue
        lat = sum(float(L["lat"]) for L in Ls) / len(Ls)
        lon = sum(float(L["lon"]) for L in Ls) / len(Ls)
        out[k] = Target(k, lat, lon, tuple(addrs.values()), tuple(names.values()),
                        Ls[0].get("building") or Ls[0].get("address") or k, place_words)
    return out


def group_key(L: dict) -> str:
    return f"{round(float(L['lat']), 4):.4f},{round(float(L['lon']), 4):.4f}"


_ADDRESS = re.compile(
    r"(?<![\d/.,:#])\d{1,5}[a-z]?(?:[-\u2013]\d{1,5})?\s+"
    r"(?:(?:(?:east|west|north|south|[ewns])\.?\s*)?"
    r"(?:\d{1,3}(?:st|nd|rd|th|d)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|"
    r"twelfth|[a-z]+(?:\s+[a-z]+){0,2})\s*"
    r"(?:street|st|avenue|ave|av|place|pl|lane|ln|square|sq|boulevard|blvd|road|rd|drive|dr|terrace|plaza)\b"
    r"|broadway|avenue of the americas|central park west|park row|bowery)", re.I)
# a title or category that names some other thing as the subject ("Empire State Building from 34th St")
_SUBJECT = re.compile(
    r"\b(building|tower|center|centre|hall|church|cathedral|chapel|synagogue|temple|mosque|school|college|"
    r"university|hotel|theat(?:er|re)|cinema|museum|library|station|firehouse|engine|ladder|fdny|nypd|precinct|"
    r"hospital|clinic|bank|store|shop|market|garage|bar|pub|restaurant|caf[eé]|deli|diner|bakery|pharmacy|"
    r"brewery|brewing|company|subway|entrance|playground|park|pk|bridge|pier|ferry|p\.?s\.? ?\d+|"
    r"[im]\.?s\.? ?\d+)\b", re.I)
_SUBJECT_CAT = re.compile(r"^[A-Z0-9][^|]*\s(Building|Tower|Center|Hall|Church|School|Hotel|Theater|Theatre|"
                          r"House|Station|Apartments|Condominium)(?:\s*\(.*\))?$")


def find_addresses(text: str) -> list[str]:
    """Street addresses written in free text, in order ("989 6th Avenue", "330 E 38th St")."""
    return [m.group(0) for m in _ADDRESS.finditer(text or "")]


def _name_in(rx: str, text: str, flags: int = 0) -> bool:
    """The name occurs in ``text`` and is not part of a sibling's name ("One Waterline Square" is not
    "Waterline Square" building two)."""
    for m in re.finditer(rx, text, flags):
        before = text[max(0, m.start() - 12):m.start()].lower()
        if not re.search(r"\b(one|two|three|four|five|six|\d{1,3})\s+$", before):
            return True
    return False


def _subject_of(rx: str, desc: str) -> bool:
    """The name opens the description, as its subject: not "X, seen from near <name>"."""
    m = re.search(rx, desc[:80])
    if not m or not _name_in(rx, desc[:80]):
        return False
    return not re.search(r"\b(from|near|behind|beside|next to|across|toward|towards|of|over)\s+(the\s+)?$",
                         desc[max(0, m.start() - 20):m.start()], re.I)


def match_scope(title: str, desc: str, cats: list[str], target: Target, dist: float,
                radius: float, year: int | None = None) -> tuple[str | None, int]:
    """Decide whether a file shows this building ("building"), just its street ("street") or neither.

    Returns the scope and a rank (lower is better). Rules, strictest evidence first:
    the building's name in the title or as a Commons category; this house number on this street in the
    title; this address as the first address the description gives (so "The X Building at 666 First
    Avenue... behind it, part of 415 E 37th" does not count); the name in the description. A street
    photo must be within ``radius``, name this street in its title, and neither name another address
    nor have another building, shop, park, school or station as its subject."""
    def ours(addr: str) -> bool:
        for a in target.addresses:
            n = a.number_on_street(addr) if a.numbers else None
            if n and a.matches_number(n):
                return True
        return False

    t_addrs, d_addrs = find_addresses(title), find_addresses(desc)
    t_ours = ours(title) or any(ours(x) for x in t_addrs)
    t_other = any(not ours(x) for x in t_addrs)
    d_first_ours = bool(d_addrs) and ours(d_addrs[0])
    d_other = any(not ours(x) for x in d_addrs)
    near_name = dist <= NAME_RADIUS_M
    name_title = near_name and any(n.free_text and _name_in(n.regex, title, re.I) for n in target.names)
    # a category alone is weaker: it also tags skyline shots taken from far away
    name_cat = dist <= NUMBER_RADIUS_M and any(re.fullmatch(n.regex + r"(?:\s*\(.*\))?", c, re.I)
                                               for n in target.names for c in cats)
    # a one-word name in the title is not evidence on its own, but with a category it ranks the file higher
    word_title = any(_name_in(n.regex, title, re.I) for n in target.names)
    name_desc = near_name and any(n.free_text and _subject_of(n.regex, desc) for n in target.names)
    bare = title
    for a in target.addresses:
        bare = re.sub(a.street_re, " ", bare, flags=re.I)  # "Park Avenue" is a street, not a park
    for n in target.names:
        bare = re.sub(n.regex, " ", bare, flags=re.I)
    sibling = any(re.search(n.regex, title, re.I) for n in target.names) and not word_title
    other_subject = sibling or bool(_SUBJECT.search(bare))
    if name_title or (dist <= NUMBER_RADIUS_M and t_ours):
        return "building", 0
    if name_cat and word_title:
        return "building", 0
    # weaker evidence (a category, the description) does not outweigh a title about something else
    if t_other or other_subject:
        return None, 9
    if year is not None and year < WEAK_EVIDENCE_SINCE and (name_cat or d_first_ours or name_desc):
        return None, 9  # an old photo filed under a site's new name often shows the building it replaced
    if name_cat:
        return "building", 1
    if dist <= NUMBER_RADIUS_M and d_first_ours:
        return "building", 1
    if name_desc and not (d_addrs and not d_first_ours):
        return "building", 2
    if dist > radius or d_other:
        return None, 9
    if not any(a.street_in(title) for a in target.addresses):
        return None, 9  # a street mentioned only in passing in the description is too weak
    if any(_SUBJECT_CAT.match(c) or _OTHER_PLACE.match(c) for c in cats):
        return None, 9
    # a street photo's title says where it was taken and nothing else ("Looking east along 52d St")
    leftover = [w for w in re.findall(r"(?<![\w'])[A-Za-z][A-Za-z']*", bare)
                if w.lower().strip("'") not in _STREET_WORDS and w.lower() not in target.place_words]
    if leftover:
        return None, 9
    return "street", 3


def photo_year(title: str, cats: list[str]) -> int | None:
    """When the photo was taken, from Commons' date categories or a year in the title."""
    for c in cats:
        m = re.search(r"taken on (\d{4})-", c) or re.match(r"^(?:[A-Z][a-z]+ )?((?:19|20)\d\d) in ", c)
        if m:
            return int(m.group(1))
    m = re.search(r"(?<!\d)((?:19[5-9]|20[0-4])\d)(?!\d)", title)
    return int(m.group(1)) if m else None


def classify(page: dict, target: Target, radius: float) -> dict | None:
    """Turn one Commons API page into a building_photos entry, or None when it is not a usable photo
    of this building or its street."""
    infos = page.get("imageinfo") or []
    if not infos:
        return None
    info = infos[0]
    if (info.get("mime") or "").lower() not in IMAGE_MIMES:
        return None
    if (info.get("width") or 0) < MIN_WIDTH or (info.get("height") or 0) < MIN_HEIGHT:
        return None
    coords = page.get("coordinates") or []
    if not coords:
        return None
    dist = min(haversine_m(target.lat, target.lon, float(c["lat"]), float(c["lon"])) for c in coords)
    title = re.sub(r"\.[a-z0-9]{3,4}$", "", str(page.get("title", "")).removeprefix("File:"), flags=re.I)
    title = title.replace("_", " ")
    desc = _strip_html(_meta(info, "ImageDescription")) + " " + _strip_html(_meta(info, "ObjectName"))
    cats = [c.strip() for c in _meta(info, "Categories").split("|") if c.strip()]
    if _EXCLUDE.search(title) or any(_EXCLUDE.search(c) for c in cats):
        return None
    year = photo_year(title, cats)
    scope, rank = match_scope(title, desc, cats, target, dist, radius, year)
    if scope is None:
        return None

    author = _strip_html(_meta(info, "Artist")) or _strip_html(_meta(info, "Credit")) or "Unknown author"
    author = re.sub(r"\s*\(talk\)\s*$", "", author)[:120]
    lic = _strip_html(_meta(info, "LicenseShortName")) or _strip_html(_meta(info, "UsageTerms")) or "See file page"
    thumb = _clean_url(info.get("thumburl") or info.get("url") or "")
    if not thumb.startswith("https://"):
        return None
    file_page = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(str(page.get("title", "")).replace(" ", "_"))
    return {
        "url": thumb,
        "page": _clean_url(info.get("descriptionurl") or file_page),
        "title": title,
        "author": author,
        "license": lic,
        "license_url": _clean_url(_meta(info, "LicenseUrl")) or None,
        "source": SOURCE,
        "distance_m": round(dist),
        "scope": scope,
        "year": year,
        "width": info.get("thumbwidth") or info.get("width"),
        "height": info.get("thumbheight") or info.get("height"),
        # best evidence first; within it newer photos (in five-year steps), then the nearest camera
        "_rank": (rank, -((year or 1990) // 5), round(dist)),
    }


def _clean_url(u: str) -> str:
    """Drop the utm_* tracking parameters the API appends to thumbnail URLs."""
    if not u:
        return ""
    p = urllib.parse.urlsplit(u)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not k.startswith("utm_")]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), ""))


def pick(candidates: Iterable[dict], limit: int) -> list[dict]:
    """Best first: building scope, then a match in the title, then distance. One entry per file."""
    seen, out = set(), []
    for c in sorted(candidates, key=lambda c: c["_rank"]):
        if c["page"] in seen:
            continue
        seen.add(c["page"])
        out.append({k: v for k, v in c.items() if k != "_rank"})
        if len(out) >= limit:
            break
    return out


# --------------------------------------------------------------------------- the API client
_TRANSIENT = {"maxlag", "cirrussearch-too-busy-error", "ratelimited", "readonly"}

class Commons:
    """A small, polite MediaWiki API client with an on-disk response cache."""

    def __init__(self, cache_dir: Path | None, session: requests.Session | None = None,
                 pause: float | None = None, refresh: bool = False):
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent()})
        # Wikimedia allows 10 requests a minute to clients it cannot identify and 200 to clients whose
        # User-Agent carries contact details (see user_agent)
        self.pause = pause if pause is not None else (0.4 if os.environ.get("APARTMENTSCOUT_CONTACT") else 6.5)
        self.refresh = refresh
        self.requests = 0
        self._last = 0.0

    def query(self, params: dict[str, Any]) -> dict:
        p = {"action": "query", "format": "json", "formatversion": "2", "maxlag": "5", **params}
        name = "commons-" + hashlib.sha1(json.dumps(p, sort_keys=True).encode()).hexdigest()[:20] + ".json"
        path = self.cache_dir / name if self.cache_dir else None
        if path and path.exists() and not self.refresh:
            try:
                return json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                pass
        data = self._get(p)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, separators=(",", ":")))
            tmp.replace(path)
        return data

    def _get(self, params: dict, tries: int = 6) -> dict:
        last: Exception | None = None
        for k in range(tries):
            wait = self.pause - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                r = self.session.get(API, params=params, timeout=30)
                self.requests += 1
                if r.status_code in (429, 500, 502, 503, 504):
                    raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
                r.raise_for_status()
                data = r.json()
                err = (data.get("error") or {}).get("code")
                if err in _TRANSIENT:
                    time.sleep(max(float(r.headers.get("Retry-After") or 5), 5.0 * (k + 1)))
                    continue
                if err:
                    raise RuntimeError(f"Commons API error: {data['error']}")
                return data
            except (requests.RequestException, ValueError) as e:
                last = e
                resp = getattr(e, "response", None)
                retry_after = resp.headers.get("Retry-After") if resp is not None else None
                try:
                    backoff = float(retry_after) if retry_after else 0.0
                except ValueError:
                    backoff = 0.0
                if resp is not None and resp.status_code == 429:
                    self.pause = min(self.pause * 1.5, 10.0)  # slow down for the rest of the run
                    backoff = max(backoff, 20.0 * (k + 1))
                time.sleep(max(backoff, 2.0 * (2 ** k)))
        raise RuntimeError(f"Commons API failed after {tries} tries: {last}")

    def _image_props(self) -> dict[str, str]:
        return {"prop": "imageinfo|coordinates", "iiprop": "url|size|mime|extmetadata",
                "iiurlwidth": str(THUMB_WIDTH), "iiextmetadatafilter": EXT_METADATA,
                "iiextmetadatalanguage": "en", "coprimary": "all", "colimit": "max"}

    def near(self, lat: float, lon: float, radius: float, limit: int = 100) -> list[dict]:
        d = self.query({"generator": "geosearch", "ggscoord": f"{lat:.6f}|{lon:.6f}",
                        "ggsradius": str(int(max(10, min(radius, 10000)))), "ggsnamespace": "6",
                        "ggslimit": str(limit), **self._image_props()})
        return (d.get("query") or {}).get("pages") or []

    def search_near(self, terms: str, lat: float, lon: float, radius: float, limit: int = 50) -> list[dict]:
        d = self.query({"generator": "search", "gsrsearch": f"nearcoord:{int(radius)}m,{lat:.6f},{lon:.6f} {terms}",
                        "gsrnamespace": "6", "gsrlimit": str(limit), **self._image_props()})
        return (d.get("query") or {}).get("pages") or []


def commons_photos(target: Target, api: Commons, radius: float = 60, limit: int = 6) -> list[dict]:
    """Licensed photos of one building (or, failing that, its street) from Wikimedia Commons."""
    pages = list(api.near(target.lat, target.lon, radius))
    # one full-text search for the house numbers and names nearby (the number radius is enforced later)
    terms = sorted({n for a in target.addresses for n in a.numbers}) + \
        sorted({f'"{n.phrase}"' for n in target.names})
    if terms:
        pages += api.search_near(" OR ".join(terms[:6]), target.lat, target.lon, NAME_RADIUS_M)
    found = [c for c in (classify(p, target, radius) for p in pages) if c]
    return pick(found, limit)


def merge_building_photos(existing: list[dict] | None, commons: list[dict]) -> list[dict]:
    """Keep photos other sources added (agents, renters), replace the Commons ones, order by scope."""
    keep = [p for p in (existing or []) if isinstance(p, dict) and p.get("source") != SOURCE]
    order = {s: i for i, s in enumerate(SCOPES)}
    keep.sort(key=lambda p: order.get(p.get("scope"), len(SCOPES)))
    return keep + commons


def add_commons_photos(listings: list[dict], api: Commons, radius: float = 60, limit: int = 6,
                       say: Callable[[str], None] = print) -> dict[str, int]:
    """Look up every building once and write ``building_photos`` onto each of its listings."""
    targets = targets_for(listings)
    found: dict[str, list[dict]] = {}
    for i, (k, t) in enumerate(targets.items(), 1):
        try:
            found[k] = commons_photos(t, api, radius, limit)
        except RuntimeError as e:
            say(f"  [{i}/{len(targets)}] {t.label}: skipped ({e})")
            continue
        b = sum(p["scope"] == "building" for p in found[k])
        say(f"  [{i}/{len(targets)}] {t.label}: {b} building, {len(found[k]) - b} street")
    for L in listings:
        if L.get("lat") is None or L.get("lon") is None:
            continue
        k = group_key(L)
        if k in found:
            merged = merge_building_photos(L.get("building_photos"), found[k])
            if merged:
                L["building_photos"] = merged
            else:
                L.pop("building_photos", None)
    return {"buildings": len(targets), "with_photos": sum(1 for v in found.values() if v),
            "requests": api.requests}


# --------------------------------------------------------------------------- local media cache
def _local_name(url: str, content_type: str | None) -> str:
    path = urllib.parse.urlsplit(url).path
    base = os.path.basename(urllib.parse.unquote(path)) or "photo"
    stem, ext = os.path.splitext(base)
    if not re.fullmatch(r"\.(jpe?g|png|webp|gif|avif|tiff?)", ext, re.I):
        ext = mimetypes.guess_extension((content_type or "").split(";")[0].strip()) or ".jpg"
        ext = ".jpg" if ext == ".jpe" else ext
    stem = re.sub(r"[^\w.-]+", "_", stem).strip("._")[:60] or "photo"
    return f"{stem}-{hashlib.sha1(url.encode()).hexdigest()[:8]}{ext.lower()}"


def download(url: str, dest_dir: Path, session: requests.Session, max_bytes: int = MAX_BYTES) -> Path | None:
    """Save one image under dest_dir; None when it is not an image, too big or unreachable."""
    try:
        with session.get(url, stream=True, timeout=30) as r:
            if r.status_code != 200:
                return None
            ctype = r.headers.get("Content-Type", "")
            if not ctype.lower().startswith("image/"):
                return None
            if int(r.headers.get("Content-Length") or 0) > max_bytes:
                return None
            dest_dir.mkdir(parents=True, exist_ok=True)
            out = dest_dir / _local_name(url, ctype)
            tmp = out.with_suffix(out.suffix + ".part")
            size = 0
            with tmp.open("wb") as f:
                for chunk in r.iter_content(64 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        break
                    f.write(chunk)
            if size > max_bytes or size == 0:
                tmp.unlink(missing_ok=True)
                return None
            tmp.replace(out)
            return out
    except requests.RequestException:
        return None


def _place(src: Path, dest: Path) -> None:
    """Reuse a file already downloaded for another listing: hard link, or copy when links fail."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    try:
        os.link(src, dest)
    except OSError:
        shutil.copy2(src, dest)


def cache_media(listings: list[dict], root: Path, session: requests.Session | None = None, pause: float = 0.4,
                say: Callable[[str], None] = print) -> dict[str, int]:
    """Download listing photos and building photos into ``<root>/media/<id>/``.

    Writes ``photos_local`` (same order as ``photos``; entries that already are ``media/...`` paths are
    kept as they are) and ``local`` on each building photo. Files already on disk are not fetched again,
    and a URL shared by several listings is downloaded once and hard-linked."""
    session = session or requests.Session()
    session.headers.update({"User-Agent": user_agent()})
    media = Path(root) / "media"
    done: dict[str, Path] = {}
    stats = {"downloaded": 0, "reused": 0, "failed": 0, "skipped_existing": 0}
    last = 0.0

    def fetch(url: str, lid: str) -> str | None:
        nonlocal last
        if url.startswith("media/"):
            return url if (Path(root) / url).exists() else None
        if not url.startswith(("http://", "https://")):
            return None
        d = media / lid
        if url in done:
            target = d / done[url].name
            _place(done[url], target)
            stats["reused"] += 1
            return target.relative_to(root).as_posix()
        existing = list(d.glob(f"*-{hashlib.sha1(url.encode()).hexdigest()[:8]}.*")) if d.exists() else []
        existing = [p for p in existing if not p.name.endswith(".part")]
        if existing:
            done[url] = existing[0]
            stats["skipped_existing"] += 1
            return existing[0].relative_to(root).as_posix()
        wait = pause - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.monotonic()
        p = download(url, d, session)
        if not p:
            stats["failed"] += 1
            return None
        done[url] = p
        stats["downloaded"] += 1
        return p.relative_to(root).as_posix()

    for i, L in enumerate(listings, 1):
        lid = L["id"]
        photos = [u for u in (L.get("photos") or []) if isinstance(u, str)]
        if photos:
            local = [x for x in (fetch(u, lid) for u in photos) if x]
            if local:
                L["photos_local"] = list(dict.fromkeys(local))
        for bp in L.get("building_photos") or []:
            if isinstance(bp, dict) and bp.get("url"):
                loc = fetch(bp["url"], lid)
                if loc:
                    bp["local"] = loc
        if i % 50 == 0:
            say(f"  cached media for {i}/{len(listings)} listings ({stats['downloaded']} downloaded)")
    return stats


# --------------------------------------------------------------------------- coverage
def coverage(listings: list[dict]) -> dict[str, int]:
    def has_listing(L: dict) -> bool:
        return bool(L.get("photos") or L.get("photos_local"))

    def scopes(L: dict) -> set[str]:
        return {p.get("scope") for p in L.get("building_photos") or [] if isinstance(p, dict)}

    n = len(listings)
    lp = sum(has_listing(L) for L in listings)
    bp = sum(bool(L.get("building_photos")) for L in listings)
    bb = sum("building" in scopes(L) or "exact-unit" in scopes(L) or "same-line" in scopes(L) for L in listings)
    either = sum(has_listing(L) or bool(L.get("building_photos")) for L in listings)
    local = sum(bool(L.get("photos_local")) for L in listings)
    return {"listings": n, "listing_photos": lp, "building_photos": bp, "building_scope": bb,
            "street_only": bp - bb, "either": either, "neither": n - either, "photos_local": local}


def coverage_lines(c: dict[str, int]) -> Iterator[str]:
    n = max(c["listings"], 1)

    def pct(k: str) -> str:
        return f"{c[k]:>4} ({100 * c[k] / n:4.1f}%)"
    yield f"Photo coverage over {c['listings']} listings:"
    yield f"  listing photos           {pct('listing_photos')}"
    yield f"  building photos (any)    {pct('building_photos')}"
    yield f"    of the building itself {pct('building_scope')}"
    yield f"    of its street only     {pct('street_only')}"
    yield f"  listing or building      {pct('either')}"
    yield f"  neither                  {pct('neither')}"
    if c.get("photos_local"):
        yield f"  saved locally (media/)   {pct('photos_local')}"
