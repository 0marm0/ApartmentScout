# The dashboard

`dashboard/` is a static web app: plain HTML, CSS and ES modules, with MapLibre GL and three.js loaded
from jsDelivr and d3-contour vendored. There is no server code and no build step for normal use. It
reads the JSON that `apartmentscout build` writes (listings, criteria, layers, sites, plans, dossiers,
notes, coverage, history and watchlist). The design tokens live in `dashboard/css/tokens.css` and the
design rules in [the design system](../design/design-system.md).

## Views

Every view sits in the same shell: a top bar with the search name, five view tabs, search (`/`) and one menu
(see [The menu](#the-menu)); a
thin stats strip under it (tracked, matching, eligible, shortlisted, median cost and commute, top match; on narrow screens
the secondary figures fold into an "all figures" popover); and, on the Map and Shortlist, the filter rail.

| # | View | What it shows |
|---|---|---|
| 1 | **Map** | Filter rail (budget tiers on monthly cost, cost and commute histograms, must-haves and feature switches, status chips, weight presets and live weight sliders), ranked photo cards with walk, subway and bus minutes, and a vector map with heat layers (commute bands, 311 noise, rent per ft², score), official subway lines, price tags and an optional 3D-buildings tilt. Clicking a listing opens the drawer: photos with credits, money (first-lease monthly, gross rent, paid month, move-in cash, unknown fees shown as unknown, headroom per tier), facts, why it ranks here, commute by mode with route legs, sun, records flags, reviews and open questions. |
| 2 | **Shortlist** | A sticky table of every filtered listing ranked live by your weights: monthly cost, tier and gate pills, size and $/ft², route bullets and minutes, floor and exposure, key amenities, score and fact coverage. Group by unit or building, change density and columns, move with the keyboard. |
| 3 | **Compare** | Up to four listings in lettered columns with grouped rows (money, space, commute, building, light, score), the best value in each row marked, unknowns never counted as the worst, a cost-against-space scatter with the value frontier and a per-dimension chart. Deep link: `#compare/id,id`. |
| 4 | **Unit 3D** | The unit's building and its neighbours from the site model. Orbit, Window, Inside (the floor plan's rooms at the real slab height), north-up Plan and Top cameras; layer toggles; a day strip comparing your floor with a compare floor and naming the building that shades the window; bay windows; proposed and filed buildings; what the window sees; sun path against the skyline; sun hours by floor and month; a **Daylight through the year** panel (direct sun, sky visibility and relative daylight per month, kept separate and labelled modelled); units in the building; assumptions and sources; **Fast / Visual** render quality, PNG snapshot (also a progressive 2x or 4x render) and GLB export. |
| 5 | **Floor plan** | The studio for a plan JSON: synced 2D plan and 3D (Both / 2D / 3D), sun patches through each window, furniture from a cited catalogue with drag, snap, rotate, duplicate and undo, fit checks graded clear / tight / blocked, TV viewing distances, layout presets, eye-level cameras and walk mode, layout save and load, PNG and GLB export, a side-by-side plan comparison, and a Light tab for relative daylight in each room, glass and surface inputs, luminaires with a night preview and an annual summary, with Fast / Visual render quality. See [floor plans](floor-plans.md). |
| 4 | **Unit 3D** | The unit's building and its neighbours from the site model. Orbit, Window, Inside (the floor plan's rooms at the real slab height), north-up Plan and Top cameras; layer toggles; a day strip comparing your floor with a compare floor and naming the building that shades the window; bay windows; proposed and filed buildings; what the window sees; sun path against the skyline; sun hours by floor and month; units in the building; assumptions and sources; PNG snapshot and GLB export. The **Model** panel (see [floor plans](floor-plans.md#same-plan-in-unit-3d)) chooses the plan the Inside camera shows (your edited plan scenario with its furniture, or the source file), shows the shared anchor, lets you pin the window for the Floor plan studio, enter a measured slab or window-eye height beside the floor-count estimate, assume a podium and tower for a building, compare two to four scenarios side by side (one PNG, one JSON receipt) and export or import a model project that restores offline. |
| 5 | **Floor plan** | The studio for a plan JSON: synced 2D plan and 3D (Both / 2D / 3D), sun patches through each window, furniture from a cited catalogue with drag, snap, rotate, duplicate and undo, fit checks graded clear / tight / blocked, TV viewing distances, layout presets, eye-level cameras and walk mode, layout save and load, PNG and GLB export, and a side-by-side plan comparison. See [floor plans](floor-plans.md). |
| 6 | **Research > Records** | A due-diligence report per building: PLUTO facts, record and street-noise scores, a generated "What matters" table with severity and report/finding labels, timelines, 311 by hour and category, collapsible ledgers linked to the raw rows, and the research notes. Prints cleanly. Deep links: `#research/records/<id>` (the old `#records/<id>` redirects here). |
| 7 | **Shortlist > Tours** | Saved picks on a tier board (S, A, B, C, Pass) by drag or buttons, tour times and notes, a nearest-next visiting order with walking minutes, a Google Maps route, printable call sheets, and picks backup and restore. Deep link: `#list/tours` (the old `#tours` redirects here). |
| 8 | **Research** | The finalist standard and coverage gaps, then tabs: a priority queue (missing and stale facts, lint flags, score swing, copyable questions), new and changed listings, gone fast, the building watchlist and a media gallery of every image with its credit. Deep links: `#research/queue`, `new`, `gone`, `watch`, `media`, `records`. See [research quality](research-quality.md). |

The tabs are Map, Shortlist, Compare, Home and Research. **Home** holds Unit 3D and Floor plan: a second row under the bar switches
between them (the same way Tours sits under Shortlist and Records under Research), and the Home tab opens whichever you used last.
The numbered rows above are the sections, not the shortcuts (`1` to `5` are the tabs). Views load on first visit; `#<view>/<listing-id>` opens a view on
a listing (for example `#unit/emerald-green-1211` or `#plan/emerald-green-1211`: both routes are unchanged, and the switch under the
bar keeps the same home when the other view has data for it).

### The tabs

A segmented control: an icon and a label per tab, an indicator that slides to the active tab (it jumps when motion is reduced), and
badges: starred homes on Shortlist, homes in Compare, open research questions on Research. At 1280 to 1600 px the top bar is one
line; the search-name pill goes first below 1360 px, and the filter rail moves behind a **Filters** button below 1180 px. On a
phone (760 px and narrower) the tabs become a **bottom tab bar**: five equal icon-and-label targets within thumb reach, all
visible at once (the old scrolling strip hid Research behind a fade), safe-area aware on notched phones, with the compare tray,
toasts and shortcut hints lifted above it. Tests: `tests/e2e/test_menu_nav.py`.

### The menu

One button at the top right (`#menuBtn`) opens one menu (`#appMenu`, `js/app-menu.js`) with five sections; it replaces the
folder menu and the settings menu. The search-name pill on the left opens the same menu under itself.

| Section | Holds |
|---|---|
| **This search** | The search name and counts (and its folder, when served), **Edit criteria…** (the wizard on every criterion), **Search settings** (quick edits previewed in this browser), **Switch search…** (the other searches; only when `apartmentscout serve` is running) and **New search…** |
| **Data** | **Export filtered CSV**, **Back up picks**, **Restore picks…** (a backup file), **Share shortlist**, **Decision memo** |
| **Appearance** | Theme (system, dark, light), accent (iris, jade, amber, rose), density (roomy, compact), office pin (gold, green) and the golden-hour map tint |
| **Comfort** | Reduce motion, reduce transparency, high contrast, text size |
| **Help** | Search or jump to (`⌘K`), Keyboard shortcuts (`?`), Restart tour, and **Install app** where the browser offers it |

Keyboard: `Enter` on the button opens it on the first row; `↑` `↓` move between rows, `←` `→` move inside a segmented row (theme,
density, accent, text size), `Home` `End` jump to the first and last row, a letter jumps to the next row that starts with it,
`Esc` closes it and returns focus to the button (or the pill) it was opened from, `Tab` leaves it. Only one row is in the tab order
(roving focus). Appearance and Comfort choices keep the menu open so you see the change; actions close it. The body scrolls on short
screens; on a phone the menu is a bottom sheet with a grab handle and a scrim, rows are at least 44 px tall and the keyboard hints are
dropped.

## Keyboard

| Key | Does |
|---|---|
| `?` | Show the shortcuts for the current view |
| `/` | Search listings |
| `j` / `k` | Next or previous listing on the Map (opens it in the drawer) |
| `[` / `]` | Fly to the previous or next starred home on the Map and open its mini card (with the drawer open, move the drawer) |
| `s` | Save the open listing to your picks |
| `c` | Add the open listing to Compare |
| `1`–`5` | Switch tab (Map, Shortlist, Compare, Home, Research); `4` opens Unit 3D or Floor plan, whichever was open last, and pressing it again on Home flips to the other |
| `t` | Flip light and dark (the menu's Appearance row also has System) |
| `Esc` | Close the lightbox, the drawer or the help |

| `Esc` | Close the drawer or the help |
| `↑` `↓` `Home` `End` `Page Up` `Page Down` | On a focused result card: move through the whole list (with the drawer open they also open the neighbour) |

Press `?` for the cheat sheet: every shortcut, searchable ("undo", "rotate", "compare", "sun"), with the keys of the
view you are on listed first. The same list, in full:

| Keys | Does | Where |
|---|---|---|
| `⌘K` / `Ctrl K`, `/` | Open the command menu: search homes, jump to a view, run an action, or ask in plain words | Everywhere |
| `?` | The searchable cheat sheet (`Esc` or `?` closes it) | Everywhere |
| `1`–`5` | Switch tab: Map, Shortlist, Compare, Home (Unit 3D or Floor plan; `4` again flips), Research | Everywhere |
| `g` then `m` `s` `c` `u` `p` `r` `t` | Go to Map, Shortlist, Compare, Unit 3D, Floor plan, Research, Tours (a hint chip lists them while the `g` waits). From a home that has a site model or a plan, `g u` and `g p` open that home | Everywhere |
| `t` | Flip light and dark (the settings menu also has System) | Everywhere |
| `⌘Z` / `Ctrl Z`, `⇧⌘Z` / `Ctrl Shift Z` (`Ctrl Y`) | Undo and redo a pick, Compare, filter, weight or commute change; not while typing in a field, and not in the Floor plan, which keeps its own history | Everywhere |
| `Esc` | Close the open panel, menu, dialog, cheat sheet or tour | Everywhere |
| `s` | Star the focused or open home | Map, Shortlist |
| `x` or `c` | Toggle Compare on the focused or open home | Map, Shortlist |
| `j` / `k` | Next or previous home (opens it on the Map; moves the row on the Shortlist) | Map, Shortlist |
| `Enter` | Open the focused card or row | Map, Shortlist |
| `↑` `↓` `Home` `End`, `←` `→` | Move between Shortlist rows, jump to the first or last, fold or unfold a building group | Shortlist |
| `p`, `,` `.` | Play or pause the day; step the time 15 minutes | Unit 3D |
| arrows, `+` `−`, `Home` `End` | Orbit or look around (Shift for a bigger step), zoom; jump along the day strip | Unit 3D |
| `R` / `Shift R`, arrows, `D`, `Del`, `⌘Z` | Turn, nudge (1 in, Shift 6 in), duplicate, remove a furniture piece, undo and redo layout changes | Floor plan |
| `W` `A` `S` `D` `Q` `E` | Walk and look in the eye-level camera (Shift runs) | Floor plan |
| `←` `→` `Home` `End` | Move between the research tabs | Research |
| `↑` `↓` `Enter` `Esc` | Move through, pick from and close the command menu and the Compare and Records pickers | Menus |
| `←` `→` `Enter` `Esc` | Step through, or skip, the guided tour | Tour |

Chords and `x` ignore the keys while you type in a field and while a dialog, the command menu or the tour is open.

Saved picks, tiers, tour notes, compare, filters, weights, density and which rail sections are collapsed are kept in your browser's local storage.
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

*Share shortlist* (under the Shortlist and Tours tabs, and in the menu's Data section) downloads one read-only, self-contained HTML
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

### Tour findings and decision history

Code: `features/tour-findings.js` (wiring), `tour-sheet.js` (the sheet), `findings-model.js` and `decisions-model.js` (pure rules, with
node tests), `findings-store.js` (storage), `decision-trail.js` (the recorder); Python mirror: `apartmentscout/tours.py`.

**Visit notes.** The drawer has a *Visit and decisions* section (a *Visit* tab) and every Tours card has *Start visit notes*; both open
the visit sheet, also at `?visit=<listing-id>` (handy for a link sent to your phone). It is built for one hand on a phone: a full-height
sheet, every control at least 44 px, steppers and short fields with the right keyboard, ratings as rows of five big buttons, and the
camera and **Done** in a bar at the bottom where a thumb rests. On a desktop it is a panel at the right. Each change is saved the moment
you make it. It asks for:

| Section | What you record |
|---|---|
| Rooms and ceilings | Rooms with width and length (type `13.5`, `13'6"` or `4.1 m`, or step by half a foot; the area adds up beside the listing's size), ceiling height |
| Home | Water pressure and cell signal bars (rated on the spot), closets, laundry (in the unit, on the floor, in the building, none), smells |
| Noise and light | Noise at the window (1 silent to 5 loud) with an optional dB reading you type from a meter app, light 1 to 5 with the time (filled in for you) and which of eight compass points the window faces, and what it looks onto |
| Does it match the listing? | W/D in the unit, doorman, size and which way the windows face: **Matches**, **Differs** (then what you found) or **Not sure**. Where the listing says nothing it reads **I saw it** |
| Photos and a note | Photos from the camera or library (shrunk to 1600 px and saved as WebP, metadata dropped), a caption each, and a free note |

**Findings sit beside the listing's facts and never overwrite them.** The drawer shows what you found labelled "observed on <date>"
next to what the listing says. A finding that differs from the listing is surfaced, not scored: the home gets a
`contradicted:<field>` gate (shown as "Differs on tour: in-unit W/D" and, for the card, a "differs on tour" badge), a line in *Why it
ranks here* and in the reasons, and no score or rank changes. **Use as a fact** (one click, in the drawer or in the sheet) promotes it:
it writes a dated, sourced claim (`field`, `value`, `source: "renter, observed on a tour"`, `observed_at`), the browser re-evaluates the
home with that fact (a must-have that is now missing fails its gate, the amenities and size parts move), and the listing's own facts
stay as published. A toast and an *Undo* button on the finding reverse it, and changing the finding it came from withdraws it. The
browser re-evaluates amenities and bare reported sizes itself; a promoted exposure refreshes the light score when you run
`apartmentscout score`, which reads the same promoted facts (see [data model](data-model.md#tour-findings)), so both sides agree.

**Where it is kept.** Text goes to this browser's local storage; photos to IndexedDB (every call is guarded: private windows and
blocked site data fall back to "kept in this browser"). When the page is served by `apartmentscout serve` the same findings are also
written to `<search>/tours/<id>/findings.json` and the photos to `<search>/tours/<id>/photos/`, through the local API below; a visit
saved there is read back after a cleared browser, and photos kept in the browser while the API was away move into the folder later.
The bundled example is read-only, so its visits stay in the browser. A visit that only lives in a browser and the picks backup reaches
the scorer with `apartmentscout tours-import picks.json` (the newer version of each visit wins; photos are not part of a backup).

**Decision history.** Every star, tier, status (the new *Your status* menu in the drawer), note, tour time and promoted finding is
recorded with the time it happened. After a tier, status or promotion change a small prompt offers a reason (`Esc` or *Skip* leaves it
blank; any entry in the drawer's *Decision history* can be given one later). Rapid edits of one note fold into a single revision.
The trail is exported and imported with **Back up picks** (`findings` and `history` next to `picks`; photos stay where they were
taken), and importing the same backup twice adds nothing.

**Memo and share page.** *Share shortlist*, the decision memo and `apartmentscout share` include each home's visit (measurements,
ratings, the four checks with *used as a fact* or *not used in the ranking*) and its decision trail. The free note, your reasons and
the text of a note appear only with *Include my notes*. Visit photos have their own opt-in (*Include my visit photos*, or
`apartmentscout share --tour-photos`): up to four embedded thumbnails per home inside a 600 KB budget.

```bash
apartmentscout share --picks picks.json --out memo.html --memo --notes --tour-photos
```

## Undo

Every change to your picks (star, tier, note, tour time), Compare list, filters, ranking weights and commute lens is
one step on a single undo stack. A toast names the change ("Starred Emerald Green 1211", "Weight: Cost", "Must-have on:
Gym") with an **Undo** button, and `⌘Z` / `Ctrl Z` does the same (`⇧⌘Z` redoes). Dragging a slider is one step, not sixty;
a new change after an undo drops the redo list; typing in a text field keeps the browser's own text undo. The command menu
lists "Undo: ..." and "Redo: ..." while there is something to undo. The stack lives for the visit (a reload starts it
empty); the values themselves persist as before.

## Ask in plain words

Type a sentence into the command menu (`⌘K`) and the first row is a preview of what it understood, with a live count,
before anything changes:

```
2 bd under 5k within 20 min by subway with w/d near grand central
  ->  Apply: 2 bd · ≤ $5,000 · ≤ 20 min subway to Grand Central · W/D
      12 of 434 active homes · Enter
```

| Say | Sets |
|---|---|
| `2 bd`, `studio`, `1-2 br`, `2+ beds`, `two bedroom` | Bedrooms (exact, a range, or at least); `2 ba` for baths |
| `under 5k`, `$4,500 or less`, `over 3k`, `between 3k and 4.5k` | Monthly cost against the amount your budget tiers compare. A price above your highest tier lifts the tier cap so it does not hide what you asked for |
| `within 20 min`, `by subway`, `by bus`, `walking`, `to grand central` | Commute limit, mode and destination (the commute lens) |
| `w/d`, `washer dryer`, `doorman`, `gym`, `elevator`, `dishwasher`, `roof deck`, `pets` | The must-have and feature switches |
| `700 sq ft`, `high floor`, `floor 15+` | Minimum size and floor |
| `starred`, `price drops` | Saved picks only; homes whose latest recorded price move was down (needs `history.json`; the row says when there is none) |
| `east of 3rd ave`, `west of broadway`, `south of 14th`, `between 30th and 45th street` | A side of a street, or a strip between two (see "Streets, parks and neighbourhoods") |
| `near central park`, `within 5 min walk of bryant park`, `in murray hill / kips bay`, `on the UES` | Walking distance to a park or street, or inside a neighbourhood |
| `within 25 min of work and 30 min of partner` | A commute limit for each of several destinations (see "Several destinations") |
| a building, or a place the map data does not have | The text filter, using the spelling in your data |
| `cheapest`, `closest`, `largest`, `best value` | The sort |

A query is a whole new search: filters it does not mention go back to their defaults, which is also why it is one undo
step. The constraints the rail has no control for (bedrooms, price, size, floor, baths, price drops) show as chips above
the results, each with an × that removes it. Words it does not recognise are listed as "not understood" in the preview
instead of being guessed at, and a phrase it understands but cannot filter on says so (`north of 3rd ave`: the avenue
runs north-south, so it has no north side). The parser is a pure module (`dashboard/js/features/nlquery.js`) with its own
node tests.

### Streets, parks and neighbourhoods

`apartmentscout places` writes `places.json` (street centrelines and park and neighbourhood outlines, about 100 KB for
Manhattan) from OpenStreetMap and, where the city profile names one, an open neighbourhood dataset (NYC: the 2020
Neighborhood Tabulation Areas); `apartmentscout build` copies it next to the rest of the dashboard data, and `all` builds
it too. Everything is tested in the browser, offline. Without the file the same phrases are reported as not supported yet
and the row says to run the command.

| Phrase | Means |
|---|---|
| `east of 3rd ave`, `west of fifth`, `west of broadway` | The side of that street's line on the named side. East and west are judged along the **street's own axis**, so on the Manhattan grid (29 degrees off true north) east of 3rd Avenue is the side away from the Hudson at every latitude, not the compass east of one point on it. A diagonal street such as Broadway uses its direction where the home stands. The line is extended past the street's last block |
| `south of 14th`, `north of 96th st`, `above 59th`, `below 14th` | The same for a crosstown street. `east of 14th` or `north of 3rd ave` say the street has no such side |
| `between 30th and 45th street`, `between 2nd and 3rd ave` | The strip between two parallel streets, in either order; `street` or `ave` said once is enough. Two avenues or two streets only |
| `near central park`, `close to bryant park`, `near 3rd ave` | Within a five-minute walk of the park's or street's nearest edge (straight-line equivalent at your walking speed with the street detour: 320 m at 4.8 km/h) |
| `within 8 min walk of union square` | The same with your minutes (1 to 30) |
| `in murray hill / kips bay`, `on the UES`, `in hell's kitchen`, `east village` | Inside the neighbourhood outline. A name shared by several areas (Upper East Side) is their union; `/`, `,`, `or` and `and` join several |

The chips say what was understood (`East of 3rd Avenue`, `≤ 5 min walk to Bryant Park`, `In Murray Hill-Kips Bay`), each
with an ×, and undo takes them back one at a time. A name the map data does not have (`east of foo avenue`, `near foo
park`) is reported as "No place ... in this search's map data" and nothing is guessed or approximated. A home without
coordinates fails a place filter, like any unknown fact. Names that are also a commute destination or a building stay
with those: `near grand central` is still the commute lens.

### Several destinations

With two or more `commute.destinations` (your work, a partner's work, a gym) the dashboard shows every one of them:

- **Rail.** An *Every destination* section under Commute has a limit slider per destination (the right end means no limit),
  each shown as a chip and undoable. Say it in a sentence too: `within 25 min of work and 30 min of partner`. With only one
  destination in the sentence the existing commute lens takes it, as before. Homes with no minutes for a destination stay
  in, like the commute slider.
- **Cards and drawer.** Each card has a compact line, `Work 18 · Partner 26 · Gym 9 ▲ · Σ 78`: minutes in the lens's mode
  to every destination (▲ marks a destination over its own limit) and the combined commute score. The drawer lists every
  destination with minutes, score, limit and weight; a row switches the lens (and the route above it) to that destination.
  Compare has a row per destination, and the Shortlist table an *Every destination* column (switch it off in the column menu).
- **Combined score.** The score that ranks homes already averages the destinations by `weight` (methodology: Scoring). The
  combined figure is that same number: 100 at half a destination's limit, 50 at the limit, 0 at twice it, so a 15-minute
  gym and a 45-minute office are each judged against their own limit. *Sort > Best combined commute* orders by it.
- **Heat map.** The legend's destination menu adds **Farthest of all** (the longest trip to any destination at each point:
  where you are within reach of everyone) and **Weighted average** (minutes averaged by the destinations' weights). They are
  drawn from `layers/commute-combined-<mode>.json`, which `apartmentscout build` writes from the grids already computed
  (24 KB for three destinations). They need a grid for every destination in that mode; the legend says when one is missing
  and when your destinations or weights changed after the build. Picking a destination anywhere returns to its own surface.

Add a destination in the criteria editor (or `criteria.yaml`), run `apartmentscout geocode` for its coordinates, then
`apartmentscout commute --dest "Partner"` to route only the new one (the others keep their grids and times), and `build`.

## First-run tour

On a first visit in a normal browser the Map shows a five-step tour: the filters, live weights, starring a home,
Compare and Unit 3D. Each step spotlights its target; `→`/`Enter` go on, `←` goes back, `Esc` or **Skip tour** ends it.
It is shown once per browser. Restart it from **Restart tour** in the menu (Help) or the command menu. (Browsers under
automation never start it by themselves; `?coach=1` forces it.)

Views that can be empty say so with an illustration and the next step: no saved picks (Tours, and the Map's saved-only
switch), nothing in Compare, no matching homes, no records for a building, no floor plan, no site model, and the empty
Research tabs. A link to a home that has no plan or site model shows another one and says so.

## Comfort and personalisation

The menu's **Appearance** section has an **Accent** row (Iris, Jade, Amber, Rose) and a **Golden-hour map tint** switch; its **Comfort**
section has the three comfort switches and text size. They apply through data attributes on `<html>`, are kept per browser and, for the three comfort switches, follow
your system by default:

| Setting | Attribute | Does |
|---|---|---|
| Reduce transparency | `data-transparency="reduced"` | Solid panels instead of glass. On by default when the OS asks (`prefers-reduced-transparency`) |
| High contrast | `data-contrast="high"` | Stronger ink and borders, solid panels, underlined links, a thicker focus ring (`prefers-contrast: more`) |
| Reduce motion | `data-motion="reduced"` | No transitions or animations, and the script animations (map easing, drawer) stop too (`prefers-reduced-motion`) |
| Text size | `data-text="m" "l" "xl"` | The type scale and the bar heights grow 12.5 % and 25 % |
| Accent | `data-accent` | Swaps the accent family of tokens, in both themes |

A setting the OS already asks for shows as on ("set by your system") and cannot be switched off from the page; the
renter can only add to it. The golden-hour tint warms the map from the side the sun is on, strongest when it is about
3 degrees up (it uses the sun position at the map centre, updated every five minutes); it is off by default.
`?goldenAt=2026-06-21T23:55:00Z` shows the map at a chosen instant.

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

**Density.** The menu's Appearance section has Roomy (comfortable) and Compact. Compact shrinks the card photo, trims the badge row to two,
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
| `GET /api/tours`, `GET /api/tours/<id>` | Every saved visit, or one |
| `POST /api/tours/<id>` | Validate and write `<search>/tours/<id>/findings.json` (`{"findings": {...}}`) |
| `POST /api/tours/<id>/photos`, `POST /api/tours/<id>/photos/delete` | Add a photo (a raw image body) or delete one (`{"photo": "<id>"}`) |

The tour calls pass the same guards. On top of those: a listing id must be a plain slug (never a path) and its folder must resolve
directly inside `<search>/tours/` and not be a symlink; a photo body is at most 12 MB, an image Pillow can decode within 60 megapixels
(JPEG, PNG or WebP), at most 40 photos per home and 400 MB for the folder, and is rotated by its EXIF orientation, shrunk to 1600 px
and stored as WebP **without any metadata**, never as the bytes the browser sent; the only `GET` outside `/api/` for tours is
`/tours/<id>/photos/<name>.webp`; a bundled example search is read-only (403) and photos need Pillow (`pip install 'apartmentscout[images]'`).

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
| `?density=compact` / `comfortable` | Start in a density (the settings menu remembers the renter's choice) |
| `?worker=0` | Re-score on the main thread instead of in a Web Worker (for comparing or debugging) |
| `?open=<listing-id>` | Open a listing in the drawer |
| `?visit=<listing-id>` | Open the visit notes sheet for a listing (the link to send to your phone) |
| `?new=1` / `?wizard=edit` | Open the New search wizard (or edit the open search); `&step=3` picks the step |
| Unit 3D: `?date=2026-12-21&min=750&floor=21&mode=window` | Date, minutes after midnight, floor and camera (`orbit`, `window`, `inside`, `plan`, `top`); `cal=slab:80.5:24:scale` is a measured height (`slab` or `eye`, metres, the floor it was taken at, `scale` or `offset`) |
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
`dashboard/dist/app.bundle.js`, which the standalone build embeds. (The published site is not built from that file: `scripts/optimize_site.py`
makes a split build of `dashboard/js/` at deploy time.)

## Install it and use it offline

The hosted dashboard (GitHub Pages under `/demo/`) is an installable app: `manifest.webmanifest` (name, relative `start_url` and
`scope`, so any sub-path works, theme colours, shortcuts to Map, Shortlist, Compare and Unit 3D) plus icons rendered from the brand pin
by `scripts/make_icons.py` into `dashboard/assets/pwa/` (dark and light 192 and 512 px, maskable 192 and 512, a 180 px Apple touch
icon, 32 px favicons and an `.ico`). Chrome and Edge offer *Install app* in the address bar and in the dashboard's menu (Help);
Safari uses *Add to Home Screen*.

`dashboard/sw.js` is the service worker; `js/pwa.js` registers it and `js/pwa-core.js` decides when:

| Where the page is opened | Worker |
|---|---|
| The published build (`as-build` meta stamped by `scripts/optimize_site.py`) on https, or on localhost | Registered |
| A plain copy of `dashboard/` (the repo tree, `python -m http.server`) | Never, unless the URL has `?pwa=1` (a source edit is never hidden by a cache) |
| `apartmentscout serve` (the page carries the `as-token` meta tag) | Never (the server rebuilds data under the page) |
| A standalone file on `file://` | Never (browsers do not allow it; the install block of `index.html` is dropped from that file) |
| Any page with `?pwa=0` | Off for that visit |

What it saves: the shell and core data listed in `precache.json` (written at deploy time) go into a cache named for the build; other
same-origin files (map layers, 3D site models, plans, dossiers) are cached the first time they are used, in a cache that belongs to the
same build; saved listing photos (`media/`) are cached on first view in their own cache, capped at 50 MB, oldest first. Remote photos
and map tiles are never touched, so offline the map shows its basemap note and the pins, lines and heat from the saved data. The page
is served from the build's cache (so the page and the hashed files it names stay one version) and the browser's worker update check
finds a new deploy: the dashboard then shows *A new version is ready* with **Reload** and **Later**. The new build installs in the
background and only takes over when you choose Reload; the first install takes over at once. Your picks, weights and filters live in
`localStorage` and are kept. Tests: `tests/e2e/test_pwa.py` (manifest, installability under `/ApartmentScout/demo/`, offline reload,
the update prompt, the photo cap, and the places the worker must stay out of) and `tests/js/pwa.test.mjs`.

## When the page will not start

Stale or hand-edited browser state must never leave a blank page.

- **Saved state is checked on read.** Every `as:*` value comes back through `store.get`, which passes it to `cleanStored()`
  (`js/state-guard.js`, pure and unit-tested in `tests/js/state-guard.test.mjs`). The shape is compared with the default the caller
  passes, or with a per-key rule for the keys that default to `null` (picks drop bad entries and bad fields, filters keep only known
  fields, weights keep finite numbers, `commute:` / `criteria:` / `findings:` need objects, and so on). A bad value is the default;
  nothing else is touched. The comfort, density and office-pin readers do their own normalising.
- **A watchdog runs before anything else.** The classic inline script at the top of `index.html` (so it also runs when a module fails
  to load, in the split build and in the standalone file) shows a full-page card, *Something stopped ApartmentScout from starting*,
  when a script does not load or fails to parse, when `boot()` throws (`window.__asBoot.fail`), when an uncaught error is followed
  by 2.5 s without a first render, or when nothing has drawn in 12 s. `app.js` marks the first render with `<html data-boot="ready">`;
  from then on the watchdog is silent, and a card shown for a slow start disappears if the app does finish.
- **The card offers two ways out.** *Reload*, and *Reset this browser's settings (keeps your saved picks)*, which removes every `as:*`
  key except `picks`, `findings:`, `trail:`, `tourplan:` and the floor-plan work (`plan.`, `plan-projects.`, `plan-tracer-draft.`,
  `plan-scenario:`, `compare-specs:`), unregisters the service worker, deletes its caches and reloads. *Technical details* holds the
  error text. `window.__AS_BOOT_MS` shortens the 12 s limit (used by the tests).

Tests: `tests/e2e/test_boot_recovery.py` (corrupt values for every kind of key, a script that does not load, a start that never
finishes, a slow start that recovers, and the reset keeping picks).

## Speed: the published build and the budget

The source tree loads about 110 module files. `scripts/optimize_site.py` (run by `scripts/build_site.sh`, which `pages.yml` calls)
rewrites the copy that Pages serves:

- esbuild splits `js/app.js` into a tiny entry, shared chunks and a chunk per lazy view (Unit 3D, Floor plan, Research, Compare, Tours, the
  wizard, settings, the lightbox ...), so the first screen runs about 80 KB of script (gzip) instead of 400 KB, and three.js and pdf.js load with the
  views that need them. The page `modulepreload`s the chunks the first screen imports.
- The 31 stylesheets become 10 minified files in the **same order** (the cascade is unchanged; a computed-style comparison of nine views found
  no difference). View-only sheets load without blocking the first render and keep their place in the document.
- MapLibre loads with `defer`, the Geist font is preloaded, and a small inline script starts `listings.json`, `criteria.json`,
  `manifest.json`, `notes.json` and `lqip.json` before any code has downloaded (`js/perf/early.js` hands those requests to `getJSON`).
- `data/listings.json` keeps only the fields the dashboard reads (`apartmentscout/slim.py`; `apartmentscout build` does the same for
  `dashboard/data/`). The list is an allowlist: **a listing field a script starts to read must be added to `DASHBOARD_FIELDS`**, and
  `tests/test_slim.py` fails when a field the example search carries and a script mentions is missing from it.

The standalone file keeps its single bundle (it has nowhere to put chunks) but embeds each data file as a JSON block that is parsed the
first time the app asks for it, so the 8 MB listings file is parsed at boot and dossiers, 3D site models and plans only when a view opens
them.

Measure it: `python scripts/perf_check.py --site _site --standalone my-search.html` reports LCP, FCP, total blocking time, bytes on the
wire (gzip, as Pages sends them) and request count on a cold load, with the CPU slowed (`--cpu 4`) and a network profile (`--net 4g`) if you
want a phone. `--check` enforces `scripts/perf_budget.json` (the `perf` job in `tests.yml`). Build the site locally with
`NO_MEDIA=1 scripts/build_site.sh _site` (leave out `NO_MEDIA` to copy the 400 MB of example photos).

## Host it

GitHub Pages: `.github/workflows/pages.yml` runs `scripts/build_site.sh`, which publishes the landing page at the site root and the
optimised, installable `dashboard/` (with the NYC example data) at `/demo/` on every push to `main`; see `landing/README.md`. To publish your
own search instead, build into a copy of `dashboard/` and host that. Anything in `data/` is public on a
public site, including notes, so publish from a copy of your search without private notes if needed, and
run `python scripts/release_check.py` first.

## Customise

Colours, type, radius and motion are CSS variables in `dashboard/css/tokens.css` (dark and light).
Each view is a module that exports `init()` and `show(arg)` and renders into its own
`<section id="view-NAME">`; it reads the shared state from `dashboard/js/app.js` (`S.listings`,
`S.crit`, `filtered()`, `sorted()`, `score()`, `openDrawer(id)`), so adding a view means one module, one
stylesheet in `dashboard/css/views/` and one tab link.
