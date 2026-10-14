"""Extra dashboard data files written by `apartmentscout build` / `serve`, one module each.

A module here exposes ``export(ws, out: Path) -> list[str]`` that writes files under ``out`` (the dashboard data
folder) and returns their names relative to it; the names are listed in manifest["extra"]. Modules are discovered
automatically, so new data files never need to edit cli.py.
"""
from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path


def run_all(ws, out: Path, log=print) -> list[str]:
    written: list[str] = []
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        mod = importlib.import_module(f"{__name__}.{info.name}")
        if hasattr(mod, "export"):
            try:
                written += mod.export(ws, out) or []
            except Exception as e:  # an optional export must never break the dashboard build
                log(f"  export {info.name} skipped: {e}")
    return written
