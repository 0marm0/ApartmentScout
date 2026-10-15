"""price.basis: a rent read from a weak source is ranked on the paid-month rent, gets a cost range and the unverified:price gate."""
import datetime as dt

import pytest

from apartmentscout.config import DEFAULT_WEIGHTS
from apartmentscout.listings import PRICE_BASES, cost_model, normalize, price_basis, price_unverified
from apartmentscout.quality.validate import validate
from apartmentscout.score import score_all, score_listing

TODAY = dt.date(2026, 10, 14)
CRIT = {"search": {"name": "T", "move_in": {"earliest": "2026-10-15", "latest": "2026-11-01"}},
        "budget": {"tiers": [{"name": "Target", "max": 5000}, {"name": "Stretch", "max": 5200}], "hard_max": 5450},
        "unit": {"min_beds": 1}, "must_have": [], "commute": {"destinations": []},
        "weights": dict(DEFAULT_WEIGHTS), "scoring": {"stale_days": 21}}


def listing(price, **kw):
    base = {"id": "x-1", "building": "X", "unit": "1", "address": "1 Main St", "status": "researching",
            "checked": "2026-10-10", "price": price, "amenities": {}}
    base.update(kw)
    return base


def test_basis_names_aliases_and_weakness():
    assert price_basis(listing({"gross": 4000, "basis": "search_snippet"})) == "search_snippet"
    assert price_basis(listing({"gross": 4000, "basis": "Search result"})) == "search_snippet"       # alias, case, spaces
    assert price_basis(listing({"gross": 4000}, price_basis="unit page")) == "unit_page"             # listing-level key
    assert price_basis(listing({"gross": 4000, "basis": "carrier pigeon"})) is None
    weak = {k for k, (_, w) in PRICE_BASES.items() if w}
    assert weak == {"building_page", "search_snippet", "received", "stale", "estimate"}
    assert price_unverified(listing({"gross": 1, "basis": "stale"})) and not price_unverified(listing({"gross": 1, "basis": "unit_page"}))
    assert not price_unverified(listing({"gross": 1}))                                                # no basis recorded: not claimed either way


def test_weak_source_net_is_not_ranked_on():
    """The Emerald Green 24D case: a search snippet showed $4,652 gross and $4,318 'net' with no term."""
    L = listing({"gross": 4652, "net_effective": 4318, "basis": "search_snippet", "checked": "2026-09-28"})
    cm = cost_model(L, CRIT, TODAY)
    assert cm["monthly"] == 4652                         # the paid-month rent, not the unverified net
    assert cm["rent"]["basis"] == "gross" and cm["rent"]["net_unverified"] == 4318
    assert cm["price_unverified"] and cm["price_basis"] == "search_snippet" and cm["price_checked"] == "2026-09-28"
    lo, hi = cm["price_range"]
    assert lo == 4318 and hi == pytest.approx(4652 * 1.05)
    assert cm["all_in"] is None
    # the same numbers from a unit page stay as quoted
    ok = cost_model(listing({"gross": 4652, "net_effective": 4318, "basis": "unit_page"}), CRIT, TODAY)
    assert ok["monthly"] == 4318 and not ok.get("price_unverified") and "price_range" not in ok


def test_advertised_range_gives_gross_and_low_end():
    L = listing({"gross": 4652, "range": [4318, 4652], "basis": "search_snippet"})
    cm = cost_model(L, CRIT, TODAY)
    assert cm["monthly"] == 4652 and cm["rent"]["range"] == [4318.0, 4652.0] and cm["price_range"][0] == 4318
    only_range = cost_model(listing({"range": [4318, 4652]}), CRIT, TODAY)
    assert only_range["monthly"] == 4652 and only_range["rent"]["gross"] == 4652     # the top of the range is the paid rent


def test_band_is_a_criteria_setting():
    crit = {**CRIT, "scoring": {**CRIT["scoring"], "unverified_price_band": 0.10}}
    cm = cost_model(listing({"gross": 5000, "basis": "building_page"}), crit, TODAY)
    assert cm["price_range"] == [5000, 5500]
    cm0 = cost_model(listing({"gross": 5000, "basis": "building_page"}), {**CRIT, "scoring": {"unverified_price_band": 0}}, TODAY)
    assert cm0["price_range"] == [5000, 5000]


def test_gate_tag_confidence_and_visibility():
    weak = listing({"gross": 4800, "basis": "received", "checked": None}, id="w-1")
    good = listing({"gross": 4800, "basis": "unit_page"}, id="g-1")
    s_weak, s_good = score_listing(weak, CRIT, TODAY), score_listing(good, CRIT, TODAY)
    assert "unverified:price" in s_weak["gates"] and "unverified:price" not in s_good["gates"]
    assert "price unverified" in s_weak["tags"] and "price_unverified" in s_weak["flags"]
    assert s_weak["confidence"] < s_good["confidence"]
    assert s_weak["eligible"] and s_weak["overall"] is not None        # kept visible and ranked, never hidden
    assert s_weak["cost"]["price_unverified"] and s_weak["cost"]["price_range"][0] <= 4800 <= s_weak["cost"]["price_range"][1]
    cost_reason = next(r for r in s_weak["reasons"] if r["dim"] == "cost")
    assert "price unverified" in cost_reason["text"]
    lo, hi = s_weak["part_ranges"]["cost"]
    assert lo <= s_weak["parts"]["cost"] <= hi and lo < hi            # the score range widens with the price range
    ranked = score_all([weak, good], CRIT, TODAY)
    assert all(x["score"]["rank"] for x in ranked)


def test_gone_listing_gets_no_price_gate():
    s = score_listing(listing({"gross": 4800, "basis": "stale"}, status="gone"), CRIT, TODAY)
    assert "unverified:price" not in s["gates"]


def test_expired_concession_with_stated_term_is_not_applied():
    """Townsend 9E: the $4,625 net needed a lease by 9/15; the rent is the gross once the offer ended."""
    L = listing({"gross": 5045, "free_months": 1, "lease_months": 12, "concession_conditions": [{"type": "expires", "value": "2026-09-15"}],
                 "basis": "unit_page"})
    cm = cost_model(L, CRIT, TODAY)
    assert cm["monthly"] == 5045 and cm["concession"]["excluded"] == "offer ended 2026-09-15"
    assert "concession:not_applied" in score_listing(L, CRIT, TODAY)["gates"]


def test_validate_flags_unknown_basis_and_bad_range():
    rows = [listing({"gross": 4000, "basis": "carrier pigeon"}, id="a-1"),
            listing({"gross": 4652, "range": [4900, 4300], "basis": "search_snippet"}, id="a-2", unit="2"),
            listing({"gross": 4652, "range": [4318, 4600], "basis": "search_snippet"}, id="a-3", unit="3")]
    codes = {(i.code, i.id) for i in validate([normalize(r) for r in rows], CRIT)}
    assert ("unknown_price_basis", "a-1") in codes
    assert ("bad_price_range", "a-2") in codes
    assert ("price_range_vs_gross", "a-3") in codes
    assert not {c for c in codes if c[0] == "unknown_price_basis" and c[1] != "a-1"}


def test_csv_import_keeps_basis_text(tmp_path):
    from apartmentscout.listings import load
    p = tmp_path / "in.csv"
    p.write_text("building,unit,price.gross,price.basis,price.source,price.checked\nTower,12B,4800,search snippet,RentHop result,2026-10-01\n")
    L = load(p)[0]
    assert L["price"]["gross"] == 4800 and L["price"]["basis"] == "search snippet" and price_basis(L) == "search_snippet"
    assert L["price"]["checked"] == "2026-10-01"


def test_coverage_treats_a_weak_rent_as_stale_not_fresh():
    from apartmentscout.quality.standard import assess
    fresh = listing({"gross": 4800, "basis": "unit_page"}, checked="2026-10-13")
    weak = listing({"gross": 4800, "basis": "search_snippet"}, checked="2026-10-13")
    assert "rent" in assess(fresh, CRIT, TODAY)["have"]
    assert "rent" in assess(weak, CRIT, TODAY)["stale"] and "rent" not in assess(weak, CRIT, TODAY)["have"]
