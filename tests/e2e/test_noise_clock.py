"""Noise by hour of the day in a real browser: the clock chart in the listing drawer and the hour slider on the map's noise layer.

Runs on the example dashboard. The data are the 311 noise complaints already in the repository (layers/noise-hours.json and
the dossiers' by-hour profiles). The map tests need WebGL, otherwise they are skipped; the drawer tests do not."""
from __future__ import annotations

import re

import pytest
from conftest import map_opened, settled

pytestmark = pytest.mark.e2e

APP = "(await import('/js/app.js'))"
DOSSIER_HOME = "paramount-tower-25e"


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _open_drawer(pg, lid: str) -> None:
    pg.evaluate(f"async (id) => {{ const a = {APP}; a.openDrawer(id); }}", lid)
    pg.wait_for_selector("#dNoise .nh-clock", timeout=20000)


def _a_home_without_a_dossier(pg) -> str:
    lid = pg.evaluate(f"""async () => {{ const a = {APP}; const have = new Set(a.S.manifest.dossiers || []);
      return a.sorted(a.filtered()).find((L) => L.lat != null && !have.has(L.id))?.id; }}""")
    assert lid
    return lid


def test_the_drawer_draws_a_24_hour_clock_and_says_when_it_is_loudest(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_drawer(pg, DOSSIER_HOME)
    assert pg.locator("#dNoise .nh-clock .nh-sp").count() == 24
    assert pg.locator("#dNoise .nh-clock .nh-sp.pk").count() == 3          # the loudest three hours
    head = pg.locator("#dNoise .nh-h").inner_text()
    assert re.match(r"^(Loudest (Sun–Thu|Fri–Sat) \d{1,2}( am| pm)?–\d{1,2} (am|pm)(: mostly .+)?\.|No clear loud hour.+)$", head), head
    assert "complaints" in pg.locator("#dNoise h3").inner_text()          # labelled as complaints, never decibels
    note = pg.locator("#dNoise .nh-note").inner_text()
    assert "not decibel readings" in note and re.search(r"[\d,]+ complaints within 150 m of this address", note), note
    # a dossier and the map layer both know this home: the clock can be read at the address or around it
    assert pg.locator("#dNoise [data-nh-scope]").count() == 2
    pg.locator('#dNoise [data-nh-scope="area"]').click()
    pg.wait_for_function("() => /around it/.test(document.querySelector('#dNoise .nh-note').textContent)", timeout=5000)
    assert re.search(r"complaints in about 450 m around it", pg.locator("#dNoise .nh-note").inner_text())
    # the nights can be told apart
    pg.locator('#dNoise [data-nh-clock="1"]').click()
    pg.wait_for_selector('#dNoise [data-nh-clock="1"][aria-pressed="true"]', timeout=5000)
    assert pg.locator("#dNoise .nh-clock .nh-sp").count() == 24
    assert not s.take(), s.take()


def test_a_home_without_a_dossier_gets_the_area_clock_from_the_map_layer(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    lid = _a_home_without_a_dossier(pg)
    _open_drawer(pg, lid)
    assert pg.locator("#dNoise [data-nh-scope]").count() == 0
    assert re.search(r"complaints in about 450 m around it", pg.locator("#dNoise .nh-note").inner_text())
    assert pg.locator("#dNoise .nh-clock .nh-sp").count() == 24
    assert pg.locator("#dNoise .nh-h").inner_text().strip()
    assert not s.take(), s.take()


def test_the_noise_map_has_an_hour_slider_that_repaints_the_surface(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("?layer=noise#map")
    pg = s.page
    map_opened(pg)
    pg.wait_for_selector("#nhHour", timeout=20000)
    assert pg.locator("#lgHours .nh-all.on").count() == 1                  # all hours until you move the slider
    pg.wait_for_function("() => !!window.__asMap.getSource('heat')", timeout=20000)
    all_day = pg.evaluate("() => window.__asMap.getSource('heat').url")
    pg.locator("#nhHour").fill("23")
    pg.wait_for_function("() => document.querySelector('#nhHourOut').textContent === '11 pm'", timeout=10000)
    pg.wait_for_function("(u) => window.__asMap.getSource('heat').url !== u", arg=all_day, timeout=20000)
    assert "11 pm" in pg.locator("#legend h4").inner_text()
    assert pg.locator("#lgHours .nh-all.on").count() == 0
    at_11pm = pg.evaluate("() => window.__asMap.getSource('heat').url")
    pg.locator("#nhHour").fill("5")
    pg.wait_for_function("(u) => window.__asMap.getSource('heat').url !== u", arg=at_11pm, timeout=20000)
    # the weekend nights are their own picture
    pg.locator("#nhHour").fill("23")
    pg.wait_for_function("() => document.querySelector('#nhHourOut').textContent === '11 pm'")
    settled(pg)
    before = pg.evaluate("() => window.__asMap.getSource('heat').url")
    pg.locator('#lgHours [data-nh-cls="1"]').click()
    pg.wait_for_function("(u) => window.__asMap.getSource('heat').url !== u", arg=before, timeout=20000)
    assert "Fri–Sat" in pg.locator("#legend h4").inner_text()
    # and "All hours" is the surface that was always there
    pg.locator("#lgHours [data-nh-all]").click()
    pg.wait_for_function("() => document.querySelector('#lgHours .nh-all.on')", timeout=10000)
    assert "complaints, not decibels" in pg.locator("#legend").inner_text()
    assert not s.take(), s.take()


def test_the_drawer_links_to_the_map_at_the_loud_hour(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    map_opened(pg)
    _open_drawer(pg, DOSSIER_HOME)
    link = pg.locator("#dNoise [data-nh-map]")
    if not link.count():
        pytest.skip("this home has no clear loud hour")
    start = int(link.get_attribute("data-nh-map"))
    link.click()
    pg.wait_for_selector("#nhHour", timeout=20000)
    pg.wait_for_function("(h) => +document.querySelector('#nhHour').value === h && !document.querySelector('#lgHours .nh-all.on')", arg=start, timeout=20000)
    assert not s.take(), s.take()
