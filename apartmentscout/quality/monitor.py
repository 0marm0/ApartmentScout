"""Monitoring: re-check watched listings from their own sources, record what was seen, diff it, write a digest.

``apartmentscout monitor`` is the command; everything here is a pure function over listings, criteria and an injected
fetcher, so the tests never touch the network. The rules:

- **Only hosts the renter allowed.** The hosts are the ones in ``monitor.allow_hosts`` (criteria.yaml), ``--allow-host``
  and the page of each watchlist entry. A known portal (StreetEasy, Zillow, RentHop ...) is never fetched unless it is
  named explicitly, because those sites block automated reads.
- **Bot checks end a host.** A challenge page, a 401/403/429/503 or a robots.txt ``Disallow`` skips the rest of that
  host for the run and is reported in the digest. Nothing here solves a CAPTCHA, logs in or works around a block.
- **Cached.** Each URL's last reading is kept for ``--max-age-hours``; a re-run inside that window reads the cache
  and does not touch the host again.
- **Only what a page says.** A price, a concession, a status or a start date is recorded only when the page states it.
  A unit missing from a building page is ``unclear``, never ``gone``. Nothing in listings.json changes unless
  ``--apply`` is given, and a listing is never revived.

Files under ``<search>/history/monitor/``: ``observations.jsonl`` (append-only, one line per fetch), ``cache/`` (the last
reading per URL), ``digests/YYYY-MM-DD.md|json`` and ``digest.json`` (the latest digest, copied to the dashboard by
``apartmentscout build``). Changes are also appended to ``history/claims.jsonl`` as claims, so they reach
``history.json`` (price history, events, availability) like any other received claim.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import html as htmllib
import json
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from . import SCHEMA_VERSION
from .common import SOURCE_NAMES, as_of, host, is_active, iso, norm_unit, num, parse_date
from .history import append_claim, diff_snapshots, history_dir, make_claim, make_snapshot
from .watchlist import watchlist

DEFAULT_MAX_AGE_HOURS = 12.0
SHORTLIST_STATUSES = ("shortlist", "touring", "applied")
# Hosts that block automated reads. They are fetched only when the renter names them in monitor.allow_hosts / --allow-host.
PORTAL_HOSTS = frozenset(SOURCE_NAMES) | {"redfin.com", "loopnet.com", "facebook.com", "rentcafe.com"}
GONE_PHRASES = re.compile(
    r"\b(?:no longer available|off[- ]market|has been rented|already rented|currently rented|in contract|under contract|"
    r"lease signed|application pending|sold out|"
    r"this (?:listing|unit|apartment|home) (?:has )?(?:expired|been removed|is no longer)|listing (?:is )?(?:not active|removed)|"
    r"unit (?:is )?(?:leased|rented|unavailable))\b", re.I)
ACTIVE_PHRASES = re.compile(r"\b(?:available now|available immediately|available today|apply now|schedule a tour|"
                            r"now leasing|in stock)\b|\bavailable\s+(?:on\s+|from\s+|starting\s+)?"
                            r"(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2}|\d{1,2}/\d{1,2})", re.I)
_MONEY = re.compile(r"\$\s?(\d{1,2},\d{3}(?:\.\d{2})?|\d{3,5}(?:\.\d{2})?)(?!\d)")
_PER_MONTH = re.compile(r"^\s*(?:/\s?mo\b|/\s?month|per month|a month|monthly|\bmo\b\.?|/\s?mth)", re.I)
_RENT_WORDS = re.compile(r"(?:rent|price|asking|starting at|from|base)\W{0,3}$", re.I)
_NOT_RENT = re.compile(r"(?:deposit|fee|application|security|sale|sold|reduced from|was|previously|utilities|parking|"
                       r"storage|pet|late|cleaning|income|net[- ]effective(?: rent)?)\W{0,6}$", re.I)
_FREE = re.compile(r"\b(\d+(?:\.\d+)?|one|two|three|a)\s*(?:months?|mos?)\s*(?:of\s+)?free\b|"
                   r"\bfree\s+(\d+(?:\.\d+)?|one|two|three)\s*months?\b", re.I)
_WORDNUM = {"a": 1.0, "one": 1.0, "two": 2.0, "three": 3.0}
_TERM = re.compile(r"\b(\d{1,2})[- ]?(?:mo|month)s?\s*(?:lease|term)\b|\blease\s*(?:term\s*)?(?:of\s*)?(\d{1,2})\s*months?\b|"
                   r"\bon\s+(?:a|an)\s+(\d{1,2})[- ]month\b", re.I)
_NET = re.compile(r"net[- ]effective[^$]{0,30}\$\s?(\d{1,2},\d{3}(?:\.\d{2})?|\d{3,5})", re.I)
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_AVAIL = re.compile(r"\bavailable\s*(?:on|from|starting|beginning)?\s*:?\s*(now|immediately|today|"
                    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?|"
                    r"\d{1,2}/\d{1,2}(?:/\d{2,4})?)", re.I)
SCHEMA_AVAILABILITY = {"instock": "active", "limitedavailability": "active", "onlineonly": "active", "preorder": "active",
                       "outofstock": "gone", "soldout": "gone", "discontinued": "gone", "instoreonly": "active"}


# --------------------------------------------------------------------------- paths
def monitor_dir(root: Path) -> Path:
    return history_dir(root) / "monitor"


def cache_path(root: Path, url: str) -> Path:
    return monitor_dir(root) / "cache" / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".json")


def observations_path(root: Path) -> Path:
    return monitor_dir(root) / "observations.jsonl"


# --------------------------------------------------------------------------- reading a page
@dataclass(frozen=True)
class Fetched:
    url: str
    status: int
    text: str


class HostBlocked(RuntimeError):
    """The host answered with a bot check, a block or a robots.txt Disallow: skip it for this run."""


class PageError(RuntimeError):
    """This page could not be read (timeout, server error); the host stays allowed."""


def _strip_tags(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|noscript|svg)\b.*?</\1>", " ", markup)
    markup = re.sub(r"(?s)<!--.*?-->", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</(?:p|div|li|tr|h\d|section|article)>", "\n", markup)
    text = htmllib.unescape(re.sub(r"<[^>]+>", " ", markup))
    return re.sub(r"[ \t\r\f\v\xa0]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip()


def _jsonld(markup: str) -> list[Any]:
    out: list[Any] = []
    for m in re.finditer(r'(?is)<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', markup):
        try:
            out.append(json.loads(m.group(1).strip()))
        except ValueError:
            continue
    return out


def _walk(node: Any) -> Iterable[dict]:
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _start_date(s: str, today: dt.date) -> str | None:
    """'now' or an ISO date from 'Oct 15', 'October 15, 2026' or '10/15'. A date without a year is the next one."""
    s = s.strip().lower().rstrip(".")
    if s in ("now", "immediately", "today"):
        return "now"
    m = re.match(r"([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$", s)
    if m:
        mo, d, y = _MONTHS.get(m.group(1)), int(m.group(2)), m.group(3)
    else:
        m = re.match(r"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$", s)
        if not m:
            return None
        mo, d, y = int(m.group(1)), int(m.group(2)), m.group(3)
    if not mo:
        return None
    try:
        if y:
            return dt.date(int(y) + 2000 if int(y) < 100 else int(y), mo, d).isoformat()
        cand = dt.date(today.year, mo, d)
        return (cand if cand >= today - dt.timedelta(days=30) else dt.date(today.year + 1, mo, d)).isoformat()
    except ValueError:
        return None


def _prices(text: str) -> list[float]:
    """Monthly rents in a piece of text: an amount followed by /mo or preceded by a rent word, never a fee or a deposit."""
    out: list[float] = []
    for m in _MONEY.finditer(text):
        v = float(m.group(1).replace(",", ""))
        if not 500 <= v <= 30000:
            continue
        before, after = text[max(0, m.start() - 28):m.start()], text[m.end():m.end() + 24]
        if _NOT_RENT.search(before):
            continue
        if _PER_MONTH.match(after) or _RENT_WORDS.search(before):
            out.append(v)
    return out


def _unit_windows(text: str, unit: str, lines_after: int = 2) -> list[str]:
    """The text that belongs to a unit label on a building page: its own line, and the next line or two when the
    label's line carries no price (a table row split over cells). Never text from the unit above."""
    u = re.escape(str(unit).strip())
    if not u:
        return []
    rx = re.compile(r"(?<![\w$])(?:#|unit\s+|apt\.?\s+|apartment\s+|residence\s+|no\.\s*)?" + u + r"(?![\w])", re.I)
    lines = text.split("\n")
    out = []
    for i, line in enumerate(lines):
        if rx.search(line):
            block = line
            if not _prices(block):
                block = "\n".join(lines[i:i + 1 + lines_after])
            out.append(block)
    return out


def _unit_in_url(url: str, unit: str) -> bool:
    segs = [norm_unit(s) for s in re.split(r"[/\-_?=&.]", urllib.parse.urlsplit(url).path + "?" + urllib.parse.urlsplit(url).query) if s]
    u = norm_unit(unit)
    return bool(u) and u in segs


def extract_observation(markup: str, url: str, today: dt.date, unit: str | None = None) -> dict:
    """What one page says about one unit: ``{gross, net, free_months, lease_months, status, available, method}``.

    Structured data (JSON-LD offers) wins; otherwise the page text is read. On a building page (the unit is not in
    the URL) only the text around the unit label counts, and a unit that is not on the page is ``unclear``. Keys the
    page does not state are left out, and several unrelated prices on one page give no price at all."""
    obs: dict[str, Any] = {}
    for node in (n for blob in _jsonld(markup) for n in _walk(blob)):
        kind = node.get("@type")
        if "Offer" in (kind if isinstance(kind, list) else [kind]) or "AggregateOffer" in (kind if isinstance(kind, list) else [kind]):
            price = num(node.get("price", node.get("lowPrice")))
            if price and 500 <= price <= 30000 and "gross" not in obs:
                obs["gross"], obs["method"] = price, "jsonld"
            av = str(node.get("availability") or "").rsplit("/", 1)[-1].lower()
            if av in SCHEMA_AVAILABILITY and "status" not in obs:
                obs["status"] = SCHEMA_AVAILABILITY[av]
                obs.setdefault("method", "jsonld")
    text = _strip_tags(markup)
    title = _strip_tags(" ".join(re.findall(r"(?is)<(?:title|h1|h2)[^>]*>(.*?)</(?:title|h1|h2)>", markup)))
    windows = _unit_windows(text, unit) if unit else []
    building_page = bool(unit) and not _unit_in_url(url, unit)
    scope = text
    if building_page:
        if not windows:
            return {**obs, "status": obs.get("status", "unclear"), "method": obs.get("method", "text"),
                    "note": "the unit is not on the page"}
        scope = "\n".join(windows)
    if "gross" not in obs:
        found = _prices("\n".join(windows) if windows else scope)
        if not found and windows:
            found = _prices(scope) if len(set(_prices(scope))) == 1 else []
        if len(set(found)) == 1 or (found and windows):
            obs["gross"], obs["method"] = found[0], "text"
        elif found:
            obs["note"] = "several different prices on the page, none tied to the unit"
    m = _NET.search(scope)
    if m:
        obs["net"] = float(m.group(1).replace(",", ""))
    m = _FREE.search(scope)
    if m:
        raw = (m.group(1) or m.group(2)).lower()
        obs["free_months"] = _WORDNUM[raw] if raw in _WORDNUM else float(raw)
    m = _TERM.search(scope)
    if m:
        obs["lease_months"] = float(next(g for g in m.groups() if g))
    m = _AVAIL.search(scope)
    if m:
        d = _start_date(m.group(1), today)
        if d:
            obs["available"] = d
    if "status" not in obs:
        zone = title + "\n" + (scope if building_page else scope[:1500])
        if GONE_PHRASES.search(zone):
            obs["status"] = "gone"
        elif ACTIVE_PHRASES.search(scope) or obs.get("gross"):
            obs["status"] = "active"
        else:
            obs["status"] = "unclear"
    obs.setdefault("method", "text")
    return obs


# --------------------------------------------------------------------------- targets and hosts
@dataclass(frozen=True)
class Target:
    id: str
    url: str
    host: str
    unit: str
    kind: str          # "unit" (the listing's own page) or "building" (the watchlist entry's page)
    watch: str | None


def host_policy(crit: dict, extra: Iterable[str] = (), entries: Iterable[dict] = ()) -> tuple[set[str], set[str]]:
    """(hosts that may be fetched, portals that need an explicit allow). Portals are never allowed implicitly."""
    listed = list(((crit.get("monitor") or {}).get("allow_hosts")) or []) + list(extra)
    explicit = {str(h).lower().removeprefix("www.") for h in listed if h}
    implied = {host(e.get("url")) for e in entries if e.get("url")}
    return explicit | {h for h in implied if h and h not in PORTAL_HOSTS}, set(PORTAL_HOSTS) - explicit


def _host_ok(h: str, allowed: set[str]) -> bool:
    return any(h == a or h.endswith("." + a) for a in allowed)


def _candidates(L: dict, entry: dict | None) -> list[tuple[str, str]]:
    """Pages that can speak for a listing, best first: its own page, its building's page, the watchlist entry's page."""
    links = L.get("links") or {}
    raw = [(links.get("listing"), "unit"), (links.get("secondary"), "building"), (links.get("building_site"), "building"),
           ((entry or {}).get("url"), "building")]
    out: list[tuple[str, str]] = []
    for url, kind in raw:
        if isinstance(url, str) and url.startswith(("http://", "https://")) and (url, kind) not in out:
            out.append((url, kind))
    return out


def plan_targets(listings: list[dict], crit: dict, ids: Iterable[str] = (), shortlist: bool = False, today: Any = None,
                 extra_hosts: Iterable[str] = ()) -> tuple[list[Target], list[dict], str | None]:
    """The pages to re-check. Default: the active units of every watchlist building. ``ids`` names listings,
    ``shortlist`` takes the shortlist / touring / applied ones. Each listing is read from the first of its pages whose
    host the renter allowed (its own page, else its building's); if none is allowed the unit's own page is planned and
    skipped with the reason. Returns (targets, watch entries, note)."""
    by = {L["id"]: L for L in listings if L.get("id")}
    entries = watchlist(listings, crit, None, today)["buildings"]
    allowed, _ = host_policy(crit, extra_hosts, entries)
    entry_of = lambda i: next((e for e in entries if i in e.get("listing_ids", [])), None)  # noqa: E731
    chosen: list[str] = []
    ids = list(ids)
    if ids:
        for i in ids:
            hit = by.get(i) or next((L for k, L in by.items() if i in k), None)
            if hit:
                chosen.append(hit["id"])
    elif shortlist:
        chosen += [L["id"] for L in listings if (L.get("status") in SHORTLIST_STATUSES or L.get("favorite")) and is_active(L)]
    else:
        for e in entries:
            chosen += [i for i in e.get("listing_ids") or [] if i in by and is_active(by[i])]
    seen: set[str] = set()
    targets: list[Target] = []
    for i in chosen:
        if i in seen:
            continue
        seen.add(i)
        L, e = by[i], entry_of(i)
        cands = _candidates(L, e)
        if not cands:
            continue
        url, kind = next((c for c in cands if _host_ok(host(c[0]), allowed)), cands[0])
        targets.append(Target(i, url, host(url), str(L.get("unit") or ""), kind, (e or {}).get("name")))
    note = None
    if not targets:
        note = ("Nothing to check: the watchlist is empty. Add buildings under `watchlist:` in criteria.yaml, set "
                "`\"watch\": true` on a listing, or pass listing ids or --shortlist.")
    return targets, entries, note


# --------------------------------------------------------------------------- previous readings and diffs
def read_observations(root: Path) -> list[dict]:
    p = observations_path(root)
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if isinstance(o, dict) and o.get("id") and o.get("fetched_at"):
            out.append(o)
    return out


def baseline_for(obs: list[dict], lid: str, since: dt.date | None, before: str) -> dict | None:
    """The reading to compare with: the latest ok reading on or before ``since``, else the latest one before ``before``."""
    mine = [o for o in obs if o["id"] == lid and o.get("status") == "ok" and o.get("observation")]
    if since is not None:
        pick = [o for o in mine if parse_date(o["fetched_at"]) and parse_date(o["fetched_at"]) <= since]
    else:
        pick = [o for o in mine if o["fetched_at"] < before]
    return max(pick, key=lambda o: o["fetched_at"])["observation"] if pick else None


def overlay(L: dict, obs: dict | None) -> dict:
    """A copy of the listing with what a reading says laid over it (the record itself for a listing nobody has read)."""
    out = copy.deepcopy(L)
    if not obs:
        return out
    p = out.setdefault("price", {})
    for key, name in (("gross", "gross"), ("net", "net_effective"), ("free_months", "free_months"), ("lease_months", "lease_months")):
        if obs.get(key) is not None:
            p[name] = obs[key]
    if obs.get("available"):
        out["available"] = obs["available"]
    if obs.get("status") == "gone":
        out["status"] = "gone"
    elif obs.get("status") == "active" and out.get("status") in ("gone", "rejected"):
        out["status"] = "researching"
    return out


def diff_reading(L: dict, base: dict | None, new: dict, base_date: str, today: dt.date) -> list[dict]:
    """Events between the baseline reading (or the listing's own record) and the new reading, through the same snapshot
    diff the history uses: price (gross, net), concession (free months, lease term), status (gone, relist), start date."""
    a = make_snapshot([overlay(L, base)], base_date)
    b = make_snapshot([overlay(L, new)], today)
    return [e for e in diff_snapshots(a, b) if e["type"] != "new"]


# --------------------------------------------------------------------------- fetching
class HttpFetcher:
    """Plain GETs with a pause between requests, robots.txt, and a per-host stop at the first bot check.

    Does not log in, submit forms or try to get past a challenge: a challenge page or a 401/403/429/503 marks the
    host blocked for the rest of the run."""

    def __init__(self, pause: float = 2.0, session: Any = None, timeout: float = 25.0, user_agent: str | None = None) -> None:
        import requests

        from ..photo_sources import is_challenge
        from ..photos import user_agent as ua

        self._is_challenge = is_challenge
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent or ua(), "Accept": "text/html,application/xhtml+xml"})
        self.pause, self.timeout = pause, timeout
        self.blocked: dict[str, str] = {}
        self._robots: dict[str, Any] = {}
        self._last = 0.0

    def _sleep(self) -> None:
        wait = self.pause - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def _robots_for(self, scheme: str, h: str) -> Any:
        from urllib.robotparser import RobotFileParser
        if h not in self._robots:
            rp = RobotFileParser()
            try:
                self._sleep()
                r = self.session.get(f"{scheme}://{h}/robots.txt", timeout=self.timeout)
                if self._is_challenge(r.status_code, r.text if r.status_code == 200 else ""):
                    self.blocked[h] = f"HTTP {r.status_code}: bot check or block"
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except Exception:   # no robots.txt to read: nothing is disallowed
                rp.parse([])
            self._robots[h] = rp
        return self._robots[h]

    def __call__(self, url: str) -> Fetched:
        parts = urllib.parse.urlsplit(url)
        h = parts.netloc.lower()
        if h not in self.blocked:
            rp = self._robots_for(parts.scheme, h)
        if h in self.blocked:
            raise HostBlocked(self.blocked[h])
        if not rp.can_fetch(self.session.headers["User-Agent"], url):
            raise HostBlocked("robots.txt disallows automated reads of this page")
        self._sleep()
        try:
            r = self.session.get(url, timeout=self.timeout, allow_redirects=True)
        except Exception as e:  # network trouble: this page only
            raise PageError(f"unreachable ({type(e).__name__})") from e
        ctype = r.headers.get("Content-Type", "html")
        text = r.text if ("html" in ctype or "json" in ctype or "text" in ctype) else ""
        if self._is_challenge(r.status_code, text):
            self.blocked[h] = f"HTTP {r.status_code}: bot check or block"
            raise HostBlocked(self.blocked[h])
        if r.status_code in (404, 410):
            return Fetched(url, r.status_code, text)
        if r.status_code != 200:
            raise PageError(f"HTTP {r.status_code}")
        return Fetched(url, r.status_code, text)


# --------------------------------------------------------------------------- one run
@dataclass
class MonitorResult:
    digest: dict
    looks: list[dict] = field(default_factory=list)      # fresh readings, to append to observations.jsonl
    changes: list[dict] = field(default_factory=list)    # events found, with their source page


def _read_cache(root: Path, url: str) -> dict | None:
    p = cache_path(root, url)
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except ValueError:
        return None


def _write_cache(root: Path, url: str, rec: dict) -> None:
    p = cache_path(root, url)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"url": url, **rec}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def run_monitor(root: Path, listings: list[dict], crit: dict, targets: list[Target], fetch: Callable[[str], Fetched] | None,
                *, today: Any = None, since: Any = None, entries: Iterable[dict] = (), extra_hosts: Iterable[str] = (),
                dry_run: bool = False, refresh: bool = False, offline: bool = False, max_age_hours: float | None = None,
                now: dt.datetime | None = None, note: str | None = None, write: bool = True) -> MonitorResult:
    """Look at every target once and return the digest with the fresh readings.

    ``dry_run`` and ``offline`` fetch nothing and read the cache as it is; ``dry_run`` also writes nothing (``write=False``
    does the same without the label). Otherwise the cache, observations, claims and digest files are written."""
    now = now or dt.datetime.now().replace(microsecond=0)
    day = as_of(today) if today else now.date()
    since_d = parse_date(since)
    ttl = float(max_age_hours if max_age_hours is not None else (crit.get("monitor") or {}).get("max_age_hours", DEFAULT_MAX_AGE_HOURS))
    allowed, need_allow = host_policy(crit, extra_hosts, entries)
    by = {L["id"]: L for L in listings}
    previous = read_observations(root)
    network = fetch is not None and not (offline or dry_run)
    res = MonitorResult(digest={})
    blocked_hosts: dict[str, str] = {}
    unchanged: list[str] = []
    skipped: list[dict] = []
    unreadable: list[dict] = []
    readings = 0
    cached_n = 0
    for t in targets:
        L = by[t.id]
        if t.host in blocked_hosts:
            skipped.append({"id": t.id, "url": t.url, "host": t.host, "reason": f"host blocked this run: {blocked_hosts[t.host]}"})
            continue
        if not _host_ok(t.host, allowed):
            why = (f"{t.host} is a portal that blocks automated reads; name it in monitor.allow_hosts to try it"
                   if t.host in need_allow else f"{t.host} is not in monitor.allow_hosts or on a watchlist entry")
            skipped.append({"id": t.id, "url": t.url, "host": t.host, "reason": why})
            continue
        cached = _read_cache(root, t.url)
        fresh = bool(cached) and dt.datetime.fromisoformat(cached["fetched_at"]) + dt.timedelta(hours=ttl) >= now
        from_cache = False
        if cached and not refresh and (fresh or not network):
            if cached.get("status") == "blocked":
                blocked_hosts[t.host] = cached.get("reason", "blocked")
                skipped.append({"id": t.id, "url": t.url, "host": t.host, "reason": f"blocked earlier ({cached.get('reason')}); cached"})
                continue
            reading, from_cache = cached, True
            cached_n += 1
        elif network:
            try:
                page = fetch(t.url)  # type: ignore[misc]
            except HostBlocked as e:
                blocked_hosts[t.host] = str(e)
                if write and not dry_run:
                    _write_cache(root, t.url, {"fetched_at": now.isoformat(timespec="seconds"), "status": "blocked", "reason": str(e)})
                skipped.append({"id": t.id, "url": t.url, "host": t.host, "reason": f"bot check or block: {e}"})
                continue
            except PageError as e:
                unreadable.append({"id": t.id, "url": t.url, "reason": str(e)})
                continue
            if page.status in (404, 410):
                obs = ({"status": "gone", "method": "http", "note": f"HTTP {page.status}: the unit's page is gone"} if t.kind == "unit"
                       else {"status": "unclear", "method": "http", "note": f"HTTP {page.status}"})
            else:
                obs = extract_observation(page.text, t.url, day, t.unit)
            reading = {"url": t.url, "fetched_at": now.isoformat(timespec="seconds"), "status": "ok", "observation": obs,
                       "sha": hashlib.sha1(page.text.encode("utf-8", "ignore")).hexdigest()[:12]}
            if write and not dry_run:
                _write_cache(root, t.url, reading)
            res.looks.append({"id": t.id, "url": t.url, "host": t.host, "fetched_at": reading["fetched_at"], "status": "ok",
                              "observation": obs, "sha": reading["sha"]})
        else:
            skipped.append({"id": t.id, "url": t.url, "host": t.host, "reason": "no cached reading and no network (dry run or offline)"})
            continue
        readings += 1
        obs = reading["observation"] or {}
        if obs.get("status") == "unclear" and not {k for k in obs if k not in ("method", "note", "status")}:
            unreadable.append({"id": t.id, "url": t.url, "reason": obs.get("note") or "the page says nothing usable about this unit"})
            continue
        base_obs = baseline_for(previous, t.id, since_d, reading["fetched_at"])
        seen = parse_date(reading["fetched_at"]) or day
        evs = diff_reading(L, base_obs, obs, (parse_date(L.get("checked")) or seen).isoformat(), seen)
        for e in evs:
            e.update(source=t.url, host=t.host, date=seen.isoformat(), fresh=not from_cache, note=obs.get("note"),
                     name=(f"{L.get('building', '')} {L.get('unit', '')}".strip() or t.id))
            res.changes.append(e)
        if not evs:
            unchanged.append(t.id)

    res.digest = make_digest(res.changes, unchanged, skipped, unreadable, blocked_hosts, readings, cached_n, len(targets), day,
                             since_d, now, dry_run, note, offline)
    if write and not dry_run:
        write_outputs(root, res, day)
    return res


CLAIM_OF = {("price", "gross"): "gross", ("price", "net"): "net", ("concession", "free_months"): "free_months",
            ("concession", "lease_months"): "lease_months", ("status", "available"): "available"}


def write_outputs(root: Path, res: MonitorResult, day: dt.date) -> None:
    """Append the fresh readings, turn each fresh change into a claim, write the digest files."""
    mdir = monitor_dir(root)
    mdir.mkdir(parents=True, exist_ok=True)
    if res.looks:
        with observations_path(root).open("a", encoding="utf-8") as f:
            for o in res.looks:
                f.write(json.dumps(o, ensure_ascii=False, separators=(",", ":")) + "\n")
    for e in res.changes:
        if not e.get("fresh"):
            continue          # a cached reading was already turned into claims when it was fetched
        field_, value = CLAIM_OF.get((e["type"], e["field"])), e["to"]
        if e["type"] in ("gone", "relist") and e["field"] in ("status", "id"):
            field_, value = "status", ("gone" if e["type"] == "gone" else "active")
        if not field_ or value is None:
            continue
        kind = "unit_page" if urllib.parse.urlsplit(e["source"]).path.strip("/") else "building_site"
        try:
            append_claim(root, make_claim(e["id"], field_, value, e["source"], kind, e["date"], max(day, parse_date(e["date"]) or day),
                                          "monitor", "exact_unit",
                                          e.get("note") or f"monitor: {e['type']} {e.get('field')}"))
        except ValueError:
            continue
    stamp = day.isoformat()
    (mdir / "digests").mkdir(exist_ok=True)
    text = json.dumps(res.digest, indent=1, ensure_ascii=False) + "\n"
    (mdir / "digests" / f"{stamp}.json").write_text(text, encoding="utf-8")
    (mdir / "digests" / f"{stamp}.md").write_text(digest_markdown(res.digest), encoding="utf-8")
    (mdir / "digest.json").write_text(text, encoding="utf-8")


def apply_to_listings(listings: list[dict], looks: list[dict], day: dt.date) -> int:
    """Lay the fresh readings over the listings in place: the price fields, the start date, a ``gone`` status (never a
    revival), the check date and the price basis. Returns how many listings changed."""
    n = 0
    latest = {o["id"]: o["observation"] for o in looks if o.get("status") == "ok" and o.get("observation")}
    for L in listings:
        obs = latest.get(L["id"])
        if not obs:
            continue
        new = overlay(L, obs)
        if obs.get("status") != "gone":
            new["status"] = L.get("status")
        if {k: new.get(k) for k in ("price", "available", "status")} == {k: L.get(k) for k in ("price", "available", "status")}:
            continue
        for k in ("price", "available", "status"):
            L[k] = new.get(k)
        L["checked"] = day.isoformat()
        L["price"].update({"checked": day.isoformat(), "basis": "unit_page", "source": "monitor re-check of the listing page"})
        n += 1
    return n


# --------------------------------------------------------------------------- digest
def make_digest(changes: list[dict], unchanged: list[str], skipped: list[dict], unreadable: list[dict], blocked: dict[str, str],
                read: int, cached: int, n_targets: int, day: dt.date, since: dt.date | None, now: dt.datetime, dry_run: bool,
                note: str | None, offline: bool) -> dict:
    rows = [{"id": e["id"], "name": e.get("name"), "date": e["date"], "type": e["type"], "field": e.get("field"),
             "from": e.get("from"), "to": e.get("to"), "url": e.get("source"), "host": e.get("host"), "note": e.get("note")}
            for e in sorted(changes, key=lambda x: (x["type"], x["id"], str(x.get("field"))))]
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["type"]] = counts.get(r["type"], 0) + 1
    return {
        "schema_version": SCHEMA_VERSION,
        "generated": day.isoformat(),
        "run": {"at": now.isoformat(timespec="seconds"), "date": day.isoformat(), "since": iso(since), "dry_run": dry_run,
                "offline": offline, "targets": n_targets, "read": read, "from_cache": cached, "fetched": read - cached,
                "skipped": len(skipped), "unreadable": len(unreadable)},
        "note": note,
        "counts": counts,
        "changes": rows,
        "unchanged": sorted(unchanged),
        "skipped": skipped,
        "unreadable": unreadable,
        "blocked_hosts": blocked,
    }


def _money(v: Any) -> str:
    return f"${v:,.0f}" if isinstance(v, (int, float)) and abs(v) >= 100 else ("-" if v is None else str(v))


def digest_markdown(d: dict) -> str:
    r = d["run"]
    lines = [f"# Monitor digest, {d['generated']}" + (" (dry run)" if r["dry_run"] else ""), ""]
    since = f" since {r['since']}" if r.get("since") else " since the previous reading"
    lines.append(f"{sum(d['counts'].values())} change(s){since}. {r['read']} of {r['targets']} page(s) read "
                 f"({r['fetched']} fetched, {r['from_cache']} from cache), {r['skipped']} skipped, {r['unreadable']} unclear or unreadable.")
    if d.get("note"):
        lines += ["", d["note"]]
    if d["changes"]:
        lines += ["", "## Changes", "", "| Listing | What | From | To | Seen | Host |", "|---|---|---|---|---|---|"]
        for c in d["changes"]:
            what = c["type"] + (f" ({c['field']})" if c.get("field") and c["type"] != "gone" else "")
            lines.append(f"| {c.get('name') or c['id']} | {what} | {_money(c['from'])} | {_money(c['to'])} | {c['date']} | {c.get('host') or ''} |")
    if d["skipped"]:
        lines += ["", "## Skipped", ""]
        by_reason: dict[str, list[str]] = {}
        for s in d["skipped"]:
            by_reason.setdefault(s["reason"], []).append(s["id"])
        lines += [f"- {reason}: {', '.join(ids[:8])}{' ...' if len(ids) > 8 else ''}" for reason, ids in by_reason.items()]
    if d["unreadable"]:
        lines += ["", "## Read but unclear", ""] + [f"- {u['id']}: {u['reason']}" for u in d["unreadable"][:20]]
    if d["unchanged"]:
        lines += ["", f"Unchanged: {len(d['unchanged'])} listing(s)."]
    lines += ["", "A reading is what one page said on one day. Confirm anything that matters with the leasing office before acting.", ""]
    return "\n".join(lines)


def digest_export(root: Path, today: Any = None) -> dict:
    """The digest for the dashboard: the latest one written by ``apartmentscout monitor``, or an empty stub."""
    p = monitor_dir(root) / "digest.json"
    if p.exists():
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(d, dict) and d.get("changes") is not None:
                return d
        except ValueError:
            pass
    return {"schema_version": SCHEMA_VERSION, "generated": as_of(today).isoformat(), "run": None,
            "note": "No monitor run yet. `apartmentscout monitor` re-checks the watchlist and writes a digest here.",
            "counts": {}, "changes": [], "unchanged": [], "skipped": [], "unreadable": [], "blocked_hosts": {}}
