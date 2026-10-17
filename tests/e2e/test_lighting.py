"""Lighting design in a real browser: the Floor plan studio's Light tab (relative daylight grid, inputs with assumed-or-source
labels, luminaires and the lamp estimate, the annual summary), render quality (Fast / Visual and the progressive export) in the
studio and in Unit 3D, with an axe sweep over the new panels.

Everything the renter sees must say what it is: Modelled (the relative daylight model, not lux), Estimate (lamps, no bounce) or
Visual preview (3D brightness, tint, glow). These tests look for those words next to the numbers, and for the numbers moving
the right way, not for particular values.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels except where a test says so: see conftest.NO_RASTER_JS

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
PLAN = "paramount-tower-25e"
SLOW = 30000

SETTLED_JS = """(capMs) => new Promise((resolve) => {
  const t0 = performance.now(); let quiet = 0, last = t0;
  const iv = setInterval(() => {
    const now = performance.now(); quiet = now - last < 130 ? quiet + 1 : 0; last = now;
    if (quiet >= 8 || now - t0 > capMs) { clearInterval(iv); resolve(quiet >= 8); }
  }, 50);
})"""


def _plan(open_page, theme: str = "dark", width: int = 1440, height: int = 1000):
    s = open_page(f"#plan/{PLAN}", theme=theme, width=width, height=height)
    s.page.wait_for_selector("#psTabs", timeout=SLOW)
    s.page.wait_for_function("() => document.querySelector('#psInsp') && document.querySelector('#phud')?.textContent", timeout=SLOW)
    s.page.evaluate(SETTLED_JS, 60000)
    return s


def _light(s, view: str = "daylight"):
    pg = s.page
    pg.click('#psTabs [data-t="light"]')
    pg.wait_for_selector("#lxRoot", timeout=SLOW)
    if view != "daylight":
        pg.click(f'[data-lx-view="{view}"]')
        pg.wait_for_selector(f'#lxSub [data-lx-view="{view}"].on', timeout=SLOW)
    pg.evaluate(SETTLED_JS, 20000)


def _means(s) -> dict[str, float]:
    """Room -> average (the first number of the room's row in the results table)."""
    return s.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('#lxResults table.lx-table tbody tr')]
        .map(tr => [tr.cells[0].childNodes[0].textContent.trim(), parseFloat(tr.cells[1].textContent)]))""")


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser")


def _axe(page, scope: list[str]) -> list[dict]:
    """axe-core on the panels under test (critical and serious violations), not the whole page: the full-page sweep is test_dashboard's."""
    if not page.evaluate("() => typeof window.axe === 'object'"):
        page.add_script_tag(path=str(AXE))
    return page.evaluate("""async (scope) => {
      const r = await axe.run({ include: scope.map((q) => [q]) }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations'], exclude: [['.maplibregl-canvas'], ['canvas']] });
      return r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
        .map(v => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
    }""", scope)


# ------------------------------------------------------------------------------------------------ daylight grid
def test_daylight_grid_is_labelled_as_a_relative_model_and_draws_a_heat_map(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s)
    pg = s.page
    kinds = pg.locator("#lxRoot .lx-kind")
    assert kinds.first.inner_text() == "Modelled"
    text = pg.locator("#lxResults").inner_text()
    assert "not lux" in text and "Not calibrated" in text
    means = _means(s)
    assert {"Bedroom", "Living room"} <= set(means) and all(v > 0 for v in means.values()), means
    assert "Bath (no window)" in text            # rooms without a window are listed, never given a made-up number
    for box in ("#lxHeat2d", "#lxHeat3d"):        # the heat toggles are remembered: an earlier test may have left them on
        if pg.is_checked(box):
            pg.uncheck(box)
    pg.wait_for_function("() => !document.querySelector('#p2heat image')", timeout=SLOW)
    pg.check("#lxHeat2d")
    pg.wait_for_selector("#p2heat image.lx-heat", state="attached", timeout=SLOW)
    assert pg.locator("#p2heat image.lx-heat").count() == len(means)
    pg.check("#lxHeat3d")
    pg.evaluate(SETTLED_JS, 20000)
    assert pg.locator("#lxResults .lx-legend").count() == 1
    # hovering the heat map reads out the value under the pointer, with its label
    pg.locator("#p2d").scroll_into_view_if_needed()
    box = pg.locator("#p2d .p2-room.k-living").first.bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.35)
    pg.mouse.move(box["x"] + box["width"] * 0.5 + 3, box["y"] + box["height"] * 0.35 + 3)
    pg.wait_for_selector(".lx-tip:not([hidden])", timeout=5000)
    assert "Modelled" in pg.locator(".lx-tip").inner_text() or "modelled" in pg.locator(".lx-tip").inner_text()
    pg.uncheck("#lxHeat2d")
    pg.wait_for_function("() => !document.querySelector('#p2heat image')", timeout=SLOW)   # the overlay is cleared on the next draw
    assert not s.take()


def test_clear_sky_follows_the_sun_and_says_so_at_night(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s)
    pg = s.page
    oc = _means(s)
    pg.click('[data-lx-sky="clear"]')
    pg.evaluate(SETTLED_JS, 20000)
    clear = _means(s)
    assert set(clear) == set(oc) and clear != oc, (oc, clear)
    pg.evaluate("() => { const t = document.querySelector('#pTime'); t.value = 300; t.dispatchEvent(new Event('input', { bubbles: true })); }")
    pg.wait_for_function("() => document.querySelector('#lxResults').textContent.includes('below the horizon')", timeout=SLOW)
    assert not s.take()


# ------------------------------------------------------------------------------------------------ inputs and their sources
def test_inputs_are_assumed_until_a_source_is_recorded_and_the_label_persists(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s)
    pg = s.page
    pg.evaluate("() => { document.querySelector('#lxInputs').open = true; }")
    assert "0 of 6 sourced" in pg.locator("#lxSrcCount").inner_text()
    assert "assumed" in pg.locator("#lxVt").inner_text()
    base = _means(s)["Living room"]
    pg.select_option("#glzPreset", "double-low-e")
    pg.wait_for_function("() => document.querySelector('#psGlazing').value === '0.7'", timeout=SLOW)
    pg.evaluate(SETTLED_JS, 10000)
    assert _means(s)["Living room"] > base                          # clearer glass: more light, same sky
    pg.select_option('select[data-lx="src"][data-k="glazing"]', "source")
    pg.fill('input[data-lx="note"][data-k="glazing"]', "Window sticker, VT 0.70")
    pg.dispatch_event('input[data-lx="note"][data-k="glazing"]', "change")
    pg.wait_for_function("() => document.querySelector('#lxSrcCount').textContent.includes('1 of 6')", timeout=SLOW)
    assert "source" in pg.locator("#lxVt").inner_text()
    stored = pg.evaluate("() => Object.entries(localStorage).filter(([k]) => k.startsWith('as:plan-light.')).map(([k, v]) => JSON.parse(v))")
    assert stored and stored[0]["daylight"]["glazing"]["source"] == "source" and "VT 0.70" in stored[0]["daylight"]["glazing"]["note"], stored
    pg.reload()
    pg.wait_for_selector("#psTabs", timeout=SLOW)
    _light(s)
    pg.evaluate("() => { document.querySelector('#lxInputs').open = true; }")
    assert "1 of 6 sourced" in pg.locator("#lxSrcCount").inner_text()
    assert pg.locator('input[data-lx="note"][data-k="glazing"]').input_value() == "Window sticker, VT 0.70"


def test_blinds_frame_and_surfaces_feed_the_model_and_sheer_exists(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s)
    pg = s.page
    pg.evaluate("() => { document.querySelector('#lxInputs').open = true; }")
    base = _means(s)["Bedroom"]
    assert pg.locator('#psBlinds [data-b="sheer"]').count() == 1
    pg.click('#psBlinds [data-b="sheer"]')
    pg.evaluate(SETTLED_JS, 10000)
    sheer = _means(s)["Bedroom"]
    assert 0.5 * base < sheer < base
    pg.click('#psBlinds [data-b="open"]')
    pg.select_option("#frmPreset", "multi-lite")
    pg.evaluate(SETTLED_JS, 10000)
    assert _means(s)["Bedroom"] < base                              # heavier frames pass less
    pg.select_option("#frmPreset", "default")
    pg.select_option("#srf-walls", "dark")
    pg.evaluate(SETTLED_JS, 10000)
    dark = _means(s)["Bedroom"]
    pg.select_option("#srf-walls", "white")
    pg.evaluate(SETTLED_JS, 10000)
    white = _means(s)["Bedroom"]
    assert dark < base < white                                      # surfaces move the inter-reflected part
    assert not s.take()


# ------------------------------------------------------------------------------------------------ luminaires
def test_luminaires_add_drag_nudge_delete_and_undo_with_an_estimate(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s, "lamps")
    pg = s.page
    assert pg.locator("#lxRoot .lx-kind").first.inner_text() == "Estimate"
    pg.click('[data-lx-add="recessed"]')
    pg.wait_for_selector("#p2lum [data-lum]", timeout=SLOW)
    assert pg.locator("#lxList li").count() >= 1 and pg.locator("#p2lum [data-lum]").count() == 1
    pg.wait_for_function("() => document.querySelector('#lxResults').textContent.includes('Estimate on the floor')", timeout=SLOW)
    assert "lx" in pg.locator("#lxResults table").inner_text()
    g = pg.locator("#p2lum [data-lum] .lx-hit").first
    x0 = float(pg.input_value("#lf-x"))
    g.scroll_into_view_if_needed()
    b = g.bounding_box()
    pg.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(b["x"] + b["width"] / 2 + 40, b["y"] + b["height"] / 2 + 10, steps=5)
    pg.mouse.up()
    pg.wait_for_function("(x0) => parseFloat(document.querySelector('#lf-x').value) !== x0", arg=x0, timeout=SLOW)
    x1 = float(pg.input_value("#lf-x"))
    assert x1 > x0
    pg.locator("#p2lum [data-lum]").first.focus()
    pg.keyboard.press("Shift+ArrowRight")                            # 6 in = 0.5 ft
    pg.wait_for_function("(x1) => parseFloat(document.querySelector('#lf-x').value) > x1", arg=x1, timeout=SLOW)
    pg.fill("#lf-lm", "1200")
    pg.dispatch_event("#lf-lm", "input")
    stored = pg.evaluate("() => Object.entries(localStorage).filter(([k]) => k.startsWith('as:plan-light.')).map(([k, v]) => JSON.parse(v))")
    assert stored[0]["luminaires"][0]["lm"] == 1200 and stored[0]["luminaires"][0]["source"] == "assumed"
    pg.click("#p2lum [data-lum]")
    pg.keyboard.press("Delete")
    pg.wait_for_function("() => document.querySelectorAll('#p2lum [data-lum]').length === 0", timeout=SLOW)
    pg.click("#psUndo")
    pg.wait_for_function("() => document.querySelectorAll('#p2lum [data-lum]').length === 1", timeout=SLOW)
    assert not s.take()


def test_night_preview_lights_the_lamps_and_names_itself_a_preview(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s, "lamps")
    pg = s.page
    pg.click('[data-lx-add="pendant"]')
    pg.click('[data-lx-add="strip"]')
    pg.wait_for_function("() => document.querySelectorAll('#p2lum [data-lum]').length === 2", timeout=SLOW)
    assert "Visual preview" in pg.locator(".lx-night").inner_text()
    pg.click('[data-lx-night="night"]')
    pg.wait_for_function("() => /night/.test(document.querySelector('#phud').textContent) && /2 lamps on/.test(document.querySelector('#phud').textContent)", timeout=SLOW)
    pg.click('[data-lx-night="auto"]')
    pg.wait_for_function("() => !/night/.test(document.querySelector('#phud').textContent)", timeout=SLOW)
    assert not s.take()


def test_luminaires_and_inputs_survive_a_complete_project_export_and_import(open_page, webgl: bool) -> None:
    """The saved lighting object (daylight inputs with their source labels, luminaires) passes the project validator."""
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s, "lamps")
    pg = s.page
    pg.click('[data-lx-add="floor"]')
    pg.wait_for_selector("#p2lum [data-lum]", timeout=SLOW)
    pg.click('[data-lx-view="daylight"]')
    pg.evaluate("() => { document.querySelector('#lxInputs').open = true; }")
    pg.select_option("#srf-floor", "light")
    pg.select_option('select[data-lx="src"][data-k="floor"]', "source")
    res = pg.evaluate("""async () => {
      const m = await import('/js/plan/project.js');
      const light = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('as:plan-light.'))));
      const plan = await (await fetch('/data/plans/paramount-tower-25e.json')).json();
      const project = m.serialiseProject(plan, [], light);
      const back = m.parseProject(JSON.stringify(project));
      const bad = m.parseProject({ ...project, lighting: { ...project.lighting, luminaires: [{ type: 'laser', x: 1, y: 1 }] } });
      return { ok: back.ok, floor: back.project?.lighting.daylight.surfaces.floor, lum: back.project?.lighting.luminaires.length, badOk: bad.ok };
    }""")
    assert res["ok"] and res["lum"] == 1 and res["floor"]["preset"] == "light" and res["floor"]["source"] == "source" and not res["badOk"], res
    assert not s.take()


# ------------------------------------------------------------------------------------------------ annual summary
def test_year_view_shows_three_separate_quantities(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    _light(s, "year")
    pg = s.page
    pg.wait_for_selector("#lxResults svg.lx-annual", timeout=SLOW)
    label = pg.locator("#lxResults svg.lx-annual").get_attribute("aria-label")
    assert "direct sun" in label and "sky light" in label and "relative daylight" in label and "Modelled, not measured" in label
    text = pg.locator("#lxResults").inner_text()
    for words in ("Direct sun, hours a day", "Sky visibility", "Relative daylight", "never averaged"):
        assert words in text, words
    pg.click("#lxResults .lx-more summary")
    rows = pg.locator("#lxResults .lx-annual-table tbody tr")
    assert rows.count() == 5 and "Sun expected" in pg.locator("#lxResults .lx-annual-table").inner_text()
    chips = pg.locator("#lxResults [data-lx-win]")
    assert chips.count() >= 2
    chips.nth(1).click()
    pg.wait_for_function("() => document.querySelector('#lxResults h3').textContent.includes('window facing')", timeout=SLOW)
    assert not s.take()


# ------------------------------------------------------------------------------------------------ render quality
@pytest.mark.no_raster(False)   # reads what WebGL drew
def test_fast_is_the_default_visual_is_remembered_and_the_export_downloads(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page)
    pg = s.page
    assert pg.get_attribute('[data-rnq="fast"]', "aria-pressed") == "true"
    pg.click('[data-rnq="visual"]')
    pg.wait_for_selector(".rnq-note:not([hidden])", timeout=SLOW)
    assert "not extra evidence" in pg.locator(".rnq-note").inner_text()
    assert pg.evaluate("() => localStorage.getItem('as:render-quality')") == '"visual"'
    pg.evaluate(SETTLED_JS, 30000)
    pg.click("#psFileBtn")
    with pg.expect_download(timeout=300000) as dl:
        pg.click('[data-f="render2"]')
    d = dl.value
    assert d.suggested_filename.endswith(".png") and "px" in d.suggested_filename
    path = d.path()
    assert path and Path(path).stat().st_size > 20_000
    assert Path(path).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    pg.wait_for_function("() => document.querySelector('.rnq-prog').hidden", timeout=SLOW)
    pg.reload()
    pg.wait_for_selector("#psTabs", timeout=SLOW)
    assert pg.get_attribute('[data-rnq="visual"]', "aria-pressed") == "true"
    pg.click('[data-rnq="fast"]')
    assert pg.evaluate("() => localStorage.getItem('as:render-quality')") == '"fast"'
    assert not s.take()


def test_a_phone_starts_in_fast(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = _plan(open_page, width=390, height=844)
    assert s.page.get_attribute('[data-rnq="fast"]', "aria-pressed") == "true"
    assert s.page.get_attribute('[data-rnq="visual"]', "aria-pressed") == "false"
    assert not s.take()


# ------------------------------------------------------------------------------------------------ Unit 3D
@pytest.mark.no_raster(False)   # reads what WebGL drew
def test_unit_3d_annual_summary_quality_and_progressive_render(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page(f"#unit/{PLAN}", width=1000, height=700)   # a smaller stage: the 2x render is a real picture either way, and software GL draws half the pixels
    pg = s.page
    pg.wait_for_selector("#annualPanel summary", timeout=SLOW)
    pg.evaluate(SETTLED_JS, 60000)
    assert "modelled" in pg.locator("#annualPanel h3").inner_text()
    assert pg.locator("#annualPanel svg").count() == 0                # closed: nothing is computed
    pg.click("#annualPanel summary")
    pg.wait_for_selector("#annualPanel svg.lx-annual", timeout=SLOW)
    assert "never averaged" in pg.locator("#annualPanel").inner_text()
    assert pg.get_attribute('.rnq-inline [data-rnq="fast"]', "aria-pressed") == "true"
    pg.click('.rnq-inline [data-rnq="visual"]')
    pg.evaluate("() => window.__quality.setDevice({ maxTexture: 1024 })")   # shadow maps of 1024 px, as test_render does: software GL redraws a 4096 px map for each of the 16 frames
    pg.evaluate(SETTLED_JS, 30000)
    with pg.expect_download(timeout=300000) as dl:
        pg.click('[data-hires="2"]')
    d = dl.value
    assert d.suggested_filename.endswith("-2x.png")
    assert Path(d.path()).stat().st_size > 50_000
    assert not s.take()


# ------------------------------------------------------------------------------------------------ accessibility
@pytest.mark.parametrize("theme", ["dark", "light"])
def test_lighting_panels_pass_axe(open_page, webgl: bool, theme: str) -> None:
    _need_webgl(webgl)
    s = _plan(open_page, theme=theme)
    pg = s.page
    _light(s)
    pg.evaluate("() => { document.querySelector('#lxInputs').open = true; }")
    pg.check("#lxHeat2d")
    scope = ["#psTab", "#p2d"]
    found = {"daylight": _axe(pg, scope)}
    pg.click('[data-lx-view="lamps"]')
    pg.click('[data-lx-add="recessed"]')
    pg.wait_for_selector("#lxEditor .lx-edit", timeout=SLOW)
    found["lamps"] = _axe(pg, scope)
    pg.click('[data-lx-view="year"]')
    pg.wait_for_selector("#lxResults svg.lx-annual", timeout=SLOW)
    found["year"] = _axe(pg, scope)
    assert not any(found.values()), json.dumps(found, indent=1)
