"""The New search wizard in a real browser: the manual flow end to end (download, copy, preview), validation, keyboard,
draft persistence, the empty state, phone width, accessibility, and the served flow against a real `apartmentscout serve` API.

The static fixtures serve dashboard/ only (no API), the way GitHub Pages or a standalone file would; the served tests
start apartmentscout/localapi.py on a temporary searches folder.
"""
from __future__ import annotations

import json
import threading
import warnings
from pathlib import Path

import pytest
import yaml

from apartmentscout import cli
from apartmentscout.config import Workspace, load_criteria
from apartmentscout.criteria_check import check_text
from apartmentscout.intake import init_search
from apartmentscout.localapi import ServeState, make_server

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
AXE = Path(__file__).parent / "vendor" / "axe.min.js"
WIZARD = ".wz-scrim.on .wz"
OVERFLOW = """() => { const vw = innerWidth, out = [];
  for (const el of document.querySelectorAll('.wz, .wz *')) { const r = el.getBoundingClientRect();
    if (!r.width || r.right <= vw + 1 || getComputedStyle(el).position === 'fixed') continue;
    let a = el.parentElement, clipped = false; while (a && a.classList && !a.classList.contains('wz-scrim')) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= vw + 1) { clipped = true; break; } a = a.parentElement; }
    if (!clipped) out.push(el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' right=' + Math.round(r.right)); }
  return out.slice(0, 6); }"""


def _next(page, n: int = 1) -> None:
    for _ in range(n):
        page.click("[data-act=next]")
        page.wait_for_timeout(120)


def _fill_basics(page, name: str = "Boston 2BR, fall 2026", city: str = "generic") -> None:
    page.fill("#f-name", name)
    page.click(f"[data-city={city}]")
    if city == "generic":
        page.click("[data-place='Boston']")


def _to_review(page, address: str = "1 Kendall Sq, Cambridge, MA") -> None:
    _next(page)   # basics -> places
    page.fill("#f-dest\\.0\\.address", address)
    _next(page, 6)
    page.wait_for_selector("#wzStepTitle:has-text('Almost there')")


def _open(open_page, path: str = "?new=1#map", **kw):
    s = open_page(path, **kw)
    s.page.wait_for_selector(WIZARD, timeout=10000)
    s.page.wait_for_timeout(300)
    return s


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_manual_flow_ends_in_a_downloadable_valid_criteria_file(open_page, theme: str) -> None:
    s = _open(open_page, theme=theme)
    pg = s.page
    assert not pg.evaluate("() => !!document.querySelector('meta[name=as-token]')"), "a static server has no local API"
    _fill_basics(pg)
    _next(pg)
    pg.click("[data-add=dest]")
    pg.fill("#f-dest\\.0\\.address", "1 Kendall Sq, Cambridge, MA")
    pg.fill("#f-dest\\.1\\.name", "Gym")
    pg.fill("#f-dest\\.1\\.address", "100 Main St, Boston")
    pg.click("[data-set='dest.0.mode'][data-v=subway]")
    pg.click("[data-set='dest.0.weight'][data-v='2']")
    _next(pg)
    pg.fill("#wzTarget", "4000"); pg.click("[data-fill=tiers]")
    assert pg.input_value("#f-hard_max") == "4675"
    _next(pg)
    pg.click("[data-size='2,650,950,1300']")
    _next(pg)
    pg.click("[data-set='am:pets'][data-v=must_have]")
    _next(pg)
    pg.click("[data-taste=luxury][data-lv='3']"); pg.click("[data-taste=quiet][data-lv='2']")
    pg.click("[data-add=rating]"); pg.fill("#f-rating\\.0\\.name", "The Ritz"); pg.click("[data-set='rating.0.rating'][data-v='5']")
    _next(pg)
    pg.click("[data-preset=shortest-commute]")
    _next(pg)
    pg.wait_for_selector("#wzStepTitle:has-text('Almost there')")
    with pg.expect_download() as d:
        pg.click(".wz-f [data-act=download]")
    text = Path(d.value.path()).read_text()
    rep = check_text(text)
    assert rep.ok, rep.errors
    c = yaml.safe_load(text)
    assert c["search"]["name"] == "Boston 2BR, fall 2026" and c["search"]["city"] == "generic"
    assert c["commute"]["destinations"][0] == {"name": "Work", "address": "1 Kendall Sq, Cambridge, MA", "arrive_by": "09:00", "max_minutes": 30, "weight": 2, "mode": "subway"}
    assert [d_["name"] for d_ in c["commute"]["destinations"]] == ["Work", "Gym"]
    assert c["budget"]["tiers"][0] == {"name": "Target", "max": 4000} and c["budget"]["hard_max"] == 4675
    assert c["unit"] == {"min_beds": 2, "sqft_floor": 650, "sqft_good": 950, "sqft_great": 1300}
    assert "pets" in c["must_have"] and c["building_ratings"] == {"The Ritz": 5}
    assert c["scoring"]["preset"] == "shortest-commute" and c["weights"]["building"] == 16 and c["weights"]["quiet"] == 6
    cli_text = pg.inner_text(".wz-cmd >> nth=0")
    assert "apartmentscout init searches/boston-2br-fall-2026 --criteria ~/Downloads/criteria-boston-2br-fall-2026.yaml" in cli_text
    assert "apartmentscout all --search searches/boston-2br-fall-2026" in cli_text
    assert not s.take()


def test_apply_as_preview_re_ranks_the_loaded_data(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    pg.fill("#f-name", "Same city, new rules")
    _next(pg)
    pg.fill("#f-dest\\.0\\.address", "Grand Central Terminal, New York")
    _next(pg, 2)
    _next(pg, 4)
    pg.wait_for_selector("#wzStepTitle:has-text('Almost there')")
    pg.click("[data-act=preview]")
    pg.wait_for_selector(".pv-banner", timeout=10000)
    assert pg.evaluate("() => !document.querySelector('.wz-scrim.on')")
    assert not s.take()


def test_empty_name_blocks_next_and_says_why(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    pg.click("[data-act=next]")
    pg.wait_for_timeout(200)
    assert "What are we looking for" in pg.inner_text("#wzStepTitle")
    assert "Give the search a name" in pg.inner_text("[data-err=name]")
    assert pg.get_attribute("#f-name", "aria-invalid") == "true"
    pg.fill("#f-name", "Fixed")
    assert pg.inner_text("[data-err=name]") == ""
    assert not s.take()


def test_inline_validation_across_steps(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    pg.fill("#f-name", "V"); _next(pg)
    pg.click("[data-act=next]")          # address missing
    assert "address" in pg.inner_text("[data-err='dest.0.address']").lower()
    pg.fill("#f-dest\\.0\\.address", "x"); pg.fill("#f-dest\\.0\\.max_minutes", "0")
    assert "more than 0" in pg.inner_text("[data-err='dest.0.max_minutes']")
    pg.fill("#f-dest\\.0\\.max_minutes", "30"); _next(pg)
    pg.fill("#f-tier\\.1\\.max", "2000")
    assert "Must be above Target" in pg.inner_text("[data-err='tier.1.max']")
    pg.fill("#f-tier\\.1\\.max", "3300"); pg.fill("#f-hard_max", "100")
    assert "below your last tier" in pg.inner_text("[data-err=hard_max]")
    pg.fill("#f-hard_max", "3500"); _next(pg)
    pg.fill("#f-sqft_good", "400")
    assert "larger than the floor" in pg.inner_text("[data-err=sqft_good]")
    assert not s.take()


def test_escape_closes_and_the_draft_survives_a_reload(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    pg.fill("#f-name", "Half finished")
    _next(pg); pg.fill("#f-dest\\.0\\.address", "Somewhere"); pg.wait_for_timeout(500)
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => !document.querySelector('.wz-scrim.on')")
    pg.reload()
    pg.wait_for_selector("#cards .card", timeout=20000)
    pg.evaluate("async () => (await import('/js/app.js')).openWizard({ mode: 'new' })")
    pg.wait_for_selector(WIZARD)
    assert pg.input_value("#f-dest\\.0\\.address") == "Somewhere", "resumes on the step it was left"
    pg.click("[data-goto=basics]")
    assert pg.input_value("#f-name") == "Half finished"
    assert "unfinished draft" in pg.inner_text(".wz-main")
    pg.click("[data-act=fresh]")
    pg.wait_for_timeout(300)
    assert pg.input_value("#f-name") == ""
    assert not s.take()


def test_keyboard_moves_through_radio_groups_and_enter_advances(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    pg.fill("#f-name", "Keys")
    pg.focus("[data-city=nyc]")
    pg.keyboard.press("ArrowRight")
    assert pg.get_attribute("[data-city=generic]", "aria-checked") == "true"
    pg.focus("#f-name"); pg.keyboard.press("Enter")
    pg.wait_for_selector("#wzStepTitle:has-text('Where do you go')")
    focused = pg.evaluate("() => document.activeElement && document.activeElement.id")
    assert focused == "wzStepTitle", "focus moves to the new step's heading"
    # Tab never leaves the dialog
    for _ in range(60):
        pg.keyboard.press("Tab")
    assert pg.evaluate("() => !!document.activeElement.closest('.wz')")
    assert not s.take()


def test_taste_answers_move_the_weights(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    _fill_basics(pg); _next(pg); pg.fill("#f-dest\\.0\\.address", "x"); _next(pg, 4)
    pg.wait_for_selector("#wzStepTitle:has-text('Finish, view')")
    assert "Not set" in pg.inner_text(".wz-ti >> nth=0")
    pg.click("[data-taste=luxury][data-lv='3']")
    assert "Sets Building to 16" in pg.inner_text(".wz-ti >> nth=0")
    pg.click("[data-taste=luxury][data-lv='3']")   # a second click on the same answer clears it
    assert "Not set" in pg.inner_text(".wz-ti >> nth=0")
    pg.click("[data-taste=quiet][data-lv='3']")
    _next(pg)
    assert pg.input_value("#w-quiet") == "10"
    assert "1 adjustment" in pg.inner_text(".wz-main")
    pg.click("[data-preset=biggest-and-nicest]")
    assert pg.input_value("#w-space") == "30" and pg.input_value("#w-quiet") == "10"
    assert not s.take()


def test_the_weight_list_comes_from_the_loaded_data(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    dims = pg.evaluate("async () => (await import('/js/app.js')).S.crit0.scoring.dimensions.map((d) => d[0])")
    _fill_basics(pg); _next(pg); pg.fill("#f-dest\\.0\\.address", "x"); _next(pg, 5)
    pg.wait_for_selector("#wzStepTitle:has-text('What matters most')")
    shown = pg.eval_on_selector_all(".wz [data-w]", "els => els.map((e) => e.dataset.w)")
    assert shown == dims
    assert not s.take()


def test_empty_state_leads_to_the_wizard(open_page) -> None:
    s = open_page("?data=nodata#map")
    pg = s.page
    pg.wait_for_selector(".onb", timeout=10000)
    assert "Start an apartment search" in pg.inner_text(".onb h2")
    pg.click("[data-onb=new]")
    pg.wait_for_selector(WIZARD)
    assert not [x for x in s.take() if "/nodata/" not in x], "only the data files that do not exist may 404"


def test_search_menu_opens_with_the_keyboard(open_page) -> None:
    s = open_page("#map", width=1600, height=900)
    pg = s.page
    pg.focus("#searchSwitch"); pg.keyboard.press("Enter")
    pg.wait_for_selector(".sm-pop.on")
    names = pg.eval_on_selector_all(".sm-it b", "els => els.map((e) => e.textContent)")
    assert names[0].startswith("New search") and any(n.startswith("Edit all") for n in names)
    pg.keyboard.press("ArrowDown"); pg.keyboard.press("Escape")
    pg.wait_for_function("() => !document.querySelector('.sm-pop')")
    assert pg.evaluate("() => document.activeElement.id") == "searchSwitch"
    pg.keyboard.press("Enter"); pg.wait_for_selector(".sm-pop.on")
    pg.click("[data-go=new]")
    pg.wait_for_selector(WIZARD)
    assert not s.take()


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_wizard_fits_a_phone(open_page, theme: str) -> None:
    s = _open(open_page, theme=theme, width=390, height=844)
    pg = s.page
    assert pg.is_hidden(".wz-steps") and pg.is_visible(".wz-pips")
    problems = []
    _fill_basics(pg)
    for step in range(8):
        if o := pg.evaluate(OVERFLOW):
            problems.append(f"step {step + 1}: {o}")
        if step == 1:
            pg.fill("#f-dest\\.0\\.address", "x")
        if step < 7:
            _next(pg)
    assert not problems, problems
    assert not s.take()


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_wizard_accessibility(open_page, theme: str, tmp_path_factory) -> None:
    s = _open(open_page, theme=theme)
    pg = s.page
    pg.add_script_tag(path=str(AXE))
    critical, serious = [], []
    _fill_basics(pg)
    for step in range(8):
        res = pg.evaluate("""async () => { const r = await axe.run(document.querySelector('.wz'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
          return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }""")
        for x in res:
            (critical if x["impact"] == "critical" else serious if x["impact"] == "serious" else []).append({"step": step + 1, **x})
        if step == 1:
            pg.fill("#f-dest\\.0\\.address", "x")
        if step < 7:
            _next(pg)
    if serious:
        warnings.warn(f"wizard axe ({theme}): " + "; ".join(f"step {x['step']} {x['id']} x{x['n']} {x['targets'][:1]}" for x in serious[:10]))
    assert not critical, json.dumps(critical, indent=1)
    assert not [x for x in serious if x["id"] in ("label", "aria-valid-attr-value", "color-contrast")], json.dumps(serious, indent=1)


# --------------------------------------------------------------------------- served by apartmentscout serve
@pytest.fixture
def served(tmp_path: Path, browser):
    searches = tmp_path / "searches"
    mine = searches / "mine"
    init_search(mine, "nyc")
    from apartmentscout.listings import normalize, save
    save([normalize({"building": "Test Tower", "unit": "12A", "address": "1 Main St, New York, NY", "status": "new", "beds": 1, "sqft": 700,
                     "lat": 40.7527, "lon": -73.9772, "price": {"gross": 3000}, "amenities": {"in_unit_wd": True}})], mine / "listings.json")
    state = ServeState(dash=ROOT / "dashboard", searches_dir=searches, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(mine))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    base = f"http://127.0.0.1:{state.port}"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce", accept_downloads=True)
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base, "data:", "blob:")) else r.abort())
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    yield page, base, searches, errors
    ctx.close()
    httpd.shutdown()
    httpd.server_close()


def test_served_create_a_search_folder(served) -> None:
    page, base, searches, errors = served
    page.goto(f"{base}/?new=1#map")
    page.wait_for_selector(WIZARD, timeout=20000)
    assert page.evaluate("() => !!document.querySelector('meta[name=as-token]')")
    _fill_basics(page, "Boston served", "generic")
    _to_review(page)
    assert page.input_value("#f-folder") == "boston-served"
    page.fill("#f-folder", "boston-served")
    page.click("[data-act=create]")
    page.wait_for_selector(".wz-note.good", timeout=10000)
    d = searches / "boston-served"
    rep = check_text((d / "criteria.yaml").read_text())
    assert rep.ok and (d / "listings.json").exists() and (d / "research").is_dir()
    assert yaml.safe_load((d / "criteria.yaml").read_text())["search"]["name"] == "Boston served"
    assert "serve --search" in page.inner_text(".wz-cmd")
    page.click("[data-act=open-new]")
    page.wait_for_function("() => document.querySelector('.onb h2')?.textContent.startsWith('Boston served')", timeout=30000)
    assert "has no listings yet" in page.inner_text(".onb h2")
    assert not errors, errors


def test_served_folder_name_collision_is_caught_before_the_server(served) -> None:
    page, base, searches, errors = served
    page.goto(f"{base}/?new=1#map")
    page.wait_for_selector(WIZARD, timeout=20000)
    _fill_basics(page, "mine", "generic")
    _to_review(page)
    assert "already exists" in page.inner_text("[data-err=folder]")
    page.click("[data-act=create]")
    page.wait_for_selector(".wz-note.bad")
    assert not (searches / "mine-2").exists() and not errors


def test_served_edit_saves_with_a_backup_and_rescoring_runs(served) -> None:
    page, base, searches, errors = served
    before = (searches / "mine" / "criteria.yaml").read_text()
    page.goto(f"{base}/?wizard=edit#map")
    page.wait_for_selector(WIZARD, timeout=20000)
    assert "edit search" in page.inner_text(".wz-eyebrow").lower()
    page.click("[data-goto=money]")
    page.fill("#f-hard_max", "3600")
    page.click("[data-goto=review]")
    assert "Hard cap" in page.inner_text(".wz-diff")
    page.click("[data-act=save]")
    page.wait_for_selector(".wz-note.good", timeout=10000)
    saved = load_criteria(searches / "mine" / "criteria.yaml")
    assert saved["budget"]["hard_max"] == 3600
    assert saved["commute"]["transit"]["feeds"], "transit feeds the wizard does not ask about are kept"
    backups = list((searches / "mine" / "backups").glob("criteria-*.yaml"))
    assert len(backups) == 1 and backups[0].read_text() == before
    page.click("[data-act=rescore]")
    page.wait_for_selector("[data-act=reload]", timeout=60000)
    assert "Done in" in page.inner_text(".wz-job")
    assert not errors, errors


def test_served_server_rejects_what_the_page_missed(served) -> None:
    """If the page's own check let something through, the server's 422 shows up in the wizard and nothing is written."""
    page, base, searches, errors = served
    before = (searches / "mine" / "criteria.yaml").read_text()
    page.goto(f"{base}/?wizard=edit#map")
    page.wait_for_selector(WIZARD, timeout=20000)
    r = page.evaluate("""async () => { const t = document.querySelector('meta[name=as-token]').content;
      const x = await fetch('/api/criteria', { method: 'POST', headers: { 'X-AS-Token': t, 'Content-Type': 'application/json' }, body: JSON.stringify({ yaml: 'search: {name: X}\\nunit: {sqft_floor: 9, sqft_good: 5, sqft_great: 2}\\n' }) });
      return [x.status, await x.json()]; }""")
    assert r[0] == 422 and "sizes must rise" in " ".join(r[1]["errors"])
    assert (searches / "mine" / "criteria.yaml").read_text() == before


def test_an_untouched_wizard_leaves_no_draft_behind(open_page) -> None:
    s = _open(open_page)
    pg = s.page
    pg.keyboard.press("Escape")
    pg.wait_for_function("() => !document.querySelector('.wz-scrim.on')")
    kept = pg.evaluate("() => Object.keys(localStorage).filter((k) => k.startsWith('as:wizard')).map((k) => localStorage.getItem(k)).filter((v) => v !== 'null')")
    assert kept == [], "nothing was typed, so nothing is kept"
    pg.evaluate("async () => (await import('/js/app.js')).openWizard({ mode: 'new' })")
    pg.wait_for_selector(WIZARD)
    assert "unfinished draft" not in pg.inner_text(".wz-main")
    assert not s.take()


def test_reopening_the_wizard_while_it_fades_out_keeps_it_open(open_page) -> None:
    """Esc starts a 200 ms fade-out that hides the dialog at the end. Opening it again before that timer fires
    (the next animation frame is late, as on a busy CI runner) must not be undone by the old timer: that race made
    `test_an_untouched_wizard_leaves_no_draft_behind` time out waiting for a dialog that was open but hidden."""
    s = _open(open_page)
    pg = s.page
    # make the animation frame that marks the dialog "on" arrive after the old 200 ms hide timer
    pg.evaluate("() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 450); }")
    pg.keyboard.press("Escape")
    pg.evaluate("async () => (await import('/js/app.js')).openWizard({ mode: 'new' })")
    pg.wait_for_timeout(700)                      # past both the 200 ms timer and the delayed frame
    assert pg.is_visible(WIZARD), "the old close timer hid a dialog that had been reopened"
    assert not s.take()
