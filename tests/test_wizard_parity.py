"""The dashboard wizard (dashboard/js/wizard-model.js) and the Python side (config/intake.yaml, config.py, criteria_check)
describe one criteria.yaml schema. These tests run the wizard model in Node and compare."""
from __future__ import annotations

import datetime as dt
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

from apartmentscout.config import DIMENSION_LABELS, PRESETS, load_criteria_text
from apartmentscout.criteria_check import check_text
from apartmentscout.intake import load_intake, render_criteria
from apartmentscout.listings import AMENITY_KEYS

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


@pytest.fixture(scope="module")
def js() -> dict[str, Any]:
    out = subprocess.run(["node", "tests/js/emit-wizard-cases.mjs"], cwd=ROOT, capture_output=True, text=True, check=True, timeout=60)
    return json.loads(out.stdout)


def _dates(v: Any) -> Any:
    """What yaml.safe_load makes of ISO dates, applied to the JSON the wizard produced."""
    if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
        try:
            return dt.date.fromisoformat(v)
        except ValueError:
            return v
    if isinstance(v, dict):
        return {k: _dates(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_dates(x) for x in v]
    return v


def test_steps_and_fields_follow_the_questionnaire(js) -> None:
    intake = load_intake()["steps"]
    assert [s["id"] for s in js["steps"]] == [s["id"] for s in intake]
    for a, b in zip(js["steps"], intake):
        assert a["fields"] == [q["id"] for q in b["questions"]], a["id"]


def test_taste_table_matches_the_questionnaire(js) -> None:
    taste = next(s for s in load_intake()["steps"] if s["id"] == "taste")["questions"]
    levels = [q for q in taste if q["type"] == "level"]
    assert [(t["id"], t["dimension"], t["weights"]) for t in js["taste"]] == [(q["id"], q["dimension"], q["weights"]) for q in levels]


def test_amenity_list_matches_intake_and_the_scorer(js) -> None:
    keys = [a["key"] for a in js["amenities"]]
    assert keys == [a["key"] for a in load_intake()["amenities"]] == AMENITY_KEYS
    assert [a["label"] for a in js["amenities"]] == [a["label"] for a in load_intake()["amenities"]]


def test_fallback_dimensions_and_presets_are_consistent_with_config(js) -> None:
    keys = [k for k, _ in js["dims"]]
    assert set(keys) <= set(DIMENSION_LABELS), "the wizard may know fewer dimensions than the scorer, never more"
    for name, p in js["presets"].items():
        assert name in PRESETS
        for k in keys:
            assert p["weights"][k] == PRESETS[name]["weights"].get(k, 0), (name, k)


def test_nyc_profile_copy_matches_config_cities(js) -> None:
    nyc = next(c for c in js["cities"] if c["id"] == "nyc")
    prof = yaml.safe_load((ROOT / "config" / "cities" / "nyc.yaml").read_text())
    assert nyc["timezone"] == prof["timezone"]
    assert nyc["feeds"] == prof["transit_feeds"]
    assert {c["id"] for c in js["cities"]} == {"generic", *(p.stem for p in (ROOT / "config" / "cities").glob("*.yaml"))}


def test_defaults_match_the_questionnaire(js) -> None:
    d, steps = js["defaults"], {s["id"]: {q["id"]: q for q in s["questions"]} for s in load_intake()["steps"]}
    assert d["budget"]["tiers"] == steps["money"]["budget_tiers"]["default"]
    assert d["budget"]["hard_max"] == steps["money"]["hard_max"]["default"]
    assert d["budget"]["basis"] == steps["money"]["budget_basis"]["default"]
    assert [d["unit"][k] for k in ("min_beds", "sqft_floor", "sqft_good", "sqft_great")] == [steps["home"][k]["default"] for k in ("min_beds", "sqft_floor", "sqft_good", "sqft_great")]
    for k in ("must_have", "strongly_prefer", "nice_to_have"):
        assert d[k] == steps["amenities"][k]["default"]
    assert d["preset"] == steps["weights"]["preset"]["default"]
    dest = steps["places"]["destinations"]["item"]
    spec = {i["id"]: i.get("default") for i in dest}
    assert (d["dest"]["arrive_by"], d["dest"]["max_minutes"], d["dest"]["weight"], d["dest"]["mode"]) == (spec["arrive_by"], spec["max_minutes"], spec["weight"], spec["mode"])
    assert d["move_in"]["earliest"] == "2026-10-28" and d["move_in"]["latest"] == "2026-12-13"   # +14d and +60d from 2026-10-14


def test_every_wizard_file_passes_the_server_validation(js) -> None:
    for case in js["cases"]:
        rep = check_text(case["yaml"])
        assert rep.ok, (case["name"], rep.errors)


def test_the_yaml_means_what_the_model_says(js) -> None:
    """The text round-trips: parsing it gives the criteria mapping the wizard built."""
    for case in js["cases"]:
        assert yaml.safe_load(case["yaml"]) == _dates(case["criteria"]), case["name"]


def test_python_and_javascript_writers_agree_on_meaning(js) -> None:
    for case in js["cases"]:
        loaded = yaml.safe_load(case["yaml"])
        again = yaml.safe_load(render_criteria(loaded))
        assert again == loaded, case["name"]
        a, b = load_criteria_text(case["yaml"]), load_criteria_text(render_criteria(loaded))
        assert a == b, case["name"]


def test_weights_resolve_to_what_the_draft_shows(js) -> None:
    full = next(c for c in js["cases"] if c["name"] == "nyc-full")
    c = load_criteria_text(full["yaml"])
    assert c["scoring"]["preset"] == "shortest-commute"
    # taste on top of the preset: luxury essential (16) + renovated very (6) + appliances somewhat (2) fold into building,
    # light very (6) sets light_view, quiet not important (0)
    assert (c["weights"]["commute"], c["weights"]["quiet"], c["weights"]["building"], c["weights"]["light_view"]) == (40, 0, 24, 6)
    assert c["building_ratings"] == {'The "Ritz" Tower': 4, "Old Brick": 2}


def test_edit_mode_keeps_transit_and_unknown_keys(js) -> None:
    edit = next(c for c in js["cases"] if c["name"] == "edit-existing")
    orig = yaml.safe_load((ROOT / "examples" / "nyc-2026" / "criteria.yaml").read_text())
    got = yaml.safe_load(edit["yaml"])
    assert got["commute"]["transit"]["feeds"] == orig["commute"]["transit"]["feeds"]
    assert got["commute"]["transit"]["service_date"] == orig["commute"]["transit"]["service_date"]
    assert got["weights"] == {"cost": 33}
    assert got["search"]["name"] == orig["search"]["name"]
