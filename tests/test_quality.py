"""validate, lint, coverage, questions and watchlist on small synthetic listings (no network)."""
import json

import pytest

from apartmentscout.config import DEFAULT_WEIGHTS
from apartmentscout.listings import normalize
from apartmentscout.quality.coverage import coverage, receipt_reconciles
from apartmentscout.quality.lint import is_challenge_page, lint_listing, rule_codes
from apartmentscout.quality.standard import assess, known_facts
from apartmentscout.quality.validate import summarise, validate, validate_document
from apartmentscout.quality.watchlist import watchlist
from apartmentscout.questions import inquiry, questions

TODAY = "2026-10-13"


def crit(**over):
    c = {"search": {"move_in": {"earliest": "2026-10-15", "latest": "2026-11-01"}, "map_center": [40.75, -73.98]},
         "budget": {"tiers": [{"name": "Target", "max": 5000}, {"name": "Stretch", "max": 5200}], "hard_max": 5450},
         "unit": {"min_beds": 1, "sqft_floor": 450, "sqft_good": 750, "sqft_great": 1050},
         "must_have": ["in_unit_wd", "elevator"], "strongly_prefer": ["doorman"], "nice_to_have": [],
         "commute": {"destinations": [{"name": "Work", "max_minutes": 30, "weight": 1}]},
         "weights": dict(DEFAULT_WEIGHTS)}
    c.update(over)
    return c


def unit(**kw):
    u = str(kw.get("unit", "5A")).lower()
    base = {"id": "tower-5a", "building": "Tower", "unit": "5A", "address": "100 West 50th Street, New York, NY",
            "lat": 40.761, "lon": -73.981, "beds": 1, "status": "researching", "checked": "2026-10-12",
            "price": {"gross": 4800, "free_months": 0, "lease_months": 12},
            "amenities": {"in_unit_wd": True, "elevator": True},
            "links": {"listing": f"https://streeteasy.com/building/100-west-50th-street-new_york/{u}"}}
    for k, v in kw.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            base[k] = {**base[k], **v}
        else:
            base[k] = v
    return base


def codes(issues):
    return {i.code for i in issues}


# --------------------------------------------------------------------------- validate
def test_validate_clean_listing_passes():
    issues = validate([unit()], crit(), today=TODAY)
    assert summarise(issues)["error"] == 0
    assert not [i for i in issues if i.severity == "warn"]


@pytest.mark.parametrize("patch, code", [
    ({"status": "available"}, "bad_status"),
    ({"price": {"gross": -5}}, "impossible_price"),
    ({"price": {"gross": 120}}, "impossible_price"),
    ({"price": {"gross": 950000}}, "impossible_price"),
    ({"price": {"gross": 5000, "net_effective": 5200}}, "net_above_gross"),
    ({"price": {"free_months": 12, "lease_months": 12}}, "bad_free_months"),
    ({"price": {"gross": 5250, "free_months": 1, "lease_months": 12, "net_effective": 4700}}, "net_mismatch"),
    ({"amenities": {"doorman": "sometimes"}}, "bad_doorman"),
    ({"exposure": ["SOUTH"]}, "bad_exposure"),
    ({"beds": 14}, "out_of_range"),
    ({"lat": 40.5, "lon": -75.2}, "outside_search_area"),
    ({"lat": 0.0, "lon": 0.0}, "bad_coordinates"),
    ({"lat": 40.7, "lon": None}, "half_coordinates"),
    ({"links": {"listing": "javascript:alert(1)"}}, "bad_url"),
    ({"photos": ["media/../../etc/passwd"]}, "bad_url"),
    ({"checked": "2027-01-01"}, "future_check"),
    ({"price": {"fees_monthly": -10}}, "negative_fee"),
    ({"building_photos": [{"url": "https://x.org/a.jpg", "scope": "nearby"}]}, "bad_photo_scope"),
    ({"status": "gone", "score": {"rank": 1}}, "inactive_ranked"),
    ({"availability": {"state": "maybe"}}, "bad_availability"),
])
def test_validate_rule(patch, code):
    assert code in codes(validate([unit(**patch)], crit(), today=TODAY))


def test_validate_duplicates_and_aliases():
    a = unit()
    b = unit(id="tower-05a", unit="05A", links=a["links"])   # same physical unit and page, different id
    d = unit(id="tower-5a")                         # duplicate id
    cs = codes(validate([a, b, d], crit(), today=TODAY))
    assert {"duplicate_id", "duplicate_unit", "duplicate_url"} <= cs
    # once declared as aliases (listings.merge_aliases folds them) they are not duplicates
    b2 = unit(id="tower-05a", unit="05A", aliases=["tower-5a"])
    cs = codes(validate([a, b2], crit(), today=TODAY))
    assert not {"duplicate_unit", "duplicate_url"} & cs
    assert "alias_unknown_id" in codes(validate([unit(aliases=["nope"])], crit(), today=TODAY))
    assert "bad_claims" in codes(validate([unit(claims=[{"value": 1}])], crit(), today=TODAY))


def test_validate_shared_building_page_is_not_a_duplicate():
    a = unit(links={"listing": "https://tower.example/availability"})
    b = unit(id="tower-6b", unit="6B", links={"listing": "https://tower.example/availability"})
    assert "duplicate_url" not in codes(validate([a, b], crit(), today=TODAY))


def test_validate_missing_local_file(tmp_path):
    (tmp_path / "media").mkdir()
    (tmp_path / "media" / "ok.jpg").write_bytes(b"x")
    L = unit(photos=["media/ok.jpg", "media/missing.jpg"])
    issues = validate([L], crit(), root=tmp_path, today=TODAY)
    assert [i.field for i in issues if i.code == "missing_file"] == ["photos[1]"]


def test_validate_document_schema_version():
    assert validate_document([]) == []
    assert {i.code for i in validate_document({"listings": []})} == {"schema_version_missing"}
    assert {i.code for i in validate_document({"schema_version": 99, "listings": []})} == {"schema_version_newer"}
    assert {i.code for i in validate_document({"rows": []})} == {"bad_document"}


# --------------------------------------------------------------------------- lint
def flagged(L, c=None, **ctx):
    return {f.code: f for f in lint_listing(L, c or crit(), {"today": __import__("datetime").date(2026, 10, 13), **ctx})}


def test_lint_clean_listing():
    assert flagged(unit()) == {}


@pytest.mark.parametrize("notes, code", [
    ("Junior 1BR with a sleeping alcove.", "junior_or_flex_1br"),
    ("Flexed one-bedroom with a pressurized wall.", "junior_or_flex_1br"),
    ("Portal lists it as a studio + alcove.", "junior_or_flex_1br"),
    ("Laundry room in the building; renovated kitchen.", "building_laundry_as_in_unit"),
    ("Just a moment... Checking your browser before accessing", "challenge_page_evidence"),
    ("Price reduced by $150 this week.", "fee_is_price_drop"),
    ("Two months free only for leases starting before 9/15.", "concession_expired_by_start"),
    ("StreetEasy floor plan image is labeled Unit 9Y.", "plan_label_mismatch"),
    ("Text from a cached copy of the page (web reader).", "stale_or_cached_page"),
    ("Some photos are virtually staged.", "photos_not_this_unit"),
])
def test_lint_text_rules(notes, code):
    L = unit(notes=notes, price={"fees_monthly": 150} if code == "fee_is_price_drop" else {},
             unit="13Y1" if code == "plan_label_mismatch" else "5A")
    assert code in flagged(L)


def test_lint_negations_and_false_friends():
    # building rules about walls, a dining alcove, a fitness studio and a flexible lease are not layout traps
    L = unit(notes="No flex walls allowed. Dining alcove, fitness studio, flexible lease terms, in-unit washer/dryer.")
    assert "junior_or_flex_1br" not in flagged(L)
    # a 1BR that can flex to a 2BR is still a real 1BR; counted as 2 beds it is a trap
    assert "junior_or_flex_1br" not in flagged(unit(notes="Large 1BR, flex 2 possible."))
    assert "junior_or_flex_1br" in flagged(unit(beds=2, notes="Flex 2 with a pressurised wall."))


def test_lint_laundry_only_when_marked_in_unit():
    text = "Laundry room in the building."
    assert "building_laundry_as_in_unit" not in flagged(unit(notes=text, amenities={"in_unit_wd": None}))
    f = flagged(unit(notes=text + " Washer/dryer in unit."))["building_laundry_as_in_unit"]
    assert f.severity == "med"   # both claims present: confirm rather than reject


def test_lint_fee_equal_to_price_history_drop():
    L = unit(price={"gross": 4800, "fees_monthly": 200}, price_history=[{"date": "2026-10-01", "gross": 5000}])
    assert flagged(L)["fee_is_price_drop"].field == "price.fees_monthly"
    assert "fee_is_price_drop" in flagged(unit(price={"gross": 4800, "fees_one_time": 200}), gross_claims=[5000])


def test_lint_url_names_other_building():
    L = unit(address="1460 Lexington Avenue, New York, NY",
             links={"listing": "https://streeteasy.com/building/1510-lexington-avenue-new_york/5a"})
    assert flagged(L)["url_names_other_building"].severity == "high"
    ok = unit(address="1760 Second Avenue, New York, NY",
              links={"listing": "https://streeteasy.com/building/1760-2-avenue-new_york/5a"})
    assert "url_names_other_building" not in flagged(ok)
    alias = unit(address="1460 Lexington Avenue", address_aliases=["1510 Lexington Ave"],
                 links={"listing": "https://streeteasy.com/building/1510-lexington-avenue-new_york/5a"})
    assert "url_names_other_building" not in flagged(alias)
    other_unit = unit(links={"listing": "https://streeteasy.com/building/100-west-50th-street-new_york/17b"})
    assert flagged(other_unit)["url_names_other_building"].severity == "med"


def test_lint_sale_listing():
    assert "sale_not_rental" in flagged(unit(links={"listing": "https://streeteasy.com/sale/1234567"}))
    assert "sale_not_rental" in flagged(unit(price={"gross": 895000}))


def test_lint_stale_check():
    f = flagged(unit(checked="2026-09-20"))["stale_or_cached_page"]
    assert f.field == "checked" and "23 days" in f.message
    assert "stale_or_cached_page" not in flagged(unit(checked="2026-09-20", status="gone"))


def test_lint_concession_rules():
    L = unit(price={"gross": 5200, "free_months": 1, "lease_months": None})
    assert flagged(L)["concession_term_unstated"].severity == "high"
    L = unit(price={"gross": 5200, "free_months": None, "lease_months": None}, notes="Two months free!")
    assert flagged(L)["concession_term_unstated"].severity == "med"
    L = unit(price={"concession": {"conditions": [{"type": "start_before", "value": "2026-10-01"}]}})
    assert "concession_expired_by_start" in flagged(L)
    late_ok = unit(price={"free_months": 1}, notes="1 month free if you start by Nov 30.")
    assert "concession_expired_by_start" not in flagged(late_ok)


def test_lint_zero_fee_is_unknown():
    assert "zero_fee_asserted" in flagged(unit(price={"fees_monthly": 0}))
    assert "zero_fee_asserted" not in flagged(unit(price={"fees_monthly": 0, "fees_basis": "fee_schedule"}))


def test_lint_plan_line_label_is_representative():
    f = flagged(unit(unit="23J", plan={"printed_label": "J"}))["plan_label_mismatch"]
    assert f.severity == "low"
    assert flagged(unit(), plan={"provenance": {"match": "mismatch"}})["plan_label_mismatch"].severity == "high"


def test_lint_snapshot_files_checked_for_bot_walls():
    assert "challenge_page_evidence" in flagged(unit(), snapshots=[("a.html", "<title>Attention Required! | Cloudflare</title>")])
    assert is_challenge_page("Pardon Our Interruption") and not is_challenge_page("Spacious one bedroom")


def test_lint_every_rule_has_a_code():
    assert len(rule_codes()) == len(set(rule_codes())) >= 11


# --------------------------------------------------------------------------- standard, questions
def complete_unit(**kw):
    return unit(**kw, sqft=700, floor=5, exposure=["S"], bedroom_enclosed=True,
                price={"fees_monthly": 50, "fees_one_time": 500}, available="2026-10-15",
                links={"floorplan": "https://x.org/plan.pdf"}, photos=["https://x.org/1.jpg"],
                commute={"Work": {"minutes": 20}}, reviews={"summary": "fine"})


def test_standard_complete_and_stale():
    c = crit()
    a = assess(complete_unit(), c, __import__("datetime").date(2026, 10, 13))
    assert a["missing"] == [] and a["stale"] == []
    a = assess(complete_unit() | {"checked": "2026-09-01"}, c, __import__("datetime").date(2026, 10, 13))
    assert set(a["stale"]) == {"rent", "concession", "fees", "start_date", "status"}
    assert not set(a["stale"]) & set(a["have"])


def test_standard_unknowns():
    k = known_facts(unit(price={"gross": 5000, "free_months": 1, "lease_months": None}, floor=5, floor_inferred=True), crit())
    assert not k["concession"] and not k["fees"] and not k["floor"] and not k["size"]
    # an itemised schedule counts; $0 is the data model's "no fees" (lint asks for its source)
    assert known_facts(unit(price={"fees": [{"name": "amenity", "amount": 85, "period": "monthly"}]}), crit())["fees"]
    assert known_facts(unit(size={"basis": "line_band_plan", "range": [600, 690]}), crit())["size"]


def test_questions_only_for_gaps_and_gates_first():
    L = unit(amenities={"in_unit_wd": None}, price={"fees_monthly": None})
    qs = questions(L, crit(), today=TODAY)
    keys = [q["key"] for q in qs]
    assert keys[0] == "must_have:in_unit_wd"
    assert "fees" in keys and "size" in keys
    assert "rent" not in keys                       # known and fresh: never asked
    assert all(q["group"] in ("confirm in writing", "show me", "tour test") for q in qs)
    assert not [q for q in questions(complete_unit(), crit(), today=TODAY)]


def test_questions_from_flags_and_inquiry():
    L = unit(notes="Two months free only for leases starting before 9/15.", price={"free_months": 2, "lease_months": 14})
    from apartmentscout.quality.lint import lint_listing as ll
    import datetime as dt
    fl = ll(L, crit(), {"today": dt.date(2026, 10, 13)})
    qs = questions(L, crit(), flags=fl, today=TODAY)
    assert any("still apply to a lease starting October 15" in q["text"] for q in qs)
    msg = inquiry(L, crit(), today=TODAY)
    assert msg.startswith("Hello") and "unit 5A" in msg and "On the visit" not in msg


# --------------------------------------------------------------------------- coverage
def test_coverage_document_and_priorities():
    c = crit()
    Ls = [normalize(x) for x in [
        complete_unit(id="done", unit="1A", status="shortlist"),
        unit(id="gap", unit="2B", sqft=None, status="shortlist"),
        unit(id="far", unit="3C", price={"gross": 5400}),
        unit(id="old", unit="4D", status="gone"),
    ]]
    doc = coverage(Ls, c, today=TODAY)
    assert set(doc) >= {"standard", "listings", "sources", "summary", "claim"}
    assert "not a market census" in doc["claim"]
    rows = doc["listings"]
    assert rows["done"]["missing"] == [] and rows["done"]["questions"] == []
    assert "size" in rows["gap"]["missing"]
    assert rows["gap"]["score_impact"] > 0 and rows["gap"]["gaps"][0]["key"] == "size"
    assert rows["gap"]["priority"] == 1                       # finalist with open facts goes first
    assert rows["old"]["priority"] == 4 and rows["old"]["questions"] == []
    s = doc["summary"]
    assert (s["listings"], s["active"], s["complete"]) == (4, 3, 1)
    assert s["missing_size"] == 2 and s["missing_fees"] == 2
    assert doc["sources"][0]["name"] == "StreetEasy" and doc["sources"][0]["listings"] == 4
    assert doc["sources"][0]["checked"] == "2026-10-12"
    json.dumps(doc)  # serialisable


def test_coverage_unknown_size_never_counts_as_small():
    c = crit()
    Ls = [normalize(unit(id="small", unit="1A", sqft=460)), normalize(unit(id="unknown", unit="2B"))]
    rows = coverage(Ls, c, today=TODAY)["listings"]
    # the unknown unit's best case beats the small one; its worst case is no better than the floor
    assert rows["unknown"]["rank_range"][0] == 1


def test_sweep_receipts(tmp_path):
    (tmp_path / "research").mkdir()
    rows = [{"source": "StreetEasy", "observed_count": 50, "unique_ids": 40, "duplicates": 5, "excluded": 4, "failed": 1,
             "pages": 3, "pages_captured": 3, "checked": "2026-10-10"},
            {"source": "RentHop", "observed_count": 20, "unique_ids": 10, "pages": 2, "pages_captured": 1}]
    (tmp_path / "research" / "sweeps.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    assert receipt_reconciles(rows[0]) and not receipt_reconciles(rows[1])
    src = {s["name"]: s for s in coverage([normalize(unit())], crit(), root=tmp_path, today=TODAY)["sources"]}
    assert src["StreetEasy"]["state"] == "complete" and src["RentHop"]["state"] == "incomplete"


# --------------------------------------------------------------------------- watchlist
def test_watchlist_from_criteria_and_listings():
    c = crit(watchlist=[{"name": "Tower", "address": "100 W 50th St", "reason": "great plans", "trigger": "1BR < $5k",
                         "last_checked": "2026-10-01"}])
    Ls = [normalize(unit()), normalize(unit(id="tower-6b", unit="6B", status="gone")),
          normalize(unit(id="annex-1", building="Annex", address="20 Elm St", unit="1", watch={"reason": "cheap"}))]
    doc = watchlist(Ls, c, events=[{"id": "tower-6b", "type": "new", "date": "2026-10-12"}], today=TODAY)
    b = {x["name"]: x for x in doc["buildings"]}
    assert b["Tower"]["units_seen"] == 2 and b["Tower"]["active_units"] == 1
    assert b["Tower"]["last_checked"] == "2026-10-12" and b["Tower"]["reason"] == "great plans"
    assert b["Tower"]["new_units"] == ["tower-6b"]
    assert b["Annex"]["reason"] == "cheap" and b["Annex"]["source"] == ["listing"]
    assert watchlist([normalize(unit())], crit(), today=TODAY)["note"]


def test_lint_concession_offer_end_date():
    L = unit(price={"free_months": 1, "concession": {"conditions": [{"type": "sign_by", "value": "2026-10-01"}]}})
    assert flagged(L)["concession_expired_by_start"].field == "price.concession"
    L = unit(price={"free_months": 1, "concession": {"conditions": [{"type": "lease_start_by", "value": "2026-10-10"}]}})
    assert "concession_expired_by_start" in flagged(L)


def test_lint_fee_equal_to_listing_claim_drop():
    L = unit(price={"gross": 4800, "fees_monthly": 100},
             claims=[{"field": "gross", "value": 4900, "source": "portal", "observed_at": "2026-10-01"}])
    assert "fee_is_price_drop" in flagged(L)


# --------------------------------------------------------------------------- shared locations
def test_validate_flags_many_buildings_on_one_coordinate_and_bbl():
    spot = {"lat": 40.702908, "lon": -74.01398, "bbl": "1000090014", "address": ", New York, NY"}
    rows = [unit(id=f"b{i}-1a", building=name, **spot) for i, name in enumerate(["Lyra", "MiMA", "70 Pine"])]
    issues = [i for i in validate(rows, crit(), today=TODAY) if i.code == "shared_location"]
    assert {i.field for i in issues} == {"lat", "bbl"}
    assert "3 listings in 3 different buildings" in issues[0].message


def test_validate_does_not_flag_one_building_under_several_spellings():
    spot = {"lat": 40.7477, "lon": -73.9821, "bbl": "1008640028"}
    rows = [unit(id="k-1", building="The Knox", address="49 East 34th Street, New York, NY", **spot),
            unit(id="k-2", building="The Knox", address="49 East 34 St, New York, NY", **spot),
            unit(id="k-3", building="Knox Tower", address="49 East 34 St, New York, NY", **spot)]
    assert not [i for i in validate(rows, crit(), today=TODAY) if i.code == "shared_location"]


def test_validate_two_buildings_on_one_tax_lot_is_fine():
    rows = [unit(id="w2-1", building="Two Worldwide Plaza", address="350 West 50 St, New York, NY", bbl="1010407501"),
            unit(id="w3-1", building="Three Worldwide Plaza", address="393 West 49 St, New York, NY", bbl="1010407501")]
    assert not [i for i in validate(rows, crit(), today=TODAY) if i.code == "shared_location"]
