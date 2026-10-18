#!/usr/bin/env python3
"""Measure the dashboard's first load and check it against the performance budget.

    python scripts/perf_check.py --site _site                 # the published layout (landing page at /, dashboard at /demo/)
    python scripts/perf_check.py --standalone dist/x.html     # one self-contained file, opened from file://
    python scripts/perf_check.py --site _site --check         # also enforce scripts/perf_budget.json (CI)
    python scripts/perf_check.py --render --check             # the 3D views: draw calls, triangles and texture memory per quality level, desktop and a
                                                              # throttled phone, plus the automatic step-down (limits: the "render" block of perf_budget.json)

What it reports for each target (median of --runs cold loads, each in a fresh browser context):

* LCP, FCP and Total Blocking Time (sum of long-task time over 50 ms between FCP and the point the first result
  card is on screen plus a settle window), measured in Chromium with the CPU slowed by --cpu (default 4, a mid phone).
* transfer: the bytes that cross the wire. The static server below gzips text the way GitHub Pages does (Pages
  serves no precompressed .br/.gz of your own, only on-the-fly gzip), so the figure is what a visitor downloads.
* requests, JavaScript bytes (gzip) and the size of every data file the first screen fetches.

`--check` also enforces the static budgets (bundle, data and CSS sizes, gzip) that need no browser.
Only the Python standard library and Playwright are needed; nothing leaves this machine (every request that is
not for the local server is aborted, like the e2e suite does, so map tiles and remote photos do not count).
"""
from __future__ import annotations

import argparse
import gzip
import http.server
import json
import mimetypes
import statistics
import sys
import threading
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUDGET = ROOT / "scripts" / "perf_budget.json"
COMPRESSIBLE = (".html", ".js", ".mjs", ".css", ".json", ".svg", ".webmanifest", ".txt", ".xml")
GPU_ARGS = (["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] if sys.platform == "darwin"
            else ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
                  "--disable-gpu-rasterization"])   # page tiles and 2D canvases on the CPU, as tests/e2e/conftest.py does (SwiftShader raster kept the GPU process busy for minutes)
# a load is "done" for the purpose of TBT when the first result card is on screen and this long has passed
SETTLE_MS = 2500
NETWORKS = {   # latency ms, down bytes/s, up bytes/s (None = unthrottled)
    "none": None,
    "broadband": (20, 20 * 125_000, 10 * 125_000),   # 20 Mbit/s, 20 ms
    "4g": (150, 1_600_000 // 8, 750_000 // 8),       # Lighthouse "slow 4G"
}

INIT_JS = """
(() => {
  const m = window.__perf = { lcp: 0, lcpEl: '', fcp: 0, tasks: [], cardAt: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { m.lcp = e.startTime; m.lcpEl = (e.element && (e.element.id || e.element.className || e.element.tagName)) + ''; } })
        .observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') m.fcp = e.startTime; })
        .observe({ type: 'paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) m.tasks.push([e.startTime, e.duration]); })
        .observe({ type: 'longtask', buffered: true }); } catch {}
  const watch = () => { if (document.querySelector('#cards .card')) { m.cardAt = performance.now(); return; } requestAnimationFrame(watch); };
  addEventListener('DOMContentLoaded', watch);
})();
"""


class Site(http.server.ThreadingHTTPServer):
    """Static files with on-the-fly gzip (like GitHub Pages) and a per-request log of wire bytes."""
    allow_reuse_address = True
    request_queue_size = 128

    def __init__(self, root: Path, media: Path | None = None, gz: bool = True) -> None:
        self.root, self.media, self.gz = root.resolve(), media, gz
        self.log: list[tuple[str, int, int]] = []   # path, raw bytes, wire bytes
        self._cache: dict[Path, tuple[bytes, bytes]] = {}
        site = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a) -> None:
                pass

            def do_GET(self) -> None:
                path = urllib.parse.unquote(self.path.split("?", 1)[0].split("#", 1)[0])
                if path.endswith("/"):
                    path += "index.html"
                target = (site.root / path.lstrip("/")).resolve()
                if site.media and "/media/" in path:   # /media/ for a dashboard at the root, /demo/media/ under Pages
                    target = (site.media / path.split("/media/", 1)[1]).resolve()
                if not target.is_file() or (site.root not in target.parents and not (site.media and site.media in target.parents)):
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                raw = target.read_bytes()
                body, enc = raw, None
                if site.gz and target.suffix in COMPRESSIBLE and len(raw) > 512:
                    if target not in site._cache:
                        site._cache[target] = (raw, gzip.compress(raw, 6))
                    body, enc = site._cache[target][1], "gzip"
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
                self.send_header("Cache-Control", "max-age=600")   # what Pages sends
                self.send_header("Content-Length", str(len(body)))
                if enc:
                    self.send_header("Content-Encoding", enc)
                self.end_headers()
                self.wfile.write(body)
                site.log.append((path, len(raw), len(body)))

        super().__init__(("127.0.0.1", 0), H)
        if gz:
            self._prewarm()
        threading.Thread(target=self.serve_forever, daemon=True).start()

    def _prewarm(self) -> None:
        """Compress every text file once, in parallel (zlib releases the GIL), so a first request is not measured
        while the server is busy deflating an 8 MB JSON file."""
        from concurrent.futures import ThreadPoolExecutor

        def one(p: Path) -> None:
            raw = p.read_bytes()
            self._cache[p] = (raw, gzip.compress(raw, 6))
        files = [p for p in self.root.rglob("*") if p.is_file() and p.suffix in COMPRESSIBLE and p.stat().st_size > 512]
        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(one, files))

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


def measure_once(browser, url: str, origin: str | None, cpu: float, net: str, width: int, height: int, site: Site | None) -> dict:
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1, color_scheme="dark",
                              reduced_motion="reduce", service_workers="block")
    ctx.add_init_script(INIT_JS)
    if origin:
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((origin, "data:", "blob:")) else r.abort())
    else:
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(("file:", "data:", "blob:")) else r.abort())
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)[:200]))
    cdp = ctx.new_cdp_session(page)
    if cpu > 1:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu})
    if NETWORKS[net]:
        lat, down, up = NETWORKS[net]
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": lat, "downloadThroughput": down, "uploadThroughput": up})
    if site:
        site.log.clear()
    page.goto(url, wait_until="commit", timeout=120_000)
    page.wait_for_function("() => window.__perf && window.__perf.cardAt > 0", timeout=120_000)
    page.wait_for_timeout(SETTLE_MS)
    m = page.evaluate("() => ({ ...window.__perf, now: performance.now() })")
    # LCP is final once the user could interact; read the last candidate
    first = m["fcp"] or 0
    tbt = sum(max(0.0, d - 50) for s, d in m["tasks"] if s >= first)
    out = {"lcp": round(m["lcp"]), "fcp": round(first), "tbt": round(tbt), "ready": round(m["cardAt"]), "lcp_el": m["lcpEl"][:40], "errors": errors}
    if site:
        log = list(site.log)
        out["transfer"] = sum(w for _, _, w in log)
        out["requests"] = len(log)
        out["js"] = sum(w for p, _, w in log if p.endswith((".js", ".mjs")))
        out["data"] = sum(w for p, _, w in log if p.endswith(".json"))
        out["css"] = sum(w for p, _, w in log if p.endswith(".css"))
        out["big"] = sorted(((p, w) for p, _, w in log), key=lambda x: -x[1])[:8]
    ctx.close()
    return out


def static_sizes(dash: Path, dist: Path | None) -> dict:
    """Budgeted sizes that need no browser: gzip bytes, as a visitor downloads them."""
    gz = lambda p: len(gzip.compress(p.read_bytes(), 6))   # noqa: E731
    out: dict[str, int] = {}
    if dist and dist.is_dir():
        import re
        html = (dash / "index.html").read_text()
        first = re.findall(r'<script type="module" src="(dist/[^"]+)"|rel="modulepreload" href="(dist/[^"]+)"', html)
        out["first_js_gz"] = sum(gz(dash / (a or b)) for a, b in first)   # the entry and the chunks it imports: what the first screen runs
        out["all_js_gz"] = sum(gz(p) for p in dist.rglob("*.js"))
    data = dash / "data"
    if data.is_dir():
        out["listings_gz"] = gz(data / "listings.json") if (data / "listings.json").exists() else 0
        out["listings_raw"] = (data / "listings.json").stat().st_size if (data / "listings.json").exists() else 0
        out["data_first_gz"] = sum(gz(data / n) for n in ("listings.json", "criteria.json", "manifest.json", "notes.json") if (data / n).exists())
    built_css = sorted(dist.glob("styles-*.css")) if dist and dist.is_dir() else []
    out["css_gz"] = sum(gz(p) for p in (built_css or (dash / "css").rglob("*.css")))
    return out


# ------------------------------------------------------------------ the 3D views: per-device render budget (room3d/quality.js levels)
RENDER_UNIT = "paramount-tower-25e"
LEVEL_CONFIGS = [("fast", 0), ("fast", 5)] + [("visual", lv) for lv in range(6)]
RENDER_DEVICES = {
    # name: (Playwright device descriptor or None, viewport, device scale factor, default CPU slowdown)
    "desktop": (None, (1440, 900), 2, 1.0),
    "mobile": ("iPhone 13", (390, 844), 3, 6.0),
}
RENDER_VIEWS = ("unit", "studio")
RENDER_KEYS = ("draws", "triangles", "texture_mb")   # what scripts/perf_budget.json limits; the rest is logged

# The budget table counts draw calls, triangles and texture memory, which three.js tallies itself, so nothing needs to be rasterised: every WebGL
# call runs (contexts, shaders, buffers, textures) except the draws, which SwiftShader would spend seconds on per frame at 1440 x 900 x 2 (the step
# hung for 12 minutes on a CI runner). Same stub as tests/e2e/conftest.NO_RASTER_JS. The automatic step-down reads frame times and keeps real draws.
NO_RASTER_JS = """(() => { for (const C of [self.WebGL2RenderingContext, self.WebGLRenderingContext]) { if (!C) continue;
  for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) if (C.prototype[k]) C.prototype[k] = function () {}; } })();"""

MEASURE_JS = """async ({ name, mode, level, frames, settle }) => {
  const q = window.__quality;
  q.setMode(mode, { persist: false }); q.pin(true); q.setLevel(level, 'manual');
  await new Promise((r) => setTimeout(r, settle));
  const ts = [];
  for (let i = 0; i < frames; i++) { q.kick(name); await new Promise((r) => requestAnimationFrame(r)); ts.push(performance.now()); }
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  return { b: q.budget()[name], median: d[Math.floor(d.length / 2)], p95: d[Math.min(d.length - 1, Math.floor(d.length * 0.95))], mode: q.mode, level: q.level };
}"""


def _render_context(browser, pw, origin: str, dev: str, cpu: float, store_visual: bool = False, no_raster: bool = False):
    desc, (w, h), dpr, _ = RENDER_DEVICES[dev]
    kw: dict = {}
    if desc:
        kw = {k: v for k, v in pw.devices[desc].items() if k != "default_browser_type"}
    kw.update(viewport={"width": w, "height": h}, device_scale_factor=dpr, color_scheme="dark", reduced_motion="reduce", service_workers="block")
    ctx = browser.new_context(**kw)
    if store_visual:   # a renter who chose Visual: the step-down has something to take away
        ctx.add_init_script("try { localStorage.setItem('as:render-quality', '\"visual\"'); } catch {}")
    if no_raster:
        ctx.add_init_script(NO_RASTER_JS)
        # the paintings' weave maps (and the museum scans) arrive a few at a time after the scene is up, each announced by `as-art-ready`;
        # the table is measured once they have all landed, or the first levels would miss their memory and the ladder would look as if it rose
        ctx.add_init_script("window.__artAt = performance.now(); addEventListener('as-art-ready', () => { window.__artAt = performance.now(); });")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((origin, "data:", "blob:")) else r.abort())
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)[:200]))
    if cpu > 1:
        ctx.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": cpu})
    return ctx, page, errors


def _open_view(page, origin: str, view: str) -> str:
    """Open Unit 3D's Inside camera or the studio's eye-level view in the window of the living room; returns the engine name."""
    if view == "unit":
        page.goto(f"{origin}/?mode=inside#unit/{RENDER_UNIT}")
        page.wait_for_function(
            "(id) => window.__unit3d && window.__unit3d.st.id === id && window.__unit3d.stage && window.__unit3d.stage.interior && window.__unit3d.views.length > 4 && document.getElementById('uLoad').hidden",
            arg=RENDER_UNIT, timeout=240_000)
        return "unit"
    page.goto(f"{origin}/#plan/{RENDER_UNIT}")
    page.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psLook .lk-chip')", timeout=240_000)
    page.click('#psMode [data-m="3d"]', timeout=180_000)
    # stand at the living room window: the shared city outside is drawn. The chips sit behind the view picker (open it first, as
    # tests/e2e/conftest.look_open does; on a phone they are always shown)
    page.evaluate("""() => { const h = document.querySelector('#psLook'), b = h && h.querySelector('.lk-pick');
      if (b && getComputedStyle(b).display !== 'none' && h.dataset.open !== '1') b.click(); }""")
    page.click("#psLook .lk-chip", timeout=180_000)
    page.wait_for_function("() => window.__plan3d.eye === 'eye' && window.__plan3d.hasCity", timeout=240_000)
    return "plan"


def render_budget_table(origin: str, devices: list[str], mobile_cpu: float, frames: int) -> dict:
    """{device: {view: {config: {draws, triangles, texture_mb, ...}}}} measured in Chromium (GPU where there is one); counts do not depend on the GPU."""
    from playwright.sync_api import sync_playwright
    out: dict = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=GPU_ARGS)
        for dev in devices:
            cpu = mobile_cpu if dev == "mobile" else RENDER_DEVICES[dev][3]
            out[dev] = {"cpu": cpu}
            for view in RENDER_VIEWS:
                ctx, page, errors = _render_context(browser, pw, origin, dev, cpu, no_raster=True)
                print(f"  opening {view} on {dev} ...", flush=True)
                name = _open_view(page, origin, view)
                print(f"  {view} on {dev} is open; measuring {len(LEVEL_CONFIGS)} levels", flush=True)
                page.wait_for_function("() => performance.now() - (window.__artAt || 0) > 4000", timeout=120_000, polling=500)
                page.wait_for_timeout(1500)
                rows: dict = {}
                for mode, level in LEVEL_CONFIGS:
                    page.evaluate("([m, l]) => { const q = window.__quality; q.setMode(m, { persist: false }); q.pin(true); q.setLevel(l, 'manual'); }", [mode, level])   # the same switch MEASURE_JS makes, early, so the paintings can be rebuilt
                    page.wait_for_timeout(1500)
                    page.wait_for_function("() => performance.now() - (window.__artAt || 0) > 3000", timeout=120_000, polling=500)   # and their textures have all arrived before they are counted
                    r = page.evaluate(MEASURE_JS, {"name": name, "mode": mode, "level": level, "frames": frames, "settle": int(1200 * max(1.0, cpu / 2))})
                    b = r["b"] or {}
                    rows[f"{mode}-L{level}"] = {
                        "draws": b.get("draws", 0), "triangles": b.get("triangles", 0), "texture_mb": round(b.get("textureMB", 0) + b.get("shadowMB", 0), 1),
                        "buffer_mb": b.get("bufferMB", 0), "pixel_ratio": b.get("pixelRatio", 0), "geometries": b.get("geometries", 0), "textures": b.get("textures", 0),
                        "frame_ms": round(r["median"], 1), "frame_p95_ms": round(r["p95"], 1)}
                out[dev][view] = rows
                if errors:
                    out[dev].setdefault("errors", []).extend(errors)
                ctx.close()
        browser.close()
    return out


def auto_step_down(origin: str, mobile_cpu: float, seconds: float = 40.0) -> dict:
    """A renter on a throttled phone who chose Visual: how far the automatic step-down goes and how long it takes. Not pinned."""
    from playwright.sync_api import sync_playwright
    res: dict = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=GPU_ARGS)
        for view in RENDER_VIEWS:
            ctx, page, errors = _render_context(browser, pw, origin, "mobile", mobile_cpu, store_visual=True)
            name = _open_view(page, origin, view)
            t0 = page.evaluate("() => performance.now()")
            timeline: list[list[float]] = []
            last = -1
            end = t0 + seconds * 1000
            while True:
                now, lv = page.evaluate("() => [performance.now(), window.__quality.level]")
                if lv != last:
                    timeline.append([round((now - t0) / 1000, 1), lv])
                    last = lv
                if now > end:
                    break
                page.wait_for_timeout(400)
            fin = page.evaluate("""async (name) => { const q = window.__quality, ts = [];
              for (let i = 0; i < 20; i++) { q.kick(name); await new Promise((r) => requestAnimationFrame(r)); ts.push(performance.now()); }
              const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); return { median: d[Math.floor(d.length / 2)], level: q.level, mode: q.mode, pinned: q.pinned }; }""", name)
            res[view] = {"timeline": timeline, "final_level": fin["level"], "frame_ms": round(fin["median"], 1), "mode": fin["mode"], "pinned": fin["pinned"], "errors": errors}
            ctx.close()
        browser.close()
    return res


def print_render_table(table: dict) -> None:
    for dev, d in table.items():
        print(f"\n== 3D budget: {dev}  (cpu x{d['cpu']:g})")
        for view in RENDER_VIEWS:
            if view not in d:
                continue
            print(f"  {'Unit 3D, Inside' if view == 'unit' else 'Studio, eye view with the city'}")
            print(f"    {'quality':<11}{'draws':>7}{'triangles':>11}{'tex+shadow MB':>15}{'buffer MB':>11}{'px ratio':>10}{'frame ms (p50 / p95)':>24}")
            for cfg, r in d[view].items():
                print(f"    {cfg:<11}{r['draws']:>7}{r['triangles']:>11,}{r['texture_mb']:>15.1f}{r['buffer_mb']:>11.1f}{r['pixel_ratio']:>10g}{r['frame_ms']:>14.1f} / {r['frame_p95_ms']:<6.1f}")


def check_render_budget(table: dict, budget: dict) -> list[str]:
    """The limits in perf_budget.json's `render` block, and the ladder itself: a lighter level must never cost more than the one above it."""
    fails: list[str] = []
    for dev, d in table.items():
        for view in RENDER_VIEWS:
            rows = d.get(view, {})
            for cfg, r in rows.items():
                for k, lim in budget.get("render", {}).get(dev, {}).get(view, {}).get(cfg, {}).items():
                    if k in RENDER_KEYS and r[k] > lim:
                        fails.append(f"render.{dev}.{view}.{cfg}.{k} = {r[k]:,} exceeds the budget {lim:,}")
            vis = [rows[f"visual-L{lv}"] for lv in range(6) if f"visual-L{lv}" in rows]
            for k in RENDER_KEYS:
                for a, b in zip(vis, vis[1:]):
                    if b[k] > a[k] * 1.02 + (1 if k == "draws" else 0):
                        fails.append(f"render.{dev}.{view}: {k} goes UP down the ladder ({a[k]} -> {b[k]}): a lighter level must not cost more")
                        break
            if rows.get("visual-L5") and rows.get("visual-L0") and rows["visual-L5"]["triangles"] >= rows["visual-L0"]["triangles"] and rows["visual-L5"]["texture_mb"] >= rows["visual-L0"]["texture_mb"]:
                fails.append(f"render.{dev}.{view}: the lightest level is no lighter than the full one")
        for e in d.get("errors", []):
            fails.append(f"render.{dev}: page error {e}")
    return fails


def run_render(a) -> int:
    """`--render`: serve dashboard/ (or --dashboard), measure the render budget table on each device and the automatic step-down on a throttled phone."""
    dash = (a.dashboard or ROOT / "dashboard").resolve()
    media = ROOT / "examples" / "nyc-2026" / "media"
    if not media.is_dir():
        media = ROOT / "examples" / "nyc-2026" / "media-lite"
    site = Site(dash, media, gz=False)
    devices = [d.strip() for d in a.devices.split(",") if d.strip()]
    table = {} if a.auto_only else render_budget_table(site.origin, devices, a.mobile_cpu, a.frames)
    print_render_table(table)
    results: dict = {"table": table}
    if "mobile" in devices and not a.no_auto:
        auto = auto_step_down(site.origin, a.mobile_cpu)
        results["auto"] = auto
        print(f"\n== automatic step-down: Visual on a phone, cpu x{a.mobile_cpu:g}, not pinned (level 0 = full)")
        for view, r in auto.items():
            steps = ", ".join(f"{t:g} s: level {lv}" for t, lv in r["timeline"])
            print(f"  {view:<7} {steps}; settled at level {r['final_level']}, frames {r['frame_ms']:g} ms")
    if a.json:
        a.json.write_text(json.dumps(results, indent=1, default=str))
    fails: list[str] = []
    if a.check:
        budget = json.loads(BUDGET.read_text()) if BUDGET.exists() else {}
        fails = check_render_budget(table, budget)
        for r in results.get("auto", {}).values():
            fails.extend(f"auto: page error {e}" for e in r["errors"])
    if fails:
        print("\nBUDGET FAILURES")
        for f in fails:
            print("  -", f)
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", type=Path, help="a published-layout folder (landing page at /, dashboard at /demo/)")
    ap.add_argument("--demo-path", default="/demo/", help="where the dashboard sits under --site")
    ap.add_argument("--standalone", type=Path, help="a standalone single-file dashboard, opened from file://")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--cpu", type=float, default=4.0, help="CPU slowdown (1 = none; 4 is about a mid phone)")
    ap.add_argument("--net", choices=list(NETWORKS), default="broadband")
    ap.add_argument("--size", default="1440x900", help="WxH viewport")
    ap.add_argument("--check", action="store_true", help="fail when a budget in scripts/perf_budget.json is exceeded")
    ap.add_argument("--json", type=Path, help="write the results here")
    ap.add_argument("--no-gzip", action="store_true")
    ap.add_argument("--render", action="store_true", help="the 3D views' per-device budget table (draw calls, triangles, texture memory per quality level) and the automatic step-down")
    ap.add_argument("--dashboard", type=Path, help="with --render: the dashboard folder to serve (default dashboard/)")
    ap.add_argument("--devices", default="desktop,mobile", help="with --render: desktop, mobile or both")
    ap.add_argument("--mobile-cpu", type=float, default=6.0, help="with --render: CPU slowdown of the mobile device (4 to 6 is a mid phone)")
    ap.add_argument("--frames", type=int, default=24, help="with --render: frames timed per quality level")
    ap.add_argument("--no-auto", action="store_true", help="with --render: skip the automatic step-down run")
    ap.add_argument("--auto-only", action="store_true", help="with --render: only the automatic step-down run (no budget table)")
    a = ap.parse_args()
    if a.render:
        return run_render(a)
    if not a.site and not a.standalone:
        ap.error("give --site and/or --standalone (or --render)")
    w, h = (int(x) for x in a.size.split("x"))
    from playwright.sync_api import sync_playwright
    budget = json.loads(BUDGET.read_text()) if BUDGET.exists() else {}
    results: dict[str, dict] = {}
    fails: list[str] = []
    media = ROOT / "examples" / "nyc-2026" / "media"
    if not media.is_dir():   # a checkout without the full set (it is in a release): the starter set answers /media/ too
        media = ROOT / "examples" / "nyc-2026" / "media-lite"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=GPU_ARGS)
        targets: list[tuple[str, str, str | None, Site | None, Path | None]] = []
        site = None
        if a.site:
            site = Site(a.site, media if not (a.site / "demo" / "media").is_dir() else None, gz=not a.no_gzip)
            targets.append(("site", site.origin + a.demo_path, site.origin, site, a.site / a.demo_path.strip("/")))
        if a.standalone:
            targets.append(("standalone", a.standalone.resolve().as_uri(), None, None, None))
        for name, url, origin, srv, dash in targets:
            runs = [measure_once(browser, url, origin, a.cpu, a.net if srv else "none", w, h, srv) for _ in range(a.runs)]
            res = {k: (round(statistics.median(r[k] for r in runs)) if isinstance(runs[0][k], (int, float)) else runs[0][k])
                   for k in runs[0] if k not in ("errors", "big", "lcp_el")}
            res["lcp_el"] = runs[-1]["lcp_el"]
            res["errors"] = sorted({e for r in runs for e in r["errors"]})
            if "big" in runs[-1]:
                res["big"] = runs[-1]["big"]
            if name == "standalone":
                res["file_bytes"] = a.standalone.stat().st_size
            if name == "site" and dash:
                dist = dash / "dist"
                res["static"] = static_sizes(dash, dist if dist.is_dir() else None)
            results[name] = res
            print(f"\n== {name}  {url}  (cpu x{a.cpu:g}, network {a.net if srv else 'file'}, median of {a.runs})")
            for k in ("lcp", "fcp", "tbt", "ready", "transfer", "requests", "js", "data", "css", "file_bytes"):
                if k in res:
                    unit = "ms" if k in ("lcp", "fcp", "tbt", "ready") else ("" if k == "requests" else " B")
                    print(f"  {k:<10}{res[k]:>12,}{unit}")
            print(f"  lcp element: {res['lcp_el']}")
            for p, wbytes in res.get("big", []):
                print(f"    {wbytes:>10,}  {p}")
            if res["errors"]:
                print("  PAGE ERRORS:", *res["errors"], sep="\n    ")
                fails.append(f"{name}: page errors")
            if "static" in res:
                print("  static (gzip):", ", ".join(f"{k}={v:,}" for k, v in res["static"].items()))
            if a.check:
                limits = budget.get(name, {})
                for k, lim in limits.items():
                    val = res.get(k, res.get("static", {}).get(k))
                    if val is not None and val > lim:
                        fails.append(f"{name}.{k} = {val:,} exceeds the budget {lim:,}")
        browser.close()
    if a.json:
        a.json.write_text(json.dumps(results, indent=1, default=str))
    if fails:
        print("\nBUDGET FAILURES")
        for f in fails:
            print("  -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
