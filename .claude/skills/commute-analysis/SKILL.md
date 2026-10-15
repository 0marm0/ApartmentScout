---
name: commute-analysis
description: Set up commute destinations and transit feeds, compute door-to-door commute heatmaps and per-listing commute times by mode (walk, subway, bus, best of transit) with ApartmentScout's GTFS router, and sanity-check them. Use when commute matters to the search or a renter asks how long a trip will take from candidate homes.
---

# Commute analysis

1. **Destinations**: every regular trip (office, school, partner, gym) under
   `commute.destinations` with `address`, `arrive_by`, `max_minutes` and `weight`.
   `apartmentscout geocode` prints coordinates; copy them in. Two or more is normal (your office and a
   partner's, a gym): give each its own `max_minutes` and a `weight` for how much it counts (a gym you
   visit twice a week might be 0.5). The dashboard then shows minutes to every destination, a limit per
   destination, a combined commute score and heat maps of the farthest and the weighted destination.
2. **Transit feeds**: find the agency GTFS zips ("<agency> GTFS static"), add each under
   `commute.transit.feeds` with a `name` and `url` (or a local `path`), and a `mode`
   (`subway`, `bus`, `rail` or `ferry`; without one each route's GTFS `route_type` decides).
   NYC: the subway, NYC Bus Manhattan and MTA Bus Company feeds from the MTA developer data page
   (`config/cities/nyc.yaml` has the URLs; other boroughs' bus feeds are commented there).
   `exclude_routes: ["^(BxM|BM|QM|SIM|X)[0-9]"]` drops premium express buses; remove it if the
   renter will pay the express fare. Set `service_date` to a normal weekday inside the feeds'
   calendars (the CLI tells you the range if it is wrong).
3. **Run**: `apartmentscout commute` (about 5 s for 700 listings with subway and Manhattan buses).
   It writes `layers/commute-<destination>.json` (best of any transit, a 50 m grid), one grid per
   mode (`-subway.json`, `-bus.json`; `--no-mode-grids` skips them) and, on every listing,
   `commute.<destination>`: `minutes`/`route` (best of transit) plus `modes.walk|subway|bus|transit`
   with minutes, a min-max range over arrival times, route text and legs (walk to stop with
   distance, rides with board and alight times, transfers, final walk). See
   `docs/guides/data-model.md`. With several destinations every one is routed (the network loads once);
   add a destination later and `apartmentscout commute --dest "Partner"` routes only that one and leaves
   the others' grids and times alone. `apartmentscout build` then writes the combined surfaces
   (`layers/commute-combined-<mode>.json`) from the grids on disk.
4. **Check**: compare three or four listings against a live trip planner at the arrive-by time,
   per mode. The model is schedule-based, averages five arrival times to include waiting, adds a
   street-to-vehicle time per mode at both ends (subway 2 min, bus 0.5) and walks at 4.8 km/h.
   **Walking** (`commute.transit.walk_model`, NYC default `network`): walks follow the OpenStreetMap
   pedestrian network (sidewalks, crossings, park paths, plazas, bridge walkways; no motorways or road
   tunnels) to the station's real entrances (NYC: the MTA entrance list, entry-only and exit-only stairs
   respected; `station_entrances: osm` uses OSM subway entrances elsewhere). The network is fetched
   once from Overpass in tiles into `cache/walk/` with receipts (the first run takes minutes, later
   runs seconds). If the fetch fails, or with `walk_model: grid`, walking falls back to the street-grid
   metric (`walk_grids`; NYC: Manhattan at 29 degrees) or the straight line x 1.25. For a new city set
   `walk_model: network` (most cities are mapped well enough). Tune `walk_speed_kmh`, `walk_detour`
   (grid model and access limit), `station_access_min` or
   `access_min: {subway: 2, bus: 0.5}`, `egress_access` and `max_walk_to_station_m` if it is
   consistently off.
5. **Read the heatmap** in the dashboard (Map, Commute heatmap). Pins can be coloured by commute.
   Grey gaps are water, areas more than 1 km from any stop and too far to walk, and (network model)
   cells more than `walk_snap_m` (60 m) from any walkable way: rail yards, reservoirs, big lots.
6. **Tell the renter what the numbers mean**: a bus time is the timetable, and Manhattan buses
   run late at rush hour; a range wider than 5 minutes means the trip hinges on a connection.

Driving and cycling are not modelled; use a routing service for those and record the minutes under
`commute_observations` on the listing.

## Heat grid details

The heat grid is exact at every 50 m cell (the router is evaluated per cell, not interpolated; with the network model each cell takes the nearest point on a walkable way within 60 m plus the straight walk from there, and each listing is a node of the walk graph, so map and listing agree), averaged over 11 arrivals 0 to 20 minutes before `arrive_by`, stored as half-minutes (`values_u8`, base64). A land model (NYC borough boundaries clipped to the shoreline, or `commute.transit.land`) blanks water and stops walks from crossing rivers; set `land: false` to turn it off.
