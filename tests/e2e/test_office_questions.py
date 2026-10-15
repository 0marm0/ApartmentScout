"""Questions for the leasing office in a real browser: the drawer section and the Shortlist building rows open a draft for the
building, each question has a checkbox, the text and the mailto: link follow the checked questions, and "Mark answered" keeps a
pasted reply as a dated note and takes the question out of later drafts. The committed example (The Knox) is the data; the Knox 6B
price dispute (the building page against the quote) is the case the draft has to get right. Nothing here sends anything.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
SLOW = 30000
AXE = Path(__file__).parent / "vendor" / "axe.min.js"
KNOX = "the-knox-6b"
DISPUTE = re.compile(r"StreetEasy building page shows \$5,300 a month with 0\.75 months free on a 10-month lease.*I was quoted \$5,250 a month with 1 month free on a 10-month lease", re.S)


def open_knox(s, home: str = KNOX) -> None:
    s.page.wait_for_selector("#dOffice", timeout=SLOW)
    s.page.locator("#dOffice [data-office-unit]").click()
    s.page.wait_for_selector("#officeSheet.on", timeout=SLOW)


def body(s) -> str:
    return s.page.locator("#ofText").input_value()


def pick_note(s, id: str = KNOX) -> str:
    return s.page.evaluate("""async (id) => { const m = await import('/js/app.js'); return m.pick(id).note || ''; }""", id)


def test_the_drawer_offers_the_building_draft_with_the_price_dispute(open_page) -> None:
    s = open_page(f"?open={KNOX}#map")
    sec = s.page.locator("#dOffice")
    sec.wait_for(timeout=SLOW)
    assert "questions for the leasing office" in sec.inner_text().lower() and "open" in sec.inner_text()
    open_knox(s)
    sheet = s.page.locator("#officeSheet")
    assert sheet.get_attribute("role") == "dialog" and sheet.get_attribute("aria-modal") == "true"
    assert "Questions for The Knox" in sheet.locator("h2").inner_text()
    text = body(s)
    assert text.startswith("Hello,") and DISPUTE.search(text), text
    assert "in writing" in text and text.rstrip().endswith("[Your name]")
    assert "Unit 6B" in text and "Across these units" in text
    # one checkbox per question, grouped as the email will be; a "Mark answered" on each real question
    boxes = sheet.locator("input[data-q-chk]")
    assert boxes.count() >= 6 and sheet.locator("[data-ans-open]").count() >= 6
    assert sheet.locator("input[data-std]").count() == 4 and not sheet.locator("input[data-std]:checked").count()
    # evidence for the dispute is one click away, and it names both readings
    why = sheet.locator("[data-q='the-knox-6b:price'] .of-why").first
    why.locator("summary").click()
    assert "5,300" in why.inner_text() and "5,250" in why.inner_text()
    assert s.take() == []


def test_checkboxes_drive_the_text_and_the_mailto_link(open_page) -> None:
    s = open_page(f"?open={KNOX}#map")
    open_knox(s)
    sheet = s.page.locator("#officeSheet")
    mail = sheet.locator("#ofMail")
    href = mail.get_attribute("href")
    assert href.startswith("mailto:?subject=") and "@" not in href.split("?")[0], "no recipient is filled in"
    q = urllib.parse.parse_qs(href[len("mailto:?"):])
    assert q["subject"][0] == s.page.locator("#ofSubj").input_value() and q["subject"][0].startswith("Questions about unit")
    assert q["body"][0].replace("\r\n", "\n") == body(s), "the link carries the text as shown"
    # uncheck the dispute question: it leaves the text and the link
    box = sheet.locator("[data-q='the-knox-6b:price'] input[data-q-chk]")
    box.uncheck()
    assert "StreetEasy building page" not in body(s)
    assert "StreetEasy building page" not in urllib.parse.unquote(mail.get_attribute("href"))
    box.check()
    assert DISPUTE.search(body(s))
    # a standard lease-term question is off until asked for
    sheet.locator(".of-std summary").click()
    std = sheet.locator("input[data-std]").first
    assert "early-termination" not in body(s)
    sheet.locator("input[data-std]").nth(1).check()
    assert "early-termination" in body(s)
    std.check()
    # adding another Knox unit brings its questions in; an edited text is kept, then rewritten on request
    other = sheet.locator("input[data-unit='the-knox-4c']")
    if other.count() and not other.is_checked():
        other.check()
    s.page.locator("#ofText").fill(body(s) + "\nP.S. I can tour on Saturday.")
    sheet.locator("[data-q='the-knox-6b:price'] input[data-q-chk]").uncheck()
    assert "P.S. I can tour" in body(s) and sheet.locator("#ofEdited").is_visible()
    sheet.locator("[data-reset-text]").click()
    assert "P.S." not in body(s) and not sheet.locator("#ofEdited").is_visible()
    # nothing checked: no text, the actions are off
    while sheet.locator("input[data-q-chk]:checked").count():
        sheet.locator("input[data-q-chk]:checked").first.uncheck()
    assert body(s) == "" and sheet.locator("#ofCopy").is_disabled()
    assert s.take() == []


def test_copy_puts_the_checked_text_on_the_clipboard_and_escape_closes(open_page) -> None:
    s = open_page(f"?open={KNOX}#map")
    s.page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=s.origin)
    open_knox(s)
    s.page.locator("#ofCopy").click()
    s.page.wait_for_selector("#toast.on")
    assert "Email copied" in s.page.locator("#toast").inner_text()
    assert s.page.evaluate("() => navigator.clipboard.readText()") == body(s)
    s.page.keyboard.press("Escape")
    s.page.wait_for_selector("#officeSheet", state="detached", timeout=5000)
    assert s.page.locator("#drawer.open").count() == 1, "the drawer is still there"
    assert s.take() == []


def test_the_draft_carries_no_renter_detail(open_page) -> None:
    s = open_page(f"?open={KNOX}#map")
    open_knox(s)
    text = body(s) + s.page.locator("#ofSubj").input_value() + s.page.locator("#ofMail").get_attribute("href")
    assert "[Your name]" in text and not re.search(r"[\w.+-]+@[\w-]+\.\w+|/Users/", urllib.parse.unquote(text))
    assert s.take() == []


def test_the_shortlist_building_row_opens_the_same_draft(open_page) -> None:
    s = open_page("#list")
    s.page.locator("#lsGroup [data-g='buildings']").click()
    chip = s.page.locator("tr.group", has_text="The Knox").locator(".of-chip")
    chip.wait_for(timeout=SLOW)
    assert re.fullmatch(r"\d+", chip.inner_text().strip()) and "leasing office" in chip.get_attribute("title")
    chip.click()
    s.page.wait_for_selector("#officeSheet.on")
    assert s.page.locator("tr.group", has_text="The Knox").get_attribute("aria-expanded") == "false", "the click did not also open the row"
    assert "Questions for The Knox" in s.page.locator("#officeSheet h2").inner_text() and DISPUTE.search(body(s))
    assert s.take() == []


def test_the_records_report_has_the_button_too(open_page) -> None:
    s = open_page(f"#research/records/{KNOX}")
    btn = s.page.locator("#rec .rec-head .of-rec")
    btn.wait_for(timeout=SLOW)
    btn.click()
    s.page.wait_for_selector("#officeSheet.on")
    assert DISPUTE.search(body(s))
    s.page.keyboard.press("Escape")
    s.page.wait_for_selector("#officeSheet", state="detached")
    assert s.page.locator("#rec .rec-head .of-rec").count() == 1, "closing the sheet does not add a second button"
    assert s.take() == []


def test_mark_answered_keeps_a_dated_note_proposes_values_and_drops_the_question(open_page) -> None:
    s = open_page(f"?open={KNOX}#map")
    s.page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=s.origin)
    open_knox(s)
    sheet = s.page.locator("#officeSheet")
    row = sheet.locator("[data-q='the-knox-6b:price']")
    row.locator("[data-ans-open]").click()
    form = row.locator("form")
    form.locator("[data-ans-text]").fill("Hi, the correct price is $5,250 a month with 1 month free on a 10-month lease. The website lags behind.")
    props = form.locator(".of-prop")
    props.first.wait_for(timeout=5000)
    assert props.count() == 3
    assert props.nth(0).locator("input[type=text]").input_value() == "5250"
    assert props.nth(1).locator("input[type=text]").input_value() == "1"
    assert props.nth(2).locator("input[type=text]").input_value() == "10"
    props.nth(2).locator("input[type=checkbox]").uncheck()           # the renter records the rent and the free month, not the term
    form.locator("[data-ans-how]").select_option("email")
    form.locator("[data-ans-day]").fill("2026-10-16")
    form.locator("button[type=submit]").click()
    s.page.wait_for_selector("[data-q='the-knox-6b:price']", state="detached", timeout=5000)
    # the question has left the draft; the answer is listed with its date and source
    assert not DISPUTE.search(body(s))
    done = sheet.locator(".of-done")
    assert "2026-10-16" in done.inner_text() and "email" in done.inner_text() and "$5,250 a month with 1 month free" in done.inner_text()
    assert "price.gross = 5250" in done.inner_text() and "price.lease_months" not in done.inner_text()
    # the reply is a dated, sourced note on the unit
    note = pick_note(s)
    assert note.startswith("Leasing office reply, 2026-10-16 (email), re price: Hi, the correct price is $5,250"), note
    # the confirmed values leave as an updates.json entry that `apartmentscout handoff import` reads
    sheet.locator("[data-copy-update]").click()
    doc = json.loads(s.page.evaluate("() => navigator.clipboard.readText()"))
    u = doc["unit_updates"][0]
    assert doc["schema"] == "apartmentscout-updates/1" and u["id"] == KNOX and u["checked_at"] == "2026-10-16"
    assert u["changes"] == {"price.gross": 5250, "price.free_months": 1} and u["source"] == "leasing office reply (email), 2026-10-16"
    # it survives a reload, and "Reopen" brings the question back (the note stays)
    s.page.reload()
    open_knox(s)
    assert not DISPUTE.search(body(s))
    s.page.locator("#officeSheet [data-reopen]").click()
    s.page.wait_for_selector("[data-q='the-knox-6b:price']")
    assert DISPUTE.search(body(s)) and pick_note(s).startswith("Leasing office reply")
    assert s.take() == []


def test_a_shared_question_is_answered_for_the_units_picked(open_page) -> None:
    s = open_page(f"?open={KNOX}#map")
    open_knox(s)
    sheet = s.page.locator("#officeSheet")
    row = sheet.locator("[data-q^='shared:move_in']").first
    row.locator("[data-ans-open]").click()
    form = row.locator("form")
    assert form.locator("[data-apply]").count() >= 2, "a shared question can be answered for each unit it covers"
    form.locator("[data-ans-text]").fill("Application $20, no broker fee, security deposit one month.")
    form.locator("button[type=submit]").click()               # first click shows what it read (nothing to record here), second saves
    if form.count():
        form.locator("button[type=submit]").click()
    s.page.wait_for_selector("[data-q^='shared:move_in']", state="detached", timeout=5000)
    assert "Application $20" in pick_note(s)
    assert "move in" not in body(s).lower().replace("move-in", "move in") or "What does it cost to move in" not in body(s)
    assert s.take() == []


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_the_sheet_and_the_drawer_section_pass_axe(open_page, theme: str) -> None:
    s = open_page(f"?open={KNOX}#map", theme=theme)
    s.page.wait_for_selector("#dOffice", timeout=SLOW)
    s.page.add_script_tag(path=str(AXE))
    run = """async (sel) => { const r = await axe.run(document.querySelector(sel), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | ')); }"""
    assert s.page.evaluate(run, "#dOffice") == []
    s.page.locator("#dOffice [data-office-unit]").click()
    s.page.wait_for_selector("#officeSheet.on")
    s.page.locator("#officeSheet [data-q='the-knox-6b:price'] [data-ans-open]").click()
    s.page.locator("#officeSheet [data-ans-text]").fill("It is $5,100 a month.")
    s.page.locator("#officeSheet .of-prop").first.wait_for(timeout=5000)
    assert s.page.evaluate(run, "#officeSheet") == []


def test_the_sheet_fits_a_phone_and_targets_are_thumb_sized(open_page) -> None:
    s = open_page(f"?open={KNOX}#map", width=390, height=800)
    open_knox(s)
    box = s.page.locator("#officeSheet .of-panel").bounding_box()
    assert box["width"] <= 390 and box["x"] >= 0
    assert s.page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    for sel in ("#ofCopy", "#ofMail", ".of-x"):
        b = s.page.locator(f"#officeSheet {sel}").bounding_box()
        assert b["height"] >= 40 and b["width"] >= 40, sel
    assert s.page.locator("#officeSheet input[data-q-chk]").first.bounding_box()["width"] >= 18
    assert s.take() == []
