"""`apartmentscout build` ships the renter's furniture.json to the dashboard's data folder and says so in the manifest, so the Floor plan
studio can use it; a search without one ships none. The shipped example's file is valid and has no personal paths."""
from __future__ import annotations

import json
from pathlib import Path

from apartmentscout import cli
from apartmentscout.config import Workspace
from apartmentscout.intake import init_search

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "nyc-2026"


def test_build_copies_furniture_json_and_flags_it_in_the_manifest(tmp_path: Path) -> None:
    mine = tmp_path / "searches" / "mine"
    init_search(mine, "generic")
    ws = Workspace(mine)
    out = tmp_path / "data"
    cli._export(ws, out)
    assert json.loads((out / "manifest.json").read_text())["furniture"] is False and not (out / "furniture.json").exists()
    (mine / "furniture.json").write_text((EXAMPLE / "furniture.json").read_text())
    cli._export(ws, out)
    assert json.loads((out / "manifest.json").read_text())["furniture"] is True
    assert (out / "furniture.json").read_text() == (EXAMPLE / "furniture.json").read_text()
    (mine / "furniture.json").unlink()
    cli._export(ws, out)
    assert json.loads((out / "manifest.json").read_text())["furniture"] is False and not (out / "furniture.json").exists()   # a stale copy never lingers


def test_the_shipped_example_furniture_is_committed_with_the_dashboard_data_and_is_public() -> None:
    f = json.loads((EXAMPLE / "furniture.json").read_text())
    assert f["kind"] == "apartmentscout-furniture" and f["schema"] == 1 and len(f["pieces"]) == 10
    assert (ROOT / "dashboard" / "data" / "furniture.json").read_text() == (EXAMPLE / "furniture.json").read_text()
    assert json.loads((ROOT / "dashboard" / "data" / "manifest.json").read_text())["furniture"] is True
    assert "/Users/" not in json.dumps(f) and all(p.get("source") for p in f["pieces"])
    for pid in ("paramount-tower-25e", "emerald-green-1211"):   # the default layout of each is the renter's own
        for base in (EXAMPLE / "plans", ROOT / "dashboard" / "data" / "plans"):
            plan = json.loads((base / f"{pid}.json").read_text())
            assert plan["layouts"][0]["id"] == "your-furniture" and len(plan["layouts"][0]["items"]) == len(f["pieces"])
