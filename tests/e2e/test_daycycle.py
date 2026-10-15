"""Playing the day and the year, seasonal trees and the night city, in both 3D engines: the play button advances the date or time and stops (and a scrub pauses it),
the trees are leafy in summer, gold in autumn and bare in winter (a picture: the sun numbers do not change), the lit windows and the street lamps come on only at night
and the room has a warm light, the sun patches (the room's sun light) move across the floor while the day plays. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import re

import pytest

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _unit(s, query: str) -> None:
    s.page.goto(f"{s.origin}/?{query}#unit/{UNIT}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && document.getElementById('uLoad').hidden",
        arg=UNIT, timeout=120000)
    s.page.wait_for_timeout(800)


def _studio(s, query: str = "date=2026-10-15&pmin=720") -> None:
    pg = s.page
    pg.goto(f"{s.origin}/?{query}#plan/{UNIT}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=90000)
    pg.wait_for_timeout(800)


SEASON = "() => window.__unit3d.stage.ctx.season()"
NIGHT = """() => { const st = window.__unit3d.stage, C = st.cityObj, lamps = C.lights;
  return { night: st.facU.uNight.value, late: st.facU.uLate.value, lamps: lamps ? { n: lamps.count, visible: lamps.group.visible } : null, dim: C.dim,
           room: st.roomState ? { lamps: st.roomState.lamps, sunI: st.roomState.sunI } : null,
           assumed: st.interior && st.interior.lamps ? st.interior.lamps.group.children.map((l) => [l.visible, l.intensity]) : [] }; }"""


# ------------------------------------------------------------------------------------------------ the trees follow the season, the numbers do not

@pytest.mark.parametrize("date,leaf,autumn", [("2026-07-21", 1, 0), ("2026-10-31", 0.9, 0.7), ("2026-12-21", 0, None), ("2026-04-18", 0.2, 0)])
def test_trees_are_leafy_in_summer_gold_in_autumn_and_bare_in_winter(open_page, webgl: bool, date: str, leaf: float, autumn) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    _unit(s, f"date={date}&min=720&mode=inside")
    got = s.page.evaluate(SEASON)
    if leaf >= 0.9:
        assert got["leaf"] >= 0.9, got
    elif leaf == 0:
        assert got["leaf"] == 0, got
    else:
        assert got["leaf"] < 0.4, got
    if autumn:
        assert got["autumn"] > 0.5, got
    if autumn == 0:
        assert got["autumn"] == 0, got
    # the picture: bare branches show in winter, never in summer
    branches = s.page.evaluate("() => { const t = window.__unit3d.stage.ctx.parts.trees.getObjectByName('tree-branches'); return t ? t.visible : null; }")
    assert branches == (got["leaf"] < 0.97), (got, branches)
    assert not s.take()


def test_the_season_changes_the_trees_and_never_the_sun_numbers(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s, "date=2026-12-21&min=720&mode=inside")
    winter = pg.evaluate("() => window.__unit3d.stage.ctx.info.trees.total")
    sun_dec = pg.evaluate("() => document.querySelector('#sunPanel .metric .v').textContent")
    pg.evaluate("() => { const u = window.__unit3d; u.st.date = '2026-07-21'; document.getElementById('uDate').value = '2026-07-21'; document.getElementById('uDate').dispatchEvent(new Event('change')); }")
    pg.wait_for_timeout(600)
    assert pg.evaluate(SEASON)["leaf"] == 1
    assert pg.evaluate("() => window.__unit3d.stage.ctx.info.trees.total") == winter, "the same trees, drawn differently"
    pg.evaluate("() => { document.getElementById('uDate').value = '2026-12-21'; document.getElementById('uDate').dispatchEvent(new Event('change')); }")
    pg.wait_for_timeout(600)
    assert pg.evaluate("() => document.querySelector('#sunPanel .metric .v').textContent") == sun_dec
    title = pg.locator('#uTools [data-tg="streetTrees"]').get_attribute("title")
    assert "never counted as shade" in title and "bare branches in winter" in title      # the chip says so
    assert not s.take()


# ------------------------------------------------------------------------------------------------ play the day

def test_play_day_advances_the_time_the_sun_and_the_readout_and_stops(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s, "date=2026-10-15&min=420&mode=inside")
    pg.locator('#uLook .lk-chip', has_text=re.compile("^Living room$")).first.click()
    pg.wait_for_timeout(500)
    assert re.search(r"Sun on the floor \d+:\d\d (am|pm) to \d+:\d\d (am|pm)", pg.inner_text(".pb-sun"))     # "Sun on the floor 8:00 am to 1:42 pm"
    t0 = pg.evaluate("() => window.__unit3d.st.min")
    sun0 = pg.evaluate("() => window.__unit3d.stage.sunDir.toArray()")
    pg.click('#uPlayBar [data-pb=day]')
    assert pg.get_attribute('#uPlayBar [data-pb=day]', "aria-pressed") == "true"
    pg.wait_for_timeout(2500)
    t1 = pg.evaluate("() => window.__unit3d.st.min")
    sun1 = pg.evaluate("() => window.__unit3d.stage.sunDir.toArray()")
    assert t1 > t0 + 60, (t0, t1)                                                          # a day in ~14 s: well over an hour in 2.5 s
    assert max(abs(a - b) for a, b in zip(sun0, sun1)) > 0.05                              # the sun moved, so its patches did
    assert pg.evaluate("() => window.__unit3d.st.playing") is True
    pg.click('#uPlayBar [data-pb=day]')                                                    # pause
    t2 = pg.evaluate("() => window.__unit3d.st.min")
    pg.wait_for_timeout(700)
    assert pg.evaluate("() => window.__unit3d.st.min") == t2 and pg.evaluate("() => window.__unit3d.st.playing") is False
    assert float(t2) == round(float(t2)), "paused on a whole minute"
    assert not s.take()


def test_scrubbing_the_strip_pauses_the_loop_and_the_loop_wraps(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s, "date=2026-12-21&min=420&mode=inside")
    pg.click('#uPlayBar [data-pb=day]')
    pg.wait_for_timeout(400)
    pg.click('#uStrip', position={"x": 400, "y": 8})
    assert pg.evaluate("() => window.__unit3d.st.playing") is False
    # it runs from first light to last light and goes round again: dawn to dusk on Dec 21 is about 6:50 am to 5 pm
    pg.click('#uPlayBar [data-pb=day]')
    seen = set()
    for _ in range(40):
        pg.wait_for_timeout(450)
        seen.add(int(pg.evaluate("() => window.__unit3d.st.min") // 120))
    assert min(seen) * 120 >= 360 and max(seen) * 120 <= 1020, seen                            # (no time before first light or after last)
    pg.click('#uPlayBar [data-pb=day]')
    assert not s.take()


def test_play_year_walks_the_months_and_shows_the_month_and_the_trees(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    pg.click('#uPlayBar [data-pb=year]')
    dates, trees = [], set()
    for _ in range(30):
        pg.wait_for_timeout(400)
        dates.append(pg.evaluate("() => window.__unit3d.st.date"))
        trees.add(pg.inner_text('.pb-tree'))
    assert pg.evaluate("() => window.__unit3d.st.min") == 720, "the same time of day throughout"
    assert len(set(dates)) > 12 and re.match(r"2026-\d\d-\d\d", dates[-1]), dates
    assert {"Bare branches", "Leaves on"} <= trees or {"Bare branches", "Leafing out"} <= trees or len(trees) >= 3, trees
    assert re.match(r"[A-Z][a-z]+ \d+", pg.inner_text('.pb-when'))                            # "January 18"
    pg.click('#uPlayBar [data-pb=year]')
    assert pg.evaluate("() => window.__unit3d.st.playing") is False
    assert pg.input_value('#uDate') == pg.evaluate("() => window.__unit3d.st.date")           # the date box caught up on pause
    assert not s.take()


def test_the_month_chart_has_twelve_bars_and_a_click_jumps_to_that_month(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    assert pg.locator('.pb-chart .pb-bar').count() == 12
    hours = pg.evaluate("() => [...document.querySelectorAll('.pb-chart .pb-bar')].map((r) => r.querySelector('title').textContent)")
    assert all(re.search(r"\d+\.\d h of direct sun", h) for h in hours)
    pg.locator('.pb-chart .pb-bar').nth(5).dispatch_event("pointerdown", {"pointerId": 1})
    pg.wait_for_timeout(500)
    assert pg.evaluate("() => window.__unit3d.st.date") == "2026-06-15"
    assert not s.take()


# ------------------------------------------------------------------------------------------------ the night city

def test_lit_windows_and_lamps_come_on_at_night_only_and_the_room_has_a_warm_light(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s, "date=2026-10-15&min=720&mode=inside")
    day = pg.evaluate(NIGHT)
    assert day["night"] < 0.01 and day["lamps"]["n"] > 400 and day["lamps"]["visible"] is False and day["room"]["lamps"] == 0
    assert all(v is False for v, _ in day["assumed"]), day
    for hhmm, mins in (("17:30", 1050), ("20:30", 1230)):
        pg.evaluate("(m) => { const u = window.__unit3d; u.st.min = m; }", mins)
        pg.evaluate("() => document.getElementById('uStrip').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))")   # (refreshTime through the strip's own handler)
        pg.wait_for_timeout(400)
    night = pg.evaluate(NIGHT)
    assert night["night"] > 0.9 and night["lamps"]["visible"] is True, night                  # the lit windows and the street lamps
    assert night["dim"] < 0.6, "the ground, grass and trees go dark"
    assert night["room"]["lamps"] > 0.9 and night["room"]["sunI"] == 0
    assert any(v and i > 0 for v, i in night["assumed"]), "no lamp is placed in this unit: a warm ceiling light stands in"
    assert 0 < night["late"] < 1, "an evening, not the dead of night"
    assert not s.take()


def test_dusk_brings_the_lights_on_gradually_not_with_a_jump(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _unit(s, "date=2026-10-15&min=960&mode=inside")
    levels = []
    for m in range(960, 1236, 20):
        pg.evaluate("(m) => { window.__unit3d.st.min = m; }", m)
        pg.evaluate("() => document.getElementById('uStrip').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))")
        pg.wait_for_timeout(120)
        levels.append(pg.evaluate("() => window.__unit3d.stage.facU.uNight.value"))
    assert levels[0] < 0.01 and levels[-1] > 0.9, levels
    assert all(b - a < 0.35 for a, b in zip(levels, levels[1:])), levels
    assert all(b >= a - 1e-6 for a, b in zip(levels, levels[1:])), "monotonic through the evening"
    assert not s.take()


# ------------------------------------------------------------------------------------------------ the studio, the same thing

def test_the_studio_plays_the_day_and_the_year_with_the_same_trees_and_night(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map", width=1600, height=1000)
    pg = s.page
    _studio(s)
    pg.locator('#psLook .lk-chip', has_text=re.compile("^Sofa, window$")).first.click()
    pg.wait_for_timeout(1000)
    assert re.search(r"Sun on the floor", pg.inner_text(".pb-sun"))
    t0 = int(pg.input_value('#pTime'))
    pg.click('#pPlayBar [data-pb=day]')
    pg.wait_for_timeout(2500)
    assert int(pg.input_value('#pTime')) != t0
    pg.click('#pPlayBar [data-pb=day]')
    t1 = pg.input_value('#pTime')
    pg.wait_for_timeout(500)
    assert pg.input_value('#pTime') == t1, "paused"
    # the year: the date walks and the trees follow the same season function as Unit 3D's
    pg.click('#pPlayBar [data-pb=year]')
    dates = set()
    for _ in range(14):
        pg.wait_for_timeout(450)
        dates.add(pg.input_value('#pDate'))
    pg.click('#pPlayBar [data-pb=year]')
    assert len(dates) > 4, dates
    # the night: the same lit windows, lamps and room light
    pg.evaluate("() => { const d = document.getElementById('pDate'); d.value = '2026-10-15'; d.dispatchEvent(new Event('change')); const t = document.getElementById('pTime'); t.value = 1230; t.dispatchEvent(new Event('input')); }")
    pg.wait_for_timeout(1200)
    st = pg.evaluate("""() => { const C = window.__plan3d.cityApi && window.__plan3d.cityApi.city; return C ? { night: C.facU.uNight.value, lamps: C.lights ? C.lights.group.visible : null, n: C.lights ? C.lights.count : 0, season: C.ctx.season() } : null; }""")
    assert st and st["night"] > 0.7 and st["lamps"] is True and st["n"] > 400 and st["season"]["autumn"] > 0.2, st
    assert not s.take()
