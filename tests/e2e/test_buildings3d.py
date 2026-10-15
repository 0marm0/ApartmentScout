"""The 3D buildings in a real browser (dashboard/js/city3d): facades drawn in the shader through the one building mesher (prismsOf / mergeBuildings), parts
with spires and roof shapes for the skyline's landmarks, stable ids, a few draw calls rather than a mesh per window, Fast against Visual, night windows,
both themes, a phone viewport, the labels (height source and confidence) in the neighbours and evidence panels, and the promise that the look never
changes a sun number. tests/e2e/test_one_city.py covers the alignment of the two engines; this file adds that they build the very same meshes. Needs
WebGL, otherwise skipped."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"
OTHER = "emerald-green-1211"


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, uid: str = UNIT, query: str = "") -> None:
    if "mode=" not in query:   # a home with a plan opens Inside by default; these checks are about the city outside
        query = (query + "&" if query else "?") + "mode=orbit"
    s.page.goto(f"{s.origin}/{query}#unit/{uid}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.scene && document.getElementById('uLoad').hidden",
        arg=uid, timeout=120000)
    s.page.wait_for_timeout(800)


# the city of Unit 3D: ids, meshes, uniforms and what is drawn, with the stable id (BIN) and the parts of every building
CITY_JS = """() => { const u = window.__unit3d, s = u.stage, C = s.cityObj, B = u.B; s.dirty = true; s.frame(true);
  const ids = [...C.near, ...C.far].sort((a, b) => a - b), id = (i) => (B[i].meta && (B[i].meta.id || B[i].meta.bin)) || null;
  const verts = {}; for (const [i, [m, a, b]] of C.vrange) verts[i] = b - a;
  return { n: ids.length, near: C.near.length, far: C.far.length, attrs: Object.keys(C.meshes[0].geometry.attributes).sort(), qual: s.facU.uQual.value, tint: s.facU.uTintMix.value,
    night: s.facU.uNight.value, castNear: C.meshes[0].castShadow, castFar: C.meshes[1].castShadow, meshVerts: C.meshes.map((m) => m.geometry.attributes.position.count),
    calls: s.renderer.info.render.calls, tris: s.renderer.info.render.triangles, withParts: ids.filter((i) => B[i].parts).length, stable: ids.map(id), verts,
    target: { parts: B[s.data.ti].parts ? B[s.data.ti].parts.length : 0, attrs: Object.keys(s.tMesh.geometry.attributes).sort() },
    }; }"""

LANDMARK_JS = """(bin) => { const u = window.__unit3d, B = u.B, i = B.findIndex((b) => b.meta && (b.meta.id || b.meta.bin) === bin); if (i < 0) return null;
  const p = B[i].parts || []; return { parts: p.length, kinds: [...new Set(p.map((q) => q.kind))], top: Math.max(0, ...p.map((q) => q.top_m)), roofs: [...new Set(p.map((q) => q.roof).filter(Boolean))] }; }"""


def _city(s):
    return s.page.evaluate(CITY_JS)


def test_unit_3d_draws_every_building_from_its_parts_with_stable_ids(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    c = _city(s)
    site = s.page.evaluate("() => fetch('data/sites/paramount-tower-25e.json').then((r) => r.json()).then((j) => ({ n: j.b.length, bmeta: j.bmeta, comps: Object.keys(j.components || {}).length }))")
    assert c["n"] == site["n"] - 1                                          # every building but this one (it is drawn on its own)
    assert len(set(c["stable"])) == len(c["stable"]) and None not in c["stable"], "every building has its own stable id"
    assert set(c["stable"]) <= {m.get("id") or m.get("bin") for m in site["bmeta"] if m}
    assert 100 <= c["withParts"] <= site["comps"]                          # buildings drawn from parts (the landmarks too)
    assert c["near"] > 500 and c["far"] >= 5 and c["castNear"] is True and c["castFar"] is False
    assert {"position", "normal", "color", "aFa", "aFb"} <= set(c["attrs"]), "the facade attributes the shader reads"
    assert {"position", "normal", "aFa", "aFb"} <= set(c["target"]["attrs"]) and c["target"]["parts"] >= 2, "this building has them too, and its parts"
    assert s.take() == []


def test_the_empire_state_building_and_the_chrysler_building_are_not_slabs(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    esb = s.page.evaluate(f"({LANDMARK_JS})('1015862')")
    chrysler = s.page.evaluate(f"({LANDMARK_JS})('1036156')")
    assert esb and esb["parts"] >= 8 and "spire" in esb["kinds"] and esb["top"] > 430          # the mast reaches 443 m
    assert chrysler and chrysler["parts"] >= 30 and chrysler["top"] > 280 and "dome" in chrysler["roofs"] and "pyramid" in chrysler["roofs"]     # arched crown and spire


def test_a_few_draw_calls_not_a_mesh_per_window(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    c = _city(s)
    assert c["calls"] < 90 and c["tris"] < 1_500_000, (c["calls"], c["tris"])        # the context3d budget
    assert sum(c["meshVerts"]) / 3 < 700_000                                         # the buildings are a fraction of it
    s.page.click('[data-rnq="visual"]')
    s.page.wait_for_timeout(1500)
    v = _city(s)
    assert v["qual"] == 1 and v["calls"] < 90 and v["tris"] < 1_800_000, (v["calls"], v["tris"])


def test_fast_is_simple_and_visual_gets_the_full_facades(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    assert _city(s)["qual"] == 0
    s.page.click('[data-rnq="visual"]')
    s.page.wait_for_timeout(1000)
    assert _city(s)["qual"] == 1
    s.page.click('[data-rnq="fast"]')
    s.page.wait_for_timeout(600)
    assert _city(s)["qual"] == 0


def test_windows_light_at_night_and_not_by_day(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s, query="?date=2026-12-15&min=780")
    assert _city(s)["night"] == 0
    _unit(s, query="?date=2026-12-15&min=1260")
    assert _city(s)["night"] > 0.9
    px = s.page.evaluate("""() => { const st = window.__unit3d.stage; st.tween = null; st.opts.labels = false; st.applyOpts();
      st.orbitCam.position.set(-60, 40, 110); st.controls.target.set(10, 45, 0); st.controls.update(); st.dirty = true; st.frame(true);
      const cv = document.createElement('canvas'); cv.width = st.cv.width; cv.height = st.cv.height; const g = cv.getContext('2d'); g.drawImage(st.cv, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data; let warm = 0, dark = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { n++; const r = d[i], gg = d[i + 1], b = d[i + 2]; if (r > 200 && gg > 140 && b < 150 && r > b + 60) warm++; if (r + gg + b < 150) dark++; }
      return { warm: warm / n, dark: dark / n }; }""")
    assert px["warm"] > 0.004 and px["dark"] > 0.02, px                               # warm lit windows beside dark glass


def test_the_look_never_changes_a_sun_number(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    state = "() => { const u = window.__unit3d; return JSON.stringify({ sun: u.sun, hit: u.hit, blk: u.blockers && u.blockers.slice(0, 5), floor: u.st.floor }); }"
    fast = s.page.evaluate(state)
    s.page.click('[data-rnq="visual"]')
    s.page.wait_for_timeout(800)
    assert s.page.evaluate(state) == fast


def test_unit_3d_and_the_floor_plan_studio_build_the_same_buildings(open_page, webgl):
    """The same ids and, for every building, the same number of vertices: both engines call one mesher on the same prepared buildings and parts."""
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    unit = _city(s)
    pg = s.page
    pg.goto(f"{s.origin}/#plan/{UNIT}")
    pg.wait_for_selector("#psFileBtn", timeout=60000)
    pg.evaluate("() => localStorage.setItem('as:plan-city.data', 'true')")
    pg.reload()
    pg.wait_for_selector("#psFileBtn", timeout=60000)
    pg.wait_for_timeout(3500)
    plan = pg.evaluate("""async () => { const G3 = await import('/js/plan/scene3d.js'), api = G3.cityApi(); if (!api) return null; const C = api.city; const verts = {}; for (const [i, [m, a, b]] of C.vrange) verts[i] = b - a;
      return { n: C.near.length + C.far.length, verts, qual: C.facU.uQual.value, attrs: Object.keys(C.meshes[0].geometry.attributes).sort() }; }""")
    assert plan and plan["n"] == unit["n"] and plan["n"] > 500
    assert plan["verts"] == unit["verts"], "every building has the same vertices in both engines"
    assert {"aFa", "aFb"} <= set(plan["attrs"])
    assert s.take() == []


def test_both_themes_and_a_phone_render_the_buildings(open_page, webgl):
    _need_webgl(webgl)
    for theme in ("dark", "light"):
        s = open_page("#unit/" + OTHER, theme=theme)
        _unit(s, OTHER)
        c = _city(s)
        assert c["calls"] < 90 and c["n"] > 500, (theme, c["calls"], c["n"])
        assert s.take() == []
    s = open_page("#unit/" + UNIT, width=390, height=844)
    _unit(s)
    c = _city(s)
    assert c["calls"] < 90 and c["tris"] < 1_500_000, (c["calls"], c["tris"])
    assert s.take() == []


def test_the_heights_layer_shows_its_classes_not_wall_palettes(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    assert _city(s)["tint"] == 1
    s.page.click('#uTools [data-tg="heights"]')
    s.page.wait_for_timeout(600)
    assert _city(s)["tint"] == 0
    s.page.click('#uTools [data-tg="heights"]')
    assert _city(s)["tint"] == 1


def test_height_source_and_confidence_are_in_the_neighbours_and_evidence_panels(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    s.page.evaluate("() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); }")
    text = s.page.locator("body").inner_text()
    assert "Confidence in the roof height" in text and "Facades" in text and "generic, not surveyed" in text
    row = s.page.locator(".u-nb tbody tr").first.inner_text()
    assert "Measured roof" in row and ("(high)" in row or "(medium)" in row or "(low)" in row), row
    s.page.locator(".u-nb tbody tr").first.click()
    s.page.wait_for_timeout(400)
    card = s.page.locator("#uCard").inner_text()
    assert "confidence" in card and "Building id" in card, card
    assert s.take() == []
