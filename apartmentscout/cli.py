"""ApartmentScout command line.

    apartmentscout init my-search --city nyc       start a search folder
    apartmentscout import listings.csv             add listings from CSV/JSON
    apartmentscout geocode                         add coordinates (and NYC BBL/BIN)
    apartmentscout commute                         transit commute grid + per-listing times
    apartmentscout layers                          city layers (NYC: 311 noise density)
    apartmentscout dossier <id>|--shortlist        public building records
    apartmentscout site <id> [--floor N]           3D site model + sun and view study
    apartmentscout score                           score and rank against criteria.yaml
    apartmentscout report                          markdown shortlist report
    apartmentscout build                           export everything to the dashboard
    apartmentscout serve                           open the dashboard locally
    apartmentscout all                             geocode, commute, layers, score, build

Every command takes --search PATH (default: the folder in $APARTMENTSCOUT_SEARCH or ./search).
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.server
import json
import os
import shutil
import socketserver
import sys
import webbrowser
from pathlib import Path

from . import __version__
from .config import Workspace, load_criteria
from .listings import CSV_TEMPLATE_COLUMNS, load, normalize, save

REPO = Path(__file__).resolve().parent.parent
DASH = REPO / "dashboard"


def city_profile(city: str | None) -> dict:
    import yaml
    p = REPO / "config" / "cities" / f"{city}.yaml"
    return (yaml.safe_load(p.read_text()) or {}) if city and p.exists() else {}


def log(*a):
    print(*a, flush=True)


def ws_from(args) -> Workspace:
    root = Path(args.search or os.environ.get("APARTMENTSCOUT_SEARCH") or "search").resolve()
    if not (root / "criteria.yaml").exists():
        sys.exit(f"No criteria.yaml in {root}. Run `apartmentscout init {root.name}` or pass --search.")
    return Workspace(root)


def _listings(ws: Workspace) -> list[dict]:
    return load(ws.listings_path) if ws.listings_path.exists() else []


def _find(listings, key):
    for L in listings:
        if L["id"] == key:
            return L
    m = [L for L in listings if key.lower() in L["id"]]
    if len(m) == 1:
        return m[0]
    sys.exit(f"No unique listing matches '{key}'. Candidates: {[x['id'] for x in m][:10]}")


# --------------------------------------------------------------------------- commands
def cmd_init(args):
    root = Path(args.path).resolve()
    if (root / "criteria.yaml").exists() and not args.force:
        sys.exit(f"{root} already has a criteria.yaml (use --force to overwrite).")
    root.mkdir(parents=True, exist_ok=True)
    src = REPO / "config" / "criteria.example.yaml"
    text = src.read_text()
    if args.city:
        text = text.replace("city: generic", f"city: {args.city}")
        prof = city_profile(args.city)
        if prof.get("timezone"):
            text = text.replace("timezone: America/New_York", f"timezone: {prof['timezone']}")
        if prof.get("transit_feeds"):
            feeds = "\n".join(f"      - {{name: {f['name']}, url: {f['url']}}}" for f in prof["transit_feeds"])
            text = text.replace("    feeds: []                # add GTFS feeds: - {name: City Metro, url: https://.../gtfs.zip}",
                                "    feeds:\n" + feeds)
    (root / "criteria.yaml").write_text(text)
    (root / "research").mkdir(exist_ok=True)
    (root / "plans").mkdir(exist_ok=True)
    if not (root / "listings.json").exists():
        save([], root / "listings.json")
    with (root / "listings.template.csv").open("w") as f:
        f.write(",".join(CSV_TEMPLATE_COLUMNS) + "\n")
    log(f"Created {root}\n  1. Edit criteria.yaml (budget, must-haves, commute addresses).\n"
        f"  2. Add listings: `apartmentscout import listings.csv` or ask your agent to research them.\n"
        f"  3. `apartmentscout all --search {root}` then `apartmentscout serve --search {root}`.")


def cmd_import(args):
    ws = ws_from(args)
    have = {L["id"]: L for L in _listings(ws)}
    new = load(args.file)
    added = updated = 0
    for L in new:
        if L["id"] in have:
            have[L["id"]] = _merge(have[L["id"]], L)
            updated += 1
        else:
            have[L["id"]] = L
            added += 1
    save(have.values(), ws.listings_path)
    log(f"{added} added, {updated} updated -> {ws.listings_path}")


def _merge(old: dict, new: dict) -> dict:
    out = dict(old)
    for k, v in new.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **{kk: vv for kk, vv in v.items() if vv is not None}}
        elif v not in (None, "", [], {}):
            out[k] = v
    return out


def cmd_geocode(args):
    from .geocode import Geocoder, geocode_listings
    ws = ws_from(args)
    crit = ws.criteria()
    city = crit["search"].get("city")
    Ls = _listings(ws)
    n = geocode_listings(Ls, ws.cache_dir / "geocode.json", city, args.provider, args.force, log)
    save(Ls, ws.listings_path)
    g = Geocoder(ws.cache_dir / "geocode.json", city)
    changed = False
    for d in crit["commute"]["destinations"]:
        if d.get("lat") is None and d.get("address"):
            r = g.geocode(d["address"])
            if r:
                d["lat"], d["lon"] = round(r["lat"], 6), round(r["lon"], 6)
                changed = True
                log(f"  destination {d['name']}: {d['lat']}, {d['lon']}  (copy these into criteria.yaml)")
    g.save()
    log(f"Geocoded {n} listings.")


def cmd_commute(args):
    from .commute.run import run_commute
    ws = ws_from(args)
    Ls = _listings(ws)
    run_commute(ws, Ls, ws.criteria(), cell_m=args.cell, log=log)
    save(Ls, ws.listings_path)


def cmd_layers(args):
    ws = ws_from(args)
    crit = ws.criteria()
    if crit["search"].get("city") != "nyc":
        log("No built-in city layers for this city yet. See docs/guides/new-city.md to add one.")
        return
    from .commute.run import _bbox
    from .layers import nyc_noise_layer
    bbox = list(_bbox(_listings(ws), crit["commute"]["destinations"], 1500))
    nyc_noise_layer(ws, bbox, months=args.months, log=log)


def cmd_dossier(args):
    ws = ws_from(args)
    crit = ws.criteria()
    Ls = _listings(ws)
    targets = [_find(Ls, k) for k in args.ids] if args.ids else [
        L for L in Ls if L.get("status") in ("shortlist", "touring", "applied") or L.get("favorite")]
    if crit["search"].get("city") != "nyc":
        sys.exit("Built-in records exist for NYC only. For other cities, follow the building-dossier skill "
                 "(.claude/skills/building-dossier) and save findings to research/<id>.md.")
    from .records.nyc import build_dossier, save_dossier
    out = ws.research_dir / "dossiers"
    done = {}
    for L in targets:
        key = L.get("bbl") or L.get("address")
        log(f"  {L['id']}")
        if key in done:
            D = dict(done[key], id=L["id"])
        else:
            D = build_dossier(L, ws, log)
            done[key] = D
        save_dossier(D, out)
        L["records"] = {**D["summary"], "dossier": f"dossiers/{L['id']}.json"}
    save(Ls, ws.listings_path)
    log(f"Dossiers in {out}")


def cmd_site(args):
    from .geo.buildings import build_site, fetch_nyc, fetch_osm, nyc_landmark_names
    from .sun import pick_face, sun_study, target_faces
    ws = ws_from(args)
    crit = ws.criteria()
    Ls = _listings(ws)
    L = _find(Ls, args.id)
    if L.get("lat") is None:
        sys.exit("Listing has no coordinates. Run `apartmentscout geocode` first.")
    city = crit["search"].get("city")
    log(f"  footprints around {L['id']} ({'NYC Open Data' if city == 'nyc' else 'OpenStreetMap'})")
    if city == "nyc":
        bs = fetch_nyc(L["lat"], L["lon"], args.radius)
        names = nyc_landmark_names([b["bbl"] for b in sorted(bs, key=lambda b: -b["height"])[:40]])
        site = build_site(L, bs, "NYC Building Footprints", names, city_profile(city).get("landmarks"))
    else:
        bs = fetch_osm(L["lat"], L["lon"], args.radius)
        site = build_site(L, bs, "OpenStreetMap contributors (ODbL)", None,
                          (crit.get("landmarks") or []) + (city_profile(city).get("landmarks") or []))
    floor = args.floor or int(L.get("floor") or 5)
    faces = target_faces(site)
    face = None
    if args.bearing is not None:
        face = min(faces, key=lambda f: abs((f["bearing"] - args.bearing + 540) % 360 - 180))
    else:
        face = pick_face(faces, L.get("exposure"))
    site["faces"] = [{k: f[k] for k in ("i", "bearing", "length")} for f in faces]
    if face:
        tz = crit["search"].get("timezone") or "America/New_York"
        st = sun_study(site, face, floor, tz, dt.date.today().year)
        site["window"] = {"face": face["i"], "bearing": face["bearing"], "floor": floor, "t": 0.5}
        site["study"] = {k: st[k] for k in ("sun_hours", "floors_table", "skyline_ahead_deg", "open_sky_share")}
        L["site"] = {"file": f"sites/{L['id']}.json", "floor": floor, "bearing": face["bearing"],
                     "sun_hours": st["sun_hours"], "skyline_ahead_deg": st["skyline_ahead_deg"],
                     "open_sky_share": st["open_sky_share"]}
        log(f"  window faces {face['bearing']:.0f} deg, floor {floor}: direct sun h/day by month {st['sun_hours']}")
    else:
        L["site"] = {"file": f"sites/{L['id']}.json"}
        log("  exposure unknown: pick the facade in the dashboard (Unit 3D tab) or pass --bearing.")
    site["timezone"] = crit["search"].get("timezone") or "America/New_York"
    (ws.sites_dir / f"{L['id']}.json").write_text(json.dumps(site, separators=(",", ":")))
    save(Ls, ws.listings_path)
    if args.charts and face:
        from .charts import sun_charts
        for p in sun_charts(site, face, floor, ws.research_dir / "charts", L["id"]):
            log(f"  chart {p}")


def cmd_score(args):
    from .score import score_all
    ws = ws_from(args)
    Ls = _listings(ws)
    score_all(Ls, ws.criteria())
    save(Ls, ws.listings_path)
    top = sorted((L for L in Ls if L["score"].get("rank")), key=lambda L: L["score"]["rank"])[:args.top]
    log(f"{'#':>3}  {'score':>5}  {'conf':>4}  {'$/mo':>6}  listing")
    for L in top:
        s = L["score"]
        log(f"{s['rank']:>3}  {s['overall']:>5}  {s['confidence']:>3}%  {s['monthly_cost'] or 0:>6.0f}  "
            f"{L.get('building')} {L.get('unit')}")


def cmd_report(args):
    from .report import shortlist_report
    ws = ws_from(args)
    p = shortlist_report(ws, _listings(ws), ws.criteria(), args.top)
    log(f"Wrote {p}")


def cmd_build(args):
    ws = ws_from(args)
    out = Path(args.out).resolve() if args.out else DASH / "data"
    _export(ws, out)
    log(f"Dashboard data -> {out}")


def _export(ws: Workspace, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    crit = ws.criteria()
    Ls = _listings(ws)
    slim = []
    for L in Ls:
        S = {k: v for k, v in L.items() if k not in ("stations",)}
        slim.append(S)
    (out / "listings.json").write_text(json.dumps(slim, separators=(",", ":"), ensure_ascii=False))
    (out / "criteria.json").write_text(json.dumps(crit, default=str, indent=1))
    for sub in ("layers", "sites", "plans"):
        src = ws.root / sub
        dst = out / sub
        if dst.exists():
            shutil.rmtree(dst)
        if src.exists():
            shutil.copytree(src, dst)
    dsrc = ws.research_dir / "dossiers"
    ddst = out / "dossiers"
    if ddst.exists():
        shutil.rmtree(ddst)
    if dsrc.exists():
        ddst.mkdir(parents=True)
        for p in dsrc.glob("*.json"):
            D = json.loads(p.read_text())
            (ddst / p.name).write_text(json.dumps(D, separators=(",", ":"), default=str))
    notes = {}
    for p in sorted(ws.research_dir.glob("*.md")):
        notes[p.stem] = p.read_text()
    (out / "notes.json").write_text(json.dumps(notes))
    manifest = {"generated": dt.datetime.now().isoformat(timespec="seconds"), "version": __version__,
                "search": crit["search"].get("name"), "layers": sorted(p.name for p in (out / "layers").glob("*.json")) if (out / "layers").exists() else [],
                "sites": sorted(p.stem for p in (out / "sites").glob("*.json")) if (out / "sites").exists() else [],
                "plans": sorted(p.stem for p in (out / "plans").glob("*.json")) if (out / "plans").exists() else [],
                "dossiers": sorted(p.stem for p in ddst.glob("*.json")) if ddst.exists() else []}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


def cmd_serve(args):
    if args.search or os.environ.get("APARTMENTSCOUT_SEARCH") or Path("search/criteria.yaml").exists():
        try:
            _export(ws_from(args), DASH / "data")
        except SystemExit:
            pass
    os.chdir(DASH)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    with socketserver.TCPServer(("127.0.0.1", args.port), Quiet) as httpd:
        url = f"http://127.0.0.1:{args.port}/"
        log(f"ApartmentScout dashboard at {url}  (Ctrl+C to stop)")
        if not args.no_open:
            webbrowser.open(url)
        httpd.serve_forever()


def cmd_all(args):
    for fn in (cmd_geocode, cmd_commute):
        fn(args)
    try:
        cmd_layers(args)
    except Exception as e:  # layers are optional
        log(f"  layers skipped: {e}")
    cmd_score(args)
    cmd_build(args)


def main(argv=None):
    p = argparse.ArgumentParser(prog="apartmentscout", description="Agent-ready apartment research toolkit.")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, fn, help_):
        s = sub.add_parser(name, help=help_)
        s.add_argument("--search", help="search folder (default ./search or $APARTMENTSCOUT_SEARCH)")
        s.set_defaults(fn=fn)
        return s

    s = sub.add_parser("init", help="create a new search folder")
    s.add_argument("path")
    s.add_argument("--city", default=None, help="nyc enables NYC Open Data modules")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_init)
    s = add("import", cmd_import, "import listings from CSV or JSON")
    s.add_argument("file")
    s = add("geocode", cmd_geocode, "geocode listings and destinations")
    s.add_argument("--provider", default="auto", choices=["auto", "nyc", "census", "nominatim"])
    s.add_argument("--force", action="store_true")
    s = add("commute", cmd_commute, "transit commute heatmap and per-listing times")
    s.add_argument("--cell", type=float, default=150, help="grid cell size in metres")
    s = add("layers", cmd_layers, "city map layers (NYC: 311 noise)")
    s.add_argument("--months", type=int, default=12)
    s = add("dossier", cmd_dossier, "public building records (NYC built in)")
    s.add_argument("ids", nargs="*")
    s = add("site", cmd_site, "3D site model and sun/view study for one listing")
    s.add_argument("id")
    s.add_argument("--floor", type=int)
    s.add_argument("--bearing", type=float, help="window facing in degrees if exposure is unknown")
    s.add_argument("--radius", type=float, default=600)
    s.add_argument("--charts", action="store_true", help="also write PNG charts to research/charts")
    s = add("score", cmd_score, "score and rank listings")
    s.add_argument("--top", type=int, default=20)
    s = add("report", cmd_report, "write a markdown shortlist report")
    s.add_argument("--top", type=int, default=15)
    s = add("build", cmd_build, "export data for the dashboard")
    s.add_argument("--out")
    s = add("serve", cmd_serve, "serve the dashboard locally")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--no-open", action="store_true")
    s = add("all", cmd_all, "geocode, commute, layers, score and build")
    s.add_argument("--provider", default="auto")
    s.add_argument("--force", action="store_true")
    s.add_argument("--cell", type=float, default=150)
    s.add_argument("--months", type=int, default=12)
    s.add_argument("--top", type=int, default=20)
    s.add_argument("--out")
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
