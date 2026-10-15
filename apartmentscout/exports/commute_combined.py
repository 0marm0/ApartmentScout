"""layers/commute-combined-<mode>.json: worst-of and weighted commute surfaces when a search has several destinations.

Built from the per-destination grids already in the dashboard's layers folder (apartmentscout/commute/combine.py), so a
change of destination weight only needs a rebuild, not another routing run.
"""
from __future__ import annotations

from pathlib import Path

from ..commute.combine import write_combined


def export(ws, out: Path) -> list[str]:
    layers = out / "layers"
    if not layers.is_dir():
        return []
    return [f"layers/{p.name}" for p in write_combined(layers, ws.criteria(), log=lambda *_: None)]
