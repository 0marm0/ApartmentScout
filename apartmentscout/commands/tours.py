"""`apartmentscout tours-import`: put the visits from a picks backup into the search folder.

    apartmentscout tours-import picks.json            writes <search>/tours/<id>/findings.json (the newer version of each visit wins)
    apartmentscout tours-import picks.json --dry-run  say what would change

A visit made on a phone with the dashboard opened as a file or from a static host lives in that browser and in the picks backup
("Back up picks"). Importing it here lets `apartmentscout score` read the facts the renter promoted and flag the ones that
contradict a listing. Photos never travel in a backup, so they are not imported.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .. import tours
from ..quality.workspace import search_from


def cmd_tours_import(args: argparse.Namespace) -> None:
    ws = search_from(args)
    try:
        raw = json.loads(Path(args.picks).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        sys.exit(f"Cannot read {args.picks}: {e}")
    visits = raw.get("findings") if isinstance(raw, dict) else None
    if not isinstance(visits, dict) or not visits:
        sys.exit("That file has no visit findings. Use the dashboard's Back up picks file after you have filled in visit notes.")
    changed, kept, skipped = [], 0, []
    for lid, f in visits.items():
        if not isinstance(lid, str) or not tours.TOUR_ID.match(lid) or lid.endswith(".") or not isinstance(f, dict):
            skipped.append(str(lid)[:40])
            continue
        mine = tours.read_findings(ws.root, lid)
        incoming = tours.normalize({**f, "photos": (mine or {}).get("photos", [])})   # a backup carries no photos: keep the folder's own
        if tours.is_blank(incoming):
            continue
        winner = tours.newest(mine, incoming)
        if winner is mine:
            kept += 1
            continue
        changed.append(lid)
        if not args.dry_run:
            tours.write_findings(ws.root, lid, winner)
    verb = "Would write" if args.dry_run else "Wrote"
    print(f"{verb} {len(changed)} visit(s) in {tours.tours_dir(ws.root)}; {kept} already up to date"
          f"{'; skipped ' + str(len(skipped)) + ' with unusable ids' if skipped else ''}.")
    if changed and not args.dry_run:
        print("Run `apartmentscout score` so promoted facts and contradictions reach the scores.")


def register(add) -> None:
    s = add("tours-import", cmd_tours_import, "write the visit findings from a picks backup into the search folder's tours/")
    s.add_argument("picks", metavar="FILE", help="the dashboard's picks backup (it carries the visits under 'findings')")
    s.add_argument("--dry-run", action="store_true", help="say what would change without writing")
