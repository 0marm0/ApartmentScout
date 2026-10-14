"""Blur-up previews (apartmentscout/lqip.py) and persisted photo flags (apartmentscout/photoflags.py)."""
from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from apartmentscout import lqip
from apartmentscout.photoflags import apply_file, apply_flags

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402


def _img(path: Path, size=(120, 80), color=(200, 90, 40)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, "WEBP")


def _listing(**kw) -> dict:
    base = {"id": "a-1", "photos_local": ["media/a-1/p-1.webp", "media/a-1/p-2.webp", "media/a-1/p-3.webp"],
            "photos": ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"]}
    return {**base, **kw}


# ------------------------------------------------------------------ ordering
def test_groups_follow_scope_and_default_to_the_exact_unit() -> None:
    L = _listing(photos_meta=[{"scope": "same-building"}, {"scope": "same-line"}, {}],
                 building_photos=[{"url": "media/a-1/b-1.webp", "local": "media/a-1/b-1.webp", "scope": "building"},
                                  {"url": "media/a-1/s-1.webp", "local": "media/a-1/s-1.webp", "scope": "street"}],
                 floorplan_images=["https://x/fp.png", "media/a-1/fp-1.webp"])
    g = lqip.photo_groups(L)
    assert g["unit"] == ["media/a-1/p-3.webp"]
    assert g["line"] == ["media/a-1/p-2.webp"]
    assert g["building"] == ["media/a-1/p-1.webp", "media/a-1/b-1.webp"]
    assert g["street"] == ["media/a-1/s-1.webp"]
    assert g["plan"] == ["media/a-1/fp-1.webp"]      # only saved copies have a path to preview


def test_flagged_photos_go_last_in_their_group_only() -> None:
    L = _listing(photo_flags={"media/a-1/p-1.webp": {"watermark": True, "why": ["phone number"]}})
    assert lqip.photo_groups(L)["unit"] == ["media/a-1/p-2.webp", "media/a-1/p-3.webp", "media/a-1/p-1.webp"]


def test_previews_cover_the_first_of_each_leading_group() -> None:
    L = _listing(photos_meta=[{}, {"scope": "same-line"}, {"scope": "same-building"}],
                 building_photos=[{"url": "media/a-1/b-1.webp", "local": "media/a-1/b-1.webp", "scope": "building"}],
                 floorplan_images=["media/a-1/fp-1.webp"])
    assert lqip.lqip_targets([L]) == ["media/a-1/p-1.webp", "media/a-1/p-2.webp", "media/a-1/p-3.webp"]


# ------------------------------------------------------------------ the sidecar
def test_make_lqip_is_a_tiny_webp_with_the_source_size(tmp_path: Path) -> None:
    f = tmp_path / "p.webp"
    _img(f, (300, 200))
    w, h, b64 = lqip.make_lqip(f)
    assert (w, h) == (300, 200)
    raw = base64.b64decode(b64)
    assert raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and len(raw) < 600
    with Image.open(__import__("io").BytesIO(raw)) as im:
        assert im.size == (24, 16)
    assert lqip.make_lqip(tmp_path / "missing.webp") is None
    (tmp_path / "bad.webp").write_bytes(b"not an image")
    assert lqip.make_lqip(tmp_path / "bad.webp") is None


def test_build_sidecar_writes_items_and_reuses_the_cache(tmp_path: Path, monkeypatch) -> None:
    media, out = tmp_path / "media", tmp_path / "out"
    out.mkdir()
    for n in (1, 2):
        _img(media / "a-1" / f"p-{n}.webp")
    L = _listing(photos_local=["media/a-1/p-1.webp", "media/a-1/p-2.webp"], photos_meta=[{}, {"scope": "same-line"}])
    cache = tmp_path / "cache" / "lqip.json"
    side = lqip.build_sidecar([L], media, out, cache_path=cache)
    on_disk = json.loads((out / "lqip.json").read_text())
    assert on_disk == side and side["v"] == 1 and side["w"] == 24
    assert set(side["items"]) == {"media/a-1/p-1.webp", "media/a-1/p-2.webp"}
    assert side["items"]["media/a-1/p-1.webp"][:2] == [120, 80]
    # a second build does not decode a single photo
    monkeypatch.setattr(lqip, "make_lqip", lambda *a, **k: pytest.fail("cache miss"))
    assert lqip.build_sidecar([L], media, out, cache_path=cache)["items"] == side["items"]


def test_build_sidecar_without_pillow_skips_and_removes_a_stale_file(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "out"
    out.mkdir()
    (out / "lqip.json").write_text("{}")
    monkeypatch.setattr(lqip, "pillow_available", lambda: False)
    logs: list[str] = []
    assert lqip.build_sidecar([_listing()], tmp_path, out, log=logs.append) is None
    assert not (out / "lqip.json").exists() and "Pillow" in logs[0]


def test_build_sidecar_with_nothing_to_preview_writes_nothing(tmp_path: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()
    assert lqip.build_sidecar([_listing()], tmp_path / "media", out) is None      # no files on disk
    assert not (out / "lqip.json").exists()


def test_alias_remote_keys_the_previews_by_the_original_links() -> None:
    side = {"v": 1, "items": {"media/a-1/p-1.webp": [1, 1, "x"], "media/a-1/p-2.webp": [2, 2, "y"]}}
    out = lqip.alias_remote(side, [_listing(photos_local=["media/a-1/p-1.webp", "media/a-1/p-2.webp"])])
    assert out["items"] == {"https://x/1.jpg": [1, 1, "x"], "https://x/2.jpg": [2, 2, "y"]}


def test_standalone_embeds_the_sidecar_under_remote_links_without_a_media_folder(tmp_path: Path) -> None:
    from apartmentscout.cli import standalone
    data = tmp_path / "data"
    data.mkdir()
    (data / "listings.json").write_text(json.dumps([_listing(photos_local=["media/a-1/p-1.webp"])]))
    (data / "lqip.json").write_text(json.dumps({"v": 1, "items": {"media/a-1/p-1.webp": [3, 2, "AAAA"]}}))
    dest = standalone(data, tmp_path / "out" / "s.html")
    html = dest.read_text()
    blob = json.loads(html.split("window.__AS_DATA__=", 1)[1].split(";</script>", 1)[0].replace("<\\/", "</"))
    assert blob["data/lqip.json"]["items"] == {"https://x/1.jpg": [3, 2, "AAAA"]}
    assert "photos_local" not in blob["data/listings.json"][0]


def test_standalone_leaves_out_an_oversized_sidecar(tmp_path: Path) -> None:
    from apartmentscout.cli import LQIP_INLINE_MAX_KB, standalone
    data = tmp_path / "data"
    data.mkdir()
    (data / "listings.json").write_text(json.dumps([_listing()]))
    (data / "lqip.json").write_text(json.dumps({"v": 1, "items": {"media/a-1/p-1.webp": [3, 2, "A" * (LQIP_INLINE_MAX_KB * 1024)]}}))
    html = standalone(data, tmp_path / "out" / "s.html").read_text()
    assert '"data/lqip.json"' not in html


# ------------------------------------------------------------------ photo flags
FLAGGED = {"media/a-1/p-1.webp": {"why": ["phone number", "face"], "uses": [["a-1", "unit"], ["b-2", "unit"]]},
           "media/gone/p-9.webp": {"why": ["person"], "uses": [["nobody", "unit"]]}}


def test_apply_flags_sets_a_sorted_map_on_the_listings_that_use_the_photo() -> None:
    A, B, C = {"id": "a-1", "x": 1}, {"id": "b-2"}, {"id": "c-3"}
    assert apply_flags([A, B, C], FLAGGED) == 2
    assert A["photo_flags"] == {"media/a-1/p-1.webp": {"watermark": True, "why": ["face", "phone number"]}}
    assert "photo_flags" in B and "photo_flags" not in C and A["x"] == 1


def test_apply_flags_is_idempotent_and_keeps_other_flags() -> None:
    A = {"id": "a-1", "photo_flags": {"media/a-1/p-0.webp": {"watermark": True, "why": ["email"]}}}
    assert apply_flags([A], FLAGGED) == 1
    assert sorted(A["photo_flags"]) == ["media/a-1/p-0.webp", "media/a-1/p-1.webp"]
    assert apply_flags([A], FLAGGED) == 0


def test_apply_file_only_touches_photo_flags_and_keeps_the_format(tmp_path: Path) -> None:
    rows = [{"id": "a-1", "price": {"gross": 1.0}, "notes": "é"}, {"id": "b-2"}]
    lp, fp = tmp_path / "listings.json", tmp_path / "flagged.json"
    lp.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + "\n")
    fp.write_text(json.dumps(FLAGGED))
    assert apply_file(lp, fp, dry_run=True) == (2, 2) and json.loads(lp.read_text()) == rows
    assert apply_file(lp, fp) == (2, 2)
    after = json.loads(lp.read_text())
    assert [{k: v for k, v in r.items() if k != "photo_flags"} for r in after] == rows
    text = lp.read_text()
    assert text.endswith("\n") and "é" in text
    assert apply_file(lp, fp) == (0, 2) and lp.read_text() == text


def test_the_example_data_carries_the_flags() -> None:
    root = Path(__file__).resolve().parents[1] / "examples" / "nyc-2026" / "listings.json"
    rows = json.loads(root.read_text())
    flagged = [L for L in rows if L.get("photo_flags")]
    assert len(flagged) > 50
    for L in flagged:
        for path, f in L["photo_flags"].items():
            assert path.startswith("media/") and f["watermark"] is True and f["why"]
