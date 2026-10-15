"""Alerts: what changed in a search since the last time it was looked at, against the renter's own criteria.

``apartmentscout alerts`` turns two *states* of a search into a short digest: new homes that fit, homes that now fit,
price drops and rises, homes gone or back on the market, homes that jumped into the top of the ranking and unknowns that
were resolved. Everything here is a pure function over listings that ``apartmentscout score`` has already scored, so the
tests use small synthetic before/after data and nothing touches the network.

A *state* is a compact record of every listing at one moment (status, whether it fits, its rank, rent, cost, open
questions). It is saved under ``<search>/history/alerts/`` and is the baseline for the next run. Files:

    state.json              the baseline (written by a run that saves)
    digest.json             the last digest, as a run wrote it
    digests/YYYY-MM-DD.*    the dated digest as JSON and Markdown (the last :data:`KEEP_DIGESTS` are kept)

``apartmentscout build`` writes ``alerts.json`` for the dashboard's "What's new" panel from the same functions
(:func:`export_digest`): the changes since the baseline if there are any, otherwise the last saved digest while it is
recent. The GitHub Actions workflow ``.github/workflows/alerts.yml`` runs the command daily and opens one issue per day
from the Markdown. What the monitor can and cannot check is in ``docs/guides/alerts.md``.

What counts as a change (a "relevant" home is active and either fits the criteria or is on the renter's shortlist):

- ``new``: a home that was not in the baseline and fits now. ``fits``: a known home that did not fit and does now.
- ``drops`` / ``rises``: the advertised rent moved; or, with the rent unchanged, the listing's own concession or fee
  fields moved the monthly cost. Estimated fees never count, so re-scoring on its own is quiet.
- ``gone`` / ``back``: a relevant home became unavailable (the renter's own *rejected* is not news) / a gone home
  is listed again.
- ``jumps``: a home that fit before at a rank below the top moved into the top ``top`` (default 10).
- ``resolved``: a question the score had to guess (price, fees, lease term, a must-have, size) is now answered.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1
STATE_VERSION = 1
TOP = 10
KEEP_DIGESTS = 30
RECENT_DAYS = 14                       # how long the dashboard keeps showing a saved digest after the changes stop
WATCH_STATUSES = ("shortlist", "touring", "applied")
RELATIVE = Path("history") / "alerts"
GROUPS = ("new", "fits", "drops", "rises", "gone", "back", "jumps", "resolved")
_KEEP_GATE = re.compile(r"^(over_budget|fails:|unverified:|unknown_cost)")
_UNKNOWN_FLAGS = {"fees_unknown": "monthly fees", "size_estimated": "size"}
_GATE_WORDS = {"price": "price", "fees": "monthly fees", "lease_term": "lease term"}

# headline wording: (group, singular, plural)
_HEAD = (("new", "{n} new", "{n} new"), ("fits", "{n} now fits", "{n} now fit"), ("drops", "{n} price drop", "{n} price drops"),
         ("rises", "{n} price rise", "{n} price rises"), ("gone", "{n} gone", "{n} gone"), ("back", "{n} back on the market", "{n} back on the market"),
         ("jumps", "{n} into the top {top}", "{n} into the top {top}"), ("resolved", "{n} unknown resolved", "{n} unknowns resolved"))
HEADLINE_PARTS = 4


# --------------------------------------------------------------------------- paths
def alerts_dir(root: Path) -> Path:
    return Path(root) / RELATIVE


def state_path(root: Path) -> Path:
    return alerts_dir(root) / "state.json"


def digest_path(root: Path) -> Path:
    return alerts_dir(root) / "digest.json"


def _write_json(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def load_state(path: Path) -> dict | None:
    """The baseline at ``path``, or None when it is missing or not a state of this version."""
    doc = _read_json(path)
    if isinstance(doc, dict) and doc.get("v") == STATE_VERSION and isinstance(doc.get("listings"), dict):
        return doc
    return None


# --------------------------------------------------------------------------- states
def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _name(L: dict) -> str:
    base = str(L.get("building") or L.get("address") or L.get("id") or "").strip()
    unit = str(L.get("unit") or "").strip()
    return f"{base} {unit}".strip() if unit and unit.lower() not in base.lower().split() else base


def _unknowns(gates: Iterable[str], flags: Iterable[str]) -> list[str]:
    from .score import AMENITY_NAMES
    out: list[str] = []
    for g in gates:
        if g.startswith("unverified:"):
            for k in g[len("unverified:"):].split(","):
                out.append(_GATE_WORDS.get(k) or AMENITY_NAMES.get(k, k.replace("_", " ")))
        elif g == "unknown_cost":
            out.append("monthly cost")
    out += [_UNKNOWN_FLAGS[f] for f in flags if f in _UNKNOWN_FLAGS]
    return sorted(dict.fromkeys(out))


def entry_of(L: dict) -> dict:
    """One listing as the baseline remembers it."""
    sc = L.get("score") or {}
    price = L.get("price") or {}
    ranks = sc.get("ranks") or {}
    rank = ranks.get("action") or sc.get("rank")
    status = str(L.get("status") or "new")
    gates = [g for g in (sc.get("gates") or []) if isinstance(g, str) and _KEEP_GATE.match(g)]
    e: dict[str, Any] = {
        "name": _name(L), "hood": L.get("neighborhood") or None, "status": status,
        "active": status not in ("gone", "rejected"),
        "fit": bool(sc.get("eligible")), "rank": int(rank) if isinstance(rank, (int, float)) and rank else None,
        "gross": _num(price.get("gross")), "cost": _num(sc.get("monthly_cost")),
        "free": _num(price.get("free_months")), "fees": _num(price.get("fees_monthly")),
        "gates": gates, "unknowns": _unknowns(gates, sc.get("flags") or []),
    }
    link = (L.get("links") or {}).get("listing") or (L.get("links") or {}).get("building_site")
    if isinstance(link, str) and link.startswith("https://"):
        e["url"] = link
    return e


def snapshot(listings: Iterable[dict], crit: dict | None = None, at: dt.datetime | None = None) -> dict:
    """The state of the whole search now. ``listings`` must already be scored (``apartmentscout score``)."""
    at = at or dt.datetime.now()
    rows = {str(L["id"]): entry_of(L) for L in listings if L.get("id") is not None}
    return {"v": STATE_VERSION, "at": at.isoformat(timespec="seconds"), "date": at.date().isoformat(),
            "search": ((crit or {}).get("search") or {}).get("name"), "listings": rows}


# --------------------------------------------------------------------------- the diff
def _watching(e: dict) -> bool:
    return e["active"] and (e["fit"] or e["status"] in WATCH_STATUSES)


def _item(id: str, e: dict, **extra: Any) -> dict:
    out = {"id": id, "name": e["name"], "hood": e.get("hood"), "rank": e.get("rank"), "gross": e.get("gross"), "cost": e.get("cost"),
           "status": e["status"]}
    if e.get("url"):
        out["url"] = e["url"]
    out.update(extra)
    return out


def _why_blocked(gates: list[str]) -> str | None:
    for g in gates:
        if g.startswith("over_budget"):
            return "was over budget"
        if g.startswith("fails:"):
            return "was failing a must-have: " + g[len("fails:"):].replace("_", " ")
    return None


def _price_change(old: dict, new: dict) -> tuple[float, float, str] | None:
    """(from, to, basis) when the rent moved, or the concession / fees the listing itself states moved the monthly cost."""
    a, b = old.get("gross"), new.get("gross")
    if a is not None and b is not None and round(a) != round(b):
        return a, b, "rent"
    if (a is not None and b is not None and (old.get("free"), old.get("fees")) != (new.get("free"), new.get("fees"))
            and old.get("cost") is not None and new.get("cost") is not None and round(old["cost"]) != round(new["cost"])):
        return old["cost"], new["cost"], "monthly cost"
    return None


def diff_states(old: dict, new: dict, top: int = TOP, include_all: bool = False) -> dict[str, list[dict]]:
    """The change groups between two states (see the module docstring). ``include_all`` also reports price moves, gone
    homes and resolved questions for homes that neither fit nor are on the shortlist."""
    before, after = old["listings"], new["listings"]
    out: dict[str, list[dict]] = {g: [] for g in GROUPS}
    for id, now in after.items():
        was = before.get(id)
        if was is None:
            if now["active"] and now["fit"]:
                out["new"].append(_item(id, now))
            continue
        relevant = _watching(now) or _watching(was) or include_all
        if not was["active"]:
            if now["active"] and was["status"] == "gone" and (relevant or now["fit"] or now["status"] in WATCH_STATUSES):
                out["back"].append(_item(id, now))
            continue
        if not now["active"]:
            if now["status"] == "gone" and (_watching(was) or include_all):
                out["gone"].append(_item(id, now, was_rank=was.get("rank")))
            continue
        if now["fit"] and not was["fit"]:
            out["fits"].append(_item(id, now, why=_why_blocked(was.get("gates") or [])))
        pc = _price_change(was, now) if relevant else None
        if pc:
            a, b, basis = pc
            out["drops" if b < a else "rises"].append(_item(id, now, **{"from": a, "to": b, "delta": b - a, "basis": basis}))
        if now["fit"] and was["fit"] and was.get("rank") and now.get("rank") and now["rank"] <= top < was["rank"]:
            out["jumps"].append(_item(id, now, **{"from": was["rank"], "to": now["rank"]}))
        if relevant:
            solved = sorted(set(was.get("unknowns") or []) - set(now.get("unknowns") or []))
            if solved:
                out["resolved"].append(_item(id, now, resolved=solved))
    for id, was in before.items():                       # removed from listings.json altogether
        if id not in after and was["active"] and (_watching(was) or include_all):
            out["gone"].append(_item(id, was, was_rank=was.get("rank"), removed=True))
    key_rank = lambda r: (r.get("rank") is None, r.get("rank") or 0, r["name"])   # noqa: E731
    out["new"].sort(key=key_rank)
    out["fits"].sort(key=key_rank)
    out["back"].sort(key=key_rank)
    out["jumps"].sort(key=lambda r: (r["to"], r["name"]))
    out["drops"].sort(key=lambda r: (r["delta"], r["name"]))
    out["rises"].sort(key=lambda r: (-r["delta"], r["name"]))
    out["gone"].sort(key=lambda r: (r.get("was_rank") is None, r.get("was_rank") or 0, r["name"]))
    out["resolved"].sort(key=key_rank)
    return out


def headline(counts: dict[str, int], top: int = TOP) -> str:
    """'3 new, 2 price drops': the first few kinds of change, biggest news first. Empty when nothing changed."""
    parts = []
    for g, one, many in _HEAD:
        n = counts.get(g, 0)
        if n:
            parts.append((one if n == 1 else many).format(n=n, top=top))
    if len(parts) > HEADLINE_PARTS:
        parts = parts[:HEADLINE_PARTS - 1] + [f"{len(parts) - HEADLINE_PARTS + 1} more kinds of change"]
    return ", ".join(parts)


def _digest_id(since: str | None, groups: dict[str, list[dict]]) -> str:
    key = json.dumps([since, {g: [(r["id"], r.get("from"), r.get("to"), r.get("resolved")) for r in rows] for g, rows in groups.items()}],
                     sort_keys=True, default=str)
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def make_digest(old: dict | None, new: dict, top: int = TOP, include_all: bool = False, pending: bool = False) -> dict:
    """The digest for the change from ``old`` (None: no baseline yet) to ``new``."""
    after = new["listings"]
    tracked = sum(1 for e in after.values() if e["active"])
    fitting = sum(1 for e in after.values() if e["active"] and e["fit"])
    groups = diff_states(old, new, top, include_all) if old else {g: [] for g in GROUPS}
    counts = {g: len(rows) for g, rows in groups.items() if rows}
    quiet = 0
    if old:
        quiet = sum(1 for id, e in after.items() if id not in old["listings"] and e["active"] and not e["fit"])
    head = headline(counts, top)
    note = None
    if not old:
        note = "First run: this is the baseline. Changes are reported from the next run on."
    elif not head:
        note = "Nothing changed for the homes that fit your criteria or are on your shortlist."
    return {
        "schema_version": SCHEMA_VERSION, "kind": "alerts", "generated": new["date"], "at": new["at"], "search": new.get("search"),
        "since": old["date"] if old else None, "since_at": old["at"] if old else None, "first_run": old is None, "pending": pending,
        "top": top, "id": _digest_id(old["date"] if old else None, groups), "headline": head,
        "title": f"ApartmentScout: {head}" if head else ("ApartmentScout: alerts are on" if old is None else "ApartmentScout: nothing new"),
        "total": sum(counts.values()), "counts": counts, "groups": {g: rows for g, rows in groups.items() if rows},
        "tracked": tracked, "fitting": fitting, "quiet_new": quiet, "note": note,
    }


# --------------------------------------------------------------------------- text
def _money(v: Any) -> str:
    return f"${v:,.0f}" if isinstance(v, (int, float)) else "price unknown"


def _day(iso: str | None) -> str:
    try:
        d = dt.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return str(iso or "")
    return f"{d.strftime('%b')} {d.day}"


def _line(group: str, r: dict, md: bool) -> str:
    name = f"**{r['name']}**" if md else r["name"]
    if md and r.get("url"):
        name = f"[{r['name']}]({r['url']})"
        name = f"**{name}**"
    hood = f" ({r['hood']})" if r.get("hood") else ""
    rank = f", ranked #{r['rank']}" if r.get("rank") else ""
    if group in ("new", "back"):
        return f"{name}{hood}: {_money(r.get('gross'))} a month{rank}"
    if group == "fits":
        return f"{name}{hood}: {_money(r.get('gross'))} a month{rank}" + (f" ({r['why']} before)" if r.get("why") else "")
    if group in ("drops", "rises"):
        sign = "-" if r["delta"] < 0 else "+"
        basis = "" if r.get("basis") == "rent" else f" ({r['basis']})"
        return f"{name}{hood}: {_money(r['from'])} to {_money(r['to'])} ({sign}{_money(abs(r['delta']))}){basis}"
    if group == "gone":
        return f"{name}{hood}: no longer available" + (f" (was ranked #{r['was_rank']})" if r.get("was_rank") else "")
    if group == "jumps":
        return f"{name}{hood}: #{r['from']} to #{r['to']}"
    return f"{name}{hood}: now known: {', '.join(r['resolved'])}"


_TITLES = {"new": "New homes that fit", "fits": "Now fit your criteria", "drops": "Price drops", "rises": "Price rises",
           "gone": "No longer available", "back": "Back on the market", "jumps": "Into the top {top}", "resolved": "Unknowns resolved"}
MAX_LINES = 12


def digest_text(d: dict, md: bool = False) -> str:
    """The digest as short readable text (plain, or Markdown for a GitHub issue)."""
    since = f" since {_day(d['since'])}" if d.get("since") else ""
    lines = [f"# {d['title']}" if md else d["title"]]
    lines.append("")
    if d.get("note") and not d["total"]:
        lines.append(d["note"])
    else:
        lines.append(f"Changes{since}: {d['total']}.")
    lines.append(f"{d['tracked']} homes tracked, {d['fitting']} fit your criteria.")
    for g in GROUPS:
        rows = d["groups"].get(g)
        if not rows:
            continue
        title = _TITLES[g].format(top=d["top"])
        lines += ["", f"## {title} ({len(rows)})" if md else f"{title} ({len(rows)})"]
        for r in rows[:MAX_LINES]:
            lines.append(("- " if md else "  ") + _line(g, r, md))
        if len(rows) > MAX_LINES:
            lines.append(("- " if md else "  ") + f"... and {len(rows) - MAX_LINES} more")
    if d.get("quiet_new"):
        lines += ["", f"{d['quiet_new']} other new home{'s' if d['quiet_new'] != 1 else ''} did not fit your criteria and {'are' if d['quiet_new'] != 1 else 'is'} not listed here."]
    if md:
        lines += ["", "---", "A change is what the search record says. Confirm a price or availability with the leasing office before acting. "
                  "Open the dashboard's What's new panel for the same list."]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- running it
def run(root: Path, listings: list[dict], crit: dict, *, baseline: Path | None = None, save: bool = True, top: int = TOP,
        include_all: bool = False, at: dt.datetime | None = None) -> dict:
    """Compare the search now with its baseline and (unless ``save`` is False) make now the new baseline. Returns the digest."""
    new = snapshot(listings, crit, at)
    old = load_state(baseline or state_path(root))
    d = make_digest(old, new, top, include_all)
    if save:
        _write_json(state_path(root), new)
        save_digest(root, d)
    return d


def save_digest(root: Path, d: dict) -> None:
    out = alerts_dir(root)
    _write_json(digest_path(root), d)
    if d["total"] or d["first_run"]:
        day = out / "digests"
        _write_json(day / f"{d['generated']}.json", d)
        (day / f"{d['generated']}.md").write_text(digest_text(d, md=True), encoding="utf-8")
        for stale in sorted(day.glob("*.json"))[:-KEEP_DIGESTS]:
            stale.unlink(missing_ok=True)
            stale.with_suffix(".md").unlink(missing_ok=True)


def export_digest(root: Path, listings: list[dict], crit: dict, at: dt.datetime | None = None) -> dict:
    """The digest the dashboard shows: what changed since the baseline now, else the last saved digest while it is recent,
    else an empty one that says so. Never writes anything."""
    new = snapshot(listings, crit, at)
    old = load_state(state_path(root))
    if old:
        live = make_digest(old, new, pending=True)
        if live["total"]:
            return live
        last = _read_json(digest_path(root))
        if isinstance(last, dict) and last.get("kind") == "alerts" and last.get("total"):
            try:
                age = (dt.date.fromisoformat(new["date"]) - dt.date.fromisoformat(str(last["generated"])[:10])).days
            except ValueError:
                age = RECENT_DAYS + 1
            if 0 <= age <= RECENT_DAYS:
                return {**last, "pending": False, "tracked": live["tracked"], "fitting": live["fitting"]}
        live["pending"] = False
        return live
    d = make_digest(None, new)
    d["note"] = "No alert baseline yet. Run `apartmentscout alerts` once to start; changes are reported from the next run on."
    return d
