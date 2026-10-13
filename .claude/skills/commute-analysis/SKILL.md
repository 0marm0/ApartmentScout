---
name: commute-analysis
description: Set up commute destinations and transit feeds, compute door-to-door commute heatmaps and per-listing commute times with ApartmentScout's GTFS router, and sanity-check them. Use when commute matters to the search or a renter asks how long a trip will take from candidate homes.
---

# Commute analysis

1. **Destinations**: every regular trip (office, school, partner, gym) under
   `commute.destinations` with `address`, `arrive_by`, `max_minutes` and `weight`.
   `apartmentscout geocode` prints coordinates; copy them in.
2. **Transit feeds**: find the agency GTFS zip ("<agency> GTFS static"), add it under
   `commute.transit.feeds` with a `name` and `url` (or a local `path`). Add several feeds for
   multi-agency cities. Set `service_date` to a normal weekday inside the feed's calendar
   (the CLI tells you the range if it is wrong).
3. **Run**: `apartmentscout commute`. It writes `layers/commute-<destination>.json` (a 150 m grid)
   and `commute.<destination>.{minutes, mode, route}` on every listing.
4. **Check**: compare three or four listings against a live trip planner at the arrive-by time.
   The model is schedule-based, averages five arrival times to include waiting, adds 2 minutes of
   street-to-platform time and walks at 4.8 km/h with a 1.25 detour factor. Tune
   `walk_speed_kmh`, `walk_detour`, `station_access_min` and `max_walk_to_station_m` if it is
   consistently off.
5. **Read the heatmap** in the dashboard (Map, Commute heatmap). Pins can be coloured by commute.
   Grey gaps are areas more than 1 km from any stop and too far to walk.

Buses and ferries are just more GTFS feeds; large bus feeds take longer to load. Driving and
cycling are not modelled; use a routing service for those and enter minutes by hand under
`commute.<destination>.minutes`.
