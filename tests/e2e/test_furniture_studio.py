"""The renter's own furniture in both 3D views, and the studio's controls for moving it: every piece drawn with its colour and material
(a black leather futon, a brown wood desk, black chest and nightstands, a grey bed), the TVs on their walls, the two views agreeing on where
everything is, a seat that looks at the TV, and a floating toolbar to select, rotate, move and remove a piece in the plan and the 3D view.
Needs WebGL, otherwise skipped."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import look_click, look_open

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"
ROOT = Path(__file__).resolve().parents[2]
INV = json.loads((ROOT / "examples" / "nyc-2026" / "furniture.json").read_text())
IDS = [p["id"] for p in INV["pieces"]]

# what each placed piece is made of, as the studio's 3D scene holds it: the group's meshes, their materials and the piece's box in metres
# what each placed piece is made of: its meshes, their materials and its box in the piece's own frame (metres, origin on the floor
# under its centre), taken from the studio's scene or from Unit 3D's interior group
BOXES = """const local = (g, THREE) => { const box = new THREE.Box3(), inv = g.matrixWorld.clone().invert(), mats = []; let meshes = 0; g.updateWorldMatrix(true, true);
  g.traverse((o) => { if (!o.isMesh || o.name === 'decal' || o.name === 'outline') return; meshes++; o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld))); const m = o.material; mats.push({ color: m.color.getHexString(), bump: !!m.bumpMap, map: !!m.map }); });
  return { visible: g.visible, meshes, min: box.min.toArray(), max: box.max.toArray(), mats }; };"""
SCENE_JS = "async () => { " + BOXES + """
  const G3 = await import('/js/plan/scene3d.js'), THREE = await import('three'), out = {};
  for (const g of G3.parts().furn.children) out[g.userData.itemId] = local(g, THREE);
  return out; }"""
UNIT_JS = "async () => { " + BOXES + """
  const THREE = await import('three'), out = {};
  for (const g of window.__unit3d.stage.interior.furniture.group.children) out[g.userData.itemId] = local(g, THREE);
  return out; }"""


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _studio(s) -> None:
    pg = s.page
    pg.goto(f"{s.origin}/#plan/{UNIT}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
    pg.wait_for_timeout(800)


def _unit(s, query: str = "?mode=inside") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{UNIT}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && document.getElementById('uLoad').hidden",
        arg=UNIT, timeout=120000)
    s.page.wait_for_timeout(800)


def _rgb(hexs: str) -> tuple[float, float, float]:
    return tuple(int(hexs[i:i + 2], 16) / 255 for i in (0, 2, 4))  # linear-ish is fine: we compare channels and darkness


def _lum(hexs: str) -> float:
    r, g, b = _rgb(hexs)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _check_looks(scene: dict) -> None:
    """The renter's answers, as drawn: black leather futon, brown wood desk and tables, black chest and nightstands, a grey bed, black TVs."""
    for pid in IDS:
        assert scene[pid]["visible"] and scene[pid]["meshes"] > 3, f"{pid} is drawn"
    futon = scene["futon"]["mats"]
    leather = [m for m in futon if m["bump"]]          # the leather carries a pebbled grain
    assert leather and all(_lum(m["color"]) < 0.14 for m in leather), "the futon's mattress is black leather"
    assert all(_lum(m["color"]) < 0.2 for m in futon), "no green fabric and no pale wooden frame: every part of the futon is dark"
    assert not any(m["map"] and not m["bump"] and _rgb(m["color"])[0] > _rgb(m["color"])[2] * 1.15 for m in futon), "no wooden arms on the futon"
    for pid in ("desk", "coffee", "dining"):
        wood = [m for m in scene[pid]["mats"] if m["map"]]   # wood is drawn with a grain texture
        assert wood and any(_rgb(m["color"])[0] > _rgb(m["color"])[2] * 1.4 and 0.05 < _lum(m["color"]) < 0.45 for m in wood), f"the {pid} is brown wood"
    for pid in ("dresser", "nightstand-1", "nightstand-2"):
        body = scene[pid]["mats"][0]   # the first material is the carcase
        assert _lum(body["color"]) < 0.14, f"the {pid} is black"
    assert any(0.3 < _lum(m["color"]) < 0.65 and abs(_rgb(m["color"])[0] - _rgb(m["color"])[2]) < 0.1 for m in scene["bed"]["mats"]), "the bed is upholstered in grey"
    for tv in ("tv", "tv-bed"):
        lo, hi = scene[tv]["min"], scene[tv]["max"]
        depth, bottom = hi[2] - lo[2], lo[1]
        assert depth < 0.1, f"{tv} is a thin panel ({depth:.3f} m deep)"
        assert abs(bottom - 32 * 0.0254) < 0.05, f"{tv} hangs 32 in off the floor"


def test_the_studio_draws_every_piece_in_the_renters_colours_and_the_tvs_on_their_walls(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    _studio(s)
    scene = s.page.evaluate(SCENE_JS)
    assert sorted(scene) == sorted(IDS), "every piece of furniture.json is placed and drawn"
    _check_looks(scene)
    items = s.page.evaluate("() => window.__plan3d.items.map(({id, ref, x, y, rot, w, d, h, elev}) => ({id, ref, x, y, rot, w, d, h, elev}))")
    by = {i["id"]: i for i in items}
    tv, futon, tvb, bed = by["tv"], by["futon"], by["tv-bed"], by["bed"]
    assert tv["elev"] == 32 and tvb["elev"] == 32
    # each TV faces the seating it serves: the living-room one the futon, the bedroom one the bed
    assert tv["x"] < futon["x"] - 40 and tvb["x"] < bed["x"] - 40
    assert not s.take()


def test_unit_3d_draws_the_same_pieces_in_the_same_places(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    _unit(s)
    scene = s.page.evaluate(UNIT_JS)
    assert sorted(scene) == sorted(IDS), "every piece is drawn in Unit 3D's Inside view too"
    _check_looks(scene)
    unit_items = s.page.evaluate("() => window.__unit3d.planInfo.layout.items.map(({id, ref, x, y, rot, w, d, h, elev, look}) => ({id, ref, x, y, rot, w, d, h, elev, look: !!look}))")
    assert all(i["look"] for i in unit_items), "each item carries the look joined from furniture.json"
    s.page.goto(f"{s.origin}/#plan/{UNIT}")
    s.page.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0", timeout=90000)
    studio = s.page.evaluate("() => window.__plan3d.items.map(({id, ref, x, y, rot, w, d, h, elev}) => ({id, ref, x, y, rot, w, d, h, elev}))")
    strip = lambda rows: sorted(({k: v for k, v in r.items() if k != "look"} for r in rows), key=lambda r: r["id"])
    assert strip(unit_items) == strip(studio), "the two views place every piece identically"
    assert not s.take()


def test_a_colour_edited_in_furniture_json_needs_no_code(open_page, webgl: bool) -> None:
    """The maintainer can fill in a renter's answer later: change the desk's look in furniture.json and the 3D desk follows."""
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    inv = json.loads((ROOT / "dashboard" / "data" / "furniture.json").read_text())
    desk = next(p for p in inv["pieces"] if p["id"] == "desk")
    desk["look"] = {"color": "#2e6f4f", "material": "metal", "finish": "gloss", "basis": "renter"}
    pg.route("**/data/furniture.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(inv)))
    _studio(s)
    mats = pg.evaluate(SCENE_JS)["desk"]["mats"]
    assert any(_rgb(m["color"])[1] > _rgb(m["color"])[0] * 1.3 and _rgb(m["color"])[1] > _rgb(m["color"])[2] for m in mats), "the desk is green now"
    row = pg.evaluate("() => [...document.querySelectorAll('#psTab .iv-row')].find((r) => /Desk/.test(r.textContent)).querySelector('.iv-look').textContent")
    assert "metal" in row and "assumed" not in row, "the furniture list says what it is made of and that it comes from the renter"
    assert not s.take()


# --------------------------------------------------------------------------- seats look at the TV


def test_from_the_sofa_you_see_the_tv_and_from_the_desk_your_monitor(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1256)
    _unit(s, "?date=2026-10-15&min=690&mode=in")
    pg = s.page
    chips = pg.evaluate("() => [...document.querySelectorAll('#uLook .lk-chip')].map((b) => b.textContent.trim())")
    assert chips[:7] == ["Living room", "Bay", "Bedroom", "Corner", "Sofa", "Sofa, window", "Bed"] and "Desk" in chips
    in_view = """async (id) => { const U = window.__unit3d, THREE = await import('three'), cam = U.cam; cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const g = U.stage.interior.furniture.group.children.find((c) => c.userData.itemId === id); return f.intersectsBox(new THREE.Box3().setFromObject(g)); }"""
    for chip, view, target in (("Sofa", "seat:sofa", "tv"), ("Bed", "seat:bed", "tv-bed"), ("Desk", "seat:desk", "desk")):
        look_click(pg, f"#uLook .lk-chip:text-is('{chip}')")
        pg.wait_for_function("(k) => window.__unit3d.curView && window.__unit3d.curView.key === k", arg=view)
        pg.wait_for_timeout(2500)
        assert pg.evaluate(in_view, target), f"{chip}: the {target} is in front of you"
    # the window view stays one click away
    look_click(pg, "#uLook .lk-chip:text-is('Sofa, window')")
    pg.wait_for_function("() => window.__unit3d.curView.key === 'seat:sofa-window'")
    assert not s.take()


# --------------------------------------------------------------------------- the toolbar beside a selected piece


def _item(pg, pid: str) -> dict:
    return pg.evaluate("(id) => { const i = window.__plan3d.items.find((q) => q.id === id); return { x: i.x, y: i.y, rot: i.rot || 0 }; }", pid)


def test_selecting_a_piece_shows_one_toolbar_in_the_plan_and_one_in_3d(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _studio(s)
    assert pg.locator(".selbar:visible").count() == 0, "nothing is selected, no toolbar"
    pg.click("#psTab [data-sel=desk]")
    pg.wait_for_function("() => document.querySelectorAll('.selbar:not([hidden])').length === 2")
    for host in ("#p2dWrap", "#pstage"):
        bar = pg.locator(f"{host} .selbar")
        assert [b.get_attribute("data-act") for b in bar.locator(".sb-b").all()] == ["rot", "free", "move", "del", "done"]
        assert "Desk, chair and monitor" in bar.locator(".sb-name").text_content()
        box, pane = bar.bounding_box(), pg.locator(host).bounding_box()
        assert pane["x"] <= box["x"] and box["x"] + box["width"] <= pane["x"] + pane["width"] + 1, f"{host}: the toolbar stays inside its pane"
        assert all(b.bounding_box()["height"] >= 40 for b in bar.locator(".sb-b").all()), "tap targets are at least 40 px"
    # the 2D plan marks the selected piece
    assert pg.evaluate("() => document.querySelector('#p2d .p2-it.sel')?.dataset.id") == "desk"
    # Escape deselects and takes the toolbars away
    pg.evaluate("() => document.activeElement.blur()")
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => document.querySelectorAll('.selbar:not([hidden])').length === 0")
    assert not s.take()


def test_rotate_move_and_remove_from_the_toolbar_and_the_keyboard(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _studio(s)
    pg.click("#psTab [data-sel=coffee]")
    pg.wait_for_function("() => document.querySelectorAll('.selbar:not([hidden])').length === 2")
    start = _item(pg, "coffee")
    bar = pg.locator("#p2dWrap .selbar")
    # rotate 90 degrees: the button, then the R key
    bar.locator("[data-act=rot]").click()
    pg.wait_for_function("([id, r]) => (window.__plan3d.items.find((q) => q.id === id).rot || 0) === r", arg=["coffee", (start["rot"] + 90) % 360])
    pg.keyboard.press("r")
    pg.wait_for_function("([id, r]) => (window.__plan3d.items.find((q) => q.id === id).rot || 0) === r", arg=["coffee", (start["rot"] + 180) % 360])
    # rotate freely: the dial turns it to any angle in one undo step, a square angle snaps from the buttons
    bar.locator("[data-act=free]").click()
    bar.locator("[data-sb=angle]").fill("37")
    pg.wait_for_function("() => Math.round(window.__plan3d.items.find((q) => q.id === 'coffee').rot) === 37")
    assert bar.locator("[data-sb=deg]").text_content() == "37°"
    bar.locator("[data-snap='270']").click()
    pg.wait_for_function("() => window.__plan3d.items.find((q) => q.id === 'coffee').rot === 270")
    pg.evaluate("() => document.activeElement.blur()")
    pg.keyboard.press("Control+z")                                  # the snap button
    pg.wait_for_function("() => Math.round(window.__plan3d.items.find((q) => q.id === 'coffee').rot) === 37")
    # move: the arrow pad nudges by the chosen step, in either pane's toolbar
    before = _item(pg, "coffee")
    bar.locator("[data-act=move]").click()
    bar.locator("[data-step='12']").click()
    bar.locator("[data-nx='1'][data-ny='0']").click()
    pg.wait_for_function("([id, x]) => window.__plan3d.items.find((q) => q.id === id).x === x", arg=["coffee", before["x"] + 12])
    pg.locator("#pstage .selbar [data-act=move]").click()
    pg.locator("#pstage .selbar [data-step='1']").click()
    pg.locator("#pstage .selbar [data-nx='0'][data-ny='1']").click()
    pg.wait_for_function("([id, y]) => window.__plan3d.items.find((q) => q.id === id).y === y", arg=["coffee", before["y"] + 1])
    # drag the piece in the plan: it follows the pointer and the toolbar follows it
    pg.evaluate("() => document.activeElement.blur()")
    box = pg.locator("#p2d [data-id=coffee]").bounding_box()
    x0, y0 = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    p0, t0 = _item(pg, "coffee"), bar.bounding_box()
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move(x0 + 30, y0 + 20, steps=6)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    p1, t1 = _item(pg, "coffee"), bar.bounding_box()
    assert p1["x"] != p0["x"] or p1["y"] != p0["y"], "the piece moved"
    assert abs(t1["x"] - t0["x"]) > 5 or abs(t1["y"] - t0["y"]) > 5, "the toolbar followed the piece"
    assert pg.evaluate("() => document.querySelector('#p2d .p2-it.sel')?.dataset.id") == "coffee", "still selected after the drag"
    # remove: the button takes it out, Undo brings it back, Delete does it from the keyboard
    n = pg.evaluate("() => window.__plan3d.items.length")
    bar.locator("[data-act=del]").click()
    pg.wait_for_function("(n) => window.__plan3d.items.length === n - 1", arg=n)
    pg.wait_for_function("() => document.querySelectorAll('.selbar:not([hidden])').length === 0")
    pg.keyboard.press("Control+z")
    pg.wait_for_function("(n) => window.__plan3d.items.length === n", arg=n)
    pg.click("#psTab [data-sel=coffee]")
    pg.evaluate("() => document.activeElement.blur()")
    pg.keyboard.press("Delete")
    pg.wait_for_function("(n) => window.__plan3d.items.length === n - 1", arg=n)
    assert not s.take()


def test_the_toolbar_works_by_touch(browser, base_url: str, webgl: bool) -> None:
    _need_webgl(webgl)
    ctx = browser.new_context(viewport={"width": 820, "height": 1100}, has_touch=True, is_mobile=False, service_workers="block")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
    pg = ctx.new_page()
    try:
        pg.goto(f"{base_url}/#plan/{UNIT}")
        pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
        pg.wait_for_timeout(800)
        pg.tap("#psTab [data-sel=nightstand-1]")
        pg.wait_for_function("() => document.querySelectorAll('.selbar:not([hidden])').length >= 1")
        bar = pg.locator(".selbar:visible").first
        before = _item(pg, "nightstand-1")
        bar.locator("[data-act=rot]").tap()
        pg.wait_for_function("([r]) => (window.__plan3d.items.find((q) => q.id === 'nightstand-1').rot || 0) === r", arg=[(before["rot"] + 90) % 360])
        bar.locator("[data-act=move]").tap()
        bar.locator("[data-nx='-1'][data-ny='0']").tap()
        pg.wait_for_function("([x]) => window.__plan3d.items.find((q) => q.id === 'nightstand-1').x === x", arg=[before["x"] - 6])
        bar.locator("[data-act=done]").tap()
        pg.wait_for_function("() => document.querySelectorAll('.selbar:not([hidden])').length === 0")
    finally:
        ctx.close()
