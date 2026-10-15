"""`apartmentscout monitor`: re-check the watchlist from the listings' own pages and write a digest of what changed.

    apartmentscout monitor                       the active units of every watchlist building
    apartmentscout monitor --shortlist           the shortlist / touring / applied units instead
    apartmentscout monitor ID [ID ...]           named listings
    apartmentscout monitor --dry-run             show the plan and what the cache already says; fetch and write nothing
    apartmentscout monitor --since 2026-10-10    compare with the reading on or before that day (default: the previous one)

Only hosts named in `monitor.allow_hosts` (criteria.yaml), `--allow-host` or on a watchlist entry are fetched, one page at
a time with a pause; a bot check, a login wall or a robots.txt Disallow skips that host and says so in the digest.
Readings are cached for `--max-age-hours` (default 12). Changes become claims in history/claims.jsonl and a digest
(history/monitor/digest.json, history/monitor/digests/DATE.md; `apartmentscout build` copies the JSON to the dashboard).
listings.json is changed only with `--apply`. Scheduling examples: docs/guides/monitoring.md.
"""
from __future__ import annotations

import argparse
import json

from ..quality.monitor import (DEFAULT_MAX_AGE_HOURS, HttpFetcher, apply_to_listings, digest_markdown, plan_targets,
                               run_monitor)
from ..quality.workspace import load_listings, search_from


def cmd_monitor(args: argparse.Namespace) -> None:
    ws = search_from(args)
    crit = ws.criteria()
    listings = load_listings(ws)
    targets, entries, note = plan_targets(listings, crit, args.ids, args.shortlist, args.as_of, args.allow_host)
    if args.limit:
        targets = targets[:args.limit]
    fetcher = None if (args.dry_run or args.offline) else HttpFetcher(pause=args.pause)
    res = run_monitor(ws.root, listings, crit, targets, fetcher, today=args.as_of, since=args.since, entries=entries,
                      extra_hosts=args.allow_host, dry_run=args.dry_run, refresh=args.refresh, offline=args.offline,
                      max_age_hours=args.max_age_hours, note=note)
    if args.apply and not args.dry_run and res.looks:
        from ..listings import save
        from ..quality.history import write_snapshot
        day = res.digest["run"]["date"]
        import datetime as dt
        n = apply_to_listings(listings, res.looks, dt.date.fromisoformat(day))
        if n:
            save(listings, ws.listings_path)
            write_snapshot(ws.root, listings, day)
        res.digest["run"]["applied"] = n
    if args.json:
        print(json.dumps(res.digest, indent=1, ensure_ascii=False))
        return
    print(digest_markdown(res.digest))
    if args.dry_run:
        print(f"Dry run: {len(targets)} page(s) planned, nothing fetched or written.")
        for t in targets[:40]:
            print(f"  {t.id:<40} {t.host}  ({t.kind} page)")
        if len(targets) > 40:
            print(f"  ... {len(targets) - 40} more")
    elif res.digest["run"].get("applied"):
        print(f"Updated {res.digest['run']['applied']} listing(s) in listings.json; run `apartmentscout score && apartmentscout build`.")


def register(add) -> None:
    s = add("monitor", cmd_monitor, "re-check watched listings from their own pages, record dated readings, write a digest of changes")
    s.add_argument("ids", nargs="*", help="listing ids to check (default: the watchlist's active units)")
    s.add_argument("--shortlist", action="store_true", help="check the shortlist / touring / applied units")
    s.add_argument("--dry-run", action="store_true", help="plan only: no network, nothing written; reads the cache as it is")
    s.add_argument("--since", help="compare with the reading on or before this day (default: the previous reading)")
    s.add_argument("--allow-host", action="append", default=[], metavar="HOST", help="also fetch this host (repeatable)")
    s.add_argument("--max-age-hours", type=float, default=None, help=f"reuse a cached reading younger than this (default {DEFAULT_MAX_AGE_HOURS:g})")
    s.add_argument("--refresh", action="store_true", help="ignore the cache and fetch again")
    s.add_argument("--offline", action="store_true", help="no network: use the cache only, still write the digest")
    s.add_argument("--apply", action="store_true", help="also write fresh readings into listings.json (price, start date, gone; never a revival)")
    s.add_argument("--pause", type=float, default=2.0, help="seconds between requests (default 2)")
    s.add_argument("--limit", type=int, default=0, help="check at most this many pages")
    s.add_argument("--as-of", help="treat this as today (testing)")
    s.add_argument("--json", action="store_true", help="print the digest as JSON")
