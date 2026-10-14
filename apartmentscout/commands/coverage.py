"""`apartmentscout coverage`: completion standard, research queue, score impact of gaps and the questions to ask."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..quality.coverage import coverage, format_report
from ..quality.history import read_claims
from ..quality.workspace import load_listings, search_from


def cmd_coverage(args: argparse.Namespace) -> None:
    ws = search_from(args)
    Ls = load_listings(ws)
    doc = coverage(Ls, ws.criteria(), ws.root, read_claims(ws.root), today=args.as_of)
    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
        print(f"Wrote {p}")
    if args.json:
        print(json.dumps(doc, indent=1, ensure_ascii=False))
    elif args.id:
        r = next((v for k, v in doc["listings"].items() if k == args.id or args.id.lower() in k), None)
        print(json.dumps(r, indent=1, ensure_ascii=False) if r else f"No listing matches {args.id}")
    else:
        print(format_report(doc, Ls, top=args.top))


def register(add) -> None:
    s = add("coverage", cmd_coverage, "research completeness: missing and stale facts, score impact, priority and "
                                      "questions per listing (not a market census)")
    s.add_argument("--top", type=int, default=15, help="research-queue rows to print")
    s.add_argument("--id", help="print one listing's coverage row")
    s.add_argument("--json", action="store_true", help="print the full coverage.json document")
    s.add_argument("--out", help="also write coverage.json to this path")
    s.add_argument("--as-of", help="date to judge staleness against (default today)")
