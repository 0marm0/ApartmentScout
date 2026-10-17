"""One render-quality control for both 3D pages, the automatic lighter mode and the phone layout, in a real browser.

* the Fast / Visual choice is ONE remembered setting: pick Visual in Unit 3D and the studio shows Visual (and the other way round);
* a lower level reaches the renderer (pixel ratio, shadow map, trees, facades, window glow) and shows the small "Lighter mode for this device"
  note, whose button pins full quality and survives a reload;
* slow frames reported by an engine's loop step the level down (the pure rules are tested in tests/js/quality.test.mjs);
* at 375 px the time slider and the camera buttons are in the lower part of the picture and nothing sits over its middle.

Needs WebGL, otherwise skipped.
"""
from __future__ import annotations

import pytest
from conftest import frames, settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels except where a test says so: see conftest.NO_RASTER_JS

UNIT = "paramount-tower-25e"
SLOW = 60000


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser")


def _unit(s, query: str = "?mode=inside") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{UNIT}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && document.getElementById('uLoad').hidden",
        arg=UNIT, timeout=120000)
    settled(s.page, 20000, ticks=5)


def _studio(s) -> None:
    s.page.goto(f"{s.origin}/#plan/{UNIT}")
    s.page.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('.rnq')", timeout=SLOW)
    settled(s.page, 20000, ticks=4)


def test_one_remembered_choice_in_both_pages(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s, "")
    assert pg.get_attribute('.rnq-inline [data-rnq="fast"]', "aria-pressed") == "true"
    pg.click('.rnq-inline [data-rnq="visual"]')
    assert pg.evaluate("() => window.__quality.mode") == "visual"
    # the studio (mounted later, in the same page) opens in the mode chosen in Unit 3D
    pg.evaluate("() => { location.hash = '#plan/%s'; }" % UNIT)
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('.rnq')", timeout=SLOW)
    assert pg.get_attribute('.rnq [data-rnq="visual"]', "aria-pressed") == "true"
    # and the other way round: Fast in the studio is Fast in Unit 3D, with one stored value
    pg.click('.rnq [data-rnq="fast"]')
    assert pg.evaluate("() => localStorage.getItem('as:render-quality')") == '"fast"'
    assert pg.get_attribute('.rnq-inline [data-rnq="fast"]', "aria-pressed") == "true"
    assert not s.take()


def test_a_lower_level_reaches_the_renderer_shows_the_note_and_force_visual_pins_it(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    _unit(s)
    pg.click('.rnq-inline [data-rnq="visual"]')
    pg.evaluate("() => window.__quality.setDevice({ dpr: 2 })")
    pg.wait_for_timeout(300)
    full = pg.evaluate("() => { const st = window.__unit3d.stage; return { shadow: st.sunL.shadow.mapSize.x, uQual: st.facU.uQual.value, glow: st.interior.glow.visible, trees: st.ctx ? st.ctx.treeStats().far + st.ctx.treeStats().near : 0 }; }")
    assert full["shadow"] >= 2048 and full["uQual"] == 1 and full["glow"] is True
    assert pg.locator(".rnq-auto:visible").count() == 0
    pg.evaluate("() => window.__quality.setLevel(4, 'auto')")
    pg.wait_for_selector(".rnq-auto:visible")
    assert "Lighter mode for this device" in pg.locator(".rnq-auto:visible").inner_text()
    low = pg.evaluate("() => { const st = window.__unit3d.stage, r = st.renderer; st.frame(true); return { shadow: st.sunL.shadow.mapSize.x, uQual: st.facU.uQual.value, glow: st.interior.glow.visible, pr: r.getPixelRatio(), trees: st.ctx ? st.ctx.treeStats().far + st.ctx.treeStats().near : 0 }; }")
    assert low["shadow"] <= 1024 and low["uQual"] == 0 and low["glow"] is False and low["pr"] <= 1.25
    if full["trees"]:
        assert low["trees"] < full["trees"] * 0.8, (full, low)
    # the studio, which is a separate renderer, follows the same level
    pg.evaluate("() => { location.hash = '#plan/%s'; }" % UNIT)
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('.rnq')", timeout=SLOW)
    assert pg.evaluate("() => window.__quality.level") == 4
    assert pg.evaluate("() => window.__quality.budget().plan.pixelRatio") <= 1.25
    # Force Visual: full quality again, pinned, remembered
    pg.wait_for_selector(".rnq-auto:visible")
    pg.click(".rnq-auto:visible button")
    assert pg.evaluate("() => [window.__quality.level, window.__quality.pinned, window.__quality.mode]") == [0, True, "visual"]
    assert pg.locator(".rnq-auto:visible").count() == 0
    assert pg.evaluate("() => localStorage.getItem('as:render-pinned')") == "true"
    pg.reload()
    pg.wait_for_function("() => window.__quality && window.__quality.pinned === true", timeout=SLOW)
    # slow frames no longer lower anything while pinned
    pg.wait_for_selector(".rnq")
    pg.evaluate("() => { let t = performance.now(); for (let i = 0; i < 60; i++) { t += 120; window.__quality.pulse('plan', t, true, 100); } }")
    assert pg.evaluate("() => window.__quality.level") == 0
    # choosing Fast turns the automatic mode back on
    pg.click('.rnq [data-rnq="fast"]')
    assert pg.evaluate("() => window.__quality.pinned") is False
    assert not s.take()


def test_slow_frames_from_the_engine_loop_step_the_level_down_and_the_renderer_follows(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    _unit(s)
    pg.click('.rnq-inline [data-rnq="visual"]')
    pg.evaluate("() => window.__quality.setDevice({ dpr: 2 })")
    res = pg.evaluate("""() => { const q = window.__quality, seen = []; q.onChange((s, ch) => { if (ch.level) seen.push(s.level); });
      q.opened('unit', 0); let t = 100; for (let i = 0; i < 40; i++) { t += 90; q.pulse('unit', t, true, 30); } return { level: q.level, seen }; }""")
    assert res["level"] >= 1 and res["seen"][0] == res["level"] or res["seen"], res
    pg.wait_for_selector(".rnq-auto:visible")
    assert pg.evaluate("() => window.__unit3d.stage.renderer.getPixelRatio()") <= 1.25 or pg.evaluate("() => window.__quality.settings.softShadows") is False
    # a quiet minute at 16 ms steps it back up, once the hold has passed
    up = pg.evaluate("""() => { const q = window.__quality; let t = 500000; for (let i = 0; i < 60; i++) { t += 16.7; q.pulse('unit', t, true, 4); } const before = q.level;
      t += 60000; for (let i = 0; i < 60; i++) { t += 16.7; q.pulse('unit', t, true, 4); } return [before, q.level]; }""")
    assert up[1] < up[0] or up[0] == 0, up
    assert not s.take()


def test_unit_3d_on_a_phone_has_the_time_and_the_cameras_within_thumb_reach_and_a_clear_picture(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=375, height=812)
    pg = s.page
    _unit(s)
    pg.evaluate("() => document.getElementById('stage').scrollIntoView({ block: 'start' })")
    frames(pg, 4)
    box = pg.evaluate("""() => {
      const st = document.getElementById('stage').getBoundingClientRect(), R = (e) => { const r = e.getBoundingClientRect(); return [r.left - st.left, r.top - st.top, r.right - st.left, r.bottom - st.top]; };
      const dock = document.querySelector('#stage .rnq-dock'), modes = document.getElementById('uModes');
      const over = [...document.querySelectorAll('#stage .float, #stage .hud, #stage .u-compass')].filter((e) => e.offsetParent && !e.hidden).map((e) => [e.className.toString().slice(0, 30), R(e)]);
      return { h: st.height, w: st.width, vh: innerHeight, stageTop: st.top, dock: R(dock), modes: R(modes), over, range: dock.querySelector('input').min + '..' + dock.querySelector('input').max };
    }""")
    assert box["h"] >= 480, box                                                   # the picture gets the screen
    assert box["dock"][1] > box["h"] * 0.8, box                                   # the time sits along the bottom edge
    assert 0 <= box["modes"][1] and box["modes"][3] < box["h"] * 0.4, box           # the camera buttons are inside the picture, in the top rows with the room switcher (css/views/unit.css)
    assert box["dock"][3] - box["dock"][1] >= 44 and box["modes"][3] - box["modes"][1] >= 36, box   # thumb-sized
    # nothing sits over the middle of the picture: the centre box (30-70 % across, 35-65 % down: the camera buttons and the room switcher take the top rows) is free of overlays
    cx0, cx1, cy0, cy1 = box["w"] * 0.3, box["w"] * 0.7, box["h"] * 0.35, box["h"] * 0.65
    for name, (l, t, r, b) in box["over"]:
        assert r <= cx0 or l >= cx1 or b <= cy0 or t >= cy1, f"{name} covers the middle of the picture: {box}"
    # the dock moves the time: drag the slider and the clock follows; Play starts the day
    before = pg.inner_text("#uClock")
    pg.evaluate("() => { const r = document.querySelector('#stage .rnq-dock-range'); r.value = String(+r.min + (+r.max - +r.min) * 0.2); r.dispatchEvent(new Event('input', { bubbles: true })); }")
    pg.wait_for_function("(b) => document.getElementById('uClock').textContent !== b", arg=before)
    pg.click("#stage .rnq-dock-play")
    pg.wait_for_function("() => window.__unit3d.st.playing === true")
    assert pg.get_attribute("#stage .rnq-dock-play", "aria-pressed") == "true"
    pg.click("#stage .rnq-dock-play")
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert not s.take()


def test_the_studio_on_a_phone_has_the_same_dock_and_a_clear_picture(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=375, height=812)
    pg = s.page
    _studio(s)
    pg.click('#psMode [data-m="3d"]')
    settled(pg, 20000, ticks=4)
    pg.evaluate("() => document.getElementById('pstage').scrollIntoView({ block: 'start' })")
    frames(pg, 4)
    box = pg.evaluate("""() => {
      const st = document.getElementById('pstage').getBoundingClientRect(), R = (e) => { const r = e.getBoundingClientRect(); return [r.left - st.left, r.top - st.top, r.right - st.left, r.bottom - st.top]; };
      const over = [...document.querySelectorAll('#pstage .float, #pstage .hud')].filter((e) => e.offsetParent && !e.hidden).map((e) => [e.className.toString().slice(0, 30), R(e)]);
      return { h: st.height, w: st.width, dock: R(document.querySelector('#pstage .rnq-dock')), cams: R(document.getElementById('psCams')), over };
    }""")
    assert box["h"] >= 480 and box["dock"][1] > box["h"] * 0.8 and box["cams"][1] > box["h"] * 0.7, box
    cx0, cx1, cy0, cy1 = box["w"] * 0.3, box["w"] * 0.7, box["h"] * 0.35, box["h"] * 0.65
    for name, (l, t, r, b) in box["over"]:
        assert r <= cx0 or l >= cx1 or b <= cy0 or t >= cy1, f"{name} covers the middle of the picture: {box}"
    pg.evaluate("() => { const r = document.querySelector('#pstage .rnq-dock-range'); r.value = '420'; r.dispatchEvent(new Event('input', { bubbles: true })); }")
    pg.wait_for_function("() => document.getElementById('pTimeV').textContent.includes('7:00')")
    assert pg.evaluate("() => document.getElementById('pTime').value") == "420"
    assert not s.take()
