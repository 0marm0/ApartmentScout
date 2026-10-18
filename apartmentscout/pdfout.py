"""Headless-browser helpers for `apartmentscout report`: a PDF of the report page and the 3D views from the windows.

Both use a browser that is already on the machine and nothing else is installed or downloaded: Playwright's Chromium when the
``playwright`` package and its browser are there, else a system Chrome, Chromium or Edge for the PDF alone (the 3D stills need a page
that runs the dashboard, which only Playwright drives here). Every function reports why it could not run by raising
:class:`BrowserUnavailable`; the command then keeps the HTML, which prints to PDF from any browser.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

READY_JS = "document.body && document.body.dataset.ready === '1'"
GPU_ARGS = (["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] if sys.platform == "darwin"
            else ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
                  "--disable-gpu-rasterization"])   # tiles and 2D canvases on the CPU: SwiftShader raster kept the GPU process busy for minutes (tests/e2e/conftest.py)
SYSTEM_BROWSERS = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge",
)


class BrowserUnavailable(RuntimeError):
    """No headless browser could be used; the message says what to install or what was tried."""


def _playwright():
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError as e:
        raise BrowserUnavailable("the playwright package is not installed (pip install playwright, then playwright install chromium)") from e
    return sync_playwright, Error


def system_browser() -> str | None:
    """A Chrome, Chromium or Edge executable on this machine, or None."""
    for c in SYSTEM_BROWSERS:
        found = c if Path(c).is_file() else shutil.which(c)
        if found:
            return found
    return None


def playwright_ready() -> bool:
    """True when Playwright and its Chromium can start (a quick launch and close)."""
    try:
        sync_playwright, _ = _playwright()
        with sync_playwright() as p:
            p.chromium.launch().close()
        return True
    except Exception:   # noqa: BLE001 - any failure means "not usable"
        return False


def html_to_pdf(html: Path, pdf: Path, *, timeout_s: float = 90) -> str:
    """Print ``html`` to ``pdf`` with the page's own paper size (``@page``) and backgrounds. Returns the engine used."""
    html, pdf = Path(html).resolve(), Path(pdf)
    pdf.parent.mkdir(parents=True, exist_ok=True)
    try:
        sync_playwright, Error = _playwright()
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch()
            except Error as e:
                raise BrowserUnavailable(f"Playwright's Chromium is not installed (playwright install chromium): {str(e)[:160]}") from e
            try:
                page = browser.new_page()
                page.goto(html.as_uri())
                page.wait_for_function(READY_JS, timeout=timeout_s * 1000)
                page.emulate_media(media="print")
                page.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
            finally:
                browser.close()
        return "playwright"
    except BrowserUnavailable as first:
        exe = system_browser()
        if not exe:
            raise BrowserUnavailable(f"{first}; no Chrome, Chromium or Edge was found either") from first
    with tempfile.TemporaryDirectory() as profile:
        cmd = [exe, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", f"--user-data-dir={profile}", "--virtual-time-budget=15000",
               f"--print-to-pdf={pdf}", html.as_uri()]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=timeout_s)
        except (subprocess.SubprocessError, OSError) as e:
            raise BrowserUnavailable(f"{Path(exe).name} could not print the report: {e}") from e
    if not pdf.is_file() or pdf.stat().st_size < 1000:
        raise BrowserUnavailable(f"{Path(exe).name} did not write a PDF")
    return Path(exe).name


def capture_stills(base_url: str, ids: Iterable[str], *, timeout_s: float = 180) -> dict[str, dict[str, Any]]:
    """The 3D view out of each home's window, taken in the dashboard served at ``base_url`` (see dashboard/js/features/report-stills.js).
    Homes with no site model, or whose scene would not draw, are left out. Raises BrowserUnavailable when Playwright cannot run."""
    ids = list(ids)
    if not ids:
        return {}
    sync_playwright, Error = _playwright()
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=GPU_ARGS)
        except Error as e:
            raise BrowserUnavailable(f"Playwright's Chromium is not installed (playwright install chromium): {str(e)[:160]}") from e
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
            ctx.route(lambda url: not url.startswith((base_url, "data:", "blob:")), lambda r: r.abort())   # nothing leaves this machine
            page = ctx.new_page()
            page.goto(f"{base_url}/?theme=light")
            page.wait_for_function("() => !!document.querySelector('#cards .card')", timeout=timeout_s * 1000)
            return page.evaluate("async (ids) => (await import('/js/features/report-stills.js')).captureStills(ids)", ids) or {}
        finally:
            browser.close()
