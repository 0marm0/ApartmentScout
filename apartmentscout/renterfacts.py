"""Facts the renter typed in for a home's unknowns, on the Python side.

A listing that does not state its size, monthly fees, a settled price, whether it has a washer/dryer in the unit or which floor
it is on loses points for each (the scorer estimates, takes the worse of two prices, or counts the amenity half). The renter can
type the real value in the dashboard's "Unknowns that move this score" section. It is saved, with the date and the source
``renter``, in ``<search>/renter_facts.json`` (through the local API when the page is served by ``apartmentscout serve``,
otherwise in the browser) and read here when scoring: :func:`overlay` applies the facts to a copy of the listing, so
``listings.json`` itself never changes. The dashboard does the same arithmetic in ``dashboard/js/features/facts-model.js``;
``tests/test_renterfacts.py`` feeds both the same cases and compares, so the two stay in step.

    {"v": 1, "facts": {"<listing id>": {"size": {"value": 640, "at": "2026-10-15", "source": "renter"}, ...}}}

Kinds: ``size`` (ft²), ``fees`` (required monthly fees, $), ``price`` (rent you will pay each month after free months, $),
``wd`` (in-unit washer/dryer, true or false) and ``floor`` (floor number).
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import threading
from pathlib import Path
from typing import Any

VERSION = 1
FILE = "renter_facts.json"
SOURCE = "renter"
KINDS = ("size", "fees", "price", "wd", "floor")
LABELS = {"size": "Size", "fees": "Monthly fees", "price": "Monthly rent", "wd": "In-unit washer/dryer", "floor": "Floor"}
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PRICE_CLAIM_FIELDS = ("gross", "net_effective", "free_months", "lease_months", "fees_monthly", "fees_one_time")


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        x = float(v)
    elif isinstance(v, str) and v.strip():
        try:
            x = float(v.replace(",", "").replace("$", ""))
        except ValueError:
            return None
    else:
        return None
    return x if math.isfinite(x) else None


def value_of(kind: str, v: Any) -> Any:
    """A typed value validated for its kind, or None."""
    if kind == "wd":
        return v if isinstance(v, bool) else None
    x = _num(v)
    if x is None:
        return None
    if kind == "size":
        return int(math.floor(x + 0.5)) if 50 <= x <= 20000 else None
    if kind == "fees":
        return round(x, 2) if 0 <= x <= 20000 else None
    if kind == "price":
        return round(x, 2) if 100 <= x <= 100000 else None
    if kind == "floor":
        return int(x) if x == int(x) and 1 <= x <= 120 else None
    return None


def normalize(raw: Any, today: dt.date | None = None) -> dict[str, dict[str, Any]]:
    """One home's facts cleaned to the schema: known kinds only, each ``{value, at, source}``; anything else is dropped."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return out
    for kind in KINDS:
        e = raw.get(kind)
        v = value_of(kind, e.get("value") if isinstance(e, dict) else e)
        if v is None:
            continue
        at = e.get("at") if isinstance(e, dict) and isinstance(e.get("at"), str) and _DATE.match(e["at"]) else None
        out[kind] = {"value": v, "at": at or (today or dt.date.today()).isoformat(), "source": SOURCE}
    return out


def load(root: Path) -> dict[str, dict[str, dict[str, Any]]]:
    """Every home's facts from ``<search>/renter_facts.json`` (empty when there is none)."""
    try:
        raw = json.loads((Path(root) / FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    facts = raw.get("facts") if isinstance(raw, dict) else None
    if not isinstance(facts, dict):
        return {}
    out = {}
    for lid, f in facts.items():
        n = normalize(f) if isinstance(lid, str) and ID.match(lid) else {}
        if n:
            out[lid] = n
    return out


class FactsFile:
    """Reads and writes one search folder's ``renter_facts.json`` (the local API's half). All writes go through ``lock``."""

    def __init__(self, root: Path, lock: threading.RLock) -> None:
        self.root, self.lock = Path(root).resolve(), lock

    def all(self) -> dict[str, dict[str, dict[str, Any]]]:
        return load(self.root)

    def save(self, listing_id: Any, facts: Any) -> dict[str, dict[str, Any]]:
        """Replace one home's facts (an empty record removes them). Returns what was kept."""
        if not isinstance(listing_id, str) or not ID.match(listing_id) or listing_id.endswith("."):
            raise ValueError("Unknown listing id.")
        if not isinstance(facts, dict):
            raise ValueError("facts must be a JSON object.")
        with self.lock:
            every = load(self.root)
            n = normalize(facts)
            if n:
                every[listing_id] = n
            else:
                every.pop(listing_id, None)
            target = self.root / FILE
            if target.is_symlink() or target.resolve().parent != self.root:
                raise ValueError("renter_facts.json is not a plain file inside the search folder.")
            tmp = self.root / f".{FILE}.{os.getpid()}.tmp"
            try:
                tmp.write_text(json.dumps({"v": VERSION, "facts": every}, indent=1, sort_keys=True, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, target)
            finally:
                tmp.unlink(missing_ok=True)
        return n


def overlay(L: dict, f: Any) -> dict:
    """The listing as scoring should see it with the renter's facts applied to a copy; the original is never touched."""
    n = normalize(f) if f else {}
    if not n:
        return L
    out = dict(L)
    if "size" in n:
        out["sqft"] = n["size"]["value"]
        for k in ("size", "sqft_basis", "sqft_estimate", "sqft_range"):
            out.pop(k, None)
    if "wd" in n:
        out["amenities"] = {**(L.get("amenities") or {}), "in_unit_wd": n["wd"]["value"]}
    if "floor" in n:
        out["floor"] = n["floor"]["value"]
        out["floor_inferred"] = False
        out["floor_source"] = SOURCE
    if "fees" in n or "price" in n:
        price = dict(L.get("price") or {})
        if "fees" in n:
            price["fees_monthly"] = n["fees"]["value"]
        if "price" in n:
            net = n["price"]["value"]
            price.update({"net_effective": net, "basis": "renter_quote", "source": "the renter, from a written quote",
                          "checked": n["price"]["at"]})
            if price.get("gross") is None:
                price["gross"] = net
            for k in ("free_months", "concession", "concession_conditions", "range"):
                price.pop(k, None)
            claims = [c for c in (L.get("claims") or []) if not _is_price_claim(c)]
            out["claims"] = claims
        out["price"] = price
    return out


def _is_price_claim(c: Any) -> bool:
    if not isinstance(c, dict):
        return False
    if isinstance(c.get("price"), dict):
        return True
    return str(c.get("field") or "").removeprefix("price.") in _PRICE_CLAIM_FIELDS


def annotate(score: dict, f: Any) -> dict:
    """Record on a score which facts the renter supplied (``score['renter']``) and say so in the reason that each one moves."""
    n = normalize(f) if f else {}
    if not n:
        return score
    score["renter"] = {k: {"value": v["value"], "at": v["at"], "source": v["source"]} for k, v in n.items()}
    score["flags"] = sorted({*score.get("flags", []), *(f"renter:{k}" for k in n)})   # the rank history names them in "why it moved"
    dim = {"size": "space", "fees": "cost", "price": "cost", "wd": "amenities", "floor": "light_view"}
    say = {"size": lambda v: f"you entered {v:,} ft²", "fees": lambda v: f"you entered ${v:,.0f} a month in fees",
           "price": lambda v: f"you entered ${v:,.0f} a month for the rent", "wd": lambda v: "you confirmed an in-unit washer/dryer" if v else "you confirmed no in-unit washer/dryer",
           "floor": lambda v: f"you entered floor {v}"}
    for r in score.get("reasons", []):
        lines = [say[k](n[k]["value"]) for k in n if dim[k] == r.get("dim")]
        if lines:
            r["items"] = [*lines, *r.get("items", [])]
    return score
