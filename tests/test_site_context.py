"""Site model v2.1: footprint metadata, BIN/BBL target matching, bay windows, blockers and sun samples,
floor-height calibration, neighbouring roofs, the neighbours table and self-checks. No network."""
from __future__ import annotations

import datetime as dt
import json

import pytest

from apartmentscout.geo import LocalFrame
from apartmentscout.geo import site as site_mod
from apartmentscout.geo.buildings import build_site, fill_heights, parse_nyc_rows
from apartmentscout.geo.checks import site_checks
from apartmentscout.geo.neighbours import clears_floor, neighbour_records, neighbours, roofs
from apartmentscout.geo.site import calibrate_floor_height, listing_panes, sample_rows
from apartmentscout.sun import (STEP_MIN, Skyline, _Tracks, main_blockers, month_tracks, sample_states, sun_study,
                                target_faces, window_point)

LAT, LON = 40.75, -73.99
F = LocalFrame(LAT, LON)
TZ = "America/New_York"


def ll(x: float, y: float) -> list[float]:
    lon, lat = F.to_lonlat(x, y)
    return [lon, lat]


def box(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
    return [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]


def row(bin_, ring, h_ft=None, bbl="1000010001", **extra):
    return {"bin": bin_, "base_bbl": bbl, "mappluto_bbl": bbl, "height_roof": h_ft, "ground_elevation": "30",
            "construction_year": "1931", "the_geom": {"type": "MultiPolygon", "coordinates": [[ring]]}, **extra}


def flat_site(b: list, target: int, **kw) -> dict:
    return {"origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.2, "b": b, "target": target, **kw}


# --------------------------------------------------------------------------- 1. footprint metadata

def test_footprint_metadata_kept_and_names_label_landmarks():
    rows = [row("1012345", box(-10, -10, 10, 10), 200, geom_source="Photogrammetric",
                last_edited_date="2017-08-22T00:00:00.000Z", feature_code="2100"),
            row("1012346", box(200, 200, 260, 260), 1454, bbl="1008350041", name="Empire State Building",
                geom_source="Other (Manual)", last_edited_date="2019-01-01T00:00:00.000Z", feature_code="2100"),
            row("1012347", box(-200, 300, -170, 330), 600, bbl="1000010003", name="1", feature_code="5100")]
    bs = parse_nyc_rows(rows)
    fill_heights(bs, {"1008350041": {"address": "350 5 Avenue", "numfloors": 102}})
    site = build_site({"lat": LAT, "lon": LON, "floor": 5}, bs, "test", {"1008350041": "350 5 Avenue"})
    m = site["bmeta"]
    assert m[0]["geom_src"] == "photogrammetric" and m[0]["edited"] == 2017 and m[0]["fcode"] == "2100"
    assert m[1]["geom_src"] == "manual" and m[1]["name"] == "Empire State Building" and m[1]["floors"] == 102
    assert "name" not in m[2] and m[2]["fcode"] == "5100"                     # junk names are dropped
    labels = {lm[1]: lm[0] for lm in site["lm"]}
    assert labels[1] == "Empire State Building"                              # name beats the PLUTO address


def test_old_site_without_new_keys_still_works():
    site = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                      [20, 0, 0, [-10, 30, 10, 30, 10, 50, -10, 50]]], 0)       # v1: no bmeta, no window
    assert neighbours(site)["rows"][0][0] == 1
    assert roofs(site)["sectors"][0]["rows"][0][0] == 1
    assert {c["id"] for c in site_checks(site)} >= {"origin", "ground"}


# --------------------------------------------------------------------------- 2. target by BIN / BBL

def _street_point_buildings():
    # the address point (origin) lies 20 m into the street south of the listing's tower and inside a
    # low building on the other side of the street
    return parse_nyc_rows([row("1000101", box(-15, 20, 15, 50), 300, bbl="1000010001"),
                           row("1000102", box(-15, -10, 15, 10), 40, bbl="1000010002"),
                           row("1000103", box(20, 20, 40, 50), 150, bbl="1000010001")])


def test_target_by_bin_when_the_address_point_is_in_the_street():
    bs = fill_heights(_street_point_buildings())
    site = build_site({"lat": LAT, "lon": LON, "floor": 3, "bin": "1000101"}, bs, "test")
    assert site["target"] == 0 and site["target_match"] == {"by": "bin", "point_offset_m": 20.0}
    by_bbl = build_site({"lat": LAT, "lon": LON, "floor": 3, "bbl": "1000010001.0"}, bs, "test")
    assert by_bbl["target"] == 0 and by_bbl["target_match"]["by"] == "bbl"   # tallest on the lot
    plain = build_site({"lat": LAT, "lon": LON, "floor": 3}, bs, "test")
    assert plain["target"] == 1 and plain["target_match"]["by"] == "point"   # unchanged fallback
    ghost = build_site({"lat": LAT, "lon": LON, "floor": 3, "bin": "1000000"}, bs, "test")
    assert ghost["target"] == 1                                               # placeholder BINs are ignored


def test_make_site_records_target_provenance_and_note(monkeypatch):
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: _street_point_buildings())
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {})
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 10, "exposure": ["S"], "bin": "1000101"}
    site, face, _ = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026)
    p = site["provenance"]
    assert p["target"] == "bin" and p["target_offset_m"] == 20.0 and "matched by BIN" in p["notes"]
    assert "target_match" not in site
    origin = next(c for c in site["checks"] if c["id"] == "origin")
    assert origin["status"] == "warn" and "BIN" in origin["msg"]


# --------------------------------------------------------------------------- 3. bay windows

def test_bay_window_union_beats_flat_pane_on_an_east_facade():
    site = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]]], 0)
    east = next(f for f in target_faces(site) if round(f["bearing"]) == 90)
    tracks = _Tracks(month_tracks(2026, LAT, LON, TZ))
    flat = sun_study(site, east, 8, TZ, 2026, tracks=tracks)
    bay = sun_study(site, east, 8, TZ, 2026, tracks=tracks, panes=[-45, 0, 45])
    assert bay["sun_hours"][11] > flat["sun_hours"][11]                  # the SE pane sees the afternoon sun
    assert all(b >= f for b, f in zip(bay["sun_hours"], flat["sun_hours"]))
    assert len(bay["sun_hours_panes"]) == 3 and bay["sun_hours_panes"][1] == flat["sun_hours"]
    assert all(max(p[m] for p in bay["sun_hours_panes"]) <= bay["sun_hours"][m] for m in range(12))
    assert "sun_hours_panes" not in flat


def test_listing_panes():
    assert listing_panes({"bay": True}) == [-45.0, 0.0, 45.0]
    assert listing_panes({"window_panes": [-30, 0, 30]}) == [-30.0, 0.0, 30.0]
    assert listing_panes({}) is None


# --------------------------------------------------------------------------- 6. who shades the window

def _blocked_south():
    # target 20 x 20 m; one 80 m box 25 m south of its south facade
    return flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                      [80, 0, 0, [-30, -60, 30, -60, 30, -35, -30, -35]]], 0,
                     timezone=TZ, bmeta=[{"height_src": "roof", "src": "t"},
                                         {"name": "Box Tower", "bin": "1000999", "height_src": "roof", "src": "t"}])


def test_every_shaded_slot_names_the_box_and_samples_count():
    site = _blocked_south()
    south = next(f for f in target_faces(site) if round(f["bearing"]) == 180)
    pt = window_point(south, 0.5, 4)
    rows = sample_states(Skyline(site), pt, 180, dt.date(2026, 12, 21), LAT, LON, TZ)
    shaded = [r for r in rows if r["state"] == "shaded"]
    assert shaded and all(r["blocker"] == 1 for r in shaded)
    assert all(24 <= r["dist"] <= 70 for r in shaded)
    assert len(rows) == 1440 // STEP_MIN
    bl = main_blockers(Skyline(site), pt, 180, 2026, LAT, LON, TZ)
    assert bl[0]["b"] == 1 and bl[0]["min"][11] > 0 and bl[0]["dist"] >= 24
    site["window"] = {"face": south["i"], "bearing": 180, "floor": 4, "t": 0.5}
    dates = [dt.date(2026, 6, 21), dt.date(2026, 12, 21)]
    csv_rows = sample_rows(site, south, dates)
    assert len(csv_rows) == len(dates) * 1440 // STEP_MIN
    assert {r["blocker"] for r in csv_rows if r["state"] == "shaded"} == {"Box Tower"}
    assert {r["blocker_bin"] for r in csv_rows if r["state"] == "shaded"} == {"1000999"}


# --------------------------------------------------------------------------- 7. eye height vs roofs

def test_roofs_report_the_first_clearing_floor():
    assert [clears_floor(h, 3.2) for h in (50, 61, 87)] == [17, 20, 28]
    assert clears_floor(87, 3.2, max_floor=20) is None
    site = flat_site([[120, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                      [50, 0, 0, [-10, -40, 10, -40, 10, -30, -10, -30]],
                      [61, 0, 0, [-40, -70, -20, -70, -20, -50, -40, -50]],
                      [87, 0, 0, [20, -90, 40, -90, 40, -70, 20, -70]],
                      [300, 0, 0, [-10, 80, 10, 80, 10, 100, -10, 100]]], 0)
    south = next(f for f in target_faces(site) if round(f["bearing"]) == 180)
    site["window"] = {"face": south["i"], "bearing": 180.0, "floor": 12, "t": 0.5}
    r = roofs(site, south)
    fc = r["facing"]
    assert sorted(x[0] for x in fc["rows"]) == [1, 2, 3]                     # the north tower is behind
    assert {x[0]: x[3] for x in fc["rows"]} == {1: 17, 2: 20, 3: 28}
    assert fc["clears_floor"] == 28 and r["eye_m"] == pytest.approx(11 * 3.2 + 1.6, abs=0.05)
    north = next(s for s in r["sectors"] if s["bearing"] == 0)
    assert north["rows"][0][0] == 4 and north["clears_floor"] is None        # 300 m: no floor clears it


# --------------------------------------------------------------------------- 8. floor height

@pytest.mark.parametrize("h,nf,want", [(77, 24, 3.2), (111, 36, 3.08), (200, 30, 4.2), (30, 12, 2.8)])
def test_floor_height_from_roof_and_floors(h, nf, want):
    site = flat_site([[h, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]]], 0,
                     bmeta=[{"floors": nf, "height_src": "roof", "src": "nyc-footprints"}])
    fh, src = calibrate_floor_height(site, 10)
    assert fh == pytest.approx(want, abs=0.01) and src == "pluto"


def test_floor_height_manual_and_default():
    site = flat_site([[77, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]]], 0,
                     bmeta=[{"floors": 24, "height_src": "pluto-floors", "src": "nyc-footprints"}])
    assert calibrate_floor_height(site, 12) == (3.2, "default")             # height built from floors: circular
    assert calibrate_floor_height(site, 12, slab_height=34.5) == pytest.approx((34.5 / 11, "manual"))
    assert calibrate_floor_height(site, 12, floor_height=3.5) == (3.5, "manual")


def test_manual_slab_changes_the_heat_table(monkeypatch):
    bs = parse_nyc_rows([row("1000101", box(-15, -10, 15, 10), 300, bbl="1000010010"),
                         row("1000102", box(-15, -80, 15, -30), 200, bbl="1000010012")])
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: bs)
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {"1000010010": {"numfloors": 30}})
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 12, "exposure": ["S"]}
    a, _, _ = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026)
    b, _, _ = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026,
                                 slab_height=60.0)
    assert a["floor_height_src"] == "pluto" and a["floor_height_m"] == pytest.approx(300 * 0.3048 / 30, abs=0.01)
    assert b["floor_height_src"] == "manual" and b["slab_m"] == 60.0 and b["floor_height_m"] == pytest.approx(60 / 11, abs=0.01)
    assert a["study"]["sun_hours"] != b["study"]["sun_hours"]


# --------------------------------------------------------------------------- 9. neighbours table

def test_neighbours_table_counts_and_orders_by_distance():
    site = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                      [25, 0, 0, [10, -10, 30, -10, 30, 10, 10, 10]],        # party wall (east)
                      [40, 0, 0, [-10, -60, 10, -60, 10, -40, -10, -40]],
                      [90, 0, 0, [-10, 200, 10, 200, 10, 220, -10, 220]],
                      [90, 0, 0, [-10, 400, 10, 400, 10, 420, -10, 420]]], 0,  # beyond 300 m
                     future=[{"name": "New Tower", "ring": [[-60, -10], [-40, -10], [-40, 10], [-60, 10]], "h": 120,
                              "status": "permit", "source": "test", "h_src": "filing-height"}])
    south = next(f for f in target_faces(site) if round(f["bearing"]) == 180)
    site["window"] = {"face": south["i"], "bearing": 180.0, "floor": 5, "t": 0.5}
    nb = neighbours(site, south)
    assert nb["from"] == "window" and nb["cols"] == ["b", "dist", "bearing", "h", "top"]
    assert [r[0] for r in nb["rows"]] == [1, 2, -1, 3]                       # party wall first, far one dropped
    recs = neighbour_records(site, south)
    assert len(recs) == 4 and recs[2]["kind"] == "future:permit" and recs[2]["name"] == "New Tower"
    assert recs[1]["in_front"] == "yes" and recs[3]["in_front"] == "no" and recs[1]["compass"] == "S"


# --------------------------------------------------------------------------- 11. self-checks

def test_checks_pass_on_a_clean_site_and_fail_on_a_party_wall_window():
    site = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                      [25, 0, 0, [10, -10, 30, -10, 30, 10, 10, 10]]], 0,
                     streets=[{"name": "A St", "pts": [[-80, -30], [80, -30]]},
                              {"name": "B St", "pts": [[-80, 30], [80, 30]]}])
    faces = {round(f["bearing"]): f for f in target_faces(site)}
    site["window"] = {"face": faces[180]["i"], "bearing": 180.0, "floor": 5, "t": 0.5}
    ok = {c["id"]: c["status"] for c in site_checks(site, faces[180])}
    assert ok == {"origin": "pass", "ground": "pass", "anchor": "pass", "outside": "pass", "open-air": "pass",
                  "streets": "pass", "heights": "pass"}
    site["window"] = {"face": faces[90]["i"], "bearing": 90.0, "floor": 5, "t": 0.5}
    bad = {c["id"]: c["status"] for c in site_checks(site, faces[90])}
    assert bad["outside"] == "fail" and bad["open-air"] == "fail"      # the neighbour is 25 m tall, the window is at 13 m


def test_checks_warn_on_origin_in_street_one_sided_streets_and_datum():
    site = flat_site([[60, 2.0, 1, [-10, 20, 10, 20, 10, 40, -10, 40]]], 0,
                     streets=[{"name": "A St", "pts": [[-80, 5], [80, 5]]}],
                     receipts=[{"dataset": "5zhs-2jue", "limit_hit": True}])
    c = {x["id"]: x["status"] for x in site_checks(site)}
    assert c["origin"] == "warn" and c["streets"] == "warn" and c["ground"] == "fail" and c["limits"] == "warn"
    json.dumps(site_checks(site))


def test_clamped_storey_height_is_recorded_and_warned(monkeypatch):
    bs = parse_nyc_rows([row("1000101", box(-15, -10, 15, 10), 174, bbl="1000010010")])
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: bs)
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {"1000010010": {"numfloors": 12}})
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 11, "exposure": ["S"]}
    site, _, _ = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026)
    assert site["floor_height_m"] == 4.2 and site["floor_height_raw"] == pytest.approx(174 * 0.3048 / 12, abs=0.01)
    assert next(c for c in site["checks"] if c["id"] == "storey")["status"] == "warn"
