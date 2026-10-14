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
| `↑` `↓` `Home` `End` `Page Up` `Page Down` | On a focused result card: move through the whole list (with the drawer open they also open the neighbour) |

The Shortlist adds arrow keys, `Enter`, `s` and `c` on the focused row. Unit 3D adds `p` (play or pause
the day) and `,` `.` (step 15 minutes). The floor plan adds `R` (turn), arrows (nudge 1 in, `Shift` 6 in),
`D` (duplicate), `Del`, `⌘Z` and `W A S D` in walk mode.

Saved picks, tiers, tour notes, compare, filters, weights, density and which rail sections are collapsed are kept in your browser's local storage.
Use **Back up picks** on the Tours view to keep them as a file, and **Restore** to load them in another
browser.

## Results list and filter rail

The results column and the filter rail are built for hundreds of homes and for hands that keep adjusting. The code
is in `dashboard/js/features/` and `dashboard/css/results-rail.css`; `features/results.js` wires it into the shell.

**Active filters.** A row of chips above the results shows every filter that differs from the starting view: the
budget cap (or "Any price"), the commute limit with its mode, each must-have or feature switch, a status set other than
the five active ones, the text search and saved picks only. One click on a chip removes that filter; **Clear all**
returns to the starting view. The row follows the rail, the search box and the command palette, and the rail follows a
chip, because both read the same filter state. It is hidden when nothing is filtered, wraps on a desktop and scrolls
sideways on a phone, and the arrow keys move between chips. Homes without a computed commute stay in the list when a
commute limit is set; the chip's tooltip says so.

**Collapsible rail sections.** Search, Budget, Commute, Must-haves and features, Status and Weights each have a heading
button (`aria-expanded`, Enter or Space toggles, the arrow keys, Home and End move between headings). A collapsed
section shows a one-line summary of its setting (for example "≤ $5,200", "≤ 30 min · Subway", "3 on", "Active" or the
two largest weights) and its controls leave the tab order. The height animates; which sections are collapsed is kept in
this browser (`localStorage`, with a safe fallback when storage is blocked). Keyboard focus also survives the rail's
rebuild after every filter change, so a switch toggled with the space bar keeps focus.

**Rank changes.** When weights, edited criteria or the commute lens change the ranking, the cards that stay on screen
slide to their new places (a FLIP animation on transforms, so it stays at 60 fps), and a small ▲3 or ▼2 badge fades in
beside the "#rank" of every home whose rank moved. The badge is measured from where the ranking stood when the renter
started adjusting, so a long drag shows the net move, and it fades out after four quiet seconds. The same badges appear
in the Shortlist table's rank column. Filters and sorting move the cards without badges, because the rank numbers do not
change. The motion is skipped under `prefers-reduced-motion` (the badges still appear), and for a moment after any
update that took more than 9 ms, so a slow device drops the animation instead of frames.

**Density.** The settings menu has Comfortable and Compact. Compact shrinks the card photo, trims the badge row to two,
drops the photo count and the sparkline but keeps the price, score, commute and drop chip, tightens the rail, and
tightens every table (the Shortlist's own density buttons follow the setting and change it). It is remembered per
browser; `?density=compact` wins for one page load.

**Price history.** A card shows a tiny step-line sparkline and, when the latest recorded change was a drop, a "↓ $150"
chip; the map's hover card shows a larger sparkline with its dates. The prices come from the listing's own
`price_history` and from `history.json` (`apartmentscout build` writes it from snapshots and dated claims); today's
price is added as the last point only when it differs from the newest recorded one and the listing has a check date.
Gross rent is plotted; net-effective prices are used only when no two gross prices exist, and the two are never mixed.
With no history, a single price or an unchanged price, nothing is drawn: there is no trend line to invent.

**Big searches.** Only the cards in view (plus a buffer) are in the page, with spacers for the rest, so 700 or 7,000
homes scroll and re-rank as smoothly as 20. Opening a listing, `j` / `k` and the arrow keys reach cards that are not
rendered yet; each card carries `aria-posinset` and `aria-setsize`, and the list is a `role="feed"`. While a weight
slider moves, the scores and the four rankings are computed in a Web Worker and applied when they come back; the
results are identical to the main-thread `rescore()`, which remains the fallback. The worker is built from a `blob:`
URL (not a module file), so it starts from the standalone file opened as `file://` too; if a worker cannot start, or
fails its startup check, or the search has fewer than 150 homes, scoring simply runs on the main thread. `?worker=0`
forces that path. `document.documentElement.dataset.scoring` says which one is running.

## New search wizard

A step-by-step dialog for starting a search (or editing every criterion of the open one) with manual controls. It
asks the questions in [`config/intake.yaml`](../../config/intake.yaml), in that order, so it matches what an agent
or `apartmentscout init --interactive` asks, and it writes the same `criteria.yaml`.

**Open it** from the search switcher in the top bar (*New search*, *Edit all criteria*, *Search settings*, and any
other search in the searches folder when the page is served), from the folder button in the top bar on narrow
screens, from the command palette (`⌘K`, "New search"), from the empty state when no data or no listings are
loaded, or with `?new=1` / `?wizard=edit` (add `&step=3` to jump to a step).

| Step | Sets |
|---|---|
| Basics | `search.name`, `search.city` (profiles in `config/cities/`), `search.timezone`, `search.map_center`, `search.move_in` |
| Places | `commute.destinations`: name, address, a pin placed by clicking the map (or typed coordinates), arrive-by, longest trip, weight, usual mode |
| Money | `budget.basis` (how fees count), `budget.tiers`, `budget.hard_max`; a target rent fills sensible tiers |
| Home | `unit.min_beds` and the floor / good / great square feet that score 0 / 50 / 100 |
| Amenities | `must_have`, `strongly_prefer`, `nice_to_have` from the amenity keys, plus your own keys |
| Building and interior | Importance (not, somewhat, very, essential) of a luxury building, renovated interior, new appliances, view, light and quiet. Each answer sets the weight of its dimension and they add up (`interior` counts toward `building` until the scorer has that dimension). Also an optional `building_ratings` map, building name to 1-5, to add to as you go |
| Weights | `scoring.preset` and `weights`: pick a preset, then adjust sliders that show each dimension's live share of the total. The dimensions are read from the loaded data (`scoring.dimensions`), so new ones appear without a change here |
| Review | The criteria.yaml, a diff against the open search, the command lines, and the actions below |

Every field is checked as you type, with the message under the field; *Next* will not move on while the step has
a problem. `Esc` closes, `Enter` in a field goes to the next step, the arrow keys move inside a choice group, and
`Tab` stays inside the dialog. On a phone it becomes a full-height sheet with a progress bar. A half-finished draft is
kept in your browser's local storage and offered again the next time you open the wizard.

**What the Review step can do depends on where the page is served from:**

| | Served by `apartmentscout serve` | GitHub Pages, a standalone file, any static server |
|---|---|---|
| New search | *Create search* makes `searches/<folder>/` (same as `init`) and can switch the dashboard to it | Download `criteria-<name>.yaml`, copy it, or copy the commands |
| Edit all criteria | *Save criteria.yaml* writes the open search's file (old one kept in `backups/`), then *Re-score now* runs score and build with progress | Download or copy; apply the file by hand |
| Preview | *Apply as preview* re-ranks the loaded data in this browser with the new criteria (when the city matches the open search); files stay unchanged | The same |

Saving rewrites `criteria.yaml` from the wizard's fields: anything the wizard does not ask about (transit feeds, tiles,
landmarks, custom presets) is carried over, but comments in the old file are not, which is what the backup is for.

### Local API

`apartmentscout serve` adds a small JSON API for the wizard. It exists only for the page this process serves:

- it listens on `127.0.0.1` only, refuses requests whose `Host` is not that address (or `localhost`) on its own port and
  any with another site's `Origin`, and answers no CORS preflight;
- every call needs the per-run random token the server writes into the page (`<meta name="as-token">`) in an
  `X-AS-Token` header; the page has no token when it is served any other way, so the controls never appear there;
- everything written is validated first with the same rules as `apartmentscout criteria --check` (and so as
  `config.load_criteria`); problems come back as a list and nothing is written;
- writes stay inside the open search folder (`criteria.yaml`, `backups/`, keeping the newest 30) or create one new
  folder directly under the searches folder, named with lowercase letters, digits and hyphens. Existing folders are
  never overwritten. The bundled `examples/` searches are read-only.

| Call | Does |
|---|---|
| `GET /api/session` | Open search, `can_save`, other searches, city profiles |
| `GET /api/criteria`, `POST /api/criteria` | Read, or validate and save, the open search's `criteria.yaml` |
| `POST /api/validate` | Validate YAML text without writing |
| `POST /api/searches`, `POST /api/searches/activate` | Create a search folder from criteria, or switch the dashboard to one |
| `POST /api/rescore`, `GET /api/jobs/<id>` | Score and rebuild in a background thread; poll for progress |

`--no-api` serves the files only; `--searches-dir DIR` (or `$APARTMENTSCOUT_SEARCHES`) says where new searches go
(default: the folder holding the open search when it is called `searches`, else `./searches`).

## Run it

```bash
apartmentscout serve --search searches/my-search      # builds, serves and opens the browser
apartmentscout serve --port 8800 --no-open
apartmentscout serve --no-api                         # files only: no save, create or re-score from the page
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
| `?density=compact` / `comfortable` | Start in a density (the settings menu remembers the renter's choice) |
| `?worker=0` | Re-score on the main thread instead of in a Web Worker (for comparing or debugging) |
| `?open=<listing-id>` | Open a listing in the drawer |
| `?new=1` / `?wizard=edit` | Open the New search wizard (or edit the open search); `&step=3` picks the step |
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
