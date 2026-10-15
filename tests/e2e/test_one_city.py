"""One city, one room: Unit 3D's Inside and Window cameras and the Floor plan studio's eye-level views draw the SAME city (every building by id,
at the same place, with the same material, sky, haze and context) and the same bright room (palette, light, tone mapping, windows without a
horizontal bar), standing at the same viewpoint. The alignment check stands each engine's camera at the same chip, converts both to the site frame and
compares the buildings' roofs by id and by where they land on the screen. Also: the "What's measured vs assumed" chip in both engines, the studio's
way into Unit 3D, and the shared daylight map and blinds. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import math

import pytest
from conftest import settled

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"
DATE = "2026-06-21"


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


# Resolves when the camera has not moved for six frames running: the glide to a chip is over (what a fixed sleep stood in for).
CAMERA_STILL_JS = """async (getCam) => {
  const get = await (async () => { if (getCam === 'studio') { const G3 = await import('/js/plan/scene3d.js'); return () => G3.getCamera(); } return () => window.__unit3d.stage.winCam; })();
  let last = null, still = 0;
  return await new Promise((resolve) => { const t0 = performance.now(); const tick = () => {
    const c = get(), p = [...c.position.toArray(), c.fov, ...(c.getWorldDirection ? c.getWorldDirection(new c.position.constructor()).toArray() : [])];
    still = last && p.every((v, i) => Math.abs(v - last[i]) < 1e-6) ? still + 1 : 0; last = p;
    if (still >= 6 || performance.now() - t0 > 20000) resolve(still >= 6); else requestAnimationFrame(tick); }; tick(); });
}"""


def _camera_still(pg, engine: str) -> None:
    assert pg.evaluate(CAMERA_STILL_JS, engine), f"the {engine} camera never came to rest"
    settled(pg, 20000, ticks=3)


def _studio(s, chip: str = "room:Living", extra: str = "") -> None:
    pg = s.page
    pg.goto(f"{s.origin}/?date={DATE}&pmin=780{extra}#plan/{UNIT}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
    pg.click('#psMode [data-m="3d"]')
    pg.click(f"#psLook [data-vp^='{chip}']")
    pg.wait_for_function("() => window.__plan3d.eye === 'eye' && window.__plan3d.hasCity", timeout=60000)
    pg.wait_for_function("""async () => { const api = (await import('/js/plan/scene3d.js')).cityApi(); return !!api && api.city.near.length + api.city.far.length > 500; }""", timeout=60000)
    _camera_still(pg, "studio")


def _unit(s, chip: str = "room:Living", date: str = DATE, minute: int = 780) -> None:
    pg = s.page
    pg.goto(f"{s.origin}/?mode=inside&date={date}&min={minute}#unit/{UNIT}")
    pg.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && document.getElementById('uLoad').hidden",
        arg=UNIT, timeout=120000)
    pg.click(f"#uLook [data-vp^='{chip}']")
    pg.wait_for_function("() => !window.__unit3d.stage.inTween", timeout=20000)
    _camera_still(pg, "unit")
    pg.evaluate("() => { const s = window.__unit3d.stage; s.dirty = true; s.frame(true); }")


# the camera, the roofs of the buildings (by id) and the materials, all in the SITE frame (metres, x east, y up, -z north)
STUDIO_JS = """async () => {
  const G3 = await import('/js/plan/scene3d.js'), THREE = await import('three'), api = G3.cityApi(), C = api.city, p = G3.parts();
  const cam = G3.getCamera(); cam.updateMatrixWorld(true);
  const inv = C.bakeM.clone().invert(), pos = cam.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), dir = cam.getWorldDirection(new THREE.Vector3()).transformDirection(inv);
  const roofs = {};
  for (const [id, [m, a, b]] of C.vrange) { const P = m.geometry.attributes.position, v = new THREE.Vector3(); let best = null; for (let i = a; i < b; i++) { v.fromBufferAttribute(P, i).applyMatrix4(inv); if (!best || v.y > best[1]) best = [v.x, v.y, v.z]; } roofs[id] = best; }
  const sky = p.scene.getObjectByName('sky'), u = sky.material.uniforms, bm = C.bMat;
  return { pose: { p: pos.toArray(), d: dir.toArray(), fov: cam.fov, aspect: cam.aspect }, roofs, ids: [...C.near, ...C.far].sort((x, y) => x - y),
    mat: { color: bm.color.getHex(), rough: bm.roughness, vc: bm.vertexColors, key: bm.customProgramCacheKey() },
    sky: { zen: u.zen.value.getHex(), hor: u.hor.value.getHex() }, fog: p.scene.fog ? [p.scene.fog.color.getHex(), p.scene.fog.near, p.scene.fog.far] : null,
    light: { hemi: p.hemi.intensity, amb: p.amb.intensity, sun: p.sunL.intensity, tone: p.renderer.toneMapping, exposure: p.renderer.toneMappingExposure },
    ctx: C.ctx ? { trees: C.ctx.info.trees, water: C.ctx.info.waterBodies, streets: C.ctx.info.streets } : null,
    calls: p.renderer.info.render.calls, tris: p.renderer.info.render.triangles };
}"""

UNIT_JS = """async () => {
  const THREE = await import('three'), st = window.__unit3d.stage, C = st.cityObj, cam = st.winCam; cam.updateMatrixWorld(true);
  const pos = cam.getWorldPosition(new THREE.Vector3()), dir = cam.getWorldDirection(new THREE.Vector3());
  const roofs = {};
  for (const [id, [m, a, b]] of C.vrange) { const P = m.geometry.attributes.position; let best = null; for (let i = a; i < b; i++) { const y = P.getY(i); if (!best || y > best[1]) best = [P.getX(i), y, P.getZ(i)]; } roofs[id] = best; }
  const u = st.skyU, bm = C.bMat;
  return { pose: { p: pos.toArray(), d: dir.toArray(), fov: cam.fov, aspect: cam.aspect }, roofs, ids: [...C.near, ...C.far].sort((x, y) => x - y),
    mat: { color: bm.color.getHex(), rough: bm.roughness, vc: bm.vertexColors, key: bm.customProgramCacheKey() },
    sky: { zen: u.zen.value.getHex(), hor: u.hor.value.getHex() }, fog: [st.scene.fog.color.getHex(), st.scene.fog.near, st.scene.fog.far],
    light: { hemi: st.hemi.intensity, amb: st.amb.intensity, sun: st.sunL.intensity, tone: st.renderer.toneMapping, exposure: st.renderer.toneMappingExposure },
    ctx: C.ctx ? { trees: C.ctx.info.trees, water: C.ctx.info.waterBodies, streets: C.ctx.info.streets } : null,
    calls: st.renderer.info.render.calls, tris: st.renderer.info.render.triangles };
}"""


def _angles(pose: dict, pt: list[float]) -> tuple[float, float] | None:
    """Horizontal and vertical angle (degrees) of a site-frame point from a camera pose: where it lands on the screen, independent of the canvas size."""
    d = pose["d"]
    v = [pt[i] - pose["p"][i] for i in range(3)]
    n = math.sqrt(sum(x * x for x in v))
    if n < 1e-6:
        return None
    v = [x / n for x in v]
    fwd = d
    if sum(a * b for a, b in zip(v, fwd)) < 0.35:
        return None                                    # behind the camera or far off to the side
    right = [-fwd[2], 0.0, fwd[0]]
    rn = math.hypot(right[0], right[2]) or 1.0
    right = [right[0] / rn, 0.0, right[2] / rn]
    up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]]
    x, y, z = (sum(a * b for a, b in zip(v, axis)) for axis in (right, up, fwd))
    return math.degrees(math.atan2(x, z)), math.degrees(math.atan2(y, z))


def _compare(studio: dict, unit: dict) -> dict:
    ids = sorted(set(studio["roofs"]) & set(unit["roofs"]), key=int)
    d_roof = max(math.dist(studio["roofs"][i], unit["roofs"][i]) for i in ids)
    errs = []
    for i in ids:
        a, b = _angles(unit["pose"], unit["roofs"][i]), _angles(studio["pose"], studio["roofs"][i])
        if a and b:
            errs.append(math.hypot(a[0] - b[0], a[1] - b[1]))
    # at a 1440 px wide, 78-degree-wide frame, one degree is about 18 px
    px = [e * 1440 / 78 for e in errs]
    return {"n": len(ids), "roof_m": d_roof, "seen": len(errs), "px_max": max(px) if px else None, "px_p95": sorted(px)[int(len(px) * 0.95) - 1] if px else None,
            "cam_m": math.dist(studio["pose"]["p"], unit["pose"]["p"]),
            "cam_deg": math.degrees(math.acos(max(-1, min(1, sum(a * b for a, b in zip(studio["pose"]["d"], unit["pose"]["d"])))))), "fov": (studio["pose"]["fov"], unit["pose"]["fov"])}


@pytest.mark.parametrize("chip", ["room:Living", "bay:", "room:Bedroom", "seat:sofa"])
def test_the_same_buildings_stand_at_the_same_places_in_both_engines(open_page, webgl: bool, chip: str) -> None:
    """Every building has the same id and the same roof position (to a millimetre) in both engines, the cameras stand at the same point looking the same
    way, and the roofs land on the same place of the screen: a few pixels, at most."""
    _need_webgl(webgl)
    a = open_page("#plan/" + UNIT)
    _studio(a, chip)
    studio = a.page.evaluate(STUDIO_JS)
    b = open_page("#unit/" + UNIT)
    _unit(b, chip)
    unit = b.page.evaluate(UNIT_JS)
    assert studio["ids"] == unit["ids"] and len(unit["ids"]) > 500                       # the same set of buildings (by id), the whole site model
    c = _compare(studio, unit)
    print("one-city alignment", chip, {k: (round(v, 4) if isinstance(v, float) else v) for k, v in c.items()})   # pytest -s shows the measured numbers
    assert c["roof_m"] < 0.002, c                                                         # every roof within 2 mm of itself in the site frame
    assert c["cam_m"] < 0.03 and c["cam_deg"] < 0.2, c                                    # the same eye point and direction (3 cm, 0.2 degrees)
    assert c["fov"][0] == c["fov"][1], c
    assert c["seen"] > 20 and c["px_p95"] < 5 and c["px_max"] < 8, c                      # the same buildings land on the same pixels, within a few
    assert not a.take() and not b.take()


# the skyline each engine really draws: the city alone (the room hidden), 800 x 500 px, the first non-sky pixel of every fourth column
SKYLINE_JS = """async (mode) => {
  const W = 800, H = 500;
  let r, scene, cam, hide = [], draw;
  if (mode === 'studio') { const G3 = await import('/js/plan/scene3d.js'), p = G3.parts(); r = p.renderer; scene = p.scene; cam = G3.getCamera(); hide = [p.shell, p.furn, p.overlay, scene.getObjectByName('city').getObjectByName('city-edges')]; draw = () => G3.render(true); }
  else { const st = window.__unit3d.stage; r = st.renderer; scene = st.scene; cam = st.winCam; hide = [st.interior.group, st.tMesh, st.marker, st.band, st.cmpBand, st.cmpBand2, st.rings, st.edges]; draw = () => { st.sky.position.copy(cam.position); r.render(scene, cam); }; }
  const keep = hide.map((o) => o.visible); hide.forEach((o) => { o.visible = false; });
  r.setPixelRatio(1); r.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
  draw();
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(r.domElement, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, prof = [];
  for (let x = 0; x < W; x += 4) { let y = 0; for (; y < H; y++) { const i = (y * W + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2]; if (!(B > R + 35 && B >= G)) break; } prof.push(y); }
  hide.forEach((o, i) => { o.visible = keep[i]; });
  return prof;
}"""


@pytest.mark.parametrize("chip", ["room:Living", "bay:"])
def test_the_skyline_drawn_by_both_engines_is_the_same(open_page, webgl: bool, chip: str) -> None:
    """Not just the numbers: render the city alone from the same viewpoint at the same size in both engines and compare the skylines (the first non-sky
    pixel of every fourth column). Different tone mapping and shadows cannot move a roof, so the profiles agree to a few pixels of 500."""
    _need_webgl(webgl)
    a = open_page("#plan/" + UNIT)
    _studio(a, chip)
    ps = a.page.evaluate(SKYLINE_JS, "studio")
    b = open_page("#unit/" + UNIT)
    _unit(b, chip)
    pu = b.page.evaluate(SKYLINE_JS, "unit")
    assert len(ps) == len(pu) == 200
    diff = [abs(x - y) for x, y in zip(ps, pu)]
    mean, p95 = sum(diff) / len(diff), sorted(diff)[int(len(diff) * 0.95)]
    print("skyline", chip, "mean px", round(mean, 2), "p95", p95, "relief", max(ps) - min(ps))
    assert max(ps) - min(ps) > 40, "the skyline has some relief (it saw a city)"
    assert mean < 3 and p95 < 10, (mean, p95)
    assert not a.take() and not b.take()


def test_same_material_sky_haze_context_and_light(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    a = open_page("#plan/" + UNIT)
    _studio(a)
    studio = a.page.evaluate(STUDIO_JS)
    b = open_page("#unit/" + UNIT)
    _unit(b)
    unit = b.page.evaluate(UNIT_JS)
    assert studio["mat"] == unit["mat"]                                                   # the same city material (vertex colours by height, the facade shader)
    assert studio["sky"] == unit["sky"]                                                   # the same sky at the same hour
    assert studio["fog"][1:] == unit["fog"][1:] and studio["fog"][0] == unit["fog"][0]    # and the same haze
    assert studio["ctx"] == unit["ctx"] and studio["ctx"]["trees"]["total"] > 1500 and studio["ctx"]["water"] >= 1
    s, u = studio["light"], unit["light"]
    assert s["tone"] == u["tone"] and s["tone"] != 0 and s["exposure"] == u["exposure"]   # tone-mapped the same, not left raw
    assert abs(s["hemi"] - u["hemi"]) < 1e-6 and abs(s["amb"] - u["amb"]) < 1e-6
    assert u["hemi"] >= 1.5 and u["amb"] >= 0.4                                           # a hemisphere sky light and a bounce fill: never murky
    assert abs(s["sun"] - u["sun"]) < 0.5, (s, u)


def test_both_rooms_are_the_same_bright_room_without_a_bar_across_the_window(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    probe = """async () => {
      const THREE = await import('three'), root = ROOT;
      const win = [], walls = [], floors = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const c = o.material && o.material.color ? o.material.color.getHex() : null;
        if (c === 0x3b3a38) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox, w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y; win.push({ w, h, y: o.position.y, rotY: o.rotation.y }); }
        if (o.name === 'wall' && o.material.color && o.visible !== false && o.material.colorWrite !== false) walls.push(o.material.color.getHex());
        if (o.name.startsWith('floor:')) floors.push(o.material.map ? 1 : 0);
      });
      const ceil = []; root.traverse((o) => { if (o.isMesh && o.name.startsWith('ceiling:') && o.material.color) ceil.push(o.material.color.getHex()); });
      return { frame: win.length, wide: win.filter((m) => m.w > 0.3 && m.h < 0.08 && m.y > 0.6 && m.y < 2.2).length, thin: win.every((m) => Math.min(m.w, m.h, 0.06) <= 0.06), walls: [...new Set(walls)], ceil: [...new Set(ceil)], floors: floors.length };
    }"""
    a = open_page("#plan/" + UNIT, theme="dark")
    _studio(a)
    st = a.page.evaluate(probe.replace("ROOT", "(await import('/js/plan/scene3d.js')).parts().shell"))
    b = open_page("#unit/" + UNIT, theme="dark")
    _unit(b)
    un = b.page.evaluate(probe.replace("ROOT", "window.__unit3d.stage.interior.group"))
    for r in (st, un):
        assert r["frame"] > 8                                                             # a frame exists: sill and head members and posts
        assert r["wide"] == 0, r                                                          # no horizontal bar across the glass between the sill and the head
        assert r["walls"] == [0xf7f4ef] and r["ceil"] == [0xffffff]                       # bright white walls and ceiling
    assert st["walls"] == un["walls"] and st["ceil"] == un["ceil"] and st["floors"] == un["floors"]
    # the same room in the light theme is the same paint (the dark-room look is gone from both)
    c = open_page("#unit/" + UNIT, theme="light")
    _unit(c)
    assert c.page.evaluate(probe.replace("ROOT", "window.__unit3d.stage.interior.group"))["walls"] == [0xf7f4ef]


def test_the_chips_and_the_seats_behave_the_same_in_both_engines(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    a = open_page("#plan/" + UNIT)
    _studio(a)
    names = lambda pg, root: pg.evaluate("(r) => [...document.querySelectorAll(r + ' .lk-chip')].map((b) => b.textContent.trim())", root)   # noqa: E731
    st = names(a.page, "#psLook")
    b = open_page("#unit/" + UNIT)
    _unit(b)
    un = names(b.page, "#uLook")
    assert st == un[: len(st)] and st[:7] == ["Living room", "Bay", "Bedroom", "Corner", "Sofa", "Bed", "Desk"]
    # the sofa chip: the same seat (40 in eye height) in both, and the same eye point in the site frame
    a.page.click("#psLook [data-vp='seat:sofa']")
    a.page.wait_for_function("() => window.__plan3d.view === 'seat:sofa'")
    _camera_still(a.page, "studio")
    b.page.click("#uLook [data-vp='seat:sofa']")
    b.page.wait_for_function("() => window.__unit3d.curView.seat === 'sofa' && !window.__unit3d.stage.inTween", timeout=20000)
    _camera_still(b.page, "unit")
    b.page.evaluate("() => { const s = window.__unit3d.stage; s.dirty = true; s.frame(true); }")
    ps, pu = a.page.evaluate(STUDIO_JS)["pose"], b.page.evaluate(UNIT_JS)["pose"]
    assert math.dist(ps["p"], pu["p"]) < 0.03 and ps["fov"] == pu["fov"]
    assert not a.take() and not b.take()


def test_accuracy_chip_in_both_engines_links_to_the_evidence(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    rows = "() => [...document.querySelectorAll('.acc-list li')].map((li) => li.querySelector('b').textContent + '|' + li.querySelector('.acc-pill').textContent)"
    expect = ["Building heights|from a source", "Facade bearing|measured", "Position along the facade|assumed", "Floor height|estimated", "Floor plan|from a source", "Furniture|confirmed"]
    a = open_page("#plan/" + UNIT)
    _studio(a)
    a.page.wait_for_function("() => document.querySelectorAll('.acc-chip:not([hidden]) .acc-dots i').length === 6")
    a.page.wait_for_function("() => document.querySelector('.acc-list li[data-row=furniture] .acc-pill')?.textContent === 'confirmed'")
    assert a.page.evaluate(rows) == expect
    assert a.page.locator(".acc-chip").inner_text().startswith("What's measured vs assumed")
    a.page.click(".acc-btn")
    assert a.page.evaluate("() => !document.querySelector('.acc-pop').hidden")
    a.page.click(".acc-open")
    a.page.wait_for_function(f"() => location.hash === '#unit/{UNIT}'")
    b = open_page("#unit/" + UNIT)
    _unit(b)
    b.page.wait_for_function("() => document.querySelector('.acc-list li[data-row=furniture] .acc-pill')?.textContent === 'confirmed'")
    assert b.page.evaluate(rows) == expect                                               # the same six rows in the same states
    b.page.click(".acc-btn")
    b.page.click(".acc-open")
    assert b.page.evaluate("() => { const r = document.getElementById('evPanel').getBoundingClientRect(); return r.top < innerHeight; }")   # it scrolled to the evidence panel
    assert not a.take() and not b.take()


def test_studio_eye_view_reaches_unit_3d_numbers_and_the_same_view_there(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    a = open_page("#plan/" + UNIT)
    _studio(a)
    txt = a.page.locator("#psLook .lk-extra").inner_text()
    assert "SUN TODAY" in txt.upper() and "of direct sun through the living room window today" in txt
    assert a.page.evaluate("() => document.querySelectorAll('#psLook .rc-strip i').length") >= 1
    a.page.click('#psLook [data-act="unit-sun"]')
    a.page.wait_for_function(f"() => location.hash === '#unit/{UNIT}'")
    a.page.wait_for_function("() => window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.interior && document.getElementById('uLoad').hidden", timeout=120000)
    got = a.page.evaluate("() => ({ mode: window.__unit3d.st.mode, date: window.__unit3d.st.date, min: window.__unit3d.st.min })")
    assert got == {"mode": "in", "date": DATE, "min": 780}                                # the Inside camera at the same date and time


def test_unit_inside_shows_the_studios_blinds_and_daylight_map(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    b = open_page("#unit/" + UNIT)
    _unit(b)
    assert b.page.evaluate("() => !!document.querySelector('#uLook [data-act=dl]') && !!document.querySelector('#uLook [data-act=blinds]')")
    before = b.page.evaluate("() => window.__unit3d.stage.sunL.intensity")
    b.page.select_option('#uLook [data-act="blinds"]', "closed")                          # the studio's saved blinds, written where the studio reads them
    b.page.wait_for_function("(b) => window.__unit3d.stage.sunL.intensity < b * 0.2", arg=before, timeout=10000)
    assert b.page.evaluate("() => window.__unit3d.stage.sunL.intensity") < before * 0.2
    assert "closed" in b.page.evaluate("() => localStorage.getItem('as:plan-light.data.paramount-tower-25e')")
    b.page.click('#uLook [data-act="dl"]')
    b.page.wait_for_function("() => !!window.__unit3d.stage.interior.group.getObjectByName('floor-tint')")
    assert b.page.evaluate("() => window.__unit3d.stage.interior.group.getObjectByName('floor-tint').children.length") >= 2
    assert not b.take()


def test_lamps_come_on_at_night_in_both_engines_and_fast_stays_light(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    b = open_page("#unit/" + UNIT, width=390, height=844)
    _unit(b, date="2026-12-21", minute=1140)
    st = b.page.evaluate("() => ({ st: window.__unit3d.stage.roomState, calls: window.__unit3d.stage.renderer.info.render.calls, tris: window.__unit3d.stage.renderer.info.render.triangles, tone: window.__unit3d.stage.renderer.toneMapping })")
    assert st["st"]["lamps"] == 1 and st["st"]["sunI"] == 0 and st["st"]["tone"] == "reinhard" and st["tone"] != 0     # Fast: a gentle curve, warm lamps
    assert st["calls"] < 220 and st["tris"] < 1_500_000, st                                # a phone's budget
    assert not b.take()
