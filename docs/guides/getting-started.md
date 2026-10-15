# From zero to your first ranked map in 15 minutes

This is the whole path for a new renter in any city, New York or not: install, name your city, add homes, time the
commutes, fetch the buildings around each home, add floor plans, and open the dashboard. Every command below is run by
`tests/test_docs_quickstart.py` against a made-up city with the network faked, so what you read here is what runs.

| Step | What you do | Time |
|---|---|---|
| [1. Install](#1-install) | one command | 2 min |
| [2. Look at the example](#2-look-at-the-example-optional) | optional | 1 min |
| [3. Start your search and name your city](#3-start-your-search-and-name-your-city) | answer the questions | 3 min |
| [4. Add homes](#4-add-homes) | a spreadsheet or your agent | 3 min |
| [5. Place the homes and time the commutes](#5-place-the-homes-and-time-the-commutes) | two commands | 2 min |
| [6. Getting the buildings around each home](#6-getting-the-buildings-around-each-home) | one command | 1 min per home, once |
| [7. Adding your floor plans](#7-adding-your-floor-plans) | trace an image or PDF | 5 min per plan |
| [8. Rank, build and look](#8-rank-build-and-look) | two commands | 1 min |
| [9. Go deeper, take it with you](#9-go-deeper-take-it-with-you) | when you have finalists | |

## 1. Install

```bash
git clone https://github.com/<you>/ApartmentScout.git
cd ApartmentScout
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e .                                      # ".[xlsx]" adds the workbook export, ".[dev]" the test tools
```

Python 3.10 or newer. Install with `-e` (editable): the city profiles and the questionnaire live in `config/` in the
checkout and the tools read them from there. No API keys are needed for anything built in.

## 2. Look at the example (optional)

```bash
apartmentscout serve --search examples/nyc-2026
```

Your browser opens the dashboard on a finished search: 732 Manhattan listings with walk, subway, bus and best-of-transit
commutes, a 311 noise layer, building dossiers, 3D site models and a floor plan with furniture. Press `?` for the keyboard
shortcuts and `1` to `8` to move between views ([dashboard guide](dashboard.md)). The example is read-only.

## 3. Start your search and name your city

You will be asked, in this order, for the city, the places you travel to, the transit timetable for the commute, your
budget, the home you want and what matters most. Pick whichever way you like; all three ask the same questions
([`config/intake.yaml`](../../config/intake.yaml)) and write the same `criteria.yaml`.

<!-- quickstart -->
```bash
apartmentscout init searches/my-search --city "Chicago, IL" --interactive
export APARTMENTSCOUT_SEARCH=searches/my-search       # or pass --search searches/my-search to every command
apartmentscout criteria --check searches/my-search/criteria.yaml
```

- **In the terminal** (above). `--city` is any city name; without it the first question asks. Enter accepts the value in
  brackets. Leave `--interactive` off to get the commented template and edit it by hand.
- **In the dashboard.** `apartmentscout serve`, then the search switcher in the top bar, *New search* (or `?new=1`). The
  wizard has the same steps, looks the city and your addresses up for you, and ends in a review that lists what happens next.
- **With your agent.** Open the repo in Claude Code, Cowork, Codex or Cursor and say "help me find a one-bedroom near X under
  $Y". It reads [`AGENTS.md`](../../AGENTS.md) and the `apartment-search` skill and asks the same questions.

**What the city question does.** A city is looked up on OpenStreetMap by name, which gives the search its id, its time zone
(sun hours and arrive-by times use it) and where the map opens. New York has a *profile* in `config/cities/nyc.yaml` that
also switches on NYC Open Data. Every other city runs on OpenStreetMap and the generic modules:

| | New York (profile) | Any other city |
|---|---|---|
| Geocoding | NYC GeoSearch (also BBL and BIN) | US Census, then OpenStreetMap |
| Transit feeds | the three MTA feeds, added for you | you add your agency's GTFS zip (below) |
| Buildings and heights for 3D, sun and view | NYC Building Footprints and PLUTO | OpenStreetMap (heights from tags, otherwise a default) |
| Streets, parks, trees, water | NYC Open Data and OpenStreetMap | OpenStreetMap |
| Building records, violations, 311 noise layer, filed new buildings | built in (`dossier`, `layers`) | not built in: the `building-dossier` skill shows where to look |
| "In <neighbourhood>" place filters | built in | streets and parks work; neighbourhoods need a dataset in a profile ([new-city](new-city.md)) |

**Places.** Each destination (work, a partner's office, a gym) takes an address. The terminal and the wizard look it up and
ask you to confirm; the wizard can also drop a pin on the map. Coordinates are saved in `criteria.yaml`.

**The transit timetable.** Commutes by subway, bus, rail and ferry come from your agency's published timetable, a *GTFS* zip.
For cities we have checked, the interview offers it (for example Boston, Chicago, San Francisco, Seattle, Portland, Los
Angeles, Denver, Minneapolis; the list is `config/transit-feeds.yaml`). For any other city, find your agency's feed at the
[Mobility Database](https://mobilitydatabase.org/feeds), [Transitland](https://www.transit.land/operators) or the agency's
"developers" or "open data" page, then add it, any time:

<!-- quickstart -->
```bash
apartmentscout city --starter                          # the starter feed(s) listed for your city, if any
apartmentscout city --feed https://example.com/gtfs.zip --name "City Metro"   # or your own: checked before it is written
```

With no feed, commute times are **walking only** and `commute` says so. `apartmentscout city` with no arguments shows the
city, time zone, map centre, feeds, and what your city does and does not have built in.

## 4. Add homes

Fill the `listings.template.csv` that `init` wrote into your search folder: one row per unit, with the full street address
(number, street, city, state): everything after this keys off it. Save it as `listings.csv` beside it, or ask your agent to
find and capture listings (the `listing-sourcing` skill; it never logs in or bypasses bot checks).

<!-- quickstart -->
```bash
apartmentscout import searches/my-search/listings.csv
apartmentscout validate && apartmentscout lint        # schema, ranges, duplicates, URLs; then the listing traps
```

The schema is in [data model](data-model.md). Leave out what you do not know: unknown is a value, and the scorer says how
much of each ranking rests on gaps.

## 5. Place the homes and time the commutes

<!-- quickstart -->
```bash
apartmentscout geocode                                 # coordinates for every home and destination
apartmentscout commute                                 # door-to-door minutes by walking, subway, bus, rail, ferry and best of transit
```

`geocode` saves your destinations' coordinates into `criteria.yaml` (the old file goes to `backups/`) and lists any home it
could not find: write that address as "number street, city, state" or set its `lat` and `lon` in `listings.json`, then run it
again. `commute` downloads each feed once (a big city's bus network is tens of MB, cached under `<search>/cache/gtfs/`), then
routes every destination and writes the heat maps. Check three or four homes against a live trip planner before you trust
them: it is a timetable estimate, see [methodology](methodology.md).

For more accurate walking, set `commute.transit.walk_model: network` (walk the OpenStreetMap street network to the station's
real entrances; `station_entrances: osm`). The first run downloads the street network for the area and takes a few minutes; if the shared OpenStreetMap server is busy it says so and uses the straight-line metric instead.

## 6. Getting the buildings around each home

The 3D view, the direct-sun hours, the sky view and the window's skyline all need to know what stands around the home. That
is a *site model*: the footprints and heights of the buildings within about 600 m, plus streets, parks, trees and water.

<!-- quickstart -->
```bash
apartmentscout surroundings                            # the shortlist (else the top 5): fetch and build each home's site model
apartmentscout surroundings --status                   # what is covered and how good it is; fetches nothing
```

**What it fetches.** Everywhere: buildings, heights, streets, parks, trees and water from OpenStreetMap (through the public
Overpass service; downloads are cached under `<search>/cache/site/`). In a city with a profile it adds the city's own open
data (New York: Building Footprints with roof heights, PLUTO floors, the street tree census, Parks trees and filed new
buildings). Default is the shortlist; `--all` does every open listing, or name homes: `apartmentscout surroundings ID [ID ...]`.
It takes about a minute per home the first time, keeps going if one fails (Overpass is shared and is sometimes busy: run it
again), and skips homes that already have a model (`--rebuild ID` redoes one, `--refresh` downloads everything again).

**The status tells you what is missing.** For each home it reports how many of the surrounding buildings had to use a
**default height** (10 m) because OpenStreetMap has no `height` or `building:levels` for them, and how many of those are within
150 m, where they decide the sun and the view. It also names the building each home was **matched to** and how far that is
from the address point. Read it like this:

- *Many defaults close by.* Sun hours and the view there are estimates: a tall neighbour may be drawn too low. Add `height`
  or `building:levels` to those buildings on openstreetmap.org, then `apartmentscout surroundings --refresh ID`; or describe the
  few that matter in `sites/<id>.components.yaml`.
- *Matched by "nearest", more than about 25 m from the address.* The model may have picked the building next door. Open the
  Unit 3D tab; if the highlighted building is wrong, set the listing's `lat` and `lon` to a point inside the right building
  in `listings.json` and run `apartmentscout surroundings --rebuild ID`.
- *A note that something is not available for your city.* Without a profile there are no filed new buildings and no
  "expected sun with typical cloud" (the model shows possible direct sun); buildings, streets, parks, trees and water are
  all there.

Then `apartmentscout build` (or step 8) and open the **Unit 3D** tab. To study one home by hand (a bay window, a measured
floor height, a given facade bearing), see `apartmentscout site --help` and the `unit-light-and-view` skill.

## 7. Adding your floor plans

A floor plan turns a listing's drawing into a 2D plan and a 3D apartment in the **Floor plan** tab, with the real sun coming
through its windows (blocked by the buildings from step 6), furniture at true size with fit checks, and the view from inside
(Unit 3D's *Inside* view). Plans are optional and per home. Three ways to add one:

1. **Trace an image or a PDF in the dashboard** (best when you have the listing's plan). Run `apartmentscout serve`, open the
   **Floor plan** tab, choose **New plan from image**, and follow the steps. Everything happens in your browser: the image or PDF
   is read locally and never uploaded.
   1. *Image.* Choose a PNG, JPEG, WebP or PDF (pick the page). Choose feet or metres first.
   2. *Scale.* Click both ends of a printed dimension line (an overall width is best) and type its length (`14'6"`, `4.42 m`).
      A second dimension at right angles checks the scale; up to 1.5% off is high confidence.
   3. *North.* Click the plan's north arrow, or an outside wall and the way it faces, or type the bearing of the top of the page.
   4. *Rooms, doors and windows, fixtures.* Click each corner (or drag a rectangle), then click on walls for doors and windows.
   5. *Details.* Set **For listing** to the home so the studio and Unit 3D attach the plan to it.
   6. *Save.* **Save to the search folder** writes `plans/<listing-id>.json` in your search (served pages only). **Save and open
      in the studio** keeps it in this browser only; **Download plan JSON** gives you the file.
2. **Give your agent the plan.** The `floor-plan-model` skill reads an image or PDF, or just the room sizes in the listing text
   ("living room 14'6" x 12'"), and writes `plans/<listing-id>.json`. Say what was printed and what was guessed.
3. **Add a plan file you already have.** `apartmentscout plans add the-plan.json --id <listing-id>` checks it and copies it in.

<!-- quickstart -->
```bash
apartmentscout plans                                   # which homes have a plan, and these three ways in
apartmentscout plans add the-plan.json --id <listing-id>   # a plan JSON from the tracer's Download, or from your agent
```

**Where the files go.** `searches/my-search/plans/<listing-id>.json`, one per home; the id must be the listing's id. A plan
whose id matches no listing opens in the studio but Unit 3D and the sun cannot attach it, and `apartmentscout plans` lists
it. After adding a file by hand run `apartmentscout build` (the dashboard picks up plans saved from the page on reload).
Never put the listing's image, a broker's logo or contact details in the repository. Format, units and the checks:
[floor plans](floor-plans.md).

## 8. Rank, build and look

<!-- quickstart -->
```bash
apartmentscout all                                     # geocode, commute, layers, places, score, build
apartmentscout coverage                                # what is still unknown for each finalist, and what it could swing
apartmentscout serve                                   # open the dashboard on your own data
```

`all` repeats steps 5 and the places geometry (street and park names for plain-language search such as "east of Main
Street"), scores every listing on your criteria and writes the dashboard data into your search's own ignored cache
(`<search>/cache/dashboard-data/`), the folder `serve` uses; nothing from a private search is written into the repo's
committed demo data. Map, Shortlist, Compare, Unit 3D, Floor plan, Research: see the [dashboard guide](dashboard.md).

## 9. Go deeper, take it with you

For each shortlisted home, in this order (the skills in [`.claude/skills/`](../../.claude/skills) walk an agent through each):

```bash
apartmentscout dossier                                 # NYC: public building records for the shortlist (elsewhere: the building-dossier skill)
apartmentscout photos                                  # licensed building photos from Wikimedia Commons, with credits
apartmentscout report                                  # shortlist.md
```

Then lease terms and fees, a noise check, a tour, a decision memo ([tour-and-decide](../../.claude/skills/tour-and-decide/SKILL.md)).
To take the search with you:

```bash
apartmentscout export --xlsx my-search.xlsx            # workbook: edit the weights, scores and ranks recalculate
apartmentscout handoff pack out.zip --to codex         # hand the search to another agent
apartmentscout build --standalone my-search.html       # the whole dashboard in one file (uses the bundle in dashboard/dist; after editing dashboard/js run scripts/bundle.sh, which needs Node.js)
```

The standalone file embeds your data, so share it only with people who should see your listings and notes. To host the
dashboard publicly see [dashboard](dashboard.md), and run `python scripts/release_check.py` first. More:
[research quality](research-quality.md), [photos](photos.md), [floor plans](floor-plans.md),
[agent handoff](agents-handoff.md), [adding a city profile](new-city.md).

## When something goes wrong

| You see | Why | Do |
|---|---|---|
| `commute` says "WALKING times only" | no transit feed in `criteria.yaml` | `apartmentscout city --starter`, or `--feed URL` ([step 3](#3-start-your-search-and-name-your-city)) |
| `commute: ... has no lat/lon` | a destination was never geocoded | `apartmentscout geocode` (it saves them now) |
| `feed ...: could not download` | the agency moved its feed | find the current GTFS link; `apartmentscout city --feed URL`; or put the zip on disk and give `path:` |
| `commute: Feed ... has no service on <date>` | `service_date` is outside the feed's calendar | set `commute.transit.service_date` to a weekday inside the range it prints, or delete the line |
| geocode: "no match" | the address is not findable | "number street, city, state", or set `lat`/`lon` in `listings.json` |
| `surroundings`: "Overpass servers are busy" | the shared OpenStreetMap server is overloaded | wait a few minutes and run it again; finished homes are kept |
| Unit 3D has no home / says nothing for it | no site model yet | `apartmentscout surroundings ID` |
| `criteria --check` warns about the time zone or map centre | New York defaults left in another city | `apartmentscout city "<your city>"` |
| `build --standalone` says the bundle is missing | the single-file build embeds the bundle in `dashboard/dist` | `scripts/bundle.sh` (needs Node.js) |
