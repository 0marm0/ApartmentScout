"""digest.json: the latest `apartmentscout monitor` digest for the dashboard (see docs/guides/monitoring.md)."""
from __future__ import annotations

import json
from pathlib import Path

from ..quality.monitor import digest_export


def export(ws, out: Path) -> list[str]:
    (out / "digest.json").write_text(json.dumps(digest_export(ws.root), separators=(",", ":"), ensure_ascii=False))
    return ["digest.json"]
