"""Extra CLI commands, one module each.

A module here exposes ``register(add)`` where ``add(name, fn, help)`` returns an argparse subparser that already has
``--search``. Modules are discovered automatically, so new commands never need to edit cli.py.
"""
from __future__ import annotations

import importlib
import pkgutil


def register_all(add) -> None:
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        mod = importlib.import_module(f"{__name__}.{info.name}")
        if hasattr(mod, "register"):
            mod.register(add)
