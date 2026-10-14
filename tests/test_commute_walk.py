"""Street-grid walking metric, its use across the router, and feed configs copied whole by `init`."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest
import yaml

from apartmentscout.cli import main
from apartmentscout.commute.run import make_walker, walk_grids
from apartmentscout.commute.walk import GridArea, Walker

SPEED = 4.8 / 3.6
# a square "island" with avenues 30 degrees east of north
GRID = {"name": "Island", "bearing_deg": 30, "factor": 1.0, "blend": 1.0,
        "polygon": [[-74.02, 40.70], [-73.96, 40.70], [-73.96, 40.80], [-74.02, 40.80]]}


def _offset(lat: float, lon: float, bearing_deg: float, m: float) -> tuple[float, float]:
    t = math.radians(bearing_deg)
    return (lat + m * math.cos(t) / 110574, lon + m * math.sin(t) / (111320 * math.cos(math.radians(lat))))


def test_polygon_contains():
    g = GridArea.from_cfg(GRID)
    assert g.contains(40.75, -74.0) and not g.contains(40.75, -73.9)
    assert list(g.contains(np.array([40.75, 40.65]), np.array([-74.0, -74.0]))) == [True, False]
    assert GridArea.from_cfg({"bbox": [-74.02, 40.70, -73.96, 40.80]}).contains(40.75, -74.0)
    with pytest.raises(ValueError):
        GridArea.from_cfg({"name": "x"})


def test_grid_metric_depends_on_direction():
    w = Walker.from_cfg(SPEED, 1.25, [GRID])
    a = (40.75, -73.99)
    along = w.metres(*a, *_offset(*a, 30, 1000))       # straight up an avenue
    diagonal = w.metres(*a, *_offset(*a, 75, 1000))    # 45 degrees to the grid
    assert along == pytest.approx(1000, rel=0.01)
    assert diagonal == pytest.approx(1000 * math.sqrt(2), rel=0.01)
    blended = Walker.from_cfg(SPEED, 1.25, [{**GRID, "factor": 1.1, "blend": 0.5}])
    assert blended.metres(*a, *_offset(*a, 75, 1000)) == pytest.approx(1.1 * 1000 * (0.5 * math.sqrt(2) + 0.5),
                                                                        rel=0.01)


def test_falls_back_outside_or_across_areas():
    w = Walker.from_cfg(SPEED, 1.25, [GRID])
    a, out = (40.75, -73.99), (40.75, -73.90)          # second point is off the island
    straight = Walker(SPEED, 1.25, []).metres(*a, *out)
    assert w.metres(*a, *out) == pytest.approx(straight)
    b = _offset(40.65, -73.99, 30, 1000)                # both outside
    assert w.metres(40.65, -73.99, *b) == pytest.approx(1250, rel=0.01)
    many = w.metres_many(*a, np.array([out[0], _offset(*a, 30, 1000)[0]]),
                         np.array([out[1], _offset(*a, 30, 1000)[1]]))
    assert many[0] == pytest.approx(straight) and many[1] == pytest.approx(1000, rel=0.01)
    assert w.seconds(*a, *_offset(*a, 30, 1000)) == pytest.approx(1000 / SPEED, rel=0.01)


def test_walk_grids_from_city_profile_or_override():
    crit = {"search": {"city": "nyc"}, "commute": {"transit": {}}}
    grids = walk_grids(crit)
    assert grids and grids[0]["name"] == "Manhattan"
    w = make_walker(crit)
    assert w.area(40.7527, -73.9772) == 0           # Grand Central
    assert w.area(40.7595, -73.9509) == -1          # Roosevelt Island
    assert w.area(40.7440, -73.9500) == -1          # Long Island City
    off = {"search": {"city": "nyc"}, "commute": {"transit": {"walk_grids": False}}}
    assert walk_grids(off) == [] and make_walker(off).grids == []
    assert walk_grids({"search": {"city": "generic"}}) == []


def test_router_uses_the_grid_walker(tmp_path):
    from apartmentscout.commute.run import _Router, commute_entry
    dest = (40.75, -73.99)
    home = _offset(*dest, 210, 1500)                  # straight down an avenue
    w = Walker.from_cfg(SPEED, 1.25, [GRID])
    e = commute_entry(_Router(None, {}, dest, SPEED, 1.25, 1200, w), *home)
    assert e["modes"]["walk"]["m"] == pytest.approx(1500, abs=10)
    assert e["minutes"] == pytest.approx(1500 / SPEED / 60, abs=0.1)


def test_init_copies_feed_configs_whole(tmp_path):
    root = tmp_path / "s"
    main(["init", str(root), "--city", "nyc"])
    crit = yaml.safe_load((root / "criteria.yaml").read_text())
    feeds = crit["commute"]["transit"]["feeds"]
    prof = yaml.safe_load((Path(__file__).parents[1] / "config/cities/nyc.yaml").read_text())["transit_feeds"]
    assert feeds == prof
    assert any(f.get("exclude_routes") for f in feeds) and all(f.get("mode") for f in feeds)
