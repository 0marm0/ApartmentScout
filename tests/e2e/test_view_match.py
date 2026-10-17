"""Unit 3D's guided "Match a photo" in a real browser: pick a listing photo, mark landmarks with fixed clicks (mouse, keyboard and
touch-style pointer events), name them from the site's landmark list or by clicking the 3D view, check the fit against a camera whose
answer is known, save it (this browser; the search folder's copy is tested in tests/test_viewcal.py), reload and see the accuracy chip
say "measured from photo N", and the phone layout. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels: see conftest.NO_RASTER_JS

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
UNIT = "the-knox-13c"   # faces NNE (28 degrees) with named towers ahead: One Vanderbilt, 432 Park Avenue, the Chrysler Building
LANDMARKS = ["One Vanderbilt", "432 Park Avenue", "Chrysler Building"]
# the camera the "photo" was taken with: it looks 6 degrees to one side of the facade, tilted up, 4 m higher than the model's eye
TRUTH = {"bearing": 38.0, "tilt": 14.0, "vfov": 72.0, "up": 4.0}


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, uid: str = UNIT, query: str = "?mode=window") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{uid}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && document.getElementById('uLoad').hidden",
        arg=uid, timeout=120000)
    settled(s.page, 20000, ticks=5)


def _tap(pg, selector: str) -> None:
    """A real mouse click at the middle of the element. (Playwright's own click scrolls the page's horizontal viewport container to centre a
    control that is already fully visible in the docked card; a person's click does not.)"""
    box = pg.locator(selector).first.bounding_box()
    assert box, f"{selector} is not on the page"
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def _open_and_pick(pg) -> None:
    pg.click("#uMatch")
    pg.wait_for_selector(".vm-card .vm-thumb:not(.gone)")
    _tap(pg, ".vm-thumb:not(.gone) >> nth=0")
    pg.wait_for_function("() => window.__unit3d.match.state.step === 2 && !!window.__unit3d.match.state.photo && window.__unit3d.match.state.photo.aspect > 0")
    pg.wait_for_timeout(300)


# where the named landmarks fall in a photo taken by TRUTH, as fractions of the picture (u, v from the top-left)
PROJECT_JS = """async (arg) => {
  const V = await import('/js/unit/view-solver.js');
  const u = window.__unit3d, w = u.winPos(u.st.floor), aspect = u.match.state.photo.aspect;
  const L = (await (await fetch('/data/sites/' + u.st.id + '.json')).json()).lm;
  return arg.names.map((n) => { const l = L.find((x) => x[0] === n); const q = V.project({ bearing: arg.cam.bearing, tilt: arg.cam.tilt, vfov: arg.cam.vfov, x: w.x, y: w.y, z: w.z + arg.cam.up }, { x: l[2], y: l[3], z: l[4] }); return { name: n, f: V.photoFraction(q, aspect), q }; });
}"""

FRAME_JS = "() => { const r = document.getElementById('vmFrame').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }"


def _click_photo(pg, f: dict) -> None:
    r = pg.evaluate(FRAME_JS)
    pg.mouse.click(r["x"] + f["u"] * r["w"], r["y"] + f["v"] * r["h"])


def _name_it(pg, name: str) -> None:
    pg.wait_for_selector("#vmLm")
    pg.select_option("#vmLm", value=name)
    _tap(pg, "[data-act=use-lm]")
    pg.wait_for_selector("#vmLm", state="detached")


def _mark_all(pg, names: list[str] = LANDMARKS) -> list[dict]:
    pts = pg.evaluate(PROJECT_JS, {"names": names, "cam": TRUTH})
    r = pg.evaluate(FRAME_JS)
    for p in pts:
        assert -0.02 <= p["f"]["u"] <= 1.02 and -0.02 <= p["f"]["v"] <= 1.02, f"{p['name']} falls outside the picture: {p['f']}, frame {r}"
    for p in pts:
        _click_photo(pg, p["f"])
        _name_it(pg, p["name"])
    return pts


# --------------------------------------------------------------------------- the guide

def test_the_guide_recovers_a_known_camera_and_saves_it(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    pg.click("#uMatch")
    # step 1: three steps, the unit's photos as buttons, a way to use your own photo
    assert pg.locator(".vm-steps li").count() == 3 and pg.locator(".vm-steps li[aria-current=step]").inner_text().strip().endswith("Pick a photo")
    assert pg.locator(".vm-thumb").count() >= 4
    assert pg.get_by_text("Use my own photo").count() == 1
    _tap(pg, ".vm-thumb:not(.gone) >> nth=0")
    pg.wait_for_function("() => window.__unit3d.match.state.step === 2 && window.__unit3d.match.state.photo.aspect > 0")
    assert "Click a landmark" in pg.locator("#vmPrompt").inner_text()
    # the 3D view shows its named landmarks so the same tower can be found there
    assert pg.evaluate("() => window.__unit3d.stage.showHidden") is True
    pts = pg.evaluate(PROJECT_JS, {"names": LANDMARKS, "cam": TRUTH})
    # one pin: it asks what it is
    _click_photo(pg, pts[0]["f"])
    assert "Which landmark" in pg.locator("#vmPrompt").inner_text() or pg.locator(".vm-target").count() == 1
    assert pg.locator("[data-act=next]").is_disabled()
    pg.select_option("#vmLm", value=LANDMARKS[0])
    _tap(pg, "[data-act=use-lm]")
    assert "One more landmark" in pg.locator("#vmFit").inner_text()
    for p in pts[1:]:
        _click_photo(pg, p["f"])
        _name_it(pg, p["name"])
    res = pg.evaluate("() => { const r = window.__unit3d.match.state.result; return { ok: r.ok, n: r.n, b: r.bearing_deg, t: r.tilt_deg, f: r.vfov_deg, h: r.eye_height_m, det: r.eye_determined, rms: r.rms_deg, q: r.quality, model: r.model_eye_m, lens: r.lens_determined }; }")
    assert res["ok"] and res["n"] == 3
    assert abs(res["b"] - TRUTH["bearing"]) < 0.5, res
    assert abs(res["t"] - TRUTH["tilt"]) < 0.6, res
    assert res["rms"] < 0.5 and res["q"] == "good", res
    assert "Fits" in pg.locator("#vmFit").inner_text() and "fits within" in pg.locator("#vmFit").inner_text()
    # the 3D camera was put where the photo's camera is
    cam = pg.evaluate("() => ({ yaw: window.__unit3d.stage.look.yaw, pitch: window.__unit3d.stage.look.pitch, az: window.__unit3d.st.az })")
    assert abs((cam["az"] + cam["yaw"]) - res["b"]) < 0.6 and abs(cam["pitch"] - res["t"]) < 0.6, (cam, res)
    # step 3
    _tap(pg, "[data-act=next]")
    pg.wait_for_selector(".vm-dl")
    text = pg.locator(".vm-dl").inner_text()
    assert "Looks toward" in text and "Tilt" in text and "Lens" in text and "Camera height" in text
    assert pg.locator(".vm-tab tbody tr").count() == 3
    _tap(pg, "[data-act=save]")
    pg.wait_for_selector(".u-note.ok[role=status]")
    assert "Saved in this browser" in pg.locator(".u-note.ok[role=status]").inner_text()
    stored = json.loads(pg.evaluate("(id) => localStorage.getItem('as:view-cal:' + id)", UNIT))
    assert stored["kind"] == "apartmentscout-view-calibration" and stored["site"] == UNIT and len(stored["landmarks"]) == 3
    assert abs(stored["result"]["bearing_deg"] - TRUTH["bearing"]) < 0.5 and stored["photo"]["n"] == 1
    # the unit now faces the measured bearing (6 degrees from the 28 degree wall: a match), and says where that came from
    assert pg.evaluate("() => window.__unit3d.st.src") == "photo-landmarks"
    assert abs(pg.evaluate("() => window.__unit3d.st.az") - stored["result"]["bearing_deg"]) < 0.01
    _tap(pg, "[data-act=close]")
    pg.wait_for_selector(".vm-card", state="detached")
    assert pg.evaluate("() => document.getElementById('stage').classList.contains('vm-on')") is False
    # reload: the match is loaded and the accuracy chip says where its numbers came from
    pg.reload()
    pg.wait_for_function("() => window.__unit3d && window.__unit3d.viewCal && document.getElementById('uLoad').hidden", timeout=120000)
    settled(pg, 20000, ticks=4)
    rows = pg.evaluate("() => [...document.querySelectorAll('.acc-list li')].map((li) => ({ k: li.dataset.row, pill: li.querySelector('.acc-pill').textContent, text: li.querySelector('p').textContent }))")
    by = {r["k"]: r for r in rows}
    assert by["bearing"]["pill"] == "measured" and "measured from photo 1" in by["bearing"]["text"], by["bearing"]
    assert "fits within" in by["bearing"]["text"]
    # these three towers are all 650 m or more away: they cannot separate the camera height from the tilt, and the chip does not pretend they can
    assert stored["result"]["eye_determined"] is False
    assert by["floor-height"]["pill"] == "estimated" and "could not fix the camera height" in by["floor-height"]["text"], by["floor-height"]
    assert pg.evaluate("() => window.__unit3d.st.src") == "photo-landmarks"
    # remove it again: the unit goes back to the site file
    pg.click("#uMatch")
    pg.wait_for_selector(".vm-saved")
    _tap(pg, "[data-act=forget]")
    pg.wait_for_function("() => window.__unit3d.viewCal === null")
    assert pg.evaluate("(id) => localStorage.getItem('as:view-cal:' + id)", UNIT) is None
    assert not [e for e in s.take() if "404" not in e]


def test_a_near_roof_clicked_in_3d_fixes_the_camera_height(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    _open_and_pick(pg)
    pts = pg.evaluate(PROJECT_JS, {"names": LANDMARKS[:2], "cam": TRUTH})
    for p in pts:
        _click_photo(pg, p["f"])
        _name_it(pg, p["name"])
    # with two landmarks the 3D view is already lined up with the photo: a building close by, picked in 3D, is the third
    spot = pg.evaluate("""async (cam) => { const V = await import('/js/unit/view-solver.js'), cv = document.getElementById('gl'), r = cv.getBoundingClientRect(), u = window.__unit3d, st = u.stage, w = u.winPos(u.st.floor);
      for (let fy = 0.25; fy < 0.9; fy += 0.05) for (let fx = 0.15; fx < 0.85; fx += 0.05) {
        const x = r.x + fx * r.width, y = r.y + fy * r.height, h = st.pickPoint(x, y);
        if (!h || h.z < 20 || Math.hypot(h.x - w.x, h.y - w.y) > 260) continue;
        const q = V.project({ ...cam, x: w.x, y: w.y, z: w.z + cam.up }, h), f = V.photoFraction(q, u.match.state.photo.aspect);
        if (f.u > 0.05 && f.u < 0.95 && f.v > 0.05 && f.v < 0.95) return { x, y, h, f, dist: Math.hypot(h.x - w.x, h.y - w.y) };
      } return null; }""", TRUTH)
    assert spot, "no near building in the lined-up view"
    _click_photo(pg, spot["f"])
    pg.wait_for_selector("#vmLm")
    pg.mouse.click(spot["x"], spot["y"])
    pg.wait_for_selector("#vmLm", state="detached")
    res = pg.evaluate("() => { const r = window.__unit3d.match.state.result; return { n: r.n, h: r.eye_height_m, det: r.eye_determined, sg: r.sigma.eye, model: r.model_eye_m, b: r.bearing_deg, t: r.tilt_deg, rms: r.rms_deg }; }")
    assert res["n"] == 3 and res["det"] is True, res
    assert abs(res["h"] - (res["model"] + TRUTH["up"])) < 2.0, res
    assert abs(res["b"] - TRUTH["bearing"]) < 0.5 and abs(res["t"] - TRUTH["tilt"]) < 0.5, res
    _tap(pg, "[data-act=next]")
    pg.wait_for_selector(".vm-dl")
    assert "measured" in pg.locator(".vm-dl > div:has-text('Camera height')").inner_text()
    _tap(pg, "[data-act=save]")
    pg.wait_for_selector(".u-note.ok[role=status]")
    # the height is a measured eye height on the unit: the page's own datum now says so, and the chip names the photo
    cal = pg.evaluate("() => ({ state: window.__unit3d.cal.state, src: window.__unit3d.cal.measured && window.__unit3d.cal.measured.src, eye: window.__unit3d.winPos(window.__unit3d.st.floor).z })")
    assert cal["state"] == "measured" and cal["src"].startswith("photo 1"), cal
    assert abs(cal["eye"] - res["h"]) < 0.05, (cal, res)
    pg.keyboard.press("Escape")   # step back to the landmarks, then close
    pg.keyboard.press("Escape")
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".vm-card", state="detached")
    pg.wait_for_timeout(300)
    rows = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('.acc-list li')].map((li) => [li.dataset.row, { pill: li.querySelector('.acc-pill').textContent, text: li.querySelector('p').textContent }]))")
    assert rows["floor-height"]["pill"] == "measured" and "Measured from photo 1" in rows["floor-height"]["text"], rows["floor-height"]
    assert rows["bearing"]["pill"] == "measured" and "measured from photo 1" in rows["bearing"]["text"], rows["bearing"]
    assert not [e for e in s.take() if "404" not in e]


def test_exported_file_is_the_record(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    _open_and_pick(pg)
    _mark_all(pg)
    _tap(pg, "[data-act=next]")
    pg.wait_for_selector("[data-act=export]")
    with pg.expect_download() as dl:
        _tap(pg, "[data-act=export]")
    d = dl.value
    assert d.suggested_filename == f"{UNIT}.view-calibration.json"
    rec = json.loads(Path(d.path()).read_text())
    assert rec["kind"] == "apartmentscout-view-calibration" and rec["schema"] == 1 and rec["site"] == UNIT
    assert rec["result"]["n"] == 3 and rec["photo"]["floor"] == 13 and rec["applied"]["floor"] == 13
    assert {l["name"] for l in rec["landmarks"]} == set(LANDMARKS)
    assert not [e for e in s.take() if "404" not in e]


def test_undo_reset_keyboard_and_touch(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    _open_and_pick(pg)
    n_pairs = "() => window.__unit3d.match.state.pairs.length"
    # keyboard: the layer is focusable, arrows move the crosshair, Enter places a pin, Escape cancels it
    pg.focus(".vm-layer")
    for _ in range(6):
        pg.keyboard.press("ArrowRight")
    pg.keyboard.press("Shift+ArrowDown")
    assert pg.locator(".vm-cross").is_visible()
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#vmLm")
    assert pg.evaluate(n_pairs) == 1 and pg.evaluate("() => window.__unit3d.match.state.pairs[0].target") is None
    pg.keyboard.press("Escape")
    pg.wait_for_selector("#vmLm", state="detached")
    assert pg.evaluate(n_pairs) == 0
    # a touch-style tap places a pin too (pointer events with pointerType touch)
    r = pg.evaluate(FRAME_JS)
    pg.evaluate("""(p) => { const l = document.querySelector('.vm-layer'); const o = { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: p.x, clientY: p.y };
      l.dispatchEvent(new PointerEvent('pointerdown', o)); l.dispatchEvent(new PointerEvent('pointerup', o)); }""", {"x": r["x"] + 0.3 * r["w"], "y": r["y"] + 0.4 * r["h"]})
    pg.wait_for_selector("#vmLm")
    assert pg.evaluate(n_pairs) == 1
    pg.select_option("#vmLm", value="One Vanderbilt")
    pg.keyboard.press("Enter")   # Enter on the list uses the landmark
    pg.wait_for_selector("#vmLm", state="detached")
    assert pg.evaluate("() => window.__unit3d.match.state.pairs[0].name") == "One Vanderbilt"
    # undo takes the naming back (the pin stays, waiting), the Undo button and Z both work, Reset clears and Undo brings it back
    pg.focus(".vm-layer")
    pg.keyboard.press("z")
    pg.wait_for_selector("#vmLm")
    assert pg.evaluate("() => window.__unit3d.match.state.pairs[0].target") is None
    _tap(pg, "[data-act=cancel-pin]")
    assert pg.evaluate(n_pairs) == 0
    _tap(pg, "[data-act=undo]")
    assert pg.evaluate(n_pairs) == 1
    _tap(pg, "[data-act=undo]")
    assert pg.evaluate(n_pairs) == 0 or pg.evaluate(n_pairs) == 1
    pg.keyboard.press("Escape")   # step back, then close
    pg.wait_for_function("() => window.__unit3d.match.state.step === 1")
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".vm-card", state="detached")
    # a pin can be dragged: its place follows the pointer
    _open_and_pick(pg)
    _click_photo(pg, {"u": 0.4, "v": 0.5})
    pg.select_option("#vmLm", value="One Vanderbilt")
    _tap(pg, "[data-act=use-lm]")
    box = pg.locator(".vm-pin").first.bounding_box()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down()
    r = pg.evaluate(FRAME_JS)
    pg.mouse.move(r["x"] + 0.7 * r["w"], r["y"] + 0.3 * r["h"], steps=6)
    pg.mouse.up()
    uv = pg.evaluate("() => { const p = window.__unit3d.match.state.pairs[0]; return [p.u, p.v]; }")
    assert abs(uv[0] - 0.7) < 0.02 and abs(uv[1] - 0.3) < 0.02, uv
    _tap(pg, "[data-act=reset]")
    assert pg.evaluate(n_pairs) == 0
    _tap(pg, "[data-act=undo]")
    assert pg.evaluate(n_pairs) == 1
    assert not [e for e in s.take() if "404" not in e]


def test_a_click_in_the_3d_view_names_the_landmark(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    _open_and_pick(pg)
    _click_photo(pg, {"u": 0.5, "v": 0.5})
    pg.wait_for_selector("#vmLm")
    assert pg.evaluate("() => document.getElementById('stage').classList.contains('vm-picking')") is True
    # find a building under some point of the canvas, then click it
    spot = pg.evaluate("""() => { const cv = document.getElementById('gl'), r = cv.getBoundingClientRect(), st = window.__unit3d.stage;
      for (let fy = 0.2; fy < 0.95; fy += 0.07) for (let fx = 0.1; fx < 0.9; fx += 0.07) { const x = r.x + fx * r.width, y = r.y + fy * r.height; const h = st.pickPoint(x, y); if (h && h.z > 15) return { x, y, h }; }
      return null; }""")
    assert spot, "no building under the canvas"
    pg.mouse.click(spot["x"], spot["y"])
    pg.wait_for_selector("#vmLm", state="detached")
    pair = pg.evaluate("() => window.__unit3d.match.state.pairs[0]")
    assert pair["kind"] == "picked" and "m up" in pair["name"]
    t = pair["target"]
    assert abs(t["z"] - spot["h"]["z"]) < 0.01 and abs(t["x"] - spot["h"]["x"]) < 0.01
    # the hit point projects back onto the click: the site-metre <-> three.js mapping is right
    err = pg.evaluate("""async (s) => { const V = await import('/js/unit/view-solver.js'), u = window.__unit3d, cv = document.getElementById('gl'), r = cv.getBoundingClientRect();
      const w = u.stage.win, L = u.stage.look, q = V.project({ bearing: u.st.az + L.yaw, tilt: L.pitch, vfov: L.fov, x: w.x, y: w.y, z: w.z }, s.h);
      return { dx: q.x - (s.x - r.x - r.width / 2) / r.height, dy: q.y - (r.height / 2 - (s.y - r.y)) / r.height }; }""", spot)
    assert abs(err["dx"]) < 0.004 and abs(err["dy"]) < 0.004, err
    assert not [e for e in s.take() if "404" not in e]


def test_two_landmarks_say_there_is_little_to_check(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    _open_and_pick(pg)
    _mark_all(pg, LANDMARKS[:2])
    _tap(pg, "[data-act=next]")
    pg.wait_for_selector(".vm-dl")
    assert pg.locator("#vmLens").count() == 1   # with two landmarks the lens is a setting, not a result
    assert "assumed" in pg.locator(".vm-dl").inner_text()
    assert "third" in pg.locator(".vm-notes").inner_text()
    assert not [e for e in s.take() if "404" not in e]


def test_phone_layout_and_accessibility(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=390, height=844)
    pg = s.page
    _unit(s)
    pg.click("#uMatch")
    pg.wait_for_selector(".vm-card")
    box = pg.locator(".vm-card").bounding_box()
    stage = pg.locator("#stage").bounding_box()
    assert box["x"] >= stage["x"] - 1 and box["x"] + box["width"] <= stage["x"] + stage["width"] + 1, (box, stage)
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    pg.add_script_tag(path=str(AXE))
    bad = pg.evaluate("async () => (await axe.run('.vm-card', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => v.id + ': ' + v.nodes.length)")
    assert not bad, bad
    _tap(pg, ".vm-thumb:not(.gone) >> nth=0")
    pg.wait_for_function("() => window.__unit3d.match.state.step === 2")
    bad = pg.evaluate("async () => (await axe.run('.vm-card', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => v.id + ': ' + v.nodes.length)")
    assert not bad, bad
    _tap(pg, "[data-act=close]")
    pg.wait_for_selector(".vm-card", state="detached")
    assert not [e for e in s.take() if "404" not in e]


def test_the_wide_layout_docks_the_card_in_the_side_column(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    pg.click("#uMatch")
    pg.wait_for_selector(".vm-card")
    assert pg.evaluate("() => document.querySelector('.vm-card').parentElement.classList.contains('u-side')")
    assert pg.evaluate("() => getComputedStyle(document.querySelector('.u-time')).display") == "none"   # the stage gets the height
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".vm-card", state="detached")
    assert pg.evaluate("() => getComputedStyle(document.querySelector('.u-time')).display") != "none"
