"""Tour findings and the decision trail, on the Python side.

What the renter observes in a home (``<search>/tours/<id>/findings.json``, written by the dashboard through the local API
or carried in a picks backup) sits beside the listing's facts and never overwrites them. A finding the renter *promotes*
becomes a dated, sourced claim and only then does scoring read it (:func:`overlay`); a finding that contradicts the
listing and has not been promoted is surfaced as a gate, a tag and a line in the reasons, with no change to any score
(:func:`flags_for`). The dashboard does the same in ``dashboard/js/features/findings-model.js``; ``tests/test_tours.py`` feeds
both the same cases and compares, so the two stay in step.

The decision trail (``dashboard/js/features/decisions-model.js``) is read here only to put it in ``apartmentscout share``.
"""
from __future__ import annotations

import json
import math
import os
import re
import secrets
from pathlib import Path
from typing import Any

from .listings import normalise_laundry, normalise_service

VERSION = 1
COMPASS8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
LEVELS = ["full-time", "part-time", "virtual", "none"]
LAUNDRY = ["in_unit", "on_floor", "building", "none"]
SMELLS = ["none", "smoke", "damp", "pets", "cooking", "sewage", "chemical"]
TAG = "differs on tour"
SOURCE = "renter, observed on a tour"
MAX = {"rooms": 12, "photos": 40, "view": 400, "note": 4000, "caption": 120, "name": 40}
CHECKS: dict[str, dict[str, str]] = {
    "wd": {"field": "in_unit_wd", "path": "amenities.in_unit_wd", "label": "Washer/dryer in the unit", "dim": "amenities"},
    "doorman": {"field": "doorman", "path": "amenities.doorman", "label": "Doorman", "dim": "amenities"},
    "size": {"field": "sqft", "path": "sqft", "label": "Size", "dim": "space"},
    "exposure": {"field": "exposure", "path": "exposure", "label": "Which way the windows face", "dim": "light_view"},
}
CHECK_KEYS = list(CHECKS)
VERDICTS = ["match", "differs", "unsure"]
SIZE_TOLERANCE = 0.02
TOUR_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
PHOTO_NAME = re.compile(r"^[a-z0-9]{6,32}\.webp$")
PHOTO_ID = re.compile(r"^[a-z0-9]{6,32}$")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$")


# --------------------------------------------------------------------------- small helpers
def _rnd(x: float, d: int) -> float:
    f = 10 ** d
    return math.floor(x * f + 0.5) / f   # half up, like the browser


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        x = float(v)
    elif isinstance(v, str) and v.strip():
        try:
            x = float(v)
        except ValueError:
            return None
    else:
        return None
    return x if math.isfinite(x) else None


def _flt(v: Any, lo: float, hi: float, d: int) -> float | int | None:
    x = _num(v)
    if x is None or not (lo < x <= hi):
        return None
    r = _rnd(x, d)
    return int(r) if r == int(r) else r


def _int(v: Any, lo: int, hi: int) -> int | None:
    x = _num(v)
    if x is None or x != int(x) or not (lo <= x <= hi):
        return None
    return int(x)


def _text(v: Any, n: int) -> str | None:
    if not isinstance(v, str):
        return None
    t = _CTRL.sub("", v).strip()
    return t[:n] if t else None


def _date(v: Any) -> str | None:
    import datetime as dt
    if not isinstance(v, str) or not _DATE.match(v):
        return None
    try:
        return v if dt.date.fromisoformat(v).isoformat() == v else None
    except ValueError:
        return None


def _datetime(v: Any) -> str | None:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})", v) if isinstance(v, str) else None
    return f"{m[1]}T{m[2]}:{m[3]}" if m and _date(m[1]) and int(m[2]) < 24 and int(m[3]) < 60 else None


def _clock(v: Any) -> str | None:
    m = re.match(r"^(\d{2}):(\d{2})$", v) if isinstance(v, str) else None
    return v if m and int(m[1]) < 24 and int(m[2]) < 60 else None


def _stamp(v: Any) -> str | None:
    return v if isinstance(v, str) and _STAMP.match(v) and len(v) <= 32 else None


def check_value(key: str, v: Any) -> Any:
    """A value for one check, validated for its kind (or None)."""
    if key == "wd":
        return v if isinstance(v, bool) else None
    if key == "doorman":
        return v if isinstance(v, str) and v in LEVELS else None
    if key == "size":
        return _flt(v, 0, 20000, 0)
    if key == "exposure":
        t = v.upper() if isinstance(v, str) else ""
        return t if t in COMPASS16 else None
    return None


# --------------------------------------------------------------------------- normalise
def normalize(raw: Any) -> dict[str, Any]:
    """A findings record cleaned to the schema: unknown keys dropped, numbers clamped, empty groups left out. Everything the
    renter typed is data, never markup. Mirrors ``normalize`` in findings-model.js."""
    f = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {"v": VERSION}

    def put(k: str, v: Any) -> None:
        if v is not None and v != [] and v != {}:
            out[k] = v

    put("observed", _date(f.get("observed")))
    put("visited_at", _datetime(f.get("visited_at")))
    put("updated", _stamp(f.get("updated")))
    rooms = []
    for r in (f.get("rooms") if isinstance(f.get("rooms"), list) else [])[: MAX["rooms"] * 4]:
        if not isinstance(r, dict) or not _text(r.get("name"), MAX["name"]):
            continue
        e: dict[str, Any] = {"name": _text(r.get("name"), MAX["name"])}
        for k in ("w", "l"):
            v = _flt(r.get(k), 0, 200, 2)
            if v is not None:
                e[k] = v
        rooms.append(e)
    put("rooms", rooms[: MAX["rooms"]])
    put("ceiling", _flt(f.get("ceiling"), 0, 30, 2))
    put("water", _int(f.get("water"), 1, 5))
    nz = f.get("noise") if isinstance(f.get("noise"), dict) else {}
    noise: dict[str, Any] = {}
    if _int(nz.get("rating"), 1, 5) is not None:
        noise["rating"] = _int(nz.get("rating"), 1, 5)
    if _flt(nz.get("db"), 20, 140, 1) is not None:
        noise["db"] = _flt(nz.get("db"), 20, 140, 1)
    put("noise", noise)
    put("signal", _int(f.get("signal"), 0, 4))
    put("closets", _int(f.get("closets"), 0, 30))
    put("laundry", f.get("laundry") if isinstance(f.get("laundry"), str) and f.get("laundry") in LAUNDRY else None)
    given = f.get("smells") if isinstance(f.get("smells"), list) else []
    sm = [k for k in SMELLS if k in given]
    if len(sm) > 1:
        sm = [k for k in sm if k != "none"]
    put("smells", sm)
    lt = f.get("light") if isinstance(f.get("light"), dict) else {}
    light: dict[str, Any] = {}
    if _int(lt.get("rating"), 1, 5) is not None:
        light["rating"] = _int(lt.get("rating"), 1, 5)
    if _clock(lt.get("time")):
        light["time"] = lt["time"]
    if isinstance(lt.get("facing"), str) and lt["facing"] in COMPASS8:
        light["facing"] = lt["facing"]
    put("light", light)
    put("view", _text(f.get("view"), MAX["view"]))
    checks: dict[str, Any] = {}
    for key in CHECK_KEYS:
        c = (f.get("checks") or {}).get(key) if isinstance(f.get("checks"), dict) else None
        if not isinstance(c, dict) or c.get("verdict") not in VERDICTS:
            continue
        e = {"verdict": c["verdict"]}
        ov = check_value(key, c.get("observed")) if c["verdict"] == "differs" else None
        if ov is not None:
            e["observed"] = ov
        checks[key] = e
    put("checks", checks)
    put("note", _text(f.get("note"), MAX["note"]))
    seen: set[str] = set()
    photos = []
    for p in f.get("photos") if isinstance(f.get("photos"), list) else []:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or not PHOTO_ID.match(p["id"]) or p["id"] in seen or len(photos) >= MAX["photos"]:
            continue
        seen.add(p["id"])
        e = {"id": p["id"], "store": "idb" if p.get("store") == "idb" else "disk"}
        for k, v in (("w", _int(p.get("w"), 1, 20000)), ("h", _int(p.get("h"), 1, 20000)), ("bytes", _int(p.get("bytes"), 0, 10 ** 9)),
                     ("caption", _text(p.get("caption"), MAX["caption"])), ("at", _stamp(p.get("at")))):
            if v is not None:
                e[k] = v
        photos.append(e)
    put("photos", photos)
    promoted: dict[str, Any] = {}
    for key in CHECK_KEYS:
        p = (f.get("promoted") or {}).get(key) if isinstance(f.get("promoted"), dict) else None
        v = check_value(key, p.get("value")) if isinstance(p, dict) else None
        if v is None:
            continue
        e = {"value": v}
        for k, x in (("observed_at", _date(p.get("observed_at"))), ("promoted_at", _stamp(p.get("promoted_at"))), ("source", _text(p.get("source"), 120))):
            if x is not None:
                e[k] = x
        promoted[key] = e
    put("promoted", promoted)
    return out


def is_blank(f: Any) -> bool:
    n = normalize(f)
    return not any(k not in ("v", "observed", "visited_at", "updated") for k in n)


# --------------------------------------------------------------------------- the listing's claim and the renter's finding
def _bearing(c: str) -> float:
    return COMPASS16.index(c) * 22.5


def _arc(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return 360 - d if d > 180 else d


def listed_value(L: dict, key: str) -> Any:
    """What the listing says about one checked item (a normalised value), or None when it says nothing."""
    am = L.get("amenities") or {}
    if key == "wd":
        v = normalise_laundry(am.get("in_unit_wd"))
        return v if isinstance(v, bool) else None
    if key == "doorman":
        return normalise_service(am.get("doorman"))
    if key == "size":
        x = L.get("sqft")
        return x if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x > 0 else None
    if key == "exposure":
        e = [str(x).upper() for x in (L.get("exposure") if isinstance(L.get("exposure"), list) else []) if str(x).upper() in COMPASS16]
        return e or None
    return None


def _same(key: str, listed: Any, obs: Any) -> bool:
    if key == "size":
        return abs(obs - listed) / listed <= SIZE_TOLERANCE
    if key == "exposure":
        return any(_arc(_bearing(e), _bearing(obs)) <= 45 for e in listed)
    return listed == obs


def assess(L: dict, key: str, check: Any) -> dict[str, Any]:
    """How the renter's check compares with the listing: kind is matches, contradicts (the listing says otherwise), adds
    (the listing is silent), unsure or none (nothing usable was entered)."""
    listed = listed_value(L, key)
    if not isinstance(check, dict) or check.get("verdict") not in VERDICTS:
        return {"kind": "none", "listed": listed, "observed": None}
    if check["verdict"] == "unsure":
        return {"kind": "unsure", "listed": listed, "observed": None}
    if check["verdict"] == "match":
        return {"kind": "none", "listed": listed, "observed": None} if listed is None else {"kind": "matches", "listed": listed, "observed": listed}
    obs = check_value(key, check.get("observed"))
    if obs is None:
        return {"kind": "none", "listed": listed, "observed": None}
    if listed is None:
        return {"kind": "adds", "listed": listed, "observed": obs}
    return {"kind": "matches" if _same(key, listed, obs) else "contradicts", "listed": listed, "observed": obs}


def phrase(key: str, v: Any) -> str:
    """A fact in words, the same in the dashboard, the reasons and the memo."""
    if v is None:
        return "not stated"
    if key == "wd":
        return "in-unit washer/dryer" if v else "no in-unit washer/dryer"
    if key == "doorman":
        return f"doorman: {v}"
    if key == "size":
        return f"{int(_rnd(float(v), 0))} ft²"
    vs = v if isinstance(v, list) else [v]
    return "faces " + "/".join(vs)


def live_promotions(f: Any) -> dict[str, Any]:
    """The promotions that still stand: a promoted value counts only while the renter's check still says the same."""
    n = normalize(f)
    out = {}
    for key in CHECK_KEYS:
        p = (n.get("promoted") or {}).get(key)
        c = (n.get("checks") or {}).get(key)
        if p and c and c.get("verdict") == "differs" and c.get("observed") == p["value"]:
            out[key] = p["value"]
    return out


def overlay(L: dict, f: Any) -> dict:
    """The listing as scoring should see it: promoted facts applied to a copy; the original is never touched."""
    live = live_promotions(f)
    if not live:
        return L
    out = {**L, "amenities": dict(L.get("amenities") or {})}
    if "wd" in live:
        out["amenities"]["in_unit_wd"] = live["wd"]
    if "doorman" in live:
        out["amenities"]["doorman"] = live["doorman"]
    if "size" in live:
        out["sqft"] = live["size"]
        for k in ("size", "sqft_basis", "sqft_estimate", "sqft_range"):
            out.pop(k, None)
    if "exposure" in live:
        out["exposure"] = [live["exposure"]]
        out["exposure_source"] = "tour"
    return out


def claim_of(key: str, f: Any) -> dict[str, Any] | None:
    """The dated, sourced claim a promotion writes (the same shape as a listing's ``claims[]`` entries)."""
    p = (normalize(f).get("promoted") or {}).get(key)
    if not p:
        return None
    return {"field": CHECKS[key]["path"], "value": [p["value"]] if key == "exposure" else p["value"], "source": p.get("source") or SOURCE,
            "observed_at": p.get("observed_at"), "status": "live", "via": "tour"}


# --------------------------------------------------------------------------- gates, tags and reasons
def flags_for(L: dict, f: Any) -> dict[str, Any]:
    """What a visit adds to a listing's score without changing a number: ``gates`` and ``tags`` for the contradictions the
    renter has not promoted, and ``items`` (lines for the reasons, by dimension). ``L`` is the listing as published."""
    n = normalize(f)
    live = live_promotions(n)
    out: dict[str, Any] = {"gates": [], "tags": [], "items": {}, "promoted": []}
    when = n.get("observed") or "an undated visit"
    for key in CHECK_KEYS:
        a = assess(L, key, (n.get("checks") or {}).get(key))
        c = CHECKS[key]
        line = None
        if key in live:
            out["promoted"].append(key)
            said = "the listing was silent" if a["listed"] is None else "the listing said " + phrase(key, a["listed"])
            obs = a["observed"] if a["observed"] is not None else live[key]
            line = f"tour {when}: {phrase(key, obs)} observed and promoted to a fact ({said})."
        elif a["kind"] == "contradicts":
            out["gates"].append(f"contradicted:{c['field']}")
            line = f"tour {when}: {phrase(key, a['observed'])} observed, the listing says {phrase(key, a['listed'])}. Not scored until you promote it."
        elif a["kind"] == "adds":
            line = f"tour {when}: {phrase(key, a['observed'])} observed (the listing is silent). Not scored until you promote it."
        if line:
            out["items"].setdefault(c["dim"], []).append(line)
    if out["gates"]:
        out["tags"].append(TAG)
    return out


def annotate_score(score: dict, fl: dict | None) -> dict:
    """Apply a visit's gates, tag and reason lines to a score in place (earlier ones are replaced) and return it."""
    score["gates"] = [g for g in score.get("gates", []) if not g.startswith("contradicted:")] + list((fl or {}).get("gates", []))
    score["tags"] = [t for t in score.get("tags", []) if t != TAG] + list((fl or {}).get("tags", []))
    for r in score.get("reasons", []):
        items = [x for x in r.get("items", []) if not x.startswith("tour ")] + list(((fl or {}).get("items") or {}).get(r.get("dim"), []))
        if items:
            r["items"] = items
        else:
            r.pop("items", None)
    return score


# --------------------------------------------------------------------------- the memo and the share page
def share_tour(L: dict, f: Any, notes: bool = False) -> dict[str, Any] | None:
    """A visit as the shared page shows it. ``L`` is the listing as published. The free note travels only with the renter's
    notes; photos are attached by the adapter."""
    n = normalize(f)
    if is_blank(n):
        return None
    live = live_promotions(n)
    out: dict[str, Any] = {}
    for k in ("observed", "visited_at"):
        if n.get(k):
            out[k] = n[k]
    for k in ("rooms", "ceiling", "water", "noise", "signal", "closets", "laundry", "smells", "light", "view"):
        if n.get(k) is not None:
            out[k] = n[k]
    checks = []
    for key in CHECK_KEYS:
        c = (n.get("checks") or {}).get(key)
        if not c:
            continue
        a = assess(L, key, c)
        checks.append({"key": key, "label": CHECKS[key]["label"], "verdict": c["verdict"], "kind": a["kind"],
                       "listed": None if a["listed"] is None else phrase(key, a["listed"]),
                       "observed": None if (a["kind"] == "matches" and c["verdict"] == "match") or a["observed"] is None else phrase(key, a["observed"]),
                       "promoted": key in live})
    if checks:
        out["checks"] = checks
    if notes and n.get("note"):
        out["note"] = n["note"][:2000]
    return out


# --------------------------------------------------------------------------- the decision trail
KINDS = ["star", "tier", "status", "note", "tour", "promote", "unpromote"]
STATUS_LABEL = {"researching": "Researching", "shortlist": "Shortlist", "touring": "Touring", "applied": "Applied", "rejected": "Rejected"}
MAX_SHARE = 40
NOTE_EXCERPT = 200
_ENTRY_ID = re.compile(r"^[A-Za-z0-9_-]{4,40}$")


def clean_trail(raw: Any) -> list[dict[str, Any]]:
    """Entries from a picks backup: known kinds, sane strings, no duplicates, oldest first (mirrors ``clean``)."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict) or x.get("kind") not in KINDS or not isinstance(x.get("e"), str) or not _ENTRY_ID.match(x["e"]) or x["e"] in seen:
            continue
        home = _text(x.get("home"), 120)
        at = x.get("at") if isinstance(x.get("at"), str) and _STAMP.match(x["at"]) and len(x["at"]) <= 32 else None
        if not home or not at:
            continue
        seen.add(x["e"])
        e: dict[str, Any] = {"e": x["e"], "home": home, "at": at, "kind": x["kind"]}
        for k in ("from", "to"):
            v = x.get(k)
            if isinstance(v, bool):
                e[k] = v
            elif v is not None:
                s = _text(v if isinstance(v, str) else str(v), NOTE_EXCERPT if x["kind"] == "note" else 160)
                if s is not None:
                    e[k] = s
        why = _text(x.get("why"), 400)
        if why:
            e["why"] = why
        out.append(e)
    out.sort(key=lambda e: (e["at"], e["e"]))
    return out[-600:]


def _when(s: str) -> str:
    return s.replace("T", " ")[:16]


def describe(x: dict, with_notes: bool = True) -> str:
    f, t = x.get("from"), x.get("to")
    k = x["kind"]
    if k == "star":
        return "Starred" if t is True else "Removed from your picks"
    if k == "tier":
        return f"Tier {f} cleared" if t is None else f"Tier set to {t}" if f is None else f"Tier {f} to {t}"
    if k == "status":
        return f"Status: {STATUS_LABEL.get(f, 'none')} to {STATUS_LABEL.get(t, 'none')}"
    if k == "note":
        return "Note cleared" if t is None else f"Note: {t}" if with_notes else "Note edited"
    if k == "tour":
        return "Tour time cleared" if t is None else f"Tour time set to {_when(t)}"
    if k == "promote":
        return f"Promoted to a fact: {t} ({'the listing was silent' if f is None else 'the listing said ' + str(f)})"
    if k == "unpromote":
        return f"Promotion withdrawn: {t}"
    return str(k)


def trail_for_share(entries: list[dict], home: str, notes: bool = False) -> list[dict]:
    """What the share page and memo carry for one home: oldest first, at most the newest ``MAX_SHARE``; reasons and the text
    of notes only with ``notes``."""
    mine = [e for e in clean_trail(entries) if e["home"] == home][-MAX_SHARE:]
    return [{"at": e["at"], "kind": e["kind"], "text": describe(e, notes), **({"why": e["why"]} if notes and e.get("why") else {})} for e in mine]


# --------------------------------------------------------------------------- files
def tours_dir(root: Path) -> Path:
    return root / "tours"


def findings_path(root: Path, listing_id: str) -> Path:
    if not isinstance(listing_id, str) or not TOUR_ID.match(listing_id) or listing_id.endswith("."):
        raise ValueError("not a listing id")
    return tours_dir(root) / listing_id / "findings.json"


def read_findings(root: Path, listing_id: str) -> dict[str, Any] | None:
    try:
        p = findings_path(root, listing_id)
        return normalize(json.loads(p.read_text(encoding="utf-8"))) if p.is_file() else None
    except (OSError, ValueError):
        return None


def load_all(root: Path) -> dict[str, dict[str, Any]]:
    """Every saved visit in a search folder: {listing id: normalised findings}. Records that hold nothing are left out."""
    out: dict[str, dict[str, Any]] = {}
    d = tours_dir(root)
    if not d.is_dir():
        return out
    for sub in sorted(d.iterdir()):
        if sub.is_dir() and not sub.is_symlink() and TOUR_ID.match(sub.name):
            f = read_findings(root, sub.name)
            if f and not is_blank(f):
                out[sub.name] = f
    return out


def write_findings(root: Path, listing_id: str, findings: Any) -> dict[str, Any]:
    """Validate and write one home's findings atomically; returns what was written."""
    n = normalize(findings)
    p = findings_path(root, listing_id)
    base = tours_dir(root).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.parent.resolve().parent != base:
        raise ValueError("outside the tours folder")
    tmp = p.parent / f".findings.{secrets.token_hex(4)}.tmp"
    try:
        tmp.write_text(json.dumps(n, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)
    finally:
        tmp.unlink(missing_ok=True)
    return n


def newest(a: dict | None, b: dict | None) -> dict | None:
    """Of two versions of one home's findings, the one updated last (a missing stamp loses)."""
    if not a or not b:
        return a or b
    return b if (b.get("updated") or "") > (a.get("updated") or "") else a


# --------------------------------------------------------------------------- the share page
def share_extras(listings: dict[str, dict], ids: list[str], findings: dict[str, dict], trail: list[dict], *, notes: bool = False,
                 photos: bool = False, root: Path | None = None, cfg: dict | None = None) -> dict[str, dict]:
    """Per home, what the share page and memo add: the visit (its photos only with ``photos``, as embedded thumbnails inside
    the template's byte budget) and the decision trail. Mirrors ``shareExtras`` in tour-findings.js."""
    cfg = cfg or {"max_per_home": 4, "thumb_px": 560, "quality": 0.74, "budget_kb": 600}
    out: dict[str, dict] = {}
    for lid in ids:
        L, f = listings.get(lid), findings.get(lid)
        tour = share_tour(L, f, notes) if L and f else None
        if tour and photos and root is not None and TOUR_ID.match(lid):
            from .share import _thumb_data_uri
            got: list[dict] = []
            used = 0
            for p in (normalize(f).get("photos") or [])[: cfg["max_per_home"]]:
                if p.get("store") != "disk":
                    continue
                path = tours_dir(root) / lid / "photos" / f"{p['id']}.webp"
                uri = _thumb_data_uri(path, cfg["thumb_px"], cfg["quality"]) if path.is_file() else None
                if uri and used + len(uri) <= cfg["budget_kb"] * 1024:
                    used += len(uri)
                    got.append({"src": uri, **({"caption": p["caption"]} if p.get("caption") else {})})
            if got:
                tour["photos"] = got
        tr = trail_for_share(trail, lid, notes)
        if tour or tr:
            out[lid] = {**({"tour": tour} if tour else {}), **({"trail": tr} if tr else {})}
    return out
