"""Commute by time of day: which departure and arrival times the router is asked about.

A commute is not one number. The 09:00 arrival the search is built around is the morning peak; the same trip at midday,
the evening way home at 18:00, a late return at 22:00 and a Saturday morning all differ, sometimes by a lot (a bus line
that stops running, a subway that thins out to 20 minutes between trains).

Each *slot* is one of those times::

    id     short key used in listings.json and the layer files ("am", "pm", ...)
    label  what the dashboard calls it
    kind   "arrive": from home, arriving at the destination by `time`   (the morning direction)
           "depart": from the destination, leaving at `time`, back home (the evening direction)
    time   "HH:MM" (24 hour); for the first slot, null means the destination's own `arrive_by`
    day    "weekday" (the search's `service_date`), "saturday" or "sunday" (the nearest such day in the feeds' calendars)

``commute.times`` in criteria.yaml tunes them::

    commute:
      times:
        enabled: true            # false: compute only the arrive_by trip, as before
        slots: [...]             # replaces the default list (the first slot should be the arrive_by trip)
        score: am                # the slot the commute SCORE reads: a slot id, or "weighted" (default: am, i.e. unchanged)
        weights: {am: 3, pm: 3, mid: 1, late: 1, wknd: 1}    # how much each slot counts when score is "weighted"

Everything here is plain data and arithmetic, so the scorer, the build and the tests can import it without numpy.
"""
from __future__ import annotations

import re
from typing import Any

DEFAULT_SLOTS: list[dict[str, Any]] = [
    {"id": "am", "label": "Morning peak", "kind": "arrive", "time": None, "day": "weekday"},
    {"id": "mid", "label": "Midday", "kind": "arrive", "time": "13:00", "day": "weekday"},
    {"id": "pm", "label": "Evening peak, home", "kind": "depart", "time": "18:00", "day": "weekday"},
    {"id": "late", "label": "Late evening, home", "kind": "depart", "time": "22:00", "day": "weekday"},
    {"id": "wknd", "label": "Weekend", "kind": "arrive", "time": "11:00", "day": "saturday"},
]
#: How much each default slot counts when ``score: weighted``: the two peaks carry a working week, the rest are occasional.
DEFAULT_WEIGHTS = {"am": 3.0, "pm": 3.0, "mid": 1.0, "late": 1.0, "wknd": 1.0}
DAYS = ("weekday", "saturday", "sunday")
KINDS = ("arrive", "depart")
_HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def hhmm_ok(t: Any) -> bool:
    return isinstance(t, str) and bool(_HHMM.match(t.strip()))


def clock_label(t: str | None) -> str:
    """'09:00' -> '9:00', '18:30' -> '18:30' (24-hour, no leading zero)."""
    if not t:
        return ""
    h, m = str(t).strip().split(":")[:2]
    return f"{int(h)}:{m}"


def times_cfg(crit: dict) -> dict:
    """commute.times as a mapping (`true`/missing -> defaults, `false` -> disabled)."""
    raw = ((crit.get("commute") or {}).get("times"))
    if raw is False:
        return {"enabled": False}
    if raw in (None, True):
        return {"enabled": True}
    return dict(raw) if isinstance(raw, dict) else {"enabled": True}


def enabled(crit: dict) -> bool:
    return bool(times_cfg(crit).get("enabled", True))


def resolve_slots(crit: dict) -> list[dict[str, Any]]:
    """The slots in force: the criteria's own list, else the defaults. Bad entries raise ValueError with a sentence to act on."""
    cfg = times_cfg(crit)
    raw = cfg.get("slots")
    slots = [dict(s) for s in (raw if raw else DEFAULT_SLOTS)]
    seen: set[str] = set()
    for i, s in enumerate(slots):
        sid = str(s.get("id") or "").strip()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,15}", sid):
            raise ValueError(f"commute.times.slots[{i + 1}]: id must be a short lowercase key (am, mid, pm), not {s.get('id')!r}")
        if sid in seen:
            raise ValueError(f"commute.times.slots: id {sid!r} appears twice")
        seen.add(sid)
        s["id"] = sid
        s["kind"] = s.get("kind") or "arrive"
        if s["kind"] not in KINDS:
            raise ValueError(f"commute.times.slots[{sid}]: kind must be arrive (from home, arriving by the time) or depart "
                             f"(from the destination, back home), not {s['kind']!r}")
        s["day"] = s.get("day") or "weekday"
        if s["day"] not in DAYS:
            raise ValueError(f"commute.times.slots[{sid}]: day must be one of {', '.join(DAYS)}, not {s['day']!r}")
        t = s.get("time")
        if t is None and not (i == 0 and s["kind"] == "arrive"):
            raise ValueError(f"commute.times.slots[{sid}]: time is required (only the first slot may use the destination's arrive_by)")
        if t is not None:
            t = str(t).strip()
            if not hhmm_ok(t):
                raise ValueError(f"commute.times.slots[{sid}]: time must be HH:MM on the 24-hour clock, not {s.get('time')!r}")
            s["time"] = t
        s["label"] = str(s.get("label") or sid)
    if not slots:
        raise ValueError("commute.times.slots: needs at least one slot")
    return slots


def slot_time(slot: dict, dest: dict) -> str:
    """The slot's clock time for a destination ('09:00'): its own `time`, else the destination's arrive_by (default 09:00)."""
    return slot.get("time") or str(dest.get("arrive_by") or "09:00")


def slot_phrase(slot: dict, dest: dict) -> str:
    """'arrive 9:00' / 'leave 18:00' with the day when it is not a weekday."""
    verb = "arrive" if slot.get("kind", "arrive") == "arrive" else "leave"
    day = "" if slot.get("day", "weekday") == "weekday" else f" {slot['day'].capitalize()}"
    return f"{verb} {clock_label(slot_time(slot, dest))}{day}"


def score_setting(crit: dict) -> str:
    """Which slot the commute score reads: a slot id, 'weighted', or 'am' (the default, i.e. the arrive_by trip)."""
    s = str(times_cfg(crit).get("score") or "").strip().lower()
    return s or "am"


def slot_weights(crit: dict, slots: list[dict]) -> dict[str, float]:
    """Weight of each slot for ``score: weighted`` (the criteria's `weights`, else the defaults; a slot with none counts 1)."""
    given = times_cfg(crit).get("weights") or {}
    out = {}
    for s in slots:
        w = given.get(s["id"], DEFAULT_WEIGHTS.get(s["id"], 1.0))
        out[s["id"]] = max(0.0, float(w))
    return out


def scored_minutes(entry: dict, crit: dict) -> float | None:
    """The minutes the commute score is computed from, for one listing's commute entry to one destination.

    Unchanged by default: the arrive_by trip's ``minutes``. With ``commute.times.score`` set to a slot id the minutes of that
    slot; with "weighted" the weight-averaged minutes over the slots the listing has. A listing without per-slot times
    (an old commute run) falls back to ``minutes``."""
    base = entry.get("minutes")
    choice = score_setting(crit)
    if choice == "am" or not enabled(crit):
        return base
    t = (entry.get("times") or {}).get("transit")
    if not t:
        return base
    try:
        slots = resolve_slots(crit)
    except ValueError:
        return base
    if choice == "weighted":
        w = slot_weights(crit, slots)
        num = den = 0.0
        for s, v in zip(slots, t):
            if v is not None and w[s["id"]] > 0:
                num += v * w[s["id"]]
                den += w[s["id"]]
        return num / den if den else base
    for s, v in zip(slots, t):
        if s["id"] == choice:
            return v if v is not None else base
    return base


def export_block(crit: dict) -> dict | None:
    """commute.times as the dashboard reads it (criteria.json): the slots in force, what the score reads, and the weights.
    None when the feature is off or the slots are invalid."""
    if not enabled(crit):
        return None
    try:
        slots = resolve_slots(crit)
    except ValueError:
        return None
    return {"slots": [{"id": s["id"], "label": s["label"], "kind": s["kind"], "time": s.get("time"), "day": s["day"]}
                      for s in slots],
            "score": score_setting(crit), "weights": slot_weights(crit, slots)}


def check(crit: dict) -> list[str]:
    """Problems with commute.times as sentences (for criteria --check); empty when fine."""
    raw = (crit.get("commute") or {}).get("times")
    if raw in (None, True, False):
        return []
    if not isinstance(raw, dict):
        return ["commute.times: a mapping (enabled, slots, score, weights), or false to turn it off."]
    out = []
    try:
        slots = resolve_slots(crit)
    except ValueError as e:
        return [str(e)]
    ids = [s["id"] for s in slots]
    sc = score_setting(crit)
    if sc != "weighted" and sc not in ids:
        out.append(f"commute.times.score: {sc!r} is not one of the slots ({', '.join(ids)}) or 'weighted'.")
    w = raw.get("weights")
    if w is not None:
        if not isinstance(w, dict):
            out.append("commute.times.weights: a mapping of slot id to a number.")
        else:
            for k, v in w.items():
                if k not in ids:
                    out.append(f"commute.times.weights: {k!r} is not one of the slots ({', '.join(ids)}).")
                elif not isinstance(v, (int, float)) or v < 0:
                    out.append(f"commute.times.weights.{k}: a number, 0 or more.")
    return out
