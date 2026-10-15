# Gallery

Screenshots of the ApartmentScout dashboard on the included example (a Manhattan one-bedroom search from
fall 2026 with a commute to a Midtown office near Grand Central), followed by the earlier one-off tools
built during that search, which the dashboard grew out of. Listing photos in the cards were cleared for use in
this private repository; re-check their rights before making it public.

Every image here is marked `public` in [`gallery/manifest.json`](gallery/manifest.json); see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for map and photo attribution.

## The ApartmentScout dashboard

### Map

The home view: a filter rail with budget tiers, histograms, must-haves and live weight sliders (the sections fold away); ranked
listing cards with walk, subway and bus minutes; and a vector map with heat layers, official subway
lines, price tags and a floating listing drawer.

<table>
<tr><td width="50%"><img src="images/map-commute.png" alt="Commute layer"><br><sub>Best-of-transit door-to-door minutes to Grand Central, arriving 09:00, walking on the real street network to real station entrances: greens to 15 minutes, yellow and gold to the 30-minute limit (dashed), reds past it</sub></td><td width="50%"><img src="images/map-drawer.png" alt="Listing drawer"><br><sub>Listing drawer: a credited building photo, monthly cost, gross rent and paid month, move-in cash, unknown fees left unknown, tier headroom and why it ranks here</sub></td></tr>
<tr><td width="50%"><img src="images/map-noise.png" alt="Noise layer"><br><sub>311 noise complaints per year in 150 m cells (335,923 requests), labelled as reports, not findings</sub></td><td width="50%"><img src="images/map-rent.png" alt="Rent layer"><br><sub>Monthly cost per ft², interpolated from the listings</sub></td></tr>
<tr><td width="50%"><img src="images/map-score.png" alt="Score layer"><br><sub>Average score nearby with your weights</sub></td><td width="50%"><img src="images/map-commute-light.png" alt="Light theme"><br><sub>The light theme</sub></td></tr>
<tr><td width="50%"><img src="images/map-3d.png" alt="3D buildings"><br><sub>3D buildings over the commute bands, with subway lines, stations and walking-time rings</sub></td><td width="50%"><img src="images/map-drawer-commute.png" alt="Commute by mode in the drawer"><br><sub>Commute by mode: best, subway, bus and walk tiles, the route leg by leg with times, records flags, what residents say and open questions</sub></td></tr>
<tr><td width="50%" align="center"><img src="images/mobile-map.png" alt="Phone layout" width="300"><br><sub>On a phone: the map on top, ranked cards in a sheet below</sub></td><td></td></tr>
</table>

### Shortlist

<table>
<tr><td><img src="images/shortlist.png" alt="Shortlist table"><br><sub>Every filtered listing ranked live by your weights: monthly cost, budget tier, size and $/ft², commute, floor and exposure, laundry, doorman and gym (? means unconfirmed), score, the share of the score resting on known facts, and status. Keyboard: arrows move, Enter opens, s saves, c compares. Share shortlist (top right) is for your saved picks; the Map button docks a mini map.</sub></td></tr>
</table>

### Compare

<table>
<tr><td><img src="images/compare.png" alt="Compare view"><br><sub>Four finalists in lettered columns: money, space, commute, building, light and score rows with the best value in each row marked and unknowns that never count as the worst; hard requirements and open questions; a cost-against-space scatter of every eligible listing with the value frontier; and where each one wins, dimension by dimension.</sub></td></tr>
</table>

### Unit 3D

The building and its real neighbours in 3D, with sun, shadows, the view from the window and from inside
the apartment.

<table>
<tr><td colspan="2"><img src="images/unit-orbit.png" alt="Unit 3D"><br><sub>Emerald Green 1211: provenance chips (listing says, assumed, matched by BIN), units in the building with compass dials, Orbit / Window / Inside / Plan / Top cameras, towers under construction drawn dashed, the window panel and a day strip comparing floors 12 and 21 on October 15</sub></td></tr>
<tr><td width="50%"><img src="images/unit-window-12.png" alt="Floor 12 window"><br><sub>From the 12th-floor window at 1 pm: in the shadow of 326 West 37th Street</sub></td><td width="50%"><img src="images/unit-window-21.png" alt="Floor 21 window"><br><sub>Same line, 21st floor: direct sun, One Manhattan West, and a permitted tower outlined where it will stand</sub></td></tr>
<tr><td width="50%"><img src="images/unit-inside.png" alt="Inside camera"><br><sub>Inside: the floor plan's walls and windows at the real slab height, with the sun patch on the floor at 11:30 am</sub></td><td width="50%"><img src="images/unit-plan-view.png" alt="Plan camera"><br><sub>North-up plan camera with the window and the filed new buildings around it</sub></td></tr>
<tr><td width="50%"><img src="images/unit-orbit-dec.png" alt="Winter shadows"><br><sub>December 21 at 12:30 pm: long winter shadows</sub></td><td width="50%"><img src="images/unit-maybury.png" alt="Another building at sunset"><br><sub>Another building, 22nd floor, 7:30 pm on June 21: Hudson Yards with proposed and rising towers outlined</sub></td></tr>
<tr><td width="50%"><img src="images/unit-sunpath.png" alt="Sun path"><br><sub>Sun paths against the skyline from the window; dashed, the skyline from the compare floor</sub></td><td width="50%"><img src="images/unit-floors.png" alt="Sun by floor and month"><br><sub>Direct-sun hours on the 15th of each month for every floor; your floor outlined</sub></td></tr>
<tr><td width="50%"><img src="images/chart-sunpath.png" alt="Report chart: sun path"><br><sub>Report chart from <code>apartmentscout site --charts</code>: sun path, floor 12</sub></td><td width="50%"><img src="images/chart-sun-by-floor.png" alt="Report chart: sun by floor"><br><sub>Report chart: direct sun by floor and month</sub></td></tr>
</table>

### Floor plan

<table>
<tr><td width="68%"><img src="images/plan-bird.png" alt="Floor plan studio"><br><sub>Synced 2D plan and 3D model under the real sun: ten pieces placed with fit checks all clear, bed and sofa TV distances marked ideal, eye-level cameras and two layout presets written for this plan</sub></td><td width="32%"><img src="images/plan-top.png" alt="Top down"><br><sub>Top-down at 5 pm on June 21; every window shaded by neighbours</sub></td></tr>
</table>

### Paramount Tower 25E

The unit the search ended on: $4,995 a month plus $37 in fees, E line on the 24th floor, a nine-minute walk to
Grand Central. It has no in-unit washer/dryer; the renter waived that must-have for the space and the view, so
it still costs amenity points but no longer gates the unit out. With the renter's building ratings and the graded
interiors it ranks #1.

<table>
<tr><td colspan="2"><img src="images/map-paramount.png" alt="Paramount Tower 25E on the map"><br><sub>The listing drawer for 25E over the commute map</sub></td></tr>
<tr><td width="50%"><img src="images/unit-paramount.png" alt="Paramount Tower 25E in Unit 3D"><br><sub>Unit 3D: the tower among its Murray Hill neighbours on October 15. The bay faces ESE (119°), read from the renter's own photos and a park sightline check: the only open side, and the only one with park canopy in view</sub></td><td width="50%"><img src="images/plan-paramount.png" alt="Paramount Tower 25E floor plan"><br><sub>Floor plan studio on the Glenwood E-line drawing: nine pieces placed, all clear, TV distances marked ideal</sub></td></tr>
<tr><td width="50%"><img src="images/unit-paramount-window.png" alt="Window camera"><br><sub>Window camera, 24th floor, facing ESE over Second Avenue toward the East River, with parks and trees drawn from OpenStreetMap</sub></td><td width="50%"><img src="images/unit-paramount-inside.png" alt="Inside camera"><br><sub>Inside: the bedroom bay at the 25th-floor slab height, park canopy low in the right-hand angled pane as in the renter's photo</sub></td></tr>
</table>

### Research: records

Records now sit inside the Research tab, next to the research queue and media.

<table>
<tr><td><img src="images/records.png" alt="Records report"><br><sub>A due-diligence report for one building: PLUTO facts, record and street-noise scores, metric tiles, a "What matters" table (issue, evidence, practical significance), monthly timelines of 311 and official records, 311 by hour and type, complaints and crime by category, collapsible ledgers, research notes and sources.</sub></td></tr>
</table>

### Research

<table>
<tr><td width="50%"><img src="images/research.png" alt="Research queue"><br><sub>The finalist standard and its gaps, then the research queue: missing and stale facts, points at stake, last check and copyable questions</sub></td><td width="50%"><img src="images/research-media.png" alt="Research media"><br><sub>Media: every image of a home grouped by listing, with scope tabs and counts, a broker-mark filter and the credit on hover; details under Photos below</sub></td></tr>
</table>

### Shortlist: tours

Tours are a section of the Shortlist tab.

<table>
<tr><td><img src="images/tours.png" alt="Tours"><br><sub>Saved picks on a tier board (S, A, B, C, Pass) with tour times and notes, and below it the tour plan in nearest-next order from the office with walking and viewing minutes and a route map. The tour-day planner above it is shown under "Deciding".</sub></td></tr>
</table>

### Map lenses and route preview

Hover a home and its commute route is drawn; the star and sun lenses change what the pins mean; the Shortlist can dock a
map beside its table. The picks used in the starred, tray and tour shots are five example saves, not data from the search.

<table>
<tr><td width="50%"><img src="images/map-route-preview.png" alt="Route preview on hover"><br><sub>Route preview, subway lens: hovering the Emerald Green 24D card draws its trip to Grand Central on the map, an 11-minute walk (dashed), the S shuttle on its own line, a short walk at the end, and a 17-minute pill</sub></td><td width="50%"><img src="images/map-starred-lens.png" alt="Starred-only lens"><br><sub>The "★ 5" chip counts your saved picks and shows only those pins, ringed in gold, with a fit button and <b>+ List</b> to filter the cards too; the Shortlist tab counts the same five</sub></td></tr>
<tr><td width="50%"><img src="images/map-sun-lens.png" alt="Sun lens"><br><sub>Sun lens: pins and price tags coloured by direct-sun hours in October (0.0 to 5.7 h) for the four homes that have a site model; every other home is grey and marked "?" and the legend says so, with a month stepper</sub></td><td width="50%"><img src="images/list-split-view.png" alt="Shortlist split view"><br><sub>Shortlist split view: the table's 60 filtered homes beside a docked mini map of exactly those homes; hovering a row (Orion Condominium 14D) previews its route, here a bus trip marked "path approximate"</sub></td></tr>
</table>

### Filters, rail and ranking

<table>
<tr><td width="50%"><img src="images/map-filter-chips.png" alt="Filter chips"><br><sub>Filter chips above the results: Target ≤ $5,000, ≤ 25 min · Best, Full-time doorman and Gym, each removable with its ×, plus Clear all; the list is down to 40 homes</sub></td><td width="50%"><img src="images/rail-collapsed.png" alt="Collapsible rail sections"><br><sub>Collapsible rail: Search, Budget, Must-haves and Status are folded to one-line summaries ("Within budget ≤ $5,450", "None", "Active") so the weight controls fit on screen</sub></td></tr>
<tr><td width="50%"><img src="images/tradeoff-pad.png" alt="Trade-off pad"><br><sub>Trade-off pad: one dot trades Cost, Commute and Space against each other; pointing at a preset ring (Biggest and nicest) previews how the top ten would re-order and who falls out, before you click to apply it</sub></td><td width="50%"><img src="images/map-rank-changes.png" alt="Rank-change badges"><br><sub>After switching the weight preset to Cheapest good enough, ▲ and ▼ badges beside each card's rank show how far it moved (▲7 on the new #1, ▲175 on #6, ▼1 on #5)</sub></td></tr>
<tr><td width="50%"><img src="images/map-compact.png" alt="Compact density"><br><sub>Compact density: smaller photos, two badges per card and a tighter rail, so more cards fit on screen</sub></td><td width="50%"><img src="images/card-photo-counts.png" alt="Card photo counts" width="300"><br><sub>The results column at 2x: each photo shows its count by group ("2 unit · 24 building", "20 building"); the count is a button that opens the lightbox</sub></td></tr>
</table>

Price-history sparklines and the "since your last visit" pill are not shown: the example data records no price changes
or snapshots, and the dashboard draws neither without them.

### Undo, search, shortcuts and comfort

<table>
<tr><td width="50%"><img src="images/undo-toast.png" alt="Undo toast"><br><sub>Starring Orion Condominium 23A shows a toast with an Undo button and the ⌘Z hint; the star, the Shortlist count and the "★ 1" chip have already changed</sub></td><td width="50%"><img src="images/palette-plain-words.png" alt="Plain-language search"><br><sub>⌘K with a sentence typed: the first row previews what it understood ("1 bd · ≤ $5,000 · ≤ 20 min subway to Grand Central · W/D", 20 of 434 active homes) before anything changes</sub></td></tr>
<tr><td width="50%"><img src="images/cheatsheet.png" alt="Keyboard cheat sheet"><br><sub>The <kbd>?</kbd> cheat sheet: searchable, with the keys for the view you are on (Map and results) listed first and Shortlist, Compare and Unit 3D beside them; 50 shortcuts in all</sub></td><td width="50%"><img src="images/coach-mark.png" alt="First-run tour"><br><sub>First-run tour (<code>?coach=1</code>): step 1 of 5 spotlights the filter rail with Skip tour and Next</sub></td></tr>
<tr><td width="50%"><img src="images/settings-menu.png" alt="Settings menu"><br><sub>The settings menu: theme, density, search and picks actions including Share shortlist and Decision memo, accent swatches, the golden-hour tint, the three comfort switches, text size and Take the tour</sub></td><td width="50%"><img src="images/accent-amber.png" alt="Amber accent"><br><sub>The Amber accent: the active budget tiers, histogram, commute slider and the map pins follow it; nothing else changes</sub></td></tr>
<tr><td width="50%"><img src="images/high-contrast.png" alt="High contrast"><br><sub>High contrast: every card and control gets a solid outline, text is brighter and the Top match link is underlined</sub></td><td></td></tr>
</table>

### Photos

<table>
<tr><td width="50%"><img src="images/lightbox.png" alt="Photo lightbox"><br><sub>The lightbox on Orion Condominium 23A: tabs by group with counts (All 41, Unit 12, Building 28, Floor plans 1), a thumbnail strip, the group, credit and position under the photo, zoom controls and the Plan switch</sub></td><td width="50%"><img src="images/lightbox-floor-plan.png" alt="Lightbox with floor plan"><br><sub>Plan set to Side by side: the unit photo beside the listing's own floor plan for 23A</sub></td></tr>
<tr><td width="50%"><img src="images/blur-up-preview.png" alt="Blur-up previews"><br><sub>Blur-up: with the photo files held back, each card already shows a blurred preview of its photo and the unit and building counts</sub></td><td width="50%"><img src="images/research-media.png" alt="Research media gallery"><br><sub>Research &gt; Media: a justified gallery with scope filters and counts, <b>Hide broker-marked</b>, and By listing, By building and All images; tiles carry their group, and "2 units" marks photos shared with another unit</sub></td></tr>
</table>

### Deciding: tray, share and tours

<table>
<tr><td colspan="2"><img src="images/decision-tray.png" alt="Decision tray"><br><sub>The decision tray along the bottom: Compare picks A, B and C with photo, price and score, an empty slot D to drag a home onto, a Compare button with the count and a fold control; it is the same list as the Compare tab</sub></td></tr>
<tr><td width="50%"><img src="images/share-shortlist-page.png" alt="Share shortlist page"><br><sub>The Share shortlist page (<code>dashboard/share/snapshot.html</code>): read-only, five homes, summary figures, a schematic map with the subway lines and a ranked list; each home below gets its photos, price and reasons</sub></td><td width="50%"><img src="images/share-decision-memo.png" alt="Decision memo"><br><sub>The decision memo: a ranked table with money, size, commute, score, tier and open items, the weights that mattered, then a page per home; use Print or save as PDF</sub></td></tr>
<tr><td colspan="2"><img src="images/tour-day-planner.png" alt="Tour-day planner"><br><sub>Tour-day planner at the top of Shortlist &gt; Tours: day, start, where you set off from, viewing time and buffer; a timeline of five stops (4 h 45 min, 1 h 12 min of estimated travel), when to leave by for each hop, and "Arrive early, wait" flags where a booked time is later than the plan; Add to calendar and Copy plan sit top right</sub></td></tr>
</table>

### New search wizard

<table>
<tr><td width="50%"><img src="images/wizard-basics.png" alt="New search wizard: basics"><br><sub><code>?new=1</code>: step 1 of 8, with every step's answer summarised in the left rail and the draft saved in the browser</sub></td><td width="50%"><img src="images/wizard-pick-on-map.png" alt="Placing a destination on the map"><br><sub>Places: <b>Place on map</b> hides the dialog and asks you to click the map to drop the destination pin</sub></td></tr>
<tr><td colspan="2"><img src="images/wizard-review.png" alt="Wizard review step"><br><sub>Review: the generated criteria.yaml, a diff against the open search (13 differences), and, because this page cannot write files, Copy YAML, Apply as preview and Download criteria.yaml</sub></td></tr>
</table>

### The CLI

<table>
<tr><td><img src="images/cli.png" alt="CLI output"><br><sub><code>commute</code>, <code>site</code> and <code>score</code> on the example search</sub></td></tr>
</table>

### More screens

<table>
<tr><td width="50%"><img src="images/map-bus.png" alt="Bus lens"><br><sub>Commute lens: bus</sub></td><td width="50%"><img src="images/map-walk.png" alt="Walk lens"><br><sub>Commute lens: walk rings</sub></td></tr>
<tr><td><img src="images/settings.png" alt="Search settings"><br><sub>Search settings</sub></td><td><img src="images/drawer-money.png" alt="Money"><br><sub>Money: every month, at signing, over the lease</sub></td></tr>
<tr><td><img src="images/unit-daylight.png" alt="Daylight"><br><sub>Daylight and blockers</sub></td><td><img src="images/unit-light-theme.png" alt="Unit 3D light"><br><sub>Unit 3D, light theme</sub></td></tr>
<tr><td><img src="images/plan-light-tab.png" alt="Plan light"><br><sub>Floor plan light tab</sub></td><td><img src="images/plan-tracer.png" alt="Tracer"><br><sub>Plan tracer</sub></td></tr>
<tr><td><img src="images/compare-light.png" alt="Compare light"><br><sub>Compare, light theme</sub></td><td><img src="images/map-light-drawer.png" alt="Map light"><br><sub>Map, light theme</sub></td></tr>
<tr><td><img src="images/mobile-drawer.png" alt="Phone drawer" width="300"><br><sub>Phone: listing panel</sub></td><td><img src="images/mobile-unit.png" alt="Phone unit" width="300"><br><sub>Phone: Unit 3D</sub></td></tr>
</table>

## Earlier tools from the search

The one-off tools an agent built during the Manhattan search, kept as design references and as examples
of what an agent can produce with this workflow. *Each was a prototype built by an agent during the
search.*

### First search dashboard

Every unit inside the commute radius on a styled Manhattan map with subway lines, filters, budget tiers,
weights, watchlist, gone-fast, compare and tour plan. Light and dark.

<table>
<tr><td width="50%"><img src="gallery/prototype--search-dark.jpg" alt="Dark mode, ranked by nicest and biggest"><br><sub>Dark mode, ranked by nicest and biggest</sub></td><td width="50%"><img src="gallery/prototype--search-home.jpg" alt="Light mode home"><br><sub>Light mode home</sub></td></tr>
<tr><td width="50%"><img src="gallery/prototype--search-units.jpg" alt="All units table"><br><sub>All units table</sub></td><td width="50%"><img src="gallery/prototype--search-new.jpg" alt="New and changed listings"><br><sub>New and changed listings</sub></td></tr>
<tr><td width="50%"><img src="gallery/prototype--search-gone-fast.jpg" alt="Gone fast: what rented and how quickly"><br><sub>Gone fast: what rented and how quickly</sub></td><td width="50%"><img src="gallery/prototype--search-my-list.jpg" alt="My list"><br><sub>My list</sub></td></tr>
<tr><td width="50%"><img src="gallery/prototype--search-compare.jpg" alt="Compare"><br><sub>Compare</sub></td><td width="50%"><img src="gallery/prototype--search-dark-compare.jpg" alt="Compare, dark"><br><sub>Compare, dark</sub></td></tr>
<tr><td width="50%"><img src="gallery/prototype--search-tour-plan.jpg" alt="Tour plan"><br><sub>Tour plan</sub></td><td width="50%"><img src="gallery/prototype--search-dark-tour.jpg" alt="Tour plan, dark"><br><sub>Tour plan, dark</sub></td></tr>
<tr><td width="50%"><img src="gallery/prototype--search-playbook.jpg" alt="Playbook"><br><sub>Playbook</sub></td><td></td></tr>
</table>

### Codex research site

A multi-page research site: unit sheet, building rankings, space research, shortlist and tours, personal
picks and dated research reports.

<table>
<tr><td width="50%"><img src="gallery/codexsite--site-space-research.jpg" alt="Find the biggest, nicest options"><br><sub>Find the biggest, nicest options</sub></td><td width="50%"><img src="gallery/codexsite--site-units-sheet.jpg" alt="Every unit on one sheet"><br><sub>Every unit on one sheet</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexsite--site-buildings.jpg" alt="Every researched building"><br><sub>Every researched building</sub></td><td width="50%"><img src="gallery/codexsite--site-shortlist-tours.jpg" alt="Shortlist and tours"><br><sub>Shortlist and tours</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexsite--site-my-picks.jpg" alt="My picks"><br><sub>My picks</sub></td><td width="50%"><img src="gallery/codexsite--site-research-report.jpg" alt="Research report, Sep 28"><br><sub>Research report, Sep 28</sub></td></tr>
</table>

### First commute heat map

The first commute heat map to a Midtown office near Grand Central.

<table>
<tr><td width="50%"><img src="gallery/commuteheat--commute_heat.jpg" alt="Commute heat map"><br><sub>Commute heat map</sub></td><td></td></tr>
</table>

### Emerald Green 1211 light and view model

Real NYC footprints and roof heights, live sun for any date and time, the view from the window, sun path
against the skyline, landmark visibility and direct sun by floor and month. The Unit 3D view generalises it
to any listing with a site model.

<table>
<tr><td width="50%"><img src="gallery/eg1211art--eg1211-stage-orbit.jpg" alt="Oct 15, 1 pm: orbit view with the sun ray"><br><sub>Oct 15, 1 pm: orbit view with the sun ray</sub></td><td width="50%"><img src="gallery/eg1211art--eg1211-stage-window-floor12.jpg" alt="From the 12th-floor window"><br><sub>From the 12th-floor window</sub></td></tr>
<tr><td width="50%"><img src="gallery/eg1211art--eg1211-stage-window-floor21.jpg" alt="From the 21st floor, same line"><br><sub>From the 21st floor, same line</sub></td><td width="50%"><img src="gallery/eg1211art--eg1211-stage-dec21.jpg" alt="December 21 at noon"><br><sub>December 21 at noon</sub></td></tr>
<tr><td width="50%"><img src="gallery/eg1211art--eg1211-sunpath-chart.jpg" alt="Sun paths against the skyline"><br><sub>Sun paths against the skyline</sub></td><td width="50%"><img src="gallery/eg1211art--eg1211-floor-month-table.jpg" alt="Direct sun hours by floor and month"><br><sub>Direct sun hours by floor and month</sub></td></tr>
<tr><td width="50%"><img src="gallery/eg1211art--eg1211-full-page.jpg" alt="The whole model page"><br><sub>The whole model page</sub></td><td width="50%"><img src="gallery/eg1211art--eg1211-dark.jpg" alt="Dark mode"><br><sub>Dark mode</sub></td></tr>
<tr><td width="50%"><img src="gallery/eg1211art--eg1211-jun21-evening.jpg" alt="June 21 evening"><br><sub>June 21 evening</sub></td><td></td></tr>
</table>

### Emerald Green #1211 view and sunlight (Codex)

Codex's reconstruction: official footprints, street centerlines, two candidate window edges, apartment 3D, window views, GLB exports.

<table>
<tr><td width="50%"><img src="gallery/codexeg--codex-eg1211-neighborhood.jpg" alt="Neighbourhood context with height prisms"><br><sub>Neighbourhood context with height prisms</sub></td><td width="50%"><img src="gallery/codexeg--codex-eg1211-street-plan.jpg" alt="Street and footprint plan"><br><sub>Street and footprint plan</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexeg--codex-eg1211-apartment-3d.jpg" alt="Apartment 3D"><br><sub>Apartment 3D</sub></td><td width="50%"><img src="gallery/codexeg--codex-eg1211-topdown-unit.jpg" alt="Top-down unit"><br><sub>Top-down unit</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexeg--codex-eg1211-living-window.jpg" alt="Living-room window view"><br><sub>Living-room window view</sub></td><td width="50%"><img src="gallery/codexeg--codex-eg1211-bedroom-window.jpg" alt="Bedroom window view"><br><sub>Bedroom window view</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexeg--codex-eg1211-winter-floor21.jpg" alt="Winter, floor 21"><br><sub>Winter, floor 21</sub></td><td width="50%"><img src="gallery/codexeg--codex-eg1211-east-candidate.jpg" alt="Rejected eastern candidate"><br><sub>Rejected eastern candidate</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexeg--view_west_floor12.jpg" alt="Rendered view west, floor 12"><br><sub>Rendered view west, floor 12</sub></td><td width="50%"><img src="gallery/codexeg--view_west_floor21.jpg" alt="Rendered view west, floor 21"><br><sub>Rendered view west, floor 21</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexeg--apartment_preview.jpg" alt="Apartment preview render"><br><sub>Apartment preview render</sub></td><td width="50%"><img src="gallery/codexeg--corrected_street_context.jpg" alt="Corrected street context"><br><sub>Corrected street context</sub></td></tr>
<tr><td width="50%"><img src="gallery/codexeg--surrounding_heights.jpg" alt="Surrounding building heights, 300 m"><br><sub>Surrounding building heights, 300 m</sub></td></tr>
</table>

### Knox: what the windows can see

An evidence-labelled view and light model for six Knox one-bedrooms, with obstruction scenarios.

<table>
<tr><td width="50%"><img src="gallery/knox--knox-light-view-13c.jpg" alt="#13C"><br><sub>#13C</sub></td><td width="50%"><img src="gallery/knox--knox-light-view-31ab.jpg" alt="#31AB"><br><sub>#31AB</sub></td></tr>
<tr><td width="50%"><img src="gallery/knox--knox-light-view-4c.jpg" alt="#4C"><br><sub>#4C</sub></td><td width="50%"><img src="gallery/knox--knox_2026_true_roof_context_mobile.jpg" alt="True roof context"><br><sub>True roof context</sub></td></tr>
<tr><td width="50%"><img src="gallery/knox--knox_2026_survey_3d_mobile.jpg" alt="3D survey"><br><sub>3D survey</sub></td><td width="50%"><img src="gallery/knox--knox_3d_floor_view_mobile.jpg" alt="3D floor view"><br><sub>3D floor view</sub></td></tr>
<tr><td width="50%"><img src="gallery/knox--knox_compass_units_mobile.jpg" alt="Compass and unit lines"><br><sub>Compass and unit lines</sub></td><td></td></tr>
</table>

### Apartment layout studio (Emerald Green #1211)

2D plan and 3D model side by side, drag furniture in either, layout presets, clearances, door swings and bed-to-TV sightlines. 

<table>
<tr><td width="50%"><img src="gallery/layout--layout-split.jpg" alt="Plan and 3D together"><br><sub>Plan and 3D together</sub></td><td width="50%"><img src="gallery/layout--layout-3d-overview.jpg" alt="3D overview"><br><sub>3D overview</sub></td></tr>
<tr><td width="50%"><img src="gallery/layout--layout-3d-topdown.jpg" alt="Top down"><br><sub>Top down</sub></td><td width="50%"><img src="gallery/layout--layout-from-bed.jpg" alt="View from the bed"><br><sub>View from the bed</sub></td></tr>
<tr><td width="50%"><img src="gallery/layout--layout-from-front-door.jpg" alt="View from the front door"><br><sub>View from the front door</sub></td><td width="50%"><img src="gallery/layout--layout-plan-2d.jpg" alt="2D plan with clearances"><br><sub>2D plan with clearances</sub></td></tr>
<tr><td width="50%"><img src="gallery/layout--layout-bed-in-living-room.jpg" alt="Preset: bed in the living room"><br><sub>Preset: bed in the living room</sub></td><td width="50%"><img src="gallery/layout--layout-dark.jpg" alt="Dark mode, floating-bed preset"><br><sub>Dark mode, floating-bed preset</sub></td></tr>
<tr><td width="50%"><img src="gallery/layout--layout_preview.jpg" alt="Bedroom TV layout options"><br><sub>Bedroom TV layout options</sub></td><td width="50%"><img src="gallery/layout--queen_primary_options.jpg" alt="Queen bed options"><br><sub>Queen bed options</sub></td></tr>
</table>

### Floor-plan fit check: three apartments

Three real plans in 3D (Emerald Green 620, Paramount, 49th St) with a furniture kit, AC units and space checks. 

<table>
<tr><td width="50%"><img src="gallery/fitcheck--fitcheck-eg620-angle.jpg" alt="Emerald Green 620, angle"><br><sub>Emerald Green 620, angle</sub></td><td width="50%"><img src="gallery/fitcheck--fitcheck-eg620-top.jpg" alt="Emerald Green 620, top"><br><sub>Emerald Green 620, top</sub></td></tr>
<tr><td width="50%"><img src="gallery/fitcheck--fitcheck-eg620-bedroom.jpg" alt="Emerald Green 620, bedroom"><br><sub>Emerald Green 620, bedroom</sub></td><td width="50%"><img src="gallery/fitcheck--fitcheck-paramount-angle.jpg" alt="Paramount, angle"><br><sub>Paramount, angle</sub></td></tr>
<tr><td width="50%"><img src="gallery/fitcheck--fitcheck-paramount-living.jpg" alt="Paramount, living room"><br><sub>Paramount, living room</sub></td><td width="50%"><img src="gallery/fitcheck--fitcheck-49th-angle.jpg" alt="49th St, angle"><br><sub>49th St, angle</sub></td></tr>
<tr><td width="50%"><img src="gallery/fitcheck--fitcheck-49th-top.jpg" alt="49th St, top"><br><sub>49th St, top</sub></td></tr>
</table>

### Room to live (Codex floor-plan 3D)

Two supplied plans with one furniture kit, drag in 3D or overhead, export GLB. 

<table>
<tr><td width="50%"><img src="gallery/roomtolive--codex-floorplan3d-plan1.jpg" alt="Plan 1 in 3D"><br><sub>Plan 1 in 3D</sub></td><td width="50%"><img src="gallery/roomtolive--codex-floorplan3d-plan1-overhead.jpg" alt="Plan 1 overhead"><br><sub>Plan 1 overhead</sub></td></tr>
<tr><td width="50%"><img src="gallery/roomtolive--codex-floorplan3d-plan2.jpg" alt="Plan 2 in 3D"><br><sub>Plan 2 in 3D</sub></td><td width="50%"><img src="gallery/roomtolive--codex-floorplan3d-plan2-fullwalls.jpg" alt="Plan 2 with full walls"><br><sub>Plan 2 with full walls</sub></td></tr>
<tr><td width="50%"><img src="gallery/roomtolive--codex-floorplan3d-futon-bedroom.jpg" alt="Futon in the bedroom preset"><br><sub>Futon in the bedroom preset</sub></td><td width="50%"><img src="gallery/roomtolive--plan-1-preview.jpg" alt="Plan 1 render"><br><sub>Plan 1 render</sub></td></tr>
<tr><td width="50%"><img src="gallery/roomtolive--plan-2-preview.jpg" alt="Plan 2 render"><br><sub>Plan 2 render</sub></td></tr>
</table>

### The Greywood 4B

3D floor plan render. 

<table>
<tr><td width="50%"><img src="gallery/greywood--floor_plan_3d.jpg" alt="3D floor plan"><br><sub>3D floor plan</sub></td></tr>
</table>

### Due-diligence reports

The reports that became the Records view.

<table>
<tr><td width="50%"><img src="gallery/henry--henry-hall-due-diligence.jpg" alt="Henry Hall 23J due diligence"><br><sub>Henry Hall 23J: due diligence</sub></td><td width="50%"><img src="gallery/henry--henry-hall-unit-neighborhood.jpg" alt="Henry Hall 23J unit and neighbourhood"><br><sub>Henry Hall 23J: unit and neighbourhood</sub></td></tr>
<tr><td width="50%"><img src="gallery/henry--henry-hall-311.jpg" alt="Henry Hall 23J 311 and enforcement"><br><sub>Henry Hall 23J: 311 and enforcement</sub></td><td width="50%"><img src="gallery/paramount--paramount-comparison.jpg" alt="Paramount and alternatives"><br><sub>Paramount and alternatives: a ranked exact-unit comparison</sub></td></tr>
<tr><td width="50%"><img src="gallery/poker--poker-amenities.jpg" alt="Poker tables hiding behind amenity names"><br><sub>Poker rooms: tables hiding behind amenity names, and an eight-player shortlist</sub></td><td></td></tr>
</table>
