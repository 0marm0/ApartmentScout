"""Transit lines and stations from GTFS, as a small GeoJSON layer for the dashboard map.

Every distinct trip shape is simplified (Douglas-Peucker, a few metres) and clipped to the search
area, then grouped by route colour so shared trunks draw as one line. Stations carry the routes
that stop there. Feeds without shapes.txt fall back to straight lines between consecutive stops.
"""
from __future__ import annotations

import datetime as dt
import math
import zipfile
from collections import defaultdict
from pathlib import Path

from .gtfs import _read

# MTA-style route groups share one colour; any feed without route_color gets a neutral grey
DEFAULT_COLOR = "#8a93a3"


def _simplify(pts: list[tuple[float, float]], tol_m: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on lon/lat, distances in metres (equirectangular, fine at city scale)."""
    if len(pts) < 3:
        return pts
    lat0 = math.radians(sum(p[1] for p in pts) / len(pts))
    kx, ky = 111320 * math.cos(lat0), 110574
    xy = [(p[0] * kx, p[1] * ky) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy) or 1e-9
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / seg
            if d > best:
                best, idx = d, i
        if best > tol_m and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def _clip(pts: list[tuple[float, float]], bbox: list[float]) -> list[list[tuple[float, float]]]:
    """Split a polyline into the runs that fall inside bbox (keeping one point either side)."""
    lon0, lat0, lon1, lat1 = bbox
    inside = [lon0 <= x <= lon1 and lat0 <= y <= lat1 for x, y in pts]
    runs, cur = [], []
    for i, p in enumerate(pts):
        near = inside[i] or (i > 0 and inside[i - 1]) or (i + 1 < len(pts) and inside[i + 1])
        if near:
            cur.append(p)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) > 1]


def transit_lines(feeds: list[tuple[str, Path]], bbox: list[float], tol_m: float = 6) -> dict:
    """GeoJSON FeatureCollection: one MultiLineString per route colour plus station points."""
    features: list[dict] = []
    for feed_name, path in feeds:
        with zipfile.ZipFile(path) as z:
            routes = {}
            for r in _read(z, "routes.txt"):
                col = (r.get("route_color") or "").strip()
                routes[r["route_id"]] = {
                    "name": r.get("route_short_name") or r.get("route_long_name") or r["route_id"],
                    "color": f"#{col}" if col else DEFAULT_COLOR,
                    "text": f"#{r['route_text_color']}" if r.get("route_text_color") else "#ffffff",
                    "type": int(r.get("route_type") or 3),
                }
            shape_route: dict[str, str] = {}
            trip_route: dict[str, str] = {}
            for t in _read(z, "trips.txt"):
                trip_route[t["trip_id"]] = t["route_id"]
                if t.get("shape_id"):
                    shape_route.setdefault(t["shape_id"], t["route_id"])
            shapes: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
            for s in _read(z, "shapes.txt"):
                if s["shape_id"] in shape_route:
                    shapes[s["shape_id"]].append((int(s["shape_pt_sequence"]), float(s["shape_pt_lon"]),
                                                  float(s["shape_pt_lat"])))
            stops = {s["stop_id"]: s for s in _read(z, "stops.txt")}
            parent = {k: (s.get("parent_station") or k) for k, s in stops.items()}
            station_routes: dict[str, set[str]] = defaultdict(set)
            seq_by_trip: dict[str, list[tuple[int, str]]] = defaultdict(list)
            need_fallback = not shapes
            for st in _read(z, "stop_times.txt"):
                rid = trip_route.get(st["trip_id"])
                if rid:
                    station_routes[parent.get(st["stop_id"], st["stop_id"])].add(rid)
                    if need_fallback:
                        seq_by_trip[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))
            if need_fallback:
                seen_seq = set()
                for tid, seq in seq_by_trip.items():
                    ids = tuple(s for _, s in sorted(seq))
                    if ids in seen_seq:
                        continue
                    seen_seq.add(ids)
                    shape_route[tid] = trip_route[tid]
                    shapes[tid] = [(i, float(stops[s]["stop_lon"]), float(stops[s]["stop_lat"]))
                                   for i, s in enumerate(ids)]

        by_color: dict[str, dict] = {}
        seen: set[tuple] = set()
        for sid, raw in shapes.items():
            rid = shape_route[sid]
            R = routes.get(rid, {"name": rid, "color": DEFAULT_COLOR, "text": "#ffffff", "type": 3})
            pts = [(round(x, 5), round(y, 5)) for _, x, y in sorted(raw)]
            for run in _clip(_simplify(pts, tol_m), bbox):
                key = tuple(run)
                if key in seen or tuple(reversed(run)) in seen:
                    continue
                seen.add(key)
                g = by_color.setdefault(R["color"], {"routes": set(), "lines": [], "type": R["type"]})
                g["routes"].add(R["name"])
                g["lines"].append([list(p) for p in run])
        for col, g in by_color.items():
            features.append({"type": "Feature", "geometry": {"type": "MultiLineString", "coordinates": g["lines"]},
                             "properties": {"kind": "line", "feed": feed_name, "color": col,
                                            "routes": sorted(g["routes"], key=lambda n: (len(n), n)),
                                            "route_type": g["type"]}})
        lon0, lat0, lon1, lat1 = bbox
        for sid, rset in station_routes.items():
            s = stops.get(sid)
            if not s or not s.get("stop_lat"):
                continue
            x, y = float(s["stop_lon"]), float(s["stop_lat"])
            if not (lon0 <= x <= lon1 and lat0 <= y <= lat1):
                continue
            names = sorted({routes[r]["name"] for r in rset if r in routes}, key=lambda n: (len(n), n))
            colors = [routes[r]["color"] for r in sorted(rset) if r in routes]
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(x, 5), round(y, 5)]},
                             "properties": {"kind": "station", "feed": feed_name, "name": s.get("stop_name", ""),
                                            "routes": names, "color": colors[0] if colors else DEFAULT_COLOR}})
    return {"kind": "lines", "name": "Transit lines", "type": "FeatureCollection",
            "feeds": [n for n, _ in feeds], "bbox": bbox,
            "generated": dt.datetime.now().isoformat(timespec="seconds"), "features": features}
