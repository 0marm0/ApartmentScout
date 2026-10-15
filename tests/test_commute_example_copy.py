"""`apartmentscout commute` with several destinations, on a TEMP copy of the example search with two synthetic
destinations and a synthetic subway (no network). examples/nyc-2026/criteria.yaml must stay a one-destination search."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest
import yaml

from apartmentscout.cli import main
from synthetic_gtfs import write_manhattan_feed

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "nyc-2026"


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


EXAMPLE_CRITERIA_SHA = digest(EXAMPLE / "criteria.yaml")   # at import, before any test runs


@pytest.fixture(scope="module")
def search(tmp_path_factory) -> Path:
    tmp = tmp_path_factory.mktemp("multi")
    feed = write_manhattan_feed(tmp / "synthetic-subway.zip")
    s = tmp / "search"
    s.mkdir()
    listings = json.loads((EXAMPLE / "listings.json").read_text())
    geocoded = [L for L in listings if L.get("lat") is not None and L.get("status") != "gone"][:90]
    (s / "listings.json").write_text(json.dumps(geocoded))
    crit = yaml.safe_load((EXAMPLE / "criteria.yaml").read_text())
    crit["commute"]["destinations"] += [
        {"name": "Partner", "address": "Columbus Circle, New York, NY", "lat": 40.7681, "lon": -73.9819, "arrive_by": "09:00", "max_minutes": 35, "weight": 1.5},
        {"name": "Gym", "address": "Union Square, New York, NY", "lat": 40.7359, "lon": -73.9906, "arrive_by": "09:00", "max_minutes": 15, "weight": 0.5}]
    crit["commute"]["transit"].update({"feeds": [{"name": "Synthetic subway", "path": str(feed), "mode": "subway"}], "walk_model": "grid", "land": False,
                                       "service_date": "2026-10-14", "heat_cell_m": 120})
    (s / "criteria.yaml").write_text(yaml.safe_dump(crit, sort_keys=False))
    return s


def test_the_example_search_itself_keeps_one_destination():
    crit = yaml.safe_load((EXAMPLE / "criteria.yaml").read_text())
    assert [d["name"] for d in crit["commute"]["destinations"]] == ["Grand Central"]


def test_commute_routes_the_new_destinations_and_leaves_the_old_one(search):
    before = json.loads((search / "listings.json").read_text())
    assert all(set(L["commute"]) == {"Grand Central"} for L in before), "the example's own minutes are for its one destination"
    gc = {L["id"]: json.dumps(L["commute"]["Grand Central"], sort_keys=True) for L in before}
    main(["commute", "--search", str(search), "--dest", "Partner", "Gym"])
    after = json.loads((search / "listings.json").read_text())
    for L in after:
        assert set(L["commute"]) == {"Grand Central", "Partner", "Gym"}
        assert json.dumps(L["commute"]["Grand Central"], sort_keys=True) == gc[L["id"]], "--dest never touches the others"
        for name in ("Partner", "Gym"):
            e = L["commute"][name]
            assert e["minutes"] > 0 and {"walk", "subway", "transit"} <= set(e["modes"])
    layers = {p.name for p in (search / "layers").glob("commute-*.json")} if (search / "layers").exists() else set()
    assert {"commute-partner.json", "commute-partner-subway.json", "commute-gym.json", "commute-gym-subway.json"} <= layers
    assert "commute-grand-central.json" not in layers, "this temp copy never had one; --dest did not invent it"


def test_commute_without_dest_routes_all_of_them(search):
    main(["commute", "--search", str(search)])
    layers = {p.name for p in (search / "layers").glob("commute-*.json")}
    assert {"commute-grand-central.json", "commute-partner.json", "commute-gym.json"} <= layers
    Ls = json.loads((search / "listings.json").read_text())
    assert all(set(L["commute"]) == {"Grand Central", "Partner", "Gym"} for L in Ls)
    near_gym = min(Ls, key=lambda L: (L["lat"] - 40.7359) ** 2 + (L["lon"] + 73.9906) ** 2)
    assert near_gym["commute"]["Gym"]["minutes"] < near_gym["commute"]["Partner"]["minutes"], "the home beside the gym is closer to the gym than to the partner's office"


def test_build_adds_the_combined_surfaces_for_the_dashboard(search, tmp_path):
    shutil.copy(EXAMPLE / "places.json", search / "places.json")
    out = tmp_path / "data"
    main(["build", "--search", str(search), "--out", str(out)])
    manifest = json.loads((out / "manifest.json").read_text())
    assert "layers/commute-combined-best.json" in manifest["extra"] and "places.json" in manifest["extra"]
    assert "commute-combined-best.json" not in manifest["layers"], "the dashboard loads the combined surfaces on demand, not at start"
    doc = json.loads((out / "layers" / "commute-combined-best.json").read_text())
    assert [d["name"] for d in doc["destinations"]] == ["Grand Central", "Partner", "Gym"]
    assert (out / "layers" / "commute-combined-best.json").stat().st_size < 60_000
    assert digest(EXAMPLE / "criteria.yaml") == EXAMPLE_CRITERIA_SHA, "the example's own criteria are never rewritten"
