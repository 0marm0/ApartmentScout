"""Window views matched to listing photos: the record Unit 3D saves, its checks, and where it lives. [photo match]

In the dashboard's Window camera, *Match a photo* lines a listing photo up with the 3D model: the renter marks landmarks in the photo,
names them from the site file or clicks them in the 3D view, and a small solver (dashboard/js/unit/view-solver.js) works out which way
the photo looks, its tilt, its lens and the height the camera stood at, with a residual. The result is one JSON record
(``apartmentscout-view-calibration``, schema 1, written by dashboard/js/unit/view-calibration.js):

    site         the listing / site id
    photo        {n, path, title, scope, floor, aspect, source}   the photo's place in the gallery and the floor it was taken on
    eye          {x, y, z}                                         the window point (site metres) and the eye height the fit started from
    landmarks    [{name, kind, x, y, z, u, v}]                     world points (site metres) and where they were clicked in the photo
    result       {bearing_deg, tilt_deg, vfov_deg, hfov_deg, eye_height_m, eye_determined, lens_determined, sigma, rms_deg, max_deg, n, dof, quality}
    applied      {az_deg, floor, facade_offset_deg}                what the unit took from it

`apartmentscout serve` saves it into ``<search>/view-calibrations/<id>.json`` (``build`` copies the folder to the page); any other page keeps it
in the browser and offers *Export*. ``apartmentscout viewcal import FILE`` takes an exported file into a search folder, and
``apartmentscout site <id>`` then uses it: the photo's bearing as the window's facing and, when the photo could fix it, the camera height as
a measured eye height (kept beside the floor-count estimate in the site file's ``calibration`` block).

The checks mirror ``normaliseViewCal`` in the dashboard: a record with a missing or out-of-range number is refused as a whole.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

KIND = "apartmentscout-view-calibration"
SCHEMA = 1
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
MAX_BYTES = 200 * 1024
FOLDER = "view-calibrations"
EYE_M = 1.6   # window eye level above the slab, the same constant as geo/anchor.py


class ViewCalError(ValueError):
    """The record cannot be saved or used; the message says why."""


def _num(v: Any, lo: float, hi: float) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi else None


def _text(v: Any, n: int = 200) -> str:
    return re.sub(r"[<>\x00-\x1f]", " ", str(v if v is not None else "")).strip()[:n]


def check(doc: Any) -> dict[str, Any]:
    """The record, cleaned (text fields stripped of markup), or ``ViewCalError``."""
    if not isinstance(doc, dict) or doc.get("kind") != KIND:
        raise ViewCalError(f"This is not an ApartmentScout view calibration (kind must be {KIND!r}).")
    if doc.get("schema") != SCHEMA:
        raise ViewCalError(f"schema {doc.get('schema')!r} is not one this version reads (use {SCHEMA}).")
    sid = doc.get("site")
    if not isinstance(sid, str) or not ID.match(sid):
        raise ViewCalError("site: use the listing id (letters, digits, - and _).")
    p, e, r, lms = doc.get("photo"), doc.get("eye"), doc.get("result"), doc.get("landmarks")
    if not isinstance(p, dict) or not isinstance(e, dict) or not isinstance(r, dict) or not isinstance(lms, list):
        raise ViewCalError("photo, eye, result and landmarks are all required.")
    floor = p.get("floor")
    if not (isinstance(floor, int) and not isinstance(floor, bool) and 1 <= floor <= 200):
        raise ViewCalError("photo.floor: the floor the photo was taken on, 1 to 200.")
    if _num(p.get("aspect"), 0.2, 5) is None:
        raise ViewCalError("photo.aspect: the picture's width / height.")
    for k, (lo, hi) in {"x": (-1e5, 1e5), "y": (-1e5, 1e5), "z": (-50, 1500)}.items():
        if _num(e.get(k), lo, hi) is None:
            raise ViewCalError(f"eye.{k} is missing or out of range.")
    if not 2 <= len(lms) <= 12:
        raise ViewCalError("landmarks: two to twelve are needed for a fit.")
    for i, l in enumerate(lms, 1):
        if not isinstance(l, dict) or any(_num(l.get(k), lo, hi) is None for k, (lo, hi) in
                                          {"x": (-1e5, 1e5), "y": (-1e5, 1e5), "z": (-50, 2000), "u": (-0.5, 1.5), "v": (-0.5, 1.5)}.items()):
            raise ViewCalError(f"landmarks[{i}] needs numeric x, y, z (site metres) and u, v (fractions of the picture).")
    ranges = {"bearing_deg": (0, 360), "tilt_deg": (-89, 89), "vfov_deg": (5, 170), "hfov_deg": (5, 179), "eye_height_m": (-50, 1500),
              "rms_deg": (0, 90), "max_deg": (0, 90)}
    for k, (lo, hi) in ranges.items():
        if _num(r.get(k), lo, hi) is None:
            raise ViewCalError(f"result.{k} is missing or out of range ({lo} to {hi}).")
    if r.get("quality") not in ("good", "fair", "poor"):
        raise ViewCalError("result.quality must be good, fair or poor.")
    if len(json.dumps(doc)) > MAX_BYTES:
        raise ViewCalError(f"The record is larger than {MAX_BYTES // 1024} KB.")
    out = json.loads(json.dumps(doc))
    out["photo"]["title"] = _text(p.get("title"), 160)
    out["photo"]["scope"] = _text(p.get("scope"), 40)
    out["photo"]["path"] = _text(p.get("path"), 300) or None
    for l in out["landmarks"]:
        l["name"] = _text(l.get("name"), 80) or "Landmark"
    return out


def path_for(root: Path, site_id: str) -> Path:
    if not isinstance(site_id, str) or not ID.match(site_id):
        raise ViewCalError("The site id must use letters, digits, - and _ only.")
    return root / FOLDER / f"{site_id}.json"


def save(root: Path, doc: Any, overwrite: bool = True) -> dict[str, Any]:
    """Validate ``doc`` and write it to ``<root>/view-calibrations/<site>.json``. An earlier file is kept once as ``.json.bak``.
    Returns ``{"path", "created", "warnings"}``."""
    rec = check(doc)
    target = path_for(root, rec["site"])
    folder = root / FOLDER
    if folder.is_symlink() or (target.exists() and target.is_symlink()):
        raise ViewCalError("The view-calibrations folder or the file is a symbolic link; refusing to write through it.")
    if target.exists() and not overwrite:
        raise ViewCalError(f"{FOLDER}/{rec['site']}.json already exists.")
    folder.mkdir(exist_ok=True)
    created = not target.exists()
    if not created:
        target.with_suffix(".json.bak").write_bytes(target.read_bytes())
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)
    warnings = []
    if rec["result"]["quality"] == "poor":
        warnings.append("The fit is poor (a landmark is probably mismatched): do not trust these numbers.")
    if not rec["result"].get("eye_determined"):
        warnings.append("The photo could not fix the camera height; only the direction was measured.")
    return {"path": f"{FOLDER}/{rec['site']}.json", "created": created, "warnings": warnings}


def load(root: Path, site_id: str) -> dict[str, Any] | None:
    """The saved record for a site, or None (a damaged file counts as none)."""
    try:
        return check(json.loads(path_for(root, site_id).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return None


def ids(root: Path) -> list[str]:
    d = root / FOLDER
    return sorted(p.stem for p in d.glob("*.json")) if d.is_dir() else []


def eye_at_floor(rec: dict[str, Any], base_m: float, floor: int) -> float | None:
    """The eye height at ``floor`` that follows from a photo taken on another floor, with every storey scaled to fit
    (the ``scale`` spread of ``vertical_calibration``): ``base + (floor - 1) * k + 1.6`` where
    ``k = (eye at the photo's floor - 1.6 - base) / (photo floor - 1)``. None when the photo did not fix the height."""
    r = rec["result"]
    if not r.get("eye_determined"):
        return None
    pf = rec["photo"]["floor"]
    slab = r["eye_height_m"] - EYE_M
    if pf <= 1:
        return r["eye_height_m"] if floor <= 1 else None
    k = (slab - base_m) / (pf - 1)
    return round(base_m + (floor - 1) * k + EYE_M, 2)


def site_command(rec: dict[str, Any], base_m: float, floor: int | None = None) -> str:
    """The ``apartmentscout site`` command line that carries a record into the site file."""
    ap = rec.get("applied") or {}
    fl = floor or ap.get("floor") or rec["photo"]["floor"]
    parts = [f"apartmentscout site {rec['site']} --floor {fl}"]
    if ap.get("az_deg") is not None:
        parts.append(f"--bearing {ap['az_deg']:.1f}")
    eye = eye_at_floor(rec, base_m, fl)
    if eye is not None:
        parts.append(f"--eye-height {eye:.2f}")
    return " ".join(parts)


def calibration_note(rec: dict[str, Any]) -> dict[str, Any]:
    """What ``site`` keeps in ``calibration.view``: the measurement and where it came from, not the landmarks."""
    r, p = rec["result"], rec["photo"]
    return {"source": "photo", "photo": p["n"], "title": p["title"], "photo_floor": p["floor"], "saved": rec.get("saved"),
            "bearing_deg": r["bearing_deg"], "tilt_deg": r["tilt_deg"], "vfov_deg": r["vfov_deg"],
            "eye_height_m": r["eye_height_m"] if r.get("eye_determined") else None,
            "rms_deg": r["rms_deg"], "landmarks": r["n"], "quality": r["quality"]}
