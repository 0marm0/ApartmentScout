"""Tour findings and the decision trail: apartmentscout/tours.py against the dashboard's models (findings-model.js and
decisions-model.js), the scorer's use of them, and the files they live in.

The parity tests run tests/js/emit-findings-cases.mjs under Node on tests/fixtures/tour-cases.json (synthetic homes and
findings only) and on generated findings for the committed example, and compare everything with the Python side: the
normaliser, the contradictions and reason lines, the promoted-fact overlay, the share summary, the trail, and the scores
both sides compute from a promoted fact.
"""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from apartmentscout import tours
from apartmentscout.score import score_all, score_listing

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "tour-cases.json").read_text(encoding="utf-8"))
LISTINGS = {L["id"]: L for L in CASES["listings"]}
node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


@pytest.fixture(scope="module")
def js() -> dict[str, Any]:
    out = subprocess.run(["node", "tests/js/emit-findings-cases.mjs"], cwd=ROOT, capture_output=True, text=True, check=True, timeout=120)
    return json.loads(out.stdout)


def rt(v: Any) -> Any:
    """What the value looks like after JSON, the way the browser sees it."""
    return json.loads(json.dumps(v))


# --------------------------------------------------------------------------- parity with the dashboard
@node
def test_normalizer_agrees(js) -> None:
    for name, raw in CASES["findings"].items():
        assert rt(tours.normalize(raw)) == js["normalized"][name], name


@node
def test_contradictions_overlay_claims_and_share_agree(js) -> None:
    for p in js["pairs"]:
        L, f = LISTINGS[p["listing"]], CASES["findings"][p["finding"]]
        tag = f"{p['listing']} / {p['finding']}"
        assert rt(tours.flags_for(L, f)) == p["flags"], tag
        assert rt(tours.overlay(L, f)) == p["overlay"], tag
        assert rt(tours.share_tour(L, f)) == p["share"], tag
        assert rt(tours.share_tour(L, f, notes=True)) == p["share_notes"], tag
        for k in tours.CHECK_KEYS:
            assert rt(tours.claim_of(k, f)) == p["claims"][k], f"{tag} claim {k}"
            assert rt(tours.assess(L, k, tours.normalize(f).get("checks", {}).get(k))) == p["assess"][k], f"{tag} assess {k}"
            assert rt(tours.listed_value(L, k)) == p["listed"][k], f"{tag} listed {k}"


@node
def test_trail_agrees(js) -> None:
    t = CASES["trail"]
    assert rt(tours.clean_trail(t)) == js["trail"]["cleaned"]
    assert rt(tours.trail_for_share(t, "fx-a")) == js["trail"]["plain"]
    assert rt(tours.trail_for_share(t, "fx-a", notes=True)) == js["trail"]["notes"]
    assert rt(tours.trail_for_share(t, "fx-b")) == js["trail"]["other"]


@node
def test_scores_from_promoted_facts_agree(js) -> None:
    """Both sides score the example with generated findings: the same gates, tags, reason lines, and the parts the
    dashboard recomputes itself (amenities always, size when it is a bare reported number)."""
    crit = json.loads((ROOT / "dashboard" / "data" / "criteria.json").read_text())
    base = json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())
    tour_map = {x["id"]: tours.normalize(x["finding"]) for x in js["scoring"]}
    scored = score_all(copy.deepcopy(base), crit, tours=tour_map)
    by = {L["id"]: L for L in scored}
    assert len(js["scoring"]) == 40
    promoted_any = contradicted_any = 0
    for x in js["scoring"]:
        s = by[x["id"]]["score"]
        assert s["gates"] == x["gates"], x["id"]
        # the dashboard keeps the scorer's own tags (thin data, source conflict); the visit's tag must agree
        assert (tours.TAG in s["tags"]) == (tours.TAG in x["tags"]), x["id"]
        assert abs(s["parts"]["amenities"] - x["amenities"]) <= 0.15 if x["amenities"] is not None else s["parts"]["amenities"] is None, x["id"]
        if x["spaceExact"]:
            assert abs(s["parts"]["space"] - x["space"]) <= 0.15, x["id"]
        items = {r["dim"]: [i for i in r.get("items", []) if i.startswith("tour ")] for r in s["reasons"]}
        assert {k: v for k, v in items.items() if v} == x["items"], x["id"]
        promoted_any += bool(tours.live_promotions(tour_map[x["id"]]))
        contradicted_any += any(g.startswith("contradicted:") for g in s["gates"])
    assert promoted_any > 5 and contradicted_any > 5


@node
def test_parse_feet_in_the_dashboard() -> None:
    script = ("import { parseFeet } from './dashboard/js/features/findings-model.js';"
              "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map((r) => parseFeet(r))))")
    out = subprocess.run(["node", "--input-type=module", "-e", script, json.dumps([r for r, _ in CASES["feet"]])], cwd=ROOT, capture_output=True, text=True, check=True, timeout=30)
    assert json.loads(out.stdout) == [f for _, f in CASES["feet"]]


# --------------------------------------------------------------------------- scoring
def example() -> tuple[dict, list[dict]]:
    crit = json.loads((ROOT / "dashboard" / "data" / "criteria.json").read_text())
    return crit, json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())


def pick_home(listings: list[dict]) -> dict:
    return next(L for L in listings if (L.get("amenities") or {}).get("in_unit_wd") is True and L.get("status") in ("new", "shortlist", "researching") and L.get("beds") is not None)


def test_a_contradiction_changes_no_score_and_a_promotion_does() -> None:
    crit, base = example()
    home = pick_home(base)
    assert "in_unit_wd" in crit["must_have"]
    plain = {L["id"]: L["score"] for L in score_all(copy.deepcopy(base), crit)}[home["id"]]
    finding = {"observed": "2026-10-14", "checks": {"wd": {"verdict": "differs", "observed": False}}}
    flagged = {L["id"]: L["score"] for L in score_all(copy.deepcopy(base), crit, tours={home["id"]: tours.normalize(finding)})}[home["id"]]
    # surfaced, not scored: the numbers are the ones the listing earned
    assert "contradicted:in_unit_wd" in flagged["gates"] and "differs on tour" in flagged["tags"]
    assert flagged["parts"] == plain["parts"] and flagged["overall"] == plain["overall"] and flagged["eligible"] == plain["eligible"]
    line = next(i for r in flagged["reasons"] if r["dim"] == "amenities" for i in r["items"] if i.startswith("tour "))
    assert "no in-unit washer/dryer observed" in line and "Not scored until you promote it" in line
    # promoted: scoring reads it, the must-have now fails
    finding["promoted"] = {"wd": {"value": False, "observed_at": "2026-10-14"}}
    scored = {L["id"]: L for L in score_all(copy.deepcopy(base), crit, tours={home["id"]: tours.normalize(finding)})}[home["id"]]
    s = scored["score"]
    assert "fails:in_unit_wd" in s["gates"] and not s["eligible"] and s["parts"]["amenities"] < plain["parts"]["amenities"]
    assert not any(g.startswith("contradicted:") for g in s["gates"]) and "differs on tour" not in s["tags"]
    assert any("promoted to a fact" in i for r in s["reasons"] for i in r.get("items", []))
    # the listing itself still says what it said
    assert scored["amenities"]["in_unit_wd"] is True


def test_findings_never_touch_the_listing_and_stale_promotions_do_not_count() -> None:
    L = copy.deepcopy(LISTINGS["fx-a"])
    before = copy.deepcopy(L)
    promoted = tours.normalize(CASES["findings"]["fx-a-promoted"])
    view = tours.overlay(L, promoted)
    assert L == before and view["amenities"]["in_unit_wd"] is False and view["sqft"] == 611 and view["exposure"] == ["N"]
    # the renter then changed the check: the old promotion no longer stands
    stale = tours.normalize(CASES["findings"]["fx-a-stale"])
    assert tours.live_promotions(stale) == {} and tours.overlay(L, stale) is L
    changed = {**promoted, "checks": {**promoted["checks"], "wd": {"verdict": "differs", "observed": True}}}
    assert "wd" not in tours.live_promotions(changed)


def test_promotion_claims_are_dated_and_sourced() -> None:
    c = tours.claim_of("size", CASES["findings"]["fx-a-promoted"])
    assert c == {"field": "sqft", "value": 611, "source": "renter, observed on a tour", "observed_at": "2026-10-14", "status": "live", "via": "tour"}
    assert tours.claim_of("doorman", CASES["findings"]["fx-a-promoted"]) is None


def test_size_within_two_percent_is_a_match_and_a_silent_listing_is_not_a_contradiction() -> None:
    a = tours.assess(LISTINGS["fx-c"], "size", {"verdict": "differs", "observed": 525})
    assert a["kind"] == "matches"
    assert tours.assess(LISTINGS["fx-b"], "wd", {"verdict": "differs", "observed": True})["kind"] == "adds"
    fl = tours.flags_for(LISTINGS["fx-b"], CASES["findings"]["fx-b"])
    assert fl["gates"] == [] and fl["tags"] == [] and "promoted to a fact" in fl["items"]["amenities"][0]


# --------------------------------------------------------------------------- files
def test_findings_round_trip_and_ids_cannot_escape(tmp_path: Path) -> None:
    n = tours.write_findings(tmp_path, "fx-a", CASES["findings"]["fx-a"])
    assert (tmp_path / "tours" / "fx-a" / "findings.json").is_file() and tours.read_findings(tmp_path, "fx-a") == n
    assert tours.load_all(tmp_path) == {"fx-a": n}
    for bad in ["../x", "a/b", "..", ".", "", "a\\b", "x" * 200, "ok/../../etc", ".hidden", "a\x00b"]:
        with pytest.raises(ValueError):
            tours.findings_path(tmp_path, bad)
    # a record with nothing the renter entered is not a visit
    tours.write_findings(tmp_path, "blank", {"observed": "2026-10-14"})
    assert "blank" not in tours.load_all(tmp_path)
    # a hand-edited file with junk is cleaned on the way in
    (tmp_path / "tours" / "fx-a" / "findings.json").write_text(json.dumps({"water": 99, "note": "kept", "evil": "<script>"}))
    assert tours.read_findings(tmp_path, "fx-a") == {"v": 1, "note": "kept"}


def test_newest_prefers_the_later_update() -> None:
    a, b = {"updated": "2026-10-14T10:00:00Z", "note": "a"}, {"updated": "2026-10-14T11:00:00Z", "note": "b"}
    assert tours.newest(a, b) is b and tours.newest(b, a) is b and tours.newest(None, a) is a and tours.newest({"note": "x"}, a) is a


def test_score_listing_is_unchanged_without_tours() -> None:
    crit, base = example()
    L = base[3]
    assert score_listing(copy.deepcopy(L), crit)["gates"] == [g for g in score_listing(copy.deepcopy(L), crit)["gates"]]
    plain = score_all(copy.deepcopy(base), crit)
    withempty = score_all(copy.deepcopy(base), crit, tours={})
    assert [L["score"] for L in plain] == [L["score"] for L in withempty]
