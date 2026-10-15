"""The built dashboard data carries only the listing fields the dashboard reads (apartmentscout/slim.py)."""
from __future__ import annotations

import copy
import json
import re
import shutil
from pathlib import Path

from apartmentscout import cli
from apartmentscout.config import Workspace
from apartmentscout.slim import DASHBOARD_FIELDS, slim_listing, slim_listings

REPO = Path(__file__).resolve().parent.parent
DASH = REPO / "dashboard"
EXAMPLE = REPO / "examples" / "nyc-2026"


def _dashboard_source() -> str:
    parts = [p.read_text() for p in sorted((DASH / "js").rglob("*.js"))]
    parts += [(DASH / "share" / "snapshot.html").read_text(), (DASH / "index.html").read_text()]
    return "\n".join(parts)


def _reads(key: str, src: str) -> bool:
    """Does any dashboard script mention ``key`` as a property (`.key`, `?.key`, `['key']`) or an object key?"""
    k = re.escape(key)
    return bool(re.search(rf"\.{k}\b|\[['\"]{k}['\"]\]|['\"]{k}['\"]|(?<![\w.]){k}\s*:", src))


def _example_keys() -> set[str]:
    keys: set[str] = set()
    for L in json.loads((DASH / "data" / "listings.json").read_text()):
        keys |= set(L)
    return keys


def test_every_listing_field_the_dashboard_reads_is_kept() -> None:
    """If a script mentions a field that the example search carries, the export must keep it."""
    src = _dashboard_source()
    missing = sorted(k for k in _example_keys() if k not in DASHBOARD_FIELDS and _reads(k, src))
    assert not missing, f"the dashboard reads {missing} but apartmentscout/slim.py DASHBOARD_FIELDS drops them"


def test_slim_listing_keeps_the_read_fields_and_drops_the_rest() -> None:
    L = {"id": "a-1", "building": "A", "price": {"gross": 4000}, "score": {"overall": 70}, "claims": [{"x": 1}],
         "legacy_score": 3, "commute_note": "x", "exposure_evidence": "long note", "window_face": 2, "favorite": "A", "custom": 1}
    out = slim_listing(L)
    assert out == {"id": "a-1", "building": "A", "price": {"gross": 4000}, "score": {"overall": 70}}
    assert "claims" in L and "custom" in L                       # the input is untouched


def test_slim_drops_the_planned_arrival_time_inside_commute_modes_only() -> None:
    L = {"commute": {"Office": {"minutes": 20, "modes": {"subway": {"minutes": 20, "legs": [{"mode": "walk"}], "legs_arrive_by": "08:58"},
                                                          "bus": {"minutes": 25, "legs_arrive_by": "09:01"}}}}}
    before = copy.deepcopy(L)
    out = slim_listing(L)
    assert out["commute"]["Office"]["modes"]["subway"] == {"minutes": 20, "legs": [{"mode": "walk"}]}
    assert out["commute"]["Office"]["modes"]["bus"] == {"minutes": 25}
    assert L == before


def test_slim_listings_is_idempotent() -> None:
    Ls = json.loads((DASH / "data" / "listings.json").read_text())[:60]
    once = slim_listings(Ls)
    assert slim_listings(once) == once


def test_the_example_data_loses_almost_nothing_but_unread_detail() -> None:
    Ls = json.loads((DASH / "data" / "listings.json").read_text())
    kept = sum(len(json.dumps(x)) for x in slim_listings(Ls))
    full = sum(len(json.dumps(x)) for x in Ls)
    assert kept <= full and kept > 0.9 * full     # a guard against an allowlist that silently drops real content


def test_build_writes_slim_listings(tmp_path: Path) -> None:
    root = tmp_path / "search"
    root.mkdir()
    shutil.copy(EXAMPLE / "criteria.yaml", root / "criteria.yaml")
    (root / "listings.json").write_text(json.dumps([{
        "id": "a-1", "building": "Alpha", "unit": "1", "address": "1 Alpha St, New York, NY", "status": "shortlist",
        "price": {"gross": 4800}, "claims": [{"field": "price", "value": 1, "source": "x"}], "exposure_evidence": "note",
        "commute": {"Office": {"minutes": 20, "modes": {"subway": {"minutes": 20, "legs_arrive_by": "08:58"}}}}}]))
    out = tmp_path / "data"
    cli._export(Workspace(root), out)
    row = json.loads((out / "listings.json").read_text())[0]
    assert row["id"] == "a-1" and row["price"] == {"gross": 4800}
    assert "claims" not in row and "exposure_evidence" not in row
    assert "legs_arrive_by" not in json.dumps(row)
