"""Self-checks on a built site model, so datum and placement mistakes surface before anyone reads the
sun hours (the kinds of error a manual audit of an earlier model found: a 5 m ground-plane datum
error, a window anchor 7 cm outside its own building, a window on a party wall).

Each check is ``{"id", "status": "pass" | "warn" | "fail", "msg"}``. ``fail`` means a number in
the site file is probably wrong; ``warn`` means it deserves a look.
"""
from __future__ import annotations

import math

from ..sun import components_of
from .neighbours import _ang, _bearing, _ring, inside_other, nearest_point, reference_point
from .shapes import dist_to_ring, point_in_poly

ORIGIN_TOL_M = 15.0
ANCHOR_IN_M = 0.2
OUT_OFFSETS = (0.5, 1.0, 1.5)


def _c(cid: str, status: str, msg: str) -> dict:
    return {"id": cid, "status": status, "msg": msg}


def site_checks(site: dict, face: dict | None = None) -> list[dict]:
    out: list[dict] = []
    ti = site.get("target")
    if ti is None:
        return [_c("target", "fail", "no footprint was matched to the listing")]
    top, g, _t, flat = site["b"][ti]
    ring = _ring(flat)
    holes = [[tuple(p) for p in h] for h in (site.get("holes") or {}).get(str(ti), [])]
    how = (site.get("provenance") or {}).get("target")

    # 1. the geocoded origin should be in (or right next to) the target
    d0 = dist_to_ring(0, 0, ring)
    if d0 == 0:
        out.append(_c("origin", "pass", "address point is inside the target footprint"))
    elif d0 <= ORIGIN_TOL_M:
        out.append(_c("origin", "pass", f"address point is {d0:.1f} m outside the target footprint"))
    else:
        out.append(_c("origin", "warn", f"address point is {d0:.0f} m from the target footprint"
                      + (f" (building matched by {how.upper()})" if how in ("bin", "bbl") else
                         f" (building matched by {how})" if how in ("name", "address") else
                         ": check that the right building was picked")))

    # 2. ground datum: the target sits at 0 and its roof is above it
    if abs(g) > 0.05:
        out.append(_c("ground", "fail", f"target ground is {g:+.1f} m, not 0: every height is offset"))
    elif top <= 0:
        out.append(_c("ground", "fail", "target roof is not above its ground"))
    else:
        out.append(_c("ground", "pass", f"target ground at 0 m, roof {top:.1f} m"))

    # storey height: roof / floors outside the plausible range was clamped
    raw = site.get("floor_height_raw")
    if raw is not None:
        out.append(_c("storey", "warn", f"roof / floors = {raw:.2f} m was clamped to {site.get('floor_height_m')} m "
                      "(a tall crown, podium or bulkhead, or a floor count that misses some floors): set "
                      "--slab-height if the floor's real height is known"))

    # 3-4. the window: anchor inside the building, nothing just outside it
    w = site.get("window")
    if face is not None and w:
        (x1, y1), (x2, y2) = face["a"], face["b"]
        t = w["t"]
        ax, ay = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        b = math.radians(face["bearing"])
        nx, ny = math.sin(b), math.cos(b)
        ix, iy = ax - nx * ANCHOR_IN_M, ay - ny * ANCHOR_IN_M
        if point_in_poly(ix, iy, ring, holes):
            out.append(_c("anchor", "pass", f"window anchor is inside the target ({ANCHOR_IN_M} m in from the facade)"))
        else:
            out.append(_c("anchor", "fail", "window anchor is not inside the target footprint: the facade or "
                          "its outward direction is wrong"))
        hits = sorted({h for d in OUT_OFFSETS if (h := inside_other(site, ax + nx * d, ay + ny * d)) is not None})
        own = point_in_poly(ax + nx * OUT_OFFSETS[0], ay + ny * OUT_OFFSETS[0], ring, holes)
        if hits or own:
            who = ", ".join(_label(site, h) for h in hits) or "the target itself"
            out.append(_c("outside", "fail", f"just outside the window is {who}: the window is on a party wall "
                          "or points inward"))
        else:
            out.append(_c("outside", "pass", "open air 0.5-1.5 m outside the window"))
        # height-aware: the air just outside the glass at the window's own height (podium roofs and courts are open air)
        from .anchor import window_open_air
        z0 = (w["floor"] - 1) * float(site.get("floor_height_m", 3.2))
        air = window_open_air(site, face, t, z0 + 0.6, z0 + 2.2)
        if air["ok"]:
            out.append(_c("open-air", "pass", "open air 0.4-1.0 m outside the window at its height"))
        else:
            who = "the target itself" if air["reason"] == "host" else _label(site, air["building"])
            out.append(_c("open-air", "fail", f"at the window's height the air just outside is inside {who}: the window is not "
                          "in open air, so its sun and view numbers cannot be trusted"))
        fut = [f for f in site.get("future") or [] if f.get("ring")
               and point_in_poly(ax + nx * 1.0, ay + ny * 1.0, [tuple(p) for p in f["ring"]])]
        if fut:
            out.append(_c("outside-future", "warn", f"a filed building ({fut[0].get('name') or 'unnamed'}) "
                          "covers the spot just outside the window"))

    # 4b. component buildings: what was split, and whether the window sits on a component at its height
    comps = components_of(site)
    info = site.get("components_info") or {}
    if comps or info:
        kept = (info.get("partial") or 0) + (info.get("height_mismatch") or 0)
        msg = (f"{len(comps)} building(s) modelled as components (podium / tower / setback)"
               + (f"; {kept} with incomplete or conflicting OpenStreetMap parts kept as single prisms" if kept else ""))
        bad = info.get("problems") or []
        out.append(_c("components", "warn" if bad else "pass", msg + ("; components file: " + "; ".join(bad[:3])
                                                                     if bad else "")))
    if face is not None and w and ti in comps:
        (x1, y1), (x2, y2) = face["a"], face["b"]
        ax, ay = x1 + (x2 - x1) * w["t"], y1 + (y2 - y1) * w["t"]
        b = math.radians(face["bearing"])
        ix, iy = ax - math.sin(b) * 0.5, ay - math.cos(b) * 0.5
        z = (w["floor"] - 1) * site.get("floor_height_m", 3.2) + 1.6
        on = [c for c in comps[ti] if point_in_poly(ix, iy, [tuple(p) for p in c["ring"]])
              and float(c.get("base_m") or 0) <= z - g <= float(c["top_m"])]
        if on:
            out.append(_c("window-component", "pass", f"the window at {z:.0f} m is on the {on[0]['kind']} "
                          f"({on[0].get('source', 'component')})"))
        else:
            out.append(_c("window-component", "warn", f"at {z:.0f} m no component of this building reaches the "
                          "facade behind the window: the facade steps back there, so the window sits out in the "
                          "air. Move it to the upper facade (--bearing / --position) or check the components"))

    # 5. streets on both sides of the origin (when streets were fetched)
    named = [s for s in site.get("streets") or [] if s.get("name") and len(s.get("pts") or []) >= 2]
    if site.get("streets") is not None:
        near: dict[str, tuple[float, float]] = {}
        for s in named:
            d, px, py = _nearest_on_line(s["pts"])
            if d <= 150 and (s["name"] not in near or d < near[s["name"]][0]):
                near[s["name"]] = (d, _bearing(px, py))
        brg = [b for _d, b in near.values()]
        spread = max((_ang(a, b) for a in brg for b in brg), default=0)
        if len(near) >= 2 and spread >= 120:
            out.append(_c("streets", "pass", f"{len(near)} named streets within 150 m, on opposite sides"))
        else:
            out.append(_c("streets", "warn", f"{len(near)} named street(s) within 150 m"
                          + ("" if len(near) < 2 else ", all on one side") + ": the site may be off-centre"))

    # 6. a filed building on top of the target
    for f in site.get("future") or []:
        fr = [tuple(p) for p in f.get("ring") or []]
        if len(fr) >= 3 and (any(point_in_poly(x, y, ring) for x, y in fr) or any(point_in_poly(x, y, fr) for x, y in ring)):
            out.append(_c("future-overlap", "warn", f"filed building {f.get('name') or f.get('job')} overlaps the "
                          "target: check it is not this building"))
            break

    # 7. guessed heights where the window looks
    if w:
        x, y, _z, _ref = reference_point(site, face)
        meta = site.get("bmeta") or []
        n = dflt = 0
        for i, (_tp, _gg, _tt, fl) in enumerate(site["b"]):
            if i == ti:
                continue
            d, px, py = nearest_point(x, y, _ring(fl))
            if d <= 150 and _ang(_bearing(px - x, py - y), w["bearing"]) <= 45:
                n += 1
                m = meta[i] if i < len(meta) and meta[i] else {}
                dflt += m.get("height_src") == "default"
        share = dflt / n if n else 0
        out.append(_c("heights", "warn" if share > 0.25 else "pass",
                      f"{dflt} of {n} buildings in front of the window (150 m, +/-45 deg) have guessed heights"))

    # 8. truncated downloads
    cut = [r.get("dataset") for r in site.get("receipts") or [] if r.get("limit_hit")]
    if cut:
        out.append(_c("limits", "warn", "query hit its row limit (results may be cut off): " + ", ".join(cut)))
    return out


def _nearest_on_line(pts: list) -> tuple[float, float, float]:
    best = (math.inf, 0.0, 0.0)
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, (-x1 * dx - y1 * dy) / (dx * dx + dy * dy + 1e-12)))
        px, py = x1 + t * dx, y1 + t * dy
        d = math.hypot(px, py)
        if d < best[0]:
            best = (d, px, py)
    return best


def _label(site: dict, i: int) -> str:
    m = (site.get("bmeta") or [None] * (i + 1))[i] or {}
    return m.get("name") or m.get("address") or f"building #{i}"


def summary_line(checks: list[dict]) -> str:
    n = {s: sum(c["status"] == s for c in checks) for s in ("pass", "warn", "fail")}
    return f"{n['pass']} pass, {n['warn']} warn, {n['fail']} fail"
