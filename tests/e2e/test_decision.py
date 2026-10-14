"""The decision workflow in a real browser: the "since your last visit" pill, the decision tray, the trade-off pad, Share
shortlist and the decision memo, and the tour-day planner.

Each test opens the committed example, seeds what the feature reads (the renter's picks, a remembered visit, a history
file) through the page's own storage and routes, and checks what the renter would see and what leaves the browser.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
LISTINGS = json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())
SEARCH = json.loads((ROOT / "dashboard" / "data" / "criteria.json").read_text())["search"]["name"]
LIVE = sorted((x for x in LISTINGS if x.get("status") in ("new", "researching", "shortlist", "touring") and (x.get("score") or {}).get("eligible")),
              key=lambda x: -(x["score"].get("overall") or 0))
IDS = [x["id"] for x in LIVE[:12]]
GONE = next(x["id"] for x in LISTINGS if x.get("status") == "gone")
PICKS = {
    IDS[0]: {"saved": True, "tier": "S", "note": "PRIVATE-NOTE-ONE", "tour": "2026-10-17T10:30"},
    IDS[1]: {"saved": True, "tier": "A", "note": "PRIVATE-NOTE-TWO"},
    IDS[2]: {"saved": True, "tier": "B"},
    IDS[3]: {"saved": True},
}
SLOW = 30000


def seed(s, **keys) -> None:
    """Write localStorage keys (values are JSON-encoded by the app's store) and reload."""
    s.page.evaluate("(kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem('as:' + k, JSON.stringify(v)); }", keys)
    s.page.reload()
    s.page.wait_for_selector("#cards .card", state="attached", timeout=SLOW)


def state(s, expr: str):
    """Evaluate against the app's shared state module."""
    return s.page.evaluate(f"async () => {{ const m = await import('/js/app.js'); return ({expr})(m); }}")


# --------------------------------------------------------------------------- since your last visit
def history_doc() -> dict:
    ev = [
        {"id": IDS[0], "date": "2026-10-12", "type": "new", "to": 4800},
        {"id": IDS[4], "date": "2026-10-13", "type": "new", "to": None},
        {"id": IDS[1], "date": "2026-10-12", "type": "price", "field": "gross", "from": 5400, "to": 5150},
        {"id": IDS[2], "date": "2026-10-13", "type": "price", "field": "gross", "from": 4900, "to": 4800},
        {"id": GONE, "date": "2026-10-11", "type": "gone", "field": "status", "from": "new", "to": "gone"},
        {"id": IDS[3], "date": "2026-10-08", "type": "price", "field": "gross", "from": 4000, "to": 4100},   # before the visit
    ]
    return {"schema_version": 1, "generated": "2026-10-14", "note": None, "snapshots": [], "events": ev, "gone_fast": [], "price_history": {}, "availability": {}}


def open_with_history(open_page, visit_day: str | None, theme: str = "dark", width: int = 1440):
    s = open_page("#map", theme=theme, width=width, height=900 if width > 600 else 844)
    s.page.route("**/data/history.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(history_doc())))
    if visit_day:
        s.page.evaluate("([k, d]) => localStorage.setItem('as:' + k, JSON.stringify({ day: d, at: d + 'T10:00:00Z' }))", [f"visit:{SEARCH}", visit_day])
    s.page.reload()
    s.page.wait_for_selector("#cards .card", timeout=SLOW)
    return s


def test_visit_pill_lists_recorded_changes_and_opens_them(open_page) -> None:
    s = open_with_history(open_page, "2026-10-09")
    pill = s.page.locator(".visit-pill")
    pill.wait_for(timeout=SLOW)
    text = pill.get_attribute("aria-label")
    assert "2 new" in text and "2 price drops" in text and "1 gone" in text, text
    pill.click()
    pop = s.page.locator(".visit-pop")
    assert pop.is_visible()
    assert pop.locator(".vp-g").count() >= 3
    first = pop.locator("a.vp-row[data-home]").first
    target = first.get_attribute("data-home")
    first.click()
    s.page.wait_for_selector("#drawer.open", timeout=SLOW)
    assert state(s, "(m) => m.S.sel") == target
    assert not pop.is_visible()
    assert not s.take()


def test_visit_pill_is_hidden_without_recorded_changes_and_on_a_first_visit(open_page) -> None:
    s = open_with_history(open_page, None)           # a first visit: nothing to compare with
    assert s.page.locator(".visit-pill").count() == 0
    s2 = open_with_history(open_page, "2026-10-14")  # visited today: nothing is newer
    assert s2.page.locator(".visit-pill").count() == 0
    s3 = open_page("#map")                           # the committed example records no changes
    s3.page.evaluate("([k, d]) => localStorage.setItem('as:' + k, JSON.stringify({ day: d }))", [f"visit:{SEARCH}", "2026-10-14"])
    s3.page.reload()
    s3.page.wait_for_selector("#cards .card", timeout=SLOW)
    assert s3.page.locator(".visit-pill").count() == 0
    assert not s.take() and not s3.take()


def test_visit_pill_can_be_marked_seen_and_survives_a_reload(open_page) -> None:
    s = open_with_history(open_page, "2026-10-09")
    s.page.locator(".visit-pill").wait_for(timeout=SLOW)
    s.page.reload()                                   # the same tab keeps its baseline
    s.page.locator(".visit-pill").wait_for(timeout=SLOW)
    s.page.locator(".visit-pill").click()
    s.page.locator("[data-seen]").click()
    assert s.page.locator(".visit-pill").count() == 0
    s.page.reload()
    s.page.wait_for_selector("#cards .card", timeout=SLOW)
    assert s.page.locator(".visit-pill").count() == 0
    assert not s.take()


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_visit_pill_on_a_phone(open_page, theme: str) -> None:
    s = open_with_history(open_page, "2026-10-09", theme=theme, width=420)
    s.page.locator(".visit-pill").wait_for(timeout=SLOW)
    s.page.locator(".visit-pill").click()
    box = s.page.locator(".visit-pop").bounding_box()
    assert box and box["x"] >= 0 and box["x"] + box["width"] <= 420 + 1
    assert not s.take()


# --------------------------------------------------------------------------- decision tray
def compare_ids(s) -> list[str]:
    return state(s, "(m) => m.S.compare")


def test_tray_collects_dragged_homes_and_reorders_them(open_page) -> None:
    s = open_page("#map")
    s.page.wait_for_selector("#tray .tray-pill", state="visible", timeout=SLOW)
    assert "Drag homes here" in s.page.locator("#tray").inner_text()
    ids = s.page.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 4).map(c => c.dataset.id)")
    for i in range(3):
        s.page.drag_and_drop(f"#cards .card:nth-child({i + 1} of .card)", "#tray")
        s.page.wait_for_timeout(250)
    assert compare_ids(s) == ids[:3]
    assert s.page.locator("#tray .td-slot.filled").count() == 3
    assert s.page.locator("#cmpCount").inner_text() == "3"
    # drop the fourth on slot A: it goes first, the others shift
    s.page.drag_and_drop("#cards .card:nth-child(4 of .card)", "#tray .td-slot[data-slot='0']")
    s.page.wait_for_timeout(250)
    assert compare_ids(s) == [ids[3], ids[0], ids[1], ids[2]]
    # drag slot D onto slot A: reorder, no duplicate
    s.page.drag_and_drop("#tray .td-slot[data-slot='3'] .ts-main", "#tray .td-slot[data-slot='0']")
    s.page.wait_for_timeout(250)
    assert compare_ids(s) == [ids[2], ids[3], ids[0], ids[1]]
    # a fifth home replaces the one under the drop
    s.page.drag_and_drop("#cards .card:nth-child(5 of .card)", "#tray .td-slot[data-slot='1']")
    s.page.wait_for_timeout(250)
    five = s.page.eval_on_selector_all("#cards .card", "cs => cs[4].dataset.id")
    got = compare_ids(s)
    assert got[1] == five and len(got) == 4 and ids[3] not in got
    # keyboard reorder and remove
    s.page.focus("#tray .td-slot[data-slot='1'] .ts-main")
    s.page.keyboard.press("Alt+ArrowRight")
    assert compare_ids(s)[2] == five
    s.page.locator("#tray .td-slot[data-slot='0'] .ts-x").click()
    assert len(compare_ids(s)) == 3
    s.page.locator("#tray .td-go").click()
    s.page.wait_for_function("() => location.hash === '#compare'", timeout=SLOW)
    assert not s.take()


def test_tray_takes_a_dragged_map_tag_and_a_table_row(open_page, webgl) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser: the map draws no price tags")
    s = open_page("#map")
    s.page.wait_for_selector(".price-tag[data-id]:visible", timeout=SLOW)
    s.page.wait_for_selector("#tray .tray-pill", state="visible", timeout=SLOW)
    tag = s.page.locator(".price-tag[data-id]:visible").first
    tag_id, before = tag.get_attribute("data-id"), tag.bounding_box()
    s.page.drag_and_drop(".price-tag[data-id]:visible >> nth=0", "#tray")
    s.page.wait_for_timeout(300)
    assert compare_ids(s) == [tag_id]
    s.page.wait_for_selector(f'.price-tag[data-id="{tag_id}"]:visible', timeout=SLOW)   # tags are redrawn after the drop
    after = s.page.locator(f'.price-tag[data-id="{tag_id}"]:visible').first.bounding_box()
    assert abs(after["x"] - before["x"]) < 2 and abs(after["y"] - before["y"]) < 2 + 40, "dragging a tag must not pan the map"
    s.page.evaluate("location.hash = 'list'")
    s.page.wait_for_selector("#table tbody tr.r[data-id]", timeout=SLOW)
    row_id = s.page.locator("#table tbody tr.r[data-id]").nth(2).get_attribute("data-id")
    s.page.drag_and_drop("#table tbody tr.r[data-id] >> nth=2", "#tray")
    s.page.wait_for_timeout(300)
    assert compare_ids(s) == [tag_id, row_id]
    assert not s.take()


def test_tray_stays_in_step_with_the_compare_toggle_and_survives_a_reload(open_page) -> None:
    s = open_page("#map")
    s.page.wait_for_selector("#tray .tray-pill", state="visible", timeout=SLOW)
    for n in (1, 2):                                  # the quick actions show on hover
        card = s.page.locator(f"#cards .card:nth-child({n} of .card)")
        card.hover()
        card.locator("[data-cmp]").click()
    assert s.page.locator("#tray .td-slot.filled").count() == 2
    s.page.reload()
    s.page.wait_for_selector("#tray .td-slot.filled", timeout=SLOW)
    assert s.page.locator("#tray .td-slot.filled").count() == 2
    s.page.locator("#tray .ts-x").first.click()
    assert state(s, "(m) => m.S.compare.length") == 1
    assert s.page.locator("#cards .card.cmp").count() == 1
    assert not s.take()


def test_tray_is_a_pill_on_a_phone_and_hidden_on_compare(open_page) -> None:
    s = open_page("#map", width=420, height=844)
    seed(s, compare=IDS[:3])
    assert s.page.locator("#tray").get_attribute("data-state") == "pill"
    s.page.locator("#tray .tray-pill").click()
    s.page.wait_for_function("() => document.getElementById('tray').dataset.state === 'dock'")
    box = s.page.locator("#tray .tray-dock").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 421
    s.page.evaluate("location.hash = 'compare'")
    s.page.wait_for_function("() => document.getElementById('tray').hidden")
    assert not s.take()


# --------------------------------------------------------------------------- trade-off pad
def weights(s) -> dict:
    return state(s, "(m) => ({ ...m.S.weights })")


def slider_values(s) -> dict:
    return s.page.evaluate("() => Object.fromEntries([...document.querySelectorAll('#rail [data-w]')].map((r) => [r.dataset.w, +r.value]))")


def test_trade_off_pad_writes_the_slider_weights_and_reranks_live(open_page) -> None:
    s = open_page("#map")
    s.page.wait_for_selector(".tp-dot", timeout=SLOW)
    before = weights(s)
    cards = lambda: s.page.eval_on_selector_all("#cards .card", "cs => cs.slice(0, 12).map(c => c.dataset.id)")  # noqa: E731
    order0 = cards()
    s.page.locator(".tp-svg").scroll_into_view_if_needed()
    s.page.wait_for_timeout(150)
    svg, dot = s.page.locator(".tp-svg").bounding_box(), s.page.locator(".tp-dot .core").bounding_box()
    s.page.mouse.move(dot["x"] + dot["width"] / 2, dot["y"] + dot["height"] / 2)
    s.page.mouse.down()
    s.page.mouse.move(svg["x"] + svg["width"] * 0.17, svg["y"] + svg["height"] * 0.85, steps=10)   # toward Commute
    s.page.mouse.up()
    s.page.wait_for_timeout(900)
    after = weights(s)
    # the group's weight is conserved, the others untouched, and the shift is toward commute
    grp = ["cost", "commute", "space"]
    assert sum(after[k] for k in grp) == sum(before[k] for k in grp)
    assert all(after[k] == before[k] for k in after if k not in grp)
    assert after["commute"] > before["commute"] and all(float(v).is_integer() for v in after.values())
    # the sliders hold exactly those weights, and the cards were re-ranked by them
    sl = slider_values(s)
    assert all(sl[k] == after[k] for k in sl)
    expected = state(s, """async (m) => { const t = await import('/js/features/tradeoff-model.js');
      return t.rankIds(m.filtered(), m.S.weights, m.DIMS.map(([k]) => k)).slice(0, 12); }""")
    assert cards() == expected and cards() != order0
    assert not s.take()


def test_trade_off_pad_keyboard_presets_and_sliders_switch(open_page) -> None:
    s = open_page("#map")
    s.page.wait_for_selector(".tp-dot", timeout=SLOW)
    w0 = weights(s)
    s.page.focus(".tp-dot")
    s.page.keyboard.press("ArrowUp")                 # one notch to Cost, taken from the other two
    s.page.wait_for_timeout(100)
    w1 = weights(s)
    assert w1["cost"] == w0["cost"] + 1 and w1["commute"] + w1["space"] == w0["commute"] + w0["space"] - 1
    # a preset ghost previews the top ten and applies on click, through the rail's own select
    ghost = s.page.locator(".tp-ghost").nth(1)
    ghost.hover()
    s.page.wait_for_selector(".tp-pop li", timeout=5000)
    assert s.page.locator(".tp-pop li").count() == 10
    key = ghost.get_attribute("data-pad-preset")
    ghost.click()
    s.page.wait_for_function("(k) => document.getElementById('presetSel')?.value === k", arg=key, timeout=SLOW)
    assert state(s, "(m) => m.S.preset") == key
    # the sliders are one click away and show the same numbers
    s.page.locator(".tp-seg [data-m=sliders]").click()
    assert s.page.locator("#rail .weights").is_visible() and not s.page.locator(".tp-svg").is_visible()
    assert slider_values(s) == {k: v for k, v in weights(s).items() if k in slider_values(s)}
    assert not s.take()


# --------------------------------------------------------------------------- share and memo
def payload_of(html: str) -> dict:
    return json.loads(re.search(r'id="as-data">(.*?)</script>', html, re.S).group(1))


def share_download(s, tmp_path: Path, selector: str) -> str:
    with s.page.expect_download(timeout=60000) as dl:
        s.page.locator(selector).click()
    p = tmp_path / dl.value.suggested_filename
    dl.value.save_as(str(p))
    return p.read_text(encoding="utf-8")


def test_share_shortlist_downloads_a_read_only_page_without_the_notes(open_page, browser, tmp_path: Path) -> None:
    s = open_page("#list")
    seed(s, picks=PICKS)
    s.page.evaluate("location.hash = 'list'")
    s.page.wait_for_selector(".share-split .share-main", timeout=SLOW)
    html = share_download(s, tmp_path, ".share-split .share-main")
    p = payload_of(html)
    assert [h["id"] for h in p["homes"]] and set(h["id"] for h in p["homes"]) == set(PICKS)
    assert p["homes"][0]["score"]["overall"] >= p["homes"][-1]["score"]["overall"]
    assert "PRIVATE-NOTE" not in html and "2026-10-17T10:30" not in html and p["notes"] is False
    assert all(h["reasons"] for h in p["homes"]) and p["dest"] and p["map"]["lines"]
    assert not re.search(r'<(script|link)[^>]+(src|href)="https?://', html)
    # the saved file opens by itself
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})   # a clean context: the file has to work by itself, with no network
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(next(tmp_path.glob("shortlist-*.html")).as_uri())
    page.wait_for_selector(".home", timeout=SLOW)
    assert page.locator(".home").count() == len(PICKS)
    assert page.locator(".rank-list li").count() == len(PICKS)
    assert page.locator(".map svg .pin").count() == len(PICKS)
    ctx.close()
    assert not errs
    assert not s.take()


def test_share_includes_notes_only_when_ticked_and_the_memo_opens_for_printing(open_page, tmp_path: Path) -> None:
    s = open_page("#list")
    seed(s, picks=PICKS)
    s.page.evaluate("location.hash = 'list'")
    s.page.wait_for_selector(".share-split .share-more", timeout=SLOW)
    s.page.locator(".share-split .share-more").click()
    s.page.locator(".share-pop [data-opt=notes]").check()
    s.page.locator(".share-pop [data-opt=photos]").select_option("none")
    s.page.keyboard.press("Escape")
    html = share_download(s, tmp_path, ".share-split .share-main")
    p = payload_of(html)
    assert p["notes"] is True and "PRIVATE-NOTE-ONE" in html and "2026-10-17T10:30" not in html
    assert not any(h.get("photos") for h in p["homes"])
    # the memo opens in its own tab on the print layout
    s.page.locator(".share-split .share-more").click()
    with s.page.context.expect_page(timeout=60000) as np:
        s.page.locator(".share-pop [data-act=memo]").click()
    memo = np.value
    memo.wait_for_load_state()
    memo.wait_for_selector(".memo", state="attached", timeout=SLOW)
    assert memo.evaluate("document.body.dataset.view") == "memo"
    assert memo.locator(".m-home").count() == len(PICKS)
    assert "PRIVATE-NOTE-TWO" in memo.locator(".memo").inner_text()
    assert not s.take()


def test_share_with_nothing_saved_says_so(open_page) -> None:
    s = open_page("#list")
    s.page.wait_for_selector(".share-split", timeout=SLOW)
    s.page.locator(".share-split .share-main").click()
    s.page.wait_for_function("() => document.getElementById('toast').textContent.includes('Star a few homes')", timeout=5000)
    assert not s.take()


# --------------------------------------------------------------------------- tour-day planner
def open_planner(open_page, tmp_path=None, width: int = 1440):
    s = open_page("#list", width=width, height=900 if width > 600 else 844)
    seed(s, picks=PICKS)
    s.page.evaluate("location.hash = 'list/tours'")
    s.page.wait_for_selector(".tp2-item", timeout=SLOW)
    return s


def entries(s) -> list[dict]:
    return s.page.evaluate("""() => [...document.querySelectorAll('.tp2-item')].map((li) => ({ key: li.dataset.key, name: li.querySelector('.tp2-open').textContent,
      time: li.querySelector('.tp2-t b').textContent }))""")


def test_planner_lists_the_stops_with_leave_by_times_and_estimates(open_page) -> None:
    s = open_planner(open_page)
    e = entries(s)
    assert len(e) == len({LISTINGS_BY_ID[i]["building"] for i in PICKS})
    body = s.page.locator("#tourPlanner").inner_text()
    assert "Leave by" in body and "est." in body and "estimates" in body.lower()
    assert "Booked" in body and s.page.locator(".tp2-chip").count() >= 1
    assert not s.take()


LISTINGS_BY_ID = {x["id"]: x for x in LISTINGS}


def test_planner_reorders_by_drag_and_by_keyboard(open_page) -> None:
    s = open_planner(open_page)
    before = [x["key"] for x in entries(s)]
    s.page.focus(".tp2-item:nth-child(2) .tp2-grip") if False else None
    first_grip = s.page.locator(".tp2-item .tp2-grip").nth(0)
    last_card = s.page.locator(".tp2-item .tp2-card").nth(len(before) - 1).bounding_box()
    g = first_grip.bounding_box()
    s.page.mouse.move(g["x"] + g["width"] / 2, g["y"] + g["height"] / 2)
    s.page.mouse.down()
    s.page.mouse.move(g["x"] + 4, last_card["y"] + last_card["height"] + 10, steps=14)
    s.page.mouse.up()
    s.page.wait_for_timeout(300)
    after = [x["key"] for x in entries(s)]
    assert after[-1] == before[0] and after[:-1] == before[1:]
    # keyboard: the up arrow on a grip moves that stop earlier
    s.page.locator(".tp2-item .tp2-grip").nth(2).focus()
    s.page.keyboard.press("ArrowUp")
    s.page.wait_for_timeout(200)
    again = [x["key"] for x in entries(s)]
    assert again[1] == after[2] and again[2] == after[1]
    assert not s.take()


def test_planner_buffer_shifts_later_stops_and_a_missed_booking_is_flagged(open_page) -> None:
    s = open_planner(open_page)
    times = lambda: s.page.eval_on_selector_all(".tp2-item .tp2-t b", "bs => bs.map(b => b.textContent)")  # noqa: E731
    t0 = times()
    s.page.locator(".tp2-item").nth(0).locator("[data-step^='b:'] [data-d='5']").click()
    t1 = times()
    assert t1[0] == t0[0] and t1[1:] != t0[1:]
    # book the second stop for a minute after the day starts: it cannot be reached in time
    s.page.locator("#tourPlanner [data-f=start]").fill("10:00")
    key = s.page.locator(".tp2-item").nth(1).get_attribute("data-key")
    s.page.locator(f".tp2-item[data-key=\"{key}\"] [data-booked]").fill("10:05")
    s.page.wait_for_timeout(300)
    assert s.page.locator(".tp2-chip.bad").count() >= 1 and "Late by" in s.page.locator("#tourPlanner").inner_text()
    assert not s.take()


def test_planner_exports_ics_and_copies_the_plan(open_page, tmp_path: Path) -> None:
    s = open_planner(open_page)
    n = len(entries(s))
    with s.page.expect_download(timeout=30000) as dl:
        s.page.locator("#tourPlanner [data-act=ics]").click()
    path = tmp_path / dl.value.suggested_filename
    dl.value.save_as(str(path))
    assert path.name.startswith("tour-plan-") and path.suffix == ".ics"
    ics = path.read_bytes().decode()
    assert ics.startswith("BEGIN:VCALENDAR\r\n") and ics.count("BEGIN:VEVENT") == n and ics.count("LOCATION:") == n
    assert all(len(line.encode()) <= 75 for line in ics.split("\r\n"))
    assert "PRIVATE-NOTE" not in ics
    # the plan as text, through whichever clipboard route the browser allows
    s.page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=s.origin)
    s.page.locator("#tourPlanner [data-act=copy]").click()
    s.page.wait_for_function("() => /Plan copied|Could not copy/.test(document.getElementById('toast').textContent)", timeout=5000)
    try:
        text = s.page.evaluate("navigator.clipboard.readText()")
    except Exception:  # noqa: BLE001 - the clipboard may be unreadable in a headless context
        text = ""
    if text:
        assert text.startswith("Tour plan for") and "(estimate)" in text
    assert not s.take()


def test_planner_on_a_phone_fits_the_screen(open_page) -> None:
    s = open_planner(open_page, width=420)
    box = s.page.locator("#tourPlanner").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 421
    wide = s.page.evaluate("() => [...document.querySelectorAll('#tourPlanner *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.tp2-strip')).length")
    assert wide == 0
    assert not s.take()
