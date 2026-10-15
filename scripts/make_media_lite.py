#!/usr/bin/env python3
"""Build a search's starter photo set, ``<search>/media-lite/``, from its full set ``<search>/media/``.

The example's full photo set is about 400 MB, so it lives in a GitHub release and on the live demo, not in git. The starter
set is the small part of it that is committed, so a fresh clone shows photos with nothing to download. It mirrors the
full set's relative paths (``media-lite/shared/<hash>.webp`` stands for ``media/shared/<hash>.webp``), so every page that
asks for ``media/...`` can be answered from either folder. What goes in:

  gallery   every photo (at most --cap, 30 by default; clean ones first, then the lightbox order) of the top --top active
            listings by ``score.rank`` that have photos, and of the listings named with --also. These are the homes a
            reader opens first, so they get a real gallery.
  lite      for every other listing with photos: the hero (the photo its card opens with), then one building photo,
            re-encoded smaller (--lite-px long side, --lite-quality).
  plan      every floor-plan image that is a local file, for every listing.

The listing's own order is the dashboard's (``apartmentscout.lqip.photo_groups`` mirrors ``dashboard/js/features/photos.js``):
unit, same line, building, then the street; a photo flagged as carrying a broker mark (``photo_flags``) comes after the
clean ones of its group, and is only taken for a gallery when there are not enough clean ones.

    python scripts/make_media_lite.py examples/nyc-2026            # build media-lite from media (both under the search)
    python scripts/make_media_lite.py examples/nyc-2026 --dry      # print the plan and the size, write nothing
    python scripts/make_media_lite.py examples/nyc-2026 --check    # does media-lite hold what the listings now call for?
    python scripts/make_media_lite.py examples/nyc-2026 --full /elsewhere/media     # the full set is somewhere else

It is deterministic (sorted selection, fixed encoder settings, no timestamps) and idempotent: running it again leaves
unchanged files untouched, replaces changed ones and removes files that are no longer selected. ``media-lite/MANIFEST.json``
records the settings and the counts. After re-scoring, or after adding photos, run it again and commit the result
(docs/RELEASE_CHECKLIST.md). Needs Pillow (``pip install -e ".[images]"``).
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from apartmentscout.lqip import _is_flagged, photo_groups  # noqa: E402  (the dashboard's photo order, in Python)

MANIFEST = "MANIFEST.json"
CLOSED = ("gone", "rejected")
TOP = 12
ALSO = ("paramount-tower-25e",)
CAP = 30
GALLERY_PX, GALLERY_Q = 1000, 68
LITE_PX, LITE_Q = 700, 60
PLAN_PX, PLAN_Q = 1100, 68
SIZE_LIMIT_MB = 35.0
ROLE_RANK = {"gallery": 0, "plan": 1, "lite": 2}   # a file wanted in two roles is encoded for the strongest one
SHOWN_GROUPS = ("unit", "line", "building", "street")


@dataclass(frozen=True)
class Params:
    top: int = TOP
    also: tuple[str, ...] = ALSO
    cap: int = CAP
    gallery_px: int = GALLERY_PX
    gallery_quality: int = GALLERY_Q
    lite_px: int = LITE_PX
    lite_quality: int = LITE_Q
    plan_px: int = PLAN_PX
    plan_quality: int = PLAN_Q


@dataclass
class Selection:
    """What goes in: ``files`` maps a ``media/...`` path to its role; the two dicts say which listing wanted what."""
    files: dict[str, str] = field(default_factory=dict)
    galleries: dict[str, int] = field(default_factory=dict)    # listing id -> photos selected (top listings)
    lite: dict[str, int] = field(default_factory=dict)         # listing id -> photos selected (1 or 2)
    plans: int = 0

    def want(self, path: str, role: str) -> None:
        old = self.files.get(path)
        if old is None or ROLE_RANK[role] < ROLE_RANK[old]:
            self.files[path] = role


def shown_order(L: dict[str, Any]) -> list[str]:
    """The listing's saved photos in the order the dashboard shows them, floor plans left out."""
    groups = photo_groups(L)
    seen: set[str] = set()
    out: list[str] = []
    for g in SHOWN_GROUPS:
        for p in groups[g]:
            if p not in seen:
                seen.add(p)
                out.append(p)
    return out


def gallery_of(L: dict[str, Any], cap: int) -> list[str]:
    """Up to ``cap`` photos for a full gallery: clean ones first (in display order), then flagged ones if room remains."""
    order = shown_order(L)
    clean = [p for p in order if not _is_flagged(L, p)]
    flagged = [p for p in order if _is_flagged(L, p)]
    keep = set((clean + flagged)[:cap])
    return [p for p in order if p in keep]


def lite_of(L: dict[str, Any]) -> list[str]:
    """The hero, then one building photo that is not the hero."""
    order = shown_order(L)
    if not order:
        return []
    hero = order[0]
    building = [p for p in photo_groups(L)["building"] if p != hero]
    return [hero] + building[:1]


def plans_of(L: dict[str, Any]) -> list[str]:
    return [p for p in photo_groups(L)["plan"]]


def top_listings(listings: Iterable[dict[str, Any]], top: int) -> list[dict[str, Any]]:
    """The first ``top`` active listings by ``score.rank`` that have photos to show."""
    ranked = [L for L in listings if L.get("status") not in CLOSED and isinstance((L.get("score") or {}).get("rank"), int)
              and shown_order(L)]
    ranked.sort(key=lambda L: (L["score"]["rank"], str(L.get("id"))))
    return ranked[:top]


def select(listings: list[dict[str, Any]], params: Params = Params()) -> Selection:
    sel = Selection()
    gallery_ids = {L["id"] for L in top_listings(listings, params.top)} | set(params.also)
    for L in sorted(listings, key=lambda L: str(L.get("id"))):
        lid = L["id"]
        if lid in gallery_ids and (shown := gallery_of(L, params.cap)):
            for p in shown:
                sel.want(p, "gallery")
            sel.galleries[lid] = len(shown)
        elif (shown := lite_of(L)):
            for p in shown:
                sel.want(p, "lite")
            sel.lite[lid] = len(shown)
        for p in plans_of(L):
            sel.want(p, "plan")
            sel.plans += 1
    return sel


def _profile(role: str, params: Params) -> tuple[int, int]:
    return {"gallery": (params.gallery_px, params.gallery_quality), "lite": (params.lite_px, params.lite_quality),
            "plan": (params.plan_px, params.plan_quality)}[role]


def encode(src: Path, max_px: int, quality: int) -> bytes:
    """The image as WebP no larger than ``max_px`` on its long side. The original bytes come back when they are already
    smaller than what the re-encode produces (a small, well-compressed photo is not made worse)."""
    from PIL import Image
    raw = src.read_bytes()
    try:
        with Image.open(io.BytesIO(raw)) as im:
            im.load()
            w, h = im.size
            if max(w, h) > max_px:
                k = max_px / max(w, h)
                im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=quality, method=6)
    except Exception:  # an unreadable file is copied as it is
        return raw
    out = buf.getvalue()
    return out if len(out) < len(raw) else raw


@dataclass
class Report:
    selection: Selection
    files: int = 0
    bytes: int = 0
    by_role: dict[str, int] = field(default_factory=dict)       # role -> bytes
    count_by_role: dict[str, int] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)            # selected but absent from the full set
    written: int = 0
    removed: int = 0

    @property
    def mb(self) -> float:
        return self.bytes / 1e6


def build(search: Path, full: Path | None = None, out: Path | None = None, params: Params = Params(),
          dry: bool = False) -> Report:
    """Select from ``search/listings.json``, encode from ``full`` (default ``search/media``) into ``out`` (default
    ``search/media-lite``). With ``dry`` nothing is written and sizes are those the encoder would produce."""
    full = full or search / "media"
    out = out or search / "media-lite"
    listings = json.loads((search / "listings.json").read_text(encoding="utf-8"))
    sel = select(listings, params)
    rep = Report(selection=sel)
    keep: set[Path] = set()
    for path in sorted(sel.files):
        role = sel.files[path]
        rel = path.removeprefix("media/")
        src = full / rel
        dest = out / rel
        if not src.is_file():
            if dest.is_file():   # a partial full set must not cost the starter set a photo it already has
                keep.add(dest)
                rep.files += 1
                rep.bytes += dest.stat().st_size
                rep.by_role[role] = rep.by_role.get(role, 0) + dest.stat().st_size
                rep.count_by_role[role] = rep.count_by_role.get(role, 0) + 1
            else:
                rep.missing.append(path)
            continue
        data = encode(src, *_profile(role, params))
        keep.add(dest)
        rep.files += 1
        rep.bytes += len(data)
        rep.by_role[role] = rep.by_role.get(role, 0) + len(data)
        rep.count_by_role[role] = rep.count_by_role.get(role, 0) + 1
        if dry:
            continue
        if not dest.is_file() or dest.read_bytes() != data:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            rep.written += 1
    if dry:
        return rep
    if out.is_dir():
        for f in sorted(out.rglob("*"), reverse=True):
            if f.is_file() and f not in keep and f.name != MANIFEST:
                f.unlink()
                rep.removed += 1
            elif f.is_dir() and not any(f.iterdir()):
                f.rmdir()
    out.mkdir(parents=True, exist_ok=True)
    (out / MANIFEST).write_text(json.dumps(manifest(rep, params), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return rep


def manifest(rep: Report, params: Params) -> dict[str, Any]:
    sel = rep.selection
    return {
        "about": "Starter photos for the example search: a small part of the full set (see scripts/make_media_lite.py). "
                 "Same relative paths as media/.",
        "settings": {"top": params.top, "also": list(params.also), "gallery_cap": params.cap,
                     "gallery": [params.gallery_px, params.gallery_quality], "lite": [params.lite_px, params.lite_quality],
                     "plan": [params.plan_px, params.plan_quality]},
        "files": rep.files, "megabytes": round(rep.mb, 1),
        "by_role": {r: {"files": rep.count_by_role.get(r, 0), "megabytes": round(rep.by_role.get(r, 0) / 1e6, 1)}
                    for r in ROLE_RANK},
        "galleries": dict(sorted(sel.galleries.items(), key=lambda kv: kv[0])),
        "lite_listings": len(sel.lite),
        "missing_from_full_set": len(rep.missing),
    }


def check(search: Path, out: Path | None = None, params: Params = Params()) -> list[str]:
    """Problems with an existing starter set against the listings now on disk (no full set needed): files that the
    listings call for and are missing, files nothing calls for, and a size over the limit. Empty means in step."""
    out = out or search / "media-lite"
    listings = json.loads((search / "listings.json").read_text(encoding="utf-8"))
    want = {p.removeprefix("media/") for p in select(listings, params).files}
    have = {f.relative_to(out).as_posix() for f in out.rglob("*") if f.is_file() and f.name != MANIFEST} if out.is_dir() else set()
    problems = []
    if want - have:
        problems.append(f"{len(want - have)} photo(s) the listings call for are not in {out.name} (e.g. {sorted(want - have)[0]})")
    if have - want:
        problems.append(f"{len(have - want)} file(s) in {out.name} are no longer selected (e.g. {sorted(have - want)[0]})")
    mb = sum((out / r).stat().st_size for r in have) / 1e6
    if mb > SIZE_LIMIT_MB + 5:
        problems.append(f"{out.name} is {mb:.1f} MB, over the {SIZE_LIMIT_MB + 5:.0f} MB limit")
    return problems


def summary(rep: Report, params: Params) -> str:
    sel = rep.selection
    lines = [f"{rep.files} files, {rep.mb:.1f} MB (target <= {SIZE_LIMIT_MB:.0f} MB)"]
    for role in ROLE_RANK:
        lines.append(f"  {role:8} {rep.count_by_role.get(role, 0):5} files  {rep.by_role.get(role, 0) / 1e6:6.1f} MB")
    lines.append(f"{len(sel.galleries)} full galleries (up to {params.cap} photos): "
                 + ", ".join(f"{k} ({v})" for k, v in sorted(sel.galleries.items())))
    lines.append(f"{len(sel.lite)} listings with 1-2 photos")
    if rep.missing:
        lines.append(f"WARNING: {len(rep.missing)} selected photo(s) are not in the full set, e.g. {rep.missing[0]}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("search", type=Path, help="the search folder (listings.json, media/), e.g. examples/nyc-2026")
    ap.add_argument("--full", type=Path, help="the full photo set (default: <search>/media)")
    ap.add_argument("--out", type=Path, help="where to write the starter set (default: <search>/media-lite)")
    ap.add_argument("--top", type=int, default=TOP, help=f"listings that get a full gallery, by score.rank (default {TOP})")
    ap.add_argument("--also", action="append", metavar="ID", help=f"also give this listing a full gallery (default {', '.join(ALSO)})")
    ap.add_argument("--cap", type=int, default=CAP, help=f"photos per full gallery (default {CAP})")
    for name, px, q in (("gallery", GALLERY_PX, GALLERY_Q), ("lite", LITE_PX, LITE_Q), ("plan", PLAN_PX, PLAN_Q)):
        ap.add_argument(f"--{name}-px", type=int, default=px, help=f"long side of {name} images in pixels (default {px})")
        ap.add_argument(f"--{name}-quality", type=int, default=q, help=f"WebP quality of {name} images (default {q})")
    ap.add_argument("--dry", action="store_true", help="print the plan and the size; write nothing")
    ap.add_argument("--check", action="store_true", help="exit 1 when the existing starter set is out of step with listings.json")
    a = ap.parse_args(argv)
    params = Params(top=a.top, also=tuple(a.also) if a.also else ALSO, cap=a.cap,
                    gallery_px=a.gallery_px, gallery_quality=a.gallery_quality, lite_px=a.lite_px, lite_quality=a.lite_quality,
                    plan_px=a.plan_px, plan_quality=a.plan_quality)
    if a.check:
        problems = check(a.search, a.out, params)
        for p in problems:
            print("media-lite:", p)
        if not problems:
            print("media-lite is in step with listings.json")
        return 1 if problems else 0
    full = a.full or a.search / "media"
    if not full.is_dir():
        print(f"{full} is not a folder: get the full set first (scripts/fetch_media.sh) or pass --full", file=sys.stderr)
        return 2
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow is needed: pip install -e '.[images]'", file=sys.stderr)
        return 2
    rep = build(a.search, full, a.out, params, dry=a.dry)
    print(summary(rep, params))
    if not a.dry:
        print(f"wrote {rep.written} file(s), removed {rep.removed}, in {a.out or a.search / 'media-lite'}")
    return 1 if rep.mb > SIZE_LIMIT_MB or rep.missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
