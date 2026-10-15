"""Noise complaints by hour of the day and day of the week.

``layers.nyc_noise_layer`` counts 311 noise requests per map cell. This module keeps the *time* of each request, so the
dashboard can answer "when is it loud here": a map of complaints by hour (an hour slider), a clock chart in the listing
drawer, and a sentence such as "loudest Fri-Sat 11 pm-2 am, mostly bars and street crowds".

These are complaints, not decibels. A request is somebody phoning 311; how many phone depends on who lives nearby,
whether they trust the service, and whether the source is the sort of noise people report. Counts compare hours of one
place well, and places only roughly. Every label in the dashboard says so.

Two conventions, both stated in the layer file:

* **Nights belong to the evening before.** A request logged at 1 am on Saturday is part of Friday night. The day class of a
  request is the weekday of ``created - 5 hours``: ``sunthu`` (Sunday to Thursday nights, the nights before a work day)
  and ``frisat`` (Friday and Saturday nights). The hour stays the clock hour, so 1 am is hour 1 of class ``frisat``.
* **Why two classes and not seven days.** Seven days by 24 hours by thousands of cells would be megabytes; two classes keep
  the file small and still separate the nights that differ most. A single building (``by_week``) keeps all 7 x 24.

Files (all written by ``apartmentscout layers``, all optional):

``layers/noise-hours.json``  ``{"kind": "noise-hours", ...}``
    ``hours_z``  one entry per day class; each is a zlib+base64 byte array [24][rows*cols] of log-quantised counts on the
                 same cells as ``noise.json`` (``q = round(log1p(count) * log_k)``, count = ``expm1(q / log_k)``)
    ``mix``      the same on 3 x 3 coarser cells (about 450 m): [class][bucket][group][cell], where bucket = ((hour - 2) % 24) // 4
                 (2-6, 6-10, 10-14, 14-18, 18-22, 22-2) and group = the kind of source (bars, street, home, vehicle, build, equip)
    ``days``     how many nights of each class the period holds, to turn counts into a rate per night
``research/dossiers/<id>.json``  ``noise_311.by_week`` (7 x 24, Monday first, clock hour) and ``by_hour_group`` (groups x 24)
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import math
import zlib
from collections.abc import Iterable, Iterator
from pathlib import Path

import numpy as np

SHIFT_H = 5                       # hours after midnight that still belong to the evening before
CLASSES = [("sunthu", "Sun-Thu nights"), ("frisat", "Fri-Sat nights")]
BUCKETS = ["2-6 am", "6-10 am", "10 am-2 pm", "2-6 pm", "6-10 pm", "10 pm-2 am"]
GROUPS = [("bars", "Bars, clubs and restaurants"), ("street", "Street, crowds and parks"),
          ("home", "Neighbours"), ("vehicle", "Traffic, horns and helicopters"),
          ("build", "Construction"), ("equip", "Alarms, dogs and building equipment")]
MIX_BLOCK = 3                     # mix cells are MIX_BLOCK x MIX_BLOCK of the hour cells
_BUILD = ("construction", "jack", "(nc1)", "(nc2)", "nm1")
_VEHICLE_DESC = ("carting", "garbage", "ice cream")


def group_of(complaint_type: str | None, descriptor: str | None) -> int:
    """Index into GROUPS for a 311 noise request: where the noise comes from, by the complaint category."""
    ct, ds = (complaint_type or "").lower(), (descriptor or "").lower()
    if any(k in ds for k in _BUILD):
        return 4
    if "commercial" in ct:
        return 0
    if "street" in ct or "park" in ct or "worship" in ct:
        return 1
    if "residential" in ct:
        return 2
    if "vehicle" in ct or "helicopter" in ct or any(k in ds for k in _VEHICLE_DESC):
        return 3
    return 5


def parse_created(created: str) -> tuple[dt.datetime, int, int, int]:
    """(timestamp, clock hour, calendar weekday 0=Monday, day class 0/1) of a 311 ``created_date``."""
    t = dt.datetime.fromisoformat(str(created)[:19])
    return t, t.hour, t.weekday(), night_class(t)


def night_class(t: dt.datetime) -> int:
    """0 = a Sun-Thu night (and its day), 1 = a Fri-Sat night: the weekday of ``t - SHIFT_H`` decides."""
    return 1 if (t - dt.timedelta(hours=SHIFT_H)).weekday() in (4, 5) else 0


def bucket_of(hour: int) -> int:
    return ((hour - 2) % 24) // 4


def count_days(since: dt.date, until: dt.date) -> list[int]:
    """How many days of each class lie in [since, until] (a day is Fri-Sat or not by its own weekday)."""
    n = [0, 0]
    d = since
    while d <= until:
        n[1 if d.weekday() in (4, 5) else 0] += 1
        d += dt.timedelta(days=1)
    return n


# ---------------------------------------------------------------- accumulating rows


class Grid:
    """The cells of a noise layer: same bbox, rows, cols and cell size as noise.json so the overlays line up."""

    def __init__(self, bbox: list[float], cell_m: float = 150, rows: int | None = None, cols: int | None = None):
        self.lon0, self.lat0, self.lon1, self.lat1 = bbox
        self.cell_m = cell_m
        self.dlat = cell_m / 110574
        self.dlon = cell_m / (111320 * math.cos(math.radians((self.lat0 + self.lat1) / 2)))
        self.rows = rows or int((self.lat1 - self.lat0) / self.dlat) + 1
        self.cols = cols or int((self.lon1 - self.lon0) / self.dlon) + 1
        self.bbox = bbox

    def cell(self, lat: float, lon: float) -> int | None:
        r, c = int((lat - self.lat0) / self.dlat), int((lon - self.lon0) / self.dlon)
        return r * self.cols + c if 0 <= r < self.rows and 0 <= c < self.cols else None


class Accum:
    """Counts of 311 noise requests by class x hour x cell, and (coarser) class x bucket x group x cell."""

    def __init__(self, grid: Grid):
        self.grid = grid
        self.mr, self.mc = -(-grid.rows // MIX_BLOCK), -(-grid.cols // MIX_BLOCK)
        self.hours = np.zeros((2, 24, grid.rows * grid.cols), dtype=np.uint32)
        self.mix = np.zeros((2, len(BUCKETS), len(GROUPS), self.mr * self.mc), dtype=np.uint32)
        self.n = 0
        self.first: dt.datetime | None = None
        self.last: dt.datetime | None = None

    def add(self, rows: Iterable[dict]) -> None:
        g = self.grid
        for p in rows:
            try:
                la, lo = float(p["latitude"]), float(p["longitude"])
                t, hour, _wd, k = parse_created(p["created_date"])
            except (KeyError, TypeError, ValueError):
                continue
            ci = g.cell(la, lo)
            if ci is None:
                continue
            self.hours[k, hour, ci] += 1
            r, c = divmod(ci, g.cols)
            self.mix[k, bucket_of(hour), group_of(p.get("complaint_type"), p.get("descriptor")),
                     (r // MIX_BLOCK) * self.mc + c // MIX_BLOCK] += 1
            self.n += 1
            self.first = t if self.first is None or t < self.first else self.first
            self.last = t if self.last is None or t > self.last else self.last


def _z(a: np.ndarray) -> str:
    return base64.b64encode(zlib.compress(a.astype(np.uint8).tobytes(), 9)).decode("ascii")


def quantise(counts: np.ndarray, k: float) -> np.ndarray:
    return np.clip(np.round(np.log1p(counts.astype(float)) * k), 0, 255).astype(np.uint8)


def dequantise(q: np.ndarray, k: float) -> np.ndarray:
    return np.expm1(q.astype(float) / k)


def log_k(maximum: int) -> float:
    """Scale so the biggest count fits a byte, rounded down to a tidy number (small counts then keep the finest steps)."""
    return float(math.floor(255 / math.log1p(max(1, maximum))))


def layer_from(acc: Accum, since: dt.date, until: dt.date, months: int, source: str = "") -> dict:
    """The noise-hours layer document for an Accum."""
    g = acc.grid
    k1, k2 = log_k(int(acc.hours.max())), log_k(int(acc.mix.max()))
    return {"kind": "noise-hours", "name": "311 noise complaints by hour", "months": months, "since": since.isoformat(),
            "until": until.isoformat(), "bbox": g.bbox, "rows": g.rows, "cols": g.cols, "cell_m": g.cell_m,
            "classes": [{"id": i, "label": lab} for i, lab in CLASSES], "night_shift_h": SHIFT_H,
            "days": count_days(since, until), "log_k": k1,
            "hours_z": [_z(quantise(acc.hours[k], k1)) for k in range(2)],
            "mix": {"cell_m": g.cell_m * MIX_BLOCK, "block": MIX_BLOCK, "rows": acc.mr, "cols": acc.mc, "log_k": k2,
                    "buckets": BUCKETS, "groups": [{"id": i, "label": lab} for i, lab in GROUPS], "z": _z(quantise(acc.mix, k2))},
            "total": acc.n, "unit": "311 noise complaints logged (reports, not decibels)",
            "generated": dt.datetime.now().isoformat(timespec="seconds"), "source": source}


def read_layer(doc: dict) -> tuple[np.ndarray, np.ndarray]:
    """(hours [2][24][cells], mix [2][buckets][groups][cells]) counts from a layer document (the inverse of layer_from)."""
    cells = doc["rows"] * doc["cols"]
    hours = np.stack([dequantise(np.frombuffer(zlib.decompress(base64.b64decode(z)), dtype=np.uint8).reshape(24, cells), doc["log_k"])
                      for z in doc["hours_z"]])
    m = doc["mix"]
    mix = dequantise(np.frombuffer(zlib.decompress(base64.b64decode(m["z"])), dtype=np.uint8), m["log_k"])
    return np.rint(hours), np.rint(mix.reshape(2, len(m["buckets"]), len(m["groups"]), m["rows"] * m["cols"]))


# ---------------------------------------------------------------- buildings (dossiers)


def week_profile(rows: Iterable[dict], since: dt.date | None = None, until: dt.date | None = None) -> dict:
    """``by_week`` (7 x 24, Monday first, clock hour) and ``by_hour_group`` (groups x 24) for the requests of one place,
    plus how many days of each class the period holds when the period is known."""
    week = [[0] * 24 for _ in range(7)]
    grp = [[0] * 24 for _ in GROUPS]
    for p in rows:
        try:
            _t, h, wd, _k = parse_created(p["created_date"])
        except (KeyError, TypeError, ValueError):
            continue
        week[wd][h] += 1
        grp[group_of(p.get("complaint_type"), p.get("descriptor"))][h] += 1
    out = {"by_week": week, "by_hour_group": grp}
    if since and until:
        out["week_days"] = count_days(since, until)
    return out


def classes_from_week(by_week: list[list[int]]) -> list[list[int]]:
    """A building's 7 x 24 calendar counts as [class][hour], with the night-of rule (hours before 5 am count to the day before)."""
    out = [[0] * 24 for _ in range(2)]
    for wd in range(7):
        for h in range(24):
            day = wd if h >= SHIFT_H else (wd - 1) % 7
            out[1 if day in (4, 5) else 0][h] += by_week[wd][h]
    return out


def peak_window(per_class: list[list[float]], days: list[float], width: int = 3) -> dict | None:
    """The loudest ``width`` consecutive hours (wrapping past midnight) as a rate per night: {cls, start, hours, rate, share}.

    per_class is [class][hour] counts, days the number of nights of each class. ``share`` is the window's part of that
    class's day total; ``ratio`` how many times the average hour of the whole week it exceeds."""
    total = sum(sum(c) for c in per_class)
    if total <= 0:
        return None
    best = None
    for k, hrs in enumerate(per_class):
        nights = max(1.0, float(days[k]))
        for s in range(24):
            w = sum(hrs[(s + i) % 24] for i in range(width))
            rate = w / nights
            if best is None or rate > best["rate"]:
                best = {"cls": k, "start": s, "hours": width, "rate": rate, "count": w,
                        "share": w / max(1, sum(hrs))}
    mean_hour = total / (24.0 * max(1.0, sum(days) / 2.0))
    best["ratio"] = best["rate"] / width / mean_hour if mean_hour else None
    return best


def patch_dossier(D: dict, cache_dir: Path | None = None, log=print) -> bool:
    """Add ``by_week`` / ``by_hour_group`` / ``week_days`` to a dossier that predates them, from the same 311 query (the
    requests within its radius over its own window). Everything else in the dossier is left as it was. False when
    there is nothing to add (already has them, no coordinates, not NYC records)."""
    from .geo.fetch import socrata
    nz = D.get("noise_311")
    lat, lon = D.get("lat"), D.get("lon")
    if not isinstance(nz, dict) or "by_week" in nz or lat is None or lon is None or not nz.get("radius_m"):
        return False
    gen = dt.date.fromisoformat(str(D.get("generated") or dt.date.today())[:10])
    since = gen - dt.timedelta(days=int(365 * float(D.get("window_years") or 3)))
    rows = socrata("erm2-nwe9", {
        "$where": f"within_circle(location,{lat},{lon},{nz['radius_m']}) AND complaint_type like 'Noise%' AND "
                  f"created_date >= '{since.isoformat()}' AND created_date < '{(gen + dt.timedelta(days=1)).isoformat()}'",
        "$select": "created_date,complaint_type,descriptor", "$limit": 50000}, cache_dir=cache_dir, max_age_days=60)
    wk = week_profile(rows, since, gen)
    nz.update(wk)
    seen = sum(sum(r) for r in wk["by_week"])
    if nz.get("nearby_total") and abs(seen - nz["nearby_total"]) > max(5, 0.05 * nz["nearby_total"]):
        log(f"    {D.get('id')}: {seen} requests by the hour against {nz['nearby_total']} in the dossier (the dataset has moved on)")
    return True


def patch_dossiers(ws, log=print) -> int:
    """Run patch_dossier over research/dossiers/*.json; returns how many were updated."""
    d = ws.research_dir / "dossiers"
    n = 0
    for p in sorted(d.glob("*.json")) if d.is_dir() else []:
        D = json.loads(p.read_text())
        try:
            changed = patch_dossier(D, ws.cache_dir / "noise311-dossiers", log)
        except Exception as e:  # noqa: BLE001 - one building's failed query must not stop the others
            log(f"    {p.stem}: skipped ({str(e)[:80]})")
            continue
        if changed:
            p.write_text(json.dumps(D, indent=1, default=str))
            n += 1
    if n:
        log(f"Noise by hour added to {n} dossiers in {d}")
    return n


# ---------------------------------------------------------------- fetching (NYC)


def iter_nyc_rows(bbox: list[float], since: dt.date, cache_dir: Path | None, log=print, page: int = 50000,
                  max_age_days: float = 30) -> Iterator[list[dict]]:
    """Pages of 311 noise requests inside ``bbox`` since ``since``: created_date, latitude, longitude, complaint_type,
    descriptor. Each page is cached under ``cache_dir`` (a re-run reads the disk), with a receipt, like the other record fetches."""
    from .geo.fetch import socrata
    lon0, lat0, lon1, lat1 = bbox
    where = (f"created_date >= '{since.isoformat()}' AND complaint_type like 'Noise%' AND "
             f"latitude between {lat0} and {lat1} AND longitude between {lon0} and {lon1}")
    offset = 0
    while True:
        rows = socrata("erm2-nwe9", {"$select": "created_date,latitude,longitude,complaint_type,descriptor", "$where": where,
                                     "$limit": page, "$offset": offset, "$order": ":id"},
                       cache_dir=cache_dir, max_age_days=max_age_days, timeout=240)
        yield rows
        log(f"    311 noise rows: {offset + len(rows):,}")
        if len(rows) < page:
            return
        offset += page


def nyc_noise_hours(ws, bbox: list[float], months: int = 12, since: dt.date | None = None, cell_m: float = 150,
                    rows: int | None = None, cols: int | None = None, log=print) -> dict:
    """Build and write layers/noise-hours.json for the NYC 311 noise requests. ``rows``/``cols`` pin the cell grid to
    an existing noise.json so the two overlays line up."""
    until = dt.date.today()
    since = since or until - dt.timedelta(days=30 * months)
    acc = Accum(Grid(bbox, cell_m, rows, cols))
    for page in iter_nyc_rows(bbox, since, ws.cache_dir / "noise311", log):
        acc.add(page)
    doc = layer_from(acc, since, until, months, "https://data.cityofnewyork.us/d/erm2-nwe9")
    out = ws.layers_dir / "noise-hours.json"
    out.write_text(json.dumps(doc, separators=(",", ":")))
    log(f"Noise by hour -> {out}  ({acc.n:,} requests, {out.stat().st_size / 1024:.0f} KB)")
    return doc
