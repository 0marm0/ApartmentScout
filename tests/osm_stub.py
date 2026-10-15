"""A made-up OpenStreetMap neighbourhood for tests of the site model outside New York: no Overpass, no network.

``osm_elements(lat, lon)`` returns Overpass-style ways around a point: the home's building (30 m, tagged with a house number),
a tall tower to the south-west, a six-storey block to the east, and two low buildings with no height tag at all (they get the
default height, which is what `apartmentscout surroundings` counts). ``stub_osm(monkeypatch)`` points the site builder at it.
"""
from __future__ import annotations

import math
from typing import Any


def _ring(lat: float, lon: float, north: float, east: float, h: float, w: float) -> list[dict[str, float]]:
    """A rectangle whose south-west corner is `north` m north and `east` m east of (lat, lon), `h` m tall in y and `w` m wide in x."""
    dlat, dlon = 1 / 111_320, 1 / (111_320 * math.cos(math.radians(lat)))
    pts = [(north, east), (north, east + w), (north + h, east + w), (north + h, east), (north, east)]
    return [{"lat": round(lat + n * dlat, 7), "lon": round(lon + e * dlon, 7)} for n, e in pts]


def osm_elements(lat: float, lon: float) -> list[dict[str, Any]]:
    way = lambda i, ring, tags: {"type": "way", "id": i, "geometry": ring, "tags": {"building": "yes", **tags}}   # noqa: E731
    return [
        way(1, _ring(lat, lon, -10, -12, 20, 24), {"name": "Home Court", "addr:housenumber": "100", "addr:street": "Rua Augusta", "height": "30"}),
        way(2, _ring(lat, lon, -80, -90, 30, 30), {"name": "South-west Tower", "height": "90", "building:levels": "28"}),
        way(3, _ring(lat, lon, -10, 40, 30, 25), {"building:levels": "6"}),
        way(4, _ring(lat, lon, 40, -30, 20, 20), {}),
        way(5, _ring(lat, lon, 70, 30, 25, 20), {}),
    ]


def stub_osm(monkeypatch) -> None:
    """Make `apartmentscout site` read osm_elements() instead of Overpass, and skip the street download."""
    from apartmentscout.geo import buildings, site, streets

    def fetch_osm(lat, lon, radius_m=600, *a, **k):
        return buildings.parse_osm_elements(osm_elements(lat, lon), lat, lon, radius_m)

    monkeypatch.setattr(site, "fetch_osm", fetch_osm)
    monkeypatch.setattr(streets, "fetch_streets", lambda *a, **k: ([], "test"))
