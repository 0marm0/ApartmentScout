"""`apartmentscout share` and the shared snapshot template (dashboard/share/snapshot.html).

The browser builds the same payload from the same template (dashboard/js/features/share-model.js); the parity test below
runs it under Node and compares. The page is checked for what it must contain and what it must never contain.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from apartmentscout import share as sh
from apartmentscout.cli import main

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "nyc-2026"
DATA = ROOT / "dashboard" / "data"
PICKS = {"version": 1, "search": "x", "picks": {
    "paramount-tower-25e": {"saved": True, "tier": "S", "note": "private view note", "tour": "2026-10-17T10:30"},
    "orion-condominium-23a": {"saved": True, "tier": "A"},
    "emerald-green-24d": {"saved": True},
    "the-max-621": {"saved": True, "tier": "Pass", "note": "too small"},
    "not-in-the-data": {"saved": True},
}}


@pytest.fixture
def picks_file(tmp_path: Path) -> Path:
    p = tmp_path / "picks.json"
    p.write_text(json.dumps(PICKS))
    return p


def payload_of(html: str) -> dict:
    m = re.search(r'<script type="application/json" id="as-data">(.*?)</script>', html, re.S)
    assert m, "no as-data block"
    return json.loads(m.group(1))


def run_share(tmp_path: Path, picks: Path | None, *flags: str) -> tuple[str, Path]:
    out = tmp_path / "shortlist.html"
    argv = ["share", "--search", str(EXAMPLE), "--out", str(out), *flags]
    if picks:
        argv += ["--picks", str(picks)]
    main(argv)
    return out.read_text(encoding="utf-8"), out


def test_share_writes_one_self_contained_page(tmp_path: Path, picks_file: Path, capsys) -> None:
    html, out = run_share(tmp_path, picks_file, "--no-photos")
    assert out.exists() and html.startswith("<!doctype html>")
    p = payload_of(html)
    # unknown ids are skipped with a note, Pass is left out, the best first
    assert [h["id"] for h in p["homes"]] == ["paramount-tower-25e", "orion-condominium-23a", "emerald-green-24d"]
    assert "not in this search" in capsys.readouterr().err
    assert p["search"]["name"] and p["dest"]["name"] == "Grand Central" and p["map"]["lines"]
    # nothing is fetched at view time: no external scripts, styles or fonts
    assert not re.search(r'<(script|link)[^>]+(src|href)="https?://', html)
    assert "/Users/" not in html and "_reference" not in html


def test_notes_and_tour_times_only_leave_when_asked(tmp_path: Path, picks_file: Path) -> None:
    html, _ = run_share(tmp_path, picks_file, "--no-photos")
    assert "private view note" not in html and "too small" not in html and "2026-10-17T10:30" not in html
    html2, _ = run_share(tmp_path, picks_file, "--no-photos", "--notes")
    p = payload_of(html2)
    assert p["homes"][0]["pick"] == {"tier": "S", "note": "private view note"} and p["notes"] is True
    assert "2026-10-17T10:30" not in html2 and "too small" not in html2


def test_memo_flag_chooses_the_opening_layout(tmp_path: Path, picks_file: Path) -> None:
    html, _ = run_share(tmp_path, picks_file, "--no-photos", "--memo", "--title", "Fall decision")
    p = payload_of(html)
    assert p["view"] == "memo" and p["title"] == "Fall decision"
    assert payload_of(run_share(tmp_path, picks_file, "--no-photos")[0])["view"] == "cards"


def test_only_schema_fields_travel(tmp_path: Path, picks_file: Path) -> None:
    schema = sh.load_schema(sh.load_template())
    p = payload_of(run_share(tmp_path, picks_file, "--no-photos")[0])
    for h in p["homes"]:
        assert set(h) <= set(schema["listing"]) | {"pick", "reasons", "commute", "photos"}
        assert set(h["score"]) <= set(schema["score"]) and set(h["price"]) <= set(schema["price"])
        assert not {"stations", "bbl", "bin", "photos_local", "legacy_score", "claims"} & set(h)


def test_a_note_cannot_break_out_of_the_page(tmp_path: Path) -> None:
    html = sh.inline_payload(sh.load_template(), {"homes": [{"notes": "</script><script>alert(1)</script>"}]})
    assert "</script><script>alert(1)" not in html
    assert payload_of(html)["homes"][0]["notes"] == "</script><script>alert(1)</script>"
    with pytest.raises(ValueError):
        sh.inline_payload(html, {})


def test_no_picks_file_falls_back_to_the_shortlisted_statuses(tmp_path: Path, capsys) -> None:
    html, _ = run_share(tmp_path, None, "--no-photos")
    p = payload_of(html)
    assert p["homes"] and "No --picks file" in capsys.readouterr().out


def test_nothing_to_share_is_an_error(tmp_path: Path) -> None:
    bad = tmp_path / "p.json"
    bad.write_text(json.dumps({"picks": {"nope": {"saved": True}}}))
    with pytest.raises(SystemExit) as e:
        run_share(tmp_path, bad)
    assert "Nothing to share" in str(e.value)
    bad.write_text("{not json")
    with pytest.raises(SystemExit):
        run_share(tmp_path, bad)


def test_picks_files_in_every_shape() -> None:
    assert sh.read_picks(["a", "b"])[0] == {"a": {"saved": True}, "b": {"saved": True}}
    assert sh.read_picks({"ids": ["a"], "weights": {"cost": 5}}) == ({"a": {"saved": True}}, {"cost": 5})
    picks, w = sh.read_picks({"picks": {"a": {"tier": "A"}, "b": "junk"}, "weights": {"space": 9}})
    assert picks == {"a": {"tier": "A"}} and w == {"space": 9}
    with pytest.raises(ValueError):
        sh.read_picks({"nothing": 1})
    assert sh.chosen_ids({"a": {"saved": True}, "b": {"tier": "Pass"}, "c": {}, "d": {"tier": "B"}}, {"a", "b", "c", "d"}) == (["a", "d"], [])


def test_weights_in_the_picks_file_reorder_the_homes(tmp_path: Path, picks_file: Path) -> None:
    doc = {**PICKS, "weights": {"cost": 40, "space": 0, "commute": 0, "amenities": 0, "light_view": 0, "building": 0, "interior": 0, "quiet": 0}}
    heavy = tmp_path / "heavy.json"
    heavy.write_text(json.dumps(doc))
    a = [h["id"] for h in payload_of(run_share(tmp_path, picks_file, "--no-photos")[0])["homes"]]
    b = [h["id"] for h in payload_of(run_share(tmp_path, heavy, "--no-photos")[0])["homes"]]
    assert sorted(a) == sorted(b) and a != b


def test_reasons_follow_the_weights() -> None:
    crit = json.loads((DATA / "criteria.json").read_text())
    L = next(x for x in json.loads((DATA / "listings.json").read_text()) if x["id"] == "paramount-tower-25e")
    dims = sh.dim_list(crit)
    r = sh.reasons_for(L, crit["weights"], dims)
    cost = next(x for x in r if x["label"] == "Cost")
    assert abs(cost["pts"] - (L["score"]["parts"]["cost"] - 50) * 20 / 100) < 0.01
    assert abs(sh.weighted_score(L, crit["weights"], dims) - L["score"]["overall"]) < 0.35
    assert all(abs(r[i - 1]["pts"]) >= abs(r[i]["pts"]) for i in range(1, len(r)))


# --------------------------------------------------------------------------- photos
def fake_search(tmp_path: Path) -> Path:
    """A search folder with one listing whose saved photo is a real (tiny) image and one linked photo."""
    from PIL import Image
    root = tmp_path / "search"
    (root / "media" / "h-1").mkdir(parents=True)
    Image.new("RGB", (1600, 1200), (180, 90, 40)).save(root / "media" / "h-1" / "p-1.webp")
    shutil.copy(EXAMPLE / "criteria.yaml", root / "criteria.yaml")
    listing = {"id": "h-1", "building": "Test House", "unit": "4A", "address": "1 Test St", "status": "shortlist", "lat": 40.75, "lon": -73.98,
               "price": {"gross": 4000}, "photos_local": ["media/h-1/p-1.webp"], "photos": ["https://photos.example/h-1/1.jpg", "https://photos.example/h-1/2.jpg"],
               "score": {"overall": 70, "parts": {"cost": 70}, "monthly_cost": 4000, "confidence": 80, "reasons": [], "cost": {"monthly": 4000}}}
    (root / "listings.json").write_text(json.dumps([listing]))
    return root


def test_local_photos_are_embedded_as_small_thumbnails_and_the_rest_linked(tmp_path: Path) -> None:
    root = fake_search(tmp_path)
    out = tmp_path / "s.html"
    main(["share", "--search", str(root), "--out", str(out)])
    p = payload_of(out.read_text())
    ph = p["homes"][0]["photos"]
    assert ph[0]["src"].startswith("data:image/jpeg;base64,") and len(ph[0]["src"]) < 40_000
    assert [x["src"] for x in ph[1:]] == ["https://photos.example/h-1/2.jpg"], "the first link is the original of the embedded copy"
    assert p["photo_bytes"] == len(ph[0]["src"])


def test_the_photo_budget_turns_thumbnails_into_links(tmp_path: Path) -> None:
    root = fake_search(tmp_path)
    out = tmp_path / "s.html"
    main(["share", "--search", str(root), "--out", str(out), "--photo-budget", "0"])
    ph = payload_of(out.read_text())["homes"][0]["photos"]
    assert all(x["src"].startswith("https://") for x in ph) and ph[0]["src"] == "https://photos.example/h-1/1.jpg"
    main(["share", "--search", str(root), "--out", str(out), "--no-photos"])
    assert "photos" not in payload_of(out.read_text())["homes"][0]


# --------------------------------------------------------------------------- browser and CLI builders agree
@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize("notes", [False, True])
def test_the_browser_builder_makes_the_same_payload(tmp_path: Path, picks_file: Path, notes: bool) -> None:
    listings = json.loads((DATA / "listings.json").read_text())
    crit = json.loads((DATA / "criteria.json").read_text())
    transit = json.loads((DATA / "layers" / "transit-lines.json").read_text())["features"]
    picks, weights = sh.read_picks(json.loads(picks_file.read_text()))
    py = sh.build_payload(listings, crit, picks, weights=weights, include_notes=notes, with_photos=False, transit_features=transit, generated="2026-10-14")
    cmd = ["node", str(ROOT / "tests" / "js" / "emit-share-payload.mjs"), str(picks_file)] + (["--notes"] if notes else [])
    js = json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=60).stdout)
    for d in (py, js):
        d.pop("source", None)
        d.pop("photo_bytes", None)
    assert py["homes"] == js["homes"]
    assert py == js
