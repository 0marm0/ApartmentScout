"""`apartmentscout surroundings`: fetch the buildings around every home you are serious about, and say how good the data is. [onboarding]

    apartmentscout surroundings                  the shortlist (else the top 5): build each home's site model
    apartmentscout surroundings ID [ID ...]      just these homes
    apartmentscout surroundings --all            every open listing
    apartmentscout surroundings --status         what is covered and how well, without fetching anything

A site model is the file `apartmentscout site <id>` writes: the footprints and heights of the buildings within 600 m
(OpenStreetMap; the city's own open data where its profile has it), streets, parks, trees and water, and the sun and view
study for the window. Unit 3D, the sun hours, the view and the floor plan studio's real sun all read it. This command runs
`site` for several homes in a row, keeps going when one fails, and reports coverage: how many buildings had to use a default
height (OpenStreetMap often lacks heights), which building each home was matched to, and what the city does not provide.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

from ..quality.workspace import load_listings, search_from

CLOSED = ("gone", "rejected")
NEAR_M = 150.0          # buildings this close decide the sun and the view; their height quality is reported on its own
DEFAULT_TOP = 5         # when nothing is shortlisted yet


def pick_targets(listings: list[dict], ids: list[str] | None, everything: bool) -> tuple[list[dict], str]:
    """The homes to cover and a phrase saying why those: given ids, every open listing, the shortlist, else the top five."""
    open_ = [L for L in listings if L.get("status") not in CLOSED]
    if ids:
        by = {L["id"]: L for L in listings}
        out = []
        for k in ids:
            L = by.get(k) or next(iter([x for x in listings if k.lower() in x["id"]]), None)
            if L is None:
                sys.exit(f"No listing matches '{k}'.")
            out.append(L)
        return out, "the listings you named"
    if everything:
        return open_, "every open listing"
    short = [L for L in open_ if L.get("status") in ("shortlist", "touring", "applied") or L.get("favorite")]
    if short:
        return short, "the shortlist"
    ranked = sorted((L for L in open_ if (L.get("score") or {}).get("rank")), key=lambda L: L["score"]["rank"])
    pool = ranked or open_
    return pool[:DEFAULT_TOP], f"the top {min(DEFAULT_TOP, len(pool))} (nothing is shortlisted yet; set status to shortlist, or use --all)"


def site_summary(site: dict) -> dict[str, Any]:
    """Coverage facts from a site file: sources, how many heights are real, the matched building, the context layers."""
    meta = site.get("bmeta") or []
    by_src = Counter(m.get("height_src") or "default" for m in meta)
    near = [r for r in ((site.get("neighbours") or {}).get("rows") or []) if r and r[1] <= NEAR_M]
    near_default = sum(1 for r in near if 0 <= r[0] < len(meta) and (meta[r[0]].get("height_src") or "default") == "default")
    prov = site.get("provenance") or {}
    ti = site.get("target")
    tm = meta[ti] if isinstance(ti, int) and 0 <= ti < len(meta) else {}
    green = site.get("green") or {}
    return {
        "source": site.get("source") or "?",
        "generated": site.get("generated"),
        "buildings": len(meta),
        "default_height": by_src.get("default", 0),
        "heights": {k: v for k, v in by_src.items() if k != "default"},
        "near": len(near), "near_default": near_default,
        "target": {"name": tm.get("name"), "address": tm.get("address"), "floors": tm.get("floors"),
                   "matched_by": prov.get("target"), "offset_m": prov.get("target_offset_m"), "height_src": tm.get("height_src")},
        "parks": len([p for p in green.get("polys") or []]) if isinstance(green.get("polys"), list) else green.get("polys", 0),
        "trees": len(green.get("trees") or []) if isinstance(green.get("trees"), list) else green.get("trees", 0),
        "water": bool(site.get("water")),
        "streets": bool(site.get("streets")),
        "future": len((site.get("future") or {}).get("rows") or []) if isinstance(site.get("future"), dict) else 0,
        "checks": [f"{c['status']}: {c['msg']}" for c in site.get("checks") or [] if c.get("status") != "pass"],
        "exposure": prov.get("exposure"),
        "floor_height_src": site.get("floor_height_src"),
    }


def status_rows(ws: Any, listings: list[dict]) -> list[dict[str, Any]]:
    """One row per listing: does it have a site model, a plan, coordinates; and the site's coverage summary."""
    rows = []
    for L in listings:
        f = ws.root / "sites" / f"{L['id']}.json"
        row: dict[str, Any] = {"id": L["id"], "label": f"{L.get('building') or ''} {L.get('unit') or ''}".strip() or L["id"],
                               "address": L.get("address"), "geocoded": L.get("lat") is not None,
                               "has_plan": (ws.root / "plans" / f"{L['id']}.json").exists(), "site": None}
        if f.exists():
            try:
                row["site"] = site_summary(json.loads(f.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                row["site"] = {"error": "the site file could not be read; rebuild it"}
        rows.append(row)
    return rows


def format_row(r: dict[str, Any]) -> list[str]:
    head = f"{r['id']}  ({r['label']}{', ' + r['address'] if r.get('address') else ''})"
    s = r["site"]
    if not r["geocoded"]:
        return [head, "   not placed on the map yet: run `apartmentscout geocode`"]
    if s is None:
        return [head, "   no site model yet"]
    if "error" in s:
        return [head, f"   {s['error']}"]
    out = [head, f"   site model  {s['generated'] or '?'} · {s['source']}"]
    h = f"   buildings   {s['buildings']} around the home; {s['default_height']} use a default 10 m height"
    if s["near"]:
        h += f" ({s['near_default']} of the {s['near']} within {NEAR_M:.0f} m)"
    out.append(h)
    t = s["target"]
    if t.get("matched_by"):
        who = t.get("name") or t.get("address") or "an unnamed building"
        off = f", {t['offset_m']:.0f} m from the address point" if t.get("offset_m") else ""
        out.append(f"   the home    matched to {who} by {t['matched_by']}{off}" + (f" ({t['floors']} floors)" if t.get("floors") else ""))
    ctx = [f"{s['parks']} park areas" if s["parks"] else None, f"{s['trees']} trees" if s["trees"] else None,
           "water" if s["water"] else None, "streets" if s["streets"] else None]
    out.append("   around      " + (", ".join(c for c in ctx if c) or "no parks, trees, water or streets"))
    out.append("   floor plan  " + ("yes" if r["has_plan"] else "none yet (apartmentscout plans)"))
    for c in s["checks"]:
        out.append(f"   check       {c}")
    return out


def advice(rows: list[dict[str, Any]], city: str | None, profile: bool) -> list[str]:
    """What the coverage means and what to do about it, from the rows."""
    built = [r["site"] for r in rows if r["site"] and "error" not in r["site"]]
    lines: list[str] = []
    if not built:
        return lines
    weak = [r for r in rows if r["site"] and "error" not in r["site"] and r["site"]["near"]
            and r["site"]["near_default"] / r["site"]["near"] > 0.4]
    if weak:
        lines.append(f"{len(weak)} home{'s have' if len(weak) != 1 else ' has'} more than 40% default heights close by "
                     f"({', '.join(r['id'] for r in weak[:4])}{'...' if len(weak) > 4 else ''}). Sun hours and the view there are "
                     "estimates: nearby towers may be missing or too low. Add `height` or `building:levels` to the buildings on "
                     "openstreetmap.org (then `apartmentscout surroundings --refresh ID`), or describe the ones that matter in sites/<id>.components.yaml.")
    off = [r for r in rows if r["site"] and "error" not in r["site"] and (r["site"]["target"].get("offset_m") or 0) > 25]
    if off:
        lines.append(f"{len(off)} home{'s were' if len(off) != 1 else ' was'} matched to a building more than 25 m from the address point "
                     f"({', '.join(r['id'] for r in off[:4])}). Open the Unit 3D tab: if the highlighted building is wrong, set the listing's "
                     "lat and lon to a point inside the right building in listings.json and run `apartmentscout surroundings --rebuild ID`.")
    if not profile:
        lines.append("Not available for this city (needs a city profile): filed or proposed new buildings, and the expected sun "
                     "with typical cloud (the model shows possible direct sun). Buildings, streets, parks, trees and water come from "
                     "OpenStreetMap.")
    return lines


def cmd_surroundings(args: argparse.Namespace) -> None:
    ws = search_from(args)
    crit = ws.criteria()
    city = (crit.get("search") or {}).get("city")
    from ..cities import load_profile
    profile = bool(load_profile(city))
    listings = load_listings(ws)
    targets, why = pick_targets(listings, args.ids, args.all)
    if not targets:
        sys.exit("No listings yet. Add some first: apartmentscout import listings.csv")
    print(f"Surroundings for {why}: {len(targets)} home{'s' if len(targets) != 1 else ''}", flush=True)
    if not args.status:
        run(ws, targets, args)
        listings = load_listings(ws)
        targets = [next((x for x in listings if x["id"] == L["id"]), L) for L in targets]
    rows = status_rows(ws, targets)
    print("", flush=True)
    for r in rows:
        print("\n".join(format_row(r)), flush=True)
    for line in advice(rows, city, profile):
        print(f"\nNote: {line}", flush=True)
    todo = [r["id"] for r in rows if r["site"] is None and r["geocoded"]]
    if todo and args.status:
        print(f"\n{len(todo)} without a site model: run `apartmentscout surroundings` to fetch them.", flush=True)
    print("\nNext: `apartmentscout build` then open the Unit 3D tab. Floor plans: `apartmentscout plans`.", flush=True)


def run(ws: Any, targets: list[dict], args: argparse.Namespace) -> None:
    """Run `apartmentscout site` for each target, one after another; a failure is reported and the rest carry on."""
    from ..cli import main
    done = failed = skipped = 0
    for i, L in enumerate(targets, 1):
        tag = f"[{i}/{len(targets)}] {L['id']}"
        if L.get("lat") is None:
            print(f"{tag}: not placed on the map, skipped (run `apartmentscout geocode`)", flush=True)
            skipped += 1
            continue
        if (ws.root / "sites" / f"{L['id']}.json").exists() and not (args.rebuild or args.refresh):
            print(f"{tag}: already has a site model (--rebuild to redo it)", flush=True)
            skipped += 1
            continue
        t0 = time.time()
        argv = ["site", L["id"], "--search", str(ws.root), "--radius", str(args.radius)] + (["--refresh"] if args.refresh else [])
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                main(argv)
        except SystemExit as e:
            if e.code not in (None, 0):
                print(f"{tag}: failed - {e.code}", flush=True)
                failed += 1
                continue
        except Exception as e:  # noqa: BLE001 - one home failing (network, a bad coordinate) must not stop the others
            busy = " OpenStreetMap's Overpass servers are busy or down; wait a few minutes and run this again (finished homes are kept)." \
                if "overpass" in str(e).lower() else f" Run `apartmentscout site {L['id']}` to see the detail."
            print(f"{tag}: failed - {type(e).__name__}: {str(e)[:160]}.{busy}", flush=True)
            failed += 1
            continue
        if args.verbose:
            print(buf.getvalue(), end="", flush=True)
        n = next((ln.strip() for ln in buf.getvalue().splitlines() if "buildings, target" in ln), "")
        print(f"{tag}: done in {time.time() - t0:.0f} s" + (f" ({n})" if n else ""), flush=True)
        done += 1
    print(f"\n{done} built, {skipped} skipped, {failed} failed.", flush=True)


def register(add) -> None:
    s = add("surroundings", cmd_surroundings, "fetch the buildings, parks and streets around your homes and report how complete the data is")
    s.add_argument("ids", nargs="*", help="listing ids (default: the shortlist, else the top five)")
    s.add_argument("--all", action="store_true", help="every open listing, not just the shortlist")
    s.add_argument("--status", action="store_true", help="only report what is covered; fetch nothing")
    s.add_argument("--rebuild", action="store_true", help="redo homes that already have a site model (cached downloads are reused)")
    s.add_argument("--refresh", action="store_true", help="redo them and download everything again")
    s.add_argument("--radius", type=float, default=600, help="metres around each home (default 600)")
    s.add_argument("--verbose", action="store_true", help="show each home's full `site` output")
