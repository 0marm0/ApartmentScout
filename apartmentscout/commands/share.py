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
from .. import tours
from ..listings import load
from ..quality.workspace import search_from

FALLBACK_STATUSES = ("shortlist", "touring", "applied")


def cmd_share(args: argparse.Namespace) -> None:
    ws = search_from(args)
    listings = load(ws.listings_path) if ws.listings_path.exists() else []
    crit = ws.criteria()
    weights = None
    findings = tours.load_all(ws.root)   # the visits saved in the search folder (tours/<id>/findings.json)
    trail: list[dict] = []
    if args.picks:
        try:
            raw = json.loads(Path(args.picks).read_text(encoding="utf-8"))
            picks, weights = sh.read_picks(raw)
        except (OSError, ValueError) as e:
            sys.exit(f"Cannot read {args.picks}: {e}")
        if isinstance(raw, dict):   # the backup carries the visits and the decision trail too; the newer version of a visit wins
            for lid, f in (raw.get("findings") if isinstance(raw.get("findings"), dict) else {}).items():
                if isinstance(lid, str) and tours.TOUR_ID.match(lid):
                    findings[lid] = tours.newest(findings.get(lid), tours.normalize({**(f if isinstance(f, dict) else {}), "photos": findings.get(lid, {}).get("photos", [])}))
            trail = tours.clean_trail(raw.get("history"))
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
                     transit_features=sh.transit_lines(ws.root), generated=args.as_of, findings=findings, trail=trail,
                     tour_photos=args.tour_photos)
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
    s.add_argument("--tour-photos", action="store_true", help="include the photos you took on your visits (from the search folder's "
                   "tours/; left out by default)")
    s.add_argument("--title", help="page heading (default: the number of homes)")
    s.add_argument("--as-of", metavar="DATE", help="snapshot date to print (default today)")
