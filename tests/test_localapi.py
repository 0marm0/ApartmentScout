"""The dashboard's local API (apartmentscout/localapi.py): token, host and path guards, validation, backups, search creation."""
from __future__ import annotations

import http.client
import json
import threading
import time
from pathlib import Path
from typing import Any, Iterator

import pytest

from apartmentscout import cli
from apartmentscout.config import Workspace
from apartmentscout.intake import init_search
from apartmentscout.localapi import ServeState, make_server

ROOT = Path(__file__).resolve().parents[1]
GOOD = """search:
  name: Wizard search
  city: generic
  move_in: {earliest: 2026-12-01, latest: 2027-01-15}
budget:
  basis: monthly_cost
  tiers:
    - {name: Target, max: 3000}
  hard_max: 3400
unit: {min_beds: 1, sqft_floor: 400, sqft_good: 650, sqft_great: 900}
must_have: [in_unit_wd]
commute:
  destinations:
    - {name: Work, address: 1 Main St, arrive_by: "09:00", max_minutes: 30, weight: 1}
weights: {cost: 30}
building_ratings: {Ritz: 4}
"""


class Client:
    def __init__(self, port: int, token: str | None) -> None:
        self.port, self.token = port, token

    def call(self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None, raw: bytes | None = None,
             token: bool = True) -> tuple[int, Any]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"127.0.0.1:{self.port}"}
        if token and self.token:
            h["X-AS-Token"] = self.token
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        payload = r.read()
        c.close()
        try:
            return r.status, json.loads(payload)
        except ValueError:
            return r.status, payload


@pytest.fixture
def served(tmp_path: Path) -> Iterator[tuple[Client, ServeState, Path]]:
    searches = tmp_path / "searches"
    mine = searches / "mine"
    init_search(mine, "generic")
    state = ServeState(dash=ROOT / "dashboard", searches_dir=searches, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(mine))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    yield Client(state.port, state.token), state, searches
    httpd.shutdown()
    httpd.server_close()


def test_binds_to_loopback_only(served) -> None:
    _, state, _ = served
    # the listening socket is on 127.0.0.1, so no other machine can reach it
    import socket
    with socket.socket() as s:
        assert s.connect_ex(("127.0.0.1", state.port)) == 0


def test_the_served_page_carries_the_token_and_nothing_else_does(served) -> None:
    c, state, _ = served
    status, html = c.call("GET", "/", token=False)
    assert status == 200 and f'<meta name="as-token" content="{state.token}">'.encode() in html
    status, js = c.call("GET", "/js/app.js", token=False)
    assert status == 200 and state.token.encode() not in js


def test_api_requires_the_token(served) -> None:
    c, _, _ = served
    for method, path in [("GET", "/api/session"), ("GET", "/api/criteria"), ("POST", "/api/criteria"), ("POST", "/api/searches"),
                         ("POST", "/api/rescore"), ("POST", "/api/validate")]:
        status, body = c.call(method, path, {"yaml": GOOD} if method == "POST" else None, token=False)
        assert status == 401, (method, path)
    status, _ = c.call("GET", "/api/session", headers={"X-AS-Token": "wrong"}, token=False)
    assert status == 401
    assert c.call("GET", "/api/session")[0] == 200


def test_wrong_host_or_origin_is_refused(served) -> None:
    c, _, _ = served
    assert c.call("GET", "/api/session", headers={"Host": "evil.example:80"})[0] == 403
    assert c.call("GET", "/api/session", headers={"Origin": "https://evil.example"})[0] == 403
    assert c.call("GET", "/", headers={"Host": "rebind.example"}, token=False)[0] == 403
    assert c.call("GET", "/api/session", headers={"Origin": f"http://127.0.0.1:{c.port}"})[0] == 200
    assert c.call("OPTIONS", "/api/criteria", token=False)[0] == 403


def test_session_describes_the_open_search(served) -> None:
    c, _, _ = served
    _, s = c.call("GET", "/api/session")
    assert s["can_save"] is True and s["search"]["folder"] == "mine" and not s["example"]
    assert [x["folder"] for x in s["searches"]] == ["mine"] and s["searches"][0]["active"]
    assert {x["id"] for x in s["cities"]} >= {"generic", "nyc"}
    assert any(f["url"] for x in s["cities"] if x["id"] == "nyc" for f in x["feeds"])


def test_get_criteria_returns_the_file(served) -> None:
    c, _, searches = served
    status, body = c.call("GET", "/api/criteria")
    assert status == 200 and body["yaml"] == (searches / "mine" / "criteria.yaml").read_text()


def test_save_writes_atomically_and_keeps_a_backup(served) -> None:
    c, _, searches = served
    f = searches / "mine" / "criteria.yaml"
    before = f.read_text()
    status, body = c.call("POST", "/api/criteria", {"yaml": GOOD})
    assert status == 200 and body["ok"], body
    assert f.read_text() == GOOD
    backup = searches / "mine" / body["backup"]
    assert backup.read_text() == before and backup.parent.name == "backups"
    assert any("apartmentscout score" in n for n in body["next"])
    assert not list((searches / "mine").glob(".criteria.*.tmp"))
    # a second save the same second does not overwrite the first backup
    status, body2 = c.call("POST", "/api/criteria", {"yaml": GOOD.replace("Wizard search", "Again")})
    assert status == 200 and body2["backup"] != body["backup"] and len(list((searches / "mine" / "backups").glob("*.yaml"))) == 2


@pytest.mark.parametrize("bad,needle", [
    ("search: {name: X}\nbudget:\n  tiers: [{name: A, max: 5000}, {name: B, max: 4000}]\n", "must be above"),
    ("search: {name: X\n", "Not valid YAML"),
    ("", "empty"),
    ("search: {name: X}\nscoring: {preset: nope}\n", "Unknown scoring preset"),
    ("budget: {basis: bananas}\n", "search.name"),
])
def test_invalid_yaml_is_rejected_and_the_file_is_untouched(served, bad: str, needle: str) -> None:
    c, _, searches = served
    f = searches / "mine" / "criteria.yaml"
    before = f.read_text()
    status, body = c.call("POST", "/api/criteria", {"yaml": bad})
    assert status == 422 and needle in " ".join(body["errors"]), body
    assert f.read_text() == before
    assert not (searches / "mine" / "backups").exists()


def test_validate_endpoint_reports_without_writing(served) -> None:
    c, _, searches = served
    before = (searches / "mine" / "criteria.yaml").read_text()
    status, ok = c.call("POST", "/api/validate", {"yaml": GOOD})
    assert status == 200 and ok["ok"] and any("Wizard search" in line for line in ok["summary"])
    status, bad = c.call("POST", "/api/validate", {"yaml": "nope: ["})
    assert status == 200 and not bad["ok"] and bad["errors"]
    assert (searches / "mine" / "criteria.yaml").read_text() == before


def test_a_symlinked_criteria_file_is_not_followed(served, tmp_path: Path) -> None:
    c, _, searches = served
    outside = tmp_path / "elsewhere.yaml"
    outside.write_text("search: {name: outside}\n")
    f = searches / "mine" / "criteria.yaml"
    f.unlink()
    f.symlink_to(outside)
    status, _ = c.call("POST", "/api/criteria", {"yaml": GOOD})
    assert status == 403 and outside.read_text() == "search: {name: outside}\n"


def test_create_a_search_from_criteria(served) -> None:
    c, _, searches = served
    status, body = c.call("POST", "/api/searches", {"name": "Boston 2BR, fall", "yaml": GOOD})
    assert status == 200 and body["folder"] == "boston-2br-fall", body
    d = searches / "boston-2br-fall"
    assert (d / "criteria.yaml").read_text() == GOOD
    assert (d / "listings.json").exists() and (d / "research").is_dir()
    assert any("serve --search" in n for n in body["next"])
    # a second one with the same name does not overwrite
    status, again = c.call("POST", "/api/searches", {"name": "Boston 2BR, fall", "yaml": GOOD})
    assert status == 409 and "already exists" in again["error"]


def test_create_adds_the_city_profile_for_nyc(served) -> None:
    c, _, searches = served
    status, body = c.call("POST", "/api/searches", {"folder": "nyc-one", "city": "nyc", "yaml": GOOD.replace("city: generic", "city: nyc")})
    assert status == 200, body
    from apartmentscout.config import load_criteria
    crit = load_criteria(searches / "nyc-one" / "criteria.yaml")
    assert len(crit["commute"]["transit"]["feeds"]) == 3 and crit["search"]["timezone"] == "America/New_York"


@pytest.mark.parametrize("folder", ["../escape", "..", ".", "a/b", "/etc/passwd", "a\\b", "UPPER", "-lead", "x" * 61, "", "con trol", "a\x00b", "~", "%2e%2e"])
def test_folder_names_cannot_leave_the_searches_folder(served, tmp_path: Path, folder: str) -> None:
    c, _, searches = served
    status, body = c.call("POST", "/api/searches", {"folder": folder, "yaml": GOOD})
    if folder == "":   # an empty folder falls back to a name made from the title, which is safe
        assert status in (200, 400, 409)
    else:
        assert status == 400, (folder, status, body)
    assert not (tmp_path / "escape").exists()
    assert sorted(p.name for p in searches.iterdir() if p.is_dir()) in (["mine"], ["mine", "search"])


def test_create_refuses_a_symlinked_target(served, tmp_path: Path) -> None:
    c, _, searches = served
    (tmp_path / "outside").mkdir()
    (searches / "sneaky").symlink_to(tmp_path / "outside")
    status, _ = c.call("POST", "/api/searches", {"folder": "sneaky", "yaml": GOOD})
    assert status in (400, 409) and not list((tmp_path / "outside").iterdir())


def test_create_rejects_invalid_criteria_and_leaves_no_folder(served) -> None:
    c, _, searches = served
    status, body = c.call("POST", "/api/searches", {"folder": "broken", "yaml": "search: {name: X}\nunit: {sqft_floor: 9, sqft_good: 5, sqft_great: 2}\n"})
    assert status == 422 and "sizes must rise" in " ".join(body["errors"])
    assert not (searches / "broken").exists()


def test_body_limits_and_content_type(served) -> None:
    c, _, _ = served
    big = json.dumps({"yaml": "x" * (300 * 1024)}).encode()
    assert c.call("POST", "/api/validate", raw=big, headers={"Content-Type": "application/json"})[0] == 413
    assert c.call("POST", "/api/validate", raw=b"yaml=1", headers={"Content-Type": "text/plain"})[0] == 415
    assert c.call("POST", "/api/validate", raw=b"{nope", headers={"Content-Type": "application/json"})[0] == 400
    assert c.call("POST", "/api/validate", raw=b"[1]", headers={"Content-Type": "application/json"})[0] == 400


def test_other_methods_and_paths_are_refused(served) -> None:
    c, _, _ = served
    assert c.call("PUT", "/api/criteria", {"yaml": GOOD})[0] == 405
    assert c.call("DELETE", "/api/criteria")[0] == 405
    assert c.call("POST", "/js/app.js", {})[0] == 405
    assert c.call("GET", "/api/nothing")[0] == 404


def test_activate_switches_the_search_the_page_serves(served) -> None:
    c, state, searches = served
    c.call("POST", "/api/searches", {"folder": "second", "yaml": GOOD})
    status, _ = c.call("POST", "/api/searches/activate", {"folder": "second"})
    assert status == 200 and state.ws.root.name == "second"
    status, crit = c.call("GET", "/data/criteria.json", token=False)
    assert status == 200 and crit["search"]["name"] == "Wizard search"
    assert c.call("POST", "/api/searches/activate", {"folder": "missing"})[0] == 404
    assert c.call("POST", "/api/searches/activate", {"folder": "../mine"})[0] == 400


def test_data_route_cannot_escape_the_search_cache(served) -> None:
    c, _, _ = served
    status, _ = c.call("GET", "/data/..%2f..%2fcriteria.yaml", token=False)
    assert status in (403, 404)
    status, _ = c.call("GET", "/data/../criteria.yaml", token=False)
    assert status in (403, 404)


def test_rescore_runs_in_the_background_and_reports_progress(served) -> None:
    c, _, _ = served
    status, body = c.call("POST", "/api/rescore", {})
    assert status == 200 and body["job"]
    job = body["job"]
    for _ in range(100):
        _, v = c.call("GET", f"/api/jobs/{job}")
        if v["state"] != "running":
            break
        time.sleep(0.1)
    assert v["state"] == "done", v
    assert [s["state"] for s in v["steps"]] == ["done", "done"]
    assert c.call("GET", "/api/jobs/nope")[0] == 404


def test_example_searches_are_read_only(tmp_path: Path) -> None:
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path / "searches", ws=None, data_dir=ROOT / "dashboard" / "data",
                       media_dir=None, export=lambda ws, out: None, rescore=lambda ws: None)
    state.ws = Workspace(ROOT / "examples" / "nyc-2026")
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    try:
        c = Client(state.port, state.token)
        _, s = c.call("GET", "/api/session")
        assert s["example"] is True and s["can_save"] is False
        before = (ROOT / "examples" / "nyc-2026" / "criteria.yaml").read_text()
        assert c.call("POST", "/api/criteria", {"yaml": GOOD})[0] == 403
        assert c.call("POST", "/api/rescore", {})[0] == 403
        assert (ROOT / "examples" / "nyc-2026" / "criteria.yaml").read_text() == before
        # creating a new search is still fine
        assert c.call("POST", "/api/searches", {"folder": "mine", "yaml": GOOD})[0] == 200
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_without_an_open_search_criteria_endpoints_say_so(tmp_path: Path) -> None:
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path / "searches", ws=None, data_dir=ROOT / "dashboard" / "data",
                       media_dir=None, export=lambda ws, out: None, rescore=lambda ws: None)
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    try:
        c = Client(state.port, state.token)
        _, s = c.call("GET", "/api/session")
        assert s["search"] is None and s["can_save"] is False and s["searches"] == []
        assert c.call("GET", "/api/criteria")[0] == 404
        assert c.call("POST", "/api/criteria", {"yaml": GOOD})[0] == 409
        assert c.call("POST", "/api/searches", {"folder": "first", "yaml": GOOD})[0] == 200   # creates searches/ on demand
        assert (tmp_path / "searches" / "first" / "criteria.yaml").exists()
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_no_api_switch_serves_files_only(tmp_path: Path) -> None:
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=lambda ws, out: None, rescore=lambda ws: None, api=False)
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    try:
        c = Client(state.port, state.token)
        status, html = c.call("GET", "/", token=False)
        assert status == 200 and b"as-token" not in html
        assert c.call("GET", "/api/session")[0] == 404
    finally:
        httpd.shutdown()
        httpd.server_close()
