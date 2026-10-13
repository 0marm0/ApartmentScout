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
- Video and photos of the same line on another floor show the same direction but a different
  view; the model tells you how much a lower floor loses.

## 2. Build the model

```bash
apartmentscout site <id> --floor 12 --charts          # exposure taken from listing.exposure
apartmentscout site <id> --floor 12 --bearing 209     # or give the facade bearing
apartmentscout build && apartmentscout serve          # Unit 3D tab
```

This fetches building footprints and heights (NYC: city footprints; elsewhere: OpenStreetMap,
check heights of the nearest blockers by hand), writes `sites/<id>.json`, and adds `site.sun_hours`
(direct sun hours per day on the 15th of each month), `skyline_ahead_deg` and `open_sky_share` to
the listing. With `--charts` it saves a sun-path chart and a floor-by-month table in
`research/charts/`.

## 3. Read and report

In the dashboard's Unit 3D tab: switch to "From the window", step through times of day, compare
floors with the compare slider, and check the floor-by-month table. Report:

- Direct sun hours on the move-in date, in December and in June, for this floor and one or two
  alternatives in the same line.
- What fills the view: nearest wall straight ahead (distance and height), open sky share,
  which landmarks show (whole tower or just the top).
- The floor at which the view clears the nearby roofs, if the renter can choose a higher unit.

## Limits to state every time

Buildings are prisms to roof height (no setbacks, crowns or trees); OSM heights may be estimates;
the window position along the facade is an assumption unless the plan shows it; only direct sun is
modelled. Recommend checking at the same time of day on a tour.
