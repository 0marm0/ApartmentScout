"""The building-heights chart written by `apartmentscout site --charts`. No network."""
from __future__ import annotations

from pathlib import Path

from apartmentscout.charts import building_heights_chart
from apartmentscout.sun import target_faces


def site_with_window() -> tuple[dict, dict]:
    site = {"origin": {"lat": 40.75, "lon": -73.99}, "floor_height_m": 3.2, "target": 0,
            "b": [[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]],
                  [25, 0, 0, [-10, -60, 10, -60, 10, -40, -10, -40]],        # in front (south)
                  [90, 0, 0, [-10, 200, 10, 200, 10, 220, -10, 220]],        # behind (north)
                  [90, 0, 0, [-10, 400, 10, 400, 10, 420, -10, 420]]],       # beyond 300 m
            "bmeta": [{}, {"name": "Southern Court"}, {"address": "9 North Street"}, {}],
            "future": [{"name": "New Tower", "ring": [[-60, -10], [-40, -10], [-40, 10], [-60, 10]], "h": 120,
                        "status": "permit", "source": "test", "h_src": "filing-height"}]}
    south = next(f for f in target_faces(site) if round(f["bearing"]) == 180)
    site["window"] = {"face": south["i"], "bearing": 180.0, "floor": 8, "t": 0.5}
    return site, south


def test_building_heights_chart_is_written_for_nearby_buildings(tmp_path: Path) -> None:
    site, south = site_with_window()
    out = building_heights_chart(site, south, tmp_path / "heights.png")
    assert out == tmp_path / "heights.png" and out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_building_heights_chart_without_a_facade_still_draws(tmp_path: Path) -> None:
    site, _ = site_with_window()
    del site["window"]
    assert building_heights_chart(site, None, tmp_path / "h.png") is not None


def test_building_heights_chart_is_none_when_nothing_is_nearby(tmp_path: Path) -> None:
    site = {"origin": {"lat": 40.75, "lon": -73.99}, "floor_height_m": 3.2, "target": 0,
            "b": [[60, 0, 1, [-10, -10, 10, -10, 10, 10, -10, 10]]]}
    assert building_heights_chart(site, None, tmp_path / "h.png") is None
    assert not (tmp_path / "h.png").exists()
