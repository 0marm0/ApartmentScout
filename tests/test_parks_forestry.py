"""NYC Parks Properties, Greenstreets and the Forestry Tree Points around a site: polygon parsing and kinds, the overlay on
OpenStreetMap parks (paved playgrounds, Parks property), the live/removed split of the inventory, the join with the street
tree census (removed trees pruned, duplicates dropped, park vs street) and how build_green wires it in. Offline: fixtures."""
from __future__ import annotations

import math

import pytest

from apartmentscout.geo import LocalFrame, context, forestry, green as green_mod, parks, sightline, trees

LAT, LON = 40.7479, -73.9748
F = LocalFrame(LAT, LON)


def mp(x0: float, y0: float, x1: float, y1: float, hole: tuple[float, float, float, float] | None = None) -> dict:
    def ring(a, b, c, d):
        pts = [F.to_lonlat(x, y) for x, y in ((a, b), (c, b), (c, d), (a, d), (a, b))]
        return [[lo, la] for lo, la in pts]
    rings = [ring(x0, y0, x1, y1)] + ([ring(*hole)] if hole else [])
    return {"type": "MultiPolygon", "coordinates": [rings]}


def prow(name, cat, geom, retired=False, ref="M1") -> dict:
    return {"signname": name, "typecategory": cat, "subcategory": "x", "gispropnum": ref, "retired": retired, "multipolygon": geom}


def frow(x, y, dbh="10", struct="Full", cond="Good", sp="Platanus x acerifolia - London planetree") -> dict:
    lon, lat = F.to_lonlat(x, y)
    return {"dbh": dbh, "tpstructure": struct, "tpcondition": cond, "genusspecies": sp, "location": {"type": "Point", "coordinates": [lon, lat]}}


def crow(x, y, dbh=8) -> dict:
    lon, lat = F.to_lonlat(x, y)
    return {"latitude": f"{lat:.8f}", "longitude": f"{lon:.8f}", "tree_dbh": str(dbh), "spc_latin": "Platanus x acerifolia"}


# --------------------------------------------------------------------------- Parks Properties and Greenstreets

def test_queries_ask_for_properties_that_touch_the_box():
    q = parks.parks_query(LAT, LON, 700)
    assert "intersects(multipolygon" in q["$where"] and "retired = false" in q["$where"] and "POLYGON((" in q["$where"]
    assert "typecategory" in q["$select"] and "multipolygon" in q["$select"]
    assert "intersects(multipolygon" in parks.greenstreets_query(LAT, LON, 700)["$where"]


def test_parks_properties_become_polygons_with_kind_hardness_and_the_property_number():
    rows = [prow("St. Vartan Park", "Neighborhood Park", mp(100, 100, 160, 150), ref="M076"),
            prow("Tudor Grove Playground", "Playground", mp(-80, -60, -30, -20)),
            prow("Court Complex", "Recreational Field/Courts", mp(300, 0, 340, 40)),
            prow("Rec Center", "Buildings/Institutions", mp(10, 10, 60, 60)),            # not green: skipped
            prow("Old lot", "Neighborhood Park", mp(10, 200, 60, 260), retired=True),    # retired: skipped
            prow("Far Park", "Neighborhood Park", mp(2000, 2000, 2100, 2100)),           # outside the radius
            prow("Sliver", "Mall", mp(0, 300, 5, 304))]                                  # 20 m2: dropped
    out = parks.parse_parks(rows, F, 600)
    by = {p["name"]: p for p in out}
    assert set(by) == {"St. Vartan Park", "Tudor Grove Playground", "Court Complex"}
    v = by["St. Vartan Park"]
    assert v["kind"] == "park" and v["src"] == "parks" and v["ref"] == "M076" and not v.get("hard") and v["cat"] == "Neighborhood Park"
    assert by["Tudor Grove Playground"]["kind"] == "play" and by["Tudor Grove Playground"]["hard"] == 1
    assert by["Court Complex"]["hard"] == 1
    assert abs(green_mod.ring_area(v["ring"])) == pytest.approx(60 * 50, rel=0.02)
    assert all(len(str(c).split(".")[-1]) <= 1 for pt in v["ring"] for c in pt)


def test_a_courtyard_in_a_property_is_a_hole_and_a_big_ring_is_simplified():
    (p,) = parks.parse_parks([prow("Ring Park", "Neighborhood Park", mp(0, 0, 100, 100, hole=(40, 40, 60, 60)))], F, 600)
    assert len(p["holes"]) == 1
    n = 900
    ring = [list(F.to_lonlat(200 + 80 * math.cos(2 * math.pi * i / n), 200 + 80 * math.sin(2 * math.pi * i / n))) for i in range(n)]
    ring.append(ring[0])
    (big,) = parks.parse_parks([prow("Round", "Flagship Park", {"type": "Polygon", "coordinates": [ring]})], F, 600)
    assert len(big["ring"]) <= parks.MAX_RING_PTS


def test_greenstreets_skip_the_inactive_ones():
    rows = [{"featurestatus": "Active", "gispropnum": "M1Z", "multipolygon": mp(0, 0, 20, 20)},
            {"featurestatus": "Inactive", "gispropnum": "M2Z", "multipolygon": mp(50, 50, 80, 80)}]
    out = parks.parse_greenstreets(rows, F, 600)
    assert [p["ref"] for p in out] == ["M1Z"] and out[0]["src"] == "greenstreet" and out[0]["kind"] == "park"


def osm(kind, x0, y0, x1, y1, **extra) -> dict:
    return {"kind": kind, "osm": f"way/{abs(hash((kind, x0))) % 999}", "ring": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], **extra}


def test_an_openstreetmap_park_inside_a_playground_property_is_paved_unless_it_says_grass():
    play = parks.parse_parks([prow("Robert Moses Playground", "Playground", mp(0, 0, 100, 100))], F, 600)
    inside = osm("park", 5, 5, 95, 95, name="Robert Moses Playground")
    lawn = osm("park", 10, 10, 90, 90, lawn=1)
    beside = osm("park", 300, 300, 360, 360)
    out = parks.merge_polys([inside, lawn, beside], play)
    got = {(p["ring"][0][0], p.get("src", "osm")): p for p in out}
    assert got[(5, "osm")]["hard"] == 1 and got[(5, "osm")]["why"].startswith("NYC Parks")
    assert not got[(10, "osm")].get("hard")                                   # OpenStreetMap says the surface is grass
    assert not got[(300, "osm")].get("hard")
    assert got[(5, "osm")]["on_parks"] == 1 and "on_parks" not in got[(300, "osm")]
    assert all(out[i]["ring"] and abs(green_mod.ring_area(out[i]["ring"])) >= abs(green_mod.ring_area(out[i + 1]["ring"])) for i in range(len(out) - 1))


def test_merge_is_repeatable_after_stripping_the_city_polygons():
    nyc = parks.parse_parks([prow("P", "Playground", mp(0, 0, 100, 100)), prow("St. Vartan", "Neighborhood Park", mp(200, 0, 300, 100))], F, 600)
    once = parks.merge_polys([osm("park", 5, 5, 95, 95), osm("park", 400, 0, 450, 50)], nyc)
    again = parks.merge_polys(parks.strip_nyc(once), nyc)
    assert [(p.get("src"), p.get("hard"), p.get("on_parks")) for p in once] == [(p.get("src"), p.get("hard"), p.get("on_parks")) for p in again]
    assert not any(p.get("src") for p in parks.strip_nyc(once)) and not any("on_parks" in p for p in parks.strip_nyc(once))
    # without the property the paved flag goes away again
    assert not parks.merge_polys(parks.strip_nyc(once), [])[0].get("hard")


# --------------------------------------------------------------------------- OpenStreetMap surfaces

def test_surface_classes_for_lawns_courts_turf_and_pitches():
    sc = green_mod.surface_class
    assert sc({"leisure": "pitch", "surface": "grass"}, "play") == ("grass", False, False)
    assert sc({"leisure": "park", "surface": "grass"}, "park") == ("park", False, False)
    assert sc({"leisure": "pitch", "surface": "artificial_turf"}, "play") == ("grass", True, True)
    assert sc({"leisure": "pitch", "surface": "asphalt", "sport": "basketball"}, "play") == ("play", True, False)
    assert sc({"leisure": "pitch", "sport": "soccer"}, "play") == ("grass", True, True)           # a field with no surface tag: turf, no trees
    assert sc({"leisure": "pitch", "sport": "tennis"}, "play") == ("play", True, False)             # a court with none: paved
    assert sc({"leisure": "playground"}, "play") == ("play", True, False)
    assert sc({"leisure": "park"}, "park") == ("park", False, False)
    assert sc({"landuse": "grass", "surface": "concrete"}, "grass") == ("grass", True, False)


def test_new_openstreetmap_tags_are_asked_for_and_parsed():
    q = green_mod.green_query(LAT, LON, 600)
    for tag in ("pitch", "flowerbed", "heath"):
        assert tag in q

    def way(i, tags, x0, y0, x1, y1):
        pts = [F.to_lonlat(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0))]
        return {"type": "way", "id": i, "tags": tags, "geometry": [{"lon": lo, "lat": la} for lo, la in pts]}

    g = green_mod.parse_green([way(1, {"leisure": "pitch", "sport": "basketball"}, 0, 0, 30, 30),
                               way(2, {"leisure": "pitch", "surface": "artificial_turf", "sport": "soccer"}, 100, 0, 160, 40),
                               way(3, {"leisure": "park", "surface": "grass"}, 200, 0, 260, 60)], F, 600)
    by = {p["osm"]: p for p in g["polys"]}
    assert by["way/1"]["kind"] == "play" and by["way/1"]["hard"] == 1
    assert by["way/2"]["kind"] == "grass" and by["way/2"]["hard"] == 1 and by["way/2"]["turf"] == 1
    assert by["way/3"]["lawn"] == 1 and "hard" not in by["way/3"]


# --------------------------------------------------------------------------- the inventory and the census

def test_the_query_asks_for_every_point_in_the_box():
    q = forestry.forestry_query(LAT, LON, 600)
    assert "within_box(location" in q["$where"] and q["$limit"] >= 30000 and "tpstructure" in q["$select"]


def test_live_and_removed_points_are_told_apart():
    assert forestry.is_live(frow(0, 0)) and forestry.is_live(frow(0, 0, cond="Unknown"))
    assert not forestry.is_live(frow(0, 0, cond="Dead")) and not forestry.is_live(frow(0, 0, struct="Stump"))
    assert forestry.is_gone(frow(0, 0, struct="Retired")) and forestry.is_gone(frow(0, 0, struct="Stump - Uprooted"))
    assert forestry.is_gone(frow(0, 0, cond="Dead")) and not forestry.is_gone(frow(0, 0))
    live, gone = forestry.read_points([frow(10, 10, "14"), frow(20, 20, struct="Retired"), frow(30, 30, "0"), frow(5000, 0),
                                       {"dbh": "5", "tpstructure": "Full", "location": None}, frow(40, 40, "n/a", sp="Quercus rubra - northern red oak")], F, 600)
    assert [t["dbh"] for t in live] == [14, 1, 6] and len(gone) == 1
    assert trees.GROUPS[live[2]["grp"]] == "oak" and trees.GROUPS[live[0]["grp"]] == "plane"


def census_block(*xy_dbh) -> dict:
    return trees.parse_census([crow(x, y, d) for x, y, d in xy_dbh], F, 600)


def test_census_trees_the_inventory_lists_as_removed_are_dropped_unless_a_live_tree_stands_there():
    c = census_block((10, 10, 8), (50, 10, 8), (90, 10, 8), (130, 10, 8))
    live, gone = forestry.read_points([frow(10.5, 10), frow(50.5, 10, struct="Retired"),
                                       frow(90.5, 10, struct="Retired"), frow(90, 11)], F, 600)     # a replanted tree beside a retired point
    out = forestry.prune_census(c, live, gone)
    left = sorted(round(x * 0.5) for x in out["pts"][0::4])
    assert out["removed"] == 1 and out["n"] == 3 and len(out["pts"]) == 12
    assert left == [10, 90, 130]                                                                      # only the one at x = 50 is gone; x = 130 has no point at all
    assert "1 census trees" in out["note"] and c["n"] == 4                                           # the input is not changed


def test_forestry_trees_are_deduped_against_the_census_and_split_into_park_and_street():
    c = census_block((10, 10, 8), (60, 10, 8))
    live, _ = forestry.read_points([frow(10.5, 10.5), frow(60, 12.5),                                # both within 3 m of a census tree: the same trees
                                    frow(200, 200, "16"), frow(205, 200, "18"),                       # inside the park
                                    frow(400, 10, "3")], F, 600)                                      # a sapling on a street, planted since the census
    poly = [{"kind": "park", "src": "parks", "ring": [[180, 180], [240, 180], [240, 240], [180, 240]]}]
    b = forestry.parse_forestry(live, forestry.census_positions(c), poly, 600, fetched="2026-10-15", rows_updated_at="2026-10-07T12:00:00+00:00")
    assert b["n"] == 3 and b["n_park"] == 2 and b["n_street"] == 1 and b["matched_census"] == 2
    assert b["dataset"] == "hn5i-inap" and b["date"] == "2026-10-07" and b["fetched"] == "2026-10-15" and b["q_m"] == 0.5
    pts = [tuple(b["pts"][i:i + 5]) for i in range(0, len(b["pts"]), 5)]
    assert all(isinstance(v, int) for p in pts for v in p) and sorted(p[4] for p in pts) == [0, 0, 1]
    assert next(p for p in pts if p[4] == 1)[2] == 3 and {p[2] for p in pts if p[4] == 0} == {16, 18}
    assert "sun hours" in b["note"]


def test_each_census_tree_absorbs_one_inventory_point_only():
    c = census_block((10, 10, 8))
    live, _ = forestry.read_points([frow(10.4, 10), frow(11.8, 10)], F, 600)                          # two points near one census tree
    b = forestry.parse_forestry(live, forestry.census_positions(c), [], 600)
    assert b["matched_census"] == 1 and b["n"] == 1


def test_polygons_on_parks_property_get_their_living_tree_count():
    polys = [{"kind": "park", "src": "parks", "on_parks": 1, "ring": [[0, 0], [100, 0], [100, 100], [0, 100]]},
             {"kind": "park", "osm": "way/1", "ring": [[300, 0], [400, 0], [400, 100], [300, 100]]},          # private park: no inventory
             {"kind": "grass", "osm": "way/2", "on_parks": 1, "ring": [[500, 0], [540, 0], [540, 40], [500, 40]]}]
    live, _ = forestry.read_points([frow(20, 20), frow(80, 80), frow(350, 50)], F, 600)
    b = forestry.parse_forestry(live, [], polys, 600)
    forestry.count_in_polys(b, polys)
    assert polys[0]["inv"] == 2 and "inv" not in polys[1] and polys[2]["inv"] == 0


# --------------------------------------------------------------------------- build_green

def stub_sources(monkeypatch, parks_rows=None, tree_rows=None, census_rows=None):
    monkeypatch.setattr(parks, "fetch_parks", lambda lat, lon, r, cd=None, refresh=False: parks.parse_parks(
        parks_rows if parks_rows is not None else [prow("St. Vartan Park", "Neighborhood Park", mp(100, 100, 200, 200))], LocalFrame(lat, lon), r))
    monkeypatch.setattr(forestry, "fetch_rows", lambda lat, lon, r, cd=None, refresh=False: (
        tree_rows if tree_rows is not None else [frow(150, 150, "14"), frow(160, 170, "20"), frow(10.5, 10, struct="Retired"), frow(30, 5)], "2026-10-07T00:00:00+00:00"))
    monkeypatch.setattr(trees, "fetch_census", lambda lat, lon, r, cd=None, refresh=False: trees.parse_census(
        census_rows if census_rows is not None else [crow(10, 10), crow(30.5, 5.5)], LocalFrame(lat, lon), r))


def osm_green(*a, **k) -> dict:
    return {"source": green_mod.SOURCE, "fetched": "2026-10-14", "radius_m": 600, "polys": [osm("park", 120, 120, 180, 180)],
            "trees": [1.0, 2.0], "counts": {"polys": 1, "trees": 1}, "note": "n"}


def test_new_york_gets_city_polygons_the_pruned_census_and_the_inventory(monkeypatch):
    monkeypatch.setattr(green_mod, "fetch_green", osm_green)
    stub_sources(monkeypatch)
    msgs: list[str] = []
    g = context.build_green(LAT, LON, 600, "nyc", say=msgs.append)
    assert [p["src"] for p in g["polys"] if "src" in p] == ["parks"] and len(g["polys"]) == 2
    assert all(p["on_parks"] == 1 for p in g["polys"]) and {p["inv"] for p in g["polys"]} == {2}     # OSM park inside the city one
    assert g["census"]["n"] == 1 and g["census"]["removed"] == 1                                       # the tree beside the retired point is gone
    assert g["forestry"]["n"] == 2 and g["forestry"]["n_park"] == 2 and g["forestry"]["matched_census"] == 1
    c = g["counts"]
    assert (c["parks_polys"], c["greenstreet_polys"] if "greenstreet_polys" in c else 0, c["census_trees"], c["forestry_trees"], c["census_removed"]) == (1, 0, 1, 2, 1)
    assert any("Parks inventory" in m for m in msgs)


def test_other_cities_get_none_of_it(monkeypatch):
    monkeypatch.setattr(green_mod, "fetch_green", osm_green)
    called: list[int] = []
    monkeypatch.setattr(parks, "fetch_parks", lambda *a, **k: called.append(1))
    g = context.build_green(LAT, LON, 600, "boston")
    assert g is not None and "forestry" not in g and "census" not in g and not called


def test_each_new_york_source_fails_on_its_own(monkeypatch):
    monkeypatch.setattr(green_mod, "fetch_green", osm_green)
    stub_sources(monkeypatch)
    monkeypatch.setattr(forestry, "fetch_rows", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    g = context.build_green(LAT, LON, 600, "nyc")
    assert "forestry" not in g and g["census"]["n"] == 2 and g["counts"]["parks_polys"] == 1          # no inventory: the census stays whole
    stub_sources(monkeypatch)
    monkeypatch.setattr(parks, "fetch_parks", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    g = context.build_green(LAT, LON, 600, "nyc")
    assert [p.get("src") for p in g["polys"]] == [None] and "forestry" in g and "parks_polys" not in g["counts"]
    monkeypatch.setattr(green_mod, "fetch_green", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    stub_sources(monkeypatch)
    g = context.build_green(LAT, LON, 600, "nyc")                                                       # no OpenStreetMap at all: the city layers alone
    assert g is not None and g["polys"][0]["src"] == "parks" and g["forestry"]["n"] == 2


def test_keep_osm_rebuilds_the_city_layers_without_doubling_them(monkeypatch):
    monkeypatch.setattr(green_mod, "fetch_green", osm_green)
    stub_sources(monkeypatch)
    first = context.build_green(LAT, LON, 600, "nyc")
    monkeypatch.setattr(green_mod, "fetch_green", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no Overpass call")))
    again = context.build_green(LAT, LON, 600, "nyc", keep=first)
    assert len(again["polys"]) == len(first["polys"]) == 2 and again["counts"]["parks_polys"] == 1
    assert again["forestry"]["n"] == first["forestry"]["n"] and again["census"]["n"] == first["census"]["n"]
    assert again["counts"]["trees"] == first["counts"]["trees"]


# --------------------------------------------------------------------------- the window's view

def test_sightline_cells_skip_paved_ground_and_count_overlaps_once():
    big = {"kind": "park", "ring": [[0, 0], [60, 0], [60, 60], [0, 60]]}
    inner = {"kind": "park", "ring": [[10, 10], [40, 10], [40, 40], [10, 40]]}
    paved = {"kind": "play", "hard": 1, "ring": [[100, 0], [160, 0], [160, 60], [100, 60]]}
    cells = sightline.green_cells({"polys": [big, inner, paved]})
    assert {c["poly"] for c in cells} == {0}                                                            # the inner polygon adds nothing; paved is not green
    total = sum(c["area"] for c in cells)
    assert 3000 < total < 4200
