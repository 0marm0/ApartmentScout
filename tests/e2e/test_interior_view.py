"""The interior pass in a real browser: the renter's own furniture as the default layout, stand-at-the-window and from-the-seat
cameras in the Floor plan studio (with the real city outside by default at eye level), and Unit 3D's Inside camera with room
chips, arrow-key switching and a smooth glide. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
UNIT = "paramount-tower-25e"
M = 0.0254

# the camera in plan inches: where it stands and the direction it looks (plan frame: +y up the drawing)
POSE_JS = """() => { const c = window.__plan3d.cam, d = c.getWorldDirection(new c.position.constructor());
  return { at: [c.position.x / 0.0254, -c.position.z / 0.0254], h: c.position.y / 0.0254, dir: [d.x, -d.z], pitch: d.y, fov: c.fov }; }"""


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _studio(s, uid: str = UNIT) -> None:
    pg = s.page
    pg.goto(f"{s.origin}/#plan/{uid}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
    pg.wait_for_timeout(600)


def _unit(s, uid: str = UNIT, query: str = "?mode=inside") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{uid}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && document.getElementById('uLoad').hidden",
        arg=uid, timeout=120000)
    s.page.wait_for_timeout(600)


def _settle(pg) -> None:
    """Let the studio's render loop take the camera to a new view (a glide of zero length still needs a frame)."""
    pg.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))")


def _chips(pg, root: str) -> list[str]:
    return pg.evaluate("(r) => [...document.querySelectorAll(r + ' .lk-chip')].map((b) => b.textContent.trim())", root)


def _on(pg, root: str) -> str:
    return pg.evaluate("(r) => document.querySelector(r + ' .lk-chip.on')?.textContent.trim() ?? ''", root)


# --------------------------------------------------------------------------- the renter's own furniture

def test_the_studio_opens_on_your_furniture_and_every_piece_fits(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    inv = json.loads((Path(__file__).resolve().parents[2] / "examples" / "nyc-2026" / "furniture.json").read_text())
    # the unit's default layout is the renter's own, at their sizes, and the checks grade all ten clear
    rows = pg.evaluate("() => [...document.querySelectorAll('#psTab .iv-row')].map((r) => r.querySelector('b').textContent)")
    assert len(rows) == 10 and rows[0] == "Queen bed"
    assert pg.locator("#psTab [data-inv-use]").get_attribute("aria-pressed") == "true"
    assert pg.evaluate("() => [...document.querySelectorAll('#psInsp .metric .v')].map((e) => e.textContent.trim())") == ["0", "0", "10"]
    items = pg.evaluate("() => window.__plan3d.items.map(({id, ref, w, d, h, elev}) => ({id, ref, w, d, h, elev}))")
    by = {i["id"]: i for i in items}
    for p in inv["pieces"]:
        assert by[p["id"]]["ref"] == p["ref"] and by[p["id"]]["w"] == p["w"] and by[p["id"]]["d"] == p["d"], p["id"]
    assert by["tv"]["elev"] == 32
    # a piece taken out can be put back at its own size; undo brings it back too
    pg.click("#psTab [data-sel=desk]")
    pg.keyboard.press("Delete")
    pg.wait_for_function("() => window.__plan3d.items.length === 9")
    assert pg.locator("#psTab [data-inv-add=desk]").count() == 1
    pg.keyboard.press("Control+z")
    pg.wait_for_function("() => window.__plan3d.items.length === 10")
    pg.click("#psTab [data-sel=desk]")
    pg.keyboard.press("Delete")
    pg.wait_for_function("() => window.__plan3d.items.length === 9")
    pg.click("#psTab [data-inv-add=desk]")
    pg.wait_for_function("() => window.__plan3d.items.length === 10")
    desk = pg.evaluate("() => window.__plan3d.items.find((i) => i.id === 'desk')")
    assert (desk["w"], desk["d"], desk["h"]) == (60, 24, 30)
    assert not s.take()


def test_a_project_carries_the_renters_furniture_out_and_back_in(open_page, webgl: bool, tmp_path) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    pg.click("#psFileBtn")
    with pg.expect_download() as dl:
        pg.click("#psMenu [data-f=project-save]")
    proj = json.loads(Path(dl.value.path()).read_text())
    assert proj["kind"] == "apartmentscout-project" and len(proj["layout"]["items"]) == 10
    assert [p["id"] for p in proj["inventory"]["pieces"]][:3] == ["bed", "nightstand-1", "nightstand-2"]
    assert proj["inventory"]["pieces"][0]["w"] == 64 and "/Users/" not in json.dumps(proj)
    # the inventory a project brings is the one the studio shows, not the search's
    proj["inventory"]["pieces"][0]["label"] = "Our queen bed"
    f = tmp_path / "project.json"
    f.write_text(json.dumps(proj))
    pg.set_input_files("#psProjectFile", str(f))
    pg.wait_for_function("() => document.querySelector('#psTab .iv-row b')?.textContent === 'Our queen bed'", timeout=30000)
    assert pg.evaluate("() => window.__plan3d.inventory.pieces.length") == 10
    assert not s.take()


# --------------------------------------------------------------------------- the studio looks out

def test_studio_stands_at_the_window_and_sits_on_the_sofa_with_the_real_city_outside(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _studio(s)
    assert _chips(pg, "#psLook") == ["Living room", "Bay", "Bedroom", "Corner", "Sofa", "Bed", "Desk"]
    assert pg.evaluate("() => window.__plan3d.eye") == "orbit" and not pg.evaluate("() => window.__plan3d.hasCity")   # the bird's-eye view stays the layout view
    plan = pg.evaluate("""async () => { const { normalisePlan, pointInPoly } = await import('/js/plan/model.js');
      const m = normalisePlan(await (await fetch('/data/plans/paramount-tower-25e.json')).json());
      return { rooms: m.rooms.filter((r) => ['Living room', 'Bedroom'].includes(r.name)).map((r) => ({ name: r.name, poly: r.poly })) }; }""")
    inside = lambda name, at: pg.evaluate("async ([poly, at]) => (await import('/js/plan/model.js')).pointInPoly(at, poly)", [next(r for r in plan["rooms"] if r["name"] == name)["poly"], at])
    # the living-room window: standing inside the room, looking out of the bay, at the city
    pg.click("#psLook [data-vp^='room:Living']")
    pg.wait_for_function("() => window.__plan3d.eye === 'eye' && window.__plan3d.hasCity")
    _settle(pg)
    pose = pg.evaluate(POSE_JS)
    assert inside("Living room", pose["at"]) and abs(pose["h"] - 63) < 1 and abs(pose["pitch"]) < 0.1
    assert pose["dir"][1] > 0.97, pose                                            # up the drawing: out of the facade
    scene = pg.evaluate("""async () => { const G3 = await import('/js/plan/scene3d.js'), p = G3.parts();
      return { fog: !!p.scene.fog, sky: p.scene.getObjectByName('sky')?.visible, city: !!p.scene.getObjectByName('city')?.getObjectByName('neighbours'), glass: p.shell.getObjectByName('interior detail').children.filter((o) => o.name === 'glass').length }; }""")
    assert scene == {"fog": True, "sky": True, "city": True, "glass": 6}           # haze, a sky, the neighbours, six panes of glass
    assert _on(pg, "#psLook") == "Living room"
    # the bay: closer to the glass and wider than the room view
    pg.click("#psLook [data-vp^='bay:']")
    pg.wait_for_function("() => window.__plan3d.view.startsWith('bay:')")
    _settle(pg)
    bay = pg.evaluate(POSE_JS)
    assert bay["at"][1] > pose["at"][1] + 40 and bay["fov"] > pose["fov"] + 20 and inside("Living room", bay["at"])
    # arrow keys on a focused chip switch the view, [ and ] from anywhere
    pg.focus("#psLook [data-vp^='bay:']")
    pg.keyboard.press("ArrowRight")
    pg.wait_for_function("() => window.__plan3d.view.startsWith('room:Bedroom')")
    _settle(pg)
    assert _on(pg, "#psLook") == "Bedroom" and inside("Bedroom", pg.evaluate(POSE_JS)["at"])
    pg.keyboard.press("ArrowRight")
    pg.wait_for_function("() => window.__plan3d.view.startsWith('corner:')")
    pg.evaluate("() => document.activeElement.blur()")                              # leave the chips' focus for the page
    pg.keyboard.press("]")
    pg.wait_for_function("() => window.__plan3d.view === 'seat:sofa'")
    _settle(pg)
    sofa = pg.evaluate(POSE_JS)
    futon = pg.evaluate("() => window.__plan3d.items.find((i) => i.id === 'futon')")
    assert abs(sofa["at"][0] - futon["x"]) < 24 and abs(sofa["at"][1] - futon["y"]) < 24 and 36 < sofa["h"] < 44   # sitting on the futon, at a seated eye height
    assert sofa["dir"][1] > 0.5                                                    # looking out of the bay
    pg.keyboard.press("[")
    pg.wait_for_function("() => window.__plan3d.view.startsWith('corner:')")
    # from the bed: the bedroom's corner window
    pg.click("#psLook [data-vp='seat:bed']")
    pg.wait_for_function("() => window.__plan3d.view === 'seat:bed'")
    _settle(pg)
    bed = pg.evaluate(POSE_JS)
    assert inside("Bedroom", bed["at"]) and bed["dir"][0] > 0.4 and bed["dir"][1] > 0.6
    # evening and night give the window a different sky; leaving puts the bird's-eye view back
    pg.click("#pMood [data-mood=evening]")
    pg.wait_for_timeout(300)
    assert pg.evaluate("async () => (await import('/js/plan/scene3d.js')).parts().scene.fog.color.getHexString()") != "cddcec"
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => window.__plan3d.eye === 'orbit' && !window.__plan3d.hasCity")
    assert not s.take()


def test_the_chips_are_an_accessible_radio_group_on_a_phone_too(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=390, height=844)
    pg = s.page
    _studio(s)
    pg.click('#psMode [data-m="3d"]')
    pg.wait_for_timeout(400)
    box = pg.evaluate("() => { const r = document.getElementById('psLook').getBoundingClientRect(), c = document.getElementById('psCams').getBoundingClientRect(), n = document.querySelector('.rnq').getBoundingClientRect(); return { look: [r.top, r.bottom], cams: [c.top, c.bottom], rnq: [n.top, n.bottom], scrolls: document.getElementById('psLook').scrollWidth > document.getElementById('psLook').clientWidth }; }")
    assert box["look"][0] >= box["cams"][1] - 1, box                              # under the camera row, not on the render switch
    assert box["look"][1] <= box["rnq"][0] or box["look"][0] >= box["rnq"][1]
    pg.click("#psLook [data-vp='seat:sofa']")
    pg.wait_for_function("() => window.__plan3d.view === 'seat:sofa'")
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")   # no sideways page scroll
    pg.add_script_tag(path=str(AXE))
    res = pg.evaluate("async () => (await axe.run('#psLook', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => v.id + ': ' + v.nodes.length)")
    assert res == [], res
    assert pg.evaluate("() => [...document.querySelectorAll('#psLook [role=radiogroup]')].every((g) => !!g.getAttribute('aria-label') && g.querySelectorAll('[role=radio]').length > 0)")
    assert pg.evaluate("() => document.querySelectorAll('#psLook .lk-chip[tabindex=\"0\"]').length") == 1
    assert not s.take()


# --------------------------------------------------------------------------- Unit 3D's Inside camera

def test_inside_view_has_room_chips_with_the_renters_furniture_and_switches_by_key(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s)
    assert pg.evaluate("() => !document.getElementById('uLook').hidden")
    assert _chips(pg, "#uLook") == ["Living room", "Bay", "Bedroom", "Corner", "Sofa", "Bed", "Desk", "Into the room"]
    assert _on(pg, "#uLook") == "Living room"
    info = pg.evaluate("() => ({ src: window.__unit3d.planInfo.source, name: window.__unit3d.planInfo.layoutName, n: window.__unit3d.stage.interior.furniture.count })")
    assert info == {"src": "file", "name": "Your furniture", "n": 10}                # the source plan's default layout, in the real city
    assert pg.evaluate("() => document.querySelector('#hud').textContent").count("Living room") == 1
    living = pg.evaluate("() => ({ off: window.__unit3d.stage.inEye.off, win: window.__unit3d.st.inWin })")
    pg.click("#uLook [data-vp^='room:Bedroom']")
    pg.wait_for_function("() => window.__unit3d.curView.key.startsWith('room:Bedroom')")
    bed = pg.evaluate("() => ({ off: window.__unit3d.stage.inEye.off, win: window.__unit3d.st.inWin, sel: document.getElementById('uInWin').value, hud: document.getElementById('hud').textContent })")
    assert bed["win"] != living["win"] and abs(bed["off"] - living["off"]) > 20 and bed["sel"] == pg.evaluate("() => window.__unit3d.curView.key")
    assert "Bedroom" in bed["hud"]
    # the corner window faces differently from the bay
    pg.focus("#uLook [data-vp^='room:Bedroom']")
    pg.keyboard.press("ArrowRight")
    pg.wait_for_function("() => window.__unit3d.curView.kind === 'corner'")
    pg.keyboard.press("End")
    pg.wait_for_function("() => window.__unit3d.curView.kind === 'inward'")
    inward = pg.evaluate("() => window.__unit3d.stage.inEye.off")
    pg.keyboard.press("Home")
    pg.wait_for_function("() => window.__unit3d.curView.key.startsWith('room:Living')")
    assert abs((inward - pg.evaluate("() => window.__unit3d.stage.inEye.off")) % 360 - 180) < 1                 # "Into the room" faces the other way
    pg.evaluate("() => document.activeElement.blur()")
    pg.keyboard.press("]")
    pg.wait_for_function("() => window.__unit3d.curView.kind === 'bay'")
    pg.click("#uLook [data-vp='seat:sofa']")
    pg.wait_for_function("() => window.__unit3d.curView.seat === 'sofa'")
    eye = pg.evaluate("() => window.__unit3d.stage.inEye.local.y")
    assert 0.9 < eye < 1.2                                                           # seated, not standing
    assert pg.evaluate("() => window.__unit3d.st.mode") == "in"
    assert not s.take()


def test_inside_camera_glides_between_rooms_unless_motion_is_reduced(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s)
    pg.emulate_media(reduced_motion="no-preference")
    pg.click("#uLook [data-vp^='room:Bedroom']")
    assert pg.evaluate("() => !!window.__unit3d.stage.inTween")                       # moving
    pg.wait_for_timeout(250)
    mid = pg.evaluate("() => ({ w: window.__unit3d.stage.interior.group.children.filter((o) => o.name === 'wall').every((o) => !o.visible), ceil: window.__unit3d.stage.interior.group.children.find((o) => o.name === 'ceiling').visible })")
    assert mid == {"w": True, "ceil": False}                                          # between rooms the walls step aside, so the camera never cuts through one
    pg.wait_for_function("() => !window.__unit3d.stage.inTween", timeout=5000)
    done = pg.evaluate("() => ({ w: window.__unit3d.stage.interior.group.children.filter((o) => o.name === 'wall').every((o) => o.visible), ceil: window.__unit3d.stage.interior.group.children.find((o) => o.name === 'ceiling').visible, yaw: window.__unit3d.stage.look.yaw })")
    assert done == {"w": True, "ceil": True, "yaw": 0}
    pg.emulate_media(reduced_motion="reduce")
    pg.click("#uLook [data-vp^='room:Living']")
    assert pg.evaluate("() => !window.__unit3d.stage.inTween && window.__unit3d.curView.key.startsWith('room:Living')")   # reduced motion: straight there
    assert not s.take()


def test_inside_view_on_a_phone_keeps_the_dropdown_and_a_scrolling_chip_row(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=390, height=844)
    pg = s.page
    _unit(s)
    assert pg.evaluate("() => getComputedStyle(document.querySelector('.u-lens .u-in-select')).display") != "none"
    opts = pg.evaluate("() => [...document.querySelectorAll('#uInWin option')].map((o) => o.textContent)")
    assert opts[:4] == ["Living room", "Bay", "Bedroom", "Corner"] and "From the sofa" in opts
    pg.select_option("#uInWin", index=2)
    pg.wait_for_function("() => window.__unit3d.curView.key.startsWith('room:Bedroom')")
    assert _on(pg, "#uLook") == "Bedroom"                                              # the chips follow the dropdown
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert not s.take()
