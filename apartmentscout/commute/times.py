"""Commute by time of day: route the extra slots (midday, evening, late, weekend) and store them compactly.

The arrive_by trip is routed by run.py exactly as before (the layers and listing minutes you already have do not move). For
every other slot in `slots.resolve_slots` this module loads the timetable window that slot needs (a different time of
day, and for a weekend slot a different service day), runs the same router (the reverse scan for "arrive by" slots, a
forward scan for "leave at" slots, the way home), and reads off the same two things:

* a heat grid per mode set (best / subway / bus), stored as the **difference from the arrive_by grid**,
  one signed byte per cell (whole minutes), deflated. Two commutes at different times of day are mostly the same map, so the differences
  are small, mostly zero, and compress to a fraction of a full grid (layers/commute-<dest>-times.json).
* minutes at every listing, as a short list in slot order on the listing (``commute[dest].times.transit = [18, 17, 19, ...]``).

Cell and listing answers are the router's, evaluated exactly as for the arrive_by trip (same walking network, same
entrances, same land mask, same averaging over a window of departures), so the five numbers for one home are comparable.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import time
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..listings import slugify
from .grid import GridSpec, surface, surface_forward
from .gtfs import (INF, Network, access_points, best_from, best_from_forward, forward_scan, load_network, reverse_scan,
                   _hhmm)
from .slots import slot_time

NODATA = 255
SENTINEL = -128          # delta value: this cell has no answer at this time of day though it has one at arrive_by
DELTA_MAX = 126          # larger differences (in minutes) clamp


def times_path(layers_dir: Path, dest_name: str) -> Path:
    return layers_dir / f"commute-{slugify(dest_name)}-times.json"


# ---------------------------------------------------------------- the delta layer


def _quant(m: np.ndarray) -> np.ndarray:
    """Minutes (NaN = blank) as the half-minute bytes run.encode_minutes writes (255 = blank)."""
    return np.where(np.isfinite(m), np.clip(np.round(np.nan_to_num(m, nan=0.0) * 2), 0, NODATA - 1), NODATA).astype(np.int16)


def encode_delta(base: np.ndarray, slot: np.ndarray) -> str:
    """The slot's grid as a difference from the arrive_by grid: whole minutes, int8, zlib, base64.

    ``base`` and ``slot`` are minute grids (NaN = blank). A cell blank at arrive_by stays blank. A cell that has a value
    at arrive_by but none at this time is -128. Whole minutes are enough (the map's bands are five minutes wide) and
    halve the size of half-minute differences; the listing numbers in the drawer are exact. Differences clamp at 126."""
    qb, qs = _quant(base), _quant(slot)
    d = np.clip(np.round((qs - qb) / 2.0), -DELTA_MAX, DELTA_MAX)
    d = np.where(qb == NODATA, 0, np.where(qs == NODATA, SENTINEL, d)).astype(np.int8)
    return base64.b64encode(zlib.compress(d.tobytes(), 9)).decode("ascii")


def decode_delta(z: str, base_u8: np.ndarray) -> np.ndarray:
    """Minutes (NaN = blank) from encode_delta's string and the arrive_by grid's bytes (run.encode_minutes' output)."""
    d = np.frombuffer(zlib.decompress(base64.b64decode(z)), dtype=np.int8).astype(np.int16)
    qb = base_u8.astype(np.int16)
    q = np.clip(qb + 2 * d, 0, NODATA - 1)
    blank = (qb == NODATA) | (d == SENTINEL)
    return np.where(blank, np.nan, q * 0.5)


# ---------------------------------------------------------------- what a run needs


@dataclass
class SlotOut:
    """One slot's answers for a destination."""

    slot: dict
    day: str                                              # the service date routed
    clock: str                                            # 'HH:MM'
    grids: dict[str, np.ndarray] = field(default_factory=dict)       # mode set -> minutes per cell (NaN = none)
    points: dict[tuple[float, float], dict[str, float]] = field(default_factory=dict)   # (lat, lon) -> {set: minutes}


@dataclass
class TimeContext:
    """Everything the slots share across destinations in one run."""

    feeds: list
    base_day: dt.date
    speed: float
    detour: float
    max_access: float
    egress_access: float
    offsets: list[int]
    window_s: int
    access_s: dict
    net_bbox: tuple
    walker: object
    land: object | None
    log: object = print
    _nets: dict = field(default_factory=dict)

    def service_day(self, slot: dict) -> dt.date:
        """The date a slot is routed on: the search's service date for a weekday; for a weekend slot the next such day."""
        want = {"saturday": 5, "sunday": 6}.get(slot.get("day", "weekday"))
        d = self.base_day
        if want is None:
            return d
        while d.weekday() != want:
            d += dt.timedelta(days=1)
        return d

    def network(self, day: dt.date, t_lo: int, t_hi: int) -> Network:
        key = (day, t_lo, t_hi)
        if key not in self._nets:
            net = load_network(self.feeds, day, t_lo, t_hi, self.speed, self.detour, bbox=self.net_bbox, walker=self.walker,
                               access_s=self.access_s, log=lambda *_a, **_k: None)
            net.set_land(self.land)
            self._nets[key] = net
            if len(self._nets) > 3:   # slot timetables are big; keep the latest few
                self._nets.pop(next(iter(self._nets)))
        return self._nets[key]


def is_base(slot: dict, dest: dict) -> bool:
    """True for the trip run.py already routes: arrive at the destination's arrive_by on the service date."""
    return slot.get("kind", "arrive") == "arrive" and slot.get("day", "weekday") == "weekday" \
        and slot_time(slot, dest) == str(dest.get("arrive_by", "09:00"))


def _mode_sets(net: Network) -> dict[str, tuple[str, ...] | None]:
    have = net.modes_present()
    sets: dict[str, tuple[str, ...] | None] = {m: (m,) for m in have}
    sets["transit"] = None
    return sets


def route_slot(ctx: TimeContext, slot: dict, d: dict, *, fld, stamp, spec: GridSpec, points: list[tuple[float, float]],
               cell_land: np.ndarray | None = None) -> SlotOut:
    """Route one slot. ``fld`` is the NetField of the destination (street-network walking) or None (grid walking model)."""
    clock_s = _hhmm(slot_time(slot, d))
    day = ctx.service_day(slot)
    arrive = slot.get("kind", "arrive") == "arrive"
    offs = [int(o) for o in ctx.offsets]
    if arrive:
        t_lo, t_hi = clock_s - 60 * max(offs) - ctx.window_s, clock_s
    else:
        t_lo, t_hi = clock_s, clock_s + 60 * max(offs) + ctx.window_s
    net = ctx.network(day, t_lo, t_hi)
    sets = _mode_sets(net)
    dest = (d["lat"], d["lon"])
    out = SlotOut(slot, str(day), slot_time(slot, d))
    if fld is not None:
        from .netroute import time_surface
        f = fld.rebind(net)
        if arrive:
            eg = f.egress()
            profs = {k: [reverse_scan(net, *dest, clock_s - 60 * o, ctx.speed, ctx.detour, ctx.max_access, modes=s,
                                      egress_access=ctx.egress_access, egress=eg) for o in offs] for k, s in sets.items()}
        else:
            ing = f.ingress()
            profs = {k: [forward_scan(net, *dest, clock_s + 60 * o, ctx.speed, ctx.detour, ctx.max_access, modes=s,
                                      egress_access=ctx.egress_access, ingress=ing) for o in offs] for k, s in sets.items()}
        grids, per_point = time_surface(f, profs, stamp, points, forward=not arrive)
        out.grids = grids
        for p, by_k in per_point.items():
            out.points[p] = {k: float(np.mean(v)) for k, v in by_k.items()}
        return out
    # grid walking model: the straight-line / street-grid walker, as run.py's _Router does
    walker = ctx.walker
    if arrive:
        profs = {k: [reverse_scan(net, *dest, clock_s - 60 * o, ctx.speed, ctx.detour, ctx.max_access, modes=s,
                                  egress_access=ctx.egress_access) for o in offs] for k, s in sets.items()}
        srf = surface(net, profs, dest, spec, ctx.max_access, walker, cell_land=cell_land, stop_land=net.stop_land())
    else:
        profs = {k: [forward_scan(net, *dest, clock_s + 60 * o, ctx.speed, ctx.detour, ctx.max_access, modes=s,
                                  egress_access=ctx.egress_access) for o in offs] for k, s in sets.items()}
        srf = surface_forward(net, profs, dest, spec, ctx.max_access, walker, cell_land=cell_land, stop_land=net.stop_land())
    out.grids = dict(srf.minutes)
    for lat, lon in points:
        acc = access_points(net, lat, lon, ctx.max_access, ctx.speed, ctx.detour)
        ws = walker.metres(lat, lon, *dest) / walker.speed_ms
        row = {}
        for k, ps in profs.items():
            if arrive:
                row[k] = float(np.mean([best_from(p, acc, ws)[0] for p in ps]))
            else:
                row[k] = float(np.mean([best_from_forward(p, acc, ws) for p in ps]))
        out.points[(lat, lon)] = row
    return out


# ---------------------------------------------------------------- writing

MODE_ORDER = ("transit", "subway", "bus")


def listing_times(slots: list[dict], d: dict, base_modes: dict[str, float | None], outs: dict[str, SlotOut],
                  point: tuple[float, float], digits: int = 1) -> dict[str, list]:
    """{mode set: [minutes per slot in slot order]} for one listing; None where the slot was not routed or has no answer."""
    res: dict[str, list] = {}
    modes = [m for m in MODE_ORDER if m in base_modes or any(m in o.grids for o in outs.values())]
    for m in modes:
        row: list = []
        for s in slots:
            if is_base(s, d):
                v = base_modes.get(m)
            else:
                o = outs.get(s["id"])
                v = (o.points.get(point) or {}).get(m) if o else None
            row.append(None if v is None or not np.isfinite(v) or v >= 120 else round(float(v), digits))
        if any(v is not None for v in row):
            res[m] = row
    return res


def write_times_layer(path: Path, d: dict, slots: list[dict], outs: dict[str, SlotOut], base_grids: dict[str, np.ndarray],
                      base: dict, offsets: list[int], log=print) -> Path | None:
    """layers/commute-<dest>-times.json: the delta grids of every routed slot against the arrive_by grids (``base_grids``,
    mode set -> minutes with NaN for blank, exactly as written to the arrive_by layers)."""
    grids: dict[str, dict[str, str]] = {}
    for m in MODE_ORDER:
        if m not in base_grids:
            continue
        per = {}
        for s in slots:
            o = outs.get(s["id"])
            if o is None or m not in o.grids:
                continue
            g = np.where(~np.isfinite(o.grids[m]) | (o.grids[m] >= 120), np.nan, o.grids[m])
            per[s["id"]] = encode_delta(base_grids[m], g)   # a cell blank at arrive_by (water, out of reach) stays blank
        if per:
            grids[m] = per
    if not grids:
        return None
    doc = {"kind": "commute-times", "name": d["name"], "destination": {k: d.get(k) for k in ("name", "address", "lat", "lon")},
           "arrive_by": d.get("arrive_by", "09:00"), "slots": [
               {"id": s["id"], "label": s["label"], "kind": s.get("kind", "arrive"), "time": slot_time(s, d),
                "day": s.get("day", "weekday"), "base": is_base(s, d),
                "service_date": outs[s["id"]].day if s["id"] in outs else None} for s in slots],
           "arrival_offsets_min": offsets, "bbox": base["bbox"], "rows": base["rows"], "cols": base["cols"], "cell_m": base["cell_m"],
           "scale": 0.5, "nodata": NODATA, "encoding": "int8 whole-minute differences from the arrive_by layer of the same mode, zlib, base64; -128 = blank at this time",
           "modes": list(grids), "feeds": base.get("feeds"), "walk_model": base.get("walk_model"), "grids": grids,
           "method": "the same router as the arrive_by layer at each time: arrive-by slots scan backwards from the arrival, "
                     "leave-at slots scan forwards from the destination (the way home), averaged over the same window of times",
           "generated": dt.datetime.now().isoformat(timespec="seconds")}
    path.write_text(json.dumps(doc, separators=(",", ":")))
    log(f"    layer {path.name}: {path.stat().st_size / 1024:.0f} KB ({sum(len(v) for v in grids.values())} grids)")
    return path


def resolved_slots(slots: list[dict], dest: dict | None = None) -> list[dict]:
    """The slot list as the dashboard reads it (criteria.json commute.times.slots)."""
    out = []
    for s in slots:
        out.append({"id": s["id"], "label": s["label"], "kind": s.get("kind", "arrive"), "time": s.get("time"),
                    "day": s.get("day", "weekday")})
    return out


# ---------------------------------------------------------------- the entry point


def _base_layer(layers_dir: Path, dest_name: str, mode: str) -> dict | None:
    from .combine import layer_path
    p = layer_path(layers_dir, dest_name, mode)
    return json.loads(p.read_text()) if p.exists() else None


def _layer_minutes(layer: dict) -> np.ndarray:
    q = np.frombuffer(base64.b64decode(layer["values_u8"]), dtype=np.uint8)
    return np.where(q == NODATA, np.nan, q * float(layer.get("scale", 0.5))).reshape(layer["rows"], layer["cols"])


def run_times(ws, listings: list[dict], crit: dict, log=print, layers_dir: Path | None = None, only: list[str] | None = None,
              only_dests: list[str] | None = None, write_layers: bool = True) -> dict[str, dict]:
    """Route the extra time-of-day slots for every destination and write them.

    Needs the arrive_by layers (`apartmentscout commute`) to exist: the grids are stored as differences from them, on the
    same cells, and the arrive_by minutes on each listing are the first number of its ``times`` list. Sets
    ``L["commute"][dest]["times"]`` on every geocoded listing (or the ``only`` ids), writes
    ``layers/commute-<dest>-times.json`` unless write_layers is false, and returns {dest: {slot id: SlotOut}}."""
    from . import slots as SL
    from .run import (DEFAULT_OFFSETS, _access_cfg, _bbox, _build_walk_graph, _next_weekday, _pad, city_profile, feed_specs,
                      land_source, load_land, make_walker, walk_model)
    if not SL.enabled(crit):
        log("  commute by time of day: switched off (commute.times: false)")
        return {}
    slots = SL.resolve_slots(crit)
    cm = crit.get("commute") or {}
    dests = [d for d in cm.get("destinations") or [] if d.get("lat") is not None]
    run_dests = [d for d in dests if only_dests is None or d["name"] in set(only_dests)]
    tr = cm.get("transit") or {}
    feeds = feed_specs(ws, crit, log)
    if not feeds:
        log("  commute by time of day: no transit feeds, so every time of day is the same walk; skipped")
        return {}
    out_dir = layers_dir or ws.layers_dir
    speed = (tr.get("walk_speed_kmh") or 4.8) / 3.6
    detour = tr.get("walk_detour", 1.25)
    max_access = tr.get("max_walk_to_station_m", 1200)
    offsets = [int(o) for o in tr.get("arrival_offsets_min", DEFAULT_OFFSETS)]
    window = 60 * int(tr.get("window_min", 150))
    egress_access = float(tr.get("egress_access", 1))
    snap_m = float(tr.get("walk_snap_m", 60))
    day = dt.date.fromisoformat(str(tr.get("service_date") or _next_weekday()))
    walker = make_walker(crit)
    model = walk_model(crit)
    bbox = _bbox(listings, dests, 1500)
    for d in run_dests:   # the walking network and stops must cover the cells already on disk, whatever the listings are now
        b0 = _base_layer(out_dir, d["name"], "transit")
        if b0 and any(abs(a - b) > 0.002 for a, b in zip(b0["bbox"], bbox)):   # a layer from other listings: cover both
            bbox = (min(bbox[0], b0["bbox"][0]), min(bbox[1], b0["bbox"][1]), max(bbox[2], b0["bbox"][2]), max(bbox[3], b0["bbox"][3]))
    net_bbox = _pad(bbox, max(max_access, 1000) + 1000)
    land = load_land(land_source(crit, city_profile(crit)), ws.cache_dir, net_bbox, log)
    ctx = TimeContext(feeds, day, speed, detour, max_access, egress_access, offsets, window, _access_cfg(tr), net_bbox,
                      walker, land, log)
    wanted = set(only) if only is not None else None
    timed = [L for L in listings if (wanted is None or L.get("id") in wanted) and L.get("lat") is not None]
    points = sorted({(round(L["lat"], 6), round(L["lon"], 6)) for L in timed})
    graph = None
    results: dict[str, dict] = {}
    for d in run_dests:
        base = _base_layer(out_dir, d["name"], "transit")
        if base is None:
            log(f"  {d['name']}: no arrive_by layer yet (run `apartmentscout commute` first); time of day skipped")
            continue
        t0 = time.time()
        lo0, la0, lo1, la1 = base["bbox"]
        spec = GridSpec(lo0, la0, (lo1 - lo0) / base["cols"], (la1 - la0) / base["rows"], base["rows"], base["cols"])
        arrive = _hhmm(str(d.get("arrive_by", "09:00")))
        net0 = ctx.network(day, arrive - 60 * max(offsets) - window, arrive)
        if model == "network" and graph is None:
            try:
                from .walknet import CellStamp
                g, plan, rec = _build_walk_graph(ws, crit, tr, net0, feeds, dests, listings, _pad(bbox, 1000), log)
                graph = (g, plan, rec, CellStamp.build(g, spec, snap_m))
            except Exception as e:  # noqa: BLE001 - as run.py: any failure falls back to the grid metric
                graph = False
                log(f"  walking: street network unavailable ({e}); using the grid metric")
        made_with, now_with = base.get("walk_model") or "grid", "network" if graph else "grid"
        if made_with != now_with:   # minutes made with another walking model would not be comparable with the arrive_by ones
            log(f"  {d['name']}: the arrive_by layer was made with the {made_with} walking model and this run has the {now_with} one "
                f"({'the street network could not be loaded; try again' if made_with == 'network' else 'run `apartmentscout commute` again'}); "
                "time of day skipped so the numbers stay comparable")
            continue
        fld = stamp = None
        if graph:
            from .netroute import NetField
            fld = NetField(graph[0], graph[1], net0, d["name"], speed, max_access * detour, snap_m)
            stamp = graph[3]
        cell_land = None
        if fld is None and land is not None:
            la, lo = spec.centres()
            LA, LO = np.meshgrid(la, lo, indexing="ij")
            cell_land = land.at(LA, LO)
        layers = {m: _base_layer(out_dir, d["name"], m) for m in MODE_ORDER}
        base_grids = {m: _layer_minutes(L) for m, L in layers.items()
                      if L and L["rows"] == base["rows"] and L["cols"] == base["cols"]}
        outs: dict[str, SlotOut] = {}
        for s in slots:
            if is_base(s, d):
                continue
            t1 = time.time()
            try:
                outs[s["id"]] = route_slot(ctx, s, d, fld=fld, stamp=stamp, spec=spec, points=points, cell_land=cell_land)
            except ValueError as e:   # a feed with no service on that kind of day (no weekend timetable): say so, go on
                log(f"    {d['name']} / {s['label']}: skipped ({str(e).split(';')[0]})")
                continue
            log(f"    {d['name']} / {s['label']} ({SL.slot_phrase(s, d)}, {outs[s['id']].day}): {time.time() - t1:.1f}s")
        n = 0
        for L in timed:
            e = (L.get("commute") or {}).get(d["name"])
            if not e:
                continue
            bm = {m: ((e.get("modes") or {}).get(m) or {}).get("minutes") for m in MODE_ORDER}
            bm["transit"] = bm["transit"] if bm["transit"] is not None else e.get("minutes")
            t = listing_times(slots, d, bm, outs, (round(L["lat"], 6), round(L["lon"], 6)))
            if t:
                e["times"] = t
                n += 1
        if write_layers and wanted is None:
            write_times_layer(times_path(out_dir, d["name"]), d, slots, outs, base_grids, base, offsets, log)
        log(f"  {d['name']}: {len(outs)} extra times of day, {n} listings ({time.time() - t0:.1f}s)")
        results[d["name"]] = outs
    return results
