"""Street, park and neighbourhood geometry for plain-language place filters (apartmentscout/geo/places.py), offline.

A small invented city on a street grid rotated 29 degrees, served through fake Overpass and Socrata responses.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
import yaml

from apartmentscout.geo import LocalFrame
from apartmentscout.geo import places as P

ROOT = Path(__file__).resolve().parents[1]
LAT0, LON0, NB = 40.75, -73.98, 29.0
FR = LocalFrame(LAT0, LON0)


def ll(e: float, n: float) -> tuple[float, float]:
    """Grid metres (east, north on a grid turned NB degrees east of true north) -> (lon, lat)."""
    a = math.radians(NB)
    x, y = e * math.cos(a) + n * math.sin(a), -e * math.sin(a) + n * math.cos(a)
    return FR.to_lonlat(x, y)


def geom(*pts: tuple[float, float]) -> list[dict]:
    return [{"lat": ll(*p)[1], "lon": ll(*p)[0]} for p in pts]


def way(name: str, *pts, **tags) -> dict:
    return {"type": "way", "id": abs(hash((name, pts))) % 10**9, "tags": {"name": name, "highway": "residential", **tags}, "geometry": geom(*pts)}


BBOX = (-74.05, 40.70, -73.90, 40.80)


# ------------------------------------------------------------------ names
def test_keys_agree_with_the_fixture_the_dashboard_is_tested_against():
    fx = json.loads((ROOT / "tests" / "fixtures" / "place_keys.json").read_text())
    for raw, key in fx["street"]:
        assert P.street_key(raw) == key, raw
    for raw, key in fx["area"]:
        assert P.area_key(raw) == key, raw


def test_line_encoding_round_trips_to_a_metre():
    pts = [ll(0, 0), ll(100, 40), ll(250, -30)]
    back = P.decode_line(P.encode_line(pts))
    for (a, b), (c, d) in zip(pts, back):
        assert abs(a - c) < 6e-6 and abs(b - d) < 6e-6
    assert P.encode_line([]) == []


# ------------------------------------------------------------------ geometry helpers
def test_simplify_keeps_corners_and_drops_wobble():
    line = [ll(0, 0), ll(500, 0.8), ll(1000, -0.5), ll(1000, 500)]   # a straight run, then a corner
    out = P.simplify(line, 3.0, FR)
    assert out[0] == line[0] and out[-1] == line[-1] and len(out) == 3


STRIP = [[0.0, -3.1], [25.0, 6.9], [50.0, 5.7], [75.0, -1.4], [100.0, 1.9], [125.0, 1.3], [150.0, 4.1], [175.0, 6.0], [200.0, -3.7], [225.0, -4.6],
         [250.0, 6.7], [275.0, 1.1], [300.0, 5.7], [325.0, -5.0], [325.0, -9.0], [300.0, 1.7], [275.0, -2.9], [250.0, 2.7], [225.0, -8.6],
         [200.0, -7.7], [175.0, 2.0], [150.0, 0.1], [125.0, -2.7], [100.0, -2.1], [75.0, -5.4], [50.0, 1.7], [25.0, 2.9], [0.0, -7.1], [0.0, -3.1]]


def test_a_simplified_ring_never_crosses_itself():
    ring = [FR.to_lonlat(x, y) for x, y in STRIP]   # a 4 m wide wobbly strip, itself a simple ring
    assert not P.self_intersects(ring, FR)
    assert P.self_intersects(P.simplify(P._dedupe(ring), 6.0, FR), FR), "plain Douglas-Peucker folds the strip over itself"
    out = P.simplify_ring(ring, 6.0, FR)
    assert not P.self_intersects(out, FR) and out[0] == out[-1] and 4 <= len(out) <= len(P._dedupe(ring))
    bow = [ll(0, 0), ll(100, 100), ll(100, 0), ll(0, 100), ll(0, 0)]
    assert P.self_intersects(bow, FR)
    assert not P.self_intersects([ll(0, 0), ll(100, 0), ll(100, 100), ll(0, 100), ll(0, 0)], FR)


def test_chain_lines_joins_ways_in_any_direction():
    a, b, c = [ll(0, 0), ll(100, 0)], [ll(200, 0), ll(100, 0)], [ll(200, 0), ll(300, 0)]
    chains = P.chain_lines([a, b, c])
    assert len(chains) == 1 and len(chains[0]) == 4
    assert {chains[0][0], chains[0][-1]} == {ll(0, 0), ll(300, 0)}
    assert len(P.chain_lines([a, [ll(0, 500), ll(100, 500)]])) == 2


def test_rings_from_the_pieces_of_a_multipolygon():
    sq = [ll(0, 0), ll(100, 0), ll(100, 100), ll(0, 100)]
    pieces = [sq[:3], [sq[2], sq[3], sq[0]]]
    rings = P.assemble_rings(pieces)
    assert len(rings) == 1 and rings[0][0] == rings[0][-1]
    assert abs(P.ring_area_m2(rings[0], FR) - 10000) < 50
    assert P.assemble_rings([sq[:3]]) == [], "an open piece is not a ring"


# ------------------------------------------------------------------ streets
def city_ways() -> list[dict]:
    return [
        # 3rd Avenue as two ways named two ways, one grid; plus the same name far away (another borough)
        way("3rd Avenue", (500, -3000), (500, 0)), way("Third Avenue", (500, 0), (500, 3000)),
        way("3rd Avenue", (9000, -3000), (9000, 3000)),
        # 5th Avenue, Avenue of the Americas (also called 6th Avenue), and Broadway, a diagonal
        way("5th Avenue", (-100, -3000), (-100, 3000)),
        way("Avenue of the Americas", (-400, -3000), (-400, 3000), alt_name="Sixth Avenue"),
        way("Malcolm X Boulevard", (-400, 3000), (-400, 5000)),
        way("Broadway", (-1000, -2000), (-250, -500), highway="primary"), way("Broadway", (-250, -500), (500, 1000), highway="primary"),
        # East and West 30th Street meet at 5th Avenue; a short lane that is not worth keeping; a numbered short street
        way("East 30th Street", (-100, 0), (1500, 0)), way("West 30th Street", (-1500, 0), (-100, 0)),
        way("Mews", (0, 100), (200, 100)), way("East 9th Street", (200, -900), (500, -900)),
    ]


def test_streets_are_chained_named_and_oriented():
    cfg = {"street_merge": [["6th Avenue", "Avenue of the Americas", "Malcolm X Boulevard"]]}
    out = P.build_streets(city_ways(), BBOX, NB, cfg, region=lambda p: p[0] < -73.95)
    by = {s["keys"][0]: s for s in out}
    assert set(by) == {"3rd avenue", "5th avenue", "6th avenue", "broadway", "30th street", "9th street"}, "short lane dropped, other-borough 3rd Ave masked, numbered streets kept"
    third = by["3rd avenue"]
    assert third["name"] == "3rd Avenue" and len(third["lines"]) == 1, "two ways, two spellings, one polyline"
    assert abs(third["axis"] - NB) < 0.6, third["axis"]
    assert abs(by["30th street"]["axis"] - (NB + 90)) < 0.6 and len(by["30th street"]["lines"]) == 1, "East and West 30th are one street"
    sixth = by["6th avenue"]
    assert {"avenue of the americas", "malcolm x boulevard", "sixth avenue"} <= set(sixth["keys"]) or {"avenue of the americas", "malcolm x boulevard"} <= set(sixth["keys"])
    assert abs(sixth["axis"] - NB) < 0.6
    pts = P.decode_line(sixth["lines"][0])
    assert abs(P.length_m(pts, FR) - 8000) < 100, "the two names are one line"
    assert abs(by["broadway"]["axis"] - (NB + math.degrees(math.atan2(1500, 3000)))) < 1, "a diagonal keeps its own axis, forward = towards the grid's north"


def test_an_alias_never_takes_a_streets_own_name():
    els = [way("Park Avenue", (0, -2000), (0, 2000), alt_name="4th Avenue"), way("4th Avenue", (300, -2000), (300, 2000))]
    out = {s["keys"][0]: s for s in P.build_streets(els, BBOX, NB, {})}
    assert out["4th avenue"]["keys"] == ["4th avenue"] and "4th avenue" not in out["park avenue"]["keys"]


# ------------------------------------------------------------------ parks and neighbourhoods
def sq(e0, n0, e1, n1):
    return [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)]


def park_elements() -> list[dict]:
    g = lambda ring: [{"lat": p[1], "lon": p[0]} for p in ring]  # noqa: E731
    return [
        {"type": "way", "id": 1, "tags": {"name": "Bryant Park", "leisure": "park"}, "geometry": g(sq(-50, 300, 150, 700))},   # 80,000 m2
        {"type": "way", "id": 2, "tags": {"name": "Tiny Triangle", "leisure": "park"}, "geometry": g(sq(0, 0, 30, 30))},
        {"type": "way", "id": 3, "tags": {"name": "Gramercy Park", "leisure": "park", "wikipedia": "en:Gramercy Park"}, "geometry": g(sq(0, 1000, 70, 1100))},   # 7,000 m2
        {"type": "way", "id": 4, "tags": {"name": "Hamilton Fish Playground", "leisure": "park"}, "geometry": g(sq(0, 2000, 300, 2300))},
        {"type": "relation", "id": 5, "tags": {"name": "Central Park", "leisure": "park"}, "members": [
            {"type": "way", "role": "outer", "geometry": g(sq(1000, 0, 2000, 500)[:3])},
            {"type": "way", "role": "outer", "geometry": g([sq(1000, 0, 2000, 500)[2], sq(1000, 0, 2000, 500)[3], sq(1000, 0, 2000, 500)[0]])},
            {"type": "way", "role": "inner", "geometry": g(sq(1400, 200, 1600, 300))}]},
    ]


def test_parks_keep_the_big_and_the_notable_and_skip_playgrounds():
    out = {a["name"]: a for a in P.build_parks(park_elements(), BBOX, {})}
    assert set(out) == {"Bryant Park", "Gramercy Park", "Central Park"}
    cp = out["Central Park"]
    assert cp["kind"] == "park" and cp["keys"] == ["central park"] and len(cp["polys"]) == 1 and len(cp["polys"][0]) == 2, "an outer ring and the reservoir hole"
    assert out["Bryant Park"]["id"] == "park-bryant-park"


NTA = [
    {"nta2020": "MN0603", "ntaname": "Murray Hill-Kips Bay", "the_geom": {"type": "MultiPolygon", "coordinates": [[[list(p) for p in sq(300, -200, 800, 400)]]]}},
    {"nta2020": "MN0801", "ntaname": "Upper East Side-Lenox Hill-Roosevelt Island", "the_geom": {"type": "MultiPolygon", "coordinates": [
        [[list(p) for p in sq(300, 1500, 800, 2000)]], [[list(p) for p in sq(900, 1600, 960, 1900)]]]}},
    {"nta2020": "MN0802", "ntaname": "Upper East Side-Carnegie Hill", "the_geom": {"type": "MultiPolygon", "coordinates": [[[list(p) for p in sq(300, 2000, 800, 2600)]]]}},
    {"nta2020": "MN0803", "ntaname": "Upper East Side-Yorkville", "the_geom": {"type": "MultiPolygon", "coordinates": [[[list(p) for p in sq(300, 2600, 800, 3000)]]]}},
    {"nta2020": "BK0101", "ntaname": "Greenpoint", "the_geom": {"type": "MultiPolygon", "coordinates": [[[list(p) for p in sq(40000, 40000, 41000, 41000)]]]}},
]
SPEC = {"socrata": "9nt8-h7nd", "id": "nta2020", "name": "ntaname", "geom": "the_geom",
        "split": [{"from": "Upper East Side-Lenox Hill-Roosevelt Island", "name": "Roosevelt Island", "rest_name": "Upper East Side-Lenox Hill",
                   "contains": list(ll(930, 1750))}]}


def test_neighbourhoods_are_split_named_grouped_and_aliased():
    cfg = {"neighbourhoods": SPEC, "aliases": {"UES": "Upper East Side", "kips": "Kips Bay", "nowhere": "Atlantis"},
           "groups": {"Midtown": ["Murray Hill-Kips Bay", "Upper East Side-Yorkville"]}}
    hoods = P.build_hoods(NTA, BBOX, SPEC, cfg)
    names = {h["name"] for h in hoods}
    assert names == {"Murray Hill-Kips Bay", "Upper East Side-Lenox Hill", "Roosevelt Island", "Upper East Side-Carnegie Hill", "Upper East Side-Yorkville"}, "Greenpoint is outside the box"
    ri = next(h for h in hoods if h["name"] == "Roosevelt Island")
    assert len(ri["polys"]) == 1 and ri["id"] == "mn0801-roosevelt-island"
    notes: list[str] = []
    groups = P.name_areas(hoods, cfg, log=notes.append)
    byk = {k: h for h in hoods for k in h["keys"]}
    assert byk["murray hill"] is byk["kips bay"] is byk["kips"] and byk["murray hill"]["name"] == "Murray Hill-Kips Bay"
    assert byk["carnegie hill"]["name"] == "Upper East Side-Carnegie Hill" and byk["roosevelt island"] is ri
    g = {k: gr for gr in groups for k in gr["keys"]}
    assert set(g["upper east side"]["members"]) == {"mn0801", "mn0802", "mn0803"}, "a part shared by three areas is their union (without the island)"
    assert "ues" in g["upper east side"]["keys"]
    assert "midtown" in g and len(g["midtown"]["members"]) == 2
    assert any("Atlantis" in n for n in notes), "an alias of nothing is reported, not invented"


def test_a_park_keeps_its_own_name_against_a_neighbourhood_part():
    areas = [{"id": "p", "name": "Union Square Park", "kind": "park", "keys": ["union square park"], "polys": []},
             {"id": "h", "name": "Midtown South-Flatiron-Union Square Park", "kind": "hood", "keys": [], "polys": []}]
    P.name_areas(areas, {})
    assert areas[0]["keys"] == ["union square park"]


# ------------------------------------------------------------------ the whole file
def fake_network(monkeypatch, els, parks, rows):
    def overpass(q, cache_dir=None, max_age_days=None, refresh=False):
        return parks if "leisure" in q else els

    monkeypatch.setattr(P, "overpass", overpass)
    monkeypatch.setattr(P, "socrata", lambda dataset, params, *a, **k: rows)


def test_build_places_end_to_end_is_small_and_complete(monkeypatch, tmp_path):
    fake_network(monkeypatch, city_ways(), park_elements(), NTA)
    profile = {"places": {"neighbourhoods": SPEC, "aliases": {"ues": "Upper East Side"}, "street_merge": [["6th Avenue", "Avenue of the Americas", "Malcolm X Boulevard"]]},
               "walk_grids": [{"name": "Test grid", "bearing_deg": NB, "polygon": [[-74.0, 40.70], [-73.9, 40.70], [-73.9, 40.80], [-74.0, 40.80]]}]}
    doc = P.build_places((-74.0, 40.72, -73.94, 40.78), profile, tmp_path, "test")
    assert doc["version"] == 1 and doc["city"] == "test" and doc["enc"] == "e5-delta"
    assert doc["grid"] == {"name": "Test grid", "north_bearing": NB}
    assert {s["keys"][0] for s in doc["streets"]} >= {"3rd avenue", "5th avenue", "30th street"}
    assert {a["kind"] for a in doc["areas"]} == {"park", "hood"} and doc["groups"]
    assert "OpenStreetMap" in doc["attribution"]
    out = tmp_path / "places.json"
    n = P.write_places(doc, out)
    assert n == out.stat().st_size and n < 60_000
    again = json.loads(out.read_text())
    assert again["streets"] == doc["streets"]


def test_build_places_without_a_neighbourhood_dataset(monkeypatch, tmp_path):
    fake_network(monkeypatch, city_ways(), park_elements(), [])
    doc = P.build_places(BBOX, {}, None, None)
    assert doc["grid"]["north_bearing"] == 0 and {a["kind"] for a in doc["areas"]} == {"park"} and doc["groups"] == []


def test_the_nyc_profile_builds_what_the_dashboard_expects():
    prof = yaml.safe_load((ROOT / "config" / "cities" / "nyc.yaml").read_text())
    cfg = prof["places"]
    assert cfg["neighbourhoods"]["socrata"] == "9nt8-h7nd" and cfg["aliases"]["ues"] == "Upper East Side"
    assert prof["walk_grids"][0]["bearing_deg"] == 29, "the street grid's north comes from the walking grid"
    region, north, name = P._region(prof)
    assert north == 29 and name == "Manhattan"
    assert region((-73.985, 40.755)) and not region((-73.95, 40.69)), "Midtown is inside the study area, Brooklyn is not"


def test_the_shipped_example_file_matches_the_format():
    doc = json.loads((ROOT / "examples" / "nyc-2026" / "places.json").read_text())
    assert doc["version"] == 1 and doc["enc"] == "e5-delta" and doc["grid"]["north_bearing"] == 29
    assert len(json.dumps(doc, separators=(",", ":"))) < 160 * 1024
    third = next(s for s in doc["streets"] if s["keys"][0] == "3rd avenue")
    pts = P.decode_line(third["lines"][0])
    assert 40.70 < pts[0][1] < 40.90 and -74.05 < pts[0][0] < -73.9
    assert abs(third["axis"] - 29) < 3
    for a in doc["areas"]:
        for poly in a["polys"]:
            for ring in poly:
                assert not P.self_intersects(P.decode_line(ring), FR), f"{a['name']} has a ring that crosses itself"
    assert (ROOT / "dashboard" / "data" / "places.json").read_text() == (ROOT / "examples" / "nyc-2026" / "places.json").read_text(), "dashboard/data carries the same file"


# ------------------------------------------------------------------ command and export
def test_places_command_and_build_export(monkeypatch, tmp_path, capsys):
    from apartmentscout.cli import main
    from apartmentscout.config import Workspace
    from apartmentscout.exports.places import export
    ws_dir = tmp_path / "s"
    ws_dir.mkdir()
    (ws_dir / "criteria.yaml").write_text(yaml.safe_dump({"search": {"name": "t", "city": "nyc"}, "commute": {"destinations": [{"name": "Work", "lat": 40.75, "lon": -73.98}]}}))
    (ws_dir / "listings.json").write_text(json.dumps([{"id": "a", "lat": 40.74, "lon": -73.99, "status": "new"}, {"id": "b", "lat": 40.77, "lon": -73.95, "status": "new"}]))
    fake_network(monkeypatch, city_ways(), park_elements(), NTA)
    main(["places", "--search", str(ws_dir)])
    assert "Wrote" in capsys.readouterr().out
    doc = json.loads((ws_dir / "places.json").read_text())
    assert doc["streets"] and doc["bbox"][0] < -73.99 and doc["bbox"][2] > -73.95
    out = tmp_path / "out"
    out.mkdir()
    assert export(Workspace(ws_dir), out) == ["places.json"] and (out / "places.json").exists()
    (ws_dir / "places.json").unlink()
    assert export(Workspace(ws_dir), out) == [] and not (out / "places.json").exists(), "no file, no stale copy"


def test_places_command_needs_coordinates(tmp_path):
    from apartmentscout.cli import main
    d = tmp_path / "s"
    d.mkdir()
    (d / "criteria.yaml").write_text(yaml.safe_dump({"search": {"name": "t", "city": "nyc"}, "commute": {"destinations": [{"name": "Work", "address": "x"}]}}))
    (d / "listings.json").write_text("[]")
    with pytest.raises(SystemExit, match="geocode"):
        main(["places", "--search", str(d)])
