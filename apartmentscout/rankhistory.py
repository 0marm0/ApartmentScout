"""Rank history: where every listing stood on each scoring run, so the dashboard can say why a home moved.

`apartmentscout score` appends one *run* to ``<search>/history/ranks.json`` (``build`` copies the file to the
dashboard as ``ranks.json``). A run keeps, for every listing, its action and fit rank, its overall score, its monthly
cost, its eleven dimension scores and the flags that explain them, plus the weights and the scoring version the run
used. That is exactly what is needed to say, later, which dimensions moved a home and why (the sentences are built in
``dashboard/js/features/moves-model.js``). Nothing here changes a score.

The file is columnar and small: listing ids once, then per run a few integer arrays and one hex string of
dimension scores (two digits per dimension, ``ff`` for unknown):

    {"v": 1, "dims": [...], "vocab": [...], "versions": {"2.1": "..."}, "ids": [...],
     "runs": [{"at": "2026-10-13T23:45", "version": "2.0", "k": 10, "w": [...], "n": 335,
               "a": [...], "f": [...], "s": [...], "c": [...], "p": "5a64...", "g": ["0.3", "", ...]}]}

``a``/``f``: action and fit rank (0 = none); ``s``: overall x 10 (-1 = none); ``c``: monthly cost in dollars (-1 =
unknown); ``g``: indexes into ``vocab`` joined by dots. At most :data:`MAX_RUNS` runs are kept, and a rescore on the
same day with the same scoring version replaces that day's run instead of adding one.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable

from .score import DIMENSIONS, SCORE_CHANGES

VERSION = 1
MAX_RUNS = 6
RELATIVE = Path("history") / "ranks.json"
_KEEP_GATE = re.compile(r"^(price_dispute|over_budget|unknown_cost|fails:|unverified:|concession:)")


def path(root: Path) -> Path:
    return Path(root) / RELATIVE


def load(root: Path) -> dict[str, Any] | None:
    """The stored history, or None when there is none (or it is not ours)."""
    try:
        doc = json.loads(path(root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and doc.get("v") == VERSION and isinstance(doc.get("runs"), list) else None


def _empty() -> dict[str, Any]:
    return {"v": VERSION, "dims": list(DIMENSIONS), "vocab": [], "versions": {}, "ids": [], "runs": []}


def _hex(v: float | None) -> str:
    return "ff" if v is None else f"{max(0, min(100, round(v))):02x}"


def _stamp(at: dt.datetime | str | None) -> str:
    if isinstance(at, str):
        return at[:16]
    return (at or dt.datetime.now()).strftime("%Y-%m-%dT%H:%M")


def make_run(doc: dict[str, Any], rows: Iterable[tuple[str, dict]], weights: dict[str, float], at: dt.datetime | str | None = None) -> dict[str, Any]:
    """One run from ``(listing id, stored score)`` pairs. Extends ``doc['ids']``, ``doc['dims']`` and ``doc['vocab']`` in place."""
    rows = [(str(i), s or {}) for i, s in rows]
    ids, index, vocab, dims = doc["ids"], {x: n for n, x in enumerate(doc["ids"])}, doc["vocab"], doc["dims"]
    vindex = {x: n for n, x in enumerate(vocab)}
    for i, s in rows:
        if i not in index:
            index[i] = len(ids)
            ids.append(i)
        for k in (s.get("parts") or {}):
            if k not in dims:
                dims.append(k)
    n = len(ids)
    a, f, sc, c = [0] * n, [0] * n, [-1] * n, [-1] * n
    p, g = [["ff"] * len(dims) for _ in range(n)], [""] * n
    version = ""
    for i, s in rows:
        j = index[i]
        r = s.get("ranks") or {}
        a[j] = int(r.get("action") or s.get("rank") or 0)
        f[j] = int(r.get("fit") or 0)
        sc[j] = round(s["overall"] * 10) if s.get("overall") is not None else -1
        mc = s.get("monthly_cost")
        c[j] = round(mc) if isinstance(mc, (int, float)) else -1
        for k, v in (s.get("parts") or {}).items():
            p[j][dims.index(k)] = _hex(v)
        names = [*(s.get("flags") or []), *(x for x in (s.get("gates") or []) if _KEEP_GATE.match(x))]
        ix = []
        for name in dict.fromkeys(names):
            if name not in vindex:
                vindex[name] = len(vocab)
                vocab.append(name)
            ix.append(vindex[name])
        g[j] = ".".join(str(x) for x in sorted(ix))
        version = version or str(s.get("version") or "")
    return {"at": _stamp(at), "version": version, "k": len(dims), "w": [round(float(weights.get(k, 0)), 2) for k in dims],
            "n": sum(1 for x in a if x), "a": a, "f": f, "s": sc, "c": c, "p": "".join("".join(x) for x in p), "g": g}


def _same(x: dict[str, Any], y: dict[str, Any]) -> bool:
    """Do two runs say the same thing (the time they were made aside)? Arrays are compared up to the shorter run's ids."""
    keys = ("version", "k", "w", "a", "f", "s", "c", "p", "g")
    n = min(len(x["a"]), len(y["a"]))
    if x["k"] != y["k"] or x["version"] != y["version"] or x["w"] != y["w"]:
        return False
    if any(any(v for v in r["a"][n:]) or any(v for v in r["f"][n:]) for r in (x, y)):
        return False
    return all(x[k][:n] == y[k][:n] for k in ("a", "f", "s", "c", "g")) and x["p"][: n * x["k"] * 2] == y["p"][: n * y["k"] * 2]


def _pad(run: dict[str, Any], n: int, k: int) -> dict[str, Any]:
    """The run widened to ``n`` listings and ``k`` dimensions (new listings and dimensions are unknown in older runs)."""
    have, kk = len(run["a"]), run["k"]
    if have == n and kk == k:
        return run
    out = dict(run)
    for key, fill in (("a", 0), ("f", 0), ("s", -1), ("c", -1)):
        out[key] = list(run[key]) + [fill] * (n - have)
    out["g"] = list(run["g"]) + [""] * (n - have)
    if kk != k:
        rows = [run["p"][i * kk * 2:(i + 1) * kk * 2] + "ff" * (k - kk) for i in range(have)]
        out["w"] = list(run["w"]) + [0] * (k - kk)
        out["k"] = k
    else:
        rows = [run["p"][i * kk * 2:(i + 1) * kk * 2] for i in range(have)]
    out["p"] = "".join(rows) + "ff" * k * (n - have)
    return out


def add_run(doc: dict[str, Any], run: dict[str, Any], same_day: bool = True) -> bool:
    """Put a run into the history: skipped when it repeats the last one, replacing the last one when that was made the
    same day with the same scoring version (``same_day=False`` always appends). Returns whether the history changed."""
    n, k = len(doc["ids"]), len(doc["dims"])
    runs = [_pad(r, n, k) for r in doc["runs"]]
    run = _pad(run, n, k)
    if runs and _same(runs[-1], run):
        doc["runs"] = runs
        return False
    if same_day and runs and runs[-1]["at"][:10] == run["at"][:10] and runs[-1]["version"] == run["version"]:
        runs[-1] = run
    else:
        runs.append(run)
    doc["runs"] = runs[-MAX_RUNS:]
    doc["versions"] = {v: SCORE_CHANGES[v] for v in sorted({r["version"] for r in doc["runs"]}) if v in SCORE_CHANGES}
    return True


def save(root: Path, doc: dict[str, Any]) -> Path:
    target = path(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(f".{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)
    return target


def record(root: Path, listings: Iterable[dict], crit: dict, at: dt.datetime | str | None = None) -> bool:
    """Append this scoring run (``listings`` already scored) to the search's rank history. Returns whether it changed."""
    doc = load(root) or _empty()
    run = make_run(doc, ((L.get("id"), L.get("score")) for L in listings if L.get("id") is not None), crit.get("weights") or {}, at)
    if not run["n"] and not any(v >= 0 for v in run["s"]):
        return False
    if not add_run(doc, run):
        return False
    save(root, doc)
    return True
