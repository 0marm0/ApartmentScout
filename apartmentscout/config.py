"""Search workspace and criteria loading."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

DEFAULT_WEIGHTS = {"cost": 20, "space": 25, "commute": 15, "amenities": 15,
                   "light_view": 10, "building": 10, "quiet": 5}


@dataclass
class Workspace:
    """A search lives in one folder: criteria.yaml, listings.json, research/, cache/."""

    root: Path

    @property
    def criteria_path(self) -> Path:
        return self.root / "criteria.yaml"

    @property
    def listings_path(self) -> Path:
        return self.root / "listings.json"

    @property
    def research_dir(self) -> Path:
        return self.root / "research"

    @property
    def cache_dir(self) -> Path:
        d = self.root / "cache"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def layers_dir(self) -> Path:
        d = self.root / "layers"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def sites_dir(self) -> Path:
        d = self.root / "sites"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def plans_dir(self) -> Path:
        return self.root / "plans"

    def criteria(self) -> dict[str, Any]:
        return load_criteria(self.criteria_path)


def load_criteria(path: str | Path) -> dict[str, Any]:
    c = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    c.setdefault("search", {})
    c.setdefault("budget", {})
    c.setdefault("unit", {})
    c.setdefault("must_have", [])
    c.setdefault("strongly_prefer", [])
    c.setdefault("nice_to_have", [])
    c.setdefault("commute", {}).setdefault("destinations", [])
    w = dict(DEFAULT_WEIGHTS)
    w.update(c.get("weights") or {})
    c["weights"] = w
    return c
