"""places.json: street, park and neighbourhood geometry for the dashboard's plain-language place filters.

Built by `apartmentscout places` into the search folder; `build` copies it next to the other dashboard data. A search
without one simply has no place filters (the dashboard says so when someone asks for "east of 3rd Ave").
"""
from __future__ import annotations

import shutil
from pathlib import Path


def export(ws, out: Path) -> list[str]:
    src = ws.root / "places.json"
    dst = out / "places.json"
    if not src.exists():
        dst.unlink(missing_ok=True)
        return []
    shutil.copyfile(src, dst)
    return ["places.json"]
