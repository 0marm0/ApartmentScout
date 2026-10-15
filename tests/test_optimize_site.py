"""scripts/optimize_site.py: the served dashboard is bundled and split, its CSS merged in order, its data slimmed, and the
installable-app files are consistent. Needs Node for esbuild (npx, or ESBUILD=/path/to/esbuild); skipped without it."""
from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DASH = ROOT / "dashboard"

pytestmark = pytest.mark.skipif(not (os.environ.get("ESBUILD") or shutil.which("npx")), reason="Node (npx esbuild) is needed")


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> dict:
    spec = importlib.util.spec_from_file_location("optimize_site", ROOT / "scripts" / "optimize_site.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["optimize_site"] = mod
    spec.loader.exec_module(mod)
    demo = tmp_path_factory.mktemp("site") / "demo"
    shutil.copytree(DASH, demo, ignore=shutil.ignore_patterns("media", "dist"))
    info = mod.optimize(demo)
    return {"demo": demo, "info": info, "html": (demo / "index.html").read_text(), "mod": mod}


def test_the_page_loads_one_split_entry_instead_of_the_module_tree(built) -> None:
    html = built["html"]
    assert 'src="js/app.js"' not in html and re.search(r'<script type="module" src="dist/app-[A-Z0-9]+\.js">', html)
    assert html.count('rel="modulepreload"') >= 2, "the chunks the first screen imports are preloaded"
    assert '<script defer src="vendor/maplibre-gl/maplibre-gl.js">' in html, "MapLibre must not block the parser"
    assert 'rel="preload" href="vendor/fonts/Geist-Variable.woff2" as="font"' in html
    # the importmap still resolves three.js and pdf.js, which stay external
    assert '"three": "./vendor/three/three.module.min.js"' in html


def test_heavy_views_are_separate_chunks_that_the_first_screen_does_not_import(built) -> None:
    demo, info = built["demo"], built["info"]
    first = "\n".join((demo / "dist" / c).read_text() for c in info["static_chunks"])
    assert "three/addons/controls/OrbitControls.js" not in first and "pdfjs-dist" not in first
    assert not re.search(r'from"three"|import\("three"\)', first), "three.js loads with Unit 3D and the floor plan, not at start"
    first_kb = sum((demo / "dist" / c).stat().st_size for c in info["static_chunks"]) / 1024
    all_kb = sum(p.stat().st_size for p in (demo / "dist").rglob("*.js")) / 1024
    assert first_kb < 0.45 * all_kb, f"the first screen imports {first_kb:.0f} of {all_kb:.0f} KB of JavaScript"
    assert info["chunks"] >= 15
    # every lazily imported view of app.js has a chunk of its own
    names = {p.name.split("-")[0] for p in (demo / "dist" / "chunks").glob("*.js")}
    assert {"unit3d", "plan3d", "research", "compare", "wizard", "tours", "settings", "list"} <= names


def test_stylesheets_are_merged_in_order_and_the_view_ones_do_not_block(built) -> None:
    html, demo = built["html"], built["demo"]
    links = re.findall(r'<link rel="stylesheet" href="(dist/styles-[^"]+)"([^>]*)>', html)
    assert 4 <= len({h for h, _ in links}) <= 16, "50 stylesheets became a handful"   # one sheet per run of blocking or deferred files, in order
    deferred = [h for h, rest in links if 'media="print"' in rest and "onload" in rest]
    assert deferred and html.count("<noscript><link rel=\"stylesheet\"") == len(deferred), "each deferred sheet has a no-script copy"
    # the cascade is unchanged: the runs are numbered in document order, and every original file's longest class survives
    assert [int(re.search(r"styles-(\d+)-", h).group(1)) for h, _ in links] == sorted(int(re.search(r"styles-(\d+)-", h).group(1)) for h, _ in links)
    merged = "".join((demo / h).read_text() for h, _ in links)
    for href in re.findall(r'<link rel="stylesheet" href="(css/[^"]+)">', (DASH / "index.html").read_text()):
        src = re.sub(r"/\*.*?\*/", "", (DASH / href).read_text(), flags=re.S)
        names = re.findall(r"\.([a-z][\w-]{3,})", src)
        if not names:   # tokens.css is custom properties only
            continue
        longest = max(names, key=len)
        assert "." + longest in merged, f"{href}: .{longest} is missing from the merged CSS"
    assert "pwa-update" in merged


def test_boot_data_is_requested_before_any_code_and_listings_are_slimmed(built) -> None:
    html, demo = built["html"], built["demo"]
    assert html.index("window.__AS_EARLY") < html.index('<link rel="stylesheet"'), "a script after a blocking stylesheet would wait for it"
    for n in ("listings", "criteria", "manifest", "notes"):
        assert f"'data/{n}.json'" in html
    rows = json.loads((demo / "data" / "listings.json").read_text())
    assert rows and not any("legacy_score" in r or "commute_note" in r for r in rows)


def test_service_worker_precache_and_build_marker_agree(built) -> None:
    demo, info = built["demo"], built["info"]
    pre = json.loads((demo / "precache.json").read_text())
    assert pre["build"] == info["build"] and re.fullmatch(r"[0-9a-f]{12}", pre["build"])
    assert f"'{pre['build']}'" in (demo / "sw.js").read_text()
    assert f'<meta name="as-build" content="{pre["build"]}">' in built["html"]
    for u in [*pre["shell"], *pre["later"], *pre["data"]]:
        assert u == "./" or (demo / u).is_file(), u
    # every file the page and its CSS name is precached, so the first offline load has nothing to miss
    for href in re.findall(r'(?:href|src)="((?:dist|vendor|assets)/[^"]+)"', built["html"]):
        assert href in pre["shell"] or href == "assets/pwa/apple-touch-icon.png", href   # the home-screen icon is fetched only when saved


def test_the_build_id_is_stable_for_the_same_input_and_changes_with_it(built, tmp_path: Path) -> None:
    def build(edit: bool) -> str:
        demo = tmp_path / ("b" if edit else "a") / "demo"
        shutil.copytree(DASH, demo, ignore=shutil.ignore_patterns("media", "dist"))
        if edit:
            (demo / "data" / "criteria.json").write_text((demo / "data" / "criteria.json").read_text() + " ")
        return built["mod"].optimize(demo)["build"]
    same, other = build(False), build(True)
    assert same == built["info"]["build"], "the same files give the same build id, so a redeploy with no change shows no update prompt"
    assert other != same
