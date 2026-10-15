# Methodology and limits

ApartmentScout is a decision aid. Every number below is an estimate with stated assumptions.
Check the important ones in person before you sign.

## Money

`apartmentscout score` writes the money picture to `score.cost` (see the [data model](data-model.md#money)).
The rules, in order of importance:

- **Unknown fees are estimated, not zero, and never hidden.** A listing without a fee sheet carries an
  `unverified: fees` gate, and `monthly` stays the documented part. For ranking and the budget tier,
  `monthly_expected` adds an estimate from comparable listings: the median known monthly fee in buildings
  with the same doorman service, plus, for condo rentals without a fee sheet, the median known condo
  move-in and application package spread over the lease (`score.cost.fees_estimate`, flagged
  `fees_estimated`). Without that, a listing that documents a $37 fee would rank below one that documents
  nothing. The range runs from the documented part to the 90th-percentile estimate. `fees_monthly: 0` says
  "no monthly fees". A fee given as a range ("$50-100 water/sewer") keeps the range.
- **No net rent without a lease term.** "2 months free" with no term gives no single net-effective
  rent: the listing is ranked on the paid-month (gross) rent, gets an `unverified: lease_term` gate, and
  shows illustrations at 12 and 14 months instead. A concession that names its term (or a
  `min_lease_months` condition) is spread over that term.
- **First-lease monthly equivalent** (`monthly`, what ranking uses): rent owed over the first lease (net
  when known) + known monthly fees + known nonrefundable one-time fees (`fees_one_time`, `broker_fee`,
  `application_fee`, nonrefundable `upfront`) spread over the lease. When the term is unknown, one-time
  fees are spread over 12 months, which overstates rather than understates, and that assumption is listed.
  Refundable deposits are upfront cash, never monthly cost.
- **Upfront cash and move-in minimum**: first month (gross + known monthly fees) + deposit + known
  mandatory one-time fees. Parts that are not documented are listed in `move_in_unknown`, never assumed.
- **Renewal** is priced from the gross: a deep concession lowers the first lease, not the second.
- **Concession conditions** (`price.concession.conditions`): an offer that only applies to leases
  starting before your earliest move-in (or the unit's availability), an offer past its end date, and a
  building-wide banner not tied to the unit are not applied (`concession: not applied` gate). Conditions
  you must confirm (new residents only, immediate leases) stay as notes.
- **Disputed prices**: when received `claims[]` disagree with `price` (a different gross, net or term),
  every capture becomes a scenario, the listing is ranked on the most expensive one and is tagged
  "source conflict" with a `price_dispute` gate. A whole-capture claim (`claims[].price`) replaces the
  rent fields together, so one source's gross is never mixed with another source's net.
- **Headroom**: room left under each budget tier and the hard cap (`headroom`, negative = over), so
  "$26 headroom, fees unknown" reads as what it is. `budget.basis` chooses what the tiers compare:
  `monthly_cost` (default, the first-lease equivalent), `net` (rent only) or `gross` (paid month).
- **Concession calculator**: for a listing above the first tier, `concession_needed` gives the free
  months that would bring it to the target, per 12 and 18 month lease, with and without known monthly
  fees, exact and rounded up to the half month to ask for. For example $6,300 gross to a $5,100 target
  needs 2.29 months free on 12 (2.54 with $135/mo of fees).

## Size

`size.basis` records how a size is known, best first: `reported` (listing or measured), `exact_plan`
(a dimensioned plan of this unit), `line_band_plan` (the same line on a nearby floor), `main_rooms_sum`
(bedroom + living + kitchen rectangles; the whole unit is estimated as that sum / 0.65, range sum /
0.75 to sum / 0.55) and `ratio_proxy` (any other estimate). Without an explicit `size.range`, the range
is ±0, 3, 8, 12 and 20 % of the estimate for those bases. `sqft` holds a reported or exact-plan size
only. A listing that states no size at all is estimated from comparables (`size_imputed`): the median
of the same building's units with the same bedrooms, else the 40th percentile of the search's known
sizes for that bedroom count, with a wide range. Listings that hide their size tend to be the small ones,
so the estimate leans low. The space score uses the middle of the range and carries the range into the score range;
$/ft² is never shown for ratio proxies, and sizes on different bases should not be compared as
percentages.

## Scoring

Eleven dimensions, each 0-100, combined with your `weights` (scoring version 2.1):

| Dimension | How it is scored |
|---|---|
| Cost | First-lease monthly equivalent (see Money; the most expensive capture when sources disagree). 100 at 80% of the first budget tier, 85 at the first tier, 35 at the hard maximum, 0 at 15% above it. |
| Space | Size (middle of its range, see Size) mapped linearly: `sqft_floor` = 0, `sqft_good` = 50, `sqft_great` = 100. Halved if below `min_beds`; an explicit studio counts as 0 bedrooms, a "fitness studio" never does. |
| Commute | Per destination: 100 at half your max minutes, 50 at the max, 0 at twice the max; weighted across destinations. |
| Amenities | Must-haves count 3, strong preferences 2, nice-to-haves 1. Unknown amenities count half. Doorman: full-time 1, part-time 0.6, virtual 0.35. Wording is normalised first: "24-hour concierge", "24 hr", "24/7 staffed" and "full-time" are a full-time doorman, a concierge counts unless it is virtual, a live-in super does not; "laundry in building" is not in-unit laundry. |
| Light and view | From the 3D sun study when present (annual mean and winter direct-sun hours); otherwise exposure, floor and words in the listing (panoramic, airshaft...). Words from building or representative media (`features_scope` other than `exact-unit`) are not scored. When the unit's photos were graded (`photo_review`), the view (60%) and natural light (40%) they show are blended half and half with that model. When the window's facing is only assumed (`exposure_source: assumed`, no listing, plan or photo says which way it faces), the model's result counts at half strength, pulled toward neutral, and says so; the photo blend is applied after that and is unchanged. |
| Building | Your own rating (`building_ratings`, 1-5) leads at 60%, then building quality at 30% and records risk at 10%; without a rating, quality 75% and risk 25%. Quality averages what is known: year built (1960 = 0, 2020 = 100) and floors (5 = 0, 40 = 100) from PLUTO (`building_facts`), doorman service, the breadth of shared amenities, residents' star ratings and graded lobby and amenity photos. Violations per 100 units are a coarse signal and count least. |
| Interior | Finishes from the unit's graded photos (`photo_review`): overall grade averaged with kitchen and bath, plus or minus for a recent renovation, premium or dated appliances; staged, rendered or low-confidence photos are pulled 30% toward neutral. Without photos, finish words in the listing (renovated, Miele, quartz, dated, formica...). Defaults to weight 0. |
| Quiet | The public-records street-noise score when present; otherwise noise words in reviews. |
| Move date | 100 when the unit is available inside your `move_in` window; up to 14 days early is also 100 (landlords often hold that long), then 40 at 45 days early and 0 at 90; late availability is 50 at 14 days and 0 at 30 days after `latest`. `move_in.hard: true` turns late availability into a failed gate. |
| Renewal risk | 100 - 9 x the concession as a % of gross (1 month free on 12 = 8.3 % -> 25): renewals usually start from the gross. 100 without a concession. |
| Transit access | 14 points per distinct line at stations within a 10-minute walk (up to 70), +20 for a one-seat ride to the main destination, +10 when a station is 5 minutes away or less. |

Interior, move date, renewal risk and transit access default to weight 0: they are computed and explained, and
count only when you weight them or pick a preset that does.

**Unknowns** count as 50 in the overall score, so a listing is neither rewarded nor punished for
missing facts; the same holds for evidence that is not about the exact unit. `confidence` is the
share of weight that is known and `range` is the overall score if every unknown were 0 or 100 and every
estimated input (a size range, a fee range, a conditional concession) sat at either end. Inferred
values are flagged (`floor_inferred`, `size_estimated`, `net_conditional`, `fees_unknown`...), and a
listing is tagged "thin data" below 60 % confidence and "source conflict" when sources disagree.

**Reasons.** Every dimension gets a plain sentence with the points it adds or removes against a
neutral listing under your weights, for example "+8 commute: 7 min to Office on foot" or "0 space:
size unknown, counted as neutral", plus the itemised evidence behind it ("floor 31 (+20, inferred
from the unit number)"). The points add up to the overall score minus 50.

**Three ranks.** `ranks.fit` orders every scored listing by quality, whatever its status, so a gone
or over-budget home still shows how good it was. `ranks.action` (also `rank`) orders only eligible
listings: within the hard budget, no failed must-have, not gone or rejected. `ranks.budget` orders the
eligible listings inside the first budget tier, and `ranks.building` ranks buildings by their best
eligible unit. Ties break on confidence, then lower cost, then id.

**Gates** never change the score. Besides the budget and must-have gates: `unverified: fees`,
`unverified: lease_term`, `concession: not_applied`, `price_dispute`, `move_date: after_window`, and
`stale: checked_N_days_ago` when an active listing was last checked more than `scoring.stale_days`
(default 21) ago. An old check date never lowers quality; it asks for a re-check.

**Presets.** `scoring.preset` picks a named, versioned set of weights; `weights:` then adjusts it key
by key, and `scoring.presets` adds your own:

| Preset | Version | Weights (cost / space / commute / amenities / light / building / interior / quiet / move / renewal / transit) |
|---|---|---|
| `balanced` | 1 | 20 / 25 / 15 / 15 / 10 / 10 / 0 / 5 / 0 / 0 / 0 |
| `biggest-and-nicest` | 3 | 3 / 30 / 7 / 15 / 20 / 10 / 10 / 5 / 0 / 0 / 0 |
| `cheapest-good-enough` | 1 | 40 / 15 / 15 / 10 / 5 / 5 / 0 / 0 / 5 / 5 / 0 |
| `shortest-commute` | 1 | 15 / 15 / 40 / 10 / 5 / 5 / 0 / 0 / 0 / 0 / 10 |

The resolved weights, the preset and its version, the dimension list and every preset are exported
with the criteria, so the dashboard can switch presets and re-rank live.

## Commute

A reverse Connection Scan over the GTFS timetable of one weekday finds, for every stop, the latest
departure that still arrives by `arrive_by`. All feeds load into one network and every route carries
a mode (subway, bus, rail or ferry: from the feed's `mode`, else its GTFS `route_type`), so the same
scan runs per mode set:

- **walk**: at `walk_speed_kmh` (4.8 km/h) along the real street network (`walk_model: network`, the
  NYC default; see "Walking on the street network" below). With `walk_model: grid`, or when the
  network cannot be fetched, a grid metric is used instead: inside a city's street grid (the city
  profile's `walk_grids`; NYC: Manhattan, avenues 29 degrees east of north) the distance is
  `factor x (blend x L1 + (1 - blend) x straight line)` with L1 measured along the avenues and streets
  (NYC: factor 1.01, blend 0.9), elsewhere straight line x `walk_detour` (1.25). Every isochrone of
  that metric is a diamond around a station's centroid, whatever the streets do.
- **subway**, **bus** (and rail or ferry when a feed has them): that mode only, plus walking.
- **transit**: every mode together, so a bus to the subway counts. This is the listing's headline
  `minutes`, and the heatmap.

Every mode keeps walking as an option, so near the destination all modes equal the walk. Door-to-door
time adds the walk to the stop and a street-to-vehicle time per mode (subway 2 min, bus 0.5, rail and
ferry 3), charged again at the destination end (`egress_access: 1`). Changing vehicles costs the
feed's published transfer time when it has one (the MTA publishes 3 minutes inside a station), else
one minute plus the walk to a stop within 250 m plus the difference in street-to-vehicle time (a bus
stop to a subway platform), plus one minute of slack before the next departure. A ride gets off at
the stop with the most slack, so it does not overshoot and walk back.

Times are averaged over eleven arrival times (every 2 minutes from 0 to 20 minutes early;
`arrival_offsets_min`) so typical waiting is included even on a 10-15 minute bus headway; each
listing also gets the min-max `range` and the legs of the median trip (walk, rides with board and
alight times, transfers, final walk). The result is schedule-based: it ignores delays, crowding, bus
traffic beyond the timetable and service changes. Only trips in the window before `arrive_by` and
stops within about 3 km of the search are loaded, so the Manhattan bus feeds add a few seconds (the
732-listing example routes in about 5 s).

**Walking on the street network.** The pedestrian network of the search area (plus 1 km) comes from
OpenStreetMap through Overpass, one query per 0.05-degree tile, cached in `cache/walk/` with a
receipt per tile (mirror, OSM data timestamp, sha256); the first run takes a few minutes, later runs
read the cache. Ways tagged highway=footway, pedestrian, path, steps, living_street, residential,
service, tertiary, secondary, primary, unclassified, trunk (and links, tracks, corridors, cycleways),
plus anything with foot=yes, are walkable; motorways, foot=no/private/use_sidepath, access=no/private
and road tunnels are not. So walks follow Broadway's diagonal, cross Central Park on its paths,
climb the Tudor City steps, go around the FDR and the rail yards, use the bridges' walkways and cannot
cross a river anywhere else. Fragments shorter than 1 km in total (a courtyard path) are dropped.
Shape points are collapsed into a junction graph (about 355,000 junctions and 16,000 km of ways for
the example), and destinations, station entrances, bus stops and listings are inserted as nodes at
their nearest point on a way.

Subway stations are entered at their real stairs: the MTA's "Subway Entrances and Exits: 2024"
(data.ny.gov `i9wp-a4ja`, 1,400 entrances in the example's area) mapped to GTFS stations by stop id,
entry-only stairs used only to enter and exit-only stairs only at the destination end; a station the
MTA files no stairs for borrows those of its same-named complex (Times Sq 7, Fulton St A/C, 14 St-Union
Sq L). The walk to the station is the network walk to the nearest usable stair, plus the same
street-to-platform time as before (`station_access_min`). Bus stops are their own entrance.
`station_entrances: osm` uses OpenStreetMap subway entrances for other cities.

For each destination and routing profile one multi-source Dijkstra gives every node its door-to-door
time: every entrance of every stop starts at "arrive_by minus the stop's latest departure plus its
platform time", the destination itself starts at zero (walking only), and walking adds metres /
speed. The fastest combination wins, with no cap on the walk to a station (a per-station cap cannot
be applied exactly in one shared search, and an approximate one left holes);
`max_walk_to_station_m x walk_detour` still bounds the walk from the last stop to the destination
and the heat grid's "near a stop" mask. Each 50 m cell takes the least of (time at a point on a way
within `walk_snap_m`, 60 m, + the straight walk from there); cells farther than that from any way
(rail yards, reservoirs) are blank. A listing takes the same least over its own nearest point and
every way within 60 m, so the map and the listing agree. The example (219 points, 94,000 cells,
33 profiles) routes in about 26 s; set `walk_model: grid` for the old 5 s.

**Land and water.** Walking never crosses a river: points and stops are labelled by landmass from
shoreline-clipped land polygons (NYC: the city's borough boundaries with water excluded, NYC Open
Data, fetched once into `cache/land/`), and a stop on another landmass is out of walking reach
(Roosevelt Island cannot walk to a First Avenue bus stop; Long Island City cannot walk to the FDR).
Bridges are not land, so they do not join landmasses. Points just off the polygons (piers, a stop at
the water's edge) take the nearest land within 100 m. Set `commute.transit.land` to another GeoJSON
(or `false`) for other cities; outside the polygons nothing is blocked. With the network model the
land polygons only blank water cells: the network itself has no way across a river except a bridge.

**The heat grid** holds the router's own answer at the centre of every 50 m cell
(`commute.transit.heat_cell_m`). With the network model see above; with the grid model it is computed the other way round for speed: each stop stamps its walking
cone onto the cells in range and every cell keeps the best departure per mode set and arrival time,
which is identical to routing each cell (checked to 1e-11 min) and takes about a second for the
example's 94,000 cells. Cells over water and cells more than 1 km from any stop and too far to walk
are blank. Layers store half-minutes as base64 bytes (`values_u8`, 255 = blank; about 125 KB per
mode). The map draws 5-minute bands (10-minute past 30) as vector polygons contoured from that field
with linear interpolation between cell centres, and the hover readout interpolates the same way, so
the colour, the readout and the router agree: within 0.08 min on average (max 0.4) at the 217
listing points, against 0.66 (max 2.4) for the old 150 m grid whose image was also stretched up to
100 m out of place at the north and east edges.

**Checks of the network model (October 2026).** Walking alone, against an independent OpenStreetMap
foot router (FOSSGIS OSRM, routing.openstreetmap.de) from 204 Manhattan buildings to an East Midtown
office: mean absolute difference 0.65 min (r = 0.9998, none over 3 min; it is a constant 50 m at the
office end), against 1.29 min for the grid metric (2 over 5 min). On 20 hand-picked walks (Broadway's
diagonal, across Central Park and Bryant Park, Tudor City to the UN, across West Street to Chelsea
Piers and Little Island, through Stuyvesant Town, over the Brooklyn and Queensboro bridges) the two
OSM routers agree within 0.17 min on average; the grid metric is off by 1.8 min on average and by
4-5 min on every Broadway diagonal. Roosevelt Island is the exception for both models: walking means
the Roosevelt Island Bridge, Queens and the Queensboro Bridge (85-90 min to Midtown; the other router
quietly takes the ferry, and the grid metric walks across the East River). The Roosevelt Island Tram
is not in the MTA's GTFS, so the island's transit times use the F train and the Q102 bus only.

The heat map equals each listing's own minutes within 0.09 min on average (max 0.35, from
interpolating between cell centres) for every mode, and along six lines walking away from a station
the minutes never fall except where the line nears another station's stairs.

Against the earlier independent prototype router (same office), the network model differs more than
the grid model did, because that router walked with the same grid metric to stop centroids (the grid
factors were fitted on its walks): mean absolute difference for any transit 1.24 min (grid 0.54),
subway 1.27, bus 1.42 (excluding Roosevelt Island). The systematic parts are the stairs (walks to the
subway 1.1 min shorter on average: Wall St, Fulton St and Brooklyn Bridge are entered at their nearest
stair) and the office end of bus trips (1.4 min longer: the office's point is in the middle of its
block, and the network walks to it from the nearest way, as a pedestrian must).

The grid-metric model was checked against that prototype router on 208 Manhattan buildings to an
East Midtown office (arrive by 9:00), mean absolute difference in minutes:

| | walk | subway | bus | any transit |
|---|---|---|---|---|
| grid walking (`walk_model: grid`) | 0.57 | 0.65 | 0.80 | 0.61 |
| straight line x 1.25 | 3.91 | 0.84 | 1.02 | 0.79 |

A later re-check (October 2026 feeds, the office point estimated to within about 50 m) gives, for
any transit, 0.74 with five arrivals and walks across rivers allowed, and 0.64 with eleven arrivals
and the land model (subway 0.68, bus 0.94); what the map shows at those buildings is 0.63 from the
new grid against 0.99 from the old one. The largest remaining gap (Roosevelt Island, 6 min) is the
other router walking across the East River to a Manhattan bus.

Correlation is 0.99 or better and only one trip differs by more than 5 minutes (a bus route choice).
The two grid factors were fitted on those walks; as an out-of-sample check the walks to and from bus
stops on the other router's bus trips agree within 0.6 min (r = 0.99). Remaining differences are
route choices between near-equal options and the street-to-platform allowance. Premium express buses
are excluded in the NYC config (`exclude_routes`); including them shortens some bus-only trips from
the Upper West Side by up to 9 minutes.

**Several destinations.** Every destination is routed with the same network, so a second one adds its scans and its
grid, not another timetable load (the example with two extra destinations routes in about 12 s). Each listing gets
`commute[<destination>]` for all of them; the score takes the weight-averaged part per destination (above), and
`apartmentscout commute --dest NAME` routes just the named ones. `apartmentscout build` then makes the **combined
surfaces**: per mode, `layers/commute-combined-<mode>.json` holds the *worst of* (the longest trip to any destination at
each cell) and the *weighted* mean of minutes (each destination counted by its `weight`) as the usual half-minute bytes,
deflated (zlib) and base64-encoded, about 24 KB for three destinations on the 227 x 416 example grid. A cell blank for any
destination (water, out of reach) is blank in both. Grids computed at different times may differ in extent; the later ones
are sampled onto the first grid's cells by nearest centre. The dashboard's per-home figure is the scorer's commute part:
100 at half the limit, 50 at the limit, 0 at twice the limit, per destination, weight-averaged over the destinations that
have minutes for the home.

## Place filters

"East of 3rd Ave", "between 30th and 45th", "near Bryant Park" and "in Murray Hill" are answered in the browser from
`places.json` (`apartmentscout places`, `apartmentscout/geo/places.py`). Streets: OpenStreetMap named `highway` ways
(Overpass, cached, a receipt per query), chained per canonical name, Douglas-Peucker simplified to 3 m, kept when they are
numbered streets or at least 1.5 km long (the profile's `street_keep` and `street_merge` add short ones and join one
avenue's names: 8th Avenue = Central Park West = Frederick Douglass Boulevard). Ways outside the profile's study polygon
(NYC: the Manhattan street grid) are dropped, so 3rd Avenue is Manhattan's. Parks: OpenStreetMap `leisure=park` ways and
multipolygon relations of at least 25,000 m2 (6,000 m2 when tagged on Wikipedia or Wikidata), minus playgrounds, piers and
pools. Neighbourhoods: the profile's open dataset (NYC: NTA 2020, Socrata `9nt8-h7nd`, residential areas), with the parts
of compound names ("Murray Hill-Kips Bay") as aliases and a part shared by several areas ("Upper East Side") as their
union. Coordinates are integer 1e-5 degree steps (about a metre), delta-encoded: about 100 KB for the Manhattan example.

Side of a street. Each street carries its own `axis` (its direction in degrees, forward = towards the grid's north), and
the grid's north is the profile's walking-grid bearing (Manhattan 29). For "east of S": take the segment of S nearest the
home, its normal turned towards the grid's east, and ask whether the home lies ahead of that segment's line along the
normal. A diagonal street is judged by its direction at the nearest stretch; a street whose direction is within about 17
degrees of the one asked for has no such side. Beyond a street's ends the last segment's line is extended, so homes below
Astor Place or above 128th Street still have a side of 3rd Avenue. "Between A and B" is the two half-planes; "near" is the
distance to the polygon's edge or the street's line, at your walking speed over the 1.25 street detour used for the
walking rings.

Not covered: a street the OpenStreetMap extract does not name the way the renter does (the profile's `street_merge` and
aliases fix the common ones), sides of a park or neighbourhood, and neighbourhood boundaries other than the dataset's (a
listing's own `neighborhood` label may differ from the outline). Unknown names are reported, never matched approximately.

## Sun and view

**Buildings.** NYC uses the city's building footprints (photogrammetric roof height and ground
elevation per building). A footprint without a roof height takes PLUTO's number of floors x 3.2 m +
2 m, and only when that is missing too a 10 m default. Elsewhere, OpenStreetMap: `height`, else
`building:levels` x 3.2 m + 2 m, else 10 m. Every building records where its height came from
(`roof`, `pluto-floors`, `osm-height`, `osm-levels`, `default`) so a guessed blocker is visible as
one. Each building is a prism from its ground to its roof, unless it has components (below). Footprint outlines are simplified by
dropping vertices within 0.3 m of a straight line, so one wall drawn as several pieces is one facade.
NYC footprints also carry their own metadata, kept per building: the footprint's name (used before
the PLUTO address to label landmarks), whether the outline is photogrammetric or was drawn by hand
(about 15 % in Midtown), the year the record was last edited (most heights are from the 2017 capture,
so newer towers and demolitions can be missing) and the feature code (5100 = under construction).

**Component buildings.** A footprint carries one roof height, so a 20 m podium under a slim 100 m
tower is drawn as the whole lot at 100 m, which overstates its shade. A building can instead be a set
of stacked prisms ("components": podium, tower, setback, bulkhead), each with its own outline, base and
top. Two sources, both optional and both recorded per component with a confidence:

- OpenStreetMap `building:part` outlines with `height` and `min_height` (or levels x 3.2 m, marked low
  confidence) within 400 m, read through Overpass with a receipt like every other download. A part
  belongs to the footprint containing its centroid. A footprint takes its parts only when they cover at
  least 90 % of it (sampled on a grid) and their tallest top is within max(8 m, 20 %) of the footprint's
  own roof; otherwise it stays one prism and the reason is counted (in Midtown about half of the
  buildings with mapped parts pass). Kinds are inferred: tower (reaches 85 % of the top), podium (from
  the ground to at most half the top), bulkhead (small, short and raised), setback (anything else).
- `<search>/sites/<id>.components.yaml`, written by hand for the target and the blockers that matter,
  from a zoning diagram, a section drawing or a measured photo. Every component needs a `source`; a
  manual entry replaces the OpenStreetMap parts of that building. Format in `apartmentscout/geo/components.py`.

Every obstruction calculation (skyline, blockers, sun hours, the floors table, the range, the sky view
below) uses the components when a building has them, in Python and in the dashboard alike. The skyline
keeps one obstruction angle per direction, so a component counts from the ground up: the open gap under
a cantilever is not modelled, and `base_m` serves the 3D drawing and the record. When the unit's own
building has components, a `window-component` check warns if no component reaches the facade behind the
window at its height (the facade steps back there and the window would hang in the air).

**Which building.** The listing's own BIN, then its tax lot (BBL), pick the building before the
geocoded point does: address points often land in the street or on the neighbour. Only without a
match is the footprint containing the point used (if it is tall enough for the listing's floor),
else the nearest tall-enough footprint within 45 m. The site file says which rule matched and how far
the address point lies outside the building.

**Floor heights.** Eye height is (floor - 1) x storey height + 1.6 m. The storey height is the
target's measured roof height divided by its PLUTO number of floors, clamped to 2.8-4.2 m; roof
heights include parapets and bulkheads, so it reads slightly high (the Knox: 111 m / 36 floors =
3.09 m). A ratio outside the range is clamped and flagged: a crown, a tall podium or a floor count
that misses floors. When the real slab elevation is known (a section drawing, an elevator directory,
a listing that states it), `--slab-height` sets it; otherwise 3.2 m.

**Light courts.** Inner rings of a footprint (light courts, courtyards) are kept. Their edges are
walls up to the roof, and the space inside is open air: a window on a court sees the court walls,
not the far side of the block.

**Party walls.** A facade of the unit's building whose outside lies inside another footprint is a
party wall. Points 0.5, 1.0 and 1.5 m outside the facade are tested at 24 places along it; if less
than 4 m of it is clear, the facade is marked shared and never chosen for the window. A partly
shared facade keeps its longest clear stretch, and the window goes in the middle of that stretch.
(In the example search this rejects, for instance, the 45 m stretch of Emerald Green's south side
built against 313 and 325 West 37th Street, a placement an earlier model had used by mistake.)

**Skyline and sun.** For a window point (facade, position along it, eye height as above, 0.4 m
outside the wall) the model casts rays every 0.5 degrees of azimuth and records the highest
obstruction angle: the skyline. The sun reaches the window when it is above the skyline in its
direction and within 90 degrees of the window's facing. A bay or multi-pane window lists its panes
as bearing offsets from the facade (a 45 degree bay is -45, 0, +45): the sun counts when it is in
front of any pane, and hours are also given pane by pane. All panes share the window point's
skyline, so a side pane still cannot see past the building's own walls; how far the bay projects
is not modelled.

**Who shades the window.** When the sun is in front of the window but below the skyline, the model
follows the sun's ray and names the first building whose roof (or component top) rises above it. The study lists the
main blockers (minutes shaded on the 15th of each month), and `--samples` writes every 6-minute slot
of the move-in day and the solstices with the blocker's name, BIN, roof and distance.

**Neighbouring roofs.** For each 45 degree sector, and for the window's own +/-45 degrees, the
nearest buildings within 150 m are listed with their roof heights and the first floor whose eye
height clears each one: "the view ahead clears the nearby roofs from floor 25". Every building
within 300 m is also listed with its distance, bearing, height and sources (`--neighbours`). Sun positions use standard solar formulas
(accuracy well under a degree) and the time zone's real daylight-saving rules. Direct sun hours are
computed every 6 minutes on the 15th of each month. The Python model and the dashboard share this
math, checked against one fixture (`tests/fixtures/sun_parity.json`).

**Ranges, not points.** The exact window position is usually the biggest unknown. Every study also
reports the lowest and highest monthly sun hours over three positions along the facade (20, 50 and
80 % of its clear stretch) and the floors two below to two above. Quote the range when it is wide.

**Streets.** Street centrelines (NYC: the city's CSCL centreline with roadbed widths; elsewhere:
OpenStreetMap) are added for orientation, for instance to confirm that a window faces West 37th
Street. They are centrelines, not kerbs.

**Future buildings.** In NYC, new-building jobs filed with the Department of Buildings (DOB NOW)
within 500 m are added when they are not standing yet: height from the filing (or stories x 3.2 m
+ 2 m), drawn on the whole tax lot. The study then also gives sun hours with those buildings in
place. This is paperwork, not a survey: a filing can be withdrawn or redesigned, towers rarely fill
their lot and step back as they rise (so the lot prism overstates the shadow), status says only
whether plans are approved or a work permit is issued, and jobs filed before DOB NOW (about 2020)
are not read.

**Where each input came from.** The site file records whether the exposure, the window position and
the floor came from the listing, a plan, the agent, landmarks in photos, or were assumed.

**Self-checks.** Every built model is checked: the address point lies within 15 m of the target
(else a warning naming how the building was matched), the target's ground is the 0 m datum, the
window anchor sits 0.2 m inside the building, the air 0.5-1.5 m outside the window is not another
building, named streets lie on opposite sides of the address, no filed building overlaps the target,
at most a quarter of the heights in front of the window are guesses, and no download was cut off at
its row limit. Failures and warnings are printed and stored in the site file.

**Receipts.** Every query to NYC Open Data or Overpass leaves a receipt next to the cached payload:
the query URL, rows returned, whether the row limit was hit, when it was fetched, when the dataset
itself was last updated, and the sha256 of the cached file. A feed last updated before the date you
care about cannot show what happened after it.

### Daylight (relative model)

Direct sun says when the sun itself reaches the glass. Most daylight in a city room comes from the sky,
so every study also reports how much sky a window sees, weighted the way a vertical window receives
light from an overcast sky. It is a relative model for comparing windows and floors, not lux.

**Sky view.** The CIE standard overcast sky has luminance L(a) = Lz (1 + 2 sin a) / 3 at altitude a
(three times brighter at the zenith than at the horizon). A sky patch at altitude a and d degrees off
the window normal lights the glass in proportion to L(a) cos(a) cos(d) dOmega, with
dOmega = cos(a) da dd. Over altitude the integral has a closed form,

    G(h) = F(90 deg) - F(h),   F(a) = (a/2 + sin(2a)/4 - (2/3) cos^3 a) / 3,

so with the skyline h(az) from the window point:

    sky_view = sum over az within 80 deg of the normal of cos(d) G(h(az))  /  the same sum with h = 0

sampled every 1 degree of azimuth (bin centres). 1.0 means nothing stands above the horizon in the
window's +/-80 degree field; a continuous wall rising 30 degrees everywhere gives about 0.51 (the low sky
counts most for a vertical window). A bay takes the union of its panes' fields, each azimuth weighted by
the nearest pane. Computed for the window and every floor (`study.sky_view`, `daylight_floors`).

**Estimated daylight factor.** The BRE average daylight factor (Littlefair, 1988),

    DF = T x Aw x theta / (A x (1 - R^2))   (%, theta in degrees)

with theta, the visible sky angle seen from the window, taken as 90 degrees x sky view (for a long wall
parallel to the window this agrees with the BRE construction within a few degrees). Unit 3D and the site
file use an assumed room: glazing transmittance T = 0.6, Aw = 3 m^2 of glass, A = 88.6 m^2 of room
surfaces (4 x 5 m, 2.7 m ceiling), reflectance R = 0.5, so an unobstructed window gives about 2.4 %. The
Floor plan studio's Light tab uses the plan's own room and window sizes (80 % of each opening glazed) and
lets you change the glazing transmittance and the blinds (open, half = 0.5, closed = 0.1): a preview
that scales the sun patches and the estimate together. Read DF_est as "this window sees more sky than
that one", never as a measurement: reflections from facades, the depth and colour of the room, frames,
dirt and furniture are not in it.

**Possible and expected sun.** Direct sun hours are possible (clear-sky) hours: the sun is up, in
front of the window and above the skyline. Expected hours on a typical month scale them by the share
of daylight hours that are sunny in that month: for New York, NOAA's 1961-1990 climate normals for
Central Park (percent of possible sunshine: 54 % in January, 55, 57, 57, 57, 57, 59, 63 % in August,
59, 61, 51, 48 % in December). The site file gives both by month and for the year (hours per day on
the 15th x days in the month). This assumes cloud is independent of the time of day and of the
direction the window faces; other cities have no table yet, so only possible hours are given.

**Towards real photometry.** Illuminance in lux, glare and annual climate-based metrics need a
physically based lighting engine with materials, a calibrated room and weather files. The Radiance
suite (https://www.radiance-online.org/) is the standard route; ApartmentScout does not run it and
claims none of its results.

Not modelled: crowns and spires except where a building's components describe them, trees, reflected
light from glass towers, sky brightness beyond the overcast model, interior depth (except in the
floor-plan view), and weather beyond the monthly sunshine share.

## Public records (NYC)

Counts over the last three years from NYC Open Data. The records score starts at 90 and subtracts
for HPD violations and complaints per 100 units per year and for open class B and C violations. The
street-noise score starts at 85 and subtracts for 311 noise requests within 150 m, requests at the
building per 100 units, and a high night share. Both are coarse screens to point you at the rows
worth reading, not ratings of the building.

311 noise is also broken down so the numbers survive a second look: requests closed as explicit
duplicates are counted and removed, distinct submission dates separate one bad weekend from a
pattern, the night share uses 22:00-06:59, construction noise is split out, the lot's requests are
given per 1,000 residential units, and counts are split by the street each request names (with the
building's own frontages singled out). Closure texts are sorted into classes (duplicate, no access,
no violation observed, gone on arrival, action taken...): a closed request is not a fixed problem.
The full ledger of requests is written to `research/<id>-noise-ledger.csv`. Comparing with a
building you know (your current home) is only fair with the same window, filter and denominator.

## Data sources

NYC Open Data (PLUTO, HPD, DOB, ECB, DOB NOW, 311, NYPD, bedbug filings, building footprints, street
centerline, tax lots), NYC Planning Labs GeoSearch, US Census geocoder, OpenStreetMap (Nominatim,
Overpass, map tiles), and the transit agencies' GTFS feeds. Respect each source's terms; heavy use of the OpenStreetMap tile server
is not allowed, so set `search.tiles` to your own tile provider if you publish a busy dashboard.
