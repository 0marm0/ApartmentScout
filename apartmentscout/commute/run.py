"""Compute commute heat grids and per-listing commute times, by mode, for every destination.

For each destination the network is loaded once (all feeds, every mode) and scanned per mode set:
each single mode present in the feeds (subway, bus, rail, ferry) and "transit" (every mode together,
so a bus to the subway counts). Every scan runs at several arrival times (arrive_by minus
arrival_offsets_min) so the minutes include typical waiting; a listing gets the mean and the min-max
range, plus the legs of the median trip. Walking is always an option inside every mode.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import time
from pathlib import Path

from ..geo import haversine_m
from ..listings import slugify
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
            download_feed(f["url"], path)
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
    city = (crit.get("search") or {}).get("city")
    p = CITIES / f"{city}.yaml"
    if not city or not p.exists():
        return []
    import yaml
    return list((yaml.safe_load(p.read_text()) or {}).get("walk_grids") or [])


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
            d = haversine_m(lat, lon, self.net.lat[stop], self.net.lon[stop]) * self.detour
            legs = journey(self.net, prof, stop, a, d, self.detour)
        out = {"minutes": round(mean, 1), "range": [round(min(mins), 1), round(max(mins), 1)],
               "route": route_text(legs) if stop >= 0 else f"walk {mins[i]:.0f} min",
               **legs_summary(legs), "legs": legs, "legs_arrive_by": clock(prof.arrive_by)}
        return out


def _grid(bbox, cell_m):
    lon0, lat0, lon1, lat1 = bbox
    dlat = cell_m / 110574
    dlon = cell_m / (111320 * math.cos(math.radians((lat0 + lat1) / 2)))
    rows, cols = int((lat1 - lat0) / dlat) + 1, int((lon1 - lon0) / dlon) + 1
    return rows, cols, dlat, dlon


def run_commute(ws, listings: list[dict], crit: dict, cell_m: float = 150, pad_m: float = 1500,
                log=print, layers_dir: Path | None = None, mode_grids: bool | None = None) -> list[dict]:
    """Route every destination; write commute-<dest>.json (best of transit) and, per mode,
    commute-<dest>-<mode>.json; set L["commute"][dest] on every geocoded listing."""
    cm = crit.get("commute") or {}
    dests = cm.get("destinations") or []
    tr = cm.get("transit") or {}
    speed = (tr.get("walk_speed_kmh") or 4.8) / 3.6
    detour = tr.get("walk_detour", 1.25)
    max_access = tr.get("max_walk_to_station_m", 1200)
    mask_m = tr.get("heat_mask_m", 1000)  # grid cells farther than this from any stop are left blank
    offsets = tr.get("arrival_offsets_min", [0, 3, 6, 9, 12])
    window = 60 * int(tr.get("window_min", 150))  # how long before arrive_by a trip may start
    egress_access = float(tr.get("egress_access", 1))  # platform-to-street at the destination end too
    if mode_grids is None:
        mode_grids = bool(tr.get("mode_grids", True))
    day = dt.date.fromisoformat(str(tr.get("service_date") or _next_weekday()))
    walker = make_walker(crit)
    if walker.grids:
        log(f"  walking: street-grid metric in {', '.join(g.name for g in walker.grids)}, "
            f"straight line x {detour} elsewhere")
    feeds = feed_specs(ws, crit, log)
    bbox = _bbox(listings, dests, pad_m)
    net_bbox = _pad(bbox, max(max_access, 1000) + 1000)  # stops a little beyond the grid still matter
    rows, cols, dlat, dlon = _grid(bbox, cell_m)
    lon0, lat0, _, _ = bbox
    out_dir = layers_dir or ws.layers_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    layers = []
    net_cache: dict[tuple[int, int], Network] = {}
    for d in dests:
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
            net = net_cache[key]
            t1 = time.time()
            sets = _mode_sets(net)
            profs = {k: [reverse_scan(net, d["lat"], d["lon"], arrive - 60 * o, speed, detour, max_access,
                                      modes=s, egress_access=egress_access) for o in offsets]
                     for k, s in sets.items()}
            log(f"  {d['name']}: {len(net.conns):,} scheduled hops, {sum(1 for m in net.stop_mask if m):,} stops, "
                f"modes {', '.join(net.modes_present())} (load {t1 - t0:.1f}s, {len(sets) * len(offsets)} scans "
                f"{time.time() - t1:.1f}s)")
        else:
            profs = {}
        R = _Router(net, profs, (d["lat"], d["lon"]), speed, detour, max_access, walker)
        t2 = time.time()
        grids: dict[str, list[int]] = {k: [] for k in ([TRANSIT] + [k for k in profs if k != TRANSIT])}
        if not profs:
            grids = {TRANSIT: []}
        for r in range(rows):
            la = lat0 + (r + 0.5) * dlat
            for c in range(cols):
                lo = lon0 + (c + 0.5) * dlon
                ws_, _ = R.walk_s(la, lo)
                acc = R.access(la, lo)
                if acc is not None and not (acc.dist <= mask_m * detour).any() and \
                        ws_ / 60 > d.get("max_minutes", 30):
                    for g in grids.values():
                        g.append(-1)  # off the network (rivers, parks, other states): leave blank
                    continue
                res = R.minutes(la, lo, acc)
                for k, g in grids.items():
                    m = sum(x[0] for x in res[k]) / len(res[k]) if k in res else ws_ / 60
                    g.append(int(round(m)) if m < 120 else -1)
        t3 = time.time()
        base = {"kind": "commute", "name": d["name"],
                "destination": {k: d.get(k) for k in ("name", "address", "lat", "lon")},
                "arrive_by": d.get("arrive_by", "09:00"), "service_date": str(day),
                "feeds": [f.get("name") for f in tr.get("feeds") or []],
                "bbox": [round(v, 6) for v in bbox], "rows": rows, "cols": cols, "cell_m": cell_m}
        method = (f"GTFS reverse connection scan + walking, averaged over arrivals "
                  f"{min(offsets)}-{max(offsets)} min before arrive_by") if feeds else "walking only"
        for k, vals in grids.items():
            if k != TRANSIT and not mode_grids:
                continue
            layer = {**base, "mode": k, "modes": sorted(grids), "method": method, "values": vals,
                     "generated": dt.datetime.now().isoformat(timespec="seconds")}
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
        for L in listings:
            if L.get("lat") is None:
                continue
            key = (round(L["lat"], 6), round(L["lon"], 6))
            if key not in seen:
                seen[key] = commute_entry(R, L["lat"], L["lon"])
            L.setdefault("commute", {})[d["name"]] = json.loads(json.dumps(seen[key]))
            n += 1
        log(f"  {d['name']}: grid {rows}x{cols} at {cell_m:.0f} m ({t3 - t2:.1f}s), {n} listings "
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

