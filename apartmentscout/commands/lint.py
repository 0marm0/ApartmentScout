"""`apartmentscout lint`: listing traps (junior 1BRs, building laundry, fee = price drop, stale pages ...)."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter

from ..quality.history import read_claims
from ..quality.lint import SEVERITY_ORDER, lint_all, rule_codes
from ..quality.workspace import load_listings, search_from


def cmd_lint(args: argparse.Namespace) -> None:
    ws = search_from(args)
    Ls = load_listings(ws)
    if args.id:
        Ls = [L for L in Ls if L["id"] == args.id] or [L for L in Ls if args.id.lower() in L["id"]]
    if not args.include_inactive and not args.id:
        Ls = [L for L in Ls if (L.get("status") or "new") not in ("gone", "rejected")]
    flags = lint_all(Ls, ws.criteria(), ws.root, read_claims(ws.root), today=args.as_of)
    floor = SEVERITY_ORDER[args.severity]
    codes = set(args.code or [])
    flags = {i: [f for f in fl if SEVERITY_ORDER[f.severity] <= floor and (not codes or f.code in codes)]
             for i, fl in flags.items()}
    flags = {i: fl for i, fl in flags.items() if fl}
    if args.json:
        print(json.dumps({i: [f.as_dict() for f in fl] for i, fl in flags.items()}, indent=1))
    else:
        c = Counter((f.severity, f.code) for fl in flags.values() for f in fl)
        n = sum(c.values())
        print(f"{len(Ls)} listings linted: {n} flags on {len(flags)} listings "
              f"({sum(v for (s, _), v in c.items() if s == 'high')} high).")
        for (s, code), v in sorted(c.items(), key=lambda kv: (SEVERITY_ORDER[kv[0][0]], -kv[1])):
            print(f"  {s:<4} {code:<30} x{v}")
        byid = {L["id"]: L for L in Ls}
        rows = sorted(flags.items(), key=lambda kv: min(SEVERITY_ORDER[f.severity] for f in kv[1]))
        for i, fl in rows[: (10 ** 9 if args.all else 60)]:
            L = byid[i]
            print(f"\n{i}  ({L.get('building', '')} {L.get('unit', '')})")
            for f in fl:
                print(f"  {f.severity:<4} {f.code:<28} {f.field or '':<22} {f.message}")
        if len(rows) > 60 and not args.all:
            print(f"\n... {len(rows) - 60} more listings (use --all or --json)")
    if args.strict and any(f.severity == "high" for fl in flags.values() for f in fl):
        sys.exit(1)


def register(add) -> None:
    s = add("lint", cmd_lint, "flag listing traps: junior/flex 1BR, building laundry, fee = price drop, stale or "
                              "cached pages, wrong building, sale listings, bot pages, expired concessions ...")
    s.add_argument("--id", help="one listing (id or unique part of it)")
    s.add_argument("--severity", default="low", choices=["high", "med", "low"], help="lowest severity to show")
    s.add_argument("--code", action="append", choices=rule_codes(), help="only these rules (repeatable)")
    s.add_argument("--include-inactive", action="store_true", help="also lint gone and rejected listings")
    s.add_argument("--json", action="store_true")
    s.add_argument("--all", action="store_true", help="print every flagged listing")
    s.add_argument("--strict", action="store_true", help="exit 1 when any high-severity flag is found")
    s.add_argument("--as-of", help="date to judge staleness against (default today)")
