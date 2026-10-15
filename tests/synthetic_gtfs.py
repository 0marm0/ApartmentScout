"""A made-up Manhattan subway for tests that need transit across the whole example search without downloading a feed.

Two north-south lines laid on the street grid (29 degrees off true north, like Manhattan's) a kilometre apart, and a
crosstown shuttle on 42nd Street. Trains every 4 minutes from 06:30 to 10:30. Not real service.
"""
from __future__ import annotations

import io
import math
import zipfile
from pathlib import Path

LAT0, LON0, NB = 40.75, -73.98, 29.0
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110574.0


def ll(e: float, n: float) -> tuple[float, float]:
    """(lat, lon) of a point `e` metres east and `n` metres north on the grid around 42nd and Fifth."""
    a = math.radians(NB)
    x, y = e * math.cos(a) + n * math.sin(a), -e * math.sin(a) + n * math.cos(a)
    return LAT0 + y / KY, LON0 + x / KX


def _t(sec: int) -> str:
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def manhattan_feed() -> bytes:
    stops, routes, trips, times = [], [], [], []
    for rid, (e, name) in {"W": (-600, "West line"), "E": (700, "East line")}.items():
        routes.append(f"{rid},{rid},{name},1")
        ids = []
        for n in range(-5400, 9001, 600):
            lat, lon = ll(e, n)
            stops.append(f"{rid}{n},{name} {n // 100},{lat:.6f},{lon:.6f},0,")
            ids.append(f"{rid}{n}")
        for direction, order in (("N", ids), ("S", ids[::-1])):
            for k, t0 in enumerate(range(6 * 3600 + 1800, 10 * 3600 + 1800, 240)):
                trips.append(f"{rid},WK,{rid}{direction}{k}")
                times += [f"{rid}{direction}{k},{_t(t0 + j * 100)},{_t(t0 + j * 100 + 20)},{sid},{j + 1}" for j, sid in enumerate(order)]
    routes.append("S,S,42nd shuttle,1")
    shuttle = [("S-1", -600), ("S-2", -150), ("S-3", 300), ("S-4", 700)]
    for sid, e in shuttle:
        lat, lon = ll(e, 0)
        stops.append(f"{sid},42nd shuttle {e},{lat:.6f},{lon:.6f},0,")
    for direction, order in (("E", shuttle), ("W", shuttle[::-1])):
        for k, t0 in enumerate(range(6 * 3600 + 1800, 10 * 3600 + 1800, 300)):
            trips.append(f"S,WK,S{direction}{k}")
            times += [f"S{direction}{k},{_t(t0 + j * 90)},{_t(t0 + j * 90 + 20)},{sid},{j + 1}" for j, (sid, _) in enumerate(order)]
    files = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA,Synthetic,http://example.test,America/New_York\n",
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20261231\n",
        "routes.txt": "route_id,route_short_name,route_long_name,route_type\n" + "\n".join(routes) + "\n",
        "trips.txt": "route_id,service_id,trip_id\n" + "\n".join(trips) + "\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n" + "\n".join(stops) + "\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "\n".join(times) + "\n",
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def write_manhattan_feed(path: Path) -> Path:
    path.write_bytes(manhattan_feed())
    return path
