"""watchlist.json: buildings to watch for new units (see docs/guides/research-quality.md#watchlist)."""
from __future__ import annotations

import json
from pathlib import Path

from ..quality.history import history_doc
from ..quality.watchlist import watchlist
from ..quality.workspace import load_listings


def export(ws, out: Path) -> list[str]:
    Ls = load_listings(ws)
    crit = ws.criteria()
    events = history_doc(ws.root, Ls, crit)["events"] if (crit.get("watchlist") or any(L.get("watch") for L in Ls)) else []
    doc = watchlist(Ls, crit, events)
    (out / "watchlist.json").write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    return ["watchlist.json"]
