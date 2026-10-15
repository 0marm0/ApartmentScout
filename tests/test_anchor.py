"""The shared model anchor: vertical calibration, open-air checks, the anchor record and assumed components.

tests/fixtures/model_anchor.json pins apartmentscout/geo/anchor.py and dashboard/js/unit/{anchor,calibration,parts}.js
to the same numbers (a node test reads the same file). Regenerate after an intentional change:

    .venv/bin/python tests/test_anchor.py
"""
from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import pytest

from apartmentscout.geo.anchor import (assume_components, open_air_at, podium_tower, slab_at, solid_at,
                                       validate_components, vertical_calibration, window_anchor, window_open_air)
from apartmentscout.geo import LocalFrame
from apartmentscout.sun import Skyline, _Tracks, month_tracks, sun_study, target_faces

FIXTURE = Path(__file__).parent / "fixtures" / "model_anchor.json"
LAT, LON, TZ = 40.7549, -73.984, "America/New_York"

# A 60 x 60 m lot (index 0) with a 100 m tower on it, a 60 m target (index 1) 20 m to its north whose south
# facade looks at the lot, and a 25 m neighbour (index 2) built against the target's east wall.
LOT = [(-30, -70), (30, -70), (30, -10), (-30, -10)]
SITE = {
    "version": 2, "origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.2, "target": 1,
    "b": [[100, 0, 0, [v for p in LOT for v in p]],
          [60, 0, 1, [-10, 10, 10, 10, 10, 30, -10, 30]],
          [25, 0, 0, [10, 10, 30, 10, 30, 30, 10, 30]]],
    "bmeta": [{"bin": "1", "height_src": "roof", "src": "nyc-footprints", "name": "Tower lot"},
              {"bin": "2", "height_src": "roof", "src": "nyc-footprints", "name": "Target"},
              {"bin": "3", "height_src": "roof", "src": "nyc-footprints"}],
}


def _site() -> dict:
    return copy.deepcopy(SITE)


def _south(site: dict) -> dict:
    return next(f for f in target_faces(site) if round(f["bearing"]) == 180)


def _assumed(site: dict) -> dict:
    """The lot as a 20 m podium under a tower held back 20 m from its north facade and 12 m at the sides."""
    return {"0": podium_tower(site, 0, 20, 20, 0, side_m=12)}


# --------------------------------------------------------------------------- vertical calibration

def test_estimate_and_measurement_stay_distinct():
    est = vertical_calibration(_site(), 10)
    assert est["state"] == "estimated" and est["measured"] is None
    assert est["estimated_slab_m"] == est["slab_m"] == pytest.approx(9 * 3.2)
    assert est["delta_m"] == 0 and est["eye_m"] == pytest.approx(est["slab_m"] + 1.6)
    meas = vertical_calibration(_site(), 10, slab_m=36.0)
    assert meas["state"] == "measured"
    assert meas["slab_m"] == 36.0 and meas["estimated_slab_m"] == pytest.approx(28.8)   # the estimate is kept
    assert meas["delta_m"] == pytest.approx(7.2) and meas["measured"]["kind"] == "slab"
    assert meas["floor_height_m"] == pytest.approx(36 / 9) and meas["estimated_floor_height_m"] == pytest.approx(3.2)


def test_eye_height_is_slab_plus_eye_level():
    c = vertical_calibration(_site(), 10, eye_m=37.6)
    assert c["slab_m"] == pytest.approx(36.0) and c["eye_m"] == pytest.approx(37.6) and c["measured"]["kind"] == "eye"


def test_spread_scale_vs_offset():
    scale = vertical_calibration(_site(), 10, slab_m=36.0, spread="scale")
    offset = vertical_calibration(_site(), 10, slab_m=36.0, spread="offset")
    assert slab_at(scale, 1) == 0 and slab_at(scale, 5) == pytest.approx(16.0) and slab_at(scale, 10) == pytest.approx(36.0)
    assert slab_at(offset, 1) == pytest.approx(7.2)
    assert slab_at(offset, 10) == pytest.approx(36.0) and slab_at(offset, 5) == pytest.approx(4 * 3.2 + 7.2)
    assert slab_at(vertical_calibration(_site(), 10), 4) == pytest.approx(9.6)


@pytest.mark.parametrize("bad", [-1, 701, float("nan")])
def test_calibration_rejects_impossible_heights(bad):
    with pytest.raises(ValueError):
        vertical_calibration(_site(), 10, slab_m=bad)


def test_measured_height_moves_the_sun_hours():
    """A taller slab sees over the 25 m neighbour that a floor-count estimate does not."""
    site = _site()
    face = _south(site)
    tracks = _Tracks(month_tracks(2026, LAT, LON, TZ))
    est = sun_study(site, face, 6, TZ, 2026, tracks=tracks)
    cal = vertical_calibration(site, 6, slab_m=30.0)
    site2 = dict(site, floor_height_m=cal["floor_height_m"])
    meas = sun_study(site2, face, 6, TZ, 2026, tracks=tracks)
    assert sum(meas["sun_hours"]) > sum(est["sun_hours"])


# --------------------------------------------------------------------------- open air

def test_solid_at_is_height_aware_with_components():
    site = _site()
    site["components"] = _assumed(site)
    assert solid_at(site, 0, -50, 10) == 0                    # inside the podium
    assert solid_at(site, 0, -50, 60) == 0                    # inside the tower
    assert solid_at(site, 25, -65, 10) == 0                   # podium corner, below its roof
    assert solid_at(site, 25, -65, 40) is None                # above the podium roof beside the tower: open air
    assert solid_at(site, 0, -50, 120) is None                # over the roof
    assert solid_at(site, 0, 20, 10, skip=1) is None          # the target itself is skipped on request


def test_light_court_is_open_air():
    site = _site()
    site["holes"] = {"0": [[[-10, -50], [10, -50], [10, -30], [-10, -30]]]}
    assert solid_at(site, 0, -40, 10) is None and solid_at(site, 20, -40, 10) == 0


def test_window_pushed_through_its_own_host_is_not_open_air():
    site = _site()
    face = _south(site)
    ok = window_open_air(site, face, 0.5, 10, 12)
    assert ok == {"ok": True, "reason": None, "building": None}
    inward = window_open_air(site, face, 0.5, 10, 12, bearing=0)         # looking into the building
    assert inward["ok"] is False and inward["reason"] == "host" and inward["building"] == 1


def test_window_against_a_neighbour_is_blocked_only_up_to_its_roof():
    site = _site()
    east = next(f for f in target_faces(site, party_walls=False) if round(f["bearing"]) == 90)
    low = window_open_air(site, east, 0.5, 10, 12)
    assert low["ok"] is False and low["reason"] == "neighbour" and low["building"] == 2
    assert window_open_air(site, east, 0.5, 40, 42)["ok"] is True      # above the 25 m roof the wall is exposed
    assert open_air_at(site, 10.4, 20, 10)["other"] == 2


def test_window_through_a_setback_component_is_caught_by_height():
    site = _site()
    site["components"] = {"0": podium_tower(site, 0, 20, 10, 180)}      # the tower is held back 10 m from the south edge
    lot_south = {"i": 0, "a": (-30.0, -70.0), "b": (30.0, -70.0), "bearing": 180.0, "length": 60.0}
    site["target"] = 0
    inward = window_open_air(site, lot_south, 0.5, 8, 10, bearing=0)
    assert not inward["ok"] and inward["reason"] == "host"            # inside the podium
    assert window_open_air(site, lot_south, 0.5, 48, 50, bearing=0)["ok"]   # above it the tower is held back from the edge


# --------------------------------------------------------------------------- anchor record

def test_window_anchor_record():
    site = _site()
    face = _south(site)
    a = window_anchor(site, face, 0.5, 8, plan_up_bearing=178.0, panes=[-45, 0, 45])
    assert a["kind"] == "apartmentscout-model-anchor" and a["schema"] == 1
    assert a["host"]["index"] == 1 and a["host"]["model"] == "prism" and a["host"]["height_m"] == 60.0
    assert a["facade"]["bearing_deg"] == 180.0 and not a["facade"]["shared"]
    assert a["window"]["point_m"] == [0.0, 10.0] and a["window"]["floor"] == 8 and a["window"]["panes"] == [-45, 0, 45]
    assert a["north"]["rotation_deg"] == 180.0 and a["north"]["mismatch_deg"] == 2.0
    assert a["datum"]["state"] == "estimated" and a["datum"]["slab_m"] == pytest.approx(22.4)
    assert a["air"]["ok"] is True
    assert "datum" in a["assumed"] and "plan_north" not in a["assumed"]
    meas = window_anchor(site, face, 0.5, 8, cal=vertical_calibration(site, 8, slab_m=25.0))
    assert meas["datum"]["state"] == "measured" and "datum" not in meas["assumed"] and "plan_north" in meas["assumed"]


def test_site_checks_report_open_air_at_the_windows_height():
    from apartmentscout.geo.checks import site_checks
    site = _site()
    face = _south(site)
    site["window"] = {"face": face["i"], "bearing": face["bearing"], "floor": 8, "t": 0.5}
    ok = next(c for c in site_checks(site, face) if c["id"] == "open-air")
    assert ok["status"] == "pass"
    east = next(f for f in target_faces(site, party_walls=False) if round(f["bearing"]) == 90)
    site["window"] = {"face": east["i"], "bearing": east["bearing"], "floor": 3, "t": 0.5}
    low = next(c for c in site_checks(site, east) if c["id"] == "open-air")
    assert low["status"] == "fail" and "not in open air" in low["msg"]
    site["window"]["floor"] = 14                                                    # above the 25 m neighbour the wall is exposed
    assert next(c for c in site_checks(site, east) if c["id"] == "open-air")["status"] == "pass"


def test_anchor_flags_a_window_that_is_not_in_open_air():
    site = _site()
    face = _south(site)
    a = window_anchor(site, face, 0.5, 8, az=0.0)                          # facing into the building
    assert a["air"]["ok"] is False and a["air"]["reason"] == "host"


# --------------------------------------------------------------------------- component buildings

def test_validate_components_reports_every_problem_and_repairs_nothing():
    good = {"ring": [[0, 0], [10, 0], [10, 10]], "base_m": 0, "top_m": 20, "kind": "podium", "source": "zoning diagram"}
    clean, problems = validate_components({"0": [good, {**good, "source": ""}, {**good, "top_m": 0}, {**good, "ring": [[0, 0]]},
                                                 {**good, "top_m": 1e6}, "x"], "99": [good], "zz": [good], "1": []}, 3)
    assert len(clean["0"]) == 1 and clean["0"][0]["confidence"] == "assumed" and set(clean) == {"0"}
    assert len(problems) == 8
    assert any("source is required" in p for p in problems) and any("no such building" in p for p in problems)
    assert validate_components("nope")[1] and validate_components([good])[0] == {"target": clean["0"]}


def test_podium_tower_geometry():
    site = _site()
    pod, tow = podium_tower(site, 0, 20, 20, 0, side_m=12)
    assert pod["kind"] == "podium" and pod["base_m"] == 0 and pod["top_m"] == 20 and len(pod["ring"]) == 4
    assert tow["kind"] == "tower" and tow["base_m"] == 20 and tow["top_m"] == 100
    xs = [p[0] for p in tow["ring"]]
    ys = [p[1] for p in tow["ring"]]
    assert min(xs) == pytest.approx(-18) and max(xs) == pytest.approx(18)         # 12 m at each side
    assert max(ys) == pytest.approx(-30) and min(ys) == pytest.approx(-70)       # held back 20 m from the north edge
    assert pod["confidence"] == tow["confidence"] == "assumed" and pod["source"].startswith("assumed: ")
    with pytest.raises(ValueError):
        podium_tower(site, 0, 20, 60, 0)                                          # nothing left of the lot
    with pytest.raises(ValueError):
        podium_tower(site, 0, 200, 5, 0)                                          # podium above the roof


def test_assumed_podium_and_tower_differ_from_the_full_footprint_tower():
    site = _site()
    face = _south(site)
    tracks = _Tracks(month_tracks(2026, LAT, LON, TZ))
    full = sun_study(site, face, 5, TZ, 2026, tracks=tracks)
    assumed, problems = assume_components(site, _assumed(site))
    assert not problems and assumed["components_info"]["assumed"] == 1
    split = sun_study(assumed, face, 5, TZ, 2026, tracks=tracks)
    assert sum(split["sun_hours"]) > sum(full["sun_hours"]) + 5              # a slimmer tower casts less shade
    assert split["sky_view"] > full["sky_view"]
    assert "components" not in site                                         # the source site is untouched
    assert Skyline(assumed).profile(0, 5, 14.4)[360] < Skyline(site).profile(0, 5, 14.4)[360] - 5     # looking south


def test_assume_components_ignores_invalid_entries():
    site = _site()
    out, problems = assume_components(site, {"0": [{"ring": [[0, 0]], "top_m": 5, "source": "x"}]})
    assert problems and "components" not in out


# --------------------------------------------------------------------------- the site builder records the datum and the anchor

def _make(monkeypatch, **kw):
    from apartmentscout.geo import site as site_mod
    ll = LocalFrame(LAT, LON)
    rows = [{"bin": "1000001", "height": 100.0, "height_src": "roof", "ground": 0.0, "ring": [ll.to_lonlat(x, y) for x, y in LOT], "holes": [], "src": "nyc-footprints"},
            {"bin": "1000002", "height": 60.0, "height_src": "roof", "ground": 0.0,
             "ring": [ll.to_lonlat(x, y) for x, y in [(-10, 10), (10, 10), (10, 30), (-10, 30)]], "holes": [], "src": "nyc-footprints"}]
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: [dict(r) for r in rows])
    monkeypatch.setattr(site_mod, "nyc_pluto", lambda *a, **k: {})
    L = {"id": "x", "lat": LAT, "lon": LON, "floor": 10, "exposure": ["S"], "bin": "1000002"}
    return site_mod.make_site(L, {"search": {"city": "nyc"}}, streets=False, future=False, components=False, green=False, year=2026, **kw)[0]


def test_site_builder_writes_calibration_and_anchor(monkeypatch):
    est = _make(monkeypatch)
    assert est["calibration"]["state"] == "estimated" and est["calibration"]["measured"] is None
    assert est["anchor"]["datum"]["slab_m"] == est["calibration"]["slab_m"] == pytest.approx(9 * est["floor_height_m"], abs=0.02)
    meas = _make(monkeypatch, eye_height=37.6)
    cal = meas["calibration"]
    assert cal["state"] == "measured" and cal["measured"]["kind"] == "eye" and cal["slab_m"] == pytest.approx(36.0)
    assert cal["estimated_slab_m"] == pytest.approx(9 * est["floor_height_m"], abs=0.02)    # the floor-count estimate is kept
    assert meas["floor_height_m"] == pytest.approx(36 / 9, abs=0.01) and meas["slab_m"] == pytest.approx(36.0)
    assert meas["anchor"]["sources"]["datum"] == "measured" and "datum" not in meas["anchor"]["assumed"]
    assert meas["anchor"]["air"]["ok"] is True
    slab = _make(monkeypatch, slab_height=36.0)
    assert slab["calibration"]["measured"]["kind"] == "slab" and slab["study"]["sun_hours"] == meas["study"]["sun_hours"]


def test_components_file_may_be_json(tmp_path):
    site = _site()
    f = tmp_path / "x.components.json"
    f.write_text(json.dumps({"buildings": [{"select": {"b": 0}, "components": [
        {"kind": "podium", "ring": "footprint", "base_m": 0, "top_m": 20, "source": "zoning diagram", "confidence": "assumed"},
        {"kind": "tower", "ring": [[-10, -60], [10, -60], [10, -40], [-10, -40]], "base_m": 20, "top_m": 100, "source": "zoning diagram"}]}]}))
    from apartmentscout.geo.components import load_overrides
    out, problems = load_overrides(f, site)
    assert not problems and [c["kind"] for c in out["0"]] == ["podium", "tower"] and out["0"][0]["confidence"] == "assumed"
    from apartmentscout.cli import _components_file
    assert _components_file(tmp_path, "x") == f
    (tmp_path / "x.components.yaml").write_text("buildings: []\n")
    assert _components_file(tmp_path, "x").suffix == ".yaml"


# --------------------------------------------------------------------------- the fixture shared with the dashboard tests

def build_fixture() -> dict:
    site = _site()
    face = _south(site)
    assumed = _assumed(site)
    with_comps = dict(site, components=assumed)
    south_set = {"0": podium_tower(site, 0, 20, 10, 180)}
    cal_cases = []
    for floor, slab, eye, spread in [(10, None, None, "scale"), (10, 36.0, None, "scale"), (10, 36.0, None, "offset"),
                                     (10, None, 37.6, "scale")]:
        cal = vertical_calibration(site, floor, slab_m=slab, eye_m=eye, spread=spread)
        cal_cases.append({"floor": floor, "slab": slab, "eye": eye, "spread": spread, "cal": cal,
                          "slab_at": {str(f): round(slab_at(cal, f), 3) for f in (1, 2, 5, 10, 20)}})
    probes = [[0, -50, 10], [0, -50, 60], [25, -65, 10], [25, -65, 40], [0, -50, 120], [0, 20, 10], [10.4, 20, 10], [10.4, 20, 40]]
    lot_south = {"i": 0, "a": [-30.0, -70.0], "b": [30.0, -70.0], "bearing": 180.0, "length": 60.0}
    east = next(f for f in target_faces(site, party_walls=False) if round(f["bearing"]) == 90)
    tracks = _Tracks(month_tracks(2026, LAT, LON, TZ))
    sun = {}
    for name, s in (("full", site), ("assumed", assume_components(site, assumed)[0])):
        st = sun_study(s, face, 5, TZ, 2026, tracks=tracks)
        sun[name] = {"hours": st["sun_hours"], "sky_view": st["sky_view"], "ahead": st["skyline_ahead_deg"]}
    return {
        "note": "generated by tests/test_anchor.py; verified by tests/js/model-anchor.test.mjs",
        "site": site, "assumed_components": assumed, "calibration": cal_cases,
        "probes": {"points": probes, "full": [solid_at(site, *p) for p in probes],
                   "components": [solid_at(with_comps, *p) for p in probes]},
        "windows": [
            {"name": "south facade, estimate", "face": face["i"], "t": 0.5, "z": [10, 12], "bearing": None,
             "result": window_open_air(site, face, 0.5, 10, 12)},
            {"name": "south facade, pushed inward", "face": face["i"], "t": 0.5, "z": [10, 12], "bearing": 0,
             "result": window_open_air(site, face, 0.5, 10, 12, bearing=0)},
            {"name": "east wall under the neighbour roof", "face": east["i"], "t": 0.5, "z": [10, 12], "bearing": None,
             "result": window_open_air(site, east, 0.5, 10, 12)},
            {"name": "east wall above the neighbour roof", "face": east["i"], "t": 0.5, "z": [40, 42], "bearing": None,
             "result": window_open_air(site, east, 0.5, 40, 42)},
            {"name": "lot podium, pushed inward", "lot": lot_south, "components": south_set, "t": 0.5, "z": [8, 10], "bearing": 0,
             "result": window_open_air(dict(site, components=south_set, target=0), lot_south, 0.5, 8, 10, bearing=0)},
            {"name": "lot tower level, pushed inward", "lot": lot_south, "components": south_set, "t": 0.5, "z": [48, 50], "bearing": 0,
             "result": window_open_air(dict(site, components=south_set, target=0), lot_south, 0.5, 48, 50, bearing=0)},
        ],
        "podium_tower": {"podium_m": 20, "setback_m": 20, "out_deg": 0, "side_m": 12, "parts": assumed["0"]},
        "anchor": window_anchor(site, face, 0.5, 8, plan_up_bearing=178.0, panes=[-45, 0, 45]),
        "sun": sun,
    }


def test_fixture_is_current():
    """The checked-in fixture matches what the code produces now (regenerate if the geometry changed)."""
    assert json.loads(json.dumps(build_fixture())) == json.loads(FIXTURE.read_text())


if __name__ == "__main__":
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(build_fixture(), indent=1) + "\n")
    print(f"wrote {FIXTURE}")
