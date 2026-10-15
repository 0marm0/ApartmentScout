# ApartmentScout roadmap

As of 14 October 2026. This replaces the open items in
[FEATURE_GAP_PLAN_2026-10-13.md](FEATURE_GAP_PLAN_2026-10-13.md). Every item below was checked against the
code and commit history before it was listed, so nothing here is already built unless it says "extend".
Effort: **S** is under a day, **M** is one to three days, **L** is more than three days.

## Vision

Before signing a lease, a renter and their AI agent should be able to answer every question that changes
the decision: true monthly cost, door-to-door commute, building condition, noise, light and view, and
whether the furniture fits. Each answer comes with its source, its uncertainty and a next step. ApartmentScout
is the open, local-first toolkit for that work. Agents run the playbooks and the CLI over plain files, and
the renter makes the calls in a dashboard they own, for any city.

## Where we are

### What ships today

| Area | What works |
|---|---|
| Agent layer | `AGENTS.md`, `CLAUDE.md` and nine skills for the whole search, from intake to the decision memo. Agents draft and never send. Checksummed handoff packs (`handoff pack / verify / import`) move a search between agents. Imports append claims and keep conflicts. |
| Pipeline | One CLI over plain files: `init`, `import`, `geocode`, `commute`, `layers`, `dossier`, `site`, `photos`, `score`, `report`, `build`, `serve`, `all`, plus `validate`, `lint` (14 listing traps), `coverage` (15-fact finalist standard), `history`, `export --xlsx/--csv` and `handoff`. |
| Money and scoring | First-lease monthly cost, paid month, move-in cash and renewal. Unknown fees stay unknown, and concessions without a term are marked conditional. Price disputes become scenarios. Scoring v2 has 10 dimensions, versioned presets, live weights in the browser with Python/JS parity, four ranks and plain-sentence reasons. |
| Commute | A built-in GTFS router gives walk, subway, bus and best-of-transit times, with ranges, legs and per-mode heat grids. It was checked against an independent router on 208 buildings, with a mean error of 0.57 to 0.80 min. The commute lens drives the layer, pins, cards, filters, Shortlist and Compare. |
| Records (NYC) | 10 Open Data datasets: PLUTO, HPD violations and complaints, DOB and ECB, DOB NOW filings, bedbugs, 311 and NYPD. The report labels each item as a report or a finding, and includes noise metrics, ledgers and a print view. |
| Light and view | Footprints with component buildings (podium, tower, setback), party-wall rejection, light courts, streets, and filed and proposed towers. The day strip names the building blocking the sun. Also included: bay windows, eye height against roofs, a neighbours table, a photo-match overlay, self-checks, source receipts and GLB/PNG export. The relative daylight model (sky view, average daylight factor estimate, possible vs expected sun hours) is labelled "not lux". |
| Floor plans | Plan JSON v2 with a synced 2D/3D studio, a 23-piece cited catalogue, fit checks, presets, cameras and exports. The plan tracer turns a plan image or PDF into an editable 3D plan. Edited plans flow into the Unit 3D Inside camera. |
| Dashboard | Six tabs (Map, Shortlist with Tours, Compare, Unit 3D, Floor plan, Research with Records), system, dark and light themes, and an in-app search settings sheet. It runs as a local server, on GitHub Pages or as one standalone HTML file. |
| Quality gate | 318 pytest and 107 `node:test` tests. CI runs both, plus the privacy, ignore and photo parts of `scripts/release_check.py`. |

### Known limits (honest)

- **Records automation is NYC-only, and there is one city profile** (`config/cities/nyc.yaml`). The "works
  anywhere" claim for commute, 3D and scoring has not been shown end to end on a second city.
- **The standalone file needs a network connection only for map tiles.** MapLibre, three.js, pdf.js, the Geist
  fonts and d3-contour are vendored and inlined; without tiles the map falls back to a plain background under the
  local overlays.
- **Dossiers stop at one building identity.** There are no elevator, facade (FISP), certificate-of-occupancy,
  litigation, registration or OATH datasets, and no resolution of address aliases or condo billing lots.
- **Commute is for the morning arrival window only.** There is no late-night trip home, no rideshare
  estimate and no route drawn on the map.
- **Monitoring is limited to pages that allow it.** `apartmentscout monitor` re-reads known units on hosts the renter allowed;
  the big portals block automated reads and are never fetched. `apartmentscout alerts` reports changes in the search data, and an
  opt-in workflow turns the digest into a daily GitHub issue (the GitHub app notifies the phone). There is no Web Push: an alert
  while the installed app is closed needs a push server (see docs/guides/alerts.md).
- **Some placements are hypotheses.** Window exposure and position are often assumed (three of the four
  Emerald Green units read "Unverified"). Only one window placement can be held at a time. Daylight is
  relative, not photometric.
- **State is per browser.** Picks, notes, tiers, settings and plan scenarios live in `localStorage`. There
  is no sync across tabs or devices and no shared shortlist.
- **The demo looks emptier than the product.** The bundled example has no recorded history, picks or
  watchlist, so New & changed, Gone fast, Watchlist and Tours all open empty. Because staleness is measured
  against today, the queue reports all 430 homes as stale and 0% at the finalist standard.
- **Nothing tests the dashboard in a browser.** There are no end-to-end, accessibility or visual regression
  checks. Screenshots are taken by hand with `scripts/screenshots.py`.
- **Hygiene is open.** The working tree holds an untracked "Model library" page (`dashboard/studios.html`)
  that links to local development URLs, and an untracked inventory note. The example's commute destination
  is a specific street address in 12 tracked files, where a public landmark would do.

## Now (next two weeks)

Ranked by value to renters and to trust in the numbers.

### 1. Clean the tree and the example identity. **S**
- **Problem:** Unreviewed files and a specific destination address would ship with the next push.
- **Build:**
  - Rebuild `studios.html` as item 12 under Next, or remove it together with its top-bar link in
    `dashboard/index.html`.
  - Move the inventory note out of `docs/`.
  - Replace the example destination with a public landmark (for example the Grand Central Terminal
    concourse), then rerun `commute`, `score`, `build` and the standalone build.
- **Files:**
  - `dashboard/studios.html`, `dashboard/index.html`, `docs/CREATION_INVENTORY_2026-10-13.md`
  - `examples/nyc-2026/{criteria.yaml,README.md,layers/*}`
  - `dashboard/data/*`, `dist/ApartmentScout-NYC-example.html`
  - `scripts/release_check.py`, which gains the new pattern
- **Accept:**
  - `git grep` finds no `127.0.0.1:8779`, no `claude.ai/artifact` and no street address for the
    destination.
  - `release_check.py` passes.
  - Commute numbers move by less than 1 min on average.

### 2. Browser smoke and accessibility tests in CI. **M**
- **Problem:** Eight views and a 5,700-line front end have no browser test, so regressions reach the demo.
- **Build:** A Playwright suite that runs each view on the example:
  - checks that each view loads with zero console errors;
  - drags a weight and checks that the order changes;
  - opens the drawer, opens a `#compare/a,b` deep link, imports a plan, and checks the Unit 3D Window
    camera;
  - checks for no horizontal overflow at 390 px;
  - runs axe-core with zero serious violations.
  The screenshot helpers can be reused.
- **Files:** new `tests/e2e/`, `.github/workflows/tests.yml`, `scripts/screenshots.py` (shared fixtures),
  and `pyproject.toml` (`[dev]`).
- **Accept:**
  - CI runs the suite headless in under 5 minutes.
  - A planted `throw` in `compare.js` fails it.

### 3. A standalone file that works offline. **M**
- **Problem:** "Double-click and it opens" fails on a plane or behind a proxy. The 3D views show "could not
  load".
- **Build:**
  - Vendor MapLibre, three.js (plus the GLTF exporter and controls) and pdf.js into `dashboard/vendor/`, and
    bundle them into the standalone build.
  - When tiles fail, the map falls back to a plain canvas with the commute bands, pins and subway lines from
    local data, plus a "basemap offline" chip.
- **Files:** `dashboard/vendor/`, `dashboard/index.html`, `dashboard/js/map.js`, `dashboard/js/unit/scene.js`,
  `dashboard/js/plan/tracer.js`, `scripts/bundle.sh`, the `build --standalone` path in `apartmentscout/cli.py`,
  and `docs/guides/dashboard.md`.
- **Accept:**
  - With the network blocked in Playwright, all eight views render.
  - Unit 3D draws the city and the tracer opens a PDF.
  - Standalone size grows by less than 6 MB.

### 4. A demo that shows the whole product. **M**
- **Problem:** First-time visitors see empty Research tabs, an empty Tours board and "430 stale".
- **Build:**
  - Ship example history derived from the search's own recorded check dates and price claims: two dated
    snapshots and the claims log, with nothing invented and labelled as the example.
  - Ship a small example watchlist and example picks with tiers that load only for `examples/`.
  - Measure staleness for an archived example against its data date ("as of 13 Oct 2026"), not today.
- **Files:**
  - `examples/nyc-2026/{history,watchlist.yaml}`
  - `apartmentscout/quality/{standard,history,watchlist}.py` (an `as_of` for archived searches)
  - `dashboard/js/tours.js` ("Try the example's picks")
  - `dashboard/js/research/*.js`
- **Accept:**
  - On the Pages demo, New & changed, Gone fast and Watchlist each show at least one item, and Tours shows a
    board.
  - A private search is unchanged (test).

### 5. The route on the map, plus nearby stations. **M**
- **Problem:** The drawer lists legs as text, but the renter cannot see where the walk goes or which station
  is closest.
- **Build:**
  - The router stores stop coordinates for each leg.
  - The drawer gets a "Show on map" control per mode. It draws a dashed walk, rides in the line colour along
    GTFS shapes between the board and alight stops, and a mode switcher with a "Back" chip.
  - A "Stations within 10 minutes" row shows line bullets and walking minutes.
- **Files:** `apartmentscout/commute/{run,gtfs,lines}.py`, `dashboard/js/map.js`, `dashboard/js/app.js` (drawer),
  and `docs/guides/data-model.md`.
- **Accept:**
  - On an example listing, the route endpoints fall within 30 m of the listing and the destination.
  - The drawn ride matches the line in the legs.
  - It works with the keyboard and in both themes.

### 6. Records that end in actions. **S-M**
- **Problem:** The report lists concerns but does not tell the renter what to ask, or what the data cannot
  show.
- **Build:** Generated sections:
  - **Written answers that would clear these:** one question per open finding.
  - **Reassuring, with limits:** clean results and what they do not prove.
  - **Evidence boundary:** datasets not queried or failed, no interior inspection, no rent history.
  - **Same line:** complaints on the unit's line within two floors, phrased as "same line, 2 floors above",
    never as a unit number.
  The summary chips jump to their rows.
- **Files:** `dashboard/js/records/model.js`, `dashboard/js/records.js`, `templates/research-note.md`,
  `.claude/skills/building-dossier/SKILL.md`, and a new `tests/js/records-model.test.mjs`.
- **Accept:**
  - On a fixture, a 24J ventilation complaint shows under "Same line" for 23J.
  - A heat finding adds the heat question.
  - The print view includes all four sections.

### 7. Dossier identity resolution and first v2 datasets. **L**
- **Problem:** Condo towers, corner buildings and rebuilt lots split their records across several BINs,
  BBLs and addresses, so today's counts can miss rows or include a predecessor building.
- **Build:**
  - `identity()` resolves HPD building id, all BINs (with predecessors excluded), billing lots and address
    aliases.
  - Every query then uses the alias sets.
  - Add four datasets with wording rules: DOB elevator compliance and devices ("paperwork open, not
    unsafe"), facade FISP ("SWARMP means repairs required"), certificate of occupancy, and HPD litigation
    ("an action, not a finding").
  - Each dataset gets a receipt with `limit_hit` and "data updated".
- **Files:** `apartmentscout/records/nyc.py`, `dashboard/js/records/{model,ledgers}.js`, `dashboard/js/records.js`
  (an Identity block), `docs/guides/methodology.md`, and new `tests/test_records_identity.py` with recorded
  fixtures.
- **Accept:**
  - A recorded condo fixture with two certificate-of-occupancy BINs returns both, plus the predecessor under
    `excluded_bins`.
  - A failed query shows "failed", never "0 rows".
  - No personal names are stored (test).

### 8. Competing window hypotheses in Unit 3D. **S-M**
- **Problem:** When exposure is unknown, the 3D answer looks more certain than it is, and a rejected facade
  disappears without a reason.
- **Build:**
  - The site JSON gets `windows.candidates[]` with a status of confirmed, likely, unconfirmed or rejected,
    plus a reason and evidence. A single window is read as one candidate, so old files still load.
  - The Window panel shows sun hours for each candidate side by side, with rejected candidates disabled and
    their reason shown.
  - The status goes on snapshots and GLB extras. Scores use only confirmed or likely candidates.
- **Files:** `apartmentscout/geo/site.py`, `dashboard/js/unit3d.js`, `dashboard/js/unit/panels.js`,
  `.claude/skills/unit-light-and-view/SKILL.md`, and `tests/test_sitemodel.py`.
- **Accept:**
  - A party-wall candidate shows as rejected with its reason.
  - Rejected candidates never feed scores or exports (test).

### 9. JSON Schemas as the agent contract. **M**
- **Problem:** Agents learn the data shapes from prose, and validation rules live only in code.
- **Build:**
  - Publish JSON Schemas for `listings.json`, `criteria.yaml`, plan JSON v2, the site summary and the
    handoff `updates.json`.
  - Add `apartmentscout schema [name]`, which prints a schema.
  - `validate` checks against the schemas first, then the semantic rules.
  - Link the schemas from `AGENTS.md`.
- **Files:** new `apartmentscout/schemas/*.json`, `apartmentscout/quality/validate.py`, `apartmentscout/cli.py`,
  `docs/guides/data-model.md` and `AGENTS.md`.
- **Accept:**
  - The example passes.
  - One bad fixture per schema fails with a JSON path.
  - The schemas and `data-model.md` agree (test).

### 10. `apartmentscout watch`: rechecks on request, within a budget. **M**
- **Problem:** Inventory changes daily. The renter needs to know what changed among the homes that matter,
  without an agent hammering portals.
- **Build:**
  - `watch plan` prints today's recheck list: finalists, shortlist and watched buildings, ordered by score
    impact and capped by a fetch budget.
  - `watch record` appends the results as claims.
  - `watch report` writes "what changed since the last check": new qualifiers, lost top picks, price and
    concession changes, relists under a new URL.
  - Watch runs only when the renter asks. Scheduling comes later.
- **Files:** new `apartmentscout/commands/watch.py`, `apartmentscout/quality/{history,watchlist}.py`,
  `.claude/skills/listing-sourcing/SKILL.md`, and a new `docs/guides/monitoring.md`.
- **Accept:**
  - The fetch budget is respected.
  - A repriced listing is not reported as "new".
  - With no material change, the output is "nothing changed" (unit test on the diff).

### 11. Phone layout fixes. **S-M**
- **Problem:** On a 390 px phone, only 3 of the 8 tabs show and nothing hints at the rest. The Shortlist
  table hides price and score behind a horizontal scroll, and the map layer chips wrap over the map controls.
- **Build:**
  - Add a "More" tab menu.
  - Below 600 px, the Shortlist becomes compact cards (rank, name, monthly, tier, score, commute).
  - Map layer chips become a single select.
- **Files:** `dashboard/css/*.css`, `dashboard/js/list.js`, `dashboard/js/app.js` (tabs) and `dashboard/js/map.js`.
- **Accept:**
  - The e2e suite (item 2) shows no horizontal overflow at 390 px.
  - Score and monthly cost are visible for the first five rows without scrolling.

### 12. "Can anything beat this one?" baseline in Compare. **M**
- **Problem:** Late in a search, the question is relative: is anything better than my current favourite?
- **Build:**
  - Compare gets "Set as baseline": every column shows deltas against it (monthly cost, headroom, size with
    its basis, floor, commute and gates).
  - `apartmentscout report --benchmark <id>` writes a memo:
    - the baseline's facts;
    - alternatives that beat it on the renter's weights, each with what still matters;
    - screened-out homes with reasons;
    - a tour order and the decisive questions.
- **Files:** `dashboard/js/compare.js`, `apartmentscout/report.py`, `templates/decision-memo.md` and
  `.claude/skills/tour-and-decide/SKILL.md`.
- **Accept:**
  - Unknown size prints "not derivable", with no percentage across different size bases.
  - Homes that fail a hard date appear only in the screened list.
  - The output is deterministic.

## Next (the following month)

| # | Item | What it adds | Effort |
|---|---|---|---|
| 1 | Records v2, rest | Registrations (company contacts only), OATH via address aliases, legacy DOB violations ("feeds overlap, don't add"), the 421-a exemption chain and the rent-stabilisation question, executed evictions as counts by year only, and the hurricane evacuation zone and flood check. A Sources table with reproduce links. | L |
| 2 | Late-night and rideshare commute | Optional `night` profile (leave after 23:30) per destination, and a labelled rideshare estimate (time and fare, day and night) from a configurable rate card. Optional score dimension at weight 0. | M |
| 3 | Verification gate matrix | `report --verify <ids>`: identity and status, enclosed bedroom, in-unit W/D, elevator, start date, commute, first-lease cost test and media scope, ending in a pass / conditional / fail verdict with confidence. Shown as a card in the drawer. | M |
| 4 | Tour findings | Structured visit capture, kept separate from listing claims: measured noise (dB at the window, day and night), water pressure and hot-water delay, cell signal, window view vs model, photos taken with permission, and a revision trail. The app fills in the decision memo. | M |
| 5 | `apartmentscout reconcile` | Crosswalk another agent's or a spreadsheet's inventory (exact URL, address+unit, alias, duplicate such as `0807` vs `807`) and adjudicate as accepted, accepted with conflict or rejected. A dry run leaves files byte-identical. | M |
| 6 | Custom-criterion register | Criteria the renter invents (for example a games room or a workshop) with evidence levels (explicit, named room, related, lead), requirements, a register view and an `amenity-research` skill. A lead is scored as unknown. | M |
| 7 | Media evidence | `apartmentscout media frames <id> <video>` (optional ffmpeg): frames and a contact sheet in the search folder. Scope chips (exact unit / same line / building / representative), with warnings when a filename names another unit or an old date. | M |
| 8 | Size and plan provenance in the UI | Plan `match` (exact / line-band / representative / mismatch) gates "plan-verified" badges. A plan whose floor band excludes the unit warns. Area from the traced polygons, with a calibration range. | S-M |
| 9 | Second city, end to end | A public non-NYC example (GTFS plus OSM plus hand-researched records) that checks the "works anywhere" claim. Fix whatever breaks. Write a second city profile and a city-module template with tests. | L |
| 10 | Local state you can carry | One "export everything" file (settings, picks, tiers, notes, plan scenarios) with import. Cross-tab `storage` sync. Atomic multi-key writes. | S |
| 11 | Furniture products in the fit check | `furniture/products.json` with verified dimensions and dated prices. "Use a product" in the inspector, storage beds with drawer pull-out zones, and an access-route check against the narrowest door. | M |
| 12 | Model library view | Replaces the untracked page. Per listing, it shows which deep models exist (site, plan, dossier, media, exports), with the rule "a building-wide model is not evidence for every unit". Built from the manifest. | S |
| 13 | Shared sun state | The Floor plan and Unit 3D share the date and time, and a plan's "shaded" pill links to the building that Unit 3D names. | S |

## Later (bigger bets)

- **Other cities at scale.** A generic Socrata / ArcGIS Hub records adapter driven by a city profile, records
  modules for two or three large US cities, community city profiles with CI checks, and international
  geocoding, currency and units.
- **Real photometry.** An optional Radiance backend with calibrated glazing and surface materials, climate-based
  annual daylight, illuminance grids and glare, validated against published test cases. The relative model
  stays the default, and nothing is presented as lux without calibration.
- **Monitoring and alerts.** Scheduled `watch` runs only after the renter opts in. Alerts go through the
  renter's own channel (email, push or a calendar digest). Fetch budgets are enforced, and sources that
  forbid automated access are not used.
- **Multi-renter collaboration.** A shared shortlist with per-person weights that can be blended or compared,
  votes and comment threads on a listing, a "who decides what" split, and conflict handling built on the
  existing claims model.
- **Hosted sync, optional and end-to-end encrypted.** Local-first stays the default. Sync is for people who
  want the same search on a phone and a laptop, or to share it with a partner. The server never holds
  plaintext.
- **An MCP server.** Expose the CLI (score, coverage, questions, dossier, site, handoff) as typed tools, so any
  MCP-capable agent can drive a search without shell access.
- **Measured geometry.** Import measured or CityGML / GLB building meshes and facade details (balconies,
  mullions, parapets). Calibrate exact-unit photos to the window camera.
- **Lease review.** Parse a lease or rider the renter supplies for fees, renewal caps, break clauses and
  concession conditions, checked against the money model. Done locally, with nothing uploaded.

## UX improvements found while browsing

All screenshots were taken from the bundled example at 1600 x 1000 (phone shots at 390 x 844). They are
referenced by file name under `shots/roadmap/` and are not committed.

**Map**: `map.png`, `map-drawer.png`, `map-light.png`, `mobile-map.png`
- The results header truncates to "325 homes · ranke…" at 1600 px. Shorten it to "325 homes", or let it wrap.
- The "Door to door" legend card always covers the lower left of the map and the pins beneath it. Make it
  collapsible, and collapse it when the drawer opens.
- Pin fills (blue vs white) on the commute layer have no legend entry.
- Neighbourhood labels collide with price tags ("MIDTOWN SOU…", "MUR…"). Give tags priority, or drop the
  labels behind them.
- Card commute chips are glyph-only at small size. Spell out the fastest mode ("subway 8").
- Drawer: "touring" and "Conditional tour" sit side by side as chips and read as duplicates. "Lease term
  unknown" appears while one-time fees are spread over 12 months; say "spread over 12 months (assumed)"
  inline.
- Top bar: the download icon has no visible label. Add a "CSV" text label or tooltip. "23 min median to
  Office" should say which set it covers ("of 325 matching").
- Phone: "Rent / ft²" wraps onto two lines and the chips run under the zoom column (see item 11 under Now).

**Shortlist**: `list.png`, `mobile-list.png`
- The meaning of "31?" in the Floor column is unexplained. Compare already says "31 inferred"; use the same
  word or a tooltip.
- The KNOWN column reads 100% on rows whose W/D is "?". Rename it to "score facts known", or include the
  must-haves.
- Availability text is cut off ("avail Now (per buildin"). Move it to a tooltip or a second line.
- On a phone the table scrolls sideways and hides monthly cost and score (see item 11 under Now).

**Compare**: `compare.png`, `compare-four.png`
- The cost-against-space scatter stops at the $5.5k line, so the 95 over-cap homes disappear. Show them
  faded above the line.
- "Best in row" goes to the only known value in a row of unknowns (for example recurring fees of $29 next
  to three unknowns). Mark it "best of 1 known".
- When a home has no photo, its column header shows a schematic with tiny "No listing photos saved" text.
  Raise the contrast or move the note into the card.

**Unit 3D**: `unit-emerald-green-1211.png`
- At 1000 px height, the "Sun on this window" card is cut off and nothing shows that the right panel
  scrolls. Add a scroll fade, or pin the four sun tiles.
- In the orbit view, the orange "under construction" labels overlap each other and the street labels.
  Declutter them as the price tags already are.
- "Units in this building" cards say "ask for the floor plan". Make that a button that copies the question.

**Floor plan**: `plan-emerald-green-1211.png`
- In 2D, the TV-distance callouts sit on top of the table and coffee-table labels, and "W/D + closet"
  overlaps "Washer/dryer". Add label collision handling or leader lines.
- The amber "9 fixtures estimated" note has no link to the fixtures. Clicking it should highlight them.
- The 3D pill "Every window shaded by neighbours" does not name the building or link to Unit 3D (see item 13
  under Next).

**Records**: `records-emerald-green-1211.png`
- A records score of 90 sits beside "4 to check". Add one line on how the score is built and what 90 means.
- The summary chips are not links. They should jump to their "What matters" row (see item 6 under Now).
- There is no Identity block (BINs, lots, aliases) (see item 7 under Now).

**Research**: `research-queue.png`, `research-new.png`
- "0%" and "430 stale" make the example look broken. For archived searches, measure staleness against the
  data date (see item 4 under Now).
- "Copy questions 317" copies everything. Scope it to the current filter or selection and show the count
  before copying.

**Tours**: `tours.png`
- The first visit is an empty board. Offer "Try with the example's picks" on example searches (see item 4
  under Now).

## Quality and trust

**Testing**
- Keep the pure-module discipline: money, scoring, sun, plan checks and the tracer are all node- or
  pytest-tested.
- Add browser end-to-end and axe-core checks (item 2 under Now).
- Add visual diffs of the eight views on the example, with a tolerance, so a CSS change cannot silently
  break a view.
- Add recorded Socrata and Overpass fixtures for every records dataset, so tests never touch the network.
- Add property tests on the money model: unknown never becomes 0, and monthly cost is never below gross
  minus concessions.
- Add a full-example scorer parity test (Python vs browser, all 732 listings).

**Validation**
- `validate`, `lint` and `coverage` exist. Next, they gain JSON Schemas (item 9 under Now) and an
  expected-warnings snapshot for the example, so new lint rules show their effect.
- `build --strict` should refuse to publish a search whose `validate` fails.

**Data provenance**
- Every number on screen should answer "where from, when, how".
- Site models already carry receipts (query URL, rows, `limit_hit`, fetched-at). Extend the same receipts
  to every dossier dataset, with the dataset's own "data updated" date (item 7 under Now).
- Facts carry a scope (exact unit, same line, building, renter said), and assumed values stay labelled in
  snapshots, GLB extras and exports.
- Received claims are evidence, not instructions, and an older claim never overrides a newer fact.

**Privacy**
- Local-first by default, with no telemetry. Searches are git-ignored and served from their own cache.
- `release_check.py` gates publishing. Extend it with the destination-address check and a scan of the
  standalone file.
- Any future sync is opt-in and end-to-end encrypted.
- Agents never contact landlords, log in, solve CAPTCHAs or submit forms without the renter's say-so.
- Third-party reviewer names are withheld from published notes, and eviction or complaint data is never
  tied to a unit number.

**Honest labels**
- "Not a market census", "reports, not findings", "relative daylight, not lux" and "estimate" stay on
  every surface that shows those numbers, including exports and screenshots.

## Risks and open questions

**Risks**

| Risk | Mitigation |
|---|---|
| Listing sites block automation, and agents may be tempted to work around it | Keep the "stop and ask the renter" rule in `AGENTS.md` and the skills. `lint` already flags bot-challenge pages saved as evidence. Monitoring stays opt-in and budgeted. |
| Third-party listing photos in the public example (about 1,000 web-sized files, 29 MB) | Publication was a recorded owner decision for a private repository. Before any public release, re-confirm the rights, or replace the photos with Commons photos and aerial fallbacks. |
| Repository weight (the example is 86 MB) | Move bulky example media and layers to a release asset or Git LFS, and keep a light example in the tree. |
| NYC Open Data schema or dataset-id drift | Receipts, recorded fixtures and "failed, not 0 rows" handling. A scheduled CI job that pings each dataset's metadata. |
| CDN dependency for maps and 3D | Vendoring plus an offline fallback (item 3 under Now). Keep the OpenFreeMap / OSM attribution visible. |
| Modelling scope creep (photometry, meshes) crowding out renter workflow | Keep 3D work behind trust items. Photometry stays under Later and is gated on calibration data. |
| Concurrent agents editing the same working tree | Changes arrive as handoff packs or pull requests. One writer per file. `release_check` flags untracked files in `dashboard/` and `docs/`. |

**Open questions**
1. Which city should be the second public example, given that GTFS feeds, open records and building heights
   all need to be available?
2. Should the example history in item 4 under Now be derived only from recorded claims, even if that leaves
   Gone fast thin?
3. Is hosted sync ever in scope, or should collaboration stay file-based (packs, exports, a shared folder)?
4. Which alert channel fits a local-first tool without running a server: email via the renter's own
   provider, OS notifications, or a calendar digest?
5. Do MTA GTFS terms allow redistributing derived commute grids in a public example, or should the example
   ship scripts and recompute them?
6. Once this roadmap is adopted, should `FEATURE_GAP_PLAN_2026-10-13.md` be archived, so there is a single
   planning document?
