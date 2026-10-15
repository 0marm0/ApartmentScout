"""Rank history: one run per scoring pass, compact, deduplicated, bounded, and read back as the dashboard expects."""
import json

import yaml

from apartmentscout import rankhistory
from apartmentscout.cli import main
from apartmentscout.config import DEFAULT_WEIGHTS
from apartmentscout.score import DIMENSIONS, SCORE_CHANGES, score_all

CRIT = {"search": {"name": "Test", "move_in": {"earliest": "2026-10-15", "latest": "2026-11-01"}, "map_center": [40.75, -73.98]},
        "budget": {"tiers": [{"name": "Target", "max": 5000}], "hard_max": 5450}, "unit": {"min_beds": 1},
        "must_have": ["in_unit_wd"], "commute": {"destinations": []}, "weights": dict(DEFAULT_WEIGHTS),
        "scoring": {"as_of": "2026-10-15"}}


def L(id, gross=4800, sqft=700, **kw):
    base = {"id": id, "building": id.split("-")[0].title(), "unit": id.split("-")[-1], "address": f"{id} Main St", "status": "researching",
            "beds": 1, "sqft": sqft, "checked": "2026-10-14", "price": {"gross": gross, "fees_monthly": 100, "free_months": 0, "lease_months": 12},
            "amenities": {"in_unit_wd": True}}
    base.update(kw)
    return base


def scored(listings, crit=CRIT):
    score_all(listings, crit)
    return listings


def test_a_run_keeps_ranks_scores_parts_and_flags_by_listing():
    Ls = scored([L("a-1"), L("b-2", gross=5200), L("c-3", sqft=None)])
    doc = rankhistory._empty()
    run = rankhistory.make_run(doc, ((x["id"], x["score"]) for x in Ls), CRIT["weights"], "2026-10-15T09:30:12")
    assert doc["ids"] == ["a-1", "b-2", "c-3"] and run["at"] == "2026-10-15T09:30" and run["k"] == len(doc["dims"])
    ranked = {x["id"]: x["score"]["rank"] for x in Ls if x["score"].get("rank")}
    assert {doc["ids"][i]: r for i, r in enumerate(run["a"]) if r} == ranked and run["n"] == len(ranked)
    assert run["s"][0] == round(Ls[0]["score"]["overall"] * 10)
    # two hex digits per dimension, 'ff' for unknown
    k = run["k"]
    row = run["p"][:2 * k]
    for j, d in enumerate(doc["dims"]):
        v = Ls[0]["score"]["parts"].get(d)
        assert row[2 * j:2 * j + 2] == ("ff" if v is None else f"{round(v):02x}")
    assert "size_imputed" in [doc["vocab"][int(i)] for i in run["g"][2].split(".") if i] or Ls[2]["score"]["parts"]["space"] is None
    assert run["w"] == [CRIT["weights"].get(d, 0) for d in doc["dims"]]


def test_a_repeat_is_skipped_and_the_same_day_replaces(tmp_path):
    Ls = scored([L("a-1"), L("b-2", gross=5200)])
    assert rankhistory.record(tmp_path, Ls, CRIT, "2026-10-13T10:00")
    assert not rankhistory.record(tmp_path, Ls, CRIT, "2026-10-13T11:00")           # identical: nothing to add
    Ls2 = scored([L("a-1"), L("b-2", gross=4000)])
    assert rankhistory.record(tmp_path, Ls2, CRIT, "2026-10-13T12:00")               # same day, same version: replaces
    doc = rankhistory.load(tmp_path)
    assert [r["at"] for r in doc["runs"]] == ["2026-10-13T12:00"]
    assert rankhistory.record(tmp_path, scored([L("a-1"), L("b-2", gross=3000)]), CRIT, "2026-10-14T08:00")
    assert [r["at"][:10] for r in rankhistory.load(tmp_path)["runs"]] == ["2026-10-13", "2026-10-14"]


def test_new_listings_and_dimensions_pad_the_older_runs(tmp_path):
    rankhistory.record(tmp_path, scored([L("a-1")]), CRIT, "2026-10-13T10:00")
    rankhistory.record(tmp_path, scored([L("a-1"), L("z-9", gross=4700)]), CRIT, "2026-10-14T10:00")
    doc = rankhistory.load(tmp_path)
    old, new = doc["runs"]
    assert doc["ids"] == ["a-1", "z-9"] and len(old["a"]) == len(new["a"]) == 2 and old["a"][1] == 0 and old["s"][1] == -1
    assert len(old["p"]) == len(new["p"]) == 2 * 2 * doc["runs"][0]["k"] and old["p"][2 * old["k"]:] == "ff" * old["k"]


def test_a_run_per_version_is_kept_and_the_file_is_bounded(tmp_path):
    for day in range(1, 12):
        rankhistory.record(tmp_path, scored([L("a-1", gross=4000 + 100 * day), L("b-2", gross=5000 - 50 * day)]), CRIT, f"2026-10-{day:02d}T08:00")
    doc = rankhistory.load(tmp_path)
    assert len(doc["runs"]) == rankhistory.MAX_RUNS and doc["runs"][-1]["at"].startswith("2026-10-11")
    assert set(doc["versions"]) == {doc["runs"][0]["version"]} and doc["versions"][doc["runs"][0]["version"]] == SCORE_CHANGES[doc["runs"][0]["version"]]
    # a gate worth explaining is kept in the vocabulary; a stale-days gate is not
    assert not any(v.startswith("stale") for v in doc["vocab"])


def test_score_records_a_run_and_build_exports_it_only_with_two(tmp_path, monkeypatch):
    root = tmp_path / "s"
    root.mkdir()
    (root / "criteria.yaml").write_text(yaml.safe_dump(CRIT))
    (root / "listings.json").write_text(json.dumps([L("a-1"), L("b-2", gross=5200)]))
    monkeypatch.setenv("APARTMENTSCOUT_SEARCH", str(root))
    main(["score"])
    assert len(rankhistory.load(root)["runs"]) == 1
    from apartmentscout.config import Workspace
    from apartmentscout.exports import rankhistory as export
    out = tmp_path / "out"
    out.mkdir()
    assert export.export(Workspace(root), out) == [] and not (out / "ranks.json").exists()
    rankhistory.record(root, scored([L("a-1"), L("b-2", gross=3500)]), CRIT, "2099-01-01T00:00")
    assert export.export(Workspace(root), out) == ["ranks.json"]
    assert json.loads((out / "ranks.json").read_text())["v"] == rankhistory.VERSION


def test_every_dimension_has_a_column():
    doc = rankhistory._empty()
    assert doc["dims"] == list(DIMENSIONS)
