"""scripts/release_check.py: privacy grep with allow-list, screenshot manifest gate, ignore rules, photos."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("release_check", REPO / "scripts" / "release_check.py")
rc = importlib.util.module_from_spec(spec)
sys.modules["release_check"] = rc     # dataclasses look the module up while the class is created
spec.loader.exec_module(rc)


def levels(findings, level: str) -> list[str]:
    return [f.message for f in findings if f.level == level]


def test_privacy_defaults_and_private_patterns(tmp_path: Path) -> None:
    home, mail = "/" + "Users/someone", "jane.doe" + "@" + "corp-mail.net"   # split so this file passes the gate
    (tmp_path / "a.md").write_text(f"built in {home}/x and mail {mail}\n")
    (tmp_path / "b.md").write_text("contact noreply@example.com, icon@2x.png, three@0.160.0\nWorks at Acme Widgets\n")
    (tmp_path / "c.json").write_text('{"station": "Simpson St", "lm": "Harvard Club"}\n')
    pats = tmp_path / "private.txt"
    pats.write_text("# private strings\nAcme Widgets\nre:\\bSimpson\\b\nHarvard\nallow:Simpson St\n")
    extra, allow, where = rc.load_patterns(pats)
    assert "Simpson St" in allow and "Harvard Club" in allow and "file outside" in where
    f = rc.check_privacy(tmp_path, ["a.md", "b.md", "c.json"], extra, allow)
    fails = levels(f, "FAIL")
    assert any(f"a.md:1: local-path '{home}'" in m for m in fails)
    assert any("a.md:1: email" in m for m in fails)
    assert any(m.startswith("b.md:2: private") for m in fails)
    assert not any("example.com" in m or "2x" in m or "c.json" in m for m in fails)
    info = levels(f, "INFO")
    assert any("'Simpson St'" in m for m in info) and any("'Harvard Club'" in m for m in info)
    assert "Acme Widgets" not in " ".join(fails)          # private hits are masked in the output


def test_allow_list_is_an_exact_phrase(tmp_path: Path) -> None:
    (tmp_path / "x.md").write_text("Simpson Street and Simpson St\n")
    f = rc.check_privacy(tmp_path, ["x.md"], [("private", r"Simpson")], ["Simpson St"])
    assert len(levels(f, "FAIL")) == 1 and len(levels(f, "INFO")) == 1


def _img(path: Path, data: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def test_image_manifest_gate(tmp_path: Path) -> None:
    sha_pub = _img(tmp_path / "docs/images/ok.png", b"public")
    sha_priv = _img(tmp_path / "docs/gallery/a--render.jpg", b"private")
    _img(tmp_path / "docs/gallery/b--plan.jpg", b"review")
    _img(tmp_path / "docs/gallery/new.jpg", b"new")
    _img(tmp_path / "docs/images/changed.png", b"after")
    man = {"images": [
        {"file": "docs/images/ok.png", "publication_status": "public", "sha256": sha_pub},
        {"file": "docs/gallery/a--render.jpg", "publication_status": "private", "sha256": sha_priv,
         "note": "listing render"},
        {"file": "docs/gallery/b--plan.jpg", "publication_status": "review"},
        {"file": "docs/images/changed.png", "publication_status": "public", "sha256": "0" * 64},
        {"file": "docs/images/gone.png", "publication_status": "public"}]}
    (tmp_path / rc.MANIFEST).write_text(json.dumps(man))
    f = rc.check_images(tmp_path)
    fails = " | ".join(levels(f, "FAIL"))
    assert "a--render.jpg: publication_status is private (listing render)" in fails
    assert "b--plan.jpg: publication_status is review" in fails
    assert "new.jpg: not in the screenshot manifest" in fails
    assert "changed.png: changed since it was reviewed" in fails
    assert "ok.png" not in fails
    assert any("gone.png" in m for m in levels(f, "WARN"))
    rc.check_images(tmp_path, add_new=True)
    m2 = json.loads((tmp_path / rc.MANIFEST).read_text())
    assert next(e for e in m2["images"] if e["file"] == "docs/gallery/new.jpg")["publication_status"] == "review"


def test_repo_manifest_covers_every_image_with_the_agreed_statuses() -> None:
    # Owner decision (2026-10-13): every image is public while the repository is private, and hot-linked
    # listing photo URLs are allowed; the decision is recorded in the manifest's policy block.
    man = json.loads((REPO / rc.MANIFEST).read_text())
    assert set(rc.image_files(REPO)) <= {e["file"] for e in man["images"]}
    assert all(e["publication_status"] == "public" for e in man["images"])
    assert man.get("policy", {}).get("listing_photo_urls") == "allowed"
    assert man["policy"].get("decided") and man["policy"].get("reason")


@pytest.mark.skipif(not shutil.which("git"), reason="git not installed")
def test_ignore_rules(tmp_path: Path) -> None:
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / ".gitignore").write_text("searches/*\n!searches/.gitkeep\n_reference/\nHANDOFF.md\n")
    f = rc.check_ignored(tmp_path)
    assert levels(f, "FAIL") == ["dashboard/data-private/ is not git-ignored"]
    (tmp_path / ".git" / "info").mkdir(exist_ok=True)
    (tmp_path / ".git" / "info" / "exclude").write_text("dashboard/data-private/\n")
    f = rc.check_ignored(tmp_path)
    assert not levels(f, "FAIL") and any("info/exclude" in m for m in levels(f, "WARN"))


def test_photo_check(tmp_path: Path) -> None:
    (tmp_path / "examples/x/research/charts").mkdir(parents=True)
    (tmp_path / "examples/x/media").mkdir(parents=True)
    (tmp_path / "examples/x/research/charts/sun.png").write_bytes(b"chart")
    (tmp_path / "examples/x/unit.jpg").write_bytes(b"photo")
    (tmp_path / "examples/x/media/a.jpg").write_bytes(b"photo")
    (tmp_path / "examples/x/listings.json").write_text(json.dumps([
        {"id": "a", "photos_local": ["media/a/1.jpg"]},
        {"id": "b", "building_photos": [{"url": "https://commons.example/x.jpg"}], "links": {"floorplan": "photos/b.jpg"}},
    ]))
    files = ["examples/x/research/charts/sun.png", "examples/x/unit.jpg", "examples/x/media/a.jpg",
             "examples/x/listings.json"]
    f = rc.check_photos(tmp_path, files)
    fails = " | ".join(levels(f, "FAIL"))
    assert "unit.jpg: image file" in fails and "media/a.jpg: media or photos folder" in fails
    assert "a has local photo copies" in fails and "sun.png" not in fails and ": b " not in fails
    assert any("1 link(s) to local photo paths" in m for m in levels(f, "WARN"))


@pytest.mark.skipif(not shutil.which("git"), reason="git not installed")
def test_main_exit_status(tmp_path: Path, capsys) -> None:
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / "ok.md").write_text("nothing private\n")
    pats = tmp_path.parent / f"{tmp_path.name}-patterns.txt"
    pats.write_text("Secret Phrase\n")
    assert rc.main(["--repo", str(tmp_path), "--only", "privacy", "--patterns", str(pats), "--quiet"]) == 0
    assert "OK to release" in capsys.readouterr().out
    (tmp_path / "bad.md").write_text("the secret phrase\n")
    assert rc.main(["--repo", str(tmp_path), "--only", "privacy", "--patterns", str(pats)]) == 1
    assert "RELEASE BLOCKED" in capsys.readouterr().out
