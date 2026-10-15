"""`apartmentscout questions`: drafts of the questions to ask each building's leasing office. Never sends anything.

    apartmentscout questions                         # every building with a unit of interest
    apartmentscout questions --building knox         # one building
    apartmentscout questions --units 6B 7BA          # named units (id or unit number), wherever they are
    apartmentscout questions --format md|json|text

See docs/guides/leasing-office-questions.md and apartmentscout/office_questions.py.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..office_questions import DEFAULT_TOP, building_drafts
from ..quality.history import read_claims
from ..quality.lint import lint_all
from ..quality.workspace import load_listings, search_from


def cmd_questions(args: argparse.Namespace) -> None:
    ws = search_from(args)
    crit = ws.criteria()
    Ls = load_listings(ws)
    units = [u for chunk in (args.units or []) for u in chunk.split(",") if u.strip()]
    drafts = building_drafts(Ls, crit, building=args.building, units=units, top=args.top, all_units=args.all,
                             standard=args.standard, today=args.as_of,
                             flags=lint_all(Ls, crit, ws.root, read_claims(ws.root), today=args.as_of))
    if not drafts:
        what = f" for {args.building!r}" if args.building else ""
        sys.exit(f"No open questions{what}: no unit of interest here has anything to ask. "
                 "Units of interest are shortlisted, touring, applied, favourite and top-ranked ones; "
                 "name others with --units or use --all.")
    out = _render(drafts, args.format)
    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(out, encoding="utf-8")
        print(f"Wrote {p}")
    else:
        print(out, end="")
    print("These are drafts. Nothing was sent: copy one into your own email or use the dashboard's mailto link.",
          file=sys.stderr)


def _render(drafts: list[dict], fmt: str) -> str:
    if fmt == "json":
        return json.dumps({"schema": drafts[0]["schema"], "buildings": drafts}, indent=1, ensure_ascii=False) + "\n"
    if fmt == "md":
        return "\n---\n\n".join(d["markdown"] for d in drafts)
    return "\n----\n\n".join(f"Subject: {d['subject']}\n\n{d['text']}" for d in drafts)


def register(add) -> None:
    s = add("questions", cmd_questions, "draft the questions to ask each building's leasing office (never sends)")
    s.add_argument("--building", help="only buildings whose name, address or key contains this text")
    s.add_argument("--units", nargs="+", metavar="UNIT",
                   help="ask about these units (listing id or unit number, space or comma separated)")
    s.add_argument("--format", choices=("text", "md", "json"), default="text", help="output format (default text)")
    s.add_argument("--top", type=int, default=DEFAULT_TOP, help="also count the top N ranked units as of interest")
    s.add_argument("--all", action="store_true", help="every active unit of the matched buildings, not only units of interest")
    s.add_argument("--standard", action="store_true",
                   help="also include the standard lease-term questions (renewal, early exit, utilities, regulation)")
    s.add_argument("--out", help="write to this file instead of printing")
    s.add_argument("--as-of", help="date to judge staleness against (default today)")
