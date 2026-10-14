"""Station entrances: where you actually step off the street into a station.

A big station complex is not a point. Grand Central-42 St, Times Sq-42 St, 34 St-Herald Sq, Fulton St
and 14 St-Union Sq have stairs spread over several blocks, so the walk to "the station" is the walk to
the nearest usable stair, not to the GTFS stop's centroid. The router walks the street network to each
entrance and adds the station's street-to-platform time (station_access_min) as before.

Sources:
- NYC: the MTA's "Subway Entrances and Exits: 2024" (data.ny.gov, i9wp-a4ja). Each entrance names its
  station by GTFS stop id (parent station, e.g. "R11"; a few name two, "718; R09"), and says whether it
  can be used to enter, to exit or both (exit-only stairs serve the destination end only).
- Elsewhere (or `station_entrances: osm`): OpenStreetMap railway=subway_entrance /
  train_station_entrance nodes, each given to the nearest rail or subway station within 250 m.
Stops without entrance data use their own coordinates (bus stops always do: the kerb is the entrance).
"""
from __future__ import annotations

import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests

from ..geo import fetch as F
from .gtfs import MODE_BIT, Network, _rows

NY_DATA = "https://data.ny.gov/resource/{}.json"
CITY_ENTRANCES = {"nyc": {"dataset": "i9wp-a4ja", "domain": "data.ny.gov"}}
F.DATASET_NAMES.setdefault("i9wp-a4ja", "MTA Subway Entrances and Exits: 2024")
MAX_FROM_STATION_M = 400  # an entrance farther than this from its station's platforms is a data error


@dataclass(frozen=True)
class Entrance:
    station: str  # GTFS stop id of the (parent) station, without feed prefix
    lat: float
    lon: float
    entry: bool = True
    exit: bool = True
    kind: str = ""
    name: str = ""  # the station's name in the source (e.g. "Times Sq-42 St"), for the same-complex fallback


def socrata_ny(dataset: str, params: dict, cache_dir: Path | None, max_age_days: float = 60) -> list[dict]:
    """A data.ny.gov Socrata query, cached with a receipt like geo.fetch.socrata (which serves NYC Open Data)."""
    name = F._key(f"socrata-{dataset}", params)
    url = NY_DATA.format(dataset)
    full = F.query_url(url, params)
    limit = int(params["$limit"]) if params.get("$limit") else None
    hit = F._cache_read(cache_dir, name, max_age_days)
    if hit is not None:
        F.note_receipt({**F.make_receipt(dataset, full, len(hit), limit, None, cached=True),
                        **(_stored_receipt(cache_dir, name) or {}), "cached": True})
        return hit
    data = F._with_retry(lambda: requests.get(url, params=params, timeout=60, headers=F.UA))
    if not isinstance(data, list):
        raise RuntimeError(f"unexpected Socrata response for {dataset}: {str(data)[:200]}")
    blob = F._cache_write(cache_dir, name, data)
    receipt = F.make_receipt(dataset, full, len(data), limit, F.sha256_bytes(blob))
    F._write_receipt(cache_dir, name, receipt)
    F.note_receipt(receipt)
    return data


def _stored_receipt(cache_dir: Path | None, name: str) -> dict | None:
    import json
    p = F._receipt_path(cache_dir, name)
    try:
        return json.loads(p.read_text()) if p is not None and p.exists() else None
    except (OSError, ValueError):
        return None


def parse_mta(rows: list[dict]) -> list[Entrance]:
    out = []
    for r in rows:
        try:
            la, lo = float(r["entrance_latitude"]), float(r["entrance_longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        for sid in str(r.get("gtfs_stop_id") or "").replace(",", ";").split(";"):
            sid = sid.strip()
            if sid:
                out.append(Entrance(sid, la, lo, (r.get("entry_allowed") or "YES").upper() == "YES",
                                    (r.get("exit_allowed") or "YES").upper() == "YES", r.get("entrance_type") or "",
                                    str(r.get("stop_name") or "")))
    return out


def load_entrances(source, cache_dir: Path | None, bbox, log=print) -> list[Entrance]:
    """Entrances from a source spec: 'nyc' / {dataset, domain} (MTA), 'osm', or a list of dicts
    {station, lat, lon[, entry, exit]}. [] when there is none or the download fails."""
    if not source:
        return []
    try:
        if isinstance(source, list):
            return [Entrance(str(e["station"]), float(e["lat"]), float(e["lon"]), bool(e.get("entry", True)),
                             bool(e.get("exit", True))) for e in source]
        if isinstance(source, str) and source in CITY_ENTRANCES:
            source = CITY_ENTRANCES[source]
        if isinstance(source, dict) and source.get("dataset"):
            lon0, lat0, lon1, lat1 = bbox
            rows = socrata_ny(source["dataset"], {
                "$limit": 50000,
                "$where": f"entrance_latitude between {lat0:.5f} and {lat1:.5f} and "
                          f"entrance_longitude between {lon0:.5f} and {lon1:.5f}"}, cache_dir)
            return parse_mta(rows)
        if source == "osm":
            lon0, lat0, lon1, lat1 = bbox
            q = (f'[out:json][timeout:120];node["railway"~"^(subway_entrance|train_station_entrance)$"]'
                 f'({lat0:.5f},{lon0:.5f},{lat1:.5f},{lon1:.5f});out;')
            els = F.overpass(q, cache_dir=cache_dir, max_age_days=120)
            return [Entrance("", e["lat"], e["lon"], (e.get("tags") or {}).get("entrance") != "exit",
                             True, "osm") for e in els if e.get("type") == "node"]
    except (RuntimeError, OSError, ValueError, requests.RequestException) as e:
        log(f"  entrances: could not load {source} ({e}); stations are entered at their GTFS coordinates")
    return []


def parent_map(feeds: list[tuple]) -> dict[str, str]:
    """'prefix:platform stop id' -> station id (parent_station, else the stop itself), for every feed."""
    out: dict[str, str] = {}
    for spec in feeds:
        prefix, path = spec[0], Path(spec[1])
        with zipfile.ZipFile(path) as z:
            for sid, parent in _rows(z, "stops.txt", ["stop_id", "parent_station"]):
                out[f"{prefix}:{sid}"] = parent or sid
    return out


def access_points(net: Network, entrances: list[Entrance], parents: dict[str, str],
                  modes: tuple[str, ...] = ("subway", "rail")) -> tuple[dict[int, list[tuple[float, float]]],
                                                                       dict[int, list[tuple[float, float]]], dict]:
    """Where each stop is entered and left: ({stop: [(lat, lon) to enter]}, {stop: [(lat, lon) to exit]}, stats).

    Stops of `modes` with entrances get them; every other stop (and any without data) gets its own point.
    A station the source lists no entrances for (the MTA files some complexes' stairs under one
    constituent: Times Sq 7, Fulton St A/C, 14 St-Union Sq L) borrows those of same-named stations within
    MAX_FROM_STATION_M. OSM entrances (no station id) go to the nearest station of those modes within 250 m.
    """
    bits = sum(MODE_BIT[m] for m in modes)
    by_station: dict[str, list[Entrance]] = defaultdict(list)
    named = [e for e in entrances if e.station]
    by_name: dict[str, list[Entrance]] = defaultdict(list)
    for e in named:
        by_station[e.station].append(e)
        if e.name:
            by_name[e.name.lower()].append(e)
    unnamed = [e for e in entrances if not e.station]
    if unnamed:
        st = {}
        for i, sid in enumerate(net.stop_ids):
            if net.stop_mask[i] & bits:
                st.setdefault(parents.get(sid, sid), (net.lat[i], net.lon[i]))
        keys = list(st)
        if keys:
            sl = np.array([st[k][0] for k in keys])
            so = np.array([st[k][1] for k in keys])
            for e in unnamed:
                d = np.hypot((sl - e.lat) * 110574, (so - e.lon) * 84000)
                j = int(np.argmin(d))
                if d[j] <= 250:
                    by_station[keys[j].split(":", 1)[-1]].append(e)
    enter: dict[int, list[tuple[float, float]]] = {}
    leave: dict[int, list[tuple[float, float]]] = {}
    with_ent = 0
    for i, sid in enumerate(net.stop_ids):
        own = [(net.lat[i], net.lon[i])]
        ents = []
        if net.stop_mask[i] & bits or (not net.stop_mask[i] and sid in parents and parents[sid] != sid):
            station = parents.get(sid, sid).split(":", 1)[-1]
            near = lambda es: [e for e in es if abs(e.lat - net.lat[i]) * 110574 < MAX_FROM_STATION_M  # noqa: E731
                               and abs(e.lon - net.lon[i]) * 84000 < MAX_FROM_STATION_M]
            ents = near(by_station.get(station, ()))
            if not ents and station not in by_station:
                ents = near(by_name.get(str(net.stop_name[i]).lower(), ()))
        a = [(e.lat, e.lon) for e in ents if e.entry]
        b = [(e.lat, e.lon) for e in ents if e.exit]
        if a or b:
            with_ent += 1
        enter[i] = a or own
        leave[i] = b or own
    stats = {"entrances": len(entrances), "stops_with_entrances": with_ent,
             "stations_with_entrances": len({k for k, v in by_station.items() if v})}
    return enter, leave, stats
