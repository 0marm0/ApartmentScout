"""Walking distance: straight line x a detour factor, or a street-grid metric inside a city's grid.

On a street grid you walk along the avenues and the streets, so the distance depends on direction:
straight along an avenue it is about the straight line, at 45 degrees to the grid it is up to 1.41x.
Inside a grid area (a polygon with the grid's bearing, from the city profile) the walk is

    factor x (blend x L1 + (1 - blend) x straight)

where L1 is the distance measured along the two grid axes. blend < 1 allows for the diagonal streets
(Broadway) and cutting corners; factor for everything else. Outside every grid area, or when the two
ends are in different areas, it falls back to straight x detour. For NYC the factors were fitted on
208 Manhattan walks of an independent router (MAE 0.6 min, against 3.9 min for straight x 1.25).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

R_EARTH = 6371008.8


@dataclass(frozen=True)
class GridArea:
    name: str
    bearing_deg: float  # direction of the avenues, clockwise from north
    factor: float
    blend: float
    lon: tuple[float, ...]  # polygon vertices
    lat: tuple[float, ...]

    @classmethod
    def from_cfg(cls, c: dict) -> GridArea:
        poly = c.get("polygon") or []
        if c.get("bbox") and not poly:
            x0, y0, x1, y1 = c["bbox"]
            poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        if len(poly) < 3:
            raise ValueError(f"walk grid {c.get('name')}: needs a polygon ([[lon, lat], ...]) or a bbox")
        return cls(str(c.get("name") or "grid"), float(c.get("bearing_deg", 0)), float(c.get("factor", 1.0)),
                   float(c.get("blend", 1.0)), tuple(float(p[0]) for p in poly), tuple(float(p[1]) for p in poly))

    def contains(self, lat, lon) -> np.ndarray:
        """Even-odd ray casting; works on scalars or arrays."""
        if np.ndim(lat) == 0 and np.ndim(lon) == 0:  # plain loop: far faster than numpy for one point
            y, x, ins = float(lat), float(lon), False
            xs, ys = self.lon, self.lat
            j = len(xs) - 1
            for i in range(len(xs)):
                if (ys[i] > y) != (ys[j] > y) and x < (xs[j] - xs[i]) * (y - ys[i]) / (ys[j] - ys[i]) + xs[i]:
                    ins = not ins
                j = i
            return np.bool_(ins)
        lat, lon = np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)
        inside = np.zeros(np.broadcast(lat, lon).shape, dtype=bool)
        xs, ys = self.lon, self.lat
        j = len(xs) - 1
        for i in range(len(xs)):
            xi, yi, xj, yj = xs[i], ys[i], xs[j], ys[j]
            if yi != yj:
                cross = ((yi > lat) != (yj > lat)) & (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
                inside ^= cross
            j = i
        return inside


@dataclass
class Walker:
    """Walking metres and seconds between points, the same everywhere in the router."""

    speed_ms: float = 4.8 / 3.6
    detour: float = 1.25
    grids: list[GridArea] = field(default_factory=list)

    @classmethod
    def from_cfg(cls, speed_ms: float, detour: float, grids: list[dict] | None) -> Walker:
        return cls(speed_ms, detour, [GridArea.from_cfg(g) for g in grids or []])

    def area(self, lat, lon) -> np.ndarray:
        """Index of the grid area each point is in, -1 outside all of them."""
        if np.ndim(lat) == 0 and np.ndim(lon) == 0:
            return np.int64(next((k for k, g in enumerate(self.grids) if g.contains(lat, lon)), -1))
        lat, lon = np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)
        out = np.full(np.broadcast(lat, lon).shape, -1, dtype=np.int64)
        for k, g in enumerate(self.grids):
            out = np.where((out < 0) & g.contains(lat, lon), k, out)
        return out

    def metres_many(self, lat: float, lon: float, lats: np.ndarray, lons: np.ndarray,
                    areas: np.ndarray | None = None, area: int | None = None) -> np.ndarray:
        """Walking metres from one point to many (areas: precomputed area() of the many points)."""
        lats, lons = np.asarray(lats, dtype=float), np.asarray(lons, dtype=float)
        p, q = math.radians(lat), np.radians(lats)
        a = np.sin((q - p) / 2) ** 2 + math.cos(p) * np.cos(q) * np.sin(np.radians(lons - lon) / 2) ** 2
        straight = 2 * R_EARTH * np.arcsin(np.sqrt(np.minimum(a, 1.0)))
        out = straight * self.detour
        if not self.grids:
            return out
        if area is None:
            area = int(self.area(lat, lon))
        if area < 0:
            return out
        if areas is None:
            areas = self.area(lats, lons)
        same = areas == area
        if same.any():
            g = self.grids[area]
            y = (lats[same] - lat) * 110574.0
            x = (lons[same] - lon) * 111320.0 * np.cos(np.radians((lats[same] + lat) / 2))
            t = math.radians(g.bearing_deg)
            l1 = np.abs(x * math.sin(t) + y * math.cos(t)) + np.abs(x * math.cos(t) - y * math.sin(t))
            out[same] = g.factor * (g.blend * l1 + (1 - g.blend) * straight[same])
        return out

    def metres(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        areas = np.array([self.area(lat2, lon2)]) if self.grids else None
        return float(self.metres_many(lat1, lon1, np.array([lat2]), np.array([lon2]), areas=areas)[0])

    def seconds(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        return self.metres(lat1, lon1, lat2, lon2) / self.speed_ms
