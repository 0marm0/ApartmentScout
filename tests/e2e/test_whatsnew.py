"""The "What's new" panel in a real browser: the dot on the menu button, the menu row and the panel (a popover on a desktop, a bottom
sheet on a phone), what it lists from alerts.json, the app badge (Badging API) and the opt-in local notification (Notification API).

alerts.json is the digest `apartmentscout build` writes from `apartmentscout alerts` (apartmentscout/alerts.py). The tests serve a
hand-made digest in its place, built from real ids of the example so a row opens its drawer. The Badging and Notification APIs are
replaced by recorders (headless Chromium cannot show either), so what is checked is when the page calls them and with what.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import block_foreign, build_url, settled, until

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "dashboard" / "data"
LISTINGS = json.loads((DATA / "listings.json").read_text())
FIT = [x for x in LISTINGS if (x.get("score") or {}).get("ranks", {}).get("action")][:6]
SLOW = 30000

RECORDERS = """
window.__badge = [];
navigator.setAppBadge = (n) => { window.__badge.push(n); return Promise.resolve(); };
navigator.clearAppBadge = () => { window.__badge.push(0); return Promise.resolve(); };
"""
FAKE_NOTIFICATION = """
window.__notes = [];
class FakeNotification { constructor(title, opts) { window.__notes.push([title, opts && opts.body]); } }
FakeNotification.permission = localStorage.getItem('fake-permission') || 'default';
FakeNotification.requestPermission = async () => { localStorage.setItem('fake-permission', 'granted'); FakeNotification.permission = 'granted'; return 'granted'; };
window.Notification = FakeNotification;
"""


def name(x: dict) -> str:
    return f"{x.get('building') or x.get('address')} {x.get('unit') or ''}".strip()


def digest(id: str = "d1", **groups) -> dict:
    groups = groups or {
        "new": [{"id": FIT[0]["id"], "name": name(FIT[0]), "hood": FIT[0].get("neighborhood"), "gross": 4800, "rank": 4}],
        "drops": [{"id": FIT[1]["id"], "name": name(FIT[1]), "from": 5100, "to": 4995, "delta": -105, "basis": "rent"}],
        "gone": [{"id": FIT[2]["id"], "name": name(FIT[2]), "was_rank": 3}],
    }
    counts = {k: len(v) for k, v in groups.items()}
    total = sum(counts.values())
    return {"schema_version": 1, "kind": "alerts", "generated": "2026-10-15", "at": "2026-10-15T07:00:00", "search": "x", "since": "2026-10-14", "since_at": None,
            "first_run": False, "pending": False, "top": 10, "id": id, "headline": "1 new, 1 price drop, 1 gone" if total == 3 else "", "title": "t",
            "total": total, "counts": counts, "groups": groups, "tracked": 400, "fitting": 120, "quiet_new": 0, "note": None if total else "Nothing changed for the homes that fit your criteria or are on your shortlist."}


@pytest.fixture
def shell(browser, base_url):
    """shell(doc, width=1440, scripts=()) -> (page, current) ; `current` is a one-item list holding the digest the next load is served."""
    contexts = []

    def _open(doc: dict | None, width: int = 1440, height: int = 900, scripts: tuple[str, ...] = (), status: int = 200):
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme="dark", reduced_motion="reduce", service_workers="block",
                                  has_touch=width < 700)
        contexts.append(ctx)
        block_foreign(ctx, base_url)
        current = [doc]
        ctx.route("**/data/alerts.json", lambda r: r.fulfill(status=status, content_type="application/json", body=json.dumps(current[0])) if status == 200 else r.fulfill(status=404, body=""))
        for s in scripts:
            ctx.add_init_script(s)
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(build_url(base_url, "#map"))
        page.wait_for_function("() => document.querySelector('#cards .card')", timeout=SLOW)
        until(page, "async () => { const m = await import('/js/features/whatsnew.js'); return m.state().loaded; }", timeout_ms=SLOW)
        return page, current, errors

    yield _open
    for c in contexts:
        c.close()


def reload(page) -> None:
    page.reload()
    page.wait_for_function("() => document.querySelector('#cards .card')", timeout=SLOW)
    settled(page)


def open_panel(page) -> None:
    page.click("#menuBtn")
    page.click("#mnNews")
    page.wait_for_selector("#wnPop:not([hidden])")


def test_the_committed_example_ships_an_alerts_file_the_build_lists() -> None:
    assert "alerts.json" in json.loads((DATA / "manifest.json").read_text())["extra"]
    d = json.loads((DATA / "alerts.json").read_text())
    assert d["kind"] == "alerts" and d["schema_version"] == 1 and d["first_run"] is True and d["tracked"] > 100


def test_a_dot_and_a_count_say_something_is_new_and_the_panel_lists_it(shell) -> None:
    page, _, errors = shell(digest())
    page.wait_for_selector("#newsDot:not([hidden])")
    assert "3 new changes" in page.get_attribute("#menuBtn", "aria-label")
    page.click("#menuBtn")
    assert page.inner_text("#mnNewsN") == "3" and "unseen" in page.get_attribute("#mnNewsN", "class")
    page.click("#mnNews")
    panel = page.locator("#wnPop")
    panel.wait_for(state="visible")
    text = panel.inner_text()
    assert "What's new" in text and "Since Oct 14: 1 new, 1 price drop, 1 gone." in text
    assert "NEW HOMES THAT FIT" in text.upper() and "$4,800" in text and "ranked #4" in text
    assert "−$105" in text and "$5,100 → $4,995" in text and "was ranked #3" in text
    assert page.get_attribute("#wnPop", "role") == "dialog"
    assert not errors


def test_opening_the_panel_marks_it_seen_and_a_new_digest_brings_the_dot_back(shell) -> None:
    page, current, _ = shell(digest("d1"))
    page.wait_for_selector("#newsDot:not([hidden])")
    open_panel(page)
    page.wait_for_selector("#newsDot", state="hidden")
    page.keyboard.press("Escape")
    page.wait_for_selector("#wnPop", state="hidden")
    reload(page)
    until(page, "async () => (await import('/js/features/whatsnew.js')).state().digest?.id === 'd1'")
    assert page.is_hidden("#newsDot")                                   # the same digest stays seen
    current[0] = digest("d2")
    reload(page)
    page.wait_for_selector("#newsDot:not([hidden])")


def test_a_row_opens_that_home(shell) -> None:
    page, _, _ = shell(digest())
    open_panel(page)
    page.click(f'#wnPop a[data-home="{FIT[1]["id"]}"]')
    page.wait_for_selector("#wnPop", state="hidden")
    until(page, "async (id) => (await import('/js/app.js')).S.sel === id", FIT[1]["id"], timeout_ms=SLOW)


def test_escape_and_a_click_outside_close_it_and_focus_returns(shell) -> None:
    page, _, _ = shell(digest())
    open_panel(page)
    assert page.evaluate("() => document.activeElement.id") == "wnTitle"
    page.keyboard.press("Escape")
    page.wait_for_selector("#wnPop", state="hidden")
    assert page.evaluate("() => document.activeElement.id") == "menuBtn"
    open_panel(page)
    page.mouse.click(300, 600)
    page.wait_for_selector("#wnPop", state="hidden")


def test_a_quiet_digest_says_so_and_shows_no_dot(shell) -> None:
    page, _, _ = shell(digest("q", **{}) | {"groups": {}, "total": 0, "counts": {}})
    assert page.is_hidden("#newsDot")
    page.click("#menuBtn")
    assert page.is_hidden("#mnNewsN")
    page.click("#mnNews")
    page.wait_for_selector("#wnPop:not([hidden])")
    assert "Nothing changed for the homes that fit" in page.inner_text("#wnPop")


def test_without_an_alerts_file_the_panel_explains_how_to_make_one(shell) -> None:
    page, _, errors = shell(None, status=404)
    assert page.is_hidden("#newsDot")
    open_panel(page)
    assert "apartmentscout alerts" in page.inner_text("#wnPop")
    assert not [e for e in errors if "alerts" in e]


def test_the_app_badge_shows_the_count_and_clears_when_the_panel_is_opened(shell) -> None:
    page, _, _ = shell(digest(), scripts=(RECORDERS,))
    until(page, "() => window.__badge.length > 0")
    assert page.evaluate("() => window.__badge") == [3]
    open_panel(page)
    until(page, "() => window.__badge.includes(0)")
    assert page.evaluate("() => window.__badge") == [3, 0]


def test_a_browser_without_the_badging_api_is_fine(shell) -> None:
    page, _, errors = shell(digest(), scripts=("delete Navigator.prototype.setAppBadge; delete Navigator.prototype.clearAppBadge;",))
    page.wait_for_selector("#newsDot:not([hidden])")
    open_panel(page)
    assert not errors


def test_notifications_are_asked_for_only_on_a_button_press_and_shown_once_per_digest(shell) -> None:
    page, current, _ = shell(digest("d1"), scripts=(FAKE_NOTIFICATION,))
    assert page.evaluate("() => window.__notes") == []                  # nothing was asked or shown on load
    assert page.evaluate("() => Notification.permission") == "default"
    open_panel(page)
    assert "Turn on" in page.inner_text("#wnPop .wn-dev")
    page.click('[data-wn="notify-on"]')
    page.wait_for_selector('.wn-dev[data-state="on"]')
    assert page.evaluate("() => Notification.permission") == "granted"
    assert page.evaluate("() => window.__notes") == []                  # turning it on does not repeat what is on screen
    reload(page)
    assert page.evaluate("() => window.__notes") == []                  # the same digest was seen
    current[0] = digest("d2")
    reload(page)
    until(page, "() => window.__notes.length === 1")
    assert page.evaluate("() => window.__notes") == [["ApartmentScout", "1 new, 1 price drop, 1 gone"]]
    reload(page)
    settled(page)
    assert page.evaluate("() => window.__notes") == []                  # d2 was already notified: once per digest


def test_turning_notifications_off_stops_them(shell) -> None:
    page, current, _ = shell(digest("d1"), scripts=(FAKE_NOTIFICATION,))
    open_panel(page)
    page.click('[data-wn="notify-on"]')
    page.click('[data-wn="notify-off"]')
    page.wait_for_selector('.wn-dev[data-state="off"]')
    current[0] = digest("d2")
    reload(page)
    settled(page)
    assert page.evaluate("() => window.__notes") == []


def test_on_a_phone_it_is_a_bottom_sheet_that_fits_the_screen(shell) -> None:
    page, _, _ = shell(digest(), width=390, height=844)
    page.wait_for_selector("#newsDot:not([hidden])")
    open_panel(page)
    box = page.locator("#wnPop").bounding_box()
    assert box["x"] == 0 and box["width"] == 390 and abs(box["y"] + box["height"] - 844) < 2 and box["height"] <= 844 * 0.83
    assert page.is_visible("#wnScrim")
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 390
    page.click("#wnScrim", position={"x": 195, "y": 20})
    page.wait_for_selector("#wnPop", state="hidden")
