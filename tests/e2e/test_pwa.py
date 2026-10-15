"""The installable app: manifest and icons, the service worker under a project-Pages sub-path, offline use, the update
prompt, the photo cache cap, and the places where it must stay out of the way (the standalone file, a source copy).

The site is built the way .github/workflows/pages.yml publishes it (scripts/optimize_site.py: bundles, precache list, stamped
worker) and served from /ApartmentScout/demo/, like https://<user>.github.io/ApartmentScout/demo/, so scope and path bugs
show up here. Needs Node for esbuild (npx, or ESBUILD=/path/to/esbuild).

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_pwa.py -q
"""
from __future__ import annotations

import http.server
import importlib.util
import json
import os
import re
import shutil
import struct
import sys
import threading
import urllib.parse
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e
ROOT = Path(__file__).resolve().parents[2]
MODE = os.environ.get("APARTMENTSCOUT_E2E", "")
# the same flags tests/e2e/conftest.py uses: a real GPU on a Mac, SwiftShader elsewhere
GPU_ARGS = (["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] if sys.platform == "darwin" and not os.environ.get("CI")
            else ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
PREFIX = "/ApartmentScout/demo/"
DASH = ROOT / "dashboard"


def _need(reason: str) -> None:
    if MODE == "1":
        pytest.fail(reason, pytrace=False)
    pytest.skip(reason)


def _optimizer():
    spec = importlib.util.spec_from_file_location("optimize_site", ROOT / "scripts" / "optimize_site.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["optimize_site"] = mod
    spec.loader.exec_module(mod)
    return mod


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name} is not a PNG"
    return struct.unpack(">II", data[16:24])


class Server(http.server.ThreadingHTTPServer):
    """Static files from `root`, never cached, so a test can rewrite sw.js and see the change at once."""
    request_queue_size = 128

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        server = self

        class H(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw) -> None:
                super().__init__(*a, directory=str(server.root), **kw)

            def log_message(self, *a) -> None:
                pass

            def end_headers(self) -> None:
                self.send_header("Cache-Control", "no-store")
                super().end_headers()
        super().__init__(("127.0.0.1", 0), H)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


@pytest.fixture(scope="module")
def site(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A built copy of the dashboard at <tmp>/ApartmentScout/demo, with a few fake photos under media/."""
    if not (os.environ.get("ESBUILD") or shutil.which("npx")):
        _need("Node (npx esbuild) is needed to build the optimised site")
    root = tmp_path_factory.mktemp("pages")
    demo = root / "ApartmentScout" / "demo"
    shutil.copytree(DASH, demo, ignore=shutil.ignore_patterns("media", "dist", "data-private", "_mockup"))
    _optimizer().optimize(demo)
    photos = demo / "media" / "test"
    photos.mkdir(parents=True)
    for i in range(6):   # 100 KB each; the worker caches by URL and size, so the bytes need not be a real image
        (photos / f"p-{i}.webp").write_bytes(bytes([i + 1]) * 100_000)
    return root


@pytest.fixture(scope="module")
def server(site: Path):
    srv = Server(site)
    yield srv
    srv.shutdown()


@pytest.fixture(scope="module")
def browser(server):
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        _need("playwright is not installed")
    pw = sync_playwright().start()
    try:
        b = pw.chromium.launch(args=GPU_ARGS)
    except Error as e:
        pw.stop()
        _need(f"Chromium is not installed for Playwright: {str(e)[:160]}")
    yield b
    b.close()
    pw.stop()


@pytest.fixture
def open_app(browser, server):
    """open_app(query='') -> (page, errors); a context that ALLOWS service workers and blocks every other origin."""
    ctxs = []

    def _open(query: str = "", hash_: str = "#map", width: int = 1280, height: int = 860):
        ctx = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
        ctxs.append(ctx)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((server.origin, "data:", "blob:")) else r.abort())
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.goto(f"{server.origin}{PREFIX}{query}{hash_}")
        page.wait_for_selector("#cards .card", timeout=30000)
        return page, errors

    yield _open
    for c in ctxs:
        c.close()


STATUS_JS = """async () => {
  const reg = await navigator.serviceWorker.ready;
  return await new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data); reg.active.postMessage({ type: 'STATUS' }, [ch.port2]); });
}"""
CONTROLLED_JS = "() => navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null"


def settle(page) -> dict:
    """Wait for the worker to be active and in control of the page; returns its status."""
    page.evaluate("async () => { await navigator.serviceWorker.ready; }")
    page.wait_for_function(CONTROLLED_JS, timeout=20000)
    return page.evaluate(STATUS_JS)


# ------------------------------------------------------------------ manifest, icons, head tags
def test_manifest_icons_and_head_tags(site: Path) -> None:
    demo = site / "ApartmentScout" / "demo"
    html = (demo / "index.html").read_text()
    assert '<link rel="manifest" href="manifest.webmanifest">' in html
    assert re.search(r'<meta name="theme-color" content="#[0-9a-f]{6}">', html)
    assert 'rel="apple-touch-icon" href="assets/pwa/apple-touch-icon.png"' in html
    assert re.search(r'<meta name="as-build" content="[0-9a-f]{12}">', html), "the built page carries the build marker that turns the worker on"
    m = json.loads((demo / "manifest.webmanifest").read_text())
    assert m["name"] == "ApartmentScout" and m["display"] == "standalone"
    assert m["start_url"] == "./" and m["scope"] == "./", "relative, so /demo/ under any Pages sub-path works"
    assert re.fullmatch(r"#[0-9a-f]{6}", m["theme_color"]) and re.fullmatch(r"#[0-9a-f]{6}", m["background_color"])
    by = {(i["purpose"], i["sizes"]): i for i in m["icons"]}
    for purpose in ("any", "maskable"):
        for size in ("192x192", "512x512"):
            icon = by[(purpose, size)]
            w, h = (int(x) for x in size.split("x"))
            assert png_size(demo / icon["src"]) == (w, h), icon["src"]
    assert (demo / "assets" / "pwa" / "apple-touch-icon.png").is_file() and png_size(demo / "assets" / "pwa" / "apple-touch-icon.png") == (180, 180)
    assert (demo / "assets" / "pwa" / "favicon.ico").is_file()
    assert all(s["url"].startswith(("./#", "./?")) for s in m["shortcuts"]), "relative to the scope, whatever the Pages sub-path"
    assert any(s["name"] == "Tour day" and s["url"] == "./?tourday=1" for s in m["shortcuts"])


def test_precache_list_names_only_files_that_exist(site: Path) -> None:
    demo = site / "ApartmentScout" / "demo"
    pre = json.loads((demo / "precache.json").read_text())
    sw = (demo / "sw.js").read_text()
    assert f"'{pre['build']}'" in sw and "__AS_BUILD__" not in sw
    for u in [*pre["shell"], *pre["later"], *pre["data"]]:
        assert u == "./" or (demo / u).is_file(), u
    assert any(u.startswith("dist/app-") for u in pre["shell"]) and "data/listings.json" in pre["data"]
    assert not any(u.startswith(("js/", "media/")) for u in pre["shell"]), "the source tree and photos are not precached"


# ------------------------------------------------------------------ install
def test_the_page_is_installable_under_a_sub_path(open_app, server) -> None:
    page, errors = open_app()
    cdp = page.context.new_cdp_session(page)
    errs = cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]
    assert errs == [], errs
    man = cdp.send("Page.getAppManifest")
    assert not man.get("errors"), man.get("errors")
    assert man["url"] == f"{server.origin}{PREFIX}manifest.webmanifest"
    assert json.loads(man["data"])["scope"] == "./"
    assert errors == []


def test_the_worker_registers_with_the_page_scope_and_takes_control(open_app, server) -> None:
    page, errors = open_app()
    settle(page)
    info = page.evaluate("async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r.scope, script: r.active.scriptURL, via: r.updateViaCache }; }")
    assert info["scope"] == f"{server.origin}{PREFIX}" and info["script"] == f"{server.origin}{PREFIX}sw.js"
    assert info["via"] == "none"
    st = page.evaluate(STATUS_JS)
    assert st["built"] is True and st["shell"] > 20
    names = page.evaluate("async () => (await caches.keys())")
    assert f"as-shell-{st['build']}" in names
    assert errors == []


# ------------------------------------------------------------------ offline
def test_the_app_opens_and_works_offline_after_one_visit(open_app, server) -> None:
    page, errors = open_app()
    settle(page)
    n_online = page.locator("#cards .card").count()
    assert n_online > 0
    page.reload()                                    # now controlled: this load is served by the worker
    page.wait_for_selector("#cards .card", timeout=30000)
    page.context.set_offline(True)
    try:
        page.reload()
        page.wait_for_selector("#cards .card", timeout=30000)
        assert page.locator("#cards .card").count() > 0
        assert page.locator("#kpis .kpi").count() > 3, "the stats strip rendered from the cached data"
        # a view that was never opened online loads from the cached chunks, and the theme query on the page URL still works
        page.goto(f"{server.origin}{PREFIX}?theme=light#compare")
        page.wait_for_selector("#view-compare:not([hidden]) > *", timeout=20000)
        assert page.evaluate("() => document.documentElement.dataset.theme") == "light"
        page.goto(f"{server.origin}{PREFIX}#research")
        page.wait_for_selector("#view-research:not([hidden]) > *", timeout=20000)
    finally:
        page.context.set_offline(False)
    assert errors == [], errors


def test_tour_day_opens_offline_from_the_installed_copy_and_keeps_what_is_answered(open_app, server) -> None:
    page, errors = open_app()
    settle(page)
    ids =page.evaluate("() => [...document.querySelectorAll('#cards .card')].slice(0, 2).map((c) => c.dataset.id)")
    day = page.evaluate("() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }")
    page.evaluate("([a, b, day]) => localStorage.setItem('as:picks', JSON.stringify({ [a]: { saved: true, tour: day + 'T10:00' }, [b]: { saved: true, tour: day + 'T11:30' } }))", [ids[0], ids[1], day])
    page.reload()                                    # controlled now: the page, its scripts and the lazy Tour day chunk are all in the build's cache
    page.wait_for_selector("#tourDayBtn", timeout=30000)
    page.wait_for_timeout(1500)
    page.context.set_offline(True)
    try:
        page.reload()
        page.wait_for_selector("#tourDayBtn", timeout=30000)
        page.click("#tourDayBtn")
        page.wait_for_selector("#tourDay.on", timeout=30000)
        assert page.locator("#tourDay .tday-stop").count() == 2
        assert "Offline" in page.locator("#tourDay .tday-status").inner_text() or "this phone" in page.locator("#tourDay .tday-status").inner_text()
        page.locator(f"#tourDay [data-open='{ids[0]}']").click()
        page.locator(f"#tourDay [data-ans='water'][data-v='4']").click()
        page.locator("#tourDay textarea[data-note]").fill("noted offline")
        page.wait_for_function("(id) => { const s = Object.keys(localStorage).find((k) => k.startsWith('as:findings:')); const r = s && JSON.parse(localStorage.getItem(s))[id]; return r && r.water === 4 && r.note === 'noted offline'; }", arg=ids[0], timeout=10000)
    finally:
        page.context.set_offline(False)
    assert errors == [], errors


def test_a_page_outside_the_cached_shell_is_not_served_the_dashboard(open_app, server) -> None:
    page, _ = open_app()
    settle(page)
    page.goto(f"{server.origin}{PREFIX}studios.html")
    assert "Research & modeling studios" in page.locator("h1").inner_text()
    assert page.locator("#cards").count() == 0


# ------------------------------------------------------------------ update prompt
def test_a_new_deploy_shows_the_update_prompt_and_reload_switches_version(open_app, site: Path, server) -> None:
    demo = site / "ApartmentScout" / "demo"
    old = json.loads((demo / "precache.json").read_text())["build"]
    page, errors = open_app()
    st = settle(page)
    assert st["build"] == old
    assert page.locator("#pwaUpdate").count() == 0
    sw_before, pre_before = (demo / "sw.js").read_text(), (demo / "precache.json").read_text()
    new = "feedface0001"
    try:
        (demo / "sw.js").write_text(sw_before.replace(f"'{old}'", f"'{new}'"))
        (demo / "precache.json").write_text(pre_before.replace(old, new))
        page.evaluate("async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); }")
        page.wait_for_selector("#pwaUpdate", timeout=20000)
        assert "new version" in page.locator("#pwaUpdate").inner_text().lower()
        assert page.evaluate(STATUS_JS)["build"] == old, "the page keeps running the old version until the renter says so"
        # Later dismisses it without switching
        page.locator("#pwaUpdate [data-pwa=later]").click()
        assert page.locator("#pwaUpdate").count() == 0
        # the worker is still waiting, so the next visit offers it again
        page.reload()
        page.wait_for_selector("#pwaUpdate", timeout=20000)
        page.evaluate("() => { window.__marker = 1; }")
        page.locator("#pwaUpdate [data-pwa=reload]").click()
        page.wait_for_function("() => window.__marker === undefined", timeout=30000)   # a new document: the page reloaded itself
        page.wait_for_selector("#cards .card", timeout=30000)
        st2 = settle(page)
        assert st2["build"] == new
        names = page.evaluate("async () => (await caches.keys())")
        assert f"as-shell-{new}" in names and f"as-shell-{old}" not in names, names
        assert errors == [], errors
    finally:
        (demo / "sw.js").write_text(sw_before)
        (demo / "precache.json").write_text(pre_before)


# ------------------------------------------------------------------ photos
def test_saved_photos_are_cached_on_demand_and_capped(open_app, server) -> None:
    page, _ = open_app()
    settle(page)
    page.evaluate("async () => { const r = await navigator.serviceWorker.ready; r.active.postMessage({ type: 'SET_PHOTO_CAP', bytes: 250000 }); }")
    page.reload()                                    # controlled load
    page.wait_for_selector("#cards .card", timeout=30000)
    urls = [f"{PREFIX}media/test/p-{i}.webp" for i in range(6)]
    for u in urls:
        assert page.evaluate("async (u) => (await fetch(u)).status", u) == 200
    st = page.evaluate(STATUS_JS)
    assert st["photoCount"] <= 2 and st["photoBytes"] <= 250000, st
    assert st["photoCount"] >= 1
    page.context.set_offline(True)
    try:
        assert page.evaluate("async (u) => (await fetch(u)).status", urls[-1]) == 200, "the newest photo is still cached"
        assert page.evaluate("async (u) => { try { return (await fetch(u)).status; } catch { return 'offline'; } }", urls[0]) == "offline", "the oldest was evicted"
    finally:
        page.context.set_offline(False)


# ------------------------------------------------------------------ where it must stay out of the way
def test_a_source_copy_of_the_dashboard_never_registers_a_worker(browser, base_url) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})   # service workers allowed (the default)
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base_url}/#map")
    page.wait_for_selector("#cards .card", timeout=30000)
    page.wait_for_timeout(6000)                      # pwa.js warms and registers (if it were going to) after about 4 s
    assert page.evaluate("async () => (await navigator.serviceWorker.getRegistrations()).length") == 0
    assert page.evaluate("() => document.querySelectorAll('meta[name=as-build]').length") == 0
    assert errors == []
    ctx.close()


def test_the_standalone_file_opens_from_file_with_no_manifest_and_no_worker(browser, tmp_path: Path) -> None:
    from apartmentscout.cli import standalone
    out = standalone(DASH / "data", tmp_path / "one.html")
    html = out.read_text()
    assert '<link rel="manifest"' not in html and 'href="assets/pwa/' not in html and '<meta name="as-build"' not in html
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"console: {m.text[:200]}") if m.type == "error" and not re.search(r"Failed to load resource|net::ERR|tiles\.|Failed to fetch", m.text) else None)
    page.goto(out.as_uri())
    page.wait_for_selector("#cards .card", timeout=60000)
    page.wait_for_timeout(5000)
    assert page.evaluate("() => 'serviceWorker' in navigator ? navigator.serviceWorker.controller === null : true")
    assert page.evaluate("() => document.querySelectorAll('link[rel=manifest]').length") == 0
    assert errors == [], errors
    ctx.close()
