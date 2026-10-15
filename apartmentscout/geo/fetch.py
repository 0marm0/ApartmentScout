"""Polite, cached JSON fetching for the site model (Socrata and Overpass).

Responses are cached as JSON under ``<search>/cache/site/`` keyed by a hash of the request, so a
re-run of ``apartmentscout site`` does not hit the network again. Transient failures (429, 5xx,
timeouts) are retried with backoff; Overpass rotates through mirrors.

Every response gets a *receipt* stored next to the cached payload (``<name>.receipt.json``): the
query URL, row count, the ``$limit`` and whether it was hit (a hit means rows were probably cut
off), when it was retrieved, the dataset's own "rows last updated" time from the Socrata metadata
endpoint, and the sha256 of the cached file. Wrap calls in ``with collect_receipts() as rc:`` to
gather the receipts of everything a command read (cache hits included); ``summarise_receipts``
condenses them for the site JSON and the dossier.
"""
from __future__ import annotations

import contextlib
import contextvars
import datetime as dt
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any, Iterator

import requests

log = logging.getLogger(__name__)

UA = {"User-Agent": "ApartmentScout/0.1 (apartment research toolkit)"}
SOCRATA = "https://data.cityofnewyork.us/resource/{}.json"
SOCRATA_META = "https://data.cityofnewyork.us/api/views/{}.json"
DATASET_NAMES = {"5zhs-2jue": "NYC Building Footprints", "64uk-42ks": "PLUTO", "inkn-q76z": "CSCL Street Centerline",
                 "w9ak-ipjd": "DOB NOW job filings", "i38t-6if2": "Digital Tax Map lots",
                 "erm2-nwe9": "311 Service Requests", "wvxf-dwi5": "HPD violations", "ygpa-z7cr": "HPD complaints",
                 "eabe-havv": "DOB complaints", "6bgk-3dad": "ECB violations", "wz6d-d3jb": "Bedbug reports",
                 "5uac-w243": "NYPD complaints", "overpass": "OpenStreetMap (Overpass)",
                 "uvpi-gqnh": "NYC Street Tree Census 2015", "pjs3-c3z5": "NYC Planimetric Hydrography",
                 "enfh-gkve": "NYC Parks Properties", "mk9u-qu7i": "NYC Greenstreets", "y6ja-fw4f": "NYC Planimetric Open Space (Parks)",
                 "hn5i-inap": "NYC Parks Forestry Tree Points"}
_RECEIPTS: contextvars.ContextVar[list | None] = contextvars.ContextVar("receipts", default=None)


@contextlib.contextmanager
def collect_receipts() -> Iterator[list[dict]]:
    """Collect the receipt of every socrata/overpass call made inside the block."""
    token = _RECEIPTS.set([])
    try:
        yield _RECEIPTS.get()  # type: ignore[misc]
    finally:
        _RECEIPTS.reset(token)


def note_receipt(r: dict) -> None:
    sink = _RECEIPTS.get()
    if sink is not None:
        sink.append(r)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def query_url(base: str, params: dict) -> str:
    return requests.Request("GET", base, params=params).prepare().url or base


def make_receipt(dataset: str, url: str, rows: int, limit: int | None, sha256: str | None,
                 retrieved: str | None = None, rows_updated: str | None = None, cached: bool = False) -> dict:
    r = {"dataset": dataset, "name": DATASET_NAMES.get(dataset), "url": url, "rows": rows, "limit": limit,
         "limit_hit": bool(limit) and rows >= int(limit), "retrieved": retrieved or _now(),
         "rows_updated": rows_updated, "sha256": sha256, "cached": cached}
    return {k: v for k, v in r.items() if v is not None}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def rows_updated(dataset: str, cache_dir: Path | None = None) -> str | None:
    """The dataset's "rows last updated" time (UTC ISO) from Socrata metadata; cached for a day."""
    name = f"meta-{dataset}.json"
    hit = _cache_read(cache_dir, name, 1)
    if hit is None:
        try:
            r = requests.get(SOCRATA_META.format(dataset), timeout=15, headers=UA)
            r.raise_for_status()
            js = r.json()
            hit = {"rowsUpdatedAt": js.get("rowsUpdatedAt"), "name": js.get("name")}
            _cache_write(cache_dir, name, hit)
        except (requests.RequestException, ValueError):
            return None
    ts = hit.get("rowsUpdatedAt")
    return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).isoformat(timespec="seconds") if ts else None


def _receipt_path(cache_dir: Path | None, name: str) -> Path | None:
    return Path(cache_dir) / (name[:-5] + ".receipt.json") if cache_dir is not None else None


def _write_receipt(cache_dir: Path | None, name: str, receipt: dict) -> None:
    p = _receipt_path(cache_dir, name)
    if p is not None:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(receipt, indent=1))


def _cached_receipt(cache_dir: Path | None, name: str, dataset: str, url: str, data: list,
                    limit: int | None) -> dict:
    """Receipt for a cache hit: the stored one, else rebuilt from the cached file."""
    p = _receipt_path(cache_dir, name)
    if p is not None and p.exists():
        try:
            return {**json.loads(p.read_text()), "cached": True}
        except (OSError, json.JSONDecodeError):
            pass
    f = Path(cache_dir) / name if cache_dir is not None else None
    sha = sha256_bytes(f.read_bytes()) if f is not None and f.exists() else None
    when = dt.datetime.fromtimestamp(f.stat().st_mtime, dt.timezone.utc).isoformat(timespec="seconds") \
        if f is not None and f.exists() else None
    upd = rows_updated(dataset, cache_dir) if dataset != "overpass" else None
    r = make_receipt(dataset, url, len(data), limit, sha, when, rows_updated=upd, cached=True)
    _write_receipt(cache_dir, name, {k: v for k, v in r.items() if k != "cached"})
    return r


def summarise_receipts(receipts: list[dict], max_url: int = 600) -> list[dict]:
    """One entry per dataset: calls, rows, limit_hit, last retrieved, rows_updated and each query's
    sha256 (first 16 hex) with its URL when short enough to be useful."""
    by: dict[str, dict] = {}
    for r in receipts:
        d = by.setdefault(r["dataset"], {"dataset": r["dataset"], "name": r.get("name"), "calls": 0, "rows": 0,
                                         "limit_hit": False, "retrieved": None, "rows_updated": None,
                                         "queries": []})
        d["calls"] += 1
        d["rows"] += int(r.get("rows") or 0)
        d["limit_hit"] = d["limit_hit"] or bool(r.get("limit_hit"))
        d["retrieved"] = max(filter(None, [d["retrieved"], r.get("retrieved")]), default=None)
        d["rows_updated"] = r.get("rows_updated") or d["rows_updated"]
        q = {"rows": r.get("rows"), "sha256": (r.get("sha256") or "")[:16] or None,
             "limit_hit": bool(r.get("limit_hit"))}
        if r.get("url") and len(r["url"]) <= max_url:
            q["url"] = r["url"]
        d["queries"].append({k: v for k, v in q.items() if v is not None})
    return [{k: v for k, v in d.items() if v is not None} for d in by.values()]
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]


def _key(kind: str, payload: Any) -> str:
    h = hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]
    return f"{kind}-{h}.json"


def _cache_read(cache_dir: Path | None, name: str, max_age_days: float | None) -> Any:
    if cache_dir is None:
        return None
    p = Path(cache_dir) / name
    if not p.exists():
        return None
    if max_age_days is not None and time.time() - p.stat().st_mtime > max_age_days * 86400:
        return None
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _cache_write(cache_dir: Path | None, name: str, data: Any) -> bytes:
    """Write the payload (when caching) and return the exact bytes, for the receipt's sha256."""
    blob = json.dumps(data, separators=(",", ":")).encode()
    if cache_dir is None:
        return blob
    d = Path(cache_dir)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (name + ".tmp")
    tmp.write_bytes(blob)
    tmp.replace(d / name)
    return blob


def _with_retry(fn, tries: int = 4, base_wait: float = 2.0):
    last: Exception | None = None
    for k in range(tries):
        try:
            r = fn()
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as e:
            last = e
            resp = getattr(e, "response", None)
            if resp is not None and resp.status_code in (400, 401, 403, 404):
                break
            time.sleep(base_wait * (2 ** k))
    raise RuntimeError(f"request failed after {tries} tries: {last}")


def socrata(dataset: str, params: dict, cache_dir: Path | None = None, max_age_days: float | None = 30,
            refresh: bool = False, timeout: float = 120) -> list[dict]:
    """GET a Socrata (NYC Open Data) query, cached."""
    name = _key(f"socrata-{dataset}", params)
    url = SOCRATA.format(dataset)
    full = query_url(url, params)
    limit = int(params["$limit"]) if params.get("$limit") else None
    if not refresh:
        hit = _cache_read(cache_dir, name, max_age_days)
        if hit is not None:
            note_receipt(_cached_receipt(cache_dir, name, dataset, full, hit, limit))
            return hit
    data = _with_retry(lambda: requests.get(url, params=params, timeout=timeout, headers=UA))
    if not isinstance(data, list):
        raise RuntimeError(f"unexpected Socrata response for {dataset}: {str(data)[:200]}")
    blob = _cache_write(cache_dir, name, data)
    receipt = make_receipt(dataset, full, len(data), limit, sha256_bytes(blob),
                           rows_updated=rows_updated(dataset, cache_dir))
    _write_receipt(cache_dir, name, receipt)
    if receipt["limit_hit"]:
        log.warning("%s returned exactly $limit=%s rows: results are probably cut off", dataset, limit)
    note_receipt(receipt)
    return data


def overpass(query: str, cache_dir: Path | None = None, max_age_days: float | None = 30,
             refresh: bool = False) -> list[dict]:
    """POST an Overpass QL query (``out geom``), cached; tries each mirror in turn."""
    name = _key("overpass", query)
    qid = "overpass:" + hashlib.sha1(query.encode()).hexdigest()[:12]
    if not refresh:
        hit = _cache_read(cache_dir, name, max_age_days)
        if hit is not None:
            note_receipt(_cached_receipt(cache_dir, name, "overpass", qid, hit, None))
            return hit
    last: Exception | None = None
    for ep in OVERPASS:
        try:
            data = _with_retry(lambda: requests.post(ep, data={"data": query}, timeout=(15, 180), headers=UA),
                               tries=2)
            els = data.get("elements", [])
            blob = _cache_write(cache_dir, name, els)
            base = (data.get("osm3s") or {}).get("timestamp_osm_base")
            receipt = make_receipt("overpass", f"{ep} {qid}", len(els), None, sha256_bytes(blob), rows_updated=base)
            _write_receipt(cache_dir, name, receipt)
            note_receipt(receipt)
            return els
        except RuntimeError as e:
            last = e
            log.info("overpass mirror %s failed: %s", ep, e)
    raise RuntimeError(f"Overpass unavailable: {last}")
