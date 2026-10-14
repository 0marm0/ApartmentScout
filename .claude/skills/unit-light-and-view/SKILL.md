---
name: unit-light-and-view
description: Build the 3D site model for a unit, work out which way its windows face (including from listing photos and video), and report direct sun hours by month and floor, the skyline the window faces and which landmarks are visible. Use when comparing floors or exposures or checking what a unit's view and light really are.
---

# Unit light and view

## 1. Establish floor and exposure

- Floor: from the listing, the plan or the unit number (`1211` -> floor 12; the importer guesses
  and marks `floor_inferred`).
- Exposure: listing text, the floor plan's compass, or the building's plan with the unit line
  marked. If none exist, use photos or video: identify landmarks visible through the windows
  (named towers in `config/cities/<city>.yaml`), measure their bearing from the building with
  the site model, and infer the facade. State your confidence and the landmarks used.
- Record where each came from on the listing, so the model and the dashboard can say so:
  `exposure_source` and `window_position_source` (`listing`, `plan`, `agent`, `photo-landmarks`,
  `model`, `assumed`) and `floor_inferred`. They end up in the site file's `provenance`.
- Video and photos of the same line on another floor show the same direction but a different
  view; the model tells you how much a lower floor loses.

## 2. Build the model

```bash
apartmentscout site <id> --floor 12 --charts          # exposure taken from listing.exposure
apartmentscout site <id> --floor 12 --bearing 209     # or give the facade bearing
apartmentscout site <id> --position 0.25              # window a quarter of the way along the facade
apartmentscout score && apartmentscout build          # then the Unit 3D tab
```

This fetches building footprints and heights (NYC: city footprints, PLUTO for missing heights;
elsewhere: OpenStreetMap), street centrelines, and in NYC new buildings filed with DOB nearby. It
writes `sites/<id>.json` (format in `docs/guides/data-model.md`) and adds `site.sun_hours` (direct
sun hours per day on the 15th of each month), `site.sun_hours_range`, `skyline_ahead_deg` and
`open_sky_share` to the listing. Downloads are cached in `cache/site/`; `--refresh` fetches again,
`--no-streets` and `--no-future` skip those layers. With `--charts` it saves a sun-path chart, a
floor-by-month table and a monthly range chart in `research/charts/`.

Check the run's output before reporting:

- **Party walls.** Facades built against a neighbour are listed as party walls and never used for
  the window. If the listing's exposure only matches a party wall, no window is chosen: the listing
  or the geocode is probably wrong (wrong building, or the unit is on another wing). Do not force it
  with `--bearing` unless a plan shows windows there.
- **Heights.** Look at `bmeta[i].height_src` for the buildings that block the window (the dashboard
  shows it on click). `default` means nothing was known: find the real height (city 3D data,
  listing of the building, floors x 3.2 m) before trusting the hours.
- **Light courts.** If the unit faces an interior court, the court is modelled as open air with
  walls (`holes`); say so, and expect little direct sun below the court's roof line.

## 3. Read and report

In the dashboard's Unit 3D tab: switch to "From the window", step through times of day, compare
floors with the compare slider, and check the floor-by-month table. Report:

- Direct sun hours on the move-in date, in December and in June, for this floor and one or two
  alternatives in the same line, **with the range** (`study.sun_hours_range`): "2 h 10 m in
  December, 1 h 30 m to 3 h depending on where the window sits and two floors either way". If the
  range is wide, the window position matters more than the floor: ask for the plan.
- What fills the view: nearest wall straight ahead (distance, height and address), open sky share,
  which landmarks show (whole tower or just the top), and which street the window faces.
- Buildings coming: any `future` building in the view, its status (proposed, plans approved, work
  permit issued) and the sun hours with it in place (`study.sun_hours_future`). Over a 12 or 24
  month lease a permitted tower across the street matters.
- The floor at which the view clears the nearby roofs, if the renter can choose a higher unit.
- Where the inputs came from (`provenance`): listing, plan, agent, photo landmarks or assumed.

## Limits to state every time

Buildings are prisms to roof height (no setbacks, crowns or trees); heights marked `default` or
`osm-levels` are estimates; the window position along the facade is an assumption unless the plan
shows it (hence the range); future buildings are drawn on their whole lot at the filed height,
which overstates their shadow, and filings change; party walls are inferred from footprints that
touch; only direct sun is modelled. Recommend checking at the same time of day on a tour.
