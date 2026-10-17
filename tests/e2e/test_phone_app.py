"""The dashboard as an iPhone app: install guide, the listing as a bottom sheet with detents, swipe between homes, pull to refresh, the
long-press quick actions, safe areas, the keyboard, Web Share, 16 px fields and 44 px targets. Every test runs in an iPhone-sized touch
context (390 x 844, iOS Safari user agent) and drives it with real touch input (tests/e2e/phone_helpers.py: a Finger over the DevTools
protocol). The service worker and the offline map are tests/e2e/test_phone_offline.py.

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_phone_app.py -q
"""
from __future__ import annotations

import json

import pytest
from conftest import Session, allowed_console, block_foreign, build_url, frames, settled
from phone_helpers import Finger, center, iphone_args, rect

pytestmark = pytest.mark.e2e
H = 844   # the viewport height; the detents are fractions of it (features/native-core.js detentHeights)
HALF, FULL = round(H * 0.64), round(H * 0.88)
PEEK = max(300, round(H * 0.4))


class Phone(Session):
    finger: Finger = None
    ctx: object = None


@pytest.fixture
def open_phone(browser, base_url: str):
    """open_phone(path='#map', theme='dark', motion=False, init='', query='') -> Phone; reduced motion by default so settling is immediate."""
    contexts = []

    def _open(path: str = "#map", theme: str = "dark", motion: bool = False, init: str = "", ua: str | None = None, standalone: bool = False) -> Phone:
        args = iphone_args()
        if ua:
            args["user_agent"] = ua
        ctx = browser.new_context(**args, color_scheme=theme, reduced_motion="no-preference" if motion else "reduce", service_workers="block")
        contexts.append(ctx)
        block_foreign(ctx, base_url)
        if standalone:   # iOS says so with navigator.standalone when the page runs as the installed app
            ctx.add_init_script("Object.defineProperty(navigator, 'standalone', { get: () => true });")
        if init:
            ctx.add_init_script(init)
        page = ctx.new_page()
        s = Phone(page, base_url)
        s.ctx = ctx
        page.on("pageerror", lambda e: s.errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: m.type == "error" and (s.allowed if allowed_console(m.text, (m.location or {}).get("url", ""), base_url) else s.errors).append(f"console: {m.text[:300]}"))
        page.goto(build_url(base_url, path, theme))
        page.wait_for_function("() => document.querySelector('#cards .card')", timeout=30000)
        settled(page, 20000, 4)
        s.finger = Finger(page)
        return s

    yield _open
    for c in contexts:
        c.close()


def sel(pg):
    return pg.evaluate("async () => (await import('/js/app.js')).S.sel")


def card_ids(pg) -> list[str]:
    return pg.evaluate("() => [...document.querySelectorAll('#cards .card')].map((c) => c.dataset.id)")


def open_first(p: Phone, n: int = 1) -> str:
    """Tap the n-th card's photo; the listing sheet opens at half height. The card is tapped where it has come to rest (images and
    layout settle under load), and the tap is repeated if the page was still busy and missed."""
    pg = p.page
    for attempt in range(4):
        pg.wait_for_function("""() => new Promise((ok) => { const el = document.querySelector('#cards .card .media'); let last = '', n = 0;
          const t = () => { const r = el.getBoundingClientRect(), k = [r.x, r.y].join(); n = k === last ? n + 1 : 0; last = k; n >= 3 ? ok(true) : requestAnimationFrame(t); }; t(); })""")
        x, y = center(pg, f"#cards .card >> nth={n - 1} >> .media")
        p.finger.tap(x, y)
        try:
            pg.wait_for_function("() => document.getElementById('drawer').classList.contains('open') && document.getElementById('drawer').dataset.detent === 'half'", timeout=10000)
            break
        except Exception:
            if attempt == 3:
                raise AssertionError(pg.evaluate("""async ([x, y]) => { const d = document.getElementById('drawer'), e = document.elementFromPoint(x, y);
                  return { tap: [x, y], drawer: d.className, detent: d.dataset.detent, sel: (await import('/js/app.js')).S.sel, hit: e && (e.tagName + '.' + e.className.toString().slice(0, 50)),
                    open: [...document.querySelectorAll('dialog[open], [role=dialog]:not([hidden]), .lb.on, .lightbox.on, .qa-menu:not([hidden])')].map((n) => n.id || n.className.toString().slice(0, 30)),
                    vv: [innerWidth, innerHeight, devicePixelRatio], touch: navigator.maxTouchPoints, phone: matchMedia('(max-width: 760px)').matches }; }""", [x, y]))
    settled(pg, 5000, 2)
    return sel(pg)


def detent(pg) -> str:
    return pg.evaluate("() => document.getElementById('drawer').dataset.detent")


def go_to(pg, d: str) -> None:
    pg.wait_for_function("(d) => document.getElementById('drawer').dataset.detent === d", arg=d)
    frames(pg, 2)


# ------------------------------------------------------------------ the listing sheet
def test_the_listing_is_a_bottom_sheet_that_opens_at_half_height(open_phone) -> None:
    p = open_phone()
    assert p.page.evaluate("getComputedStyle(document.getElementById('drawer')).visibility") == "hidden", "closed, the sheet is out of the way"
    open_first(p)
    r = rect(p.page, "#drawer")
    assert abs(r["top"] - (H - HALF)) <= 2 and r["bottom"] >= H, r
    a = rect(p.page, ".d-actions")
    assert abs(a["bottom"] - H) <= 1, "the actions stay on the screen's bottom edge while the sheet is only half up"
    assert p.page.evaluate("document.querySelector('.sheet-pos').textContent") == "1 / 289"
    assert p.take() == []


def test_a_home_opened_before_the_phone_features_start_gets_the_half_detent(open_phone) -> None:
    """?open= opens the listing while the page boots, before features/native.js starts: the sheet still takes the half detent (it was
    drawn half up with no detent, and its gestures did nothing until it was closed and opened again)."""
    p = open_phone("?open=paramount-tower-25e#map")
    p.page.wait_for_function("() => document.getElementById('drawer').dataset.detent === 'half'", timeout=30000)
    assert abs(rect(p.page, "#drawer")["top"] - (H - HALF)) <= 2
    p.page.locator(".sheet-grab").click()
    go_to(p.page, "full")
    assert p.take() == []


def test_drag_the_grab_bar_through_the_detents_and_close_below_peek(open_phone) -> None:
    p = open_phone()
    open_first(p)
    f, pg = p.finger, p.page
    gx, gy = center(pg, ".sheet-grab")
    f.drag(gx, gy, gx, gy - (FULL - HALF))                       # up by the gap: full
    go_to(pg, "full")
    assert abs(rect(pg, "#drawer")["top"] - (H - FULL)) <= 2
    assert abs(rect(pg, ".d-actions")["bottom"] - H) <= 1
    f.drag(200, 300, 200, 300 + (FULL - HALF))                    # a pull from the top of the content: back to half
    go_to(pg, "half")
    f.flick(200, 520, 200, 700)                                    # a flick down: one detent, not a close
    go_to(pg, "peek")
    assert abs(rect(pg, "#drawer")["top"] - (H - PEEK)) <= 2
    assert abs(rect(pg, ".d-actions")["bottom"] - H) <= 1, "still on the bottom edge at peek"
    f.drag(200, H - PEEK + 60, 200, H - 40)                        # dragged well below peek: closes
    pg.wait_for_function("() => !document.getElementById('drawer').classList.contains('open')")
    assert sel(pg) is None
    assert pg.evaluate("getComputedStyle(document.getElementById('drawer')).visibility") == "hidden"
    assert p.take() == []


def test_a_flick_down_from_peek_closes_and_a_slow_nudge_does_not(open_phone) -> None:
    p = open_phone()
    open_first(p)
    f, pg = p.finger, p.page
    f.flick(200, 520, 200, 700)
    go_to(pg, "peek")
    f.drag(200, H - PEEK + 80, 200, H - PEEK + 100)               # a nudge: back to peek
    go_to(pg, "peek")
    f.flick(200, H - PEEK + 60, 200, H - 20)
    pg.wait_for_function("() => !document.getElementById('drawer').classList.contains('open')")


def test_the_grab_bar_is_a_button_that_steps_the_detent(open_phone) -> None:
    p = open_phone()
    open_first(p)
    pg = p.page
    assert pg.locator(".sheet-grab").get_attribute("aria-label").startswith("Listing details, half height")
    pg.locator(".sheet-grab").click()
    go_to(pg, "full")
    pg.locator(".sheet-grab").click()
    go_to(pg, "half")
    box = pg.locator(".sheet-grab").bounding_box()
    assert box["height"] >= 44


def test_at_full_height_the_content_scrolls_and_only_a_pull_from_the_top_lowers_the_sheet(open_phone) -> None:
    p = open_phone()
    open_first(p)
    f, pg = p.finger, p.page
    pg.locator(".sheet-grab").click()
    go_to(pg, "full")
    f.drag(200, 560, 200, 200)                                     # scroll the content up (finger moves up)
    pg.wait_for_function("() => document.querySelector('.d-scroll').scrollTop > 100")
    assert detent(pg) == "full"
    f.drag(200, 250, 200, 500)                                     # finger down: the content scrolls back, the sheet stays
    assert detent(pg) == "full"
    pg.evaluate("() => { document.querySelector('.d-scroll').scrollTop = 0; }")
    f.drag(200, 300, 200, 300 + (FULL - HALF))
    go_to(pg, "half")


def test_the_sheet_moves_with_motion_on_and_comes_to_rest_at_the_detent(open_phone) -> None:
    p = open_phone(motion=True)
    open_first(p)
    pg = p.page
    # the spring has finished and the sheet rests at the detent (on a busy runner the drawn motion ends after the spring's own timer)
    at = "(top) => Math.abs(document.getElementById('drawer').getBoundingClientRect().top - top) <= 2"
    pg.wait_for_function(at, arg=H - HALF, timeout=10000)
    assert abs(rect(pg, "#drawer")["top"] - (H - HALF)) <= 2
    pg.locator(".sheet-grab").click()
    go_to(pg, "full")
    pg.wait_for_function(at, arg=H - FULL, timeout=10000)
    assert abs(rect(pg, "#drawer")["top"] - (H - FULL)) <= 2


# ------------------------------------------------------------------ swipe between homes
def test_swiping_sideways_on_the_sheet_shows_the_next_and_previous_home(open_phone) -> None:
    p = open_phone()
    first = open_first(p)
    f, pg = p.finger, p.page
    ids = pg.evaluate("async () => (await import('/js/features/results.js')).cardIds().slice(0, 3)")
    assert ids[0] == first
    y = rect(pg, ".d-head")["y"] + 20
    f.drag(320, y, 120, y, steps=8)                                # left: the next home
    pg.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=ids[1])
    assert pg.evaluate("document.querySelector('.sheet-pos').textContent") == "2 / 289"
    assert "open" in pg.evaluate("document.getElementById('drawer').className")
    y = rect(pg, ".d-head")["y"] + 20
    f.drag(120, y, 320, y, steps=8)                                # right: back
    pg.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=ids[0])
    y = rect(pg, ".d-head")["y"] + 20
    f.drag(120, y, 320, y, steps=8)                                # right again at the top of the list: nothing before it, the sheet springs back
    frames(pg, 3)
    assert sel(pg) == ids[0]
    f.drag(320, y, 190, y, steps=5)                                # a swipe of a third of the width: the next home again
    pg.wait_for_function("async (id) => (await import('/js/app.js')).S.sel === id", arg=ids[1])
    assert detent(pg) == "half", "the sheet keeps its height across homes"
    assert p.take() == []


def test_the_photos_keep_their_own_swipe(open_phone) -> None:
    p = open_phone()
    first = open_first(p)
    f, pg = p.finger, p.page
    n = pg.evaluate("document.querySelectorAll('#dTrack img').length")
    assert n > 1
    r = rect(pg, "#dTrack")
    f.drag(300, r["y"] + 120, 60, r["y"] + 120, steps=8)
    pg.wait_for_function("() => document.getElementById('dTrack').scrollLeft > 100")
    assert sel(pg) == first, "a swipe on the photos browses the photos, not the homes"


# ------------------------------------------------------------------ long press
def test_resting_a_finger_on_a_card_opens_its_quick_actions(open_phone) -> None:
    p = open_phone()
    pg, f = p.page, p.finger
    cid = card_ids(pg)[0]
    x, y = center(pg, "#cards .card >> nth=0 >> .rank")   # the rank tag: a part of the card that is not a button
    f.hold(x, y, 700)
    pg.wait_for_selector(".qa-menu", timeout=15000)
    labels = pg.evaluate("[...document.querySelectorAll('.qa-menu button')].map((b) => b.textContent.trim())")
    assert labels[:2] == ["Save to picks", "Add to compare"] and labels[-2:] == ["Share", "Open details"] and "See inside" in labels
    for h in pg.evaluate("[...document.querySelectorAll('.qa-menu button')].map((b) => b.getBoundingClientRect().height)"):
        assert h >= 44
    assert pg.evaluate("document.querySelectorAll('.qa-menu').length") == 1
    f.up()
    frames(pg, 3)
    assert not pg.evaluate("document.getElementById('drawer').classList.contains('open')"), "lifting the finger must not also open the home"
    pg.wait_for_selector(".qa-menu[data-armed=\"1\"]")
    pg.locator(".qa-menu button[data-qa=save]").tap()
    pg.wait_for_function("() => !document.querySelector('.qa-menu')")
    assert pg.evaluate("async (id) => !!(await import('/js/app.js')).S.picks[id]?.saved", cid)
    assert not pg.evaluate("document.getElementById('drawer').classList.contains('open')")
    # a second long press: compare, and the menu now offers to remove the save
    f.hold(x, y, 700)
    pg.wait_for_selector(".qa-menu")
    assert pg.locator(".qa-menu button[data-qa=save]").inner_text().strip() == "Remove from picks"
    f.up()
    pg.wait_for_selector(".qa-menu[data-armed=\"1\"]")
    pg.locator(".qa-menu button[data-qa=compare]").tap()
    pg.wait_for_function("async (id) => (await import('/js/app.js')).S.compare.includes(id)", arg=cid)
    assert p.take() == []


def test_a_long_press_menu_closes_on_escape_scrim_and_scroll_never_opens_one(open_phone) -> None:
    p = open_phone()
    pg, f = p.page, p.finger
    x, y = center(pg, "#cards .card >> nth=0 >> .rank")
    f.hold(x, y, 700)
    pg.wait_for_selector(".qa-menu")
    f.up()
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => !document.querySelector('.qa-menu')")
    f.hold(x, y, 700)
    pg.wait_for_selector(".qa-menu")
    f.up()
    pg.wait_for_selector(".qa-menu[data-armed=\"1\"]")
    pg.locator(".qa-scrim").tap(position={"x": 8, "y": 8})
    pg.wait_for_function("() => !document.querySelector('.qa-menu')")
    f.down(x, y)                                                   # a scroll starts under the finger: no menu
    for i in range(1, 6):
        f.move(x, y - i * 10)
        pg.wait_for_timeout(30)
    pg.wait_for_timeout(600)
    f.up()
    assert pg.evaluate("document.querySelectorAll('.qa-menu').length") == 0
    f.tap(x, y)                                                    # a plain tap still opens the home
    pg.wait_for_function("() => document.getElementById('drawer').classList.contains('open')")


def test_see_inside_and_share_from_the_quick_actions(open_phone) -> None:
    p = open_phone(init="window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); };")
    pg, f = p.page, p.finger
    x, y = center(pg, "#cards .card >> nth=0 >> .rank")
    f.hold(x, y, 700)
    pg.wait_for_selector(".qa-menu")
    f.up()
    pg.wait_for_selector(".qa-menu[data-armed=\"1\"]")
    pg.locator(".qa-menu button[data-qa=share]").tap()
    pg.wait_for_function("() => window.__shared.length === 1")
    d = pg.evaluate("window.__shared[0]")
    assert "open=" in d["url"] and d["title"] and "/mo" in d["text"]
    f.hold(x, y, 700)
    pg.wait_for_selector(".qa-menu")
    f.up()
    pg.wait_for_selector(".qa-menu[data-armed=\"1\"]")
    pg.locator(".qa-menu button[data-qa=inside]").tap()
    pg.wait_for_function("() => location.hash.startsWith('#unit/')")


# ------------------------------------------------------------------ pull to refresh
def _manifest_route(ctx, generated: str) -> None:
    """Answer data/manifest.json with the real file but this `generated` stamp (the page asks with cache 'reload', past any worker)."""
    import re

    def handle(route):
        r = route.fetch()
        body = json.loads(r.text())
        body["generated"] = generated
        route.fulfill(response=r, body=json.dumps(body))
    ctx.route(re.compile(r"/data/manifest\.json(\?.*)?$"), handle)


def test_pulling_the_list_down_checks_for_new_data(open_phone) -> None:
    p = open_phone()
    pg, f = p.page, p.finger
    cur = pg.evaluate("async () => (await import('/js/app.js')).S.manifest.generated")
    top = rect(pg, "#cards")["y"]
    _manifest_route(p.ctx, cur)
    f.drag(200, top + 30, 200, top + 330, steps=12)
    pg.wait_for_function("() => document.getElementById('toast').textContent.includes('Up to date')", timeout=20000)
    assert pg.evaluate("document.getElementById('cards').style.transform") == ""
    # a changed manifest: the page says new data is ready and offers a reload
    _manifest_route(p.ctx, "2099-01-01T00:00:00")   # registered last, so it answers first
    pg.wait_for_function("() => !document.querySelector('.ptr.busy, .ptr.out')", timeout=5000)
    f.drag(200, top + 30, 200, top + 330, steps=12)
    pg.wait_for_function("() => document.getElementById('toast').textContent.includes('New data is ready')", timeout=20000)
    assert pg.evaluate("!!document.querySelector('#toast .toast-act')")


def test_a_short_pull_does_nothing_and_a_pull_that_starts_mid_list_scrolls(open_phone) -> None:
    p = open_phone()
    pg, f = p.page, p.finger
    top = rect(pg, "#cards")["y"]
    f.drag(200, top + 30, 200, top + 60, steps=4)
    frames(pg, 3)
    assert pg.evaluate("document.getElementById('toast').textContent") == ""
    assert pg.evaluate("document.getElementById('cards').style.transform") == ""
    pg.evaluate("() => { document.getElementById('cards').scrollTop = 400; }")
    frames(pg, 3)
    f.drag(200, top + 30, 200, top + 330, steps=10)
    frames(pg, 3)
    assert pg.evaluate("document.getElementById('cards').style.transform") == ""
    assert pg.evaluate("document.getElementById('toast').textContent") == ""


# ------------------------------------------------------------------ safe areas, the shell, the keyboard
NOTCH = ":root { --safe-t: 47px; --safe-b: 34px; --safe-l: 0px; --safe-r: 0px; }"


def test_the_tab_bar_and_sheet_clear_the_home_indicator_and_the_top_clears_the_notch(open_phone) -> None:
    p = open_phone()
    pg = p.page
    pg.add_style_tag(content=NOTCH)
    frames(pg, 3)
    nav = rect(pg, ".topbar .nav")
    assert abs(nav["bottom"] - H) <= 1 and nav["h"] >= 54 + 34 - 1, nav
    pad = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.topbar .nav')).paddingBottom)")
    assert pad >= 34
    assert pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingTop)") >= 47
    first = rect(pg, ".topbar .icon-btn")
    assert first["top"] >= 47, "the buttons start below the notch"
    open_first(p)
    assert pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.d-actions')).paddingBottom)") >= 34
    a = rect(pg, ".d-actions")
    last_btn = pg.evaluate("(() => { const r = [...document.querySelectorAll('.d-actions .btn')].map((b) => b.getBoundingClientRect().bottom); return Math.max(...r); })()")
    assert last_btn <= H - 34 + 1, "the action buttons sit above the home indicator"
    assert a["bottom"] <= H + 1


def test_landscape_insets_keep_the_content_off_the_notch_sides(open_phone) -> None:
    p = open_phone()
    pg = p.page
    pg.add_style_tag(content=":root { --safe-l: 47px; --safe-r: 47px; }")
    frames(pg, 3)
    assert pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingLeft)") >= 47
    assert pg.evaluate("parseFloat(getComputedStyle(document.getElementById('cards')).paddingLeft)") >= 47
    assert pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.topbar .nav')).paddingRight)") >= 47


def test_the_shell_does_not_bounce_and_fills_the_dynamic_viewport(open_phone) -> None:
    p = open_phone()
    pg = p.page
    st = pg.evaluate("""() => ({ html: getComputedStyle(document.documentElement).overscrollBehaviorY, body: getComputedStyle(document.body).overscrollBehaviorY,
      cards: getComputedStyle(document.getElementById('cards')).overscrollBehaviorY, bodyH: document.body.getBoundingClientRect().height, innerH: innerHeight, scroll: document.scrollingElement.scrollHeight })""")
    assert st["html"] == "none" and st["body"] == "none" and st["cards"] == "contain", st
    assert abs(st["bodyH"] - st["innerH"]) <= 1 and st["scroll"] <= st["innerH"] + 1, "the page itself never scrolls: there is nothing to rubber-band"
    head = pg.evaluate("[...document.querySelectorAll('meta[name=viewport]')].map((m) => m.content)")[0]
    assert "viewport-fit=cover" in head and "interactive-widget=resizes-visual" in head


def test_the_keyboard_opening_hides_the_tab_bar_and_moves_nothing_else(open_phone) -> None:
    p = open_phone()
    pg = p.page
    pg.locator("#plBtn").tap()
    pg.wait_for_selector(".pl input")
    pg.locator(".pl input").focus()
    before = {k: rect(pg, k) for k in ("#cards", ".topbar", "#work", ".topbar .nav")}
    assert not pg.evaluate("document.documentElement.classList.contains('kbd-open')")
    # the soft keyboard shrinks the visual viewport, not the layout one
    pg.evaluate("""() => { const vv = window.visualViewport; Object.defineProperty(vv, 'height', { configurable: true, get: () => 460 }); vv.dispatchEvent(new Event('resize')); }""")
    pg.wait_for_function("() => document.documentElement.classList.contains('kbd-open')")
    frames(pg, 4)
    after = {k: rect(pg, k) for k in before if k != ".topbar .nav"}
    assert after == {k: v for k, v in before.items() if k != ".topbar .nav"}, "no layout shift when the keyboard opens"
    assert pg.evaluate("getComputedStyle(document.querySelector('.topbar .nav')).transform") != "none", "the tab bar steps aside"
    assert pg.evaluate("document.documentElement.scrollTop") == 0 and pg.evaluate("document.body.scrollTop") == 0
    pg.evaluate("() => { const vv = window.visualViewport; Object.defineProperty(vv, 'height', { configurable: true, get: () => innerHeight }); vv.dispatchEvent(new Event('resize')); }")
    pg.wait_for_function("() => !document.documentElement.classList.contains('kbd-open')")


# ------------------------------------------------------------------ Web Share
def test_the_share_button_opens_the_system_share_sheet_with_a_link_and_a_summary(open_phone) -> None:
    p = open_phone(init="window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); };")
    pg = p.page
    cid = open_first(p)
    pg.locator("#dShare").tap()
    pg.wait_for_function("() => window.__shared.length === 1")
    d = pg.evaluate("window.__shared[0]")
    assert f"open={cid}" in d["url"] and d["title"].startswith("Paramount Tower")
    lines = d["text"].split("\n")
    assert lines[0] == d["title"] and any("/mo" in ln and "score" in ln for ln in lines), d["text"]
    assert pg.evaluate("document.getElementById('toast').textContent") == "", "no 'link copied' toast: the system sheet did it"


def test_a_cancelled_share_is_quiet_and_a_missing_one_copies_the_link(open_phone) -> None:
    p = open_phone(init="navigator.share = async () => { throw new DOMException('cancelled', 'AbortError'); };")
    pg = p.page
    open_first(p)
    pg.locator("#dShare").tap()
    frames(pg, 4)
    assert pg.evaluate("document.getElementById('toast').textContent") == ""
    q = open_phone(init="Object.defineProperty(navigator, 'share', { value: undefined });")
    open_first(q)
    q.page.locator("#dShare").tap()
    q.page.wait_for_function("() => document.getElementById('toast').textContent.length > 0")


# ------------------------------------------------------------------ fields and targets
def _field_sizes(pg) -> list:
    return pg.evaluate("""() => [...document.querySelectorAll('input, select, textarea')].filter((e) => e.offsetParent !== null && !['checkbox', 'radio', 'range', 'file', 'hidden', 'button'].includes(e.type))
      .map((e) => [e.id || e.className || e.tagName, parseFloat(getComputedStyle(e).fontSize)])""")


def test_every_field_is_16px_or_more_so_ios_does_not_zoom(open_phone) -> None:
    p = open_phone()
    pg = p.page
    checked = 0
    sizes = _field_sizes(pg)                                       # the map screen: the sort select
    checked += len(sizes)
    assert all(s >= 16 for _, s in sizes), sizes
    assert sizes, "the results header has a select"
    pg.locator("#plBtn").tap()
    pg.wait_for_selector(".pl input")
    sizes = _field_sizes(pg)
    assert sizes and all(s >= 16 for _, s in sizes), sizes
    pg.locator(".pl input").focus()
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".pl input", state="hidden", timeout=15000)
    open_first(p)
    pg.locator("#dTabs a >> nth=-1").tap()                         # down to the notes: the tier buttons and the textarea
    pg.wait_for_selector("#dNote", state="attached")
    pg.evaluate("() => document.getElementById('dNote').scrollIntoView()")
    sizes = _field_sizes(pg)
    assert any(n == "dNote" for n, _ in sizes), sizes
    assert all(s >= 16 for _, s in sizes), sizes
    pg.locator("#dClose").tap()
    pg.locator("#filtersBtn").tap()
    pg.wait_for_function("() => document.body.classList.contains('rail-open')")
    sizes = _field_sizes(pg)
    assert all(s >= 16 for _, s in sizes), sizes


TARGETS = ["#menuBtn", "#plBtn", "#filtersBtn", "#tabs a >> nth=0", "#tabs a >> nth=4", "#groupSeg button:nth-child(1)", "#sortSel", ".layer-switch button:nth-child(1)",
           ".map-ctl button:nth-child(1)"]
DRAWER_TARGETS = ["#dClose", "#dSave", "#dShare", ".d-hero .hero-btns button:nth-child(3)", ".d-actions .btn:nth-child(1)", ".d-actions .btn:nth-child(2)", "#dTabs a:nth-child(1)", ".sheet-grab"]


def test_the_things_a_thumb_hits_are_44px(open_phone) -> None:
    p = open_phone()
    pg = p.page
    small = []
    for s in TARGETS:
        b = pg.locator(s).first.bounding_box()
        if not b or min(b["width"], b["height"]) < 43.5:
            small.append((s, b and (round(b["width"]), round(b["height"]))))
    # the star on a photo is drawn at 28 px with a 44 px hit area: the point 20 px away from its centre still hits it
    hit = pg.evaluate("""() => { const b = document.querySelector('#cards .card .save'); const r = b.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      return [[-20, 0], [20, 0], [0, -20], [0, 20]].every(([dx, dy]) => { const e = document.elementFromPoint(cx + dx, cy + dy); return e && (e === b || b.contains(e)); }); }""")
    if not hit:
        small.append(("#cards .save hit area", None))
    assert not small, small
    open_first(p)
    for s in DRAWER_TARGETS:
        b = pg.locator(s).first.bounding_box()
        if not b or min(b["width"], b["height"]) < 43.5:
            small.append((s, b and (round(b["width"]), round(b["height"]))))
    assert not small, small


# ------------------------------------------------------------------ the install guide
def test_the_install_guide_shows_three_steps_with_pictures_and_can_be_put_off(open_phone) -> None:
    p = open_phone(path="?installguide=1#map")
    pg = p.page
    pg.wait_for_selector("#installGuide .ig-card", timeout=10000)
    assert pg.locator("#installGuide .ig-step").count() == 3
    assert pg.locator("#installGuide .ig-pic svg").count() == 3
    assert "Add to Home Screen" in pg.locator("#installGuide").inner_text()
    assert pg.evaluate("document.querySelector('#installGuide .ig-card').getAttribute('role')") == "dialog"
    for b in pg.locator("#installGuide button.ig-btn").all():
        assert b.bounding_box()["height"] >= 44
    r = rect(pg, ".ig-card")
    assert r["bottom"] <= H + 1 and r["top"] >= 0, "it fits the screen"
    pg.locator("[data-ig=done]").tap()
    pg.wait_for_function("() => !document.getElementById('installGuide')")
    st = pg.evaluate("JSON.parse(localStorage.getItem('as:install-guide'))")
    assert st and st["at"] > 0 and not st.get("never"), "put off, not switched off"
    # reachable again from the menu
    pg.locator("#menuBtn").tap()
    pg.wait_for_selector("#mnAddHome", state="visible")
    pg.locator("#mnAddHome").tap()
    pg.wait_for_selector("#installGuide .ig-card")
    pg.locator("[data-ig=never]").tap()
    pg.wait_for_function("() => !document.getElementById('installGuide')")
    assert pg.evaluate("JSON.parse(localStorage.getItem('as:install-guide')).never") is True
    assert p.take() == []


def test_the_install_guide_closes_with_a_swipe_down_and_with_escape(open_phone) -> None:
    p = open_phone(path="?installguide=1#map")
    pg, f = p.page, p.finger
    pg.wait_for_selector("#installGuide .ig-card")
    g = center(pg, ".ig-grab")
    f.drag(g[0], g[1], g[0], g[1] + 260, steps=10)
    pg.wait_for_function("() => !document.getElementById('installGuide')", timeout=5000)
    pg.evaluate("() => { try { localStorage.removeItem('as:install-guide'); } catch (e) {} }")
    pg.reload()
    pg.wait_for_selector("#installGuide .ig-card")
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => !document.getElementById('installGuide')")


def test_the_install_guide_stays_away_from_an_installed_app_a_first_visit_and_other_platforms(open_phone) -> None:
    p = open_phone(path="?installguide=1#map", standalone=True)
    frames(p.page, 4)
    p.page.wait_for_timeout(1200)   # the guide, when it comes, comes ~0.6 s after start
    assert p.page.locator("#installGuide").count() == 0 and p.page.locator("#mnAddHome").count() == 0, "installed: nothing to install"
    q = open_phone(path="#map")
    q.page.wait_for_timeout(500)
    assert q.page.locator("#installGuide").count() == 0, "a first visit is never interrupted"
    assert q.page.locator("#mnAddHome").count() == 1, "but the menu has it"
    d = open_phone(path="?installguide=1#map", ua="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")
    d.page.wait_for_timeout(1200)
    assert d.page.locator("#installGuide").count() == 0 and d.page.locator("#mnAddHome").count() == 0, "Android installs through the browser's own prompt"


def test_a_return_visit_opens_the_guide_by_itself_once_idle(open_phone) -> None:
    p = open_phone(path="#map", init="try { localStorage.setItem('as:visits', '1'); } catch (e) {}")
    pg = p.page
    pg.wait_for_selector("#installGuide .ig-card", timeout=20000)   # the second visit: it waits ~7 s of quiet
    assert pg.evaluate("Number(JSON.parse(localStorage.getItem('as:visits')))") == 2


def test_the_page_carries_the_ios_install_tags(open_phone) -> None:
    p = open_phone()
    pg = p.page
    tags = pg.evaluate("""() => ({ icons: [...document.querySelectorAll('link[rel=apple-touch-icon]')].map((l) => l.sizes.value || 'default'),
      splash: document.querySelectorAll('link[rel=apple-touch-startup-image]').length, status: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content,
      capable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content, theme: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => [m.content, m.media]) })""")
    assert {"default", "120x120", "152x152", "167x167", "180x180"} <= set(tags["icons"])
    assert tags["splash"] == 24 and tags["status"] == "default" and tags["capable"] == "yes"
    assert len(tags["theme"]) == 1 or {m for _, m in tags["theme"]} == {"(prefers-color-scheme: dark)", "(prefers-color-scheme: light)"}


def test_the_theme_colour_follows_the_light_theme(open_phone) -> None:
    p = open_phone(theme="light", path="?theme=light#map")
    pg = p.page
    cols = pg.evaluate("[...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content.toLowerCase())")
    assert cols == ["#f4f4f1"], cols
    q = open_phone(theme="dark", path="?theme=dark#map")
    assert q.page.evaluate("[...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content.toLowerCase())") == ["#08090c"]


# ------------------------------------------------------------------ the other sheets
def test_the_search_settings_sheet_closes_with_a_swipe_down(open_phone) -> None:
    p = open_phone()
    pg, f = p.page, p.finger
    pg.locator("#menuBtn").tap()
    pg.wait_for_selector("#appMenu", state="visible")
    pg.locator("#mnSearch").tap()
    pg.wait_for_selector(".sheet[role=dialog]", state="visible")
    r = rect(pg, ".sheet .sh-h")
    f.drag(200, r["y"] + 24, 200, r["y"] + 24 + 300, steps=10)
    pg.wait_for_function("() => !document.querySelector('.sheet[role=dialog]') || document.querySelector('.sheet-scrim:not(.on)') || document.querySelector('.sheet[role=dialog]').closest('[hidden]')", timeout=5000)


def test_the_menu_sheet_closes_with_a_swipe_down(open_phone) -> None:
    p = open_phone()
    pg, f = p.page, p.finger
    pg.locator("#menuBtn").tap()
    pg.wait_for_selector("#appMenu", state="visible")
    r = rect(pg, "#appMenu")
    f.drag(200, r["y"] + 12, 200, r["y"] + 12 + 320, steps=10)
    pg.wait_for_function("() => document.getElementById('appMenu').hidden", timeout=5000)
