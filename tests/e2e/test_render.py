"""Photo-quality stills and a walk-through video of the unit, in a real browser (Chromium), in Unit 3D and in the Floor plan studio.

* "Render a photo": a still of the exact size asked for that is not empty (a real picture: it has detail, it is neither black nor white), made by progressive
  accumulation; the view, the render quality and the camera are as they were afterwards;
* "Make a video": the tour is recorded frame by frame; the blob is a WebM (or MP4), of the length asked for, with the duration in its header, 30 frames of
  pictures that differ, and the page is as it was (mode, time of day) afterwards; golden hour is picked from the sun on the date;
* the sheet: two buttons, the choices, a progress bar with Cancel, the result with Download, Escape closes it; on a phone it is a sheet at the bottom and
  nothing overflows.

Needs WebGL and MediaRecorder, otherwise skipped. The pictures are small and the videos a few seconds: software GL (CI) draws these in seconds, a Mac in a blink.
"""
from __future__ import annotations

import pytest
from conftest import frames, settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels except where a test says so: see conftest.NO_RASTER_JS

UNIT = "paramount-tower-25e"
SLOW = 120000
# what a picture of a room must look like: detail (the spread of its luminance), neither black nor white, no big flat black or white areas
STATS_JS = """(c) => { const g = c.getContext('2d'), w = c.width, h = c.height, d = g.getImageData(0, 0, w, h).data; let n = 0, s = 0, s2 = 0, dark = 0, bright = 0, R = 0, B = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { const i = (y * w + x) * 4, l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; R += d[i]; B += d[i + 2]; s += l; s2 += l * l; if (l < 8) dark++; if (l > 247) bright++; }
  const m = s / n; return { w, h, mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)), dark: dark / n, bright: bright / n, warm: R / Math.max(1, B) }; }"""


def _need(webgl: bool, pg=None) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser")
    if pg is not None and not pg.evaluate("() => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'"):
        pytest.skip("no MediaRecorder in this browser")


def _unit(s, query: str = "?mode=inside") -> None:
    s.page.goto(f"{s.origin}/{query}#unit/{UNIT}")
    s.page.wait_for_function(
        "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && document.getElementById('uLoad').hidden && !!window.__render",
        arg=UNIT, timeout=SLOW)
    s.page.evaluate("() => window.__quality.setDevice({ maxTexture: 1024 })")   # shadow maps of 1024 px: software GL (CI) blurs a 4096 px map for every frame of a photo
    settled(s.page, 20000, ticks=5)


def _studio(s) -> None:
    s.page.goto(f"{s.origin}/#plan/{UNIT}")
    s.page.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('.rnq') && !!window.__render && !!window.__render.plan", timeout=SLOW)
    s.page.evaluate("() => window.__quality.setDevice({ maxTexture: 1024 })")
    settled(s.page, 20000, ticks=4)


def _assert_a_picture(st: dict, w: int, h: int) -> None:
    assert (st["w"], st["h"]) == (w, h), st
    assert st["sd"] > 12, f"a flat picture: {st}"
    assert 20 < st["mean"] < 235, f"too dark or too bright: {st}"
    assert st["dark"] < 0.5 and st["bright"] < 0.7, f"mostly black or white: {st}"


@pytest.mark.no_raster(False)   # reads what WebGL drew
def test_a_photo_in_unit_3d_is_the_size_asked_for_and_a_real_picture(open_page, webgl: bool) -> None:
    _need(webgl)
    s = open_page("#map", width=1280, height=800)
    pg = s.page
    _unit(s)
    before = pg.evaluate("() => { const st = window.__unit3d.stage, r = st.renderer; return { mode: window.__quality.mode, pr: r.getPixelRatio(), w: r.domElement.width, h: r.domElement.height, busy: !!st.busy, cam: st.inEye.local.toArray(), fov: st.look.fov }; }")
    res = pg.evaluate("""async () => { const r = await window.__render.unit.photo({ width: 640, height: 320, seconds: 3, minSamples: 4, maxSamples: 6 });
      return { w: r.width, h: r.height, samples: r.samples, aborted: r.aborted, ms: r.ms, stats: (%s)(r.canvas) }; }""" % STATS_JS)
    assert res["samples"] >= 4 and not res["aborted"], res
    _assert_a_picture(res["stats"], 640, 320)
    assert (res["w"], res["h"]) == (640, 320)
    frames(pg, 3)
    after = pg.evaluate("() => { const st = window.__unit3d.stage, r = st.renderer; return { mode: window.__quality.mode, pr: r.getPixelRatio(), w: r.domElement.width, h: r.domElement.height, busy: !!st.busy, cam: st.inEye.local.toArray(), fov: st.look.fov }; }")
    assert after == before, (before, after)   # the page is as it was: the quality choice, the canvas, the camera
    assert not s.take()


@pytest.mark.no_raster(False)   # reads what WebGL drew
def test_a_second_photo_differs_when_the_light_does(open_page, webgl: bool) -> None:
    """Accumulation is of the view's own light: at night, with the lamps on, the same room is a warmer picture."""
    _need(webgl)
    s = open_page("#map", width=1280, height=800)
    pg = s.page
    _unit(s)
    js = """async (min) => { const r = document.querySelector('.rnq-dock-range'); r.value = String(min); r.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 600));
      const p = await window.__render.unit.photo({ width: 480, height: 240, seconds: 2, minSamples: 4, maxSamples: 6 }); return (%s)(p.canvas); }""" % STATS_JS
    day, night = pg.evaluate(js, 780), pg.evaluate(js, 1200)
    assert night["warm"] > day["warm"] + 0.08, (day, night)      # lamplight against daylight
    assert not s.take()


@pytest.mark.no_raster(False)   # reads what WebGL drew
def test_a_video_of_the_tour_records_with_its_type_length_and_distinct_frames(open_page, webgl: bool) -> None:
    s = open_page("#map", width=1280, height=800)
    pg = s.page
    _need(webgl, pg)
    _unit(s, "?mode=orbit")                      # started Outside: the tour needs the Inside camera, and the page must be Outside again afterwards
    before = pg.evaluate("() => ({ mode: window.__unit3d.st.mode, min: window.__unit3d.st.min, q: window.__quality.mode })")
    assert before["mode"] == "orbit"
    res = pg.evaluate("""async () => {
      const r = await window.__render.unit.video({ shot: 'tour', time: 'golden', seconds: 3, minSeconds: 3, fps: 10, res: 180, look: 'standard' });
      if (!r) return null;
      const url = URL.createObjectURL(r.blob), v = document.createElement('video'); v.src = url; v.muted = true; v.playsInline = true;
      await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('the video does not load')); });
      const seen = [], c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d');
      for (const t of [0.6, 1.4, 2.2, 3.0]) { v.currentTime = t; await new Promise((ok) => { v.onseeked = ok; }); g.drawImage(v, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; seen.push(Math.round(s / (d.length / 4) / 3)); }
      const bytes = new Uint8Array(await r.blob.arrayBuffer());
      return { type: r.type, ext: r.ext, size: r.blob.size, durationMs: r.durationMs, frames: r.frames, w: r.width, h: r.height, fps: r.fps, when: r.when, kind: r.seq.kind, videoDuration: v.duration, vw: v.videoWidth, vh: v.videoHeight, seen, head: Array.from(bytes.slice(0, 4)) };
    }""")
    assert res, "no video"
    assert res["type"].startswith(("video/webm", "video/mp4")) and res["ext"] in ("webm", "mp4"), res
    assert res["head"] == ([0x1A, 0x45, 0xDF, 0xA3] if res["ext"] == "webm" else res["head"]), res
    assert res["size"] > 4000 and res["frames"] == 30 and (res["w"], res["h"], res["fps"]) == (320, 180, 10), res
    assert (res["vw"], res["vh"]) == (320, 180), res
    assert 3000 <= res["durationMs"] <= 4200 and res["kind"] == "tour", res                  # 3 s of frames and the recorder's short lead
    assert res["videoDuration"] == res["videoDuration"] and abs(res["videoDuration"] - res["durationMs"] / 1000) < 0.6, res   # a finite length: the duration is in the header
    assert res["when"]["key"] == "golden" and 5 <= res["when"]["alt"] <= 9, res["when"]       # golden hour: the sun low (about 6.5 degrees), from the sun on this date
    assert len({*res["seen"]}) >= 2, f"the frames do not change: {res['seen']}"
    after = pg.evaluate("() => ({ mode: window.__unit3d.st.mode, min: window.__unit3d.st.min, q: window.__quality.mode, busy: !!window.__unit3d.stage.busy })")
    assert after == {**before, "busy": False}, (before, after)     # Outside again, at the time it was, in the quality it was
    assert not s.take()


def test_the_day_from_a_window_runs_the_sun_across_the_sky(open_page, webgl: bool) -> None:
    s = open_page("#map", width=1280, height=800)
    pg = s.page
    _need(webgl, pg)
    _unit(s)
    res = pg.evaluate("""async () => {
      const seq = await window.__render.unit.sequence({ shot: 'day', seconds: 4, fps: 10 });
      const r = await window.__render.unit.video({ shot: 'day', seconds: 8, fps: 5, res: 180, look: 'standard' });
      return { kind: seq.kind, n: seq.n, first: seq.minuteAt(0), last: seq.minuteAt(seq.n - 1), ok: !!r, frames: r && r.frames, type: r && r.type, dur: r && r.durationMs };
    }""")
    assert res["kind"] == "day" and res["n"] == 40 and res["first"] < 450 and res["last"] > 1100, res
    assert res["ok"] and res["frames"] == 40 and res["dur"] >= 8000, res
    assert not s.take()


@pytest.mark.no_raster(False)   # reads what WebGL drew
def test_photo_and_video_in_the_floor_plan_studio(open_page, webgl: bool) -> None:
    s = open_page("#map", width=1440, height=900)
    pg = s.page
    _need(webgl, pg)
    _studio(s)
    pg.click('#psCams [data-v="sofa"]')
    pg.wait_for_function("() => window.__plan3d.eye === 'eye'")
    photo = pg.evaluate("""async () => { const r = await window.__render.plan.photo({ width: 480, height: 300, seconds: 3, minSamples: 4, maxSamples: 6 }); return { w: r.width, h: r.height, stats: (%s)(r.canvas) }; }""" % STATS_JS)
    _assert_a_picture(photo["stats"], 480, 300)
    min0 = pg.evaluate("() => document.getElementById('pTime').value")
    vid = pg.evaluate("""async () => { const r = await window.__render.plan.video({ shot: 'tour', time: 'golden', seconds: 3, minSeconds: 3, fps: 10, res: 180, look: 'standard' });
      return r && { type: r.type, size: r.blob.size, frames: r.frames, durationMs: r.durationMs, alt: r.when.alt }; }""")
    assert vid and vid["type"].startswith(("video/webm", "video/mp4")) and vid["frames"] == 30 and vid["size"] > 3000 and 3000 <= vid["durationMs"] <= 4200, vid
    # the studio is as it was: the same camera, the same time, drawing again
    assert pg.evaluate("() => window.__plan3d.eye") == "eye" and pg.evaluate("() => document.getElementById('pTime').value") == min0
    frames(pg, 3)
    assert not s.take()


def test_the_sheet_walks_through_options_progress_result_and_cancel(open_page, webgl: bool) -> None:
    s = open_page("#map", width=1280, height=800)
    pg = s.page
    _need(webgl, pg)
    _unit(s)
    pg.evaluate("() => localStorage.setItem('as:render-sheet', JSON.stringify({ size: 'std', budget: 'quick', res: 720, seconds: 10 }))")
    pg.click('[data-rnd="photo"]')
    pg.wait_for_selector('.rnd-sheet [data-act="go"]')
    assert pg.get_attribute(".rnd-sheet", "role") == "dialog" and pg.get_attribute(".rnd-sheet", "aria-modal") == "true"
    assert pg.get_attribute('[data-seg="size"] [data-v="std"]', "aria-pressed") == "true"
    pg.click('[data-seg="budget"] [data-v="quick"]')
    pg.click('[data-act="go"]')
    pg.wait_for_selector(".rnd-fig img", timeout=SLOW)
    cap = pg.inner_text(".rnd-fig figcaption")
    assert "samples" in cap and "PNG" in cap and "JPEG" in cap, cap
    nat = pg.evaluate("() => { const i = document.querySelector('.rnd-fig img'); return [i.naturalWidth, i.naturalHeight]; }")
    assert nat[0] >= 960 and nat[1] >= 300, nat
    with pg.expect_download() as dl:
        pg.click('[data-act="dl-png"]')
    assert dl.value.suggested_filename.endswith(".png") and UNIT in dl.value.suggested_filename
    with pg.expect_download() as dl2:
        pg.click('[data-act="dl-jpg"]')
    assert dl2.value.suggested_filename.endswith(".jpg")
    pg.keyboard.press("Escape")
    pg.wait_for_selector(".rnd-sheet", state="detached")
    # a video: cancel while it works brings the choices back, and nothing is left behind
    pg.click('[data-rnd="video"]')
    pg.wait_for_selector('.rnd-sheet [data-act="go"]')
    assert pg.get_attribute('[data-seg="time"] [data-v="golden"]', "aria-pressed") == "true"       # golden hour is the default
    assert pg.get_attribute('[data-seg="shot"] [data-v="tour"]', "aria-pressed") == "true"
    pg.click('[data-seg="look"] [data-v="standard"]')
    pg.click('[data-act="go"]')
    pg.wait_for_selector(".rnd-prog progress")
    pg.click('[data-act="cancel"]')
    pg.wait_for_selector('.rnd-sheet [data-act="go"]', timeout=SLOW)
    assert pg.evaluate("() => !window.__unit3d.stage.busy")
    pg.click('.rnd-sheet [data-act="close"]')
    assert not s.take()


def test_on_a_phone_the_buttons_and_the_sheet_fit(open_page, webgl: bool) -> None:
    _need(webgl)
    s = open_page("#map", width=375, height=812)
    pg = s.page
    _unit(s)
    pg.evaluate("() => document.getElementById('stage').scrollIntoView({ block: 'start' })")
    for kind in ("photo", "video"):
        b = pg.locator(f'[data-rnd="{kind}"]')
        assert b.is_visible()
        box = b.bounding_box()
        assert box["width"] >= 28 and box["height"] >= 22 and box["x"] >= 0 and box["x"] + box["width"] <= 376, box
    pg.click('[data-rnd="photo"]')
    pg.wait_for_selector('.rnd-sheet [data-act="go"]')
    sh = pg.locator(".rnd-sheet").bounding_box()
    assert sh["x"] >= -1 and sh["x"] + sh["width"] <= 376 and sh["y"] + sh["height"] <= 813, sh
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert pg.locator('[data-seg="size"] [data-v="poster"]').count() == 0          # no 4-times poster on a phone
    for b in pg.locator(".rnd-sheet .rnd-seg button").all():
        assert b.bounding_box()["height"] >= 40
    go = pg.locator('[data-act="go"]').bounding_box()
    assert go["y"] + go["height"] <= 812
    pg.click('.rnd-sheet [data-act="close"]')
    pg.click('[data-rnd="video"]')
    pg.wait_for_selector('.rnd-sheet [data-act="go"]')
    assert pg.get_attribute('[data-seg="res"] [data-v="720"]', "aria-pressed") == "true"   # 720p on a phone
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert not s.take()
