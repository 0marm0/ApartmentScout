"""The calmer map in a real browser: count bubbles with the lowest price when zoomed out, one pin per building with its
unit count and a unit list on click, saved picks and the best-ranked homes that never join a bubble, the hover card on
desktop and the tap preview on a phone. The network is blocked (see conftest), so the basemap is the plain offline one
and only the pins and cards, which come from local data, are checked. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e

APP = "(await import('/js/app.js'))"
SRC = "window.__asMap.getSource('listings')._data.features"


def _wait_map(s) -> None:
    _wait_map_page(s.page)


def _wait_map_page(page) -> None:
    # blocked tiles make the map fall back to its offline basemap (the style is rebuilt once): wait for that, then for the pins.
    # While the style is swapped a layer can exist without its source (and the other way round), so every lookup is null-safe.
    page.wait_for_function("() => document.getElementById('mapOffline') && !document.getElementById('mapOffline').hidden && window.__asMap.isStyleLoaded()", timeout=30000)
    page.wait_for_function("() => { const m = window.__asMap; return !!(m && m.getLayer('pins-t') && m.getLayer('bld') && (m.getSource('listings')?._data?.features.length || 0) > 20 && (m.getSource('toppins')?._data?.features.length || 0) > 0); }", timeout=30000)
    page.wait_for_selector(".price-tag", timeout=30000)


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


# Resolves once the map has drawn a frame AFTER the move and has nothing left to do. queryRenderedFeatures answers from the last frame
# drawn, so a test that asks as soon as jumpTo returns (or after a fixed pause that a slow frame outlasts) reads the state from before.
IDLE_JS = """() => new Promise((resolve) => {
  const m = window.__asMap, done = () => { clearTimeout(t); resolve(true); }, t = setTimeout(() => { m.off('idle', done); resolve(false); }, 20000);
  m.once('idle', done); m.triggerRepaint();
})"""


def _idle(page) -> None:
    assert page.evaluate(IDLE_JS), "the map never went idle"


def _go(page, lon_lat, zoom: float) -> None:
    page.evaluate("([c, z]) => window.__asMap.jumpTo({ center: c, zoom: z })", [lon_lat, zoom])
    page.wait_for_function("() => window.__asMap.loaded() && !window.__asMap.isMoving()", timeout=10000)
    _idle(page)


def _screen(page, lon_lat) -> list[float]:
    return page.evaluate("""(c) => { const m = window.__asMap, q = m.project(c), r = m.getCanvas().getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; }""", lon_lat)


def _biggest_building(page) -> dict:
    return page.evaluate(f"""() => {{ const f = {SRC}.filter((x) => x.properties.bld).sort((a, b) => b.properties.n - a.properties.n)[0];
      return {{ id: f.id, n: f.properties.n, lbl: f.properties.lbl, pr: f.properties.pr, xy: f.geometry.coordinates }}; }}""")


def test_clusters_form_zoomed_out_count_every_home_and_show_the_lowest_price(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    center = pg.evaluate("() => window.__asMap.getCenter().toArray()")
    _go(pg, center, 15)
    assert pg.evaluate("() => window.__asMap.queryRenderedFeatures({ layers: ['clusters'] }).length") == 0   # zoomed in nothing is merged
    _go(pg, center, 10.2)
    clusters = pg.evaluate("""() => window.__asMap.queryRenderedFeatures({ layers: ['clusters'] }).map((f) => ({ n: f.properties.n, pr: f.properties.pr, id: f.id }))""")
    assert len(clusters) >= 2
    assert all(c["n"] >= 2 for c in clusters)
    # a bubble counts homes, not pins: a building pin inside it contributes all its units
    total = pg.evaluate("async () => { const a = " + APP + "; return a.sorted(a.filtered()).filter((L) => L.lat != null).length; }")
    tops_stars = pg.evaluate("() => window.__asMap.getSource('toppins')._data.features.length + window.__asMap.getSource('starred')._data.features.length")
    counted = pg.evaluate(f"() => {{ let n = 0; for (const f of {SRC}) n += f.properties.n; return n; }}")
    assert counted + tops_stars == total
    # each bubble carries the lowest monthly cost inside it, and it is a real price
    prices = pg.evaluate("""async () => { const m = window.__asMap, a = """ + APP + """; const out = [];
      for (const f of m.queryRenderedFeatures({ layers: ['clusters'] }).slice(0, 8)) {
        const leaves = await m.getSource('listings').getClusterLeaves(f.properties.cluster_id, 500, 0);
        out.push([f.properties.pr, Math.min(...leaves.map((l) => l.properties.pr))]); }
      return out; }""")
    assert prices and all(a == b and 1000 < a < 20000 for a, b in prices)
    assert pg.evaluate("() => !!window.__asMap.getLayer('cl-price') && window.__asMap.getLayoutProperty('cl-price', 'text-field')[1] === 'from $'")
    # clicking one zooms in and the bubble splits
    z0 = pg.evaluate("() => window.__asMap.getZoom()")
    xy = _screen(pg, pg.evaluate("() => window.__asMap.queryRenderedFeatures({ layers: ['clusters'] })[0].geometry.coordinates"))
    pg.mouse.click(*xy)
    pg.wait_for_function("(z) => window.__asMap.getZoom() > z + 0.5", arg=z0, timeout=8000)
    assert not s.take()


def test_saved_picks_never_join_a_bubble(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    ids = pg.evaluate("""async () => { const a = """ + APP + """;
      const ids = a.sorted(a.filtered()).filter((L) => L.lat != null && !a.isSaved(L.id)).slice(30, 33).map((L) => L.id);
      ids.forEach((id) => a.toggleSave(id)); return ids; }""")
    pg.wait_for_function("(ids) => ids.every((id) => window.__asMap.getSource('starred')._data.features.some((f) => f.id === id))", arg=ids, timeout=5000)
    assert pg.evaluate("(ids) => !" + SRC + ".some((f) => ids.includes(f.id))", ids)
    for lid in ids:
        coords = pg.evaluate("(id) => window.__asMap.getSource('starred')._data.features.find((f) => f.id === id).geometry.coordinates", lid)
        for zoom in (9.8, 11.0, 13.0):
            _go(pg, coords, zoom)
            rendered = pg.evaluate("() => window.__asMap.queryRenderedFeatures({ layers: ['pins-s'] }).map((f) => f.id)")
            assert lid in rendered, f"{lid} hidden at zoom {zoom}"
    # unstarring puts it back in the clustered source
    pg.evaluate("async (id) => { (" + APP + ").toggleSave(id); }", ids[0])
    pg.wait_for_function("(id) => !window.__asMap.getSource('starred')._data.features.some((f) => f.id === id)", arg=ids[0], timeout=5000)
    assert not s.take()


def test_the_best_ranked_homes_stay_visible_as_their_own_pins(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    top = pg.evaluate("""async () => { const a = """ + APP + """; return a.sorted(a.filtered()).filter((L) => L.lat != null && !a.isSaved(L.id) && L.status !== 'gone').slice(0, 10).map((L) => L.id); }""")
    on_map = pg.evaluate("() => window.__asMap.getSource('toppins')._data.features.map((f) => f.id)")
    assert sorted(top) == sorted(on_map)
    assert pg.evaluate("(ids) => !" + SRC + ".some((f) => ids.includes(f.id))", top)
    coords = pg.evaluate("(id) => window.__asMap.getSource('toppins')._data.features.find((f) => f.id === id).geometry.coordinates", top[0])
    _go(pg, coords, 10.0)
    assert top[0] in pg.evaluate("() => window.__asMap.queryRenderedFeatures({ layers: ['pins-t'] }).map((f) => f.id)")
    assert not s.take()


def test_a_building_is_one_pin_with_its_unit_count_and_a_unit_list(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    b = _biggest_building(pg)
    assert b["n"] >= 5 and b["lbl"].startswith(f"{b['n']} units · from $")
    # every one of its units is in the list, none of them has a pin of its own in the clustered source
    _go(pg, b["xy"], 15.5)
    assert b["id"] in pg.evaluate("() => window.__asMap.queryRenderedFeatures({ layers: ['bld', 'bld-s'] }).map((f) => f.id)")
    xy = _screen(pg, b["xy"])
    pg.mouse.move(xy[0] - 30, xy[1] - 30)
    pg.mouse.move(*xy, steps=3)
    pg.wait_for_selector(".bldcard", timeout=5000)           # hover: the building and its best homes
    assert f"{b['n']} units" in pg.locator(".bldcard").inner_text()
    assert pg.locator(".bldcard .bl li").count() == 3
    pg.mouse.click(*xy)
    pg.wait_for_selector(".bldlist", timeout=5000)           # click: every unit
    assert pg.locator(".bldlist .bl button[data-id]").count() == b["n"]
    assert f"{b['n']} units" in pg.locator(".bldlist .bl-h").inner_text()
    first = pg.locator(".bldlist .bl button[data-id]").first.get_attribute("data-id")
    pg.locator(".bldlist .bl button[data-id]").first.click()
    pg.wait_for_selector("#drawer.open", timeout=10000)
    assert pg.evaluate("async () => (" + APP + ").S.sel") == first
    assert pg.locator(".bldlist").count() == 0
    # the open home keeps a pin of its own even though it lives in a building
    pg.wait_for_function("(id) => window.__asMap.getSource('toppins')._data.features.some((f) => f.id === id)", arg=first, timeout=5000)
    assert not s.take()


def test_escape_closes_a_building_list(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    b = _biggest_building(pg)
    _go(pg, b["xy"], 15.5)
    pg.mouse.click(*_screen(pg, b["xy"]))
    pg.wait_for_selector(".bldlist", timeout=5000)
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => !document.querySelector('.bldlist')", timeout=3000)
    assert not s.take()


def test_pins_respect_the_filters(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    b = _biggest_building(pg)
    name = pg.evaluate("(id) => " + SRC + ".find((f) => f.id === id).properties.name", b["id"])
    pg.evaluate("async (q) => { (" + APP + ").setFilter('q', q); }", name)
    pg.wait_for_function("(n) => " + SRC + ".reduce((t, f) => t + f.properties.n, 0) + window.__asMap.getSource('toppins')._data.features.length + window.__asMap.getSource('starred')._data.features.length === n",
                         arg=pg.evaluate("async (q) => { const a = " + APP + "; return a.filtered().filter((L) => L.lat != null).length; }", name), timeout=5000)
    assert pg.evaluate(f"() => {SRC}.length") <= 2
    pg.evaluate("async () => { (" + APP + ").setFilter('q', ''); }")
    pg.wait_for_function(f"() => {SRC}.length > 20", timeout=5000)
    assert not s.take()


def test_hovering_a_pin_previews_the_home_without_opening_the_drawer(open_page, webgl: bool) -> None:
    _need_webgl(webgl)
    s = open_page("#map")
    pg = s.page
    _wait_map(s)
    f = pg.evaluate("() => { const f = window.__asMap.getSource('toppins')._data.features[0]; return { id: f.id, xy: f.geometry.coordinates }; }")
    _go(pg, f["xy"], 15)
    xy = _screen(pg, f["xy"])
    pg.mouse.move(xy[0] - 40, xy[1] - 40)
    pg.mouse.move(*xy, steps=4)
    pg.wait_for_selector(f'.hovercard[data-preview="{f["id"]}"]', timeout=5000)
    card = pg.locator(".hovercard[data-preview]").inner_text()
    assert "/mo" in card and "score" in card and "#" in card                      # price, score and rank
    assert not pg.evaluate("() => document.getElementById('drawer').classList.contains('open')")
    pg.mouse.move(xy[0] + 400, xy[1] + 300, steps=3)                              # moving away closes it
    pg.wait_for_function("() => !document.querySelector('.hovercard')", timeout=3000)
    pg.mouse.move(*xy, steps=3)
    pg.wait_for_selector(".hovercard[data-preview]", timeout=5000)
    pg.mouse.click(*xy)                                                           # a click still opens the drawer
    pg.wait_for_selector("#drawer.open", timeout=10000)
    assert pg.evaluate("async () => (" + APP + ").S.sel") == f["id"]
    assert not s.take()


def test_a_tap_previews_first_and_a_second_tap_opens(browser, base_url: str, webgl: bool) -> None:
    """A phone has no hover: the first tap on a pin shows the card (with an Open button), the second opens the drawer."""
    _need_webgl(webgl)
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=1, reduced_motion="reduce", service_workers="block")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{base_url}/#map")
        _wait_map_page(page)
        assert page.evaluate("() => matchMedia('(hover: none)').matches")
        f = page.evaluate("() => { const f = window.__asMap.getSource('toppins')._data.features[0]; return { id: f.id, xy: f.geometry.coordinates }; }")
        page.evaluate("([c]) => window.__asMap.jumpTo({ center: c, zoom: 15, padding: { bottom: 300 } })", [f["xy"]])
        page.wait_for_function("() => window.__asMap.loaded()", timeout=10000)
        _idle(page)
        xy = _screen(page, f["xy"])
        page.touchscreen.tap(*xy)
        page.wait_for_selector(f'.hovercard[data-preview="{f["id"]}"] .hc-open', timeout=5000)
        assert not page.evaluate("() => document.getElementById('drawer').classList.contains('open')")
        page.wait_for_timeout(700)                                                # (a faster pair would be a double-tap zoom)
        page.touchscreen.tap(*xy)                                                 # the second tap on the same pin opens it
        page.wait_for_selector("#drawer.open", timeout=10000)
        assert page.evaluate("async () => (await import('/js/app.js')).S.sel") == f["id"]
        assert not errors
    finally:
        ctx.close()
