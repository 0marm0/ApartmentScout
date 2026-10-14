"""Store each distinct listing image once: identical files in several ``media/<listing-id>/`` folders move to
``media/shared/<sha16>.<ext>`` and every reference in listings.json (values and keys, such as ``photos_local``,
``building_photos[].local`` and ``photo_flags``) is rewritten. Idempotent; run it after saving new photos.

    python scripts/dedupe_media.py examples/nyc-2026            # rewrite
    python scripts/dedupe_media.py examples/nyc-2026 --dry      # report only
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def plan(search: Path) -> dict[str, str]:
    """Old ``media/...`` path -> shared path, for every file whose bytes appear in more than one place."""
    media = search / "media"
    groups: dict[str, list[Path]] = defaultdict(list)
    for p in sorted(media.rglob("*")):
        if p.is_file() and p.parent.name != "shared":
            groups[hashlib.sha256(p.read_bytes()).hexdigest()].append(p)
    moves: dict[str, str] = {}
    for sha, paths in groups.items():
        if len(paths) < 2:
            continue
        new = f"media/shared/{sha[:16]}{paths[0].suffix.lower()}"
        for p in paths:
            moves[p.relative_to(search).as_posix()] = new
    return moves


def rewrite(obj: Any, moves: dict[str, str]) -> Any:
    if isinstance(obj, str):
        return moves.get(obj, obj)
    if isinstance(obj, list):
        return [rewrite(x, moves) for x in obj]
    if isinstance(obj, dict):
        return {moves.get(k, k): rewrite(v, moves) for k, v in obj.items()}
    return obj


def apply(search: Path, moves: dict[str, str]) -> int:
    (search / "media" / "shared").mkdir(parents=True, exist_ok=True)
    for old, new in moves.items():
        src, dst = search / old, search / new
        if not dst.exists():
            src.replace(dst)
        elif src.exists():
            src.unlink()
    lp = search / "listings.json"
    listings = json.loads(lp.read_text(encoding="utf-8"))
    lp.write_text(json.dumps(rewrite(listings, moves), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    for d in sorted((search / "media").iterdir(), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    return len(moves)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("search", type=Path)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args(argv)
    moves = plan(a.search)
    print(f"{len(moves)} files share {len(set(moves.values()))} distinct images")
    if not a.dry and moves:
        apply(a.search, moves)
        print("rewrote", a.search / "listings.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
