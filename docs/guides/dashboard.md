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
| `[` / `]` | Fly to the previous or next starred home on the Map and open its mini card (with the drawer open, move the drawer) |
| `s` | Save the open listing to your picks |
| `c` | Add the open listing to Compare |
| `1`–`6` | Switch tab (Map, Shortlist, Compare, Unit 3D, Floor plan, Research) |
| `t` | Flip light and dark (the settings menu also has System) |
| `Esc` | Close the lightbox, the drawer or the help |

The Shortlist adds arrow keys, `Enter`, `s` and `c` on the focused row. Unit 3D adds `p` (play or pause
the day) and `,` `.` (step 15 minutes). The floor plan adds `R` (turn), arrows (nudge 1 in, `Shift` 6 in),
`D` (duplicate), `Del`, `⌘Z` and `W A S D` in walk mode.

Saved picks, tiers, tour notes, compare, filters and weights are kept in your browser's local storage.
Use **Back up picks** on the Tours view to keep them as a file, and **Restore** to load them in another
browser.

## Map interactions

**Route preview on hover.** Hover a result card, a map pin or price tag, or a Shortlist row and that home's commute
route is drawn for the destination and mode you have selected (`L.commute[destination].modes[mode].legs`): walk legs
dashed, subway rides along the line's own geometry in the official colour, a dot at each transfer, route bullets and
a pill with the door-to-door minutes. Keyboard focus on a price tag or Shortlist row previews it too, and the route
stays for the home open in the drawer when nothing is hovered. It is one GeoJSON source updated in place (the layers
are added once), with a short intent delay so sweeping across cards does not flicker. Two things are drawn honestly
rather than invented: walking legs are straight segments (the data has no street geometry, and a walk-only route says
"straight line"), and bus stops are not in the map layers, so a bus journey is one dotted chord labelled "path
approximate". On the Shortlist the route shows on the docked map (below). Logic: `dashboard/js/features/route-geometry.js`.

**Starred-only lens.** The "★ N" chip at the end of the map's layer switch counts your saved picks (never the
`favorite` field in the data) and filters the map to them, ignoring the other filters, so the count and the pins
agree. While it is on, a fit button flies to the stars and **+ List** also applies the rail's *Saved picks only*
filter to the results. `[` and `]` fly to the previous or next star (in the current sort order) and open its mini
card; with the drawer open they move the drawer between stars. The lens is not remembered across reloads.

**Sun lens.** *Sun* in the layer switch (offered when any home has a site model) colours pins by hours of direct sun
(`site.sun_hours[month]`, clear-sky hours on the 15th) on an indigo-to-yellow scale, with a legend and a month
stepper that starts on the current month. Homes with a model keep an unclustered pin and a price tag with a sun
chip; homes without one stay small and grey, are labelled "unknown" on the legend, tag and hover card, and are never
treated as zero sun. Build more models with `apartmentscout site`.

**Split view.** On the Shortlist the **Map** button docks a mini map (about a third of the width, stacked above the
table on a phone; remembered in this browser). It draws exactly the rows the table's filters leave and refits when
that set changes (a re-sort or a star does not move it). Hovering a row pulses its pin and previews its route;
hovering a pin lights its row; clicking a pin scrolls to the row, highlights it and moves keyboard focus there (in
building grouping it opens the group first).

## Photos

**Order.** On the cards, in the drawer, in the lightbox and in the Shortlist thumbnail the photos come in one order: clean exact-unit
photos first, then same line (another floor of the same stack), then the building (amenities, lobby, exterior, other units), floor plans
and the street. A photo flagged as carrying a broker's phone number, logo or watermark (`photo_flags`, see the
[data model](data-model.md#photos)) is kept but goes to the end of its group. A card's photo count reads by group: "8 unit · 22 building"
(a lone group of unit photos reads "8 photos"); it is a button that opens the lightbox.

**Lightbox.** Click the count on a card, the photo or the expand button in the drawer, or a tile in Research > Media.

| Control | Does |
|---|---|
| `←` `→`, `Home`, `End`, swipe, thumbnails | Move between photos (neighbours are preloaded) |
| Tabs: All, Unit, Same line, Building, Floor plans, Street | Filter the sequence; each tab shows its count; `←` `→` move between tabs while one is focused |
| Pinch, wheel (or `Ctrl` + wheel on a trackpad), double-click or double-tap, `+` `-` `0`, the zoom buttons | Zoom up to 6x around the pointer; drag to pan |
| Pull the photo down | Close |
| `Plan` Off / Overlay / Side by side (`f` cycles) | Overlay the listing's floor plan on the photo with an opacity slider, or show it next to the photo; offered when the listing has a plan |
| `Esc`, the close button, a click on the backdrop | Close; focus returns to what opened it |
| Open listing | Opens the drawer (outside the drawer only) |

Each photo has a caption: its group, the title, the credit and licence (linked to the source page) and, for a flagged photo, a "Broker mark"
note. The viewer is a dialog: focus is trapped, the page behind is inert, and each change is announced ("Photo 3 of 14. Building."). It follows
the theme, drops its blur under `prefers-reduced-transparency` and its motion under `prefers-reduced-motion`, and fits a 390 px phone (the
tabs scroll, the zoom buttons give way to pinch).

**Blur-up and the transition.** Cards, the drawer and gallery tiles paint a tiny blurred preview from `data/lqip.json` at once and fade the
photo in over it. Opening a listing from its card morphs the card photo into the drawer's hero with the View Transitions API (Chromium and
Safari); elsewhere, and with `prefers-reduced-motion`, the drawer slides in as before.

**Research > Media.** A justified gallery: rows of equal height whose widths follow each photo's ratio. Filter by scope (All, Unit, Same
line, Building, Floor plans, Street, Aerial fallback), hide broker-marked photos, and lay it out by listing, by building or as one flat
list. A tile shows its group, a broker-mark badge and, on hover, its credit; a click opens the lightbox on that section's photos.

## Deciding: five tools for the last mile

Code: `dashboard/js/features/` (one module per tool, pure logic in the `*-model.js` files, tested with `node --test tests/js`).

### Since your last visit

A pill at the left of the stats strip ("3 new · 2 price drops · 1 gone") that opens a list of the changes, each a link to the
home. The browser remembers the day it last saw this search (per search, written when you leave the page); the page compares
**recorded** facts only: events and price history in `history.json`, a listing's `listed_at`, and `checked` dates. Nothing is
inferred, so with no recorded change the pill is not drawn at all (the committed example has none; it appears after builds
that keep snapshots, `apartmentscout history snapshot`). Price drops and rises compare the last price on or before your
visit with the latest; a home that is now gone or rejected is never announced as new. *Mark as seen* moves the baseline to today.
A reload in the same tab keeps the baseline; a first visit has none.

### Decision tray

A slim dock at the bottom of the stage with the Compare picks (up to four, lettered like the Compare columns): photo, price,
score and a remove button each. **Drag** a card, a map price tag, a Shortlist row or a tour card onto it; drop on a slot to put it
there (when the tray is full, the home under the drop is replaced); drag the slots, or press <kbd>Alt</kbd> + arrows on one, to
reorder; <kbd>Delete</kbd> removes. *Compare* opens the Compare view with one click. It is the same list as the Compare toggle
(`S.compare`), so the cards, the tab counter and Compare stay in step and it survives a reload. It collapses to a pill when empty,
when you fold it, and on a phone (tap the pill to open it as a sheet); it makes room beside the open drawer and lifts the map
legend above it.

### Trade-off pad

In the Ranking weights section of the rail: a triangle whose corners are **Cost, Commute and Space** (or, with *Top three*,
your three heaviest weights). Drag the one dot (or use the arrow keys: up gives the top corner a notch, left and right trade
the bottom two) and the three weights trade off against each other while their total, and every other weight, stay as they
are. It writes the **same integer weights the sliders hold** (a corner stops at the slider maximum, 40), so cards, pins and
scores re-rank live exactly as when you drag a slider; the *Pad / Sliders* switch puts the sliders one click away and both stay
in step. Presets are rings on the pad: point at one to see how the top ten would re-order (arrows, "new", who falls out), click
to apply it through the rail's own preset select.

### Share shortlist and decision memo

*Share shortlist* (under the Shortlist and Tours tabs, and in the settings menu) downloads one read-only, self-contained HTML
of your saved picks (Pass left out): a map of the homes with the subway lines, a ranked list, and per home the photos, price
(estimated fees marked), size, commute, the reasons it ranks where it does with the points under your weights, and, folded,
the money split into documented and estimated, light and view, building and interior grades and open questions. The arrow
next to it opens the options: **Decision memo** (opens the same page on its print layout; choose *Save as PDF*), the memo as a
file, *Include my notes* (off by default: a shared page does not carry your notes unless you tick it; tour times never leave)
and photos (embedded thumbnails inside a 900 KB budget, links past it, or none). The memo is a document: a ranked table, the
weights, then a page per home with photos, money, commute legs, light and view, grades, open questions and your notes.

The command line makes the same page from the picks backup, using the same template (`dashboard/share/snapshot.html`):

```bash
apartmentscout share --picks picks.json --out shortlist.html            # cards, map, reasons
apartmentscout share --picks picks.json --out memo.html --memo --notes  # opens as the memo, with your notes
```

`picks.json` is what **Back up picks** writes (it carries your weights, so the CLI ranks the way you saw it) or a plain list of
listing ids; without `--picks` it uses the shortlist, touring and applied listings. Saved local photos become small embedded
thumbnails (`--photo-budget KB`, `--no-photos`). Only the fields named in the template's `as-schema` block are copied; the
browser and CLI builders share that block, and a test builds the same payload with each and compares.

### Tour-day planner

At the top of Shortlist > Tours: choose a day, a start time and where you set off from (your destination or the first stop). The
saved picks, grouped by building, become a timeline: when to **leave by**, the hop between stops (walk or transit), a viewing
time (25 min, plus 10 per extra unit) and a **buffer** after each stop, all adjustable per stop. Drag the grip (or use the
arrows) to reorder; *Shortest walk* and *By booked time* re-order for you. A time typed in a stop's *Booked* field is the
pick's tour time: the stop waits for it if you are early and is flagged "Late by N min" if the day's plan cannot reach it.
**Add to calendar (.ics)** writes one event per stop (the address as location, an alarm at the leave-by time, floating local
times); **Copy plan** puts the day on the clipboard as text. Walking uses the dashboard's model (straight line × 1.25 at
4.8 km/h). The subway router does not run in the browser, so a transit hop is an **estimate**, labelled "est.": each home's
walk to its station from its commute route, a 4 min wait and a straight-line ride at 25 km/h; the faster of walking and that is
used unless you fix the mode on the hop.

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
| `?layer=commute` / `noise` / `rent` / `score` / `sun` / `none` | Start on a map layer |
| `?basemap=raster` | Use the raster fallback basemap instead of vector tiles |
| `?open=<listing-id>` | Open a listing in the drawer |
| `?new=1` / `?wizard=edit` | Open the New search wizard (or edit the open search); `&step=3` picks the step |
| Unit 3D: `?date=2026-12-21&min=750&floor=21&mode=window` | Date, minutes after midnight, floor and camera (`orbit`, `window`, `inside`, `plan`, `top`) |
| Floor plan: `?date=2026-06-21&pmin=1020` | Date and minutes after midnight for the sun |

## Standalone file

```bash
apartmentscout build --standalone my-search.html
```

writes one self-contained HTML file with the dashboard, its code, every stylesheet and all the data
embedded. It opens with a double-click, in app preview panes and on any host. MapLibre, three.js,
pdf.js and the Geist fonts are inlined from `dashboard/vendor/`, so it works with no connection: only the map tiles
need one, and without them the map shows a plain background with the pins, transit lines and heat layers
from the embedded data and an "Offline basemap" note (`?basemap=none` forces this). The plan tracer opens PDF plans
with the vendored pdf.js. It embeds the data, so treat it
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
