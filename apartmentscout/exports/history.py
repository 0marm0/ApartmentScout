"""history.json for the dashboard, and the day's snapshot under <search>/history/snapshots/ (see
docs/guides/data-model.md#history). The bundled examples are read-only, so they never get a snapshot written."""
from __future__ import annotations

import json
from pathlib import Path

from ..quality.history import history_doc, should_snapshot, write_snapshot
from ..quality.workspace import REPO, load_listings


def export(ws, out: Path) -> list[str]:
    Ls = load_listings(ws)
    crit = ws.criteria()
    if Ls and should_snapshot(ws.root, crit, REPO):
        write_snapshot(ws.root, Ls)
    doc = history_doc(ws.root, Ls, crit)
    (out / "history.json").write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False, default=str))
    return ["history.json"]
