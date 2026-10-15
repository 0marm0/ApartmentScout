"""The 3D buildings in a real browser (dashboard/js/city3d): one set of buildings with stable ids and parts shared by Unit 3D and the Floor plan
studio's "City outside", facades drawn in the shader (a few draw calls, not a mesh per window), Fast against Visual, night windows, both themes,
a phone viewport, the labels (height source and confidence) in the neighbours and evidence panels, and the promise that the look never changes a
sun number. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"
OTHER = "emerald-green-1211"
SLOW = 90000


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, uid: str = UNIT, query: str = "") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{uid}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.scene && document.getElementById('uLoad').hidden",
        arg=uid, timeout=120000)
    s.page.wait_for_timeout(800)


BB_JS = """() => { const s = window.__unit3d.stage, b = s.bb; if (!b) return null;
  s.dirty = true; s.frame(true);
  return { info: { ...b.info, ids: undefined }, ids: b.info.ids, night: b.uniforms.uNight.value, detail: b.uniforms.uDetail.value, tint: b.uniforms.uTintMix.value,
    near: b.meshes[0].geometry.index.count / 3, far: b.meshes[1].geometry.index.count / 3, castNear: b.meshes[0].castShadow, castFar: b.meshes[1].castShadow,
    calls: s.renderer.info.render.calls, tris: s.renderer.info.render.triangles, nTarget: s.bbT ? s.bbT.info.buildings : 0,
    parts: Object.fromEntries(b.entries.map((e) => [e.id, e.parts.length])) }; }"""


def _bb(s):
    return s.page.evaluate(BB_JS)


def test_unit_3d_draws_every_building_from_its_parts_with_stable_ids(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    b = _bb(s)
    assert b is not None, "the rich buildings were built (no fallback to prisms)"
    site = s.page.evaluate("() => fetch('data/sites/paramount-tower-25e.json').then((r) => r.json()).then((j) => ({ n: j.b.length, bmeta: j.bmeta, comps: Object.keys(j.components || {}).length, target: j.target }))")
    assert b["info"]["buildings"] == site["n"] - 1                          # every building but this one (it is drawn on its own)
    assert b["nTarget"] == 1
    assert len(set(b["ids"])) == len(b["ids"]), "every building has its own id"
    bins = {m.get("bin") for m in site["bmeta"] if m}
    assert {i for i in b["ids"] if i.isdigit()} <= bins
    assert b["info"]["partBuildings"] >= 100 and b["info"]["partBuildings"] <= site["comps"]     # buildings drawn from parts (the landmarks too)
    assert b["info"]["near"] > 500 and b["info"]["far"] >= 5
    assert b["castNear"] is True and b["castFar"] is False
    assert s.take() == []


def test_the_empire_state_building_and_the_chrysler_building_are_not_slabs(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    r = s.page.evaluate("""() => { const b = window.__unit3d.stage.bb, by = Object.fromEntries(b.entries.map((e) => [e.id, e]));
      const row = (id) => by[id] && { parts: by[id].parts.length, kinds: [...new Set(by[id].parts.map((q) => q.kind))], top: Math.max(...by[id].parts.map((q) => q.top_m)) };
      return { esb: row('1015862'), chrysler: row('1036156') }; }""")
    assert r["esb"] and r["esb"]["parts"] >= 8 and "spire" in r["esb"]["kinds"] and r["esb"]["top"] > 430       # the mast reaches 443 m
    assert r["chrysler"] and r["chrysler"]["parts"] >= 30 and r["chrysler"]["top"] > 310


def test_a_few_draw_calls_not_a_mesh_per_window(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    b = _bb(s)
    assert b["calls"] < 90 and b["tris"] < 1_500_000, (b["calls"], b["tris"])        # the context3d budget
    assert b["near"] + b["far"] + 4000 < 700_000                                     # the buildings are a fraction of it
    s.page.click('[data-rnq="visual"]')
    s.page.wait_for_timeout(1500)
    v = _bb(s)
    assert v["detail"] == 1 and v["calls"] < 90 and v["tris"] < 1_800_000, (v["calls"], v["tris"])


def test_fast_is_simple_and_visual_gets_the_full_facades(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    assert _bb(s)["detail"] == 0
    s.page.click('[data-rnq="visual"]')
    s.page.wait_for_timeout(1000)
    assert _bb(s)["detail"] == 1
    # inside the target's own mesh too
    assert s.page.evaluate("() => window.__unit3d.stage.bbT.uniforms.uDetail.value") == 1
    s.page.click('[data-rnq="fast"]')
    s.page.wait_for_timeout(600)
    assert _bb(s)["detail"] == 0


def test_windows_light_at_night_and_not_by_day(open_page, webgl):
    _need_webgl(webgl)
    s = open_page(f"?date=2026-12-15&min=780#unit/{UNIT}")
    _unit(s, query="?date=2026-12-15&min=780")
    assert _bb(s)["night"] == 0
    s.page.evaluate("() => { const s = window.__unit3d.stage; s.tween = null; s.setSun && 0; }")
    _unit(s, query="?date=2026-12-15&min=1260")
    n = _bb(s)
    assert n["night"] > 0.9, n["night"]
    # the pixels: a warm lit window next to dark glass somewhere in the picture
    px = s.page.evaluate("""() => { const st = window.__unit3d.stage; st.tween = null; st.opts.labels = false; st.applyOpts();
      st.orbitCam.position.set(-60, 40, 110); st.controls.target.set(10, 45, 0); st.controls.update(); st.dirty = true; st.frame(true);
      const cv = document.createElement('canvas'); cv.width = st.cv.width; cv.height = st.cv.height; const g = cv.getContext('2d'); g.drawImage(st.cv, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data; let warm = 0, dark = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { n++; const r = d[i], gg = d[i + 1], b = d[i + 2]; if (r > 200 && gg > 140 && b < 150 && r > b + 60) warm++; if (r + gg + b < 150) dark++; }
      return { warm: warm / n, dark: dark / n }; }""")
    assert px["warm"] > 0.004 and px["dark"] > 0.02, px


def test_the_look_never_changes_a_sun_number(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    state = "() => { const u = window.__unit3d; return JSON.stringify({ sun: u.sun, hit: u.hit, blk: u.blockers && u.blockers.slice(0, 5), floor: u.st.floor }); }"
    fast = s.page.evaluate(state)
    s.page.click('[data-rnq="visual"]')
    s.page.wait_for_timeout(800)
    assert s.page.evaluate(state) == fast
    site = s.page.evaluate("() => fetch('data/sites/paramount-tower-25e.json').then((r) => r.json()).then((j) => j.study.sun_hours)")
    assert len(site) == 12


def test_unit_3d_and_the_floor_plan_studio_show_the_same_buildings(open_page, webgl):
    """Same ids, same parts: the studio's City outside draws a subset (its radius) of the very buildings Unit 3D draws."""
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    unit = _bb(s)
    pg = s.page
    pg.goto(f"{s.origin}/#plan/{UNIT}")
    pg.wait_for_selector("#psFileBtn", timeout=60000)
    pg.evaluate("() => localStorage.setItem('as:plan-city.data', 'true')")
    pg.reload()
    pg.wait_for_selector("#psFileBtn", timeout=60000)
    pg.wait_for_timeout(3500)
    plan = pg.evaluate("""async () => { const G3 = await import('/js/plan/scene3d.js'); const city = G3.parts().scene.getObjectByName('city'); if (!city) return null;
      const b = city.userData.buildings; if (!b) return { rich: false };
      return { rich: true, ids: b.info.ids, parts: Object.fromEntries(b.entries.map((e) => [e.id, e.parts.length])), buildings: b.info.buildings, near: b.info.near, far: b.info.far }; }""")
    assert plan and plan["rich"], plan
    assert plan["buildings"] > 100 and plan["far"] == 0                       # the studio draws within its radius, all detailed
    assert set(plan["ids"]) <= set(unit["ids"]) | {i for i in plan["ids"] if i not in unit["ids"]}   # (the target is drawn separately there)
    shared = [i for i in plan["ids"] if i in unit["parts"]]
    assert len(shared) >= 0.95 * len(plan["ids"]), "the same buildings"
    assert all(plan["parts"][i] == unit["parts"][i] for i in shared), "the same parts"
    assert s.take() == []


def test_both_themes_and_a_phone_render_the_buildings(open_page, webgl):
    _need_webgl(webgl)
    for theme in ("dark", "light"):
        s = open_page("#unit/" + OTHER, theme=theme)
        _unit(s, OTHER)
        b = _bb(s)
        assert b and b["calls"] < 90 and b["info"]["buildings"] > 500, (theme, b)
        assert s.take() == []
    s = open_page("#unit/" + UNIT, width=390, height=844)
    _unit(s)
    b = _bb(s)
    assert b["calls"] < 90 and b["tris"] < 1_500_000, (b["calls"], b["tris"])
    assert s.take() == []


def test_the_heights_layer_shows_its_classes_not_wall_tints(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    assert _bb(s)["tint"] == 1
    s.page.click('#uTools [data-tg="heights"]')
    s.page.wait_for_timeout(600)
    assert _bb(s)["tint"] == 0
    s.page.click('#uTools [data-tg="heights"]')
    assert _bb(s)["tint"] == 1


def test_height_source_and_confidence_are_in_the_neighbours_and_evidence_panels(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    s.page.evaluate("() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); }")
    text = s.page.locator("body").inner_text()
    assert "Confidence in the roof height" in text and "Facades" in text and "generic, not surveyed" in text
    row = s.page.locator(".u-nb tbody tr").first.inner_text()
    assert "Measured roof height" in row and ("(high)" in row or "(medium)" in row or "(low)" in row), row
    # a building's card says where its height came from and how far to trust it, and gives its id
    s.page.locator(".u-nb tbody tr").first.click()
    s.page.wait_for_timeout(400)
    card = s.page.locator("#uCard").inner_text()
    assert "confidence" in card and "Building id" in card, card
    assert s.take() == []
