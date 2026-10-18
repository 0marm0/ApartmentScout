"""The decision report in a real browser: Make a report from Compare and the Shortlist, the page it produces (page count, print media, no
broken images, notes hidden or shown), the 3D view from the window, and `apartmentscout report` printing the same page to a PDF.

The saved file is opened in a clean context with no network, exactly as a renter would open an attachment.
"""
from __future__ import annotations

from datetime import date, timedelta

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import ROOT, settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels: see conftest.NO_RASTER_JS

LISTINGS = json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())
SEARCH = json.loads((ROOT / "dashboard" / "data" / "criteria.json").read_text())["search"]["name"]
IDS = ["paramount-tower-25e", "the-greywood-4b", "paramount-tower-41a"]
SLOW = 60000
TOUR = f"{date.today() + timedelta(days=4):%Y-%m-%d}T10:30"   # a tour in the coming days: the planner shows the next booked day, so a fixed date goes stale
PICKS = {"paramount-tower-25e": {"saved": True, "tier": "S", "note": "PRIVATE-PICK-NOTE", "tour": TOUR},
         "the-greywood-4b": {"saved": True, "tier": "A"}, "paramount-tower-41a": {"saved": True, "tier": "B"}, "orion-condominium-23a": {"saved": True}}
LETTER_PX = (816, 1056)   # 8.5 x 11 in at 96 dpi


def payload_of(html: str) -> dict:
    return json.loads(re.search(r'id="as-data">(.*?)</script>', html, re.S).group(1))


def open_compare(open_page, ids=IDS, **kw):
    s = open_page(f"#compare/{','.join(ids)}", theme="light", **kw)
    s.page.wait_for_selector("#cmpReport", timeout=SLOW)
    s.page.wait_for_selector("#mnReport", state="attached", timeout=SLOW)   # the report feature has started (it loads after the page)
    return s


def download_report(s, tmp_path: Path, **opts) -> Path:
    """Open the sheet, set the options ({name: bool/value}) and download the HTML."""
    s.page.click("#cmpReport")
    s.page.wait_for_selector("#reportSheet.on", timeout=SLOW)
    for name, v in opts.items():
        box = s.page.locator(f"#reportSheet [data-opt={name}]")
        box.check() if v is True else box.uncheck() if v is False else box.select_option(v)
    with s.page.expect_download(timeout=180000) as dl:
        s.page.click("#rpFile")
    out = tmp_path / dl.value.suggested_filename
    dl.value.save_as(str(out))
    return out


def open_file(browser, path: Path, width: int = 1100):
    """The saved report in a clean context (no network), ready to read: (context, page, errors)."""
    ctx = browser.new_context(viewport={"width": width, "height": 1000})
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(path.as_uri())
    page.wait_for_function("document.body.dataset.ready === '1'", timeout=SLOW)
    return ctx, page, errs


# --------------------------------------------------------------------------- the sheet
def test_make_a_report_opens_from_compare_with_the_compare_homes_chosen(open_page) -> None:
    s = open_compare(open_page)
    s.page.click("#cmpReport")
    s.page.wait_for_selector("#reportSheet.on", timeout=SLOW)
    sheet = s.page.locator("#reportSheet")
    assert sheet.get_by_role("heading", name="Make a report").is_visible()
    chosen = sheet.locator("[data-home]:checked")
    assert chosen.count() == 3 and {chosen.nth(i).get_attribute("data-home") for i in range(3)} == set(IDS)
    assert "3 of 4 chosen" in sheet.locator("#rpCount").inner_text()
    # four at most: with four chosen the others cannot be added; one is too few to compare
    sheet.locator("[data-home]:not(:checked)").first.click()   # the list is redrawn on every change: click, do not check()
    assert sheet.locator("[data-home]:checked").count() == 4 and sheet.locator("[data-home]:not(:checked):not(:disabled)").count() == 0
    for _ in range(3):
        sheet.locator("[data-home]:checked").first.click()
    assert s.page.locator("#rpOpen").is_disabled() and s.page.locator("#rpFile").is_disabled() and "two to four" in sheet.locator("#rpStatus").inner_text().lower()
    s.page.keyboard.press("Escape")
    s.page.wait_for_selector("#reportSheet", state="detached", timeout=5000)
    assert not s.take()


def test_the_shortlist_and_the_menu_start_from_the_best_saved_picks(open_page) -> None:
    s = open_page("#list", theme="light")
    s.page.evaluate("(p) => localStorage.setItem('as:picks', JSON.stringify(p))", PICKS)
    s.page.reload()
    s.page.wait_for_selector("#lsReport", timeout=SLOW)
    s.page.wait_for_selector("#mnReport", state="attached", timeout=SLOW)
    s.page.click("#lsReport")
    s.page.wait_for_selector("#reportSheet.on", timeout=SLOW)
    chosen = s.page.locator("#reportSheet [data-home]:checked")
    assert [chosen.nth(i).get_attribute("data-home") for i in range(chosen.count())] == IDS   # tier S, A, B: the three best saved picks
    assert s.page.locator("#reportSheet .rp-home").count() >= 4 and s.page.locator("#reportSheet .rp-tag", has_text="Saved").count() >= 3
    s.page.keyboard.press("Escape")
    s.page.wait_for_selector("#reportSheet", state="detached", timeout=5000)
    # the menu and the command palette open the same sheet
    s.page.evaluate("import('/js/features/report.js').then((m) => m.open())")
    s.page.wait_for_selector("#reportSheet.on", timeout=SLOW)
    s.page.keyboard.press("Escape")
    assert not s.take()


# --------------------------------------------------------------------------- the page
def test_the_report_has_a_page_per_part_prints_at_paper_size_and_has_no_broken_images(open_page, browser, tmp_path: Path) -> None:
    s = open_compare(open_page)
    out = download_report(s, tmp_path, stills=False)
    html = out.read_text(encoding="utf-8")
    assert not re.search(r'<(script|link)[^>]+(src|href)="https?://', html) and "/Users/" not in html and 'data:font/woff2' in html
    p = payload_of(html)
    assert [h["id"] for h in p["homes"]] == IDS and p["notes"] is False and "PRIVATE-PICK-NOTE" not in html
    ctx, page, errs = open_file(browser, out)
    info = page.evaluate("window.__report")
    assert info["pages"] == len(IDS) + 3 and info["overflow"] == [], info          # cover, table, a page each, checklist; nothing clipped
    assert page.locator(".sheet[data-kind=cover] h1").inner_text() == "Paramount Tower 25E"
    assert page.locator(".sheet[data-kind=home]").count() == 3 and page.locator("table.cmp tbody tr").count() > 15
    bad = page.evaluate("[...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.alt || i.src.slice(0, 60))")
    assert bad == [] and page.locator("img").count() >= 4
    assert page.evaluate("document.fonts.check('600 16px Geist')"), "the Geist font is embedded and loads"
    # print media: every sheet is one page of paper, the toolbar is gone and nothing sticks out sideways
    page.emulate_media(media="print")
    page.wait_for_function("getComputedStyle(document.getElementById('tools')).display === 'none'")
    boxes = page.evaluate("[...document.querySelectorAll('.sheet')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })")
    assert boxes == [list(LETTER_PX)] * (len(IDS) + 3), boxes
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
    pdf = tmp_path / "report.pdf"
    page.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
    data = pdf.read_bytes()
    assert len(re.findall(rb"/Type\s*/Page[^s]", data)) == len(IDS) + 3 and b"/MediaBox [0 0 612 792]" in data
    ctx.close()
    assert not errs and not s.take()


def test_open_report_shows_it_in_a_new_tab_ready_to_print(open_page) -> None:
    s = open_compare(open_page)
    s.page.click("#cmpReport")
    s.page.wait_for_selector("#reportSheet.on", timeout=SLOW)
    s.page.locator("#reportSheet [data-opt=stills]").uncheck()
    with s.page.context.expect_page(timeout=SLOW) as tab:
        s.page.click("#rpOpen")
    page = tab.value
    page.wait_for_function("document.body.dataset.ready === '1'", timeout=SLOW)
    assert page.url.startswith("blob:") and page.evaluate("window.__report.pages") == len(IDS) + 3
    assert page.locator("#print").is_visible() and page.title().startswith("Decision report:")
    s.page.wait_for_selector("#reportSheet", state="detached", timeout=SLOW)      # the sheet closes once the report is open
    assert not s.take()


def test_the_paper_size_switches_to_a4_and_back(open_page, browser, tmp_path: Path) -> None:
    s = open_compare(open_page)
    out = download_report(s, tmp_path, stills=False, photos=False, paper="a4")
    ctx, page, errs = open_file(browser, out)
    assert payload_of(out.read_text(encoding="utf-8"))["paper"] == "a4" and page.locator("#paper").input_value() == "a4"
    page.emulate_media(media="print")
    w, h = page.evaluate("(() => { const r = document.querySelector('.sheet').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()")
    assert (w, h) == (794, 1123)                                       # 210 x 297 mm at 96 dpi
    assert page.evaluate("window.__report.overflow") == []             # the taller, narrower sheet still holds every page's content
    page.emulate_media(media="screen")
    page.select_option("#paper", "letter")
    page.emulate_media(media="print")
    assert page.evaluate("Math.round(document.querySelector('.sheet').getBoundingClientRect().width)") == 816
    assert page.evaluate("window.__report.overflow") == []
    ctx.close()
    assert not errs and not s.take()


def test_notes_are_in_the_report_only_when_ticked_and_can_be_hidden_again(open_page, browser, tmp_path: Path) -> None:
    s = open_compare(open_page)
    s.page.evaluate("(p) => localStorage.setItem('as:picks', JSON.stringify(p))", PICKS)
    s.page.reload()
    s.page.wait_for_selector("#mnReport", state="attached", timeout=SLOW)
    out = download_report(s, tmp_path, stills=False, photos=False, notes=True)
    html = out.read_text(encoding="utf-8")
    assert payload_of(html)["notes"] is True and "PRIVATE-PICK-NOTE" in html and TOUR not in html
    ctx, page, errs = open_file(browser, out)
    assert page.locator("#notesTog").is_visible() and page.locator(".note").first.is_visible()
    assert "PRIVATE-PICK-NOTE" in page.locator(".sheet[data-kind=home]").first.inner_text()
    page.uncheck("#notes")                                              # hide them for printing
    page.emulate_media(media="print")
    assert "PRIVATE-PICK-NOTE" not in page.locator(".sheet[data-kind=home]").first.inner_text()
    ctx.close()
    # without the option the switch is not even offered
    s.page.evaluate("localStorage.removeItem('as:report-opts')")
    again = tmp_path / "again"
    again.mkdir()
    out2 = download_report(s, again, stills=False, photos=False, notes=False)
    ctx, page, errs = open_file(browser, out2)
    assert page.locator("#notesTog").is_hidden() and "PRIVATE-PICK-NOTE" not in out2.read_text(encoding="utf-8")
    ctx.close()
    assert not s.take()


def test_the_report_carries_the_plan_the_still_and_the_leasing_office_questions(open_page, browser, webgl, tmp_path: Path) -> None:
    if not webgl:
        pytest.skip("this browser cannot make a WebGL context")
    s = open_compare(open_page, ids=IDS[:2])
    out = download_report(s, tmp_path, stills=True, photos=True)
    p = payload_of(out.read_text(encoding="utf-8"))
    home = {h["id"]: h for h in p["homes"]}
    assert home[IDS[0]]["still"]["src"].startswith("data:image/jpeg;base64,") and home[IDS[0]]["still"]["when"] and home[IDS[0]]["still"]["face"] is not None
    assert home[IDS[0]]["plan"]["rooms"] and home[IDS[0]]["questions"] and home[IDS[0]]["photos"][0]["src"].startswith("data:image/")
    ctx, page, errs = open_file(browser, out)
    sheet = page.locator(".sheet[data-id='paramount-tower-25e']")
    assert sheet.locator(".card.still img").count() == 1 and sheet.locator(".card svg polygon").count() >= 5
    assert page.evaluate("[...document.querySelectorAll('.card.still img')].every((i) => i.complete && i.naturalWidth >= 800)")
    text = sheet.inner_text().lower()                                   # the headings are set in capitals by the stylesheet
    assert "open with the leasing office" in text and "still unknown" in text
    assert page.evaluate("window.__report.overflow") == []
    ctx.close()
    # taking the still must not change what Unit 3D remembers for the renter
    assert s.page.evaluate("localStorage.getItem('as:unit-cam')") is None
    assert not errs and not s.take()


def test_a_home_with_no_site_model_says_so_where_the_view_would_be(open_page, browser, tmp_path: Path) -> None:
    no_site = next(L["id"] for L in LISTINGS if (L.get("score") or {}).get("rank") and not L.get("site") and L.get("photos_local"))
    s = open_compare(open_page, ids=[IDS[1], no_site])
    out = download_report(s, tmp_path, stills=False)
    ctx, page, errs = open_file(browser, out)
    assert "No 3D model of this home yet" in page.locator(f".sheet[data-id='{no_site}']").inner_text()
    assert "No floor plan yet" in page.locator(f".sheet[data-id='{no_site}']").inner_text()
    ctx.close()
    assert not errs and not s.take()


# --------------------------------------------------------------------------- the command line
def test_the_command_prints_the_same_report_with_the_3d_views(webgl, tmp_path: Path) -> None:
    if not webgl:
        pytest.skip("this browser cannot make a WebGL context")
    out = tmp_path / "report.pdf"
    r = subprocess.run([sys.executable, "-m", "apartmentscout", "report", "--search", str(ROOT / "examples" / "nyc-2026"), "--homes", *IDS[:2], "--out", str(out)],
                       capture_output=True, text=True, timeout=240, cwd=str(ROOT), env={**__import__("os").environ, "PYTHONPATH": str(ROOT)})
    assert r.returncode == 0, r.stderr[-800:]
    assert out.is_file() and out.read_bytes()[:5] == b"%PDF-" and len(re.findall(rb"/Type\s*/Page[^s]", out.read_bytes())) == 5
    assert "No 3D view" not in r.stdout and "skipped" not in r.stderr, (r.stdout, r.stderr)
    assert out.stat().st_size > 150_000                                 # photos, the plan and the 3D views are in it
