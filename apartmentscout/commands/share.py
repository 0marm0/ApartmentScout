"""`apartmentscout share`: a read-only HTML of the renter's saved picks, ready to send or print.

    apartmentscout share --picks picks.json --out shortlist.html            cards, a map and the reasons for each rank
    apartmentscout share --picks picks.json --out memo.html --memo --notes  opens as the print-ready decision memo, with your notes

`picks.json` is the file the dashboard's "Back up picks" writes (or a plain JSON list of listing ids). The page is built
from the same template as the dashboard's Share shortlist button (dashboard/share/snapshot.html).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .. import share as sh
from ..listings import load
from ..quality.workspace import search_from

FALLBACK_STATUSES = ("shortlist", "touring", "applied")


def cmd_share(args: argparse.Namespace) -> None:
    ws = search_from(args)
    listings = load(ws.listings_path) if ws.listings_path.exists() else []
    crit = ws.criteria()
    weights = None
    if args.picks:
        try:
            picks, weights = sh.read_picks(json.loads(Path(args.picks).read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:
            sys.exit(f"Cannot read {args.picks}: {e}")
    else:
        picks = {L["id"]: {"saved": True} for L in listings if (L.get("status") or "new") in FALLBACK_STATUSES}
        print(f"No --picks file: using the {len(picks)} listings whose status is {', '.join(FALLBACK_STATUSES)}.")
    ids, missing = sh.chosen_ids(picks, {L["id"] for L in listings if L.get("id")})
    if missing:
        print(f"Skipping {len(missing)} pick(s) that are not in this search's listings: {', '.join(missing[:6])}{'...' if len(missing) > 6 else ''}",
              file=sys.stderr)
    if not ids:
        sys.exit("Nothing to share: no saved or tiered picks match this search's listings (picks marked Pass are left out).")
    if args.memo and not args.notes:
        print("The memo omits your notes unless you add --notes.")
    html = sh.render(listings, crit, picks, weights=weights, include_notes=args.notes, view="memo" if args.memo else "cards",
                     title=args.title, root=ws.root, with_photos=not args.no_photos, photo_budget_kb=args.photo_budget,
                     transit_features=sh.transit_lines(ws.root), generated=args.as_of)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"Wrote {out} · {len(ids)} home{'s' if len(ids) != 1 else ''} · {len(html) / 1024:,.0f} KB"
          f"{' · notes included' if args.notes else ''}. Open it in a browser; Print gives the PDF.")


def register(add) -> None:
    s = add("share", cmd_share, "write a read-only HTML shortlist (or print-ready decision memo) from your saved picks")
    s.add_argument("--picks", metavar="FILE", help="the dashboard's picks backup (or a JSON list of listing ids); "
                   f"default: listings with status {', '.join(FALLBACK_STATUSES)}")
    s.add_argument("--out", default="shortlist.html", metavar="FILE", help="where to write the page (default shortlist.html)")
    s.add_argument("--memo", action="store_true", help="open on the decision memo layout (the page has both)")
    s.add_argument("--notes", action="store_true", help="include your notes from the picks file (left out by default: a shared "
                   "page should not carry them unless you mean it)")
    s.add_argument("--no-photos", action="store_true", help="leave photos out")
    s.add_argument("--photo-budget", type=float, metavar="KB", help="most embedded thumbnail data, in KB (default 700); "
                   "photos past it are linked instead")
    s.add_argument("--title", help="page heading (default: the number of homes)")
    s.add_argument("--as-of", metavar="DATE", help="snapshot date to print (default today)")
