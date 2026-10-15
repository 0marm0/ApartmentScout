"""Values the renter typed for a home's unknowns: validated, applied to a copy of the listing when scoring, never written into
the listing, and saved through the local API like the tour findings."""
from __future__ import annotations

import copy
import http.client
import json
import threading
from pathlib import Path

import pytest

from apartmentscout import cli, renterfacts
from apartmentscout.config import DEFAULT_WEIGHTS, Workspace
from apartmentscout.intake import init_search
from apartmentscout.localapi import ServeState, make_server
from apartmentscout.score import score_all

ROOT = Path(__file__).resolve().parents[1]
CRIT = {"search": {"name": "Test", "move_in": {"earliest": "2026-10-15", "latest": "2026-11-01"}, "map_center": [40.75, -73.98]},
        "budget": {"tiers": [{"name": "Target", "max": 5000}, {"name": "Stretch", "max": 5300}], "hard_max": 5450}, "unit": {"min_beds": 1},
        "must_have": ["in_unit_wd"], "strongly_prefer": ["elevator"], "commute": {"destinations": []}, "weights": dict(DEFAULT_WEIGHTS),
        "scoring": {"as_of": "2026-10-15"}}


def unit(id="knox-6b", **kw):
    base = {"id": id, "building": "Knox", "unit": "6B", "address": "49 E 34th", "status": "touring", "beds": 1, "floor": 6, "floor_inferred": True,
            "checked": "2026-10-14", "available": "Now", "exposure": [], "features": {"interior": "skyline views"},
            "price": {"gross": 5250, "net_effective": 4725, "free_months": 1, "lease_months": 10, "basis": "leasing_office", "checked": "2026-09-29"},
            "amenities": {"in_unit_wd": None, "elevator": True},
            "claims": [{"field": "gross", "value": 5300, "source": "building page", "observed_at": "2026-09-29"},
                       {"field": "status", "value": "active", "source": "building page"}]}
    base.update(kw)
    return base


def comps(n=9):
    """Other homes that state a size and a fee sheet, so the unknowns above are estimated from them."""
    return [{**unit(f"c-{i}"), "building": "Knox", "unit": str(i), "sqft": 520 + 20 * i, "floor_inferred": False, "claims": [],
             "price": {"gross": 4900, "fees_monthly": 100 + 10 * i, "basis": "unit_page", "checked": "2026-10-10"},
             "amenities": {"in_unit_wd": True, "elevator": True}} for i in range(n)]


def score(L, facts=None, crit=CRIT):
    Ls = [copy.deepcopy(L), *comps()]
    score_all(Ls, crit, facts={Ls[0]["id"]: facts} if facts else None)
    return Ls[0]["score"]


# --------------------------------------------------------------------------- validation
def test_values_are_validated_for_their_kind():
    n = renterfacts.normalize({"size": "640", "fees": {"value": 135.456}, "price": 4725, "wd": True, "floor": 7.0, "bogus": 1})
    assert {k: v["value"] for k, v in n.items()} == {"size": 640, "fees": 135.46, "price": 4725.0, "wd": True, "floor": 7}
    assert all(v["source"] == "renter" and len(v["at"]) == 10 for v in n.values())
    bad = renterfacts.normalize({"size": 10, "fees": -1, "price": "free", "wd": "yes", "floor": 6.5, "bogus": 3})
    assert bad == {}
    assert renterfacts.normalize({"size": {"value": 700, "at": "2026-10-01"}})["size"]["at"] == "2026-10-01"


def test_overlay_applies_to_a_copy_and_the_listing_is_untouched():
    L = unit()
    before = copy.deepcopy(L)
    out = renterfacts.overlay(L, {"size": 640, "wd": True, "floor": 9, "fees": 150, "price": 4800})
    assert L == before
    assert out["sqft"] == 640 and out["amenities"]["in_unit_wd"] is True and out["floor"] == 9 and out["floor_inferred"] is False
    assert out["price"]["fees_monthly"] == 150 and out["price"]["net_effective"] == 4800 and out["price"]["basis"] == "renter_quote"
    assert "free_months" not in out["price"] and out["claims"] == [{"field": "status", "value": "active", "source": "building page"}]
    assert renterfacts.overlay(L, None) is L and renterfacts.overlay(L, {"size": 5}) is L


# --------------------------------------------------------------------------- what they do to a score
def test_a_typed_size_replaces_the_estimate_and_collapses_its_range():
    base = score(unit())
    assert "size_imputed" in base["flags"] and "space" in base["part_ranges"]
    mine = score(unit(), {"size": 700})
    assert "size_imputed" not in mine["flags"] and "space" not in mine.get("part_ranges", {})
    assert mine["parts"]["space"] > base["parts"]["space"] and mine["overall"] > base["overall"]
    assert mine["renter"]["size"]["value"] == 700 and mine["renter"]["size"]["source"] == "renter"
    assert any(i.startswith("you entered 700") for r in mine["reasons"] if r["dim"] == "space" for i in r["items"])


def test_typed_fees_and_a_confirmed_price_settle_the_money():
    base = score(unit(price={"gross": 5250, "net_effective": 4725, "free_months": 1, "lease_months": 10, "basis": "leasing_office"}))
    assert "unverified:fees" in base["gates"]
    fees = score(unit(), {"fees": 135})
    assert "unverified:fees" not in fees["gates"] and fees["cost"]["fees_known"] and fees["cost"]["fees_monthly"] == 135
    both = score(unit(), {"fees": 135, "price": 4725})
    assert "price_dispute" not in both["gates"] and "source conflict" not in both["tags"] and both["monthly_cost"] == 4725 + 135
    assert both["renter"]["price"]["value"] == 4725


def test_a_typed_price_ends_a_dispute_at_the_stated_rent():
    L = unit(price={"gross": 5250, "net_effective": 4725, "free_months": 1, "lease_months": 10, "fees_monthly": 135, "basis": "leasing_office"})
    assert "price_dispute" in score(L)["gates"]
    ok = score(L, {"price": 4900})
    assert "price_dispute" not in ok["gates"] and ok["monthly_cost"] == 4900 + 135 and not ok["cost"].get("dispute")


def test_washer_dryer_and_floor_move_amenities_and_light():
    L = unit()
    base = score(L)
    assert "unverified:in_unit_wd" in base["gates"]
    yes = score(L, {"wd": True})
    assert "unverified:in_unit_wd" not in yes["gates"] and yes["parts"]["amenities"] > base["parts"]["amenities"] and yes["eligible"]
    no = score(L, {"wd": False})
    assert "fails:in_unit_wd" in no["gates"] and not no["eligible"]
    high = score(L, {"floor": 30})
    assert high["parts"]["light_view"] > base["parts"]["light_view"] and "floor_inferred" not in high["flags"]


def test_the_scorer_hands_the_dashboard_what_it_needs_for_the_floor():
    s = score(unit(features={"interior": "skyline views"}, photo_review={"view": 2, "natural_light": 3}))
    h = s["light_hint"]
    assert h["rest"] == 53.0 and h["assumed"] is False and round(h["pv"], 1) == 35.0   # 45 + 8 for 'skyline'; photos: 0.6 x 25 + 0.4 x 50


# --------------------------------------------------------------------------- the file and the local API
def test_save_load_and_remove(tmp_path):
    f = renterfacts.FactsFile(tmp_path, threading.RLock())
    assert f.all() == {}
    kept = f.save("knox-6b", {"size": 640, "junk": 1})
    assert list(kept) == ["size"] and renterfacts.load(tmp_path)["knox-6b"]["size"]["value"] == 640
    assert json.loads((tmp_path / "renter_facts.json").read_text())["v"] == 1
    assert f.save("knox-6b", {}) == {} and renterfacts.load(tmp_path) == {}
    for bad in ("../x", "a/b", "", "x."):
        with pytest.raises(ValueError):
            f.save(bad, {"size": 640})
    with pytest.raises(ValueError):
        f.save("knox-6b", [1])


def serve(tmp_path, read_only=False):
    mine = tmp_path / "searches" / "mine"
    init_search(mine, "generic")
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path / "searches", ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(mine))
    if read_only:
        mine = ROOT / "examples" / "nyc-2026"
        state.ws = Workspace(mine)
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    return state, httpd, mine


def call(state, method, path, body=None, token=True, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", state.port, timeout=10)
    h = {"Host": f"127.0.0.1:{state.port}", **({"X-AS-Token": state.token} if token else {}), **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    if data:
        h["Content-Type"] = "application/json"
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    out = json.loads(r.read() or b"null")
    c.close()
    return r.status, out


def test_the_api_round_trips_and_keeps_its_guards(tmp_path):
    state, httpd, mine = serve(tmp_path)
    try:
        assert call(state, "GET", "/api/facts") == (200, {"facts": {}})
        for method, path, body in (("GET", "/api/facts", None), ("POST", "/api/facts/knox-6b", {"facts": {"size": 640}})):
            assert call(state, method, path, body, token=False)[0] == 401
            assert call(state, method, path, body, headers={"Origin": "https://evil.example"})[0] == 403
        assert not (mine / "renter_facts.json").exists()
        s, body = call(state, "POST", "/api/facts/knox-6b", {"facts": {"size": 640, "wd": True, "x": 1}})
        assert s == 200 and sorted(body["facts"]) == ["size", "wd"]
        assert call(state, "GET", "/api/facts")[1]["facts"]["knox-6b"]["size"]["value"] == 640
        assert call(state, "POST", "/api/facts/..%2Fx", {"facts": {"size": 640}})[0] == 400
        assert call(state, "GET", "/api/session")[1]["facts"] == {"save": True}
        assert call(state, "POST", "/api/facts/knox-6b", {"facts": {}})[1]["facts"] == {}
        assert renterfacts.load(mine) == {}
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_an_example_search_keeps_the_numbers_in_the_browser(tmp_path):
    state, httpd, mine = serve(tmp_path, read_only=True)
    try:
        s, body = call(state, "POST", "/api/facts/knox-6b", {"facts": {"size": 640}})
        assert s == 403 and "read-only" in body["error"] and not (mine / "renter_facts.json").exists()
        assert call(state, "GET", "/api/session")[1]["facts"] == {"save": False}
    finally:
        httpd.shutdown()
        httpd.server_close()
