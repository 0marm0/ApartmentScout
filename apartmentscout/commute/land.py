"""Land and water for the commute router: which landmass a point is on.

Two uses. The heat grid leaves cells over water blank instead of colouring rivers with the time it
would take to swim to the nearest stop, and the router does not let you walk from one landmass to a
stop on another (Roosevelt Island to a First Avenue bus stop, Long Island City to the FDR) when the
straight line between them crosses a river.

Land comes from polygons clipped to the shoreline (GeoJSON Polygon / MultiPolygon). They are drawn
into a raster (default 25 m) and split into connected landmasses, so Manhattan, Roosevelt Island and
Brooklyn-with-Queens get different labels; bridges are not land, so they do not join them. Points
just off the polygons (piers, a stop at the water's edge) take the label of the nearest land within
`snap_m`. Outside the polygons' coverage everything reads as 0 = unknown, and unknown never blocks a
walk, so a search that reaches beyond the data behaves as it did without a land model.

For NYC the polygons are the city's borough boundaries clipped to the shoreline (NYC Open Data,
"Borough Boundaries", water areas excluded); other cities can point `commute.transit.land` (or the
city profile's `land`) at any shoreline-clipped GeoJSON, or set it to false.
"""
from __future__ import annotations

import json
import math
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests

CITY_LAND = {"nyc": "https://data.cityofnewyork.us/resource/gthc-hcne.geojson"}


@dataclass
class Land:
    """A label raster: 0 = water or unknown, 1.. = one connected landmass each."""

    lon0: float
    lat0: float
    dlon: float
    dlat: float
    label: np.ndarray  # (rows, cols) int32, row 0 at lat0
    snapped: np.ndarray  # the same, with water cells near land given that land's label

    def at(self, lat, lon, snap: bool = True) -> np.ndarray:
        """Landmass label of each point (0 for water or outside the raster)."""
        lat, lon = np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)
        r = np.floor((lat - self.lat0) / self.dlat).astype(np.int64)
        c = np.floor((lon - self.lon0) / self.dlon).astype(np.int64)
        rows, cols = self.label.shape
        ok = (r >= 0) & (r < rows) & (c >= 0) & (c < cols)
        out = np.zeros(np.broadcast(lat, lon).shape, dtype=np.int32)
        src = self.snapped if snap else self.label
        out[ok] = src[r[ok], c[ok]]
        return out

    def is_land(self, lat, lon) -> np.ndarray:
        return self.at(lat, lon, snap=False) > 0

    @property
    def landmasses(self) -> int:
        return int(self.label.max())


def _rings(geojson: dict):
    """Yield (outer ring, [holes]) for every polygon, as (N, 2) lon/lat arrays."""
    feats = geojson.get("features") or ([geojson] if geojson.get("type") == "Feature" else [])
    for f in feats:
        g = f.get("geometry") or {}
        polys = [g["coordinates"]] if g.get("type") == "Polygon" else g.get("coordinates", []) if g.get("type") == "MultiPolygon" else []
        for p in polys:
            if p:
                yield np.asarray(p[0], dtype=float), [np.asarray(h, dtype=float) for h in p[1:]]


def rasterize(geojson: dict, bbox: tuple[float, float, float, float], cell_m: float = 25) -> np.ndarray:
    """Boolean land raster over bbox (lon0, lat0, lon1, lat1): True where a cell centre is inside a polygon."""
    lon0, lat0, lon1, lat1 = bbox
    dlat = cell_m / 110574
    dlon = cell_m / (111320 * math.cos(math.radians((lat0 + lat1) / 2)))
    rows, cols = int(math.ceil((lat1 - lat0) / dlat)), int(math.ceil((lon1 - lon0) / dlon))
    # scanline fill, even-odd over every ring (holes included): each ring edge crossing a row of cell
    # centres adds one crossing; the cells between consecutive crossings of a row are inside
    segs = []
    for outer, holes in _rings(geojson):
        x0, y0 = outer.min(axis=0)
        x1, y1 = outer.max(axis=0)
        if x1 < lon0 or x0 > lon1 or y1 < lat0 or y0 > lat1:
            continue
        for ring in [outer, *holes]:
            if len(ring) < 3:
                continue
            p = ring if (ring[0] == ring[-1]).all() else np.vstack([ring, ring[:1]])
            segs.append(np.column_stack([p[:-1], p[1:]]))
    land = np.zeros((rows, cols), dtype=bool)
    if not segs:
        return land
    e = np.vstack(segs)
    ax, ay, bx, by = e[:, 0], e[:, 1], e[:, 2], e[:, 3]
    lo, hi = np.minimum(ay, by), np.maximum(ay, by)
    r_start = np.maximum(np.ceil((lo - lat0) / dlat - 0.5), 0).astype(np.int64)
    r_end = np.minimum(np.ceil((hi - lat0) / dlat - 0.5), rows).astype(np.int64)  # rows whose centre is in [lo, hi)
    n = np.maximum(r_end - r_start, 0)
    keep = n > 0
    ax, ay, bx, by, r_start, n = ax[keep], ay[keep], bx[keep], by[keep], r_start[keep], n[keep]
    if not n.size:
        return land
    k = np.repeat(np.arange(n.size), n)
    r = r_start[k] + (np.arange(k.size) - np.repeat(np.cumsum(n) - n, n))
    yc = lat0 + (r + 0.5) * dlat
    x = ax[k] + (yc - ay[k]) * (bx[k] - ax[k]) / (by[k] - ay[k])
    o = np.lexsort((x, r))
    r, x = r[o], x[o]
    a, b = slice(0, None, 2), slice(1, None, 2)
    rr = r[a]
    c_in = np.clip(np.ceil((x[a] - lon0) / dlon - 0.5), 0, cols).astype(np.int64)
    c_out = np.clip(np.ceil((x[b] - lon0) / dlon - 0.5), 0, cols).astype(np.int64)
    diff = np.zeros((rows, cols + 1), dtype=np.int32)
    np.add.at(diff, (rr, c_in), 1)
    np.add.at(diff, (rr, c_out), -1)
    land[:] = np.cumsum(diff, axis=1)[:, :cols] > 0
    return land


def label_components(mask: np.ndarray) -> np.ndarray:
    """4-connected components of a boolean raster, labelled 1..n (0 = background)."""
    rows, cols = mask.shape
    lab = np.zeros((rows, cols), dtype=np.int32)
    n = 0
    flat = mask.ravel()
    lflat = lab.ravel()
    for start in np.flatnonzero(flat):
        if lflat[start]:
            continue
        n += 1
        lflat[start] = n
        q = deque([start])
        while q:
            i = q.popleft()
            r, c = divmod(i, cols)
            for j, ok in ((i - cols, r > 0), (i + cols, r < rows - 1), (i - 1, c > 0), (i + 1, c < cols - 1)):
                if ok and flat[j] and not lflat[j]:
                    lflat[j] = n
                    q.append(j)
    return lab


def _snap(lab: np.ndarray, steps: int) -> np.ndarray:
    """Give water cells within `steps` cells of land the label of the nearest land (grown ring by ring)."""
    out = lab.copy()
    for _ in range(steps):
        grow = out.copy()
        empty = out == 0
        for sl_to, sl_from in (((slice(1, None), slice(None)), (slice(None, -1), slice(None))),
                               ((slice(None, -1), slice(None)), (slice(1, None), slice(None))),
                               ((slice(None), slice(1, None)), (slice(None), slice(None, -1))),
                               ((slice(None), slice(None, -1)), (slice(None), slice(1, None)))):
            take = empty[sl_to] & (grow[sl_to] == 0) & (out[sl_from] > 0)
            grow[sl_to][take] = out[sl_from][take]
        if (grow == out).all():
            break
        out = grow
    return out


def build_land(geojson: dict, bbox: tuple[float, float, float, float], cell_m: float = 25,
               snap_m: float = 100) -> Land | None:
    mask = rasterize(geojson, bbox, cell_m)
    if not mask.any():
        return None
    lab = label_components(mask)
    lon0, lat0, lon1, lat1 = bbox
    dlat = cell_m / 110574
    dlon = cell_m / (111320 * math.cos(math.radians((lat0 + lat1) / 2)))
    return Land(lon0, lat0, dlon, dlat, lab, _snap(lab, max(0, int(round(snap_m / cell_m)))))


def land_source(crit: dict, city_profile: dict | None = None) -> str | None:
    """Where the land polygons come from: commute.transit.land (false turns it off), else the city
    profile's `land`, else the built-in source for the city, else none."""
    tr = (crit.get("commute") or {}).get("transit") or {}
    if "land" in tr:
        return tr["land"] or None
    if city_profile and city_profile.get("land"):
        return city_profile["land"]
    return CITY_LAND.get(((crit.get("search") or {}).get("city") or "").lower())


def load_land(src: str | None, cache_dir: Path, bbox: tuple[float, float, float, float], log=print,
              cell_m: float = 25) -> Land | None:
    """Fetch (once, into cache_dir) and rasterise the land polygons; None when there are none or the
    download fails (the router then works as it did without a land model)."""
    if not src:
        return None
    try:
        if src.startswith(("http://", "https://")):
            path = cache_dir / "land" / (src.rstrip("/").split("/")[-1].split("?")[0] or "land.geojson")
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                r = requests.get(src, timeout=120, headers={"User-Agent": "ApartmentScout/0.1"})
                r.raise_for_status()
                path.write_bytes(r.content)
                log(f"  land: downloaded {src}")
        else:
            path = Path(src)
        gj = json.loads(path.read_text())
    except (OSError, ValueError, requests.RequestException) as e:
        log(f"  land: could not load {src} ({e}); water is not masked and walks may cross rivers")
        return None
    land = build_land(gj, bbox, cell_m)
    if land is None:
        log(f"  land: no polygons of {src} inside the search area; ignored")
    return land
