"""Setting up a search in a city that is not New York, in a real browser: the wizard asks for the city (looked up when the
page is served by `apartmentscout serve`), the commute destination (address lookup or a map pin), the transit timetable,
and shows what happens next (the buildings around each home, floor plans). The lookups are fakes: no network."""
from __future__ import annotations

import threading
from pathlib import Path

import pytest
from conftest import block_foreign, settled
import yaml

from apartmentscout import cities as C
from apartmentscout import cli
from apartmentscout.config import Workspace
from apartmentscout.criteria_check import check_text
from apartmentscout.intake import init_search
from apartmentscout.localapi import ServeState, make_server

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
WIZARD = ".wz-scrim.on .wz"
CHICAGO = C.CityInfo(id="chicago", name="Chicago, Illinois", lat=41.87556, lon=-87.62442, timezone="America/Chicago", country="us",
                     state="Illinois", osm="relation/122604")


def _next(page, n: int = 1) -> None:
    for _ in range(n):
        page.click("[data-act=next]")
        page.wait_for_timeout(120)


def _open_static(open_page):
    s = open_page("?new=1#map")
    s.page.wait_for_selector(WIZARD, timeout=10000)
    s.page.wait_for_selector(".wz-scrim.on", timeout=10000)
    settled(s.page, 20000, ticks=3)
    return s


def test_a_city_without_a_profile_is_named_and_gets_its_transit_feed(open_page) -> None:
    s = _open_static(open_page)
    pg = s.page
    pg.fill("#f-name", "Chicago 1BR")
    pg.click("[data-city=generic]")
    pg.wait_for_selector("#f-city_name")
    assert not pg.query_selector("[data-act=findcity]"), "a static page cannot look the city up, so it does not offer to"
    pg.fill("#f-city_name", "Chicago, IL")
    pg.click("[data-place='Chicago']")                     # the offline quick start fills the zone and the map centre
    assert pg.input_value("#f-timezone") == "America/Chicago"
    _next(pg)
    pg.fill("#f-dest\\.0\\.address", "233 S Wacker Dr, Chicago, IL")
    assert "walking only" in pg.inner_text(".wz-main"), "with no feed the page says commutes are walking only"
    pg.fill("#wzFeedUrl", "not an address")
    pg.click("[data-act=addfeed]")
    assert pg.locator(".wz-feed").count() == 0
    pg.fill("#wzFeedUrl", "https://www.transitchicago.com/downloads/sch_data/google_transit.zip")
    pg.click("[data-act=addfeed]")
    pg.wait_for_selector(".wz-feed")
    assert pg.input_value("#f-feed\\.0\\.name") == "TRANSITCHICAGO"
    pg.fill("#f-feed\\.0\\.name", "CTA")
    _next(pg, 6)
    pg.wait_for_selector("#wzStepTitle:has-text('Almost there')")
    nxt = pg.inner_text(".wz-next")
    for title in ("Add listings", "Fetch the buildings around each home", "Add floor plans", "Score, build and look"):
        assert title in nxt
    assert "New plan from image" in nxt and "apartmentscout surroundings --search searches/chicago-1br" in nxt
    with pg.expect_download() as d:
        pg.click(".wz-f [data-act=download]")
    text = Path(d.value.path()).read_text()
    rep = check_text(text)
    assert rep.ok, rep.errors
    c = yaml.safe_load(text)
    assert (c["search"]["city"], c["search"]["city_name"], c["search"]["timezone"]) == ("chicago", "Chicago, IL", "America/Chicago")
    assert c["commute"]["transit"]["feeds"] == [{"name": "CTA", "url": "https://www.transitchicago.com/downloads/sch_data/google_transit.zip"}]
    assert not any("timezone" in w or "New York" in w for w in rep.warnings), rep.warnings
    assert "apartmentscout init searches/chicago-1br --city chicago --criteria" in pg.inner_text(".wz-cmd >> nth=0")
    assert not s.take()


def test_picking_a_profile_city_after_a_typed_one_resets_the_zone_and_the_feeds(open_page) -> None:
    s = _open_static(open_page)
    pg = s.page
    pg.click("[data-city=generic]")
    pg.fill("#f-city_name", "Chicago")
    pg.click("[data-place='Chicago']")
    pg.click("[data-city=nyc]")
    assert pg.input_value("#f-timezone") == "America/New_York"
    assert not pg.query_selector("#f-city_name")
    _next(pg)
    assert "profile brings its 3 timetable feeds" in pg.inner_text(".wz-main") or "3 timetable feed" in pg.inner_text(".wz-main")


@pytest.fixture
def served(tmp_path: Path, browser):
    searches = tmp_path / "searches"
    mine = searches / "mine"
    init_search(mine, "generic")
    state = ServeState(
        dash=ROOT / "dashboard", searches_dir=searches, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
        export=cli._export, rescore=cli._rescore,
        resolve_city=lambda q: CHICAGO if "chi" in q.lower() else None,
        locate=lambda q, city: {"lat": 41.87892, "lon": -87.636602, "label": "Willis Tower, Chicago"} if "wacker" in q.lower() else None,
        check_feed=lambda u: C.FeedCheck(u.endswith(".zip"), "a zip file" if u.endswith(".zip") else "that address is a web page", 12.0))
    state.activate(Workspace(mine))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    base = f"http://127.0.0.1:{state.port}"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce", accept_downloads=True)
    block_foreign(ctx, base)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    yield page, base, searches, errors
    ctx.close()
    httpd.shutdown()
    httpd.server_close()


def test_served_wizard_looks_up_the_city_the_address_and_the_feed_and_creates_the_search(served) -> None:
    page, base, searches, errors = served
    page.goto(f"{base}/?new=1#map")
    page.wait_for_selector(WIZARD, timeout=20000)
    page.fill("#f-name", "Chicago served")
    page.click("[data-city=generic]")
    page.fill("#f-city_name", "Atlantis")
    page.click("[data-act=findcity]")
    page.wait_for_selector(".wz-citybox .wz-note.bad")
    assert "Could not find 'Atlantis'" in page.inner_text(".wz-citybox .wz-note.bad")   # the server's own wording is shown
    page.fill("#f-city_name", "Chicago, IL")
    page.click("[data-act=findcity]")
    page.wait_for_selector(".wz-found")
    found = page.inner_text(".wz-found")
    assert "Chicago, Illinois" in found and "America/Chicago" in found and "City open data" in found
    assert page.input_value("#f-timezone") == "America/Chicago"
    assert page.input_value("#f-city_name") == "Chicago, Illinois"
    _next(page)
    page.fill("#f-dest\\.0\\.address", "233 S Wacker Dr")
    page.click("[data-act=findaddr]")
    page.wait_for_selector(".wz-pin.set")
    assert "41.87892" in page.inner_text(".wz-pin")
    page.click("[data-starter='0']")
    page.wait_for_selector(".wz-feed")
    assert page.input_value("#f-feed\\.0\\.name") == "CTA"
    page.fill("#wzFeedUrl", "https://agency.example/developers")
    page.click("[data-act=addfeed]")
    page.wait_for_timeout(300)
    assert page.locator(".wz-feed").count() == 1, "a web page is not accepted as a feed"
    _next(page, 6)
    page.wait_for_selector("#wzStepTitle:has-text('Almost there')")
    page.fill("#f-folder", "chicago-served")
    page.click("[data-act=create]")
    page.wait_for_selector(".wz-note.good", timeout=10000)
    assert "apartmentscout surroundings --search" in page.inner_text(".wz-main")
    d = searches / "chicago-served"
    text = (d / "criteria.yaml").read_text()
    rep = check_text(text)
    assert rep.ok, rep.errors
    c = yaml.safe_load(text)
    assert (c["search"]["city"], c["search"]["city_name"], c["search"]["timezone"]) == ("chicago", "Chicago, Illinois", "America/Chicago")
    assert c["search"]["map_center"] == [41.87556, -87.62442]
    assert c["commute"]["destinations"][0]["lat"] == 41.87892 and c["commute"]["transit"]["feeds"][0]["name"] == "CTA"
    assert not any("timezone" in w or "New York" in w or "map_center" in w or "feeds is empty" in w for w in rep.warnings), rep.warnings
    assert not errors, errors
