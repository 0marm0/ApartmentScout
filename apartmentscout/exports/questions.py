"""questions.json for the dashboard's "Questions for the leasing office" drafts (see docs/guides/leasing-office-questions.md)."""
from __future__ import annotations

import json
from pathlib import Path

from ..office_questions import export_document
from ..quality.history import read_claims
from ..quality.lint import lint_all
from ..quality.workspace import load_listings


def export(ws, out: Path) -> list[str]:
    crit, Ls = ws.criteria(), load_listings(ws)
    doc = export_document(Ls, crit, flags=lint_all(Ls, crit, ws.root, read_claims(ws.root)))
    (out / "questions.json").write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    return ["questions.json"]
