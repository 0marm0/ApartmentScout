"""Shared test setup: no test reaches the network for OpenStreetMap building parts or green space.

``make_site`` asks Overpass for ``building:part`` outlines and for parks and trees by default; tests that build
sites from stubbed footprints get no parts (every building stays a single prism) and no green space unless they
stub ``fetch_osm_parts`` / ``fetch_green`` themselves.
"""
from __future__ import annotations

import pytest


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
