"""Map interactions in a real browser: route preview on hover, the starred-only lens, the sun lens and the Shortlist
split view. The network is blocked (see conftest), so the basemap is the plain offline one; every overlay and
interaction comes from local data. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import pytest
from conftest import settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels: see conftest.NO_RASTER_JS

APP = "(await import('/js/app.js'))"


def _wait_map(s) -> None:
    s.page.wait_for_function("() => window.__asMap && window.__asMap.getLayer('pins') && window.__asMap.getLayer('route-ride')", timeout=30000)
    s.page.wait_for_selector(".price-tag", timeout=30000)


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _seed_stars(s, n: int = 3) -> list[str]:
    ids = s.page.evaluate(f"""async (n) => {{ const a = {APP};
      const ids = a.sorted(a.filtered()).filter((L) => L.lat != null && !a.isSaved(L.id)).slice(0, n).map((L) => L.id);
      ids.forEach((id) => a.toggleSave(id)); return ids; }}""", n)
    assert len(ids) == n
    return ids


def test_route_preview_draws_on_card_hover_and_stays_for_the_open_drawer(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    # a home whose best route has subway legs, so there is a ride to draw
    lid = pg.evaluate(f"""async () => {{ const a = {APP};
      return a.sorted(a.filtered()).find((L) => L.lat != null && (a.modesOf(L).legs || []).some((g) => g.mode === 'subway'))?.id; }}""")
    assert lid
    card = pg.locator(f'#cards .card[data-id="{lid}"]')
    card.scroll_into_view_if_needed()
    card.hover()
    pg.wait_for_function("() => window.__asMap.getSource('route')._data.features.some((f) => f.properties.kind === 'ride')", timeout=10000)
    kinds = pg.evaluate("() => [...new Set(window.__asMap.getSource('route')._data.features.map((f) => f.properties.kind))]")
    assert "walk" in kinds and "ride" in kinds
    # the ride wears the official colour of its line, and a time pill says the minutes
    colour = pg.evaluate("() => window.__asMap.getSource('route')._data.features.find((f) => f.properties.kind === 'ride').properties.color")
    assert colour.startswith("#") and len(colour) == 7
    pg.wait_for_selector(".rt-pill.in", timeout=5000)
    assert "min" in pg.locator(".rt-pill").inner_text()
    # one source, layers added once: hovering another home only swaps the data
    layers_before = pg.evaluate("() => window.__asMap.getStyle().layers.filter((l) => l.id.startsWith('route-')).length")
    other = pg.locator("#cards .card").nth(1)
    other.hover()
    pg.wait_for_timeout(500)
    assert pg.evaluate("() => window.__asMap.getStyle().layers.filter((l) => l.id.startsWith('route-')).length") == layers_before == 6
    # leaving clears it
    pg.mouse.move(5, 5)
    pg.wait_for_function("() => document.querySelectorAll('.rt-pill.in').length === 0", timeout=5000)
    # an open drawer keeps its home's route when nothing is hovered
    card.click()
    pg.wait_for_selector("#drawer.open", timeout=10000)
    pg.mouse.move(5, 5)
    pg.wait_for_timeout(600)
    assert pg.evaluate("() => document.querySelectorAll('.rt-pill.in').length") == 1
    assert pg.evaluate("() => window.__asMap.getSource('route')._data.features.length") > 0
    assert not s.take()


def test_route_preview_follows_the_commute_lens(open_page, webgl: bool) -> None:
    """Walking has no timetable: the route is one dashed straight line and says so."""
    _need_webgl(webgl)
    s = open_page("#map?mode=walk")
    pg = s.page
    _wait_map(s)
    pg.locator("#cards .card").first.hover()
    pg.wait_for_selector(".rt-pill.in", timeout=10000)
    assert "straight line" in pg.locator(".rt-pill").inner_text()
    kinds = pg.evaluate("() => [...new Set(window.__asMap.getSource('route')._data.features.map((f) => f.properties.kind))]")
    assert kinds == ["walk"]
    assert not s.take()


def test_starred_lens_chip_filters_the_map_and_brackets_step_through_stars(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    chip = pg.locator('[data-lens="stars"]')
    assert chip.is_disabled()                                   # no picks yet
    ids = _seed_stars(s, 3)
    pg.wait_for_function("() => document.querySelector('[data-lens=stars]') && !document.querySelector('[data-lens=stars]').disabled", timeout=5000)
    assert chip.locator("b").inner_text() == "3"
    assert chip.get_attribute("aria-pressed") == "false"
    all_pins = pg.evaluate("() => window.__asMap.getSource('listings')._data.features.length")
    assert all_pins > 10
    chip.click()
    pg.wait_for_function("() => window.__asMap.getSource('listings')._data.features.length === 0", timeout=5000)
    assert pg.locator('[data-lens="stars"]').get_attribute("aria-pressed") == "true"
    assert sorted(pg.evaluate("() => window.__asMap.getSource('starred')._data.features.map((f) => f.id)")) == sorted(ids)
    pg.wait_for_function("() => document.querySelectorAll('.price-tag').length === 3 && [...document.querySelectorAll('.price-tag')].every((t) => t.classList.contains('fav'))", timeout=5000)
    # "+ List" also applies the saved-only filter to the results list
    pg.locator('[data-lens="stars-list"]').click()
    pg.wait_for_function("() => document.querySelectorAll('#cards .card').length === 3", timeout=5000)
    pg.locator('[data-lens="stars-list"]').click()
    # ] and [ fly to the next and previous star and open its mini card (no drawer)
    seen = []
    for key in ("]", "]", "]", "]"):
        pg.keyboard.press(key)
        pg.wait_for_function("() => { const c = document.getElementById('mapCard'); return c && !c.hidden && c.classList.contains('on'); }", timeout=5000)
        seen.append(pg.evaluate("() => document.querySelector('#mapCard .mc-t').textContent.trim()"))
    assert len(set(seen[:3])) == 3 and seen[3] == seen[0]       # a ring: the fourth press wraps to the first
    assert not pg.evaluate("() => document.getElementById('drawer').classList.contains('open')")
    pg.keyboard.press("[")
    pg.wait_for_function("(t) => document.querySelector('#mapCard .mc-t')?.textContent.trim() === t", arg=seen[2], timeout=5000)
    assert pg.evaluate("() => document.querySelector('#mapCard .mc-t').textContent.trim()") == seen[2]
    # with the drawer open the brackets move the drawer between stars
    pg.locator("#mapCard .btn.primary").click()
    pg.wait_for_selector("#drawer.open", timeout=10000)
    sel0 = pg.evaluate(f"async () => {APP}.S.sel")
    pg.keyboard.press("]")
    pg.wait_for_function(f"async (a) => ({APP}).S.sel !== a", arg=sel0, timeout=5000)
    assert pg.evaluate(f"async () => {APP}.isSaved({APP}.S.sel)")
    # lens off restores every pin (the floating drawer can sit over the layer switch at 1440 px, so close it first)
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => !document.getElementById('drawer').classList.contains('open')", timeout=5000)
    pg.locator('[data-lens="stars"]').click()
    pg.wait_for_function("(n) => window.__asMap.getSource('listings')._data.features.length === n", arg=all_pins, timeout=5000)
    assert not s.take()


def test_starred_means_saved_picks_never_the_favorite_field(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    fav = pg.evaluate(f"async () => {{ const a = {APP}; return a.S.listings.filter((L) => L.favorite && L.lat != null).length; }}")
    # whatever the data flags as favorite, the chip counts the renter's picks only
    assert pg.locator('[data-lens="stars"]').is_disabled(), f"{fav} listings flagged favorite in the data must not count as stars"
    assert pg.evaluate("() => window.__asMap.getSource('starred')._data.features.length") == 0
    assert not s.take()


def test_sun_lens_colours_pins_by_sun_hours_and_keeps_unknown_grey(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    pg.locator('[data-layer="sun"]').click()
    pg.wait_for_selector("#legend .sun-key", timeout=5000)
    legend = pg.locator("#legend").inner_text()
    assert "Direct sun" in legend and "unknown" in legend.lower()
    month = pg.locator("#legend .sun-month b").inner_text()
    # homes with a model sit in their own unclustered source, coloured by hours; the rest are grey and marked unknown
    pg.wait_for_function("() => window.__asMap.getSource('sunpins')._data.features.length > 0", timeout=5000)
    cols = pg.evaluate("() => window.__asMap.getSource('sunpins')._data.features.map((f) => f.properties.col)")
    assert all(c.startswith("#") and c != "#8a90a0" for c in cols)
    unk = pg.evaluate("() => window.__asMap.getSource('listings')._data.features.filter((f) => f.properties.unk && f.properties.col === '#8a90a0').length")
    assert unk > 10
    # price tags carry a sun chip: hours where there is a model, "?" where there is none
    assert pg.locator(".price-tag .sun-chip:not(.unk)").count() >= 1
    assert pg.locator(".price-tag .sun-chip.unk").count() >= 1
    assert pg.locator(".price-tag .sun-chip.unk").first.get_attribute("title").startswith("Direct sun unknown")
    # the month stepper changes the colouring and wraps
    pg.locator('[data-sunm="1"]').click()
    pg.wait_for_function("(m) => document.querySelector('#legend .sun-month b').textContent !== m", arg=month, timeout=5000)
    assert pg.locator('#legend [data-sunm="now"]').count() == 1
    pg.locator('#legend [data-sunm="now"]').click()
    pg.wait_for_function("(m) => document.querySelector('#legend .sun-month b').textContent === m", arg=month, timeout=5000)
    # leaving the lens restores score colours and the single clustered source
    pg.locator('[data-layer="none"]').click()
    pg.wait_for_function("() => window.__asMap.getSource('sunpins')._data.features.length === 0", timeout=5000)
    assert pg.evaluate("() => window.__asMap.getSource('listings')._data.features.every((f) => f.properties.col !== '#8a90a0')")
    assert not s.take()


@pytest.mark.parametrize("width,height", [(1440, 900), (420, 900)])
def test_split_view_follows_the_table_and_links_rows_and_pins(open_page, webgl: bool, width: int, height: int) -> None:
    _need_webgl(webgl)
    s = open_page("#list", width=width, height=height)
    pg = s.page
    pg.wait_for_selector("#table tbody tr.r", timeout=30000)
    btn = pg.locator("#lsSplit")
    assert btn.get_attribute("aria-pressed") == "false"
    btn.click()
    # ready = overlays and route layers exist (the offline fallback swaps the style once, so wait for the final one)
    ready = "() => { const m = window.__asSplitMap; return !!(m && m.getLayer('route-ride') && m.getSource('sp-pins') && m.getSource('sp-pins')._data.features.length > 0); }"
    pg.wait_for_function(ready, timeout=30000)
    # the blocked tiles walk the basemap down vector -> raster -> offline, a style swap each; the last one is when the attribution says so
    pg.wait_for_function("() => document.getElementById('splitAttrib')?.textContent.includes('Basemap offline')", timeout=30000)
    settled(pg, 30000, ticks=4)
    pg.wait_for_function(ready, timeout=30000)
    assert btn.get_attribute("aria-pressed") == "true"
    if width > 760:   # about a third of the stage
        box = pg.locator("#splitMap").bounding_box()
        stage = pg.locator("#view-list").bounding_box()
        assert 0.2 < box["width"] / stage["width"] < 0.42, box
    # the map holds exactly the table's rows, and follows a filter
    n_rows = pg.evaluate(f"async () => {APP}.filtered().length")
    assert pg.evaluate("() => window.__asSplitMap.getSource('sp-pins')._data.features.length") == n_rows
    pg.evaluate(f"async () => {APP}.setFilter('maxCommute', 15)")
    pg.wait_for_function(f"async () => window.__asSplitMap.getSource('sp-pins')._data.features.length === {APP}.filtered().length && {APP}.filtered().length !== {n_rows}", timeout=30000)
    assert pg.evaluate("() => window.__asSplitMap.getSource('sp-pins')._data.features.length") == pg.evaluate(f"async () => {APP}.filtered().length")
    # hovering a row pulses its pin and previews its route
    settled(pg, 30000, ticks=6)
    row = pg.locator("#table tbody tr.r").nth(1)
    row.hover()
    pg.wait_for_selector(".sp-pulse", state="attached", timeout=10000)   # a zero-size anchor whose rings are children
    pg.wait_for_function("() => window.__asSplitMap.getSource('route')._data.features.length > 0", timeout=10000)
    pg.mouse.move(5, 5)
    pg.wait_for_function("() => document.querySelectorAll('.sp-pulse').length === 0", timeout=5000)
    # clicking a pin scrolls to its row, highlights it and moves focus there
    lid = pg.evaluate("""() => { const m = window.__asSplitMap, f = m.getSource('sp-pins')._data.features.at(-1); return f.id; }""")
    xy = pg.evaluate("""(id) => { const m = window.__asSplitMap, f = m.getSource('sp-pins')._data.features.find((x) => x.id === id), p = m.project(f.geometry.coordinates), r = m.getCanvas().getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }""", lid)
    pg.mouse.click(xy[0], xy[1])
    pg.wait_for_function("(id) => document.activeElement && document.activeElement.closest('tr.r')?.dataset.id === id", arg=lid, timeout=10000)
    assert pg.evaluate("(id) => document.querySelector(`tr.r[data-id=\"${id}\"]`).classList.contains('pin-flash')", lid)
    # the choice is remembered in this browser
    pg.reload()
    pg.wait_for_selector("#table tbody tr.r", timeout=30000)
    assert pg.locator("#lsSplit").get_attribute("aria-pressed") == "true"
    pg.locator("#lsSplit").click()
    assert pg.locator("#splitMap").is_hidden()
    assert not s.take()
