"""Render README screenshots of every dashboard view with Playwright.

    python scripts/screenshots.py              # serves ./dashboard and writes docs/images/*.png
    python scripts/screenshots.py --only map   # one shot

Needs: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import argparse
import http.server
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"

# name, url query/hash, viewport, actions, wait ms, element (None = full viewport)
SHOTS = [
    ("map-commute", "?layer=commute-office#map", (1600, 1000), [], 3500, None),
    ("map-commute-light", "?layer=commute-office&theme=light#map", (1600, 1000), [], 3500, None),
    ("map-noise", "?layer=noise#map", (1600, 1000), [], 3500, None),
    ("map-rent", "?layer=rent#map", (1600, 1000), [], 3500, None),
    ("map-score", "?layer=score#map", (1600, 1000), [], 3500, None),
    ("map-drawer", "?layer=commute-office&open=emerald-green-1211#map", (1600, 1000), [], 3500, None),
    ("shortlist", "#list", (1600, 1000), [], 1500, None),
    ("compare", "#compare/the-highpoint-condo-31f,the-horizon-35d,townsend-14c,emerald-green-1211", (1600, 1150), [], 2500, None),
    ("unit-orbit", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1000), [], 9000, None),
    ("unit-window-12", "?date=2026-10-15&min=780&mode=window#unit/emerald-green-1211", (1600, 1000), [], 9000, "#stage"),
    ("unit-window-21", "?date=2026-10-15&min=780&mode=window&floor=21#unit/emerald-green-1211", (1600, 1000), [], 9000, "#stage"),
    ("unit-orbit-dec", "?date=2026-12-21&min=750#unit/emerald-green-1211", (1600, 1000), [], 9000, "#stage"),
    ("unit-sunpath", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1000), [], 9000, "#pathCv"),
    ("unit-floors", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1300), [], 14000, "#heatPanel"),
    ("unit-maybury", "?date=2026-10-15&min=780#unit/the-maybury-2204", (1600, 1000), [], 9000, "#stage"),
    ("plan-bird", "?date=2026-10-15&pmin=780#plan/emerald-green-1211", (1600, 1000), [], 6000, None),
    ("plan-top", "?date=2026-06-21&pmin=1020#plan/emerald-green-1211", (1600, 1000), [("click", "[data-v=top]")], 6000, "#pstage"),
    ("records", "#records/emerald-green-1211", (1600, 1500), [], 2500, None),
    ("mobile-map", "?layer=commute-office#map", (420, 900), [], 3500, None),
]


def serve(directory: Path, port: int):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.request_queue_size = 128
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Quiet, directory=str(directory)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--port", type=int, default=8799)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    httpd = serve(ROOT / "dashboard", args.port)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for name, url, (w, h), actions, wait, sel in SHOTS:
            if args.only and name not in args.only:
                continue
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1.5 if w < 800 else 1)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{args.port}/{url}")
            page.wait_for_timeout(wait)
            for kind, target in actions:
                if kind == "click":
                    page.click(target)
                    page.wait_for_timeout(2500)
            path = OUT / f"{name}.png"
            (page.locator(sel).screenshot(path=str(path)) if sel else page.screenshot(path=str(path)))
            print(f"{name:18s} -> {path.relative_to(ROOT)}" + (f"   errors: {errors}" if errors else ""))
            page.close()
        browser.close()
    httpd.shutdown()


if __name__ == "__main__":
    main()
