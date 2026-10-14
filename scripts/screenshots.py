"""Render README screenshots of every dashboard view with Playwright.

    python scripts/screenshots.py              # serves ./dashboard and writes docs/images/*.png
    python scripts/screenshots.py --only map-commute map-sun-lens   # some shots (--list prints every name)
    python scripts/screenshots.py --root /tmp/snap/dashboard --out /tmp/shots   # a clean export of dashboard/ to another folder

Needs: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import http.server
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"

# name, url query/hash, viewport, actions, wait ms, element (None = full viewport)
# viewport: (width, height) or (width, height, device_scale_factor); element: a CSS selector, an (x, y, w, h) clip or None
# actions run in order after the page has settled (wait ms); the optional last number is a pause in ms afterwards:
#   ("click", css[, pause])            ("hover", css[, pause])        ("press", key[, pause])
#   ("click_at", x, y[, pause])        a mouse click at page coordinates (for placing a pin on the map)
#   ("type", css, text[, pause])       focus the field, then type like a person
#   ("select", css, value[, pause])    choose an option in a <select>
#   ("wait_for", css[, pause])         wait until the selector is in the page
#   ("wait", ms)                       ("eval", js)                   ("tall", css): grow the viewport to that element's height
#   ("download_open", css[, pause])    click a button that downloads a file, then open that file in the page
# pre-navigation actions (run before the page loads):
#   ("seed", {key: value})             write localStorage 'as:<key>' (JSON) unless it is already set, as the app does
#   ("block_media",)                   hold back every listing photo so only the blurred previews show
# saved picks, as the app stores them (local storage 'as:picks'); the older Tours shot reloads with the same data
PICK_DATA = {
    "the-highpoint-condo-31f": {"saved": True, "tier": "S", "note": "Best light on the list; confirm W/D", "tour": "2026-10-16T10:30"},
    "townsend-14c": {"saved": True, "tier": "A", "tour": "2026-10-16T12:00"},
    "the-greywood-4b": {"saved": True, "tier": "A"},
    "emerald-green-1211": {"saved": True, "tier": "B", "note": "Ask about the 421-a rider"},
    "the-horizon-35d": {"saved": True, "tier": "B"},
}
PICKS = f"localStorage.setItem('as:picks', JSON.stringify({json.dumps(PICK_DATA)}))"
STARS = {"picks": PICK_DATA}
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
    ("shortlist", "#list", (1600, 1000), [("seed", STARS)], 3000, None),
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
    ("records", "#research/records/emerald-green-1211", (1600, 1000), [("tall", "#view-research")], 4000, None),
    ("research", "#research/queue", (1600, 1000), [], 4000, None),
    ("research-media", "#research/media", (1600, 1000), [], 6000, None),
    ("tours", "#list/tours", (1600, 1000), [("eval", PICKS), ("eval", "location.reload()"),
     ("eval", "document.querySelector('.lane').parentElement.scrollIntoView()")], 4000, None),
    ("mobile-map", "?layer=commute#map", (420, 900), [], 9000, None),
    # newer features
    ("map-bus", "?mode=bus#map", (1600, 1000), [], 9000, None),
    ("map-walk", "?mode=walk#map", (1600, 1000), [], 9000, "#view-map"),
    ("map-light-drawer", "?theme=light&open=townsend-14c#map", (1600, 1000), [], 9000, None),
    ("drawer-money", "?open=the-greywood-4b#map", (1600, 1000),
     [("eval", "document.querySelector('#drawer .d-scroll').scrollTop = 300")], 9000, "#drawer"),
    ("settings", "#map", (1600, 1000), [("click", "#searchSwitch")], 7000, None),
    ("unit-daylight", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1000),
     [("eval", "document.getElementById('sunPanel').scrollIntoView()")], 10000, "#sunPanel"),
    ("unit-light-theme", "?theme=light&date=2026-06-21&min=1080#unit/the-maybury-2204", (1600, 1000), [], 10000, None),
    ("plan-light-tab", "?date=2026-10-15&pmin=690#plan/emerald-green-1211", (1600, 1000), [("click", "#psTabs [data-t=light]")], 8000, None),
    ("plan-tracer", "#plan/emerald-green-1211", (1600, 1000), [("click", "#trNewBtn")], 8000, None),
    ("research-gone", "#research/gone", (1600, 1000), [], 4000, None),
    ("compare-light", "?theme=light#compare/the-highpoint-condo-31f,the-horizon-35d,townsend-14c,emerald-green-1211", (1600, 1000), [], 4000, None),
    ("mobile-drawer", "?open=the-corinthian-9i#map", (420, 900), [], 9000, None),
    ("mobile-unit", "?date=2026-10-15&min=780#unit/emerald-green-1211", (420, 900), [], 10000, None),
    # Paramount Tower 25E (E line, floor 25)
    ("map-paramount", "?layer=commute&open=paramount-tower-25e#map", (1600, 1000), [], 9000, None),
    ("unit-paramount", "?date=2026-10-15&min=780#unit/paramount-tower-25e", (1600, 1000), [], 10000, None),
    ("unit-paramount-window", "?date=2026-10-15&min=780&mode=window#unit/paramount-tower-25e", (1600, 1000), [], 10000, "#stage"),
    ("unit-paramount-inside", "?date=2026-10-15&min=690&mode=in#unit/paramount-tower-25e", (1600, 1000), [], 10000, "#stage"),
    ("plan-paramount", "?date=2026-10-15&pmin=780#plan/paramount-tower-25e", (1600, 1000), [], 8000, None),
    # dashboard features added since: route preview, lenses, split view
    ("map-route-preview", "?mode=subway#map",
     (1600, 1000), [("eval", "__asMap.jumpTo({center: [-73.985, 40.7535], zoom: 14.2})"), ("hover", "#cards .card >> nth=3", 2500)], 9000, None),
    ("map-starred-lens", "#map", (1600, 1000), [("seed", STARS), ("click", "[data-lens=stars]", 3500)], 9000, None),
    ("map-sun-lens", "?layer=sun#map", (1600, 1000), [], 9000, None),
    ("list-split-view", "#list", (1600, 1000),
     [("seed", {"list:split": True, **STARS}), ("click", "[data-tier='2']", 500), ("click", "[data-tier='1']", 500), ("click", "[data-tg=gym]", 500),
      ("wait", 6000), ("hover", "#view-list tbody tr >> nth=2", 2500)], 9000, None),
    # filter chips, collapsible rail, rank changes, density
    ("map-filter-chips", "#map", (1600, 1000),
     [("click", "[data-tier='2']", 500), ("click", "[data-tier='1']", 500), ("click", "[data-tg=gym]", 500), ("click", "[data-tg=doorman]", 500),
      ("eval", "(() => { const r = document.getElementById('rCom'); r.value = 25; r.dispatchEvent(new Event('input', {bubbles: true})); r.dispatchEvent(new Event('change', {bubbles: true})); })()"),
      ("wait", 6500)], 9000, None),
    ("rail-collapsed", "#map", (1600, 1000),
     [("click", "#rail button[aria-expanded]:has-text('Search')", 400), ("click", "#rail button[aria-expanded]:has-text('Budget')", 400),
      ("click", "#rail button[aria-expanded]:has-text('Must-haves')", 400), ("click", "#rail button[aria-expanded]:has-text('Status')", 1200)], 9000, None),
    ("map-rank-changes", "#map", (1600, 1000),
     [("select", "#presetSel", "cheapest-good-enough", 1500), ("eval", "document.getElementById('toast').classList.remove('on')")], 9000, None),
    ("map-compact", "?density=compact#map", (1600, 1000), [], 9000, None),
    # undo, plain-language search, shortcuts, tour, comfort
    ("undo-toast", "#map", (1600, 1000), [("click", "#cards .card >> nth=1 >> .save", 900)], 9000, None),
    ("palette-plain-words", "#map", (1600, 1000),
     [("press", "Control+k", 900), ("type", "#plQ", "1 bd under 5k within 20 min by subway with w/d near grand central", 1500)], 9000, None),
    ("cheatsheet", "#map", (1600, 1000), [("press", "?", 1200)], 9000, None),
    ("coach-mark", "?coach=1#map", (1600, 1000), [("wait_for", ".coach", 1200)], 9000, None),
    ("settings-menu", "#map", (1600, 1000), [("click", "#setBtn", 1200)], 9000, None),
    ("accent-amber", "#map", (1600, 1000), [("click", "#setBtn", 600), ("click", "[data-accent=amber]", 600), ("press", "Escape", 500), ("eval", "document.activeElement.blur()")], 9000, None),
    ("high-contrast", "#map", (1600, 1000), [("click", "#setBtn", 600), ("click", "#mnContrast", 600), ("press", "Escape", 500), ("eval", "document.activeElement.blur()")], 9000, None),
    # photos
    ("lightbox", "#map", (1600, 1000), [("click", "#cards .card >> nth=1 >> .nph", 500), ("wait_for", ".lbx-img", 3500)], 9000, None),
    ("lightbox-floor-plan", "#map", (1600, 1000),
     [("click", "#cards .card >> nth=1 >> .nph", 500), ("wait_for", ".lbx-img", 2500), ("click", ".lbx-plan [data-pm=side]", 6000)], 9000, None),
    ("blur-up-preview", "#map", (1600, 1000), [("block_media",), ("wait", 1500)], 6000, None),
    ("card-photo-counts", "#map", (1600, 1000, 2), [], 9000, "#results"),
    # decision tools
    ("decision-tray", "#map", (1600, 1000),
     [("seed", {"compare": ["the-highpoint-condo-31f", "townsend-14c", "emerald-green-1211"], **STARS})], 9000, None),
    ("tradeoff-pad", "#map", (1600, 1000),
     [("click", "#rail button[aria-expanded]:has-text('Search')", 300), ("click", "#rail button[aria-expanded]:has-text('Budget')", 300),
      ("click", "#rail button[aria-expanded]:has-text('Commute')", 300), ("click", "#rail button[aria-expanded]:has-text('Must-haves')", 300),
      ("click", "#rail button[aria-expanded]:has-text('Status')", 800), ("hover", "[data-pad-preset] >> nth=1", 1500)], 9000, None),
    ("share-shortlist-page", "#list", (1600, 1000),
     [("seed", STARS), ("download_open", ".share-main", 5000)], 9000, None),
    ("share-decision-memo", "#list", (1600, 1000),
     [("seed", STARS), ("click", ".share-more", 700), ("download_open", "[data-act=memo-file]", 5000)], 9000, None),
    ("tour-day-planner", "#list/tours", (1600, 1580), [("seed", STARS)], 6000, None),
    # new search wizard
    ("wizard-basics", "?new=1", (1600, 1000), [("type", "#f-name", "Brooklyn 1BR, winter 2027", 900)], 7000, None),
    ("wizard-pick-on-map", "?new=1&step=1", (1600, 1000),
     [("type", "[data-f='dest.0.address']", "30 Rockefeller Plaza, New York, NY", 300), ("click", "[data-pick=dest]", 2500)], 7000, None),
    ("wizard-review", "?new=1", (1600, 1000),
     [("type", "#f-name", "Brooklyn 1BR, winter 2027", 300), ("click", "[data-act=next]", 1200),
      ("type", "[data-f='dest.0.address']", "30 Rockefeller Plaza, New York, NY", 300), ("click", "[data-pick=dest]", 2500),
      ("click_at", 1180, 520, 2500), ("click", "[data-goto=review]", 2500)], 7000, None),
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


PRE = ("seed", "block_media")


def _pause(args, default):
    """The optional trailing pause (ms) of an action."""
    return int(args[-1]) if args and isinstance(args[-1], (int, float)) else default


def before_load(page, actions):
    """Actions that must happen before the page loads."""
    for kind, *args in actions:
        if kind == "seed":
            page.add_init_script(
                "(() => { const seed = %s; for (const [k, v] of Object.entries(seed)) {"
                " try { if (localStorage.getItem('as:' + k) === null) localStorage.setItem('as:' + k, JSON.stringify(v)); } catch (e) {} } })()"
                % json.dumps(args[0]))
        elif kind == "block_media":
            # a handler that never answers leaves the request pending, like a very slow connection (an abort would
            # drop the blurred preview, which the page removes on an image error)
            page.route("**/media/**", lambda route: None)


def run_action(page, kind, args, out, name, w):
    if kind in PRE:
        return
    if kind == "click":
        page.click(args[0])
        page.wait_for_timeout(_pause(args[1:], 2500))
    elif kind == "click_at":
        page.mouse.click(args[0], args[1])
        page.wait_for_timeout(_pause(args[2:], 1500))
    elif kind == "hover":
        page.hover(args[0])
        page.wait_for_timeout(_pause(args[1:], 1500))
    elif kind == "press":
        page.keyboard.press(args[0])
        page.wait_for_timeout(_pause(args[1:], 900))
    elif kind == "type":
        page.click(args[0])
        page.keyboard.type(args[1], delay=18)
        page.wait_for_timeout(_pause(args[2:], 1200))
    elif kind == "select":
        page.select_option(args[0], args[1])
        page.wait_for_timeout(_pause(args[2:], 1200))
    elif kind == "wait_for":
        page.wait_for_selector(args[0], timeout=20000)
        page.wait_for_timeout(_pause(args[1:], 700))
    elif kind == "wait":
        page.wait_for_timeout(int(args[0]))
    elif kind == "eval":
        page.evaluate(args[0])
        page.wait_for_timeout(2500 if "reload" in args[0] else 800)
    elif kind == "tall":
        tall = page.evaluate(f"document.querySelector({args[0]!r}).scrollHeight")
        page.set_viewport_size({"width": w, "height": min(int(tall) + 160, 6000)})
        page.wait_for_timeout(1500)
    elif kind == "download_open":
        with page.expect_download(timeout=60000) as dl:
            page.click(args[0])
        saved = Path(tempfile.mkdtemp(prefix="as-shot-")) / f"{name}.html"   # a download, kept out of the images folder
        dl.value.save_as(str(saved))
        page.goto(saved.resolve().as_uri() + (args[1] if len(args) > 1 and isinstance(args[1], str) else ""))
        page.wait_for_timeout(_pause(args[1:], 2500))
    else:
        raise SystemExit(f"unknown action {kind!r} in {name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--port", type=int, default=8799)
    ap.add_argument("--root", type=Path, default=ROOT / "dashboard", help="dashboard folder to serve")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--list", action="store_true", help="print the shot names and exit")
    args = ap.parse_args()
    if args.list:
        print("\n".join(s[0] for s in SHOTS))
        return
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    httpd = serve(args.root, args.port)
    with sync_playwright() as p:
        # real GPU where there is one (SwiftShader drops MapLibre and three.js layers from screenshots)
        gpu = ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] if sys.platform == "darwin" else \
            ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        browser = p.chromium.launch(args=gpu)
        for name, url, vp, actions, wait, sel in SHOTS:
            if args.only and name not in args.only:
                continue
            w, h = vp[0], vp[1]
            scale = vp[2] if len(vp) > 2 else (1.5 if w < 800 else 1)
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            before_load(page, actions)
            held = any(a[0] == "block_media" for a in actions)   # photos that never arrive would keep 'load' from firing
            page.goto(f"http://127.0.0.1:{args.port}/{url}", wait_until="commit" if held else "load")
            page.wait_for_timeout(wait)
            for kind, *rest in actions:
                run_action(page, kind, rest, out, name, w)
            path = out / f"{name}.png"
            if isinstance(sel, tuple):
                page.screenshot(path=str(path), clip=dict(zip(("x", "y", "width", "height"), sel)))
            elif sel:
                page.locator(sel).screenshot(path=str(path))
            else:
                page.screenshot(path=str(path))
            print(f"{name:22s} -> {path}" + (f"   errors: {errors}" if errors else ""), flush=True)
            page.unroute_all(behavior="ignoreErrors")   # pending (held) requests would raise when the page closes
            page.close()
        browser.close()
    httpd.shutdown()


if __name__ == "__main__":
    main()
