"""NYC building dossier from NYC Open Data (no API key needed).

For one listing it pulls, by BBL/BIN and by distance:

* PLUTO               year built, floors, units, building class, owner of record
* HPD violations      open and closed housing-code violations, class A/B/C
* HPD complaints      tenant complaints to HPD (heat, hot water, pests, leaks...)
* DOB complaints      complaints to the Department of Buildings
* ECB/OATH violations construction and safety violations with penalties
* DOB NOW filings     active construction permits on the lot and the block
* Bedbug reports      the annual filings landlords must make
* 311 noise           complaints at the address and within 150 m, by type and hour
* NYPD complaints     reported crimes within 300 m over the last 12 months

All counts are reports, not proof. The dossier keeps the raw rows so an agent or
a person can read the actual text before drawing conclusions.
"""
from __future__ import annotations

import collections
import datetime as dt
import json
import os
from pathlib import Path

import requests

BASE = "https://data.cityofnewyork.us/resource/{}.json"
HEADERS = {"User-Agent": "ApartmentScout/0.1"}
if os.environ.get("SOCRATA_APP_TOKEN"):
    HEADERS["X-App-Token"] = os.environ["SOCRATA_APP_TOKEN"]

DATASETS = {
    "pluto": "64uk-42ks",
    "hpd_violations": "wvxf-dwi5",
    "hpd_complaints": "ygpa-z7cr",
    "dob_complaints": "eabe-havv",
    "ecb_violations": "6bgk-3dad",
    "dob_now_filings": "w9ak-ipjd",
    "bedbugs": "wz6d-d3jb",
    "sr311": "erm2-nwe9",
    "nypd_complaints": "5uac-w243",
    "footprints": "5zhs-2jue",
}


def soql(ds: str, params: dict, limit: int = 50000) -> list[dict]:
    p = dict(params)
    p.setdefault("$limit", limit)
    r = requests.get(BASE.format(DATASETS.get(ds, ds)), params=p, headers=HEADERS, timeout=120)
    r.raise_for_status()
    return r.json()


def _bbl_parts(bbl: str) -> tuple[str, str, str]:
    b = str(bbl).split(".")[0]
    return b[0], b[1:6], b[6:10]


def _since(years: float) -> str:
    return (dt.date.today() - dt.timedelta(days=int(365 * years))).isoformat()


def build_dossier(L: dict, ws=None, log=print, years: float = 3, radius_noise_m: int = 150,
                  radius_crime_m: int = 300) -> dict:
    bbl, bin_ = L.get("bbl"), L.get("bin")
    lat, lon = L.get("lat"), L.get("lon")
    if not bbl and L.get("address"):
        from ..geocode import Geocoder
        g = Geocoder(None, "nyc").geocode(L["address"], "nyc") or {}
        bbl, bin_ = g.get("bbl"), g.get("bin")
        lat, lon = lat or g.get("lat"), lon or g.get("lon")
    if not bbl:
        raise ValueError(f"{L['id']}: no BBL. Run `apartmentscout geocode` (NYC addresses get a BBL).")
    boro, block, lot = _bbl_parts(bbl)
    since = _since(years)
    D: dict = {"id": L["id"], "building": L.get("building"), "address": L.get("address"), "bbl": bbl, "bin": bin_,
               "lat": lat, "lon": lon, "generated": dt.date.today().isoformat(), "window_years": years,
               "sources": {k: f"https://data.cityofnewyork.us/d/{v}" for k, v in DATASETS.items()}}

    def step(name, fn):
        try:
            D[name] = fn()
            log(f"    {name}: ok")
        except Exception as e:  # keep going; record the failure in the dossier
            D[name] = {"error": str(e)[:300]}
            log(f"    {name}: {e}")

    def pluto():
        rows = soql("pluto", {"bbl": str(bbl).split(".")[0]})
        if not rows:
            return {}
        r = rows[0]
        keep = ("address", "yearbuilt", "yearalter1", "numfloors", "unitsres", "unitstotal", "bldgclass",
                "ownername", "zonedist1", "lotarea", "bldgarea", "landuse", "histdist", "landmark")
        out = {k: r.get(k) for k in keep}
        for k in ("yearbuilt", "yearalter1", "numfloors", "unitsres", "unitstotal", "lotarea", "bldgarea"):
            if _f(out.get(k)) is not None:
                out[k] = int(_f(out[k]))
        return out

    step("building_info", pluto)
    units = _f((D.get("building_info") or {}).get("unitsres")) or None

    def hpd_v():
        rows = soql("hpd_violations", {"boroid": boro, "block": str(int(block)), "lot": str(int(lot)),
                                        "$where": f"inspectiondate >= '{since}'",
                                        "$select": "violationid,class,inspectiondate,novdescription,currentstatus,violationstatus,apartment,story,rentimpairing"})
        open_ = [r for r in rows if (r.get("violationstatus") or "").lower() == "open"]
        return {"total": len(rows), "open": len(open_),
                "by_class": dict(collections.Counter(r.get("class") for r in rows)),
                "open_by_class": dict(collections.Counter(r.get("class") for r in open_)),
                "by_year": _by_year(rows, "inspectiondate"),
                "top": _top(rows, "novdescription", 8, 140),
                "recent": sorted(rows, key=lambda r: r.get("inspectiondate", ""), reverse=True)[:25]}

    def hpd_c():
        rows = soql("hpd_complaints", {"$where": f"bbl = '{str(bbl).split('.')[0]}' AND received_date >= '{since}'",
                                        "$select": "complaint_id,received_date,major_category,minor_category,apartment,complaint_status,status_description"})
        return {"total": len(rows), "complaints": len({r.get("complaint_id") for r in rows}),
                "by_category": dict(collections.Counter(r.get("major_category") for r in rows).most_common(12)),
                "by_year": _by_year(rows, "received_date"),
                "recent": sorted(rows, key=lambda r: r.get("received_date", ""), reverse=True)[:25]}

    def dob_c():
        if not bin_:
            return {"note": "no BIN"}
        rows = soql("dob_complaints", {"bin": str(bin_)})
        rows = [r for r in rows if _iso_mdy(r.get("date_entered")) >= since]
        return {"total": len(rows), "by_category": dict(collections.Counter(r.get("complaint_category") for r in rows)),
                "recent": rows[:20]}

    def ecb():
        if not bin_:
            return {"note": "no BIN"}
        rows = soql("ecb_violations", {"bin": str(bin_), "$where": f"issue_date >= '{since.replace('-', '')}'",
                                        "$select": "ecb_violation_number,issue_date,severity,violation_description,ecb_violation_status,penality_imposed"})
        return {"total": len(rows), "open": sum(1 for r in rows if (r.get("ecb_violation_status") or "").upper() != "RESOLVE"),
                "by_severity": dict(collections.Counter(r.get("severity") for r in rows)), "recent": rows[:20]}

    def permits():
        boro_name = {"1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island"}[boro]
        rows = soql("dob_now_filings", {"$where": f"borough = '{boro_name}' AND block = '{int(block)}' AND filing_date >= '{_since(1.5)}'",
                                         "$select": "job_filing_number,house_no,street_name,lot,job_type,filing_status,job_description,filing_date,initial_cost",
                                         "$order": "filing_date DESC"}, 300)
        same_lot = [r for r in rows if str(r.get("lot", "")).lstrip("0") == str(int(lot))]
        big = [r for r in rows if _f(r.get("initial_cost")) and _f(r.get("initial_cost")) >= 250000]
        heavy = [r for r in rows if any(k in (r.get("job_description") or "").upper()
                                        for k in ("DEMOLI", "NEW BUILDING", "VERTICAL ENLARGEMENT", "EXCAVAT", "FOUNDATION"))]
        return {"block_filings": len(rows), "lot_filings": len(same_lot), "major_jobs": big[:15],
                "heavy_construction": heavy[:15], "lot_recent": same_lot[:15]}

    def bedbugs():
        rows = soql("bedbugs", {"bbl": str(bbl).split(".")[0], "$order": "filing_date DESC"}, 10)
        return {"filings": rows[:5]}

    def noise():
        if lat is None:
            return {"note": "no coordinates"}
        rows = soql("sr311", {"$where": f"within_circle(location,{lat},{lon},{radius_noise_m}) AND complaint_type like 'Noise%' AND created_date >= '{since}'",
                               "$select": "created_date,complaint_type,descriptor,incident_address,bbl,resolution_description"})
        at = [r for r in rows if str(r.get("bbl", "")).split(".")[0] == str(bbl).split(".")[0]]
        hours = [0] * 24
        for r in rows:
            try:
                hours[int(r["created_date"][11:13])] += 1
            except Exception:
                pass
        per_year = len(rows) / years
        return {"radius_m": radius_noise_m, "nearby_total": len(rows), "at_building": len(at),
                "nearby_per_year": round(per_year, 1),
                "by_type": dict(collections.Counter(f"{r.get('complaint_type')} | {r.get('descriptor')}" for r in rows).most_common(12)),
                "at_building_by_type": dict(collections.Counter(r.get("descriptor") for r in at).most_common(10)),
                "by_hour": hours, "night_share": round(sum(hours[h] for h in (22, 23, 0, 1, 2, 3, 4, 5)) / max(1, len(rows)), 2),
                "by_month": _by_month(rows, "created_date"),
                "at_building_recent": sorted(at, key=lambda r: r["created_date"], reverse=True)[:40]}

    def crime():
        if lat is None:
            return {"note": "no coordinates"}
        rows = soql("nypd_complaints", {"$where": f"within_circle(lat_lon,{lat},{lon},{radius_crime_m}) AND cmplnt_fr_dt >= '{_since(1)}'",
                                         "$select": "cmplnt_fr_dt,law_cat_cd,ofns_desc"})
        return {"radius_m": radius_crime_m, "last_12m": len(rows),
                "by_level": dict(collections.Counter(r.get("law_cat_cd") for r in rows)),
                "top_offenses": dict(collections.Counter(r.get("ofns_desc") for r in rows).most_common(8))}

    for name, fn in (("hpd_violations", hpd_v), ("hpd_complaints", hpd_c), ("dob_complaints", dob_c),
                     ("ecb_violations", ecb), ("construction", permits), ("bedbugs", bedbugs),
                     ("noise_311", noise), ("crime", crime)):
        step(name, fn)
    D["summary"] = summarize(D, units)
    return D


def summarize(D: dict, units: float | None) -> dict:
    """Turn raw counts into a few comparable numbers and plain-language flags."""
    u = units or 100
    hv, hc, nz = D.get("hpd_violations") or {}, D.get("hpd_complaints") or {}, D.get("noise_311") or {}
    yrs = D.get("window_years", 3)
    flags = []
    ob = hv.get("open_by_class") or {}
    if ob.get("C"):
        flags.append(f"{ob['C']} open class C (immediately hazardous) HPD violations")
    if ob.get("B", 0) >= 5:
        flags.append(f"{ob['B']} open class B HPD violations")
    cats = hc.get("by_category") or {}
    for k in ("HEAT/HOT WATER", "PESTS", "WATER LEAK", "UNSANITARY CONDITION", "ELEVATOR"):
        if cats.get(k, 0) >= 3:
            flags.append(f"{cats[k]} HPD complaint lines about {k.lower()}")
    heavy = (D.get("construction") or {}).get("heavy_construction") or []
    if heavy:
        flags.append(f"{len(heavy)} heavy-construction filing(s) on the block (demolition, new building, excavation)")
    if nz.get("nearby_per_year", 0) > 150:
        flags.append(f"{nz['nearby_per_year']:.0f} noise complaints a year within {nz.get('radius_m')} m")
    if nz.get("night_share", 0) > 0.45:
        flags.append(f"{int(nz['night_share'] * 100)}% of nearby noise complaints are logged 10 pm-6 am")
    bb = (D.get("bedbugs") or {}).get("filings") or []
    if bb and _f(bb[0].get("infested_dwelling_unit_count")):
        flags.append(f"bedbug filing reports {bb[0]['infested_dwelling_unit_count']} infested unit(s)")
    viol_rate = (hv.get("total") or 0) / u / yrs * 100
    comp_rate = (hc.get("complaints") or 0) / u / yrs * 100
    risk = 90 - min(40, viol_rate * 1.5) - min(25, comp_rate * 1.0) - 6 * ob.get("C", 0) - min(10, ob.get("B", 0))
    noise_per_unit = (nz.get("at_building") or 0) / u / yrs * 100
    noise_score = 85 - min(35, (nz.get("nearby_per_year") or 0) / 8) - min(20, noise_per_unit * 2) - 15 * max(0, (nz.get("night_share") or 0) - 0.35)
    return {"units": units, "hpd_violations_per_100_units_yr": round(viol_rate, 1),
            "hpd_complaints_per_100_units_yr": round(comp_rate, 1),
            "noise_at_building_per_100_units_yr": round(noise_per_unit, 1),
            "risk_score": round(max(0, min(100, risk))), "noise_score": round(max(0, min(100, noise_score))),
            "flags": flags}


def to_markdown(D: dict) -> str:
    s = D.get("summary", {})
    bi = D.get("building_info") or {}
    lines = [f"# {D.get('building') or D.get('address')}: public-records dossier", "",
             f"{D.get('address')} · BBL {D.get('bbl')} · BIN {D.get('bin')} · generated {D.get('generated')} · "
             f"window: last {D.get('window_years')} years", ""]
    if bi:
        lines += ["## Building", "",
                  f"Built {bi.get('yearbuilt')}, {bi.get('numfloors')} floors, {bi.get('unitsres')} residential units, "
                  f"class {bi.get('bldgclass')}, zoning {bi.get('zonedist1')}. Owner of record: {bi.get('ownername')}.", ""]
    lines += ["## Scores", "", f"Records risk score **{s.get('risk_score')}** / 100 and street-noise score "
              f"**{s.get('noise_score')}** / 100 (higher is better).", "",
              f"HPD violations: {s.get('hpd_violations_per_100_units_yr')} per 100 units per year. "
              f"HPD complaints: {s.get('hpd_complaints_per_100_units_yr')} per 100 units per year.", ""]
    if s.get("flags"):
        lines += ["## Flags", ""] + [f"- {f}" for f in s["flags"]] + [""]
    hv = D.get("hpd_violations") or {}
    if "total" in hv:
        lines += ["## HPD violations", "", f"{hv['total']} issued, {hv['open']} still open. By class: {hv.get('by_class')}.", ""]
        lines += [f"- {t} ({n})" for t, n in (hv.get("top") or [])] + [""]
    hc = D.get("hpd_complaints") or {}
    if "total" in hc:
        lines += ["## HPD complaints", "", f"{hc.get('complaints')} complaints ({hc['total']} problem lines). "
                  f"Top categories: {hc.get('by_category')}.", ""]
    nz = D.get("noise_311") or {}
    if "nearby_total" in nz:
        lines += ["## 311 noise", "", f"{nz['nearby_total']} noise requests within {nz['radius_m']} m "
                  f"({nz['nearby_per_year']} a year); {nz['at_building']} logged at this lot. "
                  f"Night share (10 pm-6 am): {int(nz.get('night_share', 0) * 100)}%.", "",
                  "Most common nearby: " + "; ".join(f"{k} ({v})" for k, v in list((nz.get('by_type') or {}).items())[:6]), ""]
    co = D.get("construction") or {}
    if "block_filings" in co:
        lines += ["## Construction on the block", "", f"{co['block_filings']} DOB NOW filings on the block in 18 months, "
                  f"{co['lot_filings']} on this lot."]
        for r in (co.get("heavy_construction") or [])[:8]:
            lines.append(f"- {r.get('filing_date', '')[:10]} {r.get('house_no')} {r.get('street_name')}: {(r.get('job_description') or '')[:140]}")
        lines.append("")
    cr = D.get("crime") or {}
    if "last_12m" in cr:
        lines += ["## Reported crime nearby", "", f"{cr['last_12m']} NYPD complaints within {cr['radius_m']} m in 12 months. "
                  f"By level: {cr.get('by_level')}. Top: {cr.get('top_offenses')}.", ""]
    lines += ["## Caveats", "", "Complaints and 311 requests are reports, not findings. Counts scale with building size, "
              "and a closed ticket does not mean the problem was fixed. Read the recent rows in the JSON before concluding.", ""]
    return "\n".join(lines)


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _iso_mdy(s):
    if not s:
        return ""
    if "/" in s:
        m, d, y = s.split()[0].split("/")
        return f"{y}-{int(m):02d}-{int(d):02d}"
    return s[:10]


def _by_year(rows, key):
    return dict(sorted(collections.Counter((r.get(key) or "")[:4] for r in rows if r.get(key)).items()))


def _by_month(rows, key):
    return dict(sorted(collections.Counter((r.get(key) or "")[:7] for r in rows if r.get(key)).items()))


def _top(rows, key, n, width):
    c = collections.Counter((r.get(key) or "")[:width] for r in rows if r.get(key))
    return c.most_common(n)


def save_dossier(D: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    j = out_dir / f"{D['id']}.json"
    m = out_dir / f"{D['id']}.md"
    j.write_text(json.dumps(D, indent=1, default=str))
    m.write_text(to_markdown(D))
    return j, m
