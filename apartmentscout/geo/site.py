"""Assemble a site model (site JSON v2) for one listing: footprints, facades, streets, future
buildings, the chosen window (with bay panes), the calibrated floor height, the sun study with its
uncertainty range and main blockers, neighbouring roofs, the neighbours table, self-checks, source
receipts and provenance."""
from __future__ import annotations

import datetime as dt
import logging
import time
from pathlib import Path
from typing import Callable

from ..daylight import annual_daylight
from ..sun import (DAYLIGHT_DEFAULTS,DAYLIGHT_FORMULA, FIELD_DEG, Skyline, _Tracks, expected_sun, face_by_bearing,
                   future_sun_hours, main_blockers, max_floor, month_tracks, pick_face, sample_states, sun_hours_range,
                   sun_study, sunshine, target_faces, window_point, window_t)
from .anchor import EYE_M, vertical_calibration, window_anchor
from .buildings import build_site, fetch_nyc, fetch_osm, fill_heights, nyc_pluto
from .checks import site_checks
from .fetch import collect_receipts, summarise_receipts
from .neighbours import neighbours, roofs

log = logging.getLogger(__name__)

PROVENANCE = ("listing", "plan", "agent", "photo-landmarks", "model", "assumed")
_ALIASES = {"floor-plan": "plan", "floorplan": "plan", "floor-plan-compass": "plan", "plan-compass": "plan",
            "photo": "photo-landmarks", "photos": "photo-landmarks", "video": "photo-landmarks",
            "photo-landmark": "photo-landmarks", "leasing-agent": "agent", "broker": "agent", "email": "agent"}
FACE_KEYS = ("i", "bearing", "length", "shared", "open", "shared_frac", "shared_h")
BAY_PANES = (-45.0, 0.0, 45.0)
FLOOR_H_RANGE = (2.8, 4.2)
DEFAULT_FLOOR_H = 3.2


def listing_panes(L: dict) -> list[float] | None:
    """Pane offsets from the listing: ``window_panes`` (list of degrees) or ``bay: true``."""
    v = L.get("window_panes")
    if isinstance(v, (list, tuple)) and v:
        try:
            return [float(x) for x in v]
        except (TypeError, ValueError):
            return None
    if L.get("bay") is True or str(L.get("window_type") or "").lower() == "bay":
        return list(BAY_PANES)
    return None


def listing_face(faces: list[dict], index) -> dict | None:
    """The open facade with edge index ``index`` (the listing's ``window_face`` or ``--face``), else None.

    Used when two facades share a bearing (a long wall with a step in it) and the choice matters: edge
    indices count the target footprint's vertices, so they are only stable while the footprint is.
    """
    if index is None:
        return None
    try:
        i = int(index)
    except (TypeError, ValueError):
        return None
    return next((f for f in faces if f["i"] == i and not f.get("shared")), None)


def calibrate_floor_height(site: dict, floor: int | None, slab_height: float | None = None,
                           floor_height: float | None = None) -> tuple[float, str]:
    """Storey height for the target: manual setting, else roof height / floors, else 3.2 m.

    ``slab_height`` is the listing floor's slab above the target's ground (e.g. from a section
    drawing or an elevator floor directory); it sets the storey height to slab / (floor - 1).
    Roof / floors is clamped to 2.8-4.2 m (roof heights include parapets and bulkheads, so it reads
    a little high); it is used only when the roof height was measured, not itself built from floors.
    """
    if floor_height:
        return float(floor_height), "manual"
    if slab_height is not None and floor and floor > 1:
        return slab_height / (floor - 1), "manual"
    raw = roof_per_floor(site)
    if raw is not None:
        lo, hi = FLOOR_H_RANGE
        ti = site["target"]
        src = ((site.get("bmeta") or [{}] * (ti + 1))[ti] or {}).get("height_src")
        return min(hi, max(lo, raw)), ("pluto" if src == "roof" else "osm-levels")
    return DEFAULT_FLOOR_H, "default"


def roof_per_floor(site: dict) -> float | None:
    """Measured roof height / number of floors for the target, when both are known (else None)."""
    ti = site.get("target")
    if ti is None:
        return None
    m = (site.get("bmeta") or [{}] * (ti + 1))[ti] or {}
    nf = m.get("floors")
    if not nf or nf < 2 or m.get("height_src") not in ("roof", "osm-height"):
        return None
    return (site["b"][ti][0] - site["b"][ti][1]) / nf


def norm_source(v) -> str | None:
    if not v:
        return None
    s = str(v).strip().lower().replace("_", "-").replace(" ", "-")
    s = _ALIASES.get(s, s)
    return s if s in PROVENANCE else None


def provenance(L: dict, face: dict | None, floor_arg: int | None, bearing_arg: float | None,
               t_arg: float | None) -> dict:
    """Where the exposure, window position and floor came from (listing fields, else assumed)."""
    notes = []
    exp = norm_source(L.get("exposure_source"))
    if face is None:
        exp = exp or "assumed"
    elif bearing_arg is not None and not exp:
        exp = "assumed"
        notes.append(f"facade bearing {bearing_arg:g} given on the command line")
    elif not exp:
        exp = "listing" if L.get("exposure") else "assumed"
    pos = norm_source(L.get("window_position_source"))
    if not pos:
        pos = "assumed"
        if face is not None:
            notes.append("window placed " + ("at the given position" if t_arg is not None
                                             else "mid-way along the open part of the facade"))
    if floor_arg is not None and floor_arg != L.get("floor"):
        fl = "assumed"
        notes.append(f"floor {floor_arg} given on the command line")
    elif L.get("floor_inferred"):
        fl = "inferred"
    elif L.get("floor") is not None:
        fl = "listing"
    else:
        fl = "assumed"
    out = {"exposure": exp, "window_position": pos, "floor": fl, "notes": "; ".join(notes) or None}
    for key, src in (("basis", "exposure_basis"), ("evidence", "exposure_evidence")):
        if L.get(src):
            out[key] = str(L[src])
    return out


def make_site(L: dict, crit: dict, cache_dir: Path | None = None, floor: int | None = None,
              bearing: float | None = None, t: float | None = None, radius: float = 600, streets: bool = True,
              future: bool = True, refresh: bool = False, landmarks: list | None = None, year: int | None = None,
              panes: list[float] | None = None, slab_height: float | None = None,
              floor_height: float | None = None, components: bool = True, overrides: Path | None = None,
              green: bool = True, face_index: int | None = None, eye_height: float | None = None,
              say: Callable[..., None] = lambda *a: None, water: bool = True) -> tuple[dict, dict | None, dict]:
    """Build the site JSON. Returns (site, chosen face or None, timings in seconds).

    ``components``: split footprints into podium / tower / setback prisms from OpenStreetMap
    ``building:part`` outlines; ``overrides``: a ``<id>.components.yaml`` with manual components;
    ``green``: parks, lawns and trees from OpenStreetMap, and in New York the street tree census (drawn in the 3D
    views, never counted as shade); ``water``: rivers and ponds (same block of context, ``--no-water`` skips it).
    """
    with collect_receipts() as rc:
        site, face, T = _make_site(L, crit, cache_dir, floor, bearing, t, radius, streets, future, refresh,
                                   landmarks, year, panes, slab_height, floor_height, say, components, overrides, green,
                                   face_index, eye_height, water)
    site["receipts"] = summarise_receipts(rc)
    for r in site["receipts"]:
        if r.get("limit_hit"):
            say(f"  WARNING {r['dataset']} ({r.get('name') or ''}) returned exactly its row limit: "
                "results are probably cut off")
    site["checks"] = site_checks(site, face)
    return site, face, T


def _make_site(L, crit, cache_dir, floor, bearing, t, radius, streets, future, refresh, landmarks, year, panes,
               slab_height, floor_height, say, components=True, overrides=None, green=True, face_index=None,
               eye_height=None, water=True):
    city = crit["search"].get("city")
    tz = crit["search"].get("timezone")
    if not tz:   # [onboarding] a search that never set a time zone is not assumed to be in New York: use the place's own
        from ..cities import tz_for
        tz = tz_for(L["lat"], L["lon"]) or "America/New_York"
        say(f"  no search.timezone set: using {tz} for the sun times; set search.timezone in criteria.yaml to be sure")
    year = year or dt.date.today().year
    T: dict[str, float] = {}
    c0 = time.perf_counter()
    if city == "nyc":
        bs = fetch_nyc(L["lat"], L["lon"], radius, cache_dir=cache_dir, refresh=refresh)
        pluto = nyc_pluto([b["bbl"] for b in bs if b.get("bbl")], cache_dir, refresh=refresh)
        fill_heights(bs, pluto)
        names = {b["bbl"]: b["address"] for b in bs if b.get("bbl") and b.get("address")}
        site = build_site(L, bs, "NYC Building Footprints (5zhs-2jue) with PLUTO", names, landmarks)
    else:
        bs = fetch_osm(L["lat"], L["lon"], radius, cache_dir=cache_dir, refresh=refresh)
        site = build_site(L, bs, "OpenStreetMap contributors (ODbL)", None, landmarks)
    T["footprints"] = time.perf_counter() - c0
    match = site.pop("target_match", None) or {}
    site["timezone"] = tz
    site["generated"] = dt.date.today().isoformat()
    say(f"  {len(site['b'])} buildings, target #{site['target']}, "
        f"{sum(1 for m in site['bmeta'] if m.get('height_src') == 'default')} with default heights, "
        f"{len(site.get('holes') or {})} with courts")

    if components or (overrides is not None and Path(overrides).exists()):
        c0 = time.perf_counter()
        from .components import PARTS_RADIUS_M, build_components, fetch_osm_parts, tall_centres
        parts = None
        tall: list = []
        parts_problems: list[str] = []
        if components:
            try:
                # [building massing] the skyline's landmarks lie beyond the near radius: read their parts too
                tall = tall_centres(site, min(radius, PARTS_RADIUS_M))
                parts = fetch_osm_parts(L["lat"], L["lon"], min(radius, PARTS_RADIUS_M), cache_dir, refresh, tall=tall,
                                        problems=parts_problems)
                for msg in parts_problems:
                    say(f"  building parts of far landmarks unavailable: {msg}")
            except RuntimeError as e:
                say(f"  building parts unavailable: {e}")
        comps, info = build_components(site, parts, overrides)
        info["tall_searched"] = len(tall)
        if components and parts_problems:
            info["tall_failed"] = len(parts_problems)
        if comps:
            site["components"] = comps
        site["components_info"] = info
        say(f"  components: {info['buildings']} buildings split from {info['parts']} OSM parts"
            + (f", {info['manual']} manual" if info.get("manual") else "")
            + (f" ({info['partial']} partial and {info['height_mismatch']} height mismatches kept as prisms)"
               if info["partial"] or info["height_mismatch"] else ""))
        for msg in info.get("problems") or []:
            say(f"  components file: {msg}")
        T["components"] = time.perf_counter() - c0

    c0 = time.perf_counter()
    faces = target_faces(site)
    T["faces"] = time.perf_counter() - c0
    site["faces"] = [{k: f[k] for k in FACE_KEYS if k in f} for f in faces]
    shared = [f for f in faces if f.get("shared")]
    if shared:
        say(f"  party walls: {', '.join(str(round(f['bearing'])) + ' deg' for f in shared)}")

    if streets:
        c0 = time.perf_counter()
        try:
            from .streets import fetch_streets
            site["streets"], site["streets_source"] = fetch_streets(L["lat"], L["lon"], radius, city, cache_dir, refresh)
        except RuntimeError as e:
            say(f"  streets unavailable: {e}")
        T["streets"] = time.perf_counter() - c0
    if green:
        c0 = time.perf_counter()
        from .context import build_green, build_water   # [city context] parks, census trees, water (geo/context.py)
        g = build_green(L["lat"], L["lon"], radius, city, cache_dir, refresh, say)
        if g is not None:
            site["green"] = g
        T["green"] = time.perf_counter() - c0
        if water:
            c0 = time.perf_counter()
            w = build_water(L["lat"], L["lon"], city, cache_dir, refresh, say)
            if w is not None:
                site["water"] = w
            T["water"] = time.perf_counter() - c0
    if future and city == "nyc":
        c0 = time.perf_counter()
        try:
            from .future import fetch_future
            site["future"] = fetch_future(L["lat"], L["lon"], min(radius, 500), site, cache_dir, refresh)
        except RuntimeError as e:
            say(f"  DOB filings unavailable: {e}")
        T["future"] = time.perf_counter() - c0

    floor_arg = floor
    want_floor = floor or int(L.get("floor") or 5)
    # a measured window-eye height is a measured slab (eye - 1.6 m); the record keeps which one was given
    measured_kind = "eye" if eye_height is not None and slab_height is None else "slab" if slab_height is not None else None
    if eye_height is not None and slab_height is None:
        slab_height = float(eye_height) - EYE_M
    fh, fh_src = calibrate_floor_height(site, want_floor, slab_height, floor_height)
    site["floor_height_m"] = round(fh, 2)
    site["floor_height_src"] = fh_src
    raw = roof_per_floor(site)
    if fh_src == "pluto" and raw is not None and abs(raw - fh) > 0.01:
        site["floor_height_raw"] = round(raw, 2)  # roof / floors before clamping
    if slab_height is not None:
        site["slab_m"] = round(float(slab_height), 2)
    floor = min(want_floor, max_floor(site))
    panes = panes if panes is not None else listing_panes(L)
    panes = [float(o) for o in panes] if panes and any(abs(float(o)) > 1e-9 for o in panes) else None
    # explicit command-line choices (--face, then --bearing) beat the listing's window_face / window_t / exposure
    face = listing_face(faces, face_index)
    from_listing = face is None and bearing is None
    if from_listing:
        face = listing_face(faces, L.get("window_face"))
    if face is None:
        face = face_by_bearing(faces, bearing) if bearing is not None else pick_face(faces, L.get("exposure"))
    if t is None and from_listing and L.get("window_t") is not None:
        t = float(L["window_t"])
    if face:
        c0 = time.perf_counter()
        tt = window_t(face) if t is None else t
        lat, lon = site["origin"]["lat"], site["origin"]["lon"]
        sky, tracks = Skyline(site), _Tracks(month_tracks(year, lat, lon, tz))
        st = sun_study(site, face, floor, tz, year, t=tt, sky=sky, tracks=tracks, panes=panes)
        T["study"] = time.perf_counter() - c0
        c0 = time.perf_counter()
        rng = sun_hours_range(site, face, floor, tz, year, sky=sky, tracks=tracks, panes=panes)
        T["range"] = time.perf_counter() - c0
        site["window"] = {"face": face["i"], "bearing": face["bearing"], "floor": floor, "t": tt}
        if panes:
            site["window"]["panes"] = panes
        # the vertical datum (measured or estimated) and the shared anchor the dashboard's two 3D views agree on
        cal = vertical_calibration(site, floor, slab_m=slab_height if measured_kind == "slab" and floor > 1 else None,
                                   eye_m=eye_height if measured_kind == "eye" and floor > 1 else None, spread="scale",
                                   src="apartmentscout site --" + ("eye-height" if measured_kind == "eye" else "slab-height"))
        site["calibration"] = cal
        site["anchor"] = window_anchor(site, face, tt, floor, panes=panes, cal=cal)
        site["study"] = {k: st[k] for k in ("sun_hours", "floors_table", "skyline_ahead_deg", "open_sky_share",
                                            "sky_view", "daylight_factor_est", "daylight_floors")}
        site["study"]["daylight_model"] = {"sky": "CIE standard overcast", "field_deg": FIELD_DEG, **DAYLIGHT_DEFAULTS,
                                           "formula": DAYLIGHT_FORMULA, "estimate": True}
        sun_climate = sunshine(city)
        exp = expected_sun(st["sun_hours"], sun_climate["fraction"] if sun_climate else None)
        site["study"]["sun_year"] = {"possible": exp["possible"], "expected": exp["expected"]}
        if exp["monthly"] is not None:
            site["study"]["sun_hours_expected"] = exp["monthly"]
            site["study"]["sunshine"] = dict(sun_climate)
        if "sun_hours_panes" in st:
            site["study"]["sun_hours_panes"] = st["sun_hours_panes"]
        site["study"]["sun_hours_range"] = rng
        fut = future_sun_hours(site, face, floor, tt, tz, year, tracks, panes)
        if fut is not None and fut != st["sun_hours"]:
            site["study"]["sun_hours_future"] = fut
        c0 = time.perf_counter()
        wp = window_point(face, tt, floor, site["floor_height_m"])
        site["study"]["blockers"] = main_blockers(sky, wp, face["bearing"], year, lat, lon, tz, panes)
        T["blockers"] = time.perf_counter() - c0
        # annual daylight summary (modelled): direct sun, sky visibility and relative daylight, kept apart (apartmentscout/daylight.py)
        site["study"]["daylight_annual"] = annual_daylight(
            sky.profile(*wp), face["bearing"], panes, year, lat, lon, tz, st["sun_hours"], st["sky_view"],
            sun_climate["fraction"] if sun_climate else None)
        if site.get("green") and (site["green"].get("polys") or site["green"].get("trees")):
            c0 = time.perf_counter()
            from .sightline import green_view, sightline_block
            site["study"]["green_view"] = green_view(site, face, tt, floor, site["floor_height_m"])
            if L.get("exposure_basis"):  # the facade was chosen from what the window sees: keep the comparison
                site["sightline"] = sightline_block(site, floor, face["bearing"])
            T["sightline"] = time.perf_counter() - c0
    c0 = time.perf_counter()
    site["roofs"] = roofs(site, face)
    site["neighbours"] = neighbours(site, face)
    T["context"] = time.perf_counter() - c0
    site["provenance"] = provenance(L, face, floor_arg, bearing, t)
    notes = [site["provenance"]["notes"]]
    if L.get("floor") is None and floor_arg is None:
        notes.append(f"floor {floor} assumed")
    if match.get("by"):
        site["provenance"]["target"] = match["by"]
        site["provenance"]["target_offset_m"] = match.get("point_offset_m", 0.0)
        if match.get("point_offset_m", 0) > 10:
            notes.append(f"address point is {match['point_offset_m']:.0f} m outside the building; "
                         f"building matched by {match['by'].upper() if match['by'] in ('bin', 'bbl') else match['by']}")
        elif match["by"] in ("name", "address"):
            notes.append(f"building matched by {match['by']} (OpenStreetMap or footprint {'name' if match['by'] == 'name' else 'house number and street'}), "
                         "not by the address point")
    site["provenance"]["notes"] = "; ".join(filter(None, notes)) or None
    return site, face, T


def merge_receipts(site: dict, fresh: list[dict]) -> None:
    """Fold new per-dataset receipt summaries into ``site["receipts"]`` (same dataset: add calls, rows, queries)."""
    have = {r.get("dataset"): r for r in site.get("receipts") or []}
    for r in fresh:
        old = have.get(r["dataset"])
        if old is None:
            site.setdefault("receipts", []).append(r)
            continue
        old["calls"] = int(old.get("calls") or 0) + int(r.get("calls") or 0)
        old["rows"] = int(old.get("rows") or 0) + int(r.get("rows") or 0)
        old["limit_hit"] = bool(old.get("limit_hit")) or bool(r.get("limit_hit"))
        old["retrieved"] = max(filter(None, [old.get("retrieved"), r.get("retrieved")]), default=None)
        old["queries"] = list(old.get("queries") or []) + list(r.get("queries") or [])


def add_green(site: dict, cache_dir: Path | None = None, radius: float | None = None, refresh: bool = False,
              say: Callable[..., None] = lambda *a: None, city: str | None = None, water: bool = False,
              keep_osm: bool = False) -> bool:
    """Add (or refresh) the ``green`` block of an existing site JSON (parks and mapped trees, plus the street tree
    census when ``city`` is ``"nyc"``) and the window's ``study.green_view``, without rebuilding anything else.
    ``water=True`` also adds the ``water`` block (``--context-only``); ``keep_osm=True`` keeps the parks and mapped trees
    already in the file and adds only the census and water (``--keep-osm``: no Overpass call). Returns False when the site
    has no origin."""
    from .context import build_green, build_water   # [city context]
    from .sightline import green_view
    origin = site.get("origin") or {}
    if "lat" not in origin or "lon" not in origin:
        return False
    r = radius or float((site.get("green") or {}).get("radius_m") or 600)
    with collect_receipts() as rc:
        g = build_green(origin["lat"], origin["lon"], r, city, cache_dir, refresh, say, keep=site.get("green") if keep_osm else None,
                        fallback=site.get("green"))
        if g is None:
            raise RuntimeError("green space unavailable")
        site["green"] = g
        if water:
            wb = build_water(origin["lat"], origin["lon"], city, cache_dir, refresh, say)
            if wb is not None:
                site["water"] = wb
            else:
                site.pop("water", None)
    merge_receipts(site, summarise_receipts(rc))
    w = site.get("window")
    if w and site.get("study") is not None:
        face = next((f for f in target_faces(site) if f["i"] == w.get("face")), None)
        if face is not None:
            fh = site.get("floor_height_m", 3.2)
            site["study"]["green_view"] = green_view(site, face, w["t"], int(w["floor"]), fh)
    return True


def sample_rows(site: dict, face: dict, dates: list[dt.date], step_min: int = 6) -> list[dict]:
    """Rows for research/<id>-sun-samples.csv: every slot of each date at the site's window, with the
    blocking building named. Row count = (1440 / step_min) x len(dates)."""
    w = site["window"]
    lat, lon, tz = site["origin"]["lat"], site["origin"]["lon"], site.get("timezone") or "America/New_York"
    sky = Skyline(site)
    pt = window_point(face, w["t"], w["floor"], site.get("floor_height_m", 3.2))
    meta = site.get("bmeta") or []
    out = []
    for d in dates:
        for r in sample_states(sky, pt, face["bearing"], d, lat, lon, tz, w.get("panes"), step_min):
            b = r.get("blocker")
            m = (meta[b] if b is not None and 0 <= b < len(meta) and meta[b] else {})
            top = site["b"][b][0] if b is not None and b >= 0 else None
            out.append({"date": d.isoformat(), "time": f"{r['minute'] // 60:02d}:{r['minute'] % 60:02d}",
                        "az": r["az"], "alt": r["alt"], "state": r["state"],
                        "blocker": "" if b is None else ("this building" if b == site.get("target") else
                                                         (m.get("name") or m.get("address") or f"building #{b}")),
                        "blocker_bin": m.get("bin") or "", "blocker_top_m": "" if top is None else top,
                        "blocker_dist_m": r.get("dist", ""), "b": "" if b is None else b})
    return out
