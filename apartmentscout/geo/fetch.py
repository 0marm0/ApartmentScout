"""Polite, cached JSON fetching for the site model (Socrata and Overpass).

Responses are cached as JSON under ``<search>/cache/site/`` keyed by a hash of the request, so a
re-run of ``apartmentscout site`` does not hit the network again. Transient failures (429, 5xx,
timeouts) are retried with backoff; Overpass rotates through mirrors.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger(__name__)

UA = {"User-Agent": "ApartmentScout/0.1 (apartment research toolkit)"}
SOCRATA = "https://data.cityofnewyork.us/resource/{}.json"
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


def _cache_write(cache_dir: Path | None, name: str, data: Any) -> None:
    if cache_dir is None:
        return
    d = Path(cache_dir)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (name + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(d / name)


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
    if not refresh:
        hit = _cache_read(cache_dir, name, max_age_days)
        if hit is not None:
            return hit
    url = SOCRATA.format(dataset)
    data = _with_retry(lambda: requests.get(url, params=params, timeout=timeout, headers=UA))
    if not isinstance(data, list):
        raise RuntimeError(f"unexpected Socrata response for {dataset}: {str(data)[:200]}")
    _cache_write(cache_dir, name, data)
    return data


def overpass(query: str, cache_dir: Path | None = None, max_age_days: float | None = 30,
             refresh: bool = False) -> list[dict]:
    """POST an Overpass QL query (``out geom``), cached; tries each mirror in turn."""
    name = _key("overpass", query)
    if not refresh:
        hit = _cache_read(cache_dir, name, max_age_days)
        if hit is not None:
            return hit
    last: Exception | None = None
    for ep in OVERPASS:
        try:
            data = _with_retry(lambda: requests.post(ep, data={"data": query}, timeout=(15, 180), headers=UA),
                               tries=2)
            els = data.get("elements", [])
            _cache_write(cache_dir, name, els)
            return els
        except RuntimeError as e:
            last = e
            log.info("overpass mirror %s failed: %s", ep, e)
    raise RuntimeError(f"Overpass unavailable: {last}")
