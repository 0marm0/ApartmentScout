"""Site model v2: party walls, light courts, building metadata, sun-hour ranges, streets, future
buildings, provenance and the cached fetcher. Small synthetic fixtures, no network."""
from __future__ import annotations

import json
import math

import pytest

from apartmentscout.geo import LocalFrame
from apartmentscout.geo import fetch as fetch_mod
from apartmentscout.geo import site as site_mod
from apartmentscout.geo.buildings import build_site, fill_heights, parse_nyc_rows, parse_osm_elements
from apartmentscout.geo.future import group_filings, to_future
from apartmentscout.geo.shapes import point_in_poly, simplify_ring, stitch
from apartmentscout.geo.site import norm_source, provenance
from apartmentscout.geo.streets import parse_cscl, parse_osm_streets
from apartmentscout.sun import (Skyline, at, blocked_samples, pick_face, sun_hours_range, sun_study, target_faces,
                                window_t)

LAT, LON = 40.75, -73.99
F = LocalFrame(LAT, LON)


def ll(x: float, y: float) -> list[float]:
    lon, lat = F.to_lonlat(x, y)
    return [lon, lat]


def box(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
    """Closed lon/lat ring (counter-clockwise) for a local-metre box."""
    return [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]


def flat_site(b: list, target: int, holes: dict | None = None) -> dict:
    s = {"origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.2, "b": b, "target": target}
    if holes:
        s["holes"] = holes
    return s


# --------------------------------------------------------------------------- party walls

def test_party_wall_marked_and_never_picked():
    # target 20 x 20 m, 60 m tall; neighbour shares the whole east wall
    site = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                      [20, 0, 0, [10, -10, 30, -10, 30, 10, 10, 10]]], 0)
    faces = {round(f["bearing"]): f for f in target_faces(site)}
    assert faces[90]["shared"] is True and faces[90]["shared_h"] == 20
    assert not any(faces[b].get("shared") for b in (0, 180, 270))
    assert pick_face(list(faces.values()), ["E"]) is None          # only a party wall faces east
    assert round(pick_face(list(faces.values()), ["E", "N"])["bearing"]) == 0
    assert round(pick_face(list(faces.values()), ["W"])["bearing"]) == 270


def test_partly_shared_face_keeps_open_stretch_and_window_moves_into_it():
    # neighbour covers the eastern 12 m of the target's 30 m south wall
    site = flat_site([[60, 0, 1, [-15, -10, 15, -10, 15, 10, -15, 10]],
                      [30, 0, 0, [3, -25, 20, -25, 20, -10, 3, -10]]], 0)
    south = next(f for f in target_faces(site) if round(f["bearing"]) == 180)
    assert not south.get("shared")
    t0, t1 = south["open"]
    assert t0 == 0 and t1 == pytest.approx(0.6, abs=0.05)          # west 18 m open
    assert window_t(south) == pytest.approx(0.3, abs=0.03)
    assert south["shared_frac"] == pytest.approx(0.4, abs=0.05)


def test_party_wall_sample_in_neighbours_court_is_open():
    # the neighbour wraps around a court right outside the target's east wall: not a party wall
    site = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                      [20, 0, 0, [10, -20, 40, -20, 40, 20, 10, 20]]], 0,
                     holes={"1": [[[10.2, -12], [25, -12], [25, 12], [10.2, 12]]]})
    east = next(f for f in target_faces(site) if round(f["bearing"]) == 90)
    assert not east.get("shared") and "open" not in east
    others = [((10, -20, 40, 20), [(10, -20), (40, -20), (40, 20), (10, 20)], [], 20)]
    assert all(b == 20 for b in blocked_samples(east, others))       # without the court it would be shared


def test_simplify_merges_collinear_edges_into_one_facade():
    # a 16 m wall drawn as two 8 m edges (as in many city footprints) plus a near-collinear jog
    ring = [(0, 0), (7.8, 0), (15.6, 0.05), (15.6, 10), (0, 10)]
    out = simplify_ring(ring, 0.3)
    assert len(out) == 4 and (7.8, 0) not in out


# --------------------------------------------------------------------------- footprints, holes, bmeta

def _nyc_row(bin_, ring, h_ft=None, holes=(), bbl="1000010001", year="1931"):
    return {"bin": bin_, "base_bbl": bbl, "mappluto_bbl": bbl, "height_roof": h_ft, "ground_elevation": "30",
            "construction_year": year, "the_geom": {"type": "MultiPolygon", "coordinates": [[ring, *holes]]}}


def test_nyc_rows_keep_holes_and_record_height_sources():
    rows = [_nyc_row("1", box(-20, -20, 20, 20), 100, holes=[box(-8, -8, 8, 8)], bbl="1000010001"),
            _nyc_row("2", box(30, -10, 50, 10), None, bbl="1000010002"),
            _nyc_row("3", box(-50, -10, -30, 10), None, bbl="1000010003"),
            _nyc_row("4", box(60, 0, 61, 1), 5)]                        # 1.5 m shed: dropped
    bs = parse_nyc_rows(rows)
    assert len(bs) == 3 and len(bs[0]["holes"]) == 1
    assert bs[1]["height"] is None and bs[1]["height_src"] is None   # never guessed silently
    fill_heights(bs, {"1000010002": {"numfloors": 6, "address": "2 Test St", "yearbuilt": 1920},
                      "1000010001": {"address": "1 Test St"}})
    assert [b["height_src"] for b in bs] == ["roof", "pluto-floors", "default"]
    assert bs[1]["height"] == pytest.approx(6 * 3.2 + 2)
    site = build_site({"lat": LAT, "lon": LON, "floor": 5}, bs, "test")
    assert site["version"] == 2 and site["target"] == 0
    assert list(site["holes"]) == ["0"] and len(site["holes"]["0"][0]) == 4
    m = site["bmeta"]
    assert len(m) == len(site["b"])
    assert m[0] == {"bin": "1", "bbl": "1000010001", "address": "1 Test St", "year": 1931,
                    "height_src": "roof", "hconf": "high", "src": "nyc-footprints"}
    assert [x["hconf"] for x in m] == ["high", "low", "low"]          # measured / built from floors / the default
    assert m[1]["height_src"] == "pluto-floors" and m[2]["height_src"] == "default"
    # the court is open air for both point tests and the skyline
    hx = site["holes"]["0"][0]
    assert not point_in_poly(0, 0, list(zip(site["b"][0][3][0::2], site["b"][0][3][1::2])), [hx])
    prof = Skyline(site).profile(0, 0, 2)
    assert at(prof, 90) == pytest.approx(math.degrees(math.atan(28.48 / 8)), abs=0.6)


def test_osm_relation_courtyard_and_height_sources():
    def way(pts):
        return [{"lon": p[0], "lat": p[1]} for p in pts]
    outer = box(-20, -20, 20, 20)
    els = [
        {"type": "relation", "id": 7, "tags": {"building": "yes", "building:levels": "5", "type": "multipolygon"},
         "members": [{"type": "way", "role": "outer", "geometry": way(outer[:3])},
                     {"type": "way", "role": "outer", "geometry": way(outer[2:])},
                     {"type": "way", "role": "inner", "geometry": way(box(-5, -5, 5, 5))}]},
        {"type": "way", "id": 8, "tags": {"building": "yes", "height": "120 ft", "name": "Tall"},
         "geometry": way(box(40, 0, 60, 20))},
        {"type": "way", "id": 9, "tags": {"building": "yes"}, "geometry": way(box(-60, 0, -40, 20))},
    ]
    bs = parse_osm_elements(els, LAT, LON, 600)
    assert [b["height_src"] for b in bs] == ["osm-levels", "osm-height", "default"]
    assert len(bs[0]["holes"]) == 1 and bs[0]["height"] == pytest.approx(18)
    assert bs[1]["height"] == pytest.approx(120 * 0.3048)
    assert bs[2]["estimated_height"] is True
    site = build_site({"lat": LAT, "lon": LON, "floor": 3}, bs, "osm")
    assert site["holes"]["0"] and site["bmeta"][1]["name"] == "Tall" and site["bmeta"][0]["src"] == "osm"


def test_stitch_joins_reversed_segments():
    rings = stitch([[(0, 0), (1, 0), (1, 1)], [(0, 0), (0, 1), (1, 1)]])
    assert len(rings) == 1 and len(rings[0]) == 5


# --------------------------------------------------------------------------- sun-hours range

def test_sun_hours_range_brackets_the_window_and_widens_near_a_blocker():
    # 30 m south wall of a 60 m tower; a 40 m block across the street covers only the west half
    site = flat_site([[60, 0, 1, [-15, 0, 15, 0, 15, 20, -15, 20]],
                      [40, 0, 0, [-40, -40, 0, -40, 0, -20, -40, -20]]], 0)
    face = next(f for f in target_faces(site) if round(f["bearing"]) == 180)
    st = sun_study(site, face, 5, "America/New_York", 2026)
    rng = sun_hours_range(site, face, 5, "America/New_York", 2026)
    assert rng["positions"] == [0.2, 0.5, 0.8] and rng["floors"] == [3, 4, 5, 6, 7]
    assert len(rng["lo"]) == len(rng["hi"]) == 12
    for lo, h, hi in zip(rng["lo"], st["sun_hours"], rng["hi"]):
        assert lo <= h <= hi
    assert max(hi - lo for lo, hi in zip(rng["lo"], rng["hi"])) > 0.5   # position matters here


def test_sun_hours_range_uses_open_stretch_and_clips_floors():
    site = flat_site([[12, 0, 1, [-15, 0, 15, 0, 15, 20, -15, 20]]], 0)
    face = {**next(f for f in target_faces(site) if round(f["bearing"]) == 180), "open": [0.5, 1.0]}
    rng = sun_hours_range(site, face, 3, "America/New_York", 2026)
    assert rng["positions"] == [0.6, 0.75, 0.9] and rng["floors"] == [2, 3]


# --------------------------------------------------------------------------- streets

def test_parse_cscl_filters_converts_width_and_merges():
    def seg(x0, y0, x1, y1, **kw):
        return {"the_geom": {"type": "MultiLineString", "coordinates": [[ll(x0, y0), ll(x1, y1)]]},
                "stname_label": "W 38 ST", "streetwidth": "34", "rw_type": "1", "status": "2",
                "from_level_code": "13", "to_level_code": "13", **kw}
    rows = [seg(-100, 40, 0, 40), seg(0, 40, 100, 40),
            seg(0, -50, 0, 50, stname_label="LINCOLN TUNL", rw_type="4"),
            seg(0, -60, 0, 60, stname_label="9 AVE", status="1"),
            seg(-20, 0, 20, 0, stname_label="UNDER", from_level_code="10", to_level_code="10"),
            seg(5000, 0, 5100, 0, stname_label="FAR")]
    out = parse_cscl(rows, F, 600)
    assert len(out) == 1
    s = out[0]
    assert s["name"] == "W 38 St" and s["width_m"] == pytest.approx(10.4, abs=0.05)
    assert len(s["pts"]) == 3 and s["pts"][0][0] == pytest.approx(-100, abs=0.2)


def test_parse_osm_streets():
    els = [{"type": "way", "id": 1, "tags": {"highway": "residential", "name": "Main St", "width": "9 m"},
            "geometry": [{"lon": ll(-50, 0)[0], "lat": ll(-50, 0)[1]}, {"lon": ll(50, 0)[0], "lat": ll(50, 0)[1]}]},
           {"type": "way", "id": 2, "tags": {"highway": "footway"}, "geometry": []},
           {"type": "way", "id": 3, "tags": {"highway": "primary", "tunnel": "yes"},
            "geometry": [{"lon": LON, "lat": LAT}, {"lon": LON + 0.001, "lat": LAT}]}]
    out = parse_osm_streets(els, F, 600)
    assert out == [{"name": "Main St", "pts": [[-50.0, 0.0], [50.0, 0.0]], "width_m": 9.0}]


# --------------------------------------------------------------------------- future buildings

def _dob(num, status, h=None, st=None, date="2025-01-01", lat=LAT + 0.001, lon=LON, **kw):
    return {"job_filing_number": num, "filing_status": status, "job_type": "New Building", "house_no": "38",
            "street_name": "EAST   35 STREET", "bin": "1017107", "bbl": "1008640047", "proposed_height": h,
            "proposed_no_of_stories": st, "filing_date": date, "current_status_date": date,
            "latitude": str(lat), "longitude": str(lon), "owner_first_name": "PRIVATE", **kw}


def test_group_filings_status_height_and_privacy():
    rows = [_dob("M1-I1", "Permit Entire", "191", "18", "2024-06-13"),
            _dob("M1-P3", "Approved", "195", "18", "2026-03-16"),
            _dob("M2-I1", "Objections", None, "10", house_no="1", bbl="1000010002"),
            _dob("M3-I1", "Filing Withdrawn", "300"),
            _dob("M4-I1", "Approved", None, None),                           # no height, no stories: skipped
            _dob("M5-I1", "LOC Issued", "100"),
            {**_dob("M6-I1", "Approved", "50"), "job_type": "Alteration"}]
    jobs = {j["job"]: j for j in group_filings(rows)}
    assert set(jobs) == {"M1", "M2", "M5"}
    m1 = jobs["M1"]
    assert m1["status"] == "under-construction" and m1["h"] == pytest.approx(195 * 0.3048, abs=0.05)
    assert m1["h_src"] == "filing-height" and m1["filed"] == "2024-06-13" and m1["name"] == "38 East 35 Street"
    assert jobs["M2"]["status"] == "proposed" and jobs["M2"]["h_src"] == "stories"
    assert jobs["M2"]["h"] == pytest.approx(10 * 3.2 + 2)
    assert jobs["M5"]["status"] == "complete"
    assert "PRIVATE" not in json.dumps(jobs)


def test_to_future_uses_lot_ring_point_fallback_and_drops_built():
    jobs = group_filings([_dob("M1-I1", "Approved", "200", lat=LAT + 0.0005),
                          _dob("M2-I1", "Approved", "120", bbl="1000010009", bin="9", lat=LAT - 0.0005)])
    lot = [tuple(p) for p in box(-10, 45, 10, 65)]
    site = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]]], 0)
    fut = to_future(jobs, F, {"1008640047": lot}, site)
    assert [f["ring_src"] for f in fut] == ["tax-lot", "point"]
    assert fut[0]["status"] == "permit" and fut[0]["source"].startswith("NYC DOB NOW")
    assert fut[0]["url"].startswith("https://data.cityofnewyork.us/") and len(fut[0]["ring"]) == 4
    assert fut[1]["ring"][0] == pytest.approx([-8, -63.3], abs=0.2)
    # an existing footprint at about the filed height inside the lot means it is already built
    built = flat_site([[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]], [58, 0, 0, [-8, 47, 8, 47, 8, 63, -8, 63]]], 0)
    assert [f["job"] for f in to_future(jobs, F, {"1008640047": lot}, built)] == ["M2"]


def test_future_buildings_enter_after_construction_skyline():
    site = flat_site([[60, 0, 1, [-15, 0, 15, 0, 15, 20, -15, 20]]], 0)
    site["future"] = [{"ring": [[-20, -40], [20, -40], [20, -20], [-20, -20]], "h": 80, "status": "permit"}]
    p = (0, -0.4, 10)
    assert at(Skyline(site).profile(*p), 180) == 0
    assert at(Skyline(site, include_future=True).profile(*p), 180) == pytest.approx(
        math.degrees(math.atan(70 / 19.6)), abs=0.1)


# --------------------------------------------------------------------------- provenance

def test_provenance_from_listing_fields():
    face = {"i": 0}
    assert provenance({"exposure": ["S"], "floor": 12}, face, None, None, None) == {
        "exposure": "listing", "window_position": "assumed", "floor": "listing",
        "notes": "window placed mid-way along the open part of the facade"}
    p = provenance({"exposure_source": "floor_plan_compass", "floor": 13, "floor_inferred": True,
                    "window_position_source": "plan"}, face, None, None, None)
    assert (p["exposure"], p["window_position"], p["floor"], p["notes"]) == ("plan", "plan", "inferred", None)
    p = provenance({"floor": 5}, None, 9, 200.0, None)
    assert p["exposure"] == "assumed" and p["floor"] == "assumed" and "floor 9" in p["notes"]
    assert norm_source("Photo landmarks") == "photo-landmarks" and norm_source("rumour") is None


# --------------------------------------------------------------------------- fetch cache and assembly

def test_socrata_cache_and_retry(tmp_path, monkeypatch):
    calls = []

    class R:
        def __init__(self, code, body):
            self.status_code, self._b = code, body

        def json(self):
            return self._b

        def raise_for_status(self):
            if self.status_code >= 400:
                raise fetch_mod.requests.HTTPError(f"{self.status_code}", response=self)

    seq = [R(503, None), R(200, [{"a": 1}])]

    def get(url, *a, **k):
        if "/api/views/" in url:  # dataset metadata for the receipt
            return R(200, {"rowsUpdatedAt": 1791706679, "name": "Test"})
        calls.append(1)
        return seq.pop(0)
    monkeypatch.setattr(fetch_mod.requests, "get", get)
    monkeypatch.setattr(fetch_mod.time, "sleep", lambda s: None)
    with fetch_mod.collect_receipts() as rc:
        assert fetch_mod.socrata("abcd-1234", {"$where": "x"}, tmp_path) == [{"a": 1}]
        assert fetch_mod.socrata("abcd-1234", {"$where": "x"}, tmp_path) == [{"a": 1}]
    assert len(calls) == 2
    assert len([p for p in tmp_path.glob("socrata-abcd-1234-*.json") if ".receipt" not in p.name]) == 1
    # receipts: one fresh, one cache hit, same payload hash; dataset update time from the metadata endpoint
    assert len(rc) == 2 and rc[0]["sha256"] == rc[1]["sha256"] and rc[1]["cached"] and not rc[0]["cached"]
    payload = next(p for p in tmp_path.glob("socrata-abcd-1234-*.json") if ".receipt" not in p.name)
    assert rc[0]["sha256"] == fetch_mod.sha256_bytes(payload.read_bytes())
    assert rc[0]["rows"] == 1 and rc[0]["rows_updated"].startswith("2026-") and "%24where=x" in rc[0]["url"]


def test_receipt_limit_hit_and_summary(tmp_path, monkeypatch):
    class R:
        status_code = 200

        def __init__(self, body):
            self._b = body

        def json(self):
            return self._b

        def raise_for_status(self):
            pass
    monkeypatch.setattr(fetch_mod.requests, "get",
                        lambda url, *a, **k: R({}) if "/api/views/" in url else R([{"a": 1}, {"a": 2}]))
    with fetch_mod.collect_receipts() as rc:
        fetch_mod.socrata("abcd-1234", {"$where": "y", "$limit": 2}, tmp_path)
        fetch_mod.socrata("abcd-1234", {"$where": "z", "$limit": 10}, tmp_path)
    assert rc[0]["limit_hit"] is True and rc[1]["limit_hit"] is False
    (summ,) = fetch_mod.summarise_receipts(rc)
    assert summ["calls"] == 2 and summ["rows"] == 4 and summ["limit_hit"] is True and len(summ["queries"]) == 2
    assert "rows_updated" not in summ  # metadata unavailable: key omitted, not guessed


def test_make_site_offline_v2(monkeypatch):
    rows = [_nyc_row("10", box(-15, -10, 15, 10), 200, bbl="1000010010"),
            _nyc_row("11", box(15, -10, 35, 10), 80, bbl="1000010011"),          # party wall on the east
            _nyc_row("12", box(-15, -60, 15, -30), None, bbl="1000010012")]      # across the street, south
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: parse_nyc_rows(rows))
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {"1000010012": {"numfloors": 4}})
    import apartmentscout.geo.streets as st_mod
    import apartmentscout.geo.future as fu_mod
    monkeypatch.setattr(st_mod, "fetch_streets", lambda *a, **k: ([{"name": "W 1 St", "pts": [[-50, -20], [50, -20]],
                                                                   "width_m": 10.4}], "test streets"))
    monkeypatch.setattr(fu_mod, "fetch_future", lambda *a, **k: [])
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 12, "exposure": ["E", "S"]}
    crit = {"search": {"city": "nyc", "timezone": "America/New_York"}}
    site, face, T = site_mod.make_site(L, crit, year=2026)
    assert site["version"] == 2 and round(face["bearing"]) == 180          # east is a party wall
    assert any(f.get("shared") and round(f["bearing"]) == 90 for f in site["faces"])
    assert site["window"]["face"] == face["i"] and site["window"]["t"] == 0.5
    rng = site["study"]["sun_hours_range"]
    assert rng["floors"] == [10, 11, 12, 13, 14] and len(rng["lo"]) == 12
    assert site["bmeta"][2]["height_src"] == "pluto-floors"
    assert site["streets"][0]["name"] == "W 1 St" and site["future"] == []
    assert site["provenance"]["exposure"] == "listing"
    assert {"footprints", "faces", "study", "range"} <= set(T)
    json.dumps(site)  # serialisable
