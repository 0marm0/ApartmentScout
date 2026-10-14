"""Scoring 2.1: comparable estimates for unknown size and fees, building quality with renter ratings,
interior finishes and photo-graded light and view."""
import datetime as dt

from apartmentscout.config import DEFAULT_WEIGHTS
from apartmentscout.score import (build_comps, estimated_fees, estimated_size, part_building, part_interior,
                                  part_light, renter_rating, score_all, score_listing)

TODAY = dt.date(2026, 10, 13)


def crit(**over):
    c = {"search": {"city": "nyc"}, "budget": {"tiers": [{"name": "Target", "max": 5000}], "hard_max": 5450},
         "unit": {"min_beds": 1, "sqft_floor": 450, "sqft_good": 750, "sqft_great": 1050},
         "must_have": [], "strongly_prefer": [], "nice_to_have": [], "commute": {"destinations": []},
         "weights": {**DEFAULT_WEIGHTS, "interior": 10}, "scoring": {}, "building_ratings": {}}
    c.update(over)
    return c


def unit(i, building="Tower", **kw):
    base = {"id": i, "building": building, "bin": "", "status": "new", "beds": 1,
            "price": {"gross": 4800}, "amenities": {"doorman": "full-time"}}
    base.update(kw)
    return base


def pool(n=10, building="Elsewhere", fee=100.0):
    return [unit(f"p{i}", building=f"{building} {i}", sqft=600 + 20 * i,
                 price={"gross": 4500, "fees_monthly": fee}) for i in range(n)]


def test_unknown_size_uses_the_same_building_first():
    rows = [unit("a", sqft=540), unit("b", sqft=560), unit("c")] + pool()
    est = estimated_size(rows[2], build_comps(rows))
    assert est["sqft"] == 550 and "building" in est["label"]


def test_unknown_size_falls_back_to_the_lower_middle_of_the_search():
    rows = pool() + [unit("x", building="Nowhere")]
    est = estimated_size(rows[-1], build_comps(rows))
    sizes = sorted(600 + 20 * i for i in range(10))
    assert sizes[0] < est["sqft"] < sorted(sizes)[5]        # 40th percentile: below the median
    assert est["range"][0] < est["sqft"] < est["range"][1]


def test_unknown_size_no_longer_beats_a_documented_modest_size():
    rows = pool() + [unit("known", building="K", sqft=715), unit("hidden", building="H")]
    score_all(rows, crit(), TODAY)
    known, hidden = rows[-2]["score"]["parts"]["space"], rows[-1]["score"]["parts"]["space"]
    assert hidden is not None and hidden < known
    assert "size_imputed" in rows[-1]["score"]["flags"]


def test_unknown_fees_are_estimated_from_comparable_buildings():
    rows = pool(fee=120.0) + [unit("nofee", building="N")]
    comps = build_comps(rows)
    s = score_listing(rows[-1], crit(), TODAY, comps)
    assert s["monthly_cost"] == 4800 + 120
    assert s["cost"]["fees_estimate"]["monthly"] == 120
    assert "fees_estimated" in s["flags"]
    # a listing that documents its fee is not estimated
    doc = unit("doc", building="D", price={"gross": 4800, "fees_monthly": 37})
    assert score_listing(doc, crit(), TODAY, comps)["monthly_cost"] == 4837


def test_condo_one_time_fees_are_estimated_when_unknown():
    condos = [unit(f"c{i}", building=f"Alpha Condominium {i}", price={"gross": 4000, "fees_one_time": 1200.0 + 100 * i,
                                                                    "fees_monthly": 0}) for i in range(4)]
    rows = condos + pool() + [unit("new", building="Beta Condominium", price={"gross": 4000, "fees_monthly": 0})]
    est = estimated_fees(rows[-1], {"monthly": 4000, "fees_known": True}, build_comps(rows))
    assert est and round(est["monthly"]) == round(1350 / 12)


def test_renter_rating_leads_the_building_score():
    c = crit(building_ratings={"The Horizon": 2, "Paramount Tower": 5})
    good = {"building": "Paramount Tower", "building_facts": {"year_built": 1997, "floors": 52},
            "amenities": {"doorman": "full-time"}, "records": {"risk_score": 90}}
    bad = {**good, "building": "Horizon Condominium"}
    assert renter_rating(bad, c) == (2.0, "The Horizon")
    assert part_building(good, c).value > 85 > 60 > part_building(bad, c).value
    assert "renter_rated" in part_building(good, c).flags


def test_building_quality_without_a_rating_is_more_than_violations():
    new_tower = {"building_facts": {"year_built": 2018, "floors": 45}, "amenities": {"doorman": "full-time",
                 "gym": True, "pool": True, "roof_deck": True, "lounge": True}, "records": {"risk_score": 60}}
    old_walkup = {"building_facts": {"year_built": 1925, "floors": 5}, "amenities": {"doorman": "none"},
                  "records": {"risk_score": 95}}
    assert part_building(new_tower).value > part_building(old_walkup).value


def test_interior_from_photo_grades_and_from_wording():
    lux = part_interior({"photo_review": {"interior": 5, "kitchen": 5, "bath": 5, "renovation": "new-or-recent",
                                          "appliances": "premium", "scope": "unit", "confidence": "high"}})
    dated = part_interior({"photo_review": {"interior": 2, "kitchen": 2, "bath": 2, "renovation": "dated",
                                            "appliances": "dated", "scope": "unit", "confidence": "high"}})
    assert lux.value == 100 and dated.value < 20
    staged = part_interior({"photo_review": {"interior": 5, "scope": "staged-or-rendered", "confidence": "low"}})
    assert 50 < staged.value < 100 and "interior_staged" in staged.flags
    text = part_interior({"features": {"kitchen": "Newly renovated with Miele appliances"}})
    assert text.value > 60 and "interior_from_text" in text.flags
    assert part_interior({}).value is None
    assert part_interior({"photo_review": {"scope": "building-only", "building_luxury": 4}}).value is None


def test_photo_view_blends_into_light():
    base = {"floor": 24, "exposure": ["S"]}
    plain = part_light(base).value
    wall = part_light({**base, "photo_review": {"view": 1, "natural_light": 2, "scope": "unit"}}).value
    open_ = part_light({**base, "photo_review": {"view": 5, "natural_light": 5, "scope": "unit"}}).value
    assert wall < plain < open_
    assert part_light({"photo_review": {"view": 4, "scope": "unit"}}).value == 75
