"""The shared model in a real browser: one plan scenario at the same window in the Floor plan studio and Unit 3D's Inside
camera, a measured height and a pinned window that both viewers follow, assumed building parts that the drawing and the
sun maths share, a window outside open air that withholds its sun, the scenario comparison board (PNG and receipt) and an
exportable model project that restores offline in a fresh browser. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

import pytest
from conftest import settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels: see conftest.NO_RASTER_JS

AXE = Path(__file__).parent / "vendor" / "axe.min.js"
UNIT = "paramount-tower-25e"
SIBLING = "paramount-tower-9j"


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, uid: str = UNIT, query: str = "") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{uid}")
    _unit_ready(s, uid)


def _unit_ready(s, uid: str) -> None:
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.scene && document.getElementById('uLoad').hidden",
        arg=uid, timeout=120000)
    settled(s.page, 20000, ticks=5)


def _studio_ready(pg) -> None:
    """The studio's file button is there, its header says what the plan faces, and the page has gone quiet."""
    pg.wait_for_selector("#psFileBtn", timeout=60000)
    pg.wait_for_function("() => (document.getElementById('psSub')?.textContent || '').trim().length > 0", timeout=60000)
    settled(pg, 20000, ticks=8)


def _send_plan_to_unit_3d(s, uid: str = UNIT) -> None:
    """The renter's explicit step: Floor plan studio ▸ Layout ▸ Use this plan in Unit 3D."""
    pg = s.page
    pg.goto(f"{s.origin}/#plan/{uid}")
    _studio_ready(pg)
    if uid == UNIT:   # the header names the host facade (ESE), with the bays as a range, not the first pane (SSW)
        sub = pg.locator("#psSub").inner_text()
        assert "windows face ESE 119° · bays" in sub and "SSW" not in sub
    pg.click("#psFileBtn")
    pg.click("#psMenu [data-tr=scenario]")
    pg.wait_for_function("(id) => !!localStorage.getItem('as:plan-scenario:' + id)", arg=uid, timeout=10000)


def _fold(s, name: str) -> None:
    d = s.page.locator(f"#modelPanel details[data-sec={name}]")
    if not d.evaluate("(e) => e.open"):
        d.locator("summary").click()
    s.page.wait_for_function("(n) => document.querySelector(`#modelPanel details[data-sec=${n}]`).open", arg=name, timeout=5000)
    settled(s.page, 20000, ticks=3)


GLASS_JS = """async (id) => {
  const { placePlan } = await import('/js/plan/city.js');
  const { planWindows } = await import('/js/unit/anchor.js');
  const u = window.__unit3d, g = u.stage.interior.group; g.updateMatrixWorld(true);
  const glass = []; g.traverse((o) => { if (o.name === 'glass') glass.push(o); });
  const site = await (await fetch('/data/sites/' + id + '.json')).json(), f = u.faces[u.st.face];
  const ctx = placePlan(site, u.plan, u.st.floor, { anchor: { face: f.i, t: u.st.t, az: u.st.az, cal: u.cal.measured } });
  return planWindows(ctx, u.plan).map((w, i) => { const v = glass[i].getWorldPosition(new glass[i].position.constructor());
    return { room: w.room, studio: w.world_m, unit: [v.x, -v.z], studioMidZ: (w.sill_m + w.head_m) / 2, unitZ: v.y, len: w.length_m,
             glassLen: glass[i].geometry.parameters.width }; });
}"""


# --------------------------------------------------------------------------- one plan, one window, two viewers

def test_local_plan_scenario_shows_in_unit_3d_at_the_studios_window_and_never_for_a_sibling(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _send_plan_to_unit_3d(s)
    _unit(s, query="?mode=inside")
    info = pg.evaluate("() => ({src: window.__unit3d.planInfo.source, furn: window.__unit3d.planInfo.furniture, group: !!window.__unit3d.stage.interior.furniture, mode: window.__unit3d.st.mode})")
    assert info == {"src": "local scenario", "furn": 10, "group": True, "mode": "in"}
    # the same windows, in the same place, with the same dimensions in both viewers (the studio's placement maths vs the 3D transform)
    for w in pg.evaluate(GLASS_JS, UNIT):
        assert w["studio"] == pytest.approx(w["unit"], abs=0.011), w
        assert w["studioMidZ"] == pytest.approx(w["unitZ"], abs=0.011), w
        assert w["len"] == pytest.approx(w["glassLen"], abs=0.011), w
    # the Model panel says so, and the choice is the renter's
    _fold(s, "plan")
    assert "Your local scenario" in pg.locator("#modelPanel .mp-radios").inner_text()
    assert "Local scenario" in pg.locator("#modelPanel .mp-row").first.inner_text()
    pg.check("input[name=mpPlan][value=file]")
    # the source plan shows its own default layout (the renter's furniture), a scenario shows what was sent from the studio
    pg.wait_for_function("() => window.__unit3d.planInfo.source === 'file' && window.__unit3d.planInfo.layoutName === 'Your furniture' && window.__unit3d.stage.interior.furniture.count === 10")
    pg.check("input[name=mpPlan][value=scenario]")
    pg.wait_for_function("() => window.__unit3d.planInfo.source === 'local scenario' && !!window.__unit3d.stage.interior.furniture")
    # a scenario saved for this unit is never applied to a sibling unit
    _unit(s, SIBLING)
    assert pg.evaluate("() => window.__unit3d.planInfo.source") == "file"
    assert pg.evaluate("() => window.__unit3d.planInfo.label") == ""                                 # the scenario saved for 25E is not applied here
    assert not s.take()


def test_measured_height_and_pinned_window_reach_both_viewers(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    _fold(s, "height")
    est = pg.evaluate("() => window.__unit3d.cal.slabAt(25)")
    assert est == pytest.approx(24 * 3.083, abs=0.01) and pg.evaluate("() => window.__unit3d.cal.state") == "estimated"
    pg.fill("#mpCalVal", "80.5")
    pg.fill("#mpCalFloor", "25")
    pg.click("[data-act=cal-apply]")
    pg.wait_for_function("() => window.__unit3d.cal.state === 'measured'")
    cal = pg.evaluate("() => ({slab: window.__unit3d.cal.slabAt(25), est: window.__unit3d.cal.estimateAt(25), z: window.__unit3d.stage.win.floorZ, floor: window.__unit3d.st.floor})")
    assert cal["slab"] == pytest.approx(80.5) and cal["est"] == pytest.approx(est, abs=0.01)         # the estimate is kept beside it
    assert cal["z"] == pytest.approx(80.5, abs=0.01)                                                  # the city shadows and the interior follow
    assert "measured" in pg.locator("#modelPanel .mp-nums").inner_text().lower() or "Measured" in pg.locator("#modelPanel").inner_text()
    # the calibration exports as a file
    with pg.expect_download() as dl:
        pg.click("[data-act=cal-export]")
    out = json.loads(Path(dl.value.path()).read_text())
    assert out["kind"] == "apartmentscout-vertical-calibration" and out["slab_m"] == 80.5 and out["estimated_slab_m"] == pytest.approx(est, abs=0.01)
    # without a pin the studio uses the site file's window; after "Use this window in the Floor plan" it follows Unit 3D
    _fold(s, "plan")
    unit_rows = pg.evaluate("() => [...document.querySelectorAll('#modelPanel .mp-anchor dt')].filter((e) => /^(Bedroom|Living room)/.test(e.textContent)).map((e) => e.nextElementSibling.textContent.replace(/\\s+/g, ' ').trim())")
    pg.click("[data-act=pin]")
    pg.wait_for_function("(id) => !!localStorage.getItem('as:model-anchor:' + id)", arg=UNIT, timeout=10000)
    pg.goto(f"{s.origin}/#plan/{UNIT}")
    _studio_ready(pg)
    pg.click("[data-t=light]")
    pg.click("#psLightResults .ps-anchor > summary")
    pg.wait_for_selector("#psLightResults .ps-anchor .mp-anchor")
    note = pg.locator("#psLightResults .ps-anchor").inner_text()
    assert "pinned in Unit 3D" in note and "80.5 m" in note and "Measured" in note
    studio_rows = pg.evaluate("() => [...document.querySelectorAll('#psLightResults .mp-anchor dt')].filter((e) => /^(Bedroom|Living room)/.test(e.textContent)).map((e) => e.nextElementSibling.textContent.replace(/\\s+/g, ' ').trim())")
    assert studio_rows and studio_rows == unit_rows                                                  # same windows, same dimensions, same heights
    assert not s.take()


def test_a_window_outside_open_air_withholds_its_sun(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    assert pg.evaluate("() => window.__unit3d.st.air.ok") is True
    az = pg.evaluate("() => window.__unit3d.st.az")
    pg.evaluate("(v) => { const el = document.getElementById('uAz'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }", round((az + 180) % 360))
    pg.wait_for_function("() => window.__unit3d.st.air && window.__unit3d.st.air.ok === false")
    assert "inside its own building" in pg.locator("#sunPanel").inner_text()
    assert "withheld" in pg.locator("#modelPanel, #sunPanel").first.inner_text().lower() or "unresolved" in pg.locator("#sunPanel").inner_text().lower()
    assert pg.locator("#uModes [data-mode=in]").is_disabled()
    # turning it back restores the window and its numbers
    pg.evaluate("(v) => { const el = document.getElementById('uAz'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }", round(az))
    pg.wait_for_function("() => window.__unit3d.st.air && window.__unit3d.st.air.ok === true")
    pg.wait_for_selector("#sunPanel .metrics")
    assert not s.take()


# --------------------------------------------------------------------------- component buildings

def test_assumed_building_parts_feed_the_drawing_and_the_sun_maths(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s, "emerald-green-1211")
    sky0 = pg.evaluate("() => document.querySelector('#sunPanel .u-daylight .metric .v').textContent")
    _fold(s, "parts")
    pg.wait_for_selector("#mpBld")
    opts = pg.evaluate("() => [...document.querySelectorAll('#mpBld option')].map((o) => [o.value, o.textContent])")
    blocker = next(v for v, t in opts if "takes sun" in t)
    pg.select_option("#mpBld", blocker)
    pg.fill("#mpPodium", "12")
    pg.fill("#mpSetback", "14")
    pg.fill("#mpSide", "0")
    pg.click("[data-act=parts-apply]")
    pg.wait_for_function("(bi) => { const b = window.__unit3d.B[+bi]; return b.parts && b.parts.length === 2 && b.parts.every((q) => q.confidence === 'assumed'); }", arg=blocker, timeout=60000)
    # the stage is rebuilt from B0 and the daylight panel re-read: wait for the numbers the next lines look at
    pg.wait_for_function("""([bi, sky0]) => (window.__unit3d.stage.data.B[+bi].parts || []).length === 2 && document.querySelector('#sunPanel .u-daylight .metric .v').textContent !== sky0""",
                         arg=[blocker, sky0], timeout=60000)
    settled(pg, 20000, ticks=5)
    # the same parts are what the sun maths reads (B) and what is drawn (the stage was rebuilt from B0)
    assert pg.evaluate("(bi) => window.__unit3d.stage.data.B[+bi].parts.length", blocker) == 2
    assert pg.evaluate("() => document.querySelector('#sunPanel .u-daylight .metric .v').textContent") != sky0
    assert "assumed" in pg.locator("#evPanel").inner_text().lower() and "Building parts" in pg.locator("#evPanel").inner_text()
    assert pg.evaluate("(id) => !!localStorage.getItem('as:parts-assumed:' + id)", "emerald-green-1211")
    # the source site file is unchanged: removing the assumption restores the original number
    pg.click("[data-act=parts-clear]")
    pg.wait_for_function("(bi) => !window.__unit3d.B[+bi].parts", arg=blocker, timeout=60000)
    pg.wait_for_function("(sky0) => document.querySelector('#sunPanel .u-daylight .metric .v').textContent === sky0", arg=sky0, timeout=60000)
    assert pg.evaluate("() => document.querySelector('#sunPanel .u-daylight .metric .v').textContent") == sky0
    assert not s.take()


# --------------------------------------------------------------------------- scenario comparison board

@pytest.mark.no_raster(False)   # the board's PNG must be a real picture (its size)
def test_comparison_board_exports_one_png_and_a_receipt_with_deltas(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s, "emerald-green-1211")
    _fold(s, "tools")
    pg.click("[data-act=compare]")
    pg.wait_for_selector("#cbDialog[data-ready='1']", timeout=180000)
    assert pg.locator("#cbRows .cb-row").count() == 2
    pg.click("[data-preset=seasons4]")
    pg.wait_for_function("() => document.querySelectorAll('#cbRows .cb-row').length === 4 && document.getElementById('cbBusy').hidden", timeout=180000)
    assert pg.locator("#cbAdd").is_disabled()                                                         # at most four
    assert "Identical in every scenario" in pg.locator("#cbShared").inner_text()
    assert "Different: date" in pg.locator("#cbShared").inner_text()
    with pg.expect_download() as dl:
        pg.click("#cbPng")
    png = Path(dl.value.path()).read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 30000
    with pg.expect_download() as dl:
        pg.click("#cbJson")
    rc = json.loads(Path(dl.value.path()).read_text())
    assert rc["kind"] == "apartmentscout-compare-receipt" and len(rc["scenarios"]) == 4 and rc["camera"]["note"] == "one fixed camera for every panel"
    assert [x["label"] for x in rc["scenarios"]] == ["Mar 20", "Jun 21", "Sep 22", "Dec 21"]
    day = next(d for d in rc["deltas"] if d["metric"] == "Direct sun that day")
    assert day["delta_vs_first"][0] is None and day["values"][1] > day["values"][3]                    # June beats December
    assert set(rc["shared"]) >= {"Time", "Floor", "Facade", "Height"}
    # fewer than two scenarios is not a comparison
    pg.click("#cbRows [data-del='3']")
    pg.click("#cbRows [data-del='2']")
    assert pg.locator("#cbRows [data-del]").first.is_disabled()
    pg.keyboard.press("Escape")
    pg.wait_for_selector("#cbDialog", state="detached")
    assert not s.take()


# --------------------------------------------------------------------------- the model project

def test_model_project_exports_and_restores_offline_in_a_fresh_browser(open_page, webgl: bool, tmp_path: Path) -> None:
    _need_webgl(webgl)
    a = open_page("#map")
    _send_plan_to_unit_3d(a)
    _unit(a, query="?mode=inside")
    _fold(a, "height")
    a.page.fill("#mpCalVal", "80.5")
    a.page.fill("#mpCalFloor", "25")
    a.page.click("[data-act=cal-apply]")
    a.page.wait_for_function("() => window.__unit3d.cal.state === 'measured'")
    _fold(a, "tools")
    with a.page.expect_download() as dl:
        a.page.click("[data-act=project-export]")
    proj = json.loads(Path(dl.value.path()).read_text())
    assert proj["kind"] == "apartmentscout-model-project" and proj["schema"] == 1
    assert len(proj["site"]["data"]["b"]) > 1000 and proj["site"]["sha256"] and len(proj["receipts"]["datasets"]) >= 1
    assert proj["anchor"]["kind"] == "apartmentscout-model-anchor" and proj["anchor"]["datum"]["state"] == "measured"
    assert proj["plan"]["source"] == "local scenario" and len(proj["plan"]["project"]["layout"]["items"]) == 11
    assert proj["calibration"]["measured"]["value_m"] == 80.5 and proj["view"]["mode"] == "in" and proj["app"]["name"] == "ApartmentScout"
    # a site this app has never heard of, restored from the file alone (no network: every outside request is blocked)
    new = "demo-import-25e"
    proj["site"]["id"] = proj["site"]["data"]["listing"]["id"] = new
    proj["plan"]["id"] = proj["plan"]["project"]["plan"]["id"] = proj["plan"]["project"]["layout"]["plan"] = new
    f = tmp_path / "project.json"
    f.write_text(json.dumps(proj))
    b = open_page("#map")
    _unit(b, SIBLING)
    _fold(b, "tools")
    b.page.set_input_files("input[data-act=project-import]", str(f))
    b.page.wait_for_selector("[data-act=project-restore]")
    review = b.page.locator("#mpImport").inner_text()
    assert re.search(r"\b\d,\d{3}\b", review) and "with 11 pieces" in review and "Measured slab height 80.5 m" in review   # thousands of buildings (3,427)
    b.page.click("[data-act=project-restore]")
    _unit_ready(b, new)
    got = b.page.evaluate("() => ({floor: window.__unit3d.st.floor, mode: window.__unit3d.st.mode, cal: window.__unit3d.cal.state, slab: window.__unit3d.cal.slabAt(window.__unit3d.st.floor), plan: window.__unit3d.planInfo.source, furn: !!window.__unit3d.stage.interior.furniture, n: window.__unit3d.B.length})")
    assert got["cal"] == "measured" and got["slab"] == pytest.approx(80.5) and got["plan"] == "local scenario" and got["furn"] and got["n"] > 1000 and got["mode"] == "in"
    # and it is still there after a cold reload, still without a network
    b.page.goto(f"{b.origin}/#unit/{new}")
    _unit_ready(b, new)
    assert b.page.evaluate("() => window.__unit3d.B.length") == got["n"]
    # a damaged file is refused with a reason and changes nothing
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({**proj, "schema": 9}))
    _fold(b, "tools")
    b.page.set_input_files("input[data-act=project-import]", str(bad))
    b.page.wait_for_function("() => document.getElementById('mpStatus').textContent.includes('Not restored')")
    assert b.page.locator("[data-act=project-restore]").count() == 0
    # the browser-only copy can be forgotten; a site that only existed through the import then disappears
    assert "Restored from an imported project" in b.page.locator("#modelPanel").inner_text()
    b.page.click("[data-act=project-forget]")
    b.page.wait_for_function("(id) => ![...document.querySelectorAll('#unitSel option')].some((o) => o.value === id)", arg=new, timeout=20000)
    b.page.wait_for_function("(id) => window.__unit3d.st.id && window.__unit3d.st.id !== id && document.getElementById('uLoad').hidden", arg=new, timeout=120000)
    assert not b.page.evaluate("() => (window.__AS_OVERLAY__ && Object.keys(window.__AS_OVERLAY__).length) || 0")
    assert not a.take() and not b.take()


def test_model_project_can_carry_the_3d_model(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _unit(s)
    _fold(s, "tools")
    pg.locator("label.tg:has(#mpGlb)").click()
    assert pg.is_checked("#mpGlb")
    with pg.expect_download() as dl:
        pg.click("[data-act=project-export]")
    proj = json.loads(Path(dl.value.path()).read_text())
    g = proj["glb"]
    assert g["encoding"] == "base64" and g["bytes"] > 100_000 and g["sha256"] and g["name"] == f"{UNIT}.glb"
    raw = base64.b64decode(g["data"])
    assert raw[:4] == b"glTF" and len(raw) == g["bytes"] and hashlib.sha256(raw).hexdigest() == g["sha256"]
    assert not s.take()


# --------------------------------------------------------------------------- accessibility

@pytest.mark.parametrize("theme", ["dark", "light"])
def test_model_panel_and_board_have_no_serious_axe_violations(open_page, webgl: bool, theme: str) -> None:
    _need_webgl(webgl)
    s = open_page("#map", theme=theme)
    pg = s.page
    _unit(s)
    for name in ("plan", "height", "parts", "tools"):
        _fold(s, name)
    pg.add_script_tag(path=str(AXE))
    run = """async (sel) => { const r = await axe.run(document.querySelector(sel), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
      return r.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })); }"""
    assert pg.evaluate(run, "#modelPanel") == []
    pg.click("[data-act=compare]")
    pg.wait_for_selector("#cbDialog[data-ready='1']", timeout=180000)
    assert pg.evaluate(run, "#cbDialog") == []
    pg.keyboard.press("Escape")
    assert not s.take()


def test_model_panel_fits_a_phone(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=390, height=800)
    pg = s.page
    _unit(s)
    for name in ("plan", "height", "parts", "tools"):
        _fold(s, name)
    over = pg.evaluate("""() => { const vw = innerWidth; return [...document.querySelectorAll('#modelPanel *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && !e.closest('textarea, table, .cb-hide'); }).map((e) => e.tagName + '.' + e.className).slice(0, 5); }""")
    assert over == []
    assert not s.take()
