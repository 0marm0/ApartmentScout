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

import pytest

from apartmentscout.sun import (NB, Skyline, at, day_track, lit_minutes, sun_position, sun_position_ms,
                                target_faces, window_point)

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
    faces = [{k: f[k] for k in ("i", "bearing", "length", "shared") if k in f} for f in target_faces(SITE, min_len=8)]
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
        "faces": faces,
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
        mins, segs = lit_minutes(tr, sky.profile(*c["point"]), c["facing"])
        assert mins == c["minutes"] and [list(s) for s in segs] == c["segs"], c


def test_fixture_faces_and_window_point(fx):
    faces = target_faces(fx["site"])
    assert [{k: f[k] for k in ("i", "bearing", "length", "shared") if k in f} for f in faces] == fx["faces"]
    east = next(f for f in faces if round(f["bearing"]) == 90)
    assert east.get("shared") is True
    wp = fx["window_point"]
    f = next(f for f in faces if f["i"] == wp["face_i"])
    assert list(window_point(f, wp["t"], wp["floor"])) == pytest.approx(wp["expected"], abs=1e-4)


def test_fixture_is_current():
    """The checked-in fixture matches what the code produces now (regenerate if the math changed)."""
    assert json.loads(json.dumps(build_fixture())) == json.loads(FIXTURE.read_text())


if __name__ == "__main__":
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(build_fixture(), indent=1) + "\n")
    print(f"wrote {FIXTURE}")
