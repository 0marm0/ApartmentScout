#!/usr/bin/env python3
"""Run the tests that cover what you changed, in parallel.

    python scripts/test_changed.py              # changes since main (committed, staged, unstaged and new files)
    python scripts/test_changed.py --list       # only print which tests would run, and why
    python scripts/test_changed.py --base HEAD~3
    python scripts/test_changed.py --paths dashboard/js/features/lightbox.js apartmentscout/geo/site.py
    python scripts/test_changed.py --no-e2e     # unit and JavaScript tests only
    python scripts/test_changed.py --all        # everything (what CI runs)

How a path becomes tests:

* ``apartmentscout/**/*.py``: the unit tests (and e2e files) whose source names that module. The few modules everything
  imports (cli, config, listings ...) run the whole unit suite.
* ``dashboard/**``: the JavaScript tests that name the file, and the browser (e2e) files listed in ``E2E_RULES`` below for that
  part of the dashboard. A dashboard path that is in no rule, or one the whole app depends on (app.js, index.html, tokens),
  runs every browser file: when unsure, it runs the shard.
* ``tests/**``: a changed test file runs itself; a changed ``conftest.py`` or helper runs that whole class of tests.
* ``scripts/``, ``landing/``, ``config/``, ``examples/``, ``pyproject.toml``, the workflow: the tests that name the file, or the
  whole unit suite.
* docs and templates: nothing, unless a test names the file.

The unit tests run under pytest-xdist, the browser files under ``-n`` workers (one Chromium and one server per worker), and the
JavaScript tests with ``node --test``; the three groups run side by side. Exit status is non-zero when anything failed.
CI runs the full suite; this is the quick check before you commit.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
E2E_DIR = TESTS / "e2e"
JS_DIR = TESTS / "js"

# ---------------------------------------------------------------------------------------------------------- the mapping
# Dashboard path (fnmatch against the path relative to the repository, '/' separators) -> e2e file stems (test_<stem>.py).
# First match adds its files; every matching rule is used, so a general rule can sit after a specific one.
E2E_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("dashboard/js/city3d/*", ("buildings3d", "context3d", "one_city", "interior_view", "model_project", "eye_level_look", "daycycle", "quality3d", "finishes_render")),
    ("dashboard/js/room3d/*", ("interior_view", "one_city", "lighting", "model_project", "placement_walk", "furniture_studio", "measure", "fit_check", "pair3d", "view_match", "finishes_render", "quality3d", "eye_level_look", "daycycle")),
    ("dashboard/js/plan/*", ("lighting", "model_project", "interior_view", "plan_upload", "pdf_tracer", "one_city", "context3d", "buildings3d", "placement_walk", "furniture_studio", "measure", "fit_check", "pair3d", "view_match", "finishes_render", "quality3d", "eye_level_look", "daycycle")),
    ("dashboard/js/plan3d.js", ("interior_view", "one_city", "model_project", "lighting", "context3d", "placement_walk", "furniture_studio", "measure", "fit_check", "pair3d", "view_match", "finishes_render", "quality3d", "eye_level_look", "daycycle")),
    ("dashboard/js/unit/*", ("model_project", "buildings3d", "context3d", "one_city", "interior_view", "lighting", "placement_walk", "furniture_studio", "measure", "fit_check", "pair3d", "view_match", "finishes_render", "quality3d", "eye_level_look", "daycycle")),
    ("dashboard/js/unit3d.js", ("model_project", "buildings3d", "context3d", "one_city", "interior_view", "lighting", "dashboard", "placement_walk", "furniture_studio", "measure", "fit_check", "pair3d", "view_match", "finishes_render", "quality3d", "eye_level_look", "daycycle")),
    ("dashboard/js/sun.js", ("map_features", "lighting", "model_project", "buildings3d")),
    ("dashboard/js/map.js", ("map_features", "map_clusters", "dashboard", "places_multidest", "decision")),
    ("dashboard/js/features/map-features.js", ("map_features",)),
    ("dashboard/js/features/route-*", ("map_features",)),
    ("dashboard/js/features/lens-logic.js", ("map_features",)),
    ("dashboard/js/features/split-view.js", ("map_features", "dashboard")),
    ("dashboard/js/features/dest-pin-style.js", ("map_features", "places_multidest")),
    ("dashboard/js/features/places*", ("places_multidest",)),
    ("dashboard/js/features/multidest*", ("places_multidest",)),
    ("dashboard/js/features/filter-*", ("results_rail", "places_multidest")),
    ("dashboard/js/features/virtual-model.js", ("results_rail",)),
    ("dashboard/js/features/card-list.js", ("results_rail",)),
    ("dashboard/js/features/density.js", ("results_rail",)),
    ("dashboard/js/features/price-*", ("results_rail",)),
    ("dashboard/js/features/rank-*", ("results_rail",)),
    ("dashboard/js/features/rescore-*", ("results_rail", "tour_findings")),
    ("dashboard/js/features/rail-sections.js", ("results_rail",)),
    ("dashboard/js/features/results.js", ("results_rail",)),
    ("dashboard/js/features/golden*", ("shell_extras",)),
    ("dashboard/js/features/lightbox.js", ("lightbox",)),
    ("dashboard/js/features/photos.js", ("lightbox", "media_tiers")),
    ("dashboard/js/features/media*", ("lightbox", "media_tiers")),
    ("dashboard/js/features/lqip.js", ("lightbox", "media_tiers")),
    ("dashboard/js/features/morph.js", ("lightbox",)),
    ("dashboard/js/features/tradeoff*", ("decision",)),
    ("dashboard/js/features/tray*", ("decision",)),
    ("dashboard/js/features/share*", ("decision", "tour_findings")),
    ("dashboard/js/features/decision*", ("decision", "tour_findings")),
    ("dashboard/js/features/tour-*", ("decision", "tour_findings", "tourday", "office_questions")),
    ("dashboard/js/features/visit*", ("tour_findings", "decision", "tourday")),
    ("dashboard/js/features/findings-*", ("tour_findings",)),
    ("dashboard/js/features/undo*", ("shell_extras",)),
    ("dashboard/js/features/chords.js", ("shell_extras",)),
    ("dashboard/js/features/keys.js", ("shell_extras", "menu_nav")),
    ("dashboard/js/features/shortcuts.js", ("shell_extras", "menu_nav")),
    ("dashboard/js/features/cheatsheet.js", ("shell_extras",)),
    ("dashboard/js/features/coach*", ("shell_extras",)),
    ("dashboard/js/features/comfort*", ("shell_extras", "dashboard")),
    ("dashboard/js/features/empty.js", ("shell_extras",)),
    ("dashboard/js/features/plan-empty.js", ("shell_extras",)),
    ("dashboard/js/features/nl*", ("shell_extras",)),
    ("dashboard/js/features/palette-actions.js", ("shell_extras", "dashboard")),
    ("dashboard/js/features/settings-menu.js", ("menu_nav", "shell_extras")),
    ("dashboard/js/features/render-*", ("lighting", "buildings3d", "context3d")),
    ("dashboard/js/features/daylight-core.js", ("lighting", "model_project")),
    ("dashboard/js/app-menu.js", ("menu_nav", "shell_extras")),
    ("dashboard/js/settings.js", ("menu_nav", "shell_extras", "dashboard")),
    ("dashboard/js/palette.js", ("shell_extras", "dashboard")),
    ("dashboard/js/wizard*", ("wizard", "onboarding")),
    ("dashboard/js/onboarding.js", ("onboarding", "wizard")),
    ("dashboard/js/local-api.js", ("wizard", "onboarding", "plan_upload", "tour_findings")),
    ("dashboard/js/tours.js", ("tour_findings", "decision", "tourday", "office_questions", "moves_unknowns")),
    ("dashboard/js/criteria.js", ("results_rail", "wizard", "onboarding")),
    ("dashboard/js/records.js", ("dashboard",)),
    ("dashboard/js/research.js", ("dashboard", "lightbox", "media_tiers")),
    ("dashboard/js/research/*", ("dashboard", "lightbox", "media_tiers")),
    ("dashboard/js/records/*", ("dashboard",)),
    ("dashboard/js/compare.js", ("dashboard",)),
    ("dashboard/js/list.js", ("dashboard", "results_rail")),
    ("dashboard/js/views/*", ("dashboard",)),
    ("dashboard/js/enhance.js", ("dashboard", "shell_extras")),
    ("dashboard/js/state-guard.js", ("boot_recovery",)),
    ("dashboard/js/sync/*", ("device_sync", "tour_findings", "menu_nav")),
    ("dashboard/css/sync.css", ("device_sync",)),
    ("dashboard/js/pwa*.js", ("pwa", "boot_recovery")),
    ("dashboard/js/perf/*", ("pwa", "boot_recovery", "dashboard")),
    ("dashboard/sw.js", ("pwa",)),
    ("dashboard/manifest.webmanifest", ("pwa",)),
    ("dashboard/assets/pwa/*", ("pwa", "landing_page")),
    ("dashboard/vendor/*", ("pdf_tracer", "plan_upload", "pwa")),
    ("dashboard/studios.html", ("pwa",)),
    ("dashboard/css/wizard.css", ("wizard", "onboarding")),
    ("dashboard/css/results-rail.css", ("results_rail",)),
    ("dashboard/css/media.css", ("lightbox", "media_tiers")),
    ("dashboard/css/map-features.css", ("map_features",)),
    ("dashboard/css/multidest.css", ("places_multidest",)),
    ("dashboard/css/tour-*", ("tour_findings", "decision")),
    ("dashboard/css/visit.css", ("tour_findings",)),
    ("dashboard/css/tradeoff.css", ("decision",)),
    ("dashboard/css/tray.css", ("decision",)),
    ("dashboard/css/share.css", ("decision",)),
    ("dashboard/css/coach.css", ("shell_extras",)),
    ("dashboard/css/cheatsheet.css", ("shell_extras",)),
    ("dashboard/css/comfort.css", ("shell_extras",)),
    ("dashboard/css/accents.css", ("shell_extras", "dashboard")),
    ("dashboard/css/empty.css", ("shell_extras",)),
    ("dashboard/css/nlsearch.css", ("shell_extras",)),
    ("dashboard/css/appmenu.css", ("menu_nav",)),
    ("dashboard/css/tabs.css", ("menu_nav", "dashboard")),
    ("dashboard/css/pwa.css", ("pwa",)),
    ("dashboard/css/split-view.css", ("map_features",)),
    ("landing/*", ("landing_page",)),
    ("scripts/landing_images.py", ("landing_page",)),
    ("scripts/optimize_site.py", ("pwa", "results_rail")),
    ("scripts/make_media_lite.py", ("media_tiers",)),
    ("scripts/build_site.sh", ("pwa",)),
]

# Dashboard files the whole app (every view) depends on, or that no rule above names: these run every browser file.
E2E_EVERYTHING = (
    "dashboard/index.html", "dashboard/js/app.js", "dashboard/js/shell.js", "dashboard/js/util.js", "dashboard/js/enhance.js",
    "dashboard/css/tokens.css", "dashboard/css/app.css", "dashboard/css/glass.css", "dashboard/css/a11y.css", "dashboard/css/shell.css",
    "dashboard/data/*", "dashboard/dist/*", "dashboard/js/features/index.js", "dashboard/js/features/dom.js",
)

# Python modules (relative to apartmentscout/) that nearly everything imports: a change runs the whole unit suite.
CORE_PY = ("__init__.py", "__main__.py", "cli.py", "config.py", "listings.py", "score.py", "scoring.py", "criteria.py", "util.py",
           "quality/common.py", "commands/__init__.py", "paths.py", "money.py")

# Files that mean "run all of it".
UNIT_EVERYTHING = ("tests/conftest.py", "pyproject.toml", "tests/fixtures/*", "tests/synthetic_*.py", "tests/osm_stub.py", "examples/*", "config/*")
JS_EVERYTHING = ("tests/js/index.js",)


@dataclass
class Plan:
    unit: dict[str, str] = field(default_factory=dict)   # test file -> why
    js: dict[str, str] = field(default_factory=dict)
    e2e: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def add(self, kind: str, path: Path | str, why: str) -> None:
        rel = str(path.relative_to(ROOT)) if isinstance(path, Path) else path
        getattr(self, kind).setdefault(rel, why)


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def unit_test_files() -> list[Path]:
    return sorted(TESTS.glob("test_*.py"))


def e2e_test_files() -> list[Path]:
    return sorted(E2E_DIR.glob("test_*.py"))


def js_test_files() -> list[Path]:
    return sorted(JS_DIR.glob("*.test.mjs"))


def _needles_for_python(rel: str) -> list[re.Pattern[str]]:
    """Patterns that a test file contains when it exercises apartmentscout/<rel>."""
    parts = Path(rel).with_suffix("").parts
    if parts[-1] == "__init__":
        parts = parts[:-1]
    dotted = ".".join(("apartmentscout", *parts))
    pats = [re.compile(rf"\b{re.escape(dotted)}\b")]
    if parts:
        pkg = ".".join(("apartmentscout", *parts[:-1]))
        name = parts[-1]
        # `from apartmentscout.geo import site, shapes` (also over several lines) and `from apartmentscout import cities`
        pats.append(re.compile(rf"from {re.escape(pkg)} import\s*\(?[^\n)]*\b{re.escape(name)}\b"))
        pats.append(re.compile(rf"from {re.escape(pkg)} import\s*\(\s*\n(?:[^)]*\n)*?[^)]*\b{re.escape(name)}\b"))
    return pats


def _matches(text: str, pats: list[re.Pattern[str]]) -> bool:
    return any(p.search(text) for p in pats)


def plan_for(paths: list[str]) -> Plan:
    plan = Plan()
    unit_all = e2e_all = js_all = False
    units, e2es, jss = unit_test_files(), e2e_test_files(), js_test_files()
    unit_text = {p: _read(p) for p in units}
    e2e_text = {p: _read(p) for p in e2es}
    js_text = {p: _read(p) for p in jss}

    for path in sorted(set(paths)):
        if path.startswith((".git/", "_reference/", "searches/")) or path == "HANDOFF.md":
            continue
        base = Path(path).name

        # ----- tests themselves
        if path.startswith("tests/e2e/"):
            if base.startswith("test_") and base.endswith(".py"):
                if (ROOT / path).is_file():
                    plan.add("e2e", path, f"changed: {path}")
            else:   # conftest.py, a shared helper, the vendored axe-core
                e2e_all = True
                plan.notes.append(f"{path}: a browser helper changed, every browser file runs")
            continue
        if path.startswith("tests/js/"):
            if base.endswith(".test.mjs") and (ROOT / path).is_file():
                plan.add("js", path, f"changed: {path}")
            elif _any_glob(path, JS_EVERYTHING) or not base.endswith(".test.mjs"):
                # a helper (emit-*.mjs ...): the JS tests that name it, and the Python tests that run it
                for p, t in js_text.items():
                    if base in t:
                        plan.add("js", p, f"names {base}")
                for p, t in unit_text.items():
                    if base in t:
                        plan.add("unit", p, f"names {base}")
                if _any_glob(path, JS_EVERYTHING):
                    js_all = True
            continue
        if path.startswith("tests/"):
            if base.startswith("test_") and base.endswith(".py") and (ROOT / path).is_file():
                plan.add("unit", path, f"changed: {path}")
            elif _any_glob(path, UNIT_EVERYTHING) or base in ("conftest.py",):
                unit_all = True
                plan.notes.append(f"{path}: a shared test helper changed, the whole unit suite runs")
            else:
                for p, t in unit_text.items():
                    if base in t or Path(path).stem in t:
                        plan.add("unit", p, f"names {base}")
            continue

        # ----- the Python package
        if path.startswith("apartmentscout/") and path.endswith(".py"):
            rel = path[len("apartmentscout/"):]
            if rel in CORE_PY:
                unit_all = True
                plan.notes.append(f"{path}: imported by nearly everything, the whole unit suite runs")
                for p, t in e2e_text.items():
                    if "apartmentscout" in t and _matches(t, _needles_for_python(rel)):
                        plan.add("e2e", p, f"imports {path}")
                continue
            pats = _needles_for_python(rel)
            hit = False
            for p, t in unit_text.items():
                if _matches(t, pats):
                    plan.add("unit", p, f"imports {path}")
                    hit = True
            for p, t in e2e_text.items():
                if _matches(t, pats):
                    plan.add("e2e", p, f"imports {path}")
            if not hit:
                unit_all = True
                plan.notes.append(f"{path}: no unit test names it, the whole unit suite runs")
            continue
        if path.startswith("apartmentscout/"):   # data files inside the package (templates, tables ...)
            unit_all = True
            plan.notes.append(f"{path}: package data, the whole unit suite runs")
            continue

        # ----- the dashboard
        if path.startswith("dashboard/"):
            if path.startswith(("dashboard/data-private/", "dashboard/_mockup/")):
                continue
            if _any_glob(path, E2E_EVERYTHING):
                e2e_all = True
                plan.notes.append(f"{path}: the whole app depends on it, every browser file runs")
            hit = False
            for pattern, stems in E2E_RULES:
                if fnmatch.fnmatch(path, pattern):
                    hit = True
                    for stem in stems:
                        f = E2E_DIR / f"test_{stem}.py"
                        if f.is_file():
                            plan.add("e2e", f, f"{pattern} -> test_{stem}.py")
            # the files that name it
            suffix = path[len("dashboard/"):]
            needle_js = path[len("dashboard/js/"):] if path.startswith("dashboard/js/") else None
            for p, t in e2e_text.items():
                if (needle_js and needle_js in t) or path in t or (suffix.startswith(("data/", "css/")) and Path(suffix).name in t):
                    plan.add("e2e", p, f"names {path}")
                    hit = True
            for p, t in js_text.items():
                if base in t and (needle_js is None or needle_js in t or base in t):
                    plan.add("js", p, f"names {base}")
            if not hit and not _any_glob(path, E2E_EVERYTHING):
                if path.endswith((".js", ".css", ".html", ".json", ".webmanifest")):
                    e2e_all = True
                    plan.notes.append(f"{path}: not in the mapping table, every browser file runs (add a rule to E2E_RULES)")
            for p, t in unit_text.items():
                if base in t and ("dashboard" in t):
                    plan.add("unit", p, f"names {base}")
            continue

        # ----- everything else: scripts, config, landing, workflows, packaging, docs
        if _any_glob(path, UNIT_EVERYTHING):
            unit_all = True
            plan.notes.append(f"{path}: shared input, the whole unit suite runs")
        hit = False
        for pattern, stems in E2E_RULES:
            if fnmatch.fnmatch(path, pattern):
                for stem in stems:
                    f = E2E_DIR / f"test_{stem}.py"
                    if f.is_file():
                        plan.add("e2e", f, f"{pattern} -> test_{stem}.py")
                        hit = True
        for p, t in unit_text.items():
            if path in t or (base in t and not base.startswith(".")):
                plan.add("unit", p, f"names {path}")
                hit = True
        for p, t in e2e_text.items():
            if path in t:
                plan.add("e2e", p, f"names {path}")
                hit = True
        for p, t in js_text.items():
            if path in t:
                plan.add("js", p, f"names {path}")
                hit = True
        if not hit and not path.endswith((".md", ".txt", ".png", ".jpg", ".webp", ".svg", ".gitignore")) and not path.startswith(("docs/", "templates/")):
            if path.startswith("scripts/"):
                unit_all = True
                plan.notes.append(f"{path}: no test names it, the whole unit suite runs")

    if unit_all:
        for p in unit_test_files():
            plan.add("unit", p, "whole unit suite")
    if js_all:
        for p in js_test_files():
            plan.add("js", p, "all JavaScript tests")
    if e2e_all:
        for p in e2e_test_files():
            plan.add("e2e", p, "every browser file")
    # the JS tests are cheap: any dashboard JS change runs them all (a few seconds) rather than guess from file names
    if any(p.startswith("dashboard/js/") and p.endswith(".js") for p in paths) and not js_all:
        for p in js_test_files():
            plan.add("js", p, "dashboard JS changed")
    return plan


def _any_glob(path: str, patterns: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(path, g) for g in patterns)


# ------------------------------------------------------------------------------------------------------------- git
def _git(*args: str) -> list[str]:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return [ln for ln in r.stdout.splitlines() if ln.strip()]


def changed_paths(base: str) -> list[str]:
    """Committed since `base` (merge-base), plus staged, unstaged and untracked files."""
    out: set[str] = set()
    ref = None
    for cand in (base, f"origin/{base}"):
        try:
            _git("rev-parse", "--verify", "--quiet", cand)
            ref = cand
            break
        except RuntimeError:
            continue
    if ref is None:
        raise SystemExit(f"test_changed: no such ref: {base} (use --base REF, or --all)")
    try:
        mb = _git("merge-base", ref, "HEAD")[0]
    except (RuntimeError, IndexError):
        mb = ref
    out.update(_git("diff", "--name-only", "--diff-filter=ACMRTD", f"{mb}..HEAD"))
    out.update(_git("diff", "--name-only", "--diff-filter=ACMRTD", "HEAD"))
    out.update(_git("ls-files", "--others", "--exclude-standard"))
    return sorted(out)


# ---------------------------------------------------------------------------------------------------------- running
def _has_xdist() -> bool:
    try:
        import xdist  # noqa: F401
        return True
    except ImportError:
        return False


@dataclass
class Job:
    name: str
    cmd: list[str]
    env: dict[str, str]
    log: Path
    proc: subprocess.Popen | None = None
    started: float = 0.0
    code: int | None = None
    seconds: float = 0.0


def build_jobs(plan: Plan, workers: int, logdir: Path) -> list[Job]:
    jobs: list[Job] = []
    env = dict(os.environ)
    cpus = os.cpu_count() or 2
    xdist = _has_xdist()
    # split the machine: browser files get most of it, the unit suite the rest
    e2e_workers = max(1, min(workers, len(plan.e2e) * 3)) if plan.e2e else 0
    unit_workers = max(1, min(max(2, cpus // 4), 8))
    if plan.unit:
        cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *sorted(plan.unit)]
        if xdist and len(plan.unit) > 1:
            cmd += ["-n", str(unit_workers)]
        e = {**env, "APARTMENTSCOUT_E2E": "0"}
        jobs.append(Job("unit", cmd, e, logdir / "unit.log"))
    if plan.js:
        node = shutil.which("node")
        if node:
            jobs.append(Job("js", [node, "--test", *sorted(plan.js)], env, logdir / "js.log"))
        else:
            plan.notes.append("node is not installed: the JavaScript tests were skipped")
    if plan.e2e:
        cmd = [sys.executable, "-m", "pytest", "-q", "-m", "e2e", "-p", "no:cacheprovider", "-rs", *sorted(plan.e2e)]
        if xdist and e2e_workers > 1:
            cmd += ["-n", str(e2e_workers), "--dist", "loadgroup"]
        jobs.append(Job("e2e", cmd, {**env, "APARTMENTSCOUT_E2E": "1"}, logdir / "e2e.log"))
    return jobs


def run_jobs(jobs: list[Job]) -> bool:
    for j in jobs:
        j.started = time.time()
        fh = j.log.open("w")
        j.proc = subprocess.Popen(j.cmd, cwd=ROOT, env=j.env, stdout=fh, stderr=subprocess.STDOUT)
        print(f"  started {j.name}: {' '.join(Path(c).name if c == sys.executable else c for c in j.cmd[:6])} ...", flush=True)
    pending = list(jobs)
    while pending:
        for j in list(pending):
            code = j.proc.poll()
            if code is not None:
                j.code, j.seconds = code, time.time() - j.started
                pending.remove(j)
                print(f"  {j.name}: {'ok' if code == 0 else 'FAILED'} in {j.seconds:.0f}s", flush=True)
        time.sleep(0.3)
    ok = all(j.code == 0 for j in jobs)
    for j in jobs:
        if j.code != 0:
            lines = j.log.read_text(errors="replace").splitlines()
            print(f"\n----- {j.name} (full log: {j.log})")
            print("\n".join(lines[-60:]))
        else:
            tail = j.log.read_text(errors="replace").strip().splitlines()
            if j.name == "js":   # node's TAP summary: "# tests N", "# pass N", "# fail N" ...
                counts = [ln[2:] for ln in tail if ln.startswith(("# tests", "# pass", "# fail", "# skipped"))]
                print(f"js: {', '.join(counts)}")
            else:
                print(f"{j.name}: {tail[-1] if tail else ''}")
    return ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="main", help="compare against this ref (default: main)")
    ap.add_argument("--paths", nargs="+", help="act as if these paths changed (no git)")
    ap.add_argument("--list", action="store_true", help="print the mapping and the commands, run nothing")
    ap.add_argument("--all", action="store_true", help="run every unit, JavaScript and browser test")
    ap.add_argument("--no-e2e", action="store_true", help="skip the browser files")
    ap.add_argument("-n", "--workers", type=int, default=0, help="browser workers (default: about half the cores, at most 8)")
    args = ap.parse_args(argv)

    if args.all:
        paths = ["tests/conftest.py", "tests/js/index.js", "tests/e2e/conftest.py"]
    elif args.paths:
        paths = args.paths
    else:
        paths = changed_paths(args.base)
    if not paths:
        print("test_changed: nothing changed since", args.base)
        return 0
    plan = plan_for(paths)
    if args.no_e2e:
        plan.e2e.clear()

    cpus = os.cpu_count() or 2
    workers = args.workers or max(1, min(8, cpus // 2))
    print(f"changed: {len(paths)} path(s)")
    for n in plan.notes:
        print("  note:", n)
    for kind in ("unit", "js", "e2e"):
        files = getattr(plan, kind)
        print(f"{kind}: {len(files)} file(s)")
        if args.list:
            for f, why in sorted(files.items()):
                print(f"    {f}   [{why}]")
    if not (plan.unit or plan.js or plan.e2e):
        print("nothing to run (docs and templates have no tests; CI still runs the full suite)")
        return 0
    logdir = Path(tempfile.mkdtemp(prefix="as-test-changed-"))
    jobs = build_jobs(plan, workers, logdir)
    if args.list:
        for j in jobs:
            print("  $", " ".join(j.cmd))
        return 0
    t0 = time.time()
    ok = run_jobs(jobs)
    print(f"\n{'all passed' if ok else 'FAILED'} in {time.time() - t0:.0f}s. The full suite runs in CI.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
