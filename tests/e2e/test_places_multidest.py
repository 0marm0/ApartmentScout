"""Place filters ("east of 3rd Ave", "near Bryant Park", "in Murray Hill") and several commute destinations, in a real browser.

The place tests run on the example dashboard (one destination). The destination tests run on a TEMP copy of the example
search with two synthetic destinations and a synthetic subway, built with the real CLI (commute --dest, build) and served
next to the real dashboard files; examples/nyc-2026/criteria.yaml is never touched.
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path

import pytest
import yaml

# the e2e helpers (server, Session, console filter) live in tests/e2e/conftest.py; load them by path so the name `conftest`
# is never looked up in sys.modules (tests/conftest.py shares it), and put tests/ on the path for synthetic_gtfs.py
_spec = importlib.util.spec_from_file_location("e2e_helpers", Path(__file__).with_name("conftest.py"))
_h = importlib.util.module_from_spec(_spec)
sys.modules["e2e_helpers"] = _h
_spec.loader.exec_module(_h)
ROOT, THROTTLE, Session, allowed_console, build_url, serve = _h.ROOT, _h.THROTTLE, _h.Session, _h.allowed_console, _h.build_url, _h.serve
sys.path.insert(0, str(ROOT / "tests"))

pytestmark = pytest.mark.e2e
EXAMPLE = ROOT / "examples" / "nyc-2026"


@pytest.fixture
def op(open_page):
    """open_page, then wait for the shell's lazy feature module (undo, search, multi-destination) to start."""
    def _open(path: str = "#map", **kw):
        s = open_page(path, **kw)
        s.page.wait_for_function("() => typeof window.__undo === 'object'", timeout=20000)
        return s
    return _open


def _count(pg) -> int:
    return int(pg.evaluate("() => parseInt(document.getElementById('listTitle').textContent)"))


def _palette(pg, text: str) -> None:
    pg.wait_for_function("() => { const r = document.querySelector('.pl-scrim'); return !r || r.hidden; }")
    pg.keyboard.press("Control+k")
    pg.wait_for_selector("#plQ")
    pg.fill("#plQ", text)
    pg.wait_for_selector("#plList .pl-it")


def _first_row(pg) -> str:
    return pg.locator("#plList .pl-it").first.inner_text()


def _nl_chips(pg) -> list[str]:
    return pg.locator("#nlChips .nl-chip").all_inner_texts()


# ------------------------------------------------------------------ place filters
def test_east_of_an_avenue_is_a_chip_a_count_and_one_undo_step(op) -> None:
    s = op("#map")
    pg = s.page
    start = _count(pg)
    _palette(pg, "east of 3rd ave")
    row = _first_row(pg)
    assert row.startswith("Apply:") and "East of 3rd Avenue" in row, row
    assert re.search(r"\d+ of \d+ active homes", row), row
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#nlChips:not([hidden])")
    assert _nl_chips(pg) == ["East of 3rd Avenue"]
    east = _count(pg)
    assert 0 < east < start
    assert pg.evaluate("() => __undo.peek().undo") == "Applied a plain-language search"
    pg.keyboard.press("Control+z")
    assert _count(pg) == start
    pg.keyboard.press("Control+Shift+z")
    assert _count(pg) == east
    assert not s.take()


def test_west_and_east_of_an_avenue_split_the_homes(op) -> None:
    s = op("#map")
    pg = s.page
    counts = {}
    for q in ("east of 3rd ave", "west of 3rd ave"):
        _palette(pg, q)
        pg.keyboard.press("Enter")
        pg.wait_for_function("(n) => document.querySelector('#nlChips .nl-chip')?.textContent.includes(n)", arg=q.split()[0].capitalize())
        counts[q] = _count(pg)
        pg.click("#nlChips .nl-clear")
        pg.wait_for_selector("#nlChips", state="hidden")
    total = _count(pg)
    assert counts["east of 3rd ave"] + counts["west of 3rd ave"] <= total
    assert counts["east of 3rd ave"] + counts["west of 3rd ave"] >= total - 25, "the two sides together are nearly everything (homes on the avenue itself aside)"
    assert not s.take()


def test_between_streets_near_a_park_and_in_neighbourhoods(op) -> None:
    s = op("#map")
    pg = s.page
    for query, chip in (("between 30th and 45th street", "Between 30th Street and 45th Street"),
                        ("within 5 min walk of Bryant Park", "≤ 5 min walk to Bryant Park"),
                        ("in Murray Hill / Kips Bay", "In Murray Hill-Kips Bay"),
                        ("on the UES", "In Upper East Side"), ("south of 14th", "South of 14th Street")):
        _palette(pg, query)
        assert chip in _first_row(pg), (query, _first_row(pg))
        pg.keyboard.press("Enter")
        pg.wait_for_function("(c) => [...document.querySelectorAll('#nlChips .nl-chip')].some((b) => b.textContent.includes(c))", arg=chip)
        assert _count(pg) < 434, (query, "the filter removes some homes")
        pg.click("#nlChips .nl-clear")
        pg.wait_for_selector("#nlChips", state="hidden")
    assert not s.take()


def test_place_filters_mix_with_the_rest_of_the_sentence_and_clear_one_chip_at_a_time(op) -> None:
    s = op("#map")
    pg = s.page
    _palette(pg, "2 bd under 6k east of 3rd ave near Bryant Park")
    assert _first_row(pg).startswith("Apply: 2 bd")
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#nlChips:not([hidden])")
    chips = _nl_chips(pg)
    assert chips == ["2 bd", "≤ $6,000", "East of 3rd Avenue", "≤ 5 min walk to Bryant Park"], chips
    f = pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2')).nl")
    assert sorted(f) == ["maxBeds", "maxCost", "minBeds", "w:near:park-bryant-park:5", "w:side:east:3rd avenue"], f
    pg.click('#nlChips .nl-chip:has-text("East of 3rd Avenue")')
    pg.wait_for_function("() => ![...document.querySelectorAll('#nlChips .nl-chip')].some((b) => b.textContent.includes('East of'))")
    assert _nl_chips(pg) == ["2 bd", "≤ $6,000", "≤ 5 min walk to Bryant Park"]
    assert pg.evaluate("() => __undo.peek().undo") == "Removed the filter: East of 3rd Avenue"
    pg.keyboard.press("Control+z")
    assert "East of 3rd Avenue" in _nl_chips(pg)
    assert not s.take()


def test_the_map_draws_what_a_place_filter_refers_to(op, webgl) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = op("#map")
    pg = s.page
    pg.wait_for_function("() => window.__asMap && window.__asMap.loaded()", timeout=30000)
    shapes = "() => (window.__asMap.getSource('place-filter')?.serialize().data.features || []).map((f) => f.geometry.type)"
    assert pg.evaluate(shapes) == []
    _palette(pg, "east of 3rd ave between 30th and 45th street")
    pg.keyboard.press("Enter")
    pg.wait_for_function("() => (window.__asMap.getSource('place-filter')?.serialize().data.features || []).length >= 3")
    assert set(pg.evaluate(shapes)) == {"LineString"}, "a street is one or more lines"
    assert pg.evaluate("() => ['pf-fill', 'pf-casing', 'pf-line', 'pf-label'].every((id) => !!window.__asMap.getLayer(id))")
    assert pg.evaluate("() => window.__asMap.getSource('place-filter-labels').serialize().data.features.map((f) => f.properties.label).sort().join()") == "30th Street,3rd Avenue,45th Street"
    pg.click("#nlChips .nl-clear")
    pg.wait_for_function("() => (window.__asMap.getSource('place-filter')?.serialize().data.features || []).length === 0")
    _palette(pg, "in Murray Hill / Kips Bay")
    pg.keyboard.press("Enter")
    pg.wait_for_function("() => (window.__asMap.getSource('place-filter')?.serialize().data.features || []).some((f) => f.geometry.type === 'Polygon')")
    pg.keyboard.press("Escape")   # a theme switch rebuilds the style: the outline must come back with it
    pg.keyboard.press("t")
    pg.wait_for_function("() => document.documentElement.dataset.theme === 'light'")
    pg.wait_for_function("() => ['pf-fill', 'pf-line'].every((id) => !!window.__asMap.getLayer(id)) && !!window.__asMap.getSource('place-filter')", timeout=20000)
    assert not s.take()


def test_an_unknown_street_is_reported_and_nothing_is_guessed(op) -> None:
    s = op("#map")
    pg = s.page
    start = _count(pg)
    _palette(pg, "east of foo avenue")
    row = _first_row(pg)
    assert "No place" in row and "foo avenue" in row, row
    pg.keyboard.press("Enter")
    assert _count(pg) == start and pg.locator("#nlChips:not([hidden])").count() == 0
    _palette(pg, "2 bd east of foo avenue")
    row = _first_row(pg)
    assert row.startswith("Apply: 2 bd") and "no place" in row.lower(), row
    pg.keyboard.press("Escape")
    _palette(pg, "north of 3rd ave")
    assert "Can’t filter by" in _first_row(pg) and "north-south" in _first_row(pg)
    pg.keyboard.press("Escape")
    assert not s.take()


def test_a_saved_place_filter_survives_a_reload(op) -> None:
    s = op("#map")
    pg = s.page
    _palette(pg, "in Murray Hill / Kips Bay")
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#nlChips:not([hidden])")
    n = _count(pg)
    pg.reload()
    pg.wait_for_function("() => typeof window.__undo === 'object'", timeout=20000)
    pg.wait_for_selector("#nlChips:not([hidden])")
    pg.wait_for_function("(n) => parseInt(document.getElementById('listTitle').textContent) === n", arg=n, timeout=15000)
    assert _nl_chips(pg) == ["In Murray Hill-Kips Bay"]


def test_the_example_with_one_destination_has_none_of_the_destination_ui(op) -> None:
    s = op("#map")
    pg = s.page
    assert pg.locator(".md-sec, .md-line, #dDests").count() == 0
    assert pg.evaluate("() => [...document.getElementById('sortSel').options].map((o) => o.value)") == ["match", "cost", "commute", "size", "ppsf"]
    assert not s.take()


def test_place_search_works_at_phone_width_and_in_light(op) -> None:
    s = op("#map", theme="light", width=390, height=844)
    pg = s.page
    _palette(pg, "east of 3rd ave")
    assert "East of 3rd Avenue" in _first_row(pg)
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#nlChips:not([hidden])")
    assert pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert not s.take()


# ------------------------------------------------------------------ several destinations
@pytest.fixture(scope="module")
def multi(tmp_path_factory):
    """(base url) of the dashboard served with a three-destination dataset built by the real CLI from a temp copy of the example."""
    from apartmentscout.cli import main
    from synthetic_gtfs import write_manhattan_feed
    tmp = tmp_path_factory.mktemp("multi-e2e")
    feed = write_manhattan_feed(tmp / "synthetic-subway.zip")
    search = tmp / "search"
    search.mkdir()
    listings = json.loads((EXAMPLE / "listings.json").read_text())
    keep = [L for L in listings if L.get("lat") is not None and L.get("status") != "gone"][:150]
    (search / "listings.json").write_text(json.dumps(keep))
    shutil.copy(EXAMPLE / "places.json", search / "places.json")
    crit = yaml.safe_load((EXAMPLE / "criteria.yaml").read_text())
    crit["commute"]["destinations"] += [
        {"name": "Partner", "address": "Columbus Circle, New York, NY", "lat": 40.7681, "lon": -73.9819, "arrive_by": "09:00", "max_minutes": 35, "weight": 1.5},
        {"name": "Gym", "address": "Union Square, New York, NY", "lat": 40.7359, "lon": -73.9906, "arrive_by": "09:00", "max_minutes": 15, "weight": 0.5}]
    crit["commute"]["transit"].update({"feeds": [{"name": "Synthetic subway", "path": str(feed), "mode": "subway"}], "walk_model": "grid", "land": False,
                                       "service_date": "2026-10-14", "heat_cell_m": 100})
    (search / "criteria.yaml").write_text(yaml.safe_dump(crit, sort_keys=False))
    main(["commute", "--search", str(search)])
    dash = tmp / "dashboard"
    dash.mkdir()
    for item in (ROOT / "dashboard").iterdir():
        if item.name not in ("data", "dist"):
            (dash / item.name).symlink_to(item)
    main(["build", "--search", str(search), "--out", str(dash / "data")])
    shutil.copy(ROOT / "dashboard" / "data" / "lqip.json", dash / "data" / "lqip.json")   # the page asks for the blur-up sidecar; this copy has no photos of its own
    httpd = serve(dash, _h.media_roots())
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


@pytest.fixture
def open_multi(browser, multi):
    contexts = []

    def _open(path: str = "#map", theme: str = "dark", width: int = 1440, height: int = 900) -> Session:
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=1, reduced_motion="reduce")
        contexts.append(ctx)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((multi, "data:", "blob:")) else r.abort())
        page = ctx.new_page()
        if THROTTLE > 1:
            ctx.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
        s = Session(page, multi)
        page.on("pageerror", lambda e: s.errors.append(f"pageerror: {e}"))

        def on_console(m) -> None:
            if m.type != "error":
                return
            url = (m.location or {}).get("url", "")
            (s.allowed if allowed_console(m.text, url, multi) else s.errors).append(f"console: {m.text[:300]} [{url}]")
        page.on("console", on_console)
        s.requests = []
        page.on("request", lambda r: s.requests.append(r.url))
        page.goto(build_url(multi, path, theme))
        page.wait_for_function("() => document.querySelector('#cards .card')", timeout=20000)
        page.wait_for_function("() => typeof window.__undo === 'object'", timeout=20000)
        return s

    yield _open
    for c in contexts:
        c.close()


def _cells(pg, nth: int = 0) -> dict[str, float | None]:
    """{destination: minutes} read off a card's compact line."""
    return pg.evaluate("""(n) => Object.fromEntries([...document.querySelectorAll('#cards .card')[n].querySelectorAll('.md-line .cd')].map((c) => [c.querySelector('.cd-n').textContent, c.querySelector('b').textContent === '—' ? null : +c.querySelector('b').textContent]))""", nth)


def test_the_rail_cards_and_sort_know_every_destination(open_multi) -> None:
    s = open_multi("#map")
    pg = s.page
    assert pg.locator(".md-sec .md-lim").count() == 3
    assert pg.locator(".md-sec h3").first.inner_text().lower().startswith("every destination")
    assert pg.locator(".md-sec .sec-tg").count() == 1, "collapsible like the other rail sections"
    assert pg.evaluate("() => [...document.querySelectorAll('.md-sec [data-md-dest]')].map((r) => r.getAttribute('aria-label'))") == [
        "Maximum minutes to Grand Central", "Maximum minutes to Partner", "Maximum minutes to Gym"]
    assert pg.locator("#cards .card").first.locator(".md-line .cd").count() == 3
    cells = _cells(pg)
    assert set(cells) == {"Grand Central", "Partner", "Gym"} and all(isinstance(v, (int, float)) for v in cells.values()), cells
    assert pg.locator("#cards .card .cd-all b").first.inner_text().isdigit()
    opts = pg.evaluate("() => [...document.getElementById('sortSel').options].map((o) => o.value)")
    assert opts[-1] == "combined", opts
    pg.select_option("#sortSel", "combined")
    pg.wait_for_function("() => document.querySelector('#cards .card .cd-all')")
    scores = pg.evaluate("() => [...document.querySelectorAll('#cards .card .cd-all b')].slice(0, 12).map((b) => +b.textContent)")
    assert scores == sorted(scores, reverse=True), scores
    assert not s.take()


def test_a_limit_per_destination_filters_chips_and_undoes(open_multi) -> None:
    s = open_multi("#map")
    pg = s.page
    start = _count(pg)
    pg.eval_on_selector('[data-md-dest="Partner"]', "(el) => { el.value = 25; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }")
    pg.wait_for_selector("#nlChips:not([hidden])")
    assert _nl_chips(pg) == ["≤ 25 min to Partner"]
    n = _count(pg)
    assert 0 < n < start
    worst = pg.evaluate("() => Math.max(...[...document.querySelectorAll('#cards .card')].map((c) => { const p = [...c.querySelectorAll('.md-line .cd')].find((x) => x.querySelector('.cd-n').textContent === 'Partner'); return p ? +p.querySelector('b').textContent : 0; }))")
    assert worst <= 25, worst
    assert pg.evaluate("() => document.querySelector('.md-sec [data-md-val=\"Partner\"]').textContent") == "≤ 25 min"
    pg.eval_on_selector('[data-md-dest="Gym"]', "(el) => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }")
    pg.wait_for_function("() => document.querySelectorAll('#nlChips .nl-chip').length === 2")
    assert _nl_chips(pg) == ["≤ 25 min to Partner", "≤ 20 min to Gym"]
    assert pg.evaluate("() => __undo.peek().undo") == "Commute limit: ≤ 20 min to Gym"
    pg.keyboard.press("Control+z")
    assert _nl_chips(pg) == ["≤ 25 min to Partner"]
    pg.click('#nlChips .nl-chip')
    pg.wait_for_selector("#nlChips", state="hidden")
    assert _count(pg) == start
    assert pg.evaluate("() => document.querySelector('.md-sec [data-md-val=\"Partner\"]').textContent") == "Any", "the slider follows the chip"
    assert not s.take()


def test_a_sentence_sets_a_limit_for_each_destination(open_multi) -> None:
    s = open_multi("#map")
    pg = s.page
    _palette(pg, "within 25 min of grand central and 30 min of partner")
    row = _first_row(pg)
    assert row.startswith("Apply:") and "≤ 25 min to Grand Central" in row and "≤ 30 min to Partner" in row, row
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#nlChips:not([hidden])")
    assert _nl_chips(pg) == ["≤ 25 min to Grand Central", "≤ 30 min to Partner"]
    pg.wait_for_function("() => document.querySelector('.md-sec [data-md-val=\"Partner\"]')?.textContent === '≤ 30 min'")
    assert pg.evaluate("() => document.querySelector('.md-sec [data-md-val=\"Grand Central\"]').textContent") == "≤ 25 min"
    gc_max = pg.evaluate("() => Math.max(...[...document.querySelectorAll('#cards .card')].map((c) => +c.querySelector('.md-line .cd .cd-n')?.parentElement.querySelector('b').textContent || 0))")
    assert gc_max <= 25
    # a limit for only one destination stays the existing commute lens
    pg.click("#nlChips .nl-clear")
    _palette(pg, "within 20 min of partner")
    assert "≤ 20 min to Partner" in _first_row(pg)
    pg.keyboard.press("Enter")
    pg.wait_for_function("() => document.querySelector('#rDest')?.value === 'Partner'")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('as:filters2')).maxCommute") == 20
    assert not s.take()


def test_the_drawer_lists_every_destination_and_a_row_shows_that_route(open_multi) -> None:
    s = open_multi("#map")
    pg = s.page
    pg.click("#cards .card >> nth=0")
    pg.wait_for_selector("#drawer.open #dDests")
    rows = pg.locator("#dDests .md-r:not(.md-h)")
    assert rows.count() == 3
    head = pg.locator("#dDests h3").inner_text().lower()
    assert "combined score" in head, head
    assert pg.locator("#dDests .md-r.lens").count() == 1
    assert "Grand Central" in pg.locator("#dDests .md-r.lens").inner_text()
    pg.click('#dDests [data-md-lens="Partner"]')
    pg.wait_for_function("() => document.querySelector('#dDests .md-r.lens')?.textContent.includes('Partner')")
    assert "commute to partner" in pg.locator("#dCommute h3").inner_text().lower()
    assert pg.evaluate("() => document.querySelector('#rDest').value") == "Partner", "the rail's destination follows"
    assert not s.take()


def test_the_shortlist_table_has_an_every_destination_column(open_multi) -> None:
    s = open_multi("#list")
    pg = s.page
    pg.wait_for_selector("#view-list table tbody tr .md-line", timeout=20000)
    heads = pg.evaluate("() => [...document.querySelectorAll('#view-list thead th')].map((t) => t.innerText.trim().toLowerCase())")
    assert "all destinations" in heads and "to grand central" in heads, heads
    cells = pg.locator("#view-list tbody tr").first.locator(".md-line .cd")
    assert cells.count() == 3
    pg.click("#view-list thead th:has-text('All destinations')")   # sorts by the combined score, best first
    pg.wait_for_function("() => document.querySelector('#view-list thead th.on')?.textContent.toLowerCase().includes('all destinations')")
    scores = pg.evaluate("() => [...document.querySelectorAll('#view-list tbody tr .md-line .cd-all b')].slice(0, 10).map((b) => +b.textContent)")
    assert scores == sorted(scores, reverse=True), scores
    assert not s.take()


def test_the_heat_map_can_show_the_farthest_or_the_weighted_destinations(open_multi, webgl) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_multi("#map")
    pg = s.page
    pg.wait_for_function("() => window.__asMap && window.__asMap.loaded()", timeout=30000)
    assert not any("commute-combined" in u for u in s.requests), "the combined surfaces load only when asked for"
    opts = pg.evaluate("() => [...document.querySelectorAll('#lgDest option')].map((o) => o.textContent)")
    assert opts[:3] == ["To Grand Central", "To Partner", "To Gym"] and opts[3:] == ["Farthest of all 3", "Weighted average"], opts
    pg.select_option("#lgDest", "*worst")
    pg.wait_for_function("() => document.getElementById('legend').textContent.includes('longest of 3')", timeout=15000)
    assert any("commute-combined-best.json" in u for u in s.requests)
    assert pg.evaluate("() => !!window.__asMap.getLayer('heat-fill')")
    assert pg.evaluate("() => document.querySelector('#lgDest').value") == "*worst"
    pg.click("#legend summary")
    assert "The longest trip to any of Grand Central, Partner, Gym" in pg.locator("#legend").inner_text()
    pg.select_option("#lgDest", "*weighted")
    pg.wait_for_function("() => document.getElementById('legend').textContent.includes('weighted mean of 3')")
    pg.click('#legend #lgMode [data-mode="subway"]')
    pg.wait_for_function("() => document.getElementById('legend').textContent.includes('weighted mean of 3')")
    pg.wait_for_function("() => window.__asMap.loaded()")
    assert any("commute-combined-subway.json" in u for u in s.requests)
    pg.select_option("#lgDest", "Partner")
    pg.wait_for_function("() => !document.getElementById('legend').textContent.includes('weighted mean')")
    assert pg.evaluate("() => document.querySelector('#lgDest').value") == "Partner"
    assert not s.take()


def test_a_combined_surface_follows_a_reload_and_ends_when_a_destination_is_picked(open_multi, webgl) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_multi("#map")
    pg = s.page
    pg.wait_for_function("() => window.__asMap && window.__asMap.loaded()", timeout=30000)
    pg.select_option("#lgDest", "*worst")
    pg.wait_for_function("() => document.getElementById('legend').textContent.includes('longest of 3')", timeout=15000)
    pg.reload()
    pg.wait_for_function("() => document.getElementById('legend')?.textContent.includes('longest of 3')", timeout=30000)
    pg.select_option("#rDest", "Gym")   # choosing a destination anywhere returns to that destination's own surface
    pg.wait_for_function("() => !document.getElementById('legend').textContent.includes('longest of 3')")
    assert not s.take()


def test_destination_ui_fits_a_phone_and_the_light_theme(open_multi) -> None:
    s = open_multi("#map", theme="light", width=390, height=844)
    pg = s.page
    assert pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert pg.locator("#cards .card").first.locator(".md-line").is_visible()
    box = pg.locator("#cards .card").first.locator(".md-line").bounding_box()
    card = pg.locator("#cards .card").first.bounding_box()
    assert box["x"] + box["width"] <= card["x"] + card["width"] + 1, "the destination line stays inside its card"
    assert not s.take()


def test_destination_ui_passes_axe_in_both_themes(open_multi) -> None:
    axe = Path(__file__).parent / "vendor" / "axe.min.js"
    if not axe.exists():
        pytest.skip("axe-core is not vendored in this checkout")
    for theme in ("dark", "light"):
        s = open_multi("#map", theme=theme)
        pg = s.page
        pg.click("#cards .card >> nth=0")
        pg.wait_for_selector("#drawer.open #dDests")
        pg.add_script_tag(path=str(axe))
        res = pg.evaluate("""async () => {
          const r = await axe.run({ include: [['.md-sec'], ['.md-line'], ['#dDests']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
          return r.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
        }""")
        assert res == [], (theme, res)
