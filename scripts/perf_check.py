#!/usr/bin/env python3
"""Measure the dashboard's first load and check it against the performance budget.

    python scripts/perf_check.py --site _site                 # the published layout (landing page at /, dashboard at /demo/)
    python scripts/perf_check.py --standalone dist/x.html     # one self-contained file, opened from file://
    python scripts/perf_check.py --site _site --check         # also enforce scripts/perf_budget.json (CI)

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
            else ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
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
    a = ap.parse_args()
    if not a.site and not a.standalone:
        ap.error("give --site and/or --standalone")
    w, h = (int(x) for x in a.size.split("x"))
    from playwright.sync_api import sync_playwright
    budget = json.loads(BUDGET.read_text()) if BUDGET.exists() else {}
    results: dict[str, dict] = {}
    fails: list[str] = []
    media = ROOT / "examples" / "nyc-2026" / "media"
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
