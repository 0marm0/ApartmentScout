"""The move planner in a real browser: the dates it works out from the move-in window, the cash summary, a checklist that is kept (and
travels in the picks backup), and the calendar and Reminders exports.

Every test pins "today" with ?today=2026-10-15, so the dates do not depend on the day the suite runs.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path

import pytest
from conftest import ROOT

pytestmark = pytest.mark.e2e

SEARCH = json.loads((ROOT / "dashboard" / "data" / "criteria.json").read_text())["search"]["name"]
HOME = "paramount-tower-25e"
SLOW = 60000
STORE = f"as:moveplan:{SEARCH}"


def open_planner(open_page, start: str | None = None, width: int = 1440, extra: str = ""):
    s = open_page(f"?today=2026-10-15&move={HOME}{extra}#map", theme="light", width=width, height=900 if width > 600 else 844)
    s.page.wait_for_selector("#movePlanner.on", timeout=SLOW)
    if start:
        s.page.fill("#mvStart", start)
        s.page.wait_for_function(f"document.querySelector('#mvSub').textContent.includes('{date.fromisoformat(start).strftime('%b')}')")
    return s


def steps(s) -> dict[str, dict]:
    return s.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('#mvSteps [data-step]')].map((li) => [li.dataset.step, {
      date: li.querySelector('.mv-d b').textContent, status: li.className.replace(/ ?open/, '').replace('mv-step ', ''),
      done: li.querySelector('.mv-chk').getAttribute('aria-checked') === 'true', title: li.querySelector('.mv-t span').textContent }]))""")


def saved(s) -> dict:
    return json.loads(s.page.evaluate("(k) => localStorage.getItem(k)", STORE) or "{}")


# --------------------------------------------------------------------------- an iCalendar validator (RFC 5545, the parts a calendar needs)
def parse_ics(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8")
    assert text.endswith("\r\n") and not re.search(r"(?<!\r)\n", text), "every line ends in CRLF"
    lines = text.split("\r\n")[:-1]
    for ln in lines:
        assert len(ln.encode()) <= 75, f"line over 75 octets: {ln[:40]}"
    logical: list[str] = []
    for ln in lines:
        if ln.startswith(" "):
            logical[-1] += ln[1:]
        else:
            logical.append(ln)
    assert logical[0] == "BEGIN:VCALENDAR" and logical[-1] == "END:VCALENDAR"
    stack: list[str] = []
    events: list[dict] = []
    cur: dict | None = None
    for ln in logical:
        name, _, value = ln.partition(":")
        key = name.split(";")[0]
        if key == "BEGIN":
            stack.append(value)
            if value == "VEVENT":
                cur = {"alarms": 0}
        elif key == "END":
            assert stack.pop() == value
            if value == "VEVENT":
                events.append(cur)
                cur = None
        elif cur is not None and stack[-1] == "VEVENT":
            cur[name] = value
        elif cur is not None and stack[-1] == "VALARM":
            cur["alarms"] += key == "ACTION"
    assert stack == []
    assert "VERSION:2.0" in logical and any(x.startswith("PRODID:") for x in logical)
    for e in events:
        for need in ("UID", "DTSTAMP", "DTSTART;VALUE=DATE", "DTEND;VALUE=DATE", "SUMMARY"):
            assert need in e, f"{need} missing in {e.get('SUMMARY')}"
        assert re.fullmatch(r"\d{8}T\d{6}Z", e["DTSTAMP"])
        a, b = (date(int(v[:4]), int(v[4:6]), int(v[6:])) for v in (e["DTSTART;VALUE=DATE"], e["DTEND;VALUE=DATE"]))
        assert b - a == timedelta(days=1) and e["alarms"] == 1
    assert len({e["UID"] for e in events}) == len(events), "UIDs are unique"
    return events


# --------------------------------------------------------------------------- the dates
def test_the_lease_start_and_every_date_follow_the_move_in_window(open_page) -> None:
    s = open_planner(open_page)
    sub = s.page.locator("#mvSub").inner_text()
    # the example's window opens today: no time to arrange a move, so the plan starts two weeks out
    assert "Thu, Oct 29, 2026" in sub and "in 14 days" in sub
    assert s.page.locator("#mvStart").input_value() == "2026-10-29"
    assert "plan starts 14 days from today" in s.page.locator(".mv-notes").inner_text()
    st = steps(s)
    assert len(st) == 15 and st["apply"]["date"] == "Thu, Oct 15" and st["keys"]["date"] == "Thu, Oct 29" and st["move"]["date"] == "Thu, Oct 29"
    assert st["apply"]["status"].startswith("today") or "today" in st["apply"]["status"]
    # a start with time to spare: every step on its own day, in order
    s.page.fill("#mvStart", "2026-12-01")
    s.page.wait_for_function("document.querySelector('#mvSub').textContent.includes('Dec 1, 2026')")
    st = steps(s)
    assert {k: v["date"] for k, v in st.items()} == {
        "apply": "Tue, Oct 27", "approval": "Fri, Oct 30", "sign": "Tue, Nov 3", "pay": "Tue, Nov 3", "movers": "Tue, Nov 10", "reserve": "Tue, Nov 17", "internet": "Tue, Nov 17",
        "coi": "Fri, Nov 20", "utilities": "Fri, Nov 20", "usps": "Tue, Nov 24", "insurance": "Thu, Nov 26", "keys": "Tue, Dec 1", "move": "Tue, Dec 1", "address": "Fri, Dec 4", "condition": "Fri, Dec 4"}
    assert "You chose this date" in s.page.locator(".mv-basis").inner_text() and "after your latest move-in" in s.page.locator(".mv-notes").inner_text()
    s.page.click(".mv-basis .mv-link")
    s.page.wait_for_function("document.querySelector('#mvStart').value === '2026-10-29'")
    assert not s.take()


def test_a_current_lease_end_adds_the_notice_and_the_overlap_rent(open_page) -> None:
    s = open_planner(open_page, start="2026-12-01")
    s.page.fill("#mvEnd", "2026-12-15")
    s.page.wait_for_selector("#mvNotice")
    assert steps(s)["notice"]["date"] == "Fri, Nov 13"                       # 30 days before the lease ends; the 15th minus 30 is a Sunday-adjacent business day
    s.page.fill("#mvNotice", "60")
    s.page.keyboard.press("Tab")
    s.page.wait_for_function("document.querySelector('[data-step=notice] .mv-d b').textContent === 'Fri, Oct 16'")
    row = s.page.locator("#mvCosts tr", has_text="Overlap rent")
    assert "14 days where both leases run" in row.inner_text() and "$2,3" in row.inner_text()   # 14 days of $5,032: $2,314
    assert not s.take()


def test_the_cash_summary_uses_the_cost_model_and_names_what_is_unknown(open_page) -> None:
    s = open_planner(open_page)
    costs = s.page.locator("#mvCosts")
    assert "$5,032" in costs.locator("tr", has_text="First month").inner_text()
    assert "Not known" in costs.locator("tr", has_text="Security deposit").inner_text()
    assert "Due at signing" in costs.inner_text() and "and counting" in costs.inner_text()
    assert "Not counted yet: security deposit, application, broker and move-in fees" in costs.inner_text()
    s.page.fill("[data-cost=movers]", "950")
    s.page.keyboard.press("Tab")
    s.page.wait_for_function("document.querySelector('#mvCosts').innerText.includes('$5,982')")   # $5,032 + $950, a floor until the rest is known
    assert saved(s)["homes"][HOME]["movers"] == 950
    assert "so far" in s.page.locator("#movePlanner h3", has_text="Cash").inner_text()
    assert not s.take()


# --------------------------------------------------------------------------- the checklist is kept
def test_the_checklist_is_kept_like_the_renters_other_data(open_page) -> None:
    s = open_planner(open_page, start="2026-12-01")
    s.page.click("[data-step=apply] [data-act=done]")
    s.page.wait_for_function("document.querySelector('[data-step=apply] .mv-chk').getAttribute('aria-checked') === 'true'")
    assert "1 of 15 done" in s.page.locator("#mvProg").inner_text()
    s.page.click("[data-step=sign] [data-act=toggle]")                         # a step's own date can be moved
    s.page.fill("[data-step=sign] input[type=date]", "2026-11-05")
    s.page.wait_for_function("document.querySelector('[data-step=sign] .mv-d b').textContent === 'Thu, Nov 5'")
    assert "Your date" in s.page.locator("[data-step=sign]").inner_text()
    s.page.fill("#mvAddT", "Return the cable box")                              # and a step of the renter's own can be added
    s.page.fill("#mvAddD", "2026-11-30")
    s.page.click("#mvAdd button[type=submit]")
    s.page.wait_for_selector("#mvSteps li:has-text('Return the cable box')")
    plan = saved(s)["homes"][HOME]
    assert plan["start"] == "2026-12-01" and plan["done"] == {"apply": "2026-10-15"} and plan["dates"] == {"sign": "2026-11-05"} and plan["custom"][0]["title"] == "Return the cable box"
    assert saved(s)["chosen"] == HOME
    # a reload brings it all back
    s.page.reload()
    s.page.wait_for_selector("#movePlanner.on", timeout=SLOW)
    st = steps(s)
    assert st["apply"]["done"] and st["sign"]["date"] == "Thu, Nov 5" and s.page.locator("#mvStart").input_value() == "2026-12-01"
    assert s.page.locator("#mvSteps li:has-text('Return the cable box') .mv-d b").inner_text() == "Mon, Nov 30"
    # ticking it off again, removing the custom step and putting the moved date back all stick
    s.page.click("[data-step=apply] [data-act=done]")
    s.page.click("[data-step=sign] [data-act=toggle]")
    s.page.click("[data-step=sign] [data-act=reset]")
    s.page.wait_for_function("document.querySelector('[data-step=sign] .mv-d b').textContent === 'Tue, Nov 3'")
    li = s.page.locator("#mvSteps li:has-text('Return the cable box')")
    li.locator("[data-act=toggle]").click()
    li.locator("[data-act=remove]").click()
    s.page.wait_for_function("!document.querySelector('#mvSteps').textContent.includes('Return the cable box')")
    plan = saved(s)["homes"][HOME]
    assert plan.get("done") in (None, {}) and plan.get("dates") in (None, {}) and plan.get("custom") in (None, [])
    assert not s.take()


def test_the_plan_travels_in_the_picks_backup_under_one_key(open_page) -> None:
    s = open_planner(open_page, start="2026-12-01")
    s.page.click("[data-step=apply] [data-act=done]")
    s.page.fill("[data-cost=movers]", "800")
    s.page.keyboard.press("Tab")
    s.page.wait_for_function("(k) => JSON.parse(localStorage.getItem(k)).homes['paramount-tower-25e'].movers === 800", arg=STORE)
    extra = s.page.evaluate("async () => (await import('/js/app.js')).hooks.exportExtra()")
    assert list(extra["moveplan"]["homes"]) == [HOME] and extra["moveplan"]["homes"][HOME]["done"] == {"apply": "2026-10-15"} and extra["moveplan"]["chosen"] == HOME
    # an older copy never replaces a newer one on import, and a fresh browser takes the backup's plan
    s.page.evaluate("(k) => localStorage.removeItem(k)", STORE)
    s.page.reload()
    s.page.wait_for_selector("#mnMove", state="attached", timeout=SLOW)
    assert saved(s).get("homes") == {}                                    # the planner reopened from ?move= and has nothing saved for the home
    s.page.evaluate("async (x) => (await import('/js/app.js')).hooks.importExtra({ moveplan: x })", extra["moveplan"])
    assert saved(s)["homes"][HOME]["movers"] == 800 and saved(s)["homes"][HOME]["start"] == "2026-12-01"
    older = json.loads(json.dumps(extra["moveplan"]))
    older["homes"][HOME].update(movers=1, updated="2020-01-01")
    s.page.evaluate("async (x) => (await import('/js/app.js')).hooks.importExtra({ moveplan: x })", older)
    assert saved(s)["homes"][HOME]["movers"] == 800
    assert not s.take()


# --------------------------------------------------------------------------- the exports
def test_the_calendar_file_is_valid_and_has_one_event_per_open_step(open_page, tmp_path: Path) -> None:
    s = open_planner(open_page, start="2026-12-01")
    s.page.click("[data-step=apply] [data-act=done]")
    s.page.fill("#mvAddT", "Buy a rug, then measure; twice")
    s.page.fill("#mvAddD", "2026-11-05")
    s.page.click("#mvAdd button[type=submit]")
    s.page.wait_for_selector("#mvSteps li:has-text('Buy a rug')")
    with s.page.expect_download(timeout=SLOW) as dl:
        s.page.click("[data-act=ics]")
    assert dl.value.suggested_filename == "move-plan-paramount-tower-25e.ics"
    path = tmp_path / dl.value.suggested_filename
    dl.value.save_as(str(path))
    events = parse_ics(path.read_bytes())
    assert len(events) == 15, "fifteen steps, one ticked off, one added"
    by = {e["SUMMARY"]: e for e in events}
    assert "Submit your application" not in by and by["Sign the lease"]["DTSTART;VALUE=DATE"] == "20261103"
    assert by["Move in: Paramount Tower 25E"]["DTSTART;VALUE=DATE"] == "20261201" and by["Move in: Paramount Tower 25E"]["LOCATION"] == "240 East 39th Street\\, New York\\, NY"
    assert by["Buy a rug\\, then measure\\; twice"]["DTSTART;VALUE=DATE"] == "20261105"        # commas and semicolons are escaped
    assert not s.take()


def test_the_reminders_text_is_one_line_per_open_step(open_page) -> None:
    s = open_planner(open_page, start="2026-12-01")
    s.page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    s.page.click("[data-act=reminders]")
    s.page.wait_for_function("document.getElementById('toast').textContent.includes('Reminders')")
    text = s.page.evaluate("navigator.clipboard.readText()")
    lines = text.split("\n")
    assert lines[0] == "Move to Paramount Tower 25E: lease starts Tue, Dec 1, 2026" and len(lines) == 16
    assert "Sign the lease (due Tue, Nov 3)" in lines and "Collect the keys and walk through (due Tue, Dec 1)" in lines
    s.page.click("[data-act=checklist]")
    s.page.wait_for_function("document.getElementById('toast').textContent.includes('Checklist copied')")
    check = s.page.evaluate("navigator.clipboard.readText()")
    assert check.startswith("Move plan: Paramount Tower 25E\nLease starts Tue, Dec 1, 2026") and "[ ] Tue, Nov 3  Sign the lease" in check and "Due at signing: $5,032" in check
    assert not s.take()


# --------------------------------------------------------------------------- where it lives in the dashboard
def test_the_drawer_the_menu_and_the_palette_open_the_planner(open_page) -> None:
    s = open_page(f"?today=2026-10-15&open={HOME}#map", theme="light")
    s.page.wait_for_selector("#dMove", timeout=SLOW)
    sec = s.page.locator("#dMove")
    assert "0 of 15 done" in sec.inner_text() and "Lease starts Thu, Oct 29" in sec.inner_text() and "Plan the move" in sec.inner_text()
    sec.locator("[data-move-open]").click()
    s.page.wait_for_selector("#movePlanner.on", timeout=SLOW)
    assert s.page.locator("#mvT").inner_text() == "Paramount Tower 25E" and s.page.locator("#mvHome").input_value() == HOME
    s.page.click("[data-step=apply] [data-act=done]")
    s.page.keyboard.press("Escape")
    s.page.wait_for_selector("#movePlanner", state="detached", timeout=5000)
    s.page.wait_for_function("document.querySelector('#dMove') && document.querySelector('#dMove').textContent.includes('1 of 15 done')", timeout=SLOW)
    assert "Open the move plan" in s.page.locator("#dMove").inner_text()      # a plan with progress is "open", not "plan"
    s.page.evaluate("import('/js/features/move.js').then((m) => m.open())")
    s.page.wait_for_selector("#movePlanner.on", timeout=SLOW)
    assert s.page.locator("#mvHome option").count() >= 2
    s.page.keyboard.press("Escape")
    assert s.page.locator("#mnMove").count() == 1
    assert not s.take()


def test_the_planner_fits_a_phone(open_page) -> None:
    s = open_planner(open_page, start="2026-12-01", width=390)
    box = s.page.evaluate("(() => { const p = document.querySelector('.mv-panel').getBoundingClientRect(); return [Math.round(p.width), document.documentElement.scrollWidth]; })()")
    assert box[0] == 390 and box[1] <= 391
    assert s.page.evaluate("document.querySelector('#mvBody').scrollWidth <= document.querySelector('#mvBody').clientWidth + 1")
    s.page.click("[data-step=sign] [data-act=toggle]")
    assert s.page.locator("[data-step=sign] input[type=date]").is_visible()
    assert s.page.locator(".mv-bar [data-act=ics]").is_visible()
    assert not s.take()
