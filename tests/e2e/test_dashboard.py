"""Dashboard smoke, interaction and accessibility checks in a real browser (Playwright + axe-core).

Every view, the drawer, the settings sheet and the command palette open in dark and light at 1440 and 390 px with
no page errors and no console errors other than the blocked external fetches (tiles, photos). At 390 px nothing may
stick out past the right edge. axe-core runs on every view: critical violations fail, serious ones are reported.
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
VIEWS = ["map", "list", "compare", "unit", "plan", "records", "research", "tours"]
SLOW = {"unit": 2500, "plan": 2500, "map": 1500}        # WebGL views need a moment to draw

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


def _show(s, view: str) -> None:
    """Route to a view the way a click on its tab does, then wait for it to render."""
    pg = s.page
    pg.evaluate("(v) => { location.hash = v; }", view)
    name = view.split("/")[0]
    pg.wait_for_function("(v) => { const el = document.getElementById('view-' + v); return el && !el.hidden && el.children.length > 0; }",
                         arg=name, timeout=20000)
    pg.wait_for_timeout(SLOW.get(name, 700))
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
    for v in VIEWS:
        _show(s, v)
        errs = s.take()
        if errs:
            problems.append(f"#{v}: {errs[:4]}")
        if width < 600 and (o := _overflow(s)):
            problems.append(f"#{v} overflows at {width} px: {o}")
    # the drawer, the settings sheet and the command palette
    _show(s, "map")
    s.page.locator("#cards .card").first.click()
    s.page.wait_for_selector("#drawer.open", timeout=10000)
    s.page.wait_for_timeout(800)
    if width < 600 and (o := _overflow(s)):
        problems.append(f"drawer overflows: {o}")
    s.page.keyboard.press("Escape")
    s.page.wait_for_function("() => !document.querySelector('#drawer.open')")
    s.page.evaluate("async () => (await import('/js/app.js')).openSettings()")
    s.page.wait_for_selector(".sheet-scrim.on", timeout=10000)
    s.page.wait_for_timeout(500)
    if width < 600 and (o := _overflow(s)):
        problems.append(f"settings overflows: {o}")
    s.page.keyboard.press("Escape")
    s.page.wait_for_timeout(400)
    s.page.locator("#plBtn" if width < 1180 else "#q").click()
    s.page.wait_for_selector(".pl-scrim:not([hidden])", timeout=10000)
    s.page.keyboard.type("emerald")
    s.page.wait_for_timeout(400)
    s.page.keyboard.press("Escape")
    if errs := s.take():
        problems.append(f"drawer/settings/palette: {errs[:4]}")
    assert not problems, "\n".join(problems)


def test_all_view_tabs_reachable_on_a_phone(open_page) -> None:
    s = open_page("#map", width=390, height=844)
    for v in VIEWS:
        tab = s.page.locator(f'#tabs a[data-view="{v}"]')
        tab.scroll_into_view_if_needed()
        box = tab.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= 390 + 1, f"tab {v} cannot be brought on screen: {box}"
        tab.click()
        s.page.wait_for_function("(v) => document.body.dataset.view === v", arg=v, timeout=10000)
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
    s.page.wait_for_function("async (m) => (await import('/js/app.js')).S.commuteMode === m", arg=mode, timeout=5000)
    assert s.page.locator(f'#rMode button[data-mode="{mode}"]').get_attribute("aria-pressed") == "true"
    assert not s.take()


def test_weight_slider_reranks(open_page) -> None:
    s = open_page("#map")
    order = lambda: s.page.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 12).map(c => c.dataset.id)")  # noqa: E731
    before = order()
    # move all the weight onto one dimension: the ranking must change
    s.page.evaluate("""() => { const rs = [...document.querySelectorAll('#rail [data-w]')];
      rs.forEach((r, i) => { r.value = i === rs.length - 1 ? 40 : 0; r.dispatchEvent(new Event('input', { bubbles: true })); }); }""")
    s.page.wait_for_timeout(1200)
    assert order() != before
    assert not s.take()


def test_compare_add_and_deep_link(open_page) -> None:
    s = open_page("#list")
    _show(s, "list")
    btns = s.page.locator("#table [data-cmp]")
    ids = [btns.nth(i).get_attribute("data-cmp") for i in range(2)]
    btns.nth(0).click()
    btns.nth(1).click()
    s.page.wait_for_function("() => document.getElementById('cmpCount').textContent === '2'", timeout=5000)
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
    s.page.wait_for_function("(k) => location.hash === '#research/' + k", arg=key, timeout=5000)
    s.page.wait_for_selector(f'#view-research [role=tab][data-tab="{key}"][aria-selected="true"]', timeout=5000)
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


def test_unit_3d_draws(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#unit")
    _show(s, "unit")
    s.page.wait_for_selector("#view-unit canvas", timeout=20000)
    assert not s.take()


def _axe(page) -> list[dict]:
    if not page.evaluate("() => typeof window.axe === 'object'"):
        page.add_script_tag(path=str(AXE))
    res = page.evaluate("""async () => {
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations'], exclude: [['.maplibregl-canvas'], ['canvas']] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length,
        targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
    }""")
    return res


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_accessibility(open_page, theme: str, tmp_path_factory) -> None:
    s = open_page("#map", theme=theme)
    critical, serious = [], []
    for v in VIEWS:
        _show(s, v)
        for x in _axe(s.page):
            (critical if x["impact"] == "critical" else serious if x["impact"] == "serious" else []).append({"view": v, **x})
    out = tmp_path_factory.mktemp("axe") / f"axe-{theme}.json"
    out.write_text(json.dumps({"critical": critical, "serious": serious}, indent=1))
    if serious:
        warnings.warn(f"axe ({theme}): {len(serious)} serious violation(s): "
                      + "; ".join(f"#{x['view']} {x['id']} x{x['n']}" for x in serious[:12]) + f" (details: {out})")
    assert not critical, json.dumps(critical, indent=1)
