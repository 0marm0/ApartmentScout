"""`apartmentscout handoff pack | verify | import`: hand a search to another agent and take its updates back.

    apartmentscout handoff pack OUT.zip [--since DATE|PACK.zip] [--to NAME] [--from NAME]
    apartmentscout handoff verify PACK.zip
    apartmentscout handoff import PACK.zip|updates.json [--dry-run] [--all]

See docs/guides/agents-handoff.md and apartmentscout/handoff/.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Callable


def register(add: Callable[..., Any]) -> None:
    s = add("handoff", cmd_handoff, "hand the search to another agent and import its updates (pack, verify, import)")
    sub = s.add_subparsers(dest="handoff_cmd", required=True, metavar="{pack,verify,import}")

    def child(name: str, help_: str) -> argparse.ArgumentParser:
        c = sub.add_parser(name, help=help_)
        # SUPPRESS keeps a --search given before the subcommand from being reset to None here
        c.add_argument("--search", default=argparse.SUPPRESS,
                       help="search folder (default ./search or $APARTMENTSCOUT_SEARCH)")
        return c

    p = child("pack", "write a deterministic, checksummed zip of the search for another agent")
    p.add_argument("out", metavar="OUT.zip")
    p.add_argument("--since", metavar="DATE|PACK", help="delta pack: only what changed since a YYYY-MM-DD date, or "
                   "since an earlier pack (zip or MANIFEST.json)")
    p.add_argument("--to", default="agent", help="name of the receiving agent (default: agent)")
    p.add_argument("--from", dest="sender", default="apartmentscout", help="name of the sending agent")
    p.add_argument("--purpose", default="", help="one line on what the receiving agent should do")
    p.add_argument("--include", default="listings,criteria,research,sites,plans",
                   help="comma list of listings, criteria, research, sites, plans (media is never packed)")
    p.add_argument("--created", metavar="YYYY-MM-DD", help="pack date (default today, or $SOURCE_DATE_EPOCH)")
    v = child("verify", "check a pack's files against its manifest and checksums")
    v.add_argument("pack", metavar="PACK.zip")
    i = child("import", "apply another agent's updates non-destructively and print the adjudication table")
    i.add_argument("pack", metavar="PACK.zip|updates.json")
    i.add_argument("--dry-run", action="store_true", help="adjudicate and print, write nothing")
    i.add_argument("--all", action="store_true", help="also list confirmations and repeats in the table")


def cmd_handoff(args: Any) -> None:
    {"pack": _pack, "verify": _verify, "import": _import}[args.handoff_cmd](args)


def _pack(args: Any) -> None:
    from ..cli import log, ws_from
    from ..handoff.pack import build_pack
    ws = ws_from(args)
    include = tuple(x.strip() for x in args.include.split(",") if x.strip())
    out = Path(args.out)
    if out.suffix.lower() != ".zip":
        sys.exit("The pack name should end in .zip")
    r = build_pack(ws.root, out, to=args.to, sender=args.sender, purpose=args.purpose, since=args.since,
                   include=include, created=args.created)
    cov = r.manifest["coverage"]
    log(f"Pack ({r.manifest['mode']}) -> {r.path.resolve()}")
    log(f"  sha256 {r.sha256}  (also in {r.path.name}.sha256)")
    log(f"  {len(r.manifest['files'])} files; {cov['listings_in_pack']} of {cov['listings']} listings; "
        f"{cov['sites']} sites, {cov['plans']} plans, {cov['dossiers']} dossiers, {cov['research_notes']} notes; "
        f"{cov['open_questions']} active listings with open questions")
    for w in r.warnings:
        log(f"  privacy check: {w}")
    log("  Send the zip with PASTE_TO_AGENT.md (inside the pack). The pack holds private search data.")


def _verify(args: Any) -> None:
    from ..cli import log
    from ..handoff.verify import verify_pack
    r = verify_pack(Path(args.pack))
    if r.ok:
        m = r.manifest or {}
        log(f"OK  {args.pack}: {r.checked} files match the manifest ({m.get('mode')} pack from {m.get('from')} "
            f"to {m.get('to')}, {m.get('created')}); sha256 {r.sha256}")
        return
    log(f"FAILED  {args.pack}")
    for p in r.problems:
        log(f"  - {p}")
    sys.exit(1)


def _import(args: Any) -> None:
    from ..cli import log, ws_from
    from ..handoff.importer import adjudication_table, import_updates
    ws = ws_from(args)
    res = import_updates(ws.root, Path(args.pack), dry_run=args.dry_run)
    log(adjudication_table(res, all_rows=args.all))
    if res.dry_run:
        log("Dry run: nothing was written.")
    elif res.written:
        log("Wrote " + ", ".join(res.written[:6]) + (f" and {len(res.written) - 6} more" if len(res.written) > 6 else ""))
        if "listings.json" in res.written:
            log("Next: apartmentscout score && apartmentscout build")
