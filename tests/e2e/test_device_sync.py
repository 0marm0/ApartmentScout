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
    def make(path: str = "#map", theme: str = "dark", width: int = 1440, height: int = 900):
        s = open_page(path, theme=theme, width=width, height=height)
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
    # back online one after the other: the edits were made apart, and that is what must merge. (Two devices writing the gist in the
    # same moment is a different case: the gist API has no compare-and-set, so the later write can drop the other's edit.)
    mac.page.context.set_offline(False)
    wait_status(mac, "st.phase === 'synced' && !st.pending", 20000)
    phone.page.context.set_offline(False)
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


# ------------------------------------------------------------------ served by `apartmentscout serve`: the search folder stays the source on the Mac
@pytest.fixture(scope="module")
def served_search(tmp_path_factory):
    """A real `apartmentscout serve` (the local API on) over a scratch search folder holding a few of the example's homes."""
    import shutil
    import threading
    from apartmentscout import cli
    from apartmentscout.config import Workspace
    from apartmentscout.localapi import ServeState, make_server
    root = tmp_path_factory.mktemp("serve") / "searches" / "mine"
    root.mkdir(parents=True)
    shutil.copy(ROOT / "examples" / "nyc-2026" / "criteria.yaml", root / "criteria.yaml")
    keep = [{k: v for k, v in x.items() if k not in ("photos_local",)} for x in LISTINGS if x["id"] in (HOME, OTHER, THIRD)]
    (root / "listings.json").write_text(json.dumps(keep))
    state = ServeState(dash=ROOT / "dashboard", searches_dir=root.parent, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None, export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(root))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    yield root, f"http://127.0.0.1:{state.port}"
    httpd.shutdown()
    httpd.server_close()


def served_device(browser, base: str, github: FakeGitHub):
    from conftest import block_foreign
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce", service_workers="block")
    block_foreign(ctx, base)
    ctx.add_init_script(TUNING)
    github.install(ctx)
    page = ctx.new_page()
    page.goto(f"{base}/#map")
    page.wait_for_function("() => document.documentElement.dataset.boot === 'ready' && !!window.__asSync", timeout=SLOW)
    return ctx, page


def test_with_the_local_api_the_search_folder_stays_the_source_and_the_gist_merges_both_ways(browser, served_search, device, github) -> None:
    root, base = served_search
    folder = root / "tours" / HOME / "findings.json"
    ctx, mac = served_device(browser, base, github)
    try:
        # a visit saved on the Mac reaches the folder (the local API) and, once connected, the gist
        mac.evaluate("async (id) => (await import('/js/features/findings-store.js')).update(id, (cur) => ({ ...cur, note: 'saved on the mac', water: 4 }))", HOME)
        poll(lambda: json.loads(folder.read_text()).get("note") == "saved on the mac", mac, timeout=20)
        mac.click("#menuBtn")
        mac.click("#mnSync")
        mac.fill("#syToken", TOKEN)
        mac.click("[data-sy-go]")
        mac.wait_for_function("() => window.__asSync.status().connected && window.__asSync.status().phase === 'synced'", timeout=20000)
        assert github.live(f"findings:{SEARCH}/{HOME}/note") == "saved on the mac"
        # the phone (a static page, no folder) adds to the same visit and to another one
        phone = device()
        connect(phone)
        phone.page.evaluate("""async ([a, b]) => { const FS = await import('/js/features/findings-store.js');
          FS.update(a, (cur) => ({ ...cur, ceiling: 9.5 })); FS.update(b, (cur) => ({ ...cur, note: 'phone only visit' })); }""", [HOME, OTHER])
        wait_status(phone, "st.phase === 'synced' && !st.pending")
        mac.evaluate("() => window.__asSync.syncNow('manual')")
        mac.wait_for_function("() => window.__asSync.status().phase === 'synced' && !window.__asSync.status().pending", timeout=20000)
        # what came from the phone is written into the search folder through the local API, and what was there is kept
        poll(lambda: json.loads(folder.read_text()).get("ceiling") == 9.5, mac, timeout=20)
        f = json.loads(folder.read_text())
        assert f["note"] == "saved on the mac" and f["water"] == 4 and f["ceiling"] == 9.5
        other = root / "tours" / OTHER / "findings.json"
        poll(lambda: other.exists() and json.loads(other.read_text()).get("note") == "phone only visit", mac, timeout=20)
        assert json.loads(other.read_text())["note"] == "phone only visit"
        # a visit written into the folder by hand (the command line, another tool) is picked up when the page opens, and goes to the gist
        third = root / "tours" / THIRD
        third.mkdir(parents=True, exist_ok=True)
        (third / "findings.json").write_text(json.dumps({"v": 1, "note": "typed in the folder", "updated": "2026-10-15T09:00:00Z"}))
        mac.reload()
        mac.wait_for_function("() => document.documentElement.dataset.boot === 'ready' && !!window.__asSync", timeout=SLOW)
        mac.wait_for_function("() => window.__asSync.status().phase === 'synced'", timeout=20000)
        mac.evaluate("() => window.__asSync.syncNow('manual')")
        poll(lambda: github.live(f"findings:{SEARCH}/{THIRD}/note") == "typed in the folder", mac, timeout=20)
        assert github.live(f"findings:{SEARCH}/{THIRD}/note") == "typed in the folder"
    finally:
        ctx.close()


def test_a_photo_taken_on_the_phone_ends_up_in_the_macs_search_folder(browser, served_search, device, github) -> None:
    root, base = served_search
    ctx, mac = served_device(browser, base, github)
    try:
        mac.click("#menuBtn")
        mac.click("#mnSync")
        mac.fill("#syToken", TOKEN)
        mac.click("[data-sy-go]")
        mac.wait_for_function("() => window.__asSync.status().connected && window.__asSync.status().phase === 'synced'", timeout=20000)
        phone = device()
        connect(phone)
        add_photo(phone, THIRD)
        wait_status(phone, "st.phase === 'synced' && !st.pending", 20000)
        mac.evaluate("() => window.__asSync.syncNow('manual')")
        folder = root / "tours" / THIRD / "photos"
        poll(lambda: folder.is_dir() and any(folder.glob("*.webp")), mac, timeout=30)
        assert list(folder.glob("*.webp")), "the photo copy was stored in the folder by the local API, like a photo taken on the Mac"
    finally:
        ctx.close()


# ------------------------------------------------------------------ the panel itself: accessibility and a 390 px phone
AXE = Path(__file__).parent / "vendor" / "axe.min.js"
AXE_JS = """async () => { const r = await axe.run(document.querySelector('#syncSheet'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
  return r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | ')); }"""


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_the_panel_passes_axe_in_every_state(device, github, theme: str) -> None:
    s = device(theme=theme)
    s.page.add_script_tag(path=str(AXE))
    open_panel(s)
    assert s.page.evaluate(AXE_JS) == [], "setup"
    s.page.fill("#syToken", "not a token")
    assert s.page.evaluate(AXE_JS) == [], "setup with a hint about the token"
    s.page.fill("#syToken", TOKEN)
    s.page.click("[data-sy-go]")
    wait_status(s, "st.connected && st.phase === 'synced'")
    assert s.page.evaluate(AXE_JS) == [], "connected"
    s.page.click("[data-pane=file]")
    s.page.wait_for_selector("[data-sy-download]:not([disabled])", timeout=20000)
    assert s.page.evaluate(AXE_JS) == [], "file"
    s.page.click("#syncSheet .sh-close")
    s.page.click("#menuBtn")
    assert s.page.evaluate("""async () => { const r = await axe.run(document.getElementById('appMenu'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
      return r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | ')); }""") == [], "the menu with its sync row"


def test_the_panel_fits_a_390_px_phone_and_the_controls_are_thumb_sized(device, github) -> None:
    s = device(width=390, height=844)
    open_panel(s)
    page = s.page
    def check(label: str) -> None:
        over = page.evaluate("""() => { const sh = document.querySelector('#syncSheet .sheet').getBoundingClientRect(), bad = [];
          for (const el of document.querySelectorAll('#syncSheet .sh-body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > sh.right + 0.5) bad.push(el.className || el.tagName); }
          return { bad: bad.slice(0, 5), sheetRight: sh.right, scrollX: document.documentElement.scrollWidth - innerWidth }; }""")
        assert over["bad"] == [] and over["scrollX"] <= 0 and over["sheetRight"] <= 390.5, f"{label}: {over}"
        small = page.evaluate("""() => [...document.querySelectorAll('#syncSheet button, #syncSheet label.btn, #syncSheet input:not([type=file]), #syncSheet [role=switch]')].filter((e) => e.offsetParent && !e.classList.contains('sh-close')
          && e.getBoundingClientRect().height < 34 && !e.closest('details')).map((e) => (e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().height))""")
        assert small == [], f"{label}: controls under 34 px tall: {small}"
    check("setup")
    page.fill("#syToken", TOKEN)
    page.click("[data-sy-go]")
    wait_status(s, "st.connected && st.phase === 'synced'")
    check("connected")
    page.click("[data-pane=file]")
    page.wait_for_selector("[data-sy-download]:not([disabled])", timeout=20000)
    check("file")
    # the sheet is a bottom sheet on a phone and scrolls inside itself
    box = page.evaluate("() => { const r = document.querySelector('#syncSheet .sheet').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; }")
    assert box["bottom"] >= box["h"] - 1 and box["top"] > 20
    assert page.evaluate("() => { const b = document.querySelector('#syncSheet .sh-body'); return b.scrollHeight > b.clientHeight; }")


def test_the_menu_row_and_the_menu_button_show_the_state(device, github) -> None:
    s = device()
    assert s.page.inner_text("#mnSyncSt") == "Off"
    assert s.page.evaluate("() => document.getElementById('menuBtn').dataset.sync ?? null") is None, "no dot while sync is off"
    connect(s)
    assert s.page.evaluate("() => document.getElementById('menuBtn').dataset.sync") == "ok"
    assert re.match(r"Synced (just now|\d+ min ago)", s.page.inner_text("#mnSyncSt")), s.page.inner_text("#mnSyncSt")
    github.down = True
    set_pick(s, HOME, saved=True)
    wait_status(s, "st.phase === 'offline'")
    assert s.page.evaluate("() => document.getElementById('menuBtn').dataset.sync") == "warn"
    github.down = False
    s.page.keyboard.press("Escape")
    wait_status(s, "st.phase === 'synced' && !st.pending", 20000)


def test_the_palette_can_open_sync_and_run_it(device, github) -> None:
    s = device()
    s.page.keyboard.press("Control+k")
    s.page.fill("#plQ", "sync across")
    s.page.locator("#plList [role=option]", has_text="Sync across devices").click()
    s.page.wait_for_selector("#syncSheet.on", timeout=10000)
    s.page.keyboard.press("Escape")
    s.page.wait_for_function("() => document.querySelector('#syncSheet')?.hidden === true", timeout=5000)


# ------------------------------------------------------------------ keys that features keep a copy of in memory
def test_the_move_plan_and_whats_new_sync_and_the_pages_copy_is_read_again(device, github) -> None:
    mac, phone = device(), device()
    connect(mac)
    connect(phone)
    plan = {"v": 1, "chosen": HOME, "homes": {HOME: {"start": "2026-12-01", "movers": 1100, "done": {"apply": "2026-10-15"}, "dates": {}, "custom": [], "updated": "2026-10-15"}}}
    mac.page.evaluate("""async ([plan, name]) => { const { store } = await import('/js/app.js'); store.set('moveplan:' + name, plan); store.set('whatsnew:seen:' + name, 'digest-7'); store.set('whatsnew:notify:' + name, true); }""", [plan, SEARCH])
    wait_status(mac, "st.phase === 'synced' && !st.pending")
    sync_now(phone)
    # the planner's own copy in the page was refreshed: its next save would not write a stale plan over the merge
    got = phone.page.evaluate("async (id) => { const m = await import('/js/features/move.js'); return m.savedPlan().homes[id]; }", HOME)
    assert got["start"] == "2026-12-01" and got["done"] == {"apply": "2026-10-15"} and got["movers"] == 1100
    assert phone.page.evaluate("async () => (await import('/js/features/whatsnew.js')).state().seenId") == "digest-7"
    assert phone.page.evaluate("async (n) => (await import('/js/app.js')).store.get('whatsnew:notify:' + n, null)", SEARCH) is None, "a device's own notification choice is not synced"
    # two devices tick different steps of the same home: both ticks survive on both
    both = {"v": 1, "chosen": HOME, "homes": {HOME: {**plan["homes"][HOME]}}}
    mac.page.evaluate("async ([p, n]) => (await import('/js/app.js')).store.set('moveplan:' + n, p)", [{**both, "homes": {HOME: {**both["homes"][HOME], "done": {"apply": "2026-10-15", "sign": "2026-10-20"}}}}, SEARCH])
    phone.page.evaluate("async ([p, n]) => (await import('/js/app.js')).store.set('moveplan:' + n, p)", [{**both, "homes": {HOME: {**both["homes"][HOME], "done": {"apply": "2026-10-15", "book": "2026-10-22"}}}}, SEARCH])
    wait_status(mac, "st.phase === 'synced' && !st.pending")
    wait_status(phone, "st.phase === 'synced' && !st.pending")
    sync_now(mac)
    sync_now(phone)
    sync_now(mac)
    for s in (mac, phone):
        done = s.page.evaluate("async (id) => (await import('/js/features/move.js')).savedPlan().homes[id].done", HOME)
        assert done == {"apply": "2026-10-15", "sign": "2026-10-20", "book": "2026-10-22"}


def test_a_sync_file_carries_the_move_plan_and_old_readers_find_it(device, tmp_path) -> None:
    a, b = device(), device()
    plan = {"v": 1, "chosen": HOME, "homes": {HOME: {"start": "2026-12-01", "done": {}, "dates": {}, "custom": [], "updated": "2026-10-15"}}}
    a.page.evaluate("async ([plan, n]) => (await import('/js/app.js')).store.set('moveplan:' + n, plan)", [plan, SEARCH])
    path = export_file(a, tmp_path)
    doc = json.loads(path.read_text())
    assert doc["moveplan"]["homes"][HOME]["start"] == "2026-12-01", "the version-1 field a backup has always had"
    import_file(b, path)
    assert b.page.evaluate("async (id) => (await import('/js/features/move.js')).savedPlan().homes[id]?.start", HOME) == "2026-12-01"
