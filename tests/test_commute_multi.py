"""Several commute destinations: each is routed, each listing gets minutes for every one, `--dest` routes just some, and
`build` combines the grids into worst-of and weighted surfaces. Synthetic feeds (see test_commute_modes.py); no network."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from apartmentscout.commute.combine import (combine_grids, combined_path, layer_path, sample_onto, unpack, write_combined)
from apartmentscout.commute.run import decode_minutes, encode_minutes, run_commute
from apartmentscout.config import Workspace

from test_commute_modes import DAY, DEST, HOME, feeds  # noqa: F401  (fixture)

DEST2 = (40.7092, -74.0)   # the middle station of the synthetic subway


def crit_for(feeds, weights=(1.0, 2.0)):  # noqa: F811
    return {"commute": {
        "destinations": [
            {"name": "Office", "lat": DEST[0], "lon": DEST[1], "arrive_by": "09:00", "max_minutes": 30, "weight": weights[0]},
            {"name": "Partner", "lat": DEST2[0], "lon": DEST2[1], "arrive_by": "09:00", "max_minutes": 20, "weight": weights[1]}],
        "transit": {"service_date": str(DAY), "land": False, "walk_model": "grid",
                    "feeds": [{"name": "Subway", "path": str(feeds[0][1]), "mode": "subway"},
                              {"name": "Bus", "path": str(feeds[1][1]), "mode": "bus", "exclude_routes": ["^BxM"]}]}}}


def listings():
    return [{"id": "a", "lat": HOME[0], "lon": HOME[1]}, {"id": "b", "lat": 40.7091, "lon": -74.0005}, {"id": "c", "lat": 40.7260, "lon": -73.9995}]


@pytest.fixture()
def routed(tmp_path, feeds):  # noqa: F811
    ws, Ls, crit = Workspace(tmp_path), listings(), crit_for(feeds)
    run_commute(ws, Ls, crit, cell_m=100, pad_m=600, log=lambda *_: None)
    return ws, Ls, crit


def test_every_destination_gets_a_layer_per_mode_and_every_listing_minutes_for_each(routed):
    ws, Ls, _ = routed
    names = sorted(p.name for p in ws.layers_dir.glob("commute-*.json"))
    assert names == ["commute-office-bus.json", "commute-office-subway.json", "commute-office.json",
                     "commute-partner-bus.json", "commute-partner-subway.json", "commute-partner.json"]
    for L in Ls:
        assert set(L["commute"]) == {"Office", "Partner"}
        for d in L["commute"].values():
            assert d["minutes"] > 0 and {"walk", "subway", "bus", "transit"} <= set(d["modes"])
    a = Ls[0]["commute"]
    assert a["Partner"]["minutes"] < a["Office"]["minutes"], "the second destination is nearer to the first listing"
    g = json.loads(layer_path(ws.layers_dir, "Partner", "transit").read_text())
    assert g["destination"]["name"] == "Partner" and g["rows"] and g["cols"]


def test_dest_routes_only_the_named_destination_and_keeps_the_rest(routed, feeds):  # noqa: F811
    ws, Ls, crit = routed
    office = layer_path(ws.layers_dir, "Office", "transit")
    before_layer, before_entry = office.read_bytes(), json.dumps(Ls[1]["commute"]["Office"], sort_keys=True)
    Ls[1]["commute"]["Partner"] = {"minutes": 999}   # something stale, to prove it is replaced
    crit["commute"]["destinations"][1]["lat"] = 40.7270   # the partner's office moves to where the first one is
    crit["commute"]["destinations"][1]["lon"] = -74.0
    run_commute(ws, Ls, crit, cell_m=100, pad_m=600, log=lambda *_: None, only_dests=["Partner"])
    assert office.read_bytes() == before_layer, "the other destination's grid is untouched"
    assert json.dumps(Ls[1]["commute"]["Office"], sort_keys=True) == before_entry
    assert Ls[1]["commute"]["Partner"]["minutes"] == pytest.approx(Ls[1]["commute"]["Office"]["minutes"], abs=0.6)
    assert Ls[1]["commute"]["Partner"]["minutes"] != 999


def test_dest_rejects_a_name_the_search_does_not_have(routed, tmp_path, feeds):  # noqa: F811
    ws, Ls, crit = routed
    with pytest.raises(ValueError, match="no such destination: Nobody.*Office, Partner"):
        run_commute(ws, Ls, crit, only_dests=["Nobody"], log=lambda *_: None)
    from apartmentscout.cli import main
    search = tmp_path / "s2"
    main(["init", str(search), "--city", "nyc"])
    (search / "listings.json").write_text(json.dumps([{"id": "a-1", "building": "A", "unit": "1", "lat": 40.75, "lon": -73.98}]))
    with pytest.raises(ValueError, match="no such destination: Nobody"):
        main(["commute", "--search", str(search), "--dest", "Nobody"])


# ------------------------------------------------------------------ combined surfaces
def test_worst_of_and_weighted_at_every_cell():
    a = np.array([[10.0, 20.0, -1.0], [30.0, 5.0, 8.0]])
    b = np.array([[40.0, 10.0, 12.0], [30.0, 15.0, -1.0]])
    worst, weighted = combine_grids([a, b], [1.0, 3.0])
    assert np.isnan(worst[0, 2]) and np.isnan(worst[1, 2]) and np.isnan(weighted[0, 2]), "blank for one destination is blank for both"
    assert worst[0, 0] == 40 and worst[0, 1] == 20 and worst[1, 0] == 30
    assert weighted[0, 0] == pytest.approx((10 + 3 * 40) / 4) and weighted[1, 1] == pytest.approx((5 + 3 * 15) / 4)


def test_a_grid_on_other_cells_is_sampled_onto_the_first():
    ref = {"bbox": [0.0, 0.0, 4.0, 4.0], "rows": 4, "cols": 4}
    src = {"bbox": [0.0, 0.0, 2.0, 2.0], "rows": 2, "cols": 2, "values_u8": encode_minutes(np.array([[10.0, 20.0], [30.0, 40.0]]))}
    got = sample_onto(src, ref)
    assert got.shape == (4, 4)
    assert got[0, 0] == 10 and got[0, 1] == 20 and got[1, 0] == 30 and got[1, 1] == 40, "the cells the two grids share keep their values"
    assert got[0, 2] == -1 and got[3, 3] == -1 and got[2, 0] == -1, "outside the source's extent: blank"
    same = {**src, "bbox": ref["bbox"], "rows": 2, "cols": 2}
    assert sample_onto(same, ref).shape == (4, 4)


def test_write_combined_makes_one_small_file_per_mode(routed):
    ws, _, crit = routed
    out = write_combined(ws.layers_dir, crit, log=lambda *_: None)
    assert sorted(p.name for p in out) == ["commute-combined-best.json", "commute-combined-bus.json", "commute-combined-subway.json"]
    doc = json.loads(combined_path(ws.layers_dir, "transit").read_text())
    assert doc["kind"] == "commute-combo" and doc["mode"] == "best"
    assert [d["name"] for d in doc["destinations"]] == ["Office", "Partner"] and [d["weight"] for d in doc["destinations"]] == [1.0, 2.0]
    assert doc["limit_worst"] == 20 and doc["limit_weighted"] == pytest.approx((1 * 30 + 2 * 20) / 3, abs=0.06)
    worst, weighted = unpack(doc["worst_z"], doc["rows"], doc["cols"]), unpack(doc["weighted_z"], doc["rows"], doc["cols"])
    one = np.array(decode_minutes(json.loads(layer_path(ws.layers_dir, "Office", "transit").read_text()))).reshape(doc["rows"], doc["cols"])
    two = np.array(decode_minutes(json.loads(layer_path(ws.layers_dir, "Partner", "transit").read_text()))).reshape(doc["rows"], doc["cols"])
    ok = (one >= 0) & (two >= 0)
    assert ok.any()
    np.testing.assert_allclose(worst[ok], np.maximum(one, two)[ok], atol=0.26)
    np.testing.assert_allclose(weighted[ok], ((one + 2 * two) / 3)[ok], atol=0.26)
    assert np.isnan(worst[~ok]).all() and np.isnan(weighted[~ok]).all()
    assert (worst[ok] >= weighted[ok] - 0.26).all(), "the worst is never better than the average"


def test_packing_keeps_the_half_minute_bytes_and_is_far_smaller_on_a_real_sized_grid():
    from apartmentscout.commute import combine
    yy, xx = np.mgrid[0:416, 0:227]
    field = np.where((xx + yy) % 97 == 0, np.nan, 8 + 0.04 * np.hypot(yy - 200, xx - 110) * 3)   # smooth, with some blank cells
    z = combine._pack(field)
    back = unpack(z, 416, 227)
    assert np.array_equal(np.isnan(back), np.isnan(field))
    np.testing.assert_allclose(back[~np.isnan(back)], field[~np.isnan(field)], atol=0.26)
    assert len(z) < 0.4 * len(encode_minutes(field)), (len(z), len(encode_minutes(field)))


def test_weights_follow_the_criteria_and_stale_files_go(routed):
    ws, _, crit = routed
    write_combined(ws.layers_dir, crit, log=lambda *_: None)
    crit["commute"]["destinations"][1]["weight"] = 0.5
    write_combined(ws.layers_dir, crit, log=lambda *_: None)
    assert json.loads(combined_path(ws.layers_dir, "transit").read_text())["destinations"][1]["weight"] == 0.5
    crit["commute"]["destinations"].pop()
    assert write_combined(ws.layers_dir, crit, log=lambda *_: None) == [] and not list(ws.layers_dir.glob("commute-combined-*"))
    crit["commute"]["destinations"] = [{"name": "A", "lat": 40.7, "lon": -74.0}]
    assert write_combined(ws.layers_dir, crit, log=lambda *_: None) == []


def test_a_mode_every_destination_lacks_is_skipped(routed):
    ws, _, crit = routed
    layer_path(ws.layers_dir, "Partner", "bus").unlink()
    names = {p.name for p in write_combined(ws.layers_dir, crit, log=lambda *_: None)}
    assert names == {"commute-combined-best.json", "commute-combined-subway.json"}


def test_all_zero_weights_make_no_surface(routed):
    ws, _, crit = routed
    for d in crit["commute"]["destinations"]:
        d["weight"] = 0
    assert write_combined(ws.layers_dir, crit, log=lambda *_: None) == []


def test_build_exports_the_combined_layers_after_the_per_destination_ones(routed, tmp_path):
    from apartmentscout.exports.commute_combined import export
    ws, _, crit = routed
    out = tmp_path / "out"
    (out / "layers").mkdir(parents=True)
    for p in ws.layers_dir.glob("commute-*.json"):
        (out / "layers" / p.name).write_bytes(p.read_bytes())
    ws.criteria_path.write_text(json.dumps({**crit, "search": {"name": "t"}}))
    import yaml
    ws.criteria_path.write_text(yaml.safe_dump({"search": {"name": "t"}, **crit}))
    names = export(ws, out)
    assert "layers/commute-combined-best.json" in names and (out / "layers" / "commute-combined-best.json").exists()
    assert export(ws, tmp_path / "empty") == [], "no layers folder, nothing to combine"
