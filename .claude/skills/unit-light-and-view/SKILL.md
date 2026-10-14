---
name: unit-light-and-view
description: Build the 3D site model for a unit, work out which way its windows face (including from listing photos and video), and report direct sun hours (possible and expected) by month and floor, the window's sky view and estimated daylight, the skyline the window faces and which landmarks are visible. Use when comparing floors or exposures or checking what a unit's view and light really are.
---

# Unit light and view

## 1. Establish floor and exposure

- Floor: from the listing, the plan or the unit number (`1211` -> floor 12; the importer guesses
  and marks `floor_inferred`).
- Exposure: listing text, the floor plan's compass, or the building's plan with the unit line
  marked. If none exist, use photos or video: identify landmarks visible through the windows
  (named towers in `config/cities/<city>.yaml`), measure their bearing from the building with
  the site model, and infer the facade. State your confidence and the landmarks used.
- Photos of green or water: when a photo or video from inside shows a park, tree canopy or the river,
  the site model's `green` block (OpenStreetMap parks and trees, fetched by `apartmentscout site`) and
  `apartmentscout.geo.sightline.compare_facades` say which facade can see it: for every facade at the
  unit's eye height it lists the parks in a 90 degree view, where in the frame they sit (left or right
  of centre, how far below the horizon), what is hidden by neighbours and which tall buildings stand at
  the frame's edges. Put the label in `exposure_basis` (e.g. `renter photos + park sightline`) and the
  facades tested in `exposure_evidence`; the site build then keeps the comparison in `sightline`. Check
  the plan's window layout against it (which wall has the bay, which way the corner window wraps), and
  keep the confidence honest: OSM maps few trees, terrain is flat in the model and facade colour is not
  in the data.
- Record where each came from on the listing, so the model and the dashboard can say so:
  `exposure_source` and `window_position_source` (`listing`, `plan`, `agent`, `photo-landmarks`,
  `model`, `assumed`) and `floor_inferred`. They end up in the site file's `provenance`.
- Video and photos of the same line on another floor show the same direction but a different
  view; the model tells you how much a lower floor loses. Photos named for another unit number
  (`..._1525.jpg` on a listing for 1211) are representative, not this unit.
- "Faces south" (the compass aspect of the main pane) is not "what it faces": a south window may
  look into a court, a wing or a gap, and bay panes face other bearings. Settle it with a
  north-oriented plan with the unit line marked, a window-to-street video, or a phone compass
  reading at the flat pane.
- Bay or angled windows: set `bay: true` (a 45 degree bay) or `window_panes: [-30, 0, 30]` on the
  listing, or pass `--bay` / `--panes`. Hours become the union over panes, with each pane's own
  hours in `study.sun_hours_panes`.
- Aliases: when the same unit is advertised under two labels (13C and 13CA) and the leasing office
  confirms it, add `unit_aliases: ["13CA"]` to one listing. Never merge on the letters alone, and a
  plan drawn for floors 7-36 says nothing about floor 4.
- Landmark matching: compare candidate towers with dated photos (upload date is not recording
  date), treat a landmark's absence from a cropped frame as weak evidence, and keep city roof
  heights and architects' heights apart (they differ by tens of feet).

## 2. Build the model

```bash
apartmentscout site <id> --floor 12 --charts          # exposure taken from listing.exposure
apartmentscout site <id> --floor 12 --bearing 209     # or give the facade bearing
apartmentscout site <id> --position 0.25              # window a quarter of the way along the facade
apartmentscout site <id> --bay                        # 45 degree bay (or --panes -30,0,30)
apartmentscout site <id> --slab-height 34.5           # floor's slab is 34.5 m above the street
apartmentscout site <id> --samples --neighbours       # CSVs: who shades the window, every building in 300 m
apartmentscout site <id> --no-components              # every building one prism (skip OSM building parts)
apartmentscout score && apartmentscout build          # then the Unit 3D tab
```

This fetches building footprints and heights (NYC: city footprints, PLUTO for missing heights;
elsewhere: OpenStreetMap), OpenStreetMap `building:part` outlines that split footprints into
podium / tower / setback components, street centrelines, and in NYC new buildings filed with DOB
nearby. It writes `sites/<id>.json` (format in `docs/guides/data-model.md`) and adds `site.sun_hours`
(possible direct sun hours per day on the 15th of each month), `site.sun_hours_range`,
`skyline_ahead_deg`, `open_sky_share`, `sky_view`, `daylight_factor_est`, `sun_year` and (NYC)
`sun_hours_expected` to the listing. Downloads are cached in `cache/site/`; `--refresh` fetches again,
`--no-streets` and `--no-future` skip those layers. With `--charts` it saves a sun-path chart, a
floor-by-month table and a monthly range chart in `research/charts/`.

The run prints how the building was matched (BIN, tax lot, point or nearest), the storey height
used and where it came from, the main blockers and the floor from which the view ahead clears the
nearby roofs, then the self-checks.

Check the run's output before reporting:

- **Self-checks** (`checks` in the site file). Any `fail` means a number is probably wrong: fix the
  input before reporting. `origin` warns when the address point is far from the matched building
  (fine when matched by BIN; otherwise check the building), `outside` fails when the window sits
  on a party wall, `heights` warns when guessed heights dominate the view, `storey` when roof /
  floors was implausible, `limits` when a download was cut off.
- **Storey height.** `floor_height_src` is `pluto` (roof / floors), `manual` or `default`. If the
  plan, a section or the listing gives the floor's height above the street, rerun with
  `--slab-height`; it changes every eye height and the hours.

- **Party walls.** Facades built against a neighbour are listed as party walls and never used for
  the window. If the listing's exposure only matches a party wall, no window is chosen: the listing
  or the geocode is probably wrong (wrong building, or the unit is on another wing). Do not force it
  with `--bearing` unless a plan shows windows there.
- **Heights.** Look at `bmeta[i].height_src` for the buildings that block the window (the dashboard
  shows it on click; `study.blockers` names them). `default` means nothing was known: find the real
  height (city 3D data, listing of the building, floors x 3.2 m) before trusting the hours.
  `geom_src: manual` outlines were drawn by hand and `edited` years before the building opened
  mean the footprint may be stale; `fcode` 5100 is a building under construction.
- **Light courts.** If the unit faces an interior court, the court is modelled as open air with
  walls (`holes`); say so, and expect little direct sun below the court's roof line.
- **Components.** The run prints how many buildings were split into podium / tower / setback parts
  from OpenStreetMap and how many were left whole (parts covering less than 90 % of the footprint,
  or tops that disagree with the measured roof). When a main blocker (`study.blockers`) is a stepped
  tower still drawn as one prism, its shade is overstated: if a zoning diagram, section or measured
  photo gives its setbacks, write `sites/<id>.components.yaml` (format in the data-model guide; every
  component needs a `source`) and rerun. Do the same for the unit's own building when the window is
  on a setback; a `window-component` warning means the window sits where the facade steps back.

## 3. Read and report

In the dashboard's Unit 3D tab: switch to "From the window", step through times of day, compare
floors with the compare slider, and check the floor-by-month table. Report:

- Direct sun hours on the move-in date, in December and in June, for this floor and one or two
  alternatives in the same line, **with the range** (`study.sun_hours_range`): "2 h 10 m in
  December, 1 h 30 m to 3 h depending on where the window sits and two floors either way". If the
  range is wide, the window position matters more than the floor: ask for the plan.
- Possible and expected sun: `sun_hours` are clear-sky hours; `sun_hours_expected` (NYC) scales them
  by the month's sunshine share (NOAA Central Park normals), and `sun_year` gives both for the year.
  Say "about 790 of a possible 1,350 hours a year", not one number.
- Daylight: `sky_view` (share of an unobstructed window's overcast-sky light) and
  `daylight_factor_est` (an indicative daylight factor for an assumed room), per floor in
  `study.daylight_floors`. Use them to compare windows and floors ("floor 20 sees 55 % of the sky,
  floor 12 34 %"); never quote them as measured light or lux. The Floor plan studio's Light tab gives
  the estimate per room from the plan's own window sizes, with glazing and blinds as a preview.
- What fills the view: nearest wall straight ahead (distance, height and address), open sky share,
  which landmarks show (whole tower or just the top), and which street the window faces.
- Who shades the window and when: the top `study.blockers` (name, distance, months), and for the
  move-in day the shaded slots from `research/<id>-sun-samples.csv`.
- Buildings coming: any `future` building in the view, its status (proposed, plans approved, work
  permit issued) and the sun hours with it in place (`study.sun_hours_future`). Over a 12 or 24
  month lease a permitted tower across the street matters.
- The floor at which the view clears the nearby roofs (`roofs.facing.clears_floor`, with each
  roof's height and distance in `roofs.facing.rows`), if the renter can choose a higher unit.
- Where the inputs came from (`provenance`): listing, plan, agent, photo landmarks or assumed.

## Limits to state every time

Buildings are prisms to roof height unless split into components (OpenStreetMap building parts or a
components file; say which blockers are which), with no crowns or trees; heights marked `default` or
`osm-levels` are estimates; the window position along the facade is an assumption unless the plan
shows it (hence the range); future buildings are drawn on their whole lot at the filed height,
which overstates their shadow, and filings change; party walls are inferred from footprints that
touch; direct sun is geometric (expected hours use monthly sunshine averages, not weather), and sky
view and the daylight factor are a relative overcast-sky estimate, not lux (Radiance would be the route
to real photometry; it is not run); bay panes share one skyline point and the bay's projection is not
modelled; the storey height is roof / floors unless set. Recommend checking at the same time of
day on a tour.
