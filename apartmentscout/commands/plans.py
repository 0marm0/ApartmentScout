"""`apartmentscout plans`: which homes have a floor plan, and how to add one. [onboarding]

    apartmentscout plans                        list your homes with and without a plan, and how to add one
    apartmentscout plans add FILE [--id ID]     check a plan JSON and copy it to plans/<id>.json (--force replaces)

A plan lets the dashboard draw the apartment in 2D and 3D, cast the sun through its windows (with the surrounding buildings
from `apartmentscout surroundings`), and test your furniture. Make one three ways:

  1. in the dashboard: Floor plan tab > "New plan from image", trace a PNG, JPEG or PDF of the listing's plan, then "Save to the
     search folder" (or "Download plan JSON" and `apartmentscout plans add the-file.json`);
  2. give an agent the image, PDF or the room sizes (the floor-plan-model skill writes the JSON);
  3. write the JSON by hand (docs/guides/floor-plans.md).
"""
from __future__ import annotations

import argparse
import json
import sys

from .. import planfile
from ..quality.workspace import load_listings, search_from

CLOSED = ("gone", "rejected")


def cmd_plans(args: argparse.Namespace) -> None:
    ws = search_from(args)
    if args.action == "add":
        add_plan(ws, args)
        return
    listings = load_listings(ws)
    have = set(planfile.plan_ids(ws.root))
    by = {L["id"] for L in listings}
    open_ = [L for L in listings if L.get("status") not in CLOSED]
    short = [L for L in open_ if L.get("status") in ("shortlist", "touring", "applied") or L.get("favorite")]
    print(f"Floor plans in {ws.root.name}/plans/: {len(have & by)} of {len(open_)} open homes have one", flush=True)
    for L in (short or open_)[:40]:
        mark = "plan   " if L["id"] in have else "no plan"
        print(f"  {mark}  {L['id']}  ({L.get('building') or ''} {L.get('unit') or ''})".rstrip(), flush=True)
    loose = sorted(have - by)
    if loose:
        print(f"\nPlans whose id matches no listing (the studio lists them, but Unit 3D and the sun cannot attach them): "
              f"{', '.join(loose)}", flush=True)
    print("""
Add one:
  1. Dashboard: `apartmentscout serve`, open the Floor plan tab, choose "New plan from image", pick a PNG, JPEG or PDF of the
     listing's plan, click both ends of a printed dimension and type its length, mark north, trace the rooms, doors and
     windows, set "For listing" to the home, then "Save to the search folder". The image never leaves your computer.
  2. Or ask your agent: give it the plan image or PDF, or the room sizes from the listing ("living room 14'6 x 12'"); the
     floor-plan-model skill writes plans/<listing-id>.json.
  3. Or have a plan file already: `apartmentscout plans add the-plan.json --id <listing-id>`.
Then `apartmentscout build`. The 3D apartment, the sun through its windows and the furniture fit checks all use the plan;
the sun is blocked by the real buildings around once the home has a site model (`apartmentscout surroundings`).""", flush=True)


def add_plan(ws, args: argparse.Namespace) -> None:
    if not args.file:
        sys.exit("Give the plan file: apartmentscout plans add the-plan.json --id <listing-id>")
    try:
        doc = json.loads(open(args.file, encoding="utf-8").read())
    except (OSError, ValueError) as e:
        sys.exit(f"Cannot read {args.file} as JSON: {e}")
    if args.id and isinstance(doc, dict):
        doc["id"] = args.id
    ids = {L["id"] for L in load_listings(ws)}
    try:
        out = planfile.save_plan(ws.root, doc, overwrite=args.force)
    except planfile.PlanError as e:
        sys.exit(f"Not saved: {e}")
    for w in out["warnings"]:
        print(f"  Check: {w}", flush=True)
    if doc["id"] not in ids:
        print(f"  Note: no listing has the id {doc['id']!r}, so Unit 3D and the sun will not attach this plan to a home. "
              f"Re-run with --id <listing-id> --force to rename it.", flush=True)
    print(f"{'Saved' if out['created'] else 'Replaced'} {ws.root.name}/{out['path']}. Next: apartmentscout build", flush=True)


def register(add) -> None:
    s = add("plans", cmd_plans, "list which homes have a floor plan, or add a plan file to the search")
    s.add_argument("action", nargs="?", choices=["list", "add"], default="list")
    s.add_argument("file", nargs="?", help="with `add`: the plan JSON (from the tracer's Download plan JSON, or an agent)")
    s.add_argument("--id", help="with `add`: the listing id the plan belongs to (default: the id inside the file)")
    s.add_argument("--force", action="store_true", help="with `add`: replace an existing plan (the old one is kept as .json.bak)")
