"""Extra photo sources beyond the Commons geosearch in :mod:`apartmentscout.photos`.

1. **Wikidata building images.** Many named towers have a Wikidata item with an image (P18). One
   SPARQL query per building asks for items with coordinates near the listing; an item counts only
   when its label (or one of its aliases) matches the building's name, or its street address names
   this house number on this street. The item's image is then read from Commons with its author and
   licence, so it can be credited like any other ``building_photos`` entry.

2. **Listing and building web pages.** For listings without photos, a plain GET of the listing's own
   page (or the building's website) may expose ``og:image`` / ``twitter:image`` tags or gallery
   images. Pages that answer with a bot challenge are reported as blocked and never retried: this
   module does not try to get around bot protection, log in or solve CAPTCHAs.
"""
from __future__ import annotations

import hashlib
import html as htmllib
import json
import logging
import re
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import requests

from .photos import IMAGE_MIMES, MIN_HEIGHT, MIN_WIDTH, Commons, Target, _clean_url, _meta, _strip_html, user_agent
from .geo import haversine_m

log = logging.getLogger(__name__)

SPARQL = "https://query.wikidata.org/sparql"
WIKIDATA_SOURCE = "Wikidata / Wikimedia Commons"
WEB_SOURCE = "Listing or building web page"
WIKIDATA_RADIUS_M = 250

# --------------------------------------------------------------------------- bot challenges
_CHALLENGE = re.compile(
    r"(px-captcha|perimeterx|_pxhd|captcha-delivery|datadome|cf-chl|challenge-platform|cf_chl_opt|"
    r"just a moment\.\.\.|attention required! \| cloudflare|pardon our interruption|access denied|"
    r"request unsuccessful\. incapsula|are you a robot|verify you are human|press (?:&amp; |& )?hold)", re.I)


class Blocked(RuntimeError):
    """The host answered with a bot challenge or a block: record it and do not retry."""


def is_challenge(status: int, text: str) -> bool:
    """True when a response is a bot check or a block rather than the page itself."""
    if status in (401, 403, 406, 429, 503):
        return True
    return bool(_CHALLENGE.search(text[:20000]))


# --------------------------------------------------------------------------- page images
_META_IMG = re.compile(
    r"<meta\b[^>]*?(?:property|name)\s*=\s*[\"'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)[\"'][^>]*>",
    re.I)
_CONTENT = re.compile(r"\bcontent\s*=\s*[\"']([^\"']+)[\"']", re.I)
_IMG = re.compile(r"<img\b[^>]*>", re.I)
_ATTR = re.compile(r"\b(src|data-src|data-lazy-src|data-original|srcset|data-srcset|alt|class|width|height)\s*=\s*[\"']([^\"']*)[\"']", re.I)
_SKIP_IMG = re.compile(r"(?<![a-z])(?:logo|icon|ico|sprite|avatar|headshot|agent|broker|team|staff|portrait|favicon|"
                       r"badge|map|marker|pin|placeholder|blank|spacer|pixel|tracking|social|facebook|twitter|"
                       r"instagram|linkedin|youtube|equal[-_]?housing|ada|wheelchair|award|press|signature|phone|"
                       r"menu|arrow|close|search|button|loader|loading)s?(?![a-z])", re.I)
_IMG_EXT = re.compile(r"\.(jpe?g|png|webp|avif)(?:$|[?#])", re.I)


def _largest_from_srcset(srcset: str) -> str | None:
    best, best_w = None, -1
    for part in srcset.split(","):
        bits = part.strip().split()
        if not bits:
            continue
        w = 0
        if len(bits) > 1 and bits[1].endswith("w"):
            try:
                w = int(bits[1][:-1])
            except ValueError:
                w = 0
        if w >= best_w:
            best, best_w = bits[0], w
    return best


def page_images(page_html: str, base_url: str, limit: int = 12) -> list[str]:
    """Image URLs a page offers for itself: social-card images first, then large gallery images.

    Logos, icons, agent or broker headshots, maps and tracking pixels are skipped by name, and images
    that declare a width or height under 400 px are left out."""
    out: list[str] = []

    def push(u: str | None) -> None:
        if not u:
            return
        u = htmllib.unescape(u.strip())
        if u.startswith("data:"):
            return
        u = urllib.parse.urljoin(base_url, u)
        if not u.startswith(("http://", "https://")) or u in out:
            return
        if _SKIP_IMG.search(urllib.parse.urlsplit(u).path):
            return
        out.append(u)

    for tag in _META_IMG.findall(page_html):
        m = _CONTENT.search(tag)
        if m:
            push(m.group(1))
    for tag in _IMG.findall(page_html):
        attrs = {k.lower(): v for k, v in _ATTR.findall(tag)}
        if _SKIP_IMG.search(attrs.get("class", "") + " " + attrs.get("alt", "")):
            continue
        dims = [attrs.get("width", ""), attrs.get("height", "")]
        if any(d.isdigit() and int(d) < 400 for d in dims):
            continue
        src = None
        for k in ("srcset", "data-srcset"):
            if attrs.get(k):
                src = _largest_from_srcset(attrs[k])
                break
        src = src or attrs.get("data-src") or attrs.get("data-lazy-src") or attrs.get("data-original") or attrs.get("src")
        if src and _IMG_EXT.search(src):
            push(src)
        if len(out) >= limit:
            break
    return out[:limit]


@dataclass
class PageFetcher:
    """Plain GETs with a per-host block list: one challenge and that host is skipped from then on."""

    session: requests.Session
    pause: float = 1.0
    blocked: dict[str, str] | None = None

    def __post_init__(self) -> None:
        self.session.headers.setdefault("User-Agent", user_agent())
        self.blocked = {} if self.blocked is None else self.blocked
        self._last = 0.0

    def get(self, url: str) -> str:
        host = urllib.parse.urlsplit(url).netloc.lower()
        if host in self.blocked:
            raise Blocked(self.blocked[host])
        wait = self.pause - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        try:
            r = self.session.get(url, timeout=25, allow_redirects=True)
        except requests.RequestException as e:
            self.blocked[host] = f"unreachable ({type(e).__name__})"
            raise Blocked(self.blocked[host]) from e
        text = r.text if "html" in r.headers.get("Content-Type", "html") else ""
        if is_challenge(r.status_code, text):
            self.blocked[host] = f"HTTP {r.status_code}: bot challenge or block"
            raise Blocked(self.blocked[host])
        if r.status_code != 200:
            raise Blocked(f"HTTP {r.status_code}")  # this page only; the host stays allowed
        return text


# --------------------------------------------------------------------------- Wikidata
def sparql_near(lat: float, lon: float, radius_m: float = WIKIDATA_RADIUS_M) -> str:
    """Buildings (instances of a subclass of Q41176) with an image (P18) within ``radius_m`` of a
    point, with labels, aliases and street addresses."""
    return f"""SELECT ?item ?label ?alias ?image ?coord ?address WHERE {{
  SERVICE wikibase:around {{ ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point({lon:.6f} {lat:.6f})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "{radius_m / 1000:.3f}" . }}
  ?item wdt:P18 ?image .
  FILTER EXISTS {{ ?item wdt:P31/wdt:P279* wd:Q41176 . }}
  OPTIONAL {{ ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }}
  OPTIONAL {{ ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }}
  OPTIONAL {{ ?item wdt:P6375 ?address . }}
}} LIMIT 300"""


def _point(wkt: str) -> tuple[float, float] | None:
    m = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", wkt or "")
    return (float(m.group(2)), float(m.group(1))) if m else None


def match_wikidata(bindings: Iterable[dict], target: Target) -> list[dict]:
    """Wikidata items that are this building: the label or an alias matches the building's name, or
    the item's street address is this house number on this street. Returns
    ``[{item, label, file, distance_m}]``, nearest first, one per image file."""
    items: dict[str, dict[str, Any]] = {}
    for b in bindings:
        item = (b.get("item") or {}).get("value", "")
        img = (b.get("image") or {}).get("value", "")
        if not item or not img:
            continue
        rec = items.setdefault(item, {"names": set(), "addresses": set(), "images": set(), "coord": None})
        for k in ("label", "alias"):
            if b.get(k):
                rec["names"].add(b[k]["value"])
        if b.get("address"):
            rec["addresses"].add(b["address"]["value"])
        rec["images"].add(img)
        rec["coord"] = rec["coord"] or _point((b.get("coord") or {}).get("value", ""))
    out = []
    for item, rec in items.items():
        if not rec["coord"]:
            continue
        dist = haversine_m(target.lat, target.lon, *rec["coord"])
        named = any(re.search(n.regex, name, re.I) and (n.free_text or re.fullmatch(r"(?:the\s+)?" + n.regex, name.strip(), re.I))
                    for n in target.names for name in rec["names"])
        # an address match counts when the item is named after the address ("222 Broadway"), or when
        # its street address is ours and it has no other name (a theatre in the base shares the address)
        addr_named = any(a.numbers and (num := a.number_on_street(t)) and a.matches_number(num)
                         for a in target.addresses for t in rec["names"])
        addr_field = any(a.numbers and (num := a.number_on_street(t)) and a.matches_number(num)
                         for a in target.addresses for t in rec["addresses"])
        addressed = addr_named or (addr_field and not rec["names"])
        if not (named or addressed):
            continue
        label = sorted(rec["names"])[0] if rec["names"] else item.rsplit("/", 1)[-1]
        for img in sorted(rec["images"]):
            file = urllib.parse.unquote(img.rsplit("/", 1)[-1]).replace("_", " ")
            out.append({"item": item, "label": label, "file": file, "distance_m": round(dist)})
    out.sort(key=lambda r: r["distance_m"])
    seen, uniq = set(), []
    for r in out:
        if r["file"] not in seen:
            seen.add(r["file"])
            uniq.append(r)
    return uniq


class Wikidata:
    """SPARQL client with an on-disk cache and a polite pause between live requests."""

    def __init__(self, cache_dir: Path | None, session: requests.Session | None = None, pause: float = 1.0):
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent(), "Accept": "application/sparql-results+json"})
        self.pause = pause
        self.requests = 0
        self._last = 0.0

    def select(self, query: str) -> list[dict]:
        name = "wikidata-" + hashlib.sha1(query.encode()).hexdigest()[:20] + ".json"
        path = self.cache_dir / name if self.cache_dir else None
        if path and path.exists():
            try:
                return json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                pass
        wait = self.pause - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        r = self.session.get(SPARQL, params={"query": query, "format": "json"}, timeout=60)
        self.requests += 1
        if r.status_code == 429:
            time.sleep(float(r.headers.get("Retry-After") or 30))
            r = self.session.get(SPARQL, params={"query": query, "format": "json"}, timeout=60)
        r.raise_for_status()
        rows = ((r.json().get("results") or {}).get("bindings")) or []
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(rows, separators=(",", ":")))
        return rows


def commons_file_entry(page: dict, match: dict) -> dict | None:
    """A ``building_photos`` entry for one Commons file named by a Wikidata item."""
    infos = page.get("imageinfo") or []
    if not infos:
        return None
    info = infos[0]
    if (info.get("mime") or "").lower() not in IMAGE_MIMES:
        return None
    if (info.get("width") or 0) < MIN_WIDTH or (info.get("height") or 0) < MIN_HEIGHT:
        return None
    thumb = _clean_url(info.get("thumburl") or info.get("url") or "")
    if not thumb.startswith("https://"):
        return None
    title = re.sub(r"\.[a-z0-9]{3,4}$", "", str(page.get("title", "")).removeprefix("File:"), flags=re.I)
    author = _strip_html(_meta(info, "Artist")) or _strip_html(_meta(info, "Credit")) or "Unknown author"
    lic = _strip_html(_meta(info, "LicenseShortName")) or _strip_html(_meta(info, "UsageTerms")) or "See file page"
    return {
        "url": thumb,
        "page": _clean_url(info.get("descriptionurl") or ""),
        "title": title.replace("_", " "),
        "author": re.sub(r"\s*\(talk\)\s*$", "", author)[:120],
        "license": lic,
        "license_url": _clean_url(_meta(info, "LicenseUrl")) or None,
        "source": WIKIDATA_SOURCE,
        "wikidata": match["item"],
        "distance_m": match["distance_m"],
        "scope": "building",
        "year": None,
        "width": info.get("thumbwidth") or info.get("width"),
        "height": info.get("thumbheight") or info.get("height"),
    }


def wikidata_photos(target: Target, wd: Wikidata, commons: Commons, limit: int = 2) -> list[dict]:
    """Licensed images of one building via its Wikidata item (nothing when no item matches)."""
    if not target.names and not any(a.numbers for a in target.addresses):
        return []
    matches = match_wikidata(wd.select(sparql_near(target.lat, target.lon)), target)[:limit]
    out = []
    for m in matches:
        d = commons.query({"titles": "File:" + m["file"], **commons._image_props()})
        for page in (d.get("query") or {}).get("pages") or []:
            e = commons_file_entry(page, m)
            if e:
                out.append(e)
    return out
