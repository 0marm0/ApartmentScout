"""Buildings to watch for new units.

Mark a building in either place (both are merged by building):

criteria.yaml::

    watchlist:
      - name: The Example Tower
        address: 1 Example St, New York, NY
        reason: Best layouts in the area; nothing in budget right now
        trigger: a 1BR at or under $5,000 with in-unit W/D
        url: https://example-tower.com/availability
        cadence: weekly            # daily | weekly | alert
        last_checked: 2026-10-01

listings.json (on any unit in the building)::

    "watch": true
    "watch": {"reason": "...", "trigger": "...", "cadence": "daily"}
"""
from __future__ import annotations

import re
from typing import Any

from . import SCHEMA_VERSION
from .common import building_key, crit_today, is_active, iso, norm_address, num, parse_date

NOTE_EMPTY = ("No buildings on the watchlist. Add them under `watchlist:` in criteria.yaml or set `\"watch\": true` "
              "on a listing (see docs/guides/research-quality.md).")


def _name_key(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")


def watchlist(listings: list[dict], crit: dict, events: list[dict] | None = None, today: Any = None) -> dict:
    """The watchlist.json document. ``events`` (from history) flag units that appeared after the last check."""
    t = crit_today(crit, today)
    by_bkey: dict[str, list[dict]] = {}
    by_name: dict[str, list[dict]] = {}
    for L in listings:
        by_bkey.setdefault(building_key(L), []).append(L)
        if L.get("building"):
            by_name.setdefault(_name_key(L["building"]), []).append(L)

    entries: dict[str, dict] = {}

    def entry(key: str) -> dict:
        return entries.setdefault(key, {"key": key, "name": None, "address": None, "lat": None, "lon": None, "reason": None,
                                        "trigger": None, "cadence": None, "url": None, "last_checked": None,
                                        "source": []})

    for w in crit.get("watchlist") or []:
        if not isinstance(w, dict) or not (w.get("name") or w.get("address")):
            continue
        key = building_key({"address": w.get("address"), "building": w.get("name")})
        if not re.match(r"^\d", norm_address(w.get("address"))) and by_name.get(_name_key(w.get("name"))):
            key = building_key(by_name[_name_key(w["name"])][0])
        e = entry(key)
        for k in ("name", "address", "reason", "trigger", "cadence", "url"):
            if w.get(k) and not e[k]:
                e[k] = str(w[k])
        e["lat"], e["lon"] = num(w.get("lat")), num(w.get("lon"))
        e["last_checked"] = iso(parse_date(w.get("last_checked")))
        e["source"].append("criteria")
    for L in listings:
        w = L.get("watch")
        if not w:
            continue
        e = entry(building_key(L))
        if isinstance(w, dict):
            for k in ("reason", "trigger", "cadence", "url"):
                if w.get(k) and not e[k]:
                    e[k] = str(w[k])
        if "listing" not in e["source"]:
            e["source"].append("listing")

    new_ids = {}
    for ev in events or []:
        if ev.get("type") in ("new", "relist"):
            new_ids.setdefault(ev["id"], ev.get("date"))

    out = []
    for key, e in entries.items():
        units = by_bkey.get(key, [])
        first = units[0] if units else {}
        e["name"] = e["name"] or first.get("building") or e["address"]
        e["address"] = e["address"] or first.get("address")
        if e["lat"] is None and units:
            pts = [(num(u.get("lat")), num(u.get("lon"))) for u in units if num(u.get("lat")) is not None and num(u.get("lon")) is not None]
            if pts:
                e["lat"] = round(sum(p[0] for p in pts) / len(pts), 6)
                e["lon"] = round(sum(p[1] for p in pts) / len(pts), 6)
        checks = [d for d in [parse_date(e["last_checked"])] + [parse_date(u.get("checked")) for u in units] if d]
        last = max(checks) if checks else None
        e["last_checked"] = iso(last)
        if not e["url"]:
            e["url"] = next((u["links"].get("building_site") for u in units if (u.get("links") or {}).get("building_site")), None)
        e["units_seen"] = len(units)
        e["active_units"] = sum(1 for u in units if is_active(u))
        e["listing_ids"] = [u["id"] for u in units]
        e["new_units"] = [u["id"] for u in units if u["id"] in new_ids and (last is None or str(new_ids[u["id"]]) >= last.isoformat())]
        e["days_since_check"] = (t - last).days if last else None
        out.append(e)
    out.sort(key=lambda e: (-(len(e["new_units"])), e["days_since_check"] is None, -(e["days_since_check"] or 0), e["name"] or ""))
    return {"schema_version": SCHEMA_VERSION, "generated": t.isoformat(), "note": None if out else NOTE_EMPTY,
            "buildings": out}
