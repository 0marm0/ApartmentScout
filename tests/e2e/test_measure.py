"""The measuring tape in a real browser: the Floor plan studio's 3D and 2D views and Unit 3D's Inside camera. A click is a click
(a drag still orbits), points snap to wall corners, window edges and furniture edges, the reading is in feet and inches at
the plan's real scale, several measurements stay until cleared, and Esc finishes. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import math

import pytest
from conftest import camera_still, frames, settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels except where a test says so: see conftest.NO_RASTER_JS

UNIT = "paramount-tower-25e"


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _studio(s, uid: str = UNIT) -> None:
    pg = s.page
    pg.goto(f"{s.origin}/#plan/{uid}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!window.__measure && !!document.getElementById('studioMeasureTool')", timeout=90000)
    pg.evaluate("() => localStorage.clear()")
    settled(pg, 20000, ticks=5)


def _unit(s, uid: str = UNIT, query: str = "?mode=inside") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{uid}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && document.getElementById('uLoad').hidden && !!window.__measure && !!window.__measure.unit",
        arg=uid, timeout=120000)
    settled(s.page, 20000, ticks=5)


def _click_plan_point(pg, surface: str, p) -> None:
    """Click where a plan point shows on screen. Positions are read right before the click, so a scroll in between cannot matter."""
    pg.wait_for_timeout(100)
    xy = pg.evaluate("([s, p]) => window.__measure[s].clientOf(p)", [surface, p])
    assert xy, f"{p} is not on screen"
    pg.mouse.move(xy[0], xy[1])
    pg.wait_for_timeout(120)
    pg.mouse.click(xy[0], xy[1])
    pg.wait_for_timeout(200)


def _dist(a, b) -> float:
    return math.dist(a, b)


# --------------------------------------------------------------------------- the studio's 3D view

def test_the_3d_tape_reads_a_pieces_real_size_and_snaps_to_its_corners(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    pg.click("#pstage [data-bed-choice='mine']")   # the studio opens on the Latitude Run storage bed; the renter's own queen bed waits hidden
    pg.wait_for_function("() => window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed' && g.visible)")
    pg.click("#psCams [data-v=top]")
    camera_still(pg, "studio")
    before = pg.evaluate("() => window.__plan3d.items.map(({id, x, y, rot}) => [id, x, y, rot])")
    pg.click("#studioMeasureTool")
    assert pg.get_attribute("#studioMeasureTool", "aria-pressed") == "true"
    # the queen bed is 64 in wide: two of its top corners across the width
    corners = pg.evaluate("""() => { const b = window.__plan3d.items.find((i) => i.id === 'bed');
      return window.__measure.studioTargets.points.filter((q) => q.kind === 'furniture' && Math.abs(q.p[2] - 40) < 1 && Math.abs(q.p[0] - b.x) < 50 && Math.abs(q.p[1] - b.y) < 50).map((q) => q.p); }""")
    assert len(corners) == 4
    a = corners[0]
    b = next(c for c in corners[1:] if abs(_dist(a, c) - 64) < 0.01)
    _click_plan_point(pg, "studio3d", a)
    assert pg.evaluate("() => window.__measure.studioStore.pending !== null")
    _click_plan_point(pg, "studio3d", b)
    lst = pg.evaluate("() => window.__measure.studioList")
    assert len(lst) == 1 and abs(lst[0]["inches"] - 64) < 0.05 and lst[0]["text"] == "5' 4\"", lst
    assert lst[0]["kind"] == "floor"
    # the chip over the view reads the same
    pg.wait_for_function("() => document.querySelector('#pstage .ms-chip.done b')?.textContent === \"5' 4\\\"\"")
    # a click placed points: nothing moved, nothing was selected
    assert pg.evaluate("() => window.__plan3d.items.map(({id, x, y, rot}) => [id, x, y, rot])") == before
    assert pg.inner_text("#studioMeasureClear") == "×1"
    # Esc finishes the tape but keeps what was measured
    pg.keyboard.press("Escape")
    assert pg.get_attribute("#studioMeasureTool", "aria-pressed") == "false"
    assert pg.evaluate("() => window.__measure.studioList.length") == 1
    assert pg.locator("#pstage .ms-chip.done").count() == 1
    # ... and Clear removes it
    pg.click("#studioMeasureClear")
    assert pg.evaluate("() => window.__measure.studioList.length") == 0
    pg.wait_for_function("() => document.querySelectorAll('#pstage .ms-chip').length === 0")
    assert not s.take()


def test_a_drag_still_orbits_and_does_not_place_a_point(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    pg.click("#studioMeasureTool")
    box = pg.locator("#pgl").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.45
    cam0 = pg.evaluate("() => window.__plan3d.cam.position.toArray()")
    pg.mouse.move(cx, cy)
    pg.mouse.down()
    pg.mouse.move(cx + 90, cy + 10, steps=6)
    pg.mouse.up()
    pg.wait_for_timeout(200)
    assert pg.evaluate("() => window.__measure.studioStore.pending") is None
    assert pg.evaluate("() => window.__measure.studioList.length") == 0
    assert pg.evaluate("() => window.__plan3d.cam.position.toArray()") != cam0
    assert not s.take()


def test_a_click_on_a_piece_with_the_tape_out_measures_and_does_not_drag_it(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    pg.click("#psCams [data-v=top]")
    camera_still(pg, "studio")
    pg.click("#studioMeasureTool")
    before = pg.evaluate("() => window.__plan3d.items.find((i) => i.id === 'bed')")
    xy = pg.evaluate("(b) => window.__measure.studio3d.clientOf([b.x, b.y, b.h])", before)
    pg.mouse.move(xy[0], xy[1])
    pg.mouse.down()
    pg.mouse.move(xy[0] + 40, xy[1] + 30, steps=5)
    pg.mouse.up()
    after = pg.evaluate("() => window.__plan3d.items.find((i) => i.id === 'bed')")
    assert (after["x"], after["y"]) == (before["x"], before["y"])
    assert not s.take()


# --------------------------------------------------------------------------- the studio's 2D drawing

def test_the_2d_tape_snaps_to_wall_corners_and_shares_its_list_with_the_3d_view(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    pg.click("#studioMeasure2dTool")
    # two inner corners of one wall: the clear width of the room, wall face to wall face; then the same across another wall
    pts = pg.evaluate("() => window.__measure.studioTargets.points.filter((q) => q.kind === 'corner' && q.p[2] === 0).map((q) => q.p)")
    pair = next(((p, q) for p in pts for q in pts if p is not q and abs(p[1] - q[1]) < 0.01 and 60 < q[0] - p[0] < 260), None)
    other = next(((p, q) for p in pts for q in pts if p is not q and abs(p[0] - q[0]) < 0.01 and 60 < q[1] - p[1] < 260 and p != pair[0]), None)
    assert pair and other, "walls with two inner corners each"
    _click_plan_point(pg, "studio2d", pair[0])
    _click_plan_point(pg, "studio2d", pair[1])
    _click_plan_point(pg, "studio2d", other[0])
    _click_plan_point(pg, "studio2d", other[1])
    lst = pg.evaluate("() => window.__measure.studioList")
    want = [pair[1][0] - pair[0][0], other[1][1] - other[0][1]]
    assert len(lst) == 2 and all(abs(m["inches"] - w) < 0.1 for m, w in zip(lst, want)), (lst, want)
    assert pg.inner_text("#studioMeasure2dClear") == "Clear 2"
    # the chips are drawn on the plan
    assert [pg.locator("#p2d .ms2-chip.done > text").nth(i).text_content() for i in range(2)] == [m["text"] for m in lst]
    # the same measurements are in the 3D view
    pg.wait_for_function("() => document.querySelectorAll('#pstage .ms-chip.done').length === 2")
    pg.keyboard.press("Escape")
    assert pg.get_attribute("#studioMeasure2dTool", "aria-pressed") == "false"
    assert pg.locator("#p2d .ms2-chip.done").count() == 2
    # remove one from the drawing, and the 3D view loses it too
    pg.locator("#p2d .ms2-del").first.dispatch_event("click")
    assert pg.evaluate("() => window.__measure.studioList.length") == 1
    pg.wait_for_function("() => document.querySelectorAll('#pstage .ms-chip.done').length === 1")
    assert not s.take()


def test_measurements_survive_a_reload(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    pg.click("#studioMeasure2dTool")
    pts = pg.evaluate("() => window.__measure.studioTargets.points.filter((q) => q.kind === 'corner' && q.p[2] === 0).map((q) => q.p)")
    _click_plan_point(pg, "studio2d", pts[0])
    _click_plan_point(pg, "studio2d", pts[1])
    assert pg.evaluate("() => window.__measure.studioList.length") == 1
    pg.reload()
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!window.__measure", timeout=90000)
    pg.wait_for_function("() => window.__measure.studioList.length === 1")
    assert not s.take()


# --------------------------------------------------------------------------- Unit 3D, Inside

def test_the_inside_tape_measures_the_window_and_leaves_with_the_camera(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", height=1300)
    pg = s.page
    _unit(s)
    pg.evaluate("() => document.getElementById('stage').scrollIntoView({block: 'center'})")
    frames(pg, 4)
    assert pg.locator("#unitMeasureTool").is_visible()
    pg.click("#unitMeasureTool")
    assert pg.get_attribute("#unitMeasureTool", "aria-pressed") == "true"
    # two upper corners of the bay window in view
    box = pg.evaluate("() => { const r = document.getElementById('gl').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
    heads = pg.evaluate("() => window.__measure.unitTargets.points.filter((q) => q.kind === 'window' && q.p[2] > 80).map((q) => q.p)")
    shown = []
    for p in heads:
        xy = pg.evaluate("(p) => window.__measure.unit.clientOf(p)", p)
        if xy and box[0] + 30 < xy[0] < box[2] - 70 and box[1] + 120 < xy[1] < box[3] - 120:
            shown.append(p)
    assert len(shown) >= 2, shown
    a, b = shown[0], shown[1]
    _click_plan_point(pg, "unit", a)
    _click_plan_point(pg, "unit", b)
    lst = pg.evaluate("() => window.__measure.unitList")
    assert len(lst) == 1 and abs(lst[0]["inches"] - _dist(a, b)) < 0.1, (lst, _dist(a, b))
    pg.wait_for_function("() => document.querySelector('#stage .ms-chip.done b')?.textContent.length > 1")
    # Esc finishes it; the measurement stays and is shared with the studio for the same plan
    pg.keyboard.press("Escape")
    assert pg.get_attribute("#unitMeasureTool", "aria-pressed") == "false"
    assert pg.evaluate("() => window.__measure.unitList.length") == 1
    # leaving the Inside camera hides the tool and the chips (the apartment is not on screen)
    pg.click("#uModes [data-mode=orbit]")
    pg.wait_for_function("() => document.getElementById('unitMeasureTool').hidden")
    assert pg.locator("#stage .ms-chip").count() == 0
    pg.click("#uModes [data-mode=in]")
    pg.wait_for_function("() => !document.getElementById('unitMeasureTool').hidden")
    pg.wait_for_function("() => document.querySelectorAll('#stage .ms-chip.done').length === 1")
    pg.click("#unitMeasureClear")
    assert pg.evaluate("() => window.__measure.unitList.length") == 0
    assert not s.take()
