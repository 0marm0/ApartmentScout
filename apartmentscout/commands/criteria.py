"""`apartmentscout criteria --check FILE`: validate a criteria.yaml and print what it says."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from ..criteria_check import check_file, summary_lines


def cmd_criteria(args: argparse.Namespace) -> None:
    target = args.check
    if target in (None, True):
        root = args.search or os.environ.get("APARTMENTSCOUT_SEARCH") or "search"
        target = str(Path(root) / "criteria.yaml")
    rep = check_file(target)
    if args.json:
        print(json.dumps({"file": str(target), "ok": rep.ok, "errors": rep.errors, "warnings": rep.warnings,
                          "summary": summary_lines(rep.criteria) if rep.criteria and rep.ok else []}, indent=1))
    else:
        print(f"{target}")
        for line in summary_lines(rep.criteria) if rep.criteria and rep.ok else []:
            print("  " + line)
        for w in rep.warnings:
            print(f"  warning: {w}")
        for e in rep.errors:
            print(f"  error: {e}")
        print(("OK" if rep.ok else "NOT OK") + f": {len(rep.errors)} error(s), {len(rep.warnings)} warning(s)")
    if not rep.ok or (args.strict and rep.warnings):
        sys.exit(1)


def register(add) -> None:
    s = add("criteria", cmd_criteria, "validate a criteria.yaml and print a summary (--check [FILE])")
    s.add_argument("--check", nargs="?", const=True, default=None, metavar="FILE",
                   help="criteria file to validate (default: the active search's criteria.yaml)")
    s.add_argument("--json", action="store_true", help="machine-readable output")
    s.add_argument("--strict", action="store_true", help="exit 1 on warnings too")
