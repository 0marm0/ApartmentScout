"""Two units side by side in live 3D, opened from Compare: the same date, time and camera mode in both panes, a shared time slider, and each
pane's own direct-sun readout; one pane with a toggle on a phone. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import pytest
from conftest import settled

pytestmark = pytest.mark.e2e

A, B = "paramount-tower-25e", "paramount-tower-9j"
SHOTS = "/private/tmp/claude-501/-Users-Omar-1-Developer-ApartmentScout/932198fc-4e74-474c-b7c4-6ec0ead28c53/scratchpad/agent-P"
READY = "() => window.__pair3d && window.__pair3d.sides.a && window.__pair3d.sides.b && window.__pair3d.sides.a.stage.scene && window.__pair3d.sides.b.stage.scene && document.getElementById('prLoad-a').hidden && document.getElementById('prLoad-b').hidden"


def _open(s, tail: str = "") -> None:
    s.page.goto(f"{s.origin}/#compare/{A},{B}")
    s.page.wait_for_selector("#cmpPair:not([hidden])")
    s.page.click("#cmpPair")
    s.page.wait_for_function(READY, timeout=150000)
    settled(s.page, 20000, ticks=6)


def test_compare_opens_two_units_in_one_live_view(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _open(s)
    assert pg.evaluate("() => location.hash").startswith(f"#pair/{A},{B}")
    assert pg.evaluate("() => window.__pair3d.ids") == [A, B]
    # both scenes are real: inside, from the main seat, each in its own apartment
    modes = pg.evaluate("() => [window.__pair3d.sides.a.stage.mode, window.__pair3d.sides.b.stage.mode]")
    assert modes == ["in", "in"]
    seats = pg.evaluate("() => [window.__pair3d.sides.a.seat?.kind, window.__pair3d.sides.b.seat?.kind]")
    assert all(seats), seats
    for k in "ab":
        assert pg.locator(f"#prRead-{k} .pr-hours").count() == 1
        assert pg.locator(f"#prRead-{k} .pr-strip i").count() >= 2
    # both panes drew
    drew = pg.evaluate("() => ['a', 'b'].map((k) => window.__pair3d.sides[k].stage.renderer.info.render.calls > 0)")
    assert drew == [True, True]
    pg.screenshot(path=f"{SHOTS}/pair-inside.png")
    assert not s.take()


def test_one_time_slider_and_date_drive_both_panes_and_each_has_its_own_sun_hours(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _open(s)
    pg.fill("#prDate", "2026-12-21")
    pg.dispatch_event("#prDate", "change")
    pg.wait_for_function("() => document.getElementById('prQuick') && window.__pair3d.st.date === '2026-12-21'")
    hours_dec = pg.evaluate("() => ['a', 'b'].map((k) => +document.querySelector(`#prRead-${k} .pr-hours`).dataset.hours)")
    pg.fill("#prDate", "2026-06-21")
    pg.dispatch_event("#prDate", "change")
    pg.wait_for_function("() => window.__pair3d.st.date === '2026-06-21'")
    hours_jun = pg.evaluate("() => ['a', 'b'].map((k) => +document.querySelector(`#prRead-${k} .pr-hours`).dataset.hours)")
    assert hours_dec != hours_jun, (hours_dec, hours_jun)
    # the slider moves the sun in both scenes to the same moment
    pg.evaluate("() => { const t = document.getElementById('prTime'); t.value = '600'; t.dispatchEvent(new Event('input', { bubbles: true })); }")
    pg.wait_for_function("() => window.__pair3d.st.min === 600")
    suns = pg.evaluate("() => ['a', 'b'].map((k) => window.__pair3d.sides[k].sun)")
    assert suns[0] and suns[1] and abs(suns[0]["alt"] - suns[1]["alt"]) < 0.5 and abs(suns[0]["az"] - suns[1]["az"]) < 0.5
    assert pg.inner_text("#prClock").startswith("10:00")
    # each pane reads its own state at that time
    for k in "ab":
        assert pg.locator(f"#prRead-{k} .pr-now").inner_text().strip() != ""
    assert not s.take()


def test_one_camera_mode_for_both(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _open(s)
    pg.click("#prModes [data-mode=win]")
    pg.wait_for_function("() => window.__pair3d.sides.a.stage.mode === 'win' && window.__pair3d.sides.b.stage.mode === 'win'")
    settled(pg, 20000, ticks=5)
    pg.screenshot(path=f"{SHOTS}/pair-window.png")
    pg.click("#prModes [data-mode=in]")
    pg.wait_for_function("() => window.__pair3d.sides.a.stage.mode === 'in' && window.__pair3d.sides.b.stage.mode === 'in'")
    # a drag looks around in that pane only
    before = pg.evaluate("() => [window.__pair3d.sides.a.stage.look.yaw, window.__pair3d.sides.b.stage.look.yaw]")
    box = pg.locator("#prGl-a").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 120, y, steps=6); pg.mouse.up()
    after = pg.evaluate("() => [window.__pair3d.sides.a.stage.look.yaw, window.__pair3d.sides.b.stage.look.yaw]")
    assert after[0] != before[0] and after[1] == before[1]
    assert not s.take()


def test_swapping_and_picking_other_units(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _open(s)
    pg.click("#prSwap")
    pg.wait_for_function("([a, b]) => window.__pair3d.ids[0] === b && window.__pair3d.ids[1] === a && window.__pair3d.sides.a?.id === b && window.__pair3d.sides.b?.id === a && document.getElementById('prLoad-a').hidden && document.getElementById('prLoad-b').hidden", arg=[A, B], timeout=150000)
    assert pg.evaluate("() => location.hash").startswith(f"#pair/{B},{A}")
    assert not s.take()


def test_on_a_phone_one_pane_at_a_time_with_a_toggle(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", width=390, height=844)
    pg = s.page
    pg.goto(f"{s.origin}/#pair/{A},{B}")
    pg.wait_for_function(READY, timeout=150000)
    settled(pg, 20000, ticks=5)
    assert pg.locator("#prSide-a").is_visible() and not pg.locator("#prSide-b").is_visible()
    assert pg.locator("#prWhich").is_visible()
    # no horizontal scroll
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    pg.click("#prWhich [data-w=b]")
    pg.wait_for_function("() => document.getElementById('prSide-b').offsetParent !== null && document.getElementById('prSide-a').offsetParent === null")
    settled(pg, 20000, ticks=4)
    pg.screenshot(path=f"{SHOTS}/pair-phone.png")
    assert not s.take()
