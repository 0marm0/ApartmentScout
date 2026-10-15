"""The site model and `apartmentscout surroundings` in a city with no profile, on a made-up OpenStreetMap neighbourhood (no network):
the buildings come from OpenStreetMap only, the time zone is the search's, and the coverage report says how many heights are defaults."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from osm_stub import stub_osm

from apartmentscout import cli
from apartmentscout.commands import surroundings as sur
from apartmentscout.geo import site as site_mod
from apartmentscout.intake import init_search
from apartmentscout.listings import normalize, save

HOME = (38.7106, -9.1394)


def make_search(tmp_path: Path, tz: str | None = "Europe/Lisbon") -> Path:
    root = tmp_path / "lisbon"
    crit = ("search: {name: Lisbon, city: lisboa, city_name: Lisboa" + (f", timezone: {tz}" if tz else "") + "}\n"
            "budget: {tiers: [{name: T, max: 2000}], hard_max: 2500}\n"
            "commute:\n  destinations: []\n")
    init_search(root, "lisboa", crit)
    save([normalize({"building": "Rua Augusta", "unit": "3E", "address": "Rua Augusta 100, Lisboa", "status": "shortlist", "beds": 1,
                     "lat": HOME[0], "lon": HOME[1], "floor": 3, "exposure": ["SW"], "price": {"gross": 1900}})], root / "listings.json")
    return root


def args(root: Path, **kw):
    import types
    d = dict(search=str(root), ids=[], all=False, status=False, rebuild=False, refresh=False, radius=600.0, verbose=False)
    d.update(kw)
    return types.SimpleNamespace(**d)


def test_surroundings_builds_a_site_model_from_openstreetmap_alone_and_reports_the_gaps(tmp_path, monkeypatch, capsys) -> None:
    stub_osm(monkeypatch)
    monkeypatch.setattr(site_mod, "fetch_nyc", lambda *a, **k: pytest.fail("a city without a profile must not call the NYC footprints"))
    root = make_search(tmp_path)
    sur.cmd_surroundings(args(root))
    out = capsys.readouterr().out
    assert "[1/1] rua-augusta-3e: done in" in out and "1 built, 0 skipped, 0 failed." in out
    f = root / "sites" / "rua-augusta-3e.json"
    s = json.loads(f.read_text())
    assert s["source"].startswith("OpenStreetMap") and s["timezone"] == "Europe/Lisbon"
    assert len(s["b"]) == 5 and s["provenance"]["target"] in ("point", "nearest")
    assert s["bmeta"][s["target"]]["name"] == "Home Court"
    # two of the five buildings carry no height or levels: they use the default, and the report says so
    assert "2 use a default 10 m height" in out and "matched to Home Court" in out and "OpenStreetMap" in out
    assert "Not available for this city" in out and "expected sun" in out
    listing = json.loads((root / "listings.json").read_text())[0]
    assert listing["site"]["file"] == "sites/rua-augusta-3e.json"


def test_a_second_run_leaves_the_finished_home_alone_and_status_reads_the_file(tmp_path, monkeypatch, capsys) -> None:
    stub_osm(monkeypatch)
    root = make_search(tmp_path)
    sur.cmd_surroundings(args(root))
    capsys.readouterr()
    sur.cmd_surroundings(args(root))
    assert "already has a site model" in capsys.readouterr().out
    sur.cmd_surroundings(args(root, status=True))
    out = capsys.readouterr().out
    assert "site model" in out and "buildings   5 around the home" in out and "floor plan  none yet" in out


def test_the_sun_times_do_not_silently_use_new_york_when_the_search_has_no_zone(tmp_path, monkeypatch, capsys) -> None:
    stub_osm(monkeypatch)
    root = make_search(tmp_path, tz=None)
    cli.main(["site", "rua-augusta-3e", "--search", str(root)])
    out = capsys.readouterr().out
    assert "no search.timezone set: using Europe/Lisbon" in out
    assert json.loads((root / "sites" / "rua-augusta-3e.json").read_text())["timezone"] == "Europe/Lisbon"


def test_a_plan_for_the_home_is_noticed_by_the_status(tmp_path, monkeypatch, capsys) -> None:
    from apartmentscout import planfile
    stub_osm(monkeypatch)
    root = make_search(tmp_path)
    planfile.save_plan(root, {"schema": 2, "id": "rua-augusta-3e", "units": "m", "up_bearing": 200,
                              "rooms": [{"name": "Sala", "x": 0, "y": 0, "w": 5, "h": 4}], "windows": [{"x1": 0, "y1": 4, "x2": 2, "y2": 4}]})
    sur.cmd_surroundings(args(root))
    assert "floor plan  yes" in capsys.readouterr().out
