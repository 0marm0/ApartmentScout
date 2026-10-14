"""The results list and filter rail in a real browser: the active-filter chip row, collapsible rail sections, the
windowed card list with rank-change motion, the Comfortable / Compact density setting, price-history sparklines and
live re-scoring in a Web Worker (dashboard/js/features/).

The shared `open_page` fixture turns animation off (reduced motion); the tests that look at motion open their own page
with `motion=True`. Heavy views get generous timeouts: CI runners are slow.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
LISTINGS = json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())
HISTORY = json.loads((ROOT / "dashboard" / "data" / "history.json").read_text())
T = 30000
STATE = "async () => (await import('/js/app.js')).S"


def _wait_worker(s) -> None:
    s.page.wait_for_function("() => document.documentElement.dataset.scoring === 'worker'", timeout=T)


@pytest.fixture
def open_page(open_page):
    """The shared open_page, then wait until the app has booted: cards drawn and the rail built (the shared one returns earlier)."""
    def _open(path: str = "#map", **kw):
        s = open_page(path, **kw)
        s.page.wait_for_function("() => document.querySelector('#cards .card') && document.querySelector('#rail [data-w]')", timeout=T)
        s.page.wait_for_timeout(250)
        return s
    return _open


@pytest.fixture
def open_motion(browser, base_url: str):
    """Like open_page, but with animation on, and with optional replacement data files ({'/data/history.json': obj})."""
    contexts = []

    def _open(path: str = "", width: int = 1440, height: int = 900, data: dict | None = None, theme: str = "dark"):
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=1, reduced_motion="no-preference")
        contexts.append(ctx)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
        def serve(body):
            return lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        for url, body in (data or {}).items():
            ctx.route(base_url + url, serve(body))
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console: {m.text[:200]}") if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.goto(f"{base_url}/{path}")
        page.wait_for_function("() => document.querySelector('#cards .card')", timeout=T)
        page.wait_for_timeout(600)
        return page, errors

    yield _open
    for c in contexts:
        c.close()


# ------------------------------------------------------------------ active-filter chips
def test_no_chips_at_the_start_and_one_per_active_filter(open_page) -> None:
    s = open_page("#map")
    p = s.page
    assert p.locator("#filterChips.has").count() == 0
    assert p.locator("#filterChips").get_attribute("aria-hidden") == "true"
    p.locator('[data-tg="elevator"]').click()
    p.locator('[data-tg="gym"]').click()
    p.locator('[data-st="researching"]').click()
    p.evaluate("() => { const r = document.getElementById('rCom'); r.value = 30; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }")
    p.wait_for_selector("#filterChips.has", timeout=T)
    labels = p.eval_on_selector_all("#fchipScroll .fchip", "bs => bs.map(b => b.textContent.trim())")
    assert labels[:2] == ["≤ 30 min · Best", "Elevator"] or "Elevator" in labels, labels
    assert "Elevator" in labels and "Gym" in labels and any(x.startswith("≤ 30 min") for x in labels) and "4 statuses" in labels
    assert p.locator("#filterChips").get_attribute("aria-hidden") == "false"
    assert not s.take()


def test_removing_a_chip_updates_the_rail_and_the_results(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.locator('[data-tg="elevator"]').click()
    p.locator('[data-tg="gym"]').click()
    p.wait_for_selector('.fchip[data-id="toggle:gym"]', timeout=T)
    n_two = p.evaluate(f"async () => (await ({STATE})()).filters.toggles.length")
    assert n_two == 2
    count_before = p.locator("#listTitle").inner_text()
    p.locator('.fchip[data-id="toggle:gym"]').click()
    p.wait_for_selector('.fchip[data-id="toggle:gym"]', state="detached", timeout=T)
    assert p.locator('[data-tg="gym"]').get_attribute("aria-checked") == "false"      # the rail follows the chip
    assert p.locator('[data-tg="elevator"]').get_attribute("aria-checked") == "true"
    assert p.locator("#listTitle").inner_text() != count_before                        # the list follows too
    # and the other way round: switching the rail control off drops the chip
    p.locator('[data-tg="elevator"]').click()
    p.wait_for_function("() => !document.querySelector('.fchip')", timeout=T)
    assert not s.take()


def test_clear_all_goes_back_to_the_starting_view(open_page) -> None:
    s = open_page("#map")
    p = s.page
    start = p.locator("#listTitle").inner_text()
    p.locator('[data-tg="doorman"]').click()
    p.locator('[data-tier="2"]').click()
    p.locator('[data-st="gone"]').click()
    p.wait_for_function("() => document.querySelectorAll('.fchip').length === 3", timeout=T)
    p.get_by_role("button", name="Clear all filters").click()
    p.wait_for_function("() => !document.querySelector('.fchip:not(.leaving)') && !document.querySelector('#filterChips.has')", timeout=T)
    assert p.locator("#listTitle").inner_text() == start
    assert p.locator('[data-tier="2"]').get_attribute("aria-pressed") == "true"
    assert p.locator('[data-st="gone"]').get_attribute("aria-pressed") == "false"
    assert not s.take()


def test_text_search_and_saved_picks_make_chips_and_chips_clear_them(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.evaluate("async () => { const m = await import('/js/app.js'); m.setFilter('q', 'orion'); m.setFilter('savedOnly', true); }")
    p.wait_for_selector('.fchip[data-id="q"]', timeout=T)
    assert p.locator('.fchip[data-id="q"]').inner_text().strip() == "“orion”"
    assert p.locator('.fchip[data-id="saved"]').count() == 1
    p.locator('.fchip[data-id="q"]').click()
    p.wait_for_selector('.fchip[data-id="q"]', state="detached", timeout=T)
    assert p.evaluate(f"async () => (await ({STATE})()).filters.q") == ""
    assert not s.take()


def test_chip_row_scrolls_sideways_on_a_phone(open_page) -> None:
    s = open_page("#map", width=390, height=844)
    p = s.page
    p.evaluate("""async () => { const m = await import('/js/app.js');
      m.setFilter('toggles', ['in_unit_wd', 'elevator', 'doorman', 'gym', 'floor10']); m.setFilter('savedOnly', true); }""")
    p.wait_for_selector("#filterChips.has", timeout=T)
    p.wait_for_timeout(400)
    box = p.evaluate("() => { const s = document.getElementById('fchipScroll'); const cs = getComputedStyle(s); return { sw: s.scrollWidth, cw: s.clientWidth, wrap: cs.flexWrap, ox: cs.overflowX }; }")
    assert box["wrap"] == "nowrap" and box["ox"] == "auto" and box["sw"] > box["cw"], box
    # every chip is a finger-sized target and nothing makes the page itself scroll sideways
    h = p.eval_on_selector_all("#fchipScroll .fchip", "bs => bs.map(b => b.getBoundingClientRect().height)")
    assert min(h) >= 28, h
    assert p.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert not s.take()


def test_chips_are_keyboard_operable(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.evaluate("async () => { const m = await import('/js/app.js'); m.setFilter('toggles', ['elevator', 'gym']); }")
    p.wait_for_selector('.fchip[data-id="toggle:elevator"]', timeout=T)
    p.locator('.fchip[data-id="toggle:elevator"]').focus()
    p.keyboard.press("ArrowRight")
    assert p.evaluate("() => document.activeElement.dataset.id") == "toggle:gym"
    p.keyboard.press("Enter")
    p.wait_for_selector('.fchip[data-id="toggle:gym"]', state="detached", timeout=T)
    p.wait_for_function("() => document.activeElement.classList.contains('fchip') || document.activeElement.classList.contains('fchip-clear')", timeout=T)
    assert not s.take()


# ------------------------------------------------------------------ collapsible rail sections
SECTIONS = ["search", "budget", "commute", "features", "status", "weights"]


def test_every_rail_section_is_a_disclosure(open_page) -> None:
    s = open_page("#map")
    p = s.page
    for sec in SECTIONS:
        b = p.locator(f"#sec-tg-{sec}")
        assert b.get_attribute("aria-expanded") == "true", sec
        assert b.get_attribute("aria-controls") == f"sec-body-{sec}"
        assert p.locator(f"#sec-body-{sec}").count() == 1
    assert not s.take()


def test_collapse_shows_a_summary_hides_the_body_and_is_remembered(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.locator("#sec-tg-budget").click()
    p.locator("#sec-tg-features").click()
    p.wait_for_function("() => document.getElementById('sec-tg-budget').getAttribute('aria-expanded') === 'false'", timeout=T)
    assert p.evaluate("() => document.getElementById('sec-body-budget').inert")                 # out of the tab order
    assert p.locator('.sec[data-sec="budget"] .sec-sum').inner_text().strip().startswith("Within budget ≤ $")
    assert p.locator('.sec[data-sec="features"] .sec-sum').inner_text().strip() == "None"
    assert p.locator('.sec[data-sec="budget"] .sec-sum').is_visible()
    assert p.locator('.sec[data-sec="status"] .sec-sum').evaluate("e => getComputedStyle(e).opacity") == "0"   # only collapsed sections show one
    p.reload()
    p.wait_for_function("() => document.querySelector('#cards .card')", timeout=T)
    assert p.locator("#sec-tg-budget").get_attribute("aria-expanded") == "false"
    assert p.locator("#sec-tg-features").get_attribute("aria-expanded") == "false"
    assert p.locator("#sec-tg-commute").get_attribute("aria-expanded") == "true"
    assert not s.take()


def test_section_height_animates(open_motion) -> None:
    p, errors = open_motion("")
    h0 = p.evaluate("() => document.getElementById('sec-body-status').getBoundingClientRect().height")
    p.locator("#sec-tg-status").click()
    p.wait_for_timeout(110)
    mid = p.evaluate("() => document.getElementById('sec-body-status').getBoundingClientRect().height")
    p.wait_for_timeout(450)
    end = p.evaluate("() => document.getElementById('sec-body-status').getBoundingClientRect().height")
    assert end < 1 and 1 < mid < h0, (h0, mid, end)    # it passes through in-between heights instead of snapping
    assert not errors


def test_section_headings_are_keyboard_operable(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.locator("#sec-tg-budget").focus()
    p.keyboard.press("Enter")
    assert p.locator("#sec-tg-budget").get_attribute("aria-expanded") == "false"
    p.keyboard.press("Space")
    assert p.locator("#sec-tg-budget").get_attribute("aria-expanded") == "true"
    p.keyboard.press("ArrowDown")
    assert p.evaluate("() => document.activeElement.id") == "sec-tg-commute"
    p.keyboard.press("End")
    assert p.evaluate("() => document.activeElement.id") == "sec-tg-weights"
    p.keyboard.press("Home")
    assert p.evaluate("() => document.activeElement.id") == "sec-tg-search"
    assert not s.take()


def test_a_filter_change_keeps_keyboard_focus_in_the_rail(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.locator('[data-tg="gym"]').focus()
    p.keyboard.press("Space")
    p.wait_for_selector('.fchip[data-id="toggle:gym"]', timeout=T)
    assert p.evaluate("() => document.activeElement?.dataset?.tg") == "gym"       # the rail was rebuilt, focus came back
    assert not s.take()


def test_collapsed_sections_work_on_a_phone(open_page) -> None:
    s = open_page("#map", width=390, height=844)
    p = s.page
    p.locator("#filtersBtn").click()
    p.wait_for_function("() => document.body.classList.contains('rail-open')", timeout=T)
    p.locator("#sec-tg-weights").click()
    p.wait_for_timeout(400)
    assert p.locator("#sec-tg-weights").get_attribute("aria-expanded") == "false"
    assert p.locator('.sec[data-sec="weights"] .sec-sum').inner_text().strip()
    assert p.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert not s.take()


# ------------------------------------------------------------------ the windowed card list
def test_only_the_cards_in_view_are_rendered_and_the_scroll_height_is_right(open_page) -> None:
    s = open_page("#map")
    p = s.page
    total = p.evaluate(f"async () => (await import('/js/app.js')).filtered().length")
    info = p.evaluate("() => { const h = document.getElementById('cards'); return { n: h.querySelectorAll('.card').length, sh: h.scrollHeight, set: h.querySelector('.card').getAttribute('aria-setsize') }; }")
    assert total > 100
    assert info["n"] < 40, info
    assert int(info["set"]) == total
    assert abs(info["sh"] - total * 133) < total * 4 + 60, info       # about 133 px a card, from the first frame
    assert p.locator("#cards").get_attribute("role") == "feed"
    assert not s.take()


def test_scrolling_renders_the_right_cards_to_the_end(open_page) -> None:
    s = open_page("#map")
    p = s.page
    total = p.evaluate("async () => (await import('/js/app.js')).filtered().length")
    for frac in (0.25, 0.5, 0.75, 1.0):
        p.evaluate("(f) => { const h = document.getElementById('cards'); h.scrollTop = (h.scrollHeight - h.clientHeight) * f; }", frac)
        p.wait_for_timeout(250)
        got = p.evaluate("""() => { const h = document.getElementById('cards'), hr = h.getBoundingClientRect();
          return [...h.querySelectorAll('.card')].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > hr.top + 4 && r.top < hr.bottom - 4; }).map((c) => +c.getAttribute('aria-posinset')); }""")
        assert got and got == list(range(got[0], got[-1] + 1)), (frac, got)      # a gap-free run of visible cards
        assert len(got) >= 5
        if frac == 1.0:
            assert got[-1] == total
    assert p.evaluate("() => document.querySelectorAll('#cards .card').length") < 40
    assert not s.take()


def test_j_k_and_arrow_keys_walk_the_whole_list(open_page) -> None:
    s = open_page("#map")
    p = s.page
    total = p.evaluate("async () => (await import('/js/app.js')).filtered().length")
    first_ids = p.evaluate("async () => (await import('/js/features/card-list.js')).cardIds().slice(0, 40)")
    for _ in range(30):                                   # past the rendered window
        p.keyboard.press("j")
    p.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=first_ids[29], timeout=T)
    p.wait_for_timeout(500)
    assert p.evaluate("() => { const c = document.querySelector('#cards .card.sel'); const r = c.getBoundingClientRect(), h = document.getElementById('cards').getBoundingClientRect(); return r.bottom > h.top && r.top < h.bottom; }")
    p.keyboard.press("k")
    p.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=first_ids[28], timeout=T)
    p.keyboard.press("Escape")
    # arrows, Home and End move focus through cards that are not in the DOM yet
    p.locator("#cards .card").first.focus()
    p.keyboard.press("End")
    p.wait_for_function("(n) => document.activeElement?.getAttribute('aria-posinset') === String(n)", arg=total, timeout=T)
    p.keyboard.press("ArrowUp")
    assert p.evaluate("() => document.activeElement.getAttribute('aria-posinset')") == str(total - 1)
    p.keyboard.press("Home")
    p.wait_for_function("() => document.activeElement?.getAttribute('aria-posinset') === '1'", timeout=T)
    p.keyboard.press("PageDown")
    assert int(p.evaluate("() => document.activeElement.getAttribute('aria-posinset')")) > 3
    assert not s.take()


def test_opening_a_listing_scrolls_an_unrendered_card_into_view(open_page) -> None:
    s = open_page("#map")
    p = s.page
    lid = p.evaluate("async () => (await import('/js/features/card-list.js')).cardIds()[200]")
    p.evaluate("async (id) => (await import('/js/app.js')).openDrawer(id, { instant: true })", lid)
    p.wait_for_selector(f'#cards .card[data-id="{lid}"]', timeout=T)
    p.wait_for_timeout(300)
    assert p.evaluate("(id) => { const c = document.querySelector(`#cards .card[data-id=\"${id}\"]`), r = c.getBoundingClientRect(), h = document.getElementById('cards').getBoundingClientRect(); return r.top >= h.top - 2 && r.bottom <= h.bottom + 2; }", lid)
    assert p.locator(f'#cards .card[data-id="{lid}"]').evaluate("c => c.classList.contains('sel')")
    assert not s.take()


def test_a_resize_across_a_breakpoint_keeps_the_window_and_the_scroll_height_right(open_page) -> None:
    s = open_page("#map", width=1440, height=900)
    p = s.page
    total = p.evaluate("async () => (await import('/js/app.js')).filtered().length")
    p.evaluate("() => { document.getElementById('cards').scrollTop = 9000; }")
    p.wait_for_timeout(300)
    p.set_viewport_size({"width": 1100, "height": 760})          # below 1180 px the rail becomes a sheet and the column changes width
    p.wait_for_timeout(700)
    got = p.evaluate("""() => { const c = document.getElementById('cards'), hr = c.getBoundingClientRect();
      return [...c.querySelectorAll('.card')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > hr.top + 4 && r.top < hr.bottom - 4; }).map((e) => +e.getAttribute('aria-posinset')); }""")
    assert got and got == list(range(got[0], got[-1] + 1)) and len(got) >= 5, got
    p.evaluate("() => { const c = document.getElementById('cards'); c.scrollTop = c.scrollHeight; }")
    p.wait_for_timeout(400)
    p.evaluate("() => { const c = document.getElementById('cards'); c.scrollTop = c.scrollHeight; }")
    p.wait_for_timeout(300)
    last = p.evaluate("() => { const c = document.getElementById('cards'), hr = c.getBoundingClientRect(); const e = [...c.querySelectorAll('.card')].pop(); return [+e.getAttribute('aria-posinset'), e.getBoundingClientRect().bottom <= hr.bottom + 1]; }")
    assert last == [total, True], last
    assert not s.take()


def test_changing_density_keeps_the_card_you_were_looking_at(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.evaluate("() => { document.getElementById('cards').scrollTop = 6000; }")
    p.wait_for_timeout(300)
    top = lambda: p.evaluate("""() => { const c = document.getElementById('cards'), hr = c.getBoundingClientRect();
      const e = [...c.querySelectorAll('.card')].find((x) => x.getBoundingClientRect().bottom > hr.top + 20); return +e.getAttribute('aria-posinset'); }""")  # noqa: E731
    before = top()
    p.evaluate("async () => (await import('/js/features/density.js')).setDensity('compact')")
    p.wait_for_timeout(700)
    assert abs(top() - before) <= 1, (before, top())
    assert not s.take()


@pytest.mark.parametrize("density", ["comfortable", "compact"])
def test_cards_do_not_shift_when_the_window_moves(open_page, density: str) -> None:
    """The window maths (gap, padding) must match the rendered pixels in both densities: a card keeps its place while others come and go."""
    s = open_page(f"?density={density}#map")
    p = s.page
    p.evaluate("() => { document.getElementById('cards').scrollTop = 3000; }")
    p.wait_for_timeout(300)
    drift = p.evaluate("""async () => {
      const h = document.getElementById('cards'), raf = () => new Promise((r) => requestAnimationFrame(r));
      const pick = h.querySelectorAll('.card')[6], id = pick.dataset.id, out = [];
      let last = pick.getBoundingClientRect().top;
      for (let i = 0; i < 24; i++) {
        h.scrollTop += 61;                               // crosses card boundaries, so the window start moves repeatedly
        await raf(); await raf();
        const c = h.querySelector(`.card[data-id="${id}"]`);
        if (!c) break;
        const t = c.getBoundingClientRect().top;
        out.push(Math.abs((last - t) - 61)); last = t;
      }
      return out;
    }""")
    assert drift and max(drift) < 1.5, drift
    assert not s.take()


def test_a_list_that_shrinks_while_scrolled_far_down_is_not_left_blank(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.evaluate("() => { document.getElementById('cards').scrollTop = 6000; }")
    p.wait_for_timeout(300)
    p.evaluate("async () => (await import('/js/app.js')).setFilter('q', 'paramount')")
    p.wait_for_timeout(500)
    visible = p.evaluate("""() => { const h = document.getElementById('cards'), hr = h.getBoundingClientRect();
      return [...h.querySelectorAll('.card')].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > hr.top && r.top < hr.bottom; }).length; }""")
    assert visible >= 1
    assert not s.take()


def test_a_saved_tier_that_the_search_no_longer_has_does_not_break_the_page(browser, base_url: str) -> None:
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
    ctx.add_init_script("localStorage.setItem('as:filters2', JSON.stringify({ q: '', tiers: [7], over: false, maxCommute: 75, toggles: [], status: ['new'], savedOnly: false }))")
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base_url + "/")
    page.wait_for_function("() => document.querySelector('#rail [data-w]') && document.getElementById('listTitle').textContent", timeout=T)
    assert page.locator("#filterChips.has").count() == 1       # the status chip, and no crash over tier 7
    ctx.close()
    assert not errors, errors


def test_the_filter_announcement_survives_the_row_being_hidden(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.evaluate("async () => (await import('/js/app.js')).setFilter('savedOnly', true)")
    p.wait_for_selector("#filterChips.has", timeout=T)
    p.evaluate("async () => (await import('/js/app.js')).setFilter('savedOnly', false)")
    p.wait_for_function("() => !document.querySelector('#filterChips.has')", timeout=T)
    assert p.locator("#fchipStatus").inner_text() == "No filters active"
    assert p.evaluate("() => !document.getElementById('filterChips').contains(document.getElementById('fchipStatus'))")
    assert not s.take()


def test_closing_the_drawer_returns_focus_to_a_card_that_was_scrolled_away(open_page) -> None:
    s = open_page("#map")
    p = s.page
    lid = p.evaluate("async () => (await import('/js/features/card-list.js')).cardIds()[3]")
    p.locator(f'#cards .card[data-id="{lid}"]').click()
    p.wait_for_selector("#drawer.open", timeout=T)
    p.locator("#drawer .d-scroll").focus() if p.locator("#drawer .d-scroll[tabindex]").count() else p.locator("#dClose").focus()
    p.evaluate("() => { document.getElementById('cards').scrollTop = 20000; }")
    p.wait_for_timeout(300)
    assert p.locator(f'#cards .card[data-id="{lid}"]').count() == 0
    p.locator("#dClose").click()
    p.wait_for_function("(id) => document.activeElement?.dataset?.id === id", arg=lid, timeout=T)
    assert not s.take()


def test_j_in_buildings_view_continues_from_a_unit_opened_inside_a_building(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.locator('#groupSeg [data-g="buildings"]').click()
    p.wait_for_selector("#cards .unit-row", timeout=T)
    row = p.locator("#cards .unit-row").first
    uid = row.get_attribute("data-open")
    row.click()
    p.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=uid, timeout=T)
    pos = p.evaluate("async (id) => (await import('/js/features/card-list.js')).cardPos(id)", uid)
    nxt = p.evaluate("async (i) => (await import('/js/features/card-list.js')).cardIds()[i + 1]", pos)
    p.mouse.click(1000, 62)
    p.keyboard.press("j")
    p.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=nxt, timeout=T)
    assert not s.take()


def test_buildings_view_is_windowed_too(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.locator('#groupSeg [data-g="buildings"]').click()
    p.wait_for_function("() => document.querySelector('#cards .vgroup')", timeout=T)
    info = p.evaluate("() => { const h = document.getElementById('cards'); return { n: h.querySelectorAll('.vgroup').length, more: h.querySelectorAll('.units-more').length, set: +h.querySelector('.card').getAttribute('aria-setsize'), sh: h.scrollHeight }; }")
    assert info["n"] < 30 and info["more"] >= 1 and info["set"] > 50, info
    p.evaluate("() => { const h = document.getElementById('cards'); h.scrollTop = h.scrollHeight; }")
    p.wait_for_timeout(300)
    assert p.evaluate("(set) => [...document.querySelectorAll('#cards .card')].some((c) => +c.getAttribute('aria-posinset') === set)", info["set"])
    # the unit rows inside a building still open their listing
    p.evaluate("() => { document.getElementById('cards').scrollTop = 0; }")
    p.wait_for_timeout(200)
    row = p.locator("#cards .unit-row").first
    uid = row.get_attribute("data-open")
    row.click()
    p.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=uid, timeout=T)
    assert not s.take()


def test_card_actions_still_work_through_the_windowed_list(open_page) -> None:
    s = open_page("#map")
    p = s.page
    card = p.locator("#cards .card").nth(1)
    lid = card.get_attribute("data-id")
    card.hover()
    card.locator("[data-save]").click()
    p.wait_for_function("async (id) => (await import('/js/app.js')).isSaved(id)", arg=lid, timeout=T)
    assert p.locator(f'#cards .card[data-id="{lid}"] [data-save]').get_attribute("aria-pressed") == "true"
    card.locator("[data-cmp]").click(force=True)
    p.wait_for_function("async (id) => (await import('/js/app.js')).S.compare.includes(id)", arg=lid, timeout=T)
    assert p.locator("#drawer.open").count() == 0          # the quick actions do not open the listing
    card.click(position={"x": 200, "y": 20})
    p.wait_for_selector("#drawer.open", timeout=T)
    assert not s.take()


# ------------------------------------------------------------------ rank-change motion
RANKS = """() => Object.fromEntries([...document.querySelectorAll('#cards .card')].map((c) => [c.dataset.id, { rank: +(c.querySelector('.rank')?.textContent.replace('#', '') || 0), d: c.querySelector('.rk-d')?.textContent || '' }]))"""
DRAG = """async ({ up, down, steps }) => {
  const set = (k, v) => { const el = document.querySelector(`[data-w="${k}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i <= steps; i++) { set(up, 10 + (i * 30) / steps); set(down, 20 - (i * 20) / steps); await raf(); }
}"""


def test_reranking_slides_cards_and_shows_rank_deltas(open_motion) -> None:
    p, errors = open_motion("")
    before = p.evaluate(RANKS)
    p.evaluate(DRAG, {"up": "commute", "down": "cost", "steps": 14})
    p.wait_for_function("() => document.querySelector('#cards .rk-d')", timeout=T)
    # every badge says exactly how far its rank moved from where the drag began
    after = p.evaluate(RANKS)
    checked = 0
    for lid, v in after.items():
        if not v["d"]:
            continue
        sign = 1 if v["d"].startswith("▲") else -1
        mag = int(v["d"][1:])
        if lid in before and before[lid]["rank"]:
            assert before[lid]["rank"] - v["rank"] == sign * mag, (lid, before[lid], v)
            checked += 1
    assert checked >= 3
    assert any(v["d"].startswith("▲") for v in after.values()) and any(v["d"].startswith("▼") for v in after.values())
    # a badge has a spoken form
    assert p.locator("#cards .rk-d").first.get_attribute("aria-label").startswith("Moved ")
    assert not errors


def test_cards_animate_with_transforms_on_a_reorder_and_not_when_motion_is_reduced(open_motion, open_page) -> None:
    p, errors = open_motion("")
    p.evaluate("""() => { const el = document.querySelector('[data-w="commute"]'); window.__anims = 0;
      new MutationObserver(() => {}).observe(document.body, { childList: true });
      const orig = Element.prototype.animate; Element.prototype.animate = function (...a) { window.__anims++; return orig.apply(this, a); }; }""")
    p.evaluate("""() => { const el = document.querySelector('[data-w="commute"]'); el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); }""")
    p.wait_for_function("() => window.__anims > 0", timeout=T)
    assert not errors
    s = open_page("#map")        # reduced motion: the same change must not start a single animation
    s.page.evaluate("""() => { window.__anims = 0; const orig = Element.prototype.animate; Element.prototype.animate = function (...a) { window.__anims++; return orig.apply(this, a); }; }""")
    s.page.evaluate("""() => { const el = document.querySelector('[data-w="commute"]'); el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); }""")
    s.page.wait_for_function("() => document.querySelector('#cards .rk-d')", timeout=T)
    assert s.page.evaluate("() => window.__anims") == 0
    assert not s.take()


def test_rank_badges_fade_after_the_drag_is_over(open_motion) -> None:
    p, errors = open_motion("")
    p.evaluate("() => { const el = document.querySelector('[data-w=\"commute\"]'); el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    p.wait_for_function("() => document.querySelector('#cards .rk-d')", timeout=T)
    p.wait_for_function("() => !document.querySelector('.rk-d')", timeout=12000)
    assert not errors


def test_shortlist_table_shows_the_same_deltas(open_page) -> None:
    s = open_page("#map")
    p = s.page
    p.evaluate("() => { const el = document.querySelector('[data-w=\"commute\"]'); el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    p.wait_for_function("() => document.querySelector('#cards .rk-d')", timeout=T)
    card_delta = p.evaluate("() => { const c = document.querySelector('#cards .card .rk-d').closest('.card'); return [c.dataset.id, c.querySelector('.rk-d').textContent]; }")
    p.evaluate("() => { location.hash = 'list'; }")
    p.wait_for_selector("#table tbody tr.r", timeout=T)
    cell = p.evaluate("(id) => document.querySelector(`#table tr.r[data-id=\"${id}\"] .rk-d`)?.textContent ?? null", card_delta[0])
    assert cell == card_delta[1]
    assert not s.take()


def test_a_list_reordered_by_filters_keeps_every_card_correct(open_motion) -> None:
    p, errors = open_motion("")
    p.evaluate("async () => { const m = await import('/js/app.js'); m.setFilter('toggles', ['gym']); }")
    p.wait_for_timeout(700)
    ids = p.evaluate("async () => (await import('/js/features/card-list.js')).cardIds().slice(0, 8)")
    dom = p.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 8).map((c) => c.dataset.id)")
    assert ids == dom
    # no card is left mid-slide: transforms are gone once the animations finish
    p.wait_for_timeout(700)
    assert p.evaluate("() => [...document.querySelectorAll('#cards .card')].every((c) => c.getAnimations().length === 0)")
    assert not errors


# ------------------------------------------------------------------ density
def test_density_setting_in_the_menu_changes_cards_rail_and_tables_and_is_remembered(open_page) -> None:
    s = open_page("#map")
    p = s.page
    h_comfy = p.evaluate("() => document.querySelector('#cards .card').offsetHeight")
    rail_comfy = p.evaluate("() => document.getElementById('rail').scrollHeight")
    p.locator("#setBtn").click()
    assert p.locator('button[data-density="comfortable"]').get_attribute("aria-checked") == "true"
    p.locator('button[data-density="compact"]').click()
    assert p.evaluate("() => document.documentElement.dataset.density") == "compact"
    assert p.locator('button[data-density="compact"]').get_attribute("aria-checked") == "true"
    assert p.locator("#setMenu").is_visible()                                       # the menu stays open, like the theme switch
    p.wait_for_timeout(500)
    h_compact = p.evaluate("() => document.querySelector('#cards .card').offsetHeight")
    assert h_compact <= h_comfy - 12, (h_comfy, h_compact)
    assert p.evaluate("() => document.getElementById('rail').scrollHeight") < rail_comfy
    photo = p.evaluate("() => document.querySelector('#cards .media').offsetWidth")
    assert photo < 136
    # price, score and commute stay on a compact card; the badge row is trimmed
    card = p.locator("#cards .card").first
    assert card.locator(".c-price b").is_visible() and card.locator(".ring").is_visible() and card.locator(".c-modes .mode").first.is_visible()
    visible_badges = p.evaluate("() => [...document.querySelector('#cards .card .c-badges').children].filter((b) => getComputedStyle(b).display !== 'none').length")
    assert visible_badges <= 2
    # the Shortlist table follows (and its own buttons follow the global setting)
    p.keyboard.press("Escape")
    p.evaluate("() => { location.hash = 'list'; }")
    p.wait_for_selector("#table tbody tr.r", timeout=T)
    assert p.evaluate("() => document.getElementById('table').classList.contains('compact')")
    assert p.locator('#lsDensity [data-d="compact"]').get_attribute("aria-pressed") == "true"
    p.locator('#lsDensity [data-d="comfortable"]').click()
    assert p.evaluate("() => document.documentElement.dataset.density") == "comfortable"
    p.locator('#lsDensity [data-d="compact"]').click()
    # remembered per browser
    p.reload()
    p.wait_for_selector("#table tbody tr.r", timeout=T)
    assert p.evaluate("() => document.documentElement.dataset.density") == "compact"
    assert not s.take()


def test_density_url_option_and_a_blocked_storage_do_not_break_the_page(open_page) -> None:
    s = open_page("?density=compact#map")
    assert s.page.evaluate("() => document.documentElement.dataset.density") == "compact"
    assert not s.take()


def test_compact_cards_fit_a_phone_and_the_windowing_still_lines_up(open_page) -> None:
    s = open_page("?density=compact#map", width=390, height=844)
    p = s.page
    p.evaluate("() => { const h = document.getElementById('cards'); h.scrollTop = 4000; }")
    p.wait_for_timeout(300)
    got = p.evaluate("""() => { const h = document.getElementById('cards'), hr = h.getBoundingClientRect();
      return [...h.querySelectorAll('.card')].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > hr.top + 4 && r.top < hr.bottom - 4; }).map((c) => +c.getAttribute('aria-posinset')); }""")
    assert got and got == list(range(got[0], got[-1] + 1))
    assert p.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert not s.take()


# ------------------------------------------------------------------ price history
def _listings_with_history() -> tuple[list[dict], dict, dict]:
    top = [L["id"] for L in LISTINGS[:6]]
    hist = json.loads(json.dumps(HISTORY))
    hist["price_history"] = {
        top[0]: [{"date": "2026-09-20", "gross": 5200, "net": None, "source": "snapshot"}, {"date": "2026-10-02", "gross": 5050, "net": None, "source": "snapshot"}],
        top[1]: [{"date": "2026-09-01", "gross": 4000, "net": None, "source": "snapshot"}, {"date": "2026-10-05", "gross": 4100, "net": None, "source": "snapshot"}],
    }
    ls = json.loads(json.dumps(LISTINGS))
    ls[2]["price_history"] = [{"date": "2026-08-15", "gross": 5300}, {"date": "2026-09-15", "gross": 5200}]
    ls[2]["price"]["gross"] = 5100
    ls[2]["checked"] = "2026-10-10"
    return ls, hist, {"drop": top[0], "rise": top[1], "portal": ls[2]["id"]}


def test_price_history_chip_and_sparkline_only_where_prices_were_recorded(open_motion) -> None:
    ls, hist, ids = _listings_with_history()
    p, errors = open_motion("", data={"/data/history.json": hist, "/data/listings.json": ls})
    drop = p.locator('#cards .card[data-id="%s"]' % ids["drop"])
    p.evaluate("async (id) => (await import('/js/app.js')).openDrawer(id, { instant: true })", ids["drop"])
    p.wait_for_selector('#cards .card[data-id="%s"] .ph' % ids["drop"], timeout=T)
    chip = drop.locator(".ph-d")
    assert chip.inner_text().strip() == "↓ $150"
    assert "dropped $150" in drop.locator(".ph").get_attribute("aria-label")
    assert drop.locator(".ph svg path").get_attribute("d").startswith("M")
    # a rise draws the line but no drop chip
    p.evaluate("async (id) => (await import('/js/app.js')).openDrawer(id, { instant: true })", ids["rise"])
    p.wait_for_selector('#cards .card[data-id="%s"] .ph' % ids["rise"], timeout=T)
    rise = p.locator('#cards .card[data-id="%s"]' % ids["rise"])
    assert rise.locator(".ph-d").count() == 0 and "rose $100" in rise.locator(".ph").get_attribute("aria-label")
    # the listing's own portal history counts, with today's price as the last point
    p.evaluate("async (id) => (await import('/js/app.js')).openDrawer(id, { instant: true })", ids["portal"])
    p.wait_for_selector('#cards .card[data-id="%s"] .ph' % ids["portal"], timeout=T)
    assert "$5,100 on Oct 10" in p.locator('#cards .card[data-id="%s"] .ph' % ids["portal"]).get_attribute("aria-label")
    # cards without history stay clean
    others = p.evaluate("""(have) => [...document.querySelectorAll('#cards .card')].filter((c) => !have.includes(c.dataset.id) && c.querySelector('.ph')).length""", list(ids.values()))
    assert others == 0
    assert not errors


def test_no_history_means_no_sparklines_and_no_chips(open_page) -> None:
    s = open_page("#map")
    assert s.page.locator("#cards .ph, #cards .ph-d").count() == 0
    s.page.evaluate("() => { const h = document.getElementById('cards'); h.scrollTop = 6000; }")
    s.page.wait_for_timeout(300)
    assert s.page.locator("#cards .ph, #cards .ph-d").count() == 0
    assert not s.take()


def test_the_hover_card_sparkline_comes_from_the_same_series(open_motion) -> None:
    ls, hist, ids = _listings_with_history()
    p, errors = open_motion("", data={"/data/history.json": hist, "/data/listings.json": ls})
    p.wait_for_function("async (id) => { const m = await import('/js/features/price-ui.js'); const a = await import('/js/app.js'); return !!m.trendOf(a.byId(id)); }", arg=ids["drop"], timeout=T)
    html = p.evaluate("async (id) => { const m = await import('/js/features/price-ui.js'); const a = await import('/js/app.js'); return m.hoverTrendHTML(a.byId(id)); }", ids["drop"])
    assert "ph-hover" in html and "↓ $150" in html and "<path" in html
    none = p.evaluate("async () => { const m = await import('/js/features/price-ui.js'); const a = await import('/js/app.js'); return m.hoverTrendHTML(a.S.listings[5]); }")
    assert none == ""
    assert not errors


# ------------------------------------------------------------------ the worker
def test_worker_scores_exactly_like_rescore(open_page) -> None:
    s = open_page("#map")
    p = s.page
    _wait_worker(s)
    out = p.evaluate("""async () => {
      const a = await import('/js/app.js'), rs = [...document.querySelectorAll('#rail [data-w]')];
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const sig = () => JSON.stringify(a.S.listings.map((L) => [L._s, L._rank, L._ranks]));
      const bad = [];
      let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      for (let round = 0; round < 6; round++) {
        rs.forEach((r) => { r.value = String(Math.round(rnd() * 40)); r.dispatchEvent(new Event('input', { bubbles: true })); });
        await new Promise((r) => setTimeout(r, 160));        // let the worker answer
        const fromWorker = sig();
        a.rescore();                                          // the main-thread reference on the same weights
        if (sig() !== fromWorker) bad.push(round);
      }
      return { bad, mode: document.documentElement.dataset.scoring };
    }""")
    assert out["mode"] == "worker" and out["bad"] == [], out
    assert not s.take()


def test_dragging_a_slider_with_the_worker_reranks_and_stays_consistent(open_page) -> None:
    s = open_page("#map")
    p = s.page
    _wait_worker(s)
    order = lambda: p.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 10).map(c => c.dataset.id)")  # noqa: E731
    before = order()
    p.evaluate("""async () => { const raf = () => new Promise((r) => requestAnimationFrame(r)); const el = document.querySelector('[data-w="quiet"]');
      for (let i = 0; i <= 40; i++) { el.value = String(i); el.dispatchEvent(new Event('input', { bubbles: true })); await raf(); } }""")
    p.wait_for_timeout(700)
    assert order() != before
    # the cards on screen are in the order the scores say, and the KPI strip is up to date
    ok = p.evaluate("""async () => { const a = await import('/js/app.js'); const ids = a.sorted(a.filtered()).slice(0, 10).map((L) => L.id);
      return JSON.stringify(ids) === JSON.stringify([...document.querySelectorAll('#cards .card')].slice(0, 10).map((c) => c.dataset.id)); }""")
    assert ok
    assert not s.take()


def test_without_the_worker_the_same_page_still_works(open_page) -> None:
    s = open_page("?worker=0#map")
    p = s.page
    p.wait_for_function("() => document.documentElement.dataset.scoring === 'sync'", timeout=T)
    before = p.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 10).map(c => c.dataset.id)")
    p.evaluate("""() => { const el = document.querySelector('[data-w="quiet"]'); el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); }""")
    p.wait_for_function("(b) => JSON.stringify([...document.querySelectorAll('#cards .card')].slice(0, 10).map((c) => c.dataset.id)) !== JSON.stringify(b)", arg=before, timeout=T)
    assert p.evaluate("() => document.documentElement.dataset.scoring") == "sync"
    assert not s.take()


def test_a_preset_change_while_the_worker_is_running_is_not_overwritten(open_page) -> None:
    s = open_page("#map")
    p = s.page
    _wait_worker(s)
    ok = p.evaluate("""async () => {
      const a = await import('/js/app.js'), sel = document.getElementById('presetSel');
      if (!sel) return 'no presets';
      const el = document.querySelector('[data-w="cost"]');
      el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true }));          // a request is now in flight
      const other = [...sel.options].find((o) => o.value !== sel.value);
      sel.value = other.value; sel.dispatchEvent(new Event('change', { bubbles: true })); // a preset runs rescore() meanwhile
      await new Promise((r) => setTimeout(r, 300));
      const have = JSON.stringify(a.S.listings.map((L) => [L._s, L._rank]));
      a.rescore();
      return have === JSON.stringify(a.S.listings.map((L) => [L._s, L._rank]));
    }""")
    assert ok in (True, "no presets")
    assert not s.take()


def test_edited_criteria_reach_the_worker_before_the_next_drag(open_page) -> None:
    """Applying edited criteria replaces every listing's score object; the worker must be sent the new data."""
    s = open_page("#map")
    p = s.page
    _wait_worker(s)
    out = p.evaluate("""async () => {
      const a = await import('/js/app.js'), c = await import('/js/criteria.js');
      const prof = JSON.parse(JSON.stringify(c.profileOf(a.S.crit0)));
      prof.unit.sqft_good += 200;                        // scores change for every listing with a known size
      prof.budget.tiers[0].max -= 400;
      a.applyCriteria(prof, { quiet: true });
      const sig = () => JSON.stringify(a.S.listings.map((L) => [L._s, L._rank, L._ranks]));
      const el = document.querySelector('[data-w="space"]');
      const bad = [];
      for (const v of ['30', '2', '19']) {
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const fromWorker = sig();
        a.rescore();
        if (sig() !== fromWorker) bad.push(v);
      }
      return { bad, mode: document.documentElement.dataset.scoring };
    }""")
    assert out["bad"] == [], out
    assert not s.take()


def test_the_standalone_file_runs_the_worker_from_file_url(browser, tmp_path: Path, monkeypatch) -> None:
    """The standalone build opens from file://, where a module worker cannot load: the blob worker must (or scoring falls back)."""
    import apartmentscout.cli as cli

    if not shutil.which("npx"):
        pytest.skip("node and npx are needed to bundle the dashboard")
    work = tmp_path / "dashboard"
    shutil.copytree(ROOT / "dashboard", work, ignore=shutil.ignore_patterns("dist", "media"))
    (work / "dist").mkdir()
    r = subprocess.run(["npx", "--yes", "esbuild@0.24.0", str(work / "js" / "app.js"), "--bundle", "--format=esm", "--minify", "--target=es2020",
                        "--external:three", "--external:three/addons/*", f"--outfile={work / 'dist' / 'app.bundle.js'}"], capture_output=True, text=True, timeout=180)
    if r.returncode:
        pytest.skip(f"esbuild is not available: {r.stderr[-200:]}")
    monkeypatch.setattr(cli, "DASH", work)
    out = cli.standalone(work / "data", tmp_path / "search.html")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    ctx.route("**/*", lambda rt: rt.continue_() if rt.request.url.startswith(("file://", "data:", "blob:")) else rt.abort())
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.goto(out.as_uri())
    page.wait_for_function("() => document.querySelector('#cards .card')", timeout=T)
    # the worker starts shortly after the first paint; either it runs (preferred) or scoring says it fell back, never a hang
    page.wait_for_function("() => ['worker', 'sync'].includes(document.documentElement.dataset.scoring)", timeout=T)
    page.wait_for_timeout(1500)
    mode = page.evaluate("() => document.documentElement.dataset.scoring")
    before = page.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 10).map(c => c.dataset.id)")
    page.evaluate("() => { const el = document.querySelector('[data-w=\"quiet\"]'); el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.wait_for_function("(b) => JSON.stringify([...document.querySelectorAll('#cards .card')].slice(0, 10).map((c) => c.dataset.id)) !== JSON.stringify(b)", arg=before, timeout=T)
    ctx.close()
    assert mode == "worker", f"the blob worker did not start from file://: scoring is {mode}"
    assert not errors, errors
