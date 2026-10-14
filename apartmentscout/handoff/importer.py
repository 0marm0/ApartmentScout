"""`apartmentscout handoff import`: apply another agent's updates without losing anything.

Input: a pack zip (verified first; its ``updates.json`` and/or ``data/listings.json`` and research/site/plan files)
or a bare ``updates.json``. Every fact is a *claim* with a source and a ``checked_at`` date, and each one gets a
decision:

- **accepted**: fills an unknown, confirms the current value, or is newer than our last check;
- **accepted-with-conflict**: applied, and the value it replaced is kept in ``handoff/conflicts/``;
- **rejected**: not applied, with the reason (and, when the values differ, the claim kept in ``conflicts/``).

Rules (the importer hazards from earlier agent exchanges, fixed):

1. Claims are appended to the listing's ``claims`` list, never merged blindly; re-importing the same claim is a no-op.
2. ``null`` never clears a value.
3. An older (or undated) claim never replaces a newer observation, and never reactivates a ``gone`` listing. A newer
   ``still_active: true`` claim does reactivate it, as a conflict for the renter to see.
4. Workflow status (shortlist, touring, rejected...) and the search criteria are the renter's; they are never
   imported. Generated fields (score, commute, records, site) are recomputed locally, never imported.
5. Listings are matched by id, exact listing URL, normalised address + unit, or exact building name + unit, never
   by a name prefix. ``0807`` and ``807`` are the same unit.
6. Same-day disagreements on money keep the less favourable figure (higher cost, fewer free months).
7. Files are never overwritten: a differing note, site or plan from the other agent is saved under
   ``handoff/conflicts/files/``. ``--dry-run`` writes nothing at all.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from . import UPDATES_SCHEMA
from .facts import parse_date
from .verify import safe_member, verify_pack

ACCEPTED, CONFLICT, REJECTED = "accepted", "accepted-with-conflict", "rejected"
GENERATED = {"score", "commute", "records", "site", "stations", "legacy_score", "claims", "id", "bbl", "bin",
             "lat", "lon", "floor_inferred", "photos_local"}
IDENTITY = {"building", "unit", "address"}
WORKFLOW = {"status", "stage", "favorite"}
META = {"source", "checked_at", "still_active", "url", "note", "changes", "from", "generated_at"}
COST_UP = {"price.gross", "price.net_effective", "price.fees_monthly", "price.fees_one_time", "price.broker_fee",
           "price.deposit", "price.security_deposit", "price.application_fee", "price.move_in_fee"}
COST_DOWN = {"price.free_months"}
FILE_DIRS = ("data/research/", "data/sites/", "data/plans/")
FILE_EXTS = (".md", ".json")


@dataclass
class Decision:
    claim: str
    listing: str | None
    field: str | None
    value: Any
    decision: str
    reason: str
    trivial: bool = False   # confirmations and repeats: counted, hidden from the default table


@dataclass
class ImportResult:
    sender: str
    source_sha: str | None
    decisions: list[Decision] = field(default_factory=list)
    added: list[str] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    written: list[str] = field(default_factory=list)
    dry_run: bool = False

    def counts(self) -> dict[str, int]:
        out = {ACCEPTED: 0, CONFLICT: 0, REJECTED: 0}
        for d in self.decisions:
            out[d.decision] = out.get(d.decision, 0) + 1
        return out


# --------------------------------------------------------------------------- normalisation and matching
_ABBR = {"street": "st", "avenue": "ave", "av": "ave", "west": "w", "east": "e", "north": "n", "south": "s",
         "place": "pl", "boulevard": "blvd", "road": "rd", "drive": "dr", "lane": "ln", "square": "sq",
         "parkway": "pkwy", "terrace": "ter"}


def norm_unit(u: Any) -> str:
    s = re.sub(r"(?i)\b(apt|apartment|unit|no|number|suite)\b\.?", "", str(u or ""))
    s = re.sub(r"[^A-Za-z0-9]", "", s).upper()
    return s.lstrip("0") or ("0" if s else "")


def norm_addr(a: Any) -> str:
    line = str(a or "").split(",")[0].lower()
    line = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", line)
    words = [_ABBR.get(w, w) for w in re.findall(r"[a-z0-9]+", line)]
    return " ".join(words)


def norm_name(b: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(b or "").lower()))


def norm_url(u: Any) -> str:
    m = re.match(r"^(https?)://([^/?#]+)([^?#]*)", str(u or "").strip(), re.I)
    if not m:
        return ""
    host = m.group(2).lower()
    host = host[4:] if host.startswith("www.") else host
    return f"{host}{m.group(3).rstrip('/')}"


class Index:
    """Exact-key lookups over our listings. No fuzzy or prefix joins."""

    def __init__(self, listings: list[dict]) -> None:
        self.by_id: dict[str, dict] = {}
        self.keys: dict[tuple[str, str], list[dict]] = {}
        for L in listings:
            self.add(L)

    def _keys(self, rec: dict) -> list[tuple[str, str]]:
        out = []
        url = rec.get("url") or (rec.get("links") or {}).get("listing")
        if norm_url(url):
            out.append(("url", norm_url(url)))
        u = norm_unit(rec.get("unit"))
        if norm_addr(rec.get("address")) and (u or rec.get("unit") in (None, "")):
            out.append(("address+unit", f"{norm_addr(rec.get('address'))}|{u}"))
        if norm_name(rec.get("building") or rec.get("building_name")) and (u or rec.get("unit") in (None, "")):
            out.append(("name+unit", f"{norm_name(rec.get('building') or rec.get('building_name'))}|{u}"))
        return out

    def add(self, L: dict) -> None:
        self.by_id[L["id"]] = L
        for k in self._keys(L):
            self.keys.setdefault(k, [])
            if L not in self.keys[k]:
                self.keys[k].append(L)

    def match(self, rec: dict) -> tuple[dict | None, str, list[str]]:
        """(listing, method, ambiguous ids). Ambiguous matches return no listing."""
        if rec.get("id") and rec["id"] in self.by_id:
            return self.by_id[rec["id"]], "id", []
        for k in self._keys(rec):
            hits = self.keys.get(k) or []
            if len(hits) == 1:
                return hits[0], k[0], []
            if len(hits) > 1:
                return None, k[0], [h["id"] for h in hits]
        return None, "absent", []

    def duplicates(self) -> list[list[str]]:
        """Groups of different ids that share an address+unit key (for example unit 0807 stored twice as 807)."""
        return sorted(sorted(h["id"] for h in hs) for (kind, _), hs in self.keys.items()
                      if kind == "address+unit" and len(hs) > 1)


def _get(L: dict, path: str) -> Any:
    cur: Any = L
    for p in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _set(L: dict, path: str, value: Any) -> None:
    parts = path.split(".")
    cur = L
    for p in parts[:-1]:
        if not isinstance(cur.get(p), dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def _norm_value(path: str, v: Any) -> tuple[Any, bool]:
    """(normalised value, readable). Numbers parse like the CSV importer; amenities are yes/no/unknown."""
    from ..listings import _num, _tri, parse_doorman
    if v is None:
        return None, True
    if path.startswith("price.") or path in ("sqft", "beds", "baths", "floor"):
        n = _num(v)
        return n, n is not None
    if path == "amenities.doorman":
        d = parse_doorman(v)
        return d, d is not None
    if path.startswith("amenities."):
        t = _tri(v)
        return t, t is not None
    if path == "exposure":
        items = v if isinstance(v, list) else re.split(r"[,/ ]+", str(v))
        ex = [str(e).strip().upper() for e in items if str(e).strip()]
        return ex, bool(ex)
    return v, True


def _flatten(d: dict, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict) and v:
            out.update(_flatten(v, key + "."))
        else:
            out[key] = v
    return out


def _fp(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _short(v: Any, n: int = 40) -> str:
    t = json.dumps(v, ensure_ascii=False, default=str)
    return t if len(t) <= n else t[: n - 3] + "..."


def rec_fp(sender: str, rec: dict) -> str:
    """Fingerprint of one incoming record, so importing the same claim twice is a no-op."""
    return _fp(sender, {k: v for k, v in rec.items() if not k.startswith("_")}, rec.get("_record"))


def _src(rec: dict) -> str | None:
    s = rec.get("source") or rec.get("url")
    return str(s).strip() if s and str(s).strip() else None


# --------------------------------------------------------------------------- loading
def read_input(path: Path) -> tuple[dict, dict[str, bytes], str | None, list[dict]]:
    """(updates, files from the pack, zip sha256, listings from the pack). Verifies packs first."""
    path = Path(path)
    if zipfile.is_zipfile(path):
        v = verify_pack(path)
        if not v.ok:
            raise SystemExit("Pack failed verification; nothing imported:\n  " + "\n  ".join(v.problems))
        files: dict[str, bytes] = {}
        updates: dict = {}
        listings: list[dict] = []
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if not safe_member(n):
                    continue
                if n == "updates.json":
                    updates = json.loads(z.read(n))
                elif n == "data/listings.json":
                    listings = json.loads(z.read(n))
                elif n.startswith(FILE_DIRS) and n.endswith(FILE_EXTS) or n == "data/criteria.yaml":
                    files[n] = z.read(n)
        updates.setdefault("from", (v.manifest or {}).get("from") or "agent")
        return updates, files, v.sha256, listings if isinstance(listings, list) else []
    data = json.loads(path.read_text(encoding="utf-8"))
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if isinstance(data, list):   # a bare list of listings
        return {"from": "agent"}, {}, sha, data
    return data, {}, sha, []


def validate_updates(u: dict) -> list[str]:
    problems = []
    if u.get("schema") not in (None, UPDATES_SCHEMA):
        problems.append(f"unknown updates schema {u.get('schema')!r}; reading it as {UPDATES_SCHEMA}")
    for key in ("unit_updates", "new_units", "building_notes", "reviews"):
        if key in u and not isinstance(u[key], list):
            problems.append(f"{key} should be a list; ignored")
            u[key] = []
        for i, rec in enumerate(u.get(key) or []):
            if not isinstance(rec, dict):
                problems.append(f"{key}[{i}] is not an object; ignored")
            elif rec.get("checked_at") and not parse_date(rec.get("checked_at")):
                problems.append(f"{key}[{i}].checked_at {rec.get('checked_at')!r} is not a date; treated as undated")
    for key in ("unit_updates", "new_units", "building_notes", "reviews"):
        u[key] = [r for r in u.get(key) or [] if isinstance(r, dict)]
    return problems


def listing_as_update(L: dict, sender: str) -> dict:
    """Turn a listing from the other agent's pack into a unit update (a bundle of claims)."""
    changes = {k: v for k, v in _flatten({k: v for k, v in L.items()
                                         if k not in GENERATED | IDENTITY | WORKFLOW | {"checked", "sources"}}).items()
               if v not in (None, "", [], {})}
    srcs = [s if isinstance(s, str) else (s or {}).get("url") for s in L.get("sources") or []]
    return {"id": L.get("id"), "building": L.get("building"), "unit": L.get("unit"), "address": L.get("address"),
            "url": (L.get("links") or {}).get("listing"),
            "still_active": False if L.get("status") == "gone" else None,
            "checked_at": L.get("checked"),
            "source": (L.get("links") or {}).get("listing") or next((s for s in srcs if s), None)
            or f"handoff pack from {sender}",
            "changes": changes, "_record": L}


# --------------------------------------------------------------------------- the importer
class Importer:
    def __init__(self, root: Path, sender: str, sha: str | None, today: dt.date | None = None) -> None:
        from ..listings import load
        self.root = root
        self.today = today or dt.date.today()
        self.listings = load(root / "listings.json") if (root / "listings.json").exists() else []
        self.index = Index(self.listings)
        self.res = ImportResult(sender=sender, source_sha=sha)
        self.conflicts: list[dict] = []
        self.notes: dict[str, list[str]] = {}
        self.files_out: dict[str, bytes] = {}
        self.changed: set[str] = set()
        self.history_claims: list[dict] = []   # for <search>/history/claims.jsonl (the research pipeline's log)

    # -- helpers
    def decide(self, claim: str, L: dict | None, fld: str | None, value: Any, decision: str, reason: str,
               trivial: bool = False) -> str:
        self.res.decisions.append(Decision(claim, L["id"] if L else None, fld, value, decision, reason, trivial))
        return decision

    def keep_conflict(self, L: dict, fld: str, ours: Any, theirs: Any, meta: dict, decision: str, reason: str) -> None:
        self.conflicts.append({"listing": L["id"], "field": fld, "ours": ours, "theirs": theirs,
                               "ours_checked": L.get("checked"), "their_checked": meta.get("checked_at"),
                               "source": meta.get("source"), "from": self.res.sender, "decision": decision,
                               "reason": reason, "imported": self.today.isoformat()})

    # -- one field
    def field(self, claim: str, L: dict, path: str, raw: Any, meta: dict) -> str | None:
        root_key = path.split(".")[0]
        ours = _get(L, path)
        if root_key in GENERATED:
            return self.decide(claim, L, path, raw, REJECTED, "computed locally (rerun the CLI), not imported")
        if root_key in WORKFLOW:
            if root_key == "status" and raw == "gone":
                return self.status(claim, L, False, meta)
            return self.decide(claim, L, path, raw, REJECTED, "workflow status is the renter's decision")
        if raw is None:
            if ours is None:
                return None
            return self.decide(claim, L, path, raw, REJECTED, "null never clears a value")
        new, readable = _norm_value(path, raw)
        if not readable:
            return self.decide(claim, L, path, raw, REJECTED, f"unreadable value for {path}")
        if root_key in IDENTITY:
            if ours in (None, ""):
                _set(L, path, new)
                return self.decide(claim, L, path, new, ACCEPTED, "fills an unknown")
            same = {"unit": norm_unit, "address": norm_addr, "building": norm_name}[root_key]
            if same(ours) == same(new):
                return self.decide(claim, L, path, new, ACCEPTED, "confirms the current value", trivial=True)
            return self.decide(claim, L, path, new, REJECTED, "identity fields are not changed by import; fix by hand")
        if path == "notes":
            text = str(new).strip()
            if text and text in str(ours or ""):
                return self.decide(claim, L, path, text, ACCEPTED, "already in notes", trivial=True)
            stamp = f"[{self.res.sender}, {meta.get('checked_at') or 'undated'}] {text}"
            L["notes"] = f"{ours}\n{stamp}" if ours else stamp
            return self.decide(claim, L, path, text, ACCEPTED, "appended to notes")
        if path == "sources":
            have = list(L.get("sources") or [])
            add = [s for s in (new if isinstance(new, list) else [new]) if s not in have]
            if not add:
                return self.decide(claim, L, path, new, ACCEPTED, "sources already listed", trivial=True)
            L["sources"] = have + add
            return self.decide(claim, L, path, add, ACCEPTED, f"added {len(add)} source(s)")
        if path == "building_photos" and isinstance(ours, list):   # packs drop private `local` copies
            ours = [{k: v for k, v in p.items() if k != "local"} if isinstance(p, dict) else p for p in ours]
            if ours == new:
                return self.decide(claim, L, path, None, ACCEPTED, "confirms the current photos", trivial=True)
        if ours in (None, "", [], {}):
            _set(L, path, new)
            return self.decide(claim, L, path, new, ACCEPTED, "fills an unknown")
        if ours == new or (isinstance(ours, (int, float)) and isinstance(new, (int, float)) and
                           abs(float(ours) - float(new)) < 1e-9):
            return self.decide(claim, L, path, new, ACCEPTED, "confirms the current value", trivial=True)
        theirs_d, ours_d = parse_date(meta.get("checked_at")), parse_date(L.get("checked"))
        if theirs_d is None:
            reason = "undated claim cannot replace a known value"
            self.keep_conflict(L, path, ours, new, meta, REJECTED, reason)
            return self.decide(claim, L, path, new, REJECTED, reason)
        if ours_d is None or theirs_d > ours_d:
            reason = f"newer than our check ({ours_d or 'undated'}); replaced {_short(ours)}, kept in conflicts/"
            self.keep_conflict(L, path, ours, new, meta, CONFLICT, reason)
            _set(L, path, new)
            return self.decide(claim, L, path, new, CONFLICT, reason)
        if theirs_d == ours_d and (path in COST_UP or path in COST_DOWN) and \
                isinstance(ours, (int, float)) and isinstance(new, (int, float)):
            worse = new > ours if path in COST_UP else new < ours
            if worse:
                reason = f"same-day disagreement: kept the less favourable figure (was {_short(ours)})"
                self.keep_conflict(L, path, ours, new, meta, CONFLICT, reason)
                _set(L, path, new)
                return self.decide(claim, L, path, new, CONFLICT, reason)
            reason = f"same-day disagreement: ours ({_short(ours)}) is the less favourable figure"
            self.keep_conflict(L, path, ours, new, meta, REJECTED, reason)
            return self.decide(claim, L, path, new, REJECTED, reason)
        reason = f"not newer than our check ({ours_d}); kept {_short(ours)}"
        self.keep_conflict(L, path, ours, new, meta, REJECTED, reason)
        return self.decide(claim, L, path, new, REJECTED, reason)

    # -- availability
    def status(self, claim: str, L: dict, active: bool, meta: dict) -> str:
        st = L.get("status") or "new"
        theirs_d, ours_d = parse_date(meta.get("checked_at")), parse_date(L.get("checked"))
        newer = theirs_d is not None and (ours_d is None or theirs_d > ours_d)
        if st == "rejected":
            return self.decide(claim, L, "status", "active" if active else "gone", ACCEPTED,
                               "noted; the renter rejected this listing, status unchanged", trivial=True)
        if active:
            if st != "gone":
                return self.decide(claim, L, "status", "active", ACCEPTED, "confirms still active", trivial=True)
            if not newer:
                reason = "an older or undated claim cannot reactivate a gone listing"
                self.keep_conflict(L, "status", st, "active", meta, REJECTED, reason)
                return self.decide(claim, L, "status", "active", REJECTED, reason)
            reason = f"back on the market per a claim newer than our check ({ours_d}); set to researching"
            self.keep_conflict(L, "status", st, "active", meta, CONFLICT, reason)
            L["status"] = "researching"
            return self.decide(claim, L, "status", "active", CONFLICT, reason)
        if st == "gone":
            return self.decide(claim, L, "status", "gone", ACCEPTED, "confirms gone", trivial=True)
        if theirs_d is None:
            return self.decide(claim, L, "status", "gone", REJECTED, "undated claim cannot mark a listing gone")
        if ours_d is not None and theirs_d < ours_d:
            reason = f"older than our check ({ours_d}) that saw it active"
            self.keep_conflict(L, "status", st, "gone", meta, REJECTED, reason)
            return self.decide(claim, L, "status", "gone", REJECTED, reason)
        L["status"] = "gone"
        return self.decide(claim, L, "status", "gone", ACCEPTED, f"marked gone (was {st})")

    def log_history(self, lid: str, active: Any, changes: dict, meta: dict) -> None:
        """Mirror the claim into the append-only history log, so availability and Gone fast see it."""
        try:
            from ..quality.history import CLAIM_FIELDS, make_claim
        except ImportError:
            return
        items = [("status", "active" if active else "gone")] if active is not None else []
        items += [(k.replace("price.", "").replace("net_effective", "net"), v) for k, v in changes.items()
                  if v is not None and k.replace("price.", "").replace("net_effective", "net") in CLAIM_FIELDS]
        for f, v in items:
            try:
                self.history_claims.append(make_claim(
                    lid, f, v, source=meta.get("source"), source_kind="partner", claimed_at=meta.get("checked_at"),
                    received_at=self.today, method="handoff-import", note=f"from {self.res.sender}"))
            except (ValueError, TypeError):
                continue

    # -- one unit update
    def unit_update(self, cid: str, rec: dict, L: dict, method: str, fp: str | None = None) -> None:
        meta = {"checked_at": rec.get("checked_at"), "source": _src(rec)}
        fp = fp or rec_fp(self.res.sender, rec)
        if any(c.get("fp") == fp for c in L.get("claims") or [] if isinstance(c, dict)):
            self.decide(cid, L, None, None, ACCEPTED, "already imported (same claim)", trivial=True)
            return
        decisions: dict[str, str] = {}
        first = len(self.res.decisions)
        before = json.dumps(L, sort_keys=True, default=str)
        if rec.get("still_active") is not None:
            decisions["status"] = self.status(f"{cid}:status", L, bool(rec["still_active"]), meta)
        for path, raw in sorted((rec.get("changes") or {}).items()):
            d = self.field(f"{cid}:{path}", L, path, raw, meta)
            if d:
                decisions[path] = d
        if rec.get("note"):
            decisions["notes"] = self.field(f"{cid}:notes", L, "notes", rec["note"], meta) or ACCEPTED
        if not decisions:
            return
        mine = self.res.decisions[first:]
        applied = any(d.decision != REJECTED and not d.trivial for d in mine)
        theirs_d, ours_d = parse_date(meta["checked_at"]), parse_date(L.get("checked"))
        newer = bool(theirs_d and (ours_d is None or theirs_d > ours_d))
        if all(d.trivial for d in mine) and not newer:
            return   # pure confirmation of what we already have: nothing to record
        if applied and meta["source"] and meta["source"].startswith(("http://", "https://")):
            if meta["source"] not in (L.get("sources") or []):
                L["sources"] = list(L.get("sources") or []) + [meta["source"]]
        if applied and newer and theirs_d:
            L["checked"] = theirs_d.isoformat()
        changes = {k: v for k, v in (rec.get("changes") or {}).items()}
        claim = {"fp": fp, "from": self.res.sender, "source": meta["source"], "source_kind": "agent-handoff",
                 "checked": meta["checked_at"], "active": rec.get("still_active"), "changes": changes,
                 "decisions": decisions, "matched_by": method, "imported": self.today.isoformat(),
                 "pack": (self.res.source_sha or "")[:12] or None}
        for k, ck in (("price.gross", "gross"), ("price.net_effective", "net"), ("sqft", "sqft"),
                      ("available", "available")):
            if k in changes:
                claim[ck] = changes[k]
        L.setdefault("claims", []).append(claim)
        self.log_history(L["id"], rec.get("still_active"), changes, meta)
        if json.dumps(L, sort_keys=True, default=str) != before:
            self.changed.add(L["id"])

    def new_unit(self, cid: str, rec: dict) -> None:
        from ..listings import normalize
        if not _src(rec):
            self.decide(cid, None, None, rec.get("building") or rec.get("address"), REJECTED, "no source")
            return
        fp = rec_fp(self.res.sender, rec)
        body = {k: v for k, v in (rec.get("_record") or rec).items() if k not in GENERATED | META | WORKFLOW}
        L, method, amb = self.index.match({**body, "url": rec.get("url"), "id": rec.get("id")})
        if amb:
            self.decide(cid, None, None, rec.get("unit"), REJECTED, f"ambiguous match by {method}: {', '.join(amb)}")
            return
        if L is not None:
            changes = {k: v for k, v in _flatten({k: v for k, v in body.items() if k not in IDENTITY}).items()}
            self.unit_update(cid, {**rec, "changes": changes}, L, method, fp=fp)
            return
        if not (body.get("building") or body.get("address")):
            self.decide(cid, None, None, None, REJECTED, "a new unit needs a building or an address")
            return
        raw = {k: v for k, v in body.items() if v not in (None, "", [], {})}
        if rec.get("url"):
            raw["url"] = rec["url"]
        N = normalize(raw)
        if N["id"] in self.index.by_id:
            N["id"] = f"{N['id']}-{_fp(rec)[:4]}"
        N["status"] = "gone" if rec.get("still_active") is False else "new"
        if parse_date(rec.get("checked_at")):
            N["checked"] = parse_date(rec.get("checked_at")).isoformat()
        src = _src(rec)
        if src and src.startswith(("http://", "https://")):
            N["sources"] = list(N.get("sources") or []) + ([src] if src not in (N.get("sources") or []) else [])
        N["claims"] = [{"fp": fp,
                        "from": self.res.sender, "source": src, "source_kind": "agent-handoff",
                        "checked": rec.get("checked_at"), "active": rec.get("still_active"), "changes": raw,
                        "decisions": {"listing": ACCEPTED}, "matched_by": "absent", "imported": self.today.isoformat(),
                        "pack": (self.res.source_sha or "")[:12] or None}]
        self.listings.append(N)
        self.index.add(N)
        self.log_history(N["id"], rec.get("still_active"), _flatten(raw), {"source": src,
                                                                         "checked_at": rec.get("checked_at")})
        self.res.added.append(N["id"])
        self.decide(cid, N, None, f"{N.get('building')} {N.get('unit')}".strip(), ACCEPTED, "new listing")

    def building_note(self, cid: str, rec: dict) -> None:
        from ..listings import slugify
        text = str(rec.get("note") or "").strip()
        who = rec.get("building") or rec.get("address")
        if not text or not who:
            self.decide(cid, None, "note", text or None, REJECTED, "needs a note and a building or address")
            return
        if not _src(rec):
            self.decide(cid, None, "note", text, REJECTED, "no source")
            return
        rel = f"research/{slugify(who)}-handoff-notes.md"
        existing = (self.root / rel).read_text(encoding="utf-8") if (self.root / rel).exists() else ""
        if text in existing or text in "\n".join(self.notes.get(rel, [])):
            self.decide(cid, None, rel, text, ACCEPTED, "note already recorded", trivial=True)
            return
        self.notes.setdefault(rel, []).append(
            f"## {rec.get('checked_at') or 'undated'} from {self.res.sender}\n\n{text}\n\nSource: {_src(rec)}\n")
        self.decide(cid, None, rel, text[:60], ACCEPTED, f"appended to {rel}")

    def review(self, cid: str, rec: dict) -> None:
        if not rec.get("label") or not rec.get("value"):
            self.decide(cid, None, "reviews", None, REJECTED, "a review needs a label and a value")
            return
        targets = [L for L in self.listings
                   if (rec.get("building") and norm_name(L.get("building")) == norm_name(rec.get("building")))
                   or (rec.get("address") and norm_addr(L.get("address")) == norm_addr(rec.get("address")))]
        if not targets:
            self.decide(cid, None, "reviews", rec.get("label"), REJECTED, "no listing in this building")
            return
        entry = {k: rec[k] for k in ("label", "value", "url") if rec.get(k)}
        if rec.get("checked_at"):
            entry["checked"] = rec["checked_at"]
        for L in targets:
            rv = L.setdefault("reviews", {})
            ratings = rv.setdefault("ratings", [])
            same = [r for r in ratings if isinstance(r, dict) and r.get("label") == rec["label"]]
            if any(r.get("value") == rec["value"] for r in same):
                self.decide(cid, L, "reviews.ratings", rec["value"], ACCEPTED, "confirms the current rating",
                            trivial=True)
                continue
            if same and not parse_date(rec.get("checked_at")):
                reason = "undated rating cannot replace a known one"
                self.keep_conflict(L, "reviews.ratings", same[0], entry, rec, REJECTED, reason)
                self.decide(cid, L, "reviews.ratings", rec["value"], REJECTED, reason)
                continue
            if same:
                reason = f"replaced {same[0].get('value')!r}; kept in conflicts/"
                self.keep_conflict(L, "reviews.ratings", same[0], entry, rec, CONFLICT, reason)
                ratings[ratings.index(same[0])] = entry
                self.decide(cid, L, "reviews.ratings", rec["value"], CONFLICT, reason)
            else:
                ratings.append(entry)
                self.decide(cid, L, "reviews.ratings", rec["value"], ACCEPTED, "added rating")
            self.changed.add(L["id"])

    def pack_file(self, name: str, data: bytes) -> None:
        rel = name[len("data/"):]
        if not safe_member(rel) or PurePosixPath(rel).name.startswith("."):
            self.decide(f"file:{name}", None, rel, None, REJECTED, "unsafe file name")
            return
        target = self.root / rel
        if name == "data/criteria.yaml":
            if target.exists() and target.read_bytes() == data:
                return
            self.files_out[f"handoff/conflicts/files/{rel}"] = data
            self.decide(f"file:{name}", None, rel, None, REJECTED,
                        "criteria are the renter's; theirs saved to handoff/conflicts/files/ to compare by hand")
            return
        if not target.exists():
            self.files_out[rel] = data
            self.decide(f"file:{name}", None, rel, None, ACCEPTED, "new file")
        elif target.read_bytes() == data:
            self.decide(f"file:{name}", None, rel, None, ACCEPTED, "identical file", trivial=True)
        else:
            self.files_out[f"handoff/conflicts/files/{rel}"] = data
            self.decide(f"file:{name}", None, rel, None, REJECTED,
                        "differs from ours; kept ours, theirs saved to handoff/conflicts/files/")


def import_updates(root: Path, source: Path, dry_run: bool = False, today: dt.date | None = None) -> ImportResult:
    """Adjudicate and (unless dry_run) apply an updates.json or a pack to the search at ``root``."""
    root = Path(root)
    updates, files, sha, pack_listings = read_input(Path(source))
    sender = str(updates.get("from") or "agent")
    imp = Importer(root, sender, sha, today)
    imp.res.dry_run = dry_run
    imp.res.warnings += validate_updates(updates)
    dups = imp.index.duplicates()
    if dups:
        imp.res.warnings.append("possible duplicates already in your listings (same address and unit): "
                                + "; ".join(" = ".join(g) for g in dups[:10]))

    for i, rec in enumerate(updates.get("unit_updates") or [], 1):
        cid = f"u{i}"
        L, method, amb = imp.index.match(rec)
        if amb:
            imp.decide(cid, None, None, rec.get("unit"), REJECTED, f"ambiguous match by {method}: {', '.join(amb)}")
        elif L is None:
            imp.decide(cid, None, None, rec.get("id") or rec.get("unit"), REJECTED,
                       "no matching listing (send it as a new unit with a source)")
        elif not _src(rec):
            imp.decide(cid, L, None, None, REJECTED, "no source")
        else:
            imp.unit_update(cid, rec, L, method)
    for i, rec in enumerate(updates.get("new_units") or [], 1):
        imp.new_unit(f"n{i}", rec)
    for i, L in enumerate(pack_listings, 1):
        if isinstance(L, dict):
            rec = listing_as_update(L, sender)
            M, method, amb = imp.index.match(rec)
            if M is not None:
                imp.unit_update(f"p{i}", rec, M, method)
            elif amb:
                imp.decide(f"p{i}", None, None, L.get("id"), REJECTED, f"ambiguous match by {method}: {', '.join(amb)}")
            else:
                imp.new_unit(f"p{i}", rec)
    for i, rec in enumerate(updates.get("building_notes") or [], 1):
        imp.building_note(f"b{i}", rec)
    for i, rec in enumerate(updates.get("reviews") or [], 1):
        imp.review(f"r{i}", rec)
    for name, data in sorted(files.items()):
        imp.pack_file(name, data)
    imp.res.changed = sorted(imp.changed - set(imp.res.added))

    if not dry_run:
        _write(imp)
    return imp.res


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _write(imp: Importer) -> None:
    res, root = imp.res, imp.root
    stamp = f"{imp.today.isoformat()}-{re.sub(r'[^a-z0-9]+', '-', res.sender.lower()).strip('-') or 'agent'}" \
            f"-{(res.source_sha or 'x')[:8]}"
    if res.added or res.changed:
        _atomic_write(root / "listings.json",
                      (json.dumps(imp.listings, indent=1, ensure_ascii=False) + "\n").encode())
        res.written.append("listings.json")
    for c in imp.conflicts:
        rel = f"handoff/conflicts/{c['listing']}--{c['field'].replace('.', '_')}--{_fp(c)[:8]}.json"
        _atomic_write(root / rel, (json.dumps(c, indent=1, ensure_ascii=False, default=str) + "\n").encode())
        res.written.append(rel)
    if imp.history_claims:
        try:
            from ..quality.history import append_claim
            for c in imp.history_claims:
                append_claim(root, c)
            res.written.append(f"history/claims.jsonl (+{len(imp.history_claims)})")
        except ImportError:
            pass
    for rel, chunks in imp.notes.items():
        p = root / rel
        head = "" if p.exists() else "# Notes from other agents\n\nClaims, not findings. Each has a source.\n\n"
        with p.open("a", encoding="utf-8") as f:
            f.write(head + "\n".join(chunks))
        res.written.append(rel)
    for rel, data in imp.files_out.items():
        _atomic_write(root / rel, data)
        res.written.append(rel)
    report = {"from": res.sender, "source_sha256": res.source_sha, "imported": imp.today.isoformat(),
              "counts": res.counts(), "added": res.added, "changed": res.changed, "warnings": res.warnings,
              "decisions": [asdict(d) for d in res.decisions]}
    rel = f"handoff/adjudications/{stamp}.json"
    _atomic_write(root / rel, (json.dumps(report, indent=1, ensure_ascii=False, default=str) + "\n").encode())
    _atomic_write(root / f"handoff/adjudications/{stamp}.md", adjudication_table(res, all_rows=True).encode())
    res.written += [rel, f"handoff/adjudications/{stamp}.md"]


def adjudication_table(res: ImportResult, all_rows: bool = False, width: int = 60) -> str:
    """Markdown table of decisions. Confirmations and repeats are summarised unless all_rows."""
    rows = [d for d in res.decisions if all_rows or not d.trivial]
    c = res.counts()
    trivial = sum(d.trivial for d in res.decisions)
    out = [f"# Adjudication: updates from {res.sender}" + (" (dry run, nothing written)" if res.dry_run else ""), "",
           f"{c[ACCEPTED]} accepted, {c[CONFLICT]} accepted with conflict, {c[REJECTED]} rejected"
           f"; {len(res.added)} new listings, {len(res.changed)} listings changed"
           + (f"; {trivial} confirmations not shown" if trivial and not all_rows else ""), ""]
    if rows:
        out += ["| claim | listing | field | value | decision | reason |", "|---|---|---|---|---|---|"]
        for d in rows:
            v = json.dumps(d.value, ensure_ascii=False, default=str) if d.value is not None else ""
            v = v if len(v) <= 40 else v[:37] + "..."
            cells = [d.claim, d.listing or "", d.field or "", v, d.decision, d.reason[:width * 2]]
            out.append("| " + " | ".join(str(x).replace("|", "\\|").replace("\n", " ") for x in cells) + " |")
    for w in res.warnings:
        out.append(f"\nWarning: {w}")
    return "\n".join(out) + "\n"
