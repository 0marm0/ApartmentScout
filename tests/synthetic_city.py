"""A made-up city for tests that follow the documented quick start outside New York with the network faked.

``CITY`` has a few addresses with coordinates around Chicago's Loop, one east-west rail line with trains every 10 minutes, and a
Nominatim-shaped answer for the city itself. Not real service, not real addresses' coordinates beyond a few decimals.
"""
from __future__ import annotations

import io
import zipfile

LAT, LON = 41.8785, -87.6360
ADDRESSES = {   # lower-cased address -> (lat, lon, label)
    "233 s wacker dr": (41.87892, -87.636602, "Willis Tower, Chicago"),
    "225 n columbus dr, chicago, il 60601": (41.8851, -87.6203, "Aqua, Chicago"),
    "555 w madison st, chicago, il 60661": (41.8819, -87.6428, "Presidential Towers, Chicago"),
    "505 n lake shore dr, chicago, il 60611": (41.8905, -87.6144, "Lake Point Tower, Chicago"),
}
CHICAGO_ROW = {"place_id": 1, "osm_type": "relation", "osm_id": 122604, "lat": "41.8755616", "lon": "-87.6244212",
               "category": "boundary", "type": "administrative", "addresstype": "city", "name": "Chicago",
               "display_name": "Chicago, Cook County, Illinois, United States",
               "boundingbox": ["41.6439", "42.0230", "-87.9402", "-87.5240"],
               "address": {"city": "Chicago", "county": "Cook County", "state": "Illinois", "country": "United States", "country_code": "us"}}
LISTINGS_CSV = """building,unit,address,neighborhood,beds,baths,sqft,floor,exposure,price.gross,price.free_months,price.lease_months,price.fees_monthly,price.fees_one_time,price.broker_fee,available,amenities.in_unit_wd,amenities.elevator,amenities.doorman,amenities.gym,amenities.pool,amenities.roof_deck,amenities.outdoor_space,amenities.dishwasher,amenities.pets,status,links.listing,notes
Aqua,2504,"225 N Columbus Dr, Chicago, IL 60601",New Eastside,1,1,780,25,SE,2850,1,13,50,0,0,2026-11-15,true,true,true,true,true,true,true,true,true,shortlist,https://example.com/aqua-2504,fixture
Presidential Towers,1210,"555 W Madison St, Chicago, IL 60661",West Loop,1,1,700,12,,2300,0,12,35,0,0,2026-11-10,true,true,true,true,true,false,false,true,true,shortlist,https://example.com/pt-1210,fixture
Lake Point Tower,3108,"505 N Lake Shore Dr, Chicago, IL 60611",Streeterville,1,1,820,31,E,2950,0,12,40,0,0,2026-12-01,false,true,true,true,true,false,true,true,true,new,https://example.com/lpt-3108,fixture
"""


def coords(address: str) -> dict | None:
    hit = ADDRESSES.get(address.strip().lower())
    return {"lat": hit[0], "lon": hit[1], "label": hit[2]} if hit else None


def _t(sec: int) -> str:
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def small_feed() -> bytes:
    """One east-west subway line (route_type 1) through the Loop, 8 stops 700 m apart, a train each way every 10 minutes from 05:30 to 11:00,
    running every day of 2020-2040."""
    ids = [f"S{i}" for i in range(8)]
    lons = [LON - 0.0105 * 3 + 0.0105 * i for i in range(8)]
    stops = [f"{sid},Stop {i},{LAT:.6f},{lon:.6f},0," for i, (sid, lon) in enumerate(zip(ids, lons))]
    trips, times = [], []
    for direction, order in (("E", ids), ("W", ids[::-1])):
        for k, t0 in enumerate(range(5 * 3600 + 1800, 11 * 3600, 600)):
            trips.append(f"L,WK,L{direction}{k}")
            times += [f"L{direction}{k},{_t(t0 + j * 120)},{_t(t0 + j * 120 + 20)},{sid},{j + 1}" for j, sid in enumerate(order)]
    files = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA,Fixture Transit,http://example.test,America/Chicago\n",
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,1,1,20200101,20401231\n",
        "routes.txt": "route_id,route_short_name,route_long_name,route_type\nL,L,Loop line,1\n",
        "trips.txt": "route_id,service_id,trip_id\n" + "\n".join(trips) + "\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n" + "\n".join(stops) + "\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "\n".join(times) + "\n",
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()
