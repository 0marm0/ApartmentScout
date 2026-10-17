"""Dashboard smoke, interaction and accessibility checks in a real browser (Playwright + axe-core).

Every view, the drawer, the settings sheet and the command palette open in dark and light at 1440 and 390 px with
no page errors and no console errors other than the blocked external fetches (tiles, photos). At 390 px nothing may
stick out past the right edge. axe-core runs on every view: critical AND serious violations fail the build, in both themes and
in the personalised variants (other accents, high contrast, the largest text).

None of these look at a picture, so the pages build every WebGL scene (the map, Unit 3D, the floor plan studio) but draw no triangles
(`no_raster`, conftest.py): on CI's software GL each Unit 3D frame took seconds to rasterise. test_unit_3d_draws keeps the real draw.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import block_foreign
from conftest import settled
from playwright.sync_api import TimeoutError as PlaywrightTimeout

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
# every view: five tabs in the top bar (Unit 3D and Floor plan share Home); Tours sits under Shortlist and Records under Research (old links redirect, see below)
VIEWS = ["map", "list", "compare", "unit", "plan", "research"]
SUBVIEWS = ["list/tours", "research/records/emerald-green-1211"]
# the section that shows for a route: Tours has its own section, Records is hosted inside Research
SECTION = {"list/tours": "tours"}

# Elements wider than the viewport at 390 px that a scrolling or clipping ancestor does not contain.
OVERFLOW_JS = """() => {
  const vw = innerWidth, out = [];
  const clips = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && a.getBoundingClientRect().right <= vw + 1) return true; }
    return false; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right <= vw + 1 || r.left >= vw) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if (el.closest('[hidden], .maplibregl-map, .drawer:not(.open), .rail')) continue;
    if (clips(el)) continue;
    out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''} right=${Math.round(r.right)}`);
  }
  return out.slice(0, 8);
}"""


def _settled(s, cap_ms: int = 120_000) -> bool:
    """Wait until the page's main thread is idle again (conftest.SETTLED_JS); False when it never was within the cap."""
    return settled(s.page, cap_ms)


# True once a view has drawn what it will draw: the map has loaded its style and sources, Unit 3D has built its model, the floor
# plan studio has its canvas. A view with no scene is ready as soon as it has content. Waiting for this instead of a fixed sleep
# per view costs what the view needs, not what the slowest runner might.
READY_JS = """(v) => {
  const el = document.getElementById('view-' + v);
  if (!el || el.hidden || !el.children.length) return false;
  if (v === 'map') return !!window.__asMap && window.__asMap.loaded();
  if (v === 'unit') return !!(window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.scene) && document.getElementById('uLoad')?.hidden !== false;
  if (v === 'plan') return !!window.__plan3d && !!el.querySelector('canvas');
  return true;
}"""
# how long a WebGL view may take before the sweep goes on anyway (without WebGL the scene never comes; the view's own error is reported)
READY_CAP = {"map": 20000, "unit": 30000, "plan": 30000}


def _show(s, view: str) -> None:
    """Route to a view the way a click on its tab does, wait until it has drawn, then until the page is quiet."""
    pg = s.page
    pg.evaluate("(v) => { location.hash = v; }", view)
    name = SECTION.get(view, view.split("/")[0])
    pg.wait_for_function("(v) => { const el = document.getElementById('view-' + v); return el && !el.hidden && el.children.length > 0; }",
                         arg=name, timeout=20000)
    try:
        pg.wait_for_function(READY_JS, arg=name, timeout=READY_CAP.get(name, 5000))
    except PlaywrightTimeout:
        pass
    settled(pg, 20000, ticks=6)   # about 0.3 s of idle main thread: late errors from the view's own start-up have surfaced
    # a view whose module threw is caught by the shell and shown as "This view could not load"
    if err := pg.evaluate("(v) => document.querySelector('#view-' + v + ' .view-err code')?.textContent ?? null", name):
        s.errors.append(f"view #{name} could not load: {err}")


def _overflow(s) -> list[str]:
    return s.page.evaluate(OVERFLOW_JS)


@pytest.mark.parametrize("theme", ["dark", "light"])
@pytest.mark.parametrize("width", [1440, 390])
def test_every_view_loads_clean(open_page, theme: str, width: int) -> None:
    s = open_page("#map", theme=theme, width=width, height=900 if width > 600 else 844)
    problems = []
    for v in VIEWS + SUBVIEWS:
        _show(s, v)
        errs = s.take()
        if errs:
            problems.append(f"#{v}: {errs[:4]}")
        if width < 600 and (o := _overflow(s)):
            problems.append(f"#{v} overflows at {width} px: {o}")
    # the drawer, the settings sheet and the command palette
    _show(s, "map")
    s.page.locator("#cards .card").first.click()
    s.page.wait_for_selector("#drawer.open", timeout=30000)       # (the map flies to the listing first: seconds on software GL)
    settled(s.page, 20000, ticks=4)                               # the drawer has finished sliding in
    if width < 600 and (o := _overflow(s)):
        problems.append(f"drawer overflows: {o}")
    s.page.keyboard.press("Escape")
    s.page.wait_for_function("() => !document.querySelector('#drawer.open')")
    s.page.evaluate("async () => (await import('/js/app.js')).openSettings()")
    s.page.wait_for_selector(".sheet-scrim.on", timeout=30000)
    settled(s.page, 20000, ticks=4)
    if width < 600 and (o := _overflow(s)):
        problems.append(f"settings overflows: {o}")
    s.page.keyboard.press("Escape")
    s.page.wait_for_selector(".sheet-scrim.on", state="detached", timeout=30000)
    s.page.locator("#plBtn" if width < 1180 else "#q").click()
    s.page.wait_for_selector(".pl-scrim:not([hidden])", timeout=30000)
    s.page.keyboard.type("emerald")
    settled(s.page, 20000, ticks=3)
    s.page.keyboard.press("Escape")
    if errs := s.take():
        problems.append(f"drawer/settings/palette: {errs[:4]}")
    assert not problems, "\n".join(problems)


def test_all_view_tabs_reachable_on_a_phone(open_page) -> None:
    """Five tabs in a bottom tab bar, all on screen at once (Unit 3D and Floor plan share the 3D tab)."""
    s = open_page("#map", width=390, height=844)
    tabs = ["map", "list", "compare", "home", "research"]
    assert s.page.locator("#tabs a").count() == len(tabs)
    assert _settled(s), "the map never finished opening"
    nav = s.page.locator("#tabs").bounding_box()
    assert nav and abs(nav["y"] + nav["height"] - 844) <= 1 and nav["width"] == 390, f"the tab bar sits along the bottom edge: {nav}"
    for v in tabs:
        tab = s.page.locator(f'#tabs a[data-view="{v}"]')
        box = tab.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= 390 + 1 and box["width"] >= 60 and box["height"] >= 44, f"tab {v}: {box}"
        tab.click()
        s.page.wait_for_function("(v) => v === 'home' ? ['unit', 'plan'].includes(document.body.dataset.view) : document.body.dataset.view === v", arg=v, timeout=180000)
        assert _settled(s), f"view {v} kept the page busy for two minutes"
        assert s.page.locator("#tabs a.on").get_attribute("data-view") == v
    assert not s.take()


def test_shortlist_on_a_phone_shows_price_and_score(open_page) -> None:
    s = open_page("#list", width=390, height=844)
    _show(s, "list")
    rows = s.page.locator("#table tbody tr.r")
    assert rows.count() >= 5
    for i in range(5):
        for col in ("c-cost", "c-score"):
            box = rows.nth(i).locator(f"td.{col}").bounding_box()
            assert box and box["x"] + box["width"] <= 390 + 1, f"row {i} {col} is off screen: {box}"


def test_map_layer_chips_stay_on_one_line_on_a_phone(open_page) -> None:
    s = open_page("#map", width=390, height=844)
    _show(s, "map")
    s.page.wait_for_selector("#layerSwitch button")
    tops = s.page.eval_on_selector_all("#layerSwitch button", "bs => bs.map(b => Math.round(b.getBoundingClientRect().top))")
    assert len(set(tops)) == 1, f"layer chips wrap: {tops}"
    sw = s.page.locator("#layerSwitch").bounding_box()
    ctl = s.page.locator("#mapCtl").bounding_box()
    assert sw["x"] + sw["width"] <= ctl["x"], "layer chips run under the zoom column"


def test_offline_basemap_note_and_overlays(open_page) -> None:
    """Tiles are blocked, so the map must fall back to its plain background and still draw the local layers."""
    s = open_page("#map")
    _show(s, "map")
    s.page.wait_for_function("() => document.getElementById('mapOffline') && !document.getElementById('mapOffline').hidden", timeout=20000)
    layers = s.page.evaluate("() => window.__asMap.getStyle().layers.map(l => l.id)")
    assert "pins" in layers, layers
    assert not s.take()


def test_open_a_listing(open_page) -> None:
    s = open_page("#map")
    card = s.page.locator("#cards .card").first
    lid = card.get_attribute("data-id")
    card.click()
    s.page.wait_for_selector("#drawer.open", timeout=10000)
    assert s.page.evaluate("async () => (await import('/js/app.js')).S.sel") == lid
    assert s.page.locator("#drawer").inner_text().strip()
    assert not s.take()


def test_switch_commute_mode(open_page) -> None:
    s = open_page("#map")
    seg = s.page.locator("#rMode button[data-mode]:not([disabled])")
    if seg.count() < 2:
        pytest.skip("this search has a single commute mode")
    target = seg.nth(1)
    mode = target.get_attribute("data-mode")
    target.click()
    s.page.wait_for_function("async (m) => (await import('/js/app.js')).S.commuteMode === m", arg=mode, timeout=30000)
    assert s.page.locator(f'#rMode button[data-mode="{mode}"]').get_attribute("aria-pressed") == "true"
    assert not s.take()


def test_weight_slider_reranks(open_page) -> None:
    s = open_page("#map")
    order = lambda: s.page.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 12).map(c => c.dataset.id)")  # noqa: E731
    before = order()
    # move all the weight onto one dimension: the ranking must change
    s.page.evaluate("""() => { const rs = [...document.querySelectorAll('#rail [data-w]')];
      rs.forEach((r, i) => { r.value = i === rs.length - 1 ? 40 : 0; r.dispatchEvent(new Event('input', { bubbles: true })); }); }""")
    s.page.wait_for_function("(b) => JSON.stringify([...document.querySelectorAll('#cards .card')].slice(0, 12).map((c) => c.dataset.id)) !== JSON.stringify(b)",
                             arg=before, timeout=10000)
    assert order() != before
    assert not s.take()


def test_compare_add_and_deep_link(open_page) -> None:
    s = open_page("#list")
    _show(s, "list")
    btns = s.page.locator("#table [data-cmp]")
    ids = [btns.nth(i).get_attribute("data-cmp") for i in range(2)]
    btns.nth(0).click()
    btns.nth(1).click()
    s.page.wait_for_function("() => document.getElementById('cmpCount').textContent === '2'", timeout=30000)
    _show(s, "compare/" + ",".join(ids))
    text = s.page.locator("#view-compare").inner_text()
    assert text.strip()
    assert not s.take()


def test_research_tab_switch(open_page) -> None:
    s = open_page("#research")
    _show(s, "research")
    tabs = s.page.locator("#view-research [role=tab]")
    assert tabs.count() >= 2
    t = tabs.nth(1)
    key = t.get_attribute("data-tab")
    t.click()
    s.page.wait_for_function("(k) => location.hash === '#research/' + k", arg=key, timeout=30000)
    s.page.wait_for_selector(f'#view-research [role=tab][data-tab="{key}"][aria-selected="true"]', timeout=30000)
    assert not s.take()


def test_a_planted_throw_fails_the_sweep(open_page, base_url: str) -> None:
    """The harness itself: a view module that throws when it loads must show up as an error."""
    s = open_page("#map")
    src = s.page.evaluate("async () => (await fetch('/js/compare.js')).text()")
    s.page.context.route(f"{base_url}/js/compare.js", lambda r: r.fulfill(
        status=200, content_type="text/javascript", body=src + "\nthrow new Error('planted in compare.js');\n"))
    s.take()
    s.page.reload()
    _show(s, "compare")
    assert any("planted in compare.js" in e for e in s.take())


@pytest.mark.no_raster(False)   # the one test here that rasterises Unit 3D for real
def test_unit_3d_draws(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#unit")
    _show(s, "unit")
    s.page.wait_for_selector("#view-unit canvas", timeout=20000)
    assert not s.take()


def test_the_3d_views_open_the_search_default_and_the_renters_own_choice_wins(open_page, webgl: bool) -> None:
    """criteria.yaml names `search.default_listing` (the manifest carries it): Unit 3D and the Floor plan studio open that home
    when nothing else is chosen, although it is not first in their lists; a home the renter opened last (local storage) beats it."""
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#unit")
    pg = s.page
    default = pg.evaluate("async () => (await (await fetch('data/manifest.json')).json()).default_listing")
    assert default == "paramount-tower-25e"
    _show(s, "unit")
    pg.wait_for_function("(id) => document.getElementById('unitSel')?.value === id", arg=default, timeout=20000)
    assert pg.evaluate("() => document.getElementById('unitSel').options[0].value") != default
    assert pg.evaluate("() => localStorage.getItem('as:home-id')") is None          # opening the default is not a choice of the renter's
    _show(s, "plan")
    pg.wait_for_function("(id) => document.getElementById('planSel')?.value === id", arg=default, timeout=20000)
    other = pg.evaluate("async () => { const m = await (await fetch('data/manifest.json')).json(); return m.sites.find((v) => v !== m.default_listing && m.plans.includes(v)); }")
    assert other
    _show(s, f"unit/{other}")
    pg.wait_for_function("(id) => document.getElementById('unitSel')?.value === id", arg=other, timeout=20000)
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:home-id'))") == other
    pg.goto(f"{s.origin}/#unit")
    pg.reload()
    pg.wait_for_function("(id) => document.getElementById('unitSel')?.value === id", arg=other, timeout=30000)
    assert not s.take()


def _axe(page, view: str | None = None) -> list[dict]:
    """axe-core on the whole document, or with `view` (a section name) on what the renter sees with that view in front: its section and
    everything outside the view sections (top bar, rail, results, drawer, sheets), but not the other views' hidden sections. axe walks
    whatever it is given, hidden or not, and the shortlist alone leaves some 20,000 nodes behind, so a scoped run takes a third of the time.
    Rules that need the whole page (title, lang, bypass, duplicate ids) only run on the whole document: a sweep ends with one."""
    if not page.evaluate("() => typeof window.axe === 'object'"):
        page.add_script_tag(path=str(AXE))
    res = page.evaluate("""async (view) => {
      let context = document;
      if (view) {
        const shown = document.getElementById('view-' + view), views = [...document.querySelectorAll('section.view')], include = [];
        const walk = (el) => { for (const c of el.children) {
          if (views.includes(c)) { if (c === shown) include.push(c); } else if (views.some((s) => c.contains(s))) walk(c); else include.push(c); } };
        walk(document.body);
        context = { include };
      }
      const r = await axe.run(context, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations'], exclude: [['.maplibregl-canvas'], ['canvas']] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length,
        targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
    }""", view)
    return res


def _sweep(s, views: list[str]) -> tuple[list[dict], list[dict]]:
    critical, serious = [], []

    def note(where: str, found: list[dict]) -> None:
        for x in found:
            (critical if x["impact"] == "critical" else serious if x["impact"] == "serious" else []).append({"view": where, **x})
    for v in views:
        _show(s, v)
        note(v, _axe(s.page, SECTION.get(v, v.split("/")[0])))
    note(f"whole page on #{views[-1]}, every view loaded", _axe(s.page))
    return critical, serious


def test_a_planted_axe_violation_fails_the_scoped_sweep(open_page) -> None:
    """The harness itself: a scoped axe run sees the shown view and the shell around it, not the hidden views."""
    s = open_page("#list")
    _show(s, "list")
    s.page.evaluate("""() => { for (const id of ['view-list', 'rail', 'view-compare']) {
      const b = document.createElement('button'); b.className = 'planted'; document.getElementById(id).appendChild(b); } }""")
    found = {x["id"]: x for x in _axe(s.page, "list")}
    assert "button-name" in found and found["button-name"]["n"] == 2, found   # the shortlist's and the rail's, not hidden Compare's


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_accessibility(open_page, theme: str, tmp_path_factory) -> None:
    """Every view (Unit 3D and Floor plan under Home) plus Tours and Records: no critical and no serious axe violation, in both themes."""
    s = open_page("#map", theme=theme)
    critical, serious = _sweep(s, VIEWS + SUBVIEWS)
    out = tmp_path_factory.mktemp("axe") / f"axe-{theme}.json"
    out.write_text(json.dumps({"critical": critical, "serious": serious}, indent=1))
    assert not critical and not serious, json.dumps({"critical": critical, "serious": serious}, indent=1)


# the same sweep on the personalised look: each accent in each theme, high contrast with solid panels, and the largest text
PERSONAL = [
    ("dark", {"accent": "jade"}), ("dark", {"accent": "amber"}), ("dark", {"accent": "rose"}),
    ("light", {"accent": "jade"}), ("light", {"accent": "amber"}), ("light", {"accent": "rose"}),
    ("dark", {"contrast": True, "transparency": True, "text": "xl"}), ("light", {"contrast": True, "transparency": True, "text": "l", "accent": "rose"}),
]


@pytest.mark.parametrize("theme,prefs", PERSONAL, ids=lambda x: x if isinstance(x, str) else "-".join(f"{k}={v}" for k, v in x.items()))
def test_accessibility_personalised(browser, base_url: str, theme: str, prefs: dict) -> None:
    from conftest import Session, allowed_console, build_url
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=theme, device_scale_factor=1, reduced_motion="reduce")
    try:
        block_foreign(ctx, base_url)
        ctx.add_init_script(f"localStorage.setItem('as:comfort', {json.dumps(json.dumps(prefs))});")
        page = ctx.new_page()
        s = Session(page, base_url)
        page.on("pageerror", lambda e: s.errors.append(f"pageerror: {e}"))
        page.goto(build_url(base_url, "#map", theme))
        page.wait_for_function("() => document.querySelector('#cards .card')", timeout=20000)
        for k, attr in (("accent", "data-accent"), ("text", "data-text")):
            if k in prefs:
                assert page.evaluate("(a) => document.documentElement.getAttribute(a)", attr) == prefs[k]
        critical, serious = _sweep(s, ["map", "list", "compare", "research", "research/records/emerald-green-1211"])
        assert not critical and not serious, json.dumps({"prefs": prefs, "critical": critical, "serious": serious}, indent=1)
    finally:
        ctx.close()


# ------------------------------------------------------------------ consolidated navigation, theme, stats strip, starred tags
def test_old_deep_links_redirect(open_page) -> None:
    """#tours, #records/<id> and #research/<tab> keep working: they land on Tours under Shortlist and Records under Research."""
    s = open_page("#map")
    pg = s.page
    pg.evaluate("() => { location.hash = '#tours'; }")
    pg.wait_for_function("() => location.hash === '#list/tours' && !document.getElementById('view-tours').hidden", timeout=10000)
    assert pg.evaluate("() => document.querySelector('#tabs a.on').dataset.view") == "list"
    assert pg.locator("#subnav a.on").inner_text().startswith("Tours")
    pg.evaluate("() => { location.hash = '#records/emerald-green-1211'; }")
    pg.wait_for_function("() => location.hash === '#research/records/emerald-green-1211'", timeout=10000)
    pg.wait_for_selector("#view-research #rec .rec-pick-btn", timeout=15000)
    assert "Emerald Green" in pg.locator("#rec .rec-pick-btn .v").inner_text()
    assert pg.locator('#view-research [role=tab][data-tab="records"]').get_attribute("aria-selected") == "true"
    pg.evaluate("() => { location.hash = '#research/media'; }")
    pg.wait_for_selector('#view-research [role=tab][data-tab="media"][aria-selected="true"]', timeout=10000)
    assert not pg.evaluate("() => !!document.querySelector('#view-research #rec')")   # the report goes back to its parking section
    assert not s.take()


def test_theme_modes_menu_and_shortcut(open_page) -> None:
    """System, dark and light from the settings menu; `t` still flips; ?theme= wins; the choice is remembered."""
    s = open_page("#map")
    pg = s.page
    theme = lambda: pg.evaluate("() => document.documentElement.dataset.theme")  # noqa: E731
    assert theme() == "dark"
    assert pg.locator("#themeBtn").count() == 0                         # the toggle moved into the menu
    pg.locator("#menuBtn").click()
    pg.wait_for_selector("#appMenu:not([hidden])")
    pg.locator("[data-theme-mode=light]").click()
    assert theme() == "light" and pg.locator("[data-theme-mode=light]").get_attribute("aria-checked") == "true"
    pg.keyboard.press("Escape")
    assert pg.evaluate("() => document.getElementById('appMenu').hidden")
    pg.keyboard.press("t")
    assert theme() == "dark"
    pg.locator("#menuBtn").click()
    pg.locator("[data-theme-mode=system]").click()
    assert pg.evaluate("() => localStorage.getItem('as:theme')") == '"system"'
    pg.emulate_media(color_scheme="light")
    pg.wait_for_function("() => document.documentElement.dataset.theme === 'light'", timeout=30000)
    assert pg.evaluate("() => document.documentElement.dataset.themePref") == "system"
    pg.goto(pg.url.split("?")[0].split("#")[0] + "?theme=dark#map")
    pg.wait_for_function("() => document.documentElement.dataset.theme === 'dark'", timeout=10000)
    assert not s.take()


def test_stats_strip_is_collapsed_to_a_chip_until_asked_for(open_page) -> None:
    """The stats subline is one chip in the top bar ("289 matches") with a chevron; it takes no row until the renter opens it, and
    the choice is remembered in this browser."""
    s = open_page("#map", width=1440)
    pg = s.page
    chip = pg.locator("#kpiChip")
    chip.wait_for(state="visible", timeout=10000)   # the app has booted and laid the top bar out (the shared open_page returns a little earlier)
    assert chip.is_visible() and chip.get_attribute("aria-expanded") == "false"
    assert chip.inner_text().split()[1] == "matches" and int(pg.locator("#kpiChipN").inner_text()) > 0
    assert not pg.locator("#kpis").is_visible(), "collapsed: no stats row"
    bar, work = pg.locator(".topbar").bounding_box(), pg.locator("#work").bounding_box()
    assert abs(work["y"] - (bar["y"] + bar["height"])) <= 1, "the map and the list start right under the top bar"
    assert pg.locator("#kpiChip .chev").is_visible()
    # the chevron opens the full strip: a thin subline with every figure, and the chip's count is the strip's own "match filters"
    chip.click()
    pg.wait_for_selector("#kpis", state="visible")
    assert chip.get_attribute("aria-expanded") == "true"
    h = pg.locator("#kpis").bounding_box()["height"]
    assert 24 <= h <= 30, f"stats strip is {h}px tall"
    assert pg.locator("#kpis .kpi.p1").count() == 3
    keys = {t.strip(): v.strip() for t, v in zip(pg.locator("#kpis .kpi .k").all_inner_texts(), pg.locator("#kpis .kpi .v").all_inner_texts())}
    assert keys["match filters"] == pg.locator("#kpiChipN").inner_text()
    assert pg.evaluate("() => localStorage.getItem('as:stats-open')") == "true"
    # remembered across a reload; closing it is remembered too
    pg.reload()
    pg.wait_for_selector("#cards .card")
    assert pg.locator("#kpis").is_visible() and pg.locator("#kpiChip").get_attribute("aria-expanded") == "true"
    pg.locator("#kpiChip").click()
    assert not pg.locator("#kpis").is_visible() and pg.evaluate("() => localStorage.getItem('as:stats-open')") == "false"
    # a stored value of the wrong shape falls back to collapsed
    pg.evaluate("() => localStorage.setItem('as:stats-open', '\"nope\"')")
    pg.reload()
    pg.wait_for_selector("#cards .card")
    assert not pg.locator("#kpis").is_visible() and pg.locator("#kpiChip").is_visible()
    assert not s.take()


def test_stats_strip_on_a_phone_is_a_chip_and_folds_the_rest_into_the_popover(open_page) -> None:
    s = open_page("#map", width=375, height=812)
    pg = s.page
    chip = pg.locator("#kpiChip")
    chip.wait_for(state="visible", timeout=10000)   # the app has booted and laid the top bar out (the shared open_page returns a little earlier)
    assert chip.is_visible() and not pg.locator("#kpis").is_visible()
    box = chip.bounding_box()
    assert box["x"] + box["width"] < 375 and pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    brand = pg.locator(".topbar .brand").bounding_box()
    assert brand["x"] < box["x"], "the chip comes after the brand mark"
    chip.click()
    pg.wait_for_selector("#kpis", state="visible")
    # opened, the secondary figures still fold into the popover, and every figure is in it
    assert pg.locator("#kpis .kpi-more").is_visible()
    pg.locator("#kpis .kpi-more").click()
    pg.wait_for_selector("#kpiPop:not([hidden])")
    keys = [t.strip() for t in pg.locator("#kpiPop .kpi-i .k").all_inner_texts()]
    assert {"tracked", "match filters", "eligible", "shortlisted", "median / mo"} <= set(keys), keys
    pg.locator("#kpis .kpi-more").focus()   # Escape is the strip's key: on a slow runner the strip can be redrawn after the click and the focus lost
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => document.getElementById('kpiPop').hidden", timeout=30000)
    assert pg.evaluate("() => document.getElementById('kpiPop').hidden")
    assert not s.take()


def test_starred_tags_always_show_and_update_live(open_page, webgl: bool) -> None:
    """A starred home keeps a gold price tag at every zoom (never decluttered, never inside a count bubble), above plain
    tags, and starring or unstarring updates the map without a reload."""
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map")
    pg = s.page
    _show(s, "map")
    pg.wait_for_selector(".price-tag", timeout=20000)
    # pick a listing that is not already starred or flagged favorite in the data
    lid = pg.evaluate("""async () => { const a = await import('/js/app.js');
      return a.sorted(a.filtered()).find((L) => L.lat != null && !a.isSaved(L.id) && !L.favorite)?.id; }""")
    pg.evaluate("async (id) => { (await import('/js/app.js')).toggleSave(id); }", lid)
    sel = f'.price-tag[data-id="{lid}"]'
    pg.wait_for_selector(sel + ".fav", timeout=30000)
    pg.evaluate("() => window.__asMap.setZoom(10)")
    # the tags are decluttered on the next frame after the zoom: wait for that, not for a fixed second
    pg.wait_for_function("""(s) => { const t = document.querySelector(s);
      return !!t && !t.parentElement.classList.contains('hid') && !document.querySelectorAll('.tag-anchor:not(.hid) .price-tag:not(.fav):not(.sel)').length; }""", arg=sel, timeout=10000)
    assert pg.evaluate("(s) => { const t = document.querySelector(s); return !!t && !t.parentElement.classList.contains('hid'); }", sel)
    assert pg.evaluate("() => document.querySelectorAll('.tag-anchor:not(.hid) .price-tag:not(.fav):not(.sel)').length") == 0
    assert pg.evaluate("(id) => window.__asMap.getSource('starred')._data.features.some((f) => f.id === id)", lid)
    assert pg.evaluate("(id) => !window.__asMap.getSource('listings')._data.features.some((f) => f.id === id)", lid)
    assert pg.evaluate("(s) => getComputedStyle(document.querySelector(s)).borderTopColor !== getComputedStyle(document.querySelector('.price-tag:not(.fav)') || document.body).borderTopColor", sel)
    pg.evaluate("async (id) => { (await import('/js/app.js')).toggleSave(id); }", lid)
    pg.wait_for_function("(s) => !document.querySelector(s) || !document.querySelector(s).classList.contains('fav')", arg=sel, timeout=30000)
    assert pg.evaluate("(id) => !window.__asMap.getSource('starred')._data.features.some((f) => f.id === id)", lid)
    assert not s.take()
