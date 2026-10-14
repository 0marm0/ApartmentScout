"""Unit aliases (declared, never guessed), 311 noise metrics and dossier receipts. No network."""
from __future__ import annotations

from apartmentscout.geo import fetch as fetch_mod
from apartmentscout.listings import alias_groups, merge_aliases, unit_label
from apartmentscout.records import nyc


def test_unit_label_spellings():
    assert {unit_label(u) for u in ("13C", "#13-C", "Apt 13c", "unit 13 C")} == {"13C"}


def test_declared_alias_merges_once_and_letters_alone_do_not():
    Ls = [{"id": "knox-13c", "building": "The Knox", "unit": "13C", "price": {"gross": 5000}, "unit_aliases": ["13CA"]},
          {"id": "knox-13ca", "building": "The Knox", "unit": "13CA", "price": {}, "sqft": 610},
          {"id": "knox-13ba", "building": "The Knox", "unit": "13BA"},
          {"id": "knox-13b", "building": "The Knox", "unit": "13B"}]
    assert alias_groups(Ls) == {"knox-13c": ["knox-13ca"]}
    out = merge_aliases(Ls)
    assert [L["id"] for L in out] == ["knox-13c", "knox-13ba", "knox-13b"]       # 13B/13BA stay separate
    assert out[0]["alias_ids"] == ["knox-13ca"] and out[0]["sqft"] == 610 and out[0]["price"] == {"gross": 5000}
    by_id = merge_aliases([{"id": "a", "unit": "1", "aliases": ["b"]}, {"id": "b", "unit": "2"}])
    assert [L["id"] for L in by_id] == ["a"] and Ls[0].get("alias_ids") is None  # input untouched


def _r(day, hour, typ="Noise - Residential", desc="Loud Music/Party", res="The Police Department responded and "
       "upon arrival those responsible for the condition were gone.", bbl="1008850071", street="EAST 34 STREET"):
    return {"unique_key": f"{day}{hour}", "created_date": f"2026-{day}T{hour:02d}:10:00.000", "complaint_type": typ,
            "descriptor": desc, "resolution_description": res, "bbl": bbl, "street_name": street,
            "incident_address": "49 EAST 34 STREET"}


def test_noise_metrics_dupes_dates_night_construction_frontage():
    dup = "This complaint is a duplicate of a previous request."
    rows = [_r("01-02", 23), _r("01-02", 23, res=dup), _r("01-02", 1, res=dup), _r("02-03", 14),
            _r("03-04", 9, typ="Noise", desc="Noise: Construction Before/After Hours (NM1)", res="",
               bbl="1008850001", street="MADISON AVENUE"),
            _r("03-05", 22, res=dup, bbl="1008850002", street="E 34 ST")]
    m = nyc.noise_metrics(rows, "1008850071", 3, 200, "49 East 34th Street, New York, NY")
    a, b = m["nearby"], m["at_building"]
    assert a["requests"] == 6 and a["explicit_duplicates"] == 3 and a["requests_ex_dupes"] == 3
    assert a["distinct_dates"] == 4 and a["night_share_22_07"] == round(4 / 6, 2)
    assert a["construction_share"] == round(1 / 6, 2)
    assert b["requests"] == 4 and b["requests_ex_dupes"] == 2 and b["distinct_dates"] == 2
    assert list(m["frontage"]) == ["EAST 34 STREET"] and m["frontage"]["EAST 34 STREET"]["requests"] == 5
    assert m["by_street"]["MADISON AVENUE"] == 1
    assert m["closure_classes"]["duplicate"] == 3 and m["closure_classes"]["gone-on-arrival"] == 2
    assert m["at_building_per_1000_units_yr"] == round(2 / 200 / 3 * 1000, 1)
    led = nyc.noise_ledger(rows)
    assert len(led) == 6 and led[0]["created_date"] >= led[-1]["created_date"] and "closure_class" in led[0]


def test_soql_leaves_receipts(monkeypatch):
    class R:
        status_code = 200
        url = "https://data.cityofnewyork.us/resource/erm2-nwe9.json?%24limit=2"
        content = b'[{"a":1},{"a":2}]'

        def json(self):
            return [{"a": 1}, {"a": 2}]

        def raise_for_status(self):
            pass
    monkeypatch.setattr(nyc.requests, "get", lambda *a, **k: R())
    monkeypatch.setattr(nyc, "rows_updated", lambda ds, cache_dir=None: "2026-10-01T00:00:00+00:00")
    nyc._UPDATED.clear()
    with fetch_mod.collect_receipts() as rc:
        assert len(nyc.soql("sr311", {"$where": "x"}, limit=2)) == 2
    (r,) = rc
    assert r["dataset"] == "erm2-nwe9" and r["limit_hit"] is True and r["rows"] == 2
    assert r["sha256"] == fetch_mod.sha256_bytes(R.content) and r["rows_updated"].startswith("2026-10-01")
