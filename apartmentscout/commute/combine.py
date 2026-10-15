"""Combined commute surfaces for searches with several destinations.

Each destination has its own heat grid (``commute-<dest>.json`` for the best of transit, ``-subway``, ``-bus`` per
mode). With two or more, the map can also show how a place does against all of them at once:

* **worst of**: the longest trip of any destination at each cell. It answers "where can I be within 30 minutes of
  everyone I travel to".
* **weighted**: the mean of the destinations' minutes, each counted by its ``weight`` in criteria.yaml (a partner's
  office you visit twice a week counts less than your own, so you give it 0.5).

``apartmentscout build`` writes ``layers/commute-combined-<mode>.json`` from the grids on disk, so no routing is
repeated: change a destination's weight, rebuild, and the weighted surface follows. A cell that is blank (water, or too
far from any stop) for one destination is blank in both. Grids made at different times may differ in extent (a
destination re-routed alone with ``apartmentscout commute --dest``); the others are sampled onto the first one's cells
by nearest centre, which is exact when the cell size and origin agree and within one cell otherwise.

File: ``{"kind": "commute-combo", "mode", "destinations": [{name, weight, max_minutes}], "bbox", "rows", "cols",
"cell_m", "scale": 0.5, "nodata": 255, "worst_z", "weighted_z", ...}``; the two surfaces are the usual half-minute
bytes (``encode_minutes``), deflated (zlib) and base64-encoded; the dashboard inflates them with DecompressionStream.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import zlib
from pathlib import Path
from typing import Callable

import numpy as np

from ..listings import slugify
from .run import NODATA, TRANSIT, decode_minutes

MODES = (TRANSIT, "subway", "bus")
LABEL = {TRANSIT: "best", "subway": "subway", "bus": "bus"}   # the dashboard's name for each mode


def layer_path(layers_dir: Path, dest_name: str, mode: str) -> Path:
    return layers_dir / f"commute-{slugify(dest_name)}{'' if mode == TRANSIT else '-' + mode}.json"


def combined_path(layers_dir: Path, mode: str) -> Path:
    return layers_dir / f"commute-combined-{LABEL[mode]}.json"


def _grid(layer: dict) -> np.ndarray:
    return np.array(decode_minutes(layer), dtype=float).reshape(layer["rows"], layer["cols"])


def _same_grid(a: dict, b: dict) -> bool:
    return a["rows"] == b["rows"] and a["cols"] == b["cols"] and all(abs(x - y) < 1e-7 for x, y in zip(a["bbox"], b["bbox"]))


def sample_onto(src: dict, ref: dict) -> np.ndarray:
    """`src`'s minutes at the centre of every cell of `ref` (nearest cell; -1 outside src's extent)."""
    g = _grid(src)
    lo0, la0, lo1, la1 = ref["bbox"]
    lat = la0 + (np.arange(ref["rows"]) + 0.5) * (la1 - la0) / ref["rows"]
    lon = lo0 + (np.arange(ref["cols"]) + 0.5) * (lo1 - lo0) / ref["cols"]
    s0, t0, s1, t1 = src["bbox"]
    r = np.floor((lat - t0) / (t1 - t0) * src["rows"]).astype(int)
    c = np.floor((lon - s0) / (s1 - s0) * src["cols"]).astype(int)
    ok = ((r >= 0) & (r < src["rows"]))[:, None] & ((c >= 0) & (c < src["cols"]))[None, :]
    out = np.full((ref["rows"], ref["cols"]), -1.0)
    rr, cc = np.clip(r, 0, src["rows"] - 1)[:, None], np.clip(c, 0, src["cols"] - 1)[None, :]
    out[ok] = g[rr, cc][ok]
    return out


def combine_grids(grids: list[np.ndarray], weights: list[float]) -> tuple[np.ndarray, np.ndarray]:
    """(worst, weighted) minutes with NaN where any destination is blank (-1)."""
    stack = np.stack(grids)
    blank = (stack < 0).any(axis=0)
    w = np.array(weights, dtype=float)[:, None, None]
    worst = np.where(blank, np.nan, stack.max(axis=0))
    weighted = np.where(blank, np.nan, (stack * w).sum(axis=0) / w.sum())
    return worst, weighted


def _pack(m: np.ndarray) -> str:
    q = np.where(np.isfinite(m), np.clip(np.round(np.nan_to_num(m, nan=0.0) * 2), 0, NODATA - 1), NODATA).astype(np.uint8)
    return base64.b64encode(zlib.compress(q.tobytes(), 9)).decode("ascii")


def unpack(z: str, rows: int, cols: int) -> np.ndarray:
    """Minutes (NaN = blank) from a `*_z` field."""
    q = np.frombuffer(zlib.decompress(base64.b64decode(z)), dtype=np.uint8).reshape(rows, cols)
    return np.where(q == NODATA, np.nan, q * 0.5)


def write_combined(layers_dir: Path, crit: dict, log: Callable[..., None] = print) -> list[Path]:
    """Write commute-combined-<mode>.json for every mode all destinations have a grid for. Returns the paths."""
    dests = [d for d in (crit.get("commute") or {}).get("destinations") or [] if d.get("lat") is not None]
    for old in layers_dir.glob("commute-combined-*.json"):   # stale ones (a destination was removed) must not linger
        old.unlink()
    if len(dests) < 2:
        return []
    out: list[Path] = []
    for mode in MODES:
        paths = [layer_path(layers_dir, d["name"], mode) for d in dests]
        if not all(p.exists() for p in paths):
            continue
        layers = [json.loads(p.read_text()) for p in paths]
        ref = layers[0]
        weights = [float(d.get("weight", 1.0)) for d in dests]
        if not sum(weights) > 0:
            log("  combined commute skipped: every destination weight is 0")
            return out
        grids = [_grid(L) if _same_grid(L, ref) else sample_onto(L, ref) for L in layers]
        worst, weighted = combine_grids(grids, weights)
        limits = [float(d.get("max_minutes", 30)) for d in dests]
        doc = {"kind": "commute-combo", "mode": LABEL[mode], "name": "All destinations",
               "destinations": [{"name": d["name"], "weight": w, "max_minutes": m, "lat": d["lat"], "lon": d["lon"]}
                                for d, w, m in zip(dests, weights, limits)],
               "limit_worst": min(limits), "limit_weighted": round(sum(w * m for w, m in zip(weights, limits)) / sum(weights), 1),
               "bbox": ref["bbox"], "rows": ref["rows"], "cols": ref["cols"], "cell_m": ref.get("cell_m"), "scale": 0.5, "nodata": NODATA,
               "water_masked": ref.get("water_masked"), "feeds": ref.get("feeds"), "arrival_offsets_min": ref.get("arrival_offsets_min"),
               "arrive_by": [L.get("arrive_by") for L in layers], "service_date": ref.get("service_date"),
               "method": "at each cell the longest (worst) and the weight-averaged minutes of the destinations' own grids",
               "worst_z": _pack(worst), "weighted_z": _pack(weighted), "generated": dt.datetime.now().isoformat(timespec="seconds")}
        p = combined_path(layers_dir, mode)
        p.write_text(json.dumps(doc, separators=(",", ":")))
        log(f"    layer {p.name}: {p.stat().st_size / 1024:.0f} KB ({len(dests)} destinations)")
        out.append(p)
    return out
