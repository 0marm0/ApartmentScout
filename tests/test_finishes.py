"""`apartmentscout finishes` (apartmentscout/finishes.py, commands/finishes.py): the finishes model's Python twin, the words and pixels it reads,
how a proposal merges into a plan file (a renter's value is never replaced), and the example's plans. No network; Pillow is needed for the pixel tests."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from apartmentscout import cli, planfile
from apartmentscout import finishes as F

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "nyc-2026"

def need_pillow() -> None:
    pytest.importorskip("PIL")


# ------------------------------------------------------------------ the model, in step with the JavaScript
def test_the_named_tones_are_the_same_in_python_and_in_the_dashboard() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    js = ROOT / "dashboard" / "js" / "plan" / "finishes.js"
    out = subprocess.run(["node", "--input-type=module", "-e", f"import {{ NAMED_TONES, FLOOR_PATTERNS, BASES, LEGACY_FLOOR }} from {json.dumps(js.as_uri())}; console.log(JSON.stringify({{ NAMED_TONES, FLOOR_PATTERNS, BASES, LEGACY_FLOOR }}));"],
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    assert data["NAMED_TONES"] == F.NAMED_TONES
    assert tuple(data["FLOOR_PATTERNS"]) == F.PATTERNS and tuple(data["BASES"]) == F.BASES and data["LEGACY_FLOOR"] == F.LEGACY_FLOOR


@pytest.mark.parametrize("value,hexa", [("#D9B577", "#d9b577"), ("d9b577", "#d9b577"), ("#fa0", "#ffaa00"), ("Honey-Oak", "#d9a866"), ("  BLACK_granite ", "#2a2a2c"), (0xD9B577, "#d9b577"),
                                         ("lava", None), ("#12", None), ("", None), (None, None), (True, None), (1.5, None), (-1, None)])
def test_parse_tone(value: Any, hexa: str | None) -> None:
    assert F.parse_tone(value) == hexa


GOOD = {"floor": {"pattern": "basket", "tone": "#d9b577", "basis": "photos", "evidence": "photos 1-3"}, "walls": "#eeeeea", "kitchen": {"counters": {"colour": "black granite", "basis": "listing_text"}}}


def test_finishes_error_accepts_a_good_block_and_names_the_first_problem() -> None:
    assert F.finishes_error(GOOD) == "" and F.finishes_error(None) == ""
    for bad, msg in [({"floor": {"pattern": "lava"}}, "pattern"), ({"walls": {"colour": "plaid"}}, "colour"), ({"walls": {"colour": "#fff", "basis": "rumour"}}, "basis"),
                     ({"walls": {"colour": "#fff", "hue": 1}}, "unsupported field hue"), ({"roof": {}}, "unsupported field roof"), ({"kitchen": {"sink": "#fff"}}, "unsupported field sink"),
                     ({"floor": {"basis": "photos"}}, "needs a pattern or a tone"), ({"walls": {"colour": "#fff", "evidence": "<b>"}}, "plain text"), ([], "object")]:
        assert msg in F.finishes_error(bad), bad


def test_a_plan_with_bad_finishes_is_refused_by_the_plan_checker() -> None:
    plan = json.loads((EXAMPLE / "plans" / "emerald-green-1211.json").read_text())
    assert planfile.check_plan({**plan, "finishes": GOOD})[0] == []
    errors, _ = planfile.check_plan({**plan, "finishes": {"floor": {"pattern": "lava"}}})
    assert errors and "pattern" in errors[0]


# ------------------------------------------------------------------ the words
def test_the_words_set_the_floor_pattern_frames_cabinets_and_counters() -> None:
    t = F.read_text(["Glenwood lists granite kitchens and marble baths", "white cabinets, parquet and bay windows", "large dark-framed windows"])
    assert t.floor_pattern and t.floor_pattern[0] == "basket" and "block parquet" in t.floor_pattern[1]
    assert t.frames and t.frames[0] == "black"
    assert t.cabinets and t.cabinets[0] == "white"
    assert t.counters and t.counters[0] == "granite"
    assert t.bath_tile and t.bath_tile[0] == "white marble"
    assert F.read_text(["herringbone oak floors"]).floor_pattern[0] == "herringbone"
    assert F.read_text(["a basket-weave floor"]).floor_pattern[0] == "basket"
    assert F.read_text(["light plank floors"]).floor_pattern[0] == "plank"
    assert F.read_text(["white-framed windows"]).frames[0] == "white"
    assert F.read_text(["polished concrete floors"]).floor_pattern[0] == "concrete"


def test_words_that_name_no_finish_set_nothing() -> None:
    t = F.read_text(["hardwood floors throughout, stainless appliances, great light", ""])
    assert t.floor_pattern is None and t.frames is None and t.cabinets is None and t.counters is None
    assert F.read_text([]).floor_pattern is None


def test_the_fragment_kept_as_evidence_is_a_clause_not_half_a_word() -> None:
    frag = F.read_text(["Same-building photos; stainless GE appliances, white cabinets, parquet and bay windows; the view grade comes from the renter"]).floor_pattern[1]
    assert frag.startswith("parquet and bay windows") and len(frag) < 70


def test_listings_that_share_photos_share_their_words() -> None:
    a = {"id": "a", "photos_local": ["media/shared/1.webp"], "photo_review": {"evidence": "parquet floors"}}
    b = {"id": "b", "photos_local": ["media/shared/1.webp"], "photo_review": {"evidence": "no finish named"}}
    c = {"id": "c", "photos_local": ["media/c/9.webp"]}
    from apartmentscout.commands import finishes as cmd
    assert [o["id"] for o in cmd.sharing(b, [a, b, c])] == ["a"]
    assert F.read_text(F.listing_texts(b, cmd.sharing(b, [a, b, c]))).floor_pattern[0] == "basket"


# ------------------------------------------------------------------ merging into a plan
def test_a_renter_value_is_never_replaced_and_the_tools_own_readings_are_refreshed() -> None:
    existing = {"floor": {"pattern": "plank", "tone": "#caa070", "basis": "renter"}, "walls": {"colour": "#eeeeee", "basis": "photos", "evidence": "photo 1"}}
    proposal = {"floor": {"pattern": "basket", "tone": "#916b42", "basis": "photos", "evidence": "photos 1-3"}, "walls": {"colour": "#f6f5f1", "basis": "photos", "evidence": "photos 1-3"},
                "kitchen": {"cabinets": {"colour": "#ffffff", "basis": "photos", "evidence": "photo 11"}}}
    merged, changed, kept = F.merge_finishes(existing, proposal)
    assert merged["floor"]["basis"] == "renter" and merged["floor"]["tone"] == "#caa070"
    assert merged["walls"]["colour"] == "#f6f5f1" and merged["kitchen"]["cabinets"]["colour"] == "#ffffff"
    assert kept == ["floor"] and changed == ["walls", "kitchen.cabinets"]
    again, changed2, _ = F.merge_finishes(merged, {k: v for k, v in proposal.items() if k != "floor"})
    assert changed2 == [] and again == merged


def test_the_old_floor_finish_names_the_pattern_the_photos_did_not() -> None:
    merged, changed, _ = F.merge_finishes(None, {"floor": {"tone": "#916b42", "basis": "photos", "evidence": "photo 1"}}, "parquet")
    assert merged["floor"]["pattern"] == "herringbone" and changed == ["floor"]


# ------------------------------------------------------------------ the plan file: only the finishes block changes
PLAN_TEXT = """{
 "schema": 2,
 "id": "demo-1a",
 "up_bearing": 118.7,
 "floor": 25,
 "floor_finish": "basket",
 "rooms": [
  {"name": "Living room", "kind": "living", "poly": [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]}
 ]
}
"""


def test_splicing_adds_the_block_after_floor_finish_and_touches_nothing_else() -> None:
    out = F.splice_finishes(PLAN_TEXT, GOOD)
    assert json.loads(out)["finishes"] == GOOD
    before, after = PLAN_TEXT.split(' "floor_finish": "basket",\n')
    assert out.startswith(before + ' "floor_finish": "basket",\n "finishes": {\n  "floor": {') and out.endswith(after)   # the compact polygon line is untouched
    assert F.splice_finishes(out, GOOD) == out                                  # idempotent
    new = {**GOOD, "walls": "#111111"}
    replaced = F.splice_finishes(out, new)
    assert json.loads(replaced)["finishes"]["walls"] == "#111111" and replaced.endswith(after)
    assert json.loads(replaced) == {**json.loads(PLAN_TEXT), "finishes": new}


def test_splicing_works_with_two_space_indent_and_no_anchor() -> None:
    text = json.dumps({"schema": 2, "id": "x", "rooms": [{"name": "A", "poly": [[0, 0], [1, 0], [1, 1]]}]}, indent=2) + "\n"
    out = F.splice_finishes(text, {"walls": "#eeeeee"})
    assert json.loads(out)["finishes"] == {"walls": "#eeeeee"} and out.endswith("\n")


# ------------------------------------------------------------------ the pixels (synthetic photos)
def make_room(path: Path, floor=(196, 141, 78), wall=(238, 236, 232), window=False, kitchen=False) -> None:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (400, 267), wall)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 170, 400, 267], fill=floor)                 # the floor: the bottom band
    for x in range(0, 400, 40):
        d.line([x, 170, x + 10, 267], fill=tuple(int(c * 0.85) for c in floor), width=2)   # joints, so it is not one flat tone
    if window:
        d.rectangle([150, 30, 260, 140], fill=(130, 180, 240))  # sky
        d.rectangle([150, 30, 260, 140], outline=(245, 245, 243), width=7)   # a pale frame around the glass
    if kitchen:
        d.rectangle([0, 120, 400, 170], fill=(30, 30, 30))      # a dark counter and backsplash
        d.rectangle([0, 20, 400, 110], fill=(250, 250, 248))    # white cabinets
    im.save(path)


def search_with(tmp: Path, rooms: list[tuple[str, dict]], plan_text: str = PLAN_TEXT, listing_extra: dict | None = None) -> Path:
    (tmp / "media" / "demo-1a").mkdir(parents=True)
    photos, meta = [], []
    for name, kw in rooms:
        p = tmp / "media" / "demo-1a" / f"{name}.png"
        make_room(p, **kw)
        photos.append(f"media/demo-1a/{name}.png")
        meta.append({"local": f"media/demo-1a/{name}.png", "title": name})
    (tmp / "criteria.yaml").write_text("search:\n  name: t\n")
    (tmp / "listings.json").write_text(json.dumps([{"id": "demo-1a", "photos_local": photos, "photos_meta": meta, **(listing_extra or {})}]))
    (tmp / "plans").mkdir()
    (tmp / "plans" / "demo-1a.json").write_text(plan_text)
    return tmp


def test_a_synthetic_wood_floor_and_white_walls_are_read_from_the_photos(tmp_path: Path) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {"window": True}), ("living room corner", {"window": True}), ("bedroom", {})])
    listing = json.loads((root / "listings.json").read_text())[0]
    prop = F.propose(listing, [], root)
    fl = prop.finishes["floor"]
    assert fl["basis"] == "photos" and "photos 1-3" in fl["evidence"] and "tone" in fl
    # the drawn colour is the photo's colour mapped through the room renderer: it stays a warm honey (red > green > blue), a little more saturated than the photo
    r, g, b = F.hex_rgb(fl["tone"])
    assert r > g > b and 150 < r < 235 and r - b > 80
    assert prop.finishes["walls"]["basis"] == "photos" and min(F.hex_rgb(prop.finishes["walls"]["colour"])) > 220
    assert prop.photos_read == 3 and prop.photos_missing == 0
    assert F.finishes_error(prop.finishes) == ""


def test_the_kitchen_photo_gives_cabinets_counters_and_backsplash(tmp_path: Path) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {}), ("kitchen", {"kitchen": True})])
    prop = F.propose(json.loads((root / "listings.json").read_text())[0], [], root)
    k = prop.finishes["kitchen"]
    assert min(F.hex_rgb(k["cabinets"]["colour"])) > 230 and k["cabinets"]["evidence"] == "kitchen photo 2"
    assert max(F.hex_rgb(k["counters"]["colour"])) < 60 and k["counters"]["basis"] == "photos"
    assert "backsplash" in k


def test_a_pale_edge_around_the_glass_reads_as_white_window_frames(tmp_path: Path) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {"window": True}), ("bed", {"window": True}), ("hall", {})])
    prop = F.propose(json.loads((root / "listings.json").read_text())[0], [], root)
    wf = prop.finishes["window_frames"]
    assert wf["basis"] == "photos" and min(F.hex_rgb(wf["colour"])) > 200 and "photos 1-2" in wf["evidence"]


def test_a_photo_that_is_not_an_interior_is_not_read(tmp_path: Path) -> None:
    need_pillow()
    from PIL import Image
    (tmp_path / "media" / "demo-1a").mkdir(parents=True)
    Image.new("RGB", (300, 200), (255, 255, 255)).save(tmp_path / "media" / "demo-1a" / "plan.png")    # a floor plan drawing: all white
    Image.new("RGB", (300, 200), (120, 170, 235)).save(tmp_path / "media" / "demo-1a" / "sky.png")     # a facade shot: all sky
    prop = F.propose({"id": "demo-1a", "photos_local": ["media/demo-1a/plan.png", "media/demo-1a/sky.png"]}, [], tmp_path)
    assert prop.finishes == {} and prop.photos_read == 2


def test_the_words_confirm_or_contradict_the_photos(tmp_path: Path) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {"window": True}), ("bed", {"window": True})],
                       listing_extra={"photo_review": {"evidence": "herringbone oak floors, large black-framed windows"}})
    prop = F.propose(json.loads((root / "listings.json").read_text())[0], [], root)
    assert prop.finishes["floor"]["pattern"] == "herringbone" and prop.finishes["floor"]["basis"] == "photos"      # tone from photos, pattern from the words
    wf = prop.finishes["window_frames"]
    assert wf["basis"] == "listing_text" and "black-framed" in wf["evidence"] and "photos read white" in wf["evidence"]   # the words win, the disagreement is said


def test_without_pillow_only_the_words_are_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {})], listing_extra={"photo_review": {"evidence": "white cabinets, parquet floors"}})
    monkeypatch.setattr(F, "pillow_available", lambda: False)
    prop = F.propose(json.loads((root / "listings.json").read_text())[0], [], root)
    assert "Pillow" in prop.notes[0] and prop.photos_read == 0
    assert prop.finishes["floor"] == {"pattern": "basket", "basis": "listing_text", "evidence": "pattern from the listing's words: \"parquet floors (read as block parquet)\"", "confidence": "low"}


# ------------------------------------------------------------------ the command
def run(root: Path, *extra: str) -> None:
    cli.main(["finishes", "--search", str(root), *extra])


def test_the_command_writes_the_plan_keeps_the_renter_and_is_idempotent(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {"window": True}), ("living room 2", {"window": True}), ("bed", {})])
    plan_path = root / "plans" / "demo-1a.json"
    # a renter-set wall colour in the plan survives
    plan_path.write_text(F.splice_finishes(PLAN_TEXT, {"walls": {"colour": "#e0d8c8", "basis": "renter", "evidence": "my own paint"}}))
    run(root)
    out = capsys.readouterr().out
    assert "Wrote plans/demo-1a.json" in out and "walls" in out.split("Kept (set by the renter")[1]
    doc = json.loads(plan_path.read_text())
    assert doc["finishes"]["walls"] == {"colour": "#e0d8c8", "basis": "renter", "evidence": "my own paint"}
    assert doc["finishes"]["floor"]["basis"] == "photos" and doc["floor_finish"] == "basket"
    assert planfile.check_plan(doc)[0] == []
    text = plan_path.read_text()
    run(root)
    assert "Already up to date" in capsys.readouterr().out and plan_path.read_text() == text


def test_dry_run_changes_nothing(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {}), ("bed", {})])
    before = (root / "plans" / "demo-1a.json").read_text()
    run(root, "--dry-run")
    assert "dry run" in capsys.readouterr().out and (root / "plans" / "demo-1a.json").read_text() == before


def test_a_home_without_a_plan_is_reported_not_written(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    need_pillow()
    root = search_with(tmp_path, [("living room", {}), ("bed", {})])
    (root / "plans" / "demo-1a.json").unlink()
    (root / "plans" / "other.json").write_text(PLAN_TEXT.replace("demo-1a", "other"))
    with pytest.raises(SystemExit):
        run(root)                                                      # no plan matches a listing
    run(root, "--listing", "demo-1a")
    assert "No plan for this home" in capsys.readouterr().out and not (root / "plans" / "demo-1a.json").exists()


def test_words_only_needs_no_photos(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    root = tmp_path
    (root / "criteria.yaml").write_text("search:\n  name: t\n")
    (root / "listings.json").write_text(json.dumps([{"id": "demo-1a", "photo_review": {"evidence": "light plank floors, dark-framed windows"}}]))
    (root / "plans").mkdir()
    (root / "plans" / "demo-1a.json").write_text(PLAN_TEXT)
    run(root, "--words-only")
    doc = json.loads((root / "plans" / "demo-1a.json").read_text())
    assert doc["finishes"]["floor"]["pattern"] == "plank" and doc["finishes"]["window_frames"]["colour"] == F.NAMED_TONES["black"]
    assert all(leaf["basis"] == "listing_text" for leaf in (doc["finishes"]["floor"], doc["finishes"]["window_frames"]))


# ------------------------------------------------------------------ the example
def test_the_examples_plans_carry_finishes_read_from_their_photos_and_both_copies_agree() -> None:
    names = sorted(p.name for p in (EXAMPLE / "plans").glob("*.json"))
    with_photos = []
    for n in names:
        doc = json.loads((EXAMPLE / "plans" / n).read_text())
        assert (EXAMPLE / "plans" / n).read_text() == (ROOT / "dashboard" / "data" / "plans" / n).read_text(), f"{n}: the dashboard copy is stale (apartmentscout build copies it)"
        if "finishes" in doc:
            assert F.finishes_error(doc["finishes"]) == "" and planfile.check_plan(doc)[0] == [], n
            with_photos.append(n)
            for leaf_path in F.leaf_paths():
                leaf = F.get_leaf(doc["finishes"], leaf_path)
                if leaf and leaf["basis"] == "photos":
                    assert leaf.get("evidence"), (n, leaf_path)
    assert "paramount-tower-25e.json" in with_photos and "the-greywood-4b.json" in with_photos


def test_the_tool_reproduces_the_examples_paramount_24e_from_the_starter_photos() -> None:
    need_pillow()
    listings = json.loads((EXAMPLE / "listings.json").read_text())
    by = {L["id"]: L for L in listings}
    from apartmentscout.commands import finishes as cmd
    listing = by["paramount-tower-25e"]
    prop = F.propose(listing, cmd.sharing(listing, listings), EXAMPLE)
    assert prop.photos_read == 12 and prop.photos_missing == 0
    doc = json.loads((EXAMPLE / "plans" / "paramount-tower-25e.json").read_text())
    for path in F.leaf_paths():
        want, got = F.get_leaf(doc["finishes"], path), F.get_leaf(prop.finishes, path)
        assert got == want, (path, got, want)                      # the committed plan is what the tool says today
    fl = prop.finishes["floor"]
    assert fl["pattern"] == "basket" and fl["basis"] == "photos"
    r, g, b = F.hex_rgb(fl["tone"])
    assert r > g > b and 120 < r < 190                              # honey wood
    assert prop.finishes["window_frames"]["basis"] == "photos" and min(F.hex_rgb(prop.finishes["window_frames"]["colour"])) > 190   # pale aluminium, not black
    assert max(F.hex_rgb(prop.finishes["kitchen"]["counters"]["colour"])) < 70                                                      # black granite
