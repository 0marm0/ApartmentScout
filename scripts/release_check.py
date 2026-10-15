#!/usr/bin/env python3
"""Release gate: run before making the repository (or a new commit of it) public.

    python scripts/release_check.py                 every check, including pytest and node tests
    python scripts/release_check.py --skip-tests    the fast checks only
    python scripts/release_check.py --only privacy,images
    python scripts/release_check.py --add-new-images   add unlisted images to the manifest as "review"

Checks
  privacy   every file git would publish (tracked, plus untracked files that are not ignored) is scanned for local
            home-directory paths, e-mail addresses and the private strings in your pattern file. The pattern file
            lives OUTSIDE the repo: --patterns FILE, $APARTMENTSCOUT_PRIVACY_PATTERNS, or
            ~/.config/apartmentscout/privacy-patterns.txt. One entry per line:
                Jane Example          a literal phrase (case-insensitive)
                re:\\bAcme\\s+Corp\\b    a regular expression
                allow:Simpson St       an exact public phrase that may contain a private string (reported as info)
                # comment
  images    every image in docs/images/, docs/gallery/ and docs/archive/ must be listed in docs/gallery/manifest.json with
            publication_status "public" and an unchanged sha256. "private" and "review" fail.
  ignored   searches/, _reference/, HANDOFF.md and dashboard/data-private/ are git-ignored and nothing in them is
            tracked.
  photos    no listing photos in tracked example data: no image files outside examples/*/research/charts/, no media/
            or photos/ folders, no photos / photos_local fields or local building-photo copies in example listings.
  tests     pytest and `node --test tests/js`.

Exit status 0 when nothing FAILs (WARN and INFO never fail the gate).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from apartmentscout.handoff.safety import compile_patterns, privacy_hits  # noqa: E402

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
IMAGE_DIRS = ("docs/images", "docs/gallery", "docs/archive")   # the archive keeps earlier screenshots; they are checked like the live ones
MANIFEST = "docs/gallery/manifest.json"
STATUSES = ("public", "private", "review")
MUST_IGNORE = {"searches/": "searches/example-private/criteria.yaml", "_reference/": "_reference/x.md",
               "HANDOFF.md": "HANDOFF.md", "dashboard/data-private/": "dashboard/data-private/listings.json"}
# Public phrases that contain a string an owner may reasonably list as private (a station name, a landmark).
DEFAULT_ALLOW = ("Simpson St", "Harvard Club")
DEFAULT_PATTERN_FILE = Path.home() / ".config" / "apartmentscout" / "privacy-patterns.txt"
MAX_SCAN_BYTES = 40 * 1024 * 1024


@dataclass(frozen=True)
class Finding:
    level: str      # FAIL, WARN, INFO, PASS
    check: str
    message: str


# --------------------------------------------------------------------------- helpers
def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=False).stdout


def publishable_files(repo: Path) -> list[str]:
    """Tracked files plus untracked files that are not ignored (what `git add -A` would publish)."""
    out = git(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    return sorted({p for p in out.split("\0") if p and (repo / p).is_file()})


def tracked_files(repo: Path) -> list[str]:
    return [p for p in git(repo, "ls-files", "-z").split("\0") if p]


def load_patterns(path: Path | None) -> tuple[list[tuple[str, str]], list[str], str]:
    """(extra patterns, allow phrases, where they came from)."""
    src = path or (Path(os.environ["APARTMENTSCOUT_PRIVACY_PATTERNS"])
                   if os.environ.get("APARTMENTSCOUT_PRIVACY_PATTERNS") else None)
    if src is None and DEFAULT_PATTERN_FILE.exists():
        src = DEFAULT_PATTERN_FILE
    allow = list(DEFAULT_ALLOW)
    if src is None:
        return [], allow, "built-in defaults only (local paths and e-mail addresses)"
    if not src.exists():
        raise SystemExit(f"privacy pattern file not found: {src}")
    extra: list[tuple[str, str]] = []
    for line in src.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        if t.startswith("allow:"):
            allow.append(t[6:].strip())
        elif t.startswith("re:"):
            extra.append(("private", t[3:].strip()))
        else:
            extra.append(("private", r"(?i)" + re.escape(t)))
    return extra, allow, f"defaults + {len(extra)} private pattern(s) from a file outside the repo"


def _mask(name: str, hit: str) -> str:
    return hit if name == "local-path" else (hit[:2] + "…" + hit[-2:] if len(hit) > 6 else hit[:1] + "…")


def allowed_spans(text: str, allow: list[str]) -> list[tuple[int, int, str]]:
    spans = []
    for phrase in allow:
        if phrase:
            rx = r"(?<!\w)" + re.escape(phrase) + r"(?!\w)"      # whole words: "Simpson St" is not "Simpson Street"
            spans += [(m.start(), m.end(), phrase) for m in re.finditer(rx, text)]
    return spans


# --------------------------------------------------------------------------- checks
def check_privacy(repo: Path, files: list[str], extra: list[tuple[str, str]], allow: list[str]) -> list[Finding]:
    pats = compile_patterns(extra)
    found: list[Finding] = []
    info: dict[str, int] = {}
    for rel in files:
        p = repo / rel
        try:
            if p.stat().st_size > MAX_SCAN_BYTES:
                found.append(Finding("WARN", "privacy", f"{rel}: larger than 40 MB, not scanned"))
                continue
            raw = p.read_bytes()
        except OSError:
            continue
        if b"\0" in raw[:8192] or p.suffix.lower() in IMAGE_EXT:
            continue
        text = raw.decode("utf-8", errors="replace")
        spans = None
        for name, rx in pats:
            for m in rx.finditer(text):
                hit = m.group(0)
                if not privacy_hits(hit, [(name, rx)]):
                    continue           # an allow-listed e-mail or an asset name
                if spans is None:
                    spans = allowed_spans(text, allow)
                ok = next((ph for s, e, ph in spans if s <= m.start() and m.end() <= e), None)
                if ok:
                    info[f"{rel}: '{ok}'"] = info.get(f"{rel}: '{ok}'", 0) + 1
                    continue
                line = text.count("\n", 0, m.start()) + 1
                found.append(Finding("FAIL", "privacy", f"{rel}:{line}: {name} {_mask(name, hit)!r}"))
    for k, n in sorted(info.items()):
        found.append(Finding("INFO", "privacy", f"allow-listed public phrase {k} x{n}"))
    if not any(f.level == "FAIL" for f in found):
        found.append(Finding("PASS", "privacy", f"{len(files)} files scanned"))
    return found


def image_files(repo: Path) -> list[str]:
    out = []
    for d in IMAGE_DIRS:
        base = repo / d
        if base.is_dir():
            out += [p.relative_to(repo).as_posix() for p in sorted(base.rglob("*"))
                    if p.is_file() and p.suffix.lower() in IMAGE_EXT]
    return out


def image_entry(repo: Path, rel: str, status: str, note: str | None = None) -> dict:
    p = repo / rel
    w = h = None
    try:
        from PIL import Image
        with Image.open(p) as im:
            w, h = im.size
    except Exception:
        pass
    e = {"file": rel, "publication_status": status, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
         "bytes": p.stat().st_size, "width": w, "height": h}
    if note:
        e["note"] = note
    return e


def check_images(repo: Path, add_new: bool = False) -> list[Finding]:
    mp = repo / MANIFEST
    found: list[Finding] = []
    if not mp.exists():
        return [Finding("FAIL", "images", f"{MANIFEST} is missing")]
    man = json.loads(mp.read_text(encoding="utf-8"))
    entries = {e["file"]: e for e in man.get("images", []) if isinstance(e, dict) and e.get("file")}
    imgs = image_files(repo)
    added = 0
    for rel in imgs:
        e = entries.get(rel)
        if e is None:
            if add_new:
                man.setdefault("images", []).append(image_entry(repo, rel, "review", "added by release_check"))
                added += 1
            found.append(Finding("FAIL", "images", f"{rel}: not in the screenshot manifest"))
            continue
        st = e.get("publication_status")
        if st not in STATUSES:
            found.append(Finding("FAIL", "images", f"{rel}: unknown publication_status {st!r}"))
        elif st != "public":
            found.append(Finding("FAIL", "images", f"{rel}: publication_status is {st}"
                                 + (f" ({e['note']})" if e.get("note") else "")))
        sha = hashlib.sha256((repo / rel).read_bytes()).hexdigest()
        if e.get("sha256") and e["sha256"] != sha:
            found.append(Finding("FAIL", "images", f"{rel}: changed since it was reviewed (sha256 differs)"))
    for rel in sorted(set(entries) - set(imgs)):
        found.append(Finding("WARN", "images", f"{rel}: listed in the manifest but not on disk"))
    if added:
        man["images"].sort(key=lambda e: e["file"])
        mp.write_text(json.dumps(man, indent=1) + "\n", encoding="utf-8")
        found.append(Finding("INFO", "images", f"added {added} image(s) to the manifest as 'review'"))
    if not any(f.level == "FAIL" for f in found):
        found.append(Finding("PASS", "images", f"{len(imgs)} images, all public"))
    return found


def check_ignored(repo: Path) -> list[Finding]:
    found: list[Finding] = []
    tracked = tracked_files(repo)
    for prefix, probe in MUST_IGNORE.items():
        out = git(repo, "check-ignore", "-v", "--no-index", probe).strip()
        if not out:
            found.append(Finding("FAIL", "ignored", f"{prefix} is not git-ignored"))
        elif out.startswith(".git/info/exclude"):
            found.append(Finding("WARN", "ignored", f"{prefix} is ignored only by .git/info/exclude on this machine; "
                                 "a fresh clone would not ignore it"))
        bad = [t for t in tracked if (t == prefix or t.startswith(prefix)) and t != "searches/.gitkeep"]
        if bad:
            found.append(Finding("FAIL", "ignored", f"{prefix} has tracked files: {', '.join(bad[:5])}"))
    if not any(f.level == "FAIL" for f in found):
        found.append(Finding("PASS", "ignored", ", ".join(MUST_IGNORE)))
    return found


def _photo_policy(repo: Path) -> dict:
    """The owner's recorded photo policy (docs/gallery/manifest.json "policy"); hot-linked listing photo URLs may be
    allowed there, local copies never are."""
    try:
        m = json.loads((repo / "docs/gallery/manifest.json").read_text())
        return m.get("policy") or {}
    except (OSError, ValueError):
        return {}


def _listing_photo_problems(rel: str, data: object, policy: dict | None = None) -> list[str]:
    rows = data if isinstance(data, list) else (data.get("listings") if isinstance(data, dict) else None)
    if not isinstance(rows, list):
        return []
    probs, dangling = [], 0
    for L in rows:
        if not isinstance(L, dict):
            continue
        lid = L.get("id", "?")
        if L.get("photos"):
            probs.append(("INFO:" if (policy or {}).get("listing_photo_urls") == "allowed" else "") + f"{rel}: {lid} has listing photos")
        if L.get("photos_local"):
            probs.append(("INFO:" if (policy or {}).get("listing_photo_files") == "allowed" else "") + f"{rel}: {lid} has local photo copies (photos_local)")
        for bp in L.get("building_photos") or []:
            if isinstance(bp, dict) and bp.get("local"):
                probs.append(("INFO:" if (policy or {}).get("listing_photo_files") == "allowed" else "") + f"{rel}: {lid} has a local building-photo copy")
                break
        for v in (L.get("links") or {}).values():
            if isinstance(v, str) and re.match(r"^(\./)?(photos|media)/", v):
                dangling += 1
    if dangling:
        probs.append(f"WARN:{rel}: {dangling} link(s) to local photo paths (files are not in the repo)")
    return probs


def check_photos(repo: Path, files: list[str]) -> list[Finding]:
    found: list[Finding] = []
    scope = [f for f in files if f.startswith(("examples/", "dashboard/data/", "dist/"))]
    allow_media, media_ok = _photo_policy(repo).get("listing_photo_files") == "allowed", 0
    for rel in scope:
        parts = rel.split("/")
        ext = Path(rel).suffix.lower()
        if "media" in parts[:-1] or "photos" in parts[:-1]:
            if allow_media and re.match(r"^examples/[^/]+/media/", rel):
                media_ok += 1
                continue
            found.append(Finding("FAIL", "photos", f"{rel}: media or photos folder in tracked example data"))
        elif ext in IMAGE_EXT and not re.match(r"^examples/[^/]+/research/charts/", rel):
            found.append(Finding("FAIL", "photos", f"{rel}: image file in example data"))
        elif rel.endswith("listings.json"):
            try:
                data = json.loads((repo / rel).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            probs = _listing_photo_problems(rel, data, _photo_policy(repo))
            info = [p for p in probs if p.startswith("INFO:")]
            if info:
                found.append(Finding("INFO", "photos", f"{rel}: {len(info)} photo entries (hot-linked or local copies) "
                                     f"(allowed by the owner's policy in docs/gallery/manifest.json)"))
            for p in probs:
                if p.startswith("INFO:"):
                    continue
                found.append(Finding("WARN", "photos", p[5:]) if p.startswith("WARN:")
                             else Finding("FAIL", "photos", p))
        elif ext == ".html":
            text = (repo / rel).read_text(encoding="utf-8", errors="replace")
            if '"photos_local"' in text or "data:image/jpeg" in text:
                found.append(Finding("FAIL", "photos", f"{rel}: embeds local photo paths or JPEG data"))
    if media_ok:
        found.append(Finding("INFO", "photos", f"{media_ok} listing photo files under examples/*/media "
                             f"(allowed by the owner's policy in docs/gallery/manifest.json)"))
    if not any(f.level == "FAIL" for f in found):
        found.append(Finding("PASS", "photos", f"{len(scope)} example and dashboard data files"))
    return found


def check_tests(repo: Path) -> list[Finding]:
    found: list[Finding] = []
    env = {**os.environ, "APARTMENTSCOUT_LIBREOFFICE_TESTS": "1"}   # include the slow spreadsheet recalculation test
    r = subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=repo, capture_output=True, text=True, env=env)
    tail = (r.stdout.strip().splitlines() or ["no output"])[-1]
    found.append(Finding("PASS" if r.returncode == 0 else "FAIL", "tests", f"pytest: {tail}"))
    node = shutil.which("node")
    if not node:
        found.append(Finding("WARN", "tests", "node not found; JavaScript tests not run"))
    else:
        r = subprocess.run([node, "--test", "tests/js"], cwd=repo, capture_output=True, text=True)
        summary = " ".join(x.strip("# ") for x in r.stdout.splitlines() if re.match(r"^# (pass|fail) ", x))
        found.append(Finding("PASS" if r.returncode == 0 else "FAIL", "tests", f"node --test: {summary or tail}"))
    return found


CHECKS = ("privacy", "images", "ignored", "photos", "tests")


def run(repo: Path, only: tuple[str, ...] = CHECKS, patterns: Path | None = None,
        add_new_images: bool = False) -> list[Finding]:
    files = publishable_files(repo)
    out: list[Finding] = []
    if "privacy" in only:
        extra, allow, where = load_patterns(patterns)
        out.append(Finding("INFO", "privacy", f"patterns: {where}"))
        out += check_privacy(repo, files, extra, allow)
    if "images" in only:
        out += check_images(repo, add_new_images)
    if "ignored" in only:
        out += check_ignored(repo)
    if "photos" in only:
        out += check_photos(repo, files)
    if "tests" in only:
        out += check_tests(repo)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ApartmentScout release gate")
    ap.add_argument("--repo", type=Path, default=REPO)
    ap.add_argument("--patterns", type=Path, help="private pattern file (keep it outside the repo)")
    ap.add_argument("--only", help=f"comma list of {', '.join(CHECKS)}")
    ap.add_argument("--skip-tests", action="store_true")
    ap.add_argument("--add-new-images", action="store_true",
                    help="add images missing from the manifest with publication_status 'review'")
    ap.add_argument("--quiet", action="store_true", help="hide INFO lines")
    a = ap.parse_args(argv)
    only = tuple(x.strip() for x in a.only.split(",")) if a.only else CHECKS
    if a.skip_tests:
        only = tuple(c for c in only if c != "tests")
    unknown = set(only) - set(CHECKS)
    if unknown:
        ap.error(f"unknown check(s): {', '.join(sorted(unknown))}")
    findings = run(a.repo.resolve(), only, a.patterns, a.add_new_images)
    for f in findings:
        if a.quiet and f.level == "INFO":
            continue
        print(f"{f.level:<5} {f.check:<8} {f.message}")
    fails = sum(f.level == "FAIL" for f in findings)
    warns = sum(f.level == "WARN" for f in findings)
    print(f"\n{'RELEASE BLOCKED' if fails else 'OK to release'}: {fails} failure(s), {warns} warning(s) "
          f"across {', '.join(only)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
