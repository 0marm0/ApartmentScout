"""`apartmentscout validate`: schema and sanity checks on listings.json."""
from __future__ import annotations

import argparse
import json
import sys

from ..quality.validate import format_report, summarise, validate, validate_document
from ..quality.workspace import raw_document, raw_listings, search_from


def cmd_validate(args: argparse.Namespace) -> None:
    ws = search_from(args)
    try:
        doc = raw_document(ws.listings_path)
    except ValueError as e:
        print(f"listings.json is not valid JSON: {e}")
        sys.exit(2)
    issues = validate_document(doc) + validate(raw_listings(doc), ws.criteria(), ws.root, today=args.as_of)
    if args.json:
        print(json.dumps({"summary": summarise(issues), "issues": [i.as_dict() for i in issues]}, indent=1))
    else:
        print(format_report(issues, len(raw_listings(doc)), limit=10 ** 9 if args.all else 40))
    c = summarise(issues)
    if c["error"] or (args.strict and c["warn"]):
        sys.exit(1)


def register(add) -> None:
    s = add("validate", cmd_validate, "check listings.json: schema, enums, ranges, duplicates, URLs, coordinates, prices")
    s.add_argument("--json", action="store_true", help="machine-readable output")
    s.add_argument("--all", action="store_true", help="print every issue, not the first 40 per severity")
    s.add_argument("--strict", action="store_true", help="exit 1 on warnings too")
    s.add_argument("--as-of", help="date to judge 'future' check dates against (default today)")
