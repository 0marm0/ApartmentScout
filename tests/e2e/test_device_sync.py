"""Device sync in a real browser. Each `device` is its own browser context (its own localStorage and IndexedDB, like a Mac and an iPhone), and
api.github.com is answered by tests/e2e/fake_github.py through Playwright routing: nothing here ever reaches the real GitHub API, and any other
foreign request is blocked by conftest.block_foreign.

What is checked: connecting a token creates a SECRET gist and sends the sync document; a star on one device shows on the other after a sync; two
edits made apart merge without loss (different fields both stay, the same field takes the newer write); a deletion travels; photos travel as
small copies; the offline queue sends what was waiting once the network is back; GitHub's errors (bad token, rate limit, server trouble) are
shown plainly and recover; the sync file exports and merges (and takes old picks backups); the token is stored in one place, sent only in the
Authorization header and never shown, logged or synced.
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path

import pytest
from conftest import poll, settled
from fake_github import FakeGitHub

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
LISTINGS = json.loads((ROOT / "dashboard" / "data" / "listings.json").read_text())
SEARCH = json.loads((ROOT / "dashboard" / "data" / "criteria.json").read_text())["search"]["name"]
HOMES = [x["id"] for x in LISTINGS if x.get("status") in ("new", "researching", "shortlist", "touring") and (x.get("score") or {}).get("eligible")]
HOME, OTHER, THIRD = HOMES[0], HOMES[1], HOMES[2]
TOKEN = "github_pat_FAKETOKENFORTESTS_one"
SLOW = 30000
# the waits are shortened for the tests (js/sync/engine.js reads this before it loads)
TUNING = "window.__AS_SYNC_TUNING = { debounce: 250, gap: 100, backoff: [400, 600, 800], resume: 600000 };"


@pytest.fixture
def github() -> FakeGitHub:
    return FakeGitHub()


@pytest.fixture
def device(open_page, github):
    """device(name) -> Session of a fresh browser context wired to the fake GitHub, with sync loaded."""
    def make(path: str = "#map"):
        s = open_page(path)
        ctx = s.page.context
        ctx.add_init_script(TUNING)
        github.install(ctx)
        s.page.reload()
        s.page.wait_for_function("() => document.documentElement.dataset.boot === 'ready' && !!window.__asSync", timeout=SLOW)
        settled(s.page, 20000, ticks=4)
        return s
    return make


# ------------------------------------------------------------------ small helpers
def status(s) -> dict:
    return s.page.evaluate("() => window.__asSync.status()")


def wait_status(s, expr: str, timeout: int = 15000) -> None:
    """Wait until `expr` (JS over `st`, the sync status) is true."""
    s.page.wait_for_function(f"() => {{ const st = window.__asSync.status(); return !!({expr}); }}", timeout=timeout)


def open_panel(s) -> None:
    if s.page.locator("#syncSheet.on").count():
        return
    s.page.click("#menuBtn")
    s.page.click("#mnSync")
    s.page.wait_for_selector("#syncSheet.on", timeout=SLOW)


def connect(s, token: str = TOKEN) -> None:
    open_panel(s)
    s.page.fill("#syToken", token)
    s.page.click("[data-sy-go]")
    wait_status(s, "st.connected && st.phase === 'synced'")


def picks(s) -> dict:
    return s.page.evaluate("async () => JSON.parse(JSON.stringify((await import('/js/app.js')).S.picks))")


def set_pick(s, home: str, **patch) -> None:
    s.page.evaluate("async ([id, p]) => (await import('/js/app.js')).setPick(id, p)", [home, patch])


def sync_now(s) -> None:
    s.page.evaluate("() => window.__asSync.syncNow('manual')")
    wait_status(s, "st.phase === 'synced' && !st.pending")


# ------------------------------------------------------------------ connecting
def test_connecting_a_token_makes_a_secret_gist_and_sends_the_sync_document(device, github) -> None:
    s = device()
    set_pick(s, HOME, saved=True, note="north light")
    connect(s)
    assert len(github.gists) == 1
    assert github.only("POST", r"^/gists$"), "the gist was created"
    created = json.loads(github.only("POST", r"^/gists$")[0].body)
    assert created["public"] is False, "a sync gist is always secret"
    main = github.main()
    assert main["sync"]["format"] == "apartmentscout-sync" and main["version"] == 2
    items = github.items()
    assert items[f"picks/{HOME}/saved"]["v"] is True
    assert items[f"picks/{HOME}/note"]["v"] == "north light"
    assert not any(k.startswith(("theme", "density", "sync")) for k in items), "settings and the sync token are never synced"
    st = status(s)
    assert st["connected"] and st["owner"] == "renter" and st["lastSync"]


# ------------------------------------------------------------------ two devices
def test_a_star_on_one_device_shows_on_the_other_after_a_sync(device, github) -> None:
    mac, phone = device(), device()
    connect(mac)
    set_pick(mac, HOME, saved=True)
    wait_status(mac, "st.phase === 'synced' && !st.pending", 15000)
    poll(lambda: github.live(f"picks/{HOME}/saved") is True, mac.page, 10)
    assert github.live(f"picks/{HOME}/saved") is True, "the change was sent on its own, without pressing Sync now"
    connect(phone)   # the same token: the phone finds the Mac's gist and takes its picks
    assert len(github.gists) == 1, "the second device joins the first one's gist instead of making another"
    assert picks(phone)[HOME]["saved"] is True
    phone.page.wait_for_function("() => document.querySelector('#savedCount')?.textContent === '1'", timeout=10000)
    # and back: a note on the phone reaches the Mac
    set_pick(phone, OTHER, saved=True, note="quiet street")
    wait_status(phone, "st.phase === 'synced' && !st.pending")
    sync_now(mac)
    assert picks(mac)[OTHER]["note"] == "quiet street"
    mac.page.wait_for_function("() => document.querySelector('#savedCount')?.textContent === '2'", timeout=10000)


def test_what_changes_while_the_other_device_is_closed_arrives_when_it_opens(device, github) -> None:
    mac = device()
    connect(mac)
    phone = device()
    connect(phone)
    set_pick(mac, THIRD, saved=True, tier=2)
    wait_status(mac, "st.phase === 'synced' && !st.pending")
    phone.page.reload()
    phone.page.wait_for_function("() => document.documentElement.dataset.boot === 'ready' && !!window.__asSync", timeout=SLOW)
    phone.page.wait_for_function("async (id) => (await import('/js/app.js')).S.picks[id]?.tier === 2", arg=THIRD, timeout=15000)


def test_two_edits_made_apart_merge_without_loss(device, github) -> None:
    mac, phone = device(), device()
    connect(mac)
    connect(phone)
    set_pick(mac, HOME, saved=True)
    sync_now(mac)
    sync_now(phone)
    # both go offline and edit the same home
    mac.page.context.set_offline(True)
    phone.page.context.set_offline(True)
    set_pick(mac, HOME, note="mac note", tier=1)
    set_pick(phone, HOME, tier=3, tour="2026-10-20T16:00")
    wait_status(mac, "st.pending && st.phase === 'offline'")
    wait_status(phone, "st.pending && st.phase === 'offline'")
    set_pick(phone, HOME, note="phone note")   # the newest write of the shared field
    mac.page.context.set_offline(False)
    phone.page.context.set_offline(False)
    wait_status(mac, "st.phase === 'synced' && !st.pending", 20000)
    wait_status(phone, "st.phase === 'synced' && !st.pending", 20000)
    sync_now(mac)
    sync_now(phone)
    a, b = picks(mac)[HOME], picks(phone)[HOME]
    for side in (a, b):
        assert side["saved"] is True
        assert side["tour"] == "2026-10-20T16:00", "the phone's edit to a field the Mac did not touch is kept"
        assert side["note"] == "phone note", "the same field: the newer write wins on both"
    assert a["tier"] == b["tier"], "both sides agree about the field both edited"
    assert a["tier"] in (1, 3)
    assert {k: v for k, v in a.items() if k != "updated"} == {k: v for k, v in b.items() if k != "updated"}


def test_a_deletion_travels_and_a_later_edit_beats_an_earlier_deletion(device, github) -> None:
    mac, phone = device(), device()
    connect(mac)
    set_pick(mac, HOME, saved=True, note="to be removed")
    set_pick(mac, OTHER, saved=True)
    sync_now(mac)
    connect(phone)
    assert HOME in picks(phone)
    set_pick(mac, HOME, saved=False, note="")   # an empty pick is removed entirely
    sync_now(mac)
    assert github.items()[f"picks/{HOME}/saved"].get("x") == 1, "the deletion is a tombstone in the gist"
    sync_now(phone)
    assert HOME not in picks(phone), "the removal reached the phone"
    assert OTHER in picks(phone)
    # the phone edits something the Mac deleted earlier: the newer edit stays, nothing is lost
    set_pick(phone, HOME, saved=True, note="changed my mind")
    sync_now(phone)
    sync_now(mac)
    assert picks(mac)[HOME]["note"] == "changed my mind"


def test_renter_numbers_and_tour_findings_sync_and_the_other_device_can_edit_them(device, github) -> None:
    mac, phone = device(), device()
    connect(mac)
    connect(phone)
    mac.page.evaluate("""async (id) => { const FS = await import('/js/features/findings-store.js'), F = await import('/js/features/facts-store.js');
      FS.update(id, (cur) => ({ ...cur, note: 'bright, loud street', noise: { rating: 2 } })); F.setFact(id, 'size', 612); }""", HOME)
    wait_status(mac, "st.phase === 'synced' && !st.pending")
    sync_now(phone)
    got = phone.page.evaluate("""async (id) => { const FS = await import('/js/features/findings-store.js'), F = await import('/js/features/facts-store.js');
      return { note: FS.get(id)?.note, noise: FS.get(id)?.noise, size: F.get(id)?.size?.value, updated: FS.get(id)?.updated }; }""", HOME)
    assert got["note"] == "bright, loud street" and got["noise"] == {"rating": 2} and got["size"] == 612
    assert got["updated"], "the visit's own `updated` stamp is rebuilt for the page"
    # the phone adds to the same visit; the Mac gets the new field and keeps its own
    phone.page.evaluate("async (id) => (await import('/js/features/findings-store.js')).update(id, (cur) => ({ ...cur, water: 3 }))", HOME)
    wait_status(phone, "st.phase === 'synced' && !st.pending")
    sync_now(mac)
    mine = mac.page.evaluate("async (id) => { const f = (await import('/js/features/findings-store.js')).get(id); return { note: f.note, water: f.water }; }", HOME)
    assert mine == {"note": "bright, loud street", "water": 3}
    assert not mac.take()


# ------------------------------------------------------------------ offline, errors
def test_changes_made_offline_are_queued_and_sent_when_the_network_returns(device, github) -> None:
    mac = device()
    connect(mac)
    github.down = True   # GitHub cannot be reached, though the browser thinks it is online: the failed request is what shows it
    set_pick(mac, HOME, saved=True, note="written on the train")
    wait_status(mac, "st.phase === 'offline' && st.pending")
    assert github.live(f"picks/{HOME}/note") is None
    line = mac.page.evaluate("() => document.getElementById('mnSyncSt').textContent")
    assert "Offline" in line and "will sync" in line
    # closing and reopening the page offline loses nothing: the change is still waiting
    mac.page.reload()
    mac.page.wait_for_function("() => !!window.__asSync", timeout=SLOW)
    assert status(mac)["pending"] is True
    assert picks(mac)[HOME]["note"] == "written on the train"
    github.down = False
    wait_status(mac, "st.phase === 'synced' && !st.pending", 20000)
    poll(lambda: github.live(f"picks/{HOME}/note") == "written on the train", mac.page, 10)
    assert github.live(f"picks/{HOME}/note") == "written on the train"


def test_a_revoked_token_stops_with_a_plain_message_and_a_new_token_recovers(device, github) -> None:
    mac = device()
    connect(mac)
    github.tokens.clear()   # the renter revoked it on GitHub
    set_pick(mac, HOME, saved=True)
    wait_status(mac, "st.phase === 'error'")
    msg = status(mac)["error"]["message"]
    assert "does not accept this token" in msg
    assert TOKEN not in msg
    github.tokens["github_pat_FAKETOKENFORTESTS_two"] = "renter"
    open_panel(mac)
    assert "does not accept this token" in mac.page.inner_text("[data-sy-error]")
    mac.page.click("[data-sy-disconnect]")
    mac.page.fill("#syToken", "github_pat_FAKETOKENFORTESTS_two")
    mac.page.click("[data-sy-go]")
    wait_status(mac, "st.connected && st.phase === 'synced' && !st.pending")
    assert github.live(f"picks/{HOME}/saved") is True, "what was waiting went out with the new token"


def test_a_rate_limit_pauses_and_then_continues(device, github) -> None:
    import time
    mac = device()
    connect(mac)
    github.fail_next("PATCH", 403, x_ratelimit_remaining="0", x_ratelimit_reset=str(int(time.time()) + 2))
    set_pick(mac, HOME, saved=True)
    wait_status(mac, "st.phase === 'limited' && st.retryAt > 0")
    assert "asked for a pause" in mac.page.evaluate("() => document.getElementById('mnSyncSt').textContent")
    wait_status(mac, "st.phase === 'synced' && !st.pending", 25000)
    assert github.live(f"picks/{HOME}/saved") is True


def test_a_server_error_is_retried_without_losing_anything(device, github) -> None:
    mac = device()
    connect(mac)
    github.fail_next("PATCH", 502)
    github.fail_next("PATCH", 503)
    set_pick(mac, HOME, saved=True, note="retry me")
    wait_status(mac, "st.phase === 'synced' && !st.pending", 25000)
    assert github.live(f"picks/{HOME}/note") == "retry me"
    assert len(github.only("PATCH")) >= 3


def test_a_lost_gist_is_reported_not_silently_recreated(device, github) -> None:
    mac = device()
    connect(mac)
    github.gists.clear()
    set_pick(mac, HOME, saved=True)
    wait_status(mac, "st.phase === 'error'")
    assert "cannot find the sync gist" in status(mac)["error"]["message"]
    assert not github.gists


# ------------------------------------------------------------------ photos
JPEG_JS = """async ([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${(i * 47) % 360} 70% ${20 + (i * 13) % 60}%)`; g.fillRect((i * 97) % w, (i * 61) % h, 90, 60); }
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95)); }"""


def add_photo(s, home: str, size=(1800, 1200)) -> str:
    return s.page.evaluate("""async ([id, size, src]) => { const FS = await import('/js/features/findings-store.js');
      const blob = await (0, eval)('(' + src + ')')(size); const e = await FS.addPhoto(id, new File([blob], 'a.jpg', { type: 'image/jpeg' })); return e.id; }""", [home, list(size), JPEG_JS])


def test_tour_photos_travel_as_small_copies_and_the_original_stays_put(device, github) -> None:
    mac, phone = device(), device()
    connect(mac)
    connect(phone)
    pid = add_photo(mac, HOME)
    wait_status(mac, "st.phase === 'synced' && !st.pending", 20000)
    blobs = {k: w for k, w in github.items().items() if k.startswith("blob/") and not w.get("x")}
    assert len(blobs) == 1
    (uri,) = [w["v"] for w in blobs.values()]
    assert uri.startswith("data:image/jpeg;base64,") and len(uri) <= 220 * 1024, "a small JPEG, under the cap"
    sync_now(phone)
    entry = phone.page.evaluate("async (id) => (await import('/js/features/findings-store.js')).get(id).photos.map((p) => ({ id: p.id, store: p.store }))", HOME)
    assert entry == [{"id": pid, "store": "idb"}]
    url = phone.page.evaluate("async ([id, pid]) => await (await import('/js/features/findings-store.js')).photoUrl(id, { id: pid, store: 'idb' })", [HOME, pid])
    assert url and url.startswith("blob:"), "the phone can show the photo"
    # deleting it on the phone removes the copy from the gist and the photo from the Mac
    phone.page.evaluate("async ([id, pid]) => (await import('/js/features/findings-store.js')).deletePhoto(id, { id: pid, store: 'idb' })", [HOME, pid])
    wait_status(phone, "st.phase === 'synced' && !st.pending", 20000)
    sync_now(phone)
    assert not [k for k, w in github.items().items() if k.startswith("blob/") and not w.get("x")], "the copy left the gist with its photo"
    sync_now(mac)
    assert mac.page.evaluate("async (id) => ((await import('/js/features/findings-store.js')).get(id)?.photos || []).length", HOME) == 0


def test_photo_copies_can_be_turned_off(device, github) -> None:
    mac = device()
    connect(mac)
    open_panel(mac)
    mac.page.click("[data-opt=photos]")
    assert status(mac)["photos"] is False
    add_photo(mac, HOME)
    wait_status(mac, "st.phase === 'synced' && !st.pending", 20000)
    assert not [k for k in github.items() if k.startswith("blob/")]
    assert any("/photos/" in k for k in github.items()), "the photo's entry still travels, so the other device knows it exists"


# ------------------------------------------------------------------ the sync file
def export_file(s, tmp_path: Path, name: str = "sync.json") -> Path:
    open_panel(s)
    s.page.click("[data-pane=file]")
    s.page.wait_for_selector("[data-sy-download]:not([disabled])", timeout=20000)
    with s.page.expect_download() as dl:
        s.page.click("[data-sy-download]")
    out = tmp_path / name
    dl.value.save_as(out)
    return out


def import_file(s, path: Path) -> str:
    open_panel(s)
    s.page.click("[data-pane=file]")
    s.page.set_input_files("[data-sy-import]", str(path))
    s.page.wait_for_function("() => document.querySelector('[data-sy-filemsg]')?.textContent.trim().length > 0", timeout=15000)
    return s.page.inner_text("[data-sy-filemsg]")


def test_the_sync_file_round_trips_between_two_devices_and_is_also_a_picks_backup(device, tmp_path) -> None:
    a, b = device(), device()
    set_pick(a, HOME, saved=True, note="from the file", tier=1)
    a.page.evaluate("async (id) => (await import('/js/features/facts-store.js')).setFact(id, 'price', 4321)", HOME)
    path = export_file(a, tmp_path)
    doc = json.loads(path.read_text())
    assert doc["version"] == 2 and doc["sync"]["format"] == "apartmentscout-sync"
    assert doc["picks"][HOME]["note"] == "from the file", "an old reader finds the version-1 fields"
    assert doc["search"] == SEARCH
    assert TOKEN not in path.read_text()
    msg = import_file(b, path)
    assert "Merged" in msg and "new" in msg, msg
    assert picks(b)[HOME]["note"] == "from the file"
    assert b.page.evaluate("async (id) => (await import('/js/features/facts-store.js')).get(id)?.price?.value", HOME) == 4321
    again = import_file(b, path)
    assert "Nothing in the file was newer" in again, "merging the same file again changes nothing"
    assert status(b)["target"] == "file"


def test_importing_a_file_keeps_newer_edits_made_here(device, tmp_path) -> None:
    a, b = device(), device()
    set_pick(a, HOME, saved=True, note="old text")
    path = export_file(a, tmp_path)
    set_pick(b, HOME, saved=True, note="newer text on b")
    msg = import_file(b, path)
    assert picks(b)[HOME]["note"] == "newer text on b"
    assert "kept" in msg and "newer" in msg


def test_old_picks_backups_import_through_the_same_merge(device, tmp_path) -> None:
    b = device()
    set_pick(b, OTHER, saved=True, note="mine, written later")
    backup = tmp_path / "apartmentscout-picks-2026-09-01.json"
    backup.write_text(json.dumps({"version": 1, "search": SEARCH, "picks": {HOME: {"saved": True, "note": "backup note", "updated": "2026-09-01"}, OTHER: {"saved": True, "note": "backup says older", "updated": "2026-09-01"}},
                                  "weights": {"cost": 31}, "history": [{"e": "abcd1234", "home": HOME, "at": "2026-09-01T10:00:00Z", "kind": "star", "to": True}]}))
    msg = import_file(b, backup)
    assert "Merged" in msg
    p = picks(b)
    assert p[HOME]["note"] == "backup note", "something this device never had is added"
    assert p[OTHER]["note"] == "mine, written later", "an older line in a backup does not overwrite a newer edit here"
    trail = b.page.evaluate("() => window.__trail.entries.map((e) => e.e)")
    assert "abcd1234" in trail
    bad = tmp_path / "not-a-backup.json"
    bad.write_text('{"hello": 1}')
    assert "not an ApartmentScout backup" in import_file(b, bad)


def test_a_file_export_includes_small_photo_copies_when_asked(device, tmp_path) -> None:
    a, b = device(), device()
    pid = add_photo(a, HOME)
    path = export_file(a, tmp_path)
    doc = json.loads(path.read_text())
    assert [k for k in doc["sync"]["items"] if k.startswith("blob/")], "the photo copy is in the file"
    import_file(b, path)
    assert b.page.evaluate("async ([id, pid]) => !!(await (await import('/js/features/findings-store.js')).photoUrl(id, { id: pid, store: 'idb' }))", [HOME, pid])


# ------------------------------------------------------------------ privacy
def test_the_token_stays_in_one_place_and_only_goes_to_api_github_com(device, github) -> None:
    mac = device()
    set_pick(mac, HOME, saved=True, note="private words")
    connect(mac)
    sync_now(mac)
    # where it is stored: one key, never in the settings, the ledger or the synced data
    keys = mac.page.evaluate("() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k).includes('FAKETOKENFORTESTS')]))")
    assert [k for k, has in keys.items() if has] == ["as:sync.token"]
    assert TOKEN not in json.dumps(github.items()) and TOKEN not in json.dumps([g.files for g in github.gists.values()])
    # what was sent: the token only in the Authorization header, never in a URL or a body, and only to api.github.com
    assert github.log and all(r.auth == f"Bearer {TOKEN}" for r in github.log)
    assert not any(TOKEN in r.url or TOKEN in (r.body or "") for r in github.log)
    assert all(r.url.startswith("https://api.github.com/") for r in github.log)
    assert "FAKETOKEN" not in mac.page.inner_text("body"), "the token is never shown on the page"
    assert not mac.take(), "no console errors"
    # disconnecting removes it
    open_panel(mac)
    mac.page.click("[data-sy-disconnect]")
    assert mac.page.evaluate("() => localStorage.getItem('as:sync.token')") is None
    assert status(mac)["connected"] is False
    assert picks(mac)[HOME]["note"] == "private words", "the data stays on the device"
    n = len(github.log)
    set_pick(mac, HOME, note="after disconnect")
    mac.page.wait_for_timeout(1200)   # the debounce is 250 ms in these tests: nothing may be sent now
    assert len(github.log) == n


def test_nothing_is_sent_until_sync_is_connected(device, github) -> None:
    mac = device()
    set_pick(mac, HOME, saved=True)
    open_panel(mac)
    mac.page.wait_for_timeout(1000)
    assert github.log == []
    assert status(mac)["target"] == "off"
