# Gallery

ApartmentScout on its worked example, in the order a search goes: [Find](#find), [Compare](#compare), [See inside](#see-inside),
[Decide](#decide) and [Set up](#set-up), then the [phone layout](#on-a-phone). The example is a Manhattan one-bedroom search from
fall 2026 with a commute to a Midtown office near Grand Central. Everything is shot from the committed dashboard with
`scripts/screenshots.py`: desktop at 1600 x 1000, the Unit 3D stage at 1560 x 954, phone at 390 x 844, in the dark theme and a
few in the light one.

The listings, prices, commutes, records and 3D models in these pictures are the example search's own. The saved picks, the visit
notes, the decision history and the day of tours are sample entries written for the screenshots (the script lists them). The
furniture in the Inside views is the renter's own, from the example's plan file. Listing photos were cleared
for use in this private repository; re-check their rights before making it public. Every image is marked `public` in
[`gallery/manifest.json`](gallery/manifest.json); see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for map and photo
attribution. Earlier screenshots of the previous interface are kept, unused, in
[`archive/images-2026-10-15`](archive/images-2026-10-15/README.md) until the owner decides whether to delete them.

## Find

The map ranks every listing on your weights, colours the city by door-to-door time, and opens a home with its money, photos and
reasons. Search takes plain words.

<table>
<tr>
<td width="50%" valign="top"><img src="images/hero-map.png" alt="The commute map with a listing drawer open"><br><b>A listing over the commute map</b><br><sub>Paramount Tower 25E in the drawer: a credited photo, a first-lease monthly cost of $5,032 against $4,995 gross, what is paid every month and at signing (the deposit is unknown), and $60,384 over a 12-month lease that is marked as assumed. The ranked cards sit on the left.</sub></td>
<td width="50%" valign="top"><img src="images/find-commute-map.png" alt="Door-to-door commute bands over Manhattan"><br><b>Door to door, by the best of transit</b><br><sub>Minutes to Grand Central arriving at 9:00, from greens within 15 minutes through yellow and gold to the 30-minute limit and reds beyond it, with scored price tags and the subway lines. The filter rail holds budget tiers, must-haves and the commute mode.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/find-map-clusters.png" alt="The map zoomed out: homes merged into bubbles that count them and show the lowest monthly cost"><br><b>A calmer map</b><br><sub>Zoomed out, nearby homes merge into a bubble that counts them and shows the lowest monthly cost inside ("from $3,075"); click one to zoom in and watch it split. Your starred picks and the ten best-ranked homes keep a pin of their own at any zoom.</sub></td>
<td valign="top"><img src="images/find-building-pin.png" alt="Hovering a building pin: View 34, 17 units from $4,310, with its best three units"><br><b>A building is one pin</b><br><sub>View 34 is one pin with its 17 units. Hovering it lists the best three with their size, price and score; clicking opens the whole list, and a row opens that home's drawer.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/find-pin-preview.png" alt="Hovering a pin previews the home with its photo, rank, price and score"><br><b>Hover a pin, see the home</b><br><sub>A card with the photo, rank, price, score and commute for Paramount Tower 25E appears without opening the drawer. On a phone the first tap shows the card and the second opens the drawer.</sub></td>
<td valign="top"><img src="images/find-route-preview.png" alt="Hovering a home draws its subway route"><br><b>Hover a card, see the trip</b><br><sub>Subway lens: hovering Orion Condominium 23A draws its trip to Grand Central on the map, a 9-minute walk (dashed), the S shuttle on its own line, a short walk at the end and a 15-minute pill.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/find-place-search.png" alt="The command menu previewing a plain-words search"><br><b>Ask in plain words</b><br><sub>The command menu with "east of 3rd ave under 5k with w/d" typed: the first row says what it understood (up to $5,000, W/D, east of 3rd Avenue) and counts 15 of 434 active homes before anything changes.</sub></td>
<td valign="top"><img src="images/find-price-drops.png" alt="Homes whose price fell, with their price history"><br><b>Real price history</b><br><sub>"Price drops under 5.5k" keeps the 28 homes whose latest recorded price move was down. Each card shows the size of the drop, for example $294 on One Manhattan Square 57G and $500 on Gramercy Starck 10L.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/find-rank-moves.png" alt="A drawer explaining why The Knox 6B fell 40 places since Oct 13"><br><b>Why a home moved</b><br><sub>The Knox 6B fell from #6 to #46 since Oct 13 (the card says "↓40 since Oct 13"). The drawer's <i>Why it moved</i> lists each dimension with the points it moved, biggest first: size now estimated, the weights you changed, the unit's own photos, two prices that disagree.</sub></td>
<td valign="top"><img src="images/find-unknowns.png" alt="Unknowns that move this score: an 800 square-foot size typed in shows the score and rank the home would get"><br><b>Unknowns that move this score</b><br><sub>For a home the scorer had to estimate, each unknown shows the range it spans and the ranks it could land in. Typing 800 ft² shows "score 73.1, rank #6 (now #46)" before you save; the number is kept as yours and the listing's own facts are untouched.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/find-price-audit.png" alt="A listing's money section marked price unverified"><br><b>The price audit</b><br><sub>Orion Condominium 43E carries "price unverified": the $5,250 came from an agent report and the unit page could not be read. The drawer says so, ranks on that price with a range, leaves the monthly fees unknown (the ranking assumes about $80) and lists what would bring it into each budget tier.</sub></td>
<td valign="top"><img src="images/find-lightbox.png" alt="The photo lightbox beside the listing's floor plan"><br><b>Photos and the floor plan</b><br><sub>The lightbox on Orion Condominium 23A: tabs for All 41, Unit 12, Building 28 and Floor plans 1, a thumbnail strip, the credit under the photo and the listing's own floor plan beside it (Plan, Side by side).</sub></td>
</tr>
<tr>
<td colspan="2" valign="top"><img src="images/find-light-theme.png" alt="The map in the light theme with a listing open"><br><b>The light theme</b><br><sub>The same map and drawer in the light theme (the menu's Theme row, or <kbd>t</kbd>). Dark is the default, and a system setting is one click away.</sub></td>
</tr>
</table>

## Compare

Put finalists side by side, in a table or in 3D, trade the weights against each other and watch the ranking move.

<table>
<tr>
<td colspan="2" valign="top"><img src="images/compare-four.png" alt="Four finalists compared in lettered columns"><br><b>Four finalists, row by row</b><br><sub>Paramount Tower 25E, Emerald Green 24D, 7 Platt 14G and One Manhattan Square 57G in columns A to D, with money, space and commute rows below. The best value in each row is marked, and a fact nobody has confirmed (free months, fees, size) reads "Unknown" and never counts as the worst.</sub></td>
</tr>
<tr>
<td colspan="2" valign="top"><img src="images/compare-side-by-side-3d.png" alt="Two homes in the same tower side by side in 3D"><br><b>Two units side by side in 3D</b><br><sub>Compare in 3D opens two homes in one view with the same date, time and camera (Inside or Window) and one time slider. Each pane has its own direct-sun readout: Paramount Tower 25E, floor 25, gets 6 hours on this date and 41A, floor 41, none.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="images/compare-tradeoff-pad.png" alt="The trade-off pad previewing a weight preset"><br><b>The trade-off pad</b><br><sub>One dot trades Cost, Commute and Space against each other. Pointing at the Biggest and nicest ring previews the top ten if it were applied: ten of ten places change and six homes fall out. Clicking applies it through the same weights as the sliders.</sub></td>
<td width="50%" valign="top"><img src="images/compare-split-view.png" alt="The shortlist table beside a docked map"><br><b>The shortlist beside its map</b><br><sub>Shortlist split view: 55 homes in the Target tier with a gym, next to a map of exactly those homes. Hovering Emerald Green 24D previews its 17-minute subway trip.</sub></td>
</tr>
</table>

## See inside

The 3D tab holds Unit 3D (the building in its real city, with sun and shadows) and the Floor plan studio. Both draw the same room
and the same city, and a piece you place in one stays there in the other. The Paramount Tower 25E views use the renter's own
furniture (a black leather futon, a 71 in brown desk with a 32 in monitor and a rolling task chair, a black IKEA MALM chest, a grey
upholstered queen bed, two wall-mounted 55 in TVs), finishes read from the unit's photos (a basket-weave parquet floor) and a
facade bearing measured from their photos.

<table>
<tr>
<td colspan="2" valign="top"><img src="images/inside-unit-3d.png" alt="Unit 3D opening inside the apartment: the desk, monitor and chair by the bay window, the futon in the corner"><br><b>Unit 3D lands inside the apartment</b><br><sub>The 3D tab opens in the living room at the 25th-floor slab height with a wide stage: the desk, its monitor and chair by the bay window, the futon, and the real city outside. The view picker ("Sofa, window") and "Go to the window" are at the top, the day and year play bar and the sun hours by month below.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="images/inside-furniture.png" alt="Looking down the living room: a black leather futon, a wall-mounted TV, a coffee table and a dining table on a basket-weave parquet floor"><br><b>Your own furniture</b><br><sub>"Into the room": the black leather futon facing the wall-mounted 55 in TV, the coffee table and the dining table by the kitchen, on the basket-weave parquet the unit's photos show. Sizes are the renter's; colours and materials say whether they are known or stand-ins.</sub></td>
<td width="50%" valign="top"><img src="images/inside-walk-window.png" alt="Standing at the living-room window on the 25th floor, looking out over neighbouring towers, a park and the river"><br><b>Walk to the window</b><br><sub>Click the floor to walk there (a ring shows where a click goes), drag to look, or press <i>Go to the window</i>, which walks you about 22 in back from the glass, facing out. You cannot pass walls, furniture or glass. Behind the glass: neighbouring towers, a park, the East River, a natural sky.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-bedroom.png" alt="In the bedroom: the corner window with the sun on the floor, a black chest with a TV on the wall"><br><b>The bedroom</b><br><sub>The bedroom's corner window at 11:30 am, the sun patch on the parquet, and the black MALM chest under its wall-mounted TV at the left.</sub></td>
<td valign="top"><img src="images/inside-bay.png" alt="Inside the bedroom corner, looking out of the angled windows"><br><b>Through the angled windows</b><br><sub>The Corner view at 11:30 am: the angled glass at the real height with the neighbouring towers, a park's canopy and the river. Chips switch between rooms, bays, corners and the seats (sofa, bed, desk, each also looking out of the window).</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-night-window.png" alt="Standing at the window at night: lit windows in the towers, street lamps along the river road"><br><b>The night city</b><br><sub>8:30 pm at the same window: 3,400 buildings around the unit with lit facades, the street lamps along the road and the park in the dark, and the night sky.</sub></td>
<td valign="top"><img src="images/inside-play-year.png" alt="The Inside view with the Play day and Play year bar at December 28, with bare branches"><br><b>Play the day, play the year</b><br><sub>The play bar moves the sun across the day or through the months at one time of day. Here it has reached December 28: the trees are bare, the window is in shadow, and the strip says so. Trees change with the season and never count as shade in the sun numbers.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-measure-tape.png" alt="The measuring tape reading 5 feet 2 inches across the bay window"><br><b>The measuring tape</b><br><sub>The tape tool in the right-hand column: click two points and it snaps to wall corners, window edges and furniture edges. It reads 5' 2" across the bay. The same tape works in the studio's 2D plan and 3D room, and the readings are kept with the plan.</sub></td>
<td valign="top"><img src="images/inside-fits.png" alt="Does it fit? A bookshelf dropped into the living room with the space around it on each side"><br><b>Does it fit?</b><br><sub>In the studio, type "Bookshelf 36 x 12 x 72 in" (or pick a catalogue piece or a product) and drop it in a room: it is drawn at its real size and judged, with the space on each of its four sides, and can be added to your furniture list.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-match-photo.png" alt="Match a photo: a listing photo laid over the 3D view while a landmark is marked"><br><b>Match a photo</b><br><sub>From the Window view, <i>Match a photo</i> lays one of the listing's photos over the 3D view at an opacity you set. Mark two or three landmarks (a tower top, a roof corner) and it fits the camera, then reports how well the model's window, bearing and floor agree with the photographer's.</sub></td>
<td valign="top"><img src="images/inside-floor-plan.png" alt="The floor plan studio with the 2D plan and the 3D room"><br><b>The floor plan studio</b><br><sub>The Paramount Tower 25E plan in 2D and 3D with "Using your furniture", 10 of 10 pieces placed, and the Does it fit? panel in the right-hand column. Sun patches, fit checks, the tape and eye-level cameras are in the same studio.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-measured-chip.png" alt="The measured vs assumed chip opened"><br><b>Measured, sourced or assumed</b><br><sub>The chip open: building heights from a source (3,427 buildings), the facade bearing of 119 degrees measured against landmarks in the renter's photos, the position along the facade assumed, the floor height estimated, the floor plan and the finishes from sources, and the furniture confirmed by the renter.</sub></td>
<td valign="top"><img src="images/inside-orbit-day.png" alt="Unit 3D by day: the tower among its neighbours with the window marked"><br><b>Unit 3D by day</b><br><sub>Outside, by day: the window on floor 25 facing ESE (a bay), the sun ray to it, a tower under construction drawn dashed and street trees.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-orbit-night.png" alt="Unit 3D at night with lit windows"><br><b>The same view at night</b><br><sub>8:30 pm: facades are shader-drawn with lit windows, the sun is below the horizon and the HUD says Night.</sub></td>
<td valign="top"><img src="images/inside-skyline-dusk.png" alt="The Midtown skyline at dusk from Unit 3D"><br><b>The skyline, drawn from its parts</b><br><sub>6:30 pm, looking west from above and east of the tower: the Empire State Building and the Chrysler Building are built from their set-back parts and spires, with 30 Hudson Yards, Bank of America Tower and One Vanderbilt labelled.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-sun-by-floor.png" alt="Direct sun hours by floor and month" width="300"><br><b>Sun by floor and month</b><br><sub>Emerald Green 1211's facade: hours of direct sun on the 15th of each month for every floor, from 0 to 9 hours, with floor 12 outlined as the chosen floor. A click jumps the 3D view to that floor and month.</sub></td>
<td valign="top"><img src="images/inside-park-trees.png" alt="A park drawn as grass and trees in Unit 3D"><br><b>Parks and trees</b><br><sub>Atlas 38D, floor 38, at 2 pm in October: a park drawn as a lawn with its trees from the NYC Parks inventory in autumn colour, and street trees along the avenues. They are context and are never counted as shade in the sun hours.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/inside-river.png" alt="The Hudson River and piers in Unit 3D at sunset"><br><b>Water and permitted towers</b><br><sub>Henry Hall 23J on June 21 at 7 pm: the Hudson River and the piers from surveyed hydrography, and proposed and permitted towers drawn dashed where they will stand. The sun is behind the facade.</sub></td>
<td valign="top"><img src="images/inside-light-theme.png" alt="Unit 3D in the light theme"><br><b>Unit 3D in the light theme</b><br><sub>The Maybury, floor 22, at 6 pm on June 21: direct sun on the window from the west (280 degrees), with the Hudson River beyond, in the light theme.</sub></td>
</tr>
</table>

## Decide

Visit, plan the tours, ask the leasing office, then share a page or a memo.

<table>
<tr>
<td width="50%" valign="top"><img src="images/decide-office-questions.png" alt="Questions for the leasing office of The Knox"><br><b>Questions for the leasing office</b><br><sub>The side sheet for The Knox: its units with their open questions, a checkbox per question (14 checked), "Why this is asked" for the evidence, then the subject and message below. Copy email, or Open in my email app: a <code>mailto:</code> link with no recipient. Nothing is sent from the page.</sub></td>
<td width="50%" valign="top"><img src="images/decide-visit-history.png" alt="Visit notes in the listing drawer"><br><b>Visit notes and decision history</b><br><sub>Sample notes from a visit to Paramount Tower 25E: rooms measured (293 ft²), ceiling, water pressure, noise at the window with a dB reading, signal, laundry, light with the time, the view, and whether the doorman, size and windows match the listing. The dated history of every star, tier and status change sits below.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/decide-tour-planner.png" alt="The tour-day planner"><br><b>The tour-day planner</b><br><sub>Five stops from 10:00 am to 3:10 pm: when to leave by for each hop, walking or an estimated transit trip, a viewing time and a buffer, and a warning where a booked time is later than the plan. Add to calendar and Copy plan are at the top right.</sub></td>
<td valign="top"><img src="images/decide-memo.png" alt="The decision memo"><br><b>The decision memo</b><br><sub>A ranked table of the five saved homes with money, size, commute, score, tier and open items, then the weights that mattered and a page per home. Print it or save it as a PDF; your notes stay out unless you tick them.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/decide-share-page.png" alt="The read-only shortlist page"><br><b>A page to send</b><br><sub>The read-only Share shortlist page: five homes, a median of $5,032 a month, a schematic map with the subway lines and a ranked list, then a card per home with its photos, price and reasons.</sub></td>
<td valign="top"><img src="images/decide-records.png" alt="A building's public records report"><br><b>Building records</b><br><sub>The due-diligence report for Emerald Green #1211: a records score of 90 and a street-noise score of 51, four areas to check (heat and hot water complaints, heavy construction nearby, 311 noise, bedbug filings) and a "What matters" table that labels every item a report, not a finding.</sub></td>
</tr>
<tr>
<td colspan="2" valign="top"><img src="images/decide-research-queue.png" alt="The research queue"><br><b>What you still don't know</b><br><sub>The Research tab: the finalist standard (none of the 434 open homes has every fact yet), counts of missing size, fees and media, and a queue ranked by the points each unknown could swing, with questions ready to copy for the leasing office.</sub></td>
</tr>
</table>

## Set up

<table>
<tr>
<td width="50%" valign="top"><img src="images/setup-wizard-city.png" alt="The new search wizard, step 1"><br><b>The new search wizard</b><br><sub>Step 1 of 8 (<code>?new=1</code>, or New search in the menu): a search name and the city, here Another city with Chicago typed in. Each step's answer is summarised on the left and a draft is kept in the browser. Served locally it also looks the city up.</sub></td>
<td width="50%" valign="top"><img src="images/setup-wizard-review.png" alt="The wizard's review step"><br><b>Review the criteria.yaml</b><br><sub>The last step shows the generated <code>criteria.yaml</code>, a diff against the open search and, because this page cannot write files, Copy YAML, Apply as preview and Download criteria.yaml.</sub></td>
</tr>
<tr>
<td valign="top"><img src="images/setup-menu.png" alt="The one menu at the top right"><br><b>One menu</b><br><sub>The top-right menu: this search (edit criteria, settings, new search), data (CSV, back up and restore picks, share, decision memo), appearance (theme, accent, density, office pin, golden-hour tint), comfort (motion, transparency, contrast, text size) and help.</sub></td>
<td valign="top"><img src="images/setup-cli.png" alt="Command-line output"><br><b>The command line</b><br><sub>Real output on the example: <code>apartmentscout city</code> says what the city has (geocoding, OpenStreetMap buildings, streets and parks, floor plans, NYC open data, three GTFS feeds), and <code>score --top 10</code> prints the ranking.</sub></td>
</tr>
</table>

## On a phone

<table>
<tr>
<td width="20%" valign="top" align="center"><img src="images/phone-map.png" alt="The map and ranked cards on a phone" width="180"><br><b>Map and cards</b><br><sub>The commute map on top, ranked cards in a sheet below, and a bottom tab bar.</sub></td>
<td width="20%" valign="top" align="center"><img src="images/phone-unit-3d.png" alt="Unit 3D on a phone" width="180"><br><b>Unit 3D</b><br><sub>Inside, from "Sofa, window", with the camera modes, the layer tools and the play bar. The 3D scene is tuned to stay smooth on a phone.</sub></td>
<td width="20%" valign="top" align="center"><img src="images/phone-visit-notes.png" alt="Visit notes on a phone" width="180"><br><b>Visit notes</b><br><sub>Sample notes opened with <code>?visit=&lt;listing-id&gt;</code> for one hand at the home: big steppers, rooms with their areas, and the camera in the bar below.</sub></td>
<td width="20%" valign="top" align="center"><img src="images/phone-tour-day.png" alt="Tour day on a phone: three homes in time order" width="180"><br><b>Tour day</b><br><sub>Today's tours in time order (or shortest walk), each with Directions, the checklist progress and the minutes to the next stop; sample tours booked for the day of the shot.</sub></td>
<td width="20%" valign="top" align="center"><img src="images/phone-tour-checklist.png" alt="The Tour day checklist for one home" width="180"><br><b>The checklist</b><br><sub>One question at a time at the home: light at the window (1 to 5) with the time saved, which way it faces, noise with the windows shut, each with why it matters to your weights. Answers flow into the visit notes and the score.</sub></td>
</tr>
</table>

<details>
<summary><b>Earlier tools from the search</b>: the one-off prototypes the dashboard grew out of (click to open)</summary>

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

### Floor-plan fit check: two apartments

Two real plans in 3D (Emerald Green 620 and 49th St) with a furniture kit, AC units and space checks. 

<table>
<tr><td width="50%"><img src="gallery/fitcheck--fitcheck-eg620-angle.jpg" alt="Emerald Green 620, angle"><br><sub>Emerald Green 620, angle</sub></td><td width="50%"><img src="gallery/fitcheck--fitcheck-eg620-top.jpg" alt="Emerald Green 620, top"><br><sub>Emerald Green 620, top</sub></td></tr>
<tr><td width="50%"><img src="gallery/fitcheck--fitcheck-eg620-bedroom.jpg" alt="Emerald Green 620, bedroom"><br><sub>Emerald Green 620, bedroom</sub></td><td width="50%"><img src="gallery/fitcheck--fitcheck-49th-angle.jpg" alt="49th St, angle"><br><sub>49th St, angle</sub></td></tr>
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

</details>
