"""Buildings filed or permitted near a site that are not in the footprints yet (best effort).

NYC only: DOB NOW: Build job application filings (NYC Open Data ``w9ak-ipjd``), job type
"New Building". Each job has several filings (initial ``I1``, amendments ``P*``, subsequent
``S*``); they are grouped by job number. Height is the latest stated ``proposed_height`` (feet),
else stories x 3.2 m + 2 m; jobs with neither are skipped rather than guessed. The footprint is the
tax lot (``i38t-6if2``), which is an upper bound: a tower usually covers less of its lot and steps
back. Without a lot polygon a 16 m square at the filing's point is used and marked as such.

Status (DOB publishes paperwork, not physical progress):

* ``proposed``            filed, under review or with objections;
* ``permit``              plans approved, no work permit yet;
* ``under-construction``  a new-building work permit has been issued;
* ``complete``            letter of completion issued but the footprint data has not caught up.

Limits: DOB NOW covers jobs filed since about 2020 (older BIS filings are not read), withdrawn and
disapproved jobs are dropped, and the lot outline and stated height say nothing about setbacks.
"""
from __future__ import annotations

import math
from pathlib import Path

from . import LocalFrame, haversine_m
from .fetch import socrata
from .shapes import clean_ring, point_in_ring

FT = 0.3048
DATASET = "w9ak-ipjd"
SOURCE = "NYC DOB NOW job filings (w9ak-ipjd)"
DEAD = ("withdrawn", "disapproved", "denied", "revoked", "cancel")
PERMIT = ("permit entire", "permit issued", "permit")
FIELDS = ("job_filing_number,filing_status,job_type,house_no,street_name,bin,bbl,proposed_no_of_stories,"
          "proposed_height,filing_date,current_status_date,latitude,longitude")


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


def _coord(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f != 0 else None


def _status(filings: list[dict]) -> str | None:
    st = [str(f.get("filing_status") or "").lower() for f in filings]
    live = [s for s in st if not any(d in s for d in DEAD)]
    if not live:
        return None
    init = [str(f.get("filing_status") or "").lower() for f in filings
            if str(f.get("job_filing_number", "")).endswith("-I1")]
    if init and "loc issued" in init[0]:
        return "complete"
    if any(s.startswith(PERMIT) or "loc issued" in s for s in live):
        return "under-construction"
    if any(s == "approved" for s in live):
        return "permit"
    return "proposed"


def group_filings(rows: list[dict]) -> list[dict]:
    """DOB NOW rows -> one record per new-building job (no personal names are read or kept)."""
    jobs: dict[str, list[dict]] = {}
    for r in rows:
        if str(r.get("job_type", "New Building")).lower() != "new building":
            continue
        num = str(r.get("job_filing_number") or "")
        if not num:
            continue
        jobs.setdefault(num.split("-")[0], []).append(r)
    out = []
    for job, fs in jobs.items():
        status = _status(fs)
        if status is None:
            continue
        latest = sorted(fs, key=lambda f: str(f.get("current_status_date") or f.get("filing_date") or ""), reverse=True)
        h_ft = next((_num(f.get("proposed_height")) for f in latest if _num(f.get("proposed_height"))), None)
        stories = next((_num(f.get("proposed_no_of_stories")) for f in latest if _num(f.get("proposed_no_of_stories"))), None)
        if h_ft:
            h, h_src = h_ft * FT, "filing-height"
        elif stories:
            h, h_src = stories * 3.2 + 2, "stories"
        else:
            continue
        lat = next((c for c in (_coord(f.get("latitude")) for f in fs) if c is not None), None)
        lon = next((c for c in (_coord(f.get("longitude")) for f in fs) if c is not None), None)
        if lat is None or lon is None:
            continue
        f0 = fs[0]
        addr = " ".join(f"{f0.get('house_no') or ''} {f0.get('street_name') or ''}".split()).title() or None
        filed = min((str(f.get("filing_date"))[:10] for f in fs if f.get("filing_date")), default=None)
        out.append({"job": job, "name": addr, "status": status, "h": round(h, 1), "h_src": h_src,
                    "stories": int(stories) if stories else None, "lat": lat, "lon": lon,
                    "bin": f0.get("bin"), "bbl": str(f0.get("bbl") or "").split(".")[0] or None, "filed": filed,
                    "url": f"https://data.cityofnewyork.us/resource/{DATASET}.json?job_filing_number={job}-I1"})
    return out


def _square(x: float, y: float, half: float = 8.0) -> list[list[float]]:
    return [[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half]]


def to_future(jobs: list[dict], frame: LocalFrame, lots: dict[str, list] | None = None,
              site: dict | None = None, min_h: float = 10.0) -> list[dict]:
    """Jobs -> site JSON ``future`` entries; drops jobs already standing in the footprints."""
    lots = lots or {}
    built = _built_heights(site) if site else []
    out = []
    for j in jobs:
        if j["h"] < min_h:
            continue
        x, y = frame.to_xy(j["lon"], j["lat"])
        lot = lots.get(j.get("bbl") or "")
        if lot:
            ring = [[round(a, 1), round(b, 1)] for a, b in clean_ring([frame.to_xy(lo, la) for lo, la in lot])]
            ring_src = "tax-lot"
        else:
            ring, ring_src = _square(round(x, 1), round(y, 1)), "point"
        if any(h >= 0.85 * j["h"] and (point_in_ring(cx, cy, ring) or (bn and bn == j.get("bin")))
               for cx, cy, h, bn in built):
            continue  # already in the footprints at about the filed height
        out.append({"name": j.get("name"), "ring": ring, "h": j["h"], "status": j["status"], "source": SOURCE,
                    "url": j.get("url"), "stories": j.get("stories"), "h_src": j["h_src"], "ring_src": ring_src,
                    "job": j["job"], "filed": j.get("filed"), "bin": j.get("bin"), "bbl": j.get("bbl")})
    return out


def _built_heights(site: dict) -> list[tuple[float, float, float, str | None]]:
    meta = site.get("bmeta") or []
    out = []
    for i, (top, g, _t, flat) in enumerate(site["b"]):
        xs, ys = flat[0::2], flat[1::2]
        bn = (meta[i] or {}).get("bin") if i < len(meta) and meta[i] else None
        out.append((sum(xs) / len(xs), sum(ys) / len(ys), top - g, bn))
    return out


def fetch_future(lat: float, lon: float, radius_m: float, site: dict, cache_dir: Path | None = None,
                 refresh: bool = False) -> list[dict]:
    d_lat = radius_m / 110574.0
    d_lon = radius_m / (111320.0 * math.cos(math.radians(lat)))
    where = (f"job_type='New Building' AND latitude::number between {lat - d_lat} and {lat + d_lat} "
             f"AND longitude::number between {lon - d_lon} and {lon + d_lon}")
    rows = socrata(DATASET, {"$where": where, "$select": FIELDS, "$limit": 5000}, cache_dir, max_age_days=7,
                   refresh=refresh)
    jobs = [j for j in group_filings(rows) if haversine_m(lat, lon, j["lat"], j["lon"]) <= radius_m]
    lots: dict[str, list] = {}
    bbls = sorted({j["bbl"] for j in jobs if j.get("bbl")})
    for i in range(0, len(bbls), 50):
        chunk = ",".join(f"'{b}'" for b in bbls[i:i + 50])
        try:
            for r in socrata("i38t-6if2", {"$where": f"bbl in ({chunk})", "$select": "bbl,the_geom", "$limit": 500},
                             cache_dir, refresh=refresh):
                g = r.get("the_geom") or {}
                polys = g.get("coordinates") or []
                if g.get("type") == "Polygon":
                    polys = [polys]
                if polys and polys[0]:
                    lots[str(r.get("bbl")).split(".")[0]] = [tuple(p[:2]) for p in max(polys, key=lambda q: len(q[0]))[0]]
        except RuntimeError:
            pass
    return to_future(jobs, LocalFrame(lat, lon), lots, site)
