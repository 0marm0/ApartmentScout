"""Render README screenshots of every dashboard view with Playwright.

    python scripts/screenshots.py              # serves ./dashboard and writes docs/images/*.png
    python scripts/screenshots.py --only map   # one shot

Needs: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import argparse
import sys
import http.server
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"

# name, url query/hash, viewport, actions, wait ms, element (None = full viewport)
# actions: ("click", css) | ("eval", js) | ("tall", css): grow the viewport to that element's scroll height
PICKS = ("localStorage.setItem('as:picks', JSON.stringify({'the-highpoint-condo-31f': {saved: true, tier: 'S', note: 'Best light on the list; confirm W/D', tour: '2026-10-16T18:00'},"
         " 'townsend-14c': {saved: true, tier: 'A', tour: '2026-10-16T18:45'}, 'the-greywood-4b': {saved: true, tier: 'A'},"
         " 'emerald-green-1211': {saved: true, tier: 'B', note: 'Ask about the 421-a rider'}, 'the-horizon-35d': {saved: true, tier: 'B'}}))")
SHOTS = [
    ("map-commute", "?layer=commute#map", (1600, 1000), [], 9000, None),
    ("map-commute-light", "?layer=commute&theme=light#map", (1600, 1000), [], 9000, None),
    ("map-noise", "?layer=noise#map", (1600, 1000), [], 9000, None),
    ("map-rent", "?layer=rent#map", (1600, 1000), [], 9000, None),
    ("map-score", "?layer=score#map", (1600, 1000), [], 9000, None),
    ("map-drawer", "?layer=commute&open=the-corinthian-9i#map", (1600, 1000), [], 9000, None),
    ("map-drawer-commute", "?layer=commute&open=townsend-14c#map", (1600, 1000),
     [("eval", "document.getElementById('dCommute').scrollIntoView()")], 9000, "#drawer"),
    ("map-3d", "?layer=commute#map", (1600, 1000), [("click", "[data-ctl='3d']")], 9000, "#view-map"),
    ("shortlist", "#list", (1600, 1000), [], 3000, None),
    ("compare", "#compare/the-highpoint-condo-31f,the-horizon-35d,townsend-14c,emerald-green-1211", (1600, 1000), [("tall", "#view-compare")], 3500, None),
    ("unit-orbit", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1000), [], 10000, None),
    ("unit-window-12", "?date=2026-10-15&min=780&mode=window#unit/emerald-green-1211", (1600, 1000), [], 10000, "#stage"),
    ("unit-window-21", "?date=2026-10-15&min=780&mode=window&floor=21#unit/emerald-green-1211", (1600, 1000), [], 10000, "#stage"),
    ("unit-orbit-dec", "?date=2026-12-21&min=750#unit/emerald-green-1211", (1600, 1000), [], 10000, "#stage"),
    ("unit-plan-view", "?date=2026-10-15&min=780&mode=plan#unit/emerald-green-1211", (1600, 1000), [], 10000, "#stage"),
    ("unit-inside", "?date=2026-10-15&min=690&mode=in#unit/emerald-green-1211", (1600, 1000), [], 10000, "#stage"),
    ("unit-sunpath", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1000), [], 10000, "#pathCv"),
    ("unit-floors", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1300), [("eval", "document.getElementById('heatPanel').scrollIntoView()")], 12000, "#heatPanel"),
    ("unit-maybury", "?date=2026-06-21&min=1170&mode=window#unit/the-maybury-2204", (1600, 1000), [], 10000, "#stage"),
    ("plan-bird", "?date=2026-10-15&pmin=780#plan/emerald-green-1211", (1600, 1000), [], 8000, None),
    ("plan-top", "?date=2026-06-21&pmin=1020#plan/emerald-green-1211", (1600, 1000), [("click", "[data-v=top]")], 8000, "#pstage"),
    ("records", "#records/emerald-green-1211", (1600, 1000), [("tall", "#view-records")], 4000, None),
    ("research", "#research/queue", (1600, 1000), [], 4000, None),
    ("research-media", "#research/media", (1600, 1000), [], 6000, None),
    ("tours", "#tours", (1600, 1000), [("eval", PICKS), ("eval", "location.reload()")], 4000, None),
    ("mobile-map", "?layer=commute#map", (420, 900), [], 9000, None),
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
        # real GPU where there is one (SwiftShader drops MapLibre and three.js layers from screenshots)
        gpu = ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] if sys.platform == "darwin" else \
            ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        browser = p.chromium.launch(args=gpu)
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
                elif kind == "eval":
                    page.evaluate(target)
                    page.wait_for_timeout(2500 if "reload" in target else 800)
                elif kind == "tall":
                    tall = page.evaluate(f"document.querySelector({target!r}).scrollHeight")
                    page.set_viewport_size({"width": w, "height": min(int(tall) + 160, 6000)})
                    page.wait_for_timeout(1500)
            path = OUT / f"{name}.png"
            (page.locator(sel).screenshot(path=str(path)) if sel else page.screenshot(path=str(path)))
            print(f"{name:18s} -> {path.relative_to(ROOT)}" + (f"   errors: {errors}" if errors else ""))
            page.close()
        browser.close()
    httpd.shutdown()


if __name__ == "__main__":
    main()
