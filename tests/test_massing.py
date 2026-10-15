"""Building massing for the 3D views: OpenStreetMap parts with roof shape, material and colour, the parts of the skyline's
tall landmarks beyond the near radius, spires, stable building ids and the height confidence."""
from __future__ import annotations

import pytest

from apartmentscout.geo import LocalFrame
from apartmentscout.geo.buildings import height_confidence, stable_id
from apartmentscout.geo.components import (TALL_PARTS_M, classify, derive_components, parse_osm_parts, parts_query,
                                           tall_centres)
from apartmentscout.geo.neighbours import neighbour_records

LAT, LON = 40.7484, -73.9857
F = LocalFrame(LAT, LON)


def _way(i, ring, **tags):
    pts = [F.to_lonlat(x, y) for x, y in ring + [ring[0]]]
    return {"type": "way", "id": i, "geometry": [{"lon": lo, "lat": la} for lo, la in pts],
            "tags": {"building:part": "yes", **tags}}


def _box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def test_roof_material_and_colour_tags_are_read_and_flat_roofs_stay_plain():
    els = [_way(1, _box(0, 0, 10, 10), height="443.2", min_height="330", **{"roof:shape": "pyramidal", "roof:height": "113.2"}),
           _way(2, _box(20, 0, 40, 20), height="75", min_height="17", **{"roof:shape": "flat", "building:material": "limestone",
                                                                          "building:colour": "beige"}),
           _way(3, _box(50, 0, 60, 10), height="40", **{"roof:shape": "skillion", "roof:height": "6", "roof:direction": "180",
                                                         "building:colour": "not-a-colour"}),
           _way(4, _box(70, 0, 80, 10), height="30", **{"roof:shape": "gabled"})]          # a gable with no roof height: unknown, kept flat
    p = {x["osm"]: x for x in parse_osm_parts(els)}
    assert p["way/1"]["roof"] == "pyramid" and p["way/1"]["eave_m"] == pytest.approx(330.0)   # height includes the roof
    assert "roof" not in p["way/2"] and p["way/2"]["mat"] == "stone" and p["way/2"]["col"] == "#d6c7a1"
    assert p["way/3"]["roof"] == "slope" and p["way/3"]["dir"] == 180 and "col" not in p["way/3"]
    assert "roof" not in p["way/4"]


def test_a_slim_raised_mast_is_a_spire_not_a_bulkhead_or_a_tower():
    parts = [{"ring": _box(0, 0, 60, 40), "base_m": 0, "top_m": 380},
             {"ring": _box(25, 15, 28, 18), "base_m": 330, "top_m": 443},          # the antenna
             {"ring": _box(5, 5, 10, 10), "base_m": 100, "top_m": 108}]             # a rooftop box
    assert classify(parts) == ["tower", "spire", "bulkhead"]


def test_an_antenna_above_the_roof_does_not_make_the_parts_disagree_with_the_footprint():
    lot = _box(0, 0, 60, 40)
    site = {"origin": {"lat": LAT, "lon": LON}, "b": [[380, 0, 0, [v for p in lot for v in p]]],
            "bmeta": [{"bin": "1", "height_src": "roof"}]}
    ways = [_way(1, lot, height="380"), _way(2, _box(25, 15, 28, 18), height="520", min_height="380")]   # 520 > 380 + 20 %
    comps, info = derive_components(site, parse_osm_parts(ways))
    assert info["buildings"] == 1 and info["height_mismatch"] == 0
    assert [c["kind"] for c in comps["0"]] == ["tower", "spire"]


def test_tall_buildings_beyond_the_radius_get_their_parts_read():
    far = _box(900, 100, 960, 160)
    near = _box(0, 0, 40, 40)
    site = {"origin": {"lat": LAT, "lon": LON},
            "b": [[300, 0, 0, [v for p in far for v in p]], [TALL_PARTS_M + 80, 0, 0, [v for p in near for v in p]],
                  [60, 0, 0, [v for p in _box(1000, 0, 1040, 40) for v in p]]]}
    t = tall_centres(site, 600)
    assert len(t) == 1                                        # the near one is inside the radius, the 60 m one is not a landmark
    lat, lon, r = t[0]
    x, y = F.to_xy(lon, lat)
    assert (x, y) == pytest.approx((930, 130), abs=0.5) and r > 40
    q = parts_query(LAT, LON, 600, t)
    assert q.count('way["building:part"]') == 2 and 'relation["building:part"]["type"="multipolygon"]' in q
    assert q.rstrip().endswith("out geom;")                   # "out geom tags" drops the members of a relation (a base with a tower-shaped hole)
    assert "around:" in parts_query(LAT, LON, 600)


def test_height_confidence_follows_the_source_of_the_height():
    assert height_confidence({"height_src": "roof", "geom_src": "photogrammetric"}) == "high"
    assert height_confidence({"height_src": "roof", "geom_src": "manual"}) == "medium"
    assert height_confidence({"height_src": "osm-height"}) == "medium"
    for src in ("pluto-floors", "osm-levels", "default", None):
        assert height_confidence({"height_src": src}) == "low"
    assert height_confidence({"height_src": "roof", "geom_src": "photogrammetric", "fcode": "5100"}) == "low"   # under construction


def test_stable_ids_are_the_bin_else_the_osm_element():
    assert stable_id({"bin": "1087340"}, 5) == "1087340"
    assert stable_id({"bin": None, "id": "osmw42"}, 5) == "osmw42"
    assert stable_id({}, 5) == "b5"


def test_neighbour_rows_carry_the_id_class_confidence_and_part_count():
    lot = _box(0, 0, 20, 20)
    site = {"origin": {"lat": LAT, "lon": LON}, "target": None,
            "b": [[50, 0, 0, [v for p in _box(30, 0, 50, 20) for v in p]]],
            "bmeta": [{"id": "1015862", "bin": "1015862", "cls": "O4", "hconf": "high", "height_src": "roof"}],
            "components": {"0": [{"ring": [list(p) for p in lot], "base_m": 0, "top_m": 50, "kind": "tower", "source": "t"}]}}
    row = neighbour_records(site)[0]
    assert (row["id"], row["class"], row["height_conf"], row["parts"]) == ("1015862", "O4", "high", 1)


def test_a_failed_landmark_chunk_costs_only_that_chunk(monkeypatch):
    """The near blocks keep their parts when a request for far landmarks fails; the failure is reported, not raised."""
    from apartmentscout.geo import components as comp

    monkeypatch.undo()                                      # conftest stubs fetch_osm_parts for every test: this one tests the real one
    near_way = _way(1, _box(0, 0, 20, 20), height="30")
    far_way = _way(2, _box(900, 0, 920, 20), height="300")
    calls = []

    def fake(query, cache_dir=None, refresh=False):
        calls.append(query)
        if len(calls) == 1:
            return [near_way]
        if "40.75" in query:                               # the second chunk fails
            raise RuntimeError("Overpass unavailable: HTTP 500")
        return [far_way, near_way]                         # a duplicate element is kept once

    monkeypatch.setattr(comp, "overpass", fake)
    tall = [(40.74, -73.98, 60.0)] * comp.TALL_CHUNK + [(40.75, -73.98, 60.0)] * 3
    problems: list[str] = []
    parts = comp.fetch_osm_parts(LAT, LON, 600, None, False, tall=tall, problems=problems)
    assert sorted(p["osm"] for p in parts) == ["way/1", "way/2"]
    assert len(calls) == 3 and len(problems) == 1 and "HTTP 500" in problems[0]
    with pytest.raises(RuntimeError):                       # the near query itself still raises: the site builder reports it
        monkeypatch.setattr(comp, "overpass", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
        comp.fetch_osm_parts(LAT, LON, 600, None, False)


def test_a_roof_height_that_does_not_fit_the_floor_count_is_flagged_and_not_trusted():
    from apartmentscout.geo.buildings import floors_disagree
    assert floors_disagree({"height_src": "roof", "floors": 36, "height": 18.3})           # 0.5 m a floor: a podium's footprint
    assert floors_disagree({"height_src": "roof", "floors": 10, "height": 80.0})           # 8 m a floor
    assert not floors_disagree({"height_src": "roof", "floors": 52, "height": 160.3})      # 3.1 m a floor
    assert not floors_disagree({"height_src": "roof", "floors": 3, "height": 40.0})        # too few floors to say
    assert not floors_disagree({"height_src": "pluto-floors", "floors": 36, "height": 117.0})
    from apartmentscout.geo.buildings import build_site, parse_nyc_rows
    sq = [[(-10, -10), (10, -10), (10, 10), (-10, 10), (-10, -10)]]
    rows = [{"bin": "1000001", "mappluto_bbl": "1000010001", "height_roof": "60", "ground_elevation": "0",
             "the_geom": {"type": "Polygon", "coordinates": [[[F.to_lonlat(x, y)[0], F.to_lonlat(x, y)[1]] for x, y in sq[0]]]}}]
    bs = parse_nyc_rows(rows)
    bs[0]["floors"] = 36
    site = build_site({"lat": LAT, "lon": LON, "floor": 5}, bs, "test")
    assert site["bmeta"][0]["hconf"] == "low" and site["bmeta"][0]["hflag"] == "floors"
