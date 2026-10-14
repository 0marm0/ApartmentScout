"""Search workspace and criteria loading."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

# Scored dimensions, in display order, with the labels the dashboard and reasons use.
DIMENSION_LABELS: dict[str, str] = {
    "cost": "Cost", "space": "Space", "commute": "Commute", "amenities": "Amenities",
    "light_view": "Light & view", "building": "Building", "quiet": "Quiet",
    "move_date": "Move date", "renewal_risk": "Renewal risk", "transit_access": "Transit access",
}

# The three newer dimensions default to 0 so a criteria file written for the first seven keeps
# exactly the same ranking; turn them on with a weight or a preset.
DEFAULT_WEIGHTS = {"cost": 20, "space": 25, "commute": 15, "amenities": 15,
                   "light_view": 10, "building": 10, "quiet": 5,
                   "move_date": 0, "renewal_risk": 0, "transit_access": 0}

# Named, versioned weight presets. Bump `version` whenever a preset's weights change, so exported
# rankings say which recipe produced them. Criteria files can add their own under scoring.presets.
PRESETS: dict[str, dict[str, Any]] = {
    "balanced": {
        "version": 1, "label": "Balanced",
        "description": "Every dimension counts; space and cost lead.",
        "weights": dict(DEFAULT_WEIGHTS),
    },
    "biggest-and-nicest": {
        "version": 2, "label": "Biggest and nicest",
        "description": "Space first, then light, finishes and service; cost only through the budget gate.",
        "weights": {"cost": 3, "space": 35, "commute": 7, "amenities": 20, "light_view": 20,
                    "building": 10, "quiet": 5, "move_date": 0, "renewal_risk": 0, "transit_access": 0},
    },
    "cheapest-good-enough": {
        "version": 1, "label": "Cheapest good enough",
        "description": "Lowest first-lease cost among homes that clear the must-haves; renewal shock counts.",
        "weights": {"cost": 40, "space": 15, "commute": 15, "amenities": 10, "light_view": 5,
                    "building": 5, "quiet": 0, "move_date": 5, "renewal_risk": 5, "transit_access": 0},
    },
    "shortest-commute": {
        "version": 1, "label": "Shortest commute",
        "description": "Door-to-door time and nearby lines first.",
        "weights": {"cost": 15, "space": 15, "commute": 40, "amenities": 10, "light_view": 5,
                    "building": 5, "quiet": 0, "move_date": 0, "renewal_risk": 0, "transit_access": 10},
    },
}

SCORING_DEFAULTS: dict[str, Any] = {
    "preset": None,          # name of a preset; `weights:` entries then adjust it key by key
    "stale_days": 21,        # a listing checked longer ago than this gets a stale gate
    "as_of": None,           # date to score against (default: today); pin it for reproducible runs
}


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


def _preset(name: str, raw: Any) -> dict[str, Any]:
    """Accept a full preset ({weights, label, version, description}) or a bare weights mapping."""
    if not isinstance(raw, dict):
        raise ValueError(f"scoring preset {name!r} must be a mapping")
    if "weights" in raw:
        p = dict(raw)
    else:
        p = {"weights": dict(raw)}
    p["weights"] = {str(k): float(v) for k, v in (p.get("weights") or {}).items()}
    p.setdefault("version", 1)
    p.setdefault("label", name.replace("-", " ").capitalize())
    p.setdefault("description", "")
    return p


def resolve_scoring(c: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any]]:
    """Weights and the scoring block for a criteria mapping.

    Order: built-in defaults, then the named preset (if any), then the `weights:` block key by key.
    """
    sc = dict(SCORING_DEFAULTS)
    sc.update(c.get("scoring") or {})
    presets = {k: _preset(k, v) for k, v in PRESETS.items()}
    for k, v in (sc.get("presets") or {}).items():
        presets[str(k)] = _preset(str(k), v)
    w: dict[str, float] = dict(DEFAULT_WEIGHTS)
    name = sc.get("preset")
    if name:
        if name not in presets:
            raise ValueError(f"Unknown scoring preset {name!r}; choose one of {', '.join(sorted(presets))}")
        w.update(presets[name]["weights"])
    w.update(c.get("weights") or {})
    sc["presets"] = presets
    sc["dimensions"] = [[k, v] for k, v in DIMENSION_LABELS.items()]
    if name:
        sc["preset_version"] = presets[name]["version"]
    return w, sc


def load_criteria(path: str | Path) -> dict[str, Any]:
    return load_criteria_text(Path(path).read_text(encoding="utf-8"))


def load_criteria_text(text: str) -> dict[str, Any]:
    """Parse criteria.yaml text with the defaults and scoring resolution `load_criteria` applies."""
    c = yaml.safe_load(text) or {}
    if not isinstance(c, dict):
        raise ValueError("criteria.yaml must be a mapping of sections (search, budget, unit, ...)")
    c.setdefault("search", {})
    c.setdefault("budget", {})
    c.setdefault("unit", {})
    c.setdefault("must_have", [])
    c.setdefault("strongly_prefer", [])
    c.setdefault("nice_to_have", [])
    c.setdefault("commute", {}).setdefault("destinations", [])
    c["weights"], c["scoring"] = resolve_scoring(c)
    return c
