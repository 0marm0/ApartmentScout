#!/usr/bin/env python3
"""Turn a copy of dashboard/ into the fast, installable build that GitHub Pages serves under /demo/.

    python scripts/optimize_site.py _site/demo

The folder is rewritten in place (pages.yml runs this after copying dashboard/ there; the source tree is never touched):

* JavaScript: esbuild bundles js/app.js with code splitting into dist/ (one entry, shared chunks, and one chunk per lazy
  view: Unit 3D, Floor plan, Research, Compare, Tours, the wizard, the lightbox, settings...). The page preloads the
  chunks the first screen needs and fetches the rest on demand. three.js and pdf.js stay external (the import map).
  The single-file build (`apartmentscout build --standalone`) keeps its one bundle: it inlines everything into one
  HTML file and has nowhere to put chunks.
* CSS: the 31 stylesheets become a handful of minified files in the original order (the cascade is unchanged). Files for
  views that are not on screen at first paint (compare, Unit 3D, floor plan, records, tours, research, the wizard,
  share, coach marks...) load without blocking the first render, at their original position in the document.
* MapLibre loads with `defer`, the Geist font the first screen uses is preloaded, and the data files the app needs
  to boot are requested by a tiny inline script before any code has downloaded (js/perf/early.js hands them over).
* data/listings.json is slimmed to the fields the dashboard reads (apartmentscout/slim.py).
* The installable app: precache.json lists the shell and the core data, and sw.js is stamped with a build id that is a
  hash of everything it lists, so every deploy that changes anything is a new version (and shows the update prompt).

Needs Node for esbuild (`npx --yes esbuild@0.24.0`, or set ESBUILD to a binary). No other dependency.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apartmentscout.slim import slim_listings  # noqa: E402

ESBUILD_VERSION = "0.24.0"
EXTERNALS = ["three", "three/addons/*", "pdfjs-dist", "pdfjs-dist/worker"]
# stylesheets of views and panels that are not on screen at first paint; they keep their place in the document but do not block it
DEFERRED_CSS = {
    "css/wizard.css", "css/views/compare.css", "css/views/unit.css", "css/views/plan.css", "css/views/tracer.css",
    "css/views/records.css", "css/views/tours.css", "css/views/research.css", "css/tradeoff.css", "css/share.css",
    "css/tour-plan.css", "css/cheatsheet.css", "css/coach.css", "css/pwa.css",
}
BOOT_DATA = ("listings", "criteria", "manifest", "notes", "lqip")          # fetched by the app at boot (js/app.js boot())
SW_DATA = BOOT_DATA + ("history",)


def esbuild_cmd() -> list[str]:
    env = os.environ.get("ESBUILD")
    if env:
        return [env]
    npx = shutil.which("npx")
    if not npx:
        sys.exit("optimize_site: Node is needed (npx esbuild). Install Node, or set ESBUILD to an esbuild binary.")
    return [npx, "--yes", f"esbuild@{ESBUILD_VERSION}"]


def run_esbuild(args: list[str], cwd: Path) -> bytes:
    p = subprocess.run([*esbuild_cmd(), *args], cwd=cwd, capture_output=True)
    if p.returncode:
        sys.exit(f"esbuild failed: {p.stderr.decode()[-1500:]}")
    return p.stdout


def sha(data: bytes, n: int = 8) -> str:
    return hashlib.sha1(data).hexdigest()[:n]


# ------------------------------------------------------------------ JavaScript
def build_js(demo: Path) -> tuple[str, list[str], list[str]]:
    """Bundle and split js/app.js. Returns (entry file, files the first screen imports statically, every output file)."""
    dist = demo / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    meta = demo / ".meta.json"
    run_esbuild(["js/app.js", "--bundle", "--splitting", "--format=esm", "--minify", "--target=es2020",
                 *[f"--external:{e}" for e in EXTERNALS], "--outdir=dist", "--entry-names=app-[hash]",
                 "--chunk-names=chunks/[name]-[hash]", f"--metafile={meta.name}"], demo)
    info = json.loads(meta.read_text())
    meta.unlink()
    outs = info["outputs"]
    entry = next(k for k, v in outs.items() if v.get("entryPoint") == "js/app.js")
    seen: list[str] = []

    def walk(k: str) -> None:
        if k in seen:
            return
        seen.append(k)
        for i in outs[k]["imports"]:
            if i["kind"] == "import-statement" and i["path"] in outs:
                walk(i["path"])
    walk(entry)
    rel = lambda k: Path(k).relative_to("dist").as_posix() if k.startswith("dist/") else k   # noqa: E731
    return rel(entry), [rel(k) for k in seen], sorted(rel(k) for k in outs)


# ------------------------------------------------------------------ CSS
def build_css(demo: Path, html: str) -> tuple[str, list[str]]:
    """Merge the stylesheet links into minified runs that keep the original order; deferred runs do not block rendering."""
    pat = re.compile(r'<link rel="stylesheet" href="(css/[^"]+)">\n?')
    hrefs = [m.group(1) for m in pat.finditer(html)]
    runs: list[tuple[bool, list[str]]] = []
    for h in hrefs:
        d = h in DEFERRED_CSS
        if runs and runs[-1][0] == d:
            runs[-1][1].append(h)
        else:
            runs.append((d, [h]))
    # one esbuild call minifies every run (a Node start-up costs seconds, so not one call per file)
    tmp = demo / ".css-runs"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    for i, (_, group) in enumerate(runs):
        (tmp / f"run{i + 1}.css").write_text("\n".join((demo / h).read_text() for h in group))
    run_esbuild([*(f".css-runs/run{i + 1}.css" for i in range(len(runs))), "--minify", "--outdir=.css-out"], demo)
    files: list[str] = []
    tags: list[str] = []
    for i, (deferred, _) in enumerate(runs):
        out = (demo / ".css-out" / f"run{i + 1}.css").read_bytes()
        name = f"dist/styles-{i + 1}-{sha(out)}.css"
        (demo / name).write_bytes(out)
        files.append(name)
        if deferred:   # fetched at low priority, applied on load; the <noscript> copy keeps a script-less page styled
            tags.append(f'<link rel="stylesheet" href="{name}" media="print" onload="this.media=\'all\'"><noscript><link rel="stylesheet" href="{name}"></noscript>')
        else:
            tags.append(f'<link rel="stylesheet" href="{name}">')
    shutil.rmtree(tmp)
    shutil.rmtree(demo / ".css-out")
    first, last = html.index(f'<link rel="stylesheet" href="{hrefs[0]}">'), html.rindex(f'<link rel="stylesheet" href="{hrefs[-1]}">')
    last_end = html.index("\n", last) + 1
    block = html[first:last_end]
    # every stylesheet link in the block is replaced; anything else sitting between them (nothing today) is kept after the runs
    leftover = pat.sub("", block)
    return html[:first] + "\n".join(tags) + "\n" + leftover + html[last_end:], files


# ------------------------------------------------------------------ HTML
def early_fetch(names: list[str]) -> str:
    items = ",".join(f"'data/{n}.json'" for n in names)
    return ("<script>/* [perf] start the boot data fetches before any code has downloaded; js/perf/early.js hands them to the app */"
            "(function(){if(/[?&]data=/.test(location.search))return;var E=window.__AS_EARLY={};"
            f"[{items}].forEach(function(p){{E[p]=fetch(p,{{cache:'no-cache'}}).then(function(r){{if(!r.ok)throw 0;return r.json()}});E[p].catch(function(){{}})}})}})();</script>")


def rewrite_html(demo: Path, entry: str, static_chunks: list[str], data_names: list[str]) -> tuple[str, list[str]]:
    html = (demo / "index.html").read_text()
    html, css_files = build_css(demo, html)
    old = '<script type="module" src="js/app.js"></script>'
    if old not in html:
        sys.exit("optimize_site: index.html no longer loads js/app.js as a module; update scripts/optimize_site.py")
    html = html.replace(old, f'<script type="module" src="dist/{entry}"></script>')
    html = html.replace('<script src="vendor/maplibre-gl/maplibre-gl.js"></script>', '<script defer src="vendor/maplibre-gl/maplibre-gl.js"></script>')
    preloads = [f'<link rel="modulepreload" href="dist/{c}">' for c in static_chunks if c != entry]
    preloads.append('<link rel="preload" href="vendor/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>')
    head_extra = early_fetch(data_names) + "\n" + "\n".join(preloads) + "\n"
    # before the first stylesheet: a script placed after a blocking stylesheet waits for it
    first_css = html.index('<link rel="stylesheet"')
    html = html[:first_css] + head_extra + html[first_css:]
    (demo / "index.html").write_text(html)
    return html, css_files


# ------------------------------------------------------------------ data and the service worker
def slim_data(demo: Path) -> None:
    p = demo / "data" / "listings.json"
    if p.exists():
        p.write_text(json.dumps(slim_listings(json.loads(p.read_text())), separators=(",", ":"), ensure_ascii=False))


def write_service_worker(demo: Path, outputs: list[str], css_files: list[str]) -> str:
    shell = ["./", "manifest.webmanifest", "assets/favicon.svg", "assets/pwa/favicon-32.png", "assets/pwa/favicon-32-light.png",
             *[f"dist/{o}" for o in outputs], *css_files,
             "vendor/fonts/geist.css", "vendor/fonts/Geist-Variable.woff2", "vendor/fonts/GeistMono-Variable.woff2",
             "vendor/maplibre-gl/maplibre-gl.css", "vendor/maplibre-gl/maplibre-gl.js"]
    later = ["vendor/three/three.module.min.js", *sorted(p.relative_to(demo).as_posix() for p in (demo / "vendor" / "three" / "addons").rglob("*.js"))]
    data = [f"data/{n}.json" for n in SW_DATA if (demo / f"data/{n}.json").exists()]
    man = demo / "data" / "manifest.json"
    if man.exists():
        data += [f"data/layers/{n}" for n in json.loads(man.read_text()).get("layers", []) if n.startswith("transit")]
    missing = [u for u in [*shell, *later, *data] if u != "./" and not (demo / u).is_file()]
    if missing:
        sys.exit(f"optimize_site: precache lists files that do not exist: {missing}")
    h = hashlib.sha1()
    for u in sorted({*shell, *later, *data} - {"./"}):
        h.update(u.encode())
        h.update((demo / u).read_bytes())
    h.update((demo / "index.html").read_bytes())
    build = h.hexdigest()[:12]
    sw = (demo / "sw.js").read_text()
    if "__AS_BUILD__" not in sw:
        sys.exit("optimize_site: sw.js has no __AS_BUILD__ placeholder")
    (demo / "sw.js").write_text(sw.replace("__AS_BUILD__", build))
    page = (demo / "index.html").read_text()
    # js/pwa.js registers the worker only for a build that carries this marker
    (demo / "index.html").write_text(page.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta name="as-build" content="{build}">', 1))
    (demo / "precache.json").write_text(json.dumps({"build": build, "shell": shell, "later": later, "data": data}, indent=1))
    return build


def optimize(demo: Path) -> dict:
    demo = demo.resolve()
    if not (demo / "index.html").is_file():
        sys.exit(f"optimize_site: {demo} has no index.html")
    if 'name="as-build"' in (demo / "index.html").read_text():
        sys.exit(f"optimize_site: {demo} is already optimised; run it on a fresh copy of dashboard/")
    slim_data(demo)
    entry, static_chunks, outputs = build_js(demo)
    data_names = [n for n in BOOT_DATA if (demo / f"data/{n}.json").exists()]
    _, css_files = rewrite_html(demo, entry, static_chunks, data_names)
    build = write_service_worker(demo, outputs, css_files)
    return {"build": build, "entry": entry, "chunks": len(outputs), "css": len(css_files), "static_chunks": static_chunks}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("demo", type=Path, help="a copy of dashboard/ to rewrite in place (for example _site/demo)")
    a = ap.parse_args()
    r = optimize(a.demo)
    print(f"optimized {a.demo}: build {r['build']}, entry dist/{r['entry']}, {r['chunks']} JS files "
          f"({len(r['static_chunks'])} on the first screen), {r['css']} CSS files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
