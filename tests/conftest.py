"""Shared test setup: no test reaches the network for OpenStreetMap building parts or green space.

``make_site`` asks Overpass for ``building:part`` outlines and for parks and trees by default; tests that build
sites from stubbed footprints get no parts (every building stays a single prism) and no green space unless they
stub ``fetch_osm_parts`` / ``fetch_green`` themselves.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_city_lookups(monkeypatch):
    """The city lookup (Nominatim) and the transit-feed check are network calls too (cities.py): tests pass fakes or get nothing."""
    from apartmentscout import cities

    def offline(*a, **k):
        raise cities.requests.ConnectionError("offline in tests")

    monkeypatch.setattr(cities, "_http_json", offline)

    from apartmentscout import intake

    # `init` and the interview ask this for their lookups; offline it finds nothing and keeps what was typed
    monkeypatch.setattr(intake, "live_online", lambda: intake.Online(
        resolve_city=lambda q: None, geocode=lambda a, i: None,
        check_feed=lambda u: cities.FeedCheck(True, "offline in tests", None, False)))


@pytest.fixture(autouse=True)
def _no_osm_parts(monkeypatch):
    from apartmentscout.geo import components

    monkeypatch.setattr(components, "fetch_osm_parts", lambda *a, **k: [])


@pytest.fixture(autouse=True)
def _no_osm_green(monkeypatch):
    from apartmentscout.geo import green

    def offline(*a, **k):
        raise RuntimeError("offline in tests")

    monkeypatch.setattr(green, "fetch_green", offline)


@pytest.fixture(autouse=True)
def _no_census_or_water(monkeypatch):
    """The street tree census and the water polygons are network downloads too (geo/trees.py, geo/water.py)."""
    from apartmentscout.geo import trees, water

    def offline(*a, **k):
        raise RuntimeError("offline in tests")

    monkeypatch.setattr(trees, "fetch_census", offline)
    monkeypatch.setattr(water, "fetch_water", offline)


@pytest.fixture(autouse=True)
def _no_parks_or_forestry(monkeypatch):
    """NYC Parks Properties, Greenstreets and the Forestry Tree Points are network downloads too (geo/parks.py, geo/forestry.py)."""
    from apartmentscout.geo import forestry, parks

    def offline(*a, **k):
        raise RuntimeError("offline in tests")

    monkeypatch.setattr(parks, "fetch_parks", offline)
    monkeypatch.setattr(forestry, "fetch_rows", offline)


@pytest.hookimpl(optionalhook=True)   # a hook of pytest-xdist: harmless when it is not installed
def pytest_xdist_auto_num_workers(config) -> int:
    """What `pytest -n auto` means here: about three workers for every four cores, between 2 and 8. A browser test is CPU-bound (Chromium
    paints, runs WebGL and the page's scripts); with one worker per core plus whatever else the machine is doing, a page misses timeouts that
    it meets with room to spare on a quieter machine, and past 8 workers the unit suite only pays more start-up (numpy, matplotlib)."""
    import os
    return max(2, min(8, round((os.cpu_count() or 2) * 0.75)))


@pytest.fixture(scope="session")
def esbuild_ready() -> None:
    """Fill npm's npx cache with esbuild once, under a lock shared by every pytest-xdist worker (and by a unit run and a browser
    run side by side), before any test calls `npx --yes esbuild@...`: two npx processes installing into the same cache at the same
    time can corrupt it. Afterwards every call only reads the cache. Does nothing with ESBUILD set or without npx."""
    import os
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    if os.environ.get("ESBUILD") or not shutil.which("npx"):
        return
    try:
        import fcntl
    except ImportError:   # not POSIX: no lock, the old behaviour
        fcntl = None
    import re
    m = re.search(r'^ESBUILD_VERSION = "([^"]+)"', (Path(__file__).resolve().parents[1] / "scripts" / "optimize_site.py").read_text(), re.M)
    if not m:
        return
    version = m.group(1)   # the version the site build asks for
    with open(Path(tempfile.gettempdir()) / "apartmentscout-tests-npx.lock", "w") as fh:
        if fcntl:
            fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            subprocess.run(["npx", "--yes", f"esbuild@{version}", "--version"], capture_output=True, timeout=300)
        except (OSError, subprocess.SubprocessError):
            pass   # no network or no npx: the tests that need esbuild skip themselves
        finally:
            if fcntl:
                fcntl.flock(fh, fcntl.LOCK_UN)


@pytest.fixture(autouse=True)
def _no_search_from_the_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    """A test never inherits APARTMENTSCOUT_SEARCH from the shell: with it set, a test that falls back to the
    environment would write into a real search folder (it once edited examples/nyc-2026/criteria.yaml)."""
    monkeypatch.delenv("APARTMENTSCOUT_SEARCH", raising=False)
