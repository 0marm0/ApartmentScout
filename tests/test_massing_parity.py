"""Python / JavaScript parity for the building massing.

tests/fixtures/massing_parity.json pins what both languages must agree on: the skyline over a site whose buildings carry parts with a
spire, a pitched roof and appearance fields (the drawing fields must not change an obstruction), and the height-confidence and
stable-id rules. dashboard/js/sun.js and dashboard/js/city3d are checked against it by tests/js/city3d.test.mjs.

Regenerate after an intentional change:  .venv/bin/python tests/test_massing_parity.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # run directly from a worktree: use this checkout, not an installed one
from apartmentscout.geo.buildings import height_confidence, stable_id
from apartmentscout.sun import Skyline, at

FIXTURE = Path(__file__).parent / "fixtures" / "massing_parity.json"
LAT, LON = 40.7549, -73.984
PARITY_SITE = {
    "version": 2, "origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.2, "target": 2,
    "b": [[90, 0, 0, [-30, 40, 30, 40, 30, 100, -30, 100]],
          [45, 0, 0, [60, 40, 90, 40, 90, 70, 60, 70]],
          [60, 0, 1, [-10, -30, 10, -30, 10, -10, -10, -10]]],
    "bmeta": [{"bin": "1000001", "bbl": "1000010001", "cls": "O4", "year": 1931, "floors": 30, "height_src": "roof",
               "geom_src": "photogrammetric", "hconf": "high"},
              {"bin": "1000002", "cls": "D8", "year": 2004, "floors": 14, "height_src": "pluto-floors", "hconf": "low"},
              {"bin": "1000003", "height_src": "roof", "geom_src": "manual", "hconf": "medium"}],
    "components": {"0": [
        {"ring": [[-30, 40], [30, 40], [30, 100], [-30, 100]], "base_m": 0, "top_m": 15, "kind": "podium", "source": "t",
         "mat": "stone", "col": "#d6c7a1"},
        {"ring": [[-12, 55], [12, 55], [12, 85], [-12, 85]], "base_m": 15, "top_m": 62, "kind": "tower", "source": "t",
         "roof": "pyramid", "eave_m": 54},
        {"ring": [[-1.5, 69], [1.5, 69], [1.5, 72], [-1.5, 72]], "base_m": 62, "top_m": 90, "kind": "spire", "source": "t"}]},
}
PARITY_POINTS = [{"p": [0, -9.6, 14.4], "az": [0, 10, 350, 20, 340, 90, 180]}, {"p": [0, -9.6, 40.0], "az": [0, 5, 355, 90]}]
CONF_CASES = [{"height_src": "roof", "geom_src": "photogrammetric"}, {"height_src": "roof", "geom_src": "manual"}, {"height_src": "roof"},
              {"height_src": "osm-height"}, {"height_src": "osm-levels"}, {"height_src": "pluto-floors"}, {"height_src": "default"}, {},
              {"height_src": "roof", "geom_src": "photogrammetric", "fcode": "5100"}]
ID_CASES = [[{"bin": "1087340"}, 5], [{"bin": None, "id": "osmw42"}, 5], [{}, 5], [{"bin": "", "id": "osmr7"}, 0]]


def build_fixture() -> dict:
    sky = Skyline(PARITY_SITE)
    prof = []
    for c in PARITY_POINTS:
        p = sky.profile(*c["p"])
        prof.append({**c, "expected": [round(at(p, a), 4) for a in c["az"]]})
    return {"site": PARITY_SITE, "points": prof, "confidence": [{"in": c, "out": height_confidence(c)} for c in CONF_CASES],
            "ids": [{"in": [m, i], "out": stable_id(m, i)} for m, i in ID_CASES]}


def test_massing_parity_fixture_matches_python():
    fx = json.loads(FIXTURE.read_text())
    assert fx == json.loads(json.dumps(build_fixture())), "regenerate: .venv/bin/python tests/test_massing_parity.py"


def test_a_spire_is_a_solid_but_a_roof_shape_and_appearance_fields_change_no_obstruction():
    plain = json.loads(json.dumps(PARITY_SITE))
    for c in plain["components"]["0"]:
        for k in ("roof", "eave_m", "mat", "col"):
            c.pop(k, None)
    a = Skyline(PARITY_SITE).profile(0, -9.6, 14.4)
    b = Skyline(plain).profile(0, -9.6, 14.4)
    assert list(a) == list(b)
    nospire = json.loads(json.dumps(PARITY_SITE))
    nospire["components"]["0"] = nospire["components"]["0"][:2]
    c = Skyline(nospire).profile(0, -9.6, 14.4)
    assert max(a) >= max(c) - 1e-9                      # the mast is never lower than no mast


if __name__ == "__main__":
    FIXTURE.write_text(json.dumps(build_fixture(), indent=1) + "\n")
    print("wrote", FIXTURE)
