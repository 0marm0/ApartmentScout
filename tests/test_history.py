"""Claims log, snapshots, diffs, availability ladder, exports and the CLI hooks (synthetic search folders)."""
import json

import pytest
import yaml

from apartmentscout.cli import main
from apartmentscout.config import DEFAULT_WEIGHTS, Workspace
from apartmentscout.quality.history import (append_claim, availability, diff_since, diff_snapshots, history_doc,
                                            make_claim, make_snapshot, read_claims, read_snapshots, should_snapshot,
                                            status_value, write_snapshot)

CRIT = {"search": {"name": "Test", "move_in": {"earliest": "2026-10-15", "latest": "2026-11-01"},
                   "map_center": [40.75, -73.98]},
        "budget": {"tiers": [{"name": "Target", "max": 5000}], "hard_max": 5450},
        "unit": {"min_beds": 1}, "must_have": ["in_unit_wd"], "commute": {"destinations": []},
        "weights": dict(DEFAULT_WEIGHTS)}


def L(id="a-1", **kw):
    base = {"id": id, "building": "A", "unit": id.split("-")[-1], "address": "1 Main St", "status": "researching",
            "checked": "2026-10-10", "price": {"gross": 4800, "free_months": 0, "lease_months": 12},
            "amenities": {"in_unit_wd": True}}
    base.update(kw)
    return base


def search(tmp_path, listings, crit=CRIT):
    root = tmp_path / "s"
    root.mkdir()
    (root / "criteria.yaml").write_text(yaml.safe_dump(crit))
    (root / "listings.json").write_text(json.dumps(listings))
    return root


# --------------------------------------------------------------------------- claims
def test_claim_semantics_and_append_only(tmp_path):
    c = make_claim("a-1", "status", "Lease signed", "https://x.com/a", "portal_search", claimed_at="2026-10-01",
                   received_at="2026-10-05")
    assert c["value"] == "gone" and c["claimed_at"] == "2026-10-01" and c["received_at"] == "2026-10-05"
    append_claim(tmp_path, c)
    append_claim(tmp_path, make_claim("a-1", "gross", "$4,750", received_at="2026-10-06"))
    lines = (tmp_path / "history" / "claims.jsonl").read_text().splitlines()
    assert len(lines) == 2 and json.loads(lines[0])["value"] == "gone"
    assert [x["field"] for x in read_claims(tmp_path)] == ["status", "gross"]
    with pytest.raises(ValueError):
        make_claim("a-1", "status", "active", claimed_at="2026-10-09", received_at="2026-10-01")
    with pytest.raises(ValueError):
        make_claim("a-1", "colour", "blue")
    with pytest.raises(ValueError):
        make_claim("a-1", "gross", "call us")


def test_status_words():
    assert status_value("In contract") == "gone"
    assert status_value("Available now") == "active"
    assert status_value("not listed on the building page") == "unclear"   # missing is not gone


# --------------------------------------------------------------------------- availability ladder
def claim(status, claimed_at, kind="portal_search", **kw):
    return make_claim("a-1", "status", status, "src", kind, claimed_at=claimed_at, received_at="2026-10-12", **kw)


def test_older_active_claim_cannot_reactivate_gone():
    gone = L(status="gone", checked="2026-10-05")
    a = availability(gone, CRIT, [claim("active", "2026-09-30")], today="2026-10-12")
    assert a["state"] == "gone"
    # an undated forwarded claim cannot either
    a = availability(gone, CRIT, [make_claim("a-1", "status", "active", source_kind="partner", received_at="2026-10-12")],
                     today="2026-10-12")
    assert a["state"] == "gone"


def test_newer_active_claim_is_a_dispute():
    gone = L(status="gone", checked="2026-10-05")
    a = availability(gone, CRIT, [claim("active", "2026-10-08")], today="2026-10-12")
    assert a["state"] == "status_dispute" and a["as_of"] == "2026-10-08"


def test_gone_claim_overrides_older_check_and_received_date_is_not_a_check():
    # partner wrote "leased" on 10-08; we received it 10-12; our own check was 10-05
    a = availability(L(checked="2026-10-05"), CRIT, [claim("leased", "2026-10-08", "partner")], today="2026-10-12")
    assert a["state"] == "gone"
    # a cached copy received today says nothing about today
    cached = make_claim("a-1", "status", "active", "src", "unit_page", received_at="2026-10-12", method="cached")
    a = availability(L(checked="2026-09-01"), CRIT, [cached], today="2026-10-12")
    assert a["state"] == "unverified"


@pytest.mark.parametrize("kw, state", [
    ({"status": "rejected"}, "rejected"),
    ({"price": {"gross": 6000}}, "over_budget"),
    ({"available": "2026-12-01"}, "late"),
    ({"checked": "2026-09-01"}, "unverified"),
    ({"checked": None}, "unverified"),
    ({"amenities": {"in_unit_wd": None}}, "conditional"),
    ({"price": {"gross": 5000, "free_months": 1}}, "conditional"),
    ({}, "potential"),
])
def test_ladder_states(kw, state):
    assert availability(L(**kw), CRIT, [], today="2026-10-12")["state"] == state


def test_favourite_never_changes_availability():
    for fav in (None, "S", "A"):
        assert availability(L(favorite=fav, checked="2026-09-01"), CRIT, [], today="2026-10-12")["state"] == "unverified"


# --------------------------------------------------------------------------- snapshots and diffs
def test_snapshot_diff_classes():
    a = make_snapshot([L("a-1"), L("a-2"), L("a-3"), L("a-4", status="gone"), L("a-5"), L("a-6")], "2026-10-01")
    b = make_snapshot([
        L("a-1", price={"gross": 4700, "free_months": 0, "lease_months": 12}),            # price cut
        L("a-2", status="gone"),                                                          # gone
        L("a-3", price={"gross": 4800, "free_months": 1, "lease_months": 12}),            # concession
        L("a-4", status="researching"),                                                   # relist
        L("a-6", available="2026-11-01"),                                                 # date change, not new
        L("b-9"),                                                                         # new
        {**L("x-5"), "unit": "5"},                                                        # a-5 again under a new id
    ], "2026-10-08")
    ev = diff_snapshots(a, b)
    kinds = {(e["id"], e["type"], e["field"]) for e in ev}
    assert ("a-1", "price", "gross") in kinds
    assert ("a-2", "gone", "status") in kinds
    assert ("a-3", "concession", "free_months") in kinds
    assert ("a-4", "relist", "status") in kinds
    assert ("a-6", "status", "available") in kinds and ("a-6", "new", None) not in kinds
    assert ("b-9", "new", None) in kinds
    assert ("x-5", "relist", "id") in kinds and ("a-5", "gone", "status") not in kinds
    assert all(e["date"] == "2026-10-08" for e in ev)


def test_history_doc_gone_fast_and_price_history(tmp_path):
    write_snapshot(tmp_path, [L("a-1")], "2026-10-01")
    write_snapshot(tmp_path, [L("a-1", price={"gross": 4700}), L("a-2")], "2026-10-04")
    write_snapshot(tmp_path, [L("a-1", price={"gross": 4700}), L("a-2", status="gone")], "2026-10-09")
    append_claim(tmp_path, make_claim("a-1", "gross", 4650, "https://x.com", "unit_page", received_at="2026-10-11"))
    doc = history_doc(tmp_path, [L("a-1", price={"gross": 4700}), L("a-2", status="gone")], CRIT, today="2026-10-12")
    assert [s["date"] for s in doc["snapshots"]] == ["2026-10-01", "2026-10-04", "2026-10-09"]
    assert doc["snapshots"][-1] == {"date": "2026-10-09", "total": 2, "active": 1}
    gf = {g["id"]: g for g in doc["gone_fast"]}
    assert gf["a-2"] == {"id": "a-2", "listed": "2026-10-04", "gone": "2026-10-09", "days": 5, "last_price": 4800}
    assert [p["gross"] for p in doc["price_history"]["a-1"]] == [4800, 4700, 4650]
    types = [e["type"] for e in doc["events"]]
    assert {"new", "price", "gone", "claim"} <= set(types)
    assert doc["summary"]["median_days_to_gone"] == 5 and doc["note"] is None
    assert doc["availability"]["a-2"]["state"] == "gone"


def test_listed_date_unknown_for_first_snapshot(tmp_path):
    write_snapshot(tmp_path, [L("a-1")], "2026-10-01")
    write_snapshot(tmp_path, [L("a-1", status="gone")], "2026-10-05")
    doc = history_doc(tmp_path, [L("a-1", status="gone")], CRIT, today="2026-10-12")
    assert doc["gone_fast"][0]["listed"] is None and doc["gone_fast"][0]["days"] is None


def test_empty_history_has_a_note(tmp_path):
    doc = history_doc(tmp_path, [L()], CRIT, today="2026-10-12")
    assert doc["snapshots"] == [] and doc["events"] == [] and doc["note"]


def test_diff_since(tmp_path):
    write_snapshot(tmp_path, [L("a-1")], "2026-10-01")
    write_snapshot(tmp_path, [L("a-1"), L("a-2")], "2026-10-05")
    base, ev = diff_since(tmp_path, [L("a-1", status="gone"), L("a-2")], since="2026-10-02", today="2026-10-12")
    assert base == "2026-10-01" and {(e["id"], e["type"]) for e in ev} == {("a-1", "gone"), ("a-2", "new")}
    base, ev = diff_since(tmp_path, [L("a-1"), L("a-2")], today="2026-10-12")
    assert base == "2026-10-05" and ev == []


def test_snapshot_same_day_replaces(tmp_path):
    write_snapshot(tmp_path, [L("a-1")], "2026-10-01")
    write_snapshot(tmp_path, [L("a-1"), L("a-2")], "2026-10-01")
    snaps = read_snapshots(tmp_path)
    assert len(snaps) == 1 and set(snaps[0]["listings"]) == {"a-1", "a-2"}


def test_examples_are_never_snapshotted(tmp_path):
    from apartmentscout.quality.workspace import REPO
    assert not should_snapshot(REPO / "examples" / "nyc-2026", {}, REPO)
    assert should_snapshot(tmp_path, {}, REPO)
    assert not should_snapshot(tmp_path, {"history": {"snapshot_on_build": False}}, REPO)


# --------------------------------------------------------------------------- CLI and exports
def test_cli_commands(tmp_path, capsys):
    root = search(tmp_path, [L("a-1"), L("a-2", price={"gross": -1}), L("a-3", notes="Junior 1BR", beds=1)])
    with pytest.raises(SystemExit) as e:
        main(["validate", "--search", str(root), "--as-of", "2026-10-12"])
    assert e.value.code == 1 and "impossible_price" in capsys.readouterr().out
    main(["lint", "--search", str(root), "--as-of", "2026-10-12"])
    assert "junior_or_flex_1br" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        main(["lint", "--search", str(root), "--strict", "--as-of", "2026-10-12"])
    capsys.readouterr()
    main(["coverage", "--search", str(root), "--as-of", "2026-10-12", "--out", str(tmp_path / "cov.json")])
    assert "not a market census" in capsys.readouterr().out
    assert set(json.loads((tmp_path / "cov.json").read_text())["listings"]) == {"a-1", "a-2", "a-3"}
    main(["history", "diff", "--search", str(root)])
    assert "No snapshots yet" in capsys.readouterr().out
    main(["history", "snapshot", "--search", str(root), "--date", "2026-10-01"])
    main(["history", "claim", "a-1", "status", "leased", "--search", str(root), "--kind", "broker",
          "--claimed-at", "2026-10-11", "--received-at", "2026-10-12"])
    main(["history", "show", "a-1", "--search", str(root), "--as-of", "2026-10-12"])
    assert "a-1: gone" in capsys.readouterr().out
    main(["history", "diff", "--search", str(root), "--as-of", "2026-10-12"])
    assert "Changes since 2026-10-01" in capsys.readouterr().out


def test_exports_write_contract_files(tmp_path):
    from apartmentscout.exports import run_all
    crit = dict(CRIT, watchlist=[{"name": "A", "address": "1 Main St", "reason": "test"}])
    root = search(tmp_path, [L("a-1"), L("a-2", status="gone")], crit)
    out = tmp_path / "data"
    out.mkdir()
    written = run_all(Workspace(root), out, log=lambda *a: None)
    assert {"coverage.json", "history.json", "watchlist.json"} <= set(written)
    hist = json.loads((out / "history.json").read_text())
    assert set(hist) >= {"snapshots", "events", "gone_fast", "price_history"}
    assert len(hist["snapshots"]) == 1                     # build recorded today's snapshot
    assert (root / "history" / "snapshots").is_dir()
    cov = json.loads((out / "coverage.json").read_text())
    assert set(cov) >= {"standard", "listings", "sources", "summary"}
    row = cov["listings"]["a-1"]
    assert set(row) >= {"have", "missing", "stale", "score_impact", "priority", "questions", "lint"}
    wl = json.loads((out / "watchlist.json").read_text())
    b = wl["buildings"][0]
    assert set(b) >= {"key", "name", "address", "lat", "lon", "reason", "last_checked", "units_seen", "url"}
    assert b["units_seen"] == 2


def test_listing_level_claims_feed_the_ladder():
    gone = L(status="gone", checked="2026-10-05",
             claims=[{"field": "status", "value": "available", "source": "partner sheet", "observed_at": "2026-10-09"}])
    assert availability(gone, CRIT, [], today="2026-10-12")["state"] == "status_dispute"
    gone["claims"][0]["status"] = "superseded"
    assert availability(gone, CRIT, [], today="2026-10-12")["state"] == "gone"
    older = L(status="gone", checked="2026-10-05",
              claims=[{"field": "status", "value": "active", "source": "old capture", "observed_at": "2026-09-20"}])
    assert availability(older, CRIT, [], today="2026-10-12")["state"] == "gone"
