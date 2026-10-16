#!/usr/bin/env python3
"""Records the README walk-through: map -> a card -> its drawer -> Unit 3D -> inside the home -> walk to the window -> the night city.

It drives the real dashboard (the worked example) in Chromium and captures the page with the DevTools screencast (full-resolution
JPEG frames with timestamps), not a screen recording, so the picture stays crisp. Waits for loading are cut out and the scenes are
joined with short cross-fades. Nothing is drawn over the page: no cursor, no captions.

    git archive HEAD dashboard | tar -x -C /tmp/snap
    ln -s "$PWD/examples/nyc-2026/media-lite" /tmp/snap/dashboard/media-lite
    python scripts/record_walkthrough.py --root /tmp/snap/dashboard

Writes docs/images/walkthrough.webp (animated, for the README) and docs/images/walkthrough.mp4 (full quality, linked from it).
Needs: pip install playwright && playwright install chromium; ffmpeg on the PATH.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import functools
import http.server
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.async_api import Page, async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"
W, H, DPR = 1280, 800, 1.5
FPS = 30
LAPSE_STEP = 0.14      # seconds each step of the time-lapse is shown
FADE = 0.35            # seconds of cross-fade between scenes
UNIT = "paramount-tower-25e"
NO_TOUR = "(() => { try { localStorage.setItem('as:coach', JSON.stringify({done: true, at: '2026-10-01'})); } catch (e) {} })()"


# a slow turn of Unit 3D's orbit camera around its target
DRIFT = """(() => { const st = __unit3d.stage, c = st.controls.target, p = st.orbitCam.position, r = Math.hypot(p.x - c.x, p.z - c.z), a0 = Math.atan2(p.z - c.z, p.x - c.x),
  t0 = performance.now(); const tick = () => { const k = Math.min((performance.now() - t0) / 2600, 1), e = k * k * (3 - 2 * k), a = a0 + e * 0.8;
  p.x = c.x + r * Math.cos(a); p.z = c.z + r * Math.sin(a); st.controls.update(); st.dirty = true; if (k < 1) requestAnimationFrame(tick); }; tick(); })()"""


class Recorder:
    """Collects screencast frames into numbered scenes; frames that arrive while no scene is open are dropped."""

    def __init__(self, cdp) -> None:
        self.cdp = cdp
        self.scenes: list[list[tuple[float, bytes]]] = []
        self.ends: list[float] = []
        self.lapse: set[int] = set()   # scenes made of separate steps (a time-lapse): each step is shown for a short, even time
        self.open = False
        cdp.on("Page.screencastFrame", self._frame)

    def _frame(self, ev) -> None:
        if self.open:
            self.scenes[-1].append((time.time(), base64.b64decode(ev["data"])))   # arrival time: the frame metadata clock is not wall time
        asyncio.ensure_future(self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]}))

    async def start(self) -> None:
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 94, "everyNthFrame": 1})

    def begin(self) -> None:
        self.scenes.append([])
        self.open = True

    def end(self) -> None:
        self.open = False
        self.ends.append(time.time())


async def hold(page: Page, seconds: float) -> None:
    await page.wait_for_timeout(int(seconds * 1000))


class TooSlow(Exception):
    """The machine was too busy to draw a moving scene smoothly; the recording is thrown away and made again."""


async def scene(page: Page, rec: Recorder, seconds: float, action=None, min_fps: float = 0) -> None:
    """One scene of at least `seconds`, running `action` (a coroutine function) just after it starts; a slow action makes the scene longer.
    `min_fps` is the frame rate a moving scene must reach (TooSlow otherwise)."""
    rec.begin()
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


def encode(rec: Recorder, tmp: Path) -> Path:
    """The scenes as clips, joined with cross-fades into one near-lossless master."""
    clips: list[tuple[Path, float]] = []
    for i, frames in enumerate(rec.scenes):
        if len(frames) < 2:
            raise SystemExit(f"scene {i} captured {len(frames)} frames")
        d = tmp / f"s{i}"
        d.mkdir()
        lines = []
        frames = sorted(frames, key=lambda f: f[0])
        for j, (t, jpg) in enumerate(frames):
            (d / f"{j:05d}.jpg").write_bytes(jpg)
            nxt = frames[j + 1][0] if j + 1 < len(frames) else t + 1 / FPS
            if j + 1 == len(frames):
                tail = max(rec.ends[i] - t, 0.05) - 1 / FPS   # the last picture stays until the scene ends (added below: the concat demuxer would count it twice)
            if i in rec.lapse and j + 1 < len(frames):
                nxt = min(nxt, t + LAPSE_STEP)   # a slow step (the machine was busy) is not shown longer than a quick one
            lines.append(f"file '{d / f'{j:05d}.jpg'}'\nduration {max(nxt - t, 0.001):.4f}")
        lines.append(f"file '{d / f'{len(frames) - 1:05d}.jpg'}'")
        (d / "list.txt").write_text("\n".join(lines))
        clip = tmp / f"clip{i}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(d / "list.txt"), "-vf", f"fps={FPS},tpad=stop_mode=clone:stop_duration={tail:.3f},format=yuv420p",
                        "-c:v", "libx264", "-crf", "14", "-preset", "fast", str(clip)], check=True)
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


def finish(joined: Path, tmp: Path, out_mp4: Path, out_webp: Path, webp_width: int, webp_quality: int, webp_fps: int) -> None:
    """The two deliverables from the joined master: a 1440 px H.264 video, and an animated WebP (ffmpeg here has no WebP encoder, so
    the frames go through libwebp's img2webp)."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(joined), "-vf", "scale=1440:-2:flags=lanczos", "-c:v", "libx264", "-crf", "26", "-preset", "slow",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out_mp4)], check=True)
    frames = tmp / "webp-frames"
    frames.mkdir(exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(joined), "-vf", f"fps={webp_fps},scale={webp_width}:-2:flags=lanczos",
                    str(frames / "f%04d.png")], check=True)
    files = sorted(frames.glob("f*.png"))
    subprocess.run(["img2webp", "-lossy", "-q", str(webp_quality), "-m", "6", "-d", str(round(1000 / webp_fps)), "-loop", "0", *map(str, files), "-o", str(out_webp)],
                   check=True, capture_output=True)
    print(f"{out_mp4.name}: {out_mp4.stat().st_size / 1e6:.2f} MB, {out_webp.name}: {out_webp.stat().st_size / 1e6:.2f} MB ({len(files)} frames)")


async def record(root: Path, port: int, tmp: Path, args) -> Recorder:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a) -> None:
            pass

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
            page.on("pageerror", lambda e: print("page error:", str(e).splitlines()[0], file=sys.stderr))
            cdp = await ctx.new_cdp_session(page)
            rec = Recorder(cdp)
            await page.goto(base + "?layer=commute#map")
            await page.wait_for_function("() => !!window.__asMap && document.querySelector('#cards .card')", timeout=180000)
            await hold(page, 9)   # the basemap tiles and the commute bands paint
            await rec.start()
            await page.mouse.move(2, 2)

            # 1. the map: commute bands, a slow push in, then a card hover draws its route
            async def push_in() -> None:
                await page.evaluate("window.__asMap.easeTo({center: [-73.975, 40.7525], zoom: 12.6, duration: 2400})")
            await scene(page, rec, 2.6, push_in, min_fps=12)

            async def hover_card() -> None:
                await page.hover("#cards .card >> nth=0")
            await scene(page, rec, 1.6, hover_card)

            # 2. the card opens its drawer (photo, money, score), which then scrolls
            async def open_card() -> None:
                await page.click("#cards .card >> nth=0")
            await scene(page, rec, 2.0, open_card, min_fps=10)

            async def scroll_drawer() -> None:
                await page.evaluate("document.querySelector('#drawer .d-scroll').scrollTo({top: 330, behavior: 'smooth'})")
            await scene(page, rec, 2.0, scroll_drawer, min_fps=10)

            # 3. See inside: Unit 3D, the city around the building (the loading wait is cut out)
            await page.click("#drawer a.btn.primary:has-text('See inside')")
            await page.wait_for_function("() => window.__unit3d && window.__unit3d.stage && window.__unit3d.stage.scene", timeout=240000)
            # draw at full detail and never step down: the automatic "lighter mode" is for slow devices, and its note would sit over the view
            await page.evaluate("import('/js/room3d/quality.js').then((m) => m.quality.pin(true))")
            await page.add_style_tag(content=".rnq-auto { display: none !important; }")
            await hold(page, 6)

            async def orbit() -> None:
                await page.click("#uModes [data-mode=orbit]")
                await hold(page, 0.8)
                await page.evaluate(DRIFT)
            await scene(page, rec, 3.4, orbit, min_fps=12)

            # 4. inside: the living room with the renter's furniture, then walk to the window
            async def go_inside() -> None:
                await page.click("#uModes [data-mode=in]")
                await hold(page, 1.2)
                # choose the sofa view without opening the view menu, so no menu is drawn over the picture
                await page.evaluate("document.querySelector(\"[data-vp='seat:sofa']\").click()")
            await scene(page, rec, 3.2, go_inside)

            async def walk() -> None:
                await page.click("#uLook [data-act=to-window]")
                await page.wait_for_function("() => window.__unit3d.walk && window.__unit3d.walk.walking()", timeout=5000)
                await page.wait_for_function("() => !window.__unit3d.walk.walking()", timeout=30000)
            await scene(page, rec, 3.0, walk, min_fps=12)

            # 5. the same window as the day goes: the time slider's keys (the full stop key: a quarter of an hour) run the sun down to a night sky
            async def to_night() -> None:
                rec.lapse.add(len(rec.scenes) - 1)
                await page.mouse.move(2, 2)
                await page.evaluate("document.getElementById('uStrip').focus({preventScroll: true})")
                while await page.evaluate("window.__unit3d.st.min") < 1200:
                    await page.keyboard.press(".")
                    # let the new sky draw before the next step, so every step is a frame of the time-lapse
                    await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
                    await hold(page, 0.12)
                await hold(page, 1.3)   # stay in the night
            await scene(page, rec, 3.0, to_night)
            await rec.cdp.send("Page.stopScreencast")
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
    ap.add_argument("--width", type=int, default=960, help="width of the animated WebP")
    ap.add_argument("--quality", type=int, default=68, help="WebP quality 0-100")
    ap.add_argument("--fps", type=int, default=12, help="frame rate of the animated WebP")
    ap.add_argument("--attempts", type=int, default=6, help="how many times to record again when the machine is too busy for smooth motion")
    ap.add_argument("--keep", type=Path, help="keep the encoded intermediates (joined.mp4 is the master) in this folder")
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
        finish(joined, tmp, args.out / "walkthrough.mp4", args.out / "walkthrough.webp", args.width, args.quality, args.fps)
    finally:
        if args.keep:
            shutil.copytree(tmp, args.keep, dirs_exist_ok=True)
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
