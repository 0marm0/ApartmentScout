"""The city context in a real browser: the NYC street tree census and the NYC Parks inventory as instanced trees in two levels of
detail, the street / sidewalk plate, the grass of parks and lawns, the blue water plane and the river and park labels, in Unit 3D
and in the Floor plan studio's "City outside". Checks what the renter is told (trees and water are context only, never shade; street
trees come from the 2015 census, park trees from the Parks inventory), the separate street-tree and park-tree layers and that the
choice is remembered, that parks really render as grass, that Visual quality turns on tree shadows and the water glint while Fast
does not, that none of it changes a sun number, the draw-call and triangle budgets on a desktop and on a phone-width viewport, and
that the water really renders blue. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"          # the East River is ~250 m east of this tower; 1,300 census trees and 600 Parks inventory trees around it
SLOW = 90000


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, uid: str = UNIT) -> None:
    s.page.goto(f"{s.origin}/?mode=orbit#unit/{uid}")   # a home with a plan opens Inside by default; these checks are about the city outside
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.scene && document.getElementById('uLoad').hidden",
        arg=uid, timeout=120000)
    s.page.wait_for_timeout(800)


CTX_JS = """() => { const s = window.__unit3d.stage, c = s.ctx; if (!c) return null;
  const mats = []; s.scene.traverse((o) => { if (o.name === 'water') mats.push(o.material); });
  return { info: c.info, lod: c.treeStats(), layers: Object.fromEntries(Object.entries(c.parts).map(([k, v]) => [k, !!v && v.visible])),
    shadows: ['tree-crowns-near', 'tree-crowns-far', 'tree-cones'].map((n) => { const m = s.scene.getObjectByName(n); return m ? m.castShadow : null; }),
    glint: mats[0] ? mats[0].uniforms.uGlint.value : null, shallow: mats[0] ? mats[0].uniforms.uShallow.value.toArray() : null,
    calls: s.renderer.info.render.calls, tris: s.renderer.info.render.triangles, quality: s.quality, labels: s.labels.map((l) => l.cls) }; }"""


def _ctx(s):
    s.page.evaluate("() => { const s = window.__unit3d.stage; s.dirty = true; s.frame(true); }")
    return s.page.evaluate(CTX_JS)


def test_unit_3d_draws_the_census_trees_ground_and_water(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    c = _ctx(s)
    assert c is not None
    t = c["info"]["trees"]
    assert t["census"] > 1000 and t["total"] > 2000                                          # not the old 170 mapped trees
    assert t["park"] > 150 and t["street"] > 100 and t["streetTrees"] > 1200 and t["parkTrees"] > 300   # the Parks inventory: park trees and newer street trees
    assert t["streetTrees"] + t["parkTrees"] == t["total"]
    assert c["info"]["waterBodies"] >= 1 and c["info"]["streets"] is True
    assert all(c["layers"][k] for k in ("plate", "water", "green", "trees"))
    assert {"water", "park"} <= set(c["labels"]) or "water" in c["labels"]                     # the East River is labelled
    lod = c["lod"]
    assert lod["near"] + lod["far"] + lod["cones"] == lod["n"]
    assert c["calls"] < 90, c["calls"]                                                          # instancing: a handful of draw calls
    assert c["tris"] < 1_500_000, c["tris"]
    assert s.take() == []


def test_legend_says_trees_and_water_are_context_only(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    title = lambda k: s.page.locator(f'#uTools [data-tg="{k}"]').get_attribute("title")   # noqa: E731
    assert "grass" in title("green").lower() and "never counted as shade" in title("green")
    street, park = title("streetTrees"), title("parkTrees")
    assert "NYC Street Tree Census" in street and "2015" in street and "never counted as shade" in street
    assert "NYC Parks" in park and "inventory" in park and "never counted as shade" in park
    assert "context only" in title("water").lower()
    s.page.evaluate("() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); }")
    text = s.page.locator("body").inner_text()
    assert "never counted as shade or as obstructions" in text
    assert "Street trees:" in text and "NYC Street Tree Census" in text and "surveyed 2015" in text
    assert "Park trees:" in text and "NYC Parks" in text and "East River" in text
    assert "paved playgrounds and courts are drawn as paved ground" in text


def test_street_trees_and_park_trees_switch_separately_and_are_remembered(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    n = lambda: (lambda lod: lod["near"] + lod["far"] + lod["cones"])(_ctx(s)["lod"])   # the trees drawn   # noqa: E731
    both = n()
    base = _ctx(s)["info"]["trees"]
    s.page.click('#uTools [data-tg="streetTrees"]')
    street_off = n()
    assert street_off == base["parkTrees"] and street_off < both                         # only the park trees are left
    assert s.page.locator('#uTools [data-tg="streetTrees"]').get_attribute("aria-pressed") == "false"
    assert s.page.locator('#uTools [data-tg="parkTrees"]').get_attribute("aria-pressed") == "true"
    assert _ctx(s)["layers"]["trees"] and _ctx(s)["layers"]["green"]                       # the grass stays
    s.page.click('#uTools [data-tg="parkTrees"]')
    assert n() == 0 and not _ctx(s)["layers"]["trees"] and _ctx(s)["layers"]["green"]
    s.page.reload()                                                                          # remembered per browser
    _unit(s)
    assert s.page.locator('#uTools [data-tg="streetTrees"]').get_attribute("aria-pressed") == "false"
    assert s.page.locator('#uTools [data-tg="parkTrees"]').get_attribute("aria-pressed") == "false"
    assert n() == 0
    s.page.click('#uTools [data-tg="parkTrees"]')
    assert n() == base["parkTrees"]
    s.page.click('#uTools [data-tg="streetTrees"]')
    assert n() == both
    s.page.reload()
    _unit(s)
    assert n() == both                                                                       # both on again, and that is remembered too
    assert s.take() == []


def test_parks_render_as_grass_and_playgrounds_as_paved_ground(open_page, webgl):
    """Look straight down on a planted median (an OpenStreetMap lawn beside the Queens Midtown Tunnel ramp): green, in both themes."""
    _need_webgl(webgl)
    for theme in ("dark", "light"):
        s = open_page("#unit/" + UNIT, theme=theme)
        _unit(s)
        meshes = s.page.evaluate("() => window.__unit3d.stage.ctx.parts.green.children.map((m) => m.name)")
        assert "green-patches" in meshes and any(m.startswith("green-patches-") for m in meshes)   # parks, and at least one more layer (lawn, paved, court)
        px = s.page.evaluate("""() => { const st = window.__unit3d.stage; st.tween = null; st.setMode('top'); st.opts.labels = false; st.applyOpts();
          st.opts.streetTrees = false; st.opts.parkTrees = false; st.applyOpts();
          st.orbitCam.position.set(145, 420, 245); st.controls.target.set(145, 0, 245); st.controls.update(); st.dirty = true; st.frame(true);
          const cv = document.createElement('canvas'); cv.width = st.cv.width; cv.height = st.cv.height; const g = cv.getContext('2d'); g.drawImage(st.cv, 0, 0);
          const at = (fx, fy) => Array.from(g.getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data).slice(0, 3);
          return { lawn: at(0.5, 0.5) }; }""")
        r, g, b = px["lawn"]
        assert g > r + 18 and g > b + 18, (theme, "the lawn is green", px)


def test_toggling_the_layers_and_the_ground_base(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    base = lambda: s.page.evaluate("() => window.__unit3d.stage.groundBase.position.y")   # noqa: E731
    assert base() < -0.5                                                                    # the base sinks under the water plane while the plate stands in for it
    s.page.click('#uTools [data-tg="water"]')
    c = _ctx(s)
    assert not c["layers"]["plate"] and not c["layers"]["water"] and c["layers"]["trees"]
    assert base() > -0.1                                                                    # plain ground again
    s.page.click('#uTools [data-tg="green"]')
    c = _ctx(s)
    assert not c["layers"]["green"] and not c["layers"]["trees"]
    s.page.click('#uTools [data-tg="green"]')
    s.page.click('#uTools [data-tg="water"]')
    assert _ctx(s)["layers"]["trees"]
    assert s.take() == []


def test_visual_quality_turns_on_tree_shadows_and_the_water_glint_fast_does_not(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    fast = _ctx(s)
    assert fast["glint"] == 0 and not any(fast["shadows"])
    s.page.click('[data-rnq="visual"]')
    s.page.wait_for_timeout(800)
    vis = _ctx(s)
    assert vis["glint"] == 1 and all(v for v in vis["shadows"] if v is not None) and any(v for v in vis["shadows"])
    # inside the apartment the floor's sun patches follow the numbers, which ignore trees: no crown shadows there
    s.page.click('#uModes [data-mode="in"]')
    s.page.wait_for_timeout(1500)
    assert not any(_ctx(s)["shadows"])
    s.page.click('#uModes [data-mode="orbit"]')
    s.page.wait_for_timeout(800)
    assert any(v for v in _ctx(s)["shadows"] if v is not None)
    s.page.click('[data-rnq="fast"]')
    s.page.wait_for_timeout(500)
    back = _ctx(s)
    assert back["glint"] == 0 and not any(back["shadows"])
    assert s.take() == []


def test_trees_and_water_never_change_a_sun_number(open_page, webgl):
    """The sun maths use buildings alone: the blockers, the lit state and the hit distance are the same with or without the context."""
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    state = "() => { const u = window.__unit3d; return JSON.stringify({ sun: u.sun, hit: u.hit, blk: u.blockers && u.blockers.slice(0, 5), floor: u.st.floor }); }"
    with_ctx = s.page.evaluate(state)
    s.page.click('#uTools [data-tg="green"]')
    s.page.click('#uTools [data-tg="water"]')
    s.page.wait_for_timeout(500)
    without = s.page.evaluate(state)
    assert with_ctx == without
    # and the site file's own saved numbers carry no mention of trees as obstructions
    site = s.page.evaluate("() => fetch('data/sites/paramount-tower-25e.json').then((r) => r.json()).then((j) => ({ note: j.green.census.note, blockers: JSON.stringify(j.study.blockers) }))")
    assert "not counted as obstructions" in site["note"] and "tree" not in site["blockers"].lower()


def test_lod_follows_the_camera_and_respects_the_budget(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT)
    _unit(s)
    far = _ctx(s)["lod"]
    assert far["near"] == 0 and far["far"] > 1000                                           # the default orbit is hundreds of metres out
    s.page.evaluate("""() => { const st = window.__unit3d.stage; st.tween = null; st.orbitCam.position.set(-90, 7, -22); st.controls.target.set(40, 9, 50); st.controls.update(); st.dirty = true; st.frame(true); }""")
    near = _ctx(s)
    assert 0 < near["lod"]["near"] <= 1500
    assert near["lod"]["near"] + near["lod"]["far"] + near["lod"]["cones"] == near["lod"]["n"]
    assert near["calls"] < 90 and near["tris"] < 1_800_000, (near["calls"], near["tris"])


def test_water_renders_blue_in_both_themes(open_page, webgl):
    """Look straight down on the East River and read the pixel: blue, clearly different from the ground beside it."""
    _need_webgl(webgl)
    for theme in ("dark", "light"):
        s = open_page("#unit/" + UNIT, theme=theme)
        _unit(s)
        px = s.page.evaluate("""() => { const st = window.__unit3d.stage; st.tween = null; st.setMode('top'); st.opts.labels = false; st.applyOpts();
          st.orbitCam.position.set(480, 600, 400); st.controls.target.set(480, 0, 400); st.controls.update(); st.dirty = true; st.frame(true);
          const cv = document.createElement('canvas'); cv.width = st.cv.width; cv.height = st.cv.height; const g = cv.getContext('2d'); g.drawImage(st.cv, 0, 0);
          const at = (fx, fy) => Array.from(g.getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data).slice(0, 3);
          return { river: at(0.5, 0.5), land: at(0.1, 0.1) }; }""")
        r, g, b = px["river"]
        assert b > r + 25 and b > g + 8, (theme, px)                                          # blue
        lr, lg, lb = px["land"]
        assert abs(lb - lr) < 40, (theme, "the ground beside it is grey", px)


def test_phone_viewport_gets_the_lighter_budget(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#unit/" + UNIT, width=390, height=844)
    _unit(s)
    c = _ctx(s)
    assert c["quality"]["phone"] is True
    assert c["calls"] < 90 and c["tris"] < 1_500_000, (c["calls"], c["tris"])
    assert c["lod"]["n"] <= 4500
    assert s.take() == []


def test_floor_plan_studio_city_outside_uses_the_same_context(open_page, webgl):
    _need_webgl(webgl)
    s = open_page("#plan/" + UNIT)
    pg = s.page
    pg.wait_for_selector("#psFileBtn", timeout=60000)
    pg.evaluate("() => localStorage.setItem('as:plan-city.data', 'true')")    # "Show the city outside", as the studio's checkbox stores it
    pg.reload()
    pg.wait_for_selector("#psFileBtn", timeout=60000)
    pg.wait_for_timeout(3000)
    info = pg.evaluate("""async () => { const G3 = await import('/js/plan/scene3d.js'); const sc = G3.parts().scene; const city = sc.getObjectByName('city');
      if (!city) return null; const names = []; city.traverse((o) => { if (o.name) names.push(o.name); });
      return { ctx: city.userData.context ? { trees: city.userData.context.trees, water: city.userData.context.waterBodies } : null, names }; }""")
    assert info and info["ctx"], info
    assert info["ctx"]["trees"]["census"] > 200 and info["ctx"]["water"] >= 1
    assert "ground-plate" in info["names"] and "tree-crowns-far" in info["names"]
    assert s.take() == []
