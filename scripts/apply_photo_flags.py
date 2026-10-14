#!/usr/bin/env python3
"""Write a photo review's flags into a listings.json as per-listing ``photo_flags`` (idempotent).

    python scripts/apply_photo_flags.py flagged.json                       # examples/nyc-2026/listings.json
    python scripts/apply_photo_flags.py flagged.json --listings searches/mine/listings.json --dry-run

``flagged.json`` maps a saved photo path to ``{"why": [...], "uses": [[listing id, kind], ...]}``; see
``apartmentscout/photoflags.py``. Only ``photo_flags`` changes in the listings file.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apartmentscout.photoflags import apply_file  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("flagged", type=Path, help="JSON map: saved photo path -> {why, uses}")
    ap.add_argument("--listings", type=Path, default=ROOT / "examples" / "nyc-2026" / "listings.json")
    ap.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    a = ap.parse_args()
    changed, flagged = apply_file(a.listings, a.flagged, dry_run=a.dry_run)
    print(f"{'Would change' if a.dry_run else 'Changed'} {changed} listings; {flagged} flagged photos in {a.listings}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
