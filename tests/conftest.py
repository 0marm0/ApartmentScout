"""Shared test setup: no test reaches the network for OpenStreetMap building parts or green space.

``make_site`` asks Overpass for ``building:part`` outlines and for parks and trees by default; tests that build
sites from stubbed footprints get no parts (every building stays a single prism) and no green space unless they
stub ``fetch_osm_parts`` / ``fetch_green`` themselves.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_city_lookups(monkeypatch):
    """The city lookup (Nominatim) and the transit-feed check are network calls too (cities.py): tests pass fakes or get nothing."""
    from apartmentscout import cities

    def offline(*a, **k):
        raise cities.requests.ConnectionError("offline in tests")

    monkeypatch.setattr(cities, "_http_json", offline)

    from apartmentscout import intake

    # `init` and the interview ask this for their lookups; offline it finds nothing and keeps what was typed
    monkeypatch.setattr(intake, "live_online", lambda: intake.Online(
        resolve_city=lambda q: None, geocode=lambda a, i: None,
        check_feed=lambda u: cities.FeedCheck(True, "offline in tests", None, False)))


@pytest.fixture(autouse=True)
def _no_osm_parts(monkeypatch):
    from apartmentscout.geo import components

    monkeypatch.setattr(components, "fetch_osm_parts", lambda *a, **k: [])


@pytest.fixture(autouse=True)
def _no_osm_green(monkeypatch):
    from apartmentscout.geo import green

    def offline(*a, **k):
        raise RuntimeError("offline in tests")

    monkeypatch.setattr(green, "fetch_green", offline)


@pytest.fixture(autouse=True)
def _no_census_or_water(monkeypatch):
    """The street tree census and the water polygons are network downloads too (geo/trees.py, geo/water.py)."""
    from apartmentscout.geo import trees, water

    def offline(*a, **k):
        raise RuntimeError("offline in tests")

    monkeypatch.setattr(trees, "fetch_census", offline)
    monkeypatch.setattr(water, "fetch_water", offline)


@pytest.fixture(autouse=True)
def _no_parks_or_forestry(monkeypatch):
    """NYC Parks Properties, Greenstreets and the Forestry Tree Points are network downloads too (geo/parks.py, geo/forestry.py)."""
    from apartmentscout.geo import forestry, parks

    def offline(*a, **k):
        raise RuntimeError("offline in tests")

    monkeypatch.setattr(parks, "fetch_parks", offline)
    monkeypatch.setattr(forestry, "fetch_rows", offline)
