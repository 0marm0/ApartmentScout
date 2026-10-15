"""The look of the outdoors and the room's surfaces in both 3D engines at eye level: Unit 3D's Inside camera and the Floor plan studio's
eye cameras show the same city (one builder, facades), a bright natural sky, greenery where it really is, a textured wood floor and
windows with no horizontal bar across the glass. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import look_click, look_open

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"
PLAN = json.loads((Path(__file__).resolve().parents[2] / "dashboard" / "data" / "plans" / f"{UNIT}.json").read_text())
# the frame colour the plan's finishes name (read from the unit's photos), else the default bronze
FRAME_HEX = int((PLAN.get("finishes", {}).get("window_frames", {}).get("colour") or "#3b3a38")[1:], 16)
FLOOR_TONE = tuple(int(PLAN["finishes"]["floor"]["tone"][i:i + 2], 16) for i in (1, 3, 5))

# the share of the picture that shows the outside: render, hide sky + sun + city + context, render again, count the cells that changed
OUTSIDE_JS = """() => {
  const st = window.__unit3d.stage, cv = st.cv, W = 96, H = 48, off = document.createElement('canvas'); off.width = W; off.height = H;
  const g = off.getContext('2d', { willReadFrequently: true });
  const grab = () => { st.frame(true); g.drawImage(cv, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
  const a = grab(), hide = [st.cityObj.group, st.sky, st.sunDisc, st.sunGlow, st.ctx && st.ctx.group].filter(Boolean), was = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; }); const bg = st.scene.background; st.scene.background = null;
  const b = grab();
  hide.forEach((o, i) => { o.visible = was[i]; }); st.scene.background = bg; st.dirty = true; st.frame(true);
  let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 36) n++;
  return n / (W * H);
}"""

# trees in the camera's frustum that no wall, floor, ceiling or building hides from the eye (their crown tops, sampled)
TREES_JS = """async () => {
  const st = window.__unit3d.stage, cam = st.activeCam(); cam.updateMatrixWorld(true);
  const V3 = cam.position.constructor, trees = st.ctx.parts.trees, THREE = await import('three'), ray = new THREE.Raycaster();
  const blockers = [...(st.interior.blockers || []), ...st.city];
  let inView = 0, seen = 0;
  for (const name of ['tree-crowns-near', 'tree-crowns-far', 'tree-cones']) {
    const m = trees.getObjectByName(name); if (!m) continue; const a = m.instanceMatrix.array;
    for (let i = 0; i < m.count; i++) {
      const p = new V3(a[i * 16 + 12], a[i * 16 + 13] + 4, a[i * 16 + 14]).applyMatrix4(trees.matrixWorld), n = p.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
      if (!(Math.abs(n.x) < 1 && Math.abs(n.y) < 1 && n.z > -1 && n.z < 1)) continue;
      if (++inView > 600) continue;
      const d = p.clone().sub(cam.position), L = d.length(); ray.set(cam.position, d.normalize()); ray.far = L - 0.5;
      if (!ray.intersectObjects(blockers, false).length) seen++;
    }
  }
  return { inView, seen };
}"""

# horizontal frame members of every window of an engine's room, as heights above the floor (metres), and the window's own sill and head
BARS_JS = """(root, frameHex) => {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || o.name === 'glass' || o.name === 'glass-sheen' || !o.geometry?.parameters) return;
    let a = o.parent, inWindows = false; while (a) { if (a.name === 'interior detail') { inWindows = true; break; } a = a.parent; }
    if (!inWindows) return;                                                                            // (the room's architecture, not the furniture)
    const p = o.geometry.parameters, m = o.material;
    if (p.width === undefined || p.height === undefined || !m?.color || Math.abs(m.color.getHex() - frameHex) > 0x030303) return;   // the plan's frame colour
    if (p.width > p.height * 4 && p.width > 0.3) out.push({ y: o.position.y, h: p.height, w: p.width });
  });
  return out;
}"""


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, query: str) -> None:
    s.page.goto(f"{s.origin}/?{query}#unit/{UNIT}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && document.getElementById('uLoad').hidden",
        arg=UNIT, timeout=120000)
    s.page.wait_for_timeout(800)


def _look(pg, chip: str) -> None:
    look_click(pg, f"#uLook .lk-chip:has-text('{chip}')")
    pg.wait_for_timeout(1200)


def _studio(s) -> None:
    pg = s.page
    pg.goto(f"{s.origin}/?date=2026-10-15&pmin=720#plan/{UNIT}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
    pg.wait_for_timeout(800)


# ------------------------------------------------------------------------------------------------ the Inside camera shows the outdoors

@pytest.mark.parametrize("query", ["date=2026-10-15&min=720&mode=inside", "date=2026-10-15&min=1110&mode=inside", "date=2026-10-15&min=1260&mode=inside"])
def test_inside_camera_renders_the_city_through_the_windows(open_page, webgl: bool, query: str) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, query)
    pg = s.page
    shares = {}
    for chip in ("Living room", "Bay", "Bedroom", "Corner", "Desk"):
        _look(pg, chip)
        shares[chip] = pg.evaluate(OUTSIDE_JS)
    # a window-facing view is a good part outside (the sky, the buildings, the park): a wall or an opaque pane would give nothing
    # (the seat views look into the room, so how much of them is outside depends on the shape of the stage: only the windows are held to it)
    assert all(v > 0.08 for k, v in shares.items() if k != "Desk"), shares
    assert pg.evaluate("() => window.__unit3d.stage.city.length >= 2 && window.__unit3d.stage.city.every((m) => m.visible && m.geometry.attributes.position.count > 1000)")
    assert not s.take()


def test_inside_camera_sees_the_city_in_visual_quality_too(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg = s.page
    pg.evaluate("() => { const b = [...document.querySelectorAll('button')].find((x) => /^Visual$/.test(x.textContent.trim()) && x.offsetParent); if (b) b.click(); }")
    pg.wait_for_timeout(3000)
    _look(pg, "Living room")
    assert pg.evaluate(OUTSIDE_JS) > 0.15
    assert not s.take()


def test_greenery_is_in_view_from_the_windows_where_it_really_is(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg = s.page
    info = pg.evaluate("() => { const c = window.__unit3d.stage.ctx; return { trees: c.info.trees.total, parts: c.info.patches, layers: window.__unit3d.stage.opts }; }")
    assert info["trees"] > 1500 and info["parts"] > 50, info      # the 25E site file has a park and street-tree inventory: they are in the context layer
    assert info["layers"]["green"] and info["layers"]["streetTrees"] and info["layers"]["parkTrees"]
    for chip in ("Living room", "Bay", "Corner", "Bedroom"):
        _look(pg, chip)
        seen = pg.evaluate(TREES_JS)
        assert seen["seen"] >= 25, (chip, seen)   # crowns the eye can see over the sill, between the towers: the street trees and the park
    assert not s.take()


# ------------------------------------------------------------------------------------------------ one sky, one city, one floor in both engines

def test_eye_level_sky_is_a_bright_daylight_sky_in_both_engines(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg = s.page
    sky = pg.evaluate("""() => { const st = window.__unit3d.stage, U = st.skyU, lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      return { daylight: st.pal.daylight, hor: lum(U.hor.value), zen: lum(U.zen.value), blueZen: U.zen.value.b > U.zen.value.r * 1.5, glow: U.glow.value }; }""")
    assert sky["daylight"] and sky["hor"] > 0.55 and sky["zen"] > 0.2 and sky["blueZen"] and sky["glow"] == 1, sky   # a pale hazy horizon, a clear blue overhead, the sun's haze on
    _studio(s)
    look_click(pg, "#psLook .lk-chip:has-text('Living room')")
    pg.wait_for_timeout(1500)
    st = pg.evaluate("() => { const sc = window.__plan3d.parts.scene, d = sc.getObjectByName('sky'), U = d.material.uniforms, lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; return { vis: d.visible, hor: lum(U.hor.value), zen: lum(U.zen.value), blueZen: U.zen.value.b > U.zen.value.r * 1.5 }; }")
    assert st["vis"] and st["hor"] > 0.55 and st["zen"] > 0.2 and st["blueZen"], st
    assert not s.take()


def test_the_studio_and_unit_3d_draw_the_same_buildings_from_one_builder(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg = s.page
    unit = pg.evaluate("() => window.__unit3d.stage.city.flatMap((m) => Array.from(m.userData.ids)).sort((a, b) => a - b)")
    assert len(unit) > 500
    _studio(s)
    look_click(pg, "#psLook .lk-chip:has-text('Living room')")
    pg.wait_for_timeout(1500)
    studio = pg.evaluate("""() => { const api = window.__plan3d.cityApi; if (!api) return null; const C = api.city;
      return { names: C.meshes.map((m) => m.name), facade: !!C.bMat.userData.facade || C.facU.uQual !== undefined, ids: C.meshes.flatMap((m) => Array.from(m.userData.ids)).sort((a, b) => a - b), uToSite: !!C.facU.uToSite }; }""")
    assert studio is not None
    assert studio["names"] == ["neighbours", "neighbours-far"] and studio["facade"] and studio["uToSite"]   # city3d/city.js createCity, with the facade shader's uniforms
    assert studio["ids"] == unit                                                                          # the very same buildings, by the same ids
    assert not s.take()


def test_the_floor_is_textured_honey_parquet_in_both_engines_and_both_qualities(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    probe = """(root) => { const out = []; root.traverse((o) => { if (o.isMesh && o.name.startsWith('floor: Living') && o.material.map) { const t = o.material.map, c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); g.drawImage(t.image, 0, 0, 64, 64, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data; let r = 0, gg = 0, b = 0, n = 0, lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; const l = (d[i] + d[i + 1] + d[i + 2]) / 3; lo = Math.min(lo, l); hi = Math.max(hi, l); }
      out.push({ size: t.image.width, bump: !!o.material.bumpMap, mean: [r / n, gg / n, b / n].map(Math.round), spread: hi - lo }); } }); return out; }"""
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg = s.page
    for quality in ("Fast", "Visual"):
        pg.evaluate("(q) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === q && x.offsetParent); if (b) b.click(); }", quality)
        pg.wait_for_timeout(1500)
        unit = pg.evaluate(f"() => ({probe})(window.__unit3d.stage.interior.group)")
        assert unit and unit[0]["bump"] and unit[0]["size"] >= 1024, (quality, unit)
        r, g, b = unit[0]["mean"]
        assert r > g > b and all(abs(c - t) < 30 for c, t in zip(unit[0]["mean"], FLOOR_TONE)) and unit[0]["spread"] > 20, (quality, unit, FLOOR_TONE)   # the plan's honey wood (read from its photos) with grain and joints, not one flat tone
    _studio(s)
    st = pg.evaluate(f"() => ({probe})(window.__plan3d.parts.scene)")
    assert st and st[0]["bump"] and st[0]["size"] >= 1024 and all(abs(c - t) < 30 for c, t in zip(st[0]["mean"], FLOOR_TONE)), (st, FLOOR_TONE)
    assert not s.take()


def test_no_window_has_a_horizontal_bar_across_the_glass_in_either_engine(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg = s.page
    unit = pg.evaluate(f"() => ({BARS_JS})(window.__unit3d.stage.interior.group, {FRAME_HEX})")
    _studio(s)
    look_click(pg, "#psLook .lk-chip:has-text('Living room')")   # (the bird's-eye view cuts the walls, and the window's head member with them: eye-level views draw full-height windows)
    pg.wait_for_timeout(1500)
    studio = pg.evaluate(f"() => ({BARS_JS})(window.__plan3d.parts.scene, {FRAME_HEX})")
    # 25E: windows from sill 20 in to head 94 in. Frame members may only be the sill (at 0.5 m) and the head (at 2.4 m): nothing in between
    for name, bars in (("unit", unit), ("studio", studio)):
        assert bars, name
        assert all(b["y"] < 0.6 or b["y"] > 2.3 for b in bars), (name, [b for b in bars if 0.6 <= b["y"] <= 2.3])
    assert not s.take()


def test_inside_camera_always_stands_in_the_room_or_at_the_window(open_page, webgl: bool) -> None:
    """Whatever state the camera was left in (no standing point yet, no room built), Inside never sits at the ground with no view out."""
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg = s.page
    height = "() => window.__unit3d.stage.activeCam().position.y"
    room_y = pg.evaluate(height)
    assert room_y > 50                                                  # floor 24: about 72 m up
    pg.evaluate("() => { const s = window.__unit3d.stage; s.inEye = null; s.dirty = true; s.frame(true); }")
    assert abs(pg.evaluate(height) - room_y) < 3 and pg.evaluate(OUTSIDE_JS) > 0.05, "no standing point: it takes the first window's"
    pg.evaluate("() => { const s = window.__unit3d.stage, i = s.interior; s.inEye = null; s.interior = null; s.dirty = true; s.frame(true); s.interior = i; }")
    assert pg.evaluate(height) > 50, "no room: it looks out of the window like the Window camera"
    assert not s.take()
