"""City context around a site: the NYC Street Tree Census (points with trunk diameters, allometry, compaction), the
water polygons (clipping, simplification, quantising, labels), and how make_site / add_green wire them in. Offline:
every download is a fixture. The JS twin of the allometry is checked against tests/fixtures/tree_allometry.json."""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from apartmentscout.geo import LocalFrame, context, green as green_mod, trees, water
from apartmentscout.geo import site as site_mod
from apartmentscout.geo.buildings import parse_nyc_rows

LAT, LON = 40.75, -73.99
F = LocalFrame(LAT, LON)
FIXTURES = Path(__file__).parent / "fixtures"


def row(x: float, y: float, dbh, latin="Platanus x acerifolia") -> dict:
    lon, lat = F.to_lonlat(x, y)
    return {"latitude": f"{lat:.8f}", "longitude": f"{lon:.8f}", "tree_dbh": str(dbh), "spc_latin": latin}


# --------------------------------------------------------------------------- allometry

def test_allometry_grows_with_diameter_then_levels_off():
    r = [trees.crown_radius_m(d) for d in (1, 5, 10, 20, 40, 60)]
    h = [trees.tree_height_m(d) for d in (1, 5, 10, 20, 40, 60)]
    assert r == sorted(r) and h == sorted(h)
    assert trees.crown_radius_m(500) == trees.CROWN_MAX_M / 2 and trees.tree_height_m(500) == trees.HEIGHT_MAX_M
    # a Midtown street tree: 8 in trunk -> about 10 m tall with a crown 6-7 m across
    assert 9 < trees.tree_height_m(8) < 11.5
    assert 5.5 < 2 * trees.crown_radius_m(8) < 7.5
    assert trees.crown_radius_m(0) == trees.CROWN_BASE_M / 2 and trees.tree_height_m(-3) == trees.HEIGHT_BASE_M


def test_allometry_matches_the_js_twin_fixture():
    rows = json.loads((FIXTURES / "tree_allometry.json").read_text())
    assert rows
    for dbh, crown_r, height in rows:
        assert trees.crown_radius_m(dbh) == pytest.approx(crown_r, abs=0.005)
        assert trees.tree_height_m(dbh) == pytest.approx(height, abs=0.005)


def test_census_trunks_are_sized_with_the_growth_since_the_survey():
    assert trees.grown_dbh_in(8) == 8 + trees.GROWTH_IN == 10.0
    assert trees.grown_dbh_in(-1) == trees.GROWTH_IN
    assert 11.5 < trees.tree_height_m(trees.grown_dbh_in(8)) < 14.5            # a Midtown street tree after a decade of growth


def test_water_window_reaches_past_the_far_shore_of_the_east_river():
    assert water.HALF_M >= 1500 and water.Q_M == 0.5


def test_species_groups_by_genus():
    g = trees.GROUPS
    assert g[trees.species_group("Platanus x acerifolia")] == "plane"
    assert g[trees.species_group("Gleditsia triacanthos var. inermis")] == "locust"
    assert g[trees.species_group("Styphnolobium japonicum")] == "locust"
    assert g[trees.species_group("Quercus palustris")] == "oak"
    assert g[trees.species_group("Pyrus calleryana")] == "ornamental"
    assert g[trees.species_group("Ginkgo biloba")] == "ginkgo"
    assert g[trees.species_group("Pinus strobus")] == "conifer"
    assert g[trees.species_group(None)] == "other" and g[trees.species_group("")] == "other"
    assert g[trees.species_group("Unknownus x")] == "other"


# --------------------------------------------------------------------------- census parsing and compaction

def test_census_query_asks_for_live_trees_in_the_box():
    q = trees.census_query(LAT, LON, 600)
    assert "status='Alive'" in q["$where"] and "latitude between" in q["$where"] and "longitude between" in q["$where"]
    assert q["$limit"] >= 10000 and "tree_dbh" in q["$select"] and "spc_latin" in q["$select"]


def test_parse_census_builds_compact_points_with_a_diameter_and_group():
    rows = [row(10, 20, 8), row(-30.2, 5.3, 14, "Quercus rubra"), row(100, 100, 3, "Gleditsia triacanthos")]
    c = trees.parse_census(rows, F, 600, fetched="2026-10-14")
    assert c["source"].startswith("NYC Street Tree Census") and c["dataset"] == "uvpi-gqnh" and c["date"] == "2015"
    assert c["fetched"] == "2026-10-14" and c["n"] == 3 and len(c["pts"]) == 12 and c["q_m"] == 0.5
    pts = [tuple(c["pts"][i:i + 4]) for i in range(0, 12, 4)]
    assert all(isinstance(v, int) for p in pts for v in p)                    # integers: compact in JSON
    near = pts[0]                                                             # nearest first
    assert abs(near[0] * 0.5 - 10) <= 0.26 and abs(near[1] * 0.5 - 20) <= 0.26 and near[2] == 8
    assert c["groups"][near[3]] == "plane"
    assert [c["groups"][p[3]] for p in pts] == ["plane", "oak", "locust"] or {c["groups"][p[3]] for p in pts} == {"plane", "oak", "locust"}


def test_parse_census_drops_far_duplicate_and_broken_rows_and_clamps_diameters():
    rows = [row(10, 10, 8), row(10.1, 10.1, 9),                               # same half-metre cell: one tree
            row(900, 0, 8),                                                   # outside the radius
            {"latitude": "x", "longitude": "-73.9", "tree_dbh": "5"},         # unparseable position
            row(20, 20, 0), row(30, 30, 450), row(40, 40, "n/a")]            # sapling, data-entry error, missing
    c = trees.parse_census(rows, F, 600)
    assert c["n"] == 4
    dbh = sorted(c["pts"][i + 2] for i in range(0, len(c["pts"]), 4))
    assert dbh[0] == 1 and dbh[-1] == trees.MAX_DBH_IN and 6 in dbh


def test_parse_census_caps_the_count_nearest_first():
    rows = [row(i * 3.0, 0, 8) for i in range(1, 50)]
    c = trees.parse_census(rows, F, 600, max_trees=10)
    assert c["n"] == 10 and max(c["pts"][0::4]) * 0.5 <= 31


def test_compaction_keeps_a_site_small():
    rows = [row(-290 + (i % 60) * 9.7, -290 + (i // 60) * 9.7, 4 + i % 20) for i in range(1800)]
    c = trees.parse_census(rows, F, 600)
    size = len(json.dumps(c, separators=(",", ":")))
    assert c["n"] == 1800 and size / c["n"] < 20                               # under 20 bytes a tree
    stats = trees.census_stats(c)
    assert stats["n"] == 1800 and stats["crown_m2"] > 0


# --------------------------------------------------------------------------- water

def lonlat_ring(*xy):
    pts = [list(F.to_lonlat(x, y)) for x, y in xy]
    return pts + [pts[0]]


def hydro_row(name, *rings):
    return {"name": name, "feat_code": "2620", "the_geom": {"type": "MultiPolygon", "coordinates": [[lonlat_ring(*r) for r in rings]]}}


def test_clip_ring_cuts_to_the_square():
    big = [(-5000, -5000), (5000, -5000), (5000, 5000), (-5000, 5000)]
    c = water.clip_ring(big, -100, 100)
    xs = [p[0] for p in c] + [p[1] for p in c]
    assert min(xs) == -100 and max(xs) == 100 and abs(water.ring_area(c)) == pytest.approx(200 * 200)
    assert water.clip_ring([(500, 500), (600, 500), (600, 600)], -100, 100) == []
    inner = [(-10, -10), (10, -10), (10, 10), (-10, 10)]
    assert water.clip_ring(inner, -100, 100) == inner


def test_dp_simplify_drops_collinear_points_and_keeps_corners():
    ring = [(x, 0.0) for x in range(0, 100, 5)] + [(100.0, y) for y in range(0, 100, 5)] + [(x, 100.0) for x in range(100, 0, -5)] + [(0.0, y) for y in range(100, 0, -5)]
    s = water.dp_simplify(ring, 0.5)
    assert len(s) <= 6 and abs(water.ring_area(s)) == pytest.approx(100 * 100, rel=0.02)


def test_parse_hydro_clips_quantises_and_labels_a_river():
    river = [(300, -2000), (2500, -2000), (2500, 2000), (300, 2000), (300, 500), (320, 300), (300, 100), (310, -300)]
    island = [(500, 0), (600, 0), (600, 120), (500, 120)]                    # a hole: Roosevelt Island
    w = water.parse_hydro([hydro_row("EAST RIVER", river, island), hydro_row("unset", [(5000, 5000), (5100, 5000), (5100, 5100)])], F, 800)
    assert w["source"].startswith("NYC Planimetric") and w["half_m"] == 800 and w["q_m"] == 0.5
    (poly,) = w["polys"]                                                       # the far, nameless body is outside the window
    assert poly["name"] == "East River" and len(poly["rings"]) == 2
    lim = (800 + water.PAD_M) / water.Q_M
    assert all(abs(v) <= lim + 1 for ring in poly["rings"] for v in ring) and all(isinstance(v, int) for ring in poly["rings"] for v in ring)
    assert w["labels"] and w["labels"][0]["name"] == "East River"
    lx, ly = w["labels"][0]["x"], w["labels"][0]["y"]
    assert 300 < lx < 800 and abs(ly) <= 800                                   # in the water, not on the island
    assert not (500 <= lx <= 600 and 0 <= ly <= 120)
    assert w["counts"]["rings"] == 2 and w["counts"]["points"] > 6 and "context" in w["note"].lower()


def test_parse_hydro_small_slivers_are_dropped():
    tiny = hydro_row("pond", [(0, 0), (5, 0), (5, 5), (0, 5)])
    assert water.parse_hydro([tiny], F, 800)["polys"] == []


def test_parse_osm_water_reads_ways_and_multipolygons():
    def g(*xy):
        return [{"lat": F.to_lonlat(x, y)[1], "lon": F.to_lonlat(x, y)[0]} for x, y in xy]

    lake = {"type": "way", "id": 1, "tags": {"natural": "water", "name": "The Pond"}, "geometry": g((0, 0), (80, 0), (80, 60), (0, 60), (0, 0))}
    pool = {"type": "way", "id": 2, "tags": {"natural": "water", "water": "pool"}, "geometry": g((200, 0), (240, 0), (240, 40), (200, 40), (200, 0))}
    rel = {"type": "relation", "id": 3, "tags": {"natural": "water", "type": "multipolygon", "name": "Bay"},
           "members": [{"type": "way", "role": "outer", "geometry": g((-500, 100), (-100, 100), (-100, 400), (-500, 400), (-500, 100))}]}
    w = water.parse_osm_water([lake, pool, rel], F, 800)
    assert [p.get("name") for p in w["polys"]] == ["Bay", "The Pond"] or {p.get("name") for p in w["polys"]} == {"Bay", "The Pond"}
    assert w["source"].startswith("OpenStreetMap")
    assert "swimming" not in json.dumps(w)


def test_nyc_params_snap_to_a_grid_so_neighbours_share_a_download():
    a, b = water.nyc_params(40.7479, -73.9748), water.nyc_params(40.7481, -73.9751)
    assert a == b and "intersects(the_geom" in a["$where"] and "the_geom" in a["$select"]


def test_label_point_prefers_deep_water_near_the_site():
    sea = [-1600, -1600, 1600, -1600, 1600, 1600, -1600, 1600]                # all water
    x, y = water.label_point([sea], 800, (0.0, 0.0))
    assert math.hypot(x, y) < 200
    assert water.label_point([], 800) is None


# --------------------------------------------------------------------------- wiring

def stepped(monkeypatch):
    ring = [list(F.to_lonlat(x, y)) for x, y in [(-15, -10), (15, -10), (15, 10), (-15, 10), (-15, -10)]]
    r = {"bin": "1000101", "base_bbl": "1000010001", "mappluto_bbl": "1000010001", "height_roof": 600, "ground_elevation": "0",
         "construction_year": "1990", "the_geom": {"type": "MultiPolygon", "coordinates": [[ring]]}}
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: parse_nyc_rows([r]))
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {})


def fake_census(lat, lon, radius, cache_dir=None, refresh=False):
    return trees.parse_census([row(40, 10, 8), row(60, -20, 12, "Quercus rubra")], LocalFrame(lat, lon), radius)


def fake_water(lat, lon, city=None, half_m=800.0, cache_dir=None, refresh=False):
    return water.parse_hydro([hydro_row("EAST RIVER", [(300, -2000), (2500, -2000), (2500, 2000), (300, 2000)])], LocalFrame(lat, lon), half_m)


def osm_green(*a, **k):
    return {"source": green_mod.SOURCE, "fetched": "2026-10-14", "radius_m": 600, "polys": [], "trees": [1.0, 2.0],
            "counts": {"polys": 0, "trees": 1}, "note": "n"}


def test_make_site_adds_census_trees_and_water_for_nyc(monkeypatch):
    stepped(monkeypatch)
    monkeypatch.setattr(green_mod, "fetch_green", osm_green)
    monkeypatch.setattr(trees, "fetch_census", fake_census)
    monkeypatch.setattr(water, "fetch_water", fake_water)
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 20, "exposure": ["E"]}
    site, _, T = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026)
    assert site["green"]["trees"] == [1.0, 2.0]                                # the OpenStreetMap trees stay as they were
    assert site["green"]["census"]["n"] == 2 and site["green"]["counts"]["census_trees"] == 2
    assert site["water"]["polys"][0]["name"] == "East River" and "water" in T
    off, _, _ = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026, water=False)
    assert "water" not in off and "census" in off["green"]
    none, _, _ = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026, green=False)
    assert "green" not in none and "water" not in none


def test_census_alone_survives_an_unreachable_overpass(monkeypatch):
    stepped(monkeypatch)
    monkeypatch.setattr(trees, "fetch_census", fake_census)                    # conftest makes fetch_green fail
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 20, "exposure": ["E"]}
    site, _, _ = site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, year=2026)
    assert site["green"]["polys"] == [] and site["green"]["census"]["n"] == 2
    assert "water" not in site                                                 # conftest makes fetch_water fail too: no block, no crash


def test_other_cities_get_no_census(monkeypatch):
    called = []
    monkeypatch.setattr(trees, "fetch_census", lambda *a, **k: called.append(1))
    monkeypatch.setattr(green_mod, "fetch_green", osm_green)
    g = context.build_green(LAT, LON, 600, "boston")
    assert g is not None and "census" not in g and not called


def test_add_green_context_only_adds_water_and_census(monkeypatch):
    monkeypatch.setattr(green_mod, "fetch_green", osm_green)
    monkeypatch.setattr(trees, "fetch_census", fake_census)
    monkeypatch.setattr(water, "fetch_water", fake_water)
    s = {"origin": {"lat": LAT, "lon": LON}, "b": []}
    assert site_mod.add_green(s, radius=600, city="nyc") is True
    assert "census" in s["green"] and "water" not in s                        # --green-only leaves water alone
    assert site_mod.add_green(s, radius=600, city="nyc", water=True) is True  # --context-only
    assert s["water"]["polys"] and s["green"]["counts"]["census_trees"] == 2
    monkeypatch.setattr(water, "fetch_water", lambda *a, **k: water.parse_hydro([], LocalFrame(LAT, LON)))
    site_mod.add_green(s, radius=600, city="nyc", water=True)
    assert "water" not in s                                                    # no water here any more: the stale block goes


def test_add_green_raises_when_nothing_loads():
    with pytest.raises(RuntimeError):
        site_mod.add_green({"origin": {"lat": LAT, "lon": LON}, "b": []}, radius=600)


def test_keep_osm_reuses_the_parks_and_adds_only_the_census_and_water(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("Overpass must not be called with keep_osm")

    monkeypatch.setattr(green_mod, "fetch_green", boom)
    monkeypatch.setattr(trees, "fetch_census", fake_census)
    monkeypatch.setattr(water, "fetch_water", fake_water)
    s = {"origin": {"lat": LAT, "lon": LON}, "b": [], "green": {**osm_green(), "polys": [{"kind": "park", "ring": [[0, 0], [10, 0], [10, 10]], "osm": "way/1"}],
                                                                 "counts": {"polys": 1, "trees": 1, "census_trees": 99}, "census": {"n": 99, "pts": []}}}
    assert site_mod.add_green(s, radius=600, city="nyc", water=True, keep_osm=True) is True
    assert s["green"]["polys"][0]["osm"] == "way/1" and s["green"]["trees"] == [1.0, 2.0]       # the OpenStreetMap part is untouched
    assert s["green"]["census"]["n"] == 2 and s["green"]["counts"]["census_trees"] == 2         # the census is fresh
    assert s["water"]["polys"]
