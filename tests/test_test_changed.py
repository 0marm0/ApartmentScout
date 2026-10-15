"""scripts/test_changed.py maps changed paths to the tests that cover them; the mapping table must not rot."""
from __future__ import annotations

import fnmatch
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def tc():
    spec = importlib.util.spec_from_file_location("test_changed_script", ROOT / "scripts" / "test_changed.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["test_changed_script"] = mod
    spec.loader.exec_module(mod)
    return mod


def _repo_files() -> list[str]:
    out = []
    for top in ("dashboard", "landing", "scripts"):
        out += [str(p.relative_to(ROOT)) for p in (ROOT / top).rglob("*") if p.is_file() and "node_modules" not in p.parts]
    return out


def test_every_rule_names_browser_files_that_exist(tc) -> None:
    for pattern, stems in tc.E2E_RULES:
        for stem in stems:
            assert (ROOT / "tests" / "e2e" / f"test_{stem}.py").is_file(), f"{pattern} -> test_{stem}.py does not exist"


def test_every_rule_matches_something_in_the_repository(tc) -> None:
    files = _repo_files()
    dead = [pattern for pattern, _ in tc.E2E_RULES if not any(fnmatch.fnmatch(f, pattern) for f in files)]
    assert not dead, f"rules that match no file (renamed or removed?): {dead}"


def test_every_browser_file_is_reachable_from_some_change(tc) -> None:
    """A browser file no change can select would only ever run in CI; each is named by a rule, or runs when its own file changes."""
    named = {f"tests/e2e/test_{stem}.py" for _, stems in tc.E2E_RULES for stem in stems}
    unreachable = [str(p.relative_to(ROOT)) for p in tc.e2e_test_files() if str(p.relative_to(ROOT)) not in named]
    # boot_recovery, onboarding etc. are selected by the files they name; the plan must pick up every file for the app shell
    plan = tc.plan_for(["dashboard/js/app.js"])
    assert set(plan.e2e) == {str(p.relative_to(ROOT)) for p in tc.e2e_test_files()}, "a change to the app shell runs every browser file"
    for f in unreachable:
        probe = tc.plan_for([f])
        assert f in probe.e2e, f"{f} is selected by nothing"


@pytest.mark.parametrize("changed,kind,expected", [
    ("dashboard/js/features/lightbox.js", "e2e", "tests/e2e/test_lightbox.py"),
    ("dashboard/js/features/places-geo.js", "e2e", "tests/e2e/test_places_multidest.py"),
    ("dashboard/js/city3d/facade.js", "e2e", "tests/e2e/test_buildings3d.py"),
    ("dashboard/js/state-guard.js", "e2e", "tests/e2e/test_boot_recovery.py"),
    ("dashboard/js/wizard-steps.js", "e2e", "tests/e2e/test_wizard.py"),
    ("landing/index.html", "e2e", "tests/e2e/test_landing_page.py"),
    ("apartmentscout/geo/site.py", "unit", "tests/test_sitemodel.py"),
    ("apartmentscout/localapi.py", "e2e", "tests/e2e/test_wizard.py"),
    ("tests/e2e/test_pwa.py", "e2e", "tests/e2e/test_pwa.py"),
    ("tests/test_green.py", "unit", "tests/test_green.py"),
    ("tests/js/photos.test.mjs", "js", "tests/js/photos.test.mjs"),
])
def test_a_change_selects_the_tests_that_cover_it(tc, changed: str, kind: str, expected: str) -> None:
    plan = tc.plan_for([changed])
    assert expected in getattr(plan, kind), (changed, sorted(getattr(plan, kind))[:10])


def test_the_browser_helpers_and_unknown_dashboard_files_run_every_browser_file(tc) -> None:
    every = {str(p.relative_to(ROOT)) for p in tc.e2e_test_files()}
    assert set(tc.plan_for(["tests/e2e/conftest.py"]).e2e) == every
    assert set(tc.plan_for(["dashboard/js/features/a-file-no-rule-names.js"]).e2e) == every


def test_docs_and_templates_select_nothing(tc) -> None:
    plan = tc.plan_for(["docs/guides/dashboard.md", "templates/research-note.md"])
    assert not plan.e2e and not plan.js


def test_a_package_module_nobody_tests_runs_the_whole_unit_suite(tc, tmp_path, monkeypatch) -> None:
    plan = tc.plan_for(["apartmentscout/config.py"])
    assert set(plan.unit) == {str(p.relative_to(ROOT)) for p in tc.unit_test_files()}
