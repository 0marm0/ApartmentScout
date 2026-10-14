"""Honest money model: unknown fees, missing lease terms, concessions, disputes, upfront and headroom."""
import datetime as dt

import pytest

from apartmentscout.listings import (_unflatten, concession_ask, concession_needed, concession_terms, cost_model,
                                     monthly_cost, net_effective, normalize, price_per_sqft, size_basis, size_info)

TODAY = dt.date(2026, 10, 13)
CRIT = {"search": {"move_in": {"earliest": dt.date(2026, 11, 1), "latest": dt.date(2026, 12, 1)}},
        "budget": {"tiers": [{"name": "Target", "max": 5000}, {"name": "Stretch", "max": 5200}], "hard_max": 5450}}


def cm(price, **extra):
    return cost_model({"price": price, **extra}, CRIT, TODAY)


def test_unknown_fees_stay_unknown():
    m = cm({"gross": 4900})
    assert m["monthly"] == 4900 and m["fees_known"] is False
    assert m["monthly_range"] == [4900, None] and m["all_in"] is None
    assert "monthly fees" in m["unknown"]


def test_zero_fees_are_known_and_give_all_in():
    m = cm({"gross": 4900, "fees_monthly": 0})
    assert m["fees_known"] and m["all_in"] == 4900 and m["monthly_range"] == [4900, 4900]


def test_fee_range_widens_monthly_range():
    m = cm({"gross": 4900, "fees_monthly": "50-100"})
    assert m["monthly"] == 4950 and m["monthly_range"] == [4950, 5000] and m["all_in"] is None
    assert m["fees_monthly"] == [50, 100]


def test_itemised_fees_fill_in_and_optional_items_are_ignored():
    m = cm({"gross": 4000, "fees": [{"name": "amenity", "amount": 100, "period": "monthly"},
                                    {"name": "parking", "amount": 400, "period": "monthly", "optional": True},
                                    {"name": "move-in", "amount": 600, "period": "one_time"},
                                    {"name": "fob deposit", "amount": 50, "period": "one_time", "refundable": True}],
            "lease_months": 12})
    assert m["fees_known"] and m["fees_monthly"] == 100
    assert m["monthly"] == pytest.approx(4000 + 100 + 50)
    assert m["upfront"]["other_refundable"] == 50 and m["move_in_min"] == pytest.approx(4000 + 100 + 50 + 600)


def test_free_months_without_term_give_no_invented_net():
    p = {"gross": 6000, "free_months": 2}
    assert net_effective(p) is None
    m = cm(p)
    assert m["rent"]["basis"] == "conditional" and m["rent"]["net"] is None
    ill = {x["lease_months"]: x["net"] for x in m["rent"]["illustrations"]}
    assert ill == {12: 5000, 14: pytest.approx(6000 * 12 / 14, abs=0.01)}
    assert m["monthly"] == 6000                      # ranked on the paid-month rent
    assert m["monthly_range"][0] == 5000             # best case still visible
    assert "lease term" in m["unknown"]
    assert cm({**p, "fees_monthly": 0})["all_in"] is None   # no all-in while the net is conditional


def test_free_months_with_term_compute_net_and_spread_one_time_fees():
    p = {"gross": 5250, "free_months": 1, "lease_months": 12}
    assert net_effective(p) == pytest.approx(4812.5)
    L = {"price": {**p, "fees_monthly": 35, "fees_one_time": 1200}}
    assert monthly_cost(L) == pytest.approx(4812.5 + 35 + 100)
    assert cost_model(L, CRIT, TODAY)["rent"]["basis"] == "computed"


def test_one_time_fees_without_term_are_spread_over_12_and_flagged():
    m = cm({"gross": 4800, "fees_monthly": 0, "fees_one_time": 1200})
    assert m["monthly"] == 4900
    assert any("12 months" in a for a in m["assumptions"])


def test_refundable_deposit_is_upfront_cash_not_monthly_cost():
    m = cm({"gross": 4800, "fees_monthly": 20, "deposit": 4800, "application_fee": 20, "lease_months": 12})
    assert m["monthly"] == pytest.approx(4800 + 20 + 20 / 12)
    assert m["upfront"]["deposit"] == 4800
    assert m["move_in_min"] == pytest.approx(4800 + 20 + 4800 + 20)
    assert m["move_in_unknown"] == []


def test_move_in_minimum_lists_unknown_parts():
    m = cm({"gross": 4800})
    assert m["move_in_min"] == 4800 and set(m["move_in_unknown"]) == {"deposit", "one-time fees"}


def test_headroom_against_tiers_and_concession_needed():
    m = cm({"gross": 5100, "fees_monthly": 0})
    rooms = {r["tier"]: r["room"] for r in m["headroom"]}
    assert rooms == {"Target": -100, "Stretch": 100, "Hard cap": 350}
    need = m["concession_needed"]
    assert need["target"] == 5000 and need["12"]["rent_only"] == pytest.approx(12 * (1 - 5000 / 5100), abs=0.01)
    assert need["12"]["rent_only_ask"] == 0.5


def test_concession_expired_by_start_date_is_not_applied():
    p = {"gross": 6000, "free_months": 1, "lease_months": 12,
         "concession": {"conditions": [{"type": "start_before", "value": "2026-10-20"}]}}
    m = cm(p)
    assert m["rent"]["basis"] == "gross" and m["monthly"] == 6000
    assert m["concession"]["applies"] is False and "starting by 2026-10-20" in m["concession"]["excluded"]


def test_concession_in_time_applies_with_a_note():
    p = {"gross": 6000, "free_months": 1, "lease_months": 12,
         "concession": {"conditions": [{"type": "start_before", "value": "2026-11-15"},
                                       {"type": "new_residents_only"}]}}
    m = cm(p)
    assert m["monthly"] == 5500 and m["concession"]["applies"]
    assert any("starting by" in n for n in m["concession"]["notes"])
    assert any("new residents" in n for n in m["concession"]["notes"])


def test_offer_expiry_and_building_banner_exclude_the_concession():
    ended = concession_terms({"price": {"gross": 5000, "free_months": 1, "lease_months": 12,
                                        "concession_conditions": [{"type": "expires", "value": "2026-10-01"}]}},
                             CRIT, TODAY)
    assert ended["applies"] is False and "ended" in ended["excluded"]
    banner = cm({"gross": 5000, "free_months": 1, "lease_months": 12,
                 "concession": {"conditions": [{"type": "unit_not_named"}]}})
    assert banner["monthly"] == 5000


def test_min_lease_condition_supplies_the_term():
    m = cm({"gross": 7000, "free_months": 2, "concession": {"conditions": [{"type": "min_lease_months", "value": 14}]}})
    assert m["rent"]["basis"] == "computed" and m["rent"]["net"] == pytest.approx(6000)


def test_conflicting_price_claims_rank_on_the_conservative_scenario():
    L = {"price": {"gross": 5000, "fees_monthly": 0},
         "claims": [{"field": "price.gross", "value": 5300, "source": "portal B", "observed_at": "2026-10-10"},
                    {"field": "gross", "value": 5000, "source": "owner site"},
                    {"field": "gross", "value": 4000, "source": "old cache", "status": "superseded"}]}
    m = cost_model(L, CRIT, TODAY)
    assert m["dispute"] and m["monthly"] == 5300
    assert [s["monthly"] for s in m["scenarios"]] == [5000, 5300]
    assert m["monthly_range"][0] == 5000


def test_whole_capture_claim_does_not_mix_sources():
    L = {"price": {"gross": 5600, "net_effective": 5133, "fees_monthly": 0},
         "claims": [{"source": "owner", "price": {"gross": 5400}}]}
    m = cost_model(L, CRIT, TODAY)
    assert m["dispute"] and m["monthly"] == 5400   # the owner's 5,400 with no concession beats the portal's 5,133 net
    assert m["scenarios"][0]["monthly"] == 5133


def test_concession_calculator():
    assert concession_needed(6300, 5100, 12) == pytest.approx(2.29, abs=0.01)
    assert concession_needed(6300, 5100, 12, fees=135) == pytest.approx(2.54, abs=0.01)
    assert concession_needed(4800, 5000) == 0
    assert concession_needed(6000, 100, fees=200) is None
    t = concession_ask(6300, 5100, fees=135)
    assert t["12"]["rent_only_ask"] == 2.5 and t["12"]["with_fees_ask"] == 3.0
    assert t["18"]["rent_only"] == pytest.approx(3.43, abs=0.01)
    assert "with_fees" not in concession_ask(6300, 5100)["12"]


def test_csv_fee_range_survives_import():
    row = _unflatten({"building": "X", "price.gross": "5000", "price.fees_monthly": "$50-100"})
    assert row["price"]["fees_monthly"] == [50, 100]


# ---------------------------------------------------------------------- size basis

def test_size_basis_vocabulary_and_aliases():
    assert size_basis("Line and floor band") == "line_band_plan"
    assert size_basis("advertised") == "reported"
    assert size_basis("stated rooms") == "main_rooms_sum"
    assert size_basis("something odd") == "ratio_proxy"


def test_bare_sqft_is_reported_and_exact():
    si = size_info({"sqft": 700})
    assert si == {**si, "sqft": 700, "basis": "reported", "range": [700, 700], "exact": True, "ppsf_ok": True}


def test_proxy_size_has_wider_range_and_no_ppsf():
    proxy = {"size": {"sqft": 700, "basis": "ratio_proxy"}}
    plan = {"size": {"sqft": 700, "basis": "exact_plan"}}
    p, e = size_info(proxy), size_info(plan)
    assert p["range"][1] - p["range"][0] > e["range"][1] - e["range"][0] > 0
    assert price_per_sqft(proxy, 5000) is None
    assert price_per_sqft(plan, 5000)["value"] == pytest.approx(7.14, abs=0.01)
    assert price_per_sqft({"sqft": 700}, 5000)["range"] == [7.14, 7.14]


def test_main_rooms_sum_estimates_total_with_range():
    si = size_info({"size": {"basis": "main_rooms_sum", "main_rooms_sqft": 455}})
    assert si["sqft"] == 700 and si["range"] == [607, 827] and not si["exact"]


def test_normalize_keeps_estimates_out_of_sqft():
    est = normalize({"building": "A", "unit": "1", "size": {"sqft": 640, "basis": "tier plan"}})
    assert "sqft" not in est and est["size"]["basis"] == "line_band_plan"
    exact = normalize({"building": "A", "unit": "2", "size": {"sqft": 640, "basis": "exact plan"}})
    assert exact["sqft"] == 640
