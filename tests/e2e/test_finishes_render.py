"""A unit's finishes, read from its own photos (`apartmentscout finishes`, the plan's `finishes` block), as both 3D engines draw them: the floor's tone and pattern,
the wall paint, the window frames, the kitchen's cabinets, stone counters and backsplash, and the accuracy chip's "Finishes" row saying which of it
comes from photos. A unit with no finishes keeps the defaults. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import look_click, settled, studio_city_ready

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
PLANS = ROOT / "dashboard" / "data" / "plans"
DEFAULT_WALL, DEFAULT_FRAME = 0xF7F4EF, 0x3B3A38


def plan(unit: str) -> dict:
    return json.loads((PLANS / f"{unit}.json").read_text())


def hexnum(h: str) -> int:
    return int(h[1:], 16)


def close(a: int, b: int, tol: int = 3) -> bool:
    return all(abs(((a >> s) & 255) - ((b >> s) & 255)) <= tol for s in (16, 8, 0))


# what a room's meshes show: wall paint, ceiling paint, window-frame colours, counter tops, backsplash tiles and each floor's texture mean
PROBE = """(root) => {
  const out = { walls: [], ceilings: [], frames: [], tops: [], splash: [], floors: {} };
  const hex = (m) => m.color.getHex();
  root.traverse((o) => {
    if (!o.isMesh) return; const m = o.material; if (!m || Array.isArray(m)) return;
    if (o.name === 'wall' && m.isMeshStandardMaterial) out.walls.push(hex(m));
    else if (o.name.startsWith('ceiling:') && m.isMeshStandardMaterial) out.ceilings.push(hex(m));
    else if (o.name.startsWith('counter top')) out.tops.push(hex(m));
    else if (o.name === 'backsplash') out.splash.push(hex(m));
    else if (o.name.startsWith('floor: ') && m.map) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.drawImage(m.map.image, 0, 0, 64, 64, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data; let r = 0, gg = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      out.floors[o.name.slice(7)] = [r / n, gg / n, b / n].map(Math.round);
    } else if (o.geometry?.parameters && o.geometry.parameters.width > o.geometry.parameters.height * 4 && o.geometry.parameters.width > 0.3 && m.isMeshStandardMaterial) {
      let a = o.parent, inDetail = false; while (a) { if (a.name === 'interior detail') { inDetail = true; break; } a = a.parent; }
      if (inDetail && o.geometry.parameters.depth > 0.04 && o.geometry.parameters.depth < 0.07) out.frames.push(hex(m));   // a frame member: 2.6 in deep
    }
  });
  return out;
}"""
CHIP_JS = """(host) => { const el = document.querySelector(`.acc-chip[data-host="${host}"]`); if (!el) return null; el.querySelector('.acc-btn').click();
  const li = el.querySelector('li[data-row="finishes"]'); return li ? { text: li.textContent, pill: li.querySelector('.acc-pill').textContent } : null; }"""


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, unit: str) -> None:
    s.page.goto(f"{s.origin}/?date=2026-10-15&min=720&mode=inside#unit/{unit}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 2 && document.getElementById('uLoad').hidden",
        arg=unit, timeout=120000)
    settled(s.page, 20000, ticks=5)


def _studio(s, unit: str) -> None:
    s.page.goto(f"{s.origin}/?date=2026-10-15&pmin=720#plan/{unit}")
    s.page.wait_for_function("() => window.__plan3d && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
    look_click(s.page, "#psLook .lk-chip:has-text('Living room')")   # an eye-level view: full-height walls and windows
    studio_city_ready(s.page)


def _check(probe: dict, p: dict) -> None:
    f = p["finishes"]
    if "walls" in f:
        assert probe["walls"] and all(close(w, hexnum(f["walls"]["colour"])) for w in probe["walls"]), (probe["walls"], f["walls"])
    if "ceiling" in f:
        assert probe["ceilings"] and all(close(c, hexnum(f["ceiling"]["colour"])) for c in probe["ceilings"])
    if "window_frames" in f:
        assert probe["frames"] and all(close(c, hexnum(f["window_frames"]["colour"])) for c in probe["frames"]), (probe["frames"], f["window_frames"])
    else:
        assert probe["frames"] and all(close(c, DEFAULT_FRAME) for c in probe["frames"])
    fl = f.get("floor", {})
    if fl.get("tone"):
        tone = [int(fl["tone"][i:i + 2], 16) for i in (1, 3, 5)]
        living = probe["floors"].get("Living room") or next(v for k, v in probe["floors"].items() if k.startswith("Living"))
        assert all(abs(a - b) < 32 for a, b in zip(living, tone)), (living, tone)   # the texture's mean is the plan's tone
    k = f.get("kitchen", {})
    if k.get("counters"):
        assert probe["tops"] and all(close(t, hexnum(k["counters"]["colour"])) for t in probe["tops"]), probe["tops"]
    if k.get("backsplash"):
        assert probe["splash"] and all(close(t, hexnum(k["backsplash"]["colour"])) for t in probe["splash"]), probe["splash"]


@pytest.mark.parametrize("unit", ["paramount-tower-25e", "paramount-tower-9j", "the-greywood-4b"])
def test_a_units_photo_derived_finishes_are_drawn_by_both_engines(open_page, webgl: bool, unit: str) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    p = plan(unit)
    assert p["finishes"]["floor"]["basis"] in ("photos", "listing_text")
    _unit(s, unit)
    pg = s.page
    inside = pg.evaluate(f"() => ({PROBE})(window.__unit3d.stage.interior.group)")
    _check(inside, p)
    chip = pg.evaluate(CHIP_JS, "unit")
    assert chip and "photos" in chip["text"] and chip["pill"] in ("from a source", "estimated"), chip
    _studio(s, unit)
    studio = pg.evaluate(f"() => ({PROBE})(window.__plan3d.parts.scene)")
    _check(studio, p)
    assert pg.evaluate(CHIP_JS, "studio")["text"] == chip["text"]   # one reading of the plan in both views
    assert not s.take()


def test_the_kitchen_has_cabinets_stone_tops_and_a_backsplash_in_both_engines(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    p = plan("paramount-tower-25e")
    _unit(s, "paramount-tower-25e")
    pg = s.page
    inside = pg.evaluate(f"() => ({PROBE})(window.__unit3d.stage.interior.group)")
    _studio(s, "paramount-tower-25e")
    studio = pg.evaluate(f"() => ({PROBE})(window.__plan3d.parts.scene)")
    for name, probe in (("unit", inside), ("studio", studio)):
        assert len(probe["tops"]) >= 2 and len(probe["splash"]) >= 1, (name, probe["tops"], probe["splash"])
        assert max(probe["tops"][0] >> 16 & 255, probe["tops"][0] >> 8 & 255) < 70                           # black granite
        kitchen = next(v for k, v in probe["floors"].items() if k.startswith("Kitchen"))
        assert max(kitchen) < 100, (name, kitchen)                                                             # the black kitchen floor of the photos
    assert p["finishes"]["kitchen"]["cabinets"]["colour"] == "#ffffff"
    assert not s.take()


def test_a_unit_with_no_finishes_keeps_the_default_room(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    unit = "emerald-green-1211"
    assert "finishes" not in plan(unit)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, unit)
    pg = s.page
    inside = pg.evaluate(f"() => ({PROBE})(window.__unit3d.stage.interior.group)")
    assert inside["walls"] and all(close(w, DEFAULT_WALL) for w in inside["walls"]), inside["walls"]
    assert inside["tops"] == [] and inside["splash"] == []
    assert inside["frames"] and all(close(c, DEFAULT_FRAME) for c in inside["frames"])
    chip = pg.evaluate(CHIP_JS, "unit")
    assert chip and chip["pill"] == "assumed" and "apartmentscout finishes" in chip["text"], chip
    assert not s.take()


def test_finishes_appear_in_both_quality_modes(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, "paramount-tower-25e")
    pg = s.page
    p = plan("paramount-tower-25e")
    for quality in ("Visual", "Fast"):
        pg.evaluate("(q) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === q && x.offsetParent); if (b) b.click(); }", quality)
        pg.wait_for_timeout(2500)
        _check(pg.evaluate(f"() => ({PROBE})(window.__unit3d.stage.interior.group)"), p)
    assert not s.take()
