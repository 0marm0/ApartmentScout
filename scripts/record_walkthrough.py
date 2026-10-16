#!/usr/bin/env python3
"""Records the README walk-through, about 70 seconds of the real dashboard on the worked example:

  Find      the commute heat map with the ranked list, a card's route, its drawer (money, commute, light, noise by hour), the 311 noise
            layer swept through the day, walking-time rings, a plain-words search in the command menu, the trade-off pad re-ranking
            the list, the map in 3D
  The tower Unit 3D around Paramount Tower, every building's height, the day's shadows played across the city
  Inside    the living room with the renter's own furniture, the year's sun on the floor, a walk into the bedroom and to the window
  Sun       the same window on floor 6 (in shadow) and floor 25 (in sun), the sun path against the skyline and sun by floor and month,
            then a listing photo laid over the 3D window view (Match a photo)
  Fit       the floor-plan studio in 2D and 3D: a bookshelf typed in and dropped, then the room from the sofa
  Decide    four finalists row by row, the typeset decision report, the move planner, two units side by side in 3D with the day
            playing, the building's public records
  On a phone  the app in a 390 x 844 phone (a second browser context composited into the frame): the map, the Tour day list and the
            one-hand checklist at a home
  Night     back at the window while the sun sets over a lit night city

It drives the real dashboard in Chromium and captures the page with the DevTools screencast (full-resolution JPEG frames with
timestamps), not a screen recording, so the picture stays crisp. Waits for loading are cut out and the scenes are joined with short
cross-fades; the day and year plays are sped up. Nothing is drawn over the page: no cursor, no captions. Toasts and two floating
helpers (the automatic "lighter mode" note and the bed/chair switches) are hidden so they do not sit over the picture. The map in 3D
is shown in the light theme (the dark one hides the commute colours under the buildings); the dark theme comes back after it.

    git archive HEAD dashboard | tar -x -C /tmp/snap
    ln -s "$PWD/examples/nyc-2026/media-lite" /tmp/snap/dashboard/media-lite
    python scripts/record_walkthrough.py --root /tmp/snap/dashboard

Writes docs/images/walkthrough.webp (animated, for the README) and docs/images/walkthrough.mp4 (full quality, linked from it).
`--art dashboard/data-private/art --out <a private folder>` makes the renter's own copy with their real paintings (the recorder
answers the page's local-API session question with the art list, as `apartmentscout serve` does); never for docs/images.
`--only find,phone` records some groups only, to try a scene (find, tower, fit, decide, phone, night).
Needs: pip install playwright pillow && playwright install chromium; ffmpeg and img2webp (libwebp) on the PATH.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import datetime
import functools
import http.server
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

from playwright.async_api import Page, async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"
W, H, DPR = 1600, 900, 1.2   # a wide window, so the map beside the list and the 3D stage are big
FPS = 30
LAPSE_STEP = 0.14      # seconds each step of the time-lapse is shown
FADE = 0.35            # seconds of cross-fade between scenes
UNIT = "paramount-tower-25e"
FINALISTS = "paramount-tower-25e,orion-condominium-23a,7-platt-14g,one-manhattan-square-57g"
PAIR = "paramount-tower-25e,paramount-tower-41a"
TOWER_VIEW = [-73.977, 40.7480]   # the 3D map: Midtown and Murray Hill, looking up the island past Grand Central
QUERY = "east of 3rd ave under 5k with w/d"   # the command menu's plain-words search
PHONE_W, PHONE_H = 390, 844                    # the phone: drawn at 2x, then laid in the frame
# a day of tours booked for today, as the app stores the renter's picks (local storage 'as:picks'), so Tour day has a route
_TODAY = datetime.date.today().isoformat()
TOUR_DAY = {
    "paramount-tower-25e": {"saved": True, "tier": "S", "status": "touring", "tour": f"{_TODAY}T10:30"},
    "emerald-green-24d": {"saved": True, "tier": "A", "status": "touring", "tour": f"{_TODAY}T12:00"},
    "7-platt-14g": {"saved": True, "tier": "A", "status": "touring", "tour": f"{_TODAY}T14:15"},
}
SEED_PICKS = ("(() => { try { if (localStorage.getItem('as:picks') === null) localStorage.setItem('as:picks', JSON.stringify(%s)); } catch (e) {} })()"
              % json.dumps(TOUR_DAY))
VIEW_WINDOW = 1                  # the living room's corner window (Unit 3D's window groups): the park and the river
NO_TOUR = "(() => { try { localStorage.setItem('as:coach', JSON.stringify({done: true, at: '2026-10-01'})); } catch (e) {} })()"
# toasts, the automatic "lighter mode" note and the floating bed / sim rig / office chair switches would sit over the picture
HIDE = ("(() => { const add = () => { const s = document.createElement('style'); s.textContent = '.toast, .rnq-auto, .bed-ctl { display: none !important; }';"
        " document.head.append(s); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })()")
# Unit 3D's inside camera: stand at a plan point (inches) and look along a heading (0 = +y), as a person walking there would
GO = "([x, y, dir, pitch, fov]) => { __unit3d.stage.look.fov = fov; return __unit3d.walk.goTo([x, y], {dir, pitch}); }"
LIVING = [95, 118, 350, 4, 85]    # the back of the living room: the Monet by the dining table, the triptych over the futon, the windows ahead
NIGHT = [90, 255, 354, 2, 66]       # the desk and chair in the living room, the bay ahead: the middle pane clear, the thin posts at its sides
WALK_FROM = [112, 138, 352, 3, 82]   # where the walk to the corner window starts: the whole room ahead (the way from the bedroom door passes bare walls)
BEDROOM = [200, 162, 8, 2, 80]   # the bedroom door: TV on the left, the bed on the right, the window corner ahead
# a smooth scroll of whatever scrolls under the middle of the window
SCROLL = ("(dy) => { let e = document.elementFromPoint(innerWidth / 2, innerHeight * 0.6);"
          " while (e && !(e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement;"
          " (e || document.scrollingElement).scrollBy({top: dy, behavior: 'smooth'}); }")
# an input range moved from `a` to `b` over `ms` milliseconds (eased), with input events on the way and a change event at the end
SWEEP = ("([sel, a, b, ms]) => { const e = document.querySelector(sel), t0 = performance.now(); const tick = () => {"
         " const k = Math.min((performance.now() - t0) / ms, 1), v = Math.round(a + (b - a) * (k * k * (3 - 2 * k)));"
         " if (+e.value !== v) { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }"
         " if (k < 1) requestAnimationFrame(tick); else e.dispatchEvent(new Event('change', {bubbles: true})); }; tick(); }")
FLOOR = "(f) => { const e = document.getElementById('uFloor'); e.value = f; e.dispatchEvent(new Event('input', {bubbles: true})); }"


def drift(ms: int, angle: float) -> str:
    """A slow turn of Unit 3D's orbit camera around its target."""
    return ("(() => { const st = __unit3d.stage, c = st.controls.target, p = st.orbitCam.position, r = Math.hypot(p.x - c.x, p.z - c.z), a0 = Math.atan2(p.z - c.z, p.x - c.x),"
            f" t0 = performance.now(); const tick = () => {{ const k = Math.min((performance.now() - t0) / {ms}, 1), e = k * k * (3 - 2 * k), a = a0 + e * {angle};"
            " p.x = c.x + r * Math.cos(a); p.z = c.z + r * Math.sin(a); st.controls.update(); st.dirty = true; if (k < 1) requestAnimationFrame(tick); }; tick(); })()")


class Recorder:
    """Collects screencast frames into numbered scenes; frames that arrive while no scene is open are dropped."""

    def __init__(self) -> None:
        self.scenes: list[list[tuple[float, bytes]]] = []
        self.ends: list[float] = []
        self.lapse: set[int] = set()          # scenes made of separate steps (a time-lapse): each step is shown for a short, even time
        self.speed: dict[int, float] = {}     # scenes played faster than they were recorded (the day and year plays)
        self.phone: set[int] = set()          # scenes shot on the phone page, laid in a phone in the frame
        self.open = False
        self.src: Page | None = None          # the page whose frames the open scene keeps (a second page may be streaming too)
        self.cdps: dict[Page, object] = {}

    async def watch(self, ctx, page: Page) -> None:
        """Starts the screencast of a page (the walk-through's own, a phone, a report opened in a new tab)."""
        cdp = await ctx.new_cdp_session(page)
        cdp.on("Page.screencastFrame", lambda ev: self._frame(ev, page, cdp))
        await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 94, "everyNthFrame": 1})
        self.cdps[page] = cdp

    async def unwatch(self, page: Page) -> None:
        cdp = self.cdps.pop(page, None)
        if cdp:
            try:
                await cdp.send("Page.stopScreencast")
            except Exception:   # the page is already gone
                pass

    def _frame(self, ev, page: Page, cdp) -> None:
        if self.open and page is self.src:
            self.scenes[-1].append((time.time(), base64.b64decode(ev["data"])))   # arrival time: the frame metadata clock is not wall time
        asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]}))

    def begin(self, page: Page, phone: bool = False) -> None:
        self.scenes.append([])
        self.src = page
        if phone:
            self.phone.add(len(self.scenes) - 1)
        self.open = True

    def end(self) -> None:
        self.open = False
        self.ends.append(time.time())


async def hold(page: Page, seconds: float) -> None:
    await page.wait_for_timeout(int(seconds * 1000))


class TooSlow(Exception):
    """The machine was too busy to draw a moving scene smoothly; the recording is thrown away and made again."""


async def scene(page: Page, rec: Recorder, seconds: float, action=None, min_fps: float = 0, speed: float = 1, phone: bool = False) -> None:
    """One scene of at least `seconds` (as recorded), running `action` (a coroutine function) just after it starts; a slow action makes
    the scene longer. `min_fps` is the frame rate a moving scene must reach (TooSlow otherwise); `speed` plays it faster in the video;
    `phone` is a scene of the phone page."""
    rec.begin(page, phone)
    if speed != 1:
        rec.speed[len(rec.scenes) - 1] = speed
    # the screencast only sends a frame when the page changes: a still first frame makes the scene start on the picture as it is
    rec.scenes[-1].append((time.time(), await page.screenshot(type="jpeg", quality=94)))
    t0 = time.time()
    await hold(page, 0.3)
    if action:
        await action()
    await hold(page, max(seconds - (time.time() - t0), 0.05))
    rec.end()
    frames, length = len(rec.scenes[-1]), rec.ends[-1] - t0
    if min_fps and (length < seconds * 0.6 or frames / max(length, 0.1) < min_fps):
        raise TooSlow(f"scene {len(rec.scenes) - 1}: {frames} frames in {length:.1f}s (need {min_fps} fps)")


def canvas_size(rec: Recorder, tmp: Path) -> tuple[int, int]:
    """The pixel size of the other scenes' frames (the window times its device scale)."""
    return round(W * DPR), round(H * DPR)


def phone_assets(tmp: Path, canvas: tuple[int, int]):
    """The backdrop (a dark gradient with a glow, the phone's bezel and its shadow) and the rounded mask of the phone's screen, as PNGs,
    and where the screen sits: (x, y, width, height). Made once."""
    from PIL import Image, ImageChops, ImageDraw, ImageFilter
    cw, ch = canvas
    ph = round(ch * 0.915)
    pw = round(ph * PHONE_W / PHONE_H)
    px, py = (cw - pw) // 2, (ch - ph) // 2
    bg_path, mask_path = tmp / "phone-bg.png", tmp / "phone-mask.png"
    if not bg_path.exists():
        r = round(ph * 0.052)   # the screen's corner radius
        bez = max(round(ch * 0.011), 6)
        ss = 3                  # drawn three times larger, then reduced, for smooth corners
        ramp = Image.linear_gradient("L").resize((cw, ch))   # black at the top, white at the bottom
        bg = Image.composite(Image.new("RGB", (cw, ch), (13, 24, 27)), Image.new("RGB", (cw, ch), (7, 12, 14)), ramp)
        glow = ImageChops.invert(Image.radial_gradient("L").resize((cw, ch))).point(lambda v: v * 0.45)   # a soft glow behind the phone
        bg = Image.composite(Image.new("RGB", (cw, ch), (40, 66, 74)), bg, glow)
        rect = (px - bez, py - bez, px + pw + bez, py + ph + bez)
        shadow = Image.new("L", (cw, ch), 0)
        ImageDraw.Draw(shadow).rounded_rectangle((rect[0], rect[1] + 14, rect[2], rect[3] + 14), r + bez, fill=170)
        shadow = shadow.filter(ImageFilter.GaussianBlur(26))
        bg = Image.composite(Image.new("RGB", (cw, ch), (0, 0, 0)), bg, shadow)
        big = Image.new("RGBA", (cw * ss, ch * ss), (0, 0, 0, 0))
        d = ImageDraw.Draw(big)
        d.rounded_rectangle([v * ss for v in rect], (r + bez) * ss, fill=(26, 34, 37, 255), outline=(70, 84, 89, 255), width=2 * ss)
        phone = big.resize((cw, ch), Image.LANCZOS)
        bg = bg.convert("RGBA")
        bg.alpha_composite(phone)
        bg.convert("RGB").save(bg_path)
        m = Image.new("L", (pw * ss, ph * ss), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, pw * ss - 1, ph * ss - 1), r * ss, fill=255)
        m.resize((pw, ph), Image.LANCZOS).save(mask_path)
    return bg_path, mask_path, (px, py, pw, ph)


def encode(rec: Recorder, tmp: Path) -> Path:
    """The scenes as clips, joined with cross-fades into one near-lossless master."""
    clips: list[tuple[Path, float]] = []
    for i, frames in enumerate(rec.scenes):
        if not frames:
            raise SystemExit(f"scene {i} captured no frames")
        if len(frames) == 1:   # a still scene: the page did not change, so the screencast sent nothing after the first picture
            frames = frames + [(rec.ends[i] - 0.1, frames[0][1])]
        d = tmp / f"s{i}"
        d.mkdir()
        lines = []
        frames = sorted(frames, key=lambda f: f[0])
        k = rec.speed.get(i, 1.0)
        for j, (t, jpg) in enumerate(frames):
            (d / f"{j:05d}.jpg").write_bytes(jpg)
            nxt = frames[j + 1][0] if j + 1 < len(frames) else t + 1 / FPS
            if j + 1 == len(frames):
                tail = max((rec.ends[i] - t) / k, 0.05) - 1 / FPS   # the last picture stays until the scene ends (added below: the concat demuxer would count it twice)
            if i in rec.lapse and j + 1 < len(frames):
                nxt = min(nxt, t + LAPSE_STEP)   # a slow step (the machine was busy) is not shown longer than a quick one
            lines.append(f"file '{d / f'{j:05d}.jpg'}'\nduration {max((nxt - t) / k, 0.001):.4f}")
        lines.append(f"file '{d / f'{len(frames) - 1:05d}.jpg'}'")
        (d / "list.txt").write_text("\n".join(lines))
        clip = tmp / f"clip{i}.mp4"
        pad = f"fps={FPS},tpad=stop_mode=clone:stop_duration={tail:.3f}"
        if i in rec.phone:   # the phone's picture laid in a phone on a dark backdrop, the size of the other scenes
            bg, mask, (px, py, pw, ph) = phone_assets(tmp, canvas_size(rec, tmp))
            raw = tmp / f"raw{i}.mp4"   # the phone's own picture first (a finite clip), then laid in the frame for exactly its length
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(d / "list.txt"), "-vf", f"{pad},format=yuv420p",
                            "-c:v", "libx264", "-crf", "12", "-preset", "fast", str(raw)], check=True)
            rawdur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(raw)]).strip())
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-framerate", str(FPS), "-loop", "1", "-i", str(bg), "-framerate", str(FPS), "-loop", "1", "-i", str(mask),
                   "-filter_complex", f"[0:v]scale={pw}:{ph}:flags=lanczos,format=rgba[s];[2:v]format=gray[m];[s][m]alphamerge[sm];[1:v][sm]overlay={px}:{py},format=yuv420p",
                   "-t", f"{rawdur:.3f}", "-c:v", "libx264", "-crf", "14", "-preset", "fast", str(clip)]
        else:
            cmd = ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(d / "list.txt"), "-vf", f"{pad},format=yuv420p",
                   "-c:v", "libx264", "-crf", "14", "-preset", "fast", str(clip)]
        subprocess.run(cmd, check=True)
        dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(clip)]).strip())
        clips.append((clip, dur))
        print(f"scene {i}: {len(frames)} frames, {dur:.2f}s")
    inputs: list[str] = []
    for clip, _ in clips:
        inputs += ["-i", str(clip)]
    graph, last, acc = [], "[0:v]", clips[0][1]
    for i in range(1, len(clips)):
        graph.append(f"{last}[{i}:v]xfade=transition=fade:duration={FADE}:offset={acc - FADE:.3f}[v{i}]")
        last, acc = f"[v{i}]", acc + clips[i][1] - FADE
    joined = tmp / "joined.mp4"
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(graph) or "null", "-map", last if graph else "0:v", "-c:v", "libx264",
           "-crf", "14", "-preset", "slow", "-pix_fmt", "yuv420p", str(joined)]
    subprocess.run(cmd, check=True)
    print(f"{acc:.1f}s in all")
    return joined


def finish(joined: Path, tmp: Path, out_mp4: Path, out_webp: Path, args) -> None:
    """The two deliverables from the joined master: an H.264 video, and an animated WebP (ffmpeg here has no WebP encoder, so the
    frames go through libwebp's img2webp)."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(joined), "-vf", f"scale={args.mp4_width}:-2:flags=lanczos", "-c:v", "libx264", "-crf", str(args.crf),
                    "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out_mp4)], check=True)
    frames = tmp / "webp-frames"
    frames.mkdir(exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(joined), "-vf", f"fps={args.fps},scale={args.width}:-2:flags=lanczos",
                    str(frames / "f%04d.png")], check=True)
    files = sorted(frames.glob("f*.png"))
    subprocess.run(["img2webp", "-lossy", "-q", str(args.quality), "-m", "6", "-d", str(round(1000 / args.fps)), "-loop", "0", *map(str, files), "-o", str(out_webp)],
                   check=True, capture_output=True)
    print(f"{out_mp4.name}: {out_mp4.stat().st_size / 1e6:.2f} MB, {out_webp.name}: {out_webp.stat().st_size / 1e6:.2f} MB ({len(files)} frames)")


async def frame_drawn(page: Page) -> None:
    await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")


async def fold_legend(page: Page) -> None:
    """Folds the map legend to its title, for a clear map (it unfolds again when the commute mode changes)."""
    if not await page.evaluate("document.getElementById('legend').classList.contains('min')"):
        await page.click("#lgTog")


async def pan(page: Page, degrees: float, ms: int) -> None:
    """A slow turn of the head where one stands inside the home."""
    await page.evaluate("([deg, ms]) => { const w = __unit3d.walk, st = __unit3d.stage, h0 = w.heading(), t0 = performance.now();"
                        " const tick = () => { const k = Math.min((performance.now() - t0) / ms, 1), e = k * k * (3 - 2 * k);"
                        " w.setHeading(h0 + e * deg); st.dirty = true; if (k < 1) requestAnimationFrame(tick); }; tick(); }", [degrees, ms])


async def grab(page: Page, rec: Recorder) -> None:
    """Adds the picture as it is now to the open scene."""
    rec.scenes[-1].append((time.time(), await page.screenshot(type="jpeg", quality=94)))


async def set_time(page: Page, minute: int) -> None:
    """Unit 3D's clock to `minute` of the day with the time slider's keys (a quarter of an hour each), between scenes."""
    await page.evaluate("document.getElementById('uStrip').focus({preventScroll: true})")
    for _ in range(120):
        now = await page.evaluate("window.__unit3d.st.min")
        if abs(now - minute) < 15:
            break
        await page.keyboard.press("." if now < minute else ",")
    await hold(page, 0.4)


async def set_date(page: Page, date: str) -> None:
    await page.evaluate("(d) => { const e = document.getElementById('uDate'); e.value = d; e.dispatchEvent(new Event('change', {bubbles: true})); }", date)
    await hold(page, 0.8)


async def walk_done(page: Page) -> None:
    await page.wait_for_function("() => window.__unit3d.walk && window.__unit3d.walk.walking()", timeout=5000)
    await page.wait_for_function("() => !window.__unit3d.walk.walking()", timeout=30000)


async def unit_ready(page: Page) -> None:
    await page.wait_for_function("() => window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.scene", timeout=240000)


async def glide(page: Page, a: tuple[float, float], b: tuple[float, float], seconds: float) -> None:
    """The pointer, button held, moves smoothly from a to b."""
    t0 = time.time()
    while True:
        k = min((time.time() - t0) / seconds, 1)
        e = k * k * (3 - 2 * k)
        await page.mouse.move(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e)
        if k >= 1:
            break
        await page.wait_for_timeout(16)


async def record(root: Path, port: int, tmp: Path, args) -> Recorder:
    art: Path | None = args.art
    only = set(args.only.split(",")) if args.only else None

    def want(group: str) -> bool:
        return only is None or group in only

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a) -> None:
            pass

        # --art: answer the page's local-API session question with the art list, as `apartmentscout serve` does, and serve the files
        def do_GET(self) -> None:
            if art and self.path.split("?")[0] == "/api/session":
                body = json.dumps({"api": 1, "can_save": False, "example": False, "search": None, "searches": [], "cities": [],
                                   "art": sorted(q.name for q in art.iterdir() if q.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def translate_path(self, path: str) -> str:
            if art and path.startswith("/data-private/art/"):
                return str(art / Path(urllib.parse.unquote(path.split("?")[0])).name)
            return super().translate_path(path)

    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.request_queue_size = 128   # the page asks for ~110 files at once; the default backlog of 5 resets some
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}/"
    gpu = ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] if sys.platform == "darwin" else \
        ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=gpu)
            ctx = await browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=DPR)
            page = await ctx.new_page()
            await page.add_init_script(NO_TOUR)
            await page.add_init_script(HIDE)
            if art:   # the page asks the local API only when the server put a token in it
                await page.add_init_script("(() => { const m = document.createElement('meta'); m.name = 'as-token'; m.content = 'walkthrough';"
                                           " document.documentElement.append(m); })()")
            page.on("pageerror", lambda e: print("page error:", str(e).splitlines()[0], file=sys.stderr))
            rec = Recorder()
            # Unit 3D reads its date and time from the address: a mid-October morning, the sun on the 25th floor's windows;
            # the move planner's "today" is pinned to mid September, so its plan has room before the lease starts
            await page.goto(base + "?layer=commute&date=2026-10-15&min=570&today=2026-09-14#map")
            await page.wait_for_function("() => !!window.__asMap && document.querySelector('#cards .card')", timeout=180000)
            await hold(page, 6)
            # load the 3D scene's tiles once, so the tilt later does not wait for them
            await page.evaluate(f"void window.__asMap.jumpTo({{center: {TOWER_VIEW}, zoom: 14.3, pitch: 54, bearing: 12}})")
            await hold(page, 4)
            await page.evaluate("void window.__asMap.jumpTo({center: [-73.98, 40.751], zoom: 12.25, pitch: 0, bearing: 0})")
            await hold(page, 5)   # the basemap tiles and the commute bands paint
            await rec.watch(ctx, page)
            await page.mouse.move(2, 2)

            async def find() -> None:
                # ---- Find. The commute heat map beside the ranked list: a slow push in, then a card hover draws its route
                async def push_in() -> None:
                    await page.evaluate("void window.__asMap.easeTo({center: [-73.975, 40.7525], zoom: 12.6, duration: 2200})")
                await scene(page, rec, 2.4, push_in, min_fps=12)

                async def hover_card() -> None:
                    await page.hover("#cards .card >> nth=0")
                await scene(page, rec, 1.3, hover_card)

                # the card opens its drawer (photo, money, score), which then scrolls on through the commute and the light to the noise by hour
                async def open_card() -> None:
                    await page.click("#cards .card >> nth=0")
                await scene(page, rec, 1.7, open_card, min_fps=10)

                async def scroll_drawer() -> None:
                    await page.evaluate("document.querySelector('#drawer .d-scroll').scrollTo({top: 330, behavior: 'smooth'})")
                    await hold(page, 0.6)
                    await page.evaluate("document.getElementById('dCommute').scrollIntoView({block: 'start', behavior: 'smooth'})")
                    await hold(page, 0.8)
                    await page.evaluate("document.getElementById('dNoise').scrollIntoView({block: 'center', behavior: 'smooth'})")
                await scene(page, rec, 3.0, scroll_drawer, min_fps=8)

                # the drawer, the home's mini card put away, for a clear map
                await page.click("#dClose")
                await page.mouse.move(2, 2)
                await hold(page, 0.8)
                if await page.is_visible("#mapCard [data-x]"):
                    await page.click("#mapCard [data-x]")
                await page.mouse.move(2, 2)
                await hold(page, 0.8)

                # the 311 noise layer through the day (its hour slider in the legend), the nightlife lighting up
                if await page.evaluate("document.getElementById('legend').classList.contains('min')"):
                    await page.click("#lgTog")
                await page.click("#layerSwitch [data-layer=noise]")
                await page.mouse.move(2, 2)
                await hold(page, 2.4)   # the noise surface paints

                async def noise_day() -> None:
                    await page.evaluate("void window.__asMap.easeTo({center: [-73.99, 40.7395], zoom: 12.9, duration: 2600})")
                    await page.evaluate(SWEEP, ["#nhHour", 7, 23, 2600])
                await scene(page, rec, 3.1, noise_day, min_fps=8)
                await page.click("[data-nh-all]")
                await hold(page, 0.5)
                await page.click("#layerSwitch [data-layer=commute]")
                await page.evaluate("void window.__asMap.jumpTo({center: [-73.975, 40.7525], zoom: 12.6, pitch: 0, bearing: 0})")
                await fold_legend(page)
                await page.mouse.move(2, 2)
                await hold(page, 1.8)

                # walking-time rings around the destination
                async def walk_rings() -> None:
                    await page.click("button[data-mode=walk] >> nth=0")
                await scene(page, rec, 1.6, walk_rings)
                await page.click("button[data-mode=best] >> nth=0")   # the colours back for the scenes that follow
                await fold_legend(page)
                await page.mouse.move(2, 2)
                await hold(page, 1.5)

                # a plain-words question in the command menu filters the map; then the filters come off again
                async def ask() -> None:
                    await page.keyboard.press("Control+k")
                    await hold(page, 0.5)
                    await page.keyboard.type(QUERY, delay=26)
                    await hold(page, 0.6)
                    await page.keyboard.press("Enter")
                    await hold(page, 1.4)
                await scene(page, rec, 3.5, ask)
                await page.keyboard.press("Control+z")
                await hold(page, 1.2)
                if not await page.evaluate("document.body.innerText.includes('289 homes')"):
                    print("warning: the plain-words filters did not come off", file=sys.stderr)

                # the trade-off pad: drag the dot from Cost toward Commute, then toward Space, and the list re-ranks
                for t in ("Search", "Budget", "Commute", "Must-haves", "Status"):
                    await page.click(f"#rail button[aria-expanded]:has-text('{t}')")
                    await hold(page, 0.25)
                await page.mouse.move(2, 2)
                await hold(page, 0.9)
                dot, svg = await page.locator(".tp-dot .core").bounding_box(), await page.locator(".tp-svg").bounding_box()
                a = (dot["x"] + dot["width"] / 2, dot["y"] + dot["height"] / 2)
                to_commute = (svg["x"] + svg["width"] * 0.20, svg["y"] + svg["height"] * 0.80)
                to_space = (svg["x"] + svg["width"] * 0.82, svg["y"] + svg["height"] * 0.80)

                async def drag_dot() -> None:
                    await page.mouse.move(*a)
                    await page.mouse.down()
                    await glide(page, a, to_commute, 1.0)
                    await hold(page, 0.3)
                    await glide(page, to_commute, to_space, 1.0)
                    await hold(page, 0.3)
                    await page.mouse.up()
                await scene(page, rec, 3.2, drag_dot)
                await page.evaluate("[...document.querySelectorAll('#rail button')].find((b) => b.textContent.trim() === 'Reset')?.click()")
                await hold(page, 0.8)
                for t in ("Search", "Budget", "Commute", "Must-haves", "Status"):
                    await page.click(f"#rail button[aria-expanded]:has-text('{t}')")
                    await hold(page, 0.25)

                # the map in 3D, in the light theme (the dark one hides the commute colours under the buildings): tilt over Midtown and Murray Hill
                await page.evaluate("import('/js/shell.js').then((m) => m.setThemeMode('light'))")
                await page.click("button[data-mode=best] >> nth=0")
                await page.evaluate("void window.__asMap.jumpTo({center: [-73.979, 40.751], zoom: 13.5, pitch: 0, bearing: 0})")
                await hold(page, 3.5)   # the light basemap and bands paint
                await fold_legend(page)
                await page.mouse.move(2, 2)
                await hold(page, 1.2)

                async def tilt() -> None:
                    await page.click("[data-ctl='3d']")
                    await hold(page, 0.12)
                    await page.evaluate(f"void window.__asMap.easeTo({{center: {TOWER_VIEW}, zoom: 14.3, pitch: 54, bearing: 12, duration: 3200}})")
                await scene(page, rec, 3.1, tilt, min_fps=10)
                await page.evaluate("import('/js/shell.js').then((m) => m.setThemeMode('dark'))")

            async def tower() -> None:
                # ---- The tower. Unit 3D (the loading wait is cut out)
                await page.evaluate(f"location.hash = '#unit/{UNIT}'")
                await unit_ready(page)
                # draw at full detail and never step down: the automatic "lighter mode" is for slow devices
                await page.evaluate("import('/js/room3d/quality.js').then((m) => { m.quality.pin(true); })")
                await hold(page, 4)
                await page.click("#uModes [data-mode=orbit]")
                await hold(page, 3)

                async def orbit() -> None:
                    await page.evaluate(drift(2000, 0.55))
                await scene(page, rec, 2.2, orbit, min_fps=12)

                # every building around it with its height
                async def heights() -> None:
                    await page.click("[data-tg=heights]")
                    await page.evaluate(drift(1800, 0.4))
                await scene(page, rec, 2.0, heights, min_fps=12)
                await page.click("[data-tg=heights]")
                await hold(page, 1.2)

                # the day played across the city: the shadows swing round (sped up three times)
                async def play_day() -> None:
                    await page.click("#uPlayBar [data-pb=day]")
                await scene(page, rec, 9.6, play_day, min_fps=12, speed=3)
                await page.click("#uPlayBar [data-pb=day]")   # pause

                # ---- Inside: the living room with the renter's own furniture (one office chair at the desk, no sim rig)
                await set_time(page, 630)
                await page.click("#uModes [data-mode=in]")
                await hold(page, 2.5)
                await page.evaluate(GO, LIVING)
                await walk_done(page)
                await hold(page, 1.2)

                async def look_living() -> None:
                    await pan(page, 16, 1700)
                await scene(page, rec, 2.0, look_living, min_fps=12)

                # the year: the sun patch slides across the floor with the seasons, the trees outside turn (sped up three times)
                async def play_year() -> None:
                    await page.click("#uPlayBar [data-pb=year]")
                await scene(page, rec, 9.0, play_year, min_fps=3, speed=3)   # each day of the year is a fresh sky: a few frames a second
                await page.click("#uPlayBar [data-pb=year]")   # pause
                await set_date(page, "2026-10-15")
                await set_time(page, 615)   # 10:00-10:30: the sun on floor 25's window, floor 6's still in the street's shadow
                await hold(page, 1)

                # the bedroom from its door (a cut: walking there would pass a bare wall), then a walk to the living room's corner window
                await page.evaluate(GO, BEDROOM)
                await walk_done(page)
                await hold(page, 1.2)

                async def look_bedroom() -> None:
                    await pan(page, 22, 1800)
                await scene(page, rec, 2.0, look_bedroom, min_fps=12)

                await page.evaluate(GO, WALK_FROM)
                await walk_done(page)
                await hold(page, 0.8)

                async def to_window() -> None:
                    await page.evaluate(f"void __unit3d.walk.goToWindow({VIEW_WINDOW})")
                    await walk_done(page)
                await scene(page, rec, 3.0, to_window, min_fps=12, speed=1.4)   # the walk is shown a little quicker than it was

                # ---- Sun. The same window on floor 6 (in the shadow of the street) and on floor 25 (in the sun)
                await page.click("#uModes [data-mode=win]")
                await hold(page, 2)
                await page.evaluate(FLOOR, 6)
                await hold(page, 2.5)

                async def floors() -> None:
                    await hold(page, 1.0)
                    await page.evaluate(FLOOR, 25)
                    await frame_drawn(page)
                    await grab(page, rec)   # the switch is one big redraw: keep its picture even if the screencast skips it
                await scene(page, rec, 2.3, floors)

                # the sun path against the skyline, and direct sun by floor and month
                await page.evaluate("document.getElementById('pathCv').closest('.panel').scrollIntoView({block: 'center'})")
                await hold(page, 1.5)

                async def sun_path() -> None:
                    await page.evaluate("document.getElementById('heatPanel').scrollIntoView({block: 'center', behavior: 'smooth'})")
                await scene(page, rec, 2.0, sun_path)
                await page.evaluate("document.getElementById('stage').scrollIntoView({block: 'start'})")
                await hold(page, 1.0)

                # ---- Match a photo: a listing photo laid over the 3D window view, faded across until the buildings line up
                await page.click("#uMatch")
                await hold(page, 1.5)
                await page.click(".vm-card .vm-thumb:not(.gone) >> nth=0")
                await hold(page, 3.5)
                await page.evaluate(SWEEP, ["#vmOp", 90, 90, 1])
                await page.mouse.move(2, 2)
                await hold(page, 0.8)

                async def match_photo() -> None:
                    await page.evaluate(SWEEP, ["#vmOp", 90, 24, 2300])
                await scene(page, rec, 3.0, match_photo, min_fps=8)
                await page.click(".vm-card [data-act=close]")
                await hold(page, 1.0)

            async def fit() -> None:
                # ---- Fit. The floor-plan studio, 2D and 3D side by side: does a bookshelf fit?
                await page.evaluate(f"location.hash = '#plan/{UNIT}'")
                await page.wait_for_selector("#tfText", timeout=60000)
                await hold(page, 8)

                async def drop_in() -> None:
                    await page.click("#tfText")
                    await page.keyboard.type("Bookshelf 36 x 12 x 72 in", delay=22)
                    await hold(page, 0.2)
                    await page.click("[data-tf=drop-text]")
                await scene(page, rec, 3.2, drop_in)

                # the studio's 3D view alone: from the bird's-eye cutaway down to the sofa
                await page.click("#psMode [data-m='3d']")
                await hold(page, 2.5)

                async def from_sofa() -> None:
                    await page.click("#psCams [data-v=sofa]")
                await scene(page, rec, 2.6, from_sofa, min_fps=12)
                await page.click("#psMode [data-m='both']")

            async def decide() -> None:
                # ---- Decide. Four finalists row by row
                await page.evaluate(f"location.hash = '#compare/{FINALISTS}'")
                await hold(page, 4)
                await page.mouse.move(2, 2)

                async def table() -> None:
                    await page.evaluate(SCROLL, 120)
                await scene(page, rec, 2.4, table)

                # the typeset decision report: the sheet that chooses what goes in, then the document it opens (its building is cut out)
                async def open_sheet() -> None:
                    await page.click("#cmpReport")
                await scene(page, rec, 2.0, open_sheet)
                await hold(page, 1.0)
                async with ctx.expect_page() as info:
                    await page.click("#rpOpen")
                rp = await info.value
                await rp.wait_for_load_state("load")
                await rp.wait_for_timeout(5000)
                await rp.evaluate("document.body.style.zoom = 1.3")
                await rp.wait_for_timeout(800)
                await rec.watch(ctx, rp)

                async def read_report() -> None:
                    await rp.evaluate("window.scrollTo({top: innerHeight * 1.2, behavior: 'smooth'})")
                await scene(rp, rec, 3.2, read_report)
                await rec.unwatch(rp)
                await rp.close()
                if await page.is_visible(".rp-x"):
                    await page.click(".rp-x")
                await hold(page, 1.0)

                # the move planner: dated steps from today to the lease start, ready for the calendar
                async def move_plan() -> None:
                    await page.evaluate(f"import('/js/features/move.js').then((m) => m.open('{UNIT}'))")
                    await hold(page, 1.5)
                    await page.evaluate("document.getElementById('mvBody').scrollTo({top: 360, behavior: 'smooth'})")
                await scene(page, rec, 3.0, move_plan)
                await page.evaluate("import('/js/features/move.js').then((m) => m.close(true))")
                await hold(page, 0.5)

                # two units side by side in 3D, the same window and time for both, with the day playing
                await page.evaluate(f"location.hash = '#compare/{PAIR}'")
                await hold(page, 3)
                await page.click("#cmpPair")
                await page.wait_for_function("() => window.__pair3d && window.__pair3d.sides.a && window.__pair3d.sides.b && window.__pair3d.sides.a.stage.scene"
                                             " && window.__pair3d.sides.b.stage.scene", timeout=150000)
                await hold(page, 2)
                await page.click("#prModes [data-mode=win]")
                await page.evaluate("void window.__pair3d.setTime(540)")
                await hold(page, 3.5)

                async def pair_day() -> None:
                    await page.click("#prPlay")
                await scene(page, rec, 3.2, pair_day, min_fps=10)
                await page.click("#prPlay")

                # the building's public records
                await page.evaluate(f"location.hash = '#research/records/{UNIT}'")
                await hold(page, 4)
                await page.mouse.move(2, 2)

                async def records() -> None:
                    await page.evaluate(SCROLL, 150)
                await scene(page, rec, 2.4, records)

            async def phone() -> None:
                # ---- On a phone: a second browser context at phone size, its picture laid in a phone in the frame
                pctx = await browser.new_context(viewport={"width": PHONE_W, "height": PHONE_H}, device_scale_factor=2, is_mobile=True, has_touch=True)
                ph = await pctx.new_page()
                await ph.add_init_script(NO_TOUR)
                await ph.add_init_script(HIDE)
                await ph.add_init_script(SEED_PICKS)
                ph.on("pageerror", lambda e: print("phone page error:", str(e).splitlines()[0], file=sys.stderr))
                await ph.goto(base + "?layer=commute&date=2026-10-15&min=570#map")
                await ph.wait_for_function("() => !!window.__asMap && document.querySelector('#cards .card')", timeout=180000)
                await hold(ph, 6)
                await fold_legend(ph)   # the legend would cover the map on a phone
                await hold(ph, 1)
                await rec.watch(pctx, ph)

                async def phone_map() -> None:
                    await ph.evaluate("void window.__asMap.easeTo({center: [-73.976, 40.7515], zoom: 13.1, duration: 2000})")
                    await hold(ph, 0.4)
                    await ph.evaluate(SCROLL, 260)
                await scene(ph, rec, 2.4, phone_map, phone=True)
                await rec.unwatch(ph)

                # Tour day: the day's homes in order, with the walk between them
                await ph.goto(base + "?tourday=1#map")
                await ph.wait_for_selector("#tourDay [data-open='paramount-tower-25e']", timeout=60000)
                await hold(ph, 2.5)
                await rec.watch(pctx, ph)

                async def tour_day() -> None:
                    await ph.evaluate("(() => { const e = document.querySelector('#tourDay [data-open]'); let s = e; while (s && !(s.scrollHeight > s.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;"
                                      " (s || document.scrollingElement).scrollBy({top: 150, behavior: 'smooth'}); })()")
                await scene(ph, rec, 2.4, tour_day, phone=True)

                # the one-hand checklist at a home: big buttons for the light, the noise
                async def checklist() -> None:
                    await ph.click("#tourDay [data-open='paramount-tower-25e']")
                    await hold(ph, 1.2)
                    await ph.click("#tourDay [data-ans='light'][data-v='4']")
                    await hold(ph, 0.7)
                    await ph.evaluate(SCROLL, 330)
                    await hold(ph, 0.8)
                    keys = await ph.evaluate("[...document.querySelectorAll('#tourDay [data-ans]')].map((b) => b.dataset.k)")
                    pick = next((k for k in ("noise-2", "noise-3") if k in keys), None)
                    if pick:
                        await ph.click(f"#tourDay [data-k='{pick}']")
                await scene(ph, rec, 4.0, checklist, phone=True)
                await rec.unwatch(ph)
                await pctx.close()

            async def night() -> None:
                # ---- Night. Back at the window as the sun sets over the city: the time slider's keys run it down to a lit night sky
                await page.evaluate(f"location.hash = '#unit/{UNIT}'")
                await unit_ready(page)
                await hold(page, 4)
                await page.click("#uModes [data-mode=in]")
                await hold(page, 2.5)
                await set_time(page, 1020)
                await page.evaluate(GO, NIGHT)   # from a spot where a pane, not a post, is in the middle of the view
                await walk_done(page)
                await page.mouse.move(2, 2)
                await hold(page, 1.5)

                async def to_night() -> None:
                    rec.lapse.add(len(rec.scenes) - 1)
                    await page.evaluate("document.getElementById('uStrip').focus({preventScroll: true})")
                    while await page.evaluate("window.__unit3d.st.min") < 1200:
                        await page.keyboard.press(".")
                        # let the new sky draw before the next step, so every step is a frame of the time-lapse
                        await frame_drawn(page)
                        await hold(page, 0.12)
                    await hold(page, 1.4)   # stay in the night
                await scene(page, rec, 3.0, to_night)

            for name, group in (("find", find), ("tower", tower), ("fit", fit), ("decide", decide), ("phone", phone), ("night", night)):
                if want(name):
                    await group()
            await rec.unwatch(page)
            await browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
    return rec


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", type=Path, default=ROOT / "dashboard", help="dashboard folder to serve (a clean snapshot, see the docstring)")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--port", type=int, default=0, help="0 picks a free port")
    ap.add_argument("--width", type=int, default=820, help="width of the animated WebP")
    ap.add_argument("--quality", type=int, default=62, help="WebP quality 0-100")
    ap.add_argument("--fps", type=int, default=10, help="frame rate of the animated WebP")
    ap.add_argument("--mp4-width", type=int, default=1600, help="width of the MP4")
    ap.add_argument("--crf", type=int, default=26, help="H.264 quality of the MP4 (lower is better and bigger)")
    ap.add_argument("--attempts", type=int, default=6, help="how many times to record again when the machine is too busy for smooth motion")
    ap.add_argument("--keep", type=Path, help="keep the encoded intermediates (joined.mp4 is the master) in this folder")
    ap.add_argument("--art", type=Path, help="the renter's own painting images (dashboard/data-private/art): show them instead of painted "
                    "stand-ins. Never for the README copy: those images stay out of the repository")
    ap.add_argument("--only", help="record only some groups, comma separated (find, tower, fit, decide, phone, night): to try a scene")
    ap.add_argument("--from-master", type=Path, help="skip recording: make the two outputs again from a kept joined.mp4")
    args = ap.parse_args()
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is needed")
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="as-walk-"))
    try:
        if args.from_master:
            joined = args.from_master
        else:
            for attempt in range(1, args.attempts + 1):
                t0 = time.time()
                try:
                    rec = asyncio.run(record(args.root, args.port, tmp, args))
                    break
                except TooSlow as e:
                    print(f"attempt {attempt}: {e}; the machine is too busy, trying again", flush=True)
            else:
                raise SystemExit("the machine stayed too busy for a smooth recording; try again when it is quieter")
            print(f"recorded in {time.time() - t0:.0f}s")
            joined = encode(rec, tmp)
        finish(joined, tmp, args.out / "walkthrough.mp4", args.out / "walkthrough.webp", args)
    finally:
        if args.keep:
            shutil.copytree(tmp, args.keep, dirs_exist_ok=True)
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
