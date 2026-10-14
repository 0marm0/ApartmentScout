"""Loading a search for the quality commands and exports."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..listings import normalize

REPO = Path(__file__).resolve().parents[2]


def raw_document(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def raw_listings(doc: Any) -> list[dict]:
    if isinstance(doc, dict):
        doc = doc.get("listings") or []
    return [L for L in doc if isinstance(L, dict)] if isinstance(doc, list) else []


def load_listings(ws: Any) -> list[dict]:
    """Normalised listings of a workspace (empty when listings.json is missing)."""
    return [normalize(L) for L in raw_listings(raw_document(ws.listings_path))]


def search_from(args: Any):
    """The Workspace for a parsed command line (same rules as every other command)."""
    from ..cli import ws_from
    return ws_from(args)
