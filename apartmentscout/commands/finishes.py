"""`apartmentscout finishes`: fill each home's plan with the finishes its own photos show. [finishes]

    apartmentscout finishes                      every home with a plan (plans/<id>.json): read its photos and photo review, write finishes
    apartmentscout finishes --listing ID         one home
    apartmentscout finishes --dry-run            print what would be written, change nothing
    apartmentscout finishes --words-only         read the listing's words only, not the pixels (no Pillow needed)

The photos are the ones saved for the listing (``photos_local`` in listings.json): they are looked up in the search's ``media/``
folder, then in ``media-lite/``. A photo that is on neither is skipped and said so; the full published set (``search.media_base_url``
in criteria.yaml) is not fetched. What is written goes into the plan's ``finishes`` block (docs/guides/floor-plans.md) with
``basis: photos`` or ``listing_text`` and the photo numbers as ``evidence``; a value whose basis is ``renter`` is never replaced,
and a re-run refreshes the tool's own earlier readings. Then ``apartmentscout build`` copies the plans into the dashboard.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .. import finishes as F
from .. import planfile
from ..quality.workspace import raw_document, raw_listings, search_from

def sharing(listing: dict, listings: list[dict]) -> list[dict]:
    """The other listings that use at least one of this listing's saved photos (a building's marketing pictures serve many homes)."""
    mine = {p for p in (listing.get("photos_local") or []) if isinstance(p, str)}
    return [o for o in listings if o is not listing and o.get("id") != listing.get("id") and mine & set(o.get("photos_local") or [])]


def describe(finishes: dict) -> list[str]:
    lines = []
    for path in F.leaf_paths():
        leaf = F.get_leaf(finishes, path)
        if not leaf:
            continue
        what = " ".join(x for x in (leaf.get("pattern"), leaf.get("tone") or leaf.get("colour")) if x)
        lines.append(f"    {'.'.join(path):<20} {what:<22} {leaf.get('basis', ''):<13} {leaf.get('evidence', '')}")
    return lines


def run_one(ws, listing: dict, listings: list[dict], plan_path: Path | None, args: argparse.Namespace) -> bool:
    """Propose, merge and (unless --dry-run) write one home's finishes. True when the plan file changed."""
    lid = listing.get("id", "?")
    others = sharing(listing, listings)
    prop = F.propose(listing, others, ws.root, use_pixels=not args.words_only)
    print(f"{lid}: {prop.photos_read} of {prop.photos_total} photos read" + (f", words also read from {', '.join(o['id'] for o in others[:6])}" if others else ""), flush=True)
    for n in prop.notes:
        print(f"  Note: {n}", flush=True)
    if not prop.finishes:
        print("  Nothing in the photos or the words names a finish; the plan keeps its defaults.", flush=True)
        return False
    if plan_path is None or not plan_path.exists():
        print("  No plan for this home (apartmentscout plans add ...), so there is nowhere to write; the proposal would be:", flush=True)
        print("\n".join(describe(prop.finishes)), flush=True)
        return False
    text = plan_path.read_text(encoding="utf-8")
    doc = json.loads(text)
    merged, changed, kept = F.merge_finishes(doc.get("finishes"), prop.finishes, doc.get("floor_finish"), keep_photos=args.words_only or not F.pillow_available())
    err = F.finishes_error(merged)
    if err:
        print(f"  Not written: {err}", flush=True)
        return False
    print("\n".join(describe(merged)), flush=True)
    if kept:
        print(f"  Kept (set by the renter, or read from photos earlier): {', '.join(kept)}", flush=True)
    if not changed:
        print("  Already up to date.", flush=True)
        return False
    if args.dry_run:
        print(f"  (dry run) would change: {', '.join(changed)}", flush=True)
        return False
    out = F.splice_finishes(text, merged)
    tmp = plan_path.with_suffix(".json.tmp")
    tmp.write_text(out, encoding="utf-8")
    tmp.replace(plan_path)
    print(f"  Wrote {plan_path.parent.name}/{plan_path.name}: {', '.join(changed)}", flush=True)
    return True


def cmd_finishes(args: argparse.Namespace) -> None:
    ws = search_from(args)
    listings = raw_listings(raw_document(ws.listings_path))
    by = {L.get("id"): L for L in listings}
    if not args.words_only and not F.pillow_available():
        print("Pillow is not installed (pip install -e '.[images]'): reading the listings' words only, not their photos.", flush=True)
    if args.listing:
        if args.listing not in by:
            sys.exit(f"No listing with the id {args.listing!r} in {ws.listings_path.name}.")
        targets = [by[args.listing]]
    else:
        have = set(planfile.plan_ids(ws.root))
        targets = [L for L in listings if L.get("id") in have]
        if not targets:
            sys.exit(f"No plans in {ws.root.name}/plans/ match a listing: add one with `apartmentscout plans add FILE --id <listing-id>`.")
    wrote = 0
    for L in targets:
        wrote += run_one(ws, L, listings, ws.root / "plans" / f"{L['id']}.json", args)
    print(f"\n{wrote} plan{'s' if wrote != 1 else ''} written." + (" Next: apartmentscout build (copies the plans into the dashboard)." if wrote else ""), flush=True)


def register(add) -> None:
    s = add("finishes", cmd_finishes, "read each home's floor, walls, window frames and kitchen from its photos into the plan's finishes")
    s.add_argument("--listing", help="one listing id (default: every home that has a plan)")
    s.add_argument("--dry-run", action="store_true", help="print what would be written and change nothing")
    s.add_argument("--words-only", action="store_true", help="read the listing's words only (photo review, titles, features), not the pixels")
