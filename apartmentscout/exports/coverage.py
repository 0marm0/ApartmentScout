"""coverage.json for the dashboard's Research view (see docs/guides/data-model.md#coverage)."""
from __future__ import annotations

import json
from pathlib import Path

from ..quality.coverage import coverage
from ..quality.history import read_claims
from ..quality.workspace import load_listings


def export(ws, out: Path) -> list[str]:
    doc = coverage(load_listings(ws), ws.criteria(), ws.root, read_claims(ws.root))
    (out / "coverage.json").write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    return ["coverage.json"]
