"""Where the renter's furniture stands, and walking around inside it, in a real browser.

* The Floor plan studio and Unit 3D's Inside view place every piece identically, after a reload and after visiting the other view.
* A piece the renter drags stays exactly there across reloads and in both views; nothing automatic moves it (an older saved layout keeps
  what the renter moved and takes the new default for what they never touched).
* Click the floor to walk there (a smooth glide, with a ring where the click will take you), drag to look around, W S / arrow keys walk
  and stop at walls and furniture, one click to stand at the nearest window, and a double-click on a window does the same; by touch, tap to walk.
Needs WebGL, otherwise skipped."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import look_click

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels: see conftest.NO_RASTER_JS

UNIT = "paramount-tower-25e"
ROOT = Path(__file__).resolve().parents[2]
PLAN = json.loads((ROOT / "examples" / "nyc-2026" / "plans" / f"{UNIT}.json").read_text())
DEFAULT = {i["id"]: i for i in PLAN["layouts"][0]["items"]}
KEY = f"as:plan.data.{UNIT}"
M = 0.0254


def _r1(v: float) -> float:
    """Round to a tenth the way the page does (half up: 152.25 is 152.3; Python's round() would say 152.2)."""
    return int(v * 10 + 0.5) / 10

STUDIO_ITEMS = "() => window.__plan3d.items.map(({id, ref, x, y, rot, w, d, h, elev}) => ({id, ref, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: Math.round(rot || 0), w, d, h, elev})).sort((a, b) => a.id.localeCompare(b.id))"
UNIT_ITEMS = "() => window.__unit3d.planInfo.layout.items.map(({id, ref, x, y, rot, w, d, h, elev}) => ({id, ref, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: Math.round(rot || 0), w, d, h, elev})).sort((a, b) => a.id.localeCompare(b.id))"
# where the unit's drawn furniture really is, back in plan inches (so a mesh that disagrees with its item is caught)
UNIT_MESHES = """() => { const U = window.__unit3d, fr = U.stage.interior.frame, out = {};
  for (const g of U.stage.interior.furniture.group.children) out[g.userData.itemId] = [Math.round((g.position.x / 0.0254 + fr.xc) * 10) / 10, Math.round((-g.position.z / 0.0254 + fr.yw) * 10) / 10];
  return out; }"""
STAGE_STATE = """() => { const U = window.__unit3d, st = U.stage, fr = st.interior.frame, e = st.inEye;
  return { x: e.local.x / 0.0254 + fr.xc, y: -e.local.z / 0.0254 + fr.yw, h: e.local.y / 0.0254, head: ((e.off + st.look.yaw) % 360 + 360) % 360, walking: U.walk.walking() }; }"""
PROJECT_UNIT = """async (a) => { const THREE = await import('three'), U = window.__unit3d, st = U.stage, fr = st.interior.frame, g = st.interior.group;
  const v = new THREE.Vector3((a.x - fr.xc) * 0.0254, a.h * 0.0254, -(a.y - fr.yw) * 0.0254); g.localToWorld(v); v.project(st.activeCam());
  const r = st.cv.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }"""


def _floor_spot(pg, candidates=((80, 240), (60, 260), (100, 262), (60, 215), (120, 215), (50, 290), (110, 300))) -> tuple[dict, dict]:
    """A standable floor point whose place on the screen is the canvas itself (not under a panel): the plan point and its screen point."""
    for x, y in candidates:
        sp = pg.evaluate(PROJECT_UNIT, {"x": x, "y": y, "h": 0})
        hit = pg.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.id; }", [sp["x"], sp["y"]])
        if hit == "gl" and pg.evaluate("([x, y]) => window.__unit3d.walk.space.canStand(x, y)", [x, y]):
            return {"x": x, "y": y}, sp
    raise AssertionError("no floor point is visible on the canvas")


def _only(items: dict, ids) -> dict:
    """The pieces of `ids`: a layout saved before the storage bed, the chair, the sim rig and the paintings existed has them filled in by the next view that loads it."""
    return {k: v for k, v in items.items() if k in ids}


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _studio(s) -> None:
    s.page.goto(f"{s.origin}/#plan/{UNIT}")
    s.page.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
    s.page.wait_for_timeout(600)


def _unit(s, query: str = "?mode=inside") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{UNIT}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && window.__unit3d.walk && document.getElementById('uLoad').hidden",
        arg=UNIT, timeout=120000)
    s.page.wait_for_timeout(600)


def _reload(s) -> None:
    s.page.reload()
    s.page.wait_for_timeout(300)


def _stored(pg) -> dict | None:
    raw = pg.evaluate("(k) => localStorage.getItem(k)", KEY)
    return json.loads(raw) if raw else None


def _drag_in_plan(pg, pid: str, dx: float, dy: float) -> None:
    box = pg.locator(f"#p2d [data-id={pid}]").bounding_box()
    x0, y0 = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    hit = pg.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.closest('[data-id]')?.dataset.id || e.tagName); }", [x0, y0])
    assert hit == pid, f"the drag starts on {pid}, not on {hit}"
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move(x0 + dx, y0 + dy, steps=8)
    pg.mouse.up()
    pg.wait_for_timeout(400)


# ----------------------------------------------------------------------------------------------- one placement, in both views


def test_both_views_place_every_piece_identically_and_nothing_moves_on_a_reload_or_a_visit_to_the_other_view(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    _studio(s)
    studio = s.page.evaluate(STUDIO_ITEMS)
    assert [i["id"] for i in studio] == sorted(DEFAULT), "all sixteen pieces, hidden ones included"
    # the default is the data in the plan file: placed where it says, nothing computed in the browser
    for i in studio:
        d = DEFAULT[i["id"]]
        assert (i["x"], i["y"], i["rot"]) == (_r1(d["x"]), _r1(d["y"]), round(d.get("rot", 0))), i["id"]
    assert _stored(s.page) is None, "looking does not write a layout"
    _unit(s)
    unit = s.page.evaluate(UNIT_ITEMS)
    assert unit == studio, "the two views place every piece identically, at the same size"
    meshes = s.page.evaluate(UNIT_MESHES)
    hidden = {k for k, v in DEFAULT.items() if v.get("hidden")}   # the grey bed and its nightstands (the storage bed is the default) and the sim rig
    assert hidden and not hidden & set(meshes), "a hidden piece is in the layout but not drawn until they show it"
    for i in unit:
        if i["id"] not in hidden:
            assert meshes[i["id"]] == [i["x"], i["y"]], f"{i['id']} is drawn where its item is"
    # a reload of either view changes nothing, and neither does going back and forth
    _reload(s)
    s.page.wait_for_function("() => window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.walk", timeout=120000)
    assert s.page.evaluate(UNIT_ITEMS) == studio
    _studio(s)
    assert s.page.evaluate(STUDIO_ITEMS) == studio
    _reload(s)
    s.page.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0", timeout=90000)
    assert s.page.evaluate(STUDIO_ITEMS) == studio
    _unit(s)
    assert s.page.evaluate(UNIT_ITEMS) == studio
    assert not s.take()


def test_a_piece_the_renter_drags_stays_there_after_a_reload_and_in_unit_3d_and_nothing_else_moves(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _studio(s)
    before = {i["id"]: i for i in pg.evaluate(STUDIO_ITEMS)}
    _drag_in_plan(pg, "coffee", 36, 14)
    moved = next(i for i in pg.evaluate(STUDIO_ITEMS) if i["id"] == "coffee")
    assert (moved["x"], moved["y"]) != (before["coffee"]["x"], before["coffee"]["y"]), "the piece moved"
    stored = _stored(pg)
    assert stored["ver"] == 2 and next(i for i in stored["items"] if i["id"] == "coffee").get("placed") is True
    after = {i["id"]: i for i in pg.evaluate(STUDIO_ITEMS)}
    assert all(after[k] == before[k] for k in before if k != "coffee"), "nothing else moved"
    # reload: exactly where it was put; Unit 3D draws it there too, and still agrees on everything else
    _reload(s)
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0", timeout=90000)
    pg.wait_for_timeout(500)
    assert {i["id"]: i for i in pg.evaluate(STUDIO_ITEMS)} == after
    _unit(s)
    assert {i["id"]: i for i in pg.evaluate(UNIT_ITEMS)} == after, "Unit 3D shows the layout the renter made in the studio"
    assert pg.evaluate(UNIT_MESHES)["coffee"] == [moved["x"], moved["y"]]
    _reload(s)
    pg.wait_for_function("() => window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.walk", timeout=120000)
    assert {i["id"]: i for i in pg.evaluate(UNIT_ITEMS)} == after
    _studio(s)
    assert {i["id"]: i for i in pg.evaluate(STUDIO_ITEMS)} == after, "visiting Unit 3D moved nothing"
    # "Use your furniture layout" is the renter choosing the whole layout, so it puts the coffee table back; nothing else does
    pg.click("#psTab [data-inv-use]")
    pg.wait_for_function("([x, y]) => { const c = window.__plan3d.items.find((i) => i.id === 'coffee'); return Math.abs(c.x - x) < 0.1 && Math.abs(c.y - y) < 0.1; }", arg=[round(DEFAULT["coffee"]["x"], 1), round(DEFAULT["coffee"]["y"], 1)])
    assert not s.take()


def test_a_layout_saved_before_pieces_were_marked_keeps_what_the_renter_moved_and_takes_the_new_default_for_the_rest(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    old = {"bed": (230, 238.5, 270), "nightstand-1": (198, 280, 270), "nightstand-2": (198, 197, 270), "tv-bed": (306.75, 238.5, 90), "dresser": (294.2, 159.5, 180),
           "desk": (33, 306, 270), "futon": (118, 238.5, 90), "coffee": (72, 238.5, 90), "tv": (21.75, 238.5, 270), "dining": (71, 163.5, 0)}
    refs = {i["id"]: i["ref"] for i in PLAN["layouts"][0]["items"]}
    refs["dresser"] = "dresser"   # the old default held the old chest
    layout = {"schema": 1, "kind": "apartmentscout-layout", "plan": UNIT, "units": "in",
              "items": [{"id": k, "ref": refs[k], "x": v[0], "y": v[1], "rot": v[2], "w": 60 if k == "desk" else None} | ({} if k == "desk" else {}) for k, v in old.items()]}
    for it in layout["items"]:
        if it["w"] is None:
            del it["w"]
    desk = next(i for i in layout["items"] if i["id"] == "desk")
    desk.update(x=140, y=120, rot=0, d=24, h=30)   # the renter moved the desk (an older build also baked its 60 x 24 size in)
    pg.goto(f"{s.origin}/#map")
    pg.evaluate("([k, v]) => localStorage.setItem(k, v)", [KEY, json.dumps(layout)])
    _studio(s)
    now = {i["id"]: i for i in pg.evaluate(STUDIO_ITEMS)}
    assert (now["desk"]["x"], now["desk"]["y"], now["desk"]["rot"]) == (140, 120, 0), "the desk the renter moved stays where they put it"
    assert (now["desk"]["w"], now["desk"]["d"]) == (89.2, 21.6), "but it is their rotating desk, not the old 60 x 24 baked into the saved layout"
    for k in ("bed", "futon", "tv", "tv-bed"):
        d = DEFAULT[k]
        assert (now[k]["x"], now[k]["y"], now[k]["rot"]) == (_r1(d["x"]), _r1(d["y"]), round(d.get("rot", 0))), f"{k}: never touched, so it takes the new default"
    saved = _stored(pg)
    assert saved["ver"] == 2 and next(i for i in saved["items"] if i["id"] == "desk")["placed"] is True, "saved again in the new form, the desk marked as the renter's"
    _unit(s)
    assert _only({i["id"]: i for i in pg.evaluate(UNIT_ITEMS)}, now) == now
    _reload(s)
    pg.wait_for_function("() => window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.walk", timeout=120000)
    assert _only({i["id"]: i for i in pg.evaluate(UNIT_ITEMS)}, now) == now, "a layout saved before the newer pieces existed gets them filled in, and nothing else changes"
    assert not s.take()


def test_one_unreadable_piece_in_a_saved_layout_does_not_send_everything_back_to_the_default(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    layout = {"schema": 1, "kind": "apartmentscout-layout", "plan": UNIT, "units": "in", "ver": 2,
              "items": [{"id": "bed", "ref": "queen-bed", "x": 120, "y": 200, "rot": 0, "placed": True}, {"id": "ghost", "ref": "hovercraft", "x": 5, "y": 5, "rot": 0}]}
    pg.goto(f"{s.origin}/#map")
    pg.evaluate("([k, v]) => localStorage.setItem(k, v)", [KEY, json.dumps(layout)])
    _studio(s)
    bed = next(i for i in pg.evaluate(STUDIO_ITEMS) if i["id"] == "bed")
    assert (bed["x"], bed["y"], bed["rot"]) == (120, 200, 0)
    assert len(pg.evaluate(STUDIO_ITEMS)) == 16, "the other fifteen pieces (the hidden ones among them) were filled in from the default"
    assert not s.take()


def test_the_desk_set_and_the_chest_stay_within_the_triangle_budgets_in_fast_and_visual(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    count = """() => { const out = {}; for (const g of window.__unit3d.stage.interior.furniture.group.children) { let t = 0; g.traverse((o) => { if (!o.isMesh) return; const gm = o.geometry; t += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; }); out[g.userData.itemId] = t; } return out; }"""
    fast = pg.evaluate(count)
    assert fast["desk"] > 300 and all(v <= 1600 for v in fast.values()), f"Fast: about 1,500 triangles a piece at most ({fast})"
    pg.locator("button", has_text="Visual").first.click()
    pg.wait_for_function("(n) => window.__unit3d.stage.interior.furniture.group.children.length === n", arg=len(fast))
    pg.wait_for_timeout(2500)
    visual = pg.evaluate(count)
    assert visual["desk"] > fast["desk"] * 2, "Visual draws the desk set richer (a mesh chair back, a mug, a notebook)"
    assert all(v <= 6000 for v in visual.values()), f"Visual: about 6,000 triangles a piece at most ({visual})"
    assert not s.take()


# ----------------------------------------------------------------------------------------------- walking in Unit 3D


def test_unit_3d_click_the_floor_to_walk_a_ring_shows_where_drag_to_look_and_the_keys_stop_at_walls(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1500, height=1100)
    pg = s.page
    _unit(s)
    look_click(pg, "#uLook .lk-chip:text-is('Sofa')")
    pg.wait_for_function("() => window.__unit3d.curView && window.__unit3d.curView.key === 'seat:sofa'")
    pg.wait_for_timeout(1500)
    start = pg.evaluate(STAGE_STATE)
    target, sp = _floor_spot(pg)
    pg.mouse.move(sp["x"], sp["y"])
    pg.wait_for_function("() => { const m = window.__unit3d.stage.interior.group.getObjectByName('walk-marker'); return !!m && m.visible; }")
    ring = pg.evaluate("() => { const m = window.__unit3d.stage.interior.group.getObjectByName('walk-marker'); return [m.position.x, m.position.z]; }")
    assert abs(ring[0] / M - (target["x"] - pg.evaluate("() => window.__unit3d.stage.interior.frame.xc"))) < 8, "the ring is where the pointer is"
    pg.mouse.click(sp["x"], sp["y"])
    pg.wait_for_function("() => window.__unit3d.walk.walking()", timeout=3000)
    mid = []
    for _ in range(3):                                   # a glide: it moves a bit each time we look, never jumps
        pg.wait_for_timeout(350)
        mid.append(pg.evaluate(STAGE_STATE))
    xs = [start["x"], *[m["x"] for m in mid]]
    assert all(abs(b - a) < 70 for a, b in zip(xs, xs[1:])), "no jump between frames"
    assert mid[0]["h"] > start["h"] - 0.01, "the eye rises from the seat to standing height"
    pg.wait_for_function("() => !window.__unit3d.walk.walking()", timeout=60000)
    end = pg.evaluate(STAGE_STATE)
    assert abs(end["x"] - target["x"]) < 8 and abs(end["y"] - target["y"]) < 8 and abs(end["h"] - 63) < 1, "arrived, standing, about 1.6 m up"
    assert pg.evaluate("() => { const m = window.__unit3d.stage.interior.group.getObjectByName('walk-marker'); return !m || !m.visible; }"), "the ring goes when you arrive"
    # drag to look around: any direction, not just near where it started
    cv = pg.evaluate("() => { const r = window.__unit3d.stage.cv.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    pg.mouse.move(cv[0], cv[1])
    pg.mouse.down()
    pg.mouse.move(cv[0] + 900, cv[1], steps=12)
    pg.mouse.up()
    turned = pg.evaluate(STAGE_STATE)
    delta = abs(((turned["head"] - end["head"]) + 540) % 360 - 180)
    assert delta > 60, "the view turned a long way, which the old 90 degree limit on the Inside look could not do in one drag"
    assert abs(turned["x"] - end["x"]) < 0.01 and abs(turned["y"] - end["y"]) < 0.01, "looking does not move you"
    # walk with the keys: forward then on into the partition: it stops short of the wall
    pg.locator("#gl").focus()
    for key, secs in (("ArrowLeft", 0.7),):
        pg.keyboard.down(key)
        pg.wait_for_timeout(int(secs * 1000))
        pg.keyboard.up(key)
    heading = pg.evaluate(STAGE_STATE)["head"]
    pg.keyboard.down("w")
    pg.wait_for_timeout(2500)
    pg.keyboard.up("w")
    a = pg.evaluate(STAGE_STATE)
    assert (a["x"], a["y"]) != (end["x"], end["y"]), "W walks"
    for _ in range(4):
        pg.keyboard.down("w")
        pg.wait_for_timeout(2500)
        pg.keyboard.up("w")
    b = pg.evaluate(STAGE_STATE)
    walls = pg.evaluate("""() => { const U = window.__unit3d; const p = U.walk.pos(); return U.walk.space.canStand(p[0], p[1]); }""")
    assert walls, "after a long walk straight on, still on the floor: never through a wall or a piece of furniture"
    assert heading is not None and b["h"] > 62
    assert not s.take()


def test_unit_3d_go_to_the_window_and_a_double_click_on_a_window_stand_you_there_looking_out(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1500, height=1100)
    pg = s.page
    _unit(s)
    look_click(pg, "#uLook .lk-chip:text-is('Sofa')")
    pg.wait_for_function("() => window.__unit3d.curView && window.__unit3d.curView.key === 'seat:sofa'")
    pg.wait_for_timeout(1500)
    assert pg.locator("#uLook [data-act=to-window]").count() == 1
    pg.click("#uLook [data-act=to-window]")
    pg.wait_for_function("() => window.__unit3d.walk.walking()", timeout=3000)
    pg.wait_for_function("() => !window.__unit3d.walk.walking()", timeout=20000)
    at = pg.evaluate(STAGE_STATE)
    glass = pg.evaluate("""() => { const U = window.__unit3d, p = U.walk.pos(), m = U.plan, best = [];
      for (const w of m.windows) { const ex = w.b[0] - w.a[0], ey = w.b[1] - w.a[1], t = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * ex + (p[1] - w.a[1]) * ey) / (ex * ex + ey * ey))); best.push([Math.hypot(p[0] - (w.a[0] + ex * t), p[1] - (w.a[1] + ey * t)), w.room]); }
      best.sort((a, b) => a[0] - b[0]); return best[0]; }""")
    assert glass[1] == "Living room", "the nearest window to the sofa is the living room's bay"
    assert 9 < glass[0] < 40, f"standing {glass[0]:.0f} in from the glass, not at the wall and not across the room"
    assert abs(at["h"] - 63) < 1
    # looking out: the heading is about the way the bay faces (up the drawing), within the bay's own spread
    assert min(at["head"], 360 - at["head"]) < 30, f"facing out of the window ({at['head']:.0f} degrees)"
    # a double-click on the bedroom's window: stand at it looking out
    look_click(pg, "#uLook .lk-chip:text-is('Bedroom')")
    pg.wait_for_function("() => window.__unit3d.curView && window.__unit3d.curView.room === 'Bedroom'")
    pg.wait_for_timeout(1500)
    sp = pg.evaluate(PROJECT_UNIT, {"x": 311, "y": 297, "h": 50})
    assert pg.evaluate("(p) => window.__unit3d.walk.windowAt(p.x, p.y)", sp) >= 0, "that point of the screen is a window"
    pg.mouse.dblclick(sp["x"], sp["y"])
    pg.wait_for_function("() => window.__unit3d.walk.walking()", timeout=3000)
    pg.wait_for_function("() => !window.__unit3d.walk.walking()", timeout=20000)
    assert pg.evaluate("() => document.getElementById('uCard').hidden"), "the double-click did not leave a building card over the glass"
    end = pg.evaluate(STAGE_STATE)
    room = pg.evaluate("() => window.__unit3d.walk.roomAt(window.__unit3d.walk.pos())")
    assert room == "Bedroom" and 5 < (end["head"] if end["head"] < 180 else 360 - end["head"]) < 90, f"in the bedroom, facing the corner window ({end['head']:.0f})"
    # the seat views stay as quick jumps
    look_click(pg, "#uLook .lk-chip:text-is('Desk')")
    pg.wait_for_function("() => window.__unit3d.curView && window.__unit3d.curView.key === 'seat:desk'")
    pg.wait_for_timeout(1200)
    assert not pg.evaluate("() => window.__unit3d.walk.walking()")
    assert not s.take()


def test_unit_3d_tap_to_walk_and_drag_to_look_by_touch(browser, base_url: str, webgl: bool) -> None:
    _need_webgl(webgl)
    ctx = browser.new_context(viewport={"width": 820, "height": 1300}, has_touch=True, is_mobile=False, service_workers="block")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
    pg = ctx.new_page()
    try:
        pg.goto(f"{base_url}/?mode=inside#unit/{UNIT}")
        pg.wait_for_function("(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.walk && document.getElementById('uLoad').hidden", arg=UNIT, timeout=120000)
        pg.wait_for_timeout(1000)
        pg.evaluate("() => { const b = document.getElementById('gl'); b.scrollIntoView({ block: 'center' }); }")
        pg.wait_for_timeout(500)
        _, sp = _floor_spot(pg)
        start = pg.evaluate(STAGE_STATE)
        pg.touchscreen.tap(sp["x"], sp["y"])
        pg.wait_for_function("() => window.__unit3d.walk.walking()", timeout=3000)
        pg.wait_for_function("() => !window.__unit3d.walk.walking()", timeout=20000)
        end = pg.evaluate(STAGE_STATE)
        assert (end["x"], end["y"]) != (start["x"], start["y"]) and abs(end["h"] - 63) < 1, "a tap walks there"
    finally:
        ctx.close()


# ----------------------------------------------------------------------------------------------- walking in the studio


def test_the_studio_walk_click_to_walk_go_to_the_window_and_stop_at_furniture(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1100)
    pg = s.page
    _studio(s)
    pg.click("#psMode [data-m='3d']")
    pg.click("#psCams [data-v=sofa]")
    pg.wait_for_function("() => window.__plan3d.eye === 'eye'")
    pg.wait_for_timeout(1500)
    state = "() => ({ at: window.__plan3d.eyeAt.at, yaw: window.__plan3d.eyeAt.yaw, touring: window.__plan3d.touring })"
    proj = """async (a) => { const G3 = await import('/js/plan/scene3d.js'), THREE = await import('three'), cam = G3.getCamera(), r = document.getElementById('pgl').getBoundingClientRect();
      const v = new THREE.Vector3(a.x * 0.0254, a.h * 0.0254, -a.y * 0.0254).project(cam); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }"""
    start = pg.evaluate(state)
    sp = pg.evaluate(proj, {"x": 45, "y": 200, "h": 0})
    pg.mouse.move(sp["x"], sp["y"])
    pg.wait_for_function("() => window.__plan3d.marker === true")
    pg.mouse.click(sp["x"], sp["y"])
    pg.wait_for_function("() => window.__plan3d.touring", timeout=3000)
    pg.wait_for_function("() => !window.__plan3d.touring", timeout=20000)
    end = pg.evaluate(state)
    assert abs(end["at"][0] - 45) < 6 and abs(end["at"][1] - 200) < 6, f"walked to the click: {end['at']}"
    assert end["at"] != start["at"]
    # Go to the window: the button in the camera row and the one in the look panel
    pg.click("#psCams [data-v=window]")
    pg.wait_for_function("() => window.__plan3d.touring", timeout=3000)
    pg.wait_for_function("() => !window.__plan3d.touring", timeout=20000)
    at = pg.evaluate(state)
    assert 340 < at["at"][1] < 380 and 60 < at["at"][0] < 130, f"at the living-room bay: {at['at']}"
    assert abs(at["yaw"]) < 0.4, "looking out of it"
    # keep walking toward the glass: stops short of it
    pg.locator("#pgl").focus()
    pg.keyboard.down("w")
    pg.wait_for_timeout(3500)
    pg.keyboard.up("w")
    near = pg.evaluate(state)
    assert near["at"][1] < 388, "never through the glass"
    assert pg.evaluate("() => window.__plan3d.canStand(window.__plan3d.eyeAt.at[0], window.__plan3d.eyeAt.at[1])"), "and still on the floor"
    assert not s.take()
