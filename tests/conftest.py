"""Shared test setup: no test reaches the network for OpenStreetMap building parts.

``make_site`` asks Overpass for ``building:part`` outlines by default; tests that build sites from stubbed
footprints get no parts (every building stays a single prism) unless they stub ``fetch_osm_parts`` themselves.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_osm_parts(monkeypatch):
    from apartmentscout.geo import components

    monkeypatch.setattr(components, "fetch_osm_parts", lambda *a, **k: [])
