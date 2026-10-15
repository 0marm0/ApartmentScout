"""scripts/make_media_lite.py: which photos the starter set holds, the caps, determinism, idempotence and size."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("make_media_lite", REPO / "scripts" / "make_media_lite.py")
ml = importlib.util.module_from_spec(spec)
sys.modules["make_media_lite"] = ml
spec.loader.exec_module(ml)

Image = pytest.importorskip("PIL.Image")


def listing(lid: str, rank: int | None, unit: int = 0, building: int = 0, plans: int = 0, status: str = "researching",
            flagged: tuple[int, ...] = ()) -> dict:
    """A listing with ``unit`` own photos, ``building`` licensed building photos and ``plans`` local floor plans."""
    own = [f"media/{lid}/p-{i}.webp" for i in range(unit)]
    L: dict = {"id": lid, "status": status, "photos_local": own,
               "building_photos": [{"url": f"media/{lid}/b-{i}.webp", "local": f"media/{lid}/b-{i}.webp", "scope": "building"}
                                   for i in range(building)],
               "floorplan_images": ["https://example.test/fp.webp"] + [f"media/{lid}/fp-{i}.webp" for i in range(plans)]}
    if rank is not None:
        L["score"] = {"rank": rank}
    if flagged:
        L["photo_flags"] = {own[i]: {"watermark": True, "why": ["phone number"]} for i in flagged}
    return L


def write_image(path: Path, size: tuple[int, int] = (1600, 1000), seed: int = 0) -> None:
    import random
    rnd = random.Random(seed)
    im = Image.new("RGB", size, (rnd.randrange(256),) * 3)
    px = im.load()
    for _ in range(3000):                       # some texture, so the encoder has something to compress
        px[rnd.randrange(size[0]), rnd.randrange(size[1])] = tuple(rnd.randrange(256) for _ in range(3))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=95)


def make_search(tmp: Path, listings: list[dict]) -> Path:
    search = tmp / "search"
    search.mkdir()
    (search / "listings.json").write_text(json.dumps(listings))
    seed = 0
    for L in listings:
        paths = list(L["photos_local"]) + [b["local"] for b in L["building_photos"]] + [p for p in L["floorplan_images"] if p.startswith("media/")]
        for p in paths:
            seed += 1
            write_image(search / p, seed=seed)
    return search


def fleet() -> list[dict]:
    return [listing("top-a", 1, unit=5, building=3, plans=1), listing("top-b", 2, unit=0, building=4),
            listing("third", 3, unit=2, building=2), listing("closed", 4, unit=3, building=1, status="gone"),
            listing("unranked", None, unit=3, building=2, plans=1), listing("bare", 5), listing("pinned", 9, unit=4, building=4)]


def test_select_gives_top_listings_full_galleries_and_the_rest_one_or_two_photos() -> None:
    sel = ml.select(fleet(), ml.Params(top=2, also=("pinned",)))
    assert set(sel.galleries) == {"top-a", "top-b", "pinned"}               # the top two active, plus the pinned one
    assert sel.galleries["top-a"] == 8 and sel.galleries["top-b"] == 4
    assert sel.lite == {"third": 2, "closed": 2, "unranked": 2}             # hero + one building photo each
    assert "media/third/p-0.webp" in sel.files and "media/third/b-0.webp" in sel.files and "media/third/p-1.webp" not in sel.files
    assert sel.files["media/top-a/p-4.webp"] == "gallery" and sel.files["media/third/p-0.webp"] == "lite"
    assert not any(p.startswith("media/bare/") for p in sel.files)          # nothing to show, nothing stored


def test_lite_takes_the_building_photo_after_the_hero_even_when_the_hero_is_a_building_photo() -> None:
    L = listing("b-only", 7, unit=0, building=3)
    assert ml.lite_of(L) == ["media/b-only/b-0.webp", "media/b-only/b-1.webp"]
    assert ml.lite_of(listing("one", 7, unit=0, building=1)) == ["media/one/b-0.webp"]
    assert ml.lite_of(listing("none", 7)) == []


def test_every_local_floor_plan_is_kept_for_every_listing_and_remote_links_are_not() -> None:
    sel = ml.select(fleet(), ml.Params(top=1, also=()))
    plans = {p for p, role in sel.files.items() if role == "plan"}
    assert plans == {"media/top-a/fp-0.webp", "media/unranked/fp-0.webp"}


def test_gallery_is_capped_and_prefers_clean_photos_over_flagged_ones() -> None:
    L = listing("flagy", 1, unit=6, building=4, flagged=(0, 1))             # the first two unit photos carry a broker mark
    got = ml.gallery_of(L, cap=6)
    assert len(got) == 6
    assert "media/flagy/p-0.webp" not in got and "media/flagy/p-1.webp" not in got       # clean ones fill the cap first
    assert got[:4] == [f"media/flagy/p-{i}.webp" for i in (2, 3, 4, 5)]                  # in the dashboard's order
    assert set(ml.gallery_of(L, cap=40)) == set(ml.shown_order(L)) and len(ml.gallery_of(L, cap=40)) == 10


def test_top_listings_skip_closed_unranked_and_photoless_listings() -> None:
    assert [L["id"] for L in ml.top_listings(fleet(), 10)] == ["top-a", "top-b", "third", "pinned"]


def test_a_path_wanted_twice_is_kept_in_its_strongest_role() -> None:
    a, b = listing("a", 1, unit=1), listing("b", 2, unit=1)
    b["photos_local"] = list(a["photos_local"])                              # the same shared photo
    sel = ml.select([a, b], ml.Params(top=1, also=()))
    assert sel.files["media/a/p-0.webp"] == "gallery"


def test_build_writes_the_selection_re_encodes_smaller_and_is_idempotent(tmp_path: Path) -> None:
    search = make_search(tmp_path, fleet())
    params = ml.Params(top=2, also=("pinned",), lite_px=400, gallery_px=800)
    rep = ml.build(search, params=params)
    out = search / "media-lite"
    files = {f.relative_to(out).as_posix() for f in out.rglob("*.webp")}
    assert files == {p.removeprefix("media/") for p, _ in ((p, 0) for p in rep.selection.files)} and rep.files == len(files)
    assert not rep.missing and rep.written == len(files)
    with Image.open(out / "third/p-0.webp") as im:                           # a "lite" photo is shrunk to the long-side limit
        assert max(im.size) == 400
    with Image.open(out / "top-a/p-0.webp") as im:                           # a gallery photo is shrunk less
        assert max(im.size) == 800
    assert (out / "third/p-0.webp").stat().st_size < (search / "media/third/p-0.webp").stat().st_size
    man = json.loads((out / "MANIFEST.json").read_text())
    assert man["files"] == len(files) and set(man["galleries"]) == {"top-a", "top-b", "pinned"}
    first = {f: (out / f).read_bytes() for f in files}
    again = ml.build(search, params=params)                                  # second run: nothing to write or remove
    assert again.written == 0 and again.removed == 0
    assert {f: (out / f).read_bytes() for f in files} == first               # deterministic bytes
    assert ml.check(search, params=params) == []


def test_build_removes_files_that_are_no_longer_selected_and_keeps_what_a_partial_full_set_cannot_replace(tmp_path: Path) -> None:
    search = make_search(tmp_path, fleet())
    params = ml.Params(top=1, also=())
    ml.build(search, params=params)
    out = search / "media-lite"
    stale = out / "gone-listing" / "p-0.webp"
    stale.parent.mkdir()
    stale.write_bytes(b"old")
    (search / "media/third/p-0.webp").unlink()                               # absent from the full set, present in the starter set
    rep = ml.build(search, params=params)
    assert not stale.exists() and not stale.parent.exists() and rep.removed == 1
    assert (out / "third/p-0.webp").is_file() and rep.missing == []
    (out / "third/p-0.webp").unlink()                                        # now absent from both: reported, not invented
    assert ml.build(search, params=params).missing == ["media/third/p-0.webp"]


def test_dry_run_writes_nothing_and_reports_the_size(tmp_path: Path) -> None:
    search = make_search(tmp_path, fleet())
    rep = ml.build(search, params=ml.Params(top=1, also=()), dry=True)
    assert rep.files > 0 and rep.bytes > 0 and not (search / "media-lite").exists()
    assert "full galleries" in ml.summary(rep, ml.Params(top=1, also=()))


def test_check_reports_a_set_that_has_drifted_from_the_listings(tmp_path: Path) -> None:
    search = make_search(tmp_path, fleet())
    params = ml.Params(top=1, also=())
    assert ml.check(search, params=params)                                   # nothing built yet: everything is missing
    ml.build(search, params=params)
    assert ml.check(search, params=params) == []
    (search / "media-lite/top-a/p-0.webp").unlink()
    (search / "media-lite/extra.webp").write_bytes(b"x")
    problems = ml.check(search, params=params)
    assert len(problems) == 2 and "not in media-lite" in problems[0] and "no longer selected" in problems[1]


def test_main_refuses_without_a_full_set_and_runs_a_dry_plan_otherwise(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    (empty / "listings.json").write_text("[]")
    assert ml.main([str(empty)]) == 2 and "fetch_media" in capsys.readouterr().err
    (tmp_path / "full").mkdir()
    assert ml.main([str(make_search(tmp_path / "full", fleet())), "--dry", "--top", "1"]) == 0
    assert "full galleries" in capsys.readouterr().out


def test_the_committed_starter_set_matches_the_example_listings() -> None:
    """The real thing, no full set needed: every listing with photos has its hero, nothing is orphaned, the size is capped."""
    search = REPO / "examples" / "nyc-2026"
    lite = search / "media-lite"
    if not lite.is_dir():
        pytest.skip("no starter set in this checkout")
    listings = json.loads((search / "listings.json").read_text())
    have = {f.relative_to(lite).as_posix() for f in lite.rglob("*") if f.is_file() and f.name != ml.MANIFEST}
    missing = [L["id"] for L in listings if ml.shown_order(L) and ml.shown_order(L)[0].removeprefix("media/") not in have]
    assert not missing, f"listings without their hero photo in media-lite: {missing[:5]}"
    assert ml.check(search) == [], "run scripts/make_media_lite.py (needs the full set: scripts/fetch_media.sh) and commit the result"
    assert sum((lite / r).stat().st_size for r in have) / 1e6 <= 40
