"""Why a home moved, and the unknowns that move its score, in a real browser, on the committed example.

The renter asked why the Knox 6B is missing from the top ten when it was #6 on Oct 13: the card says "↓40 since Oct 13", the
drawer says why (an estimated size, two prices that disagree, light and view, the weights, scoring 2.1), and typing the size
re-ranks it at once. Every number a test types is a fixture.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from conftest import settled

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "dashboard" / "data"
LISTINGS = json.loads((DATA / "listings.json").read_text())
SEARCH = json.loads((DATA / "criteria.json").read_text())["search"]["name"]
KNOX = "the-knox-6b"
KNOX_RANK = next(x for x in LISTINGS if x["id"] == KNOX)["score"]["ranks"]["action"]
SLOW = 90000   # a cap on waiting for the state: the list and the scoring worker take that long on a busy software-GL runner


def card(s, id: str = KNOX):
    """The card for a home, scrolled into the windowed list by opening its drawer."""
    # asked again until the card is there: the first ask is lost when the list has not been built yet (a busy software-GL runner), and a drawer
    # that is already open for this home is only redrawn, not scrolled to, so the next ask closes it first
    s.page.evaluate("() => { window.__askedCard = 0; }")
    s.page.wait_for_function("""async (id) => { const has = () => !!document.querySelector(`#cards .card[data-id="${id}"]`), n = (window.__askedCard = (window.__askedCard || 0) + 1);
      try { const m = await import('/js/app.js'); if (n > 1 && !has()) m.closeDrawer(); if (n === 1 || !has()) m.openDrawer(id, { instant: true }); } catch {}
      return has(); }""", arg=id, timeout=SLOW, polling=1000)
    return s.page.locator(f'#cards .card[data-id="{id}"]')


def knox(s) -> dict:
    return s.page.evaluate("""async (id) => { const m = await import('/js/app.js'); const L = m.byId(id);
      return { rank: L._rank, score: L._s, renter: L.score.renter || null, gates: L.score.gates, space: L.score.parts.space }; }""", id := KNOX)


def open_knox(s):
    card(s)
    s.page.wait_for_selector("#dUnknowns", timeout=SLOW)
    settled(s.page, 30000, ticks=4)   # the drawer redraws once the scores are in: act on the rows after that


def test_the_card_says_the_knox_fell_and_the_drawer_says_why(open_page) -> None:
    s = open_page("#map")
    note = card(s).locator(".mv-note")
    note.wait_for(timeout=SLOW)
    assert note.inner_text() == "↓40 since Oct 13"
    assert KNOX_RANK == 46 and card(s).locator(".rank").inner_text() == "#46"
    sec = s.page.locator("#dMoved")
    sec.wait_for(timeout=SLOW)
    text = sec.inner_text()
    assert "#6 → #46" in text and "Score 72.8 → 67.2" in text
    assert re.search(r"size now estimated at ~562 ft² \(no size listed\)", text, re.I)
    assert re.search(r"two prices disagree: scoring the higher", text, re.I)
    assert re.search(r"unit's own photos now count", text, re.I) and re.search(r"floor is inferred", text, re.I)
    assert re.search(r"scoring 2\.1 added interior", text, re.I) and "weights in your criteria changed" in text
    assert re.search(r"\d+ homes now rank above it", text)
    assert not s.take()


def test_a_card_note_opens_the_explanation(open_page) -> None:
    s = open_page("#map")
    card(s).locator(".mv-note").click()
    s.page.wait_for_function("""() => { const sc = document.querySelector('#drawer .d-scroll'), t = document.getElementById('dMoved'); return sc && t && sc.scrollTop > 100 && Math.abs(t.offsetTop - sc.scrollTop) < 400; }""", timeout=SLOW)


def test_the_rail_picks_the_run_to_compare_with_and_filters_to_the_homes_that_moved(open_page) -> None:
    s = open_page("#map")
    rail = s.page.locator(".mv-rail")
    rail.wait_for(timeout=SLOW)
    assert "Oct 13" in rail.locator(".mv-hint").inner_text() and "first run" in rail.locator(".mv-hint").inner_text()
    n = int(rail.locator("[data-mv-only] .n").inner_text())
    assert 20 < n < 150
    s.page.evaluate("() => document.querySelector('[data-mv-only]').click()")
    s.page.wait_for_function(f"() => document.getElementById('listTitle').textContent.startsWith('{n} homes')", timeout=SLOW)
    # another run: the price audit alone moved the Knox 14 places
    s.page.select_option(".mv-rail .mv-since", label="Oct 14, 8:39 pm")
    s.page.wait_for_function("() => /since Oct 14, 8:39 pm/.test(document.querySelector('#cards')?.textContent || '')", timeout=SLOW)
    m = int(s.page.locator("[data-mv-only] .n").inner_text())
    assert m < n
    assert card(s).locator(".mv-note").inner_text() == "↓14 since Oct 14, 8:39 pm"
    s.page.select_option(".mv-rail .mv-since", index=0)
    s.page.evaluate("() => document.querySelector('[data-mv-only]').click()")   # off again
    s.page.select_option("#sortSel", "moved")
    s.page.wait_for_function("() => document.querySelector('#cards .card .mv-note')", timeout=SLOW)
    first = s.page.locator("#cards .card").first.locator(".mv-note").inner_text()
    assert re.match(r"[↑↓]\d{3} since Oct 13", first), first
    assert not s.take()


def test_entering_the_size_re_ranks_the_knox_and_is_kept_as_the_renters(open_page) -> None:
    s = open_page("#map")
    open_knox(s)
    row = s.page.locator('#dUnknowns [data-uk="size"]')
    assert "Enter the size" in row.inner_text() and "~562 ft²" in row.inner_text()
    span = row.locator(".uk-span").inner_text()
    best, worst = (int(x) for x in re.search(r"#(\d+) to #(\d+)", span).groups())
    assert best < KNOX_RANK < worst, span
    row.locator("input").fill("800")
    live = row.locator(".uk-live")
    live.wait_for(timeout=5000)
    assert re.search(rf"With 800 ft²: score \d+\.\d \(now 67\.2\), rank #6 \(now #{KNOX_RANK}\)", live.inner_text())
    assert knox(s)["rank"] == KNOX_RANK, "typing alone saves nothing"
    row.locator("[data-uk-save]").click()
    s.page.wait_for_function("async (id) => (await import('/js/app.js')).byId(id)._rank === 6", arg=KNOX, timeout=SLOW)
    after = knox(s)
    assert after["renter"]["size"] == {"value": 800, "at": after["renter"]["size"]["at"], "source": "renter"}
    assert card(s).locator(".rank").inner_text() == "#6"
    assert "Saved 800 ft²" in s.page.locator("#toast").inner_text()
    assert card(s).locator(".mv-note").count() == 0, "back where it was on Oct 13: nothing to say"
    saved = s.page.evaluate("(k) => JSON.parse(localStorage.getItem('as:' + k))", f"facts:{SEARCH}")
    assert saved[KNOX]["size"]["value"] == 800 and saved[KNOX]["size"]["source"] == "renter"
    # the listing's own facts are not touched
    assert s.page.evaluate("async (id) => (await import('/js/app.js')).byId(id).sqft ?? null", KNOX) is None
    # it survives a reload, and clearing it puts the estimate back
    s.page.reload()
    s.page.wait_for_selector("#cards .card", timeout=SLOW)
    s.page.wait_for_function("async (id) => (await import('/js/app.js')).byId(id)._rank === 6", arg=KNOX, timeout=SLOW)
    open_knox(s)
    entered = s.page.locator('#dUnknowns [data-uk="size"]')
    assert "800 ft²" in entered.inner_text() and "source: renter" in entered.inner_text()
    entered.locator("[data-uk-clear]").click()
    s.page.wait_for_function("async (id) => (await import('/js/app.js')).byId(id)._rank === 46", arg=KNOX, timeout=SLOW)
    assert knox(s)["renter"] is None and knox(s)["rank"] == KNOX_RANK
    assert not s.take()


def test_a_confirmed_price_and_a_floor_move_the_knox_too(open_page) -> None:
    s = open_page("#map")
    open_knox(s)
    price = s.page.locator('#dUnknowns [data-uk="price"]')
    assert "Confirm the price" in price.inner_text() and "disagree" in price.inner_text()
    price.locator("input").fill("4725")
    price.locator("[data-uk-save]").click()
    s.page.wait_for_function("async (id) => (await import('/js/app.js')).byId(id).score.renter?.price", arg=KNOX, timeout=SLOW)
    k = knox(s)
    assert "price_dispute" not in k["gates"] and k["rank"] < KNOX_RANK
    s.page.wait_for_selector('#dUnknowns [data-uk="floor"]')
    s.page.locator('#dUnknowns [data-uk="floor"] input').fill("30")
    s.page.locator('#dUnknowns [data-uk="floor"] [data-uk-save]').click()
    s.page.wait_for_function("async (id) => (await import('/js/app.js')).byId(id).score.renter?.floor", arg=KNOX, timeout=SLOW)
    assert knox(s)["renter"].keys() == {"price", "floor"}
    assert not s.take()


def test_a_value_that_is_not_a_number_saves_nothing(open_page) -> None:
    s = open_page("#map")
    open_knox(s)
    row = s.page.locator('#dUnknowns [data-uk="size"]')
    row.locator("input").fill("lots")
    assert "does not look like a usable size" in row.locator(".uk-live").inner_text()
    row.locator("[data-uk-save]").click()
    assert knox(s)["renter"] is None
    assert s.page.evaluate("(k) => localStorage.getItem('as:' + k)", f"facts:{SEARCH}") in (None, "{}")


def test_the_unknowns_work_on_a_phone(open_page) -> None:
    s = open_page(f"?open={KNOX}#map", width=390, height=844)
    s.page.wait_for_selector("#dUnknowns", timeout=SLOW)
    settled(s.page, 30000, ticks=4)   # the drawer redraws once the scores are in: act on the rows after that
    row = s.page.locator('#dUnknowns [data-uk="size"]')
    row.scroll_into_view_if_needed()
    box = row.bounding_box()
    assert box["width"] <= 390 and box["x"] >= 0
    assert s.page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    row.locator("input").fill("700")
    row.locator("[data-uk-save]").click()
    s.page.wait_for_function("async (id) => (await import('/js/app.js')).byId(id).score.renter?.size", arg=KNOX, timeout=SLOW)
    assert not s.take()
