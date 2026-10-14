"""Component buildings (podium / tower / setback / bulkhead) and the relative daylight model."""
from __future__ import annotations

import math

import pytest

from apartmentscout.geo import LocalFrame
from apartmentscout.geo import components as comp_mod
from apartmentscout.geo.checks import site_checks
from apartmentscout.geo.components import (build_components, classify, coverage, derive_components,
                                           load_overrides, parse_osm_parts)
from apartmentscout.sun import (Skyline, _Tracks, components_of, expected_sun, month_tracks, sky_view, sun_hours_range,
                                sun_study, target_faces, valid_component)

LAT, LON, TZ = 40.7549, -73.984, "America/New_York"
F = LocalFrame(LAT, LON)

# a south-facing target north of a 60 x 60 m lot carrying a 20 m podium and a 20 x 20 m tower to 100 m
LOT = [(-30, -70), (30, -70), (30, -10), (-30, -10)]
TOWER = [(-10, -60), (10, -60), (10, -40), (-10, -40)]


def _site(**extra) -> dict:
    s = {"version": 2, "origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.2, "target": 1,
         "b": [[100, 0, 0, [v for p in LOT for v in p]], [60, 0, 1, [-10, 10, 10, 10, 10, 30, -10, 30]]],
         "bmeta": [{"bin": "1000001", "height_src": "roof", "src": "nyc-footprints"},
                   {"bin": "1000002", "height_src": "roof", "src": "nyc-footprints"}]}
    s.update(extra)
    return s


def _comps() -> dict:
    return {"0": [{"ring": [list(p) for p in LOT], "base_m": 0, "top_m": 20, "kind": "podium", "source": "test"},
                  {"ring": [list(p) for p in TOWER], "base_m": 20, "top_m": 100, "kind": "tower", "source": "test"}]}


def _ll(ring):
    return [F.to_lonlat(x, y) for x, y in ring]


def _way(i, ring, **tags):
    g = [{"lon": lo, "lat": la} for lo, la in _ll(ring + [ring[0]])]
    return {"type": "way", "id": i, "geometry": g, "tags": {"building:part": "yes", **tags}}


# --------------------------------------------------------------------------- obstruction calculations

def test_podium_and_setback_tower_change_sun_hours_vs_full_prism():
    prism, split = _site(), _site(components=_comps())
    faces = target_faces(split)
    south = next(f for f in faces if round(f["bearing"]) == 180)
    tracks = _Tracks(month_tracks(2026, LAT, LON, TZ))
    a = sun_study(prism, south, 5, TZ, 2026, tracks=tracks)
    b = sun_study(split, south, 5, TZ, 2026, tracks=tracks)
    assert sum(b["sun_hours"]) > sum(a["sun_hours"]) + 5
    assert b["sun_hours"][5] > a["sun_hours"][5]                       # June: over the podium, beside the tower
    assert b["skyline_ahead_deg"] == pytest.approx(math.degrees(math.atan(85.6 / 49.6)), abs=0.3)
    assert a["skyline_ahead_deg"] == pytest.approx(math.degrees(math.atan(85.6 / 19.6)), abs=0.3)
    assert b["sky_view"] > a["sky_view"] and b["daylight_factor_est"] > a["daylight_factor_est"]
    # floors table and range consume the components too
    assert sum(b["floors_table"][3]) > sum(a["floors_table"][3])
    ra = sun_hours_range(prism, south, 5, TZ, 2026, tracks=tracks)
    rb = sun_hours_range(split, south, 5, TZ, 2026, tracks=tracks)
    assert sum(rb["hi"]) > sum(ra["hi"])
    # the blocker is the same building, named by its index
    hit = Skyline(split).blocker(0, 9.6, 14.4, 180, 30)
    assert hit is not None and hit[0] == 0 and hit[1] == pytest.approx(49.6, abs=0.01)


def test_daylight_keys_per_floor():
    split = _site(components=_comps())
    south = next(f for f in target_faces(split) if round(f["bearing"]) == 180)
    st = sun_study(split, south, 5, TZ, 2026, floors=range(2, 8))
    assert set(st["daylight_floors"]) == set(range(2, 8))
    sv = [st["daylight_floors"][f][0] for f in range(2, 8)]
    assert sv == sorted(sv)                                             # higher floors see more sky
    assert st["daylight_floors"][5] == [st["sky_view"], st["daylight_factor_est"]]


def test_invalid_components_are_ignored():
    assert not valid_component({"ring": [[0, 0], [1, 0]], "top_m": 3})
    assert not valid_component({"ring": [[0, 0], [1, 0], [1, 1]], "base_m": 5, "top_m": 3})
    assert valid_component({"ring": [[0, 0], [1, 0], [1, 1]], "top_m": 3})
    s = _site(components={"0": [{"ring": "x"}], "9": _comps()["0"], "bad": []})
    assert components_of(s) == {}
    assert Skyline(s).profile(0, 9.6, 14.4).max() == pytest.approx(Skyline(_site()).profile(0, 9.6, 14.4).max())


def test_sky_view_monotonic_and_bay():
    import numpy as np
    flat = np.zeros(720)
    assert sky_view(flat, 10) == pytest.approx(1.0)
    wall = np.full(720, 30.0)
    assert 0.45 < sky_view(wall, 10) < 0.56                             # CIE weighting: low sky counts most
    assert sky_view(np.full(720, 60.0), 10) < sky_view(wall, 10)
    half = np.zeros(720)
    half[:360] = 45.0                                                   # obstructed to the east only
    assert sky_view(half, 90) < sky_view(half, 270)
    assert sky_view(half, 180, panes=[-45, 0, 45]) == pytest.approx(sky_view(half, 180, panes=[45, 0, -45]))


def test_expected_sun_uses_climatology():
    e = expected_sun([2.0] * 12, [0.5] * 12)
    assert e == {"possible": 730, "expected": 365, "monthly": [1.0] * 12}
    assert expected_sun([2.0] * 12, None) == {"possible": 730, "expected": None, "monthly": None}


# --------------------------------------------------------------------------- OpenStreetMap parts

def test_parse_osm_parts_tags():
    els = [_way(1, LOT, height="20"), _way(2, TOWER, height="100", min_height="20"),
           _way(3, TOWER, **{"building:levels": "10", "building:min_level": "2"}),
           _way(4, TOWER, **{"building:part": "no", "height": "5"}), _way(5, TOWER),
           _way(6, TOWER, height="300 ft", min_height="10")]
    ps = parse_osm_parts(els)
    assert [p["osm"] for p in ps] == ["way/1", "way/2", "way/3", "way/6"]
    assert ps[2]["base_m"] == pytest.approx(6.4) and ps[2]["top_m"] == pytest.approx(34.0) and ps[2]["levels"]
    assert ps[3]["top_m"] == pytest.approx(91.44) and not ps[1]["levels"]


def test_derive_components_cover_and_height_rules():
    site = _site()
    parts = parse_osm_parts([_way(1, LOT, height="20"), _way(2, TOWER, height="100", min_height="20")])
    comps, info = derive_components(site, parts)
    assert list(comps) == ["0"] and info["buildings"] == 1
    assert [(c["kind"], c["base_m"], c["top_m"], c["confidence"]) for c in comps["0"]] == \
        [("podium", 0.0, 20.0, "medium"), ("tower", 20.0, 100.0, "medium")]
    assert comps["0"][1]["ref"] == "https://www.openstreetmap.org/way/2"
    assert comps["0"][1]["ring"][0] == pytest.approx([-10, -60], abs=0.15)
    # only the tower mapped: the rest of the lot is unknown, so the footprint keeps its prism
    comps, info = derive_components(site, parse_osm_parts([_way(2, TOWER, height="100", min_height="20")]))
    assert comps == {} and info["partial"] == 1
    # parts that disagree with the measured roof (100 m) are not trusted
    comps, info = derive_components(site, parse_osm_parts([_way(1, LOT, height="20"), _way(2, TOWER, height="150")]))
    assert comps == {} and info["height_mismatch"] == 1


def test_classify_and_coverage():
    parts = [{"ring": LOT, "base_m": 0, "top_m": 20}, {"ring": TOWER, "base_m": 0, "top_m": 100},
             {"ring": [(-3, -53), (3, -53), (3, -47), (-3, -47)], "base_m": 100, "top_m": 106},
             {"ring": TOWER, "base_m": 20, "top_m": 60}]
    assert classify(parts) == ["podium", "tower", "bulkhead", "setback"]
    assert coverage(LOT, [], [LOT]) == pytest.approx(1.0)
    assert coverage(LOT, [], [TOWER]) == pytest.approx(400 / 3600, abs=0.03)


# --------------------------------------------------------------------------- manual overrides

def test_manual_overrides_yaml(tmp_path):
    p = tmp_path / "x.components.yaml"
    p.write_text("""
buildings:
  - select: {bin: "1000001"}
    components:
      - {kind: podium, ring: footprint, base_m: 0, top_m: 24, source: "DOB zoning diagram", confidence: high}
      - {kind: tower, ring: [[-10, -60], [10, -60], [10, -40], [-10, -40]], base_m: 24, top_m: 100,
         source: "DOB zoning diagram"}
  - select: target
    components:
      - {kind: tower, ring: footprint, top_m: 60}
  - select: {at: [500, 500]}
    components: []
""")
    comps, problems = load_overrides(p, _site())
    assert list(comps) == ["0"]
    assert comps["0"][0]["ring"] == [[-30, -70], [30, -70], [30, -10], [-30, -10]]
    assert comps["0"][0]["source"] == "manual: DOB zoning diagram" and comps["0"][0]["confidence"] == "high"
    assert comps["0"][1]["confidence"] == "medium"
    assert any("source is required" in m for m in problems) and any("no building matches" in m for m in problems)
    # manual entries replace OSM-derived ones for the same building
    parts = parse_osm_parts([_way(1, LOT, height="20"), _way(2, TOWER, height="100", min_height="20")])
    merged, info = build_components(_site(), parts, p)
    assert merged["0"][0]["top_m"] == 24 and info["manual"] == 1 and info["problems"]


def test_window_component_check():
    split = _site(components={**_comps(), "1": [
        {"ring": [[-10, 10], [10, 10], [10, 30], [-10, 30]], "base_m": 0, "top_m": 12, "kind": "podium", "source": "t"},
        {"ring": [[-10, 20], [10, 20], [10, 30], [-10, 30]], "base_m": 12, "top_m": 60, "kind": "tower", "source": "t"}]},
        components_info={"parts": 4, "buildings": 2, "partial": 0, "height_mismatch": 0})
    south = next(f for f in target_faces(split) if round(f["bearing"]) == 180)
    for floor, want in ((2, "pass"), (8, "warn")):
        split["window"] = {"face": south["i"], "bearing": 180.0, "floor": floor, "t": 0.5}
        ch = {c["id"]: c for c in site_checks(split, south)}
        assert ch["window-component"]["status"] == want, ch["window-component"]
        assert ch["components"]["status"] == "pass"


def test_make_site_with_parts(monkeypatch):
    """make_site splits the blocker when Overpass returns its parts and records what it did."""
    from apartmentscout.geo import site as site_mod
    rows = [{"bin": "1000001", "height": 100.0, "height_src": "roof", "ground": 0.0, "ring": _ll(LOT), "holes": [],
             "src": "nyc-footprints"},
            {"bin": "1000002", "height": 60.0, "height_src": "roof", "ground": 0.0,
             "ring": _ll([(-10, 10), (10, 10), (10, 30), (-10, 30)]), "holes": [], "src": "nyc-footprints"}]
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: [dict(r) for r in rows])
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {})
    parts = parse_osm_parts([_way(1, LOT, height="20"), _way(2, TOWER, height="100", min_height="20")])
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 5, "exposure": ["S"], "bin": "1000002"}
    crit = {"search": {"city": "nyc"}}
    monkeypatch.setattr(comp_mod, "fetch_osm_parts", lambda *a, **k: parts)
    a, _, _ = site_mod.make_site(L, crit, streets=False, future=False, year=2026)
    b, _, _ = site_mod.make_site(L, crit, streets=False, future=False, year=2026, components=False)
    assert a["components_info"]["buildings"] == 1 and "components" not in b
    assert sum(a["study"]["sun_hours"]) > sum(b["study"]["sun_hours"])
    assert a["study"]["sky_view"] > b["study"]["sky_view"]
    assert a["study"]["daylight_model"]["estimate"] is True
    assert a["study"]["sunshine"]["fraction"][0] == 0.54 and len(a["study"]["sun_hours_expected"]) == 12
    assert a["study"]["sun_year"]["expected"] < a["study"]["sun_year"]["possible"]
