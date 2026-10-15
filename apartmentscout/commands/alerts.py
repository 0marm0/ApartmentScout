"""`apartmentscout alerts`: what changed in this search since the last run, against your criteria.

    apartmentscout alerts                      print the digest and make now the new baseline
    apartmentscout alerts --no-save            print it; keep the baseline where it is
    apartmentscout alerts --format md          Markdown (what the GitHub issue shows); --json for the data
    apartmentscout alerts --json-out d.json --md-out d.md    also write the files (used by .github/workflows/alerts.yml)
    apartmentscout alerts --baseline old.json  compare with a saved state instead of history/alerts/state.json

Reads the scores in listings.json, so run `apartmentscout score` first. Changes: new homes that fit, homes that now fit,
price drops and rises, gone or back on the market, rank jumps into the top 10, unknowns resolved. It makes no network
requests and never edits listings.json. The first run only records the baseline. Detail: docs/guides/alerts.md.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..alerts import TOP, digest_text, run
from ..quality.workspace import load_listings, search_from


def cmd_alerts(args: argparse.Namespace) -> None:
    ws = search_from(args)
    d = run(ws.root, load_listings(ws), ws.criteria(), baseline=Path(args.baseline) if args.baseline else None,
            save=not args.no_save, top=args.top, include_all=args.all)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    if args.md_out:
        Path(args.md_out).write_text(digest_text(d, md=True), encoding="utf-8")
    as_json = args.json or args.format == "json"
    if as_json:
        print(json.dumps(d, indent=1, ensure_ascii=False))
    else:
        print(digest_text(d, md=args.format == "md"), end="")
        if not args.no_save:
            print("Baseline saved. `apartmentscout build` shows this digest in the dashboard's What's new panel.")


def register(add) -> None:
    s = add("alerts", cmd_alerts, "what changed since the last run: new homes that fit, price drops, gone, rank jumps; text and JSON")
    s.add_argument("--no-save", action="store_true", help="do not move the baseline (and write no digest files)")
    s.add_argument("--baseline", metavar="FILE", help="compare with this saved state instead of history/alerts/state.json")
    s.add_argument("--top", type=int, default=TOP, help=f"a rank jump counts when it lands in the top N (default {TOP})")
    s.add_argument("--all", action="store_true", help="also report price moves, gone homes and answered questions for homes that do not fit")
    s.add_argument("--format", choices=("text", "md", "json"), default="text", help="what to print (default text)")
    s.add_argument("--json", action="store_true", help="print the digest as JSON (same as --format json)")
    s.add_argument("--json-out", metavar="FILE", help="also write the digest as JSON to FILE")
    s.add_argument("--md-out", metavar="FILE", help="also write the digest as Markdown to FILE")
