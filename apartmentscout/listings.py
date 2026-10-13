"""Listing schema, normalisation and file I/O.

A *listing* is one rentable unit. Everything in ApartmentScout reads and writes
the same JSON shape (see ``docs/guides/data-model.md``). Agents may add any extra
keys they like; unknown keys are preserved.

Minimal valid listing::

    {"id": "emerald-green-1211", "building": "Emerald Green", "unit": "1211",
     "address": "320 W 38th St, New York, NY", "price": {"gross": 5021}}
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Iterable

# Amenity keys the scorer understands. Values are True / False / None (unknown),
# except ``doorman`` which is one of: "full-time", "part-time", "virtual", "none", None.
AMENITY_KEYS = [
    "in_unit_wd", "elevator", "doorman", "gym", "pool", "roof_deck", "outdoor_space",
    "dishwasher", "central_ac", "pets", "parking", "bike_room", "package_room",
    "lounge", "coworking", "game_room",
]

STATUSES = ["new", "researching", "shortlist", "touring", "applied", "rejected", "gone"]


def slugify(*parts: Any) -> str:
    s = "-".join(str(p) for p in parts if p not in (None, ""))
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "listing"


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d[\d,]*\.?\d*", str(v))
    return float(m.group(0).replace(",", "")) if m else None


def _tri(v: Any) -> bool | None:
    """Parse yes/no/unknown text into True/False/None."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    t = str(v).strip().lower()
    if t.startswith(("yes", "y ", "true", "in unit", "in-unit")) or t in {"y", "1"}:
        return True
    if t.startswith(("no", "none", "false", "n ")) or t in {"n", "0"}:
        return False
    return None


def parse_doorman(v: Any) -> str | None:
    if v is None or v == "":
        return None
    t = str(v).lower()
    if "virtual" in t:
        return "virtual"
    if "part" in t:
        return "part-time"
    if any(k in t for k in ("full", "24", "doorman", "concierge", "staffed")):
        return "full-time"
    if t.startswith(("no", "none")):
        return "none"
    return None


def net_effective(price: dict) -> float | None:
    """Monthly net-effective rent: gross spread over the lease after free months."""
    if not price:
        return None
    if price.get("net_effective") is not None:
        return float(price["net_effective"])
    gross = _num(price.get("gross"))
    if gross is None:
        return None
    lease = _num(price.get("lease_months")) or 12
    free = _num(price.get("free_months")) or 0
    return round(gross * (lease - free) / lease, 2)


def monthly_cost(listing: dict) -> float | None:
    """Net-effective rent plus recurring fees plus one-time fees amortised over the lease."""
    p = listing.get("price") or {}
    ne = net_effective(p)
    if ne is None:
        return None
    lease = _num(p.get("lease_months")) or 12
    rec = _num(p.get("fees_monthly")) or 0
    one = _num(p.get("fees_one_time")) or 0
    return round(ne + rec + one / lease, 2)


def infer_floor(unit: Any) -> float | None:
    """Best guess of the floor from a unit label: 1211 -> 12, 35D -> 35, 7B -> 7, PH -> None."""
    u = str(unit or "").strip().upper()
    m = re.match(r"^(\d{1,2})[A-Z]{1,2}$", u)
    if m:
        return float(m.group(1))
    m = re.match(r"^(\d{3,4})[A-Z]?$", u)
    if m:
        return float(m.group(1)[:-2])
    return None


def normalize(raw: dict) -> dict:
    """Return a listing in canonical shape. Unknown keys are kept."""
    L = dict(raw)
    L.setdefault("building", raw.get("building_name") or "")
    L.setdefault("unit", "")
    L["id"] = raw.get("id") or slugify(L.get("building") or L.get("address"), L.get("unit"))
    price = dict(raw.get("price") or {})
    for k_flat, k in (("rent", "gross"), ("gross", "gross"), ("net", "net_effective"),
                      ("free_months", "free_months"), ("lease_months", "lease_months"),
                      ("fees_monthly", "fees_monthly"), ("fees_one_time", "fees_one_time"),
                      ("broker_fee", "broker_fee")):
        if k_flat in raw and k not in price and raw[k_flat] not in (None, ""):
            price[k] = _num(raw[k_flat])
    L["price"] = price
    am = dict(raw.get("amenities") or {})
    for k in AMENITY_KEYS:
        if k in raw and k not in am:
            am[k] = parse_doorman(raw[k]) if k == "doorman" else _tri(raw[k])
    L["amenities"] = am
    for k in ("beds", "baths", "sqft", "floor", "lat", "lon"):
        if k in L and L[k] not in (None, ""):
            L[k] = _num(L[k])
    if L.get("floor") in (None, "") and L.get("unit"):
        f = infer_floor(L["unit"])
        if f:
            L["floor"] = f
            L["floor_inferred"] = True
    if isinstance(L.get("exposure"), str):
        L["exposure"] = [e.strip().upper() for e in re.split(r"[,/ ]+", L["exposure"]) if e.strip()]
    L.setdefault("status", "new")
    L.setdefault("links", {})
    if raw.get("url") and "listing" not in L["links"]:
        L["links"]["listing"] = raw["url"]
    return L


def load(path: str | Path) -> list[dict]:
    path = Path(path)
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        return [normalize(_unflatten(r)) for r in rows]
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("listings", [])
    return [normalize(d) for d in data]


def save(listings: Iterable[dict], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(list(listings), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def _unflatten(row: dict) -> dict:
    """CSV columns like ``price.gross`` or ``amenities.gym`` become nested keys."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if k is None:
            continue
        v = v.strip() if isinstance(v, str) else v
        if v == "":
            continue
        cur = out
        parts = k.strip().split(".")
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = v
    for k in ("price",):
        if k in out:
            out[k] = {kk: _num(vv) for kk, vv in out[k].items()}
    if "amenities" in out:
        out["amenities"] = {kk: (parse_doorman(vv) if kk == "doorman" else _tri(vv))
                            for kk, vv in out["amenities"].items()}
    return out


CSV_TEMPLATE_COLUMNS = [
    "building", "unit", "address", "neighborhood", "beds", "baths", "sqft", "floor", "exposure",
    "price.gross", "price.free_months", "price.lease_months", "price.fees_monthly",
    "price.fees_one_time", "price.broker_fee", "available",
    "amenities.in_unit_wd", "amenities.elevator", "amenities.doorman", "amenities.gym",
    "amenities.pool", "amenities.roof_deck", "amenities.outdoor_space", "amenities.dishwasher",
    "amenities.pets", "status", "links.listing", "notes",
]
