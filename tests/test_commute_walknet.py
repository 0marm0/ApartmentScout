"""Street-network walking (walknet.py, netroute.py, entrances.py) on a small synthetic network (no network I/O).

A 5 x 5 street grid with blocks of ~111 m (0.001 deg of latitude, the same in metres east), plus one
diagonal "Broadway" from the south-west corner to the north-east corner, and a motorway and a road tunnel
that must not be walked.
"""
from __future__ import annotations

import datetime as dt
import json
import math

import numpy as np
import pytest

from apartmentscout.commute import walknet
from apartmentscout.commute.entrances import Entrance, access_points as entrance_points, parse_mta
from apartmentscout.commute.grid import GridSpec
from apartmentscout.commute.run import decode_minutes, run_commute, walk_model
from apartmentscout.commute.walknet import CellStamp, build_graph, walkable
from apartmentscout.config import Workspace

LAT0, LON0 = 40.70, -74.00
DLAT = 0.001
DLON = 0.001 * 110574 / (111320 * math.cos(math.radians(LAT0 + 0.002)))  # same metres as DLAT


def _nid(i: int, j: int) -> int:
    return 1000 + i * 10 + j


def _network(diagonal: bool = True):
    nodes = {_nid(i, j): (LAT0 + i * DLAT, LON0 + j * DLON) for i in range(5) for j in range(5)}
    ways = {}
    w = 1
    for i in range(5):
        ways[w] = (tuple(_nid(i, j) for j in range(5)), {"highway": "residential"})
        w += 1
    for j in range(5):
        ways[w] = (tuple(_nid(i, j) for i in range(5)), {"highway": "secondary"})
        w += 1
    if diagonal:
        ways[w] = (tuple(_nid(k, k) for k in range(5)), {"highway": "primary", "name": "Broadway"})
        w += 1
    # a motorway and a road tunnel straight across: not walkable
    nodes[9001], nodes[9002] = (LAT0 + 0.5 * DLAT, LON0), (LAT0 + 3.5 * DLAT, LON0 + 4 * DLON)
    ways[90] = ((_nid(0, 0), 9001, 9002, _nid(4, 4)), {"highway": "motorway"})
    ways[91] = ((_nid(0, 4), _nid(4, 0)), {"highway": "primary", "tunnel": "yes"})
    # a tiny disconnected courtyard path (dropped as a small component)
    nodes[9101], nodes[9102] = (LAT0 + 2.5 * DLAT, LON0 + 2.5 * DLON), (LAT0 + 2.6 * DLAT, LON0 + 2.5 * DLON)
    ways[92] = ((9101, 9102), {"highway": "footway"})
    return ways, nodes


def test_walkable_filter():
    assert walkable({"highway": "footway"}) and walkable({"highway": "residential"})
    assert walkable({"highway": "trunk"}) and walkable({"highway": "steps"})
    assert not walkable({"highway": "motorway"})
    assert walkable({"highway": "motorway", "foot": "yes"})
    assert not walkable({"highway": "footway", "foot": "no"})
    assert not walkable({"highway": "primary", "foot": "use_sidepath"})
    assert not walkable({"highway": "service", "access": "private"})
    assert not walkable({"highway": "primary", "tunnel": "yes"})
    assert walkable({"highway": "footway", "tunnel": "yes"})  # a pedestrian underpass
    assert not walkable({"building": "yes"})


def test_tiles_cover_and_snap_to_a_lattice():
    t = walknet.tiles((-74.01, 40.69, -73.96, 40.76), 0.05)
    assert len(t) == 3 * 2
    s = min(x[0] for x in t), min(x[1] for x in t), max(x[2] for x in t), max(x[3] for x in t)
    assert s[0] <= 40.69 and s[1] <= -74.01 and s[2] >= 40.76 and s[3] >= -73.96
    q = walknet.overpass_query(*t[0])
    assert "out body" in q and "footway" in q and "foot" in q


def test_graph_walks_the_diagonal_not_the_motorway():
    ways, nodes = _network()
    g = build_graph(ways, nodes, anchors=[(LAT0, LON0), (LAT0 + 4 * DLAT, LON0 + 4 * DLON),
                                          (LAT0 + 4 * DLAT, LON0)], min_component_m=50)
    assert g.stats["anchors_placed"] == 3
    a, b, c = (int(x) for x in g.anchor_node)
    cost, src = g.dijkstra([(a, 0.0, 7)])
    block = DLAT * 110574
    # corner to corner along Broadway: 4 x sqrt(2) blocks, not 8 (L1) and not via the motorway
    assert cost[b] == pytest.approx(4 * math.sqrt(2) * block, rel=0.01)
    # straight up the avenue: 4 blocks; the road tunnel across is not used
    assert cost[c] == pytest.approx(4 * block, rel=0.01)
    assert src[b] == 7
    # the courtyard path was dropped
    assert g.stats["dropped_small_components_km"] > 0


def test_anchor_inserted_mid_block_and_snap_distance():
    ways, nodes = _network(diagonal=False)
    mid = (LAT0 + 0.00003, LON0 + 2.5 * DLON)  # 3 m north of the middle of the southern street
    g = build_graph(ways, nodes, anchors=[mid, (LAT0, LON0)], min_component_m=50)
    m, a0 = int(g.anchor_node[0]), int(g.anchor_node[1])
    assert g.anchor_snap_m[0] == pytest.approx(3.3, abs=0.5)
    cost, _ = g.dijkstra([(a0, 0.0, 0)])
    assert cost[m] == pytest.approx(2.5 * DLAT * 110574, rel=0.01)  # along the street, not via a corner


def test_limit_stops_a_label_spreading():
    ways, nodes = _network(diagonal=False)
    g = build_graph(ways, nodes, anchors=[(LAT0, LON0)], min_component_m=50)
    a = int(g.anchor_node[0])
    cost, src = g.dijkstra([(a, 1000.0, 3)], limit_m=250)
    reached = np.isfinite(cost)
    assert reached.sum() >= 3 and (~reached).any()
    assert (cost[reached] - 1000 <= 250 + 1e-6).all() and (src[reached] == 3).all()


def test_cell_stamp_blanks_cells_far_from_any_way():
    ways, nodes = _network()
    g = build_graph(ways, nodes, anchors=[(LAT0, LON0)], min_component_m=50, step_m=10)
    spec = GridSpec.cover((LON0 - 3 * DLON, LAT0 - 3 * DLAT, LON0 + 7 * DLON, LAT0 + 7 * DLAT), 50)
    st = CellStamp.build(g, spec, 60)
    cost, _ = g.dijkstra([(int(g.anchor_node[0]), 0.0, 0)])
    grid = st.apply(g.sample_cost(cost))
    la, lo = spec.centres()
    r0 = int(np.argmin(np.abs(la - LAT0)))
    c0 = int(np.argmin(np.abs(lo - LON0)))
    assert grid[r0, c0] < 60  # next to the anchor
    assert not np.isfinite(grid[0, 0])  # 300 m outside the network: blank
    # a cell on the diagonal is reached along it: about distance from the corner, not L1
    k = 2 * DLAT
    r, c = int(np.argmin(np.abs(la - (LAT0 + k)))), int(np.argmin(np.abs(lo - (LON0 + 2 * DLON))))
    assert grid[r, c] < 2 * math.sqrt(2) * DLAT * 110574 + 60


def test_mta_entrances_parse_and_map_to_platforms():
    rows = [{"gtfs_stop_id": "718; R09", "entrance_latitude": "40.7", "entrance_longitude": "-74.0",
             "entry_allowed": "YES", "exit_allowed": "NO"},
            {"gtfs_stop_id": "R09", "entrance_latitude": "40.7005", "entrance_longitude": "-74.0",
             "entry_allowed": "NO", "exit_allowed": "YES"},
            {"gtfs_stop_id": "", "entrance_latitude": "x"}]
    ents = parse_mta(rows)
    assert [e.station for e in ents] == ["718", "R09", "R09"]
    assert ents[0].entry and not ents[0].exit and not ents[2].entry

    class N:  # the two platforms of station R09 and a bus stop
        stop_ids = ["sub:R09N", "sub:R09S", "bus:100"]
        lat = [40.7002, 40.7002, 40.71]
        lon = [-74.0, -74.0, -74.0]
        stop_mask = [1, 1, 2]
    parents = {"sub:R09N": "R09", "sub:R09S": "R09", "bus:100": "100"}
    enter, leave, st = entrance_points(N, ents, parents)
    assert enter[0] == [(40.7, -74.0)] and leave[0] == [(40.7005, -74.0)]
    assert enter[2] == [(40.71, -74.0)]  # a bus stop is its own entrance
    assert st["stops_with_entrances"] == 2


def test_walk_model_defaults():
    assert walk_model({}) == "grid"
    assert walk_model({"search": {"city": "nyc"}}) == "network"
    assert walk_model({"search": {"city": "nyc"}, "commute": {"transit": {"walk_model": "grid"}}}) == "grid"
    with pytest.raises(ValueError):
        walk_model({"commute": {"transit": {"walk_model": "teleport"}}})


def _fake_overpass(ways, nodes):
    els = [{"type": "way", "id": k, "nodes": list(v[0]), "tags": v[1]} for k, v in ways.items()]
    els += [{"type": "node", "id": k, "lat": v[0], "lon": v[1]} for k, v in nodes.items()]

    def f(query, cache_dir=None, max_age_days=None, refresh=False):
        return els
    return f


def test_run_commute_walk_only_on_the_network(tmp_path, monkeypatch):
    ways, nodes = _network()
    monkeypatch.setattr(walknet.F, "overpass", _fake_overpass(ways, nodes))
    ws = Workspace(tmp_path)
    dest = (LAT0 + 4 * DLAT, LON0 + 4 * DLON)
    crit = {"commute": {"destinations": [{"name": "Office", "lat": dest[0], "lon": dest[1], "max_minutes": 30}],
                        "transit": {"walk_model": "network", "land": False}}}
    listings = [{"id": "a", "lat": LAT0, "lon": LON0}, {"id": "b", "lat": LAT0 + 4 * DLAT, "lon": LON0}]
    logs = []
    run_commute(ws, listings, crit, cell_m=50, pad_m=200, log=logs.append)
    assert any("street network" in x for x in logs), logs
    block = DLAT * 110574
    speed = 4.8 / 3.6
    a = listings[0]["commute"]["Office"]
    assert a["modes"]["walk"]["m"] == pytest.approx(4 * math.sqrt(2) * block, rel=0.02)
    b = listings[1]["commute"]["Office"]
    assert b["minutes"] == pytest.approx(4 * block / speed / 60, rel=0.02)
    lay = json.loads((ws.layers_dir / "commute-office.json").read_text())
    assert lay["walk_model"] == "network" and lay["walk_network"]["km"] > 0
    v = np.array(decode_minutes(lay)).reshape(lay["rows"], lay["cols"])
    lo0, la0, lo1, la1 = lay["bbox"]
    r = int((LAT0 - la0) / (la1 - la0) * lay["rows"])
    c = int((LON0 - lo0) / (lo1 - lo0) * lay["cols"])
    assert abs(v[r, c] - a["minutes"]) < 1.0  # the heat map agrees with the listing
    assert (v == -1).any()  # cells away from the streets are blank


def test_network_failure_falls_back_to_the_grid(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("Overpass unavailable")
    monkeypatch.setattr(walknet.F, "overpass", boom)
    ws = Workspace(tmp_path)
    crit = {"commute": {"destinations": [{"name": "Office", "lat": LAT0 + 0.004, "lon": LON0}],
                        "transit": {"walk_model": "network", "land": False}}}
    listings = [{"id": "a", "lat": LAT0, "lon": LON0}]
    logs = []
    run_commute(ws, listings, crit, cell_m=100, pad_m=200, log=logs.append)
    assert any("unavailable" in x for x in logs)
    lay = json.loads((ws.layers_dir / "commute-office.json").read_text())
    assert lay["walk_model"] == "grid"
    assert listings[0]["commute"]["Office"]["minutes"] > 0


def _corridor():
    """A street along lon -74.0 from 40.698 to 40.729 (nodes every 0.001 deg) and a parallel one 170 m east,
    joined every 0.003 deg."""
    nodes, ways = {}, {}
    east = LON0 + 0.002
    for k in range(32):
        nodes[2000 + k] = (40.698 + 0.001 * k, LON0)
        nodes[3000 + k] = (40.698 + 0.001 * k, east)
    ways[1] = (tuple(2000 + k for k in range(32)), {"highway": "secondary"})
    ways[2] = (tuple(3000 + k for k in range(32)), {"highway": "secondary"})
    for k in range(0, 32, 3):
        ways[10 + k] = ((2000 + k, 3000 + k), {"highway": "residential"})
    return ways, nodes


def test_transit_on_the_network_uses_station_entrances(tmp_path, monkeypatch):
    from test_commute_modes import DAY as MDAY, DEST, HOME, _bus, _subway
    s, b = tmp_path / "subway.zip", tmp_path / "bus.zip"
    s.write_bytes(_subway())
    b.write_bytes(_bus())
    ways, nodes = _corridor()
    monkeypatch.setattr(walknet.F, "overpass", _fake_overpass(ways, nodes))
    ws = Workspace(tmp_path / "search")
    # the Mid Station's only stair is 150 m south of its platforms (40.7092): homes to the south gain
    entrance = {"station": "PS2", "lat": 40.7092 - 150 / 110574, "lon": LON0}
    crit = {"commute": {
        "destinations": [{"name": "Office", "lat": DEST[0], "lon": DEST[1], "arrive_by": "09:00", "max_minutes": 30}],
        "transit": {"service_date": str(MDAY), "arrival_offsets_min": [0], "walk_model": "network", "land": False,
                    "station_entrances": [entrance],
                    "feeds": [{"name": "Subway", "path": str(s), "mode": "subway"},
                              {"name": "Bus", "path": str(b), "mode": "bus", "exclude_routes": ["^BxM"]}]}}}
    listings = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}]
    logs = []
    run_commute(ws, listings, crit, cell_m=100, pad_m=300, log=logs.append)
    assert any("street network" in x for x in logs), logs
    sub = listings[0]["commute"]["Office"]["modes"]["subway"]
    walk_leg = sub["legs"][0]
    assert walk_leg["mode"] == "walk" and walk_leg["to"] == "Mid Station"
    # to the stair: 1,020 m - 150 m along the street, plus the 2-minute platform allowance
    assert walk_leg["m"] == pytest.approx(1020 - 150, abs=25)
    lay = json.loads((ws.layers_dir / "commute-office-subway.json").read_text())
    assert lay["walk_network"]["entrances"]["stops_with_entrances"] >= 2
    v = np.array(decode_minutes(lay)).reshape(lay["rows"], lay["cols"])
    lo0, la0, lo1, la1 = lay["bbox"]
    r = int((HOME[0] - la0) / (la1 - la0) * lay["rows"])
    c = int((HOME[1] - lo0) / (lo1 - lo0) * lay["cols"])
    assert abs(v[r, c] - sub["minutes"]) < 1.5


def test_complex_without_its_own_entrances_borrows_same_named_stairs():
    ents = [Entrance("127", 40.7560, -73.9870, name="Times Sq-42 St"),
            Entrance("127", 40.7565, -73.9865, exit=False, name="Times Sq-42 St"),
            Entrance("999", 40.7000, -74.0000, name="Times Sq-42 St")]  # same name, far away: not borrowed

    class N:
        stop_ids = ["sub:725N", "sub:127N"]
        stop_name = ["Times Sq-42 St", "Times Sq-42 St"]
        lat = [40.7557, 40.7559]
        lon = [-73.9873, -73.9869]
        stop_mask = [1, 1]
    enter, leave, _ = entrance_points(N, ents, {"sub:725N": "725", "sub:127N": "127"})
    assert sorted(enter[0]) == sorted([(40.7560, -73.9870), (40.7565, -73.9865)])
    assert leave[0] == [(40.7560, -73.9870)]
