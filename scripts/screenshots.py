"""Render the README, gallery and landing-page screenshots of the dashboard with Playwright.

    python scripts/screenshots.py              # serves ./dashboard and writes docs/images/*.png
    python scripts/screenshots.py --only hero-map inside-bay   # some shots (--list prints every name)
    python scripts/screenshots.py --root /tmp/snap/dashboard --out /tmp/shots   # a clean export of dashboard/ to another folder

For published images shoot from a clean snapshot of the committed dashboard, not from a working tree with edits:

    git archive HEAD dashboard | tar -x -C /tmp/snap
    ln -s "$PWD/examples/nyc-2026/media-lite" /tmp/snap/dashboard/media-lite   # the example's starter photos (the page tries media/ first,
                                                                                # then media-lite/); link the full set as .../media instead if you have it
    python scripts/screenshots.py --root /tmp/snap/dashboard --out /tmp/shots

Each shot has one size, so the images sit together: desktop 1600 x 1000, phone 390 x 844 (1.5x), and for the 3D views the stage
alone at 1560 x 954, the wide 3D pane of this window (the Unit 3D tab's stage fills the width). Dark theme except the
`*-light*` shots. The first-run tour is switched off for every shot (the page also never starts it under automation), the pointer is
parked in a corner so no hover card or route preview is left in the picture (except in the shots that are about a hover), and a toast
left on screen is cleared before the picture is taken. The furniture control's sim rig, office chair and hidden-pieces rows are
left out (the sim rig is hidden in the default layout and never appears). A shot that fails is reported and the rest
still run; the exit status is 1 if any failed.

Needs: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import argparse
import datetime
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
# viewport: (width, height) or (width, height, device_scale_factor); element: a CSS selector, an (x, y, w, h) clip,
# ("crop", css, w, h) (the top left w x h of that element) or None
# actions run in order after the page has settled (wait ms); the optional last number is a pause in ms afterwards:
#   ("click", css[, pause])            ("hover", css[, pause])        ("press", key[, pause])
#   ("click_at", x, y[, pause])        a mouse click at page coordinates (for placing a pin on the map)
#   ("type", css, text[, pause])       focus the field, then type like a person
#   ("select", css, value[, pause])    choose an option in a <select>
#   ("wait_for", css[, pause])         wait until the selector is in the page
#   ("wait", ms)                       ("eval", js)                   ("tall", css): grow the viewport to that element's height
#   ("download_open", css[, pause])    click a button that downloads a file, then open that file in the page
#   ("upload", css, path[, pause])     give a file input a file from the repository (path relative to its root)
# pre-navigation actions (run before the page loads):
#   ("seed", {key: value})             write localStorage 'as:<key>' (JSON) unless it is already set, as the app does
#   ("block_media",)                   hold back every listing photo so only the blurred previews show
DESK = (1600, 1000)
PHONE = (390, 844)             # drawn at 1.5x
STAGE = (1600, 1256)           # with this window the 3D stage is 1560 x 954; the shot is the stage alone
STAGE_TALL = (1600, 1450)      # a taller window, cropped to the stage size from its top left, for panels that need the height

# the example's saved picks, as the app stores them (local storage 'as:picks'): five example saves, not data from the search
PICK_DATA = {
    "paramount-tower-25e": {"saved": True, "tier": "S", "status": "touring", "note": "Bay faces the river and the park canopy; no in-unit W/D", "tour": "2026-10-16T10:30"},
    "emerald-green-24d": {"saved": True, "tier": "A", "tour": "2026-10-16T12:00"},
    "7-platt-14g": {"saved": True, "tier": "A", "note": "Ask about the free month"},
    "one-manhattan-square-57g": {"saved": True, "tier": "B"},
    "orion-condominium-23a": {"saved": True, "tier": "B"},
}
PICKS = f"localStorage.setItem('as:picks', JSON.stringify({json.dumps(PICK_DATA)}))"
STARS = {"picks": PICK_DATA}
SEARCH = "Manhattan 1BR, fall 2026"
# a visit, as typed on a phone at the home (local storage 'as:findings:<search>')
VISIT = {"paramount-tower-25e": {
    "observed": "2026-10-15", "rooms": [{"name": "Living room", "w": 14.5, "l": 11.5}, {"name": "Bedroom", "w": 12, "l": 10.5}],
    "ceiling": 9, "water": 4, "noise": {"rating": 2, "db": 41}, "signal": 3, "closets": 3, "laundry": "building", "smells": ["none"],
    "light": {"rating": 5, "time": "11:30", "facing": "ESE"}, "view": "The East River past Second Avenue, park canopy low in the right-hand pane",
    "checks": {"doorman": {"verdict": "match"}, "exposure": {"verdict": "match"}, "size": {"verdict": "unsure"}},
    "note": "Quiet at the window with it shut; the radiator cover is a half wall.", "updated": "2026-10-15T15:20:00Z"}}
# what the renter decided about a home and when (local storage 'as:trail:<search>')
TRAIL = [
    {"e": "t1a1", "home": "paramount-tower-25e", "at": "2026-10-11T18:02:00Z", "kind": "star", "from": False, "to": True},
    {"e": "t1a2", "home": "paramount-tower-25e", "at": "2026-10-12T09:14:00Z", "kind": "tier", "from": "B", "to": "A", "why": "Light and view beat the cheaper options"},
    {"e": "t1a3", "home": "paramount-tower-25e", "at": "2026-10-13T20:41:00Z", "kind": "status", "from": "researching", "to": "touring"},
    {"e": "t1a4", "home": "paramount-tower-25e", "at": "2026-10-15T15:25:00Z", "kind": "tier", "from": "A", "to": "S", "why": "The bay window is as good as the model said"},
]
SEEDS = {**STARS, f"findings:{SEARCH}": VISIT, f"trail:{SEARCH}": TRAIL}
# a day of tours booked for today, so the Tour day screens have a route (the clock is the machine's)
_TODAY = datetime.date.today().isoformat()
TOUR_DAY = {"picks": {
    "paramount-tower-25e": {"saved": True, "tier": "S", "status": "touring", "tour": f"{_TODAY}T10:30"},
    "emerald-green-24d": {"saved": True, "tier": "A", "status": "touring", "tour": f"{_TODAY}T12:00"},
    "7-platt-14g": {"saved": True, "tier": "A", "status": "touring", "tour": f"{_TODAY}T14:15"},
}}
# the biggest building pin (View 34, 17 units) and the first-ranked home, as the map's listings source holds them
BUILDING = "f.find((x) => x.properties.id.startsWith('b:view 34'))"
GO = ("([js, z]) => { const f = __asMap.getSource('listings')._data.features, t = new Function('f', 'return ' + js)(f);"
      " __asMap.jumpTo({center: t.geometry.coordinates, zoom: z}); }")


def cam(px, py, pn, tx, ty, tn, ray=True):
    """Unit 3D's orbit camera at (east, up, north) metres from the site origin, looking at the target point (ray=False hides the sun ray)."""
    return ("eval", "(() => { const st = __unit3d.stage; "
            f"st.orbitCam.position.set({px}, {py}, {-pn}); st.controls.target.set({tx}, {ty}, {-tn}); st.controls.update(); "
            + ("" if ray else "st.opts.ray = false; st.ray.visible = false; ") + "st.dirty = true; })()")


PARAMOUNT = "date=2026-10-15&min=780#unit/paramount-tower-25e"
SHOTS = [
    # ---- the hero, and Find
    ("hero-map", "?layer=commute&open=paramount-tower-25e#map", DESK, [], 9000, None),
    ("find-commute-map", "?layer=commute#map", DESK, [], 9000, None),
    ("find-walk-map", "?layer=commute&mode=walk#map", DESK, [], 9000, None),
    ("find-route-preview", "?mode=subway#map", DESK,
     [("eval", "__asMap.jumpTo({center: [-73.9855, 40.7553], zoom: 14.3})"), ("hover", "#cards .card >> nth=1", 2500)], 9000, None),
    ("find-place-search", "#map", DESK,
     [("press", "Control+k", 900), ("type", "#plQ", "east of 3rd ave under 5k with w/d", 1800)], 9000, None),
    ("find-price-drops", "#map", DESK,
     [("press", "Control+k", 900), ("type", "#plQ", "price drops under 5.5k", 1500), ("press", "Enter", 3500)], 9000, None),
    ("find-price-audit", "?open=orion-condominium-43e#map", DESK, [("click", "#dTabs a[data-to=dMoney]", 1800), ("eval", "document.querySelector('#drawer .d-scroll').scrollTop -= 50")], 9000, None),
    ("find-lightbox", "#map", DESK,
     [("click", "#cards .card >> nth=1 >> .nph", 500), ("wait_for", ".lbx-img", 2500), ("click", ".lbx-plan [data-pm=side]", 6000)], 9000, None),
    ("find-light-theme", "?theme=light&layer=commute&open=paramount-tower-25e#map", DESK, [], 9000, None),
    ("find-map-clusters", "?layer=commute#map", DESK, [("eval", "__asMap.jumpTo({center: [-73.975, 40.755], zoom: 11.9})"), ("wait", 2500)], 9000, None),
    ("find-building-pin", "?layer=none#map", DESK,
     [("goto_map", BUILDING, 15.2), ("wait", 2500), ("hover_map", BUILDING, 2200)], 9000, None),
    ("find-pin-preview", "?layer=commute#map", DESK,
     [("eval", "__asMap.jumpTo({center: [-73.9745, 40.7449], zoom: 14.4})"), ("wait", 2500), ("hover_pin", "pins-t", "paramount-tower-25e", 2200)], 9000, None),
    ("find-rank-moves", "?open=the-knox-6b#map", DESK,
     [("click", "#dTabs a[data-to=dMoved]", 1800), ("eval", "document.querySelector('#drawer .d-scroll').scrollTop -= 70")], 9000, None),
    ("find-unknowns", "?open=the-knox-6b#map", DESK,
     [("click", "#dTabs a[data-to=dUnknowns]", 1500), ("fill", "#dUnknowns [data-uk=size] input", "800", 1500)], 9000, None),
    ("find-drawer-commute", "?open=paramount-tower-25e#map", DESK, [("click", "#dTabs a[data-to=dCommute]", 1800), ("eval", "document.querySelector('#drawer .d-scroll').scrollTop -= 50")], 9000, None),
    # ---- on a phone
    ("phone-drawer", "?layer=commute&open=paramount-tower-25e#map", PHONE, [], 9000, None),
    ("phone-map", "?layer=commute#map", PHONE, [], 9000, None),
    ("phone-unit-3d", f"?{PARAMOUNT}", PHONE, [("eval", "document.getElementById('stage').scrollIntoView({block: 'start'})")], 10000, None),
    ("phone-visit-notes", "?visit=paramount-tower-25e#map", PHONE, [("seed", SEEDS)], 9000, None),
    ("phone-tour-day", "?tourday=1#map", PHONE, [("seed", TOUR_DAY)], 9000, None),
    ("phone-tour-checklist", "?tourday=1#map", PHONE, [("seed", TOUR_DAY), ("click", "#tourDay [data-open='paramount-tower-25e']", 1500),
      ("click", "#tourDay [data-ans='light'][data-v='4']", 400)], 9000, None),
    # ---- Compare
    ("compare-four", "#compare/paramount-tower-25e,emerald-green-24d,7-platt-14g,one-manhattan-square-57g", DESK, [], 4500, None),
    ("compare-tradeoff-pad", "#map", DESK,
     [("click", "#rail button[aria-expanded]:has-text('Search')", 300), ("click", "#rail button[aria-expanded]:has-text('Budget')", 300),
      ("click", "#rail button[aria-expanded]:has-text('Commute')", 300), ("click", "#rail button[aria-expanded]:has-text('Must-haves')", 300),
      ("click", "#rail button[aria-expanded]:has-text('Status')", 800), ("hover", "[data-pad-preset] >> nth=1", 1500)], 9000, None),
    ("compare-split-view", "#list", DESK,
     [("seed", {"list:split": True, **STARS}), ("click", "[data-tier='2']", 500), ("click", "[data-tier='1']", 500), ("click", "[data-tg=gym]", 500),
      ("wait", 6000), ("hover", "#view-list tbody tr >> nth=2", 2500)], 9000, None),
    # ---- See inside (the 3D tab: Unit 3D and the Floor plan)
    ("inside-unit-3d", f"?{PARAMOUNT}", DESK, [], 11000, None),
    ("inside-orbit-day", "?date=2026-10-15&min=780&mode=orbit#unit/paramount-tower-25e", STAGE, [], 11000, "#stage"),
    ("inside-orbit-night", "?date=2026-10-15&min=1230&mode=orbit#unit/paramount-tower-25e", STAGE, [], 11000, "#stage"),
    ("inside-skyline-dusk", "?date=2026-10-15&min=1110&mode=orbit#unit/paramount-tower-25e", STAGE, [cam(500, 330, -150, -500, 120, 250, ray=False), ("wait", 2500)], 11000, "#stage"),
    ("inside-bay", "?date=2026-10-15&min=690&mode=in#unit/paramount-tower-25e", STAGE, [("look", "corner:Bedroom:0", 3500)], 11000, "#stage"),
    ("inside-furniture", "?date=2026-10-15&min=690&mode=in#unit/paramount-tower-25e", STAGE, [("look", "room:Bedroom:0", 2500), ("look", "into-room", 3500)], 11000, "#stage"),
    ("inside-bedroom", "?date=2026-10-15&min=690&mode=in#unit/paramount-tower-25e", STAGE, [("look", "corner:Bedroom:0", 2500), ("drag", "#stage", 300, 500, 1300, 480, 2500)], 11000, "#stage"),
    ("inside-walk-window", "?date=2026-10-15&min=690&mode=in#unit/paramount-tower-25e", STAGE, [("look", "seat:sofa", 2500), ("walk_window", 2500)], 11000, "#stage"),
    ("inside-night-window", "?date=2026-10-15&min=1230&mode=in#unit/paramount-tower-25e", STAGE, [("look", "seat:sofa", 2500), ("walk_window", 2500)], 11000, "#stage"),
    ("inside-play-year", "?date=2026-11-24&min=780&mode=in#unit/paramount-tower-25e", DESK, [("look", "bay:Living room:1", 2500), ("click", "#uPlayBar [data-pb=year]", 1800)], 11000, None),
    ("inside-measure-tape", "?date=2026-10-15&min=690&mode=in#unit/paramount-tower-25e", STAGE,
     [("look", "bay:Living room:1", 3000), ("click", "#unitMeasureTool", 800), ("click_frac", "#stage", 0.30, 0.55, 500), ("click_frac", "#stage", 0.70, 0.55, 1500)], 11000, "#stage"),
    ("inside-fits", "#plan/paramount-tower-25e", (1600, 1240),
     [("wait_for", "#tfText", 800), ("fill", "#tfText", "Bookshelf 36 x 12 x 72 in", 600), ("click", "[data-tf=drop-text]", 2500)], 11000, None),
    ("inside-match-photo", "?date=2026-10-15&min=780&mode=win#unit/paramount-tower-25e", DESK,
     [("click", "#uMatch", 1500), ("click", ".vm-card .vm-thumb:not(.gone) >> nth=0", 3500)], 11000, None),
    ("compare-side-by-side-3d", "#compare/paramount-tower-25e,paramount-tower-41a", DESK,
     [("click", "#cmpPair", 1000), ("wait_pair", 1500), ("click", "#prModes [data-mode=win]", 3500)], 6000, None),
    ("inside-measured-chip", f"?{PARAMOUNT}", STAGE_TALL, [("click", ".acc-btn", 800), ("eval", "document.querySelectorAll('.acc-pop').forEach((e) => { e.style.maxHeight = 'none'; })")], 11000, ("crop", "#stage", 1560, 954)),
    ("inside-park-trees", "?date=2026-10-15&min=840&mode=orbit#unit/atlas-38d", STAGE, [cam(270, 175, 70, -10, 0, 300, ray=False), ("wait", 2500)], 11000, "#stage"),
    ("inside-river", "?date=2026-06-21&min=1140&mode=orbit#unit/henry-hall-23j", STAGE, [cam(350, 160, -250, -350, 20, 450, ray=False), ("wait", 2500)], 11000, "#stage"),
    ("inside-sun-by-floor", "?date=2026-10-15&min=780#unit/emerald-green-1211", (1600, 1300),
     [("eval", "document.getElementById('heatPanel').scrollIntoView()")], 12000, "#heatPanel"),
    ("inside-light-theme", "?theme=light&date=2026-06-21&min=1080&mode=orbit#unit/the-maybury-2204", STAGE, [], 11000, "#stage"),
    ("inside-floor-plan", "?date=2026-10-15&pmin=780#unit/paramount-tower-25e", DESK, [("click", "#subnav [data-sub=plan]", 7000)], 9000, None),
    # ---- Sun and light (Unit 3D's sun tools on the featured unit)
    ("sun-path-chart", "?date=2026-12-21&min=600#unit/paramount-tower-25e", (1600, 1300, 2),
     [("eval", "document.getElementById('pathCv').closest('section').scrollIntoView()")], 12000, "section.panel:has(> #pathCv)"),
    ("sun-low-floor", "?date=2026-03-20&min=510&mode=win&floor=8#unit/paramount-tower-25e", STAGE, [], 11000, "#stage"),
    ("sun-high-floor", "?date=2026-03-20&min=510&mode=win&floor=25#unit/paramount-tower-25e", STAGE, [], 11000, "#stage"),
    ("sun-winter-shadows", "?date=2026-12-21&min=720&mode=orbit#unit/paramount-tower-25e", STAGE, [], 11000, "#stage"),
    ("sun-summer-shadows", "?date=2026-06-21&min=720&mode=orbit#unit/paramount-tower-25e", STAGE, [], 11000, "#stage"),
    ("sun-plan-view", "?date=2026-12-21&min=600&mode=plan#unit/paramount-tower-25e", STAGE, [], 11000, "#stage"),
    # ---- the city in 3D
    ("city-building-models", "?date=2026-10-15&min=780&mode=orbit#unit/paramount-tower-25e", STAGE, [("click", "#uTools [data-tg=heights]", 3000)], 11000, "#stage"),
    ("city-map-3d", "?layer=commute#map", DESK,
     [("eval", "__asMap.jumpTo({center: [-73.9790, 40.7490], zoom: 15.3})"), ("click", "#mapCtl [data-ctl='3d']", 2500),
      ("eval", "__asMap.jumpTo({pitch: 62, bearing: -30})"), ("wait", 4000)], 9000, None),
    # ---- the Floor plan studio
    ("studio-top", "#plan/paramount-tower-25e", DESK, [("click", "#psCams [data-v=top]", 3000), ("click", "#psDims [data-dm=all]", 1500)], 11000, None),
    ("studio-light", "?date=2026-12-21&pmin=600#plan/paramount-tower-25e", DESK, [("click", "#psMode [data-m='3d']", 2500), ("click", "#psTabs [data-t=light]", 3000)], 11000, None),
    ("studio-tracer", "#plan/paramount-tower-25e", DESK,
     [("click", "#trNewBtn", 1500), ("upload", "#trFile", "examples/nyc-2026/media-lite/emerald-green-620/emerald-green-line-20-plan.webp", 3500)], 11000, None),
    # ---- Decide
    ("decide-visit-history", "?open=paramount-tower-25e#map", DESK,
     [("seed", SEEDS), ("click", "#dTabs a[data-to=dVisit]", 1800), ("eval", "document.querySelector('#drawer .d-scroll').scrollTop -= 50")], 9000, None),
    ("decide-office-questions", "?open=the-knox-6b#map", DESK,
     [("eval", "document.getElementById('dOffice').scrollIntoView()"), ("click", "#dOffice [data-office-unit]", 2000)], 9000, None),
    ("decide-memo", "#list", DESK, [("seed", STARS), ("click", ".share-more", 700), ("download_open", "[data-act=memo-file]", 5000)], 9000, None),
    ("decide-share-page", "#list", DESK, [("seed", STARS), ("download_open", ".share-main", 5000)], 9000, None),
    ("decide-tour-planner", "#list/tours", DESK, [("seed", STARS)], 6000, None),
    ("decide-records", "#research/records/emerald-green-1211", DESK, [], 4000, None),
    ("decide-research-queue", "#research/queue", DESK, [], 4000, None),
    ("decide-tours-board", "#list/tours", DESK, [("seed", STARS), ("eval", "(() => { const b = document.querySelector('#view-tours .tb'); b.scrollIntoView({block: 'start'}); let e = b.parentElement; while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement; (e || document.scrollingElement).scrollBy(0, -64); })()")], 6000, None),
    ("decide-gone-fast", "#research/gone", DESK, [], 4000, None),
    # ---- Set up
    ("setup-wizard-city", "?new=1", DESK,
     [("type", "#f-name", "Chicago 1BR, spring 2027", 600), ("click", ".wz-city:has-text('Another city')", 600), ("type", "#f-city_name", "Chicago, IL", 900)], 7000, None),
    ("setup-wizard-review", "?new=1", DESK,
     [("type", "#f-name", "Midtown 1BR, winter 2027", 300), ("click", "[data-act=next]", 1200),
      ("type", "[data-f='dest.0.address']", "30 Rockefeller Plaza, New York, NY", 300), ("click", "[data-pick=dest]", 2500),
      ("click_at", 1180, 520, 2500), ("click", "[data-goto=review]", 2500)], 7000, None),
    ("setup-menu", "#map", DESK, [("click", "#menuBtn", 1200)], 9000, None),
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
# no shot shows the first-run tour; the page also skips it under automation
NO_TOUR = "(() => { try { if (localStorage.getItem('as:coach') === null) localStorage.setItem('as:coach', JSON.stringify({done: true, at: '2026-10-01'})); } catch (e) {} })()"


def _pause(args, default):
    """The optional trailing pause (ms) of an action."""
    return int(args[-1]) if args and isinstance(args[-1], (int, float)) else default


def before_load(page, actions):
    """Actions that must happen before the page loads."""
    page.add_init_script(NO_TOUR)
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
    elif kind == "fill":
        page.fill(args[0], args[1])
        page.wait_for_timeout(_pause(args[2:], 1200))
    elif kind == "look":
        # Unit 3D's / the studio's view picker: open it, then choose a view by its key (seat:sofa, room:Bedroom:0, into-room, ...)
        page.evaluate("(k) => { const h = document.querySelector('#uLook') || document.querySelector('#psLook'), b = h && h.querySelector('.lk-pick');"
                      " if (b && getComputedStyle(b).display !== 'none' && h.dataset.open !== '1') b.click(); }", None)
        page.click(f"[data-vp='{args[0]}']")
        page.wait_for_timeout(_pause(args[1:], 3000))
    elif kind == "drag":
        # drag inside an element (Unit 3D: drag to look around), from (x0, y0) to (x1, y1) in that element's pixels
        box = page.locator(args[0]).bounding_box()
        page.mouse.move(box["x"] + args[1], box["y"] + args[2])
        page.mouse.down()
        page.mouse.move(box["x"] + args[3], box["y"] + args[4], steps=25)
        page.mouse.up()
        page.wait_for_timeout(_pause(args[5:], 2000))
    elif kind == "walk_window":
        page.click("#uLook [data-act=to-window]")
        page.wait_for_function("() => window.__unit3d.walk && window.__unit3d.walk.walking()", timeout=5000)
        page.wait_for_function("() => !window.__unit3d.walk.walking()", timeout=30000)
        page.wait_for_timeout(_pause(args[0:], 1800))
    elif kind == "goto_map":
        page.evaluate(GO, [args[0], args[1]])
        page.wait_for_timeout(1500)
    elif kind == "hover_pin":
        xy = page.evaluate("([layer, id]) => { const m = window.__asMap, f = m.queryRenderedFeatures({layers: [layer]}).find((x) => x.id === id),"
                           " q = m.project(f.geometry.coordinates), r = m.getCanvas().getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; }", [args[0], args[1]])
        page.mouse.move(xy[0] - 8, xy[1] - 8)
        page.mouse.move(xy[0], xy[1], steps=6)
        page.wait_for_timeout(_pause(args[2:], 1800))
    elif kind == "hover_map":
        # hover (or click, with "click") the map pin of a feature picked by a JS expression over the listings source features
        # ('f' is the feature list); the expression returns one feature
        xy = page.evaluate("(js) => { const m = window.__asMap, f = window.__asMap.getSource('listings')._data.features;"
                           " const t = new Function('f', 'return ' + js)(f), q = m.project(t.geometry.coordinates), r = m.getCanvas().getBoundingClientRect();"
                           " return [q.x + r.left, q.y + r.top]; }", args[0])
        page.mouse.move(xy[0] - 6, xy[1] - 6)
        page.mouse.move(xy[0], xy[1], steps=6)
        if len(args) > 1 and args[1] == "click":
            page.mouse.click(xy[0], xy[1])
        page.wait_for_timeout(_pause(args[1:], 1800))
    elif kind == "click_frac":
        box = page.locator(args[0]).bounding_box()
        page.mouse.click(box["x"] + box["width"] * args[1], box["y"] + box["height"] * args[2])
        page.wait_for_timeout(_pause(args[3:], 1200))
    elif kind == "wait_pair":
        page.wait_for_function("() => window.__pair3d && window.__pair3d.sides.a && window.__pair3d.sides.b && window.__pair3d.sides.a.stage.scene"
                               " && window.__pair3d.sides.b.stage.scene", timeout=150000)
        page.wait_for_timeout(_pause(args, 2500))
    elif kind == "move":
        page.mouse.move(args[0], args[1], steps=4)
        page.wait_for_timeout(_pause(args[2:], 1200))
    elif kind == "wait":
        page.wait_for_timeout(int(args[0]))
    elif kind == "eval":
        page.evaluate(args[0])
        page.wait_for_timeout(2500 if "reload" in args[0] else 800)
    elif kind == "tall":
        tall = page.evaluate(f"document.querySelector({args[0]!r}).scrollHeight")
        page.set_viewport_size({"width": w, "height": min(int(tall) + 160, 6000)})
        page.wait_for_timeout(1500)
    elif kind == "upload":
        page.set_input_files(args[0], str(ROOT / args[1]))
        page.wait_for_timeout(_pause(args[2:], 2500))
    elif kind == "download_open":
        with page.expect_download(timeout=60000) as dl:
            page.click(args[0])
        saved = Path(tempfile.mkdtemp(prefix="as-shot-")) / f"{name}.html"   # a download, kept out of the images folder
        dl.value.save_as(str(saved))
        page.goto(saved.resolve().as_uri() + (args[1] if len(args) > 1 and isinstance(args[1], str) else ""))
        page.wait_for_timeout(_pause(args[1:], 2500))
    else:
        raise SystemExit(f"unknown action {kind!r} in {name}")


# the furniture control's sim rig, office chair and hidden-pieces rows are left out of the pictures (the bed row stays)
HIDE = "[data-rig-ctl], [data-chair-ctl], [data-off-ctl] { display: none !important; }"


def take(page, path: Path, sel, hovering: bool = False) -> None:
    """The picture: the whole window, an element, a fixed clip, or the top left of an element."""
    if not hovering:
        page.mouse.move(2, 2)   # a pointer left over a card or a pin would draw its route preview or a hover card into the picture
        page.wait_for_timeout(700)
    page.evaluate("(() => { const t = document.getElementById('toast'); if (t) { t.style.transition = 'none'; t.classList.remove('on'); t.style.visibility = 'hidden'; } })()")   # a toast left over from an action is not part of the picture
    page.add_style_tag(content=HIDE)
    page.wait_for_timeout(150)
    if isinstance(sel, tuple) and sel and sel[0] == "crop":
        box = page.locator(sel[1]).bounding_box()
        page.screenshot(path=str(path), clip={"x": box["x"], "y": box["y"], "width": min(sel[2], box["width"]), "height": min(sel[3], box["height"])})
    elif isinstance(sel, tuple):
        page.screenshot(path=str(path), clip=dict(zip(("x", "y", "width", "height"), sel)))
    elif sel:
        page.locator(sel).screenshot(path=str(path))
    else:
        page.screenshot(path=str(path))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--port", type=int, default=8799)
    ap.add_argument("--root", type=Path, default=ROOT / "dashboard", help="dashboard folder to serve")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--list", action="store_true", help="print the shot names and exit")
    args = ap.parse_args()
    names = [s[0] for s in SHOTS]
    if args.list:
        print("\n".join(names))
        return 0
    unknown = sorted(set(args.only or []) - set(names))
    if unknown:
        raise SystemExit(f"no such shot: {', '.join(unknown)} (--list prints the names)")
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    httpd = serve(args.root, args.port)
    failed: list[str] = []
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
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            try:
                before_load(page, actions)
                held = any(a[0] == "block_media" for a in actions)   # photos that never arrive would keep 'load' from firing
                page.goto(f"http://127.0.0.1:{args.port}/{url}", wait_until="commit" if held else "load")
                page.wait_for_timeout(wait)
                for kind, *rest in actions:
                    run_action(page, kind, rest, out, name, w)
                path = out / f"{name}.png"
                take(page, path, sel, hovering=any(a[0] in ("hover", "hover_map", "hover_pin") for a in actions))
                print(f"{name:26s} -> {path}" + (f"   errors: {errors}" if errors else ""), flush=True)
            except Exception as e:   # one bad shot must not stop the batch
                failed.append(name)
                print(f"{name:26s} FAILED: {str(e).splitlines()[0]}", flush=True)
            finally:
                page.unroute_all(behavior="ignoreErrors")   # pending (held) requests would raise when the page closes
                page.close()
        browser.close()
    httpd.shutdown()
    if failed:
        print("failed:", " ".join(failed), file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
