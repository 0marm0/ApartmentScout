"""ranks.json for the dashboard: the search's rank history (apartmentscout/rankhistory.py), which the dashboard reads to say
why a home moved. Written only when the search has recorded at least two scoring runs, because one run has nothing to compare."""
from __future__ import annotations

import json
from pathlib import Path

from .. import rankhistory


def export(ws, out: Path) -> list[str]:
    doc = rankhistory.load(ws.root)
    target = out / "ranks.json"
    if not doc or len(doc["runs"]) < 2:
        target.unlink(missing_ok=True)
        return []
    target.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return ["ranks.json"]
