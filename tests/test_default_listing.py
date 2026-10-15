"""The example's featured unit and the search's default home.

* ``search.default_listing`` in criteria.yaml is validated by ``criteria --check`` and written into manifest.json by ``build``;
  the dashboard's 3D views open that home when nothing else is chosen (dashboard/js/features/default-home.js).
* The example's featured unit is unit 25E on floor 25 of Paramount Tower: the renter's real unit is not the one shown, so no
  tracked file may carry the real unit's label or id (the old strings are assembled below so that this file does not carry them).
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest
import yaml

from apartmentscout import cli
from apartmentscout.config import Workspace
from apartmentscout.criteria_check import check_file, check_text
from apartmentscout.intake import init_search
from apartmentscout.listings import save

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "examples" / "nyc-2026"
NEW_ID = "paramount-tower-25e"
OLD_ID = "paramount-tower-" + "24" + "e"
OLD_LABEL = re.compile(r"(?<![0-9A-Za-z-])" + "24" + "E(?![0-9A-Za-z])")
OLD_STREETEASY = "paramount-tower/" + "24" + "e"


def _crit(extra: str) -> str:
    return f"""search:
  name: t
  city: generic
{extra}budget:
  basis: monthly_cost
  tiers:
    - {{name: Target, max: 3000}}
  hard_max: 3400
unit: {{min_beds: 1, sqft_floor: 400, sqft_good: 650, sqft_great: 900}}
must_have: [in_unit_wd]
commute:
  destinations:
    - {{name: Work, address: 1 Main St, arrive_by: "09:00", max_minutes: 30, weight: 1}}
weights: {{cost: 30}}
"""


def test_the_example_names_the_renamed_unit_as_its_default_home() -> None:
    crit = yaml.safe_load((EXAMPLE / "criteria.yaml").read_text())
    assert crit["search"]["default_listing"] == NEW_ID
    rep = check_file(EXAMPLE / "criteria.yaml")
    assert rep.ok and not [w for w in rep.warnings if "default_listing" in w]
    listings = json.loads((EXAMPLE / "listings.json").read_text())
    home = next(x for x in listings if x["id"] == NEW_ID)
    assert (home["unit"], home["floor"], home["building"]) == ("25E", 25, "Paramount Tower")
    assert next(x for x in listings if x["id"] == "paramount-tower-9j")["unit"] == "9J"      # the other Paramount unit is untouched
    manifest = json.loads((ROOT / "dashboard" / "data" / "manifest.json").read_text())
    assert manifest["default_listing"] == NEW_ID
    assert all(NEW_ID in manifest[k] for k in ("sites", "plans", "dossiers"))
    assert (EXAMPLE / "sites" / f"{NEW_ID}.json").is_file() and (EXAMPLE / "plans" / f"{NEW_ID}.json").is_file()


def test_the_renamed_unit_is_studied_at_floor_25_everywhere() -> None:
    site = json.loads((EXAMPLE / "sites" / f"{NEW_ID}.json").read_text())
    assert site["listing"]["id"] == NEW_ID and site["listing"]["unit"] == "25E" and site["listing"]["floor"] == 25
    assert site["window"]["floor"] == 25 and site["sightline"]["floor"] == 25
    assert all(f["floor"] == 25 for f in site["sightline"]["facades"])
    eye = site["floor_height_m"] * 24 + 1.6
    assert all(abs(f["eye"][2] - eye) < 0.1 for f in site["sightline"]["facades"])      # the window's eye, 24 storeys above the street
    listing = next(x for x in json.loads((EXAMPLE / "listings.json").read_text()) if x["id"] == NEW_ID)
    assert listing["site"]["floor"] == 25 and listing["site"]["sun_hours"] == site["study"]["sun_hours"]
    plan = json.loads((EXAMPLE / "plans" / f"{NEW_ID}.json").read_text())
    assert plan["id"] == NEW_ID and plan["floor"] == 25 and "#25E" in plan["title"]


def _tracked_text_files() -> list[Path]:
    try:
        names = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout.decode().split("\0")
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("not a git checkout")
    out = []
    for n in names:
        p = ROOT / n
        if n and p.is_file() and p.suffix.lower() not in {".png", ".jpg", ".webp", ".woff2", ".woff", ".ico", ".pdf", ".zip", ".glb", ".wasm"}:
            out.append(p)
    return out


def test_no_tracked_file_carries_the_real_units_id_or_label() -> None:
    bad: list[str] = []
    for p in _tracked_text_files():
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if OLD_ID in text.lower() or OLD_STREETEASY in text.lower() or OLD_LABEL.search(text):
            bad.append(str(p.relative_to(ROOT)))
        if OLD_ID in p.name.lower():
            bad.append(str(p.relative_to(ROOT)) + " (name)")
    assert not bad, f"the real unit shows in: {bad}"


def test_no_file_name_carries_the_real_units_id() -> None:
    assert not [p for p in _tracked_text_files() if OLD_ID in str(p).lower()]


def test_criteria_check_validates_default_listing(tmp_path: Path) -> None:
    assert not check_text(_crit("  default_listing: building-1211\n")).errors
    assert not check_text(_crit("")).errors
    for bad in ("Not An Id", "[a, b]", "../x", "UPPER"):
        rep = check_text(_crit(f"  default_listing: {bad}\n"))
        assert any("search.default_listing" in e for e in rep.errors), bad


def test_criteria_check_warns_about_a_default_that_is_not_in_listings(tmp_path: Path) -> None:
    (tmp_path / "criteria.yaml").write_text(_crit("  default_listing: there-1\n"))
    (tmp_path / "listings.json").write_text(json.dumps([{"id": "here-1", "status": "new"}, {"id": "gone-1", "status": "gone"}]))
    rep = check_file(tmp_path / "criteria.yaml")
    assert rep.ok and any("there-1" in w and "not in listings.json" in w for w in rep.warnings)
    (tmp_path / "criteria.yaml").write_text(_crit("  default_listing: gone-1\n"))
    assert any("gone-1" in w and "marked gone" in w for w in check_file(tmp_path / "criteria.yaml").warnings)
    (tmp_path / "criteria.yaml").write_text(_crit("  default_listing: here-1\n"))
    assert not [w for w in check_file(tmp_path / "criteria.yaml").warnings if "default_listing" in w]


def test_build_writes_the_default_home_into_the_manifest(tmp_path: Path) -> None:
    mine = tmp_path / "mine"
    init_search(mine, "generic")
    ws = Workspace(mine)
    save([{"id": "here-1", "building": "Here", "unit": "1", "status": "new"}], ws.listings_path)
    cli._export(ws, tmp_path / "out")
    assert "default_listing" not in json.loads((tmp_path / "out" / "manifest.json").read_text())
    text = (mine / "criteria.yaml").read_text()
    (mine / "criteria.yaml").write_text(text.replace("search:\n", "search:\n  default_listing: here-1\n", 1))
    cli._export(Workspace(mine), tmp_path / "out")
    assert json.loads((tmp_path / "out" / "manifest.json").read_text())["default_listing"] == "here-1"
    (mine / "criteria.yaml").write_text(text.replace("search:\n", "search:\n  default_listing: nowhere-9\n", 1))
    cli._export(Workspace(mine), tmp_path / "out")      # an id the search does not have is left out, not written
    assert "default_listing" not in json.loads((tmp_path / "out" / "manifest.json").read_text())
