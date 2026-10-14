"""Listing history: an append-only claims log, dated snapshots, diffs and the availability ladder.

Files under ``<search>/history/``:

- ``claims.jsonl``: one line per received claim ("source X said field F was V"). Never edited, only appended.
  ``received_at`` is the day the claim reached this search (the day we looked, or the day a message arrived).
  ``claimed_at`` is the day the source says the fact was true (a page's "listed" or "updated" date, the date a
  partner captured it). They differ for forwarded or cached material, and a writing date is never a check date:
  a claim with no ``claimed_at`` is *undated* and can never outrank a dated one.
- ``snapshots/YYYY-MM-DD.json``: a compact fingerprint of every listing, written on ``apartmentscout build``
  (one per day; a rebuild the same day replaces it) or by ``apartmentscout history snapshot``.

Availability (``potential``, ``conditional``, ``unverified``, ``over_budget``, ``late``, ``rejected``, ``gone``,
``status_dispute``) is separate from the workflow ``status`` the renter sets, and favourites never change it.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import statistics
from pathlib import Path
from typing import Any, Iterable

from ..listings import monthly_cost
from . import SCHEMA_VERSION
from .common import as_of, building_key, crit_today, iso, move_in, norm_unit, num, parse_date, stale_days

STATES = ("potential", "conditional", "unverified", "over_budget", "late", "rejected", "gone", "status_dispute")
CLAIM_FIELDS = ("status", "gross", "net", "fees_monthly", "fees_one_time", "free_months", "lease_months", "available",
                "sqft", "concession", "note")
SOURCE_KINDS = ("unit_page", "building_site", "portal_search", "broker", "leasing_office", "partner", "renter", "agent",
                "cached", "other")
GONE_WORDS = re.compile(r"\b(?:gone|leased|rented|lease signed|in contract|off[- ]market|no longer available|removed|"
                        r"application pending|taken|sold)\b", re.I)
UNCLEAR_WORDS = re.compile(r"\b(?:not listed|missing|unclear|not found|unknown)\b", re.I)
ACTIVE_WORDS = re.compile(r"\b(?:active|available|listed|live|for rent|open)\b", re.I)

SNAP_FIELDS = ["status", "gross", "net", "fees_monthly", "free_months", "lease_months", "available", "checked", "key"]
NOTE_EMPTY = ("No history yet. ApartmentScout records a snapshot each time the dashboard is built and agents log "
              "claims with `apartmentscout history claim`; changes appear from the second snapshot.")


# --------------------------------------------------------------------------- paths
def history_dir(root: Path) -> Path:
    return Path(root) / "history"


def claims_path(root: Path) -> Path:
    return history_dir(root) / "claims.jsonl"


def snapshots_dir(root: Path) -> Path:
    return history_dir(root) / "snapshots"


# --------------------------------------------------------------------------- claims
def status_value(v: Any) -> str:
    """Normalise a status claim to active / gone / unclear. Unclear (a unit missing from a page) is not gone."""
    t = str(v or "").strip().lower()
    if t in ("gone", "active", "unclear"):
        return t
    if GONE_WORDS.search(t):
        return "gone"
    if UNCLEAR_WORDS.search(t):
        return "unclear"
    if ACTIVE_WORDS.search(t):
        return "active"
    return "unclear"


def make_claim(id: str, field: str, value: Any, source: str | None = None, source_kind: str = "other",
               claimed_at: Any = None, received_at: Any = None, method: str | None = None, scope: str | None = None,
               note: str | None = None) -> dict:
    """Build and check one claim. Raises ValueError on a malformed claim."""
    if not id:
        raise ValueError("claim needs a listing id")
    f = field.replace("price.", "")
    if f not in CLAIM_FIELDS:
        raise ValueError(f"field must be one of {', '.join(CLAIM_FIELDS)}")
    if source_kind not in SOURCE_KINDS:
        raise ValueError(f"source_kind must be one of {', '.join(SOURCE_KINDS)}")
    rec = as_of(received_at)
    cl = parse_date(claimed_at)
    if claimed_at not in (None, "") and cl is None:
        raise ValueError(f"claimed_at {claimed_at!r} is not a YYYY-MM-DD date")
    if cl and cl > rec:
        raise ValueError("claimed_at cannot be after received_at: a source cannot report a day we have not reached")
    if f == "status":
        value = status_value(value)
    elif f in ("gross", "net", "fees_monthly", "fees_one_time", "free_months", "lease_months", "sqft"):
        x = num(value)
        if x is None:
            raise ValueError(f"{f} needs a number")
        value = x
    return {"id": id, "field": f, "value": value, "source": source or None, "source_kind": source_kind,
            "claimed_at": iso(cl), "received_at": rec.isoformat(), "method": method, "scope": scope, "note": note,
            "logged_at": dt.datetime.now().isoformat(timespec="seconds")}


def append_claim(root: Path, claim: dict) -> dict:
    """Append one claim to <search>/history/claims.jsonl (append-only; earlier lines are never rewritten)."""
    p = claims_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(claim, ensure_ascii=False, separators=(",", ":")) + "\n")
    return claim


def read_claims(root: Path | None) -> list[dict]:
    if root is None or not claims_path(root).exists():
        return []
    out = []
    for line in claims_path(root).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            c = json.loads(line)
        except ValueError:
            continue
        if isinstance(c, dict) and c.get("id") and c.get("field"):
            out.append(c)
    return out


def listing_claims(L: dict) -> list[dict]:
    """Claims recorded on the listing itself (``claims[]``, see the Money section of the data model) in log shape.
    ``observed_at`` is the date the source observed the fact, i.e. ``claimed_at``. Superseded ones are dropped."""
    out = []
    for c in L.get("claims") or []:
        if not isinstance(c, dict) or str(c.get("status") or "live").lower() in ("superseded", "withdrawn", "stale"):
            continue
        base = {"id": L.get("id"), "source": c.get("source"), "source_kind": c.get("source_kind") or "other",
                "claimed_at": iso(parse_date(c.get("observed_at") or c.get("claimed_at"))),
                "received_at": iso(parse_date(c.get("received_at"))), "method": c.get("method"), "note": c.get("note"),
                "scope": c.get("scope"), "origin": "listing"}
        if c.get("field"):
            f = str(c["field"]).replace("price.", "").replace("net_effective", "net")
            v = status_value(c.get("value")) if f in ("status", "availability") else c.get("value")
            out.append({**base, "field": "status" if f == "availability" else f, "value": v})
        for k, v in (c.get("price") or {}).items() if isinstance(c.get("price"), dict) else []:
            out.append({**base, "field": "net" if k == "net_effective" else k, "value": v})
    return out


def all_claims(root: Path | None, listings: Iterable[dict]) -> list[dict]:
    """The append-only log plus the claims stored on listings."""
    return read_claims(root) + [c for L in listings for c in listing_claims(L)]


def claim_date(c: dict) -> dt.date | None:
    """The date a claim speaks for: claimed_at only. received_at is when it reached us, never when it was true,
    except for our own direct look at the live page (source_kind unit_page/building_site with no claimed_at)."""
    d = parse_date(c.get("claimed_at"))
    if d:
        return d
    if c.get("source_kind") in ("unit_page", "building_site", "leasing_office") and c.get("method") != "cached":
        return parse_date(c.get("received_at"))
    return None


# --------------------------------------------------------------------------- availability ladder
def availability(L: dict, crit: dict, claims: Iterable[dict] = (), today: Any = None) -> dict:
    """Where a listing stands on the availability ladder, with the reason and the date it rests on.

    Rules, in order:
    1. The latest dated *gone* evidence (status gone, or a gone status claim) stands unless a dated active claim
       is *newer*; then it is ``status_dispute``. Older or undated active claims never reactivate a gone listing.
    2. ``rejected`` workflow status means screened out.
    3. Monthly cost above the hard budget cap is ``over_budget``; a start after the move-in window is ``late``.
    4. Never checked, or last checked longer ago than ``quality.stale_days``: ``unverified``.
    5. An open gate (unverified must-have, unknown cost, a concession whose term is unknown): ``conditional``.
    6. Otherwise ``potential``. The renter's favourite tier is never consulted.
    """
    t = crit_today(crit, today)
    mine = [c for c in claims if c.get("id") == L.get("id")]
    if not any(c.get("origin") == "listing" for c in mine):
        mine += listing_claims(L)
    ck = parse_date(L.get("checked"))
    status = L.get("status") or "new"
    gone_dates = [claim_date(c) for c in mine if c.get("field") == "status" and status_value(c.get("value")) == "gone"]
    gone_dates = [d for d in gone_dates if d]
    if status == "gone":
        gone_dates.append(ck or parse_date(L.get("gone_at")) or dt.date.min)
    active_claims = [(claim_date(c), c) for c in mine if c.get("field") == "status" and status_value(c.get("value")) == "active"]
    if status not in ("gone", "rejected") and ck:
        active_claims.append((ck, {"source": "the listing's own check"}))
    if gone_dates:
        g = max(gone_dates)
        newer = [(d, c) for d, c in active_claims if d and d > g]
        if newer:
            d, c = max(newer, key=lambda x: x[0])
            return {"state": "status_dispute", "as_of": iso(d),
                    "reason": f"marked gone{' ' + iso(g) if g != dt.date.min else ''}, but {c.get('source') or 'a source'} "
                              f"said active on {d}: recheck before acting"}
        return {"state": "gone", "as_of": iso(g) if g != dt.date.min else None,
                "reason": "gone" + (f" (latest evidence {g})" if g != dt.date.min else "")}
    if status == "rejected":
        return {"state": "rejected", "as_of": iso(ck), "reason": "screened out by the renter or agent"}
    cost = monthly_cost(L, crit, t)
    hard = (crit.get("budget") or {}).get("hard_max")
    if cost is not None and hard and cost > float(hard):
        return {"state": "over_budget", "as_of": iso(ck), "reason": f"${cost:,.0f}/mo is above the ${float(hard):,.0f} cap"}
    _, latest = move_in(crit)
    av = parse_date(L.get("available"))
    if av and latest and av > latest:
        return {"state": "late", "as_of": iso(ck), "reason": f"available {av}, after the move-in window ends {latest}"}
    last = max([d for d in [ck] + [claim_date(c) for c in mine] if d], default=None)
    if last is None:
        return {"state": "unverified", "as_of": None, "reason": "never checked on a dated visit"}
    if (t - last).days > stale_days(crit):
        return {"state": "unverified", "as_of": iso(last), "reason": f"last checked {last} ({(t - last).days} days ago)"}
    p = L.get("price") or {}
    am = L.get("amenities") or {}
    open_gates = [k for k in crit.get("must_have") or [] if am.get(k) is None]
    if cost is None:
        open_gates.append("cost")
    if num(p.get("free_months")) and num(p.get("lease_months")) is None:
        open_gates.append("concession term")
    if open_gates:
        return {"state": "conditional", "as_of": iso(last), "reason": "unconfirmed: " + ", ".join(g.replace("_", " ") for g in open_gates)}
    return {"state": "potential", "as_of": iso(last), "reason": "active, within budget and window, gates confirmed"}


# --------------------------------------------------------------------------- snapshots
def fingerprint(L: dict) -> list:
    p = L.get("price") or {}
    av = L.get("available")
    return [L.get("status") or "new", num(p.get("gross")), num(p.get("net_effective")), num(p.get("fees_monthly")),
            num(p.get("free_months")), num(p.get("lease_months")), str(av) if av not in (None, "") else None,
            iso(parse_date(L.get("checked"))), f"{building_key(L)}#{norm_unit(L.get('unit'))}"]


def make_snapshot(listings: list[dict], date: Any = None) -> dict:
    return {"schema_version": SCHEMA_VERSION, "date": as_of(date).isoformat(), "fields": SNAP_FIELDS,
            "listings": {L["id"]: fingerprint(L) for L in listings if L.get("id")}}


def write_snapshot(root: Path, listings: list[dict], date: Any = None) -> Path:
    snap = make_snapshot(listings, date)
    d = snapshots_dir(root)
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{snap['date']}.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(snap, separators=(",", ":"), ensure_ascii=False))
    tmp.replace(p)
    return p


def read_snapshots(root: Path | None) -> list[dict]:
    """All snapshots, oldest first."""
    if root is None or not snapshots_dir(root).is_dir():
        return []
    out = []
    for p in sorted(snapshots_dir(root).glob("*.json")):
        try:
            s = json.loads(p.read_text())
        except ValueError:
            continue
        if isinstance(s, dict) and isinstance(s.get("listings"), dict) and parse_date(s.get("date")):
            out.append(s)
    return sorted(out, key=lambda s: s["date"])


def _rows(snap: dict) -> dict[str, dict]:
    f = snap.get("fields") or SNAP_FIELDS
    return {i: dict(zip(f, v)) for i, v in snap["listings"].items()}


def _ev(id: str, date: str, type: str, field: str | None = None, frm: Any = None, to: Any = None,
        source: str | None = None, note: str | None = None) -> dict:
    return {"id": id, "date": date, "type": type, "field": field, "from": frm, "to": to, "source": source, "note": note}


def diff_snapshots(a: dict, b: dict) -> list[dict]:
    """Events between two snapshots, dated at the later one.

    A new id for a unit that was already known (same building and unit) is a relist, not new; a changed
    available date or price is a change, never a new listing (false freshness)."""
    A, B, date = _rows(a), _rows(b), b["date"]
    out: list[dict] = []
    moved: set[str] = set()
    known_keys = {r.get("key"): i for i, r in A.items() if r.get("key") and not str(r.get("key")).endswith("#")}
    for i, r in B.items():
        if i not in A:
            prev = known_keys.get(r.get("key"))
            if prev and prev not in B:
                moved.add(prev)
                out.append(_ev(i, date, "relist", "id", prev, i, note="same building and unit under a new id or URL"))
            elif prev and A[prev].get("status") in ("gone",):
                out.append(_ev(i, date, "relist", "id", prev, i, note="same unit as a gone listing"))
            else:
                out.append(_ev(i, date, "new", to=r.get("gross")))
            continue
        o = A[i]
        so, sn = o.get("status"), r.get("status")
        if so != sn:
            if sn == "gone":
                out.append(_ev(i, date, "gone", "status", so, sn))
            elif so in ("gone", "rejected") and sn not in ("gone", "rejected"):
                out.append(_ev(i, date, "relist", "status", so, sn))
            else:
                out.append(_ev(i, date, "status", "status", so, sn))
        for f in ("gross", "net", "fees_monthly"):
            if o.get(f) != r.get(f) and not (o.get(f) is None and r.get(f) is None):
                out.append(_ev(i, date, "price", f, o.get(f), r.get(f)))
        for f in ("free_months", "lease_months"):
            if o.get(f) != r.get(f):
                out.append(_ev(i, date, "concession", f, o.get(f), r.get(f)))
        if o.get("available") != r.get("available"):
            out.append(_ev(i, date, "status", "available", o.get("available"), r.get("available")))
    for i, o in A.items():
        if i not in B and i not in moved and o.get("status") != "gone":
            out.append(_ev(i, date, "gone", "status", o.get("status"), None, note="row removed from listings.json"))
    return out


def claim_events(claims: Iterable[dict]) -> list[dict]:
    out = []
    for c in claims:
        d = claim_date(c)
        note = c.get("note") or ""
        if d is None:
            note = (note + " " if note else "") + f"(undated: received {c.get('received_at')}, date of the fact unknown)"
        out.append(_ev(c["id"], iso(d) or c.get("received_at"), "claim", c.get("field"), None, c.get("value"),
                       c.get("source"), note or None))
    return out


def diff_since(root: Path, listings: list[dict], since: Any = None, today: Any = None) -> tuple[str | None, list[dict]]:
    """Events between the last snapshot on or before ``since`` (default: the latest snapshot before today) and
    the current listings. Returns (base date, events)."""
    snaps = read_snapshots(root)
    t = as_of(today)
    cur = make_snapshot(listings, t)
    if since is not None:
        s = parse_date(since)
        base = [x for x in snaps if parse_date(x["date"]) <= s] if s else []
        base_snap = base[-1] if base else (snaps[0] if snaps else None)
    else:
        earlier = [x for x in snaps if parse_date(x["date"]) < t]
        base_snap = earlier[-1] if earlier else (snaps[-1] if snaps else None)
    if base_snap is None:
        return None, []
    ev = diff_snapshots(base_snap, cur)
    lo = parse_date(base_snap["date"])
    ev += [e for e in claim_events(read_claims(root)) if parse_date(e["date"]) and parse_date(e["date"]) > lo]
    return base_snap["date"], ev


# --------------------------------------------------------------------------- history.json
def history_doc(root: Path | None, listings: list[dict], crit: dict, today: Any = None) -> dict:
    """The history.json document (see docs/guides/data-model.md#history)."""
    t = crit_today(crit, today)
    snaps = read_snapshots(root)
    claims = all_claims(root, listings)
    events: list[dict] = []
    for a, b in zip(snaps, snaps[1:]):
        events += diff_snapshots(a, b)
    events += claim_events(claims)
    events.sort(key=lambda e: (e["date"] or "", e["id"]), reverse=True)

    # price history: every change in gross or net across snapshots, plus price claims
    ph: dict[str, list[dict]] = {}
    for s in snaps:
        for i, r in _rows(s).items():
            pts = ph.setdefault(i, [])
            if r.get("gross") is None and r.get("net") is None:
                continue
            if not pts or (pts[-1]["gross"], pts[-1]["net"]) != (r.get("gross"), r.get("net")):
                pts.append({"date": s["date"], "gross": r.get("gross"), "net": r.get("net"), "source": "snapshot"})
    for c in claims:
        if c.get("field") in ("gross", "net") and claim_date(c):
            pts = ph.setdefault(c["id"], [])
            last = next((p for p in reversed(pts) if p["gross"] is not None or p["net"] is not None), None)
            pt = {"date": iso(claim_date(c)), "gross": None, "net": None, "source": c.get("source") or c.get("source_kind")}
            pt[c["field"]] = c.get("value")
            if last:  # carry the other number forward so each point is complete where known
                other = "net" if c["field"] == "gross" else "gross"
                pt[other] = last.get(other)
            pts.append(pt)
    price_history = {i: sorted(p, key=lambda x: x["date"]) for i, p in ph.items() if len(p) >= 2}

    # gone: first seen active -> first seen gone, from snapshots and dated gone claims
    first_active: dict[str, str] = {}
    first_gone: dict[str, str] = {}
    last_price: dict[str, float | None] = {}
    first_date = snaps[0]["date"] if snaps else None
    for s in snaps:
        for i, r in _rows(s).items():
            if r.get("status") != "gone":
                first_active.setdefault(i, s["date"])
                if r.get("gross") is not None:
                    last_price[i] = r.get("gross")
            elif i not in first_gone:
                first_gone[i] = s["date"]
        missing = set(first_active) - set(s["listings"]) - set(first_gone)
        for i in missing:
            first_gone[i] = s["date"]
    for c in claims:
        d = claim_date(c)
        if c.get("field") == "status" and status_value(c.get("value")) == "gone" and d:
            if c["id"] not in first_gone or d.isoformat() < first_gone[c["id"]]:
                first_gone[c["id"]] = d.isoformat()
    byid = {L["id"]: L for L in listings}
    gone_fast = []
    for i, g in first_gone.items():
        L = byid.get(i, {})
        explicit = parse_date(L.get("listed_at") or L.get("listed"))
        seen = first_active.get(i)
        # a unit already present in the first snapshot was listed on an unknown earlier day
        listed = explicit or (parse_date(seen) if seen and seen != first_date else None)
        gd = parse_date(g)
        days = (gd - listed).days if listed and gd and gd >= listed else None
        lp = last_price.get(i, num((L.get("price") or {}).get("gross")))
        gone_fast.append({"id": i, "listed": iso(listed), "gone": g, "days": days, "last_price": lp})
    gone_fast.sort(key=lambda x: (x["days"] is None, x["days"] if x["days"] is not None else 0, x["gone"]))
    numeric = [x["days"] for x in gone_fast if x["days"] is not None]

    snap_rows = []
    for s in snaps:
        rows = _rows(s).values()
        snap_rows.append({"date": s["date"], "total": len(s["listings"]),
                          "active": sum(1 for r in rows if r.get("status") not in ("gone", "rejected"))})
    avail = {L["id"]: availability(L, crit, claims, t) for L in listings if L.get("id")}
    counts: dict[str, int] = {}
    for a in avail.values():
        counts[a["state"]] = counts.get(a["state"], 0) + 1
    return {
        "schema_version": SCHEMA_VERSION,
        "generated": t.isoformat(),
        "note": None if snaps or claims else NOTE_EMPTY,
        "snapshots": snap_rows,
        "events": events,
        "gone_fast": gone_fast,
        "price_history": price_history,
        "availability": avail,
        "summary": {"snapshots": len(snaps), "claims": len(claims), "events": len(events), "gone": len(gone_fast),
                    "numeric_days": len(numeric), "median_days_to_gone": statistics.median(numeric) if numeric else None,
                    "availability": counts},
    }


def should_snapshot(root: Path, crit: dict, repo: Path | None = None) -> bool:
    """Snapshots on build are on by default; off when criteria say ``history: {snapshot_on_build: false}``
    or for the read-only examples bundled in the repository."""
    h = crit.get("history") or {}
    if h.get("snapshot_on_build") is not None:
        return bool(h["snapshot_on_build"])
    if repo is not None:
        try:
            Path(root).resolve().relative_to((repo / "examples").resolve())
            return False
        except ValueError:
            pass
    return True
