# Gallery

ApartmentScout on its worked example: [Find](#find), [See inside](#see-inside), [Sun and light](#sun-and-light), [The city in 3D](#the-city-in-3d), [Floor-plan studio](#floor-plan-studio), [Compare](#compare), [Decide](#decide), [Set up](#set-up), then the [phone layout](#on-a-phone). The example is a Manhattan one-bedroom search from
fall 2026 with a commute to a Midtown office near Grand Central. Everything is shot from the committed dashboard with
`scripts/screenshots.py`: desktop at 1600 x 1000, the Unit 3D stage at 1560 x 954, phone at 390 x 844, in the dark theme and a
few in the light one.

The listings, prices, commutes, records and 3D models in these pictures are the example search's own. The saved picks, the visit
notes, the decision history and the day of tours are sample entries written for the screenshots (the script lists them). The
furniture in the Inside views is the renter's own, from the example's plan file. Listing photos belong to their owners and are
shown here as part of the worked example; Commons photos carry their licence and author. Every image is marked `public` in
[`gallery/manifest.json`](gallery/manifest.json); see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for map and photo
attribution. A short animated walk-through of the whole path is at the top of the [README](../README.md).

## Find

The map ranks every listing on your weights, colours the city by door-to-door time, and opens a home with its money, photos and reasons. Search takes plain words.

<table>
<tr>
<td colspan="2" valign="top"><a href="images/hero-map.png"><img src="images/hero-map.png" alt="The map with ranked cards on the left and Paramount Tower 25E open in the drawer"></a><br><b>The map, the ranked list and a home</b><br><sub>Paramount Tower 25E in the drawer: a credited photo, a first-lease monthly cost of $5,032 against $4,995 gross, what is paid every month and at signing (the deposit is unknown), and $60,384 over a 12-month lease that is marked as assumed. The ranked cards sit on the left, the filter rail beside them.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/find-place-search.png"><img src="images/find-place-search.png" alt="The command menu previewing a plain-words search"></a><br><b>Ask in plain words</b><br><sub>The command menu with "east of 3rd ave under 5k with w/d" typed: the first row says what it understood (up to $5,000, W/D, east of 3rd Avenue) and counts 15 of 434 active homes before anything changes.</sub></td>
<td width="50%" valign="top"><a href="images/find-building-pin.png"><img src="images/find-building-pin.png" alt="Hovering a building pin: View 34, 17 units from $4,310, with its best three units"></a><br><b>A building is one pin</b><br><sub>View 34 is one pin with its 17 units. Hovering it lists the best three with their size, price and score; clicking opens the whole list, and a row opens that home's drawer.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/find-pin-preview.png"><img src="images/find-pin-preview.png" alt="Hovering a pin previews the home with its photo, rank, price and score"></a><br><b>Hover a pin, see the home</b><br><sub>A card with the photo, rank, price, score and commute for Paramount Tower 25E appears without opening the drawer. On a phone the first tap shows the card and the second opens the drawer.</sub></td>
<td width="50%" valign="top"><a href="images/find-route-preview.png"><img src="images/find-route-preview.png" alt="Hovering a home draws its subway route to Grand Central"></a><br><b>Hover a card, see the trip</b><br><sub>Subway lens: hovering Orion Condominium 23A draws its trip to Grand Central on the map, a 9-minute walk (dashed), the S shuttle on its own line, a short walk at the end and a 15-minute pill.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/find-rank-moves.png"><img src="images/find-rank-moves.png" alt="A drawer explaining why The Knox 6B fell 40 places since Oct 13"></a><br><b>Why a home moved</b><br><sub>The Knox 6B fell from #6 to #46 since Oct 13 (the card says "↓40 since Oct 13"). The drawer's <i>Why it moved</i> lists each dimension with the points it moved, biggest first: size now estimated, the weights you changed, the unit's own photos, two prices that disagree.</sub></td>
<td width="50%" valign="top"><a href="images/find-unknowns.png"><img src="images/find-unknowns.png" alt="Unknowns that move this score: an 800 square-foot size typed in shows the score and rank the home would get"></a><br><b>Unknowns that move this score</b><br><sub>For a home the scorer had to estimate, each unknown shows the range it spans and the ranks it could land in. Typing 800 ft² shows "score 73.1, rank #6 (now #46)" before you save; the number is kept as yours and the listing's own facts are untouched.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/find-price-audit.png"><img src="images/find-price-audit.png" alt="A listing's money section: monthly cost, every month and at signing, marked price unverified"></a><br><b>What it costs, and is the price real?</b><br><sub>The drawer's Money section on Orion Condominium 43E: monthly cost, what is paid every month and at signing, and the total over the lease. It carries "price unverified": the $5,250 came from an agent report and the unit page could not be read, so the drawer ranks on that price with a range, leaves the monthly fees unknown (the ranking assumes about $80) and lists what would bring it into each budget tier.</sub></td>
<td width="50%" valign="top"><a href="images/find-price-drops.png"><img src="images/find-price-drops.png" alt="Homes whose price fell, with the size of each drop"></a><br><b>Real price history</b><br><sub>"Price drops under 5.5k" keeps the 28 homes whose latest recorded price move was down. Each card shows the size of the drop, for example $294 on One Manhattan Square 57G and $500 on Gramercy Starck 10L.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/find-drawer-commute.png"><img src="images/find-drawer-commute.png" alt="The drawer's commute section: 10 minutes by every mode, by time of day, then direct sun by month and noise by hour"></a><br><b>Commute, sun and noise for one home</b><br><sub>Paramount Tower 25E's drawer at Commute: 10 minutes to Grand Central by the best route, subway, bus and on foot, the same trip at 9:00, 13:00, 18:00, 22:00 and Saturday 11:00, then direct sun on the window month by month (about 1,344 hours a year expected with typical cloud) and 311 noise by hour.</sub></td>
<td width="50%" valign="top"><a href="images/find-lightbox.png"><img src="images/find-lightbox.png" alt="The photo lightbox beside the listing's floor plan"></a><br><b>Photos and the floor plan</b><br><sub>The lightbox on Orion Condominium 23A: tabs for All 41, Unit 12, Building 28 and Floor plans 1, a thumbnail strip, the credit under the photo and the listing's own floor plan beside it (Plan, Side by side).</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/find-map-clusters.png"><img src="images/find-map-clusters.png" alt="The map zoomed out: homes merged into bubbles that count them and show the lowest monthly cost"></a><br><b>A calmer map</b><br><sub>Zoomed out, nearby homes merge into a bubble that counts them and shows the lowest monthly cost inside ("from $3,075"); click one to zoom in and watch it split. Your starred picks and the ten best-ranked homes keep a pin of their own at any zoom.</sub></td>
<td width="50%" valign="top"><a href="images/find-light-theme.png"><img src="images/find-light-theme.png" alt="The map in the light theme with a listing open"></a><br><b>The light theme</b><br><sub>The same map and drawer in the light theme (the menu's Theme row, or <kbd>t</kbd>). Dark is the default, and a system setting is one click away.</sub></td>
</tr>
<tr>
<td colspan="2" valign="top"><img src="images/find-walk-map.png" alt="The commute map on foot with 10, 20 and 30-minute rings around Grand Central"><br><b>On foot</b><br><sub>The Walk mode of the commute panel: walking takes the same time at any hour, so the map draws dashed rings at 10, 20 and 30 minutes around Grand Central, and cards, filters and columns use walking minutes.</sub></td>
</tr>
</table>

## See inside

Unit 3D puts you inside the exact unit, on its real floor, with the city through the glass. The Paramount Tower 25E views use the renter's own furniture (a black leather futon, the Bestier rotating desk with a 32 in monitor and an office chair, a black IKEA STORKLINTA dresser, the brown Latitude Run storage bed with black quilted bedding, two wall-mounted 55 in TVs, three paintings), finishes read from the unit's photos (a basket-weave parquet floor) and a facade bearing measured from their photos.

<table>
<tr>
<td colspan="2" valign="top"><a href="images/inside-unit-3d.png"><img src="images/inside-unit-3d.png" alt="Unit 3D inside Paramount Tower 25E: the desk, monitor and office chair by the bay window, a painting, the TV and the dining table"></a><br><b>Unit 3D lands inside the apartment</b><br><sub>The 3D tab opens in the apartment at the 25th-floor slab height with a wide stage: the desk, its monitor and the one office chair by the bay window, the wall-mounted TV, a painting and the real city outside. The view picker and "Go to the window" are at the top, the day and year play bar and the sun hours by month below.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/inside-living-room.png"><img src="images/inside-living-room.png" alt="Looking down the living room of Paramount Tower 25E toward the bay: the wall-mounted TV, the desk and office chair, the futon, the dining table, two paintings and the towers through the windows"></a><br><b>Your furniture, paintings and the view</b><br><sub>From the back of the living room toward the bay: the futon facing the TV, the dining table and chairs, the Bestier desk with its single office chair at the window, the Monet by the dining table and the Central Park triptych over the futon (shown here as a painted stand-in), with the towers beyond the glass. The two public-domain paintings ship with the dashboard; a private file wins over a stand-in.</sub></td>
<td width="50%" valign="top"><a href="images/inside-furniture.png"><img src="images/inside-furniture.png" alt="The bedroom seen from its door: the brown storage bed with black quilted bedding, the wall-mounted TV, a painting over the bed and the corner windows with towers, a park and the river"></a><br><b>The bedroom from its door</b><br><sub>The brown Latitude Run storage bed with black quilted bedding, the wall-mounted 55 in TV and the tall dresser, a painting over the bed and the corner windows, at real sizes. Colours and materials say whether they are known or stand-ins.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/inside-bay.png"><img src="images/inside-bay.png" alt="The bedroom bay at wide angle, looking out of the angled windows at towers, a park and the river with the bed's headboard at the edge"></a><br><b>Through the angled windows</b><br><sub>The bedroom bay at 11:30 am, wide angle: the angled glass at the real height with the neighbouring towers, a park's canopy and the river, the radiator cover and the bed's headboard. Chips switch between rooms, bays, corners and the seats (sofa, bed, desk, each also looking out of the window).</sub></td>
<td width="50%" valign="top"><a href="images/inside-bedroom.png"><img src="images/inside-bedroom.png" alt="The bedroom from the window end: the whole bed, the seascape painting over it, the dresser and the window"></a><br><b>The bedroom</b><br><sub>The bedroom from its window end: the whole storage bed with its black quilted bedding and nightstand, the Van Gogh seascape over the headboard, the dresser and the TV, and the tower across the street in the glass.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/inside-night-window.png"><img src="images/inside-night-window.png" alt="Standing at the window at night: lit windows in the towers, street lamps along the river road"></a><br><b>The night city</b><br><sub>8:30 pm at the same window: thousands of buildings around the unit with lit facades, the street lamps along the road and the park in the dark, and the night sky.</sub></td>
<td width="50%" valign="top"><a href="images/inside-measure-tape.png"><img src="images/inside-measure-tape.png" alt="The measuring tape reading 5 feet 2 inches across the bay window"></a><br><b>The measuring tape</b><br><sub>The tape tool in the right-hand column: click two points and it snaps to wall corners, window edges and furniture edges. It reads 5' 2" across the bay. The same tape works in the studio's 2D plan and 3D room, and the readings are kept with the plan.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/inside-fits.png"><img src="images/inside-fits.png" alt="Does it fit? A bookshelf dropped into the living room with the space around it on each side"></a><br><b>Does it fit?</b><br><sub>In the studio, type "Bookshelf 36 x 12 x 72 in" (or pick a catalogue piece or a product) and drop it in a room: it is drawn at its real size and judged, with the space on each of its four sides, and can be added to your furniture list.</sub></td>
<td width="50%" valign="top"><a href="images/inside-match-photo.png"><img src="images/inside-match-photo.png" alt="Match a photo: a listing photo laid over the 3D view while a landmark is marked"></a><br><b>Match a photo</b><br><sub>From the Window view, <i>Match a photo</i> lays one of the listing's photos over the 3D view at an opacity you set. Mark two or three landmarks (a tower top, a roof corner) and it fits the camera, then reports how well the model's window, bearing and floor agree with the photographer's.</sub></td>
</tr>
<tr>
<td colspan="2" valign="top"><a href="images/inside-measured-chip.png"><img src="images/inside-measured-chip.png" alt="The measured vs assumed chip opened over the desk and office chair"></a><br><b>Measured, sourced or assumed</b><br><sub>The chip open: building heights from a source, the facade bearing of 119 degrees measured against landmarks in the renter's photos, the position along the facade assumed, the floor height estimated, the floor plan and the finishes from sources, and the furniture confirmed by the renter.</sub></td>
</tr>
</table>

## Sun and light

Direct sun is worked out for the window from the buildings around it: by floor, by month, by hour, and with the building that blocks it named. Trees are context and never count as shade.

<table>
<tr>
<td width="50%" valign="top"><a href="images/sun-low-floor.png"><img src="images/sun-low-floor.png" alt="The view from floor 8 of Paramount Tower at 8:30 am on March 20: a neighbouring building fills the window, which is in shadow"></a><br><b>Floor 8: in shadow</b><br><sub>The same window line on floor 8, March 20 at 8:30 am. The HUD says "Window in shadow · 713 2 Avenue": the sun is 16 degrees up in the east-south-east, behind the building across the avenue, and the view is its facade and the low roofs.</sub></td>
<td width="50%" valign="top"><a href="images/sun-high-floor.png"><img src="images/sun-high-floor.png" alt="The view from floor 25 at the same moment: direct sun over the low roofs, towers, a park and the river"></a><br><b>Floor 25, same moment: direct sun</b><br><sub>Floor 25 at the same date and time: "Direct sun on the window". The sun clears the roofs that shade floor 8, and the view opens to the towers, a park's lawn and a strip of the East River.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/sun-winter-shadows.png"><img src="images/sun-winter-shadows.png" alt="The block around Paramount Tower at noon on December 21 with long winter shadows"></a><br><b>December 21, noon</b><br><sub>Outside at noon on December 21: the sun due south and 26 degrees up, long shadows across the streets and facades, the sun ray reaching the 25th-floor window, and 567 3 Avenue (under construction) drawn dashed.</sub></td>
<td width="50%" valign="top"><a href="images/sun-summer-shadows.png"><img src="images/sun-summer-shadows.png" alt="The same block at noon on June 21 with short summer shadows and trees in leaf"></a><br><b>June 21, noon</b><br><sub>The same camera at noon on June 21: the sun 69 degrees up in the south-east, short shadows, trees in leaf along the streets, and the sun ray dropping steeply to the window.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/sun-path-chart.png"><img src="images/sun-path-chart.png" alt="A chart of the sun's path on December 21, March 20 and June 21 against the skyline seen from the 25E window"></a><br><b>Sun path against the skyline</b><br><sub>From the 25E window: the skyline as seen from floor 25 (filled) and from floor 34 (dashed), the sun's arcs on June 21, March 20 and December 21, and December 21 hour by hour, faint where a building blocks it. Ticks mark the side panes of the bay.</sub></td>
<td width="50%" valign="top"><a href="images/inside-sun-by-floor.png"><img src="images/inside-sun-by-floor.png" alt="Direct sun hours by floor and month for a facade"></a><br><b>Sun by floor and month</b><br><sub>Emerald Green 1211's facade: hours of direct sun on the 15th of each month for every floor, from 0 to 9 hours, with floor 12 outlined as the chosen floor. A click jumps the 3D view to that floor and month.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/sun-plan-view.png"><img src="images/sun-plan-view.png" alt="The street plan from straight above: neighbouring roofs, their shadows and the sun's line to the window"></a><br><b>From above: what stands in the way</b><br><sub>Street plan, December 21 at 10 am: the tower from straight above among its neighbours and their shadows, with the sun's line running to the window, so you can see which building would stand between the window and the sun at any hour.</sub></td>
<td width="50%" valign="top"><a href="images/inside-play-year.png"><img src="images/inside-play-year.png" alt="The Inside view with the Play day and Play year bar at December 28, with bare branches"></a><br><b>Play the day, play the year</b><br><sub>The play bar moves the sun across the day or through the months at one time of day. Here it has reached December 28: the trees are bare, the window is in shadow, and the strip says so. Trees change with the season and never count as shade in the sun numbers.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/inside-orbit-day.png"><img src="images/inside-orbit-day.png" alt="Unit 3D by day: the tower among its neighbours with the window marked"></a><br><b>By day</b><br><sub>Outside, by day: the window on floor 25 facing ESE (a bay), the sun ray to it, a tower under construction drawn dashed and street trees.</sub></td>
<td width="50%" valign="top"><a href="images/inside-orbit-night.png"><img src="images/inside-orbit-night.png" alt="Unit 3D at night with lit windows across the neighbourhood"></a><br><b>And at night</b><br><sub>8:30 pm: facades are shader-drawn with lit windows, the sun is below the horizon and the HUD says Night.</sub></td>
</tr>
</table>

## The city in 3D

Each site model holds thousands of buildings from open footprints and heights, with landmarks built from their parts, water, parks, street trees and permitted towers drawn dashed.

<table>
<tr>
<td colspan="2" valign="top"><a href="images/city-building-models.png"><img src="images/city-building-models.png" alt="Buildings coloured by height class with roof heights labelled around Paramount Tower"></a><br><b>Every building around the tower, with its height</b><br><sub>The Heights layer: every building around the tower coloured by height class with its roof height labelled (Paramount Tower 160 m, 567 3 Avenue 180 m and under construction), a 150 m ring on the ground and the window marked on floor 25.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/city-map-3d.png"><img src="images/city-map-3d.png" alt="The commute map tilted with extruded 3D buildings, price tags and subway lines"></a><br><b>The map in 3D</b><br><sub><i>Tilt with 3D buildings</i> on the map: OpenStreetMap buildings rise over the commute layer, with the price tags, the subway lines and Grand Central, from Hudson Yards to Murray Hill.</sub></td>
<td width="50%" valign="top"><a href="images/inside-river.png"><img src="images/inside-river.png" alt="The Hudson River and piers in Unit 3D at sunset"></a><br><b>Water and permitted towers</b><br><sub>Henry Hall 23J on June 21 at 7 pm: the Hudson River and the piers from surveyed hydrography, and proposed and permitted towers drawn dashed where they will stand. The sun is behind the facade.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/inside-park-trees.png"><img src="images/inside-park-trees.png" alt="A park drawn as grass and trees in Unit 3D"></a><br><b>Parks and trees</b><br><sub>Atlas 38D, floor 38, at 2 pm in October: a park drawn as a lawn with its trees from the NYC Parks inventory in autumn colour, and street trees along the avenues. They are context and are never counted as shade in the sun hours.</sub></td>
<td width="50%" valign="top"><a href="images/inside-light-theme.png"><img src="images/inside-light-theme.png" alt="Unit 3D in the light theme on a June evening"></a><br><b>The light theme</b><br><sub>The Maybury, floor 22, at 6 pm on June 21: direct sun on the window from the west (280 degrees), with the Hudson River beyond, in the light theme.</sub></td>
</tr>
</table>

## Floor-plan studio

The Floor plan studio draws the same room as Unit 3D: a piece placed in one stays there in the other.

<table>
<tr>
<td width="50%" valign="top"><a href="images/inside-floor-plan.png"><img src="images/inside-floor-plan.png" alt="The floor plan studio with the 2D plan and the furnished 3D room side by side"></a><br><b>Bird's eye beside the plan</b><br><sub>The Paramount Tower 25E plan in 2D and 3D with "Using your furniture" and the Does it fit? panel in the right-hand column. Drag a piece in either view and it moves in both; sun patches, fit checks, the tape and eye-level cameras are in the same studio.</sub></td>
<td width="50%" valign="top"><a href="images/studio-top.png"><img src="images/studio-top.png" alt="The studio's Top camera beside the 2D plan with every room's dimensions and the walkway clearances"></a><br><b>Top down, with every dimension</b><br><sub>The Top camera with every room's dimensions on (<i>All rooms</i>): the 10.4 ft and 9.1 ft walkways marked workable, and the blocked, tight and clear counts (0, 2 and 9) for the pieces placed.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/studio-light.png"><img src="images/studio-light.png" alt="The studio's 3D room on December 21 at 10 am with sunlight on the floor and the Light tab open"></a><br><b>The light tab</b><br><sub>The 3D room alone on December 21 at 10 am with the Light tab: directional sunlight on the floor, glazing transmittance and blinds (open, sheer, half, closed), and for each window its facing, its unoccluded reach and its sun today.</sub></td>
<td width="50%" valign="top"><a href="images/studio-tracer.png"><img src="images/studio-tracer.png" alt="New plan from image: a listing floor plan loaded for tracing, with the eight steps across the top"></a><br><b>Trace a plan from an image</b><br><sub><i>New plan from image</i>: a listing's floor plan (an Emerald Green line) loaded as the backdrop, then eight steps: image, scale, north, rooms, doors and windows, fixtures, details and save. The image or PDF page stays in the browser.</sub></td>
</tr>
</table>

## Compare

Put finalists side by side, in a table or in 3D, trade the weights against each other and watch the ranking move.

<table>
<tr>
<td width="50%" valign="top"><a href="images/compare-four.png"><img src="images/compare-four.png" alt="Four finalists compared in lettered columns"></a><br><b>Four finalists, row by row</b><br><sub>Paramount Tower 25E, Emerald Green 24D, 7 Platt 14G and One Manhattan Square 57G in columns A to D, with money, space and commute rows below. The best value in each row is marked, and a fact nobody has confirmed (free months, fees, size) reads "Unknown" and never counts as the worst.</sub></td>
<td width="50%" valign="top"><a href="images/compare-side-by-side-3d.png"><img src="images/compare-side-by-side-3d.png" alt="Two homes in the same tower side by side in 3D"></a><br><b>Two units side by side in 3D</b><br><sub>Compare in 3D opens two homes in one view with the same date, time and camera (Inside or Window) and one time slider. Each pane has its own direct-sun readout: Paramount Tower 25E, floor 25, gets 6 hours on this date and 41A, floor 41, none.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/compare-tradeoff-pad.png"><img src="images/compare-tradeoff-pad.png" alt="The trade-off pad previewing a weight preset"></a><br><b>The trade-off pad</b><br><sub>One dot trades Cost, Commute and Space against each other. Pointing at the Biggest and nicest ring previews the top ten if it were applied: ten of ten places change and six homes fall out. Clicking applies it through the same weights as the sliders.</sub></td>
<td width="50%" valign="top"><a href="images/compare-split-view.png"><img src="images/compare-split-view.png" alt="The shortlist table beside a docked map"></a><br><b>The shortlist beside its map</b><br><sub>Shortlist split view: 55 homes in the Target tier with a gym, next to a map of exactly those homes. Hovering Emerald Green 24D previews its 17-minute subway trip.</sub></td>
</tr>
</table>

## Decide

Read the records, ask the leasing office, visit, plan the tours, then share a page or a memo.

<table>
<tr>
<td width="50%" valign="top"><a href="images/decide-records.png"><img src="images/decide-records.png" alt="A building's public records report"></a><br><b>Building records</b><br><sub>The due-diligence report for Emerald Green #1211: a records score of 90 and a street-noise score of 51, four areas to check (heat and hot water complaints, heavy construction nearby, 311 noise, bedbug filings) and a "What matters" table that labels every item a report, not a finding.</sub></td>
<td width="50%" valign="top"><a href="images/decide-office-questions.png"><img src="images/decide-office-questions.png" alt="Questions for the leasing office of The Knox"></a><br><b>Questions for the leasing office</b><br><sub>The side sheet for The Knox: its units with their open questions, a checkbox per question (14 checked), "Why this is asked" for the evidence, then the subject and message below. Copy email, or Open in my email app: a <code>mailto:</code> link with no recipient. Nothing is sent from the page.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/decide-visit-history.png"><img src="images/decide-visit-history.png" alt="Visit notes in the listing drawer"></a><br><b>Visit notes and history</b><br><sub>Sample notes from a visit to Paramount Tower 25E: rooms measured (293 ft²), ceiling, water pressure, noise at the window with a dB reading, signal, laundry, light with the time, the view, and whether the doorman, size and windows match the listing. The dated history of every star, tier and status change sits below.</sub></td>
<td width="50%" valign="top"><a href="images/decide-tours-board.png"><img src="images/decide-tours-board.png" alt="The tours board: saved picks in S, A, B, C and Pass lanes with tour times and notes"></a><br><b>The tours board</b><br><sub>The Tours tab: saved picks in To sort, S, A, B, C and Pass lanes (drag between them or use the tier buttons), each with a tour time, notes and <i>Start visit notes</i>, and the tour plan below, ordered from Grand Central with the walking minutes.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/decide-tour-planner.png"><img src="images/decide-tour-planner.png" alt="The tour-day planner"></a><br><b>The tour-day planner</b><br><sub>Five stops from 10:00 am to 3:10 pm: when to leave by for each hop, walking or an estimated transit trip, a viewing time and a buffer, and a warning where a booked time is later than the plan. Add to calendar and Copy plan are at the top right.</sub></td>
<td width="50%" valign="top"><a href="images/decide-memo.png"><img src="images/decide-memo.png" alt="The decision memo"></a><br><b>The decision memo</b><br><sub>A ranked table of the five saved homes with money, size, commute, score, tier and open items, then the weights that mattered and a page per home. Print it or save it as a PDF; your notes stay out unless you tick them.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/decide-share-page.png"><img src="images/decide-share-page.png" alt="The read-only shortlist page"></a><br><b>A page to send</b><br><sub>The read-only Share shortlist page: five homes, a median of $5,032 a month, a schematic map with the subway lines and a ranked list, then a card per home with its photos, price and reasons.</sub></td>
<td width="50%" valign="top"><a href="images/decide-research-queue.png"><img src="images/decide-research-queue.png" alt="The research queue"></a><br><b>What you still don't know</b><br><sub>The Research tab: the finalist standard (none of the 434 open homes has every fact yet), counts of missing size, fees and media, and a queue ranked by the points each unknown could swing, with questions ready to copy for the leasing office.</sub></td>
</tr>
<tr>
<td colspan="2" valign="top"><a href="images/decide-gone-fast.png"><img src="images/decide-gone-fast.png" alt="Research, Gone fast: good units at your budget go in 5 days, a days-on-market chart and the units that went"></a><br><b>What rented, and how fast</b><br><sub>Research, <i>Gone fast</i>: the lesson first (good units at your budget go in 5 days, the median of the five with both dates), days on market as a histogram, then each unit that went with its dates, days on market, last price and budget tier.</sub></td>
</tr>
</table>

## Set up

Start a search in any city from the dashboard, the terminal or an agent.

<table>
<tr>
<td width="50%" valign="top"><a href="images/setup-wizard-city.png"><img src="images/setup-wizard-city.png" alt="The new search wizard, step 1"></a><br><b>The new search wizard</b><br><sub>Step 1 of 8 (<code>?new=1</code>, or New search in the menu): a search name and the city, here Another city with Chicago typed in. Each step's answer is summarised on the left and a draft is kept in the browser. Served locally it also looks the city up.</sub></td>
<td width="50%" valign="top"><a href="images/setup-wizard-review.png"><img src="images/setup-wizard-review.png" alt="The wizard's review step"></a><br><b>Review the criteria.yaml</b><br><sub>The last step shows the generated <code>criteria.yaml</code>, a diff against the open search and, because this page cannot write files, Copy YAML, Apply as preview and Download criteria.yaml.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="images/setup-menu.png"><img src="images/setup-menu.png" alt="The one menu at the top right"></a><br><b>One menu</b><br><sub>The top-right menu: this search (edit criteria, settings, new search), data (CSV, back up and restore picks, share, decision memo), appearance (theme, accent, density, office pin, golden-hour tint), comfort (motion, transparency, contrast, text size) and help.</sub></td>
<td width="50%" valign="top"><a href="images/setup-cli.png"><img src="images/setup-cli.png" alt="Command-line output"></a><br><b>The command line</b><br><sub>Real output on the example: <code>apartmentscout city</code> says what the city has (geocoding, OpenStreetMap buildings, streets and parks, floor plans, NYC open data, three GTFS feeds), and <code>score --top 10</code> prints the ranking.</sub></td>
</tr>
</table>

## On a phone

The layout follows the screen; the dashboard installs as an app and works offline.

<table>
<tr>
<td width="16%" valign="top"><a href="images/phone-map.png"><img src="images/phone-map.png" alt="The map and ranked cards on a phone" width="150"></a><br><b>Map and cards</b><br><sub>The commute map on top, ranked cards in a sheet below, and a bottom tab bar.</sub></td>
<td width="16%" valign="top"><a href="images/phone-drawer.png"><img src="images/phone-drawer.png" alt="A listing drawer on a phone" width="150"></a><br><b>A listing</b><br><sub>The drawer slides up over the map: the credited photo, score, tabs from Overview to Commute, the money first, and See inside, Unit 3D and Plan in the bar.</sub></td>
<td width="16%" valign="top"><a href="images/phone-unit-3d.png"><img src="images/phone-unit-3d.png" alt="Unit 3D on a phone" width="150"></a><br><b>Unit 3D</b><br><sub>Inside, from "Sofa, window", with the camera modes, the view picker, the bed switch, the layers button and the play bar. The 3D scene is tuned to stay smooth on a phone.</sub></td>
<td width="16%" valign="top"><a href="images/phone-visit-notes.png"><img src="images/phone-visit-notes.png" alt="Visit notes on a phone" width="150"></a><br><b>Visit notes</b><br><sub>Sample notes opened with <code>?visit=&lt;listing-id&gt;</code> for one hand at the home: big steppers, rooms with their areas, and the camera in the bar below.</sub></td>
<td width="16%" valign="top"><a href="images/phone-tour-day.png"><img src="images/phone-tour-day.png" alt="Tour day on a phone: three homes in time order" width="150"></a><br><b>Tour day</b><br><sub>Today's tours in time order (or shortest walk), each with Directions, the checklist progress and the minutes to the next stop; sample tours booked for the day of the shot.</sub></td>
<td width="16%" valign="top"><a href="images/phone-tour-checklist.png"><img src="images/phone-tour-checklist.png" alt="The Tour day checklist for one home" width="150"></a><br><b>The checklist</b><br><sub>One question at a time at the home: light at the window (1 to 5) with the time saved, which way it faces, noise with the windows shut, each with why it matters to your weights. Answers flow into the visit notes and the score.</sub></td>
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
