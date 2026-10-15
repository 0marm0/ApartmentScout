"""apartmentscout alerts: the change digest from synthetic before/after searches, the saved baseline, the text, the CLI and the
dashboard export. No network, no clock: every state is built with an explicit time."""
import datetime as dt
import json

import yaml

from apartmentscout import alerts as A
from apartmentscout.cli import main
from apartmentscout.config import DEFAULT_WEIGHTS, Workspace
from apartmentscout.exports import alerts as export_alerts
from apartmentscout.quality.workspace import load_listings

D1 = dt.datetime(2026, 10, 14, 7, 0)
D2 = dt.datetime(2026, 10, 15, 7, 0)
CRIT = {"search": {"name": "Test search"}, "budget": {"tiers": [{"name": "Target", "max": 5000}], "hard_max": 5450}, "unit": {"min_beds": 1},
        "must_have": [], "commute": {"destinations": []}, "weights": dict(DEFAULT_WEIGHTS)}


def home(id, *, gross=4800, fit=True, rank=None, status="researching", gates=(), flags=(), cost=None, free=None, fees=None,
         unit="1A", building="The Example", hood="Chelsea", link=None):
    price = {"gross": gross}
    if free is not None:
        price["free_months"] = free
    if fees is not None:
        price["fees_monthly"] = fees
    L = {"id": id, "building": building, "unit": unit, "neighborhood": hood, "status": status, "price": price,
         "score": {"eligible": fit, "monthly_cost": cost if cost is not None else gross, "gates": list(gates), "flags": list(flags),
                   "ranks": {"action": rank}, "rank": rank}}
    if link:
        L["links"] = {"listing": link}
    return L


def state(*homes, at=D1):
    return A.snapshot(homes, CRIT, at)


def groups(old, new, **kw):
    return {g: rows for g, rows in A.diff_states(old, new, **kw).items() if rows}


def ids(rows):
    return [r["id"] for r in rows]


# --------------------------------------------------------------------------- the diff
def test_new_homes_that_fit_are_reported_and_the_others_are_only_counted():
    old = state(home("a", rank=1))
    new = state(home("a", rank=1), home("b", rank=2, unit="2B"), home("c", fit=False, gross=6200), home("d", status="gone"), at=D2)
    g = groups(old, new)
    assert ids(g["new"]) == ["b"] and g["new"][0]["rank"] == 2 and g["new"][0]["gross"] == 4800
    assert set(g) == {"new"}
    d = A.make_digest(old, new)
    assert d["quiet_new"] == 1 and d["counts"] == {"new": 1}          # c is new but does not fit; d is gone: neither is news


def test_a_known_home_that_starts_to_fit_says_why_it_did_not():
    old = state(home("a", fit=False, gross=5300, gates=["over_budget:5300"]), home("b", fit=False, gates=["fails:in_unit_wd"]))
    new = state(home("a", rank=4, gross=4950), home("b", rank=9), at=D2)
    g = groups(old, new)
    assert ids(g["fits"]) == ["a", "b"]
    assert g["fits"][0]["why"] == "was over budget" and g["fits"][1]["why"] == "was failing a must-have: in unit wd"
    assert (g["fits"][0]["from"], g["fits"][0]["to"], g["fits"][0]["delta"]) == (5300, 4950, -350)   # got cheaper: one item, not two
    assert "drops" not in g and "jumps" not in g and "new" not in g
    assert "(was over budget before; down from $5,300)" in A.digest_text(A.make_digest(old, new))


def test_price_drops_and_rises_with_the_amount_largest_drop_first():
    old = state(home("a", gross=5100, rank=3), home("b", gross=4500, rank=4), home("c", gross=4900, rank=5), home("same", gross=4700, rank=6))
    new = state(home("a", gross=4995, rank=3), home("b", gross=4300, rank=4), home("c", gross=5050, rank=5), home("same", gross=4700, rank=6), at=D2)
    g = groups(old, new)
    assert [(r["id"], r["delta"]) for r in g["drops"]] == [("b", -200), ("a", -105)]
    assert [(r["id"], r["from"], r["to"]) for r in g["rises"]] == [("c", 4900, 5050)]
    assert g["drops"][0]["basis"] == "rent"


def test_price_moves_of_homes_that_do_not_fit_stay_quiet_unless_asked():
    old = state(home("a", fit=False, gross=6100), home("s", fit=False, gross=6000, status="shortlist"))
    new = state(home("a", fit=False, gross=5900), home("s", fit=False, gross=5800, status="shortlist"), at=D2)
    assert ids(groups(old, new)["drops"]) == ["s"]                      # the shortlist is watched even when it does not fit
    assert set(ids(groups(old, new, include_all=True)["drops"])) == {"a", "s"}


def test_a_concession_the_listing_states_moves_the_cost_but_estimated_fees_do_not():
    old = state(home("a", gross=5000, cost=5100, free=None, rank=2), home("b", gross=5000, cost=5100, rank=3))
    new = state(home("a", gross=5000, cost=4700, free=1, rank=2), home("b", gross=5000, cost=5150, rank=3), at=D2)
    g = groups(old, new)
    assert [(r["id"], r["basis"], r["from"], r["to"]) for r in g["drops"]] == [("a", "monthly cost", 5100, 4700)]
    assert "rises" not in g                                            # b only re-estimated: nothing on the listing changed


def test_gone_back_and_the_renters_own_rejection():
    old = state(home("a", rank=1), home("b", rank=2), home("c", rank=3), home("x", rank=4), home("old", status="gone", fit=False),
                home("n", fit=False, status="gone"))
    new = state(home("a", rank=1, status="gone"), home("b", rank=1, status="rejected"), home("c", rank=2), home("old", status="new", rank=3),
                home("n", fit=False, status="gone"), at=D2)               # x is deleted from listings.json
    g = groups(old, new)
    assert ids(g["gone"]) == ["a", "x"] and g["gone"][1]["removed"] is True and g["gone"][0]["was_rank"] == 1
    assert ids(g["back"]) == ["old"]
    assert "b" not in ids(g.get("gone", []))                          # rejecting a home is the renter's decision, not news


def test_jumps_are_homes_that_fit_before_and_enter_the_top():
    old = state(home("a", rank=14), home("b", rank=8), home("c", rank=30), home("d", rank=11), home("e", rank=12))
    new = state(home("a", rank=7), home("b", rank=2), home("c", rank=20), home("d", rank=10), home("e", rank=11), home("f", rank=1), at=D2)
    g = groups(old, new)
    assert [(r["id"], r["from"], r["to"]) for r in g["jumps"]] == [("a", 14, 7), ("d", 11, 10)]
    assert ids(g["new"]) == ["f"]                                      # b was in the top already; f is new, not a jump
    assert ids(groups(old, new, top=5)["jumps"]) == ["b"]              # 7 and 10 are not the top 5; b went 8 to 2


def test_resolved_unknowns_are_the_questions_that_are_no_longer_open():
    old = state(home("a", rank=1, gates=["unverified:price", "unverified:in_unit_wd,pets"], flags=["fees_unknown"]),
                home("b", rank=2, gates=["unknown_cost"]), home("c", rank=3, gates=["unverified:fees"]))
    new = state(home("a", rank=1, gates=["unverified:in_unit_wd"]), home("b", rank=2), home("c", rank=3, gates=["unverified:fees"]), at=D2)
    g = groups(old, new)
    a, b = g["resolved"]
    assert a["id"] == "a" and a["resolved"] == ["monthly fees", "pets allowed", "price"]
    assert b["id"] == "b" and b["resolved"] == ["monthly cost"]
    assert "c" not in ids(g["resolved"])


def test_a_rescore_with_nothing_changed_is_silent():
    homes = [home("a", rank=1, gates=["unverified:fees"]), home("b", rank=2), home("c", fit=False)]
    d = A.make_digest(state(*homes), state(*homes, at=D2))
    assert d["total"] == 0 and d["headline"] == "" and d["title"] == "ApartmentScout: nothing new"
    assert "Nothing changed" in d["note"]


# --------------------------------------------------------------------------- headline, text, digest
def test_headline_names_the_kinds_of_change_and_caps_them():
    assert A.headline({"new": 3, "drops": 2}) == "3 new, 2 price drops"
    assert A.headline({"new": 1, "drops": 1, "rises": 1}) == "1 new, 1 price drop, 1 price rise"
    assert A.headline({}) == ""
    assert A.headline({"fits": 1, "gone": 2, "jumps": 3}, top=10) == "1 now fits, 2 gone, 3 into the top 10"
    long = A.headline({g: 1 for g in A.GROUPS})
    assert long == "1 new, 1 now fits, 1 price drop, 1 price rise, 4 more"


def test_first_run_is_a_baseline_with_nothing_to_report():
    d = A.make_digest(None, state(home("a", rank=1), home("b", fit=False)))
    assert d["first_run"] and d["total"] == 0 and d["since"] is None and d["tracked"] == 2 and d["fitting"] == 1
    assert d["title"] == "ApartmentScout: alerts are on" and "baseline" in d["note"]


def test_the_digest_text_is_short_and_readable():
    old = state(home("a", gross=5100, rank=3, link="https://example.test/a"), home("b", rank=12, unit="2B"))
    new = state(home("a", gross=4995, rank=3, link="https://example.test/a"), home("b", rank=6, unit="2B"),
                home("n", rank=1, unit="9N", hood="Murray Hill", gross=4650), home("z", fit=False), at=D2)
    d = A.make_digest(old, new)
    assert d["title"] == "ApartmentScout: 1 new, 1 price drop, 1 into the top 10"
    plain = A.digest_text(d)
    assert plain.startswith("ApartmentScout: 1 new, 1 price drop, 1 into the top 10\n\nChanges since Oct 14: 3.")
    assert "The Example 9N (Murray Hill): $4,650 a month, ranked #1" in plain
    assert "The Example 1A (Chelsea): $5,100 to $4,995 (-$105)" in plain
    assert "The Example 2B (Chelsea): #12 to #6" in plain
    assert "1 other new home did not fit" in plain
    md = A.digest_text(d, md=True)
    assert md.startswith("# ApartmentScout: 1 new") and "## Price drops (1)" in md and "**[The Example 1A](https://example.test/a)**" in md
    assert "leasing office" in md and "\n\n\n" not in md


def test_a_long_group_is_cut_with_a_count():
    new = state(*[home(f"n{i:02d}", rank=i + 1, unit=f"{i}A") for i in range(20)], at=D2)
    d = A.make_digest(state(home("a", rank=30)), new)
    assert d["counts"]["new"] == 20 and "... and 8 more" in A.digest_text(d)


def test_the_digest_id_follows_the_content_and_not_the_clock():
    old = state(home("a", gross=5100, rank=3))
    one = A.make_digest(old, state(home("a", gross=4995, rank=3), at=D2))
    two = A.make_digest(old, state(home("a", gross=4995, rank=3), at=D2 + dt.timedelta(hours=5)))
    other = A.make_digest(old, state(home("a", gross=4900, rank=3), at=D2))
    assert one["id"] == two["id"] != other["id"]


# --------------------------------------------------------------------------- the baseline on disk
def test_run_saves_the_baseline_and_the_next_run_reports_against_it(tmp_path):
    root = tmp_path / "s"
    first = A.run(root, [home("a", gross=5100, rank=1)], CRIT, at=D1)
    assert first["first_run"] and (root / "history/alerts/state.json").is_file()
    assert (root / "history/alerts/digests/2026-10-14.md").is_file()
    second = A.run(root, [home("a", gross=5000, rank=1), home("b", rank=2)], CRIT, at=D2)
    assert second["since"] == "2026-10-14" and second["counts"] == {"new": 1, "drops": 1}
    assert json.loads((root / "history/alerts/digest.json").read_text())["id"] == second["id"]
    third = A.run(root, [home("a", gross=5000, rank=1), home("b", rank=2)], CRIT, at=D2 + dt.timedelta(hours=1))
    assert third["total"] == 0                                         # the second run moved the baseline


def test_no_save_leaves_the_baseline_alone(tmp_path):
    root = tmp_path / "s"
    A.run(root, [home("a", rank=1)], CRIT, at=D1)
    before = (root / "history/alerts/state.json").read_text()
    d = A.run(root, [home("a", rank=1), home("b", rank=2)], CRIT, save=False, at=D2)
    assert d["counts"] == {"new": 1} and (root / "history/alerts/state.json").read_text() == before
    again = A.run(root, [home("a", rank=1), home("b", rank=2)], CRIT, save=False, at=D2)
    assert again["id"] == d["id"]


def test_an_explicit_baseline_file_and_a_damaged_one(tmp_path):
    root = tmp_path / "s"
    old = tmp_path / "old.json"
    old.write_text(json.dumps(state(home("a", gross=5200, rank=1))))
    d = A.run(root, [home("a", gross=5000, rank=1)], CRIT, baseline=old, save=False, at=D2)
    assert d["counts"] == {"drops": 1}
    old.write_text("{not json")
    assert A.run(root, [home("a", rank=1)], CRIT, baseline=old, save=False, at=D2)["first_run"]
    assert A.load_state(tmp_path / "missing.json") is None


def test_old_digests_are_pruned(tmp_path):
    root = tmp_path / "s"
    for day in range(A.KEEP_DIGESTS + 5):
        d = A.make_digest(None, state(home("a", rank=1), at=dt.datetime(2026, 1, 1) + dt.timedelta(days=day)))
        A.save_digest(root, d)
    kept = sorted((root / "history/alerts/digests").glob("*.md"))
    assert len(kept) == A.KEEP_DIGESTS and kept[0].name == "2026-01-06.md"


# --------------------------------------------------------------------------- what the dashboard gets
def test_export_is_live_changes_then_the_last_digest_while_recent_then_nothing(tmp_path):
    root = tmp_path / "s"
    assert A.export_digest(root, [home("a", rank=1)], CRIT, D1)["first_run"]
    A.run(root, [home("a", gross=5100, rank=1)], CRIT, at=D1)
    A.run(root, [home("a", gross=5000, rank=1)], CRIT, at=D2)         # a saved digest with one price drop
    live = A.export_digest(root, [home("a", gross=5000, rank=1), home("n", rank=2)], CRIT, D2 + dt.timedelta(hours=2))
    assert live["pending"] and live["counts"] == {"new": 1}
    recent = A.export_digest(root, [home("a", gross=5000, rank=1)], CRIT, D2 + dt.timedelta(days=3))
    assert not recent["pending"] and recent["counts"] == {"drops": 1} and recent["generated"] == "2026-10-15"
    stale = A.export_digest(root, [home("a", gross=5000, rank=1)], CRIT, D2 + dt.timedelta(days=A.RECENT_DAYS + 1))
    assert stale["total"] == 0 and not stale["first_run"]
    assert json.loads((root / "history/alerts/state.json").read_text())["date"] == "2026-10-15"   # exporting never writes


def write_search(tmp_path, listings):
    root = tmp_path / "s"
    root.mkdir(exist_ok=True)
    (root / "criteria.yaml").write_text(yaml.safe_dump(CRIT))
    (root / "listings.json").write_text(json.dumps(listings))
    return root


def test_cli_writes_the_files_and_the_build_export_reads_them(tmp_path, capsys):
    root = write_search(tmp_path, [home("a", gross=5100, rank=1), home("b", rank=2)])
    main(["alerts", "--search", str(root)])
    assert "alerts are on" in capsys.readouterr().out
    write_search(tmp_path, [home("a", gross=4900, rank=1), home("b", rank=2), home("c", rank=3, unit="3C")])
    main(["alerts", "--search", str(root), "--no-save", "--json-out", str(tmp_path / "d.json"), "--md-out", str(tmp_path / "d.md")])
    out = capsys.readouterr().out
    assert out.startswith("ApartmentScout: 1 new, 1 price drop") and "Baseline saved" not in out
    assert json.loads((tmp_path / "d.json").read_text())["counts"] == {"new": 1, "drops": 1}
    assert (tmp_path / "d.md").read_text().startswith("# ApartmentScout: 1 new, 1 price drop")
    main(["alerts", "--search", str(root), "--no-save", "--json"])
    assert json.loads(capsys.readouterr().out)["kind"] == "alerts"
    ws = Workspace(root)
    out_dir = tmp_path / "data"
    out_dir.mkdir()
    assert export_alerts.export(ws, out_dir) == ["alerts.json"]
    doc = json.loads((out_dir / "alerts.json").read_text())
    assert doc["pending"] and doc["headline"] == "1 new, 1 price drop" and doc["groups"]["new"][0]["id"] == "c"
    assert load_listings(ws)[0]["id"] == "a"


def test_the_build_export_is_registered_and_never_breaks_a_search_without_scores(tmp_path):
    root = write_search(tmp_path, [{"id": "u", "building": "Plain", "status": "new", "price": {"gross": 4000}}])
    out_dir = tmp_path / "data"
    out_dir.mkdir()
    export_alerts.export(Workspace(root), out_dir)
    doc = json.loads((out_dir / "alerts.json").read_text())
    assert doc["first_run"] and doc["tracked"] == 1 and doc["fitting"] == 0
