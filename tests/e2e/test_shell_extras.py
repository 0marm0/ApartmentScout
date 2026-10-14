"""Shell, commands and comfort features in a real browser: undo (toast, Cmd/Ctrl+Z, redo), plain-language queries in the
command palette, g-chords, x and s on a focused card, the searchable cheat sheet, the first-run coach marks, the
illustrated empty states, and the comfort and accent settings.

Every test opens the page under Playwright, which sets navigator.webdriver, so the coach marks never start by themselves
here (they would cover the page): the coach tests ask for them with ?coach=1.
"""
from __future__ import annotations

import json

import pytest

pytestmark = pytest.mark.e2e


@pytest.fixture
def op(open_page):
    """open_page, then wait until the shell's lazy feature module (undo, chords, search, tour, settings) has started."""
    def _open(path: str = "#map", **kw):
        s = open_page(path, **kw)
        s.page.wait_for_function("() => typeof window.__undo === 'object'", timeout=20000)
        return s
    return _open


def _picks(pg) -> dict:
    return pg.evaluate("() => JSON.parse(localStorage.getItem('as:picks') || '{}')")


def _saved(pg) -> list[str]:
    return sorted(k for k, v in _picks(pg).items() if v.get("saved"))


def _count(pg) -> int:
    return int(pg.evaluate("() => parseInt(document.getElementById('listTitle').textContent)"))


def _toast(pg) -> str:
    return pg.evaluate("() => document.getElementById('toast').textContent")


# ------------------------------------------------------------------ undo
def test_star_shows_an_undo_toast_and_the_button_undoes_it(op) -> None:
    s = op("#map")
    pg = s.page
    pg.click("#cards .card:nth-child(1) .save")
    pg.wait_for_selector("#toast.on .toast-act", timeout=5000)
    assert _toast(pg).startswith("Starred "), _toast(pg)
    assert len(_saved(pg)) == 1
    pg.click("#toast .toast-act")
    assert _saved(pg) == []
    assert pg.evaluate("() => __undo.canRedo") is True
    assert not s.take()


def test_cmd_z_and_shift_cmd_z_walk_the_stack(op) -> None:
    s = op("#map")
    pg = s.page
    pg.click("#cards .card:nth-child(1) .save")
    pg.hover("#cards .card:nth-child(2)")   # the quick actions appear on hover
    pg.click("#cards .card:nth-child(2) [data-cmp]")
    pg.wait_for_function("() => __undo.size === 2")
    assert len(_saved(pg)) == 1 and pg.evaluate("() => JSON.parse(localStorage.getItem('as:compare') || '[]').length") == 1
    pg.keyboard.press("Control+z")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:compare') || '[]').length") == 0
    assert len(_saved(pg)) == 1
    pg.keyboard.press("Control+z")
    assert _saved(pg) == []
    pg.keyboard.press("Control+z")
    pg.wait_for_selector("#toast.on")
    assert _toast(pg).startswith("Nothing to undo")
    pg.keyboard.press("Control+Shift+z")
    assert len(_saved(pg)) == 1
    pg.keyboard.press("Control+y")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:compare') || '[]').length") == 1
    assert not s.take()


def test_undo_does_not_steal_the_key_from_a_text_field(op) -> None:
    s = op("#map")
    pg = s.page
    pg.click("#cards .card:nth-child(1) .save")
    pg.wait_for_function("() => __undo.size === 1")
    pg.click("#cards .card:nth-child(1)")
    pg.wait_for_selector("#dNote")
    pg.click("#dNote")
    pg.keyboard.type("quiet side")
    pg.keyboard.press("Control+z")
    assert pg.evaluate("() => __undo.size") == 1 and len(_saved(pg)) == 1, "the field's own undo handled it"
    assert not s.take()


def test_a_weight_drag_is_one_undo_step_and_filters_and_picks_share_the_stack(op) -> None:
    s = op("#map")
    pg = s.page
    start = _count(pg)
    before = pg.evaluate("() => document.querySelector('[data-w=cost]').value")
    for v in (24, 28, 33):   # a drag fires many input events
        pg.eval_on_selector("[data-w=cost]", "(el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }", v)
        pg.wait_for_timeout(40)
    pg.wait_for_function("() => __undo.size === 1")
    assert pg.evaluate("() => __undo.peek().undo") == "Weight: Cost"
    pg.click("[data-tg=doorman]")
    pg.wait_for_function("() => __undo.size === 2")
    assert pg.evaluate("() => __undo.peek().undo") == "Must-have on: Full-time doorman"
    assert _count(pg) < start
    pg.keyboard.press("Control+z")
    assert _count(pg) == start
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2')).toggles.length") == 0
    pg.keyboard.press("Control+z")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:weights')).cost") == int(before)
    assert pg.evaluate("() => document.querySelector('[data-w=cost]').value") == before, "the slider moved back with it"
    assert not s.take()


def test_the_commute_lens_undoes(op) -> None:
    s = op("#map")
    pg = s.page
    lens = "() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('as:commute:')))).mode"
    pg.click('#rMode [data-mode="subway"]')
    pg.wait_for_function("() => __undo.size === 1")
    assert pg.evaluate("() => __undo.peek().undo").startswith("Commute: subway")
    assert pg.evaluate(lens) == "subway"
    pg.keyboard.press("Control+z")
    assert pg.evaluate(lens) == "best"
    assert pg.evaluate("() => document.querySelector('#rMode [data-mode=best]').classList.contains('on')")
    assert not s.take()


# ------------------------------------------------------------------ plain-language search
def _palette(pg, text: str) -> None:
    pg.wait_for_function("() => { const r = document.querySelector('.pl-scrim'); return !r || r.hidden; }")   # a closing palette hides on the next tick
    pg.keyboard.press("Control+k")
    pg.wait_for_selector("#plQ")
    pg.fill("#plQ", text)
    pg.wait_for_selector("#plList .pl-it")


def test_a_sentence_becomes_a_preview_row_and_applies_as_one_undoable_step(op) -> None:
    s = op("#map")
    pg = s.page
    start = _count(pg)
    _palette(pg, "1 bd under 5k within 25 min by subway with doorman gym")
    row = pg.locator("#plList .pl-it").first
    text = row.inner_text()
    assert text.startswith("Apply:"), text
    for part in ("1 bd", "≤ $5,000", "≤ 25 min subway", "Doorman", "Gym"):
        assert part in text, (part, text)
    assert "of" in text and "active homes" in text, "the row says how many homes it would show"
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#nlChips:not([hidden])")
    f = pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2'))")
    assert f["maxCommute"] == 25 and sorted(f["toggles"]) == ["doorman", "gym"]
    assert f["nl"] == {"minBeds": 1, "maxBeds": 1, "maxCost": 5000}
    assert pg.evaluate("() => document.getElementById('sortSel').value") == "match"
    chips = pg.locator("#nlChips .nl-chip").all_inner_texts()
    assert chips == ["1 bd", "≤ $5,000"], chips
    assert _count(pg) <= start
    assert pg.evaluate("() => __undo.peek().undo") == "Applied a plain-language search"
    # a chip clears just its own constraint, as an undoable step
    pg.click("#nlChips .nl-chip:has-text('$5,000')")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2')).nl") == {"minBeds": 1, "maxBeds": 1}
    pg.keyboard.press("Control+z")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2')).nl.maxCost") == 5000
    pg.keyboard.press("Control+z")
    pg.wait_for_selector("#nlChips", state="hidden")
    assert _count(pg) == start
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2')).maxCommute") == 75
    assert not s.take()


def test_starred_and_sorting_words_and_the_unsupported_phrase(op) -> None:
    s = op("#map")
    pg = s.page
    _palette(pg, "starred cheapest")
    assert pg.locator("#plList .pl-it").first.inner_text().startswith("Apply: Starred")
    pg.keyboard.press("Enter")
    pg.wait_for_function("() => document.getElementById('sortSel').value === 'cost'")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2')).savedOnly") is True
    # a phrase it understands but cannot filter on is said out loud, not guessed
    _palette(pg, "east of 3rd ave")
    first = pg.locator("#plList .pl-it").first.inner_text()
    assert "filter by" in first and "east of 3rd ave" in first, first
    pg.keyboard.press("Escape")
    # plain words keep working as before
    _palette(pg, "compare")
    assert "Compare" in pg.locator("#plList .pl-it").first.inner_text()
    assert not s.take()


def test_price_drops_says_so_when_there_is_no_history(op) -> None:
    s = op("#map")
    pg = s.page
    _palette(pg, "price drops")
    pg.wait_for_function("() => document.querySelector('#plList .pl-it').innerText.includes('no price history')", timeout=10000)
    assert not s.take()


# ------------------------------------------------------------------ chords and the cheat sheet
def test_g_then_a_letter_goes_to_the_view_with_a_hint_while_it_waits(op) -> None:
    s = op("#map")
    pg = s.page
    pg.keyboard.press("g")
    pg.wait_for_selector(".chord-hint.on")
    hint = pg.inner_text(".chord-hint")
    for word in ("Map", "Shortlist", "Compare", "Unit 3D", "Floor plan", "Research"):
        assert word in hint, hint
    pg.keyboard.press("c")
    pg.wait_for_function("() => location.hash === '#compare'")
    assert not pg.evaluate("() => document.querySelector('.chord-hint').classList.contains('on')")
    for key, hash_ in (("s", "#list"), ("r", "#research"), ("t", "#list/tours"), ("m", "#map")):
        pg.keyboard.press("g")
        pg.keyboard.press(key)
        pg.wait_for_function("(h) => location.hash === h", arg=hash_)
    pg.wait_for_function("() => document.body.dataset.view === 'map'")
    # g then a key that is not a chord: that key does its own job (j opens the first home in the list)
    pg.keyboard.press("g")
    pg.keyboard.press("j")
    pg.wait_for_selector("#drawer.open")
    assert pg.evaluate("() => location.hash") == "#map"
    assert not s.take()


def test_chords_are_off_while_typing(op) -> None:
    s = op("#map")
    pg = s.page
    pg.keyboard.press("Control+k")
    pg.wait_for_selector("#plQ")
    pg.keyboard.type("gc")
    assert pg.evaluate("() => location.hash") == "#map"
    assert pg.input_value("#plQ") == "gc"
    assert not s.take()


def test_g_u_keeps_the_home_you_are_looking_at(op) -> None:
    s = op("#map")
    pg = s.page
    site = pg.evaluate("async () => (await (await fetch('data/manifest.json')).json()).sites[0]")
    pg.goto(f"{s.origin}/?open={site}#map")
    pg.wait_for_selector("#drawer.open")
    pg.wait_for_function("() => typeof window.__undo === 'object'")
    pg.keyboard.press("g")
    pg.keyboard.press("u")
    pg.wait_for_function("(id) => location.hash === '#unit/' + id", arg=site, timeout=10000)
    assert not s.take()


def test_the_cheat_sheet_opens_searches_and_closes(op) -> None:
    s = op("#map")
    pg = s.page
    pg.keyboard.press("?")
    pg.wait_for_selector(".cs-scrim.on .cs[role=dialog]")
    assert pg.evaluate("() => document.activeElement.id") == "csQ"
    assert pg.locator(".cs-g.now h3").inner_text().lower().startswith("map and results"), "the current view's keys come first"
    total = pg.locator(".cs-r").count()
    assert total > 40
    pg.fill("#csQ", "undo")
    rows = pg.locator(".cs-r .cs-d").all_inner_texts()
    assert 1 <= len(rows) < total and any("Undo the last" in r for r in rows), rows
    pg.fill("#csQ", "zzzzqq")
    assert "No shortcut matches" in pg.inner_text(".cs-empty")
    pg.fill("#csQ", "g then")
    assert pg.locator(".cs-r").count() == 7
    # the old fixed list is gone
    assert pg.locator(".kbd-help").count() == 0
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".cs-scrim", state="hidden")
    assert pg.evaluate("() => location.hash") == "#map", "Esc closed the sheet and nothing else"
    # also from the settings menu and by the key again
    pg.click("#setBtn")
    pg.click("#mnKeys")
    pg.wait_for_selector(".cs-scrim.on")
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".cs-scrim", state="hidden")
    assert not s.take()


def test_x_and_s_act_on_the_focused_card(op) -> None:
    s = op("#map")
    pg = s.page
    pg.focus("#cards .card:nth-child(2)")
    cid = pg.evaluate("() => document.activeElement.dataset.id")
    pg.keyboard.press("x")
    pg.wait_for_function("(id) => JSON.parse(localStorage.getItem('as:compare') || '[]').includes(id)", arg=cid)
    pg.keyboard.press("x")
    pg.wait_for_function("(id) => !JSON.parse(localStorage.getItem('as:compare') || '[]').includes(id)", arg=cid)
    pg.focus(f"#cards .card[data-id='{cid}']")
    pg.keyboard.press("s")
    pg.wait_for_function("(id) => JSON.parse(localStorage.getItem('as:picks') || '{}')[id]?.saved", arg=cid)
    assert pg.evaluate("() => document.activeElement.dataset.id") == cid, "focus stays on the card after the list redraws"
    assert not s.take()


# ------------------------------------------------------------------ coach marks
def test_the_tour_walks_five_steps_once_and_restarts_from_the_menu(op) -> None:
    s = op("?coach=1#map")
    pg = s.page
    pg.wait_for_selector(".coach-card", timeout=15000)
    titles = []
    for i in range(5):
        assert pg.inner_text("#coachStep") == f"STEP {i + 1} OF 5" or pg.inner_text("#coachStep").lower() == f"step {i + 1} of 5"
        titles.append(pg.inner_text("#coachT"))
        spot = pg.evaluate("() => { const r = document.querySelector('.coach-spot').getBoundingClientRect(); return [r.width, r.height]; }")
        assert spot[0] > 20 and spot[1] > 20
        pg.keyboard.press("ArrowRight")
        pg.wait_for_timeout(450)
    assert titles[0].startswith("Start with the filters") and titles[-1].startswith("See the light")
    pg.wait_for_selector(".coach-card", state="detached")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:coach')).done") is True
    # restart from the settings menu, skip with Esc
    pg.click("#setBtn")
    pg.click("#mnTour")
    pg.wait_for_selector(".coach-card", timeout=10000)
    assert pg.evaluate("() => document.activeElement.textContent") == "Next"
    pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(300)
    pg.keyboard.press("ArrowLeft"); pg.wait_for_timeout(300)
    assert pg.inner_text("#coachT").startswith("Start with the filters")
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".coach-card", state="detached")
    assert not s.take()


def test_the_tour_does_not_start_by_itself_under_automation(op) -> None:
    s = op("#map")
    s.page.wait_for_timeout(2200)
    assert s.page.locator(".coach-card").count() == 0
    assert not s.take()


def test_skip_tour_button_and_keys_are_held_while_it_is_up(op) -> None:
    s = op("?coach=1#map")
    pg = s.page
    pg.wait_for_selector(".coach-card", timeout=15000)
    pg.keyboard.press("g"); pg.keyboard.press("c")
    assert pg.evaluate("() => location.hash") == "#map", "chords wait while the tour owns the keyboard"
    pg.click("[data-skip]")
    pg.wait_for_selector(".coach-card", state="detached")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:coach')).done") is True
    assert not s.take()


# ------------------------------------------------------------------ empty states
def _has_art(pg, selector: str) -> bool:
    return pg.evaluate("(sel) => !!document.querySelector(sel + ' svg.ill')", selector)


def test_empty_states_have_an_illustration(op) -> None:
    s = op("#compare")
    pg = s.page
    pg.wait_for_selector("#view-compare .cmp-empty")
    assert _has_art(pg, "#view-compare .cmp-empty")
    pg.evaluate("() => { location.hash = '#list/tours'; }")
    pg.wait_for_selector("#view-tours .tr-none")
    assert _has_art(pg, "#view-tours .tr-none")
    pg.evaluate("() => { location.hash = '#research/records/no-such-home'; }")
    pg.wait_for_selector("#view-research .rec-empty", timeout=15000)
    assert _has_art(pg, "#view-research .rec-empty")
    pg.evaluate("() => { location.hash = '#map'; }")
    pg.click("[data-saved]")
    pg.wait_for_selector("#cards .cards-empty")
    assert "No saved picks yet" in pg.inner_text("#cards .cards-empty") and _has_art(pg, "#cards .cards-empty")
    pg.click("#resetFilters")
    pg.wait_for_selector("#cards .card")
    _palette(pg, "zzzzqq")
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#cards .cards-empty")
    assert "No homes match" in pg.inner_text("#cards .cards-empty") and _has_art(pg, "#cards .cards-empty")
    assert not s.take()


@pytest.mark.parametrize("view,selector,title", [("unit", "#view-unit .empty", "No site models yet"), ("plan", "#view-plan #psEmpty", "Bring in a floor plan")])
def test_no_site_models_and_no_plans_are_illustrated(op, base_url: str, view: str, selector: str, title: str) -> None:
    s = op("#map")
    pg = s.page
    manifest = pg.evaluate("async () => (await (await fetch('data/manifest.json')).json())")
    manifest.update(sites=[], plans=[])
    pg.context.route(f"{base_url}/data/manifest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(manifest)))
    pg.reload()
    pg.wait_for_selector("#cards .card")
    pg.evaluate("(v) => { location.hash = v; }", view)
    pg.wait_for_selector(selector, timeout=20000)
    assert _has_art(pg, selector) and title in pg.inner_text(selector)
    assert not s.take()


# ------------------------------------------------------------------ comfort and accents
def _attr(pg, name: str) -> str:
    return pg.evaluate("(n) => document.documentElement.getAttribute(n)", name)


@pytest.fixture
def calm_page(browser, base_url: str):
    """A page whose OS asks for nothing special (the shared fixture asks for reduced motion), to test the switches themselves."""
    ctxs = []

    def _open(theme: str = "dark", init: str | None = None):
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=theme, reduced_motion="no-preference")
        ctxs.append(ctx)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
        if init:
            ctx.add_init_script(init)
        pg = ctx.new_page()
        errs: list[str] = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"{base_url}/{'?theme=light' if theme == 'light' else ''}#map")
        pg.wait_for_selector("#cards .card", timeout=20000)
        pg.wait_for_function("() => typeof window.__undo === 'object'")
        return pg, errs

    yield _open
    for c in ctxs:
        c.close()


def test_comfort_switches_set_attributes_and_persist(calm_page) -> None:
    pg, errs = calm_page()
    assert [_attr(pg, a) for a in ("data-transparency", "data-contrast", "data-motion", "data-text", "data-accent")] == ["full", "normal", "full", "m", "iris"]
    pg.click("#setBtn")
    pg.click("#mnTransp")
    pg.click("#mnContrast")
    pg.click("#mnMotion")
    pg.click('#setMenu [data-text="xl"]')
    assert pg.evaluate("() => !document.getElementById('setMenu').hidden"), "the menu stays open while you choose"
    assert [_attr(pg, a) for a in ("data-transparency", "data-contrast", "data-motion", "data-text")] == ["reduced", "high", "reduced", "xl"]
    assert pg.get_attribute("#mnContrast", "aria-checked") == "true" and pg.get_attribute('#setMenu [data-text="xl"]', "aria-checked") == "true"
    assert pg.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches") is True, "JavaScript animations follow the switch too"
    # glass is gone, the type scale grew and the choice survives a reload
    assert pg.evaluate("() => getComputedStyle(document.querySelector('#setMenu')).backdropFilter") in ("none", "")
    assert pg.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ts'))") == 1.25
    pg.reload()
    pg.wait_for_selector("#cards .card")
    assert [_attr(pg, a) for a in ("data-transparency", "data-contrast", "data-motion", "data-text")] == ["reduced", "high", "reduced", "xl"]
    assert not errs


def test_a_setting_the_system_asks_for_is_on_and_cannot_be_switched_off(op) -> None:
    s = op("#map")   # this context asks for reduced motion
    pg = s.page
    assert _attr(pg, "data-motion") == "reduced"
    pg.click("#setBtn")
    assert pg.get_attribute("#mnMotion", "aria-checked") == "true" and pg.get_attribute("#mnMotion", "aria-disabled") == "true"
    assert "system" in pg.inner_text("#mnMotion").lower()
    pg.click("#mnMotion", force=True)
    assert _attr(pg, "data-motion") == "reduced"
    assert not s.take()


def test_accents_apply_in_both_themes_and_persist(calm_page) -> None:
    pg, errs = calm_page()
    iris = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    seen = {"iris": iris}
    for name in ("jade", "amber", "rose"):
        pg.click("#setBtn") if pg.evaluate("() => document.getElementById('setMenu').hidden") else None
        pg.click(f'#setMenu [data-accent="{name}"]')
        assert _attr(pg, "data-accent") == name
        seen[name] = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    assert len(set(seen.values())) == 4, seen
    pg.reload()
    pg.wait_for_selector("#cards .card")
    assert _attr(pg, "data-accent") == "rose"
    pg2, errs2 = calm_page("light", init="localStorage.setItem('as:comfort', JSON.stringify({accent: 'jade'}));")
    assert _attr(pg2, "data-accent") == "jade" and _attr(pg2, "data-theme") == "light"
    assert pg2.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == "#08724f"
    assert not errs and not errs2


def test_golden_hour_tint_is_off_by_default_and_follows_the_sun(calm_page, base_url: str) -> None:
    pg, errs = calm_page()
    assert pg.evaluate("() => parseFloat(getComputedStyle(document.getElementById('goldenTint')).opacity)") == 0
    pg.click("#setBtn")
    pg.click("#mnGolden")
    assert pg.evaluate("() => document.documentElement.hasAttribute('data-golden')")
    pg.close()
    # ?goldenAt pins the instant: golden hour at sunset in June, none at noon
    for at, lo, hi in (("2026-06-21T23:55:00Z", 0.4, 1.0), ("2026-06-21T16:00:00Z", 0.0, 0.0)):
        pg2, errs2 = calm_page(init="localStorage.setItem('as:comfort', JSON.stringify({golden: true}));")
        pg2.goto(f"{base_url}/?goldenAt={at}#map")
        pg2.wait_for_selector("#goldenTint")
        pg2.wait_for_timeout(1500)
        strength = pg2.evaluate("() => window.__golden.tint.strength")
        assert lo <= strength <= hi, (at, strength)
        assert not errs2
    assert not errs
