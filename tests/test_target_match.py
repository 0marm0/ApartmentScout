"""Which building is the listing's? Outside New York there is no BIN or tax lot: the target used to be the nearest footprint to the geocoded
point, which was the wrong building in Chicago (Aqua matched the Fairmont Hotel across the street, Presidential Towers matched 540 West
Madison). The listing's building name and street address are matched against OpenStreetMap ``name`` / ``addr:housenumber`` / ``addr:street``
within 250 m first; the method (name, address, bin, bbl, point, nearest) is recorded and shown in Unit 3D's evidence. Synthetic OSM, no network."""
from __future__ import annotations

import pytest
from osm_stub import _ring

from apartmentscout.geo.buildings import (address_matches, build_site, name_matches, parse_osm_elements, pick_target,
                                          split_address)

LAT, LON = 41.8869, -87.6195


def way(i: int, north: float, east: float, h: float, w: float, d: float, **tags):
    """An OSM building ``w`` m wide (east) and ``d`` m deep (north) with its south-west corner `north`, `east` m from the point."""
    ring = _ring(LAT, LON, north, east, d, w)
    return {"type": "way", "id": i, "geometry": ring, "tags": {"building": "yes", "height": str(h), **tags}}


def site_for(elements, listing):
    bs = parse_osm_elements(elements, LAT, LON, 600)
    s = build_site({"lat": LAT, "lon": LON, "id": "x", **listing}, bs, "test")
    return s, s["bmeta"][s["target"]] if s["target"] is not None else None


# Aqua (225 N Columbus Dr): the geocoded point lies in the street, 12 m from the Fairmont Hotel across it and 70 m from Aqua itself
AQUA = [
    way(1, -30, 5, 60, 40, 25, name="Fairmont Chicago Millennium Park", **{"addr:housenumber": "200", "addr:street": "North Columbus Drive"}),
    way(2, 60, 20, 250, 45, 35, name="Aqua", **{"addr:housenumber": "225", "addr:street": "North Columbus Drive"}),
    way(3, 5, -90, 40, 30, 30, name="Swissotel Chicago"),
]
AQUA_LISTING = {"building": "Aqua", "address": "225 N Columbus Dr, Chicago, IL 60601", "floor": 30}


def test_aqua_is_matched_by_name_not_to_the_fairmont_across_the_street():
    s, m = site_for(AQUA, AQUA_LISTING)
    assert m["name"] == "Aqua" and s["target_match"]["by"] == "name"
    # without the name it is still found by its house number and street
    s, m = site_for(AQUA, {"address": AQUA_LISTING["address"], "floor": 30})
    assert m["name"] == "Aqua" and s["target_match"]["by"] == "address"
    # the old behaviour is what happens with neither: the nearest footprint, the wrong building
    s, m = site_for(AQUA, {"floor": 5})
    assert m["name"] == "Fairmont Chicago Millennium Park" and s["target_match"]["by"] == "nearest"


# Presidential Towers: four towers share a name; 540 West Madison (its own name and number) is the nearest footprint to the point
PRESIDENTIAL = [
    way(10, -12, -22, 90, 18, 14, name="540 West Madison", **{"addr:housenumber": "540", "addr:street": "West Madison Street"}),
    way(11, 30, 10, 140, 40, 25, name="Presidential Towers", **{"addr:housenumber": "555", "addr:street": "West Madison Street"}),
    way(12, 90, 10, 140, 40, 25, name="Presidential Towers", **{"addr:housenumber": "575", "addr:street": "West Madison Street"}),
    way(13, 30, 90, 140, 40, 25, name="Presidential Towers", **{"addr:housenumber": "600", "addr:street": "West Madison Street"}),
    way(14, 90, 90, 140, 40, 25, name="Presidential Towers"),
]
PRESIDENTIAL_LISTING = {"building": "Presidential Towers", "address": "555 W Madison St, Chicago, IL", "floor": 20}


def test_presidential_towers_is_matched_by_name_and_the_tower_with_the_listings_number():
    s, m = site_for(PRESIDENTIAL, PRESIDENTIAL_LISTING)
    assert m["name"] == "Presidential Towers" and s["target_match"]["by"] == "name"
    assert m["address"] == "555 West Madison Street"                        # the four towers share a name: the number picks the right one
    # no street number on the listing: the tower nearest the point, still not 540 West Madison
    s, m = site_for(PRESIDENTIAL, {"building": "Presidential Towers", "floor": 20})
    assert m["name"] == "Presidential Towers" and s["target_match"]["by"] == "name"
    s, m = site_for(PRESIDENTIAL, {"floor": 5})
    assert m["name"] == "540 West Madison" and s["target_match"]["by"] == "nearest"


def test_a_name_or_address_far_from_the_point_is_not_trusted():
    far = [way(1, 400, 400, 80, 30, 30, name="Aqua", **{"addr:housenumber": "225", "addr:street": "North Columbus Drive"}),
           way(2, -5, -5, 30, 20, 20, name="Corner Shop")]
    s, m = site_for(far, AQUA_LISTING)
    assert m["name"] == "Corner Shop" and s["target_match"]["by"] in ("point", "nearest")


def test_the_city_identifiers_still_come_first():
    bs = parse_osm_elements(AQUA, LAT, LON, 600)
    from apartmentscout.geo.buildings import _local
    from apartmentscout.geo import LocalFrame
    F = LocalFrame(LAT, LON)
    rows = [(b, _local(F, b["ring"]), []) for b in bs]
    for r in rows:
        r[0]["bin"] = None
    rows[2][0]["bin"] = "1234567"
    i, how = pick_target(rows, {**AQUA_LISTING, "bin": "1234567"})
    assert (i, how) == (2, "bin")


@pytest.mark.parametrize("a,b,want", [
    ("Aqua", "Aqua", True), ("Aqua", "Aqua at Lakeshore East", True), ("The Aqua Tower", "Aqua", True), ("Presidential Towers", "Presidential Towers", True),
    ("Presidential Towers", "540 West Madison", False), ("Aqua", "Fairmont Chicago Millennium Park", False), ("The Tower", "Tower", False),
    ("Apartments", "Lake Apartments", False), ("", "Aqua", False), (None, None, False), ("Atlas", "Atlas Condominium", True),
])
def test_name_matching(a, b, want):
    assert name_matches(a, b) is want


@pytest.mark.parametrize("a,b,want", [
    ("225 N Columbus Dr, Chicago, IL", "225 North Columbus Drive", True), ("555 W Madison St", "555 West Madison Street", True),
    ("555 W Madison St", "575 West Madison Street", False), ("555 W Madison St", "555 West Jackson Boulevard", False), ("Chicago", "555 West Madison Street", False),
    ("225 Columbus", "225 North Columbus Drive", True),
])
def test_address_matching(a, b, want):
    assert address_matches(a, b) is want


def test_split_address():
    assert split_address("225 N Columbus Dr, Chicago, IL 60601") == ("225", "n columbus dr")
    assert split_address("Chicago") == (None, "chicago")


def test_the_target_note_and_the_origin_check_name_the_method():
    from apartmentscout.geo import site as site_mod
    import apartmentscout.geo.checks as checks
    bs = parse_osm_elements(AQUA, LAT, LON, 600)
    site = build_site({"lat": LAT, "lon": LON, "id": "x", **AQUA_LISTING}, bs, "test")
    site["provenance"] = {"target": site.pop("target_match")["by"]}
    c = {x["id"]: x for x in checks.site_checks(site)}
    assert site["provenance"]["target"] == "name"
    if c["origin"]["status"] == "warn":
        assert "matched by name" in c["origin"]["msg"]
    assert site_mod  # imported for the make_site note, exercised in tests/test_site_context.py
