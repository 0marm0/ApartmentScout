"""Per-mode commute routing on small synthetic GTFS feeds (no network).

Geometry, all on one meridian (lon -74.0), destination at S3:

    home/B1 40.7000 --bus M1 (6 min)--> B2 40.7090 --bus M2 (17 min)--> B3 40.7268
                                        S2 40.7092 --subway X (3 min)--> S3 40.7270 = destination

Arrive by 09:00. Subway only means walking 1 km to S2; bus only means M1 then the slow M2;
transit (any mode) rides M1 and changes to the subway at B2/S2, which beats both.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import zipfile
from pathlib import Path

import pytest

from apartmentscout.commute.gtfs import (MODE_BIT, journey, legs_summary, load_network, pretty_stop, reverse_scan,
                                         route_mode, route_text, access_points, best_from)
from apartmentscout.commute.run import commute_entry, decode_minutes, run_commute, _Router
from apartmentscout.config import Workspace

SPEED, DETOUR = 4.8 / 3.6, 1.25
DAY = dt.date(2026, 10, 14)
ARRIVE = 9 * 3600
HOME = (40.7000, -74.0)
DEST = (40.7270, -74.0)
CAL = ("service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
       "WK,1,1,1,1,1,0,0,20260101,20261231\n")
AGENCY = "agency_id,agency_name,agency_url,agency_timezone\nA,A,http://a,America/New_York\n"


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def _subway() -> bytes:
    return _zip({
        "agency.txt": AGENCY, "calendar.txt": CAL,
        "routes.txt": "route_id,route_short_name,route_type\nRX,X,1\n",
        "trips.txt": "route_id,service_id,trip_id\nRX,WK,x1\nRX,WK,x2\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                     "PS2,Mid Station,40.7092,-74.0,1,\n"
                     "S2,Mid Station,40.7092,-74.0,0,PS2\n"
                     "S2b,Mid Station,40.7092,-74.0,0,PS2\n"
                     "S3,Terminal,40.7270,-74.0,0,\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                          "x1,08:40:00,08:40:00,S2,1\nx1,08:43:00,08:43:00,S3,2\n"
                          "x2,08:50:00,08:50:00,S2,1\nx2,08:53:00,08:53:00,S3,2\n",
        # published transfer between the platforms of one station, named by the parent (as the MTA does)
        "transfers.txt": "from_stop_id,to_stop_id,transfer_type,min_transfer_time\nPS2,PS2,2,300\n",
    })


def _bus() -> bytes:
    return _zip({
        "agency.txt": AGENCY, "calendar.txt": CAL,
        "routes.txt": "route_id,route_short_name,route_type\nM1,M1,3\nM2,M2,3\nBXM,BxM9,3\n",
        "trips.txt": "route_id,service_id,trip_id\nM1,WK,a1\nM1,WK,a2\nM2,WK,b1\nM2,WK,b2\nBXM,WK,e1\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n"
                     "B1,SOUTH ST/1 AV,40.7000,-74.0\nB2,MID ST/1 AV,40.7090,-74.0\nB3,NORTH ST/1 AV,40.7268,-74.0\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                          "a1,08:25:00,08:25:00,B1,1\na1,08:31:00,08:31:00,B2,2\n"
                          "a2,08:35:00,08:35:00,B1,1\na2,08:41:00,08:41:00,B2,2\n"
                          "b1,08:33:00,08:33:00,B2,1\nb1,08:50:00,08:50:00,B3,2\n"
                          "b2,08:43:00,08:43:00,B2,1\nb2,09:00:00,09:00:00,B3,2\n"
                          # a fast premium express straight to the destination (excluded in one test)
                          "e1,08:45:00,08:45:00,B1,1\ne1,08:52:00,08:52:00,B3,2\n",
    })


@pytest.fixture()
def feeds(tmp_path: Path) -> list[tuple]:
    s, b = tmp_path / "subway.zip", tmp_path / "bus.zip"
    s.write_bytes(_subway())
    b.write_bytes(_bus())
    return [("subway", s, None), ("bus", b, None, ["^BxM"])]


@pytest.fixture()
def net(feeds):
    return load_network(feeds, DAY, 6 * 3600, ARRIVE, SPEED, DETOUR, log=None)


def _minutes(net, modes, egress=1.0):
    prof = reverse_scan(net, *DEST, ARRIVE, SPEED, DETOUR, modes=modes, egress_access=egress)
    acc = access_points(net, *HOME, 1200, SPEED, DETOUR)
    walk_s = 3001 * DETOUR / SPEED
    return prof, acc, best_from(prof, acc, walk_s)


def test_route_type_and_names():
    assert route_mode(1) == "subway" and route_mode("3") == "bus" and route_mode(2) == "rail"
    assert route_mode(4) == "ferry" and route_mode(700) == "bus" and route_mode(401) == "subway"
    assert pretty_stop("1 AV/E 43 ST") == "1 Av/E 43 St"
    assert pretty_stop("BROADWAY/W 3RD ST") == "Broadway/W 3rd St"
    assert pretty_stop("Grand Central-42 St") == "Grand Central-42 St"


def test_modes_are_tagged_and_excluded_routes_dropped(net):
    assert set(net.trip_mode) == {"subway", "bus"}
    assert "BxM9" not in net.trip_route  # premium express excluded by pattern
    i = net.stop_ids.index("bus:B1")
    assert net.stop_mask[i] == MODE_BIT["bus"]
    assert net.stop_name[i] == "South St/1 Av"


def test_parent_station_transfers_apply_to_platforms(net):
    s2, s2b = net.stop_ids.index("subway:S2"), net.stop_ids.index("subway:S2b")
    assert (s2b, 300) in net.foot[s2]  # walking S2b -> S2 costs the published 300 s, not a 60 s proximity hop
    assert all(t == 300 for j, t in net.foot[s2] if j == s2b)


def test_mode_separation(net):
    _, _, (sub, sub_stop, _) = _minutes(net, ("subway",))
    _, _, (bus, bus_stop, _) = _minutes(net, ("bus",))
    _, _, (anym, any_stop, _) = _minutes(net, None)
    # subway only: walk 1023 m to S2 (+2 min to the platform), X at 08:50, +2 min up to the street at S3
    assert net.stop_ids[sub_stop] == "subway:S2"
    assert sub == pytest.approx(28.0, abs=0.2)
    # bus only: M1 08:25 then M2 08:33 (the 08:35 M1 misses the last M2 that makes it)
    assert net.stop_ids[bus_stop] == "bus:B1"
    assert bus == pytest.approx(35.5, abs=0.2)
    # any mode: M1 08:35, change to the subway at Mid, X 08:50
    assert net.stop_ids[any_stop] == "bus:B1"
    assert anym == pytest.approx(25.5, abs=0.2)
    assert anym < sub < bus


def test_transfer_legs_and_route_text(net):
    prof, acc, (m, stop, a) = _minutes(net, None)
    d = 0.0
    legs = journey(net, prof, stop, a, d)
    kinds = [x["mode"] for x in legs]
    assert kinds == ["walk", "bus", "transfer", "subway", "walk"]
    bus, tr, sub, last = legs[1], legs[2], legs[3], legs[4]
    assert (bus["route"], bus["board"], bus["alight"], bus["to"]) == ("M1", "08:35", "08:41", "Mid St/1 Av")
    assert tr["at"] == "Mid St/1 Av" and tr["to"] == "Mid Station"
    assert (sub["route"], sub["board"], sub["alight"], sub["from"]) == ("X", "08:50", "08:53", "Mid Station")
    assert sub["wait"] > 0
    assert last["to"] == "destination" and last["min"] == pytest.approx(2.0, abs=0.1)  # 0 m + 2 min to the street
    s = legs_summary(legs)
    assert s["via"] == "mixed" and s["transfers"] == 1 and s["ride_min"] == pytest.approx(9.0)
    assert route_text(legs) == ("walk 0 min to South St/1 Av → bus M1 to Mid St/1 Av → X to Terminal → "
                                "walk 2 min to destination")


def test_bus_to_bus_transfer_at_one_stop(net):
    prof, acc, (m, stop, a) = _minutes(net, ("bus",))
    legs = journey(net, prof, stop, a, 0)
    assert [x["mode"] for x in legs] == ["walk", "bus", "bus", "walk"]
    assert [x["route"] for x in legs[1:3]] == ["M1", "M2"]
    assert legs[2]["board"] == "08:33" and legs[2]["wait"] == 2.0


def test_commute_entry_shape(net):
    sets = {"subway": ("subway",), "bus": ("bus",), "transit": None}
    profs = {k: [reverse_scan(net, *DEST, ARRIVE - 60 * o, SPEED, DETOUR, modes=s, egress_access=1.0)
                 for o in (0, 3, 6)] for k, s in sets.items()}
    e = commute_entry(_Router(net, profs, DEST, SPEED, DETOUR, 1200), *HOME)
    assert set(e) == {"minutes", "mode", "route", "modes"}
    assert set(e["modes"]) == {"walk", "subway", "bus", "transit"}
    assert e["minutes"] == e["modes"]["transit"]["minutes"] and e["mode"] == "transit"
    for k in ("subway", "bus", "transit"):
        x = e["modes"][k]
        assert x["range"][0] <= x["minutes"] <= x["range"][1]
        assert {"route", "legs", "via", "transfers", "ride_min", "walk_min", "wait_min", "legs_arrive_by"} <= set(x)
    assert e["modes"]["walk"]["minutes"] == pytest.approx(3002 * DETOUR / SPEED / 60, abs=0.2)
    assert e["modes"]["transit"]["minutes"] <= min(e["modes"]["subway"]["minutes"], e["modes"]["bus"]["minutes"])


def test_walking_wins_inside_every_mode(net):
    near = (40.7262, -74.0)  # 90 m from the destination
    profs = {"transit": [reverse_scan(net, *DEST, ARRIVE, SPEED, DETOUR)]}
    e = commute_entry(_Router(net, profs, DEST, SPEED, DETOUR, 1200), *near)
    assert e["mode"] == "walk" and e["modes"]["transit"]["via"] == "walk"
    assert e["modes"]["transit"]["minutes"] == e["modes"]["walk"]["minutes"]


def test_run_commute_writes_mode_grids(tmp_path, feeds):
    ws = Workspace(tmp_path / "search")
    crit = {"commute": {
        "destinations": [{"name": "Office", "lat": DEST[0], "lon": DEST[1], "arrive_by": "09:00", "max_minutes": 30}],
        "transit": {"service_date": str(DAY), "arrival_offsets_min": [0, 5],
                    "feeds": [{"name": "Subway", "path": str(feeds[0][1]), "mode": "subway"},
                              {"name": "Bus", "path": str(feeds[1][1]), "mode": "bus",
                               "exclude_routes": ["^BxM"]}]}}}
    listings = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}, {"id": "b", "lat": 40.7091, "lon": -74.0005}]
    layers = run_commute(ws, listings, crit, cell_m=300, pad_m=300, log=lambda *_: None, times=False)   # times of day: test_commute_times.py
    assert len(layers) == 1 and layers[0]["mode"] == "transit"
    files = sorted(p.name for p in ws.layers_dir.glob("commute-*.json"))
    assert files == ["commute-office-bus.json", "commute-office-subway.json", "commute-office.json"]
    sub = json.loads((ws.layers_dir / "commute-office-subway.json").read_text())
    best = json.loads((ws.layers_dir / "commute-office.json").read_text())
    assert sub["mode"] == "subway" and sub["kind"] == "commute-mode" and best["kind"] == "commute"
    sv, bv = decode_minutes(sub), decode_minutes(best)
    assert len(sv) == sub["rows"] * sub["cols"] == len(bv)
    assert all(b <= s for b, s in zip(bv, sv) if b >= 0 and s >= 0)
    c = listings[0]["commute"]["Office"]
    assert c["modes"]["transit"]["via"] == "mixed"
    assert c["minutes"] < c["modes"]["subway"]["minutes"] < c["modes"]["bus"]["minutes"]
