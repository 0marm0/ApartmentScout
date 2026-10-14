# Methodology and limits

ApartmentScout is a decision aid. Every number below is an estimate with stated assumptions.
Check the important ones in person before you sign.

## Money

`apartmentscout score` writes the money picture to `score.cost` (see the [data model](data-model.md#money)).
The rules, in order of importance:

- **Unknown fees stay unknown.** A listing without a fee sheet is ranked on the part that is known
  (rent plus any fees that are known) and carries an `unverified: fees` gate; its monthly range is open at
  the top ("$4,850 + fees"). No fee buffer is invented, and `fees_monthly: 0` is the only way to say
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
only. The space score uses the middle of the range and carries the range into the score range;
$/ft² is never shown for ratio proxies, and sizes on different bases should not be compared as
percentages.

## Scoring

Ten dimensions, each 0-100, combined with your `weights` (scoring version 2.0):

| Dimension | How it is scored |
|---|---|
| Cost | First-lease monthly equivalent (see Money; the most expensive capture when sources disagree). 100 at 80% of the first budget tier, 85 at the first tier, 35 at the hard maximum, 0 at 15% above it. |
| Space | Size (middle of its range, see Size) mapped linearly: `sqft_floor` = 0, `sqft_good` = 50, `sqft_great` = 100. Halved if below `min_beds`; an explicit studio counts as 0 bedrooms, a "fitness studio" never does. |
| Commute | Per destination: 100 at half your max minutes, 50 at the max, 0 at twice the max; weighted across destinations. |
| Amenities | Must-haves count 3, strong preferences 2, nice-to-haves 1. Unknown amenities count half. Doorman: full-time 1, part-time 0.6, virtual 0.35. Wording is normalised first: "24-hour concierge", "24 hr", "24/7 staffed" and "full-time" are a full-time doorman, a concierge counts unless it is virtual, a live-in super does not; "laundry in building" is not in-unit laundry. |
| Light and view | From the 3D sun study when present (annual mean and winter direct-sun hours); otherwise exposure, floor and words in the listing (panoramic, airshaft...). Words from building or representative media (`features_scope` other than `exact-unit`) are not scored. |
| Building | Average of the review risk score, review-site star ratings and the public-records score. |
| Quiet | The public-records street-noise score when present; otherwise noise words in reviews. |
| Move date | 100 when the unit is available inside your `move_in` window; up to 14 days early is also 100 (landlords often hold that long), then 40 at 45 days early and 0 at 90; late availability is 50 at 14 days and 0 at 30 days after `latest`. `move_in.hard: true` turns late availability into a failed gate. |
| Renewal risk | 100 - 9 x the concession as a % of gross (1 month free on 12 = 8.3 % -> 25): renewals usually start from the gross. 100 without a concession. |
| Transit access | 14 points per distinct line at stations within a 10-minute walk (up to 70), +20 for a one-seat ride to the main destination, +10 when a station is 5 minutes away or less. |

Move date, renewal risk and transit access default to weight 0: they are computed and explained, and
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

| Preset | Version | Weights (cost / space / commute / amenities / light / building / quiet / move / renewal / transit) |
|---|---|---|
| `balanced` | 1 | 20 / 25 / 15 / 15 / 10 / 10 / 5 / 0 / 0 / 0 |
| `biggest-and-nicest` | 2 | 3 / 35 / 7 / 20 / 20 / 10 / 5 / 0 / 0 / 0 |
| `cheapest-good-enough` | 1 | 40 / 15 / 15 / 10 / 5 / 5 / 0 / 5 / 5 / 0 |
| `shortest-commute` | 1 | 15 / 15 / 40 / 10 / 5 / 5 / 0 / 0 / 0 / 10 |

The resolved weights, the preset and its version, the dimension list and every preset are exported
with the criteria, so the dashboard can switch presets and re-rank live.

## Commute

A reverse Connection Scan over the GTFS timetable of one weekday finds, for every stop, the latest
departure that still arrives by `arrive_by`. All feeds load into one network and every route carries
a mode (subway, bus, rail or ferry: from the feed's `mode`, else its GTFS `route_type`), so the same
scan runs per mode set:

- **walk**: at `walk_speed_kmh` (4.8 km/h). Inside a city's street grid (the city profile's
  `walk_grids`; NYC: Manhattan, avenues 29 degrees east of north) the distance is
  `factor x (blend x L1 + (1 - blend) x straight line)` with L1 measured along the avenues and streets
  (NYC: factor 1.01, blend 0.9), so a walk straight up an avenue is about the straight line and one at
  45 degrees to the grid about 1.38x. Elsewhere, or between two different areas (Manhattan and
  Roosevelt Island), it is straight line x `walk_detour` (1.25). The same function gives the walk to
  the stop, transfer walks, the walk from the stop and the heat grids.
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

Times are averaged over five arrival times (0, 3, 6, 9 and 12 minutes early) to include typical
waiting; each listing also gets the min-max `range` and the legs of the median trip (walk, rides with
board and alight times, transfers, final walk). The result is schedule-based: it ignores delays,
crowding, bus traffic beyond the timetable and service changes. Grid cells more than 1 km from any
stop and too far to walk are left blank (rivers, parks, other states). Only trips in the window before
`arrive_by` and stops within about 3 km of the search are loaded, so the Manhattan bus feeds add a few
seconds (the 732-listing example routes in about 5 s).

Checked against an independent GTFS router on 208 Manhattan buildings to an East Midtown office
(arrive by 9:00), mean absolute difference in minutes:

| | walk | subway | bus | any transit |
|---|---|---|---|---|
| grid walking (default for NYC) | 0.57 | 0.65 | 0.80 | 0.61 |
| straight line x 1.25 | 3.91 | 0.84 | 1.02 | 0.79 |

Correlation is 0.99 or better and only one trip differs by more than 5 minutes (a bus route choice).
The two grid factors were fitted on those walks; as an out-of-sample check the walks to and from bus
stops on the other router's bus trips agree within 0.6 min (r = 0.99). Remaining differences are
route choices between near-equal options and the street-to-platform allowance. Premium express buses
are excluded in the NYC config (`exclude_routes`); including them shortens some bus-only trips from
the Upper West Side by up to 9 minutes.

## Sun and view

**Buildings.** NYC uses the city's building footprints (photogrammetric roof height and ground
elevation per building). A footprint without a roof height takes PLUTO's number of floors x 3.2 m +
2 m, and only when that is missing too a 10 m default. Elsewhere, OpenStreetMap: `height`, else
`building:levels` x 3.2 m + 2 m, else 10 m. Every building records where its height came from
(`roof`, `pluto-floors`, `osm-height`, `osm-levels`, `default`) so a guessed blocker is visible as
one. Each building is a prism from its ground to its roof. Footprint outlines are simplified by
dropping vertices within 0.3 m of a straight line, so one wall drawn as several pieces is one facade.
NYC footprints also carry their own metadata, kept per building: the footprint's name (used before
the PLUTO address to label landmarks), whether the outline is photogrammetric or was drawn by hand
(about 15 % in Midtown), the year the record was last edited (most heights are from the 2017 capture,
so newer towers and demolitions can be missing) and the feature code (5100 = under construction).

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
follows the sun's ray and names the first building whose roof rises above it. The study lists the
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

Not modelled: setbacks, crowns and spires (buildings are prisms to the roof), trees, reflected
light from glass towers, sky brightness, interior depth (except in the floor-plan view), and weather.

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
