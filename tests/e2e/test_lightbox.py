"""Photos in a real browser: the full-screen lightbox from cards, the drawer and the Research gallery (groups, zoom,
swipe, floor plan overlay, keyboard, focus, phone width, axe), blur-up previews, photo ordering and the card-to-drawer
transition. Saved photos are served from the example's media folder; every other host is blocked (see conftest).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
LB = ".lbx"
# a listing whose photos, building photos and floor plan are all saved under the example's media/ folder
PLAN_LISTING = "416-west-52nd-street-507"


def _open_card_lightbox(s, n: int = 0) -> None:
    pg = s.page
    pg.locator("#cards .card .nph").nth(n).click()
    pg.wait_for_selector(f"{LB} .lbx-img.on", timeout=20000)


def _counter(pg) -> str:
    return pg.locator(f"{LB} .lbx-n").inner_text().replace(" ", "")


def _zoom_pct(pg) -> int:
    return int(pg.locator(f"{LB} .lbx-zv").inner_text().rstrip("%"))


def _open_drawer(s, id_: str) -> None:
    pg = s.page
    pg.wait_for_timeout(1000)          # the map module finishes loading just after the first cards; opening earlier can be undone by it
    pg.evaluate("async (id) => (await import('/js/app.js')).openDrawer(id, { instant: true })", id_)
    pg.wait_for_selector("#drawer.open #dTrack img", timeout=15000)
    pg.wait_for_timeout(300)


# ------------------------------------------------------------------ cards
def test_card_shows_photo_counts_by_group(open_page) -> None:
    s = open_page("#map")
    s.page.wait_for_selector("#cards .card .nph")
    chip = s.page.locator("#cards .card .nph").first
    assert s.page.locator("#cards .card .nph").count() > 5
    text = chip.inner_text()
    assert any(w in text for w in ("unit", "building", "photo", "same line")), text
    label = chip.get_attribute("aria-label")
    assert label.startswith("View ") and "full screen" in label
    assert not s.take()


def test_card_count_opens_the_lightbox_not_the_drawer_and_escape_returns_focus(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    chip = pg.locator("#cards .card .nph").first
    chip.focus()
    pg.keyboard.press("Enter")
    pg.wait_for_selector(f"{LB} .lbx-img.on", timeout=20000)
    assert pg.get_attribute(LB, "role") == "dialog" and pg.get_attribute(LB, "aria-modal") == "true"
    assert not pg.evaluate("() => !!document.querySelector('#drawer.open')"), "the count must not open the drawer"
    assert pg.evaluate("() => !!document.getElementById('cards').closest('[inert]')"), "the page behind is inert while the viewer is open"
    pg.keyboard.press("Escape")
    pg.wait_for_selector(LB, state="detached", timeout=5000)
    assert not pg.evaluate("() => !!document.getElementById('cards').closest('[inert]')")
    assert pg.evaluate("() => document.activeElement?.classList.contains('nph')")
    assert not s.take()


# ------------------------------------------------------------------ navigation, tabs, captions
def test_arrow_keys_home_end_and_tabs_move_between_photos(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_card_lightbox(s)
    total = int(_counter(pg).split("/")[1])
    assert _counter(pg) == f"1/{total}" and total > 3
    pg.keyboard.press("ArrowRight"); assert _counter(pg) == f"2/{total}"
    pg.keyboard.press("ArrowLeft"); pg.keyboard.press("ArrowLeft"); assert _counter(pg) == f"{total}/{total}"      # wraps
    pg.keyboard.press("Home"); assert _counter(pg) == f"1/{total}"
    pg.keyboard.press("End"); assert _counter(pg) == f"{total}/{total}"
    # the group tabs filter the sequence and the counts add up
    tabs = pg.locator(f"{LB} [role=tab]")
    names = [t.inner_text().replace("\n", " ") for t in tabs.all()]
    assert names[0].startswith("All") and any(n.startswith("Building") for n in names), names
    pg.locator(f'{LB} [role=tab][data-tab="building"]').click()
    assert pg.get_attribute(f'{LB} [role=tab][data-tab="building"]', "aria-selected") == "true"
    n_building = int(pg.locator(f'{LB} [data-tab="building"] i').inner_text())
    assert _counter(pg).endswith(f"/{n_building}")
    assert pg.locator(f"{LB} .lbx-tag").inner_text().lower() == "building"
    assert pg.locator(f"{LB} .lbx-th").count() == n_building
    assert not s.take()


def test_caption_names_credit_and_licence(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_card_lightbox(s)
    pg.locator(f'{LB} [role=tab][data-tab="building"]').click()
    pg.wait_for_timeout(200)
    cap = pg.locator(f"{LB} .lbx-cap").inner_text()
    assert "BUILDING" in cap.upper()
    assert pg.locator(f"{LB} .lbx-credit").inner_text().strip(), "building photos carry a credit line"
    live = pg.locator(f"{LB} .lbx-live").inner_text()
    assert live.startswith("Photo 1 of")
    assert not s.take()


def test_thumbnail_click_and_strip_state(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_card_lightbox(s)
    pg.locator(f"{LB} .lbx-th").nth(2).click()
    assert _counter(pg).startswith("3/")
    assert pg.locator(f"{LB} .lbx-th").nth(2).get_attribute("aria-current") == "true"
    assert pg.locator(f"{LB} .lbx-th[aria-current=true]").count() == 1
    assert not s.take()


# ------------------------------------------------------------------ zoom, pan, swipe
def test_double_click_wheel_and_keys_zoom(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_card_lightbox(s)
    box = pg.locator(f"{LB} .lbx-img").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    assert _zoom_pct(pg) == 100
    pg.mouse.dblclick(cx, cy)
    assert _zoom_pct(pg) > 200 and pg.evaluate("() => document.querySelector('.lbx').classList.contains('zoomed')")
    pg.mouse.dblclick(cx, cy)
    assert _zoom_pct(pg) == 100
    pg.mouse.move(cx, cy)
    pg.mouse.wheel(0, -400)
    assert _zoom_pct(pg) > 100
    pg.keyboard.press("0"); assert _zoom_pct(pg) == 100
    pg.keyboard.press("+"); assert _zoom_pct(pg) == 150
    pg.keyboard.press("-"); assert _zoom_pct(pg) == 100
    # a zoomed photo pans by dragging and stays inside its edges
    pg.keyboard.press("+"); pg.keyboard.press("+")
    tx0 = pg.evaluate("() => document.querySelector('.lbx-zoom').style.transform")
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx - 90, cy - 40, steps=6); pg.mouse.up()
    assert pg.evaluate("() => document.querySelector('.lbx-zoom').style.transform") != tx0
    assert _counter(pg).startswith("1/"), "panning a zoomed photo must not change photo"
    assert not s.take()


def test_swipe_and_pull_down(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_card_lightbox(s)
    box = pg.locator(f"{LB} .lbx-stage").bounding_box()
    y = box["y"] + box["height"] / 2
    x = box["x"] + box["width"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 260, y, steps=8); pg.mouse.up()
    assert _counter(pg).startswith("2/"), _counter(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 260, y, steps=8); pg.mouse.up()
    assert _counter(pg).startswith("1/")
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x, y + 300, steps=10); pg.mouse.up()
    pg.wait_for_selector(LB, state="detached", timeout=5000)
    assert not s.take()


def test_clicking_the_backdrop_closes_but_clicking_the_photo_does_not(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_card_lightbox(s)
    box = pg.locator(f"{LB} .lbx-img").bounding_box()
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.wait_for_timeout(400)
    assert pg.locator(LB).count() == 1
    pg.mouse.click(8, 400)
    pg.wait_for_selector(LB, state="detached", timeout=5000)
    assert not s.take()


# ------------------------------------------------------------------ floor plan
def test_floor_plan_overlay_and_side_by_side(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_drawer(s, PLAN_LISTING)
    pg.click("#dExpand")
    pg.wait_for_selector(f"{LB} .lbx-img.on", timeout=20000)
    assert pg.locator(f"{LB} .lbx-plan").is_visible()
    assert pg.get_attribute(f'{LB} [data-pm="off"]', "aria-pressed") == "true"
    pg.click(f'{LB} [data-pm="overlay"]')
    assert pg.locator(f"{LB} .lbx-ov").is_visible() and pg.locator(f"{LB} .lbx-op").is_visible()
    pg.locator(f"{LB} .lbx-op").fill("30")
    assert float(pg.evaluate("() => document.querySelector('.lbx-ov').style.opacity")) == pytest.approx(0.30)
    pg.click(f'{LB} [data-pm="side"]')
    pg.wait_for_selector(f"{LB} .lbx-pane.side:not([hidden])")
    assert not pg.locator(f"{LB} .lbx-ov").is_visible()
    pg.wait_for_function("() => document.querySelector('.lbx-planimg').naturalWidth > 0", timeout=10000)
    pg.keyboard.press("f")                       # f cycles: side -> off
    assert pg.get_attribute(f'{LB} [data-pm="off"]', "aria-pressed") == "true"
    # the plan itself has no plan control (nothing to overlay on a plan)
    pg.locator(f'{LB} [role=tab][data-tab="plan"]').click()
    assert not pg.locator(f"{LB} .lbx-plan").is_visible()
    assert not s.take()


# ------------------------------------------------------------------ drawer
def test_drawer_carousel_opens_the_lightbox_at_the_same_photo(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_drawer(s, PLAN_LISTING)
    assert pg.locator("#dExpand").count() == 1
    count = pg.locator("#dCount").inner_text()
    assert " · " in count and count.startswith("1 / "), f"the counter names the group: {count}"
    pg.click("#dNext"); pg.wait_for_timeout(500)
    assert pg.locator("#dCount").inner_text().startswith("2 / ")
    pg.locator("#dTrack").focus()
    pg.keyboard.press("Enter")
    pg.wait_for_selector(f"{LB} .lbx-img.on", timeout=20000)
    # same photo as the carousel's second slide (the lightbox lists the unit group first, like the carousel)
    src = pg.evaluate("() => document.querySelector('.lbx-img').getAttribute('src')")
    slide = pg.evaluate("() => document.querySelectorAll('#dTrack img')[1].getAttribute('src')")
    assert src == slide
    assert pg.locator(f"{LB} .lbx-open").is_hidden(), "the drawer already shows this listing"
    pg.keyboard.press("Escape")
    pg.wait_for_selector(LB, state="detached", timeout=5000)
    assert pg.evaluate("() => !!document.querySelector('#drawer.open')"), "closing the viewer keeps the drawer"
    assert not s.take()


def test_clicking_a_slide_opens_the_lightbox_and_a_drag_does_not(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    _open_drawer(s, PLAN_LISTING)
    box = pg.locator("#dTrack").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 160, y, steps=8); pg.mouse.up()
    pg.wait_for_timeout(500)
    assert pg.locator(LB).count() == 0, "dragging the carousel must not open the viewer"
    pg.mouse.click(x, y)
    pg.wait_for_selector(f"{LB} .lbx-img", timeout=20000)
    assert not s.take()


# ------------------------------------------------------------------ research gallery
def test_research_gallery_filters_by_scope_and_opens_the_lightbox(open_page) -> None:
    s = open_page("#research/media")
    pg = s.page
    pg.wait_for_selector("#view-research .rgt-b", timeout=20000)
    assert pg.locator("#view-research .rg").count() > 0
    all_n = pg.locator("#view-research .rgt").count()
    # justified rows: the tiles of a full row share one height
    heights = pg.evaluate("""() => { const g = document.querySelector('#view-research .rg'); const rows = new Map();
      for (const t of g.querySelectorAll('.rgt-b')) { const r = t.getBoundingClientRect(); const k = Math.round(r.top); (rows.get(k) || rows.set(k, []).get(k)).push(Math.round(r.height)); }
      return [...rows.values()].filter((r) => r.length > 1).slice(0, 1) }""")
    if heights:
        assert max(heights[0]) - min(heights[0]) <= 2, heights
    pg.locator('#view-research [data-k="plan"]').click()
    pg.wait_for_selector("#view-research .rgt-b")
    assert pg.locator("#view-research .rgt:not(.g-plan)").count() == 0
    assert pg.locator('#view-research [data-k="plan"]').get_attribute("aria-pressed") == "true"
    pg.locator('#view-research [data-k="all"]').click()
    pg.wait_for_selector("#view-research .rgt-b")
    pg.locator("#view-research .rgt-b").first.click()
    pg.wait_for_selector(f"{LB} .lbx-img", timeout=20000)
    assert pg.locator(f"{LB} .lbx-open").is_visible(), "outside the drawer the viewer can open the listing"
    pg.keyboard.press("Escape")
    pg.wait_for_selector(LB, state="detached", timeout=5000)
    pg.locator('#view-research [data-v="building"]').click()
    pg.wait_for_selector("#view-research .mg-t.static")
    assert pg.locator("#view-research .mg").count() > 0 and all_n > 0
    assert not s.take()


def test_research_scope_chip_counts_match_the_tiles(open_page) -> None:
    s = open_page("#research/media")
    pg = s.page
    pg.wait_for_selector("#view-research .rgt-b", timeout=20000)
    n = int(pg.locator('#view-research [data-k="street"] .n').inner_text())
    assert n > 0
    pg.locator('#view-research [data-k="street"]').click()
    pg.wait_for_selector("#view-research .rgt-b")
    assert pg.locator("#view-research .rs-sub").inner_text().startswith(f"{n} image")
    assert pg.locator('#view-research [data-k="street"]').get_attribute("aria-pressed") == "true"
    assert not s.take()


# ------------------------------------------------------------------ phone
def test_lightbox_on_a_phone_fits_and_scrolls_its_tabs(open_page) -> None:
    s = open_page("#map", width=420, height=900)
    pg = s.page
    _open_drawer(s, PLAN_LISTING)
    pg.click("#dExpand")
    pg.wait_for_selector(f"{LB} .lbx-img.on", timeout=20000)
    assert pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    for sel in (".lbx-close", ".lbx-tabs", ".lbx-strip", ".lbx-cap"):
        b = pg.locator(f"{LB} {sel}").bounding_box()
        assert b and b["x"] >= -1 and b["x"] + b["width"] <= 421, (sel, b)
    close = pg.locator(f"{LB} .lbx-close").bounding_box()
    assert close["width"] >= 34 and close["height"] >= 34, "touch targets"
    pg.click(f'{LB} [data-tab="building"]')
    assert _counter(pg).startswith("1/")
    pg.click(f"{LB} .lbx-close")
    pg.wait_for_selector(LB, state="detached", timeout=5000)
    assert not s.take()


# ------------------------------------------------------------------ accessibility
@pytest.mark.parametrize("theme", ["dark", "light"])
def test_lightbox_has_no_serious_axe_violations(open_page, theme: str) -> None:
    s = open_page("#map", theme=theme)
    pg = s.page
    _open_drawer(s, PLAN_LISTING)
    pg.click("#dExpand")
    pg.wait_for_selector(f"{LB} .lbx-img.on", timeout=20000)
    pg.add_script_tag(path=str(AXE))
    res = pg.evaluate("""async () => { const r = await axe.run('.lbx', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }""")
    bad = [v for v in res if v["impact"] in ("critical", "serious")]
    assert not bad, json.dumps(bad, indent=1)
    # focus stays inside the dialog
    for _ in range(14):
        pg.keyboard.press("Tab")
        assert pg.evaluate("() => !!document.activeElement.closest('.lbx')"), "focus escaped the lightbox"
    assert not s.take()


# ------------------------------------------------------------------ blur-up, ordering, transition
def test_blur_up_previews_load_from_the_sidecar_and_paint_behind_pending_photos(open_page, browser, base_url: str) -> None:
    side = json.loads(Path(__file__).resolve().parents[2].joinpath("dashboard/data/lqip.json").read_text())
    assert side["v"] == 1 and len(side["items"]) > 100
    first = next(iter(side["items"].values()))
    assert len(first[2]) < 700, "a preview is a few hundred bytes"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    pending: list = []
    requested: list[str] = []

    def route(r):
        u = r.request.url
        if u.startswith(base_url + "/data/lqip.json"):
            requested.append(u)
        if "/media/" in u:
            pending.append(r)          # never answered: the photo stays loading, so its preview must show
            return
        r.continue_() if u.startswith((base_url, "data:", "blob:")) else r.abort()
    ctx.route("**/*", route)
    pg = ctx.new_page()
    pg.goto(base_url + "/#map")
    pg.wait_for_selector("#cards .card", timeout=20000)
    pg.wait_for_function("() => document.querySelectorAll('#cards .media .lq').length > 3", timeout=15000)
    assert requested, "the sidecar is fetched"
    bg = pg.evaluate("() => getComputedStyle(document.querySelector('#cards .media .lq b')).backgroundImage")
    assert bg.startswith('url("data:image/webp;base64,')
    # the main listings file does not carry the previews
    assert "base64" not in pg.evaluate("async () => (await fetch('data/listings.json')).text().then((t) => t.slice(0, 200000))")
    # and the pending photo is invisible until it loads (the page fades it in over the preview)
    assert pg.evaluate("() => getComputedStyle(document.querySelector('#cards .media > img')).opacity") == "0"
    ctx.close()


def test_a_flagged_first_photo_goes_behind_a_clean_one(browser, base_url: str) -> None:
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    seen: dict = {}

    def route(r):
        u = r.request.url
        if u.endswith("/data/listings.json"):
            body = json.loads(r.fetch().text())
            L = next(x for x in body if len(x.get("photos_local") or []) > 2 and x["status"] in ("new", "researching", "shortlist"))
            seen.update(id=L["id"], first=L["photos_local"][0], second=L["photos_local"][1])
            L["photo_flags"] = {L["photos_local"][0]: {"watermark": True, "why": ["phone number"]}}
            L.pop("photos_meta", None)
            r.fulfill(body=json.dumps(body), content_type="application/json")
        else:
            r.continue_() if u.startswith((base_url, "data:", "blob:")) else r.abort()
    ctx.route("**/*", route)
    pg = ctx.new_page()
    pg.goto(base_url + "/#map")
    pg.wait_for_selector("#cards .card", timeout=20000)
    got = pg.evaluate("""async (id) => { const m = await import('/js/app.js'); const u = await import('/js/util.js');
      const L = m.byId(id); const own = u.imagesOf(L).own; return { own: own.slice(0, 3), all: own } }""", seen["id"])
    assert seen["first"] not in got["own"][:2] and got["own"][0] == seen["second"], (seen, got)
    assert got["all"][-1] == seen["first"], "flagged photos are last in their group (here: the unit group is all there is)"
    ctx.close()


def test_card_photo_grows_into_the_drawer_with_a_view_transition(browser, base_url: str) -> None:
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="no-preference")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(base_url + "/#map")
    pg.wait_for_selector("#cards .card", timeout=20000)
    has_vt = pg.evaluate("() => typeof document.startViewTransition === 'function'")
    pg.evaluate("""() => { window.__vt = 0; const o = document.startViewTransition?.bind(document); if (o) document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; }""")
    pg.locator("#cards .card").first.click()
    pg.wait_for_selector("#drawer.open #dTrack img", timeout=15000)
    pg.wait_for_function("() => !document.documentElement.classList.contains('vt-hero')", timeout=5000)
    if has_vt:
        assert pg.evaluate("() => window.__vt") == 1
    # names are cleaned up once the transition ends, and a second open (drawer already open) is a plain swap
    assert pg.evaluate("() => !document.querySelector('[style*=view-transition-name]')")
    pg.locator("#cards .card").nth(1).click()
    pg.wait_for_timeout(600)
    if has_vt:
        assert pg.evaluate("() => window.__vt") == 1
    assert not errors
    ctx.close()


def test_reduced_motion_skips_the_transition(open_page) -> None:
    s = open_page("#map")             # open_page emulates reduced motion
    pg = s.page
    pg.evaluate("""() => { window.__vt = 0; if (document.startViewTransition) { const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; } }""")
    pg.locator("#cards .card").first.click()
    pg.wait_for_selector("#drawer.open", timeout=10000)
    assert pg.evaluate("() => window.__vt") == 0
    assert not s.take()


def test_shortlist_thumbnails_use_the_card_photo(open_page) -> None:
    s = open_page("#list")
    pg = s.page
    pg.wait_for_selector("#view-list .th img", timeout=20000)
    # a home with saved photos shows the same first photo in the table as on its card (not the unit glyph)
    got = pg.evaluate("""async () => { const m = await import('/js/app.js'); const p = await import('/js/features/photos.js');
      const L = m.S.listings.find((x) => (x.photos_local || []).length && x.status !== 'gone');
      const row = [...document.querySelectorAll('#view-list tr, #view-list [data-id]')].find((r) => (r.dataset.id || '') === L.id);
      return { want: p.heroOf(L).url, have: row ? row.querySelector('.th img')?.getAttribute('src') ?? null : 'norow' } }""")
    assert got["have"] in (got["want"], "norow"), got
    assert pg.locator("#view-list .th img").count() > 5
    assert not s.take()
