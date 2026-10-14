"""Compute commute heat grids and per-listing commute times for every destination."""
from __future__ import annotations

import datetime as dt
import json
import math
import time
from pathlib import Path

from ..geo import haversine_m
from ..listings import slugify
from .gtfs import (StopIndex, describe_route, door_to_door, download_feed, load_network,
                   reverse_scan, _hhmm)


def _bbox(listings: list[dict], dests: list[dict], pad_m: float) -> tuple[float, float, float, float]:
    pts = [(L["lat"], L["lon"]) for L in listings if L.get("lat") is not None and L.get("status") != "gone"]
    pts += [(d["lat"], d["lon"]) for d in dests if d.get("lat") is not None]
    if not pts:
        raise ValueError("No geocoded listings. Run `apartmentscout geocode` first.")
    lats, lons = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
    # trim far outliers so one odd listing does not blow up the grid
    k = max(0, int(len(pts) * 0.01))
    la0, la1, lo0, lo1 = lats[k], lats[-1 - k], lons[k], lons[-1 - k]
    dlat = pad_m / 110574
    dlon = pad_m / (111320 * math.cos(math.radians((la0 + la1) / 2)))
    return lo0 - dlon, la0 - dlat, lo1 + dlon, la1 + dlat


def feed_paths(ws, crit: dict, log=print) -> list[tuple[str, Path]]:
    """Local paths of the search's GTFS feeds, downloading (or refreshing) them into the cache."""
    feeds = []
    for f in ((crit.get("commute") or {}).get("transit") or {}).get("feeds") or []:
        name = slugify(f.get("name") or "feed")
        path = Path(f["path"]) if f.get("path") else ws.cache_dir / "gtfs" / f"{name}.zip"
        if not path.exists() or f.get("url"):
            if f.get("url"):
                log(f"  feed {f.get('name')}: {f['url']}")
                download_feed(f["url"], path)
        feeds.append((name, path))
    return feeds


def run_commute(ws, listings: list[dict], crit: dict, cell_m: float = 150, pad_m: float = 1500,
                log=print) -> list[dict]:
    cm = crit.get("commute") or {}
    dests = cm.get("destinations") or []
    tr = cm.get("transit") or {}
    speed = (tr.get("walk_speed_kmh") or 4.8) / 3.6
    detour = tr.get("walk_detour", 1.25)
    max_access = tr.get("max_walk_to_station_m", 1200)
    sa = 60 * tr.get("station_access_min", 2)  # street-to-platform time added to every transit trip
    mask_m = tr.get("heat_mask_m", 1000)  # grid cells farther than this from any stop are left blank
    day = dt.date.fromisoformat(str(tr.get("service_date") or _next_weekday()))
    feeds = feed_paths(ws, crit, log)
    bbox = _bbox(listings, dests, pad_m)
    lon0, lat0, lon1, lat1 = bbox
    dlat = cell_m / 110574
    dlon = cell_m / (111320 * math.cos(math.radians((lat0 + lat1) / 2)))
    rows, cols = int((lat1 - lat0) / dlat) + 1, int((lon1 - lon0) / dlon) + 1
    layers = []
    for d in dests:
        if d.get("lat") is None:
            raise ValueError(f"Destination {d['name']} has no lat/lon. Run `apartmentscout geocode`.")
        arrive = _hhmm(str(d.get("arrive_by", "09:00")))
        t0 = time.time()
        if feeds:
            net = load_network(feeds, day, arrive - 3 * 3600, arrive, speed, detour)
            # average over several arrival times so the result includes typical waiting time
            offsets = tr.get("arrival_offsets_min", [0, 3, 6, 9, 12])
            profs = [reverse_scan(net, d["lat"], d["lon"], arrive - 60 * o, speed, detour) for o in offsets]
            prof = profs[0]
            idx = StopIndex(net)
            log(f"  {d['name']}: {len(net.conns):,} scheduled hops, {len(net.stop_ids):,} stops "
                f"({time.time() - t0:.1f}s)")
        else:
            net = prof = idx = None
            profs = []
        vals = []
        for r in range(rows):
            la = lat0 + (r + 0.5) * dlat
            for c in range(cols):
                lo = lon0 + (c + 0.5) * dlon
                if prof and not any(True for _ in idx.near(la, lo, mask_m)) and \
                        haversine_m(la, lo, d["lat"], d["lon"]) * detour / speed / 60 > d.get("max_minutes", 30):
                    vals.append(-1)  # off the network (rivers, parks, other states): leave blank
                    continue
                if prof:
                    m = sum(door_to_door(la, lo, pf, idx, (d["lat"], d["lon"]), speed, detour, max_access, sa)[0]
                            for pf in profs) / len(profs)
                else:
                    m = haversine_m(la, lo, d["lat"], d["lon"]) * detour / speed / 60
                vals.append(int(round(m)) if m < 120 else -1)
        layer = {"kind": "commute", "name": d["name"], "destination": {k: d.get(k) for k in ("name", "address", "lat", "lon")},
                 "arrive_by": d.get("arrive_by", "09:00"), "service_date": str(day),
                 "method": "GTFS reverse connection scan + walking, averaged over arrivals 0-12 min before arrive_by" if feeds else "walking only",
                 "feeds": [f.get("name") for f in tr.get("feeds") or []],
                 "bbox": [round(v, 6) for v in bbox], "rows": rows, "cols": cols, "cell_m": cell_m,
                 "values": vals, "generated": dt.datetime.now().isoformat(timespec="seconds")}
        out = ws.layers_dir / f"commute-{slugify(d['name'])}.json"
        out.write_text(json.dumps(layer, separators=(",", ":")))
        layers.append(layer)
        n = 0
        for L in listings:
            if L.get("lat") is None:
                continue
            if prof:
                m, best = door_to_door(L["lat"], L["lon"], prof, idx, (d["lat"], d["lon"]), speed, detour, max_access, sa)
                m = sum(door_to_door(L["lat"], L["lon"], pf, idx, (d["lat"], d["lon"]), speed, detour, max_access, sa)[0]
                        for pf in profs) / len(profs)
                route = (describe_route(net, prof, best["stop"], best["access_min"]) if best["mode"] == "transit"
                         else f"walk {m:.0f} min")
            else:
                m = haversine_m(L["lat"], L["lon"], d["lat"], d["lon"]) * detour / speed / 60
                best, route = {"mode": "walk"}, f"walk {m:.0f} min"
            L.setdefault("commute", {})[d["name"]] = {"minutes": round(m, 1), "mode": best["mode"], "route": route}
            n += 1
        log(f"  {d['name']}: grid {rows}x{cols} at {cell_m:.0f} m, {n} listings ({time.time() - t0:.1f}s)")
    return layers


def _next_weekday() -> dt.date:
    d = dt.date.today() + dt.timedelta(days=1)
    while d.weekday() > 3:
        d += dt.timedelta(days=1)
    return d
