"""scripts/release_check.py photos check: the starter set (examples/*/media-lite) is allowed and size-capped, media/ is not."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("release_check", REPO / "scripts" / "release_check.py")
rc = importlib.util.module_from_spec(spec)
sys.modules["release_check"] = rc
spec.loader.exec_module(rc)


def levels(findings, level: str) -> list[str]:
    return [f.message for f in findings if f.level == level]


def _policy(repo: Path, allowed: bool) -> None:
    (repo / "docs/gallery").mkdir(parents=True, exist_ok=True)
    (repo / "docs/gallery/manifest.json").write_text(json.dumps({"policy": {"listing_photo_files": "allowed" if allowed else "no"}}))


def test_starter_set_is_allowed_under_the_owners_policy_and_the_full_set_still_is_not(tmp_path: Path) -> None:
    (tmp_path / "examples/x/media-lite/shared").mkdir(parents=True)
    (tmp_path / "examples/x/media-lite/shared/a.webp").write_bytes(b"x" * 1000)
    (tmp_path / "examples/x/media-lite/MANIFEST.json").write_text("{}")
    (tmp_path / "examples/x/media/shared").mkdir(parents=True)
    (tmp_path / "examples/x/media/shared/b.webp").write_bytes(b"x")
    files = ["examples/x/media-lite/shared/a.webp", "examples/x/media-lite/MANIFEST.json", "examples/x/media/shared/b.webp"]
    _policy(tmp_path, True)
    found = rc.check_photos(tmp_path, files)
    fails = " | ".join(levels(found, "FAIL"))
    assert "media/shared/b.webp: media or photos folder" in fails and "media-lite/shared/a.webp" not in fails
    assert any("1 starter photos under examples/*/media-lite" in m for m in levels(found, "INFO"))
    _policy(tmp_path, False)
    assert "media-lite/shared/a.webp: listing photo copy" in " | ".join(levels(rc.check_photos(tmp_path, files), "FAIL"))


def test_starter_set_fails_when_it_outgrows_its_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "examples/x/media-lite").mkdir(parents=True)
    (tmp_path / "examples/x/media-lite/a.webp").write_bytes(b"x" * 3000)
    _policy(tmp_path, True)
    monkeypatch.setattr(rc, "LITE_MAX_MB", 0.002)
    assert any("media-lite is 0.0 MB; the limit is 0.002 MB" in m
               for m in levels(rc.check_photos(tmp_path, ["examples/x/media-lite/a.webp"]), "FAIL"))
    monkeypatch.setattr(rc, "LITE_MAX_MB", 40)
    assert not levels(rc.check_photos(tmp_path, ["examples/x/media-lite/a.webp"]), "FAIL")


def test_the_full_set_folder_must_be_ignored() -> None:
    assert "examples/nyc-2026/media/" in rc.MUST_IGNORE


def test_a_single_file_build_may_keep_photo_paths_under_the_policy_but_never_embed_jpeg_data(tmp_path: Path) -> None:
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist/one.html").write_text('<script>{"photos_local":["media/a/p.webp"]}</script>')
    (tmp_path / "dist/jpeg.html").write_text('<img src="data:image/jpeg;base64,AAAA">')
    _policy(tmp_path, True)
    ok = levels(rc.check_photos(tmp_path, ["dist/one.html"]), "FAIL")
    assert not ok
    assert any("jpeg.html: embeds" in m for m in levels(rc.check_photos(tmp_path, ["dist/jpeg.html"]), "FAIL"))
    _policy(tmp_path, False)
    assert any("one.html: embeds" in m for m in levels(rc.check_photos(tmp_path, ["dist/one.html"]), "FAIL"))
