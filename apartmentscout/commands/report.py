"""`apartmentscout report --homes ID ID ... --out report.pdf`: the decision report for two to four homes.

    apartmentscout report --homes paramount-tower-25e greywood-4b --out report.pdf
    apartmentscout report --homes 25e 41a 4b --notes --tour-photos --paper a4 --out report.html

The document is `dashboard/report/report.html` filled from the search folder (the same page the dashboard's Make a report button
produces): a cover with the recommendation and why, a side-by-side table, a page for each home and a final checklist. With a
`.pdf` name it is printed by a headless browser (Playwright's Chromium, else a system Chrome or Edge); when none is available the
HTML is written instead, and any browser prints it to PDF. The 3D view from each window is taken with Playwright, which runs the
dashboard from this machine; without it the page says so where the picture would be. Nothing is uploaded, and the renter's own notes
and visit photos are left out unless asked for.

Without `--homes` the command still writes the markdown shortlist (`shortlist.md`), as before.
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

from .. import pdfout
from .. import report_doc as rd
from ..listings import load
from ..quality.workspace import search_from
from .share import picks_context

SLUG = re.compile(r"[^a-z0-9]+")


def resolve_ids(listings: list[dict], keys: list[str]) -> list[str]:
    """Listing ids from what the renter typed: an exact id, else the one id that contains the text."""
    ids = [L["id"] for L in listings if L.get("id")]
    out: list[str] = []
    for key in keys:
        if key in ids:
            hit = key
        else:
            near = [i for i in ids if key.lower() in i.lower()]
            if len(near) != 1:
                sys.exit(f"{'No' if not near else 'More than one'} listing matches '{key}'" + (f": {', '.join(near[:8])}" if near else "."))
            hit = near[0]
        if hit not in out:
            out.append(hit)
    return out


def _stills(ws, ids: list[str]) -> dict:
    """The 3D views from the windows of ``ids``, by serving the dashboard on this machine for a headless browser. {} when not possible."""
    from .. import cli
    from ..localapi import ServeState, make_server
    data = cli.default_data_dir(ws)
    if not (data / "manifest.json").is_file():
        if cli._is_example(ws):
            print("3D views skipped: the example's dashboard data is missing (run `apartmentscout build`).", file=sys.stderr)
            return {}
        cli._export(ws, data)
    state = ServeState(dash=cli.DASH, searches_dir=ws.root.parent, ws=ws, data_dir=data, media_dir=ws.root / "media", export=cli._export, rescore=cli._rescore, api=False)
    state.media_lite_dir = ws.root / "media-lite"
    httpd = make_server(state, 0)
    import threading
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        return pdfout.capture_stills(f"http://127.0.0.1:{state.port}", ids)
    finally:
        httpd.shutdown()
        httpd.server_close()


def run(args: argparse.Namespace) -> None:
    ws = search_from(args)
    listings = load(ws.listings_path) if ws.listings_path.exists() else []
    crit = ws.criteria()
    ids = resolve_ids(listings, args.homes)
    if not (2 <= len(ids) <= rd.MAX_HOMES):
        sys.exit(f"A decision report compares 2 to {rd.MAX_HOMES} homes; {len(ids)} were given.")
    picks, weights, findings, trail, _ = picks_context(ws, listings, args.picks)
    stills: dict = {}
    if not args.no_stills:
        try:
            stills = _stills(ws, ids)
            missing = [i for i in ids if i not in stills]
            if missing:
                print(f"No 3D view for {', '.join(missing)} (no site model, or the scene did not draw).")
        except pdfout.BrowserUnavailable as e:
            print(f"3D views skipped: {e}", file=sys.stderr)
    try:
        html = rd.render(listings, crit, ids, picks=picks, weights=weights, include_notes=args.notes, tour_photos=args.tour_photos, root=ws.root,
                         with_photos=not args.no_photos, photo_budget_kb=args.photo_budget, findings=findings, trail=trail, stills=stills,
                         title=args.title, generated=args.as_of, paper=args.paper)
    except rd.ReportError as e:
        sys.exit(str(e))
    out = Path(args.out or "report.pdf")
    out.parent.mkdir(parents=True, exist_ok=True)
    note = " · notes included" if args.notes else ""
    if out.suffix.lower() == ".pdf":
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "report.html"
            page.write_text(html, encoding="utf-8")
            try:
                engine = pdfout.html_to_pdf(page, out)
            except pdfout.BrowserUnavailable as e:
                fallback = out.with_suffix(".html")
                fallback.write_text(html, encoding="utf-8")
                print(f"No PDF made ({e}).\nWrote {fallback} instead: open it in a browser and choose Print, then Save as PDF.")
                return
        print(f"Wrote {out} ({engine}) · {len(ids)} homes · {out.stat().st_size / 1024:,.0f} KB{note}")
        return
    out.write_text(html, encoding="utf-8")
    print(f"Wrote {out} · {len(ids)} homes · {len(html) / 1024:,.0f} KB{note}. Open it in a browser; Print gives the PDF.")


def add_arguments(s: argparse.ArgumentParser) -> None:
    """The decision-report options, added to the existing `report` command (cli.py)."""
    s.add_argument("--homes", nargs="+", metavar="ID", help="make the decision report for these 2 to 4 homes (a listing id, or text that matches one); "
                   "without it the markdown shortlist is written")
    s.add_argument("--out", metavar="FILE", help="where to write the report: .pdf (needs a headless browser, else HTML is written instead) or .html "
                   "(default report.pdf)")
    s.add_argument("--picks", metavar="FILE", help="the dashboard's picks backup: your tiers, notes, weights, visits and decision trail")
    s.add_argument("--notes", action="store_true", help="include your notes (pick notes and visit notes); left out by default")
    s.add_argument("--tour-photos", action="store_true", help="include the photos you took on your visits (from tours/ in the search folder)")
    s.add_argument("--no-photos", action="store_true", help="leave the listing photos out")
    s.add_argument("--photo-budget", type=float, metavar="KB", help="most embedded photo data, in KB (default 1500)")
    s.add_argument("--no-stills", action="store_true", help="skip the 3D view from each window (it needs Playwright and a few seconds per home)")
    s.add_argument("--paper", choices=["letter", "a4"], default="letter", help="paper size (default letter)")
    s.add_argument("--title", help="a title for the report (default: the search's name)")
    s.add_argument("--as-of", metavar="DATE", help="the date to print (default today)")
