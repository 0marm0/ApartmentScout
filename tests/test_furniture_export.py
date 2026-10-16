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
    assert f["kind"] == "apartmentscout-furniture" and f["schema"] == 1 and len(f["pieces"]) == 13   # the renter's eleven pieces (the office chair is one), the candidate storage bed and the sim rig
    assert (ROOT / "dashboard" / "data" / "furniture.json").read_text() == (EXAMPLE / "furniture.json").read_text()
    assert json.loads((ROOT / "dashboard" / "data" / "manifest.json").read_text())["furniture"] is True
    assert "/Users/" not in json.dumps(f) and all(p.get("source") for p in f["pieces"])
    for pid in ("paramount-tower-25e", "emerald-green-1211"):   # the default layout of each is the renter's own
        for base in (EXAMPLE / "plans", ROOT / "dashboard" / "data" / "plans"):
            plan = json.loads((base / f"{pid}.json").read_text())
            owned = [p for p in f["pieces"] if not p.get("candidate") and p["id"] != "sim-rig"]   # only Paramount 25E holds the candidate bed (hidden until the renter switches to it) and the sim rig (the pedal end slides under its desk)
            assert plan["layouts"][0]["id"] == "your-furniture" and len(plan["layouts"][0]["items"]) == (len(f["pieces"]) if pid == "paramount-tower-25e" else len(owned))


def test_the_renters_answers_are_in_the_furniture_file_and_the_25e_default_layout_is_data() -> None:
    f = {p["id"]: p for p in json.loads((EXAMPLE / "furniture.json").read_text())["pieces"]}
    desk = f["desk"]   # the Bestier rotating desk, used straight: 51.8 + 46.9 in less the overlap, a 32-inch monitor (the task chair is its own piece, desk-chair)
    assert (desk["w"], desk["d"], desk["h"]) == (89.2, 21.6, 29.1) and desk["variant"] == "rotating"
    assert desk["set"]["monitor"] == 32 and desk["set"]["chair"] is False and desk["set"]["config"] == "straight"
    assert desk["look"]["material"] == "laminate" and desk["look"]["basis"] == "renter" and desk["look"]["parts"]["posts"]["color"] == "silver"
    chair = f["desk-chair"]   # the rolling office chair is a piece of its own: renter basis for owning it, black assumed
    assert chair["ref"] == "task-chair" and chair["look"]["basis"] == "renter" and chair["look"]["color"] == "black" and "color" in chair["look"]["assumed"]
    chest = f["dresser"]   # IKEA STORKLINTA 6-drawer, the tall one (the renter corrected it from a MALM)
    assert chest["ref"] == "dresser-storklinta-6" and (chest["w"], chest["d"], chest["h"]) == (27.6, 18.9, 47.2) and chest["look"]["basis"] == "renter"
    assert "705.592.78" in chest["source"] and chest["source"].startswith("manufacturer")
    for tv in ("tv", "tv-bed"):
        assert (f[tv]["w"], f[tv]["h"]) == (48.4, 27.8)   # 55-inch class
    plan = json.loads((EXAMPLE / "plans" / "paramount-tower-25e.json").read_text())
    layout = plan["layouts"][0]
    assert layout["id"] == "your-furniture" and all(i["placed"] is True for i in layout["items"]), "the renter's layout: every piece placed"
    assert json.loads((ROOT / "dashboard" / "data" / "plans" / "paramount-tower-25e.json").read_text())["layouts"][0] == layout
    assert "/Users/" not in json.dumps(layout)


def test_the_storage_bed_is_recorded_as_a_candidate_with_the_makers_dimensions_and_no_price() -> None:
    f = json.loads((EXAMPLE / "furniture.json").read_text())
    bed = {p["id"]: p for p in f["pieces"]}["bed-latitude"]
    assert bed["source"] == "manufacturer" and bed["ref"] == "queen-storage-bed-towers"
    c = bed["candidate"]
    assert c["brand"] == "Latitude Run" and c["sku"] == "BHLT1182" and c["size"] == "Queen" and c["colour"] == "Brown Oak"
    assert c["url"].startswith("https://www.wayfair.com/") and "not owned" in c["status"]
    assert (bed["w"], bed["d"], bed["h"]) == (94, 83.3, 47.4) and bed["spec"]["overall"] == {"w": 94, "d": 83.3, "h": 47.4}
    assert bed["spec"]["nightstand"]["d"] == 17 and bed["spec"]["frame"]["w"] == 60.5 and bed["spec"]["mattress"] == {"w": 60, "d": 80, "h": 12}
    # every number says where it comes from: the spec table, the maker's drawing, our measuring of it, or our choice
    leaves = {f"{g}.{k}" for g, vals in bed["spec"].items() for k in vals}
    assert leaves == set(bed["spec_basis"]) and set(bed["spec_basis"].values()) <= {"spec", "diagram", "measured", "assumed"}
    assert "price" not in {k.lower() for k in c} and "$" not in json.dumps(bed)
    # the option group switches between the renter's bed, this one and none; nothing in it is a position
    group = f["options"]["bed"]
    assert group["default"] == "storage" and [x["id"] for x in group["choices"]] == ["mine", "storage", "none"]
    plan = json.loads((EXAMPLE / "plans" / "paramount-tower-25e.json").read_text())
    item = {i["id"]: i for i in plan["layouts"][0]["items"]}["bed-latitude"]
    assert "hidden" not in item and item["placed"] is True, "the storage bed is the default: shown, placed"
    own = {i["id"]: i for i in plan["layouts"][0]["items"]}
    assert all(own[k]["hidden"] is True for k in ("bed", "nightstand-1", "nightstand-2")), "their own bed and its nightstands wait until chosen"
