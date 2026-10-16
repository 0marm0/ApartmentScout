<h1 align="center">ApartmentScout</h1>

<p align="center"><b>Know the apartment before you sign.</b><br>
Rank every listing on your own criteria and its true monthly cost, time the commute, read the building's records, and stand
inside the exact unit, with your own furniture, in the real city around it.</p>

<p align="center">
<a href="https://github.com/0marm0/ApartmentScout/actions/workflows/tests.yml"><img alt="Tests" src="https://github.com/0marm0/ApartmentScout/actions/workflows/tests.yml/badge.svg"></a>
<a href="https://github.com/0marm0/ApartmentScout/actions/workflows/pages.yml"><img alt="Pages deploy" src="https://github.com/0marm0/ApartmentScout/actions/workflows/pages.yml/badge.svg"></a>
<a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/0marm0/ApartmentScout?color=informational"></a>
<img alt="Python 3.10 or newer" src="https://img.shields.io/badge/python-3.10%2B-informational">
<img alt="No API keys, accounts or servers" src="https://img.shields.io/badge/API%20keys-none-success">
</p>

<p align="center">
<a href="https://0marm0.github.io/ApartmentScout/demo/"><img alt="Try the live demo" src="https://img.shields.io/badge/%E2%96%B6%20%20Try%20the%20live%20demo-12865f?style=for-the-badge"></a>
<a href="docs/guides/iphone.md"><img alt="Install on iPhone" src="https://img.shields.io/badge/%F0%9F%93%B1%20%20Install%20on%20iPhone-2b3140?style=for-the-badge"></a>
<a href="#quick-start"><img alt="Quick start" src="https://img.shields.io/badge/%E2%9A%A1%20%20Quick%20start-2b3140?style=for-the-badge"></a>
</p>

<p align="center">
<a href="https://0marm0.github.io/ApartmentScout/demo/"><img src="docs/images/walkthrough.webp" width="820" alt="A 20-second walk-through: the commute map over Manhattan, a ranked card opening into its drawer, Unit 3D around Paramount Tower, then standing inside the living room, walking to the window, and the same view as the sun sets over a lit night city"></a><br>
<sub>Map, card, drawer, then inside the unit: walk to the window and watch the day turn to night. <a href="docs/images/walkthrough.mp4">Watch it in full quality (MP4)</a>.</sub>
</p>

ApartmentScout came out of a real search for a one-bedroom in Manhattan: 738 listings in 260 buildings, and the same questions
for every finalist. What does it cost a month once fees and free months are counted? How long is the trip door to door? What do
the city's records say about the building? How loud is the street, and will the window see the sky or a wall? This repository
turns that process into agent playbooks, a Python command line and a dashboard you own, for any city, with that search included
as a worked example.

## What you can do

Five steps, in the order a search goes. [Screenshots](#screenshots) of every screen are below, and the [gallery](docs/GALLERY.md) captions each one.

| | Journey | What you get |
|---|---|---|
| 1 | **[Find](docs/GALLERY.md#find)** | Every listing ranked on **your weights and true monthly cost** (fees and free months counted, unknowns kept unknown). **Door-to-door commute** by walk, subway, bus or the best of them, from a built-in GTFS router. A map that merges homes into bubbles, previews a pin, and takes plain-words search ("east of 3rd ave under 5k with w/d"). Price drops, a price audit, and a plain-language reason for every rank move. |
| 2 | **[Compare](docs/GALLERY.md#compare)** | Up to four finalists row by row, the best value marked and unknowns never counted as the worst. Two units side by side in 3D with their own direct-sun hours. A trade-off pad to drag cost against commute and space, and **unknowns that move this score**: type the real size or fee and see the rank you would get. |
| 3 | **[See inside](docs/GALLERY.md#see-inside)** | **Unit 3D** puts you in the exact unit with the furniture you own, finishes read from the listing photos, and the real city through the glass. Walk to the window, play the day and the year (sun, shadows, seasons), see it at night, measure, test "does it fit?", match a listing photo. Floor plans traced from the listing's PDF. |
| 4 | **[Decide](docs/GALLERY.md#decide)** | Building dossiers from public records and a 311 noise layer (New York built in). Questions for the leasing office, drafted and never sent. A phone **tour day** with directions, a one-hand checklist and a noise check that keeps one number and no audio. A tour planner, a share page, a decision memo, a typeset decision report for two to four homes, and a move planner with a calendar file. |
| 5 | **[Set up](docs/GALLERY.md#set-up)** | Any city OpenStreetMap knows, by a wizard in the dashboard, an interview in the terminal, or your agent. Plain files in a folder you own. The dashboard installs as an app and works offline. Nine agent skills, and checksummed handoff packs between agents. |

## Screenshots

Every screen below is from the worked example; click a picture for full size. The [gallery](docs/GALLERY.md) has a caption for each one.

### Find

Rank every listing on your weights and true monthly cost, over a door-to-door commute map.

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/hero-map.png"><img src="docs/images/hero-map.png" alt="A listing over the commute map"></a><br><sub><b>A listing over the commute map</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-commute-map.png"><img src="docs/images/find-commute-map.png" alt="Door to door, by the best of transit"></a><br><sub><b>Door to door, by the best of transit</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-map-clusters.png"><img src="docs/images/find-map-clusters.png" alt="A calmer map"></a><br><sub><b>A calmer map</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-building-pin.png"><img src="docs/images/find-building-pin.png" alt="A building is one pin"></a><br><sub><b>A building is one pin</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-pin-preview.png"><img src="docs/images/find-pin-preview.png" alt="Hover a pin, see the home"></a><br><sub><b>Hover a pin, see the home</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-route-preview.png"><img src="docs/images/find-route-preview.png" alt="Hover a card, see the trip"></a><br><sub><b>Hover a card, see the trip</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-place-search.png"><img src="docs/images/find-place-search.png" alt="Ask in plain words"></a><br><sub><b>Ask in plain words</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-price-drops.png"><img src="docs/images/find-price-drops.png" alt="Real price history"></a><br><sub><b>Real price history</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-rank-moves.png"><img src="docs/images/find-rank-moves.png" alt="Why a home moved"></a><br><sub><b>Why a home moved</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-unknowns.png"><img src="docs/images/find-unknowns.png" alt="Unknowns that move this score"></a><br><sub><b>Unknowns that move this score</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-price-audit.png"><img src="docs/images/find-price-audit.png" alt="The price audit"></a><br><sub><b>The price audit</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-lightbox.png"><img src="docs/images/find-lightbox.png" alt="Photos and the floor plan"></a><br><sub><b>Photos and the floor plan</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-light-theme.png"><img src="docs/images/find-light-theme.png" alt="The light theme"></a><br><sub><b>The light theme</b></sub></td>
</tr>
</table>

### Compare

Finalists row by row, in 3D side by side, and a pad to trade the weights.

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/compare-four.png"><img src="docs/images/compare-four.png" alt="Four finalists, row by row"></a><br><sub><b>Four finalists, row by row</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/compare-side-by-side-3d.png"><img src="docs/images/compare-side-by-side-3d.png" alt="Two units side by side in 3D"></a><br><sub><b>Two units side by side in 3D</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/compare-tradeoff-pad.png"><img src="docs/images/compare-tradeoff-pad.png" alt="The trade-off pad"></a><br><sub><b>The trade-off pad</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/compare-split-view.png"><img src="docs/images/compare-split-view.png" alt="The shortlist beside its map"></a><br><sub><b>The shortlist beside its map</b></sub></td>
</tr>
</table>

### See inside

Unit 3D: the exact unit, your own furniture, real sun and shadows, the city through the glass, the floor-plan studio.

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-unit-3d.png"><img src="docs/images/inside-unit-3d.png" alt="Unit 3D lands inside the apartment"></a><br><sub><b>Unit 3D lands inside the apartment</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-furniture.png"><img src="docs/images/inside-furniture.png" alt="Your own furniture"></a><br><sub><b>Your own furniture</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-walk-window.png"><img src="docs/images/inside-walk-window.png" alt="Walk to the window"></a><br><sub><b>Walk to the window</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-bedroom.png"><img src="docs/images/inside-bedroom.png" alt="The bedroom"></a><br><sub><b>The bedroom</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-bay.png"><img src="docs/images/inside-bay.png" alt="Through the angled windows"></a><br><sub><b>Through the angled windows</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-night-window.png"><img src="docs/images/inside-night-window.png" alt="The night city"></a><br><sub><b>The night city</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-play-year.png"><img src="docs/images/inside-play-year.png" alt="Play the day, play the year"></a><br><sub><b>Play the day, play the year</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-measure-tape.png"><img src="docs/images/inside-measure-tape.png" alt="The measuring tape"></a><br><sub><b>The measuring tape</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-fits.png"><img src="docs/images/inside-fits.png" alt="Does it fit?"></a><br><sub><b>Does it fit?</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-match-photo.png"><img src="docs/images/inside-match-photo.png" alt="Match a photo"></a><br><sub><b>Match a photo</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-floor-plan.png"><img src="docs/images/inside-floor-plan.png" alt="The floor plan studio"></a><br><sub><b>The floor plan studio</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-measured-chip.png"><img src="docs/images/inside-measured-chip.png" alt="Measured, sourced or assumed"></a><br><sub><b>Measured, sourced or assumed</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-orbit-day.png"><img src="docs/images/inside-orbit-day.png" alt="Unit 3D by day"></a><br><sub><b>Unit 3D by day</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-orbit-night.png"><img src="docs/images/inside-orbit-night.png" alt="The same view at night"></a><br><sub><b>The same view at night</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-skyline-dusk.png"><img src="docs/images/inside-skyline-dusk.png" alt="The skyline, drawn from its parts"></a><br><sub><b>The skyline, drawn from its parts</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-sun-by-floor.png"><img src="docs/images/inside-sun-by-floor.png" alt="Sun by floor and month"></a><br><sub><b>Sun by floor and month</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-park-trees.png"><img src="docs/images/inside-park-trees.png" alt="Parks and trees"></a><br><sub><b>Parks and trees</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-river.png"><img src="docs/images/inside-river.png" alt="Water and permitted towers"></a><br><sub><b>Water and permitted towers</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-light-theme.png"><img src="docs/images/inside-light-theme.png" alt="Unit 3D in the light theme"></a><br><sub><b>Unit 3D in the light theme</b></sub></td>
</tr>
</table>

### Decide

Records, questions for the leasing office, tours, a share page and a decision memo.

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-office-questions.png"><img src="docs/images/decide-office-questions.png" alt="Questions for the leasing office"></a><br><sub><b>Questions for the leasing office</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-visit-history.png"><img src="docs/images/decide-visit-history.png" alt="Visit notes and decision history"></a><br><sub><b>Visit notes and decision history</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-tour-planner.png"><img src="docs/images/decide-tour-planner.png" alt="The tour-day planner"></a><br><sub><b>The tour-day planner</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-memo.png"><img src="docs/images/decide-memo.png" alt="The decision memo"></a><br><sub><b>The decision memo</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-share-page.png"><img src="docs/images/decide-share-page.png" alt="A page to send"></a><br><sub><b>A page to send</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-records.png"><img src="docs/images/decide-records.png" alt="Building records"></a><br><sub><b>Building records</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-research-queue.png"><img src="docs/images/decide-research-queue.png" alt="What you still don't know"></a><br><sub><b>What you still don't know</b></sub></td>
</tr>
</table>

### Set up

Any city: a wizard in the dashboard, an interview in the terminal, or your agent.

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/setup-wizard-city.png"><img src="docs/images/setup-wizard-city.png" alt="The new search wizard"></a><br><sub><b>The new search wizard</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/setup-wizard-review.png"><img src="docs/images/setup-wizard-review.png" alt="Review the criteria.yaml"></a><br><sub><b>Review the criteria.yaml</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/setup-menu.png"><img src="docs/images/setup-menu.png" alt="One menu"></a><br><sub><b>One menu</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/setup-cli.png"><img src="docs/images/setup-cli.png" alt="The command line"></a><br><sub><b>The command line</b></sub></td>
</tr>
</table>

### On a phone

Installs as an app: the map, Unit 3D, visit notes and a one-hand tour day.

<table>
<tr>
<td width="20%" valign="top" align="center"><a href="docs/images/phone-map.png"><img src="docs/images/phone-map.png" alt="Map and cards" width="180"></a><br><sub><b>Map and cards</b></sub></td>
<td width="20%" valign="top" align="center"><a href="docs/images/phone-unit-3d.png"><img src="docs/images/phone-unit-3d.png" alt="Unit 3D" width="180"></a><br><sub><b>Unit 3D</b></sub></td>
<td width="20%" valign="top" align="center"><a href="docs/images/phone-visit-notes.png"><img src="docs/images/phone-visit-notes.png" alt="Visit notes" width="180"></a><br><sub><b>Visit notes</b></sub></td>
<td width="20%" valign="top" align="center"><a href="docs/images/phone-tour-day.png"><img src="docs/images/phone-tour-day.png" alt="Tour day" width="180"></a><br><sub><b>Tour day</b></sub></td>
<td width="20%" valign="top" align="center"><a href="docs/images/phone-tour-checklist.png"><img src="docs/images/phone-tour-checklist.png" alt="The checklist" width="180"></a><br><sub><b>The checklist</b></sub></td>
</tr>
</table>

### From earlier versions

Screens from earlier builds of the same dashboard: the sun studies, the floor-plan studio, the map and the research pages as they first shipped.

#### Sun and light

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/chart-sun-by-floor.png"><img src="docs/images/earlier/chart-sun-by-floor.png" alt="Direct sun by floor and month"></a><br><sub><b>Direct sun by floor and month</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/chart-sunpath.png"><img src="docs/images/earlier/chart-sunpath.png" alt="Sun path against the skyline"></a><br><sub><b>Sun path against the skyline</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-sunpath.png"><img src="docs/images/earlier/unit-sunpath.png" alt="The sun's arc over the neighbours"></a><br><sub><b>The sun's arc over the neighbours</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-floors.png"><img src="docs/images/earlier/unit-floors.png" alt="Sun hours, every floor of a tower"></a><br><sub><b>Sun hours, every floor of a tower</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-window-12.png"><img src="docs/images/earlier/unit-window-12.png" alt="The view from floor 12"></a><br><sub><b>The view from floor 12</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-window-21.png"><img src="docs/images/earlier/unit-window-21.png" alt="The same window from floor 21"></a><br><sub><b>The same window from floor 21</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-maybury.png"><img src="docs/images/earlier/unit-maybury.png" alt="Dusk from a 22nd floor"></a><br><sub><b>Dusk from a 22nd floor</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-orbit-dec.png"><img src="docs/images/earlier/unit-orbit-dec.png" alt="Winter shadows over the block"></a><br><sub><b>Winter shadows over the block</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-plan-view.png"><img src="docs/images/earlier/unit-plan-view.png" alt="From above: what blocks the window"></a><br><sub><b>From above: what blocks the window</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-inside.png"><img src="docs/images/earlier/unit-inside.png" alt="Inside, looking out"></a><br><sub><b>Inside, looking out</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/unit-light-theme.png"><img src="docs/images/earlier/unit-light-theme.png" alt="Light and view in the light theme"></a><br><sub><b>Light and view in the light theme</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/mobile-unit.png"><img src="docs/images/earlier/mobile-unit.png" alt="Unit 3D on a phone"></a><br><sub><b>Unit 3D on a phone</b></sub></td>
</tr>
</table>

#### Floor-plan studio

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/plan-bird.png"><img src="docs/images/earlier/plan-bird.png" alt="Bird's eye beside the plan"></a><br><sub><b>Bird's eye beside the plan</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/plan-top.png"><img src="docs/images/earlier/plan-top.png" alt="Top-down with clearances"></a><br><sub><b>Top-down with clearances</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/plan-light-tab.png"><img src="docs/images/earlier/plan-light-tab.png" alt="The light tab"></a><br><sub><b>The light tab</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/plan-tracer.png"><img src="docs/images/earlier/plan-tracer.png" alt="Trace a plan from an image"></a><br><sub><b>Trace a plan from an image</b></sub></td>
</tr>
</table>

#### Map, listings and photos

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/map-3d.png"><img src="docs/images/earlier/map-3d.png" alt="The map in 3D"></a><br><sub><b>The map in 3D</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/map-walk.png"><img src="docs/images/earlier/map-walk.png" alt="Walking time to Grand Central"></a><br><sub><b>Walking time to Grand Central</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/map-drawer-commute.png"><img src="docs/images/earlier/map-drawer-commute.png" alt="A drawer's commute and records"></a><br><sub><b>A drawer's commute and records</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/drawer-money.png"><img src="docs/images/earlier/drawer-money.png" alt="What it costs, month by month"></a><br><sub><b>What it costs, month by month</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/mobile-drawer.png"><img src="docs/images/earlier/mobile-drawer.png" alt="A listing on a phone"></a><br><sub><b>A listing on a phone</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/lightbox.png"><img src="docs/images/earlier/lightbox.png" alt="The photo lightbox"></a><br><sub><b>The photo lightbox</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/lightbox-floor-plan.png"><img src="docs/images/earlier/lightbox-floor-plan.png" alt="Photo beside the floor plan"></a><br><sub><b>Photo beside the floor plan</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/compare.png"><img src="docs/images/earlier/compare.png" alt="Compare, dark"></a><br><sub><b>Compare, dark</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/compare-light.png"><img src="docs/images/earlier/compare-light.png" alt="Compare, light"></a><br><sub><b>Compare, light</b></sub></td>
</tr>
</table>

#### Research, tours and sharing

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/research.png"><img src="docs/images/earlier/research.png" alt="The research queue"></a><br><sub><b>The research queue</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/research-gone.png"><img src="docs/images/earlier/research-gone.png" alt="What rented, and how fast"></a><br><sub><b>What rented, and how fast</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/tours.png"><img src="docs/images/earlier/tours.png" alt="Shortlist and tour board"></a><br><sub><b>Shortlist and tour board</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/tour-day-planner.png"><img src="docs/images/earlier/tour-day-planner.png" alt="A day of tours"></a><br><sub><b>A day of tours</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/records.png"><img src="docs/images/earlier/records.png" alt="Building records"></a><br><sub><b>Building records</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/share-shortlist-page.png"><img src="docs/images/earlier/share-shortlist-page.png" alt="A shareable shortlist page"></a><br><sub><b>A shareable shortlist page</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/share-decision-memo.png"><img src="docs/images/earlier/share-decision-memo.png" alt="The decision memo"></a><br><sub><b>The decision memo</b></sub></td>
</tr>
</table>

#### Setting up

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/wizard-basics.png"><img src="docs/images/earlier/wizard-basics.png" alt="New search: the basics"></a><br><sub><b>New search: the basics</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/wizard-review.png"><img src="docs/images/earlier/wizard-review.png" alt="New search: review and save"></a><br><sub><b>New search: review and save</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/earlier/cli.png"><img src="docs/images/earlier/cli.png" alt="The command line"></a><br><sub><b>The command line</b></sub></td>
</tr>
</table>

## How it works

Three parts, all yours, all plain files in a folder. No account, server or API key sits between you and your data.

```mermaid
flowchart LR
  subgraph you [You]
    R(["Renter"])
    AG["Your agent<br/>Claude Code · Codex · Cursor"]
  end
  SK[["9 skills<br/>.claude/skills"]]
  OD[("Open data<br/>OpenStreetMap · NYC Open Data<br/>GTFS · Census · Wikimedia")]
  CLI["apartmentscout CLI<br/>import · geocode · commute<br/>dossier · surroundings · score"]
  SF[("Search folder<br/>criteria.yaml · listings.json<br/>research · plans · sites")]
  B["build"]
  DD["Dashboard data<br/>JSON"]
  D["Static dashboard<br/>Map · Shortlist · Compare · 3D · Research"]
  L["apartmentscout serve<br/>on your machine"]
  P["GitHub Pages<br/>installable, offline"]
  F["One HTML file<br/>or a read-only share page"]

  R --> AG
  R --> CLI
  SK -. playbooks .-> AG
  AG -->|runs| CLI
  OD --> CLI
  CLI <--> SF
  SF --> B --> DD --> D
  D --> L
  D --> P
  D --> F
```

| | What it does |
|---|---|
| **Your agent** | Open the repository in Claude Code, Codex, Cursor or any agent that reads [`AGENTS.md`](AGENTS.md). Nine [skills](.claude/skills) walk it through intake, listing sourcing, commutes, building dossiers, noise, light and view, floor plans, lease and fees, and tours. It checks its own data with `validate`, `lint` and `coverage`, and drafts messages to leasing offices without sending them. |
| **The CLI** | Every stage is one command over files in your search folder: `geocode`, `commute`, `dossier`, `surroundings`, `score`, `build`, `export`, `share`. Repeatable, scriptable, and offline once the data is pulled. |
| **The dashboard** | Map, Shortlist, Compare, 3D and Research in one static page with one menu. Serve it, host it on GitHub Pages, open it as a single HTML file, or install it as an app. |

The [methodology](docs/guides/methodology.md) covers the money model, the scoring formula, the commute router and its validation,
and the sun and skyline model, and says what each one leaves out.

## Quick start

**Look first.** The [live demo](https://0marm0.github.io/ApartmentScout/demo/) is the dashboard on the worked example, running in
your browser: 738 Manhattan listings (434 active) in 260 buildings, commutes to an office near Grand Central, 16 3D site models,
9 floor plans and 30 building dossiers. Or run it on your own machine:

```bash
git clone --depth 1 https://github.com/0marm0/ApartmentScout.git   # --depth 1: today's files, not the whole history
cd ApartmentScout
python -m venv .venv && source .venv/bin/activate
pip install -e .                                       # ".[xlsx]" adds the workbook export, ".[dev]" the test tools
apartmentscout serve --search examples/nyc-2026
```

**Then your own search**, from nothing to a ranked map in about 15 minutes, in any city
([the full walk-through](docs/guides/getting-started.md)). It asks for your **city** (looked up, so the time zone and map are
right), your **places** (addresses are found and confirmed) and your **transit timetable** (a starter feed is offered where one has
been checked):

<!-- quickstart -->
```bash
apartmentscout init searches/my-search --city "Chicago, IL" --interactive
export APARTMENTSCOUT_SEARCH=searches/my-search
apartmentscout import searches/my-search/listings.csv   # fill the listings.template.csv that init wrote, or ask your agent
apartmentscout validate && apartmentscout lint         # catch bad data and listing traps early
apartmentscout all                                     # geocode, commute by mode, layers, places, score, build
apartmentscout surroundings                            # fetch the buildings around each shortlisted home (3D, sun, view)
apartmentscout plans                                   # floor plans: which homes have one, and how to add one
apartmentscout serve                                   # open the dashboard on your own data
```

Prefer to click? Run `apartmentscout serve`, open the menu at the top right and choose *New search*: a wizard asks the same
questions and writes the same `criteria.yaml`. Prefer to talk? Open the repository in Claude Code, Codex or Cursor and say
"help me find a one-bedroom near X under $Y": the agent reads [`AGENTS.md`](AGENTS.md) and interviews you. Requires Python 3.10+.
Floor plans: [adding your floor plans](docs/guides/getting-started.md#7-adding-your-floor-plans).

## On your phone

The dashboard is an installable app. On an iPhone, open the demo in Safari, tap Share, then **Add to Home Screen**: it opens
full screen and keeps working with no signal. On tour day it gives you today's visits in order with directions, a checklist at each
home and a noise check. The steps, what works offline and what stays on the phone are in the
[iPhone guide](docs/guides/iphone.md).

## Privacy

- **Your search stays yours.** Searches live in `searches/`, which git ignores. Your criteria, notes, saved picks, visit answers and
  tour-day checklist stay on your machine, and in the browser's own storage on your phone. There is no account, no analytics and no
  ApartmentScout server.
- **What the network sees.** Building a search reads public sources (OpenStreetMap, NYC Open Data, the US Census geocoder,
  transit agencies' feeds, Wikimedia Commons). The dashboard's map loads tiles from OpenFreeMap and Esri imagery, like any web map.
  The landing page loads nothing from other sites.
- **The example data.** [`examples/nyc-2026`](examples/nyc-2026) is a real Manhattan one-bedroom search, lightly anonymised: public
  listings, public records and open data. It contains no renter identity, income or documents. The saved picks and visit notes in the
  gallery are sample entries. Listing photos belong to their owners; Commons building photos carry their licence and author.
- **Sites' rules are respected.** Agents are told to use official APIs and open data, never to bypass a CAPTCHA or bot check, never
  to log in, and never to contact a landlord without your say-so. When a portal blocks automated reading, the agent stops and asks
  you to open the page yourself.
- **Sync is off until you turn it on.** It then sends your picks, notes, numbers, tour findings, floor plan work and (optionally)
  small copies of tour photos to **a secret gist in your own GitHub account** (unlisted, so anyone with its link can read it) or
  to a file you move by hand, and nowhere else: no server of ours, no telemetry. The GitHub token stays in the browser on the
  device and is sent only to `api.github.com`. See [the sync guide](docs/guides/sync.md).
- **Reports are not findings.** 311 calls, complaints and reviews are shown as reports. Commute, sun, money and score numbers are
  estimates, and coverage is of the listings you captured, not a market census. Check the important ones in person.
- **Publishing.** A Pages site, a standalone file or a workbook shows your listings and notes to whoever has it. Run
  `python scripts/release_check.py` first.

## FAQ

<details>
<summary><b>Does it work outside New York?</b></summary>

Yes. Any city OpenStreetMap knows gets the map, geocoding, walking times, 3D site models, sun and view, floor plans and ranking;
add a transit timetable (GTFS) for commutes by subway and bus. Building-records automation and the noise layer are New York only
for now. Elsewhere an agent researches records with the `building-dossier` skill. `apartmentscout city "Your City"` shows what your
city has, and [adding a city profile](docs/guides/new-city.md) is a short YAML file. You can also
[request or offer a city](https://github.com/0marm0/ApartmentScout/issues/new?template=new_city.yml).
</details>

<details>
<summary><b>Where does the data come from, and under what licences?</b></summary>

NYC Open Data, the US Census geocoder, OpenStreetMap (ODbL), MTA and other agencies' GTFS feeds, Esri imagery and Wikimedia
Commons photos, with MapLibre GL, three.js, d3-contour and the Geist fonts. Each keeps its own licence and attribution; they are
summarised in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Keep the map attribution visible on anything you publish and show the
credit line with every Commons photo. Listings are what you or your agent capture, within each source's terms.
</details>

<details>
<summary><b>Do I need an AI agent, an API key or an account?</b></summary>

No. Everything built in uses free public data and needs no key. You can run the CLI and the dashboard by hand, or use the wizard.
An agent (Claude Code, Codex, Cursor, anything that reads `AGENTS.md`) is optional: it does the sourcing and research legwork.
</details>

<details>
<summary><b>Does it work offline?</b></summary>

Once your data is built, yes: the CLI works on local files, and the hosted dashboard installs as an app that keeps its shell, data
and the 3D models you have opened in the browser's cache. Map tiles and photos you have not opened need a connection. A single-file
build (`apartmentscout build --standalone`) opens with no server at all. Details:
[the dashboard guide](docs/guides/dashboard.md#install-it-and-use-it-offline).
</details>

<details>
<summary><b>Does it work on a phone?</b></summary>

Yes. The layout follows the screen, Unit 3D has a phone layout, and Tour day is built for one hand. Add it to your Home Screen to
use it offline: see the [iPhone guide](docs/guides/iphone.md) (Android: Chrome's *Install app* in the dashboard's Help menu).
</details>

<details>
<summary><b>Can it contact landlords or apply for me?</b></summary>

No. It drafts questions and emails for you to copy; nothing is sent from the page or by an agent unless you explicitly ask it to.
</details>

<details>
<summary><b>How accurate are the sun, view and commute numbers?</b></summary>

They are models, and the [methodology](docs/guides/methodology.md) says what each one leaves out (trees are context and never count
as shade; heights default where OpenStreetMap has none; a commute is a timetable estimate, not a live route). Unknowns stay
unknown and are listed so you know what to ask or check on a visit.
</details>

## Documentation

| | |
|---|---|
| Start | [Getting started](docs/guides/getting-started.md) · [The dashboard](docs/guides/dashboard.md) · [iPhone guide](docs/guides/iphone.md) · [Sync between devices](docs/guides/sync.md) · [Other cities](docs/guides/new-city.md) |
| How it is computed | [Methodology](docs/guides/methodology.md) · [Data model](docs/guides/data-model.md) · [Research quality](docs/guides/research-quality.md) · [Leasing-office questions](docs/guides/leasing-office-questions.md) |
| 3D and photos | [Floor plans](docs/guides/floor-plans.md) · [Photos](docs/guides/photos.md) · [Gallery](docs/GALLERY.md) |
| Agents | [AGENTS.md](AGENTS.md) · [Skills](.claude/skills) · [Agent handoff](docs/guides/agents-handoff.md) · [Monitoring](docs/guides/monitoring.md) · [Alerts on your phone](docs/guides/alerts.md) |
| Project | [Roadmap](docs/ROADMAP.md) · [Release checklist](docs/RELEASE_CHECKLIST.md) · [Design system](docs/design/design-system.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) |

The worked example, [`examples/nyc-2026`](examples/nyc-2026), has 738 listings, commutes on the MTA timetables, a 311 noise layer,
30 building dossiers, 16 3D site models and 9 floor plans. Its photos are in two sets (a 34 MB starter set in the repository, the
full set on demand): see [photos](docs/guides/photos.md). The site, with the demo at `/demo/`, is published by
`.github/workflows/pages.yml` on every push to `main`.

## Contributing

Issues and pull requests are welcome, especially city profiles, records modules, GTFS feed lists and better floor-plan tooling.
Start with [CONTRIBUTING.md](CONTRIBUTING.md) (set-up and tests), use the [issue forms](https://github.com/0marm0/ApartmentScout/issues/new/choose)
for a bug, a feature or a new city, and follow the [code of conduct](CODE_OF_CONDUCT.md). Before you open a pull request:

```bash
pip install -e ".[dev]"
python scripts/test_changed.py         # runs the unit, JavaScript and browser tests your change touches
```

To report a security problem privately, see [SECURITY.md](SECURITY.md). If you use the project in research, [CITATION.cff](CITATION.cff)
has a citation.

## Licence

MIT, see [LICENSE](LICENSE). Data from the sources above remains under its own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
