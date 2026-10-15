"""Browser fixtures for the dashboard end-to-end suite (tests/e2e).

The suite runs when Playwright and its Chromium are installed, or always with APARTMENTSCOUT_E2E=1 (then a missing
browser is an error, not a skip). APARTMENTSCOUT_E2E=0 turns it off. It serves dashboard/ (and the example's
saved photos under /media/) with a threaded static server on a free port, and blocks every request that is not for
that server, so map tiles, remote photos and any CDN fail the same way in CI as on a plane (the map shows its offline
basemap).

The photos are the starter set that ships with the repository (examples/nyc-2026/media-lite, also reachable as /media-lite/), the
same on every machine, so a test sees what a fresh clone sees: a full gallery for the top-ranked listings and one or two photos
for the rest. APARTMENTSCOUT_E2E_MEDIA=full answers /media/ from the full set (examples/nyc-2026/media) first, when it is on disk.

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e -q

APARTMENTSCOUT_E2E_CPU_THROTTLE=<n> slows every page's JavaScript n times (Chromium's CPU throttling), to reproduce a
slow CI runner locally; 6 is about a GitHub-hosted runner.

Parallel runs (pytest-xdist): `pytest -m e2e tests/e2e -n auto --dist loadgroup`. Every worker is its own process and so has its own
session fixtures: one Playwright, one Chromium, one static server on a free port (`("127.0.0.1", 0)`), its own temp folders
(`tmp_path_factory` is per worker) and its own browser contexts (service workers, storage and caches are per context). Nothing in
the suite uses a fixed port, a shared temp folder or an environment variable another test sets. The one thing a process may
start is ONE sync Playwright (a second one in the same process fails inside the first one's event loop), so a test file never
starts its own: it uses the session `browser` below. Test files whose module-scoped fixtures are costly to build (a built site,
a temp search) are kept on one worker with an `xdist_group` mark added in `pytest_collection_modifyitems`.
"""
from __future__ import annotations

import http.server
import os
import sys
import threading
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import pytest

ROOT = Path(__file__).resolve().parents[2]
MODE = os.environ.get("APARTMENTSCOUT_E2E", "")
CI = bool(os.environ.get("CI"))
THROTTLE = float(os.environ.get("APARTMENTSCOUT_E2E_CPU_THROTTLE") or 1)
# a real GPU on a Mac; SwiftShader elsewhere (CI), where WebGL may be missing or drop layers
GPU_ARGS = (["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] if sys.platform == "darwin" and not CI
            else ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])


def _skip_or_fail(reason: str) -> None:
    if MODE == "1":
        pytest.fail(reason, pytrace=False)
    pytest.skip(reason)


def media_roots() -> list[Path]:
    """Where /media/ is answered from: the full set first when asked for and present, then the starter set."""
    ex = ROOT / "examples" / "nyc-2026"
    full = [(ex / "media").resolve()] if os.environ.get("APARTMENTSCOUT_E2E_MEDIA") == "full" and (ex / "media").is_dir() else []
    return [*full, (ex / "media-lite").resolve()]


def serve(dashboard: Path, media: list[Path] | Path) -> http.server.ThreadingHTTPServer:
    """dashboard/ on a free port, with /media/ mapped to the example's saved photos like `apartmentscout serve`: each folder
    in turn (media/, then media-lite/); /media-lite/ is the starter set itself (the last folder)."""
    roots = [media] if isinstance(media, Path) else list(media)
    lite = roots[-1]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw) -> None:
            super().__init__(*a, directory=str(dashboard), **kw)

        def translate_path(self, path: str) -> str:
            clean = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
            for prefix, folders in (("/media/", roots), ("/media-lite/", [lite])):
                if clean.startswith(prefix):
                    for root in folders:
                        target = (root / clean[len(prefix):]).resolve()
                        if root in target.parents and target.is_file():
                            return str(target)
                    return str(folders[0] / "__missing__")
            return super().translate_path(path)

        def log_message(self, *a) -> None:
            pass

    http.server.ThreadingHTTPServer.request_queue_size = 128
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


@pytest.fixture(scope="session")
def base_url() -> Iterator[str]:
    # [perf] APARTMENTSCOUT_E2E_DASHBOARD=<folder> runs the suite against a built copy (scripts/build_site.sh output: _site/demo)
    httpd = serve(Path(os.environ.get("APARTMENTSCOUT_E2E_DASHBOARD") or ROOT / "dashboard"), media_roots())
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


@pytest.fixture(scope="session")
def browser(base_url: str):
    if MODE == "0":
        pytest.skip("APARTMENTSCOUT_E2E=0")
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        _skip_or_fail("playwright is not installed (pip install -e '.[dev]')")
    pw = sync_playwright().start()
    try:
        b = pw.chromium.launch(args=GPU_ARGS)
    except Error as e:
        pw.stop()
        _skip_or_fail(f"Chromium is not installed for Playwright (playwright install chromium): {str(e)[:200]}")
    yield b
    b.close()
    pw.stop()


@dataclass
class Session:
    """One page plus everything it reported: uncaught errors and console errors that are not allowed failures."""
    page: object
    origin: str
    errors: list[str] = field(default_factory=list)
    allowed: list[str] = field(default_factory=list)

    def take(self) -> list[str]:
        out, self.errors[:] = list(self.errors), []
        return out


def allowed_console(msg_text: str, url: str, origin: str) -> bool:
    """External tile, photo and font fetches fail on purpose (the network is blocked); nothing local may fail."""
    external = bool(url) and not url.startswith((origin, "data:", "blob:"))
    if msg_text.startswith("Failed to load resource") and external:
        return True
    # a saved listing photo that is not in the starter set (or the full set, if it is on disk): the photo chain goes on to the
    # published copy and the original link (both blocked above); each step is a 404 on /media/ or /media-lite/
    if msg_text.startswith("Failed to load resource") and "404" in msg_text and url.startswith((origin + "/media/", origin + "/media-lite/")):
        return True
    # MapLibre/three report blocked tile, glyph and texture fetches with the URL in the message
    return "Failed to fetch" in msg_text and external


def build_url(base: str, path: str, theme: str = "dark") -> str:
    """'?open=x#map' + light -> base/?open=x&theme=light#map"""
    q, _, h = path.partition("#")
    params = [p for p in q.lstrip("?").split("&") if p] + (["theme=light"] if theme == "light" else [])
    return f"{base}/{'?' + '&'.join(params) if params else ''}#{h}"


def block_foreign(ctx, *allowed: str) -> None:
    """Abort every request that is not for one of the `allowed` URL prefixes (data: and blob: always are).

    Only the requests to be blocked go through the route handler; the local ones are never intercepted. A handler that said
    `continue_()` for each of them needed this Python process to answer every request of the page, so a test that was busy in
    Python (reading a file, polling a folder) stalled the page it was waiting for, and each page load paid one round trip per file."""
    import re
    prefixes = [*allowed, "data:", "blob:"]
    ctx.route(re.compile(r"^(?!(?:" + "|".join(re.escape(p) for p in prefixes) + "))"), lambda r: r.abort())


@pytest.fixture
def open_page(browser, base_url: str):
    """open_page(path, theme='dark', width=1440, height=900) -> Session, with the network outside base_url blocked."""
    contexts = []

    def _open(path: str = "#map", theme: str = "dark", width: int = 1440, height: int = 900) -> Session:
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme,
                                  device_scale_factor=1, reduced_motion="reduce",
                                  service_workers="block")   # [pwa] only tests/e2e/test_pwa.py runs with the service worker
        contexts.append(ctx)
        block_foreign(ctx, base_url)
        page = ctx.new_page()
        if THROTTLE > 1:
            ctx.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
        s = Session(page, base_url)
        page.on("pageerror", lambda e: s.errors.append(f"pageerror: {e}"))

        def on_console(m) -> None:
            if m.type != "error":
                return
            url = (m.location or {}).get("url", "")
            (s.allowed if allowed_console(m.text, url, base_url) else s.errors).append(f"console: {m.text[:300]} [{url}]")
        page.on("console", on_console)
        page.goto(build_url(base_url, path, theme))
        page.wait_for_function("() => document.querySelector('#cards .card, .view:not([hidden]) > *')", timeout=20000)
        return s

    yield _open
    for c in contexts:
        c.close()


@pytest.fixture(scope="session")
def webgl(browser) -> bool:
    """True when this browser can make a WebGL context (SwiftShader in CI may not)."""
    ctx = browser.new_context()
    p = ctx.new_page()
    ok = p.evaluate("() => !!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl')")
    ctx.close()
    return ok


# ------------------------------------------------------------------ waiting on a condition instead of a fixed sleep
# Resolves once timers fire on time `ticks` times running (a tick is 50 ms; 8 is about half a second of an idle main thread).
# Opening a view that builds a WebGL scene (the map, Unit 3D, the floor plan studio) blocks the page's one thread for seconds,
# many times longer with software GL on a two-core CI runner; an action started in the meantime waits behind it, so a test that
# clicks on without waiting piles those blocks up until one of its own timeouts fires. The cap only stops a page that never
# idles (an endless busy loop) from hanging the run.
SETTLED_JS = """([capMs, ticks]) => new Promise((resolve) => {
  const t0 = performance.now(); let quiet = 0, last = t0;
  const iv = setInterval(() => {
    const now = performance.now(); quiet = now - last < 130 ? quiet + 1 : 0; last = now;
    if (quiet >= ticks || now - t0 > capMs) { clearInterval(iv); resolve(quiet >= ticks); }
  }, 50);
})"""


def settled(page, cap_ms: int = 120_000, ticks: int = 8) -> bool:
    """Wait until the page's main thread is idle again (see SETTLED_JS); False when it never was within the cap."""
    return page.evaluate(SETTLED_JS, [cap_ms, ticks])


# Playwright's wait_for_function does NOT await a promise: `async () => (await import('/js/app.js')).S.sel === id` is a Promise, which is
# truthy, so the wait returned at once and the test went on racing the page. This runs such a predicate to completion instead.
ASYNC_UNTIL_JS = """async ([src, arg, timeoutMs]) => {
  const pred = (0, eval)('(' + src + ')'), t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try { if (await pred(arg)) return true; } catch (e) { /* the module or the state is not there yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}"""


def until(page, predicate_js: str, arg=None, timeout_ms: float = 30000) -> None:
    """Wait for a (possibly async) JS predicate to hold; raises AssertionError on timeout, like a failed assertion."""
    if not page.evaluate(ASYNC_UNTIL_JS, [predicate_js, arg, timeout_ms]):
        raise AssertionError(f"timed out after {timeout_ms:g} ms waiting for: {predicate_js.strip()[:240]}")


def _await_async_predicates() -> None:
    """Make Page.wait_for_function await an `async` predicate (see ASYNC_UNTIL_JS) for every test in the suite."""
    try:
        from playwright.sync_api import Page
    except ImportError:
        return
    original = Page.wait_for_function
    if getattr(original, "_awaits_async", False):
        return

    def wait_for_function(self, expression, *, arg=None, timeout=None, polling=None):
        if isinstance(expression, str) and expression.lstrip().startswith("async"):
            return until(self, expression, arg, 30000 if timeout is None else timeout)
        return original(self, expression, arg=arg, timeout=timeout, polling=polling)
    wait_for_function._awaits_async = True
    wait_for_function.__doc__ = original.__doc__
    Page.wait_for_function = wait_for_function


_await_async_predicates()


def frames(page, n: int = 3) -> None:
    """Wait for n animation frames: what a handler scheduled with requestAnimationFrame (the windowed card list after a scroll or a resize) has run."""
    page.evaluate("(n) => new Promise((resolve) => { const step = () => (--n > 0 ? requestAnimationFrame(step) : resolve()); requestAnimationFrame(step); })", n)


def poll(fn, page, timeout: float = 10.0, interval_ms: int = 50):
    """Call fn() until it returns something truthy or `timeout` seconds pass; returns the last value (the caller asserts on it).
    For conditions that live outside the page (a file the local API writes) where a fixed sleep would stand in for them. The
    wait between tries is `page.wait_for_timeout`, not time.sleep: Playwright's sync API only serves the page's route handlers,
    events and downloads while the test is inside one of its calls."""
    import time
    end = time.monotonic() + timeout
    while True:
        try:
            v = fn()
        except (OSError, ValueError, KeyError, IndexError):   # the file is not there yet, or half written
            v = None
        if v or time.monotonic() >= end:
            return v
        page.wait_for_timeout(interval_ms)


def map_opened(page, timeout_ms: int = 15000) -> None:
    """Wait until the map module has finished opening (the style and sources are loaded), then until the page is quiet.
    Without WebGL the map never reports loaded, so the wait gives up after `timeout_ms` and the caller goes on."""
    from playwright.sync_api import TimeoutError as PlaywrightTimeout
    try:
        page.wait_for_function("() => !!window.__asMap && window.__asMap.loaded()", timeout=timeout_ms)
    except PlaywrightTimeout:
        pass
    settled(page, 20000, ticks=4)


# ------------------------------------------------------------------ parallel runs
# Test files whose module-scoped fixtures are costly (a site built with esbuild, a temp search built with the CLI, a second static
# server): under `--dist loadgroup` each stays on ONE worker, so the fixture is built once instead of once per worker that gets
# one of its tests. Every other test is its own unit of work and goes to whichever worker is free.
XDIST_GROUPED = {"test_pwa", "test_landing_page", "test_places_multidest", "test_tour_findings", "test_media_tiers"}


def pytest_collection_modifyitems(items) -> None:
    for item in items:
        mod = item.module.__name__.rsplit(".", 1)[-1]
        if mod in XDIST_GROUPED and not item.get_closest_marker("xdist_group"):
            item.add_marker(pytest.mark.xdist_group(name=mod))
