"""Onboarding fixes found by walking a new user through a city that is not New York: build never touches the committed
demo data, geocode saves the destination coordinates it finds, and a search with no transit feeds says so."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from apartmentscout import cli
from apartmentscout.cli import main
from apartmentscout.criteria_edit import set_destination_coords, set_search_fields
from apartmentscout.intake import init_search
from apartmentscout.listings import save

ROOT = Path(__file__).resolve().parents[1]
BLOCK = """\
search:
  name: Chicago
  city: chicago              # a comment that must survive
commute:
  destinations:
    - name: Work
      address: 233 S Wacker Dr, Chicago, IL
      # lat/lon are filled by `apartmentscout geocode`
      arrive_by: "09:00"
      max_minutes: 35
    - name: Gym
      address: 1 Main St
      lat: null
      arrive_by: "18:00"
"""


def _dest(text: str, name: str) -> dict:
    return next(d for d in yaml.safe_load(text)["commute"]["destinations"] if d["name"] == name)


def test_destination_coordinates_are_added_in_place_and_comments_survive() -> None:
    out = set_destination_coords(BLOCK, {"Work": (41.87892, -87.636602)})
    assert out is not None
    assert _dest(out, "Work")["lat"] == 41.87892 and _dest(out, "Work")["lon"] == -87.636602
    assert "# a comment that must survive" in out and "# lat/lon are filled by" in out
    assert out.count("lat:") == BLOCK.count("lat:") + 1 and "Gym" in out   # nothing else moved
    assert _dest(out, "Gym").get("lat") is None


def test_existing_coordinates_are_replaced_not_duplicated() -> None:
    once = set_destination_coords(BLOCK, {"Work": (41.0, -87.0)})
    twice = set_destination_coords(once, {"Work": (41.5, -87.5)})
    assert twice is not None and twice.count("lat: 41.5") == 1 and "lat: 41.0" not in twice
    assert _dest(twice, "Work")["lon"] == -87.5


def test_flow_style_destinations_are_edited_too() -> None:
    text = "commute:\n  destinations:\n    - {name: Work, address: 1 Main St, arrive_by: \"09:00\"}\n"
    out = set_destination_coords(text, {"Work": (1.5, 2.5)})
    assert out is not None and _dest(out, "Work")["lat"] == 1.5 and _dest(out, "Work")["lon"] == 2.5


def test_search_fields_are_set_in_place() -> None:
    out = set_search_fields(BLOCK, {"timezone": "America/Chicago", "city_name": "Chicago, IL", "map_center": [41.88, -87.63]})
    s = yaml.safe_load(out)["search"]
    assert s["timezone"] == "America/Chicago" and s["city_name"] == "Chicago, IL" and s["map_center"] == [41.88, -87.63]
    assert "# a comment that must survive" in out


def _search(tmp_path: Path, city: str = "chicago") -> Path:
    root = tmp_path / "s"
    init_search(root, city, BLOCK_CRITERIA)
    save([{"id": "a-1", "building": "A", "unit": "1", "address": "225 N Columbus Dr, Chicago, IL", "lat": 41.8851, "lon": -87.6203,
           "beds": 1, "price": {"gross": 2500}, "status": "new"}], root / "listings.json")
    return root


BLOCK_CRITERIA = """\
search: {name: Chicago, city: chicago, timezone: America/Chicago}
budget: {tiers: [{name: T, max: 3000}], hard_max: 3500}
commute:
  destinations:
    - name: Work
      address: 233 S Wacker Dr, Chicago, IL
      arrive_by: "09:00"
      max_minutes: 35
"""


def test_geocode_saves_the_destination_coordinates_so_commute_can_run(tmp_path, monkeypatch, capsys) -> None:
    root = _search(tmp_path)
    from apartmentscout import geocode as G
    monkeypatch.setattr(G.Geocoder, "geocode", lambda self, address, provider="auto": {"lat": 41.87892, "lon": -87.636602, "label": "Willis Tower"})
    main(["geocode", "--search", str(root)])
    crit = yaml.safe_load((root / "criteria.yaml").read_text())
    assert crit["commute"]["destinations"][0]["lat"] == 41.87892
    assert list((root / "backups").glob("criteria-*.yaml")), "the old file is kept"
    assert "Saved the coordinates" in capsys.readouterr().out
    main(["commute", "--search", str(root)])   # no "has no lat/lon" any more
    out = capsys.readouterr().out
    assert "WALKING times only" in out, "no feeds: the walking-only fallback is announced"
    assert json.loads((root / "listings.json").read_text())[0]["commute"]["Work"]["mode"] == "walk"


def test_commute_with_a_missing_coordinate_exits_with_the_fix_not_a_traceback(tmp_path) -> None:
    root = _search(tmp_path)
    with pytest.raises(SystemExit) as e:
        main(["commute", "--search", str(root)])
    assert "geocode" in str(e.value)


def test_a_dead_feed_url_is_skipped_with_a_message(tmp_path, monkeypatch, capsys) -> None:
    import requests

    from apartmentscout.commute import run as R

    def boom(url, dest, **k):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(R, "download_feed", boom)
    ws = type("W", (), {"cache_dir": tmp_path})()
    crit = {"commute": {"transit": {"feeds": [{"name": "Dead", "url": "https://example.invalid/g.zip"}]}}}
    assert R.feed_specs(ws, crit, log=print) == []
    assert "could not download" in capsys.readouterr().out


def test_build_of_a_private_search_goes_to_its_own_cache_not_the_demo_data(tmp_path, capsys) -> None:
    root = _search(tmp_path)
    demo = ROOT / "dashboard" / "data" / "listings.json"
    before = demo.stat().st_mtime_ns
    main(["build", "--search", str(root)])
    assert (root / "cache" / "dashboard-data" / "listings.json").exists()
    assert demo.stat().st_mtime_ns == before, "the committed demo data is not rewritten by someone else's search"
    assert cli.default_data_dir(cli.Workspace(ROOT / "examples" / "nyc-2026")) == ROOT / "dashboard" / "data"
