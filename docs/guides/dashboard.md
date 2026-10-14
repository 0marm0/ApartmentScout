# The dashboard

`dashboard/` is a static web app: plain HTML, CSS and ES modules, with MapLibre GL and three.js loaded
from jsDelivr and d3-contour vendored. There is no server code and no build step for normal use. It
reads the JSON that `apartmentscout build` writes (listings, criteria, layers, sites, plans, dossiers,
notes, coverage, history and watchlist). The design tokens live in `dashboard/css/tokens.css` and the
design rules in [the design system](../design/design-system.md).

## Views

Every view sits in the same shell: a top bar with the search name, six view tabs, search (`/`) and a settings
menu (theme: system, dark or light; search settings; CSV export of the filtered listings; picks backup; shortcuts); a
thin stats strip under it (tracked, matching, eligible, shortlisted, median cost and commute, top match; on narrow screens
the secondary figures fold into an "all figures" popover); and, on the Map and Shortlist, the filter rail.

| # | View | What it shows |
|---|---|---|
| 1 | **Map** | Filter rail (budget tiers on monthly cost, cost and commute histograms, must-haves and feature switches, status chips, weight presets and live weight sliders), ranked photo cards with walk, subway and bus minutes, and a vector map with heat layers (commute bands, 311 noise, rent per ft², score), official subway lines, price tags and an optional 3D-buildings tilt. Clicking a listing opens the drawer: photos with credits, money (first-lease monthly, gross rent, paid month, move-in cash, unknown fees shown as unknown, headroom per tier), facts, why it ranks here, commute by mode with route legs, sun, records flags, reviews and open questions. |
| 2 | **Shortlist** | A sticky table of every filtered listing ranked live by your weights: monthly cost, tier and gate pills, size and $/ft², route bullets and minutes, floor and exposure, key amenities, score and fact coverage. Group by unit or building, change density and columns, move with the keyboard. |
| 3 | **Compare** | Up to four listings in lettered columns with grouped rows (money, space, commute, building, light, score), the best value in each row marked, unknowns never counted as the worst, a cost-against-space scatter with the value frontier and a per-dimension chart. Deep link: `#compare/id,id`. |
| 4 | **Unit 3D** | The unit's building and its neighbours from the site model. Orbit, Window, Inside (the floor plan's rooms at the real slab height), north-up Plan and Top cameras; layer toggles; a day strip comparing your floor with a compare floor and naming the building that shades the window; bay windows; proposed and filed buildings; what the window sees; sun path against the skyline; sun hours by floor and month; units in the building; assumptions and sources; PNG snapshot and GLB export. |
| 5 | **Floor plan** | The studio for a plan JSON: synced 2D plan and 3D (Both / 2D / 3D), sun patches through each window, furniture from a cited catalogue with drag, snap, rotate, duplicate and undo, fit checks graded clear / tight / blocked, TV viewing distances, layout presets, eye-level cameras and walk mode, layout save and load, PNG and GLB export, and a side-by-side plan comparison. See [floor plans](floor-plans.md). |
| 6 | **Research > Records** | A due-diligence report per building: PLUTO facts, record and street-noise scores, a generated "What matters" table with severity and report/finding labels, timelines, 311 by hour and category, collapsible ledgers linked to the raw rows, and the research notes. Prints cleanly. Deep links: `#research/records/<id>` (the old `#records/<id>` redirects here). |
| 7 | **Shortlist > Tours** | Saved picks on a tier board (S, A, B, C, Pass) by drag or buttons, tour times and notes, a nearest-next visiting order with walking minutes, a Google Maps route, printable call sheets, and picks backup and restore. Deep link: `#list/tours` (the old `#tours` redirects here). |
| 8 | **Research** | The finalist standard and coverage gaps, then tabs: a priority queue (missing and stale facts, lint flags, score swing, copyable questions), new and changed listings, gone fast, the building watchlist and a media gallery of every image with its credit. Deep links: `#research/queue`, `new`, `gone`, `watch`, `media`, `records`. See [research quality](research-quality.md). |

The tabs are Map, Shortlist, Compare, Unit 3D, Floor plan and Research; Tours is a sub-tab of Shortlist and Records a
sub-tab of Research. The numbered rows above are the sections, not the shortcuts (`1` to `6` are the tabs). Views load on first visit; `#<view>/<listing-id>` opens a view on
a listing (for example `#unit/emerald-green-1211` or `#plan/emerald-green-1211`).

## Keyboard

| Key | Does |
|---|---|
| `?` | Show the shortcuts for the current view |
| `/` | Search listings |
| `j` / `k` | Next or previous listing on the Map (opens it in the drawer) |
| `s` | Save the open listing to your picks |
| `c` | Add the open listing to Compare |
| `1`–`6` | Switch tab (Map, Shortlist, Compare, Unit 3D, Floor plan, Research) |
| `t` | Flip light and dark (the settings menu also has System) |
| `Esc` | Close the drawer or the help |

The Shortlist adds arrow keys, `Enter`, `s` and `c` on the focused row. Unit 3D adds `p` (play or pause
the day) and `,` `.` (step 15 minutes). The floor plan adds `R` (turn), arrows (nudge 1 in, `Shift` 6 in),
`D` (duplicate), `Del`, `⌘Z` and `W A S D` in walk mode.

Saved picks, tiers, tour notes, compare, filters and weights are kept in your browser's local storage.
Use **Back up picks** on the Tours view to keep them as a file, and **Restore** to load them in another
browser.

## Run it

```bash
apartmentscout serve --search searches/my-search      # builds, serves and opens the browser
apartmentscout serve --port 8800 --no-open
```

**Private searches stay out of the repo.** For the bundled example, `serve` exports into
`dashboard/data/` (the committed demo). For any other search it exports into that search's own
git-ignored cache (`<search>/cache/dashboard-data/`) and the server maps `/data/` to it, and `/media/` to
`<search>/media/`, where `apartmentscout photos --cache` keeps local copies of listing photos. Paths that
try to leave those folders are refused. Nothing from your search is written into `dashboard/`.

You can also serve `dashboard/` with any static server after `apartmentscout build --out dashboard/data`.
Opening `dashboard/index.html` directly as a file does **not** work (browsers block ES modules on
`file://`); use `serve` or a standalone file.

URL options:

| Option | Effect |
|---|---|
| `?data=path/to/data` | Load another data folder |
| `?theme=light` / `?theme=dark` | Start in a theme |
| `?layer=commute` / `noise` / `rent` / `score` / `none` | Start on a map layer |
| `?basemap=raster` | Use the raster fallback basemap instead of vector tiles |
| `?open=<listing-id>` | Open a listing in the drawer |
| Unit 3D: `?date=2026-12-21&min=750&floor=21&mode=window` | Date, minutes after midnight, floor and camera (`orbit`, `window`, `inside`, `plan`, `top`) |
| Floor plan: `?date=2026-06-21&pmin=1020` | Date and minutes after midnight for the sun |

## Standalone file

```bash
apartmentscout build --standalone my-search.html
```

writes one self-contained HTML file with the dashboard, its code, every stylesheet and all the data
embedded. It opens with a double-click, in app preview panes and on any host. MapLibre, three.js and
the Geist fonts are inlined from `dashboard/vendor/`, so it works with no connection: only the map tiles
need one, and without them the map shows a plain background with the pins, transit lines and heat layers
from the embedded data and an "Offline basemap" note (`?basemap=none` forces this). The plan tracer still
loads pdf.js from a CDN to open PDF plans. It embeds the data, so treat it
like the search itself: it shows your listings and notes to anyone you send it to.

After editing `dashboard/js/`, run `scripts/bundle.sh` (Node + esbuild) to refresh
`dashboard/dist/app.bundle.js`, which the standalone build embeds.

## Host it

GitHub Pages: `.github/workflows/pages.yml` publishes the landing page at the site root and `dashboard/`
(with the NYC example data) at `/demo/` on every push to `main`; see `landing/README.md`. To publish your
own search instead, build into a copy of `dashboard/` and host that. Anything in `data/` is public on a
public site, including notes, so publish from a copy of your search without private notes if needed, and
run `python scripts/release_check.py` first.

## Customise

Colours, type, radius and motion are CSS variables in `dashboard/css/tokens.css` (dark and light).
Each view is a module that exports `init()` and `show(arg)` and renders into its own
`<section id="view-NAME">`; it reads the shared state from `dashboard/js/app.js` (`S.listings`,
`S.crit`, `filtered()`, `sorted()`, `score()`, `openDrawer(id)`), so adding a view means one module, one
stylesheet in `dashboard/css/views/` and one tab link.
