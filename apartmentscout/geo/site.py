"""Assemble a site model (site JSON v2) for one listing: footprints, facades, streets, future
buildings, the chosen window, the sun study with its uncertainty range, and provenance."""
from __future__ import annotations

import datetime as dt
import logging
import time
from pathlib import Path
from typing import Callable

from ..sun import (Skyline, _Tracks, face_by_bearing, future_sun_hours, max_floor, month_tracks, pick_face,
                   sun_hours_range, sun_study, target_faces, window_t)
from .buildings import build_site, fetch_nyc, fetch_osm, fill_heights, nyc_pluto

log = logging.getLogger(__name__)

PROVENANCE = ("listing", "plan", "agent", "photo-landmarks", "model", "assumed")
_ALIASES = {"floor-plan": "plan", "floorplan": "plan", "floor-plan-compass": "plan", "plan-compass": "plan",
            "photo": "photo-landmarks", "photos": "photo-landmarks", "video": "photo-landmarks",
            "photo-landmark": "photo-landmarks", "leasing-agent": "agent", "broker": "agent", "email": "agent"}
FACE_KEYS = ("i", "bearing", "length", "shared", "open", "shared_frac", "shared_h")


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
    return {"exposure": exp, "window_position": pos, "floor": fl, "notes": "; ".join(notes) or None}


def make_site(L: dict, crit: dict, cache_dir: Path | None = None, floor: int | None = None,
              bearing: float | None = None, t: float | None = None, radius: float = 600, streets: bool = True,
              future: bool = True, refresh: bool = False, landmarks: list | None = None, year: int | None = None,
              say: Callable[..., None] = lambda *a: None) -> tuple[dict, dict | None, dict]:
    """Build the site JSON. Returns (site, chosen face or None, timings in seconds)."""
    city = crit["search"].get("city")
    tz = crit["search"].get("timezone") or "America/New_York"
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
    site["timezone"] = tz
    site["generated"] = dt.date.today().isoformat()
    say(f"  {len(site['b'])} buildings, target #{site['target']}, "
        f"{sum(1 for m in site['bmeta'] if m.get('height_src') == 'default')} with default heights, "
        f"{len(site.get('holes') or {})} with courts")

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
    if future and city == "nyc":
        c0 = time.perf_counter()
        try:
            from .future import fetch_future
            site["future"] = fetch_future(L["lat"], L["lon"], min(radius, 500), site, cache_dir, refresh)
        except RuntimeError as e:
            say(f"  DOB filings unavailable: {e}")
        T["future"] = time.perf_counter() - c0

    floor_arg = floor
    floor = min(floor or int(L.get("floor") or 5), max_floor(site))
    face = face_by_bearing(faces, bearing) if bearing is not None else pick_face(faces, L.get("exposure"))
    if face:
        c0 = time.perf_counter()
        tt = window_t(face) if t is None else t
        lat, lon = site["origin"]["lat"], site["origin"]["lon"]
        sky, tracks = Skyline(site), _Tracks(month_tracks(year, lat, lon, tz))
        st = sun_study(site, face, floor, tz, year, t=tt, sky=sky, tracks=tracks)
        T["study"] = time.perf_counter() - c0
        c0 = time.perf_counter()
        rng = sun_hours_range(site, face, floor, tz, year, sky=sky, tracks=tracks)
        T["range"] = time.perf_counter() - c0
        site["window"] = {"face": face["i"], "bearing": face["bearing"], "floor": floor, "t": tt}
        site["study"] = {k: st[k] for k in ("sun_hours", "floors_table", "skyline_ahead_deg", "open_sky_share")}
        site["study"]["sun_hours_range"] = rng
        fut = future_sun_hours(site, face, floor, tt, tz, year, tracks)
        if fut is not None and fut != st["sun_hours"]:
            site["study"]["sun_hours_future"] = fut
    site["provenance"] = provenance(L, face, floor_arg, bearing, t)
    if L.get("floor") is None and floor_arg is None:
        site["provenance"]["notes"] = "; ".join(filter(None, [site["provenance"]["notes"], f"floor {floor} assumed"]))
    return site, face, T
