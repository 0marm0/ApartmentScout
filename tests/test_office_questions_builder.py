"""Leasing-office question drafts: per building, deduplicated, grouped by unit, never sent, nothing personal in them."""
import copy
import json
import urllib.parse
from pathlib import Path

import pytest

from apartmentscout.cli import main
from apartmentscout.config import DEFAULT_WEIGHTS, Workspace
from apartmentscout.handoff.safety import compile_patterns, privacy_hits
from apartmentscout.listings import normalize
from apartmentscout.office_questions import (
    SIGNOFF, assemble_units, building_drafts, default_selection, expand_document, export_document, interest_reasons,
    live_disagreements, mailto, render_markdown, render_text, subject, unit_questions)
from apartmentscout.quality.workspace import load_listings

TODAY = "2026-10-15"
ROOT = Path(__file__).resolve().parents[1] / "examples" / "nyc-2026"


def crit():
    return {"search": {"move_in": {"earliest": "2026-10-15", "latest": "2026-11-01"}, "map_center": [40.75, -73.98]},
            "budget": {"tiers": [{"name": "Target", "max": 5000}, {"name": "Stretch", "max": 5400}], "hard_max": 5600},
            "unit": {"min_beds": 1, "sqft_floor": 450, "sqft_good": 750, "sqft_great": 1050},
            "must_have": ["in_unit_wd", "elevator"], "strongly_prefer": [], "nice_to_have": [],
            "commute": {"destinations": []}, "weights": dict(DEFAULT_WEIGHTS)}


def unit(uid="tower-6b", u="6B", **kw):
    base = {"id": uid, "building": "The Tower", "unit": u, "address": "10 Example Street, New York, NY", "beds": 1,
            "status": "touring", "checked": "2026-10-14", "sqft": 640, "floor": 6, "exposure": ["S"],
            "available": "2026-10-20", "bedroom_enclosed": True,
            "price": {"gross": 5250, "free_months": 1, "lease_months": 10, "fees_monthly": 135, "fees_one_time": 0,
                      "basis": "leasing_office", "checked": "2026-10-14"},
            "amenities": {"in_unit_wd": True, "elevator": True},
            "links": {"listing": f"https://streeteasy.com/building/example/{u.lower()}", "floorplan": "plans/x.png"},
            "photos": ["a.jpg"], "reviews": {"summary": "ok"}}
    base.update(kw)
    return normalize(base)


def knox_dispute() -> dict:
    return unit(price={"gross": 5250, "free_months": 1, "lease_months": 10, "fees_monthly": 135, "fees_one_time": 0,
                       "basis": "leasing_office", "checked": "2026-09-29"},
                claims=[{"source": "StreetEasy building page", "observed_at": "2026-09-29",
                         "price": {"gross": 5300, "free_months": 0.75, "lease_months": 10}}])


def by_topic(qs):
    return {q["topic"]: q for q in qs}


# ---------------------------------------------------------------- one unit
def test_price_dispute_names_both_readings_and_asks_for_writing():
    q = by_topic(unit_questions(knox_dispute(), crit(), today=TODAY))["price"]
    assert q["kind"] == "dispute" and q["scope"] == "unit"
    t = q["text"]
    assert "StreetEasy building page" in t and "$5,300 a month with 0.75 months free on a 10-month lease" in t
    assert "I was quoted $5,250 a month with 1 month free on a 10-month lease" in t
    assert "September 29" in t and "in writing" in t
    assert q["fields"] == ["price.gross", "price.free_months", "price.lease_months", "price.net_effective"]
    assert any("5,300" in e for e in q["evidence"]) and any("5,250" in e for e in q["evidence"])


def test_a_dispute_replaces_the_rent_concession_and_availability_questions():
    topics = by_topic(unit_questions(knox_dispute(), crit(), today=TODAY))
    assert "price" in topics and not {"concession", "availability"} & set(topics)


def test_superseded_and_agreeing_claims_are_not_disputes():
    L = unit(claims=[{"source": "old page", "status": "superseded", "price": {"gross": 5800}},
                     {"source": "same page", "price": {"gross": 5250}}])
    assert live_disagreements(L) == []
    assert "dispute" not in {q["kind"] for q in unit_questions(L, crit(), today=TODAY)}


def test_a_field_style_claim_is_a_dispute_too():
    L = unit(claims=[{"source": "Leasebreak", "observed_at": "2026-10-10", "field": "price.gross", "value": 5400}])
    q = by_topic(unit_questions(L, crit(), today=TODAY))["price"]
    assert q["kind"] == "dispute" and "$5,400 a month" in q["text"] and "Leasebreak" in q["text"]


def test_a_weak_price_asks_whether_it_is_still_available_at_that_rent():
    L = unit(price={"gross": 4100, "basis": "search_snippet", "checked": "2026-09-28"}, checked="2026-09-28")
    q = by_topic(unit_questions(L, crit(), today=TODAY))["price"]
    assert q["kind"] == "verify" and "search-result listing showed $4,100 a month" in q["text"]
    assert "still available at that rent" in q["text"]


def test_complete_fresh_unit_has_nothing_to_ask_but_the_always_open_items():
    L = unit(price={"gross": 5250, "free_months": 1, "lease_months": 10, "fees_monthly": 135, "fees_one_time": 0,
                    "basis": "unit_page", "checked": "2026-10-14"})
    topics = {q["topic"] for q in unit_questions(L, crit(), today=TODAY)}
    assert not topics & {"price", "fees", "move_in", "size", "floor", "in_unit_wd", "identity"}


def test_inferred_floor_and_estimated_size_are_asked_with_what_we_hold():
    L = unit(sqft=None, floor_inferred=True)
    L["score"] = {"flags": ["size_estimated", "floor_inferred"], "gates": []}
    t = by_topic(unit_questions(L, crit(), today=TODAY))
    assert "taken from the unit number" in t["floor"]["text"] and "6" in t["floor"]["text"]
    assert "only have an estimate" in t["size"]["text"]


def test_unverified_in_unit_wd_is_asked_once():
    L = unit(amenities={"in_unit_wd": None, "elevator": True})
    L["score"] = {"gates": ["unverified:in_unit_wd"], "flags": []}
    qs = [q for q in unit_questions(L, crit(), today=TODAY) if q["topic"] == "in_unit_wd"]
    assert len(qs) == 1 and "washer and dryer inside the unit" in qs[0]["text"]


def test_known_fees_are_confirmed_unknown_fees_are_listed():
    known = by_topic(unit_questions(unit(checked="2026-09-01"), crit(), today=TODAY))["fees"]
    assert known["scope"] == "unit" and "$135" in known["text"]
    L = unit()
    L["price"].pop("fees_monthly")
    unknown = by_topic(unit_questions(L, crit(), today=TODAY))["fees"]
    assert unknown["scope"] == "building" and "every required monthly charge" in unknown["text"]


def test_dates_in_the_text_are_plain_words():
    t = by_topic(unit_questions(unit(available=None, checked="2026-09-01"), crit(), today=TODAY))["start"]["text"]
    assert "2026-" not in t and "October 15" in t


# ---------------------------------------------------------------- one building
def building(**kw):
    return [unit("tower-6b", "6B", **kw), unit("tower-7ba", "7BA", status="shortlist"),
            unit("other-1a", "1A", building="Other", address="99 Other Avenue, New York, NY", status="new")]


def test_only_units_of_interest_are_asked_about():
    drafts = building_drafts(building(), crit(), today=TODAY)
    assert [d["building"] for d in drafts] == ["The Tower"]
    assert {u["unit"] for u in drafts[0]["units"]} == {"6B", "7BA"}


def test_top_ranked_favourite_and_selected_units_count_and_gone_ones_do_not():
    Ls = building()
    Ls[2]["score"] = {"rank": 3}
    assert interest_reasons(Ls[2], 10) == ["top-ranked"]
    assert interest_reasons(Ls[2], 2) == []
    Ls[2]["favorite"] = True
    assert interest_reasons(Ls[2], 2) == ["favorite"]
    assert interest_reasons({**Ls[2], "status": "gone"}, 10) == []
    assert "selected" in interest_reasons(Ls[2], 0, ["other-1a"])
    drafts = building_drafts(Ls, crit(), units=["1a"], today=TODAY)           # named by unit number: only that unit
    assert [(d["building"], [u["unit"] for u in d["units"]]) for d in drafts] == [("Other", ["1A"])]


def test_building_filter_matches_name_address_and_key():
    for q in ("tower", "10 example", "Example Street"):
        assert [d["building"] for d in building_drafts(building(), crit(), building=q, today=TODAY)] == ["The Tower"]
    assert building_drafts(building(), crit(), building="nowhere", today=TODAY) == []


def test_same_question_for_two_units_is_asked_once_for_both():
    Ls = [unit("tower-6b", "6B", checked="2026-09-01"), unit("tower-7ba", "7BA", checked="2026-09-01")]
    d = building_drafts(Ls, crit(), today=TODAY)[0]
    fees = [s for s in d["shared"] if s["topic"] == "fees"]
    assert len(fees) == 1 and fees[0]["units"] == ["6B", "7BA"] and fees[0]["unit_ids"] == ["tower-6b", "tower-7ba"]
    assert "For 6B and 7BA: I have required monthly fees of $135." in d["text"]
    assert d["text"].count("required monthly fees") == 1


def test_building_wide_questions_come_first_and_each_unit_has_its_block():
    Ls = [knox_dispute(), unit("tower-7ba", "7BA", checked="2026-09-01")]
    d = building_drafts(Ls, crit(), today=TODAY)[0]
    t = d["text"]
    assert [u["unit"] for u in d["units"]] == ["6B", "7BA"] or [u["unit"] for u in d["units"]] == ["7BA", "6B"]
    assert t.index("Across these units") < t.index("Unit 6B") < t.index("Unit 7BA") or t.index("Unit 7BA") < t.index("Unit 6B")
    assert t.startswith("Hello,") and t.rstrip().endswith(f"Thank you,\n{SIGNOFF}")
    assert d["subject"] == "Questions about units 6B and 7BA at The Tower"
    nums = [int(line.split(".")[0]) for line in t.splitlines() if line[:1].isdigit()]
    assert nums == list(range(1, len(nums) + 1))                                   # numbered once, in order


def test_a_single_unit_draft_says_about_the_building():
    d = building_drafts([knox_dispute()], crit(), today=TODAY)[0]
    assert "I'm interested in unit 6B at The Tower (10 Example Street)." in d["text"]
    assert d["subject"] == "Questions about unit 6B at The Tower"


def test_selection_answered_and_standard_questions():
    d = building_drafts([knox_dispute()], crit(), today=TODAY)[0]
    price_id = "tower-6b:price"
    assert price_id in d["selected"] and not any(s.startswith("standard:") for s in d["selected"])
    without = render_text(d, [i for i in d["selected"] if i != price_id])
    assert "in writing, and that the unit is still available" not in without
    assert render_text(d, []) == ""
    with_std = building_drafts([knox_dispute()], crit(), standard=True, today=TODAY)[0]
    assert "early-termination" in with_std["text"] and "early-termination" not in d["text"]
    # an answered question leaves the next draft
    units = [{**u, "questions": unit_questions(knox_dispute(), crit(), today=TODAY)} for u in d["units"]]
    again = assemble_units(d["building_key"], d["building"], d["address"], units, answered=[price_id])
    assert price_id not in default_selection(again) and "StreetEasy building page" not in again["text"]


def test_markdown_and_mailto_carry_the_same_text():
    d = building_drafts([knox_dispute()], crit(), today=TODAY)[0]
    assert d["markdown"].startswith("## Questions about unit 6B at The Tower") and "**Unit 6B**" in d["markdown"]
    assert d["mailto"] == mailto(d) and d["mailto"].startswith("mailto:?subject=")
    q = urllib.parse.parse_qs(d["mailto"][len("mailto:?"):])
    assert q["subject"] == [d["subject"]] and q["body"][0].replace("\r\n", "\n") == d["text"]
    assert subject(d) == d["subject"] and render_markdown(d, []) == ""


# ---------------------------------------------------------------- privacy
def test_no_renter_detail_and_no_address_or_path_leaks_from_sources():
    L = knox_dispute()
    home = "/" + "Users" + "/jane"          # written in pieces so the privacy scan of the repository does not flag the test itself
    L["claims"][0]["source"] = f"renter pasted from {home}/Desktop/quote.pdf jane@example.org"
    L["price"]["basis"] = "renter_quote"
    d = building_drafts([L], crit(), today=TODAY)[0]
    text = d["text"] + d["markdown"] + json.dumps(d)
    assert not privacy_hits(text, compile_patterns()) and "/Users/" not in text and "jane" not in text
    assert "Another source shows" in d["text"] and SIGNOFF in d["text"]


def test_every_example_draft_passes_the_privacy_patterns():
    ws = Workspace(ROOT)
    for d in building_drafts(load_listings(ws), ws.criteria(), today=TODAY):
        assert not privacy_hits(d["text"] + d["markdown"], compile_patterns()), d["building"]
        assert d["text"].rstrip().endswith(SIGNOFF)


# ---------------------------------------------------------------- the bundled example
@pytest.fixture(scope="module")
def knox():
    ws = Workspace(ROOT)
    return next(d for d in building_drafts(load_listings(ws), ws.criteria(), building="knox", today=TODAY))


def test_knox_6b_price_dispute_is_in_the_knox_draft(knox):
    block = next(b for b in knox["by_unit"] if b["unit"] == "6B")
    q = next(q for q in block["questions"] if q["topic"] == "price")
    assert q["kind"] == "dispute"
    assert ("The StreetEasy building page shows $5,300 a month with 0.75 months free on a 10-month lease (seen September 29), "
            "and I was quoted $5,250 a month with 1 month free on a 10-month lease (September 29). "
            "Could you confirm the correct rent, free months and lease length in writing, and that the unit is still "
            "available?") == q["text"]
    assert "Unit 6B" in knox["text"] and q["text"] in knox["text"]


def test_knox_draft_groups_three_units_and_merges_shared_questions(knox):
    assert {u["unit"] for u in knox["units"]} == {"6B", "7BA", "13C"}
    assert knox["subject"].endswith("at The Knox") and "(49 East 34th Street)" in knox["text"]
    assert any(s["units"] == ["7BA", "6B"] and s["topic"] == "fees" for s in knox["shared"])
    # the superseded 13C public listing is not offered as a competing reading
    assert "5,825" not in knox["text"]


# ---------------------------------------------------------------- data file and command
def test_export_document_expands_back_to_the_unit_questions():
    Ls = [knox_dispute(), unit("tower-7ba", "7BA", sqft=None)]
    doc = export_document(Ls, crit(), today=TODAY)
    back = expand_document(doc)
    for L in Ls:
        assert back[L["id"]]["questions"] == unit_questions(L, crit(), today=TODAY)
    assert doc["schema"] == "apartmentscout-office-questions/1" and doc["signoff"] == SIGNOFF
    assert json.loads(json.dumps(doc)) == doc


def test_export_document_skips_closed_units():
    Ls = [knox_dispute(), unit("tower-7ba", "7BA", status="gone", sqft=None)]
    assert list(export_document(Ls, crit(), today=TODAY)["units"]) == ["tower-6b"]


@pytest.fixture()
def search(tmp_path: Path) -> Path:
    import shutil
    import yaml
    s = tmp_path / "s"
    s.mkdir()
    (s / "criteria.yaml").write_text(yaml.safe_dump(crit()))
    Ls = [knox_dispute(), unit("tower-7ba", "7BA", status="shortlist", sqft=None)]
    (s / "listings.json").write_text(json.dumps(Ls))
    return s


def test_cli_prints_text_md_and_json_and_sends_nothing(search: Path, capsys):
    main(["questions", "--search", str(search), "--as-of", TODAY])
    out = capsys.readouterr()
    assert "Subject: Questions about units 6B and 7BA at The Tower" in out.out and "Nothing was sent" in out.err
    main(["questions", "--search", str(search), "--as-of", TODAY, "--format", "md"])
    assert capsys.readouterr().out.startswith("## Questions about")
    main(["questions", "--search", str(search), "--as-of", TODAY, "--format", "json", "--units", "6B"])
    doc = json.loads(capsys.readouterr().out)
    assert doc["buildings"][0]["units"][0]["unit"] == "6B" and len(doc["buildings"][0]["units"]) == 1


def test_cli_without_anything_to_ask_exits_with_a_hint(search: Path):
    with pytest.raises(SystemExit) as e:
        main(["questions", "--search", str(search), "--building", "nowhere"])
    assert "No open questions" in str(e.value)


def test_cli_writes_a_file(search: Path, tmp_path: Path, capsys):
    out = tmp_path / "drafts" / "q.md"
    main(["questions", "--search", str(search), "--format", "md", "--out", str(out)])
    assert out.read_text().startswith("## Questions about")


def test_the_updates_entry_the_dashboard_writes_is_one_the_importer_accepts(search: Path, tmp_path: Path, capsys):
    """"Mark answered" copies this entry; `handoff import` adjudicates it like any other dated, sourced claim."""
    fx = json.loads((Path(__file__).parent / "fixtures" / "office-updates.json").read_text())
    Ls = json.loads((search / "listings.json").read_text())
    Ls[0]["id"] = fx["input"]["unit_id"]
    Ls[0]["price"].update({"gross": 5300, "free_months": 0.75, "checked": "2026-09-29"})
    Ls[0]["checked"] = "2026-09-29"
    (search / "listings.json").write_text(json.dumps(Ls))
    up = tmp_path / "updates.json"
    up.write_text(json.dumps(fx["doc"]))
    main(["handoff", "import", str(up), "--search", str(search), "--dry-run"])
    out = capsys.readouterr().out
    assert "price.gross" in out and "rejected" not in out.lower().replace("0 rejected", "")
    main(["handoff", "import", str(up), "--search", str(search)])
    capsys.readouterr()
    L = next(x for x in json.loads((search / "listings.json").read_text()) if x["id"] == fx["input"]["unit_id"])
    assert L["price"]["gross"] == 5250 and L["price"]["free_months"] == 1
    claim = L["claims"][-1]
    assert "leasing office reply" in claim["source"] and claim["checked"] == "2026-10-15" and claim["changes"]["price.gross"] == 5250


# ---------------------------------------------------------------- parity with dashboard/js/features/office-model.js
CASES =Path(__file__).parent / "fixtures" / "office-cases.json"


def office_cases() -> dict:
    """The fixture tests/js/office-model.test.mjs replays: a questions.json document, its expansion and drafts for several
    choices of units, answers and checked questions. Rewrite it with ``UPDATE_OFFICE_CASES=1 pytest tests/test_office_questions.py``."""
    Ls = [knox_dispute(), unit("tower-7ba", "7BA", checked="2026-09-01", status="shortlist", score={"rank": 2}),
          unit("tower-13c", "13C", checked="2026-09-01", sqft=None, status="touring", score={"rank": 5}),
          unit("tower-2d", "2D", checked="2026-09-01", status="new"),
          unit("other-1a", "1A", building="Other", address="99 Other Avenue, New York, NY", sqft=None, status="touring")]
    Ls[0]["score"] = {"rank": 1}
    doc = export_document(Ls, crit(), today=TODAY)
    entries = expand_document(doc)
    key = entries["tower-6b"]["building_key"]

    def case(name, ids, answered=(), standard=False, selected=None):
        units = [{k: v for k, v in entries[i].items() if k != "building_key"} for i in ids]
        d = assemble_units(key, entries[ids[0]]["building"], entries[ids[0]]["address"], units, answered=answered, standard=standard)
        sel = d["selected"] if selected is None else selected
        return {"name": name, "building_key": key, "units": list(ids), "answered": list(answered), "standard": standard,
                "selected": selected, "default_selection": d["selected"], "shared_ids": [s["id"] for s in d["shared"]],
                "subject": subject(d, sel), "text": render_text(d, sel)}

    fee_mk = next(q["mk"] for q in entries["tower-7ba"]["questions"] if q["topic"] == "fees")
    cases = [case("one unit with a price dispute", ["tower-6b"]),
             case("two units share a question", ["tower-6b", "tower-7ba"]),
             case("three units, one answered, standard terms on", ["tower-6b", "tower-7ba", "tower-13c"],
                  answered=["tower-6b:price", "tower-7ba:fees"], standard=True),
             case("a chosen subset", ["tower-6b", "tower-7ba"], selected=["tower-6b:price", "shared:" + fee_mk]),
             case("nothing chosen", ["tower-6b", "tower-7ba"], selected=[]),
             case("four units", ["tower-6b", "tower-7ba", "tower-13c", "tower-2d"], standard=True)]
    return {"doc": doc, "expanded": entries, "cases": cases}


def test_the_parity_fixture_is_current():
    import os
    fresh = office_cases()
    if os.environ.get("UPDATE_OFFICE_CASES"):
        CASES.write_text(json.dumps(fresh, indent=1, ensure_ascii=False) + "\n")
    assert json.loads(CASES.read_text()) == json.loads(json.dumps(fresh)), "run UPDATE_OFFICE_CASES=1 pytest tests/test_office_questions.py"
    assert any(c["text"] == "" for c in fresh["cases"]) and any("For 7BA and 13C" in c["text"] for c in fresh["cases"])
