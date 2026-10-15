"""alerts.json: the digest behind the dashboard's "What's new" panel (see docs/guides/alerts.md).

It is the change since the saved baseline (`apartmentscout alerts`) when there is one, else the last saved digest while it
is recent. Nothing is written to the search folder; the baseline moves only when `apartmentscout alerts` runs."""
from __future__ import annotations

import json
from pathlib import Path

from ..alerts import export_digest
from ..quality.workspace import load_listings


def export(ws, out: Path) -> list[str]:
    d = export_digest(ws.root, load_listings(ws), ws.criteria())
    (out / "alerts.json").write_text(json.dumps(d, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return ["alerts.json"]
