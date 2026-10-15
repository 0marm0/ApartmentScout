"""Floor plan files in a search folder: checking one, saving one, and listing which homes have one. [onboarding]

A plan is `plans/<listing-id>.json` (schema in docs/guides/floor-plans.md). The dashboard's tracer writes the same JSON
(`Download plan JSON`, or `Save to the search folder` when the page is served by `apartmentscout serve`), an agent writes it
by the floor-plan-model skill, and `apartmentscout plans add FILE` copies a finished file in after checking it. The checks
here are the structural ones (a plan the studio would refuse, or place nowhere); the studio's own `normalisePlan` stays the
authority on the geometry.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
MAX_BYTES = 200 * 1024
UNITS = ("ft", "m", "in")
ROOM_KINDS = ("living", "bedroom", "kitchen", "dining", "bath", "hall", "closet", "office", "outdoor", "other")


class PlanError(ValueError):
    """The plan cannot be saved; the message says why."""


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _point(p: Any) -> bool:
    return isinstance(p, (list, tuple)) and len(p) == 2 and all(_num(x) for x in p)


def _segment(o: Any) -> bool:
    return isinstance(o, dict) and ((all(_num(o.get(k)) for k in ("x1", "y1", "x2", "y2"))) or (_point(o.get("a")) and _point(o.get("b"))))


def check_plan(doc: Any) -> tuple[list[str], list[str]]:
    """(errors, warnings) for a plan mapping. Errors mean the studio would not open it."""
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(doc, dict):
        return ["The plan must be a JSON object."], warnings
    pid = doc.get("id")
    if not isinstance(pid, str) or not ID.match(pid):
        errors.append("id: use letters, digits, - and _ (up to 80), ideally the listing's id so the studio and Unit 3D attach it.")
    if doc.get("schema") not in (None, 1, 2):
        errors.append(f"schema: {doc.get('schema')!r} is not one this version reads (use 2).")
    if doc.get("units", "ft") not in UNITS:
        errors.append(f"units: {doc.get('units')!r}; use ft, m or in.")
    rooms = doc.get("rooms")
    if not isinstance(rooms, list) or not rooms:
        errors.append("rooms: a plan needs at least one room.")
        rooms = []
    usable = 0
    for i, r in enumerate(rooms, 1):
        if not isinstance(r, dict):
            errors.append(f"rooms[{i}]: must be an object.")
            continue
        poly = r.get("poly")
        if isinstance(poly, list) and len(poly) >= 3 and all(_point(p) for p in poly):
            usable += 1
        elif all(_num(r.get(k)) for k in ("x", "y", "w", "h")) and r["w"] > 0 and r["h"] > 0:
            usable += 1
        else:
            warnings.append(f"rooms[{i}] ({r.get('name') or 'unnamed'}) has no usable rectangle or polygon and will be skipped.")
        if r.get("kind") not in (None, *ROOM_KINDS):
            warnings.append(f"rooms[{i}]: kind {r.get('kind')!r} is not one of {', '.join(ROOM_KINDS)}; it is treated as other.")
    if rooms and not usable:
        errors.append("rooms: none has a usable rectangle (x, y, w, h) or polygon (poly).")
    for key in ("windows", "doors", "open_walls"):
        v = doc.get(key)
        if v is None:
            continue
        if not isinstance(v, list):
            errors.append(f"{key}: must be a list.")
        else:
            bad = sum(1 for o in v if not _segment(o))
            if bad:
                warnings.append(f"{key}: {bad} entr{'ies have' if bad != 1 else 'y has'} no x1,y1,x2,y2 (or a, b) and will be skipped.")
    if doc.get("finishes") is not None:   # [finishes] the plan's floor, paint, kitchen and window frames, each with its basis
        from .finishes import finishes_error
        e = finishes_error(doc["finishes"])
        if e:
            errors.append(e)
    ub = doc.get("up_bearing")
    if ub is not None and not (_num(ub) and 0 <= ub < 360.0001):
        errors.append("up_bearing: a compass bearing from 0 to 360 for the top of the drawing, or leave it out.")
    if ub is None:
        warnings.append("up_bearing is not set, so window bearings and the sun cannot be placed; add the compass bearing the top of the drawing faces.")
    if not doc.get("windows"):
        warnings.append("No windows: the sun and the view have nothing to come through.")
    if len(json.dumps(doc)) > MAX_BYTES:
        errors.append(f"The plan is larger than {MAX_BYTES // 1024} KB.")
    return errors, warnings


def plan_path(root: Path, plan_id: str) -> Path:
    if not isinstance(plan_id, str) or not ID.match(plan_id):
        raise PlanError("The plan id must use letters, digits, - and _ only.")
    return root / "plans" / f"{plan_id}.json"


def save_plan(root: Path, doc: Any, overwrite: bool = False) -> dict[str, Any]:
    """Validate `doc` and write it to <root>/plans/<id>.json. Raises PlanError (message for the renter); returns
    {"path", "created", "warnings"}. An existing plan is only replaced with `overwrite`, and the old file is kept as
    <id>.json.bak once."""
    errors, warnings = check_plan(doc)
    if errors:
        raise PlanError("; ".join(errors))
    target = plan_path(root, doc["id"])
    plans = root / "plans"
    if plans.is_symlink() or (target.exists() and target.is_symlink()):
        raise PlanError("The plans folder or the file is a symbolic link; refusing to write through it.")
    if target.exists() and not overwrite:
        raise PlanError(f"plans/{doc['id']}.json already exists. Use a different plan id, or replace it on purpose.")
    plans.mkdir(exist_ok=True)
    created = not target.exists()
    if not created:
        target.with_suffix(".json.bak").write_bytes(target.read_bytes())
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)
    return {"path": f"plans/{doc['id']}.json", "created": created, "warnings": warnings}


def plan_ids(root: Path) -> list[str]:
    d = root / "plans"
    return sorted(p.stem for p in d.glob("*.json")) if d.is_dir() else []


def plan_title(root: Path, plan_id: str) -> str:
    try:
        return str(json.loads(plan_path(root, plan_id).read_text(encoding="utf-8")).get("title") or "")
    except (OSError, ValueError, PlanError):
        return ""
