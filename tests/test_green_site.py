"""make_site wiring for green space and the facade choice: the green block, the chosen window's green view, the
exposure basis and evidence, the sightline comparison, and window_face / window_t precedence. Offline."""
from __future__ import annotations

from apartmentscout.geo import LocalFrame, green as green_mod
from apartmentscout.geo import site as site_mod
from apartmentscout.geo.buildings import parse_nyc_rows

LAT, LON = 40.75, -73.99
F = LocalFrame(LAT, LON)
CFG = {"search": {"city": "nyc"}}


def ll(x: float, y: float) -> list[float]:
    lon, lat = F.to_lonlat(x, y)
    return [lon, lat]


def stepped_site(monkeypatch, green_block: dict | None = None):
    """One 197 m tower whose east side has a 3 m step: two east facades of different length."""
    ring = [ll(-15, -10), ll(15, -10), ll(15, -2), ll(18, -2), ll(18, 10), ll(-15, 10), ll(-15, -10)]
    row = {"bin": "1000101", "base_bbl": "1000010001", "mappluto_bbl": "1000010001", "height_roof": 600,
           "ground_elevation": "0", "construction_year": "1990",
           "the_geom": {"type": "MultiPolygon", "coordinates": [[ring]]}}
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: parse_nyc_rows([row]))
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {})
    if green_block is not None:
        monkeypatch.setattr(green_mod, "fetch_green", lambda *a, **k: green_block)


def block() -> dict:
    return {"source": green_mod.SOURCE, "fetched": "2026-10-14", "radius_m": 600,
            "polys": [{"kind": "park", "name": "Test Park", "osm": "way/1",
                       "ring": [[120, -40], [170, -40], [170, 20], [120, 20]]}],
            "trees": [], "counts": {"polys": 1, "trees": 0}, "note": "n"}


def build(L: dict, **kw):
    return site_mod.make_site(L, CFG, streets=False, future=False, year=2026, **kw)


def test_make_site_stores_green_the_chosen_view_and_the_basis(monkeypatch):
    stepped_site(monkeypatch, block())
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 20, "exposure": ["E"], "exposure_source": "photo-landmarks",
         "exposure_basis": "renter photos + park sightline", "exposure_evidence": "Tested four facades."}
    site, face, _ = build(L)
    assert site["green"]["polys"][0]["name"] == "Test Park"
    assert site["study"]["green_view"]["green"][0]["name"] == "Test Park"
    prov = site["provenance"]
    assert prov["basis"] == "renter photos + park sightline" and prov["evidence"] == "Tested four facades."
    assert prov["exposure"] == "photo-landmarks"
    blk = site["sightline"]
    assert blk["facades"][blk["chosen"]]["green"]                                   # the east facade sees the park
    plain, _, _ = build({**L, "exposure_basis": None})
    assert "sightline" not in plain and "basis" not in plain["provenance"]
    off, _, _ = build(L, green=False)
    assert "green" not in off and "green_view" not in off["study"]


def test_make_site_survives_an_unreachable_overpass(monkeypatch):
    stepped_site(monkeypatch)                                                       # conftest: fetch_green raises
    site, face, _ = build({"id": "x", "lat": LAT, "lon": LON, "floor": 20, "exposure": ["E"]})
    assert "green" not in site and face is not None and "green_view" not in site["study"]


def test_window_face_and_position_come_from_the_listing_unless_the_command_line_says_otherwise(monkeypatch):
    stepped_site(monkeypatch)
    base = {"id": "x", "lat": LAT, "lon": LON, "floor": 20, "exposure": ["E"]}
    plain, _, _ = build(base)
    east = [f for f in plain["faces"] if round(f["bearing"]) == 90]
    longer, shorter = max(east, key=lambda f: f["length"])["i"], min(east, key=lambda f: f["length"])["i"]
    assert len(east) == 2 and plain["window"]["face"] == longer                    # ties go to the longer stretch
    chosen, _, _ = build({**base, "window_face": shorter, "window_t": 0.25})
    assert chosen["window"]["face"] == shorter and chosen["window"]["t"] == 0.25
    by_bearing, _, _ = build({**base, "window_face": shorter, "window_t": 0.25}, bearing=0.0)
    assert round(by_bearing["window"]["bearing"]) == 0 and by_bearing["window"]["t"] != 0.25
    by_face, _, _ = build({**base, "window_face": shorter}, face_index=longer)
    assert by_face["window"]["face"] == longer
