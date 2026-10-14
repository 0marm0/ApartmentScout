"""Python side of the Python/JS parity check for the sun and skyline math.

tests/fixtures/sun_parity.json holds sun positions, DST-correct local times, a small synthetic site
(with a light court and a party wall) and expected skyline angles and lit minutes. This test checks
apartmentscout/sun.py against it; a node test checks dashboard/js/sun.js against the same file.

Regenerate after an intentional change to the math:  .venv/bin/python tests/test_sun_parity.py
"""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from apartmentscout.sun import (NB, SUNSHINE, Skyline, at, daylight_factor_est, day_track, expected_sun, lit_minutes,
                                sky_view, sun_position, sun_position_ms, target_faces, window_point)

FIXTURE = Path(__file__).parent / "fixtures" / "sun_parity.json"
LAT, LON, TZ = 40.7549, -73.984, "America/New_York"

# 40 x 40 m block, 30 m tall, with a 20 x 20 m light court; a 100 m tower 30 m north of it;
# a 60 m target to the south sharing its east wall with a 25 m neighbour.
SITE = {
    "version": 2, "origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.2, "target": 2,
    "b": [
        [30, 0, 0, [-20, 40, 20, 40, 20, 80, -20, 80]],
        [100, 0, 0, [-10, 110, 10, 110, 10, 130, -10, 130]],
        [60, 0, 1, [-10, -30, 10, -30, 10, -10, -10, -10]],
        [25, 0, 0, [10, -30, 30, -30, 30, -10, 10, -10]],
    ],
    "holes": {"0": [[[-10, 50], [10, 50], [10, 70], [-10, 70]]]},
}
POINTS = [
    # [x, y, z, azimuths, analytic expectations {az: deg}]
    {"name": "court centre, ground", "p": [0, 60, 2], "az": [0, 45, 90, 180, 270],
     "analytic": {"0": math.degrees(math.atan(28 / 10)), "90": math.degrees(math.atan(28 / 10))}},
    {"name": "street south of block", "p": [0, 20, 10], "az": [0, 90, 180, 350],
     "analytic": {"0": math.degrees(math.atan(20 / 20))}},
    {"name": "above the block roof", "p": [0, 60, 40], "az": [0, 180],
     "analytic": {"0": math.degrees(math.atan(60 / 50)), "180": math.degrees(math.atan(20 / 70))}},
    {"name": "target north face, floor 5", "p": [0, -9.6, 14.4], "az": [0, 30, 330, 180],
     "analytic": {"0": math.degrees(math.atan(85.6 / 119.6))}},  # the tower beats the block
]
SUN_TIMES = ["2026-06-21T12:57:00", "2026-12-21T11:55:00", "2026-03-20T07:10:00", "2026-10-15T13:00:00",
             "2026-09-22T18:30:00", "2026-01-15T00:00:00"]
# (2026-03-08 02:xx does not exist in New York, so it is left out: libraries disagree on it)
ZONED = [("2026-03-08", 60), ("2026-03-08", 180), ("2026-11-01", 90), ("2026-07-04", 780), ("2026-12-31", 1439)]
LIT = [{"date": "2026-10-15", "point": [0, -9.6, 14.4], "facing": 0.0},
       {"date": "2026-06-21", "point": [0, -9.6, 14.4], "facing": 0.0},
       {"date": "2026-12-15", "point": [0, -30.4, 30.4], "facing": 180.0}]
# Bay windows: panes are bearing offsets from the facade normal; lit = sun above the skyline and in front
# of at least one pane (union). The flat south case shows a bay adds nothing when the flat pane already
# faces every December sun azimuth; the west case shows the target's own walls still hide the SE sun.
BAY = [{"date": "2026-06-21", "point": [0, -9.6, 14.4], "facing": 0.0, "panes": [-45, 0, 45]},
       {"date": "2026-12-15", "point": [-10.4, -20, 30.4], "facing": 270.0, "panes": [-45, 0, 45]},
       {"date": "2026-12-15", "point": [0, -30.4, 30.4], "facing": 180.0, "panes": [-45, 0, 45]}]
# Who shades the window: owner = index in site.b of the first wall along the sun ray that rises above it.
BLOCKERS = [{"point": [0, -9.6, 14.4], "az": 0.0, "alt": 10.0}, {"point": [0, -9.6, 14.4], "az": 0.0, "alt": 20.0},
            {"point": [0, -9.6, 14.4], "az": 0.0, "alt": 40.0}, {"point": [-10.4, -20, 30.4], "az": 90.0, "alt": 5.0}]


# Component buildings: a podium (the whole lot, 20 m) with a 20 x 20 m tower to 100 m set back 30 m from the
# street, south of a target whose window faces south. The footprint's single prism would be 100 m everywhere.
COMP_SITE = {
    "version": 2, "origin": {"lat": LAT, "lon": LON}, "floor_height_m": 3.2, "target": 1,
    "b": [
        [100, 0, 0, [-30, -70, 30, -70, 30, -10, -30, -10]],
        [60, 0, 1, [-10, 10, 10, 10, 10, 30, -10, 30]],
    ],
    "components": {"0": [
        {"ring": [[-30, -70], [30, -70], [30, -10], [-30, -10]], "base_m": 0, "top_m": 20, "kind": "podium",
         "source": "synthetic", "confidence": "high"},
        {"ring": [[-10, -60], [10, -60], [10, -40], [-10, -40]], "base_m": 20, "top_m": 100, "kind": "tower",
         "source": "synthetic", "confidence": "high"},
    ]},
}
COMP_POINT = [0, 9.6, 14.4]
COMP_AZ = [180, 150, 200, 135, 225]
COMP_LIT = [{"date": "2026-06-21", "point": COMP_POINT, "facing": 180.0},
            {"date": "2026-03-20", "point": [0, 9.6, 30.4], "facing": 180.0}]
COMP_BLOCKERS = [{"point": COMP_POINT, "az": 180.0, "alt": 10.0}, {"point": COMP_POINT, "az": 180.0, "alt": 30.0},
                 {"point": COMP_POINT, "az": 180.0, "alt": 65.0}]
# Diffuse sky: CIE overcast sky view (relative, 0-1) for a few windows, flat and bay.
SKY = [{"site": "site", "point": [0, -9.6, 14.4], "facing": 0.0, "panes": None},
       {"site": "site", "point": [0, -30.4, 30.4], "facing": 180.0, "panes": None},
       {"site": "site", "point": [-10.4, -20, 30.4], "facing": 270.0, "panes": [-45, 0, 45]},
       {"site": "comp", "point": COMP_POINT, "facing": 180.0, "panes": None},
       {"site": "prism", "point": COMP_POINT, "facing": 180.0, "panes": None}]
POSSIBLE = [3.1, 4.2, 5.0, 6.3, 7.0, 7.4, 7.2, 6.6, 5.6, 4.4, 3.3, 2.9]


def _prism(site: dict) -> dict:
    return {k: v for k, v in site.items() if k != "components"}


def _ms(date: str, minutes: int) -> int:
    y, m, d = map(int, date.split("-"))
    t = dt.datetime(y, m, d, minutes // 60, minutes % 60, tzinfo=ZoneInfo(TZ))
    return int(t.timestamp() * 1000)


def build_fixture() -> dict:
    sky = Skyline(SITE)
    pts = []
    for p in POINTS:
        prof = sky.profile(*p["p"])
        pts.append({**p, "expected": [round(at(prof, a), 4) for a in p["az"]]})
    full = sky.profile(*POINTS[0]["p"])
    lit = []
    for c in LIT:
        tr = day_track(dt.date.fromisoformat(c["date"]), LAT, LON, TZ)
        mins, segs = lit_minutes(tr, sky.profile(*c["point"]), c["facing"])
        lit.append({**c, "minutes": mins, "segs": [list(s) for s in segs], "samples": len(tr)})
    for c in BAY:  # bay cases ride in "lit" with their panes (dashboard/js/sun.js litInfo takes them there)
        tr = day_track(dt.date.fromisoformat(c["date"]), LAT, LON, TZ)
        prof = sky.profile(*c["point"])
        mins, segs = lit_minutes(tr, prof, c["facing"], panes=c["panes"])
        lit.append({**c, "minutes": mins, "segs": [list(x) for x in segs], "samples": len(tr),
                    "pane_minutes": [lit_minutes(tr, prof, (c["facing"] + o) % 360)[0] for o in c["panes"]],
                    "flat_minutes": lit_minutes(tr, prof, c["facing"])[0]})
    blockers = []
    for c in BLOCKERS:
        hit = sky.blocker(*c["point"], c["az"], c["alt"])
        blockers.append({**c, "owner": hit[0] if hit else None, "dist": round(hit[1], 3) if hit else None})
    faces = [{k: f[k] for k in ("i", "bearing", "length", "shared") if k in f} for f in target_faces(SITE, min_len=8)]
    csky, psky = Skyline(COMP_SITE), Skyline(_prism(COMP_SITE))
    comp_prof = csky.profile(*COMP_POINT)
    comp_lit = []
    for c in COMP_LIT:
        tr = day_track(dt.date.fromisoformat(c["date"]), LAT, LON, TZ)
        m1, s1 = lit_minutes(tr, csky.profile(*c["point"]), c["facing"])
        m0, _ = lit_minutes(tr, psky.profile(*c["point"]), c["facing"])
        comp_lit.append({**c, "minutes": m1, "segs": [list(x) for x in s1], "prism_minutes": m0})
    comp_blk = []
    for c in COMP_BLOCKERS:
        hit = csky.blocker(*c["point"], c["az"], c["alt"])
        comp_blk.append({**c, "owner": hit[0] if hit else None, "dist": round(hit[1], 3) if hit else None})
    skies = {"site": sky, "comp": csky, "prism": psky}
    sky_cases = []
    for c in SKY:
        sv = sky_view(skies[c["site"]].profile(*c["point"]), c["facing"], c["panes"])
        sky_cases.append({**c, "sky_view": round(sv, 6), "df": round(daylight_factor_est(sv), 6)})
    exp = expected_sun(POSSIBLE, SUNSHINE["nyc"]["fraction"])
    return {
        "_about": ("Shared fixture for apartmentscout/sun.py and dashboard/js/sun.js. Angles in degrees, azimuth "
                   "clockwise from north. JS zonedMs takes a 0-based month. Wall edges include hole rings "
                   "(site.holes); a light court is open air. Regenerate with `python tests/test_sun_parity.py`."),
        "lat": LAT, "lon": LON, "tz": TZ, "nb": NB, "step_min": 6,
        "sun": [dict(zip(("local", "ms", "az", "alt"), (s, _ms(s[:10], int(s[11:13]) * 60 + int(s[14:16])),
                                                         *[round(v, 4) for v in sun_position_ms(
                                                             _ms(s[:10], int(s[11:13]) * 60 + int(s[14:16])),
                                                             LAT, LON)])))
                for s in SUN_TIMES],
        "zoned": [{"date": d, "minutes": m, "ms": _ms(d, m)} for d, m in ZONED],
        "site": SITE,
        "points": pts,
        "profile_court_centre": [round(float(v), 3) for v in full],
        "lit": lit,
        "blockers": blockers,
        "faces": faces,
        "components_site": COMP_SITE,
        "components_profile": {"point": COMP_POINT, "az": COMP_AZ,
                               "expected": [round(at(comp_prof, a), 4) for a in COMP_AZ],
                               "prism": [round(at(psky.profile(*COMP_POINT), a), 4) for a in COMP_AZ]},
        "components_lit": comp_lit,
        "components_blockers": comp_blk,
        "sky": sky_cases,
        "sunshine": SUNSHINE["nyc"]["fraction"],
        "expected_sun": {"possible_hours": POSSIBLE, **exp},
        "window_point": {"face_i": faces[0]["i"], "t": 0.5, "floor": 5,
                         "expected": [round(v, 4) for v in window_point(
                             next(f for f in target_faces(SITE) if f["i"] == faces[0]["i"]), 0.5, 5)]},
    }


@pytest.fixture(scope="module")
def fx() -> dict:
    return json.loads(FIXTURE.read_text())


def test_fixture_sun_positions(fx):
    for s in fx["sun"]:
        az, alt = sun_position_ms(s["ms"], fx["lat"], fx["lon"])
        assert az == pytest.approx(s["az"], abs=1e-3) and alt == pytest.approx(s["alt"], abs=1e-3), s
        y, mo, d = map(int, s["local"][:10].split("-"))
        when = dt.datetime(y, mo, d, int(s["local"][11:13]), int(s["local"][14:16]), tzinfo=ZoneInfo(fx["tz"]))
        assert sun_position(when, fx["lat"], fx["lon"]) == pytest.approx((s["az"], s["alt"]), abs=1e-3)
    june = fx["sun"][0]
    assert 72 < june["alt"] < 74 and 170 < june["az"] < 190     # solstice noon in Manhattan
    assert fx["sun"][-1]["alt"] < 0                              # midnight


def test_fixture_zoned_times_handle_dst(fx):
    z = {(r["date"], r["minutes"]): r["ms"] for r in fx["zoned"]}
    # 01:00 EST -> 03:00 EDT on 2026-03-08 is one real hour; 01:30 on 2026-11-01 is the first (EDT) one
    assert z[("2026-03-08", 180)] - z[("2026-03-08", 60)] == 3600_000
    assert z[("2026-11-01", 90)] == int(dt.datetime(2026, 11, 1, 5, 30, tzinfo=dt.timezone.utc).timestamp() * 1000)
    for r in fx["zoned"]:
        assert _ms(r["date"], r["minutes"]) == r["ms"]


def test_fixture_skyline_profiles(fx):
    sky = Skyline(fx["site"])
    for p in fx["points"]:
        prof = sky.profile(*p["p"])
        got = [at(prof, a) for a in p["az"]]
        assert got == pytest.approx(p["expected"], abs=1e-3), p["name"]
        for a, want in p["analytic"].items():
            assert at(prof, float(a)) == pytest.approx(want, abs=0.05), (p["name"], a)
    full = sky.profile(*fx["points"][0]["p"])
    assert [round(float(v), 3) for v in full] == pytest.approx(fx["profile_court_centre"], abs=1e-3)


def test_fixture_court_is_open_air(fx):
    """Without the hole edges the court centre would see the far outer wall (20 m) instead of the
    court wall (10 m): the v1 behaviour this fixture guards against."""
    no_holes = {**fx["site"], "holes": {}}
    prof = Skyline(no_holes).profile(*fx["points"][0]["p"])
    east = fx["points"][0]["az"].index(90)
    assert at(prof, 90) == pytest.approx(math.degrees(math.atan(28 / 20)), abs=0.05)
    assert fx["points"][0]["expected"][east] > at(prof, 90) + 10


def test_fixture_lit_minutes(fx):
    sky = Skyline(fx["site"])
    for c in fx["lit"]:
        tr = day_track(dt.date.fromisoformat(c["date"]), fx["lat"], fx["lon"], fx["tz"])
        assert len(tr) == c["samples"]
        mins, segs = lit_minutes(tr, sky.profile(*c["point"]), c["facing"], panes=c.get("panes"))
        assert mins == c["minutes"] and [list(s) for s in segs] == c["segs"], c


def test_fixture_bay_windows(fx):
    """Union over panes: never less than any single pane, and more than the flat pane when a side pane
    sees sun the flat pane cannot (north face in June, west face in December)."""
    sky = Skyline(fx["site"])
    bay = [c for c in fx["lit"] if c.get("panes")]
    assert len(bay) == 3
    for c in bay:
        tr = day_track(dt.date.fromisoformat(c["date"]), fx["lat"], fx["lon"], fx["tz"])
        prof = sky.profile(*c["point"])
        mins, segs = lit_minutes(tr, prof, c["facing"], panes=c["panes"])
        assert mins == c["minutes"] and [list(x) for x in segs] == c["segs"], c
        assert mins >= max(c["pane_minutes"]) and mins >= c["flat_minutes"]
    north, west, south = bay
    assert north["minutes"] > north["flat_minutes"] and west["minutes"] > west["flat_minutes"]
    assert south["minutes"] == south["flat_minutes"]


def test_fixture_blockers(fx):
    sky = Skyline(fx["site"])
    for c in fx["blockers"]:
        hit = sky.blocker(*c["point"], c["az"], c["alt"])
        assert (hit[0] if hit else None) == c["owner"], c
        if hit:
            assert hit[1] == pytest.approx(c["dist"], abs=1e-3)
    low, high, clear, _ = fx["blockers"]
    assert low["owner"] == 0 and high["owner"] == 1 and clear["owner"] is None  # nearest wall above the ray wins


def test_fixture_faces_and_window_point(fx):
    faces = target_faces(fx["site"])
    assert [{k: f[k] for k in ("i", "bearing", "length", "shared") if k in f} for f in faces] == fx["faces"]
    east = next(f for f in faces if round(f["bearing"]) == 90)
    assert east.get("shared") is True
    wp = fx["window_point"]
    f = next(f for f in faces if f["i"] == wp["face_i"])
    assert list(window_point(f, wp["t"], wp["floor"])) == pytest.approx(wp["expected"], abs=1e-4)


def test_fixture_components(fx):
    """A podium + set-back tower casts less shade than its footprint pushed up to the tower roof."""
    site = fx["components_site"]
    sky, prism = Skyline(site), Skyline(_prism(site))
    c = fx["components_profile"]
    assert [at(sky.profile(*c["point"]), a) for a in c["az"]] == pytest.approx(c["expected"], abs=1e-3)
    south = c["az"].index(180)
    assert c["expected"][south] == pytest.approx(math.degrees(math.atan(85.6 / 49.6)), abs=0.05)  # the tower
    assert c["prism"][south] == pytest.approx(math.degrees(math.atan(85.6 / 19.6)), abs=0.05)     # the whole lot
    for lit in fx["components_lit"]:
        tr = day_track(dt.date.fromisoformat(lit["date"]), fx["lat"], fx["lon"], fx["tz"])
        mins, segs = lit_minutes(tr, sky.profile(*lit["point"]), lit["facing"])
        assert mins == lit["minutes"] and [list(x) for x in segs] == lit["segs"]
        assert lit_minutes(tr, prism.profile(*lit["point"]), lit["facing"])[0] == lit["prism_minutes"]
        assert lit["minutes"] > lit["prism_minutes"], lit
    low, mid, high = fx["components_blockers"]
    assert (low["owner"], low["dist"]) == (0, pytest.approx(19.6, abs=1e-3))   # the podium wall
    assert (mid["owner"], mid["dist"]) == (0, pytest.approx(49.6, abs=1e-3))   # the tower behind it
    assert high["owner"] is None                                              # over the tower
    for b in fx["components_blockers"]:
        hit = sky.blocker(*b["point"], b["az"], b["alt"])
        assert (hit[0] if hit else None) == b["owner"]


def test_fixture_sky_view(fx):
    skies = {"site": Skyline(fx["site"]), "comp": Skyline(fx["components_site"]),
             "prism": Skyline(_prism(fx["components_site"]))}
    for c in fx["sky"]:
        sv = sky_view(skies[c["site"]].profile(*c["point"]), c["facing"], c["panes"])
        assert sv == pytest.approx(c["sky_view"], abs=1e-6) and 0 <= sv <= 1
        assert daylight_factor_est(sv) == pytest.approx(c["df"], abs=1e-6)
    comp, prism = fx["sky"][3], fx["sky"][4]
    assert comp["sky_view"] > prism["sky_view"] + 0.05
    assert sky_view(np.zeros(NB), 123.0) == pytest.approx(1.0)
    assert daylight_factor_est(1.0) == pytest.approx(0.6 * 3.0 * 90 / (88.6 * 0.75))
    e = fx["expected_sun"]
    assert expected_sun(e["possible_hours"], fx["sunshine"]) == {k: e[k] for k in ("possible", "expected", "monthly")}
    assert e["expected"] < e["possible"]


def test_fixture_is_current():
    """The checked-in fixture matches what the code produces now (regenerate if the math changed)."""
    assert json.loads(json.dumps(build_fixture())) == json.loads(FIXTURE.read_text())


if __name__ == "__main__":
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(build_fixture(), indent=1) + "\n")
    print(f"wrote {FIXTURE}")
