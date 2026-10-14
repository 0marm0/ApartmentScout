"""Door-to-door minutes with walking on the street network (walk_model: network).

For one destination and one routing profile (mode set x arrival time) every node of the walk graph
gets the time it takes from there to the destination:

    min( walk the network to the destination,
         min over stops j: walk the network to one of j's entrances + j's street-to-platform time
                           + (arrive_by - latest departure from j) )

computed as one multi-source Dijkstra: every entrance of every stop is a source, starting at
"arrive_by - latest departure + platform time", and walking adds metres / speed. There is no cap on
the walk to a station here: the fastest combination wins, whatever the walk (a cap per source cannot
be enforced exactly in one shared search, and an approximate one leaves holes where a far station's
label stops spreading and blocks a nearer one). max_walk_to_station_m x walk_detour still bounds the
walk from the last stop to the destination and the "near a stop" mask of the heat grid. The
destination end walks the network from each stop's exits (exit-only stairs count there, entry-only
ones do not).

The heat grid takes, at each 50 m cell centre, the least (node time + walk along the edge to a point
within snap_m of the centre + the straight snap from there); cells farther than snap_m from any
walkable way stay blank. A listing is a node of the graph (inserted at its nearest point on the
network) and takes the same least over the ways within snap_m (a building's nearest way can be a dead-end
courtyard path), so its minutes are read off the same field as the map's.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .gtfs import NEG, Network, Profile
from .walknet import CellStamp, WalkGraph


@dataclass
class NetPlan:
    """Anchors of the walk graph: what each one is."""

    anchors: list[tuple[float, float]] = field(default_factory=list)
    dest: dict[str, int] = field(default_factory=dict)  # destination name -> anchor
    enter: dict[int, list[int]] = field(default_factory=dict)  # stop -> anchors to enter it from the street
    leave: dict[int, list[int]] = field(default_factory=dict)  # stop -> anchors to leave it to the street
    points: dict[tuple[float, float], int] = field(default_factory=dict)  # listing (lat, lon) rounded -> anchor
    entrance_stats: dict = field(default_factory=dict)

    def add(self, lat: float, lon: float) -> int:
        key = (round(lat, 6), round(lon, 6))
        if key in self._seen:
            return self._seen[key]
        self.anchors.append(key)
        self._seen[key] = len(self.anchors) - 1
        return self._seen[key]

    def __post_init__(self):
        self._seen: dict[tuple[float, float], int] = {}


def plan_anchors(dests: list[dict], listings: list[dict], enter: dict[int, list[tuple[float, float]]],
                 leave: dict[int, list[tuple[float, float]]]) -> NetPlan:
    p = NetPlan()
    for d in dests:
        if d.get("lat") is not None:
            p.dest[d["name"]] = p.add(d["lat"], d["lon"])
    for L in listings:
        if L.get("lat") is not None:
            p.points[(round(L["lat"], 6), round(L["lon"], 6))] = p.add(L["lat"], L["lon"])
    for j, pts in enter.items():
        p.enter[j] = [p.add(*q) for q in pts]
    for j, pts in leave.items():
        p.leave[j] = [p.add(*q) for q in pts]
    return p


class NetField:
    """Walk-graph times for one destination: walk-only, egress per stop, and per profile."""

    def __init__(self, g: WalkGraph, plan: NetPlan, net: Network | None, dest_name: str, speed: float,
                 limit_m: float, snap_m: float = 60.0):
        self.g, self.plan, self.net, self.speed, self.limit_m, self.snap_m = g, plan, net, speed, limit_m, snap_m
        self._near: dict[tuple[float, float], tuple[np.ndarray, np.ndarray]] = {}
        a = plan.dest[dest_name]
        node = int(g.anchor_node[a])
        if node < 0:
            raise ValueError(f"destination {dest_name} is not within reach of the walk network")
        self.dest_cost, _ = g.dijkstra([(node, float(g.anchor_snap_m[a]), -1)])  # metres, incl. the snap

    def anchor_cost(self, cost: np.ndarray, a: int) -> float:
        node = int(self.g.anchor_node[a])
        return float(cost[node] + self.g.anchor_snap_m[a]) if node >= 0 else math.inf

    def egress(self) -> dict[int, float]:
        """Walking metres from each stop's nearest exit to the destination (within the limit)."""
        out = {}
        for j, anchors in self.plan.leave.items():
            m = min((self.anchor_cost(self.dest_cost, a) for a in anchors), default=math.inf)
            if m <= self.limit_m:
                out[j] = m
        return out

    def profile_cost(self, prof: Profile) -> tuple[np.ndarray, np.ndarray]:
        """(cost in metres-equivalent: seconds before arrive_by x speed, winning stop or -1 = walk) per node."""
        net, g, sp = self.net, self.g, self.speed
        seeds = []
        if net is not None:
            _, _, smask, sacc = net.arrays()
            ld = prof.ld_array()
            live = np.nonzero((ld > NEG) & ((smask & prof.mask) > 0))[0]
            for j in live.tolist():
                c = (prof.arrive_by - float(ld[j]) + float(sacc[j])) * sp
                for a in self.plan.enter.get(j, ()):
                    node = int(g.anchor_node[a])
                    if node >= 0:
                        seeds.append((node, c + float(g.anchor_snap_m[a]), j))
        cost, src = g.dijkstra(seeds)
        walk_better = self.dest_cost <= cost
        return np.where(walk_better, self.dest_cost, cost), np.where(walk_better, -1, src)

    def nearest_stop(self) -> np.ndarray:
        """Metres from every node to the nearest entrance of any stop in service (within the limit)."""
        seeds = []
        smask = self.net.arrays()[2] if self.net is not None else None
        for j, anchors in self.plan.enter.items():
            if smask is not None and not smask[j]:
                continue
            for a in anchors:
                node = int(self.g.anchor_node[a])
                if node >= 0:
                    seeds.append((node, float(self.g.anchor_snap_m[a]), j))
        cost, _ = self.g.dijkstra(seeds, limit_m=self.limit_m)
        return cost

    def point(self, cost: np.ndarray, src: np.ndarray, lat: float, lon: float) -> tuple[float, int]:
        """(cost, source) at a point: the least over its anchor (its nearest point on the network) and
        every way within snap_m, as a heat-grid cell does; 300 m search when nothing is that close."""
        key = (round(lat, 6), round(lon, 6))
        g = self.g
        best, bsrc = math.inf, -1
        a = self.plan.points.get(key)
        if a is not None and g.anchor_node[a] >= 0:
            node = int(g.anchor_node[a])
            best, bsrc = float(cost[node] + g.anchor_snap_m[a]), int(src[node])
        if key not in self._near:
            idx, d = g.nearest_samples(lat, lon, self.snap_m)
            if not idx.size and not math.isfinite(best):
                idx, d = g.nearest_samples(lat, lon, 300.0)
            self._near[key] = (idx, d)
        idx, d = self._near[key]
        if idx.size:
            e = g.s_edge[idx]
            cu = cost[g.eu[e]] + g.s_x[idx] + d
            cv = cost[g.ev[e]] + (g.elen[e] - g.s_x[idx]) + d
            k = int(np.argmin(np.minimum(cu, cv)))
            v = float(min(cu[k], cv[k]))
            if v < best:
                best, bsrc = v, int(src[g.eu[e[k]]] if cu[k] <= cv[k] else src[g.ev[e[k]]])
        return best, bsrc


def net_surface(fld: NetField, profs: dict[str, list[Profile]], stamp: CellStamp, points: list[tuple[float, float]]):
    """Minutes per cell per mode set (mean over arrival times), walk-only minutes, metres to the nearest
    stop, and for every point {set: [(minutes, stop or -1, access seconds)] per profile} plus walk metres."""
    g, sp = fld.g, fld.speed
    walk_min = stamp.apply(g.sample_cost(fld.dest_cost)) / sp / 60
    near = stamp.apply(g.sample_cost(fld.nearest_stop())) if fld.net is not None else np.full(walk_min.shape, np.inf)
    out: dict[str, np.ndarray] = {}
    runs: dict[tuple[float, float], dict[str, list]] = {p: {} for p in points}
    for k, ps in profs.items():
        acc = np.zeros(walk_min.shape)
        for prof in ps:
            cost, src = fld.profile_cost(prof)
            acc += stamp.apply(g.sample_cost(cost)) / sp / 60
            ld = prof.ld_array()
            for p in points:
                c, s = fld.point(cost, src, *p)
                mins = c / sp / 60
                a = c / sp - (prof.arrive_by - float(ld[s])) if s >= 0 else c / sp
                runs[p].setdefault(k, []).append((mins, s, a))
        out[k] = acc / len(ps)
    walks = {p: fld.point(fld.dest_cost, np.full(g.n, -1), *p)[0] for p in points}
    return out, walk_min, near, runs, walks
