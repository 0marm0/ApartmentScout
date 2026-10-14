"""Scoring v2: ranks, wording normalisers, move date, renewal and transit sub-models, gates, reasons, presets."""
import datetime as dt
import textwrap

import pytest

from apartmentscout.config import DEFAULT_WEIGHTS, PRESETS, load_criteria, resolve_scoring
from apartmentscout.listings import is_studio, normalise_laundry, normalise_service
from apartmentscout.score import DIMENSIONS, part_renewal, score_all, score_listing

TODAY = dt.date(2026, 10, 13)


def crit(**over):
    c = {"search": {"city": "nyc", "move_in": {"earliest": dt.date(2026, 11, 1), "latest": dt.date(2026, 11, 15)}},
         "budget": {"tiers": [{"name": "Target", "max": 5000}, {"name": "Stretch", "max": 5200}], "hard_max": 5450},
         "unit": {"min_beds": 1, "sqft_floor": 450, "sqft_good": 750, "sqft_great": 1050},
         "must_have": ["in_unit_wd", "elevator"], "strongly_prefer": ["doorman", "gym"], "nice_to_have": [],
         "commute": {"destinations": [{"name": "Office", "max_minutes": 30, "weight": 1}]},
         "weights": dict(DEFAULT_WEIGHTS), "scoring": {"stale_days": 21}}
    c.update(over)
    return c


def unit(i="a", **kw):
    base = {"id": i, "building": f"B{i}", "status": "new", "price": {"gross": 4800, "fees_monthly": 0},
            "sqft": 750, "beds": 1, "available": "2026-11-05", "checked": "2026-10-10",
            "amenities": {"in_unit_wd": True, "elevator": True, "doorman": "full-time", "gym": True},
            "commute": {"Office": {"minutes": 15,
                                   "route": "walk 4 min to 33 St → 6 to Grand Central-42 St → walk 3 min"}}}
    base.update(kw)
    return base


# ---------------------------------------------------------------------- wording

@pytest.mark.parametrize("text,want", [
    ("24-hour concierge", "full-time"), ("24 hr doorman", "full-time"), ("24h", "full-time"),
    ("24/7 staffed lobby", "full-time"), ("Full-time doorman", "full-time"), ("Concierge", "full-time"),
    ("virtual doorman", "virtual"), ("24/7 virtual concierge", "virtual"), ("part-time doorman", "part-time"),
    ("Doorman 7am-11pm", "part-time"), ("no doorman", "none"), ("Doorman: no", "none"), ("None", "none"),
    ("live-in super", None), ("", None),
])
def test_service_normaliser(text, want):
    assert normalise_service(text) == want


@pytest.mark.parametrize("text,want", [
    ("In-unit washer/dryer", True), ("W/D", True), ("Yes - unit", True), ("laundry in building", False),
    ("Laundry room on every floor", False), ("washer/dryer hookups", False), ("No", False), ("ask", None),
])
def test_laundry_normaliser(text, want):
    assert normalise_laundry(text) is want if want is not None else normalise_laundry(text) is None


def test_service_wording_scores_like_the_enum():
    worded = score_listing(unit(amenities={"in_unit_wd": "in-unit W/D", "elevator": True,
                                           "doorman": "24-hour concierge", "gym": True}), crit(), TODAY)
    enum = score_listing(unit(), crit(), TODAY)
    assert worded["parts"]["amenities"] == enum["parts"]["amenities"] == 100
    assert "service_wording" in worded["flags"]


def test_laundry_in_building_fails_the_in_unit_must_have():
    s = score_listing(unit(amenities={"in_unit_wd": "laundry in building", "elevator": True}), crit(), TODAY)
    assert "fails:in_unit_wd" in s["gates"] and not s["eligible"]


def test_fitness_studio_is_not_a_studio_apartment():
    assert is_studio({"type": "1BR with fitness studio access"}) is None
    assert is_studio({"type": "Studio apartment"}) is True
    assert is_studio({"beds": 0}) is True and is_studio({"beds": 1}) is False
    s = score_listing(unit(beds=None, type="Studio"), crit(), TODAY)
    assert "studio_from_text" in s["flags"] and s["parts"]["space"] == 25


# ---------------------------------------------------------------------- dimensions

def test_move_date_inside_early_late():
    c = crit()
    assert score_listing(unit(available="2026-11-05"), c, TODAY)["parts"]["move_date"] == 100
    now = score_listing(unit(available="Now"), c, TODAY)["parts"]["move_date"]
    assert now == pytest.approx(100 - 60 * 5 / 31, abs=0.1)  # 19 days before Nov 1
    late = score_listing(unit(available="2026-11-29"), c, TODAY)
    assert late["parts"]["move_date"] == pytest.approx(50)
    assert "move_date:after_window" in late["gates"] and late["eligible"]
    hard = crit(search={"move_in": {"earliest": "2026-11-01", "latest": "2026-11-15", "hard": True}})
    assert not score_listing(unit(available="2026-11-29"), hard, TODAY)["eligible"]
    assert score_listing(unit(available=None), c, TODAY)["parts"]["move_date"] is None


def test_renewal_risk_from_concession_depth():
    price = {"gross": 6000, "free_months": 1, "lease_months": 12, "fees_monthly": 0}
    s = score_listing(unit(price=price), crit(), TODAY)
    assert s["parts"]["renewal_risk"] == pytest.approx(100 - 9 * 100 / 12, abs=0.1)
    assert score_listing(unit(), crit(), TODAY)["parts"]["renewal_risk"] == 100
    assert part_renewal({"rent": {}}).value is None


def test_transit_access_lines_one_seat_and_close_station():
    L = unit(stations=[{"name": "33 St", "lines": "6", "walkMinutes": 4},
                       [8, "Grand Central", "4567S"], {"name": "Far", "lines": "ACE", "walkMinutes": 14}])
    s = score_listing(L, crit(), TODAY)
    assert s["parts"]["transit_access"] == pytest.approx(min(70, 14 * 5) + 20 + 10)
    r = next(r for r in s["reasons"] if r["dim"] == "transit_access")
    assert "5 lines within a 10-min walk" in r["text"] and "one-seat ride to Office" in r["text"]
    assert score_listing(unit(), crit(), TODAY)["parts"]["transit_access"] is None


def test_non_exact_visual_evidence_is_neutral():
    text = {"view": "panoramic skyline, bright"}
    exact = score_listing(unit(features=text, features_scope="exact-unit"), crit(), TODAY)
    building = score_listing(unit(features=text, features_scope={"view": "building"}), crit(), TODAY)
    assert exact["parts"]["light_view"] > 50
    assert building["parts"]["light_view"] is None and "visual_not_exact" in building["flags"]


def test_space_uses_the_size_range():
    rep = score_listing(unit(sqft=None, size={"sqft": 750, "basis": "reported"}), crit(), TODAY)
    proxy = score_listing(unit(sqft=None, size={"sqft": 750, "basis": "ratio_proxy"}), crit(), TODAY)
    assert rep["parts"]["space"] == proxy["parts"]["space"] == 50
    assert "space" not in rep["part_ranges"]
    assert proxy["part_ranges"]["space"] == [25.0, 75.0]   # 600-900 ft²
    assert proxy["range"][1] - proxy["range"][0] > rep["range"][1] - rep["range"][0]
    assert proxy["ppsf"] is None and rep["ppsf"]["value"] == pytest.approx(6.4)
    assert "size_proxy" in proxy["flags"]


# ---------------------------------------------------------------------- gates, tags, reasons

def test_money_gates_and_stale_gate():
    s = score_listing(unit(price={"gross": 4800}, checked="2026-09-01"), crit(), TODAY)
    assert "unverified:fees" in s["gates"] and "stale:checked_42_days_ago" in s["gates"] and s["eligible"]
    cond = score_listing(unit(price={"gross": 5400, "free_months": 2, "fees_monthly": 0}), crit(), TODAY)
    assert "unverified:lease_term" in cond["gates"] and cond["monthly_cost"] == 5400
    gone = score_listing(unit(status="gone", price={"gross": 4800}, checked="2026-01-01"), crit(), TODAY)
    assert not any(g.startswith(("stale", "unverified:fees")) for g in gone["gates"])


def test_source_conflict_and_thin_data_tags():
    s = score_listing(unit(claims=[{"field": "gross", "value": 5100, "source": "portal"}]), crit(), TODAY)
    assert "source conflict" in s["tags"] and "price_dispute" in s["gates"] and s["monthly_cost"] == 5100
    thin = score_listing({"id": "t", "price": {"gross": 4800}, "status": "new"}, crit(), TODAY)
    assert "thin data" in thin["tags"]


def test_reasons_are_itemised_sentences_with_points():
    s = score_listing(unit(sqft=None), crit(), TODAY)
    by = {r["dim"]: r for r in s["reasons"]}
    assert set(by) == set(DIMENSIONS)
    assert by["space"]["text"] == "0 space: size unknown, counted as neutral" and by["space"]["pts"] == 0
    assert by["commute"]["text"].startswith("+") and "15 min to Office by subway" in by["commute"]["text"]
    w, tot = crit()["weights"], sum(crit()["weights"].values())
    for k, r in by.items():
        part = s["parts"][k]
        assert r["pts"] == pytest.approx(0 if part is None else (part - 50) * w[k] / tot, abs=0.06)
    # points against neutral add up to the overall score
    assert 50 + sum(r["pts"] for r in s["reasons"]) == pytest.approx(s["overall"], abs=0.3)


def test_inferred_floor_is_flagged():
    s = score_listing(unit(floor=12, floor_inferred=True), crit(), TODAY)
    assert "floor_inferred" in s["flags"]
    assert any("inferred from the unit number" in i for r in s["reasons"] for i in r.get("items", []))


# ---------------------------------------------------------------------- ranks

def test_fit_action_budget_and_building_ranks():
    Ls = [unit("a", price={"gross": 4700, "fees_monthly": 0}, sqft=900),
          unit("b", price={"gross": 5100, "fees_monthly": 0}, sqft=1000),
          unit("gone", status="gone", sqft=1100),
          unit("over", price={"gross": 6000, "fees_monthly": 0}, sqft=1050),
          unit("a2", building="Ba", price={"gross": 4900, "fees_monthly": 0}, sqft=600)]
    score_all(Ls, crit(), TODAY)
    s = {L["id"]: L["score"] for L in Ls}
    assert s["gone"]["ranks"]["fit"] == 1 and s["gone"]["ranks"]["action"] is None and "rank" not in s["gone"]
    assert s["over"]["ranks"]["fit"] is not None and s["over"]["ranks"]["action"] is None
    assert [s[i]["rank"] for i in ("b", "a", "a2")] == [1, 2, 3]
    assert s["b"]["ranks"]["budget"] is None and s["a"]["ranks"]["budget"] == 1 and s["a2"]["ranks"]["budget"] == 2
    assert s["a2"]["ranks"]["building"] == s["a"]["ranks"]["building"] == 2
    assert s["gone"]["ranks"]["building"] is None


def test_ties_break_on_confidence_then_cost_then_id():
    Ls = [unit("z"), unit("y", price={"gross": 4800, "fees_monthly": 0}), unit("x")]
    score_all(Ls, crit(weights={**DEFAULT_WEIGHTS, "cost": 0}), TODAY)
    assert [L["id"] for L in sorted(Ls, key=lambda L: L["score"]["rank"])] == ["x", "y", "z"]


def test_overall_matches_the_dashboard_rescore_formula():
    """The dashboard recomputes overall = sum(w * (part ?? 50)) / sum(w) over every weighted key."""
    c = crit(weights={**DEFAULT_WEIGHTS, "move_date": 5, "transit_access": 5})
    s = score_listing(unit(sqft=None), c, TODAY)
    W = c["weights"]
    js = sum(W[k] * (s["parts"][k] if s["parts"][k] is not None else 50) for k in W) / sum(W.values())
    assert s["overall"] == pytest.approx(js, abs=0.05)


# ---------------------------------------------------------------------- presets

def test_presets_are_named_versioned_and_cover_every_dimension():
    assert {"balanced", "biggest-and-nicest", "cheapest-good-enough", "shortest-commute"} <= set(PRESETS)
    for p in PRESETS.values():
        assert p["version"] >= 1 and set(p["weights"]) == set(DIMENSIONS)
    assert PRESETS["balanced"]["weights"] == DEFAULT_WEIGHTS


def test_preset_then_weights_override(tmp_path):
    f = tmp_path / "criteria.yaml"
    f.write_text(textwrap.dedent("""
        search: {name: t}
        scoring:
          preset: shortest-commute
          presets:
            mine: {cost: 1, space: 1}
        weights: {quiet: 9}
    """))
    c = load_criteria(f)
    assert c["weights"]["commute"] == 40 and c["weights"]["quiet"] == 9
    assert c["scoring"]["preset"] == "shortest-commute" and c["scoring"]["preset_version"] == 1
    assert c["scoring"]["presets"]["mine"]["weights"] == {"cost": 1.0, "space": 1.0}
    assert c["scoring"]["dimensions"][0] == ["cost", "Cost"]
    with pytest.raises(ValueError):
        resolve_scoring({"scoring": {"preset": "nope"}})


def test_presets_reorder_a_small_set():
    big = unit("big", sqft=1100, price={"gross": 5400, "fees_monthly": 0}, commute={"Office": {"minutes": 28}})
    cheap = unit("cheap", sqft=560, price={"gross": 4000, "fees_monthly": 0}, commute={"Office": {"minutes": 12}})

    def order(name):
        Ls = [dict(big), dict(cheap)]
        w, sc = resolve_scoring({"scoring": {"preset": name}})
        score_all(Ls, crit(weights=w, scoring=sc), TODAY)
        return [L["id"] for L in sorted(Ls, key=lambda L: L["score"]["rank"])]

    assert order("biggest-and-nicest") == ["big", "cheap"]
    assert order("cheapest-good-enough") == ["cheap", "big"]
