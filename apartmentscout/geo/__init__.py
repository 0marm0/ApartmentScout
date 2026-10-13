"""Small geometry helpers: distances, a local metre grid, bearings."""
from __future__ import annotations

import math

R_EARTH = 6371008.8


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


class LocalFrame:
    """Equirectangular east/north metres around an origin. Fine within a few km."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.ky = 110574.0

    def to_xy(self, lon: float, lat: float) -> tuple[float, float]:
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        return self.lon0 + x / self.kx, self.lat0 + y / self.ky


COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
COMPASS_DEG = {k: i * 22.5 for i, k in enumerate(COMPASS)}


def compass(deg: float) -> str:
    return COMPASS[int((deg % 360) / 22.5 + 0.5) % 16]
