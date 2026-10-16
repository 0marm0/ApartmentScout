"""Commute by time of day on a small synthetic subway (no network).

One line H -- D on a meridian, 10 minutes end to end, with a different timetable at every time of day:

    weekday   morning peak 07:00-10:00 every 5 min   | midday 10:00-17:00 every 20 min   | evening 17:00-20:00 every 5 min
              | late 22:00, 22:40, 23:20 (every 40 min)
    Saturday  08:00-14:00 every 30 min, nothing after

Both directions run (H to D, D to H). Home is at H, the destination at D.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import zipfile
from pathlib import Path

import numpy as np
import pytest

from apartmentscout.commute import slots as SL
from apartmentscout.commute.gtfs import (INF, access_points, best_from, best_from_forward, forward_scan, load_network,
                                         reverse_scan)
from apartmentscout.commute.run import decode_minutes, run_commute
from apartmentscout.commute.times import (SENTINEL, decode_delta, encode_delta, is_base, listing_times, times_path)
from apartmentscout.config import Workspace

SPEED, DETOUR = 4.8 / 3.6, 1.25
WEDNESDAY, SATURDAY = dt.date(2026, 10, 14), dt.date(2026, 10, 17)
HOME, DEST = (40.7000, -74.0), (40.7270, -74.0)
CAL = ("service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
       "WK,1,1,1,1,1,0,0,20260101,20261231\nSA,0,0,0,0,0,1,0,20260101,20261231\n")


def _t(s: int) -> str:
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:00"


def _feed() -> bytes:
    runs = [("WK", range(7 * 3600, 10 * 3600, 300)), ("WK", range(10 * 3600, 17 * 3600, 1200)),
            ("WK", range(17 * 3600, 20 * 3600, 300)), ("WK", [22 * 3600, 22 * 3600 + 2400, 22 * 3600 + 4800]),
            ("SA", range(8 * 3600, 14 * 3600, 1800))]
    trips, times = [], []
    n = 0
    for svc, deps in runs:
        for t0 in deps:
            for d, (a, b) in (("up", ("H", "D")), ("down", ("D", "H"))):
                tid = f"{svc}{d}{n}"
                n += 1
                trips.append(f"R,{svc},{tid}")
                times += [f"{tid},{_t(t0)},{_t(t0)},{a},1", f"{tid},{_t(t0 + 600)},{_t(t0 + 600)},{b},2"]
    files = {"agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA,A,http://a,America/New_York\n",
             "calendar.txt": CAL, "routes.txt": "route_id,route_short_name,route_type\nR,R,1\n",
             "trips.txt": "route_id,service_id,trip_id\n" + "\n".join(trips) + "\n",
             "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                          f"H,Home St,{HOME[0]},{HOME[1]},0,\nD,Desk St,{DEST[0]},{DEST[1]},0,\n",
             "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "\n".join(times) + "\n"}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


@pytest.fixture()
def feed(tmp_path: Path) -> Path:
    p = tmp_path / "line.zip"
    p.write_bytes(_feed())
    return p


def _net(feed, day, lo, hi):
    return load_network([("line", feed, "subway")], day, lo, hi, SPEED, DETOUR, log=None)


def _forward_minutes(net, depart, offsets=(0,)):
    acc = access_points(net, *HOME, 1200, SPEED, DETOUR)
    ws = 3001 * DETOUR / SPEED
    return np.mean([best_from_forward(forward_scan(net, *DEST, depart + 60 * o, SPEED, DETOUR, egress_access=1.0), acc, ws)
                    for o in offsets])


def _reverse_minutes(net, arrive, offsets=(0,)):
    acc = access_points(net, *HOME, 1200, SPEED, DETOUR)
    ws = 3001 * DETOUR / SPEED
    return np.mean([best_from(reverse_scan(net, *DEST, arrive - 60 * o, SPEED, DETOUR, egress_access=1.0), acc, ws)[0]
                    for o in offsets])


# ---------------------------------------------------------------- the forward scan


def test_forward_scan_earliest_arrival_and_door_to_door(feed):
    net = _net(feed, WEDNESDAY, 17 * 3600, 21 * 3600)
    h, d = net.stop_ids.index("line:H"), net.stop_ids.index("line:D")
    p = forward_scan(net, *DEST, 18 * 3600, SPEED, DETOUR, egress_access=1.0)
    # leaving the destination at 18:00 the walk to Desk St is nothing but the 2 min platform allowance: the 18:05 train
    assert p.ea[d] == 18 * 3600 + 120 and p.ea[h] == 18 * 3600 + 5 * 60 + 600
    acc = access_points(net, *HOME, 1200, SPEED, DETOUR)
    m = best_from_forward(p, acc, 3001 * DETOUR / SPEED)
    assert m == pytest.approx(5 + 10 + 2, abs=0.1)   # 5 min wait for the 18:05 (2 min platform at the start is inside it), 10 ride, 2 to the street
    assert p.ea_array()[h] == 18 * 3600 + 900


def test_forward_scan_waits_for_the_next_train_and_gives_up_when_service_ends(feed):
    net = _net(feed, WEDNESDAY, 21 * 3600, 26 * 3600)
    h = net.stop_ids.index("line:H")
    p = forward_scan(net, *DEST, 22 * 3600 + 60, SPEED, DETOUR, egress_access=1.0)
    assert p.ea[h] == 22 * 3600 + 2400 + 600           # the 22:00 has gone; the next is 22:40
    last = forward_scan(net, *DEST, 23 * 3600 + 30 * 60, SPEED, DETOUR, egress_access=1.0)
    assert last.ea[h] >= INF and np.isinf(last.ea_array()[h])      # no train left after 23:20
    acc = access_points(net, *HOME, 1200, SPEED, DETOUR)
    walk_s = 3001 * DETOUR / SPEED
    assert best_from_forward(last, acc, walk_s) == pytest.approx(walk_s / 60)   # walking is always allowed


def test_forward_and_reverse_agree_on_a_symmetric_timetable(feed):
    # the same minutes whichever way round the trip is asked, once each end is charged the same street-to-platform time
    net = _net(feed, WEDNESDAY, 5 * 3600, 21 * 3600)
    fwd = _forward_minutes(net, 18 * 3600, offsets=range(0, 21, 2))
    rev = _reverse_minutes(net, 18 * 3600 + 17 * 60 + 20 * 60, offsets=range(0, 21, 2))   # arrive 18:37 .. 18:17 on the same trains
    assert fwd == pytest.approx(rev, abs=3.0)


def test_commute_differs_through_the_day(feed):
    offs = range(0, 21, 2)
    peak = _reverse_minutes(_net(feed, WEDNESDAY, 5 * 3600, 9 * 3600), 9 * 3600, offs)
    midday = _reverse_minutes(_net(feed, WEDNESDAY, 10 * 3600, 13 * 3600), 13 * 3600, offs)
    evening = _forward_minutes(_net(feed, WEDNESDAY, 18 * 3600, 22 * 3600), 18 * 3600, offs)
    late = _forward_minutes(_net(feed, WEDNESDAY, 22 * 3600, 26 * 3600), 22 * 3600, offs)
    weekend = _reverse_minutes(_net(feed, SATURDAY, 8 * 3600, 11 * 3600), 11 * 3600, offs)
    assert peak < midday < late
    assert evening < midday              # an evening train every 5 minutes beats one every 20
    assert peak < weekend < late         # every 30 minutes on Saturday, every 40 minutes late on a weekday
    assert 13 < peak < 22 and late > 25


# ---------------------------------------------------------------- slots: configuration and arithmetic


def test_default_slots_and_clock_labels():
    slots = SL.resolve_slots({})
    assert [s["id"] for s in slots] == ["am", "mid", "pm", "late", "wknd"]
    assert [s["kind"] for s in slots] == ["arrive", "arrive", "depart", "depart", "arrive"]
    assert SL.clock_label("09:00") == "9:00" and SL.clock_label("18:30") == "18:30"
    d = {"name": "Office", "arrive_by": "08:30"}
    assert SL.slot_time(slots[0], d) == "08:30" and SL.slot_phrase(slots[0], d) == "arrive 8:30"
    assert SL.slot_phrase(slots[2], d) == "leave 18:00" and SL.slot_phrase(slots[4], d) == "arrive 11:00 Saturday"
    assert is_base(slots[0], d) and not any(is_base(s, d) for s in slots[1:])
    assert not is_base({**slots[0], "time": "08:00"}, d)


@pytest.mark.parametrize("slots,msg", [
    ([{"id": "Bad Id", "time": "09:00"}], "short lowercase key"),
    ([{"id": "a", "time": "09:00"}, {"id": "a", "time": "10:00"}], "twice"),
    ([{"id": "a", "time": "9am"}], "HH:MM"),
    ([{"id": "a", "time": "09:00"}, {"id": "b"}], "time is required"),
    ([{"id": "a", "time": "09:00", "kind": "sideways"}], "kind must be"),
    ([{"id": "a", "time": "09:00", "day": "monday"}], "day must be"),
])
def test_bad_slots_say_what_to_fix(slots, msg):
    with pytest.raises(ValueError, match=msg):
        SL.resolve_slots({"commute": {"times": {"slots": slots}}})
    assert any(msg in p for p in SL.check({"commute": {"times": {"slots": slots}}}))


def test_check_flags_unknown_score_and_weights():
    ok = {"commute": {"times": {"score": "weighted", "weights": {"am": 2, "pm": 2}}}}
    assert SL.check(ok) == [] and SL.check({}) == [] and SL.check({"commute": {"times": False}}) == []
    assert SL.check({"commute": {"times": {"score": "dawn"}}})[0].startswith("commute.times.score")
    assert "weights" in SL.check({"commute": {"times": {"weights": {"nope": 1}}}})[0]
    assert "mapping" in SL.check({"commute": {"times": ["am"]}})[0]


def test_scored_minutes_is_unchanged_unless_the_renter_opts_in():
    e = {"minutes": 20.0, "times": {"transit": [20.0, 24.0, 30.0, 40.0, None]}}
    assert SL.scored_minutes(e, {}) == 20.0                                           # default: the arrive_by trip
    assert SL.scored_minutes(e, {"commute": {"times": {"score": "am"}}}) == 20.0
    assert SL.scored_minutes(e, {"commute": {"times": {"score": "pm"}}}) == 30.0
    assert SL.scored_minutes(e, {"commute": {"times": {"score": "wknd"}}}) == 20.0    # no answer for that slot: fall back
    w = SL.scored_minutes(e, {"commute": {"times": {"score": "weighted"}}})           # am 3, mid 1, pm 3, late 1; wknd has no answer
    assert w == pytest.approx((20 * 3 + 24 + 30 * 3 + 40) / 8)
    w2 = SL.scored_minutes(e, {"commute": {"times": {"score": "weighted", "weights": {"am": 1, "pm": 1, "mid": 0, "late": 0, "wknd": 0}}}})
    assert w2 == pytest.approx(25.0)
    assert SL.scored_minutes({"minutes": 18.0}, {"commute": {"times": {"score": "pm"}}}) == 18.0     # an old run without times
    assert SL.scored_minutes(e, {"commute": {"times": {"enabled": False, "score": "pm"}}}) == 20.0


# ---------------------------------------------------------------- the delta layer


def test_delta_layer_round_trips_within_half_a_minute_and_keeps_blanks():
    rng = np.random.default_rng(3)
    base = rng.uniform(5, 55, size=(12, 9))
    base[0, :3] = np.nan                     # water at arrive_by
    slot = base + rng.integers(-8, 25, size=base.shape)
    slot[5, 5] = np.nan                      # no answer late at night, though there is one at arrive_by
    slot[0, 0] = 30.0                        # an answer where arrive_by has none: stays blank
    z = encode_delta(base, slot)
    q = np.clip(np.round(np.nan_to_num(base, nan=0) * 2), 0, 254).astype(np.uint8)
    q[np.isnan(base)] = 255
    got = decode_delta(z, q.ravel()).reshape(base.shape)
    assert np.isnan(got[0, :3]).all() and np.isnan(got[5, 5])
    ok = np.isfinite(got)
    assert np.abs(got[ok] - slot[ok]).max() <= 1.0     # a whole-minute step on a half-minute base
    assert np.abs(got[ok] - slot[ok]).mean() < 0.6
    assert SENTINEL == -128


def test_delta_layer_is_small_when_nothing_changes():
    base = np.random.default_rng(1).uniform(5, 55, size=(200, 150))
    flat = len(encode_delta(base, base))
    noisy = len(encode_delta(base, base + np.random.default_rng(2).integers(-9, 20, size=base.shape)))
    assert flat < 400 and noisy > 10 * flat


def test_listing_times_keep_slot_order_and_leave_gaps():
    slots = SL.resolve_slots({})
    d = {"name": "O", "arrive_by": "09:00"}
    from apartmentscout.commute.times import SlotOut
    pt = (40.7, -74.0)
    outs = {"mid": SlotOut(slots[1], "2026-10-14", "13:00", {"transit": np.zeros((1, 1))}, {pt: {"transit": 24.04, "subway": 25.5}}),
            "late": SlotOut(slots[3], "2026-10-14", "22:00", {"transit": np.zeros((1, 1))}, {pt: {"transit": 130.0, "subway": 41.0}})}
    t = listing_times(slots, d, {"transit": 20.0, "subway": 21.0, "bus": None}, outs, pt)
    assert t["transit"] == [20.0, 24.0, None, None, None]    # 130 minutes is "no answer"; slots not routed are None
    assert t["subway"] == [21.0, 25.5, None, 41.0, None]
    assert "bus" not in t


# ---------------------------------------------------------------- the whole run


def _crit(feed: Path, **times):
    c = {"commute": {"destinations": [{"name": "Office", "lat": DEST[0], "lon": DEST[1], "arrive_by": "09:00", "max_minutes": 30}],
                     "transit": {"service_date": str(WEDNESDAY), "arrival_offsets_min": [0, 6, 12], "walk_model": "grid",
                                 "feeds": [{"name": "Line", "path": str(feed), "mode": "subway"}]}}}
    if times:
        c["commute"]["times"] = times
    return c


def test_run_commute_writes_times_layer_and_listing_times(tmp_path, feed):
    ws = Workspace(tmp_path / "search")
    listings = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}, {"id": "b", "lat": 40.7091, "lon": -74.0005}]
    run_commute(ws, listings, _crit(feed), cell_m=300, pad_m=300, log=lambda *_: None)
    p = times_path(ws.layers_dir, "Office")
    assert p.exists()
    doc = json.loads(p.read_text())
    assert doc["kind"] == "commute-times" and [s["id"] for s in doc["slots"]] == ["am", "mid", "pm", "late", "wknd"]
    assert doc["slots"][0]["base"] and not doc["slots"][1]["base"] and doc["slots"][4]["service_date"] == str(SATURDAY)
    assert set(doc["grids"]["transit"]) == {"mid", "pm", "late", "wknd"}
    best = json.loads((ws.layers_dir / "commute-office.json").read_text())
    base_u8 = np.frombuffer(__import__("base64").b64decode(best["values_u8"]), dtype=np.uint8)
    late = decode_delta(doc["grids"]["transit"]["late"], base_u8)
    morning = np.array(decode_minutes(best))
    both = np.isfinite(late) & (morning >= 0)
    assert both.any() and (late[both] - morning[both]).max() > 10      # late evening is slower near the line (walking cells match)
    assert (late[both] >= morning[both] - 1).all()
    t = listings[0]["commute"]["Office"]["times"]["transit"]
    assert len(t) == 5 and t[0] == pytest.approx(listings[0]["commute"]["Office"]["minutes"], abs=0.1)
    assert t[2] < t[3] and t[0] < t[1] < t[3]                 # peak < midday < late; the evening peak beats late evening
    assert t[4] is not None and t[4] > t[0]
    assert "subway" in listings[0]["commute"]["Office"]["times"]


def test_the_arrive_by_layer_and_minutes_do_not_depend_on_the_times(tmp_path, feed):
    a, b = Workspace(tmp_path / "a"), Workspace(tmp_path / "b")
    la = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}]
    lb = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}]
    run_commute(a, la, _crit(feed), cell_m=300, pad_m=300, log=lambda *_: None)
    run_commute(b, lb, _crit(feed), cell_m=300, pad_m=300, log=lambda *_: None, times=False)
    assert (a.layers_dir / "commute-office.json").read_text().split('"generated"')[0] == \
           (b.layers_dir / "commute-office.json").read_text().split('"generated"')[0]
    assert la[0]["commute"]["Office"]["minutes"] == lb[0]["commute"]["Office"]["minutes"]
    assert "times" not in lb[0]["commute"]["Office"] and not times_path(b.layers_dir, "Office").exists()


def test_times_can_be_switched_off_in_criteria_and_custom_slots_are_honoured(tmp_path, feed):
    off = Workspace(tmp_path / "off")
    run_commute(off, [{"id": "a", "lat": HOME[0], "lon": HOME[1]}], _crit(feed, enabled=False), cell_m=300, pad_m=300,
                log=lambda *_: None)
    assert not times_path(off.layers_dir, "Office").exists()
    ws = Workspace(tmp_path / "custom")
    L = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}]
    slots = [{"id": "am", "label": "Rush", "kind": "arrive", "time": None}, {"id": "sat", "label": "Saturday lunch", "kind": "arrive",
                                                                               "time": "12:00", "day": "saturday"}]
    run_commute(ws, L, _crit(feed, slots=slots), cell_m=300, pad_m=300, log=lambda *_: None)
    doc = json.loads(times_path(ws.layers_dir, "Office").read_text())
    assert [s["id"] for s in doc["slots"]] == ["am", "sat"] and doc["slots"][1]["time"] == "12:00"
    assert len(L[0]["commute"]["Office"]["times"]["transit"]) == 2


def test_a_feed_without_weekend_service_skips_that_slot_and_says_so(tmp_path):
    zin = zipfile.ZipFile(io.BytesIO(_feed()))
    files = {n: zin.read(n) for n in zin.namelist()}
    files["calendar.txt"] = CAL.split("SA")[0].rsplit("\n", 1)[0].encode() + b"\n"   # weekday service only
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    feed = tmp_path / "wk.zip"
    feed.write_bytes(buf.getvalue())
    ws = Workspace(tmp_path / "search")
    L = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}]
    logs: list[str] = []
    run_commute(ws, L, _crit(feed), cell_m=300, pad_m=300, log=logs.append)
    t = L[0]["commute"]["Office"]["times"]["transit"]
    assert t[4] is None and t[1] is not None and any("Weekend: skipped" in x for x in logs)
    assert "wknd" not in json.loads(times_path(ws.layers_dir, "Office").read_text())["grids"]["transit"]


def test_times_only_leaves_the_arrive_by_run_alone(tmp_path, feed):
    from apartmentscout.commute.times import run_times
    ws = Workspace(tmp_path / "search")
    L = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}]
    crit = _crit(feed)
    run_commute(ws, L, crit, cell_m=300, pad_m=300, log=lambda *_: None, times=False)
    before = (ws.layers_dir / "commute-office.json").read_text()
    minutes = L[0]["commute"]["Office"]["minutes"]
    run_times(ws, L, crit, log=lambda *_: None)
    assert (ws.layers_dir / "commute-office.json").read_text() == before
    assert L[0]["commute"]["Office"]["minutes"] == minutes and len(L[0]["commute"]["Office"]["times"]["transit"]) == 5
    # and without arrive_by layers there is nothing to difference against: said, not raised
    empty = Workspace(tmp_path / "empty")
    logs: list[str] = []
    run_times(empty, L, crit, log=logs.append)
    assert any("no arrive_by layer yet" in x for x in logs)


def test_times_on_the_street_network_agree_between_map_and_listing(tmp_path, feed, monkeypatch):
    """The network walking model: forward scans seeded at the exits, reverse scans at the entrances; the heat map at a
    home's own cell and the home's number are the same field."""
    from test_commute_walknet import _corridor, _fake_overpass
    from apartmentscout.commute import walknet
    ways, nodes = _corridor()
    monkeypatch.setattr(walknet.F, "overpass", _fake_overpass(ways, nodes))
    ws = Workspace(tmp_path / "search")
    crit = _crit(feed)
    crit["commute"]["transit"].update(walk_model="network", land=False, station_entrances=[])
    L = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}]
    logs: list[str] = []
    run_commute(ws, L, crit, cell_m=100, pad_m=300, log=logs.append)
    assert any("street network" in x for x in logs), logs
    t = L[0]["commute"]["Office"]["times"]["transit"]
    assert len(t) == 5 and all(v is not None for v in t) and t[0] < t[1] < t[3]
    doc = json.loads(times_path(ws.layers_dir, "Office").read_text())
    assert doc["walk_model"] == "network"
    best = json.loads((ws.layers_dir / "commute-office.json").read_text())
    base_u8 = np.frombuffer(__import__("base64").b64decode(best["values_u8"]), dtype=np.uint8)
    lo0, la0, lo1, la1 = best["bbox"]
    r = int((HOME[0] - la0) / (la1 - la0) * best["rows"])
    c = int((HOME[1] - lo0) / (lo1 - lo0) * best["cols"])
    for k, sid in ((1, "mid"), (2, "pm"), (3, "late")):
        g = decode_delta(doc["grids"]["transit"][sid], base_u8).reshape(best["rows"], best["cols"])
        assert abs(g[r, c] - t[k]) < 2.0, (sid, g[r, c], t[k])   # a 100 m cell, and whole-minute steps
