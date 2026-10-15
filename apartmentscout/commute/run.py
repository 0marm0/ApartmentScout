"""Compute commute heat grids and per-listing commute times, by mode, for every destination.

For each destination the network is loaded once (all feeds, every mode) and scanned per mode set:
each single mode present in the feeds (subway, bus, rail, ferry) and "transit" (every mode together,
so a bus to the subway counts). Every scan runs at several arrival times (arrive_by minus
arrival_offsets_min) so the minutes include typical waiting; a listing gets the mean and the min-max
range, plus the legs of the median trip. Walking is always an option inside every mode.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import math
import time
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import requests

from ..geo import haversine_m
from ..listings import slugify
from .grid import GridSpec, surface
from .land import land_source, load_land
from .walk import Walker
from .gtfs import (DEFAULT_ACCESS_S, MODES, Network, access_points, best_from, clock, download_feed, journey,
                   legs_summary, load_network, reverse_scan, route_text, _hhmm)

TRANSIT = "transit"


def _bbox(listings: list[dict], dests: list[dict], pad_m: float) -> tuple[float, float, float, float]:
    pts = [(L["lat"], L["lon"]) for L in listings if L.get("lat") is not None and L.get("status") != "gone"]
    pts += [(d["lat"], d["lon"]) for d in dests if d.get("lat") is not None]
    if not pts:
        raise ValueError("No geocoded listings. Run `apartmentscout geocode` first.")
    lats, lons = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
    # trim far outliers so one odd listing does not blow up the grid
    k = max(0, int(len(pts) * 0.01))
    la0, la1, lo0, lo1 = lats[k], lats[-1 - k], lons[k], lons[-1 - k]
    return _pad((lo0, la0, lo1, la1), pad_m)


def _pad(b: tuple[float, float, float, float], pad_m: float) -> tuple[float, float, float, float]:
    lo0, la0, lo1, la1 = b
    dlat = pad_m / 110574
    dlon = pad_m / (111320 * math.cos(math.radians((la0 + la1) / 2)))
    return lo0 - dlon, la0 - dlat, lo1 + dlon, la1 + dlat


def _feed_mode(f: dict) -> str | None:
    m = (f.get("mode") or "").strip().lower() or None
    if m and m not in MODES:
        raise ValueError(f"Feed {f.get('name')}: mode must be one of {', '.join(MODES)}, not {m!r}")
    return m


def feed_specs(ws, crit: dict, log=print) -> list[tuple[str, Path, str | None, list[str]]]:
    """(name, local path, mode, excluded route patterns) for every GTFS feed of the search, downloading (or refreshing) into the cache."""
    feeds = []
    for f in ((crit.get("commute") or {}).get("transit") or {}).get("feeds") or []:
        name = slugify(f.get("name") or "feed")
        path = Path(f["path"]) if f.get("path") else ws.cache_dir / "gtfs" / f"{name}.zip"
        if f.get("url"):
            fresh = path.exists()
            try:
                download_feed(f["url"], path)
            except requests.RequestException as e:   # [onboarding] a bad or moved URL is a message, not a traceback
                log(f"  feed {f.get('name')}: could not download {f['url']} ({type(e).__name__}). Check the URL, or download "
                    f"the zip yourself and give its location as `path:` in criteria.yaml. Skipped.")
                continue
            if not fresh:
                log(f"  feed {f.get('name')}: downloaded {f['url']}")
        if path.exists():
            feeds.append((name, path, _feed_mode(f), list(f.get("exclude_routes") or [])))
        else:
            log(f"  feed {f.get('name')}: no file at {path} and no url; skipped")
    return feeds


def feed_paths(ws, crit: dict, log=print, routing: bool = False) -> list[tuple[str, Path]]:
    """(name, path) of the feeds to draw as map lines. Bus feeds are routed but not drawn unless the
    feed sets `map_lines: true` (hundreds of grey bus lines would bury the subway map); routing=True
    returns every feed."""
    specs = feed_specs(ws, crit, log)
    cfg = {slugify(f.get("name") or "feed"): f
           for f in ((crit.get("commute") or {}).get("transit") or {}).get("feeds") or []}
    out = []
    for name, path, mode, _skip in specs:
        f = cfg.get(name, {})
        if routing or f.get("map_lines", mode != "bus"):
            out.append((name, path))
    return out


CITIES = Path(__file__).resolve().parents[2] / "config" / "cities"


def walk_grids(crit: dict) -> list[dict]:
    """Street-grid areas for walking: commute.transit.walk_grids if set (false or [] turns them off),
    else the city profile's walk_grids."""
    tr = (crit.get("commute") or {}).get("transit") or {}
    if "walk_grids" in tr:
        return list(tr["walk_grids"] or [])
    return list(city_profile(crit).get("walk_grids") or [])


def make_walker(crit: dict) -> Walker:
    tr = (crit.get("commute") or {}).get("transit") or {}
    return Walker.from_cfg((tr.get("walk_speed_kmh") or 4.8) / 3.6, tr.get("walk_detour", 1.25), walk_grids(crit))


def _access_cfg(tr: dict) -> dict[str, int]:
    acc = dict(DEFAULT_ACCESS_S)
    if tr.get("station_access_min") is not None:
        acc["subway"] = int(60 * float(tr["station_access_min"]))
    for k, v in (tr.get("access_min") or {}).items():
        acc[k] = int(60 * float(v))
    return acc


def _mode_sets(net: Network | None) -> dict[str, tuple[str, ...] | None]:
    """Routing sets: each mode in the feeds on its own, then every mode together."""
    if net is None:
        return {}
    have = net.modes_present()
    sets: dict[str, tuple[str, ...] | None] = {m: (m,) for m in have}
    sets[TRANSIT] = None
    return sets


class _Router:
    """All profiles (mode set x arrival offset) for one destination, and per-point evaluation."""

    def __init__(self, net: Network | None, profs: dict[str, list], dest: tuple[float, float],
                 speed: float, detour: float, max_access: float, walker: Walker | None = None):
        self.net, self.profs, self.dest = net, profs, dest
        self.walker = walker or (net.walker if net is not None else Walker(speed, detour))
        self.speed, self.detour, self.max_access = speed, detour, max_access

    def walk_s(self, lat: float, lon: float) -> tuple[float, float]:
        w = self.net.walker if self.net is not None else self.walker
        m = w.metres(lat, lon, self.dest[0], self.dest[1])
        return m / w.speed_ms, m

    def access_m(self, lat: float, lon: float, stop: int, access_s: float) -> float:
        """Metres walked from the point to `stop` (for the legs)."""
        return haversine_m(lat, lon, self.net.lat[stop], self.net.lon[stop]) * self.detour

    def access(self, lat: float, lon: float):
        return access_points(self.net, lat, lon, self.max_access, self.speed, self.detour) if self.net else None

    def minutes(self, lat: float, lon: float, acc=None) -> dict[str, list[tuple[float, int, float]]]:
        """{set: [(minutes, stop or -1, access_s) per arrival offset]}; walking is always allowed."""
        ws, _ = self.walk_s(lat, lon)
        if self.net is None:
            return {}
        acc = acc if acc is not None else self.access(lat, lon)
        return {k: [best_from(p, acc, ws) for p in ps] for k, ps in self.profs.items()}

    def entry(self, k: str, runs: list[tuple[float, int, float]], lat: float, lon: float) -> dict:
        mins = [r[0] for r in runs]
        mean = sum(mins) / len(mins)
        # legs of the median run (the typical trip), not of an extreme
        order = sorted(range(len(runs)), key=lambda i: mins[i])
        i = order[(len(order) - 1) // 2]
        _, stop, a = runs[i]
        prof = self.profs[k][i]
        if stop < 0:
            ws, wm = self.walk_s(lat, lon)
            legs = [{"mode": "walk", "min": round(ws / 60, 1), "m": int(round(wm)), "to": "destination"}]
        else:
            legs = journey(self.net, prof, stop, a, self.access_m(lat, lon, stop, a), self.detour)
        out = {"minutes": round(mean, 1), "range": [round(min(mins), 1), round(max(mins), 1)],
               "route": route_text(legs) if stop >= 0 else f"walk {mins[i]:.0f} min",
               **legs_summary(legs), "legs": legs, "legs_arrive_by": clock(prof.arrive_by)}
        return out


class _NetRouter(_Router):
    """The router with street-network walking: per-point answers precomputed by netroute.net_surface."""

    def __init__(self, net, profs, dest, speed, detour, max_access, runs: dict, walks: dict):
        super().__init__(net, profs, dest, speed, detour, max_access, Walker(speed, detour))
        self.runs, self.walks = runs, walks

    @staticmethod
    def _key(lat: float, lon: float) -> tuple[float, float]:
        return round(lat, 6), round(lon, 6)

    def walk_s(self, lat: float, lon: float) -> tuple[float, float]:
        m = self.walks[self._key(lat, lon)]
        return m / self.speed, m

    def minutes(self, lat: float, lon: float, acc=None) -> dict[str, list[tuple[float, int, float]]]:
        return self.runs[self._key(lat, lon)] if self.net is not None else {}

    def access_m(self, lat: float, lon: float, stop: int, access_s: float) -> float:
        return max(0.0, access_s - float(self.net.arrays()[3][stop])) * self.speed


def walk_model(crit: dict) -> str:
    """'network' (walk the OpenStreetMap street network) or 'grid' (straight line x detour, or the
    street-grid metric of walk.py): commute.transit.walk_model, else the city profile's, else grid."""
    tr = (crit.get("commute") or {}).get("transit") or {}
    m = str(tr.get("walk_model") or city_profile(crit).get("walk_model") or "grid").lower()
    if m not in ("network", "grid"):
        raise ValueError(f"commute.transit.walk_model must be network or grid, not {m!r}")
    return m


def _build_walk_graph(ws, crit: dict, tr: dict, net, feeds, dests, listings, walk_bbox, log):
    """(graph, plan, receipts summary) for street-network walking; raises when the network is unavailable."""
    from ..geo.fetch import collect_receipts, summarise_receipts
    from .entrances import access_points as entrance_points, load_entrances, parent_map
    from .netroute import plan_anchors
    from .walknet import load_graph
    with collect_receipts() as rc:
        src = tr.get("station_entrances", city_profile(crit).get("station_entrances"))
        ents = load_entrances(src, ws.cache_dir / "walk", walk_bbox, log) if net is not None else []
        if net is not None:
            enter, leave, st = entrance_points(net, ents, parent_map(feeds))
        else:
            enter, leave, st = {}, {}, {}
        plan = plan_anchors(dests, listings, enter, leave)
        plan.entrance_stats = st
        g = load_graph(walk_bbox, plan.anchors, ws.cache_dir, log,
                       step_m=float(tr.get("walk_sample_m", 15)), anchor_max_m=float(tr.get("walk_anchor_max_m", 300)))
    if st:
        log(f"  entrances: {st['entrances']:,} station entrances, {st['stops_with_entrances']:,} platforms entered "
            f"by their stairs")
    summary = summarise_receipts(rc)
    bases = sorted(r["rows_updated"] for r in rc if r.get("dataset") == "overpass" and r.get("rows_updated"))
    for q in summary:
        if q.get("dataset") == "overpass" and bases:
            q["rows_updated"] = bases[0] if bases[0][:10] == bases[-1][:10] else f"{bases[0]} .. {bases[-1]}"
    return g, plan, summary


DEFAULT_CELL_M = 50
DEFAULT_OFFSETS = list(range(0, 21, 2))  # arrive 0, 2, ... 20 minutes before arrive_by
NODATA = 255  # values_u8: half-minutes 0..254, 255 = no value (water, or out of reach of any stop)


def encode_minutes(m: np.ndarray) -> str:
    """Minutes (NaN = no value) as base64 bytes of half-minutes, row-major from the south-west."""
    q = np.where(np.isfinite(m), np.clip(np.round(np.nan_to_num(m, nan=0.0) * 2), 0, NODATA - 1), NODATA)
    return base64.b64encode(q.astype(np.uint8).tobytes()).decode("ascii")


def decode_minutes(layer: dict) -> list[float]:
    """The layer's minutes per cell as floats, -1 where blank (accepts the old `values` list too)."""
    if "values" in layer:
        return [float(v) for v in layer["values"]]
    q = np.frombuffer(base64.b64decode(layer["values_u8"]), dtype=np.uint8)
    return [-1.0 if v == NODATA else v * float(layer.get("scale", 0.5)) for v in q.tolist()]


def city_profile(crit: dict) -> dict:
    city = (crit.get("search") or {}).get("city")
    p = CITIES / f"{city}.yaml"
    if not city or not p.exists():
        return {}
    import yaml
    return yaml.safe_load(p.read_text()) or {}


def run_commute(ws, listings: list[dict], crit: dict, cell_m: float | None = None, pad_m: float = 1500,
                log=print, layers_dir: Path | None = None, mode_grids: bool | None = None,
                only: Iterable[str] | None = None, only_dests: Iterable[str] | None = None) -> list[dict]:
    """Route every destination; write commute-<dest>.json (best of transit) and, per mode,
    commute-<dest>-<mode>.json; set L["commute"][dest] on every geocoded listing.

    ``only`` (listing ids) re-times just those listings, for example after fixing their coordinates:
    the walking network and the routing scans are the same, but the heat-map layers on disk are
    left untouched and the other listings keep the commute they already have.

    ``only_dests`` (destination names) routes just those destinations, for example a newly added second one: the
    others keep the grids and per-listing minutes already on disk, and the walking network, entrances and land model
    are still planned around every destination so nothing is fetched twice.

    The grids hold the router's own answer at every cell centre (grid.surface), so a map that
    interpolates between centres stays within a fraction of a minute of the router anywhere."""
    cm = crit.get("commute") or {}
    dests = cm.get("destinations") or []
    run_dests = dests
    if only_dests is not None:
        names = list(only_dests)
        missing = [n for n in names if n not in {d["name"] for d in dests}]
        if missing:
            raise ValueError(f"no such destination: {', '.join(missing)} (the search has: {', '.join(d['name'] for d in dests)})")
        run_dests = [d for d in dests if d["name"] in names]
    tr = cm.get("transit") or {}
    speed = (tr.get("walk_speed_kmh") or 4.8) / 3.6
    detour = tr.get("walk_detour", 1.25)
    max_access = tr.get("max_walk_to_station_m", 1200)
    mask_m = tr.get("heat_mask_m", 1000)  # grid cells farther than this from any stop are left blank
    offsets = [int(o) for o in tr.get("arrival_offsets_min", DEFAULT_OFFSETS)]
    window = 60 * int(tr.get("window_min", 150))  # how long before arrive_by a trip may start
    egress_access = float(tr.get("egress_access", 1))  # platform-to-street at the destination end too
    cell = float(cell_m if cell_m is not None else tr.get("heat_cell_m", DEFAULT_CELL_M))
    if mode_grids is None:
        mode_grids = bool(tr.get("mode_grids", True))
    day = dt.date.fromisoformat(str(tr.get("service_date") or _next_weekday()))
    wanted = set(only) if only is not None else None
    timed = [L for L in listings if wanted is None or L.get("id") in wanted]
    if wanted is not None and not timed:
        raise ValueError("none of the requested listing ids exist in this search")
    walker = make_walker(crit)
    model = walk_model(crit)
    snap_m = float(tr.get("walk_snap_m", 60))
    if walker.grids and model == "grid":
        log(f"  walking: street-grid metric in {', '.join(g.name for g in walker.grids)}, "
            f"straight line x {detour} elsewhere")
    feeds = feed_specs(ws, crit, log)
    if not feeds:   # [onboarding] say so: otherwise a search with no transit feeds quietly gets walking times only
        log("  No transit feeds are set up, so these are WALKING times only. Add your agency's GTFS zip with "
            "`apartmentscout city --feed URL` (or under commute.transit.feeds in criteria.yaml); "
            "docs/guides/getting-started.md, step 6, shows how to find one.")
    bbox = _bbox(listings, dests, pad_m)
    net_bbox = _pad(bbox, max(max_access, 1000) + 1000)  # stops a little beyond the grid still matter
    spec = GridSpec.cover(bbox, cell)
    land = load_land(land_source(crit, city_profile(crit)), ws.cache_dir, net_bbox, log)
    if land is not None:
        log(f"  land: {land.landmasses} landmasses; water cells are blank and walks do not cross rivers")
    out_dir = layers_dir or ws.layers_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    layers = []
    net_cache: dict[tuple[int, int], Network] = {}
    graph = None  # (WalkGraph, NetPlan, receipts, CellStamp) once built; False after a failed build
    for d in run_dests:
        if d.get("lat") is None:
            raise ValueError(f"Destination {d['name']} has no lat/lon. Run `apartmentscout geocode`.")
        arrive = _hhmm(str(d.get("arrive_by", "09:00")))
        t0 = time.time()
        net = None
        if feeds:
            key = (arrive - 60 * max(offsets) - window, arrive)
            if key not in net_cache:
                net_cache[key] = load_network(feeds, day, key[0], key[1], speed, detour, bbox=net_bbox, walker=walker,
                                              access_s=_access_cfg(tr), log=log)
                net_cache[key].set_land(land)
            net = net_cache[key]
        if model == "network" and graph is None:
            try:
                t_g = time.time()
                g, plan, rec = _build_walk_graph(ws, crit, tr, net, feeds, dests, listings, _pad(bbox, 1000), log)
                from .walknet import CellStamp
                graph = (g, plan, rec, CellStamp.build(g, spec, snap_m))
                log(f"  walking: street network ({g.stats.get('km')} km of OpenStreetMap ways, "
                    f"{time.time() - t_g:.1f}s)")
            except Exception as e:  # noqa: BLE001 - any failure falls back to the grid metric
                graph = False
                log(f"  walking: street network unavailable ({e}); using the grid metric")
        fld = None
        if graph:
            from .netroute import NetField, net_surface
            fld = NetField(graph[0], graph[1], net, d["name"], speed, max_access * detour, snap_m)
        profs = {}
        if net is not None:
            t1 = time.time()
            sets = _mode_sets(net)
            eg = fld.egress() if fld is not None else None
            profs = {k: [reverse_scan(net, d["lat"], d["lon"], arrive - 60 * o, speed, detour, max_access,
                                      modes=s, egress_access=egress_access, egress=eg) for o in offsets]
                     for k, s in sets.items()}
            log(f"  {d['name']}: {len(net.conns):,} scheduled hops, {sum(1 for m in net.stop_mask if m):,} stops, "
                f"modes {', '.join(net.modes_present())} ({len(sets) * len(offsets)} scans {time.time() - t1:.1f}s)")
        t2 = time.time()
        la, lo = spec.centres()
        LA, LO = np.meshgrid(la, lo, indexing="ij")
        if fld is not None:
            stamp = graph[3]
            pts = sorted({(round(L["lat"], 6), round(L["lon"], 6)) for L in timed if L.get("lat") is not None})
            mins, walk_min, near_m, runs, walks = net_surface(fld, profs, stamp, pts)
            R = _NetRouter(net, profs, (d["lat"], d["lon"]), speed, detour, max_access, runs, walks)
            blank = ~np.isfinite(walk_min)  # farther than walk_snap_m from any walkable way
            if net is not None:
                blank |= (walk_min > d.get("max_minutes", 30)) & ~(near_m <= mask_m * detour)
            grids = {k: mins[k] for k in ([TRANSIT] + [k for k in profs if k != TRANSIT])} if profs \
                else {TRANSIT: walk_min}
        else:
            R = _Router(net, profs, (d["lat"], d["lon"]), speed, detour, max_access, walker)
            cell_land = land.at(LA, LO) if land is not None else None
            srf = surface(net, profs, (d["lat"], d["lon"]), spec, max_access, walker, cell_land=cell_land,
                          stop_land=net.stop_land() if net is not None else None)
            blank = np.zeros((spec.rows, spec.cols), dtype=bool)
            if net is not None:  # off the network: far from every stop and too far to walk
                blank = (srf.walk_min > d.get("max_minutes", 30)) & ~(srf.nearest_stop_m <= mask_m * detour)
            grids = {k: srf.minutes[k] for k in ([TRANSIT] + [k for k in profs if k != TRANSIT])} if profs \
                else {TRANSIT: srf.walk_min}
        if land is not None:
            blank |= ~land.is_land(LA, LO)  # water
        t3 = time.time()
        base = {"kind": "commute", "name": d["name"],
                "destination": {k: d.get(k) for k in ("name", "address", "lat", "lon")},
                "arrive_by": d.get("arrive_by", "09:00"), "service_date": str(day),
                "feeds": [f.get("name") for f in tr.get("feeds") or []],
                "bbox": [round(v, 7) for v in spec.bbox], "rows": spec.rows, "cols": spec.cols, "cell_m": cell,
                "arrival_offsets_min": offsets, "water_masked": land is not None,
                "walk_model": "network" if graph else "grid"}
        if graph:
            g, plan = graph[0], graph[1]
            base["walk_network"] = {"source": "OpenStreetMap (Overpass)", "km": g.stats.get("km"),
                                    "junctions": g.stats.get("junctions"), "snap_m": snap_m,
                                    "osm_base": next((q.get("rows_updated") for q in graph[2]
                                                      if q.get("dataset") == "overpass"), None),
                                    "entrances": plan.entrance_stats or None,
                                    "sources": [{k: v for k, v in q.items() if k != "queries"} for q in graph[2]]}
        walking = "walking the OpenStreetMap street network to station entrances" if graph else "walking"
        method = (f"GTFS reverse connection scan + {walking}, the router's answer at each cell centre, averaged "
                  f"over arrivals {min(offsets)}-{max(offsets)} min before arrive_by") if feeds else walking
        for k, vals in grids.items():
            if wanted is not None or (k != TRANSIT and not mode_grids):
                continue
            m = np.where(blank | ~np.isfinite(vals) | (vals >= 120), np.nan, vals)
            layer = {**base, "mode": k, "modes": sorted(grids), "method": method, "scale": 0.5, "nodata": NODATA,
                     "values_u8": encode_minutes(m), "generated": dt.datetime.now().isoformat(timespec="seconds")}
            suffix = "" if k == TRANSIT else f"-{k}"
            if k != TRANSIT:
                layer["name"] = f"{d['name']} ({k})"
                layer["kind"] = "commute-mode"
            out = out_dir / f"commute-{slugify(d['name'])}{suffix}.json"
            out.write_text(json.dumps(layer, separators=(",", ":")))
            if k == TRANSIT:
                layers.append(layer)
            log(f"    layer {out.name}: {out.stat().st_size / 1024:.0f} KB")
        n, seen = 0, {}
        for L in timed:
            if L.get("lat") is None:
                continue
            key = (round(L["lat"], 6), round(L["lon"], 6))
            if key not in seen:
                seen[key] = commute_entry(R, L["lat"], L["lon"])
            L.setdefault("commute", {})[d["name"]] = json.loads(json.dumps(seen[key]))
            n += 1
        log(f"  {d['name']}: grid {spec.rows}x{spec.cols} at {cell:.0f} m ({t3 - t2:.1f}s), {n} listings "
            f"at {len(seen)} points ({time.time() - t3:.1f}s); total {time.time() - t0:.1f}s")
    return layers


def commute_entry(R: _Router, lat: float, lon: float) -> dict:
    """commute[dest] for one point: best-of-transit minutes and route, plus every mode."""
    ws, wm = R.walk_s(lat, lon)
    walk = {"minutes": round(ws / 60, 1), "m": int(round(wm)), "route": f"walk {ws / 60:.0f} min"}
    res = R.minutes(lat, lon)
    modes: dict[str, dict] = {"walk": walk}
    for k, runs in res.items():
        modes[k] = R.entry(k, runs, lat, lon)
    best = modes.get(TRANSIT) or walk
    return {"minutes": best["minutes"], "mode": "walk" if best.get("via", "walk") == "walk" else "transit",
            "route": best["route"], "modes": modes}


def _next_weekday() -> dt.date:
    d = dt.date.today() + dt.timedelta(days=1)
    while d.weekday() > 3:
        d += dt.timedelta(days=1)
    return d

