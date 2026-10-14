"""Persist "this photo carries a broker mark" in the listing data so the dashboard can order it last.

A review pass (OCR, face and logo checks) produces a map from a saved photo path to why it was flagged::

    {"media/<id>/p-1.webp": {"why": ["phone number"], "uses": [["<listing id>", "unit"]]}}

``apply_flags`` writes that into each listing that uses the photo as a per-listing ``photo_flags`` map::

    "photo_flags": {"media/<id>/p-1.webp": {"watermark": true, "why": ["phone number"]}}

keyed by the saved path (the same string as in ``photos_local``, ``building_photos[].local`` or
``floorplan_images``). The dashboard keeps a flagged photo but moves it to the end of its group (unit, same line,
building, floor plans, street) and badges it in the lightbox. Only ``photo_flags`` is touched, and running it again
with the same input changes nothing.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable


def apply_flags(listings: Iterable[dict], flagged: dict) -> int:
    """Set ``photo_flags`` on the listings named in ``flagged``; returns how many listings changed (idempotent)."""
    by_id = {L.get("id"): L for L in listings}
    wanted: dict[str, dict[str, dict]] = {}
    for path, info in (flagged or {}).items():
        why = sorted({str(w) for w in (info or {}).get("why", [])})
        for use in (info or {}).get("uses", []):
            lid = use[0] if isinstance(use, (list, tuple)) and use else use
            if lid in by_id:
                wanted.setdefault(lid, {})[path] = {"watermark": True, "why": why}
    changed = 0
    for lid, flags in wanted.items():
        L = by_id[lid]
        merged = {**(L.get("photo_flags") or {}), **flags}
        if merged != L.get("photo_flags"):
            L["photo_flags"] = dict(sorted(merged.items()))
            changed += 1
    return changed


def apply_file(listings_path: Path, flagged_path: Path, dry_run: bool = False) -> tuple[int, int]:
    """Apply a flags file to a listings.json in place, keeping the file's formatting (two-space JSON, UTF-8, final
    newline). Returns ``(listings changed, photos flagged)``."""
    listings = json.loads(listings_path.read_text(encoding="utf-8"))
    flagged = json.loads(flagged_path.read_text(encoding="utf-8"))
    changed = apply_flags(listings, flagged)
    n = sum(len(L.get("photo_flags") or {}) for L in listings)
    if changed and not dry_run:
        listings_path.write_text(json.dumps(listings, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed, n
