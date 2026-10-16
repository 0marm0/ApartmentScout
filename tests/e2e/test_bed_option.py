"""The bed the renter may buy beside their own, in a real browser: the "Bed" control (My bed / Latitude Run storage bed / No bed) in the Floor plan
studio's 2D plan and 3D view and in Unit 3D's Inside view.

* One control in each pane, all showing the same choice; the 3D views change at once; the 2D plan draws the T-shaped bed with its nightstands.
* The storage bed brings its own nightstands, so the separate ones go; "No bed" keeps them; no other piece moves, in either view.
* The choice is saved with the layout (the pieces' hidden marks): it survives a reload, undo takes it back, and Unit 3D and the studio agree.
* The Fit card answers the renter's questions for the 94 in unit on that wall in plain words.
* The bed draws within the triangle budgets in Fast and Visual, and its LEDs glow at night and not by day.
Needs WebGL, otherwise skipped."""
from __future__ import annotations

import json

import pytest

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"
KEY = f"as:plan.data.{UNIT}"

CTL = "[data-bed-ctl]"
STUDIO_3D_IDS = "() => window.__plan3d.parts.furn.children.filter((g) => g.visible).map((g) => g.userData.itemId).sort()"
STUDIO_2D_IDS = "() => [...document.querySelectorAll('#p2furn [data-id]')].map((g) => g.dataset.id).sort()"
UNIT_3D_IDS = "() => window.__unit3d.stage.interior.furniture.group.children.map((g) => g.userData.itemId).sort()"
STUDIO_PLACES = "() => window.__plan3d.items.map(({id, x, y, rot, w, d, h}) => [id, Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(rot || 0), w, d, h]).sort()"
UNIT_PLACES = "() => window.__unit3d.planInfo.layout.items.filter((x) => !x.hidden).map(({id, x, y, rot, w, d, h}) => [id, Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(rot || 0), w, d, h]).sort()"
BED_TRIS_ABOVE = """(t) => { const g = window.__unit3d.stage.interior.furniture.group.children.find((c) => c.userData.itemId === 'bed-latitude'); if (!g) return false; let n = 0; g.traverse((o) => { if (!o.isMesh) return; const gm = o.geometry; n += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; }); return n > t; }"""
CEILING_LIGHT_ON = "() => { let on = false; window.__plan3d.parts.scene.getObjectByName('assumed room lights').traverse((o) => { if (o.isPointLight && o.visible && o.intensity > 0) on = true; }); return on; }"
CHECKED = "(root) => [...document.querySelectorAll(root + ' [data-bed-choice]')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.bedChoice)"
LEDS = """() => { const out = []; for (const g of window.__plan3d.parts.furn.children) g.traverse((o) => { const l = o.userData && o.userData.leds; if (l) out.push({ id: g.userData.itemId, mats: l.mats.map((m) => m.emissiveIntensity), glows: l.glows.map((m) => m.opacity) }); }); return out; }"""
TRIS = """() => { const out = {}; for (const g of window.__unit3d.stage.interior.furniture.group.children) { let t = 0; g.traverse((o) => { if (!o.isMesh) return; const gm = o.geometry; t += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; }); out[g.userData.itemId] = t; } return out; }"""

MINE = ["bed", "coffee", "desk", "dining", "dresser", "futon", "nightstand-1", "nightstand-2", "tv", "tv-bed"]
STORAGE = ["bed-latitude", "coffee", "desk", "dining", "dresser", "futon", "tv", "tv-bed"]
NONE = ["coffee", "desk", "dining", "dresser", "futon", "nightstand-1", "nightstand-2", "tv", "tv-bed"]


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _studio(s) -> None:
    s.page.goto(f"{s.origin}/#plan/{UNIT}")
    s.page.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip') && !!document.querySelector('#p2dWrap [data-bed-ctl] [data-bed-choice]')", timeout=90000)
    s.page.wait_for_function("() => window.__plan3d.parts.furn.children.length >= 10", timeout=30000)


def _unit(s, query: str = "?mode=inside") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{UNIT}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && window.__unit3d.walk && document.getElementById('uLoad').hidden && !!document.querySelector('#uViews [data-bed-choice]')",
        arg=UNIT, timeout=120000)


def _stored(pg) -> dict | None:
    raw = pg.evaluate("(k) => localStorage.getItem(k)", KEY)
    return json.loads(raw) if raw else None


def _hidden(layout: dict) -> list[str]:
    return sorted(i["id"] for i in layout["items"] if i.get("hidden"))


# ----------------------------------------------------------------------------------------------- the studio


def test_the_studio_has_one_bed_control_in_the_2d_plan_and_one_in_the_3d_view_and_they_move_together(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    assert pg.locator(f"#p2dWrap {CTL}").is_visible() and pg.locator(f"#pstage {CTL}").is_visible(), "a control in each pane"
    labels = pg.locator(f"#p2dWrap {CTL} .bd-seg .bd-long").all_inner_texts()
    assert labels == ["My bed", "Latitude Run storage bed", "No bed"]
    # the renter's own bed is what loads, in every pane
    assert pg.evaluate(STUDIO_3D_IDS) == MINE and pg.evaluate(STUDIO_2D_IDS) == MINE
    assert pg.evaluate(CHECKED, "#p2dWrap") == ["mine"] and pg.evaluate(CHECKED, "#pstage") == ["mine"]
    before = pg.evaluate(STUDIO_PLACES)

    pg.locator("#p2dWrap [data-bed-choice='storage']").click()
    pg.wait_for_function("() => window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed-latitude' && g.visible)")
    assert pg.evaluate(STUDIO_3D_IDS) == STORAGE, "the 3D view changed at once: the storage bed, and the separate nightstands are gone with it"
    assert pg.evaluate(STUDIO_2D_IDS) == STORAGE
    assert pg.evaluate(CHECKED, "#p2dWrap") == ["storage"] and pg.evaluate(CHECKED, "#pstage") == ["storage"], "both controls follow"
    box = pg.evaluate("() => { const b = document.querySelector('#p2furn [data-id=bed-latitude]').getBBox(); return [b.width, b.height]; }")
    assert 90 <= max(box) <= 98 and 80 <= min(box) <= 86, f"the 2D glyph is the 94 x 83 in outline ({box})"
    assert pg.evaluate(STUDIO_PLACES) == before, "no piece moved, was turned or was resized"

    pg.locator("#pstage [data-bed-choice='none']").click()
    pg.wait_for_function("() => !window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed-latitude' && g.visible)")
    assert pg.evaluate(STUDIO_3D_IDS) == NONE and pg.evaluate(STUDIO_2D_IDS) == NONE, "no bed: the nightstands stand on their own"
    assert pg.evaluate(CHECKED, "#p2dWrap") == ["none"]
    assert pg.evaluate(STUDIO_PLACES) == before

    pg.locator("#psUndo").click()
    pg.wait_for_function("() => window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed-latitude' && g.visible)")
    assert pg.evaluate(STUDIO_3D_IDS) == STORAGE, "undo takes the choice back like any other edit"
    assert not s.take()


def test_the_choice_is_saved_with_the_layout_and_comes_back_after_a_reload(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    pg.locator("#pstage [data-bed-choice='storage']").click()
    pg.wait_for_function("(k) => { const v = localStorage.getItem(k); return !!v && JSON.parse(v).items.some((i) => i.id === 'bed' && i.hidden); }", arg=KEY)
    layout = _stored(pg)
    assert _hidden(layout) == ["bed", "nightstand-1", "nightstand-2"], "saved like every other layout edit: as the pieces' own marks"
    assert all(i.get("placed") for i in layout["items"]), "every piece is still the renter's placement"
    pg.reload()
    _studio(s)
    assert pg.evaluate(STUDIO_3D_IDS) == STORAGE and pg.evaluate(CHECKED, "#p2dWrap") == ["storage"], "remembered"
    pg.locator("#p2dWrap [data-bed-choice='mine']").click()
    pg.wait_for_function("() => window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed' && g.visible)")
    assert pg.evaluate(STUDIO_3D_IDS) == MINE and _hidden(_stored(pg)) == ["bed-latitude"]
    assert not s.take()


def test_a_layout_saved_before_the_bed_existed_still_loads_with_the_renters_own_bed(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    plan = json.loads(pg.evaluate("async (u) => JSON.stringify(await (await fetch(`/data/plans/${u}.json`)).json())", UNIT))
    items = [dict(i) for i in plan["layouts"][0]["items"] if i["id"] != "bed-latitude"]
    items = [{k: v for k, v in i.items() if k not in ("w", "d", "h", "label", "hidden")} for i in items]
    pg.evaluate("([k, v]) => localStorage.setItem(k, v)", [KEY, json.dumps({"schema": 1, "kind": "apartmentscout-layout", "plan": UNIT, "units": "in", "ver": 2, "items": items})])
    _studio(s)
    assert pg.evaluate(STUDIO_3D_IDS) == MINE, "the missing piece is filled in hidden: their bed stays the choice"
    assert pg.evaluate(CHECKED, "#p2dWrap") == ["mine"]
    assert not s.take()


# ----------------------------------------------------------------------------------------------- the fit card


def test_the_fit_card_answers_each_question_for_the_94_inch_unit_in_plain_words(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    pg.locator("#p2dWrap [data-bed-fit]").click()
    pop = pg.locator("#p2dWrap .bd-pop")
    pop.wait_for(state="visible")
    rows = {k: pop.locator(f"[data-bed-row='{k}']").inner_text() for k in ("wall", "walk", "drawers", "doors", "windows", "heat")}
    assert "22 in to spare on the left" in rows["wall"] and "8 in to spare on the right" in rows["wall"] and "94 in headboard unit" in rows["wall"]
    assert "32 in" in rows["walk"] and "IKEA MALM 6-drawer chest" in rows["walk"]
    assert "pull out 17 in" in rows["drawers"] and "about 31 in" in rows["drawers"] and "left side" in rows["drawers"] and "right side" in rows["drawers"]
    assert "closet door" in rows["doors"] and "bedroom door" in rows["doors"]
    assert "window on the right starts 8 in past the right tower" in rows["windows"]
    assert "Bedroom AC" in rows["heat"] and "no radiator" in rows["heat"]
    assert "candidate purchase, not owned" in pop.inner_text() and "BHLT1182" in pop.inner_text()
    assert pop.locator("[data-bed-alt]").count() == 0, "it fits, so no other wall is proposed"
    pg.keyboard.press("Escape")
    pop.wait_for(state="hidden")
    assert pg.evaluate(CHECKED, "#p2dWrap") == ["mine"], "looking at the fit does not switch the bed"
    assert not s.take()


# ----------------------------------------------------------------------------------------------- Unit 3D


def test_unit_3d_has_the_control_over_the_inside_view_and_switching_keeps_the_camera_and_the_layout(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    assert pg.locator("#uViews [data-bed-ctl]").is_visible()
    assert pg.evaluate(UNIT_3D_IDS) == MINE and pg.evaluate(CHECKED, "#uViews") == ["mine"]
    before = pg.evaluate(UNIT_PLACES)
    eye = pg.evaluate("() => { const e = window.__unit3d.stage.inEye; return [e.local.x, e.local.y, e.local.z, e.off, window.__unit3d.stage.look.yaw]; }")
    pg.locator("#uViews [data-bed-choice='storage']").click()
    pg.wait_for_function("() => window.__unit3d.stage.interior.furniture.group.children.some((g) => g.userData.itemId === 'bed-latitude')")
    assert pg.evaluate(UNIT_3D_IDS) == STORAGE, "the Inside view drew the storage bed and dropped the separate nightstands"
    assert pg.evaluate("() => { const e = window.__unit3d.stage.inEye; return [e.local.x, e.local.y, e.local.z, e.off, window.__unit3d.stage.look.yaw]; }") == eye, "the camera did not move"
    visible = pg.evaluate(UNIT_PLACES)
    assert {p[0]: p[1:] for p in visible if p[0] != "bed-latitude"} == {p[0]: p[1:] for p in before if p[0] not in ("bed", "nightstand-1", "nightstand-2")}, "every other piece is where it was"
    assert _hidden(_stored(pg)) == ["bed", "nightstand-1", "nightstand-2"], "saved where the studio saves its edits"
    meshes = pg.evaluate("() => { const U = window.__unit3d, fr = U.stage.interior.frame, g = U.stage.interior.furniture.group.children.find((c) => c.userData.itemId === 'bed-latitude'); return [Math.round((g.position.x / 0.0254 + fr.xc) * 10) / 10, Math.round((-g.position.z / 0.0254 + fr.yw) * 10) / 10]; }")
    assert abs(meshes[0] - 266.85) < 0.2 and abs(meshes[1] - 218) < 0.2, "drawn where the layout puts it: the headboard on the wall the renter's bed is on"
    assert pg.evaluate(CHECKED, "#uViews") == ["storage"]
    pg.reload()
    _unit(s)
    assert pg.evaluate(UNIT_3D_IDS) == STORAGE, "remembered across a reload"
    pg.locator("#uViews [data-bed-fit]").click()
    pg.locator("#uViews .bd-pop").wait_for(state="visible")
    assert "headboard unit has 22 in to spare" in pg.locator("#uViews [data-bed-row='wall']").inner_text()
    assert not s.take()


def test_a_choice_made_in_unit_3d_is_there_when_you_go_to_the_studio_and_back_without_reloading(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    assert pg.evaluate(STUDIO_3D_IDS) == MINE
    pg.evaluate("(u) => { location.hash = '#unit/' + u; }", UNIT)
    pg.wait_for_function("(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && document.getElementById('uLoad').hidden && !!document.querySelector('#uViews [data-bed-choice]')", arg=UNIT, timeout=120000)
    pg.locator("#uModes [data-mode='in']").click()
    pg.locator("#uViews [data-bed-choice='storage']").wait_for(state="visible")
    pg.locator("#uViews [data-bed-choice='storage']").click()
    pg.wait_for_function("() => window.__unit3d.stage.interior.furniture.group.children.some((g) => g.userData.itemId === 'bed-latitude')")
    pg.evaluate("(u) => { location.hash = '#plan/' + u; }", UNIT)
    pg.wait_for_function("() => window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed-latitude' && g.visible)", timeout=30000)
    assert pg.evaluate(STUDIO_3D_IDS) == STORAGE and pg.evaluate(CHECKED, "#p2dWrap") == ["storage"], "the studio took up what Unit 3D saved"
    assert not s.take()


# ----------------------------------------------------------------------------------------------- how it looks


def test_the_storage_bed_stays_within_the_triangle_budgets_in_fast_and_visual(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    pg.locator("#uViews [data-bed-choice='storage']").click()
    pg.wait_for_function("() => window.__unit3d.stage.interior.furniture.group.children.some((g) => g.userData.itemId === 'bed-latitude')")
    fast = pg.evaluate(TRIS)
    assert 500 < fast["bed-latitude"] <= 1600, f"Fast: about 1,500 triangles a piece at most ({fast})"
    pg.locator("button", has_text="Visual").first.click()
    pg.wait_for_function(BED_TRIS_ABOVE, arg=fast["bed-latitude"] * 1.5, timeout=30000)   # the furniture is drawn again, richer
    visual = pg.evaluate(TRIS)
    assert visual["bed-latitude"] > fast["bed-latitude"] * 2, "Visual draws the slats, the casters' stems, the ports and the padded panels"
    assert all(v <= 6000 for v in visual.values()), f"Visual: about 6,000 triangles a piece at most ({visual})"
    assert not s.take()


def test_the_leds_glow_after_dark_and_are_off_by_day(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    pg.locator("#pstage [data-bed-choice='storage']").click()
    pg.wait_for_function("() => window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed-latitude' && g.visible)")
    pg.locator("#pMood [data-mood='day']").click()
    pg.wait_for_function("() => window.__plan3d.parts.mood.now === 'day'")
    day = pg.evaluate(LEDS)
    assert day and all(v == 0 for led in day for v in led["mats"]) and all(v == 0 for led in day for v in led["glows"]), "no glow by day"
    pg.locator("#pMood [data-mood='night']").click()
    pg.wait_for_function("() => window.__plan3d.parts.mood.now === 'night'")
    night = pg.evaluate(LEDS)
    assert night and all(v > 1 for led in night for v in led["mats"]), f"the cubby lights, the reading lights and the band glow at night ({night})"
    assert all(0.1 < v <= 0.7 for led in night for v in led["glows"]), "and so do the soft washes under the rail and in the cubbies"
    assert {led["id"] for led in night} == {"bed-latitude"}
    # a lit LED is not a lamp: the room's own ceiling light stays on
    assert pg.evaluate(CEILING_LIGHT_ON)
    assert not s.take()


def test_on_a_phone_the_control_fits_the_pane_with_short_labels(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=390, height=844)
    pg = s.page
    _studio(s)
    ctl = pg.locator(f"#p2dWrap {CTL}")
    ctl.wait_for(state="visible")
    assert pg.locator(f"#p2dWrap {CTL} .bd-short").first.is_visible() and not pg.locator(f"#p2dWrap {CTL} .bd-long").first.is_visible()
    box, pane = ctl.bounding_box(), pg.locator("#p2dWrap").bounding_box()
    assert box["x"] >= pane["x"] - 1 and box["x"] + box["width"] <= pane["x"] + pane["width"] + 1, "inside the pane, nothing runs off the screen"
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert pg.evaluate("() => [...document.querySelectorAll('#p2dWrap [data-bed-choice]')].every((b) => b.getAttribute('aria-label').length > 4)"), "the full name stays the accessible one"
    assert not s.take()


def test_the_choice_works_from_the_keyboard_like_a_radio_group(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _studio(s)
    group = pg.locator("#p2dWrap [role=radiogroup]")
    assert group.get_attribute("aria-label") == "Bed"
    pg.locator("#p2dWrap [data-bed-choice='mine']").focus()
    pg.keyboard.press("ArrowRight")
    pg.wait_for_function("() => window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed-latitude' && g.visible)")
    assert pg.evaluate(CHECKED, "#p2dWrap") == ["storage"]
    assert pg.evaluate("() => document.activeElement.dataset.bedChoice") == "storage", "the keyboard stays on the choice it moved to"
    pg.keyboard.press("ArrowRight")
    pg.wait_for_function("() => !window.__plan3d.parts.furn.children.some((g) => g.userData.itemId === 'bed-latitude' && g.visible)")
    assert pg.evaluate(STUDIO_3D_IDS) == NONE
    assert not s.take()
