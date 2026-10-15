"""Boot resilience: stale or corrupt saved state never stops the app, and a start that does fail shows the recovery card.

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_boot_recovery.py -q

Covers dashboard/js/state-guard.js (every localStorage read is shape-checked) and the inline watchdog in dashboard/index.html
(a script that does not load, a start that never finishes, a boot error: calm card with Reload and Reset).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import block_foreign

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]

CARD = "#as-boot"
READY = "() => document.documentElement.dataset.boot === 'ready'"

# every kind of wrong: wrong type, truncated JSON, an old shape, a number where an object belongs
CORRUPT = {
    "as:picks": '"not an object"', "as:compare": '{"a":1}', "as:weights": "[1,2,3]", "as:filters2": '"zzz"', "as:preset": "42",
    "as:theme": '"purple"', "as:comfort": "123", "as:density": '{"x":1}', "as:destPin": "[]", "as:recent": '{"a":1}',
    "as:list:ui": '"zzz"', "as:coach": "7", "as:combo": '"a"', "as:rail:collapsed": '"x"', "as:list:split": '"yes"',
    "as:research-tab": "{}", "as:research-queue": "[1]", "as:legend-min": '"x"', "as:tp-mode": "5", "as:plan-mood": "{}",
    "as:draft:new": "{not json", "as:filters2x": '{"tiers": [0,',
}


def _context(browser, base_url: str, width: int = 1280, height: int = 800):
    ctx = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce", service_workers="block")
    block_foreign(ctx, base_url)
    return ctx


def _seed(page, base_url: str, items: dict[str, str]) -> None:
    """Write raw localStorage strings on the app's origin before the app ever runs (a static file shares the origin)."""
    page.goto(f"{base_url}/manifest.webmanifest")
    page.evaluate("(items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }", items)


def _search_name(page, base_url: str) -> str:
    return page.evaluate("async () => (await (await fetch('data/criteria.json')).json()).search?.name || ''")


def test_corrupt_saved_state_still_boots(browser, base_url: str) -> None:
    ctx = _context(browser, base_url)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{base_url}/manifest.webmanifest")
        name = page.evaluate("async () => (await (await fetch('/data/criteria.json')).json()).search?.name || ''")
        items = dict(CORRUPT)
        for prefix in ("commute", "criteria", "findings", "trail", "tourplan", "visit"):
            items[f"as:{prefix}:{name}"] = "17"
        items["as:criteria:" + name + "x"] = "{broken"
        page.evaluate("(items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }", items)
        page.goto(f"{base_url}/#map")
        page.wait_for_function(READY, timeout=20000)
        page.wait_for_selector("#cards .card", timeout=20000)
        assert page.locator(CARD).count() == 0, "a bad saved value must not trigger the recovery card"
        assert page.locator("#kpis").inner_text().strip(), "the stats strip rendered"
        # the other views still open on the same bad state
        for view in ("list", "compare", "research"):
            page.evaluate("(v) => { location.hash = '#' + v; }", view)
            page.wait_for_selector(f"#view-{view}:not([hidden]) > *", timeout=20000)
        assert page.locator(CARD).count() == 0
        # after the app writes its own state back, the stored values are valid again
        page.evaluate("() => { location.hash = '#map'; }")
        page.keyboard.press("t")
        assert page.evaluate("() => document.documentElement.dataset.theme") in ("dark", "light")
        assert not [e for e in errors if "ResizeObserver" not in e], errors
    finally:
        ctx.close()


def test_partly_valid_picks_keep_the_good_entries(browser, base_url: str) -> None:
    ctx = _context(browser, base_url)
    page = ctx.new_page()
    try:
        page.goto(f"{base_url}/manifest.webmanifest")
        ids = page.evaluate("async () => (await (await fetch('/data/listings.json')).json()).slice(0, 2).map((l) => l.id)")
        picks = {ids[0]: {"saved": True, "note": "keep me"}, ids[1]: "garbage", "ghost": None}
        page.evaluate("(p) => localStorage.setItem('as:picks', JSON.stringify(p))", picks)
        page.goto(f"{base_url}/#list")
        page.wait_for_function(READY, timeout=20000)
        page.wait_for_function("() => document.getElementById('savedCount')?.textContent === '1'", timeout=10000)
        assert page.locator(CARD).count() == 0
    finally:
        ctx.close()


@pytest.mark.parametrize("how", ["syntax", "missing"])
def test_a_script_that_breaks_shows_the_recovery_card(browser, base_url: str, how: str) -> None:
    ctx = _context(browser, base_url)
    page = ctx.new_page()
    # the app's entry script: js/app.js in the source tree, dist/app-<hash>.js in the split build
    entry = lambda url: "/js/app.js" in url or "/dist/app-" in url  # noqa: E731
    if how == "syntax":
        ctx.route(entry, lambda r: r.fulfill(status=200, content_type="text/javascript", body="export const broken = ;"))
    else:
        ctx.route(entry, lambda r: r.abort())
    try:
        page.goto(f"{base_url}/#map")
        page.wait_for_selector(CARD, timeout=15000)
        assert "Something stopped ApartmentScout from starting" in page.inner_text(f"{CARD} h1")
        assert page.get_by_role("button", name="Reload").is_visible()
        assert page.locator("#as-boot-reset").is_visible() and "keeps your saved picks" in page.inner_text("#as-boot-reset")
        page.wait_for_load_state("load")
        assert page.evaluate("() => document.activeElement.id") == "as-boot-reload", "focus starts on Reload"
        page.locator(f"{CARD} summary").click()
        assert page.locator("#as-boot-err").text_content().strip(), "the error text is in the details fold"
    finally:
        ctx.close()


def test_a_start_that_never_finishes_shows_the_card_after_the_timeout(browser, base_url: str) -> None:
    ctx = _context(browser, base_url)
    ctx.add_init_script("window.__AS_BOOT_MS = 1500;")
    held: list[object] = []
    ctx.route("**/data/listings.json", lambda r: held.append(r))   # never answered: the app waits for its data
    page = ctx.new_page()
    try:
        page.goto(f"{base_url}/#map")
        page.wait_for_selector(CARD, timeout=15000)
        assert "did not finish loading" in page.locator("#as-boot-err").text_content()
    finally:
        ctx.close()


def test_a_slow_start_that_finishes_takes_the_card_away(browser, base_url: str) -> None:
    ctx = _context(browser, base_url)
    ctx.add_init_script("window.__AS_BOOT_MS = 1200;")
    held: list[object] = []
    ctx.route("**/data/listings.json", lambda r: held.append(r))
    page = ctx.new_page()
    try:
        page.goto(f"{base_url}/#map")
        page.wait_for_selector(CARD, timeout=15000)
        for r in held:
            r.continue_()
        page.wait_for_function(f"() => !document.querySelector('{CARD}')", timeout=20000)
        page.wait_for_selector("#cards .card", timeout=20000)
    finally:
        ctx.close()


def test_reset_clears_settings_keeps_picks_and_reloads(browser, base_url: str) -> None:
    ctx = _context(browser, base_url)
    page = ctx.new_page()
    try:
        page.goto(f"{base_url}/manifest.webmanifest")
        name = _search_name(page, base_url)
        keep = {"as:picks": json.dumps({"somewhere": {"saved": True, "note": "mine"}}), "as:findings:Another search": '{"x":{"y":1}}',
                "as:trail:Another search": "[]", "as:plan-projects.data": "{}"}
        drop = {"as:weights": '{"cost":30}', "as:theme": '"light"', "as:comfort": '{"motion":true}', "as:filters2": '{"over":true}', "as:draft:new": "{}"}
        page.evaluate("(items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }", {**keep, **drop})
        page.evaluate("async () => { await caches.open('as-test-cache'); }")
        page.goto(f"{base_url}/#map")
        page.wait_for_function(READY, timeout=20000)
        page.evaluate("() => window.__asBoot.fail(new Error('forced for the test'))")   # the same call boot() makes when it throws
        page.wait_for_selector(CARD)
        assert "forced for the test" in page.locator("#as-boot-err").text_content()
        with page.expect_navigation(timeout=15000):
            page.click("#as-boot-reset")
        page.wait_for_function(READY, timeout=20000)
        assert page.locator(CARD).count() == 0, "after the reset the app starts normally"
        stored = page.evaluate("(ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)]))", [*keep, *drop])
        for k, v in keep.items():
            assert stored[k] == v, f"{k} must survive the reset"
        for k in drop:
            assert stored[k] is None, f"{k} must be cleared by the reset"
        assert page.evaluate("async () => (await caches.keys()).includes('as-test-cache')") is False
    finally:
        ctx.close()


def test_the_standalone_file_has_the_watchdog_and_the_menu(browser, tmp_path) -> None:
    """The single-file build carries the inline watchdog (it runs before any module) and boots with the new menu and tabs."""
    from apartmentscout.cli import standalone
    out = standalone(ROOT / "dashboard" / "data", tmp_path / "one.html")
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(out.as_uri())
        page.wait_for_function(READY, timeout=60000)
        assert page.locator("#appMenu").count() == 1 and page.locator("#tabs a").count() == 5
        page.evaluate("() => window.__asBoot.fail(new Error('forced in the standalone file'))")
        page.wait_for_selector(CARD)
        assert "forced in the standalone file" in page.locator("#as-boot-err").text_content()
        page.evaluate("() => localStorage.setItem('as:weights', '{}')")
        with page.expect_navigation(timeout=15000):
            page.click("#as-boot-reset")
        page.wait_for_function(READY, timeout=60000)
        assert page.evaluate("() => localStorage.getItem('as:weights')") is None
        assert not errors, errors
    finally:
        ctx.close()
