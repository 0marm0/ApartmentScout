"""Floor plan files (`apartmentscout plans`, planfile.py), the surroundings batch (`apartmentscout surroundings`) and the local
API the wizard and the tracer use to look up a city, an address, a transit feed and to save a traced plan. No network."""
from __future__ import annotations

import http.client
import json
import threading
import types
from pathlib import Path
from typing import Any, Iterator

import pytest

from apartmentscout import cities as C
from apartmentscout import cli, planfile
from apartmentscout.commands import plans as plans_cmd
from apartmentscout.commands import surroundings as sur
from apartmentscout.config import Workspace
from apartmentscout.intake import init_search
from apartmentscout.listings import save
from apartmentscout.localapi import ServeState, make_server

ROOT = Path(__file__).resolve().parents[1]

# a one-bedroom drawn for a Lisbon listing: north up, one window wall
PLAN: dict[str, Any] = {
    "schema": 2, "id": "rua-augusta-3e", "title": "Rua Augusta 3E", "units": "m", "ceiling": 2.7, "up_bearing": 200,
    "source": "Listing plan image, dimensions as printed",
    "rooms": [{"name": "Sala", "kind": "living", "x": 0, "y": 3, "w": 5, "h": 4}, {"name": "Quarto", "kind": "bedroom", "x": 0, "y": 0, "w": 3.2, "h": 3}],
    "windows": [{"room": "Sala", "x1": 1, "y1": 7, "x2": 3.5, "y2": 7, "sill": 0.8, "head": 2.2}],
    "doors": [{"x1": 4, "y1": 3, "x2": 4.9, "y2": 3, "kind": "entry"}],
}


def plan(**kw: Any) -> dict[str, Any]:
    return {**json.loads(json.dumps(PLAN)), **kw}


# --------------------------------------------------------------------------- planfile
def test_a_good_plan_passes() -> None:
    errors, warnings = planfile.check_plan(PLAN)
    assert errors == [] and warnings == []


@pytest.mark.parametrize("bad,msg", [
    ({"id": "../etc"}, "id:"), ({"id": ""}, "id:"), ({"rooms": []}, "at least one room"), ({"units": "yards"}, "units:"),
    ({"up_bearing": 400}, "up_bearing:"), ({"schema": 9}, "schema:"), ({"rooms": [{"name": "X", "w": 0, "h": 3, "x": 0, "y": 0}]}, "usable"),
    ({"windows": "none"}, "windows: must be a list")])
def test_a_broken_plan_is_refused_with_a_reason(bad: dict, msg: str) -> None:
    errors, _ = planfile.check_plan(plan(**bad))
    assert any(msg in e for e in errors), errors


def test_warnings_for_a_plan_that_cannot_place_the_sun() -> None:
    p = plan()
    del p["up_bearing"], p["windows"]
    _, warnings = planfile.check_plan(p)
    assert any("up_bearing is not set" in w for w in warnings) and any("No windows" in w for w in warnings)


def test_not_an_object_is_an_error() -> None:
    assert planfile.check_plan([1, 2])[0]


def test_save_creates_refuses_to_overwrite_and_keeps_a_backup(tmp_path: Path) -> None:
    out = planfile.save_plan(tmp_path, PLAN)
    assert out["created"] and (tmp_path / "plans" / "rua-augusta-3e.json").exists()
    with pytest.raises(planfile.PlanError, match="already exists"):
        planfile.save_plan(tmp_path, PLAN)
    out2 = planfile.save_plan(tmp_path, plan(title="Changed"), overwrite=True)
    assert not out2["created"] and (tmp_path / "plans" / "rua-augusta-3e.json.bak").exists()
    assert json.loads((tmp_path / "plans" / "rua-augusta-3e.json").read_text())["title"] == "Changed"
    assert planfile.plan_ids(tmp_path) == ["rua-augusta-3e"]


def test_save_will_not_write_through_a_link(tmp_path: Path) -> None:
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "plans").symlink_to(tmp_path / "elsewhere")
    with pytest.raises(planfile.PlanError, match="symbolic link"):
        planfile.save_plan(tmp_path, PLAN)


def test_a_huge_plan_is_refused(tmp_path: Path) -> None:
    with pytest.raises(planfile.PlanError, match="larger than"):
        planfile.save_plan(tmp_path, plan(source="x" * 300_000))


# --------------------------------------------------------------------------- apartmentscout plans
def make_search(tmp_path: Path) -> Path:
    root = tmp_path / "lisbon"
    init_search(root, "generic")
    save([{"id": "rua-augusta-3e", "building": "Rua Augusta", "unit": "3E", "status": "shortlist", "lat": 38.71, "lon": -9.137},
          {"id": "alfama-1a", "building": "Alfama", "unit": "1A", "status": "shortlist", "lat": 38.711, "lon": -9.13},
          {"id": "gone-1", "building": "Old", "unit": "1", "status": "gone"}], root / "listings.json")
    return root


def plan_args(root: Path, action: str = "list", file: str | None = None, **kw: Any) -> types.SimpleNamespace:
    return types.SimpleNamespace(search=str(root), action=action, file=file, id=kw.get("id"), force=kw.get("force", False))


def test_plans_lists_homes_with_and_without_a_plan_and_says_how_to_add_one(tmp_path: Path, capsys) -> None:
    root = make_search(tmp_path)
    planfile.save_plan(root, PLAN)
    plans_cmd.cmd_plans(plan_args(root))
    out = capsys.readouterr().out
    assert "1 of 2 open homes have one" in out and "plan     rua-augusta-3e" in out and "no plan  alfama-1a" in out
    assert "New plan from image" in out and "Save to the search folder" in out and "plans add" in out


def test_plans_add_checks_copies_and_warns_about_an_unknown_listing(tmp_path: Path, capsys) -> None:
    root = make_search(tmp_path)
    src = tmp_path / "traced.json"
    src.write_text(json.dumps(plan(id="somewhere-else")))
    plans_cmd.cmd_plans(plan_args(root, "add", str(src)))
    out = capsys.readouterr().out
    assert "Saved lisbon/plans/somewhere-else.json" in out and "no listing has the id 'somewhere-else'" in out
    plans_cmd.cmd_plans(plan_args(root, "add", str(src), id="alfama-1a"))
    assert (root / "plans" / "alfama-1a.json").exists()
    assert json.loads((root / "plans" / "alfama-1a.json").read_text())["id"] == "alfama-1a"
    with pytest.raises(SystemExit, match="already exists"):
        plans_cmd.cmd_plans(plan_args(root, "add", str(src), id="alfama-1a"))
    plans_cmd.cmd_plans(plan_args(root, "list"))
    assert "matches no listing" in capsys.readouterr().out


def test_plans_add_rejects_bad_input(tmp_path: Path) -> None:
    root = make_search(tmp_path)
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    with pytest.raises(SystemExit, match="Cannot read"):
        plans_cmd.cmd_plans(plan_args(root, "add", str(bad)))
    with pytest.raises(SystemExit, match="Give the plan file"):
        plans_cmd.cmd_plans(plan_args(root, "add"))
    bad.write_text(json.dumps({"id": "x", "rooms": []}))
    with pytest.raises(SystemExit, match="Not saved"):
        plans_cmd.cmd_plans(plan_args(root, "add", str(bad)))


# --------------------------------------------------------------------------- surroundings
LISTINGS = [{"id": "a", "status": "new"}, {"id": "b", "status": "shortlist"}, {"id": "c", "status": "touring"},
            {"id": "d", "status": "gone"}, {"id": "e", "status": "new", "favorite": True}]


def test_targets_are_the_shortlist_then_the_top_five() -> None:
    got, why = sur.pick_targets(LISTINGS, None, False)
    assert [L["id"] for L in got] == ["b", "c", "e"] and why == "the shortlist"
    plain = [{"id": f"x{i}", "status": "new", "score": {"rank": 10 - i}} for i in range(8)]
    got, why = sur.pick_targets(plain, None, False)
    assert [L["id"] for L in got] == ["x7", "x6", "x5", "x4", "x3"] and "nothing is shortlisted" in why
    assert [L["id"] for L in sur.pick_targets(LISTINGS, None, True)[0]] == ["a", "b", "c", "e"]
    assert [L["id"] for L in sur.pick_targets(LISTINGS, ["c"], False)[0]] == ["c"]
    with pytest.raises(SystemExit):
        sur.pick_targets(LISTINGS, ["zzz"], False)


SITE = {"source": "OpenStreetMap contributors (ODbL)", "generated": "2026-10-15", "target": 0, "timezone": "America/Chicago",
        "bmeta": [{"name": "Aqua", "height_src": "osm-height", "floors": 82}] + [{"height_src": "default"}] * 6 + [{"height_src": "osm-levels"}] * 3,
        "neighbours": {"rows": [[1, 20, 0, 10, 10], [2, 60, 0, 10, 10], [3, 90, 0, 10, 10], [8, 100, 0, 9, 9], [4, 400, 0, 10, 10]]},
        "provenance": {"target": "nearest", "target_offset_m": 33.4, "exposure": "listing"},
        "green": {"polys": [1, 2], "trees": [1, 2, 3]}, "water": {"x": 1}, "streets": [1],
        "checks": [{"id": "origin", "status": "warn", "msg": "address point is 33 m from the target footprint"}, {"id": "g", "status": "pass", "msg": "ok"}]}


def test_site_summary_counts_default_heights_near_and_far() -> None:
    s = sur.site_summary(SITE)
    assert (s["buildings"], s["default_height"]) == (10, 6)
    assert (s["near"], s["near_default"]) == (4, 3), "only buildings within 150 m, and only those with a default height"
    assert s["target"]["name"] == "Aqua" and s["target"]["matched_by"] == "nearest" and s["parks"] == 2 and s["trees"] == 3
    assert s["checks"] == ["warn: address point is 33 m from the target footprint"]


def test_status_and_advice_for_a_thin_osm_city(tmp_path: Path) -> None:
    root = make_search(tmp_path)
    (root / "sites").mkdir()
    (root / "sites" / "rua-augusta-3e.json").write_text(json.dumps(SITE))
    ws = Workspace(root)
    from apartmentscout.quality.workspace import load_listings
    rows = sur.status_rows(ws, load_listings(ws)[:2])
    text = "\n".join("\n".join(sur.format_row(r)) for r in rows)
    assert "3 of the 4 within 150 m" in text and "matched to Aqua by nearest, 33 m from the address point" in text
    assert "alfama-1a" in text and "no site model yet" in text
    notes = " ".join(sur.advice(rows, "lisbon", profile=False))
    assert "more than 40% default heights" in notes and "more than 25 m from the address point" in notes
    assert "Not available for this city" in notes and "--refresh" in notes
    assert "Not available for this city" not in " ".join(sur.advice(rows, "nyc", profile=True))


def test_an_ungeocoded_home_is_reported_not_crashed_on(tmp_path: Path) -> None:
    root = make_search(tmp_path)
    save([{"id": "x", "status": "shortlist", "address": "somewhere"}], root / "listings.json")
    ws = Workspace(root)
    from apartmentscout.quality.workspace import load_listings
    row = sur.status_rows(ws, load_listings(ws))[0]
    assert "run `apartmentscout geocode`" in sur.format_row(row)[1]


def fake_main(calls: list[str], fail: set[str]):
    def main(argv: list[str]) -> None:
        sid, root = argv[1], Path(argv[argv.index("--search") + 1])
        calls.append(sid)
        if sid in fail:
            raise RuntimeError("Overpass unavailable: request failed after 2 tries: HTTP 500")
        (root / "sites").mkdir(exist_ok=True)
        (root / "sites" / f"{sid}.json").write_text(json.dumps(SITE))
        print("  487 buildings, target #123, 107 with default heights, 0 with courts")
    return main


def surround_args(root: Path, **kw: Any) -> types.SimpleNamespace:
    d = dict(search=str(root), ids=[], all=False, status=False, rebuild=False, refresh=False, radius=600.0, verbose=False)
    d.update(kw)
    return types.SimpleNamespace(**d)


def test_surroundings_runs_each_home_keeps_going_after_a_failure_and_skips_finished_ones(tmp_path: Path, monkeypatch, capsys) -> None:
    root = make_search(tmp_path)
    calls: list[str] = []
    monkeypatch.setattr(sur, "RETRY_WAIT_S", 0.0)
    monkeypatch.setattr(cli, "main", fake_main(calls, {"alfama-1a"}))
    sur.cmd_surroundings(surround_args(root))
    out = capsys.readouterr().out
    assert calls == ["rua-augusta-3e", "alfama-1a", "alfama-1a"], "a download failure is tried once more"
    assert "trying again" in out
    assert "done in" in out and "failed - RuntimeError" in out and "Overpass servers are busy" in out
    assert "1 built, 0 skipped, 1 failed." in out
    calls.clear()
    sur.cmd_surroundings(surround_args(root))
    assert calls == ["alfama-1a", "alfama-1a"], "the finished home is not fetched again (the failing one is, and retried)"
    assert "already has a site model" in capsys.readouterr().out
    calls.clear()
    sur.cmd_surroundings(surround_args(root, rebuild=True))
    assert calls == ["rua-augusta-3e", "alfama-1a", "alfama-1a"]


def test_surroundings_status_fetches_nothing(tmp_path: Path, monkeypatch, capsys) -> None:
    root = make_search(tmp_path)
    calls: list[str] = []
    monkeypatch.setattr(cli, "main", fake_main(calls, set()))
    sur.cmd_surroundings(surround_args(root, status=True))
    assert calls == [] and "without a site model" in capsys.readouterr().out


# --------------------------------------------------------------------------- the local API
class Client:
    def __init__(self, port: int, token: str) -> None:
        self.port, self.token = port, token

    def post(self, path: str, body: Any, token: bool = True) -> tuple[int, Any]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/json"}
        if token:
            h["X-AS-Token"] = self.token
        c.request("POST", path, body=json.dumps(body).encode(), headers=h)
        r = c.getresponse()
        data = json.loads(r.read())
        c.close()
        return r.status, data

    def get(self, path: str) -> tuple[int, Any]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", path, headers={"Host": f"127.0.0.1:{self.port}", "X-AS-Token": self.token})
        r = c.getresponse()
        data = json.loads(r.read())
        c.close()
        return r.status, data


@pytest.fixture
def served(tmp_path: Path) -> Iterator[tuple[Client, ServeState, Path]]:
    root = make_search(tmp_path)
    chicago = C.CityInfo(id="chicago", name="Chicago, Illinois", lat=41.87556, lon=-87.62442, timezone="America/Chicago",
                         country="us", state="Illinois", osm="relation/122604")
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=cli._export, rescore=cli._rescore,
                       resolve_city=lambda q: chicago if "chi" in q.lower() else None,
                       locate=lambda q, city: {"lat": 41.87892, "lon": -87.636602, "label": "Willis Tower"} if "wacker" in q.lower() else None,
                       check_feed=lambda u: C.FeedCheck(u.endswith(".zip"), "a zip file" if u.endswith(".zip") else "that address is a web page", 12.0))
    state.activate(Workspace(root))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    yield Client(state.port, state.token), state, root
    httpd.shutdown()
    httpd.server_close()


def test_the_wizard_can_look_up_a_city(served) -> None:
    c, _, _ = served
    status, body = c.post("/api/city", {"q": "Chicago, IL"})
    assert status == 200 and body["id"] == "chicago" and body["timezone"] == "America/Chicago" and body["center"] == [41.87556, -87.62442]
    assert body["starter_feeds"][0]["name"] == "CTA" and any("City open data" in m for m in body["missing"])
    assert c.post("/api/city", {"q": "Atlantis"})[0] == 404
    assert c.post("/api/city", {"q": ""})[0] == 400


def test_the_wizard_can_find_an_address_and_check_a_feed(served) -> None:
    c, _, _ = served
    status, body = c.post("/api/geocode", {"q": "233 S Wacker Dr", "city": "chicago"})
    assert status == 200 and body == {"lat": 41.87892, "lon": -87.636602, "label": "Willis Tower"}
    assert c.post("/api/geocode", {"q": "nowhere"})[0] == 404
    assert c.post("/api/feeds/check", {"url": "https://x.example/g.zip"})[1]["ok"] is True
    assert c.post("/api/feeds/check", {"url": "https://x.example/page"})[1]["ok"] is False


def test_lookups_need_the_token(served) -> None:
    c, _, _ = served
    for path, body in [("/api/city", {"q": "Chicago"}), ("/api/geocode", {"q": "x"}), ("/api/feeds/check", {"url": "x"}), ("/api/plans", {"plan": PLAN})]:
        assert c.post(path, body, token=False)[0] == 401, path


def test_the_session_offers_plan_saving_and_the_cities_carry_a_centre(served) -> None:
    c, _, _ = served
    s = c.get("/api/session")[1]
    assert s["plans"]["save"] is True
    nyc = next(x for x in s["cities"] if x["id"] == "nyc")
    assert nyc["center"] == [40.7549, -73.984] and nyc["zoom"] == 12.8


def test_a_traced_plan_is_saved_into_the_search_and_shows_without_a_rebuild(served) -> None:
    c, state, root = served
    status, body = c.post("/api/plans", {"plan": PLAN})
    assert status == 200 and body["path"] == "plans/rua-augusta-3e.json" and body["created"] is True
    assert json.loads((root / "plans" / "rua-augusta-3e.json").read_text())["title"] == "Rua Augusta 3E"
    assert (state.data_dir / "plans" / "rua-augusta-3e.json").exists()
    assert "rua-augusta-3e" in json.loads((state.data_dir / "manifest.json").read_text())["plans"]
    assert c.post("/api/plans", {"plan": PLAN})[0] == 409, "an existing plan is not replaced by accident"
    assert c.post("/api/plans", {"plan": plan(title="Second"), "overwrite": True})[0] == 200
    assert c.post("/api/plans", {"plan": {"id": "x", "rooms": []}})[0] == 422
    assert c.post("/api/plans", {"plan": "nope"})[0] == 422


def test_an_example_search_does_not_take_plans(tmp_path: Path) -> None:
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=lambda ws, out: None, rescore=lambda ws: None)
    state.ws = Workspace(ROOT / "examples" / "nyc-2026")
    from apartmentscout.localapi import ApiError
    with pytest.raises(ApiError) as e:
        state.save_plan(PLAN, False)
    assert e.value.status == 403
    assert not (ROOT / "examples" / "nyc-2026" / "plans" / "rua-augusta-3e.json").exists()
