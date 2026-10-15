"""ApartmentScout command line.

    apartmentscout init my-search --city nyc       start a search folder (--interactive asks, --criteria FILE starts from a file)
    apartmentscout criteria --check [FILE]         validate criteria.yaml and print a summary
    apartmentscout import listings.csv             add listings from CSV/JSON
    apartmentscout geocode                         add coordinates (and NYC BBL/BIN)
    apartmentscout commute                         commute grids + per-listing times by mode
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
import json
import os
import re
import shutil
import sys
import webbrowser
from pathlib import Path

from . import __version__
from .config import Workspace, load_criteria
from .listings import CSV_TEMPLATE_COLUMNS, load, normalize, save
from .lqip import alias_remote, build_sidecar
from .slim import slim_listing

REPO = Path(__file__).resolve().parent.parent
DASH = REPO / "dashboard"
LQIP_INLINE_MAX_KB = 400   # larger blur-up sidecars stay out of the standalone file (the cards still work without them)


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
def cmd_init(args, input_fn=None):
    """Create a search folder: the commented template, a criteria file you wrote or downloaded (--criteria), or the
    answers to the intake questionnaire (--interactive; falls back to the template when stdin is not a terminal)."""
    from .intake import Quit, init_search, interview, render_criteria
    root = Path(args.path).resolve()
    if (root / "criteria.yaml").exists() and not args.force:
        sys.exit(f"{root} already has a criteria.yaml (use --force to overwrite).")
    text = None
    if args.criteria:
        try:
            text = Path(args.criteria).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            sys.exit(f"Cannot read {args.criteria}: {e}")
    elif args.interactive:
        if input_fn is None and not (sys.stdin.isatty() and sys.stdout.isatty()):
            log("Not a terminal, so there is nothing to ask: using the template. "
                "Edit criteria.yaml, or answer config/intake.yaml's questions with your agent.")
        else:
            try:
                answers = interview(input_fn or input, log)
            except (Quit, KeyboardInterrupt):
                sys.exit("\nStopped before the end of the questions; nothing was written.")
            if args.city:
                answers.setdefault("search", {})["city"] = args.city
            text = render_criteria(answers, "Written by apartmentscout init --interactive.")
    try:
        city = init_search(root, args.city, text, force=args.force)
    except ValueError as e:
        sys.exit(f"criteria.yaml has problems, nothing was written:\n{e}")
    log(f"Created {root} (city: {city})\n  1. {'Review' if text else 'Edit'} criteria.yaml (budget, must-haves, commute addresses);"
        f" `apartmentscout criteria --check {root / 'criteria.yaml'}` validates it.\n"
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
    only = [_find(Ls, k)["id"] for k in args.ids] if getattr(args, "ids", None) else None
    run_commute(ws, Ls, ws.criteria(), cell_m=args.cell, log=log,
                mode_grids=False if getattr(args, "no_mode_grids", False) else None, only=only)
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


def _panes_arg(args) -> list[float] | None:
    if getattr(args, "bay", False):
        return [-45.0, 0.0, 45.0]
    if getattr(args, "panes", None):
        try:
            return [float(x) for x in str(args.panes).split(",") if x.strip()]
        except ValueError:
            sys.exit("--panes takes comma-separated bearing offsets in degrees, e.g. -45,0,45")
    return None


def _sample_dates(L: dict, crit: dict, year: int) -> list[dt.date]:
    """Move-in (listing ``available``, else the search's move_in) plus the solstices and an equinox."""
    out = []
    mi = (crit.get("search") or {}).get("move_in")
    for raw in (L.get("available"), mi.get("earliest") if isinstance(mi, dict) else mi):
        try:
            d = dt.date.fromisoformat(str(raw)[:10])
        except (TypeError, ValueError):
            continue
        out.append(d)
        break
    for m, d in ((3, 20), (6, 21), (12, 21)):
        x = dt.date(year, m, d)
        if x not in out:
            out.append(x)
    return out


def _write_csv(path: Path, rows: list[dict]) -> None:
    import csv
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        if not rows:
            f.write("")
            return
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def cmd_site(args):
    from .geo.checks import summary_line
    from .geo.site import make_site
    ws = ws_from(args)
    crit = ws.criteria()
    Ls = _listings(ws)
    L = _find(Ls, args.id)
    if L.get("lat") is None:
        sys.exit("Listing has no coordinates. Run `apartmentscout geocode` first.")
    city = crit["search"].get("city")
    if args.green_only:
        from .geo.site import add_green
        path = ws.sites_dir / f"{L['id']}.json"
        if not path.exists():
            sys.exit(f"No site file for {L['id']}: run `apartmentscout site {L['id']}` first.")
        site = json.loads(path.read_text())
        log(f"  parks and trees around {L['id']} (OpenStreetMap)")
        if not add_green(site, ws.cache_dir / "site", radius=args.radius if args.radius != 600 else None,
                         refresh=args.refresh, say=log):
            sys.exit("The site file has no origin: rebuild it with `apartmentscout site`.")
        path.write_text(json.dumps(site, separators=(",", ":")))
        return
    log(f"  footprints around {L['id']} ({'NYC Open Data' if city == 'nyc' else 'OpenStreetMap'})")
    lms = (crit.get("landmarks") or []) + (city_profile(city).get("landmarks") or [])
    site, face, timings = make_site(L, crit, cache_dir=ws.cache_dir / "site", floor=args.floor, bearing=args.bearing,
                                    t=args.position, radius=args.radius, streets=not args.no_streets,
                                    future=not args.no_future, refresh=args.refresh, landmarks=lms,
                                    panes=_panes_arg(args), slab_height=args.slab_height,
                                    floor_height=args.floor_height, components=not args.no_components,
                                    overrides=ws.sites_dir / f"{L['id']}.components.yaml",
                                    green=not args.no_green, face_index=args.face, say=log)
    prov = site.get("provenance") or {}
    log(f"  target matched by {prov.get('target') or '?'}; storey height {site['floor_height_m']} m "
        f"({site.get('floor_height_src')})")
    if face:
        st, w = site["study"], site["window"]
        rng = st["sun_hours_range"]
        L["site"] = {"file": f"sites/{L['id']}.json", "floor": w["floor"], "bearing": face["bearing"],
                     "sun_hours": st["sun_hours"], "sun_hours_range": {"lo": rng["lo"], "hi": rng["hi"]},
                     "skyline_ahead_deg": st["skyline_ahead_deg"], "open_sky_share": st["open_sky_share"],
                     "sky_view": st.get("sky_view"), "daylight_factor_est": st.get("daylight_factor_est"),
                     "sun_year": st.get("sun_year"), "exposure_source": prov.get("exposure")}
        if st.get("sun_hours_expected"):
            L["site"]["sun_hours_expected"] = st["sun_hours_expected"]
        log(f"  window faces {face['bearing']:.0f} deg at t={w['t']}, floor {w['floor']}"
            + (f", panes {w['panes']}" if w.get("panes") else "") + f": direct sun h/day by month {st['sun_hours']}")
        log(f"  range over facade positions {rng['positions']} and floors {rng['floors']}: "
            f"Dec {rng['lo'][11]}-{rng['hi'][11]} h, Jun {rng['lo'][5]}-{rng['hi'][5]} h")
        sy = st.get("sun_year") or {}
        log(f"  sky view {st.get('sky_view')} (CIE overcast, relative), estimated daylight factor "
            f"{st.get('daylight_factor_est')}% (indicative); direct sun {sy.get('possible')} h a year possible"
            + (f", about {sy['expected']} h expected with typical cloud" if sy.get("expected") else ""))
        fc = (site.get("roofs") or {}).get("facing") or {}
        if fc:
            cl = fc.get("clears_floor")
            log(f"  view ahead clears the nearby roofs from floor {cl}" if cl else
                "  view ahead: no floor of this building clears the nearby roofs")
        meta = site.get("bmeta") or []
        for b in (st.get("blockers") or [])[:3]:
            m = meta[b["b"]] if 0 <= b["b"] < len(meta) else {}
            log(f"  shaded by {m.get('name') or m.get('address') or '#' + str(b['b'])} "
                f"({b['dist']:.0f} m): {sum(b['min']) / 60:.1f} h over the 12 sample days")
    else:
        L["site"] = {"file": f"sites/{L['id']}.json"}
        log("  exposure unknown or only party walls match: pick the facade in the dashboard (Unit 3D tab) "
            "or pass --bearing.")
    log(f"  checks: {summary_line(site['checks'])}")
    for c in site["checks"]:
        if c["status"] != "pass":
            log(f"    {c['status'].upper()} {c['id']}: {c['msg']}")
    log("  timings " + ", ".join(f"{k} {v:.1f}s" for k, v in timings.items()))
    (ws.sites_dir / f"{L['id']}.json").write_text(json.dumps(site, separators=(",", ":")))
    save(Ls, ws.listings_path)
    if args.samples and face:
        from .geo.site import sample_rows
        rows = sample_rows(site, face, _sample_dates(L, crit, dt.date.today().year))
        p = ws.research_dir / f"{L['id']}-sun-samples.csv"
        _write_csv(p, rows)
        log(f"  sun samples ({len(rows)} rows) -> {p}")
    if args.neighbours:
        from .geo.neighbours import neighbour_records
        rows = neighbour_records(site, face)
        p = ws.research_dir / f"{L['id']}-neighbours.csv"
        _write_csv(p, rows)
        log(f"  neighbours within 300 m ({len(rows)} rows) -> {p}")
    if args.charts and face:
        from .charts import sun_charts
        for p in sun_charts(site, face, site["window"]["floor"], ws.research_dir / "charts", L["id"]):
            log(f"  chart {p}")


def cmd_photos(args):
    """Building photos from Wikimedia Commons and, for private searches, local copies of photos."""
    import time

    from .photos import Commons, add_commons_photos, cache_media, coverage, coverage_lines
    ws = ws_from(args)
    Ls = _listings(ws)
    targets = [_find(Ls, k) for k in args.ids] if args.ids else Ls
    example = (REPO / "examples").resolve() in ws.root.resolve().parents
    want_cache = args.cache or args.source in ("local", "all")
    if want_cache and example:
        sys.exit("Refusing to save photos inside examples/: the bundled example is committed. "
                 "Run --cache on your own search.")
    if args.source == "web" and example:
        sys.exit("Refusing to add listing-page photos inside examples/: they belong to their owners and the bundled "
                 "example is committed. Run --source web on your own search.")
    t0 = time.monotonic()
    if args.source == "wikidata":
        from .photo_sources import Wikidata, add_wikidata_photos
        log(f"Wikidata building images (credited from Wikimedia Commons): {len(targets)} listings, up to {args.max} each")
        st = add_wikidata_photos(targets, Wikidata(ws.cache_dir / "photos"), Commons(ws.cache_dir / "photos", refresh=args.refresh),
                                 limit=args.max, say=log)
        log(f"  {st['with_photos']}/{st['buildings']} buildings have a Wikidata image; {st['requests']} SPARQL requests, "
            f"{time.monotonic() - t0:.0f} s")
        save(Ls, ws.listings_path)
    if args.source == "web":
        import requests

        from .photo_sources import PageFetcher, add_web_photos
        log(f"Listing and building pages: {sum(1 for L in targets if not (L.get('photos') or L.get('photos_local')))} "
            "listings without photos (plain GETs; a bot check ends that host for this run)")
        st = add_web_photos(targets, PageFetcher(requests.Session()), limit=args.max, say=log)
        log(f"  {st['with_photos']}/{st['listings']} listings got images from {st['pages']} pages; "
            f"{len(st['blocked'])} host(s) blocked; {time.monotonic() - t0:.0f} s")
        save(Ls, ws.listings_path)
    if args.source in ("commons", "all"):
        api = Commons(ws.cache_dir / "photos", refresh=args.refresh)
        log(f"Wikimedia Commons: {len(targets)} listings, radius {args.radius:g} m, up to {args.max} photos each"
            + ("" if os.environ.get("APARTMENTSCOUT_CONTACT") else
               "  (set APARTMENTSCOUT_CONTACT to an email or URL for Wikimedia's faster rate limit)"))
        st = add_commons_photos(targets, api, radius=args.radius, limit=args.max, say=log)
        log(f"  {st['with_photos']}/{st['buildings']} buildings have photos; {st['requests']} API requests, "
            f"{time.monotonic() - t0:.0f} s")
        save(Ls, ws.listings_path)
    if want_cache:
        t1 = time.monotonic()
        st = cache_media(targets, ws.root, say=log)
        log(f"  media: {st['downloaded']} downloaded, {st['reused']} reused, {st['skipped_existing']} already "
            f"saved, {st['failed']} failed; {time.monotonic() - t1:.0f} s -> {ws.root / 'media'}")
        save(Ls, ws.listings_path)
    for line in coverage_lines(coverage(Ls)):
        log(line)


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
    """One self-contained HTML file: the dashboard, its CSS and JS bundle, every data file and the
    vendored libraries (MapLibre, three.js and its addons, pdf.js, Geist fonts).

    Works when opened as a file, in app previews and on any static host, with no network except
    map tiles; without tiles the map falls back to a plain background under the local overlays."""
    bundle = DASH / "dist" / "app.bundle.js"
    if not bundle.exists():
        sys.exit("dashboard/dist/app.bundle.js is missing. Run scripts/bundle.sh (needs Node and esbuild).")
    html = (DASH / "index.html").read_text()
    # [pwa] the manifest and icon links point at files that are not next to a single HTML file (and a manifest cannot load
    # from file://), so the installable-app block is dropped; js/pwa.js does nothing without a secure origin
    html = re.sub(r"<!-- \[pwa\].*?<!-- end \[pwa\] -->\n?", "", html, flags=re.S)
    data = {}
    for f in sorted(data_dir.rglob("*.json")):
        data["data/" + f.relative_to(data_dir).as_posix()] = json.loads(f.read_text())
    data["share/snapshot.html"] = (DASH / "share" / "snapshot.html").read_text()   # the Share button's template (features/share.js)
    no_media = not (dest.parent / "media").is_dir()
    if no_media and isinstance(data.get("data/listings.json"), list):
        # local photo copies are not embedded: without a media/ folder next to the file use the photo links
        if "data/lqip.json" in data:   # the blur-up previews follow the photos: found under their original links
            data["data/lqip.json"] = alias_remote(data["data/lqip.json"], data["data/listings.json"])
        data["data/listings.json"] = [{k: v for k, v in L.items() if k != "photos_local"} for L in data["data/listings.json"]]
    if "data/lqip.json" in data:
        kb = len(json.dumps(data["data/lqip.json"], separators=(",", ":"))) / 1024
        if kb > LQIP_INLINE_MAX_KB or not data["data/lqip.json"].get("items"):
            log(f"Blur-up previews not embedded in the standalone file ({kb:.0f} KB; the limit is {LQIP_INLINE_MAX_KB} KB)")
            del data["data/lqip.json"]
        else:
            log(f"Blur-up previews embedded: {kb:.0f} KB")
    embedded = _embed_data(data)
    js = bundle.read_text().replace("</script", "<\\/script")
    # inline every local stylesheet (tokens, shell and the per-view files) in document order
    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">',
                  lambda m: f"<style>\n{(DASH / m.group(1)).read_text()}\n</style>", html)
    html = html.replace('<script type="module" src="js/app.js"></script>',
                        f"{embedded}\n<script type=\"module\">\n{js}\n</script>")
    html = _inline_vendor(html)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(html)
    return dest.resolve()



# Defines window.__AS_DATA__ over the JSON blocks above it. Each file is parsed the first time the app asks for it (a getter
# replaces itself with the value), so the 8 MB listings file is parsed at boot and the dossiers, 3D site models and plans
# only when a view opens them; parsing one big JSON string is also much cheaper than compiling the same data as a
# JavaScript object literal. `p in __AS_DATA__` stays free (no parse). The text of a block is dropped once parsed.
_LAZY_DATA_JS = (
    "(function(){var E={};document.querySelectorAll('script[type=\"application/json\"][data-as]').forEach(function(s){"
    "var k=s.getAttribute('data-as');Object.defineProperty(E,k,{enumerable:true,configurable:true,get:function(){"
    "var v=JSON.parse(s.textContent);Object.defineProperty(E,k,{value:v,enumerable:true,writable:true,configurable:true});"
    "s.textContent='';return v}})});window.__AS_DATA__=E})();"
)


def _embed_data(data: dict) -> str:
    """The standalone file's data: one inert `<script type="application/json" data-as="PATH">` per file plus the loader that
    makes them `window.__AS_DATA__` (see _LAZY_DATA_JS). JSON is ASCII-escaped and every `<` is written as \\u003c, so no
    value can end the block or start an HTML comment."""
    import html as _html
    blocks = []
    for path, value in data.items():
        text = json.dumps(value, separators=(",", ":"), default=str).replace("<", "\\u003c")
        blocks.append(f'<script type="application/json" data-as="{_html.escape(path, quote=True)}">{text}</script>')
    return "\n".join(blocks) + f"\n<script>{_LAZY_DATA_JS}</script>"


def _inline_vendor(html: str) -> str:
    """Inline dashboard/vendor: fonts and MapLibre as <style>/<script>, three.js, its addons and pdf.js as data: URLs in
    the import map (a data: module cannot resolve relative imports, so those are pointed at the import map)."""
    import base64
    import posixpath

    V = DASH / "vendor"

    def b64(b: bytes) -> str:
        return base64.b64encode(b).decode()

    def js_url(src: str) -> str:
        return "data:text/javascript;base64," + b64(src.encode())

    fonts = re.sub(r'url\("([^"]+\.woff2)"\)',
                   lambda m: f'url("data:font/woff2;base64,{b64((V / "fonts" / m.group(1)).read_bytes())}")',
                   (V / "fonts" / "geist.css").read_text())
    ml_css = (V / "maplibre-gl" / "maplibre-gl.css").read_text()
    ml_js = re.sub(r"//# sourceMappingURL=\S+", "", (V / "maplibre-gl" / "maplibre-gl.js").read_text())
    ml_js = ml_js.replace("</script", "<\\/script")
    swaps = {'<link rel="stylesheet" href="vendor/fonts/geist.css">': f"<style>\n{fonts}\n</style>",
             '<link rel="stylesheet" href="vendor/maplibre-gl/maplibre-gl.css">': f"<style>\n{ml_css}\n</style>",
             '<script src="vendor/maplibre-gl/maplibre-gl.js"></script>': f"<script>\n{ml_js}\n</script>"}
    for a, b in swaps.items():
        html = html.replace(a, b)
    imports = {"three": js_url((V / "three" / "three.module.min.js").read_text())}
    addons = V / "three" / "addons"
    for f in sorted(addons.rglob("*.js")):
        rel = f.relative_to(addons).as_posix()
        src = re.sub(r"""(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}/[^'"]+)\2""",
                     lambda m: f"{m.group(1)}{m.group(2)}three/addons/"
                               f"{posixpath.normpath(posixpath.join(posixpath.dirname(rel), m.group(3)))}{m.group(2)}",
                     f.read_text())
        imports["three/addons/" + rel] = js_url(src)
    # pdf.js (plan tracer): the library and its worker, only fetched when a PDF plan is opened
    imports["pdfjs-dist"] = js_url((V / "pdfjs" / "pdf.min.mjs").read_text())
    imports["pdfjs-dist/worker"] = js_url((V / "pdfjs" / "pdf.worker.min.mjs").read_text())
    imap = json.dumps({"imports": imports}, indent=1)
    return re.sub(r'<script type="importmap">.*?</script>', lambda m: f'<script type="importmap">\n{imap}\n</script>',
                  html, count=1, flags=re.S)


def _export(ws: Workspace, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    crit = ws.criteria()
    Ls = _listings(ws)
    slim = []
    for L in Ls:
        S = {k: v for k, v in L.items() if k not in ("stations",)}
        if S.get("status") in ("gone", "rejected"):
            # keep what the dashboard shows for closed listings, drop the bulky detail
            S["commute"] = {d: {k: v for k, v in (c or {}).items() if k != "modes"} | (
                {"modes": {m: {k: v for k, v in (x or {}).items() if k not in ("legs",)}
                           for m, x in (c.get("modes") or {}).items()}} if (c or {}).get("modes") else {})
                for d, c in (S.get("commute") or {}).items()}
            if isinstance(S.get("score"), dict) and S["score"].get("reasons"):
                S["score"] = {**S["score"], "reasons": [{k: v for k, v in r.items() if k != "items"} for r in S["score"]["reasons"]]}
        slim.append(slim_listing(S))   # only the fields the dashboard reads (apartmentscout/slim.py)
    (out / "listings.json").write_text(json.dumps(slim, separators=(",", ":"), ensure_ascii=False))
    previews = build_sidecar(slim, ws.root / "media", out, cache_path=ws.cache_dir / "lqip.json", log=log)   # blur-up previews
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
                "dossiers": sorted(p.stem for p in ddst.glob("*.json")) if ddst.exists() else [],
                "lqip": bool(previews)}
    from .exports import run_all
    manifest["extra"] = run_all(ws, out, log=log)   # history, coverage and other optional data files
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


def _rescore(ws: Workspace) -> None:
    """Score and rank every listing and save: what `apartmentscout score` does, without the printout."""
    from .score import score_all
    Ls = _listings(ws)
    score_all(Ls, ws.criteria())
    save(Ls, ws.listings_path)


def _searches_dir(args, ws: Workspace | None) -> Path:
    """Where new searches are created: --searches-dir, $APARTMENTSCOUT_SEARCHES, the folder holding the open search
    when that is called `searches`, else ./searches."""
    given = getattr(args, "searches_dir", None) or os.environ.get("APARTMENTSCOUT_SEARCHES")
    if given:
        return Path(given).resolve()
    if ws is not None and ws.root.parent.name == "searches":
        return ws.root.parent
    return Path("searches").resolve()


def cmd_serve(args):
    """Serve the dashboard. The bundled example exports into dashboard/data (the committed demo);
    any other search exports into its own git-ignored cache so private data never lands in the repo,
    and the server maps /data/ and /media/ (locally saved listing photos) to that search.

    Unless --no-api is given the page also gets a local-only API (see localapi.py) so the New search wizard can save
    criteria.yaml and create or switch search folders."""
    from .localapi import ServeState, make_server
    ws = None
    if args.search or os.environ.get("APARTMENTSCOUT_SEARCH") or Path("search/criteria.yaml").exists():
        try:
            ws = ws_from(args)
        except SystemExit:
            pass
    state = ServeState(dash=DASH, searches_dir=_searches_dir(args, ws), ws=None, data_dir=DASH / "data", media_dir=None,
                       export=_export, rescore=_rescore, api=not args.no_api)
    if ws is not None:
        state.activate(ws)
    httpd = make_server(state, args.port)
    with httpd:
        url = f"http://127.0.0.1:{state.port}/"
        log(f"ApartmentScout dashboard at {url}  (Ctrl+C to stop)")
        if state.api:
            log("  New search wizard: saves criteria.yaml and creates search folders from the page (this machine only).")
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
    s.add_argument("--criteria", metavar="FILE", help="start from this criteria.yaml (for example one downloaded from "
                   "the dashboard's New search wizard); it is validated and the city's transit feeds are added if missing")
    s.add_argument("--interactive", action="store_true", help="answer the intake questionnaire (config/intake.yaml) "
                   "on the terminal; without a terminal this writes the template")
    s.set_defaults(fn=cmd_init)
    s = add("import", cmd_import, "import listings from CSV or JSON")
    s.add_argument("file")
    s = add("geocode", cmd_geocode, "geocode listings and destinations")
    s.add_argument("--provider", default="auto", choices=["auto", "nyc", "census", "nominatim"])
    s.add_argument("--force", action="store_true")
    s = add("commute", cmd_commute, "commute heatmaps and per-listing times by mode (walk, subway, bus, best)")
    s.add_argument("--cell", type=float, default=None, help="grid cell size in metres (default: commute.transit.heat_cell_m or 50)")
    s.add_argument("--no-mode-grids", action="store_true",
                   help="write only the best-of-transit heat grid, not one per mode")
    s.add_argument("--ids", nargs="+", metavar="ID",
                   help="re-time only these listings (ids, or unique id fragments); the heat-map layers on disk "
                        "and every other listing's commute are left as they are")
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
    s.add_argument("--face", type=int, help="facade by edge index in the site file's faces (overrides --bearing and "
                   "the listing's exposure; the listing's window_face does the same)")
    s.add_argument("--radius", type=float, default=600)
    s.add_argument("--charts", action="store_true", help="also write PNG charts to research/charts")
    s.add_argument("--no-streets", action="store_true", help="skip street centrelines")
    s.add_argument("--no-future", action="store_true", help="skip filed / permitted new buildings (NYC)")
    s.add_argument("--no-green", action="store_true", help="skip parks, lawns and trees from OpenStreetMap")
    s.add_argument("--green-only", action="store_true", help="only add (or refresh) the parks and trees of an "
                   "existing site file, leaving the rest of it as it is")
    s.add_argument("--no-components", action="store_true", help="keep every building a single prism (skip "
                   "OpenStreetMap building:part podiums / towers; <id>.components.yaml still applies)")
    s.add_argument("--refresh", action="store_true", help="ignore cached downloads")
    s.add_argument("--bay", action="store_true", help="the window is a 45 degree bay (panes -45, 0, +45)")
    s.add_argument("--panes", help="pane bearing offsets from the facade, comma-separated, e.g. -30,0,30")
    s.add_argument("--slab-height", type=float, help="height of the listing floor's slab above street level in "
                   "metres (sets the storey height; default: roof height / PLUTO floors)")
    s.add_argument("--floor-height", type=float, help="storey height in metres (overrides the calibration)")
    s.add_argument("--samples", action="store_true", help="write research/<id>-sun-samples.csv: every 6 min on "
                   "move-in day and the solstices, with the building that shades the window")
    s.add_argument("--neighbours", action="store_true", help="write research/<id>-neighbours.csv: every building "
                   "within 300 m with distance, bearing, height and sources")
    s = add("photos", cmd_photos, "licensed building photos (Wikimedia Commons) and local photo copies")
    s.add_argument("ids", nargs="*")
    s.add_argument("--source", default="commons", choices=["commons", "local", "all", "wikidata", "web"],
                   help="commons: look up building photos; local: save existing photos under media/; all: both; "
                        "wikidata: images of named towers from their Wikidata item (credited, licensed); web: for "
                        "listings with no photos, images from the listing's own page (private searches only)")
    s.add_argument("--radius", type=float, default=60, help="metres around the listing for street photos")
    s.add_argument("--max", type=int, default=6, help="building photos to keep per listing (wikidata: per building; "
                   "web: images read per page)")
    s.add_argument("--cache", action="store_true", help="also save photos under <search>/media/ (not for examples)")
    s.add_argument("--refresh", action="store_true", help="ignore cached API responses")
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
    s.add_argument("--no-api", action="store_true", help="serve the files only: no save, create or re-score from the page")
    s.add_argument("--searches-dir", metavar="DIR", help="where the wizard creates new search folders "
                   "(default: the folder holding the open search if it is called searches, else ./searches)")
    s = add("all", cmd_all, "geocode, commute, layers, score and build")
    s.add_argument("--provider", default="auto")
    s.add_argument("--force", action="store_true")
    s.add_argument("--cell", type=float, default=None)
    s.add_argument("--months", type=int, default=12)
    s.add_argument("--top", type=int, default=20)
    s.add_argument("--out")
    s.add_argument("--standalone", metavar="FILE")
    from .commands import register_all
    register_all(add)   # commands that live in apartmentscout/commands/*.py
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
