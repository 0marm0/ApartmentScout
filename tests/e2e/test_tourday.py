"""Tour day in a real browser at 375 px: the button that appears when there are tours today, the route in order with directions links
and hops, the checklist (a rating, a yes/no, a count, a note, a photo), answers flowing into the tour findings and the score, the
unknowns and office questions built from the listing, the 10-second noise check (the microphone stubbed, asked only on a tap), the
phone's back button, thumb-sized targets and axe, and the queue: answers made with the local API unreachable wait, then reach the search
folder. The committed example is the data; every answer here is a fixture typed by the test.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from test_tour_findings import served_search, HOMES, jpeg   # noqa: F401  (served_search is a fixture: a real `apartmentscout serve` over a scratch search)

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
LISTINGS = json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())
CANDIDATES = [x for x in LISTINGS if x.get("status") in ("shortlist", "touring", "researching") and (x.get("score") or {}).get("eligible")
              and x.get("lat") and (x.get("amenities") or {}).get("in_unit_wd") is True and (x.get("amenities") or {}).get("roof_deck") is None]
CANDIDATES.sort(key=lambda x: -(x["score"].get("overall") or 0))
FIRST, SECOND = CANDIDATES[0]["id"], CANDIDATES[1]["id"]   # FIRST is booked at 10:30, SECOND at 09:45: the route starts with SECOND
AXE = Path(__file__).parent / "vendor" / "axe.min.js"
SLOW = 30000

SEED = """(([first, second]) => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0'), day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (!localStorage.getItem('as:picks')) localStorage.setItem('as:picks', JSON.stringify({ [first]: { saved: true, tour: day + 'T10:30' }, [second]: { saved: true, tour: day + 'T09:45' } }));
})(%s);"""
MIC = """(() => {
  window.__mic = { calls: 0, denied: false, stopped: 0 };
  navigator.mediaDevices.getUserMedia = async () => {
    window.__mic.calls++;
    if (window.__mic.denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const ctx = new AudioContext(); await ctx.resume();
    const osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
    gain.gain.value = 0.02; osc.connect(gain).connect(dest); osc.start();
    dest.stream.getTracks().forEach((t) => { const stop = t.stop.bind(t); t.stop = () => { window.__mic.stopped++; stop(); }; });
    return dest.stream;
  };
})();"""


def phone(browser, origin: str, *, picks: bool = True, theme: str = "dark", query: str = "", mic: bool = False, ids=(FIRST, SECOND)):
    """A 375 x 812 touch phone context that may reach only `origin`. Returns (context, page, errors)."""
    ctx = browser.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme=theme, reduced_motion="reduce", service_workers="block")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((origin, "data:", "blob:")) else r.abort())
    if picks:
        ctx.add_init_script(SEED % json.dumps(list(ids)))
    if mic:
        ctx.add_init_script(MIC)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console: {m.text[:200]}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.goto(f"{origin}/{'?' + query if query else ''}#map" if theme == "dark" else f"{origin}/?{query + '&' if query else ''}theme=light#map")
    page.wait_for_function("() => document.querySelector('#cards .card')", timeout=SLOW)
    return ctx, page, errors


@pytest.fixture
def phone_page(browser, base_url):
    made = []

    def _make(**kw):
        ctx, page, errors = phone(browser, base_url, **kw)
        made.append(ctx)
        return page, errors
    yield _make
    for c in made:
        c.close()


def day(page) -> str:
    return page.evaluate("() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }")


def findings(page, id: str) -> dict:
    return page.evaluate("(id) => (JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]) || '{}'))[id] || {}", id)


def open_day(page) -> None:
    page.wait_for_selector("#tourDayBtn", timeout=SLOW)
    page.click("#tourDayBtn")
    page.wait_for_selector("#tourDay.on", timeout=SLOW)


def open_unit(page, id: str) -> None:
    page.locator(f"#tourDay [data-open='{id}']").first.click()
    page.wait_for_selector("#tourDay .tday-q", timeout=SLOW)


def ans(page, key: str, v) -> None:
    page.locator(f"#tourDay [data-ans='{key}'][data-v='{v}']").click()


def listing(page, id: str) -> dict:
    return page.evaluate("""async (id) => { const m = await import('/js/app.js'); const L = m.byId(id);
      return { gates: L.score.gates, tags: L.score.tags, wd: L.amenities.in_unit_wd, parts: L.score.parts, overall: L.score.overall }; }""", id)


# --------------------------------------------------------------------------- the way in and the route
def test_the_button_appears_only_when_there_are_tours_today(phone_page) -> None:
    page, errors = phone_page(picks=False)
    page.wait_for_timeout(800)
    assert page.locator("#tourDayBtn").count() == 0
    # booking a tour for today on the Tours board (the pick's Tour field) brings it in without a reload
    page.evaluate("""async ([id]) => { const m = await import('/js/app.js'); const d = new Date(), p = (n) => String(n).padStart(2, '0');
      m.setPick(id, { saved: true, tour: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T15:00` }); }""", [FIRST])
    page.wait_for_selector("#tourDayBtn", timeout=5000)
    assert "1 tour today, first at 3:00 pm" in page.get_attribute("#tourDayBtn", "aria-label")
    page.evaluate("""async ([id]) => { const m = await import('/js/app.js'); m.setPick(id, { tour: '2030-01-01T15:00' }); }""", [FIRST])
    page.wait_for_function("() => !document.querySelector('#tourDayBtn')", timeout=5000)
    assert errors == []


def test_the_route_is_in_time_order_with_directions_and_the_hop_to_the_next_stop(phone_page) -> None:
    page, errors = phone_page()
    open_day(page)
    stops = page.locator("#tourDay .tday-stop")
    assert stops.count() == 2
    assert [stops.nth(i).get_attribute("data-id") for i in range(2)] == [SECOND, FIRST], "09:45 before 10:30"
    first = stops.nth(0).inner_text()
    assert "9:45 am" in first and "10:30 am" in stops.nth(1).inner_text()
    home = next(x for x in CANDIDATES if x["id"] == SECOND)
    assert (home["address"].split(",")[0]) in first
    href = stops.nth(0).locator("a[data-directions]").get_attribute("href")
    assert href.startswith("https://www.google.com/maps/dir/?api=1&destination=") and "travelmode=walking" in href and "key=" not in href
    assert stops.nth(0).locator("a[data-directions]").get_attribute("target") == "_blank"
    hop = page.locator("#tourDay .tday-hop")
    assert hop.count() == 1 and "(estimate)" in hop.inner_text() and ("on foot" in hop.inner_text() or "by transit" in hop.inner_text())
    assert "leave by" in stops.nth(1).inner_text()
    # reorder by hand, then by the shortest walk
    page.locator(f"[data-down='{SECOND}']").click()
    assert [page.locator("#tourDay .tday-stop").nth(i).get_attribute("data-id") for i in range(2)] == [FIRST, SECOND]
    page.locator("[data-mode='time']").click()
    assert page.locator("#tourDay .tday-stop").first.get_attribute("data-id") == SECOND
    assert errors == []


def test_the_palette_and_the_shortcut_url_open_it_and_the_back_button_steps_back(phone_page) -> None:
    page, errors = phone_page(query="tourday=1")
    page.wait_for_selector("#tourDay.on", timeout=SLOW)
    open_unit(page, SECOND)
    assert page.evaluate("() => history.state?.tday") == "unit"
    page.go_back()
    page.wait_for_selector("#tourDay .tday-route", timeout=5000)
    assert page.locator("#tourDay").count() == 1, "back from the checklist returns to the route"
    page.go_back()
    page.wait_for_selector("#tourDay", state="detached", timeout=5000)
    assert page.evaluate("() => location.pathname") == "/", "back from the route closes the mode and stays in the app"
    # the command palette lists it even with no tour today
    page.evaluate("async () => { const m = await import('/js/app.js'); for (const id of Object.keys(m.S.picks)) m.setPick(id, { tour: null, saved: true }); }")
    page.wait_for_function("() => !document.querySelector('#tourDayBtn')", timeout=5000)
    page.keyboard.press("Control+k")
    page.wait_for_selector("#plQ", timeout=5000)
    page.keyboard.type("tour day")
    page.locator(".pl-it", has_text="Today's tours in order").first.click()
    page.wait_for_selector("#tourDay.on", timeout=5000)
    assert "No tours booked for today" in page.locator("#tourDay").inner_text()
    assert errors == []


# --------------------------------------------------------------------------- the checklist and the findings
def test_answers_flow_into_the_tour_findings_the_score_and_the_visit_sheet(phone_page) -> None:
    page, errors = phone_page()
    before = listing(page, FIRST)
    open_day(page)
    open_unit(page, FIRST)
    ans(page, "light", 4); ans(page, "facing", "SW"); ans(page, "water", 3); ans(page, "signal", 2)
    page.locator("#tourDay [data-count='closets'][data-d='1']").click()
    page.locator("#tourDay [data-count='closets'][data-d='1']").click()
    ans(page, "wd", "false")   # the listing says there is one in the unit
    assert page.locator("#tourDay [data-ans='wd'][data-v='false']").get_attribute("aria-pressed") == "true"
    page.locator("#tourDay textarea[data-note]").fill("Super was friendly.")
    page.locator("#tourDay input[data-photo]").first.set_input_files({"name": "w.jpg", "mimeType": "image/jpeg", "buffer": jpeg()})
    page.wait_for_function("() => document.querySelectorAll('#tourDay .tday-photos img').length === 1 && document.querySelector('#tourDay .tday-photos img').naturalWidth > 0", timeout=15000)
    page.wait_for_function("(id) => ((JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]) || '{}'))[id] || {}).note", arg=FIRST, timeout=10000)
    f = findings(page, FIRST)
    assert f["light"]["rating"] == 4 and f["light"]["facing"] == "SW" and f["water"] == 3 and f["signal"] == 2 and f["closets"] == 2
    assert f["checks"]["wd"] == {"verdict": "differs", "observed": False} and f["note"] == "Super was friendly." and len(f["photos"]) == 1
    # progress moves, and the listing's own fact is untouched while the score is flagged, not changed
    assert "6 of" in page.locator("#tdProg").inner_text()
    after = listing(page, FIRST)
    assert "contradicted:in_unit_wd" in after["gates"] and "differs on tour" in after["tags"]
    assert after["wd"] is True and after["parts"] == before["parts"] and after["overall"] == before["overall"]
    # tapping the same answer again clears it
    ans(page, "water", 3)
    assert page.locator("#tourDay [data-ans='water'][data-v='3']").get_attribute("aria-pressed") == "false"
    assert "water" not in findings(page, FIRST)
    # the summary card after the tour, then the visit sheet shows the same findings
    page.locator("[data-finish]").click()
    card = page.locator("#tourDay .tday-sum")
    card.wait_for(timeout=5000)
    text = card.inner_text().lower()   # the labels are drawn in capitals
    assert "light" in text and "4 of 5, faces sw" in text and "not in the unit" in text and "differs from the listing" in text and "closets" in text
    assert page.locator("#tourDay .tday-next").count() == 1
    page.locator("[data-visit]").first.click()
    page.wait_for_selector("#visitSheet.on", timeout=5000)
    sheet = page.locator("#visitSheet")
    assert sheet.locator("[data-set='light.rating'][data-v='4']").get_attribute("aria-pressed") == "true"
    assert sheet.locator("[data-set='signal'][data-v='2']").get_attribute("aria-pressed") == "true"
    assert sheet.locator("[data-verdict='wd'][data-v='differs']").get_attribute("aria-pressed") == "true"
    assert sheet.locator("[data-f='note']").input_value() == "Super was friendly."
    assert errors == []


def test_unknowns_and_office_questions_come_from_the_listing_and_ride_in_the_note(phone_page) -> None:
    page, errors = phone_page()
    open_day(page)
    open_unit(page, FIRST)
    body = page.locator("#tourDay .tday-body").inner_text()
    assert "The listing does not say" in body and "Roof deck?" in body, "roof deck is unknown on this listing and wanted in the criteria"
    assert "You weight light and view" in body
    ans(page, "am_roof_deck", "true")
    assert page.locator("#tourDay [data-ans='am_roof_deck'][data-v='true']").get_attribute("aria-pressed") == "true"
    asks = page.locator("#tourDay .tday-ask")
    if asks.count():   # a gate the score is unsure about becomes a question for the office
        asks.first.click()
        assert asks.first.get_attribute("aria-pressed") == "true"
    page.wait_for_function("(id) => (((JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]) || '{}'))[id] || {}).note || '').includes('Roof deck: yes.')", arg=FIRST, timeout=10000)
    note = findings(page, FIRST)["note"]
    assert note.startswith("— Tour day answers —") and "Roof deck: yes." in note
    # what the renter types stays theirs and goes before the block; the block is rebuilt around it
    page.locator("#tourDay textarea[data-note]").fill("Hallway smells of paint.")
    page.wait_for_function("(id) => (((JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]) || '{}'))[id] || {}).note || '').startsWith('Hallway')", arg=FIRST, timeout=10000)
    ans(page, "am_roof_deck", "false")
    page.wait_for_function("(id) => (((JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]) || '{}'))[id] || {}).note || '').includes('Roof deck: no.')", arg=FIRST, timeout=10000)
    note = findings(page, FIRST)["note"]
    assert note.startswith("Hallway smells of paint.\n\n— Tour day answers —") and note.count("Roof deck") == 1
    assert page.locator("#tourDay textarea[data-note]").input_value() == "Hallway smells of paint."
    assert errors == []


# --------------------------------------------------------------------------- the noise check
def test_the_noise_check_asks_only_on_a_tap_reads_ten_seconds_and_keeps_one_approximate_number(phone_page) -> None:
    page, errors = phone_page(mic=True)
    requests = []
    page.on("request", lambda r: requests.append(r.url) if not r.url.startswith(("data:", "blob:")) else None)
    open_day(page)
    open_unit(page, FIRST)
    assert page.evaluate("() => window.__mic.calls") == 0, "nothing is asked until the renter taps"
    # a blocked microphone is a calm message, not a broken page
    page.evaluate("() => { window.__mic.denied = true; }")
    page.locator("[data-meter-go='shut']").click()
    page.wait_for_function("() => window.__mic.calls === 1", timeout=5000)
    page.wait_for_selector("#toast.show, #toast", timeout=5000)
    page.wait_for_function("() => /blocked/i.test(document.getElementById('toast').textContent)", timeout=5000)
    page.wait_for_selector("[data-meter-go='shut']:not([disabled])", timeout=5000)
    page.evaluate("() => { window.__mic.denied = false; }")
    before = len(requests)
    page.locator("[data-meter-go='open']").click()
    page.wait_for_selector("[data-meter='open'] .tday-meter-on", timeout=5000)
    assert page.locator("[data-meter='open'] [data-meter-db]").inner_text() != ""
    page.wait_for_selector("[data-meter='open'] .tday-reading", timeout=25000)
    reading = page.locator("[data-meter='open'] .tday-reading").inner_text()
    assert "Approximate" in reading and "About" in reading
    db = int(page.evaluate("(id) => JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]))[id].noise.db", FIRST))
    assert 50 <= db <= 75, db   # a 0.02 sine is about -37 dBFS, near 63 dB with the offset
    f = findings(page, FIRST)
    assert f["noise"]["db"] == db and f["noise"]["rating"] in (3, 4), "the level suggests a rating when none was given"
    assert page.evaluate("() => window.__mic.stopped") >= 1, "the microphone is released"
    assert "phone microphone, approximate" in f["note"]
    assert [u for u in requests[before:] if not u.startswith(page.url.split("#")[0])] == [], "nothing is uploaded"
    assert "not calibrated" in page.locator("#tourDay .tday-body").inner_text()
    assert errors == []


# --------------------------------------------------------------------------- the phone
@pytest.mark.parametrize("theme", ["dark", "light"])
def test_it_fits_a_375_px_phone_every_target_is_thumb_sized_and_axe_is_clean(phone_page, theme: str) -> None:
    page, errors = phone_page(theme=theme)
    open_day(page)
    page.add_script_tag(path=str(AXE))
    for screen in ("route", "unit", "summary", "all"):
        if screen == "unit":
            open_unit(page, SECOND)
            ans(page, "light", 2)
        elif screen == "summary":
            page.locator("[data-finish]").click()
            page.wait_for_selector("#tourDay .tday-sum", timeout=5000)
        elif screen == "all":
            page.locator("[data-all]").first.click()
            page.wait_for_selector("#tourDay .tday-sum", timeout=5000)
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), screen
        assert page.evaluate("() => { const b = document.querySelector('#tourDay .tday-body'); return b.scrollWidth <= b.clientWidth + 1; }"), screen
        small = page.evaluate("""() => [...document.querySelectorAll('#tourDay button, #tourDay a[href], #tourDay textarea, #tourDay label.tday-btn')]
            .filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.dataset.ans || e.className || e.tagName) + ':' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) }; })
            .filter((r) => r.h < 44 || r.w < 44)""")
        assert small == [], (screen, small)
        bad = page.evaluate("""async () => { const r = await axe.run(document.getElementById('tourDay'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
          return r.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })); }""")
        assert bad == [], (screen, bad)
    # the bar with the main actions sits where a thumb rests, inside the viewport
    bar = page.locator("#tourDay .tday-bar-f").bounding_box()
    assert bar["y"] + bar["height"] <= 812 + 1 and bar["y"] > 640
    assert page.evaluate("() => document.querySelector('#work').inert")
    for _ in range(6):   # Escape steps back through the screens (all, summary, checklist, route) and then closes
        if not page.locator("#tourDay").count():
            break
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
    page.wait_for_selector("#tourDay", state="detached", timeout=5000)
    assert not page.evaluate("() => document.querySelector('#work').inert")
    assert errors == []


# --------------------------------------------------------------------------- the queue
def test_answers_made_while_the_api_is_unreachable_wait_then_reach_the_search_folder(browser, served_search) -> None:
    root, base = served_search
    ids = (HOMES[0]["id"], HOMES[1]["id"])
    ctx, page, errors = phone(browser, base, ids=ids)
    try:
        open_day(page)
        page.wait_for_function("() => document.querySelector('#tourDay .tday-status')?.textContent.includes('search folder')", timeout=10000)
        open_unit(page, ids[0])
        ans(page, "water", 4)
        page.wait_for_function("() => document.querySelector('.tday-status')?.textContent.includes('search folder')", timeout=10000)
        page.wait_for_timeout(900)
        assert json.loads((root / "tours" / ids[0] / "findings.json").read_text())["water"] == 4
        # the connection drops: the answer is kept on the phone and counted as waiting
        ctx.set_offline(True)
        ans(page, "signal", 3)
        page.wait_for_function("() => /1 home waiting to sync/.test(document.querySelector('.tday-status')?.textContent || '')", timeout=10000)
        assert findings(page, ids[0])["signal"] == 3
        assert "signal" not in json.loads((root / "tours" / ids[0] / "findings.json").read_text())
        pending = page.evaluate("() => JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0] + ':unsent') || '[]')")
        assert pending == [ids[0]]
        # back online: it is sent, the folder has it, and the status says so
        ctx.set_offline(False)
        page.evaluate("() => dispatchEvent(new Event('online'))")
        page.wait_for_function("() => document.querySelector('.tday-status')?.textContent.includes('Saved to your search folder')", timeout=25000)
        assert json.loads((root / "tours" / ids[0] / "findings.json").read_text())["signal"] == 3
        assert page.evaluate("() => JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0] + ':unsent') || '[]')") == []
        assert [e for e in errors if "Failed to fetch" not in e and "ERR_INTERNET_DISCONNECTED" not in e] == []
    finally:
        ctx.close()
