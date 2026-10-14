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
import re
import shutil
import sys
import urllib.parse
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
    from .commute.run import _bbox, feed_paths
    bbox = list(_bbox(_listings(ws), crit["commute"]["destinations"], 1500))
    feeds = feed_paths(ws, crit, log=log)
    if feeds:
        from .commute.lines import transit_lines
        pad = 0.01
        g = transit_lines(feeds, [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad])
        out = ws.root / "layers" / "transit-lines.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(g, separators=(",", ":")))
        n = sum(1 for f in g["features"] if f["properties"]["kind"] == "station")
        log(f"Transit lines -> {out}  ({len(g['features']) - n} line groups, {n} stations)")
    if getattr(args, "transit_only", False):
        return
    if crit["search"].get("city") != "nyc":
        log("No built-in city noise layer for this city yet. See docs/guides/new-city.md to add one.")
        return
    from .layers import nyc_noise_layer
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
    from .geo.site import make_site
    ws = ws_from(args)
    crit = ws.criteria()
    Ls = _listings(ws)
    L = _find(Ls, args.id)
    if L.get("lat") is None:
        sys.exit("Listing has no coordinates. Run `apartmentscout geocode` first.")
    city = crit["search"].get("city")
    log(f"  footprints around {L['id']} ({'NYC Open Data' if city == 'nyc' else 'OpenStreetMap'})")
    lms = (crit.get("landmarks") or []) + (city_profile(city).get("landmarks") or [])
    site, face, timings = make_site(L, crit, cache_dir=ws.cache_dir / "site", floor=args.floor, bearing=args.bearing,
                                    t=args.position, radius=args.radius, streets=not args.no_streets,
                                    future=not args.no_future, refresh=args.refresh, landmarks=lms, say=log)
    if face:
        st, w = site["study"], site["window"]
        rng = st["sun_hours_range"]
        L["site"] = {"file": f"sites/{L['id']}.json", "floor": w["floor"], "bearing": face["bearing"],
                     "sun_hours": st["sun_hours"], "sun_hours_range": {"lo": rng["lo"], "hi": rng["hi"]},
                     "skyline_ahead_deg": st["skyline_ahead_deg"], "open_sky_share": st["open_sky_share"]}
        log(f"  window faces {face['bearing']:.0f} deg at t={w['t']}, floor {w['floor']}: "
            f"direct sun h/day by month {st['sun_hours']}")
        log(f"  range over facade positions {rng['positions']} and floors {rng['floors']}: "
            f"Dec {rng['lo'][11]}-{rng['hi'][11]} h, Jun {rng['lo'][5]}-{rng['hi'][5]} h")
    else:
        L["site"] = {"file": f"sites/{L['id']}.json"}
        log("  exposure unknown or only party walls match: pick the facade in the dashboard (Unit 3D tab) "
            "or pass --bearing.")
    log("  timings " + ", ".join(f"{k} {v:.1f}s" for k, v in timings.items()))
    (ws.sites_dir / f"{L['id']}.json").write_text(json.dumps(site, separators=(",", ":")))
    save(Ls, ws.listings_path)
    if args.charts and face:
        from .charts import sun_charts
        for p in sun_charts(site, face, site["window"]["floor"], ws.research_dir / "charts", L["id"]):
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
    if args.standalone:
        p = standalone(out, Path(args.standalone))
        log(f"Standalone dashboard -> {p}  (open it directly; no server needed)")


def standalone(data_dir: Path, dest: Path) -> Path:
    """One self-contained HTML file: the dashboard, its CSS and JS bundle, and every data file.

    Works when opened as a file, in app previews and on any static host. MapLibre, three.js and
    fonts still load from public CDNs, and map tiles need an internet connection."""
    bundle = DASH / "dist" / "app.bundle.js"
    if not bundle.exists():
        sys.exit("dashboard/dist/app.bundle.js is missing. Run scripts/bundle.sh (needs Node and esbuild).")
    html = (DASH / "index.html").read_text()
    data = {}
    for f in sorted(data_dir.rglob("*.json")):
        data["data/" + f.relative_to(data_dir).as_posix()] = json.loads(f.read_text())
    blob = json.dumps(data, separators=(",", ":"), default=str).replace("</", "<\\/")
    js = bundle.read_text().replace("</script", "<\\/script")
    # inline every local stylesheet (tokens, shell and the per-view files) in document order
    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">',
                  lambda m: f"<style>\n{(DASH / m.group(1)).read_text()}\n</style>", html)
    html = html.replace('<script type="module" src="js/app.js"></script>',
                        f"<script>window.__AS_DATA__={blob};</script>\n<script type=\"module\">\n{js}\n</script>")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(html)
    return dest.resolve()


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
    """Serve the dashboard. The bundled example exports into dashboard/data (the committed demo);
    any other search exports into its own git-ignored cache so private data never lands in the repo,
    and the server maps /data/ and /media/ (locally saved listing photos) to that search."""
    data_dir, media_dir = DASH / "data", None
    if args.search or os.environ.get("APARTMENTSCOUT_SEARCH") or Path("search/criteria.yaml").exists():
        try:
            ws = ws_from(args)
            example = (REPO / "examples").resolve() in ws.root.resolve().parents
            data_dir = DASH / "data" if example else ws.cache_dir / "dashboard-data"
            _export(ws, data_dir)
            media_dir = ws.root / "media"
        except SystemExit:
            pass
    routes = {"/data/": data_dir.resolve(), "/media/": media_dir.resolve() if media_dir else None}

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(DASH), **kw)

        def translate_path(self, path):
            clean = path.split("?", 1)[0].split("#", 1)[0]
            for prefix, root in routes.items():
                if root and clean.startswith(prefix):
                    rel = Path(urllib.parse.unquote(clean[len(prefix):]))
                    target = (root / rel).resolve()
                    if root in target.parents or target == root:
                        return str(target)
                    return str(root / "__forbidden__")
            return super().translate_path(path)

        def log_message(self, *a):
            pass
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.request_queue_size = 128  # the dashboard loads many files at once
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as httpd:
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
    s.add_argument("--transit-only", action="store_true", help="only rebuild the transit lines layer")
    s = add("dossier", cmd_dossier, "public building records (NYC built in)")
    s.add_argument("ids", nargs="*")
    s = add("site", cmd_site, "3D site model and sun/view study for one listing")
    s.add_argument("id")
    s.add_argument("--floor", type=int)
    s.add_argument("--bearing", type=float, help="window facing in degrees if exposure is unknown")
    s.add_argument("--position", type=float, help="window position along the facade, 0..1 (default: middle of "
                   "the facade's open stretch)")
    s.add_argument("--radius", type=float, default=600)
    s.add_argument("--charts", action="store_true", help="also write PNG charts to research/charts")
    s.add_argument("--no-streets", action="store_true", help="skip street centrelines")
    s.add_argument("--no-future", action="store_true", help="skip filed / permitted new buildings (NYC)")
    s.add_argument("--refresh", action="store_true", help="ignore cached downloads")
    s = add("score", cmd_score, "score and rank listings")
    s.add_argument("--top", type=int, default=20)
    s = add("report", cmd_report, "write a markdown shortlist report")
    s.add_argument("--top", type=int, default=15)
    s = add("build", cmd_build, "export data for the dashboard")
    s.add_argument("--out")
    s.add_argument("--standalone", metavar="FILE", help="also write a single self-contained HTML dashboard")
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
    s.add_argument("--standalone", metavar="FILE")
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
