"""Tour findings and decision history in a real browser: the visit sheet (phone first), flags and promoted facts reaching the
scores, the decision trail with its reason prompt, the picks backup, the shared memo, and the local API saving into a search
folder. The committed example is the data; every finding here is a fixture, typed by the test.
"""
from __future__ import annotations

import io
import json
import re
import threading
from pathlib import Path

import pytest
from conftest import block_foreign
from conftest import poll

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
LISTINGS = json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())
SEARCH = json.loads((ROOT / "dashboard" / "data" / "criteria.json").read_text())["search"]["name"]
HOMES = [x for x in LISTINGS if x.get("status") in ("new", "researching", "shortlist", "touring") and (x.get("score") or {}).get("eligible")
         and (x.get("amenities") or {}).get("in_unit_wd") is True and x.get("sqft") and x.get("beds") is not None]
HOMES.sort(key=lambda x: -(x["score"].get("overall") or 0))
HOME, OTHER = HOMES[0]["id"], HOMES[1]["id"]
SLOW = 30000
AXE = Path(__file__).parent / "vendor" / "axe.min.js"


def jpeg(size=(900, 600)) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.effect_noise(size, 60).convert("RGB").save(buf, "JPEG", quality=80)
    return buf.getvalue()


def open_home(s, home: str = HOME) -> None:
    s.page.evaluate("(id) => { location.href = location.pathname + '?open=' + id + '#map'; }", home)
    s.page.reload()
    s.page.wait_for_selector("#dVisit", timeout=SLOW)


def sheet(s):
    return s.page.locator("#visitSheet")


def listing(s, id: str = HOME) -> dict:
    return s.page.evaluate("""async (id) => { const m = await import('/js/app.js'); const L = m.byId(id);
      return { gates: L.score.gates, tags: L.score.tags, wd: L.amenities.in_unit_wd, sqft: L.sqft, parts: L.score.parts, eligible: L.score.eligible, overall: L.score.overall }; }""", id)


def fill_a_visit(s) -> None:
    sh = sheet(s)
    sh.locator("[data-add-room='Living room']").click()
    sh.locator("[data-room-f='w']").first.fill("13'6\"")
    sh.locator("[data-room-f='l']").first.fill("16")
    sh.locator("[data-step='ceiling'][data-d='0.25']").click()
    sh.locator("[data-set='water'][data-v='2']").click()
    sh.locator("[data-set='noise.rating'][data-v='4']").click()
    sh.locator("[data-set='light.facing'][data-v='N']").click()
    sh.locator("[data-verdict='wd'][data-v='differs']").click()
    sh.locator("[data-obs='wd'][data-v='false']").click()
    sh.locator("[data-verdict='size'][data-v='differs']").click()
    sh.locator("[data-check-size]").fill("600")
    s.page.wait_for_function("() => document.querySelector('[data-check=size] [data-promote]')", timeout=5000)


# --------------------------------------------------------------------------- findings reach the scores
def test_a_contradiction_is_flagged_and_changes_no_score_until_it_is_promoted(open_page) -> None:
    s = open_page(f"?open={HOME}#map")
    s.page.wait_for_selector("#dVisit", timeout=SLOW)
    before = listing(s)
    s.page.locator("[data-vf-open]").first.click()
    s.page.wait_for_selector("#visitSheet.on")
    fill_a_visit(s)
    flagged = listing(s)
    assert "contradicted:in_unit_wd" in flagged["gates"] and "contradicted:sqft" in flagged["gates"] and "differs on tour" in flagged["tags"]
    assert flagged["parts"] == before["parts"] and flagged["eligible"] == before["eligible"] and flagged["overall"] == before["overall"]
    assert flagged["wd"] is True, "the listing's own fact is untouched"
    s.page.locator(".vs-done").click()
    s.page.wait_for_selector("#visitSheet", state="detached")
    # the card says so, and the drawer shows both sides with the observation dated
    warn = s.page.locator(f".card[data-id='{HOME}'] .c-warn")   # the card's one warning mark carries it (label and tooltip)
    assert "differs on tour" in (warn.get_attribute("aria-label") or "").lower()
    d = s.page.locator("#dVisit")
    assert re.search(r"observed on \w+ \d+, \d{4}", d.inner_text()), d.inner_text()
    assert "Found no in-unit washer/dryer, the listing says in-unit washer/dryer" in d.inner_text()
    # promote with one click
    d.locator("[data-vf-promote='wd']").click()
    done = listing(s)
    assert done["wd"] is False and "fails:in_unit_wd" in done["gates"] and done["eligible"] is False and done["parts"]["amenities"] < before["parts"]["amenities"]
    assert "contradicted:in_unit_wd" not in done["gates"] and "contradicted:sqft" in done["gates"], "the one not promoted is still only flagged"
    # the reasons carry the line, dated
    # (the reasons are redrawn once the scoring worker has the new facts: open the Amenities section again on each look)
    s.page.wait_for_function("""() => { const w = document.getElementById('dWhy'); if (!w) return false;
      for (const d of w.querySelectorAll('details')) if (/Amenities/.test(d.textContent)) d.open = true;
      return w.innerText.includes('promoted to a fact'); }""", timeout=60000)
    # (the wait above is the check: the reasons redraw again after it, and a later read can land between two draws)
    # undo: the listing, its score and the gate are as they were, and both steps are in the trail
    s.page.locator("#toast .toast-act").click()
    back = listing(s)
    assert back["wd"] is True and back["parts"] == flagged["parts"] and "contradicted:in_unit_wd" in back["gates"]
    kinds = [e["kind"] for e in s.page.evaluate("() => window.__trail.entries")]
    assert kinds.count("promote") == 1 and kinds.count("unpromote") == 1
    assert s.take() == []


def test_findings_and_a_photo_survive_a_reload(open_page) -> None:
    s = open_page(f"?visit={HOME}#map")
    s.page.wait_for_selector("#visitSheet.on", timeout=SLOW)
    sh = sheet(s)
    sh.locator("[data-set='water'][data-v='3']").click()
    sh.locator("[data-f='view']").fill("Brick wall across a light well")
    sh.locator("input[data-photo]").first.set_input_files({"name": "w.jpg", "mimeType": "image/jpeg", "buffer": jpeg()})
    s.page.wait_for_function("() => document.querySelectorAll('#visitSheet .vs-ph img').length === 1 && document.querySelector('#visitSheet .vs-ph img').naturalWidth > 0", timeout=15000)
    s.page.wait_for_function("(h) => ((JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]) || '{}'))[h] || {}).view", arg=HOME, timeout=15000)   # typed text saves after a short pause
    stored = s.page.evaluate("() => JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]))")
    rec = stored[HOME]
    assert rec["water"] == 3 and rec["photos"][0]["store"] == "idb" and rec["view"].startswith("Brick")
    s.page.wait_for_timeout(400)
    s.page.reload()
    s.page.wait_for_selector("#visitSheet.on", timeout=SLOW)
    assert s.page.locator("#visitSheet [data-set='water'][data-v='3']").get_attribute("aria-pressed") == "true"
    s.page.wait_for_function("() => document.querySelector('#visitSheet .vs-ph img')?.naturalWidth > 0", timeout=15000)
    assert s.take() == []


# --------------------------------------------------------------------------- the phone
def test_the_sheet_fits_a_phone_and_every_target_is_thumb_sized(open_page) -> None:
    s = open_page(f"?visit={HOME}#map", width=390, height=844)
    s.page.wait_for_selector("#visitSheet.on", timeout=SLOW)
    sh = sheet(s)
    box = sh.locator(".vs-panel").bounding_box()
    assert box["width"] == 390 and box["height"] == 844
    assert s.page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    assert s.page.evaluate("() => { const b = document.querySelector('#visitSheet .vs-body'); return b.scrollWidth <= b.clientWidth + 1; }")
    small = s.page.evaluate("""() => [...document.querySelectorAll('#visitSheet button, #visitSheet input:not([type=file]):not([type=date]), #visitSheet textarea, #visitSheet label.vs-cam')]
        .filter((e) => e.offsetParent && !e.closest('.vs-jump')).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.dataset.set || e.dataset.step || e.className || e.tagName) + ':' + (e.textContent || e.getAttribute('aria-label') || '').slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter((r) => r.h < 44 || r.w < 44)""")
    assert small == [], small
    # the camera and Done sit in a bar inside the viewport (under the thumb), and the page behind cannot be reached
    bar = sh.locator(".vs-bar").bounding_box()
    assert bar["y"] + bar["height"] <= 844 + 1 and bar["y"] > 700
    assert s.page.evaluate("() => document.querySelector('#work').inert")
    # keyboard: focus stays inside; Escape closes and returns it to what opened the sheet
    for _ in range(60):
        s.page.keyboard.press("Tab")
        assert s.page.evaluate("() => !!document.activeElement.closest('#visitSheet')")
    s.page.keyboard.press("Escape")
    s.page.wait_for_selector("#visitSheet", state="detached")
    assert not s.page.evaluate("() => document.querySelector('#work').inert")
    assert s.take() == []


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_the_sheet_and_the_drawer_section_pass_axe(open_page, theme: str) -> None:
    s = open_page(f"?visit={HOME}#map", theme=theme, width=390, height=844)
    s.page.wait_for_selector("#visitSheet.on", timeout=SLOW)
    sh = sheet(s)
    fill_a_visit(s)
    sh.locator("[data-promote='wd']").click()
    s.page.add_script_tag(path=str(AXE))
    bad = s.page.evaluate("""async () => { const r = await axe.run(document.querySelector('#visitSheet'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return r.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })); }""")
    assert bad == [], bad
    s.page.locator(".vs-done").click()
    s.page.wait_for_selector("#visitSheet", state="detached")
    bad = s.page.evaluate("""async () => { const r = await axe.run(document.getElementById('drawer'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return r.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })); }""")
    assert bad == [], bad


# --------------------------------------------------------------------------- the trail and the backup
def test_decisions_get_a_reason_and_travel_with_the_picks_backup(open_page, tmp_path: Path) -> None:
    s = open_page(f"?open={HOME}#map")
    s.page.wait_for_selector("#dVisit", timeout=SLOW)
    s.page.click("#dTier [data-tier='A']")
    s.page.wait_for_selector(".trail-ask.on")
    s.page.fill(".trail-ask input", "Best light of the three")
    s.page.press(".trail-ask input", "Enter")
    s.page.wait_for_selector(".trail-ask", state="detached")
    s.page.locator("#dStatus").select_option("touring")
    s.page.click("#dTier [data-tier='S']")
    s.page.wait_for_selector(".trail-ask.on")
    s.page.click(".trail-ask [data-skip]")
    trail = s.page.locator("#vfTrail")
    text = trail.inner_text()
    for line in ("Tier A to S", "Status: none to Touring", "Tier set to A", "Starred", "Best light of the three"):
        assert line in text, (line, text)
    trail.locator("[data-why]").first.click()
    s.page.fill("#vfTrail .tr-why input", "Moved up after the second look")
    s.page.keyboard.press("Enter")
    assert "Moved up after the second look" in s.page.locator("#vfTrail").inner_text()
    # a visit, then the backup
    s.page.locator("[data-vf-open]").first.click()
    s.page.wait_for_selector("#visitSheet.on")
    sheet(s).locator("[data-set='water'][data-v='4']").click()
    sheet(s).locator(".vs-done").click()
    with s.page.expect_download() as dl:
        s.page.evaluate("async () => { (await import('/js/app.js')).exportPicks(); }")
    path = tmp_path / "picks.json"
    dl.value.save_as(path)
    doc = json.loads(path.read_text())
    assert doc["findings"][HOME]["water"] == 4 and "photos" not in doc["findings"][HOME]
    assert [e["kind"] for e in doc["history"]] == ["star", "tier", "status", "tier"]
    assert any(e.get("why") == "Best light of the three" for e in doc["history"])
    # a fresh browser: restoring the backup brings the visit and the trail back, and importing twice adds nothing
    s.page.evaluate("() => { localStorage.clear(); }")
    s.page.reload()
    s.page.wait_for_selector("#cards .card", state="attached", timeout=SLOW)
    s.page.wait_for_function("() => window.__trail", timeout=SLOW)
    for _ in range(2):
        s.page.evaluate("""async (doc) => { const m = await import('/js/app.js'); await m.importPicks(new File([JSON.stringify(doc)], 'p.json', { type: 'application/json' })); }""", doc)
    got = s.page.evaluate("() => ({ n: window.__trail.entries.length, f: JSON.parse(localStorage.getItem('as:findings:' + document.title.split(' · ')[0]) || '{}') })")
    assert got["n"] == len(doc["history"]) and got["f"][HOME]["water"] == 4
    s.page.evaluate("async (id) => { (await import('/js/app.js')).openDrawer(id); }", HOME)
    assert "Best light of the three" in s.page.locator("#vfTrail").inner_text()
    assert s.take() == []


# --------------------------------------------------------------------------- the memo
def test_the_memo_carries_the_visit_and_the_trail_and_photos_only_when_asked(open_page, tmp_path: Path) -> None:
    s = open_page("#list/tours")
    s.page.evaluate("""([picks, home]) => { localStorage.setItem('as:picks', JSON.stringify(picks)); }""", [{HOME: {"saved": True, "tier": "S", "note": "PRIVATE-NOTE"}, OTHER: {"saved": True}}, HOME])
    s.page.reload()
    s.page.wait_for_selector("#view-tours .tc", timeout=SLOW)
    # the Tours card has its own way in
    card = s.page.locator(f".tc[data-id='{HOME}']")
    card.locator("[data-vf-open]").click()
    s.page.wait_for_selector("#visitSheet.on")
    fill_a_visit(s)
    sheet(s).locator("[data-note='1'], [data-f='note']").first.fill("PRIVATE-VISIT-NOTE")
    sheet(s).locator("input[data-photo]").first.set_input_files({"name": "w.jpg", "mimeType": "image/jpeg", "buffer": jpeg()})
    s.page.wait_for_function("() => document.querySelectorAll('#visitSheet .vs-ph').length === 1", timeout=15000)
    s.page.wait_for_timeout(500)
    sheet(s).locator("[data-promote='wd']").click()
    sheet(s).locator(".vs-done").click()
    s.page.wait_for_selector("#visitSheet", state="detached")
    s.page.click("#dClose") if s.page.locator("#dClose").is_visible() else None

    def memo(notes: bool, photos: bool) -> dict:
        s.page.evaluate("([n, p]) => { localStorage.setItem('as:share-notes', JSON.stringify(n)); localStorage.setItem('as:share-tourphotos', JSON.stringify(p)); localStorage.setItem('as:share-photos', JSON.stringify('none')); }", [notes, photos])
        s.page.reload()
        s.page.wait_for_selector("#view-tours .tc", timeout=SLOW)
        s.page.locator(".share-more").click()
        with s.page.expect_download(timeout=60000) as dl:
            s.page.locator("[data-act='memo-file']").click()
        p = tmp_path / f"memo-{notes}-{photos}.html"
        dl.value.save_as(p)
        html = p.read_text(encoding="utf-8")
        assert "</script><script>" not in html
        data = json.loads(re.search(r'<script type="application/json" id="as-data">(.*?)</script>', html, re.S).group(1))
        return {"html": html, "home": next(h for h in data["homes"] if h["id"] == HOME)}

    plain = memo(False, False)
    h = plain["home"]
    assert [c["key"] for c in h["tour"]["checks"]] == ["wd", "size"] and h["tour"]["checks"][0]["promoted"] and not h["tour"]["checks"][1]["promoted"]
    assert h["tour"]["rooms"][0]["name"] == "Living room" and h["tour"]["water"] == 2
    assert "photos" not in h["tour"] and "note" not in h["tour"] and "PRIVATE-VISIT-NOTE" not in plain["html"] and "PRIVATE-NOTE" not in plain["html"]
    assert [t["kind"] for t in h["trail"]] == ["promote"] and not any("why" in t for t in h["trail"])
    full = memo(True, True)
    h = full["home"]
    assert h["tour"]["note"] == "PRIVATE-VISIT-NOTE" and h["tour"]["photos"][0]["src"].startswith("data:image/jpeg;base64,")
    assert h["pick"]["note"] == "PRIVATE-NOTE"
    # the page itself draws them
    viewer = s.page.context.browser.new_context(viewport={"width": 1200, "height": 900})
    page = viewer.new_page()
    page.goto((tmp_path / "memo-True-True.html").as_uri() + "#memo")
    body = page.locator("#app").inner_text()
    for expected in ("On the visit", "Decision trail", "Differs, used as a fact", "Differs, not used in the ranking", "Observed on"):
        assert expected.lower() in body.lower(), expected
    assert page.locator(".m-home .tph img").count() == 1
    viewer.close()


# --------------------------------------------------------------------------- the local API
@pytest.fixture(scope="module")
def served_search(tmp_path_factory):
    """A real `apartmentscout serve` (the local API on) over a scratch search folder holding a few of the example's homes."""
    from apartmentscout import cli
    from apartmentscout.config import Workspace
    from apartmentscout.localapi import ServeState, make_server
    import shutil
    root = tmp_path_factory.mktemp("serve") / "searches" / "mine"
    root.mkdir(parents=True)
    shutil.copy(ROOT / "examples" / "nyc-2026" / "criteria.yaml", root / "criteria.yaml")
    keep = [{k: v for k, v in x.items() if k not in ("photos_local",)} for x in HOMES[:8]]
    (root / "listings.json").write_text(json.dumps(keep))
    state = ServeState(dash=ROOT / "dashboard", searches_dir=root.parent, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None, export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(root))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    yield root, f"http://127.0.0.1:{state.port}"
    httpd.shutdown()
    httpd.server_close()


def test_served_by_the_local_api_a_visit_and_its_photos_land_in_the_search_folder(browser, served_search) -> None:
    root, base = served_search
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    block_foreign(ctx, base)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/?visit={HOMES[0]['id']}#map")
    page.wait_for_selector("#visitSheet.on", timeout=SLOW)
    page.wait_for_function("() => document.querySelector('#vsSave')?.textContent.includes('search folder')", timeout=10000)
    sh = page.locator("#visitSheet")
    sh.locator("[data-set='water'][data-v='4']").click()
    sh.locator("[data-f='note']").fill("quiet corridor")
    sh.locator("input[data-photo]").first.set_input_files({"name": "w.jpg", "mimeType": "image/jpeg", "buffer": jpeg((3200, 2400))})
    page.wait_for_function("() => document.querySelectorAll('#visitSheet .vs-ph img').length === 1", timeout=15000)
    home = HOMES[0]["id"]
    findings = root / "tours" / home / "findings.json"
    # the page saves into the search folder after a short pause: wait for the file to hold all three things typed
    poll(lambda: (lambda d: d.get("water") == 4 and d.get("note") == "quiet corridor" and d["photos"][0]["store"] == "disk")(json.loads(findings.read_text())), page, timeout=20)
    f = json.loads(findings.read_text())
    assert f["water"] == 4 and f["note"] == "quiet corridor" and f["photos"][0]["store"] == "disk"
    webp = root / "tours" / home / "photos" / f"{f['photos'][0]['id']}.webp"
    data = webp.read_bytes()
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) < 2_000_000
    from PIL import Image
    assert max(Image.open(webp).size) <= 1600
    # the thumbnail is the folder's file; a reload with a cleared browser reads the visit back from the folder
    page.wait_for_function("() => document.querySelector('#visitSheet .vs-ph img')?.src.includes('/tours/')", timeout=10000)
    page.evaluate("() => localStorage.clear()")
    page.reload()
    page.wait_for_selector("#visitSheet.on", timeout=SLOW)
    page.wait_for_function("() => document.querySelector('#visitSheet [data-set=water][data-v=\"4\"]')?.getAttribute('aria-pressed') === 'true'", timeout=10000)
    # a finding that contradicts a listing, promoted, scores the same as `apartmentscout score` would after reading the folder
    sh = page.locator("#visitSheet")
    sh.locator("[data-verdict='wd'][data-v='differs']").click()
    sh.locator("[data-obs='wd'][data-v='false']").click()
    sh.locator("[data-promote='wd']").click()
    poll(lambda: "wd" in (json.loads(findings.read_text()).get("promoted") or {}), page, timeout=20)   # the verdict and the promotion are in the folder (the page saves 0.6 s after a change)
    from apartmentscout import tours
    from apartmentscout.score import score_all
    from apartmentscout.listings import load
    from apartmentscout.config import load_criteria
    crit = load_criteria(root / "criteria.yaml")
    scored = {L["id"]: L for L in score_all(load(root / "listings.json"), crit, tours=tours.load_all(root))}[home]
    live = page.evaluate("async (id) => { const m = await import('/js/app.js'); const L = m.byId(id); return { gates: L.score.gates.filter((g) => /^(fails|contradicted)/.test(g)), eligible: L.score.eligible }; }", home)
    assert [g for g in scored["score"]["gates"] if g.startswith(("fails", "contradicted"))] == live["gates"] and scored["score"]["eligible"] == live["eligible"]
    # the API's guards hold from the page's own origin too
    status = page.evaluate("async () => (await fetch('/api/tours', { headers: { 'X-AS-Token': 'wrong' } })).status")
    assert status == 401 and errors == []
    ctx.close()
