"""Green space in the site model (parks, lawns, trees from OpenStreetMap) and the facade sightline helper:
which parks a window on each facade can see. Offline: Overpass answers are fixtures."""
from __future__ import annotations

import math

import pytest

from apartmentscout.geo import LocalFrame, green as green_mod, sightline as sl
from apartmentscout.geo.green import fetch_green as real_fetch_green   # conftest stubs the module attribute offline
from apartmentscout.geo.site import add_green, listing_face, merge_receipts

LAT, LON = 40.75, -73.99
F = LocalFrame(LAT, LON)


def geom(*xy: tuple[float, float]) -> list[dict]:
    """Overpass ``out geom`` points for local-metre coordinates."""
    return [{"lat": F.to_lonlat(x, y)[1], "lon": F.to_lonlat(x, y)[0]} for x, y in xy]


def closed(x0: float, y0: float, x1: float, y1: float) -> list[dict]:
    return geom((x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0))


def way(id_: int, tags: dict, g: list[dict]) -> dict:
    return {"type": "way", "id": id_, "tags": tags, "geometry": g}


def tree(id_: int, x: float, y: float) -> dict:
    lon, lat = F.to_lonlat(x, y)
    return {"type": "node", "id": id_, "lat": lat, "lon": lon, "tags": {"natural": "tree"}}


# --------------------------------------------------------------------------- parsing and compaction

def test_query_asks_for_areas_and_trees_within_the_radius():
    q = green_mod.green_query(LAT, LON, 600)
    assert "around:600" in q and f"{LAT},{LON}" in q
    for tag in ("park", "playground", "garden", "grass", "recreation_ground", "wood", "tree_row", '"natural"="tree"'):
        assert tag in q
    assert "out geom tags" in q


def test_areas_become_compact_polygons_with_kind_name_and_osm_id():
    els = [way(1, {"leisure": "park", "name": "Tudor Greens"}, closed(100, 100, 140, 130)),
           way(2, {"landuse": "grass"}, closed(-50, -40, -20, -10)),
           way(3, {"natural": "wood"}, closed(0, 200, 30, 240)),
           way(4, {"building": "yes"}, closed(0, 0, 10, 10))]                       # not green: ignored
    g = green_mod.parse_green(els, F, 600, fetched="2026-10-14")
    kinds = {p["osm"]: p["kind"] for p in g["polys"]}
    assert kinds == {"way/1": "park", "way/2": "grass", "way/3": "wood"}
    park = next(p for p in g["polys"] if p["osm"] == "way/1")
    assert park["name"] == "Tudor Greens" and len(park["ring"]) == 4          # closing vertex dropped
    assert all(len(str(c).split(".")[-1]) <= 1 for pt in park["ring"] for c in pt)  # rounded to 0.1 m
    assert g["fetched"] == "2026-10-14" and g["radius_m"] == 600 and g["source"].startswith("OpenStreetMap")
    assert g["counts"]["polys"] == 3 and "sun hours" in g["note"]
    assert [abs(green_mod.ring_area(p["ring"])) for p in g["polys"]] == sorted(
        [abs(green_mod.ring_area(p["ring"])) for p in g["polys"]], reverse=True)   # biggest first


def test_small_slivers_open_ways_and_hard_surfaces():
    els = [way(1, {"leisure": "garden"}, closed(0, 0, 5, 5)),                         # 25 m2: dropped
           way(2, {"leisure": "park"}, geom((0, 0), (30, 0), (30, 30))),             # not closed: dropped
           way(3, {"leisure": "park", "surface": "concrete"}, closed(50, 50, 90, 90)),
           way(4, {"leisure": "playground"}, closed(100, 100, 130, 130))]
    g = green_mod.parse_green(els, F, 600)
    by = {p["osm"]: p for p in g["polys"]}
    assert set(by) == {"way/3", "way/4"}
    assert by["way/3"].get("hard") == 1 and by["way/4"]["kind"] == "play" and by["way/4"].get("hard") == 1


def test_multipolygon_relation_keeps_its_courtyard_as_a_hole():
    outer = closed(0, 0, 100, 100)
    inner = closed(40, 40, 60, 60)
    rel = {"type": "relation", "id": 9, "tags": {"leisure": "park", "type": "multipolygon", "name": "Ring Park"},
           "members": [{"type": "way", "role": "outer", "geometry": outer},
                       {"type": "way", "role": "inner", "geometry": inner}]}
    g = green_mod.parse_green([rel], F, 600)
    (p,) = g["polys"]
    assert p["osm"] == "relation/9" and len(p["holes"]) == 1
    assert abs(green_mod.ring_area(p["ring"])) == pytest.approx(10000, rel=0.01)


def test_trees_nodes_rows_radius_and_duplicates():
    row = way(7, {"natural": "tree_row"}, geom((0, 100), (40, 100)))              # 40 m long: a tree every 8 m
    els = [tree(1, 10, 10), tree(2, 10.4, 10.2), tree(3, 900, 0), row]            # 2 duplicates, 1 outside 600 m
    g = green_mod.parse_green(els, F, 600)
    pts = list(zip(g["trees"][0::2], g["trees"][1::2]))
    assert g["counts"]["tree_nodes"] == 2 and g["counts"]["tree_row_points"] == 6
    assert len(pts) == 7                                                           # 1 + 6 after thinning the duplicate
    assert all(math.hypot(*p) <= 600 for p in pts)


def test_line_samples_are_evenly_spaced_and_carry_over_corners():
    pts = green_mod.line_samples([(0, 0), (20, 0), (20, 20)], step=8)
    assert [tuple(round(v, 1) for v in p) for p in pts] == [(0, 0), (8, 0), (16, 0), (20, 4), (20, 12), (20, 20)]


def test_fetch_green_goes_through_the_cached_overpass_call(monkeypatch):
    calls = []

    def fake(query, cache_dir=None, max_age_days=30, refresh=False):
        calls.append((query, cache_dir, refresh))
        return [way(1, {"leisure": "park"}, closed(0, 0, 40, 40)), tree(2, 5, 5)]

    monkeypatch.setattr(green_mod, "overpass", fake)
    g = real_fetch_green(LAT, LON, 500, cache_dir="cache-dir", refresh=True)
    assert calls == [(green_mod.green_query(LAT, LON, 500), "cache-dir", True)]
    assert g["counts"] == {"polys": 1, "trees": 1, "tree_nodes": 1, "tree_row_points": 0}


# --------------------------------------------------------------------------- site integration

def box_b(x0, y0, x1, y1, top, g=0.0):
    return [top, g, 1, [x0, y0, x1, y0, x1, y1, x0, y1]]


def city(**kw) -> dict:
    """A 20 x 20 m tower (100 m) at the origin, floor height 3 m, and whatever else the test adds."""
    site = {"origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.0, "target": 0,
            "b": [box_b(-10, -10, 10, 10, 100.0)], "bmeta": [{"name": "Target"}], "study": {}}
    site.update(kw)
    return site


def park(x0, y0, x1, y1, name="Test Park") -> dict:
    return {"kind": "park", "name": name, "osm": "way/1",
            "ring": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


def test_add_green_adds_the_block_and_merges_the_receipt(monkeypatch):
    site = city(window={"face": 1, "t": 0.5, "floor": 20, "bearing": 90},
                receipts=[{"dataset": "overpass", "name": "OpenStreetMap (Overpass)", "calls": 1, "rows": 10,
                           "limit_hit": False, "retrieved": "2026-10-01T00:00:00+00:00",
                           "queries": [{"rows": 10, "sha256": "ab"}]}])
    site["b"][0] = box_b(-10, -10, 10, 10, 100.0)

    def fake_fetch(lat, lon, radius, cache_dir=None, refresh=False):
        from apartmentscout.geo.fetch import make_receipt, note_receipt
        note_receipt(make_receipt("overpass", "mirror q", 3, None, "cd" * 32))
        return {"source": green_mod.SOURCE, "fetched": "2026-10-14", "radius_m": radius, "polys": [park(100, -20, 140, 20)],
                "trees": [], "counts": {"polys": 1, "trees": 0}, "note": "n"}

    monkeypatch.setattr(green_mod, "fetch_green", fake_fetch)
    assert add_green(site, radius=600) is True
    assert site["green"]["polys"] and site["green"]["radius_m"] == 600
    (r,) = [r for r in site["receipts"] if r["dataset"] == "overpass"]
    assert r["calls"] == 2 and r["rows"] == 13 and len(r["queries"]) == 2
    assert site["study"]["green_view"]["fov_deg"] == 90.0                           # the window sees east: the park
    assert site["study"]["green_view"]["green"][0]["name"] == "Test Park"


def test_add_green_needs_an_origin():
    assert add_green({"b": []}) is False


def test_merge_receipts_adds_new_datasets():
    site = {"receipts": [{"dataset": "5zhs-2jue", "calls": 1, "rows": 5}]}
    merge_receipts(site, [{"dataset": "overpass", "calls": 1, "rows": 2, "queries": []}])
    assert [r["dataset"] for r in site["receipts"]] == ["5zhs-2jue", "overpass"]


def test_listing_face_picks_the_open_facade_by_index():
    faces = [{"i": 1, "bearing": 119, "length": 23}, {"i": 16, "bearing": 119, "length": 25},
             {"i": 4, "bearing": 29, "length": 10, "shared": True}]
    assert listing_face(faces, 1)["i"] == 1 and listing_face(faces, "16")["i"] == 16
    assert listing_face(faces, 4) is None and listing_face(faces, 99) is None and listing_face(faces, None) is None
    assert listing_face(faces, "x") is None


# --------------------------------------------------------------------------- sightline

def test_green_cells_cover_the_area_without_the_courtyard():
    g = {"polys": [{"kind": "park", "ring": [[0, 0], [60, 0], [60, 60], [0, 60]],
                    "holes": [[[20, 20], [40, 20], [40, 40], [20, 40]]]}]}
    cells = sl.green_cells(g, 6.0)
    assert sum(c["area"] for c in cells) == pytest.approx(3600 - 400, rel=0.1)
    assert not any(20 < c["x"] < 40 and 20 < c["y"] < 40 for c in cells)
    tiny = sl.green_cells({"polys": [{"kind": "park", "ring": [[0, 0], [3, 0], [3, 3], [0, 3]]}]}, 6.0)
    assert len(tiny) == 1                                                            # a small garden is not lost


def test_a_box_tower_has_four_facades_and_party_walls_are_dropped():
    site = city()
    z = (20 - 1) * 3.0 + 1.6
    groups = sl.facade_groups(sl.exterior_edges(site, z))
    assert [g["bearing"] for g in groups] == [0.0, 90.0, 180.0, 270.0] and all(g["length"] == 20.0 for g in groups)
    site["b"].append(box_b(10, -10, 40, 10, 150.0))                                   # a neighbour built against the east wall
    groups = sl.facade_groups(sl.exterior_edges(site, z))
    assert [g["bearing"] for g in groups] == [0.0, 180.0, 270.0]


def test_a_tower_uses_the_component_that_reaches_the_eye_height():
    site = city()
    site["components"] = {"0": [{"ring": [[-10, -10], [10, -10], [10, 10], [-10, 10]], "base_m": 0, "top_m": 12, "kind": "podium"},
                                {"ring": [[-4, -4], [4, -4], [4, 4], [-4, 4]], "base_m": 0, "top_m": 100, "kind": "tower"}]}
    high = sl.facade_groups(sl.exterior_edges(site, 60.0))
    assert all(g["length"] == 8.0 for g in high)                                      # the slim tower, not the podium
    low = sl.facade_groups(sl.exterior_edges(site, 6.0))
    assert all(g["length"] == 20.0 for g in low)


def test_walls_block_a_ground_point_only_when_they_rise_above_the_sight_line():
    eye = (0.0, 0.0, 60.0)
    target = [[200.0, 0.0]]
    import numpy as np
    pts = np.array(target)
    low = city(b=[box_b(-1, -1, 1, 1, 1.0), box_b(60, -20, 70, 20, 20.0)])
    tall = city(b=[box_b(-1, -1, 1, 1, 1.0), box_b(60, -20, 70, 20, 50.0)])
    assert sl.Walls(low).visible(eye, pts, 0.0)[0]                                    # sight line at 60 * (1 - 60/200) = 42 m > 20 m wall
    assert not sl.Walls(tall).visible(eye, pts, 0.0)[0]                               # 50 m wall is above it
    # a tree crown (10 m) behind the same 20 m wall is hidden from lower down but a wall near the eye never hides it
    assert sl.Walls(low).visible(eye, pts, 10.0)[0]


def test_survey_reports_where_in_the_frame_the_park_appears():
    # tower faces east; a park 150-190 m east and 20-60 m to the south-east of the facade centre line
    site = city(green={"polys": [park(150, -80, 190, -40)], "trees": []})
    eye = (10.6, 0.0, 60.0)
    s = sl.survey(site, eye, 90.0, 90.0)
    (row,) = s["green"]
    assert row["visible_m2"] > 1000 and row["visible_share"] == 1.0
    assert row["offset_deg"][0] > 10 and row["offset_deg"][1] < 45                    # to the right of the centre line, inside 90 degrees
    assert 140 < row["dist_m"][0] < row["dist_m"][1] < 230
    assert s["frame_pct"] > 0 and s["trees"] == {"in_fov": 0, "visible": 0, "offset_deg": []}
    west = sl.survey(site, (-10.6, 0.0, 60.0), 270.0, 90.0)
    assert west["green"] == [] and west["frame_pct"] == 0.0


def test_a_tall_neighbour_hides_the_park():
    site = city(green={"polys": [park(150, -80, 190, -40)], "trees": []})
    site["b"].append(box_b(40, -70, 70, -10, 110.0))                                  # a 110 m slab in the sight line
    s = sl.survey(site, (10.6, 0.0, 60.0), 90.0, 90.0)
    assert s["green"][0]["visible_m2"] == 0 and s["frame_pct"] == 0.0 and s["visible_m2"] == 0


def test_tall_neighbours_near_the_edges_of_the_frame_are_listed_with_their_offsets():
    site = city()
    site["b"].append(box_b(35, -60, 65, -25, 110.0))                                  # right of centre, about 44 degrees off
    site["b"].append(box_b(35, 25, 65, 60, 90.0))                                     # left of centre, about 44 degrees off
    site["b"].append(box_b(100, -5, 120, 5, 120.0))                                   # dead ahead: not an edge
    site["b"].append(box_b(35, -60, 65, -25, 40.0))                                   # lower than the eye: ignored
    site["bmeta"] += [{"name": "Dark Tower"}, {"name": "Tan Brick"}, {"name": "Ahead"}, {"name": "Low"}]
    near = sl.tall_near_edges(site, (10.6, 0.0, 60.0), 90.0, 45.0)
    assert [t["name"] for t in near["right_edge"]] == ["Dark Tower"]
    assert [t["name"] for t in near["left_edge"]] == ["Tan Brick"]
    assert 38 < near["right_edge"][0]["offset_deg"] < 50 and near["left_edge"][0]["offset_deg"] < -38
    assert near["right_edge"][0]["top_above_eye_m"] == 50


def test_mapped_trees_are_counted_when_visible():
    site = city(green={"polys": [], "trees": [120.0, 5.0, 130.0, -8.0, -120.0, 0.0]})
    s = sl.survey(site, (10.6, 0.0, 60.0), 90.0, 90.0)
    assert s["trees"]["in_fov"] == 2 and s["trees"]["visible"] == 2


def test_compare_facades_ranks_the_facade_that_looks_at_the_park():
    site = city(green={"polys": [park(150, -30, 200, 30)], "trees": []})
    rows = sl.compare_facades(site, 20)
    by = {r["bearing"]: r for r in rows}
    assert set(by) == {0.0, 90.0, 180.0, 270.0}
    best = max(rows, key=lambda r: r["frame_pct"])
    assert best["bearing"] == 90.0 and by[270.0]["frame_pct"] == 0.0
    assert "Test Park" in best["verdict"] and by[270.0]["verdict"].startswith("no mapped green in view")
    assert best["openness"]["mean_obstruction_deg"] >= 0


def test_sightline_block_marks_the_chosen_facade_and_stays_compact():
    site = city(green={"polys": [park(150, -30, 200, 30)], "trees": []})
    blk = sl.sightline_block(site, 20, chosen_bearing=88.0)
    assert blk["chosen"] == [f["bearing"] for f in blk["facades"]].index(90.0)
    assert blk["floor"] == 20 and "flat ground" in blk["model"]
    f90 = blk["facades"][blk["chosen"]]
    assert set(f90["green"][0]) <= {"poly", "kind", "name", "osm", "visible_m2", "in_fov_m2", "offset_deg", "dist_m",
                                    "below_horizon_deg"}
    assert len(f90["green"]) <= 5


def test_green_view_describes_the_chosen_window():
    site = city(green={"polys": [park(150, -30, 200, 30)], "trees": []})
    face = {"a": (10.0, -10.0), "b": (10.0, 10.0), "bearing": 90.0}
    gv = sl.green_view(site, face, 0.5, 20, 3.0)
    assert gv["bearing"] == 90.0 and gv["floor"] == 20 and gv["green"][0]["name"] == "Test Park"
    assert gv["eye"][2] == pytest.approx(58.6) and gv["fov_deg"] == 90.0


def test_angle_helpers():
    assert sl.angle_diff(350, 10) == -20 and sl.angle_diff(10, 350) == 20
    assert sl.bearing_to(0, 1) == 0 and sl.bearing_to(1, 0) == 90 and sl.bearing_to(0, -1) == 180
