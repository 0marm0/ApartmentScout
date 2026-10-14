"""Browser fixtures for the dashboard end-to-end suite (tests/e2e).

The suite runs when Playwright and its Chromium are installed, or always with APARTMENTSCOUT_E2E=1 (then a missing
browser is an error, not a skip). APARTMENTSCOUT_E2E=0 turns it off. It serves dashboard/ (and the example's
saved photos under /media/) with a threaded static server on a free port, and blocks every request that is not for
that server, so map tiles, remote photos and any CDN fail the same way in CI as on a plane (the map shows its offline
basemap).

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e -q

APARTMENTSCOUT_E2E_CPU_THROTTLE=<n> slows every page's JavaScript n times (Chromium's CPU throttling), to reproduce a
slow CI runner locally; 6 is about a GitHub-hosted runner.
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


def serve(dashboard: Path, media: Path) -> http.server.ThreadingHTTPServer:
    """dashboard/ on a free port, with /media/ mapped to the example's saved photos like `apartmentscout serve`."""
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw) -> None:
            super().__init__(*a, directory=str(dashboard), **kw)

        def translate_path(self, path: str) -> str:
            clean = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
            if clean.startswith("/media/"):
                target = (media / clean[len("/media/"):]).resolve()
                return str(target if media in target.parents else media / "__forbidden__")
            return super().translate_path(path)

        def log_message(self, *a) -> None:
            pass

    http.server.ThreadingHTTPServer.request_queue_size = 128
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


@pytest.fixture(scope="session")
def base_url() -> Iterator[str]:
    httpd = serve(ROOT / "dashboard", (ROOT / "examples" / "nyc-2026" / "media").resolve())
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
    # a saved listing photo that is not in this checkout: the card falls back to the photo link (blocked above)
    if msg_text.startswith("Failed to load resource") and "404" in msg_text and url.startswith(origin + "/media/"):
        return True
    # MapLibre/three report blocked tile, glyph and texture fetches with the URL in the message
    return "Failed to fetch" in msg_text and external


def build_url(base: str, path: str, theme: str = "dark") -> str:
    """'?open=x#map' + light -> base/?open=x&theme=light#map"""
    q, _, h = path.partition("#")
    params = [p for p in q.lstrip("?").split("&") if p] + (["theme=light"] if theme == "light" else [])
    return f"{base}/{'?' + '&'.join(params) if params else ''}#{h}"


@pytest.fixture
def open_page(browser, base_url: str):
    """open_page(path, theme='dark', width=1440, height=900) -> Session, with the network outside base_url blocked."""
    contexts = []

    def _open(path: str = "#map", theme: str = "dark", width: int = 1440, height: int = 900) -> Session:
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme,
                                  device_scale_factor=1, reduced_motion="reduce")
        contexts.append(ctx)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
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
