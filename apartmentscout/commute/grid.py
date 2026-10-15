"""The commute heat surface: the router's door-to-door answer at every cell centre of a fine grid.

The per-point router (run._Router.minutes) looks, for one home, at every stop within walking range and
keeps the latest departure that still arrives on time. Done cell by cell that costs one stop search per
cell; here it runs the other way round. Each stop "stamps" its walking cone onto the cells within range
(access = walking metres / speed + the stop's street-to-vehicle time, the same Walker the router uses),
and every cell keeps, per profile (mode set x arrival time), the latest departure over all stamps and
the walk-only option. The result is identical to calling the router at each cell centre, at a fraction
of the cost, so the grid can be fine (50-75 m) and still take seconds.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .gtfs import NEG, FProfile, Network, Profile
from .walk import R_EARTH, Walker


@dataclass(frozen=True)
class GridSpec:
    """A regular lat/lon grid; cell (r, c) spans [lat0 + r*dlat, lat0 + (r+1)*dlat] and likewise in lon."""

    lon0: float
    lat0: float
    dlon: float
    dlat: float
    rows: int
    cols: int

    @classmethod
    def cover(cls, bbox: tuple[float, float, float, float], cell_m: float) -> GridSpec:
        lon0, lat0, lon1, lat1 = bbox
        dlat = cell_m / 110574
        dlon = cell_m / (111320 * math.cos(math.radians((lat0 + lat1) / 2)))
        rows, cols = int(math.ceil((lat1 - lat0) / dlat)), int(math.ceil((lon1 - lon0) / dlon))
        return cls(lon0, lat0, dlon, dlat, max(rows, 1), max(cols, 1))

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """The outer edges of the cells (what a map stretches the grid over)."""
        return self.lon0, self.lat0, self.lon0 + self.cols * self.dlon, self.lat0 + self.rows * self.dlat

    def centres(self) -> tuple[np.ndarray, np.ndarray]:
        return self.lat0 + (np.arange(self.rows) + 0.5) * self.dlat, self.lon0 + (np.arange(self.cols) + 0.5) * self.dlon


def _haversine(lat: float, lon: float, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    p, q = math.radians(lat), np.radians(lats)
    a = np.sin((q - p) / 2) ** 2 + math.cos(p) * np.cos(q) * np.sin(np.radians(lons - lon) / 2) ** 2
    return 2 * R_EARTH * np.arcsin(np.sqrt(np.minimum(a, 1.0)))


@dataclass
class Surface:
    """Per mode set: minutes per cell, (rows, cols), averaged over the arrival times; NaN = no answer."""

    spec: GridSpec
    minutes: dict[str, np.ndarray]
    nearest_stop_m: np.ndarray  # walking metres to the closest stop of any mode (inf if none in range)
    walk_min: np.ndarray        # walking-only minutes to the destination


def surface(net: Network, profs: dict[str, list[Profile]], dest: tuple[float, float], spec: GridSpec,
            max_access_m: float, walker: Walker | None = None, cell_land: np.ndarray | None = None,
            stop_land: np.ndarray | None = None) -> Surface:
    """Router minutes at every cell centre, for every mode set in `profs`.

    cell_land / stop_land (optional): landmass label of each cell (rows, cols) and stop; 0 = unknown.
    A stop is not reachable on foot from a cell on a different landmass (no swimming across a river).
    """
    w = walker or net.walker
    la, lo = spec.centres()
    LA, LO = np.meshgrid(la, lo, indexing="ij")
    flat_la, flat_lo = LA.ravel(), LO.ravel()
    n = flat_la.size
    cell_area = w.area(flat_la, flat_lo) if w.grids else None
    walk_m = w.metres_many(dest[0], dest[1], flat_la, flat_lo, areas=cell_area)
    walk_s = walk_m / w.speed_ms
    keys = list(profs)
    plist = [(k, p) for k in keys for p in profs[k]]
    P = len(plist)
    arrive = np.array([p.arrive_by for _, p in plist], dtype=float)
    best = arrive[:, None] - walk_s[None, :]  # latest departure from home; walking is always an option
    nearest = np.full(n, np.inf)
    if net is not None and P:
        rlat, rlon, smask, sacc = net.arrays()
        slat, slon = np.degrees(rlat), np.degrees(rlon)
        LD = np.full((P, len(slat)), -np.inf)
        for i, (_, p) in enumerate(plist):
            ld = p.ld_array().astype(float)
            ok = (ld > NEG) & ((smask & p.mask) > 0)
            LD[i, ok] = ld[ok]
        sarea = net.areas() if w.grids else None
        dla = max_access_m / 110574 + spec.dlat
        flat_land = cell_land.ravel() if cell_land is not None else None
        for j in np.nonzero(smask > 0)[0]:
            # cells whose centre lies within max_access_m of the stop (straight line, as the router filters)
            dlo = max_access_m / (111320 * math.cos(math.radians(slat[j]))) + spec.dlon
            r0 = max(0, int((slat[j] - dla - spec.lat0) / spec.dlat))
            r1 = min(spec.rows, int((slat[j] + dla - spec.lat0) / spec.dlat) + 1)
            c0 = max(0, int((slon[j] - dlo - spec.lon0) / spec.dlon))
            c1 = min(spec.cols, int((slon[j] + dlo - spec.lon0) / spec.dlon) + 1)
            if r0 >= r1 or c0 >= c1:
                continue
            idx = (np.arange(r0, r1)[:, None] * spec.cols + np.arange(c0, c1)[None, :]).ravel()
            d = _haversine(slat[j], slon[j], flat_la[idx], flat_lo[idx])
            keep = d <= max_access_m
            if flat_land is not None and stop_land is not None and stop_land[j] > 0:
                cl = flat_land[idx]
                keep &= (cl == 0) | (cl == stop_land[j])
            idx = idx[keep]
            if not idx.size:
                continue
            m = w.metres_many(slat[j], slon[j], flat_la[idx], flat_lo[idx],
                              areas=None if cell_area is None else cell_area[idx],
                              area=None if sarea is None else int(sarea[j]))
            nearest[idx] = np.minimum(nearest[idx], m)
            col = LD[:, j]
            live = col > -np.inf
            if not live.any():
                continue
            dep = col[live][:, None] - (m / w.speed_ms + sacc[j])[None, :]
            rows_ = np.nonzero(live)[0]
            sub = best[np.ix_(rows_, idx)]
            best[np.ix_(rows_, idx)] = np.maximum(sub, dep)
    mins = (arrive[:, None] - best) / 60.0
    out: dict[str, np.ndarray] = {}
    i = 0
    for k in keys:
        q = len(profs[k])
        out[k] = mins[i:i + q].mean(axis=0).reshape(spec.rows, spec.cols)
        i += q
    return Surface(spec, out, nearest.reshape(spec.rows, spec.cols), (walk_s / 60).reshape(spec.rows, spec.cols))


def surface_forward(net: Network, profs: dict[str, list[FProfile]], dest: tuple[float, float], spec: GridSpec,
                    max_access_m: float, walker: Walker | None = None, cell_land: np.ndarray | None = None,
                    stop_land: np.ndarray | None = None) -> Surface:
    """`surface` for trips that leave the destination (the evening way home): minutes from the departure to reaching each
    cell centre, for every mode set in `profs`, averaged over the departure times. Each stop stamps the same walking cone
    onto the cells; a cell keeps the earliest arrival over all stamps and the walk from the destination."""
    w = walker or net.walker
    la, lo = spec.centres()
    LA, LO = np.meshgrid(la, lo, indexing="ij")
    flat_la, flat_lo = LA.ravel(), LO.ravel()
    n = flat_la.size
    cell_area = w.area(flat_la, flat_lo) if w.grids else None
    walk_m = w.metres_many(dest[0], dest[1], flat_la, flat_lo, areas=cell_area)
    walk_s = walk_m / w.speed_ms
    keys = list(profs)
    plist = [(k, p) for k in keys for p in profs[k]]
    P = len(plist)
    depart = np.array([p.depart_at for _, p in plist], dtype=float)
    best = depart[:, None] + walk_s[None, :]  # earliest arrival at the cell; walking is always an option
    nearest = np.full(n, np.inf)
    if net is not None and P:
        rlat, rlon, smask, sacc = net.arrays()
        slat, slon = np.degrees(rlat), np.degrees(rlon)
        EA = np.full((P, len(slat)), np.inf)
        for i, (_, p) in enumerate(plist):
            ea = p.ea_array()
            ok = np.isfinite(ea) & ((smask & p.mask) > 0)
            EA[i, ok] = ea[ok]
        sarea = net.areas() if w.grids else None
        dla = max_access_m / 110574 + spec.dlat
        flat_land = cell_land.ravel() if cell_land is not None else None
        for j in np.nonzero(smask > 0)[0]:
            dlo = max_access_m / (111320 * math.cos(math.radians(slat[j]))) + spec.dlon
            r0 = max(0, int((slat[j] - dla - spec.lat0) / spec.dlat))
            r1 = min(spec.rows, int((slat[j] + dla - spec.lat0) / spec.dlat) + 1)
            c0 = max(0, int((slon[j] - dlo - spec.lon0) / spec.dlon))
            c1 = min(spec.cols, int((slon[j] + dlo - spec.lon0) / spec.dlon) + 1)
            if r0 >= r1 or c0 >= c1:
                continue
            idx = (np.arange(r0, r1)[:, None] * spec.cols + np.arange(c0, c1)[None, :]).ravel()
            d = _haversine(slat[j], slon[j], flat_la[idx], flat_lo[idx])
            keep = d <= max_access_m
            if flat_land is not None and stop_land is not None and stop_land[j] > 0:
                cl = flat_land[idx]
                keep &= (cl == 0) | (cl == stop_land[j])
            idx = idx[keep]
            if not idx.size:
                continue
            m = w.metres_many(slat[j], slon[j], flat_la[idx], flat_lo[idx],
                              areas=None if cell_area is None else cell_area[idx],
                              area=None if sarea is None else int(sarea[j]))
            nearest[idx] = np.minimum(nearest[idx], m)
            col = EA[:, j]
            live = np.isfinite(col)
            if not live.any():
                continue
            arr = col[live][:, None] + (m / w.speed_ms + sacc[j])[None, :]
            rows_ = np.nonzero(live)[0]
            best[np.ix_(rows_, idx)] = np.minimum(best[np.ix_(rows_, idx)], arr)
    mins = (best - depart[:, None]) / 60.0
    out: dict[str, np.ndarray] = {}
    i = 0
    for k in keys:
        q = len(profs[k])
        out[k] = mins[i:i + q].mean(axis=0).reshape(spec.rows, spec.cols)
        i += q
    return Surface(spec, out, nearest.reshape(spec.rows, spec.cols), (walk_s / 60).reshape(spec.rows, spec.cols))
