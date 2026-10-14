"""Walking on the real street network (OpenStreetMap), for the commute router and heat map.

The grid metric in walk.py measures a walk as if every block were a perfect rectangle, so every
isochrone around a station is a diamond. This module walks the pedestrian network instead: sidewalks,
crossings, park paths, plazas, steps, bridges' footpaths, and the streets themselves where no separate
sidewalk is mapped. It knows that Broadway cuts diagonally, that Central Park is crossed on its paths,
that the FDR and the highways are not walkable, that Stuyvesant Town is a superblock, and that the
Queensboro and Williamsburg bridges have walkways but the tunnels do not.

Pipeline:

1. fetch_ways(): one Overpass query per tile of the search area (cached with receipts by geo.fetch),
   ways tagged highway=footway|pedestrian|path|steps|...|trunk plus anything with foot=yes.
2. walkable(): drops foot=no/private/use_sidepath, access=no/private, and road tunnels.
3. build_graph(): keeps the connected pieces of network longer than `min_component_m` (so a private
   courtyard path does not trap a point), inserts "anchors" (destinations, station entrances, bus stops,
   listings) as nodes at their nearest point on the network, and collapses chains of shape points into
   edges between junctions. Edges are sampled every `step_m` metres for the heat grid.
4. WalkGraph.dijkstra(): multi-source shortest walks (metres), each node remembering which source won.

Times are walking metres / walking speed. No allowance is made for waiting at crossings, crowds,
stairs or elevation (the same as most journey planners).
"""
from __future__ import annotations

import hashlib
import heapq
import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

from ..geo import fetch as F

GRAPH_VERSION = 1
WALK_HIGHWAYS = ("footway", "pedestrian", "path", "steps", "living_street", "residential", "service",
                 "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link",
                 "unclassified", "trunk", "trunk_link", "track", "corridor", "cycleway", "road", "bridleway")
_ROADS = frozenset({"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary",
                    "tertiary_link", "unclassified", "residential", "service", "road", "living_street"})
_FOOT_OK = frozenset({"yes", "designated", "permissive"})
_FOOT_NO = frozenset({"no", "private", "use_sidepath"})
R_EARTH = 6371008.8


def walkable(tags: dict) -> bool:
    """May a pedestrian use this OSM way? foot=yes|designated|permissive always wins; motorways,
    foot=no|private|use_sidepath, access=no|private and road tunnels are out."""
    foot = tags.get("foot", "")
    if foot in _FOOT_OK:
        return True
    hw = tags.get("highway", "")
    if hw not in WALK_HIGHWAYS or foot in _FOOT_NO:
        return False
    if tags.get("access") in ("no", "private"):
        return False
    if hw in _ROADS and (tags.get("tunnel") == "yes" or tags.get("motorroad") == "yes"):
        return False  # Queens-Midtown, Holland, Lincoln: no sidewalks
    return True


def overpass_query(s: float, w: float, n: float, e: float) -> str:
    box = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    hw = "|".join(WALK_HIGHWAYS)
    return (f'[out:json][timeout:240];\n(\n  way["highway"~"^({hw})$"]({box});\n'
            f'  way["highway"]["foot"~"^(yes|designated|permissive)$"]({box});\n);\nout body qt;\n>;\nout skel qt;')


def tiles(bbox: tuple[float, float, float, float], tile_deg: float) -> list[tuple[float, float, float, float]]:
    """(s, w, n, e) tiles covering bbox (lon0, lat0, lon1, lat1), snapped to a fixed lattice so a slightly
    different search area reuses the cached tiles."""
    lon0, lat0, lon1, lat1 = bbox
    i0, i1 = math.floor(lat0 / tile_deg), math.ceil(lat1 / tile_deg)
    j0, j1 = math.floor(lon0 / tile_deg), math.ceil(lon1 / tile_deg)
    return [(i * tile_deg, j * tile_deg, (i + 1) * tile_deg, (j + 1) * tile_deg)
            for i in range(i0, i1) for j in range(j0, j1)]


def fetch_ways(bbox: tuple[float, float, float, float], cache_dir: Path | None, log=print,
               tile_deg: float = 0.05, max_age_days: float = 120,
               fetcher: Callable[..., list[dict]] | None = None) -> tuple[dict[int, tuple], dict[int, tuple]]:
    """Every walkable-candidate way in bbox: ({way id: (node ids, tags)}, {node id: (lat, lon)})."""
    fetcher = fetcher or F.overpass
    ways: dict[int, tuple] = {}
    nodes: dict[int, tuple[float, float]] = {}
    ts = tiles(bbox, tile_deg)
    t0 = time.time()
    for k, (s, w, n, e) in enumerate(ts):
        t1 = time.time()
        els = fetcher(overpass_query(s, w, n, e), cache_dir=cache_dir, max_age_days=max_age_days)
        if time.time() - t1 > 2 and k + 1 < len(ts):
            time.sleep(2)  # a fresh download: leave the public Overpass servers a breather between tiles
        for el in els:
            if el.get("type") == "way":
                ways[el["id"]] = (tuple(el.get("nodes") or ()), el.get("tags") or {})
            elif el.get("type") == "node":
                nodes[el["id"]] = (el["lat"], el["lon"])
        if log and len(ts) > 1 and (k + 1) % 4 == 0:
            log(f"    walk network: {k + 1}/{len(ts)} tiles ({time.time() - t0:.0f}s)")
    return ways, nodes


# ---------------------------------------------------------------- geometry helpers


def _hav(la1, lo1, la2, lo2) -> np.ndarray:
    p, q = np.radians(la1), np.radians(la2)
    a = np.sin((q - p) / 2) ** 2 + np.cos(p) * np.cos(q) * np.sin(np.radians(np.asarray(lo2) - lo1) / 2) ** 2
    return 2 * R_EARTH * np.arcsin(np.sqrt(np.minimum(a, 1.0)))


class _Find:
    """Union-find over 0..n-1."""

    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, x: int) -> int:
        p = self.p
        while p[x] != x:
            p[x] = p[p[x]]
            x = p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


class _Buckets:
    """Points bucketed on a square lattice of `cell_m` metres, for nearest-point queries."""

    def __init__(self, lat: np.ndarray, lon: np.ndarray, cell_m: float):
        self.lat0 = float(np.min(lat)) if len(lat) else 0.0
        self.lon0 = float(np.min(lon)) if len(lon) else 0.0
        self.ky = 110574.0
        self.kx = 111320.0 * math.cos(math.radians(float(np.mean(lat)) if len(lat) else 0.0))
        self.cell = cell_m
        self.lat, self.lon = lat, lon
        r = np.floor((lat - self.lat0) * self.ky / cell_m).astype(np.int64)
        c = np.floor((lon - self.lon0) * self.kx / cell_m).astype(np.int64)
        self.key = r * 1_000_003 + c
        self.order = np.argsort(self.key, kind="stable")
        self.sorted = self.key[self.order]

    def near(self, lat: float, lon: float, radius_m: float) -> tuple[np.ndarray, np.ndarray]:
        """Indices of the points within radius_m and their distances (metres)."""
        r = int(math.floor((lat - self.lat0) * self.ky / self.cell))
        c = int(math.floor((lon - self.lon0) * self.kx / self.cell))
        k = int(math.ceil(radius_m / self.cell))
        out = []
        for dr in range(-k, k + 1):
            base = (r + dr) * 1_000_003
            lo = np.searchsorted(self.sorted, base + c - k, side="left")
            hi = np.searchsorted(self.sorted, base + c + k, side="right")
            if hi > lo:
                out.append(self.order[lo:hi])
        if not out:
            return np.zeros(0, dtype=np.int64), np.zeros(0)
        idx = np.concatenate(out)
        d = _hav(lat, lon, self.lat[idx], self.lon[idx])
        keep = d <= radius_m
        return idx[keep], d[keep]


# ---------------------------------------------------------------- the graph


@dataclass
class WalkGraph:
    """Junction graph of the walkable network.

    Nodes are junctions (and anchors); each edge is a chain of OSM shape points with its true length.
    Samples are points every ~step_m along every edge: (edge, metres from the edge's u end).
    """

    lat: np.ndarray
    lon: np.ndarray
    indptr: np.ndarray
    nbr: np.ndarray
    wm: np.ndarray
    eu: np.ndarray
    ev: np.ndarray
    elen: np.ndarray
    s_lat: np.ndarray
    s_lon: np.ndarray
    s_edge: np.ndarray
    s_x: np.ndarray
    anchor_node: np.ndarray  # junction index of each anchor, -1 if it could not be placed on the network
    anchor_snap_m: np.ndarray  # straight metres from the anchor to its point on the network
    step_m: float = 15.0
    stats: dict = field(default_factory=dict)
    _adj: tuple | None = field(default=None, repr=False)

    @property
    def n(self) -> int:
        return len(self.lat)

    def dijkstra(self, seeds: Iterable[tuple[int, float, int]], limit_m: float | None = None,
                 limit_from: str = "walk") -> tuple[np.ndarray, np.ndarray]:
        """Multi-source shortest walk. seeds: (node, starting cost in metres, source id).

        Returns (cost, src): the least starting-cost-plus-metres at every node (inf where unreached) and the
        source id that achieves it (-1 unreached). With limit_m, a label stops spreading once it has walked
        more than limit_m metres from its own source (the starting cost does not count against it).
        """
        if self._adj is None:
            self._adj = (self.indptr.tolist(), self.nbr.tolist(), self.wm.tolist())
        indptr, nbr, wm = self._adj
        n = self.n
        inf = math.inf
        cost = [inf] * n
        src = [-1] * n
        heap: list[tuple[float, float, int, int]] = []
        for node, c, s in seeds:
            if node < 0:
                continue
            if c < cost[node]:
                cost[node] = c
                src[node] = s
                heap.append((c, 0.0, node, s))
        heapq.heapify(heap)
        pop, push = heapq.heappop, heapq.heappush
        lim = inf if limit_m is None else float(limit_m)
        while heap:
            c, walked, u, s = pop(heap)
            if c > cost[u] or src[u] != s:
                continue
            for k in range(indptr[u], indptr[u + 1]):
                w = wm[k]
                nw = walked + w
                if nw > lim:
                    continue
                v = nbr[k]
                nc = c + w
                if nc < cost[v]:
                    cost[v] = nc
                    src[v] = s
                    push(heap, (nc, nw, v, s))
        return np.asarray(cost, dtype=float), np.asarray(src, dtype=np.int64)

    def sample_cost(self, cost: np.ndarray, src: np.ndarray | None = None):
        """Cost at every sample point: the cheaper of reaching it from either end of its edge (and the
        winning source when src is given)."""
        e = self.s_edge
        cu = cost[self.eu[e]] + self.s_x
        cv = cost[self.ev[e]] + (self.elen[e] - self.s_x)
        out = np.minimum(cu, cv)
        if src is None:
            return out
        return out, np.where(cu <= cv, src[self.eu[e]], src[self.ev[e]])

    def nearest_samples(self, lat: float, lon: float, radius_m: float) -> tuple[np.ndarray, np.ndarray]:
        if not hasattr(self, "_sb"):
            self._sb = _Buckets(self.s_lat, self.s_lon, 50.0)
        return self._sb.near(lat, lon, radius_m)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        arrs = {k: getattr(self, k) for k in ("lat", "lon", "indptr", "nbr", "wm", "eu", "ev", "elen", "s_lat",
                                              "s_lon", "s_edge", "s_x", "anchor_node", "anchor_snap_m")}
        tmp = path.with_suffix(".tmp.npz")
        np.savez_compressed(tmp, step_m=np.array(self.step_m), stats=np.array(json.dumps(self.stats)), **arrs)
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> WalkGraph:
        z = np.load(path)
        kw = {k: z[k] for k in z.files if k not in ("step_m", "stats")}
        return cls(**kw, step_m=float(z["step_m"]), stats=json.loads(str(z["stats"])))


def build_graph(ways: dict[int, tuple], nodes: dict[int, tuple], anchors: list[tuple[float, float]] | None = None,
                min_component_m: float = 1000.0, anchor_max_m: float = 300.0, step_m: float = 15.0,
                log=None) -> WalkGraph:
    """Junction graph of the walkable ways, with each anchor (lat, lon) inserted at its nearest point."""
    t0 = time.time()
    anchors = list(anchors or [])
    rid: dict[int, int] = {}
    rlat: list[float] = []
    rlon: list[float] = []
    lines: list[list[int]] = []
    for _wid, (nds, tags) in sorted(ways.items()):
        if not walkable(tags):
            continue
        line = []
        for nd in nds:
            p = nodes.get(nd)
            if p is None:
                continue
            i = rid.get(nd)
            if i is None:
                i = rid[nd] = len(rlat)
                rlat.append(p[0])
                rlon.append(p[1])
            if not line or line[-1] != i:
                line.append(i)
        if len(line) >= 2:
            lines.append(line)
    RLA, RLO = np.asarray(rlat), np.asarray(rlon)
    # pieces (consecutive shape points) and their lengths
    pa = np.fromiter((a for ln in lines for a in ln[:-1]), dtype=np.int64)
    pb = np.fromiter((b for ln in lines for b in ln[1:]), dtype=np.int64)
    plen = _hav(RLA[pa], RLO[pa], RLA[pb], RLO[pb]) if len(pa) else np.zeros(0)
    # connected components; drop the small ones (a courtyard path, a mapping fragment)
    uf = _Find(len(rlat))
    for a, b in zip(pa.tolist(), pb.tolist()):
        uf.union(a, b)
    root = np.fromiter((uf.find(i) for i in range(len(rlat))), dtype=np.int64, count=len(rlat))
    comp_len = np.bincount(root[pa], weights=plen, minlength=len(rlat)) if len(pa) else np.zeros(len(rlat))
    big = comp_len[root] >= min_component_m
    lines = [ln for ln in lines if big[ln[0]]]
    piece_line = np.fromiter((k for k, ln in enumerate(lines) for _ in ln[:-1]), dtype=np.int64)
    piece_pos = np.fromiter((j for ln in lines for j in range(len(ln) - 1)), dtype=np.int64)
    pa = np.fromiter((a for ln in lines for a in ln[:-1]), dtype=np.int64)
    pb = np.fromiter((b for ln in lines for b in ln[1:]), dtype=np.int64)
    plen = _hav(RLA[pa], RLO[pa], RLA[pb], RLO[pb]) if len(pa) else np.zeros(0)
    # anchors: nearest point on any piece (found through 10 m samples, then projected exactly)
    a_piece = np.full(len(anchors), -1, dtype=np.int64)
    a_t = np.zeros(len(anchors))
    a_d = np.full(len(anchors), np.inf)
    if anchors and len(pa):
        ns = np.maximum(1, np.ceil(plen / 10.0)).astype(np.int64)
        sp = np.repeat(np.arange(len(pa)), ns + 1)
        st = (np.arange(sp.size) - np.repeat(np.cumsum(ns + 1) - (ns + 1), ns + 1)) / np.repeat(ns, ns + 1)
        sla = RLA[pa][sp] + (RLA[pb][sp] - RLA[pa][sp]) * st
        slo = RLO[pa][sp] + (RLO[pb][sp] - RLO[pa][sp]) * st
        B = _Buckets(sla, slo, 100.0)
        kx = 111320.0 * math.cos(math.radians(float(np.mean(RLA))))
        for k, (la, lo) in enumerate(anchors):
            idx, d = B.near(la, lo, anchor_max_m)
            if not idx.size:
                continue
            cand = np.unique(sp[idx[np.argsort(d)[:8]]])
            ax, ay = (RLO[pa[cand]] - lo) * kx, (RLA[pa[cand]] - la) * 110574.0
            bx, by = (RLO[pb[cand]] - lo) * kx, (RLA[pb[cand]] - la) * 110574.0
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = np.where(L2 > 0, np.clip(-(ax * dx + ay * dy) / np.where(L2 > 0, L2, 1), 0, 1), 0)
            dist = np.hypot(ax + t * dx, ay + t * dy)
            j = int(np.argmin(dist))
            if dist[j] <= anchor_max_m:
                a_piece[k], a_t[k], a_d[k] = cand[j], t[j], dist[j]
    # insert anchors into their lines as new shape points (or reuse a piece end within 0.5 m)
    forced: set[int] = set()
    a_raw = np.full(len(anchors), -1, dtype=np.int64)
    inserts: dict[int, list[tuple[int, float, int]]] = {}
    extra_la, extra_lo = [], []
    for k in np.nonzero(a_piece >= 0)[0].tolist():
        p = int(a_piece[k])
        t = float(a_t[k])
        if t * plen[p] < 0.5:
            a_raw[k] = pa[p]
        elif (1 - t) * plen[p] < 0.5:
            a_raw[k] = pb[p]
        else:
            i = len(rlat) + len(extra_la)
            extra_la.append(RLA[pa[p]] + (RLA[pb[p]] - RLA[pa[p]]) * t)
            extra_lo.append(RLO[pa[p]] + (RLO[pb[p]] - RLO[pa[p]]) * t)
            a_raw[k] = i
            inserts.setdefault(int(piece_line[p]), []).append((int(piece_pos[p]), t, i))
        forced.add(int(a_raw[k]))
    if extra_la:
        RLA = np.concatenate([RLA, extra_la])
        RLO = np.concatenate([RLO, extra_lo])
    for li, ins in inserts.items():
        ln = lines[li]
        out = []
        by_pos: dict[int, list[tuple[float, int]]] = {}
        for pos, t, i in ins:
            by_pos.setdefault(pos, []).append((t, i))
        for j, a in enumerate(ln):
            out.append(a)
            for _t, i in sorted(by_pos.get(j, ())):
                if out[-1] != i:
                    out.append(i)
        lines[li] = out
    # junctions: shared shape points, line ends, anchors
    uses = np.zeros(len(RLA), dtype=np.int64)
    for ln in lines:
        for a in ln:
            uses[a] += 1
        uses[ln[0]] += 1
        uses[ln[-1]] += 1
    for a in forced:
        uses[a] += 2
    junc = uses >= 2
    jid = np.full(len(RLA), -1, dtype=np.int64)
    jl = np.nonzero(junc)[0]
    jid[jl] = np.arange(jl.size)
    # edges: split every line at its junctions
    eu, ev, chains = [], [], []
    for ln in lines:
        start = 0
        for j in range(1, len(ln)):
            if junc[ln[j]]:
                eu.append(jid[ln[start]])
                ev.append(jid[ln[j]])
                chains.append(ln[start:j + 1])
                start = j
    cn = np.fromiter((len(c) for c in chains), dtype=np.int64, count=len(chains))
    flat = np.fromiter((a for c in chains for a in c), dtype=np.int64, count=int(cn.sum()))
    first = np.cumsum(cn) - cn
    seg = _hav(RLA[flat[:-1]], RLO[flat[:-1]], RLA[flat[1:]], RLO[flat[1:]]) if flat.size > 1 else np.zeros(0)
    seg = np.concatenate([[0.0], seg])
    seg[first] = 0.0  # no length across a chain boundary
    cum = np.cumsum(seg)
    within = cum - np.repeat(cum[first], cn)  # metres from the chain's start
    elen = within[first + cn - 1]
    eu_a, ev_a = np.asarray(eu, dtype=np.int64), np.asarray(ev, dtype=np.int64)
    # CSR adjacency, both directions (loops dropped; parallel edges kept)
    keep = eu_a != ev_a
    src = np.concatenate([eu_a[keep], ev_a[keep]])
    dst = np.concatenate([ev_a[keep], eu_a[keep]])
    w = np.concatenate([elen[keep], elen[keep]])
    o = np.lexsort((w, src))
    src, dst, w = src[o], dst[o], w[o]
    indptr = np.zeros(jl.size + 1, dtype=np.int64)
    np.add.at(indptr, src + 1, 1)
    indptr = np.cumsum(indptr)
    # samples every ~step_m along each edge, ends included
    nsm = np.maximum(1, np.ceil(elen / step_m)).astype(np.int64)
    s_edge = np.repeat(np.arange(len(elen)), nsm + 1)
    s_x = (np.arange(s_edge.size) - np.repeat(np.cumsum(nsm + 1) - (nsm + 1), nsm + 1)) / np.repeat(nsm, nsm + 1)
    s_x = s_x * elen[s_edge]
    # locate each sample on its chain: global position = chain offset + x
    goff = np.cumsum(elen) - elen + np.arange(len(elen)) * 1e-6  # strictly increasing chain offsets
    G = np.repeat(goff, cn) + within
    g = goff[s_edge] + s_x
    p = np.searchsorted(G, g, side="right") - 1
    p = np.clip(p, first[s_edge], first[s_edge] + cn[s_edge] - 2)
    span = within[p + 1] - within[p]
    f = np.where(span > 0, (s_x - within[p]) / np.where(span > 0, span, 1), 0.0).clip(0, 1)
    s_lat = RLA[flat[p]] + (RLA[flat[p + 1]] - RLA[flat[p]]) * f
    s_lon = RLO[flat[p]] + (RLO[flat[p + 1]] - RLO[flat[p]]) * f
    anchor_node = np.where(a_raw >= 0, jid[np.maximum(a_raw, 0)], -1)
    gr = WalkGraph(RLA[jl], RLO[jl], indptr, dst, w, eu_a, ev_a, elen, s_lat, s_lon, s_edge, s_x,
                   anchor_node, np.where(np.isfinite(a_d), a_d, -1.0), step_m)
    gr.stats = {"ways": len(lines), "junctions": int(jl.size), "edges": len(elen), "km": round(float(elen.sum()) / 1000, 1),
                "samples": int(s_edge.size), "anchors": len(anchors), "anchors_placed": int((anchor_node >= 0).sum()),
                "dropped_small_components_km": round(float(comp_len[(comp_len > 0) & (comp_len < min_component_m)].sum()) / 1000, 3),
                "build_s": round(time.time() - t0, 1)}
    if log:
        log(f"    walk graph: {gr.stats['junctions']:,} junctions, {gr.stats['edges']:,} edges, "
            f"{gr.stats['km']:,} km, {gr.stats['anchors_placed']}/{len(anchors)} anchors ({gr.stats['build_s']}s)")
    return gr


def anchors_key(bbox, anchors: list[tuple[float, float]], **kw) -> str:
    blob = json.dumps([GRAPH_VERSION, [round(v, 5) for v in bbox], [(round(a, 6), round(b, 6)) for a, b in anchors],
                       sorted(kw.items())])
    return hashlib.sha1(blob.encode()).hexdigest()[:16]


def load_graph(bbox: tuple[float, float, float, float], anchors: list[tuple[float, float]], cache_dir: Path | None,
               log=print, step_m: float = 15.0, anchor_max_m: float = 300.0, tile_deg: float = 0.05,
               fetcher=None) -> WalkGraph:
    """The walk graph for bbox with these anchors: from the cache when built before, else fetched and built."""
    key = anchors_key(bbox, anchors, step_m=step_m, anchor_max_m=anchor_max_m)
    path = Path(cache_dir) / "walk" / f"graph-{key}.npz" if cache_dir is not None else None
    if path is not None and path.exists():
        try:
            return WalkGraph.load(path)
        except (OSError, ValueError, KeyError):
            pass
    ways, nodes = fetch_ways(bbox, Path(cache_dir) / "walk" if cache_dir is not None else None, log,
                             tile_deg=tile_deg, fetcher=fetcher)
    if not ways:
        raise RuntimeError("no walkable ways in the search area")
    g = build_graph(ways, nodes, anchors, anchor_max_m=anchor_max_m, step_m=step_m, log=log)
    if path is not None:
        g.save(path)
        # graphs are keyed by their anchors (listings change often): keep the newest few, not one per run
        old = sorted(path.parent.glob("graph-*.npz"), key=lambda p: p.stat().st_mtime, reverse=True)[3:]
        for p in old:
            p.unlink(missing_ok=True)
    return g


# ---------------------------------------------------------------- heat-grid stamping


@dataclass
class CellStamp:
    """Which samples lie within snap_m of each cell centre of a grid, ready for a fast per-cell minimum."""

    rows: int
    cols: int
    cells: np.ndarray  # cell index of each (sample, cell) pair, sorted
    samples: np.ndarray
    dist: np.ndarray  # metres from the sample to the cell centre
    starts: np.ndarray  # first pair of each distinct cell
    ucells: np.ndarray  # the distinct cells

    @classmethod
    def build(cls, g: WalkGraph, spec, snap_m: float) -> CellStamp:
        r = np.floor((g.s_lat - spec.lat0) / spec.dlat).astype(np.int64)
        c = np.floor((g.s_lon - spec.lon0) / spec.dlon).astype(np.int64)
        ky = 110574.0
        kx = 111320.0 * math.cos(math.radians(spec.lat0 + spec.rows * spec.dlat / 2))
        k = int(math.ceil(snap_m / min(spec.dlat * ky, spec.dlon * kx))) + 1
        cs, ss, ds = [], [], []
        base = np.arange(g.s_lat.size)
        for dr in range(-k, k + 1):
            for dc in range(-k, k + 1):
                rr, cc = r + dr, c + dc
                ok = (rr >= 0) & (rr < spec.rows) & (cc >= 0) & (cc < spec.cols)
                if not ok.any():
                    continue
                la = spec.lat0 + (rr[ok] + 0.5) * spec.dlat
                lo = spec.lon0 + (cc[ok] + 0.5) * spec.dlon
                d = np.hypot((g.s_lat[ok] - la) * ky, (g.s_lon[ok] - lo) * kx)
                m = d <= snap_m
                cs.append((rr[ok] * spec.cols + cc[ok])[m])
                ss.append(base[ok][m])
                ds.append(d[m])
        cells, samples, dist = np.concatenate(cs), np.concatenate(ss), np.concatenate(ds)
        o = np.argsort(cells, kind="stable")
        cells, samples, dist = cells[o], samples[o], dist[o]
        ucells, starts = np.unique(cells, return_index=True)
        return cls(spec.rows, spec.cols, cells, samples, dist, starts, ucells)

    def apply(self, sample_cost: np.ndarray) -> np.ndarray:
        """(rows, cols) least sample cost + snap distance (same units as the costs: metres); inf off-network."""
        out = np.full(self.rows * self.cols, np.inf)
        if self.cells.size:
            v = sample_cost[self.samples] + self.dist
            out[self.ucells] = np.minimum.reduceat(v, self.starts)
        return out.reshape(self.rows, self.cols)
