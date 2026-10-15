"""The relative daylight model (apartmentscout/daylight.py): physics checks and the Python side of the Python/JS parity.

tests/fixtures/daylight_parity.json holds synthetic skylines, expected vertical sky components, sensor-point sky
components, a sensor grid and an annual summary. This file checks apartmentscout/daylight.py against it; a node test
(tests/js/daylight-parity.test.mjs) checks dashboard/js/features/daylight-core.js against the same file.

Regenerate after an intentional change to the math:  .venv/bin/python tests/test_daylight.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from apartmentscout import daylight as D
from apartmentscout.sun import SUNSHINE, Skyline, _Tracks, month_tracks, sky_view

FIXTURE = Path(__file__).parent / "fixtures" / "daylight_parity.json"
LAT, LON, TZ = 40.7549, -73.984, "America/New_York"
OPEN = np.zeros(720)


def _profiles() -> dict[str, list[float]]:
    az = np.arange(720) * 0.5
    return {
        "open": [0.0] * 720,
        "wall30": [30.0] * 720,
        "tower": [round(float(55 if 150 <= a <= 210 else 12), 3) for a in az],
        "ragged": [round(float(8 + 25 * math.sin(math.radians(a) * 2) ** 2), 3) for a in az],
    }


PROFILES = _profiles()
CLEAR_A = {"kind": "clear", "sun_az": 200.0, "sun_alt": 30.0}
CLEAR_B = {"kind": "clear", "sun_az": 120.0, "sun_alt": 12.0}
CLEAR_C = {"kind": "clear", "sun_az": 180.0, "sun_alt": 60.0}
VSC_CASES = [
    {"profile": "open", "facing": 180.0, "panes": None, "sky": None},
    {"profile": "tower", "facing": 180.0, "panes": None, "sky": None},
    {"profile": "tower", "facing": 170.0, "panes": [-45, 0, 45], "sky": None},
    {"profile": "tower", "facing": 180.0, "panes": None, "sky": CLEAR_A},
    {"profile": "ragged", "facing": 90.0, "panes": None, "sky": CLEAR_B},
    {"profile": "open", "facing": 0.0, "panes": None, "sky": CLEAR_C},
]
WIN_S = {"a": [1.0, 0.0], "b": [3.0, 0.0], "normal": [0.0, -1.0], "sill": 0.9, "head": 2.1}
WIN_E = {"a": [4.0, 1.0], "b": [4.0, 4.0], "normal": [1.0, 0.0], "sill": 0.5, "head": 2.2}
SENSORS = [[2.0, 1.5, 0.76], [0.5, 3.0, 0.76], [3.5, 0.3, 0.76], [2.0, 4.5, 0.76], [2.0, -0.5, 0.76]]
SENSOR_CASES = [
    {"win": WIN_S, "profile": "tower", "up_bearing": 0.0, "sky": None},
    {"win": WIN_S, "profile": "ragged", "up_bearing": 30.0, "sky": CLEAR_A},
    {"win": WIN_E, "profile": "tower", "up_bearing": 90.0, "sky": CLEAR_C},
]
ROOM = [[0.0, 0.0], [4.0, 0.0], [4.0, 5.0], [0.0, 5.0]]
GRID_CASES = [
    {"up_bearing": 0.0, "vt": 0.7, "glazed": 0.8, "blinds": "half", "surfaces": {"walls": 0.4}, "sky": None,
     "windows": [{**WIN_S, "profile": "tower"}, {**WIN_E, "profile": "ragged"}]},
    {"up_bearing": 30.0, "vt": 0.45, "glazed": 0.65, "blinds": "sheer", "surfaces": None, "sky": CLEAR_A,
     "windows": [{**WIN_S, "profile": "wall30"}]},
]
POSSIBLE = [2.1, 3.0, 4.2, 5.3, 6.1, 6.4, 6.2, 5.5, 4.4, 3.2, 2.2, 1.8]
ANNUAL = {"profile": "tower", "facing": 180.0, "panes": None, "year": 2026, "possible": POSSIBLE, "sky_view": 0.62}


def _prof(name: str) -> np.ndarray:
    return np.array(PROFILES[name], dtype=float)


def _grid(c: dict) -> dict:
    wins = [{**{k: tuple(v) if isinstance(v, list) else v for k, v in w.items() if k != "profile"},
             "profile": _prof(w["profile"])} for w in c["windows"]]
    return D.room_grid([tuple(p) for p in ROOM], 2.7, wins, c["up_bearing"], vt=c["vt"], glazed=c["glazed"],
                       blinds=c["blinds"], surfaces=c["surfaces"], sky=c["sky"])


def build_fixture() -> dict:
    fx: dict = {"model": D.MODEL_LABEL, "lat": LAT, "lon": LON, "tz": TZ, "profiles": PROFILES, "room": ROOM,
                "ceiling_m": 2.7,
                "presets": {"glazing": [list(p) for p in D.GLAZING_PRESETS], "frame": [list(p) for p in D.FRAME_PRESETS],
                            "blinds": D.BLINDS, "surfaces": {k: [list(p) for p in v] for k, v in D.SURFACE_PRESETS.items()},
                            "surface_default": D.SURFACE_DEFAULT},
                "constants": {"field_deg": D.FIELD_DEG, "clear_step": D.CLEAR_STEP, "sensor_height_m": D.SENSOR_HEIGHT_M,
                              "samples": [D.SAMPLES_U, D.SAMPLES_Z]}}
    fx["luminance"] = [{"alt": a, "az": z, "sun_alt": sa, "sun_az": sz, "clear": D.cie_clear(a, z, sa, sz),
                        "overcast": D.cie_overcast(a)}
                       for a, z, sa, sz in [(10, 100, 30, 200), (45, 200, 30, 200), (80, 10, 12, 120), (0, 90, 60, 180),
                                            (25, 270, 45, 90)]]
    fx["e_h"] = [{"sky": s, "value": D.horizontal_illuminance(s)} for s in (None, CLEAR_A, CLEAR_B, CLEAR_C)]
    fx["vsc"] = [{**c, "expected": D.vertical_sky_component(_prof(c["profile"]), c["facing"], c["panes"], c["sky"])}
                 for c in VSC_CASES]
    fx["sensor"] = [{**c, "points": SENSORS,
                     "expected": [D.sensor_sky_component(p, {**c["win"], "a": tuple(c["win"]["a"]), "b": tuple(c["win"]["b"]),
                                                              "normal": tuple(c["win"]["normal"])},
                                                         _prof(c["profile"]), c["up_bearing"], c["sky"]) for p in SENSORS]}
                    for c in SENSOR_CASES]
    grids = []
    for c in GRID_CASES:
        g = _grid(c)
        grids.append({**c, "expected": {k: g[k] for k in ("x0", "y0", "step", "nx", "ny", "values", "t", "rho", "reflected",
                                                           "sky_component_mean", "stats")}})
    fx["grid"] = grids
    a = ANNUAL
    prof = _prof(a["profile"])
    tracks = _Tracks(month_tracks(a["year"], LAT, LON, TZ))
    fx["annual"] = {**a, "monthly_direct": tracks.hours(prof, a["facing"], a["panes"]),
                    "expected": D.annual_daylight(prof, a["facing"], a["panes"], a["year"], LAT, LON, TZ, a["possible"],
                                                  a["sky_view"], SUNSHINE["nyc"]["fraction"]),
                    "fraction": SUNSHINE["nyc"]["fraction"]}
    return fx


@pytest.fixture(scope="module")
def fx() -> dict:
    return json.loads(FIXTURE.read_text())


def test_fixture_is_current(fx):
    assert json.loads(json.dumps(build_fixture())) == fx, "run: .venv/bin/python tests/test_daylight.py"


# ------------------------------------------------------------------------------------------------ physics
def test_open_window_under_overcast_sky_gets_the_textbook_share():
    assert D.vertical_sky_component(OPEN, 180) == pytest.approx(0.396, abs=0.001)   # the BRE / UK VSC maximum, 39.6 %


def test_vsc_agrees_with_the_existing_sky_view_ratio():
    for name in ("wall30", "tower", "ragged"):
        p = _prof(name)
        ratio = D.vertical_sky_component(p, 180) / D.vertical_sky_component(OPEN, 180)
        assert ratio == pytest.approx(sky_view(p, 180), abs=0.02), name   # field 90 vs 80 degrees is the only difference


def test_wall_rising_30_degrees_everywhere_leaves_about_half():
    assert D.vertical_sky_component(_prof("wall30"), 180) / D.vertical_sky_component(OPEN, 180) == pytest.approx(0.51, abs=0.01)


def test_overcast_vsc_falls_as_the_skyline_rises():
    vals = [D.vertical_sky_component(np.full(720, h), 180) for h in (0, 10, 25, 40, 60, 80)]
    assert vals == sorted(vals, reverse=True) and vals[-1] < 0.01


def test_clear_sky_favours_the_window_that_faces_the_sun():
    toward = D.vertical_sky_component(OPEN, 200, None, CLEAR_A)
    away = D.vertical_sky_component(OPEN, 20, None, CLEAR_A)
    assert toward > 2 * away > 0


def test_clear_sky_integral_converges_with_a_finer_grid():
    """Brute-force integral over 1 degree bins against the 3 degree bins the model uses."""
    sky, facing = CLEAR_A, 200.0
    az, alt = np.meshgrid(np.arange(360) + 0.5, np.arange(90) + 0.5, indexing="ij")
    L = D.cie_clear(alt, az, sky["sun_alt"], sky["sun_az"])
    d = np.abs((az - facing + 540) % 360 - 180)
    den = (L * np.sin(np.radians(alt)) * np.cos(np.radians(alt))).sum()
    num = (L * np.cos(np.radians(alt)) ** 2 * np.cos(np.radians(d)) * (d < 90)).sum()
    assert D.vertical_sky_component(OPEN, facing, None, sky) == pytest.approx(num / den, rel=0.03)


def test_clear_sky_is_brightest_towards_the_sun_and_dimmest_across_it():
    sun = (30.0, 200.0)
    near = D.cie_clear(30, 200, *sun)
    far = D.cie_clear(30, 20, *sun)
    assert near == pytest.approx(D.cie_clear(30, 200, *sun)) and near > 3 * far
    assert D.cie_clear(90, 0, *sun) > 0 and D.cie_clear(0, 90, *sun) > 0


def _patch_integral(p, win, prof, up_bearing, sky, step=1.0) -> float:
    """Independent check: loop over sky patches and intersect each ray with the window rectangle."""
    (ax, ay), (bx, by), (nx, ny) = win["a"], win["b"], win["normal"]
    length = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / length, (by - ay) / length
    total = 0.0
    for ka in range(int(360 / step)):
        az = (ka + 0.5) * step
        phi = math.radians(az - up_bearing)
        hx, hy = math.sin(phi), math.cos(phi)
        for ke in range(int(90 / step)):
            alt = (ke + 0.5) * step
            if alt <= float(D.at(prof, az)):
                continue
            ca, sa = math.cos(math.radians(alt)), math.sin(math.radians(alt))
            dx, dy, dz = hx * ca, hy * ca, sa
            dn = dx * nx + dy * ny
            if dn <= 0:
                continue
            t = ((ax - p[0]) * nx + (ay - p[1]) * ny) / dn
            if t <= 0:
                continue
            ix, iy, iz = p[0] + dx * t, p[1] + dy * t, p[2] + dz * t
            s = (ix - ax) * ux + (iy - ay) * uy
            if 0 <= s <= length and win["sill"] <= iz <= win["head"]:
                total += D.sky_luminance(alt, az, sky) * sa * ca * math.radians(step) ** 2
    return total / D.horizontal_illuminance(sky)


@pytest.mark.parametrize("sky, name, tol", [(None, "tower", 0.06), (CLEAR_A, "open", 0.06), (CLEAR_A, "tower", 0.2)])
def test_sensor_samples_agree_with_an_independent_sky_patch_integral(sky, name, tol):
    """A sharp occluder across the bright part of the clear sky is the hard case for a sampled window (wider tolerance)."""
    win = {**WIN_S, "a": tuple(WIN_S["a"]), "b": tuple(WIN_S["b"]), "normal": tuple(WIN_S["normal"])}
    prof = _prof(name)
    for p in ([2.0, 1.5, 0.76], [2.0, 3.0, 0.76], [1.0, 2.0, 0.76]):
        sampled = D.sensor_sky_component(p, win, prof, 0.0, sky, 16, 12)
        patches = _patch_integral(p, win, prof, 0.0, sky)
        assert sampled == pytest.approx(patches, rel=tol, abs=0.002), (p, sky, name)


def test_sensor_behind_the_glass_or_a_closed_off_window_gets_nothing():
    win = {**WIN_S, "a": tuple(WIN_S["a"]), "b": tuple(WIN_S["b"]), "normal": tuple(WIN_S["normal"])}
    assert D.sensor_sky_component([2.0, -0.5, 0.76], win, OPEN, 0.0) == 0.0     # outside, on the street side
    assert D.sensor_sky_component([2.0, 1.5, 0.76], win, np.full(720, 89.9), 0.0) == pytest.approx(0, abs=1e-3)


def test_daylight_falls_with_distance_from_the_window_and_scales_with_the_inputs():
    wins = [{"a": (1.0, 0.0), "b": (3.0, 0.0), "normal": (0.0, -1.0), "sill": 0.9, "head": 2.1, "profile": OPEN}]
    base = D.room_grid(ROOM, 2.7, wins, 0.0, vt=0.7, glazed=0.8)
    ys = {}
    for k, v in enumerate(base["values"]):
        if v is not None:
            ys.setdefault(k // base["nx"], []).append(v)
    rows = [max(ys[j]) for j in sorted(ys)]
    assert rows[0] > rows[len(rows) // 2] > rows[-1] > 0
    half = D.room_grid(ROOM, 2.7, wins, 0.0, vt=0.7, glazed=0.8, blinds="half")
    assert half["stats"]["mean"] == pytest.approx(base["stats"]["mean"] * 0.5, rel=1e-9)   # blinds scale the whole result
    dark = D.room_grid(ROOM, 2.7, wins, 0.0, vt=0.7, glazed=0.8, surfaces={"floor": 0.1, "walls": 0.1, "ceiling": 0.1})
    white = D.room_grid(ROOM, 2.7, wins, 0.0, vt=0.7, glazed=0.8, surfaces={"floor": 0.6, "walls": 0.85, "ceiling": 0.9})
    assert dark["reflected"] < base["reflected"] < white["reflected"]
    assert dark["sky_component_mean"] == pytest.approx(white["sky_component_mean"])    # reflectance only moves the reflected part
    blocked = D.room_grid(ROOM, 2.7, [{**wins[0], "profile": np.full(720, 60.0)}], 0.0, vt=0.7, glazed=0.8)
    assert blocked["stats"]["mean"] < base["stats"]["mean"] / 2


def test_mean_inter_reflected_component_matches_the_flux_transfer_formula():
    wins = [{"a": (1.0, 0.0), "b": (3.0, 0.0), "normal": (0.0, -1.0), "sill": 0.9, "head": 2.1, "profile": OPEN}]
    g = D.room_grid(ROOM, 2.7, wins, 0.0, vt=0.6, glazed=0.8, surfaces={"floor": 0.25, "walls": 0.55, "ceiling": 0.75})
    area_floor, area_wall = 20.0, 18.0 * 2.7
    rho = (area_floor * 0.25 + area_wall * 0.55 + area_floor * 0.75) / (2 * area_floor + area_wall)
    flux = 2.0 * 1.2 * D.vertical_sky_component(OPEN, 180)
    expected = 0.6 * 0.8 * flux * rho / ((2 * area_floor + area_wall) * (1 - rho)) * 100
    assert g["rho"] == pytest.approx(rho) and g["reflected"] == pytest.approx(expected)


def test_annual_summary_keeps_three_quantities_apart():
    prof = _prof("tower")
    a = D.annual_daylight(prof, 180.0, None, 2026, LAT, LON, TZ, POSSIBLE, 0.62, SUNSHINE["nyc"]["fraction"])
    assert set(a) == {"model", "direct_sun", "sky_visibility", "relative_daylight"}
    assert len(a["direct_sun"]["possible_h_per_day"]) == len(a["relative_daylight"]["clear_pct"]) == 12
    assert all(e < p for e, p in zip(a["direct_sun"]["expected_h_per_day"], a["direct_sun"]["possible_h_per_day"]))
    assert a["sky_visibility"]["share"] == 0.62 and "mixed_pct" not in a["relative_daylight"]
    assert len(set(a["relative_daylight"]["clear_pct"])) > 3            # the clear diffuse sky changes with the sun
    none = D.annual_daylight(prof, 180.0, None, 2026, LAT, LON, TZ, POSSIBLE, 0.62, None)
    assert none["direct_sun"]["expected_h_per_day"] is None


def test_input_presets_are_ordered_and_in_range():
    for rows in (D.GLAZING_PRESETS, D.FRAME_PRESETS):
        assert all(0 < v <= 1 for _, _, v in rows) and len({i for i, _, _ in rows}) == len(rows)
    for key, rows in D.SURFACE_PRESETS.items():
        assert all(0 < v < 1 for _, _, v in rows), key
    assert list(D.BLINDS) == ["open", "sheer", "half", "closed"] and sorted(D.BLINDS.values()) == [0.1, 0.5, 0.55, 1.0]


def test_site_study_carries_the_annual_summary():
    """geo/site.py writes the summary for a real study (checked on the module source, no network)."""
    src = (Path(__file__).parents[1] / "apartmentscout" / "geo" / "site.py").read_text()
    assert "annual_daylight" in src and "daylight_annual" in src


# ------------------------------------------------------------------------------------------------ parity with the fixture
def test_fixture_luminance_and_horizontal_illuminance(fx):
    for c in fx["luminance"]:
        assert D.cie_clear(c["alt"], c["az"], c["sun_alt"], c["sun_az"]) == pytest.approx(c["clear"], rel=1e-12)
        assert D.cie_overcast(c["alt"]) == pytest.approx(c["overcast"], rel=1e-12)
    for c in fx["e_h"]:
        assert D.horizontal_illuminance(c["sky"]) == pytest.approx(c["value"], rel=1e-12)


def test_fixture_vsc(fx):
    for c in fx["vsc"]:
        got = D.vertical_sky_component(np.array(fx["profiles"][c["profile"]]), c["facing"], c["panes"], c["sky"])
        assert got == pytest.approx(c["expected"], rel=1e-9), c


def test_fixture_sensor_components(fx):
    for c in fx["sensor"]:
        win = {**c["win"], "a": tuple(c["win"]["a"]), "b": tuple(c["win"]["b"]), "normal": tuple(c["win"]["normal"])}
        for p, want in zip(c["points"], c["expected"]):
            got = D.sensor_sky_component(p, win, np.array(fx["profiles"][c["profile"]]), c["up_bearing"], c["sky"])
            assert got == pytest.approx(want, rel=1e-9, abs=1e-12), (c["profile"], p)


def test_fixture_room_grid(fx):
    for c in fx["grid"]:
        got = _grid(c)
        for k in ("x0", "y0", "step", "nx", "ny", "t", "rho", "reflected", "sky_component_mean"):
            assert got[k] == pytest.approx(c["expected"][k], rel=1e-9), k
        assert [v is None for v in got["values"]] == [v is None for v in c["expected"]["values"]]
        assert [v for v in got["values"] if v is not None] == pytest.approx([v for v in c["expected"]["values"] if v is not None], rel=1e-9)
        assert got["stats"] == pytest.approx(c["expected"]["stats"], rel=1e-9)


def test_fixture_annual(fx):
    a = fx["annual"]
    prof = np.array(fx["profiles"][a["profile"]])
    got = D.annual_daylight(prof, a["facing"], a["panes"], a["year"], LAT, LON, TZ, a["possible"], a["sky_view"], a["fraction"])
    assert got == a["expected"]
    assert _Tracks(month_tracks(a["year"], LAT, LON, TZ)).hours(prof, a["facing"], a["panes"]) == a["monthly_direct"]


def test_skyline_class_still_available_for_the_site_study():
    assert Skyline  # the site study builds its window skyline with the same class the direct-sun model uses


if __name__ == "__main__":
    FIXTURE.parent.mkdir(exist_ok=True)
    FIXTURE.write_text(json.dumps(build_fixture(), indent=1) + "\n")
    print("wrote", FIXTURE)
