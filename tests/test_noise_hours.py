"""Noise complaints by hour and day (apartmentscout/noise_hours.py) on a handful of made-up 311 records, and the
Python-to-browser round trip of the layer file (dashboard/js/features/noise-hours-model.js)."""
from __future__ import annotations

import datetime as dt
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from apartmentscout import noise_hours as NH

ROOT = Path(__file__).resolve().parents[1]
BBOX = [-74.01, 40.73, -73.98, 40.76]


def rec(when: str, lat: float = 40.745, lon: float = -73.995, ct: str = "Noise - Residential", ds: str = "Loud Music/Party") -> dict:
    return {"created_date": when + ".000", "latitude": str(lat), "longitude": str(lon), "complaint_type": ct, "descriptor": ds}


# 2026-10-16 is a Friday, 2026-10-14 a Wednesday
def test_the_night_belongs_to_the_evening_before():
    assert NH.night_class(dt.datetime(2026, 10, 14, 23, 30)) == 0       # Wednesday night
    assert NH.night_class(dt.datetime(2026, 10, 16, 23, 30)) == 1       # Friday night
    assert NH.night_class(dt.datetime(2026, 10, 17, 1, 10)) == 1        # Saturday 1 am is still Friday night
    assert NH.night_class(dt.datetime(2026, 10, 18, 3, 0)) == 1         # Sunday 3 am: Saturday night
    assert NH.night_class(dt.datetime(2026, 10, 18, 5, 30)) == 0        # Sunday morning is not
    assert NH.night_class(dt.datetime(2026, 10, 19, 1, 0)) == 0         # Monday 1 am: Sunday night, a school night
    assert NH.night_class(dt.datetime(2026, 10, 16, 10, 0)) == 1        # Friday daytime shares the Fri-Sat class
    assert NH.parse_created("2026-10-17T01:10:05.000")[1:] == (1, 5, 1)  # hour 1, Saturday (5), class 1


@pytest.mark.parametrize("ct,ds,group", [
    ("Noise - Commercial", "Loud Music/Party", "bars"), ("Noise - Street/Sidewalk", "Loud Talking", "street"),
    ("Noise - Park", "Loud Music/Party", "street"), ("Noise - Residential", "Banging/Pounding", "home"),
    ("Noise - Vehicle", "Car/Truck Horn", "vehicle"), ("Noise - Helicopter", "Other", "vehicle"),
    ("Noise", "Noise: Construction Before/After Hours (NM1)", "build"), ("Noise", "Noise: Jack Hammering (NC2)", "build"),
    ("Noise", "Noise: Alarms (NR3)", "equip"), ("Noise", "Air Conditioner/Ventilation", "equip"),
    ("Noise", "Noise: Private Carting Noise (NQ1)", "vehicle"), (None, None, "equip"),
])
def test_sources_are_grouped_by_where_the_noise_comes_from(ct, ds, group):
    assert NH.GROUPS[NH.group_of(ct, ds)][0] == group


def test_day_counts_split_the_period_by_class():
    assert NH.count_days(dt.date(2026, 10, 12), dt.date(2026, 10, 18)) == [5, 2]       # a Monday to a Sunday
    assert sum(NH.count_days(dt.date(2025, 10, 18), dt.date(2026, 10, 14))) == 362


def _acc(rows):
    a = NH.Accum(NH.Grid(BBOX, 150))
    a.add(rows)
    return a


def test_counts_land_in_the_right_cell_hour_and_class():
    a = _acc([rec("2026-10-16T23:10:00"), rec("2026-10-17T00:40:00"), rec("2026-10-14T09:00:00"),
              rec("2026-10-17T00:45:00", ct="Noise - Commercial"),
              rec("2026-10-17T00:46:00", lat=45.0),                 # outside the layer: dropped
              {"created_date": "bad", "latitude": "40.745", "longitude": "-73.995"}])
    assert a.n == 4
    cell = a.grid.cell(40.745, -73.995)
    assert a.hours[1, 23, cell] == 1 and a.hours[1, 0, cell] == 2 and a.hours[0, 9, cell] == 1
    assert a.hours.sum() == 4
    # the coarse mix: Friday/Saturday late-night bucket (10 pm-2 am = 5), bars (0) and neighbours (2)
    g = a.grid
    r, c = divmod(cell, g.cols)
    mi = (r // NH.MIX_BLOCK) * a.mc + c // NH.MIX_BLOCK
    assert a.mix[1, 5, 2, mi] == 2 and a.mix[1, 5, 0, mi] == 1 and a.mix[0, 1, 2, mi] == 1 and a.mix[0, 2, 2, mi] == 0
    assert a.mix.sum() == 4
    assert a.first == dt.datetime(2026, 10, 14, 9, 0) and a.last == dt.datetime(2026, 10, 17, 0, 45)


def test_the_layer_file_round_trips_and_is_small():
    rng = np.random.default_rng(7)
    rows = []
    for _ in range(4000):
        d = dt.datetime(2026, 1, 1) + dt.timedelta(minutes=int(rng.integers(0, 60 * 24 * 280)))
        hot = rng.random() < 0.5                                       # half the complaints cluster at one spot, at night
        rows.append(rec(d.strftime("%Y-%m-%dT%H:%M:%S"), 40.745 if hot else float(rng.uniform(40.731, 40.759)),
                        -73.995 if hot else float(rng.uniform(-74.009, -73.981)), ct="Noise - Commercial" if hot else "Noise - Residential"))
    a = _acc(rows)
    doc = NH.layer_from(a, dt.date(2026, 1, 1), dt.date(2026, 10, 7), 9)
    assert doc["kind"] == "noise-hours" and doc["days"] == NH.count_days(dt.date(2026, 1, 1), dt.date(2026, 10, 7))
    hours, mix = NH.read_layer(json.loads(json.dumps(doc)))
    exact = a.hours.astype(float)
    big = exact > 20
    assert np.abs(hours - exact)[big].max() / exact[big].max() < 0.08           # log steps: a few per cent on big counts
    assert np.abs(hours - exact)[exact <= 3].max() <= 1                           # and the small counts are exact to one
    assert (hours > 0).sum() == (exact > 0).sum()                                 # nothing present vanishes, nothing appears
    assert abs(mix.sum() - a.mix.sum()) / a.mix.sum() < 0.03
    assert len(json.dumps(doc)) < 120_000


def test_week_profile_and_classes_for_a_building():
    rows = [rec("2026-10-16T23:10:00"), rec("2026-10-17T00:40:00", ct="Noise - Commercial"), rec("2026-10-14T09:00:00", ct="Noise", ds="Construction"),
            rec("2026-10-19T01:00:00")]
    w = NH.week_profile(rows, dt.date(2026, 10, 12), dt.date(2026, 10, 18))
    assert w["by_week"][4][23] == 1 and w["by_week"][5][0] == 1 and w["by_week"][2][9] == 1 and w["by_week"][0][1] == 1
    assert sum(map(sum, w["by_week"])) == 4 and w["week_days"] == [5, 2]
    grp = w["by_hour_group"]
    assert grp[0][0] == 1 and grp[4][9] == 1 and grp[2][23] == 1 and sum(map(sum, grp)) == 4
    cls = NH.classes_from_week(w["by_week"])
    assert cls[1][23] == 1 and cls[1][0] == 1 and cls[0][9] == 1 and cls[0][1] == 1          # Mon 1 am is Sunday night


def test_peak_window_finds_the_loud_hours_per_night():
    fri = [0] * 24
    for h in (23, 0, 1):
        fri[h] = 40
    flat = [10] * 24
    pk = NH.peak_window([flat, fri], [260, 104])
    assert pk["cls"] == 1 and pk["start"] == 23 and pk["count"] == 120 and pk["share"] == 1.0
    assert pk["ratio"] > 3
    assert NH.peak_window([[0] * 24, [0] * 24], [5, 2]) is None
    flat_pk = NH.peak_window([flat, flat], [260, 104])
    assert flat_pk["ratio"] < 1.5          # nothing stands out


def test_dossier_patch_adds_the_profile_and_leaves_the_rest(tmp_path, monkeypatch):
    import apartmentscout.geo.fetch as F
    asked = {}

    def fake(dataset, params, cache_dir=None, max_age_days=30, refresh=False, timeout=120):
        asked.update(params)
        return [rec("2026-10-16T23:10:00"), rec("2026-10-17T00:40:00")]

    monkeypatch.setattr(F, "socrata", fake)
    D = {"id": "x", "lat": 40.74, "lon": -73.99, "generated": "2026-10-13", "window_years": 3,
         "noise_311": {"radius_m": 150, "nearby_total": 2, "by_hour": [0] * 24, "keep": "me"}}
    assert NH.patch_dossier(D, tmp_path) is True
    nz = D["noise_311"]
    assert nz["keep"] == "me" and nz["by_week"][4][23] == 1 and nz["week_days"][0] + nz["week_days"][1] in (1095, 1096)
    assert "within_circle(location,40.74,-73.99,150)" in asked["$where"] and "2023-10-14" in asked["$where"] or "2023-10-13" in asked["$where"]
    assert NH.patch_dossier(D, tmp_path) is False                                   # already has it
    assert NH.patch_dossier({"noise_311": {"note": "no coordinates"}}, tmp_path) is False


# ---------------------------------------------------------------- the browser reads what Python wrote


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_dashboard_decodes_the_python_layer_identically(tmp_path):
    rng = np.random.default_rng(11)
    rows = []
    for _ in range(3000):
        d = dt.datetime(2026, 2, 1) + dt.timedelta(minutes=int(rng.integers(0, 60 * 24 * 200)))
        rows.append(rec(d.strftime("%Y-%m-%dT%H:%M:%S"), float(rng.uniform(40.735, 40.755)), float(rng.uniform(-74.005, -73.985)),
                        ct=["Noise - Commercial", "Noise - Residential", "Noise - Street/Sidewalk"][int(rng.integers(0, 3))]))
    doc = NH.layer_from(_acc(rows), dt.date(2026, 2, 1), dt.date(2026, 8, 20), 6)
    hours, mix = NH.read_layer(doc)
    p = tmp_path / "layer.json"
    p.write_text(json.dumps(doc))
    lat, lon = 40.745, -73.995
    script = f"""
      import fs from 'node:fs';
      import {{ decode, cellCounts, areaProfile }} from '{(ROOT / "dashboard/js/features/noise-hours-model.js").as_posix()}';
      const dec = await decode(JSON.parse(fs.readFileSync('{p.as_posix()}', 'utf8')));
      const all = cellCounts(dec, 'all', 'all'), h23 = cellCounts(dec, 23, 1), prof = areaProfile(dec, {lat}, {lon}, 1);
      console.log(JSON.stringify({{ total: Array.from(all).reduce((a, b) => a + b, 0), h23: Array.from(h23).reduce((a, b) => a + b, 0),
        hours: prof.hours, mix: prof.mix, cells: prof.cells }}));
    """
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert out["total"] == pytest.approx(hours.sum())
    assert out["h23"] == pytest.approx(hours[1, 23].sum())
    # the same 3 x 3 cells around the point, summed in numpy
    g = NH.Grid(doc["bbox"], doc["cell_m"], doc["rows"], doc["cols"])
    lo0, la0, lo1, la1 = doc["bbox"]
    r = int((lat - la0) / (la1 - la0) * doc["rows"])
    c = int((lon - lo0) / (lo1 - lo0) * doc["cols"])
    want = np.zeros((2, 24))
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            want += hours[:, :, (r + dr) * g.cols + (c + dc)]
    assert np.array(out["hours"]) == pytest.approx(want)
    mi = (r // NH.MIX_BLOCK) * doc["mix"]["cols"] + c // NH.MIX_BLOCK
    assert np.array(out["mix"]) == pytest.approx(mix[:, :, :, mi])
