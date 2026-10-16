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

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-commute-map.png"><img src="docs/images/find-commute-map.png" alt="Door-to-door commute bands over Manhattan beside the ranked cards"></a><br><sub><b>Every listing, ranked, on a door-to-door commute map</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-walk-window.png"><img src="docs/images/inside-walk-window.png" alt="Standing at the living-room window on the 25th floor, looking out over neighbouring towers, a park and the river"></a><br><sub><b>Stand at the window of the exact unit</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-skyline-dusk.png"><img src="docs/images/inside-skyline-dusk.png" alt="The Midtown skyline at dusk from Unit 3D"></a><br><sub><b>The real city around it, at any hour</b></sub></td>
</tr>
</table>

ApartmentScout came out of a real search for a one-bedroom in Manhattan: 738 listings in 260 buildings, and the same questions
for every finalist. What does it cost a month once fees and free months are counted? How long is the trip door to door? What do
the city's records say about the building? How loud is the street, and will the window see the sky or a wall? This repository
turns that process into agent playbooks, a Python command line and a dashboard you own, for any city, with that search included
as a worked example.

**Jump to:** [Find](#find) · [See inside](#see-inside) · [Sun and light](#sun-and-light) · [The city in 3D](#the-city-in-3d) · [Floor-plan studio](#floor-plan-studio) · [Compare](#compare) · [Decide](#decide) · [Set up](#set-up) · [On a phone](#on-a-phone). Every screen is from the worked example; click a picture for full size, and the [gallery](docs/GALLERY.md) has a caption for each.

## Find

Every listing ranked on your weights and its true monthly cost, on a door-to-door commute map; plain-words search, hover previews, and a reason for every rank. [More about each picture](docs/GALLERY.md#find).

<table>
<tr>
<td colspan="3" valign="top" align="center"><a href="docs/images/hero-map.png"><img src="docs/images/hero-map.png" alt="The map with ranked cards on the left and Paramount Tower 25E open in the drawer"></a><br><sub><b>The map, the ranked list and a home</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-place-search.png"><img src="docs/images/find-place-search.png" alt="The command menu previewing a plain-words search"></a><br><sub><b>Ask in plain words</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-building-pin.png"><img src="docs/images/find-building-pin.png" alt="Hovering a building pin: View 34, 17 units from $4,310, with its best three units"></a><br><sub><b>A building is one pin</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-pin-preview.png"><img src="docs/images/find-pin-preview.png" alt="Hovering a pin previews the home with its photo, rank, price and score"></a><br><sub><b>Hover a pin, see the home</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-route-preview.png"><img src="docs/images/find-route-preview.png" alt="Hovering a home draws its subway route to Grand Central"></a><br><sub><b>Hover a card, see the trip</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-rank-moves.png"><img src="docs/images/find-rank-moves.png" alt="A drawer explaining why The Knox 6B fell 40 places since Oct 13"></a><br><sub><b>Why a home moved</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-unknowns.png"><img src="docs/images/find-unknowns.png" alt="Unknowns that move this score: an 800 square-foot size typed in shows the score and rank the home would get"></a><br><sub><b>Unknowns that move this score</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-price-audit.png"><img src="docs/images/find-price-audit.png" alt="A listing's money section: monthly cost, every month and at signing, marked price unverified"></a><br><sub><b>What it costs, and is the price real?</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-price-drops.png"><img src="docs/images/find-price-drops.png" alt="Homes whose price fell, with the size of each drop"></a><br><sub><b>Real price history</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-drawer-commute.png"><img src="docs/images/find-drawer-commute.png" alt="The drawer's commute section: 10 minutes by every mode, by time of day, then direct sun by month and noise by hour"></a><br><sub><b>Commute, sun and noise for one home</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/find-lightbox.png"><img src="docs/images/find-lightbox.png" alt="The photo lightbox beside the listing's floor plan"></a><br><sub><b>Photos and the floor plan</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-map-clusters.png"><img src="docs/images/find-map-clusters.png" alt="The map zoomed out: homes merged into bubbles that count them and show the lowest monthly cost"></a><br><sub><b>A calmer map</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/find-light-theme.png"><img src="docs/images/find-light-theme.png" alt="The map in the light theme with a listing open"></a><br><sub><b>The light theme</b></sub></td>
</tr>
</table>

## See inside

Unit 3D puts you in the exact unit with the furniture you own and the real city through the glass: walk to the window, measure, test what fits. [More about each picture](docs/GALLERY.md#see-inside).

<table>
<tr>
<td colspan="3" valign="top" align="center"><a href="docs/images/inside-unit-3d.png"><img src="docs/images/inside-unit-3d.png" alt="Unit 3D opening inside Paramount Tower 25E: the desk, monitor and office chair by the bay window, the futon in the corner"></a><br><sub><b>Unit 3D lands inside the apartment</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-furniture.png"><img src="docs/images/inside-furniture.png" alt="Looking down the living room: a black leather futon, a wall-mounted TV, a coffee table and a dining table on a basket-weave parquet floor"></a><br><sub><b>Your own furniture</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-bay.png"><img src="docs/images/inside-bay.png" alt="Inside the bedroom corner, looking out of the angled windows at towers, a park and the river"></a><br><sub><b>Through the angled windows</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-bedroom.png"><img src="docs/images/inside-bedroom.png" alt="In the bedroom: the corner window with the sun on the floor, a black chest with a TV on the wall"></a><br><sub><b>The bedroom</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-night-window.png"><img src="docs/images/inside-night-window.png" alt="Standing at the window at night: lit windows in the towers, street lamps along the river road"></a><br><sub><b>The night city</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-measure-tape.png"><img src="docs/images/inside-measure-tape.png" alt="The measuring tape reading 5 feet 2 inches across the bay window"></a><br><sub><b>The measuring tape</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/inside-fits.png"><img src="docs/images/inside-fits.png" alt="Does it fit? A bookshelf dropped into the living room with the space around it on each side"></a><br><sub><b>Does it fit?</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-match-photo.png"><img src="docs/images/inside-match-photo.png" alt="Match a photo: a listing photo laid over the 3D view while a landmark is marked"></a><br><sub><b>Match a photo</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-measured-chip.png"><img src="docs/images/inside-measured-chip.png" alt="The measured vs assumed chip opened over the desk and office chair"></a><br><sub><b>Measured, sourced or assumed</b></sub></td>
</tr>
</table>

## Sun and light

When the sun reaches the window, on which floor and in which season, and what stands in its way, from real building footprints and heights. [More about each picture](docs/GALLERY.md#sun-and-light).

<table>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/sun-low-floor.png"><img src="docs/images/sun-low-floor.png" alt="The view from floor 8 of Paramount Tower at 8:30 am on March 20: a neighbouring building fills the window, which is in shadow"></a><br><sub><b>Floor 8: in shadow</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/sun-high-floor.png"><img src="docs/images/sun-high-floor.png" alt="The view from floor 25 at the same moment: direct sun over the low roofs, towers, a park and the river"></a><br><sub><b>Floor 25, same moment: direct sun</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/sun-winter-shadows.png"><img src="docs/images/sun-winter-shadows.png" alt="The block around Paramount Tower at noon on December 21 with long winter shadows"></a><br><sub><b>December 21, noon</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/sun-summer-shadows.png"><img src="docs/images/sun-summer-shadows.png" alt="The same block at noon on June 21 with short summer shadows and trees in leaf"></a><br><sub><b>June 21, noon</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/sun-path-chart.png"><img src="docs/images/sun-path-chart.png" alt="A chart of the sun's path on December 21, March 20 and June 21 against the skyline seen from the 25E window"></a><br><sub><b>Sun path against the skyline</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-sun-by-floor.png"><img src="docs/images/inside-sun-by-floor.png" alt="Direct sun hours by floor and month for a facade"></a><br><sub><b>Sun by floor and month</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/sun-plan-view.png"><img src="docs/images/sun-plan-view.png" alt="The street plan from straight above: neighbouring roofs, their shadows and the sun's line to the window"></a><br><sub><b>From above: what stands in the way</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-play-year.png"><img src="docs/images/inside-play-year.png" alt="The Inside view with the Play day and Play year bar at December 28, with bare branches"></a><br><sub><b>Play the day, play the year</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-orbit-day.png"><img src="docs/images/inside-orbit-day.png" alt="Unit 3D by day: the tower among its neighbours with the window marked"></a><br><sub><b>By day</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-orbit-night.png"><img src="docs/images/inside-orbit-night.png" alt="Unit 3D at night with lit windows across the neighbourhood"></a><br><sub><b>And at night</b></sub></td>
</tr>
</table>

## The city in 3D

Every building around the home with its height, the skyline, the water, the parks and the towers still to come. [More about each picture](docs/GALLERY.md#the-city-in-3d).

<table>
<tr>
<td colspan="3" valign="top" align="center"><a href="docs/images/city-building-models.png"><img src="docs/images/city-building-models.png" alt="Buildings coloured by height class with roof heights labelled around Paramount Tower"></a><br><sub><b>Every building around the tower, with its height</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/city-map-3d.png"><img src="docs/images/city-map-3d.png" alt="The commute map tilted with extruded 3D buildings, price tags and subway lines"></a><br><sub><b>The map in 3D</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-river.png"><img src="docs/images/inside-river.png" alt="The Hudson River and piers in Unit 3D at sunset"></a><br><sub><b>Water and permitted towers</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-park-trees.png"><img src="docs/images/inside-park-trees.png" alt="A park drawn as grass and trees in Unit 3D"></a><br><sub><b>Parks and trees</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-light-theme.png"><img src="docs/images/inside-light-theme.png" alt="Unit 3D in the light theme on a June evening"></a><br><sub><b>The light theme</b></sub></td>
</tr>
</table>

## Floor-plan studio

The plan in 2D and 3D side by side: furniture at real sizes, clearances, sunlight on the floor, and new plans traced from a listing image. [More about each picture](docs/GALLERY.md#floor-plan-studio).

<table>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/inside-floor-plan.png"><img src="docs/images/inside-floor-plan.png" alt="The floor plan studio with the 2D plan and the furnished 3D room side by side"></a><br><sub><b>Bird's eye beside the plan</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/studio-top.png"><img src="docs/images/studio-top.png" alt="The studio's Top camera beside the 2D plan with every room's dimensions and the walkway clearances"></a><br><sub><b>Top down, with every dimension</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/studio-light.png"><img src="docs/images/studio-light.png" alt="The studio's 3D room on December 21 at 10 am with sunlight on the floor and the Light tab open"></a><br><sub><b>The light tab</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/studio-tracer.png"><img src="docs/images/studio-tracer.png" alt="New plan from image: a listing floor plan loaded for tracing, with the eight steps across the top"></a><br><sub><b>Trace a plan from an image</b></sub></td>
</tr>
</table>

## Compare

Finalists row by row, two units side by side in 3D, and a pad to trade cost against commute and space. [More about each picture](docs/GALLERY.md#compare).

<table>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/compare-four.png"><img src="docs/images/compare-four.png" alt="Four finalists compared in lettered columns"></a><br><sub><b>Four finalists, row by row</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/compare-side-by-side-3d.png"><img src="docs/images/compare-side-by-side-3d.png" alt="Two homes in the same tower side by side in 3D"></a><br><sub><b>Two units side by side in 3D</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/compare-tradeoff-pad.png"><img src="docs/images/compare-tradeoff-pad.png" alt="The trade-off pad previewing a weight preset"></a><br><sub><b>The trade-off pad</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/compare-split-view.png"><img src="docs/images/compare-split-view.png" alt="The shortlist table beside a docked map"></a><br><sub><b>The shortlist beside its map</b></sub></td>
</tr>
</table>

## Decide

Building records, questions for the leasing office, visit notes, tours, a share page and a decision memo. [More about each picture](docs/GALLERY.md#decide).

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-records.png"><img src="docs/images/decide-records.png" alt="A building's public records report"></a><br><sub><b>Building records</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-office-questions.png"><img src="docs/images/decide-office-questions.png" alt="Questions for the leasing office of The Knox"></a><br><sub><b>Questions for the leasing office</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-visit-history.png"><img src="docs/images/decide-visit-history.png" alt="Visit notes in the listing drawer"></a><br><sub><b>Visit notes and history</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-tours-board.png"><img src="docs/images/decide-tours-board.png" alt="The tours board: saved picks in S, A, B, C and Pass lanes with tour times and notes"></a><br><sub><b>The tours board</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-tour-planner.png"><img src="docs/images/decide-tour-planner.png" alt="The tour-day planner"></a><br><sub><b>The tour-day planner</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-memo.png"><img src="docs/images/decide-memo.png" alt="The decision memo"></a><br><sub><b>The decision memo</b></sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-share-page.png"><img src="docs/images/decide-share-page.png" alt="The read-only shortlist page"></a><br><sub><b>A page to send</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-research-queue.png"><img src="docs/images/decide-research-queue.png" alt="The research queue"></a><br><sub><b>What you still don't know</b></sub></td>
<td width="33%" valign="top" align="center"><a href="docs/images/decide-gone-fast.png"><img src="docs/images/decide-gone-fast.png" alt="Research, Gone fast: good units at your budget go in 5 days, a days-on-market chart and the units that went"></a><br><sub><b>What rented, and how fast</b></sub></td>
</tr>
</table>

## Set up

Any city: a wizard in the dashboard, an interview in the terminal, or your agent. [More about each picture](docs/GALLERY.md#set-up).

<table>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/setup-wizard-city.png"><img src="docs/images/setup-wizard-city.png" alt="The new search wizard, step 1"></a><br><sub><b>The new search wizard</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/setup-wizard-review.png"><img src="docs/images/setup-wizard-review.png" alt="The wizard's review step"></a><br><sub><b>Review the criteria.yaml</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><a href="docs/images/setup-menu.png"><img src="docs/images/setup-menu.png" alt="The one menu at the top right"></a><br><sub><b>One menu</b></sub></td>
<td width="50%" valign="top" align="center"><a href="docs/images/setup-cli.png"><img src="docs/images/setup-cli.png" alt="Command-line output"></a><br><sub><b>The command line</b></sub></td>
</tr>
</table>

## On a phone

Installs as an app: the map, a listing, Unit 3D, visit notes and a one-hand tour day. [More about each picture](docs/GALLERY.md#on-a-phone).

<table>
<tr>
<td width="16%" valign="top" align="center"><a href="docs/images/phone-map.png"><img src="docs/images/phone-map.png" alt="The map and ranked cards on a phone" width="150"></a><br><sub><b>Map and cards</b></sub></td>
<td width="16%" valign="top" align="center"><a href="docs/images/phone-drawer.png"><img src="docs/images/phone-drawer.png" alt="A listing drawer on a phone" width="150"></a><br><sub><b>A listing</b></sub></td>
<td width="16%" valign="top" align="center"><a href="docs/images/phone-unit-3d.png"><img src="docs/images/phone-unit-3d.png" alt="Unit 3D on a phone" width="150"></a><br><sub><b>Unit 3D</b></sub></td>
<td width="16%" valign="top" align="center"><a href="docs/images/phone-visit-notes.png"><img src="docs/images/phone-visit-notes.png" alt="Visit notes on a phone" width="150"></a><br><sub><b>Visit notes</b></sub></td>
<td width="16%" valign="top" align="center"><a href="docs/images/phone-tour-day.png"><img src="docs/images/phone-tour-day.png" alt="Tour day on a phone: three homes in time order" width="150"></a><br><sub><b>Tour day</b></sub></td>
<td width="16%" valign="top" align="center"><a href="docs/images/phone-tour-checklist.png"><img src="docs/images/phone-tour-checklist.png" alt="The Tour day checklist for one home" width="150"></a><br><sub><b>The checklist</b></sub></td>
</tr>
</table>

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
