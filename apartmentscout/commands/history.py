"""`apartmentscout history`: snapshots, diffs, the claims log and the availability ladder.

    apartmentscout history diff [--since DATE]        what changed since a snapshot
    apartmentscout history snapshot [--date DATE]     record today's snapshot now (build does this too)
    apartmentscout history claim ID FIELD VALUE ...   append a received claim to history/claims.jsonl
    apartmentscout history show [ID]                  availability ladder (one listing or counts)
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter

from ..quality.history import (CLAIM_FIELDS, SOURCE_KINDS, append_claim, availability, diff_since, make_claim,
                               read_claims, read_snapshots, write_snapshot)
from ..quality.workspace import load_listings, search_from

TYPE_ORDER = ["new", "relist", "price", "concession", "status", "gone", "claim"]


def _fmt(v) -> str:
    if isinstance(v, float):
        return f"${v:,.0f}" if v >= 100 else f"{v:g}"
    return "-" if v is None else str(v)


def cmd_history(args: argparse.Namespace) -> None:
    ws = search_from(args)
    crit = ws.criteria()
    sub = args.history_cmd
    if sub == "snapshot":
        p = write_snapshot(ws.root, load_listings(ws), args.date)
        print(f"Wrote {p}")
    elif sub == "claim":
        try:
            c = make_claim(args.id, args.field, args.value, args.source, args.kind, args.claimed_at, args.received_at,
                           args.method, args.scope, args.note)
        except ValueError as e:
            sys.exit(f"Claim not recorded: {e}")
        if args.id not in {L["id"] for L in load_listings(ws)}:
            print(f"Note: no listing has id {args.id} yet; the claim is kept and will apply once it does.")
        append_claim(ws.root, c)
        print(f"Logged: {c['id']} {c['field']} = {c['value']!r} (claimed {c['claimed_at'] or 'undated'}, "
              f"received {c['received_at']})")
    elif sub == "diff":
        Ls = load_listings(ws)
        base, ev = diff_since(ws.root, Ls, args.since, args.as_of)
        if base is None:
            print(f"No snapshots yet in {ws.root / 'history' / 'snapshots'}. Run `apartmentscout build` or "
                  "`apartmentscout history snapshot`, then diff after the next change.")
            return
        if args.json:
            print(json.dumps({"since": base, "events": ev}, indent=1, ensure_ascii=False))
            return
        byid = {L["id"]: L for L in Ls}
        c = Counter(e["type"] for e in ev)
        print(f"Changes since {base}: " + (", ".join(f"{c[t]} {t}" for t in TYPE_ORDER if c[t]) or "none"))
        for t in TYPE_ORDER:
            rows = [e for e in ev if e["type"] == t]
            if not rows:
                continue
            print(f"\n{t.upper()} ({len(rows)})")
            for e in rows[:args.limit]:
                L = byid.get(e["id"], {})
                name = f"{L.get('building', '')} {L.get('unit', '')}".strip() or e["id"]
                what = f"{e['field']}: {_fmt(e['from'])} -> {_fmt(e['to'])}" if e["field"] else _fmt(e["to"])
                print(f"  {e['date']}  {name:<34} {what}" + (f"  [{e['note']}]" if e.get("note") else ""))
            if len(rows) > args.limit:
                print(f"  ... {len(rows) - args.limit} more")
    elif sub == "show":
        Ls = load_listings(ws)
        claims = read_claims(ws.root)
        if args.id:
            L = next((x for x in Ls if x["id"] == args.id), None) or next((x for x in Ls if args.id.lower() in x["id"]), None)
            if not L:
                sys.exit(f"No listing matches {args.id}")
            a = availability(L, crit, claims, args.as_of)
            print(f"{L['id']}: {a['state']}  ({a['reason']})")
            for c in [c for c in claims if c["id"] == L["id"]]:
                print(f"  claim {c['field']} = {c['value']!r}  claimed {c.get('claimed_at') or 'undated'}  received "
                      f"{c.get('received_at')}  {c.get('source') or ''}")
        else:
            cnt = Counter(availability(L, crit, claims, args.as_of)["state"] for L in Ls)
            print(f"{len(Ls)} listings, {len(claims)} claims, {len(read_snapshots(ws.root))} snapshots")
            for s, n in cnt.most_common():
                print(f"  {s:<15} {n}")


def register(add) -> None:
    s = add("history", cmd_history, "listing history: snapshots, diffs, received claims, availability ladder")
    hs = s.add_subparsers(dest="history_cmd", required=True)

    def sub(name: str, help_: str) -> argparse.ArgumentParser:
        p = hs.add_parser(name, help=help_)
        p.add_argument("--search", default=argparse.SUPPRESS, help="search folder")
        return p

    d = sub("diff", "what changed since the last snapshot (or --since DATE)")
    d.add_argument("--since", help="compare against the last snapshot on or before this date")
    d.add_argument("--as-of", help="treat this as today")
    d.add_argument("--limit", type=int, default=40, help="rows per change type")
    d.add_argument("--json", action="store_true")
    sn = sub("snapshot", "record a snapshot of listings.json now")
    sn.add_argument("--date", help="snapshot date (default today)")
    c = sub("claim", "append a received claim to history/claims.jsonl")
    c.add_argument("id")
    c.add_argument("field", choices=CLAIM_FIELDS)
    c.add_argument("value")
    c.add_argument("--source", help="URL or name of who said it")
    c.add_argument("--kind", default="other", choices=SOURCE_KINDS, help="what kind of source")
    c.add_argument("--claimed-at", help="date the source says the fact was true (page date, capture date)")
    c.add_argument("--received-at", help="date the claim reached this search (default today)")
    c.add_argument("--method", help="how it was captured: browser, paste, email, call, cached ...")
    c.add_argument("--scope", help="exact_unit, building, line ... when the claim is not about the exact unit")
    c.add_argument("--note")
    sh = sub("show", "availability ladder for one listing, or counts for all")
    sh.add_argument("id", nargs="?")
    sh.add_argument("--as-of", help="treat this as today")
