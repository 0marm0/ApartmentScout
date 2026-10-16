"""Commute by time of day in a real browser: the time selector on the map's commute legend, and the bars in the listing drawer.

Runs on the example dashboard (one destination, Grand Central). The network is blocked (see conftest), so the basemap is the
plain offline one; the commute surface, the difference grids and every number come from the local data files. The map needs
WebGL, otherwise those tests are skipped; the drawer test does not."""
from __future__ import annotations

import pytest
from conftest import map_opened, settled

pytestmark = pytest.mark.e2e

APP = "(await import('/js/app.js'))"


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _heat_signature(pg) -> str:
    """The contour fills on the map right now, reduced to a comparable string."""
    return pg.evaluate("""() => { const s = window.__asMap.getSource('heat-fill'); const f = (s && s._data && s._data.features) || [];
      return f.map((x) => x.properties.i + ':' + JSON.stringify(x.geometry.coordinates).length).join('|'); }""")


def _a_home_with_times(pg) -> str:
    lid = pg.evaluate(f"""async () => {{ const a = {APP};
      return a.sorted(a.filtered()).find((L) => L.lat != null && L.commute?.[a.dest().name]?.times?.transit?.every((v) => v != null))?.id; }}""")
    assert lid, "the example listings carry per-slot commute times"
    return lid


def test_the_legend_offers_every_time_of_day_and_the_map_follows_the_choice(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    map_opened(pg)
    pg.wait_for_selector("#lgTime .tod-seg button", timeout=20000)
    chips = pg.locator("#lgTime [data-tod]")
    labels = chips.all_inner_texts()
    assert labels == ["9:00", "13:00", "18:00 home", "22:00 home", "Sat 11:00"], labels
    assert pg.locator("#lgTime [data-tod].on").inner_text() == "9:00"
    assert "arrive 09:00" in pg.locator("#legend h4").inner_text()
    pg.wait_for_function("() => !!window.__asMap.getSource('heat-fill')", timeout=20000)
    morning = _heat_signature(pg)
    first = pg.evaluate(f"async () => {{ const a = {APP}; return a.commuteOf(a.sorted(a.filtered()).find((L) => L.lat != null && L.commute)); }}")

    pg.locator('#lgTime [data-tod="late"]').click()
    pg.wait_for_function("() => document.querySelector('#lgTime [data-tod=late]').classList.contains('on')", timeout=5000)
    # the difference grid is fetched on demand, then the contours are redrawn from it
    pg.wait_for_function("() => !document.querySelector('#lgTime .tod-load')", timeout=20000)
    pg.wait_for_function("(sig) => { const s = window.__asMap.getSource('heat-fill'); const f = (s && s._data && s._data.features) || [];"
                         " return f.map((x) => x.properties.i + ':' + JSON.stringify(x.geometry.coordinates).length).join('|') !== sig; }",
                         arg=morning, timeout=20000)
    assert "leave 22:00" in pg.locator("#legend h4").inner_text()
    assert "Late evening" in pg.locator("#legend h4").inner_text()
    settled(pg)
    # cards, filters and sorting read the same lens: this home takes longer to get home at 10 pm than it takes to get there at 9 am
    late = pg.evaluate(f"async () => {{ const a = {APP}; return a.commuteOf(a.sorted(a.filtered()).find((L) => L.lat != null && L.commute)); }}")
    assert first is not None and late is not None and late != first
    # back to the arrive-by trip: the surface that was always there
    pg.locator('#lgTime [data-tod="am"]').click()
    pg.wait_for_function("(sig) => { const s = window.__asMap.getSource('heat-fill'); const f = (s && s._data && s._data.features) || [];"
                         " return f.map((x) => x.properties.i + ':' + JSON.stringify(x.geometry.coordinates).length).join('|') === sig; }",
                         arg=morning, timeout=20000)
    assert pg.locator("#lgTime [data-tod].on").inner_text() == "9:00"
    assert not s.take(), s.take()


def test_walking_has_no_time_of_day_and_the_score_never_follows_the_lens(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    map_opened(pg)
    pg.wait_for_selector("#lgTime [data-tod]", timeout=20000)
    scores = pg.evaluate(f"async () => {{ const a = {APP}; return a.S.listings.slice(0, 40).map((L) => L.score?.overall); }}")
    pg.locator('#lgTime [data-tod="pm"]').click()
    pg.wait_for_function("() => document.querySelector('#lgTime [data-tod=pm]').classList.contains('on')", timeout=5000)
    settled(pg)
    assert pg.evaluate(f"async () => {{ const a = {APP}; return a.S.listings.slice(0, 40).map((L) => L.score?.overall); }}") == scores
    pg.locator("#lgMode [data-mode=walk]").click()
    pg.wait_for_function("() => document.querySelector('#lgTime [data-tod]').disabled", timeout=5000)
    assert "same time at any hour" in pg.locator("#lgTime").inner_text()
    pg.locator("#lgMode [data-mode=best]").click()
    pg.wait_for_function("() => !document.querySelector('#lgTime [data-tod]').disabled", timeout=5000)
    assert not s.take(), s.take()


def test_a_link_can_open_the_map_on_a_time_of_day(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("?time=pm#map")
    pg = s.page
    map_opened(pg)
    pg.wait_for_selector("#lgTime [data-tod].on", timeout=20000)
    assert pg.locator("#lgTime [data-tod].on").inner_text() == "18:00 home"
    assert "leave 18:00" in pg.locator("#legend h4").inner_text()
    assert not s.take(), s.take()


def test_the_drawer_shows_a_bar_per_time_of_day_in_words_and_numbers(open_page) -> None:
    s = open_page("#map")
    pg = s.page
    lid = _a_home_with_times(pg)
    pg.evaluate(f"async (id) => {{ const a = {APP}; a.openDrawer(id); }}", lid)
    pg.wait_for_selector("#dTod .tod-b", timeout=20000)
    bars = pg.locator("#dTod .tod-b")
    assert bars.count() == 5
    assert bars.nth(0).get_attribute("aria-pressed") == "true"
    nums = [int(x) for x in pg.locator("#dTod .tod-b b").all_inner_texts()]
    expected = pg.evaluate(f"""async (id) => {{ const a = {APP}; const L = a.byId(id); return L.commute[a.dest().name].times.transit.map(Math.round); }}""", lid)
    assert nums == expected
    sentence = pg.locator("#dTod .tod-sum").inner_text()
    assert f"{nums[0]} min to arrive at 9:00" in sentence and f"{nums[2]} min to leave at 18:00" in sentence and f"{nums[3]} min to leave at 22:00" in sentence
    note = pg.locator("#dTod .tod-note").inner_text()
    assert "commute score reads the arrive-by trip" in note
    # the bars are a control: choosing one moves the map and every number to that time
    pg.locator('#dTod [data-tod="pm"]').click()
    pg.wait_for_selector('#dTod [data-tod="pm"][aria-pressed="true"]', timeout=10000)
    assert pg.evaluate(f"async () => {{ const a = {APP}; return (await import('/js/features/timeofday.js')).activeId(); }}") == "pm"
    # and the subway tab shows the subway's numbers
    if pg.locator('#dCommute .mt[data-mode="subway"]').count():
        pg.locator('#dCommute .mt[data-mode="subway"]').click()
        pg.wait_for_selector('#dCommute .mt[data-mode="subway"].on', timeout=10000)
        sub = [int(x) for x in pg.locator("#dTod .tod-b b").all_inner_texts() if x.isdigit()]
        want = pg.evaluate(f"async (id) => {{ const a = {APP}; return a.byId(id).commute[a.dest().name].times.subway?.map((v) => v == null ? null : Math.round(v)); }}", lid)
        assert sub == [v for v in want if v is not None]
    assert not s.take(), s.take()
