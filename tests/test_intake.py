"""Intake questionnaire (config/intake.yaml), `init --interactive` / `--criteria`, and `criteria --check`."""
from __future__ import annotations

import datetime as dt
import json
import types
from pathlib import Path

import pytest
import yaml

from apartmentscout import cli
from apartmentscout.config import DIMENSION_LABELS, PRESETS, load_criteria
from apartmentscout.criteria_check import check_file, check_text
from apartmentscout.intake import (INTAKE_PATH, Quit, interview, load_intake, render_criteria, resolve_weights,
                                   taste_weights, template_text)

ROOT = Path(__file__).resolve().parents[1]
TODAY = dt.date(2026, 10, 14)

# one answer per prompt, in questionnaire order (Enter = accept the default)
SCRIPT = [
    "Boston 2BR",                 # name
    "generic",                    # city
    "America/New_York",           # timezone
    "2026-12-01",                 # earliest
    "+90d",                       # latest
    "y",                          # hard deadline
    "42.36, -71.06",              # map centre
    "y", "Lab", "1 Kendall Sq, Cambridge, MA", "08:30", "40", "1.5", "subway",   # destination 1
    "n",                          # another?
    "net",                        # basis
    "Target=3800, Stretch=4200",  # tiers
    "4500",                       # hard max
    "2",                          # min beds
    "600", "900", "1300",         # sqft
    "in_unit_wd, pets",           # must
    "dishwasher",                 # strong
    "gym, roof_deck",             # nice
    "3", "2", "", "", "1", "3",   # luxury, renovated, appliances, view, light, quiet
    "Ritz=4, Old Brick=2",        # ratings
    "shortest-commute",           # preset
    "cost=12",                    # weights
]


def scripted(answers: list[str]):
    it = iter(answers)

    def ask(_prompt: str) -> str:
        try:
            return next(it)
        except StopIteration as e:
            raise EOFError from e
    return ask


def test_every_step_and_question_is_listed_in_order() -> None:
    steps = load_intake()["steps"]
    assert [s["id"] for s in steps] == ["basics", "places", "money", "home", "amenities", "taste", "weights"]
    for s in steps:
        for q in s["questions"]:
            for key in ("id", "maps_to", "type", "ask"):
                assert q.get(key) is not None, f"{s['id']}.{q.get('id')} lacks {key}"
            if q["id"] not in ("name",):
                assert "default" in q, f"{q['id']} lacks a default"
            assert q.get("why") or q["type"] == "destinations", f"{q['id']} lacks a why"


def test_every_question_maps_to_a_key_criteria_check_accepts() -> None:
    crit = check_text(render_criteria({"search": {"name": "x"}}))
    assert crit.ok
    for s in load_intake()["steps"]:
        for q in s["questions"]:
            top = q["maps_to"].split(".")[0]
            assert top in {"search", "budget", "unit", "must_have", "strongly_prefer", "nice_to_have", "commute", "scoring",
                           "weights", "building_ratings"}


def test_scripted_interview_builds_valid_criteria() -> None:
    out: list[str] = []
    c = interview(scripted(SCRIPT), out.append, today=TODAY)
    assert c["search"] == {"name": "Boston 2BR", "city": "generic", "timezone": "America/New_York",
                           "move_in": {"earliest": "2026-12-01", "latest": "2027-01-12", "hard": True}, "map_center": [42.36, -71.06]}
    assert c["commute"]["destinations"] == [{"name": "Lab", "address": "1 Kendall Sq, Cambridge, MA", "arrive_by": "08:30",
                                             "max_minutes": 40, "weight": 1.5, "mode": "subway"}]
    assert c["budget"] == {"basis": "net", "tiers": [{"name": "Target", "max": 3800}, {"name": "Stretch", "max": 4200}], "hard_max": 4500}
    assert c["unit"] == {"min_beds": 2, "sqft_floor": 600, "sqft_good": 900, "sqft_great": 1300}
    assert (c["must_have"], c["strongly_prefer"], c["nice_to_have"]) == (["in_unit_wd", "pets"], ["dishwasher"], ["gym", "roof_deck"])
    assert c["building_ratings"] == {"Ritz": 4, "Old Brick": 2}
    assert c["scoring"] == {"preset": "shortest-commute"}
    w = c["weights"]
    assert w["cost"] == 12
    # taste: luxury essential (building 16), renovated very (interior 6, or folded into building), light somewhat, quiet essential
    assert w["quiet"] == 10
    text = render_criteria(c, "test")
    rep = check_text(text)
    assert rep.ok, rep.errors
    loaded = rep.criteria
    assert loaded["weights"]["cost"] == 12 and loaded["scoring"]["preset"] == "shortest-commute"
    assert loaded["search"]["move_in"]["earliest"] == dt.date(2026, 12, 1)
    assert any("Anything to change" in line for line in out)


def test_interview_reasks_invalid_answers() -> None:
    out: list[str] = []
    answers = ["Name", "mars", "generic", "", "", "", "", "-", "", "n", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
               "", "", "", "", "", "", "", "", ""]
    c = interview(scripted(answers), out.append, today=TODAY)
    assert any("choose one of" in line for line in out)
    assert c["search"]["city"] == "generic"


def test_end_of_input_stops_without_a_result() -> None:
    with pytest.raises(Quit):
        interview(scripted(["Only a name"]), lambda s: None, today=TODAY)


def test_taste_weights_fold_missing_dimensions_into_building() -> None:
    lv = {"luxury": 3, "renovated": 2, "appliances": None, "view": None, "light": 1, "quiet": 0}
    full = taste_weights(lv, dimensions=["building", "interior", "light_view", "quiet"])
    assert full == {"building": 16, "interior": 6, "light_view": 3, "quiet": 0}
    folded = taste_weights(lv, dimensions=["building", "light_view", "quiet"])
    assert folded == {"building": 22, "light_view": 3, "quiet": 0}
    assert taste_weights({}) == {}


def test_resolve_weights_layers_preset_taste_overrides() -> None:
    w = resolve_weights("biggest-and-nicest", {"quiet": 9}, {"cost": 1})
    assert w["space"] == 30 and w["quiet"] == 9 and w["cost"] == 1
    assert set(w) == set(DIMENSION_LABELS)
    assert resolve_weights(None, {}) == {k: float(v) for k, v in PRESETS["balanced"]["weights"].items() if k in DIMENSION_LABELS} | {
        k: 0.0 for k in DIMENSION_LABELS if k not in PRESETS["balanced"]["weights"]}


def test_render_round_trips_the_example_criteria(tmp_path: Path) -> None:
    raw = yaml.safe_load((ROOT / "examples" / "nyc-2026" / "criteria.yaml").read_text())
    text = render_criteria(raw, "round trip")
    p = tmp_path / "criteria.yaml"
    p.write_text(text)
    a, b = load_criteria(ROOT / "examples" / "nyc-2026" / "criteria.yaml"), load_criteria(p)
    for key in ("search", "budget", "unit", "must_have", "strongly_prefer", "nice_to_have", "weights"):
        assert a[key] == b[key], key
    assert a["commute"] == b["commute"]
    assert b["scoring"]["preset"] == a["scoring"]["preset"]


# --------------------------------------------------------------------------- init
def _args(path: Path, **kw) -> types.SimpleNamespace:
    return types.SimpleNamespace(path=str(path), city=kw.get("city"), force=kw.get("force", False),
                                 criteria=kw.get("criteria"), interactive=kw.get("interactive", False))


def test_init_interactive_writes_a_valid_search(tmp_path: Path, capsys) -> None:
    cli.cmd_init(_args(tmp_path / "s", city="nyc", interactive=True), input_fn=scripted(SCRIPT))
    crit = load_criteria(tmp_path / "s" / "criteria.yaml")
    assert crit["search"]["name"] == "Boston 2BR" and crit["search"]["city"] == "nyc"
    assert crit["commute"]["transit"]["feeds"], "the nyc profile's feeds are added"
    assert (tmp_path / "s" / "listings.json").exists() and (tmp_path / "s" / "research").is_dir()
    assert "criteria --check" in capsys.readouterr().out


def test_init_interactive_without_a_terminal_writes_the_template(tmp_path: Path, capsys, monkeypatch) -> None:
    monkeypatch.setattr("sys.stdin", types.SimpleNamespace(isatty=lambda: False))
    cli.cmd_init(_args(tmp_path / "s", city="nyc", interactive=True))
    assert "Not a terminal" in capsys.readouterr().out
    assert (tmp_path / "s" / "criteria.yaml").read_text() == template_text("nyc")
    assert check_file(tmp_path / "s" / "criteria.yaml").ok


def test_init_interactive_stopped_early_writes_nothing(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        cli.cmd_init(_args(tmp_path / "s", interactive=True), input_fn=scripted(["x"]))
    assert not (tmp_path / "s" / "criteria.yaml").exists()


def test_init_from_a_criteria_file_validates_and_adds_city_defaults(tmp_path: Path) -> None:
    src = tmp_path / "wizard.yaml"
    src.write_text("search:\n  name: From the wizard\n  city: nyc\nbudget:\n  tiers:\n    - {name: A, max: 3000}\n")
    cli.cmd_init(_args(tmp_path / "s", criteria=str(src)))
    crit = load_criteria(tmp_path / "s" / "criteria.yaml")
    assert crit["search"]["name"] == "From the wizard"
    assert crit["search"]["timezone"] == "America/New_York"
    assert len(crit["commute"]["transit"]["feeds"]) == 3


def test_init_from_an_invalid_criteria_file_writes_nothing(tmp_path: Path) -> None:
    src = tmp_path / "bad.yaml"
    src.write_text("search: {name: X}\nbudget:\n  tiers: [{name: A, max: 5000}, {name: B, max: 4000}]\n")
    with pytest.raises(SystemExit) as e:
        cli.cmd_init(_args(tmp_path / "s", criteria=str(src)))
    assert "must be above" in str(e.value)
    assert not (tmp_path / "s").exists()


def test_init_refuses_to_overwrite(tmp_path: Path) -> None:
    cli.cmd_init(_args(tmp_path / "s"))
    with pytest.raises(SystemExit):
        cli.cmd_init(_args(tmp_path / "s"))
    cli.cmd_init(_args(tmp_path / "s", force=True))


# --------------------------------------------------------------------------- criteria --check
def test_criteria_check_prints_a_summary_and_exits_zero(capsys) -> None:
    from apartmentscout.commands.criteria import cmd_criteria
    cmd_criteria(types.SimpleNamespace(check=str(ROOT / "examples" / "nyc-2026" / "criteria.yaml"), json=False, strict=False, search=None))
    out = capsys.readouterr().out
    assert "Manhattan 1BR" in out and "OK: 0 error(s)" in out and "Grand Central" in out


def test_criteria_check_fails_with_every_problem(capsys) -> None:
    from apartmentscout.commands.criteria import cmd_criteria
    bad = ROOT / "tests" / "fixtures" / "criteria-bad.yaml"
    with pytest.raises(SystemExit) as e:
        cmd_criteria(types.SimpleNamespace(check=str(bad), json=True, strict=False, search=None))
    assert e.value.code == 1
    data = json.loads(capsys.readouterr().out)
    joined = " ".join(data["errors"])
    for needle in ("search.name", "latest is before earliest", "must be above", "sizes must rise", "already in", "arrive_by",
                   "weights.cost", "building_ratings.Ritz"):
        assert needle in joined, needle


@pytest.mark.parametrize("text,needle", [
    ("search: [1, 2]\n", "search: must be a mapping"),
    ("- a\n- b\n", "must be a mapping of sections"),
    ("search: {name: X\n", "Not valid YAML"),
    ("", "empty"),
    ("search: {name: X}\nscoring: {preset: nope}\n", "Unknown scoring preset"),
    ("search: {name: X, timezone: Mars/Base}\n", "IANA"),
    ("search: {name: X}\ncommute:\n  destinations:\n    - {name: A}\n", "address or lat/lon"),
])
def test_criteria_check_catches(text: str, needle: str) -> None:
    rep = check_text(text)
    assert not rep.ok and needle in " ".join(rep.errors), rep.errors


def test_criteria_check_warns_but_passes_unknown_keys() -> None:
    rep = check_text("search: {name: X, city: atlantis}\nbudjet: {}\nweights: {cost: 5, flavor: 3}\n")
    assert rep.ok
    assert any("atlantis" in w for w in rep.warnings) and any("budjet" in w for w in rep.warnings) and any("flavor" in w for w in rep.warnings)


def test_building_ratings_is_an_accepted_optional_map() -> None:
    assert check_text("search: {name: X}\nbuilding_ratings: {Ritz: 5, Dump: 1}\n").ok
    assert not check_text("search: {name: X}\nbuilding_ratings: {Ritz: 9}\n").ok
    assert not check_text("search: {name: X}\nbuilding_ratings: [Ritz]\n").ok


def test_intake_file_is_valid_yaml_at_the_documented_path() -> None:
    assert INTAKE_PATH == ROOT / "config" / "intake.yaml"
    assert load_intake()["version"] == 1
