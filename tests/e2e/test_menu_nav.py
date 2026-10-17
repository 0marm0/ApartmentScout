"""The one top-right menu and the view tabs (Playwright + axe-core).

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_menu_nav.py -q

The menu (#menuBtn opens #appMenu: This search, Data, Appearance, Comfort, Help; js/app-menu.js) replaces the folder menu and the
settings menu. The tabs (#tabs: Map, Shortlist, Compare, Home, Research) have icons, a sliding indicator and badges, Unit 3D and
Floor plan live under Home with a sub-switch, and on a phone the tabs are a bottom bar.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import settled
from playwright.sync_api import TimeoutError as PlaywrightTimeout

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels: see conftest.NO_RASTER_JS

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
SECTIONS = ["This search", "Data", "Appearance", "Comfort", "Help"]
EMERALD = "emerald-green-1211"    # has a site model and a plan in the example


def _open_menu(pg) -> None:
    # the lazy feature module adds Share shortlist and Decision memo to the Data section a moment after the first render:
    # open once they are in, so the menu does not grow under the test
    pg.wait_for_selector("#mnShare", state="attached", timeout=20000)
    pg.locator("#menuBtn").click()
    pg.wait_for_selector("#appMenu:not([hidden])")


def _axe(page, include: list[str] | None = None) -> list[dict]:
    """Serious and critical WCAG A/AA violations in the whole page, or only inside the `include` selectors."""
    if not page.evaluate("() => typeof window.axe === 'object'"):
        page.add_script_tag(path=str(AXE))
    return page.evaluate("""async (include) => {
      const r = await axe.run(include ? { include: include.map((s) => [s]) } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations'], exclude: [['.maplibregl-canvas'], ['canvas']] });
      return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
    }""", include)


# ------------------------------------------------------------------ one menu
def test_one_menu_replaces_the_folder_and_settings_buttons(open_page) -> None:
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    assert pg.locator("#searchMenuBtn, #setBtn, #setMenu").count() == 0, "the old buttons are gone"
    assert pg.locator(".top-actions .icon-btn:visible").count() == 1, "one icon button at the right: the menu"
    pg.wait_for_selector("#mnShare", state="attached", timeout=15000)   # the share items are added by the lazy feature module
    _open_menu(pg)
    heads = pg.eval_on_selector_all("#appMenu .am-h", "els => els.map((e) => e.textContent)")
    assert heads == SECTIONS
    # every control that used to live in either menu
    for sel in ("#mnEdit", "#mnSearch", "#mnNew", "#csvBtn", "#mnPicks", "#mnRestore", "#mnShare", "#mnMemo",
                "[data-theme-mode=system]", "[data-theme-mode=dark]", "[data-theme-mode=light]", "[data-accent=iris]", "[data-accent=rose]",
                "[data-density=compact]", "[data-dest-pin=classic]", "#mnGolden", "#mnMotion", "#mnTransp", "#mnContrast", "[data-text=xl]",
                "#mnPalette", "#mnKeys", "#mnTour"):
        assert pg.locator(f"#appMenu {sel}").count() == 1, sel
    # each item sits in its section
    assert pg.locator("#amSearch #mnEdit, #amSearch #mnNew").count() == 2
    assert pg.evaluate("() => document.querySelector('#amDataH').parentElement.contains(document.getElementById('csvBtn'))")
    assert pg.evaluate("() => document.querySelector('#amHelpH').parentElement.contains(document.getElementById('mnTour'))")
    assert pg.locator("#mnSwitch").is_hidden(), "no other searches without the local API"
    assert pg.locator("#amName").inner_text().strip() == pg.evaluate("() => document.getElementById('searchName').textContent")
    assert not s.take()


def test_menu_keyboard_navigation(open_page) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    active = lambda: pg.evaluate("() => document.activeElement.id || document.activeElement.dataset.themeMode || document.activeElement.dataset.accent || ''")  # noqa: E731
    pg.focus("#menuBtn"); pg.keyboard.press("Enter")
    pg.wait_for_selector("#appMenu:not([hidden])")
    assert active() == "mnEdit" and pg.get_attribute("#menuBtn", "aria-expanded") == "true"
    # roving focus: exactly one item is in the tab order
    assert pg.evaluate("() => [...document.querySelectorAll('#appMenu button[role^=menuitem]')].filter((b) => b.tabIndex === 0).length") == 1
    pg.keyboard.press("ArrowDown"); assert active() == "mnSearch"
    pg.keyboard.press("ArrowDown"); assert active() == "mnNew"       # Switch search is hidden without the API
    pg.keyboard.press("ArrowUp"); assert active() == "mnSearch"
    pg.keyboard.press("End")
    assert active() == "mnTour", "End goes to the last row"
    pg.keyboard.press("Home"); assert active() == "mnEdit"
    # a segmented group is one stop: down lands on its checked option, left and right move inside it
    pg.focus("[data-theme-mode=dark]")
    pg.keyboard.press("ArrowRight"); assert active() == "light"
    pg.keyboard.press("ArrowLeft"); pg.keyboard.press("ArrowLeft"); assert active() == "system"
    pg.focus("[data-theme-mode=dark]")
    pg.keyboard.press("ArrowDown")
    assert pg.evaluate("() => document.activeElement.dataset.accent") == "iris", "down from Theme reaches the Accent row at its checked swatch"
    # typing a letter jumps to the next row that starts with it
    pg.keyboard.press("Home"); pg.keyboard.press("k")
    assert active() == "mnKeys"
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => document.getElementById('appMenu').hidden")
    assert pg.evaluate("() => document.activeElement.id") == "menuBtn", "Esc returns focus to the button"
    assert pg.get_attribute("#menuBtn", "aria-expanded") == "false"
    # Esc also works when the menu was opened with the mouse and focus is elsewhere; Tab leaves and closes it
    _open_menu(pg); pg.keyboard.press("Escape"); pg.wait_for_function("() => document.getElementById('appMenu').hidden")
    pg.focus("#menuBtn"); pg.keyboard.press("Enter"); pg.keyboard.press("Tab")
    pg.wait_for_function("() => document.getElementById('appMenu').hidden")
    assert not s.take()


def test_choices_keep_the_menu_open_and_actions_close_it(open_page) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    _open_menu(pg)
    for sel in ("[data-theme-mode=light]", "[data-accent=jade]", "[data-density=compact]", "[data-dest-pin=classic]", "#mnContrast", "[data-text=l]"):
        pg.click(f"#appMenu {sel}")
        assert pg.evaluate("() => !document.getElementById('appMenu').hidden"), f"{sel} keeps the menu open"
    assert pg.evaluate("() => document.documentElement.dataset.theme") == "light"
    assert pg.evaluate("() => document.documentElement.dataset.accent") == "jade"
    assert pg.get_attribute("#appMenu [data-density=compact]", "aria-checked") == "true"
    pg.click("#mnKeys")
    pg.wait_for_function("() => document.getElementById('appMenu').hidden")
    pg.wait_for_selector(".cs-scrim.on")
    pg.keyboard.press("Escape")
    _open_menu(pg)
    with pg.expect_download() as dl:
        pg.click("#csvBtn")
    assert dl.value.suggested_filename.endswith(".csv")
    pg.wait_for_function("() => document.getElementById('appMenu').hidden")
    _open_menu(pg)
    pg.click("#mnSearch")
    pg.wait_for_selector(".sheet-scrim.on")
    assert pg.evaluate("() => document.getElementById('appMenu').hidden")
    assert not s.take()


def test_back_up_and_restore_picks(open_page, tmp_path) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    pg.wait_for_selector("#cards .card[data-id]")
    ids = pg.evaluate("() => [...document.querySelectorAll('#cards .card[data-id]')].slice(0, 2).map((c) => c.dataset.id)")
    backup = tmp_path / "picks.json"
    backup.write_text(json.dumps({"version": 1, "picks": {i: {"saved": True, "note": "restored"} for i in ids}}))
    assert pg.locator("#savedCount").is_hidden()
    _open_menu(pg)
    with pg.expect_file_chooser() as fc:
        pg.click("#mnRestore")
    fc.value.set_files(str(backup))
    pg.wait_for_function("() => document.getElementById('savedCount').textContent === '2'", timeout=10000)
    _open_menu(pg)
    with pg.expect_download() as dl:
        pg.click("#mnPicks")
    saved = json.loads(Path(dl.value.path()).read_text())
    assert set(ids) <= set(saved["picks"])
    assert not s.take()


def test_the_search_switcher_opens_the_same_menu_under_itself(open_page) -> None:
    s = open_page("#map", width=1600, height=900)
    pg = s.page
    assert pg.is_visible("#searchSwitch")
    pg.click("#searchSwitch")
    pg.wait_for_selector("#appMenu:not([hidden])")
    sw, mn = pg.locator("#searchSwitch").bounding_box(), pg.locator("#appMenu").bounding_box()
    assert abs(mn["x"] - sw["x"]) < 40 and mn["y"] >= sw["y"] + sw["height"], (sw, mn)
    assert pg.get_attribute("#searchSwitch", "aria-expanded") == "true" and pg.get_attribute("#menuBtn", "aria-expanded") == "false"
    assert pg.evaluate("() => document.getElementById('amBody').scrollTop") == 0, "it opens at This search"
    pg.click("#menuBtn")        # the other opener takes over
    assert pg.get_attribute("#menuBtn", "aria-expanded") == "true" and pg.get_attribute("#searchSwitch", "aria-expanded") == "false"
    mn2 = pg.locator("#appMenu").bounding_box()
    assert mn2["x"] > 1200
    pg.keyboard.press("Escape")
    assert not s.take()


def test_other_searches_appear_when_the_local_api_answers(browser, base_url: str) -> None:
    from conftest import build_url
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce", service_workers="block")
    activated: list[str] = []
    session = {"can_save": True, "search": {"folder": "searches/mine", "name": "Mine"},
               "searches": [{"name": "Mine", "folder": "searches/mine", "active": True}, {"name": "Second flat", "folder": "searches/second", "active": False}]}

    def route(r) -> None:
        url = r.request.url
        if url.endswith("/api/session"):
            r.fulfill(status=200, content_type="application/json", body=json.dumps(session))
        elif url.endswith("/api/searches/activate"):
            activated.append(r.request.post_data or "")
            r.fulfill(status=200, content_type="application/json", body="{}")
        elif url.startswith((base_url, "data:", "blob:")):
            r.continue_()
        else:
            r.abort()
    ctx.route("**/*", route)
    ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'as-token'; m.content = 'test'; document.head.append(m); });")
    try:
        pg = ctx.new_page()
        pg.goto(build_url(base_url, "#map"))
        pg.wait_for_selector("#cards .card", timeout=20000)
        _open_menu(pg)
        pg.wait_for_selector("#mnSwitch:not([hidden])")
        assert "searches/mine" in pg.locator("#amMeta").inner_text()
        assert pg.locator("#amSwitchList").is_hidden() and pg.get_attribute("#mnSwitch", "aria-expanded") == "false"
        pg.click("#mnSwitch")
        assert pg.locator("#amSwitchList [data-switch]").count() == 1 and pg.is_visible("#amSwitchList")
        assert pg.evaluate("() => !document.getElementById('appMenu').hidden"), "Switch search expands in place"
        assert pg.evaluate("() => document.activeElement.dataset.switch") == "searches/second"
        with pg.expect_navigation():
            pg.click("[data-switch='searches/second']")
        assert json.loads(activated[0])["folder"] == "searches/second"
    finally:
        ctx.close()


def test_menu_fits_a_short_screen_and_scrolls(open_page) -> None:
    s = open_page("#map", width=1280, height=520)
    pg = s.page
    _open_menu(pg)
    box = pg.locator("#appMenu").bounding_box()
    assert box["y"] + box["height"] <= 520 + 1, box
    assert pg.evaluate("() => { const b = document.getElementById('amBody'); return b.scrollHeight > b.clientHeight; }"), "the body scrolls"
    pg.locator("#mnTour").scroll_into_view_if_needed()
    tour = pg.locator("#mnTour").bounding_box()
    assert tour["y"] + tour["height"] <= 520, "the last row can be reached"
    assert not s.take()


def test_menu_stays_above_the_compare_tray(open_page) -> None:
    s = open_page("#map", width=1024, height=768)
    pg = s.page
    pg.wait_for_selector("#cards .card[data-id]")
    pg.evaluate("() => import('/js/app.js').then((m) => m.toggleCompare(document.querySelector('#cards .card[data-id]').dataset.id))")
    pg.wait_for_selector(".tray", state="visible")
    _open_menu(pg)
    pg.locator("#mnTour").scroll_into_view_if_needed()
    settled(pg, 20000, ticks=3)
    # the menu has finished opening and scrolling (a slow runner is still mid-way after a short quiet spell): then the last row is on top
    on_top = """() => { const r = document.getElementById('mnTour').getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!e && !!e.closest('#mnTour'); }"""
    try:
        pg.wait_for_function(on_top, timeout=10000)
    except PlaywrightTimeout:
        pass
    assert pg.evaluate(on_top), pg.evaluate("""() => { const q = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), getComputedStyle(el).zIndex]; };
      const r = document.getElementById('mnTour').getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { covered_by: e && (e.tagName + '#' + e.id + '.' + e.className.toString().slice(0, 60)), row: q('#mnTour'), menu: q('#appMenu'), tray: q('.tray'),
        topbar: q('.topbar'), body: document.body.className }; }""")   # the last row is not covered by the tray
    assert not s.take()


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_menu_is_a_bottom_sheet_on_a_phone(open_page, theme: str) -> None:
    s = open_page("#map", theme=theme, width=390, height=844)
    pg = s.page
    _open_menu(pg)
    pg.wait_for_selector("#amScrim:not([hidden])")
    box = pg.locator("#appMenu").bounding_box()
    assert box["x"] == 0 and box["width"] == 390 and abs(box["y"] + box["height"] - 844) <= 1, box
    assert box["y"] >= 60, "the top bar stays visible above the sheet"
    assert pg.evaluate("() => document.documentElement.scrollWidth") <= 390
    # nothing in the sheet pokes out sideways, and every row is a comfortable touch target
    assert pg.evaluate("""() => [...document.querySelectorAll('#appMenu button')].filter((b) => b.offsetParent && (b.getBoundingClientRect().right > 391 || b.getBoundingClientRect().left < -1)).length""") == 0
    assert pg.evaluate("() => Math.min(...[...document.querySelectorAll('#appMenu button[role=menuitem]')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height))") >= 40
    pg.locator("#mnTour").scroll_into_view_if_needed()
    pg.wait_for_function("() => document.getElementById('mnTour').getBoundingClientRect().bottom <= 845", timeout=5000)   # the last row scrolls into the sheet
    assert not [x for x in _axe(pg)], "axe: no serious violations with the sheet open"
    pg.mouse.click(195, 30)     # the scrim above the sheet closes it
    pg.wait_for_function("() => document.getElementById('appMenu').hidden")
    assert pg.evaluate("() => document.activeElement.id") == "menuBtn"
    _open_menu(pg); pg.keyboard.press("Escape")
    pg.wait_for_function("() => document.getElementById('appMenu').hidden")
    assert not s.take()


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_menu_has_no_serious_axe_violations(open_page, theme: str) -> None:
    s = open_page("#map", theme=theme, width=1440, height=900)
    pg = s.page
    _open_menu(pg)
    assert _axe(pg) == []
    assert not s.take()


# ------------------------------------------------------------------ tabs
def test_tabs_have_icons_labels_and_badges(open_page) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    labels = pg.eval_on_selector_all("#tabs a", "els => els.map((e) => e.querySelector('.nl').textContent)")
    assert labels == ["Map", "Shortlist", "Compare", "3D", "Research"]
    assert pg.locator("#tabs a svg.ni").count() == 5
    assert pg.evaluate("() => document.querySelector('#tabs a.on').dataset.view") == "map"
    pg.wait_for_selector("#cards .card[data-id]")
    ids = pg.evaluate("() => [...document.querySelectorAll('#cards .card[data-id]')].slice(0, 3).map((c) => c.dataset.id)")
    pg.evaluate("(ids) => ids.forEach((id) => import('/js/app.js').then((m) => m.setPick(id, { saved: true })))", ids)
    pg.wait_for_function("() => document.getElementById('savedCount').textContent === '3'", timeout=10000)
    pg.evaluate("(ids) => ids.slice(0, 2).forEach((id) => import('/js/app.js').then((m) => m.toggleCompare(id)))", ids)
    pg.wait_for_function("() => document.getElementById('cmpCount').textContent === '2'", timeout=10000)
    assert pg.locator("#savedCount").is_visible() and pg.locator("#cmpCount").is_visible()
    assert "3" in pg.locator("#tabs a[data-view=list]").inner_text() and "2" in pg.locator("#tabs a[data-view=compare]").inner_text()
    assert not s.take()


def test_sliding_indicator_follows_the_active_tab(open_page) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    pg.wait_for_selector(".nav-ink", state="attached")
    ink = lambda: pg.evaluate("""() => { const i = document.querySelector('.nav-ink'), a = document.querySelector('#tabs a.on');
      return { x: new DOMMatrix(getComputedStyle(i).transform).m41, w: parseFloat(i.style.width), ax: a.offsetLeft, aw: a.offsetWidth }; }""")  # noqa: E731
    first = ink()
    assert abs(first["x"] - first["ax"]) < 1 and abs(first["w"] - first["aw"]) < 1
    pg.click('#tabs a[data-view="compare"]')
    pg.wait_for_function("() => document.querySelector('#tabs a.on').dataset.view === 'compare'")
    pg.wait_for_function("""() => { const i = document.querySelector('.nav-ink'), a = document.querySelector('#tabs a.on');
      return Math.abs(new DOMMatrix(getComputedStyle(i).transform).m41 - a.offsetLeft) < 1 && Math.abs(parseFloat(i.style.width) - a.offsetWidth) < 1; }""", timeout=10000)   # the indicator is under the new tab
    second = ink()
    assert second["x"] > first["x"] + 50 and abs(second["x"] - second["ax"]) < 1 and abs(second["w"] - second["aw"]) < 1
    # the context asks for reduced motion: the indicator jumps (no transition)
    assert pg.evaluate("() => getComputedStyle(document.querySelector('.nav-ink')).transitionDuration") in ("0s", "0.001s", "1e-06s")
    assert not s.take()


def test_unit_3d_and_floor_plan_live_under_home(open_page) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    assert pg.locator('#tabs a[data-view="unit"], #tabs a[data-view="plan"]').count() == 0, "one 3D tab, not two"
    pg.click('#tabs a[data-view="home"]')
    pg.wait_for_function("() => document.body.dataset.view === 'unit'", timeout=30000)
    assert pg.locator("#tabs a.on").get_attribute("data-view") == "home"
    sub = pg.locator("#subnav")
    assert sub.is_visible() and sub.get_attribute("data-kind") == "home"
    assert pg.eval_on_selector_all("#subnav a", "els => els.map((e) => e.textContent)") == ["Unit 3D", "Floor plan"]
    assert pg.locator("#subnav .share-split").count() == 0, "the share button belongs to the Shortlist row only"
    pg.click('#subnav a[data-sub="plan"]')
    pg.wait_for_function("() => document.body.dataset.view === 'plan'", timeout=30000)
    assert pg.locator("#tabs a.on").get_attribute("data-view") == "home" and pg.locator("#subnav a.on").inner_text() == "Floor plan"
    # leaving Home and coming back opens the view you were on
    pg.click('#tabs a[data-view="map"]')
    pg.wait_for_function("() => document.body.dataset.view === 'map'")
    assert pg.get_attribute('#tabs a[data-view="home"]', "href") == "#plan"
    pg.click('#tabs a[data-view="home"]')
    pg.wait_for_function("() => document.body.dataset.view === 'plan'", timeout=30000)
    assert not s.take()


@pytest.mark.parametrize("view", ["unit", "plan"])
def test_deep_links_still_open_the_unit_and_plan(open_page, view: str) -> None:
    s = open_page(f"#{view}/{EMERALD}", width=1440, height=900)
    pg = s.page
    pg.wait_for_function("(v) => document.body.dataset.view === v && !document.getElementById('view-' + v).hidden", arg=view, timeout=30000)
    assert pg.locator("#tabs a.on").get_attribute("data-view") == "home"
    other = "plan" if view == "unit" else "unit"
    assert pg.get_attribute(f'#subnav a[data-sub="{other}"]', "href") == f"#{other}/{EMERALD}", "the sub-switch keeps the same home"
    pg.wait_for_function("(v) => document.getElementById('view-' + v).children.length > 0", arg=view, timeout=30000)
    assert not s.take()


def test_number_keys_and_chords_follow_the_tabs(open_page) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    pg.wait_for_function("() => !!window.__asMap && window.__asMap.loaded()", timeout=30000)
    settled(pg, 30000)   # the map has opened, so the first keys are not racing it
    hash_ = lambda: pg.evaluate("() => location.hash.split('/')[0]")  # noqa: E731
    for key, want in (("2", "#list"), ("3", "#compare"), ("5", "#research"), ("1", "#map")):
        pg.keyboard.press(key)
        pg.wait_for_function("(w) => location.hash.split('/')[0] === w", arg=want)
    pg.keyboard.press("4")
    pg.wait_for_function("() => location.hash.split('/')[0] === '#unit'", timeout=10000)
    pg.wait_for_function("() => document.body.dataset.view === 'unit'", timeout=30000)
    pg.keyboard.press("4")                    # on Home, 4 flips to the other side
    pg.wait_for_function("() => document.body.dataset.view === 'plan'", timeout=30000)
    pg.keyboard.press("g"); pg.keyboard.press("u")
    pg.wait_for_function("() => document.body.dataset.view === 'unit'", timeout=30000)
    pg.keyboard.press("g"); pg.keyboard.press("p")
    pg.wait_for_function("() => document.body.dataset.view === 'plan'", timeout=30000)
    assert hash_() == "#plan"
    pg.keyboard.press("g"); pg.keyboard.press("m")
    pg.wait_for_function("() => document.body.dataset.view === 'map'")
    assert not s.take()


@pytest.mark.parametrize("width,height", [(1600, 1000), (1440, 900), (1366, 768), (1280, 800), (1024, 768)])
def test_top_bar_stays_one_clean_line(open_page, width: int, height: int) -> None:
    s = open_page("#map", width=width, height=height)
    pg = s.page
    pg.evaluate("() => document.fonts.ready")
    settled(pg, 20000, ticks=6)   # fonts and the search name are in, the tabs have their final width
    r = pg.evaluate("""() => {
      const t = document.querySelector('.topbar').getBoundingClientRect(), out = { h: t.height, bad: [] };
      for (const el of document.querySelectorAll('.topbar > *, .top-actions > *')) {
        const b = el.getBoundingClientRect(); if (!b.width) continue;
        if (b.top < t.top - 1 || b.bottom > t.bottom + 1 || b.right > innerWidth || b.left < 0) out.bad.push(el.className || el.id || el.tagName);
      }
      const n = document.getElementById('tabs').getBoundingClientRect(), a = document.querySelector('.top-actions').getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect();
      out.gapL = n.left - br.right; out.gapR = a.left - n.right; out.sw = document.documentElement.scrollWidth - innerWidth;
      return out; }""")
    assert r["h"] <= 56 and not r["bad"] and r["sw"] <= 0, r
    assert r["gapL"] >= 8 and r["gapR"] >= 8, r      # the tabs never touch their neighbours
    assert not s.take()


def test_top_bar_on_a_phone_has_no_tabs_row(open_page) -> None:
    s = open_page("#map", width=390, height=844)
    pg = s.page
    top = pg.evaluate("() => document.querySelector('.topbar').getBoundingClientRect().height")
    assert top <= 60, top
    bar = pg.locator("#tabs").bounding_box()
    assert bar["y"] > 700 and bar["height"] >= 54
    # the compare tray and the toast clear the bar
    pg.evaluate("() => import('/js/app.js').then((m) => m.toggleCompare(document.querySelector('#cards .card[data-id]').dataset.id))")
    try:
        pg.wait_for_selector(".tray", state="visible", timeout=5000)
    except PlaywrightTimeout:
        pass   # the tray is optional here: when it shows, it has to clear the bar
    settled(pg, 20000, ticks=3)
    tray = pg.locator(".tray")
    if tray.count() and tray.first.is_visible():
        tb = tray.first.bounding_box()
        assert tb["y"] + tb["height"] <= bar["y"] + 1, (tb, bar)
    assert pg.evaluate("() => document.documentElement.scrollWidth") <= 390
    assert not s.take()


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_tabs_and_home_switch_have_no_serious_axe_violations(open_page, theme: str) -> None:
    s = open_page("#unit/" + EMERALD, theme=theme, width=1440, height=900)
    pg = s.page
    pg.wait_for_function("() => document.body.dataset.view === 'unit'", timeout=30000)
    pg.wait_for_function("() => !!(window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.scene) && document.getElementById('uLoad')?.hidden !== false", timeout=60000)
    settled(pg, 30000, ticks=6)
    assert _axe(pg, [".topbar", "#subnav"]) == [], "the top bar and the Home switch (the 3D views have their own checks)"
    s2 = open_page("#map", theme=theme, width=390, height=844)
    assert _axe(s2.page) == []
    assert not s.take() and not s2.take()
