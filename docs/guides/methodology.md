# Methodology and limits

ApartmentScout is a decision aid. Every number below is an estimate with stated assumptions.
Check the important ones in person before you sign.

## Scoring

Seven dimensions, each 0-100, combined with your `weights`:

| Dimension | How it is scored |
|---|---|
| Cost | Monthly cost (net-effective rent + recurring fees + one-time fees / lease months). 100 at 80% of the first budget tier, 85 at the first tier, 35 at the hard maximum, 0 at 15% above it. |
| Space | Square feet mapped linearly: `sqft_floor` = 0, `sqft_good` = 50, `sqft_great` = 100. Halved if below `min_beds`. |
| Commute | Per destination: 100 at half your max minutes, 50 at the max, 0 at twice the max; weighted across destinations. |
| Amenities | Must-haves count 3, strong preferences 2, nice-to-haves 1. Unknown amenities count half. Doorman: full-time 1, part-time 0.6, virtual 0.35. |
| Light and view | From the 3D sun study when present (annual mean and winter direct-sun hours); otherwise exposure, floor and words in the listing (panoramic, airshaft...). |
| Building | Average of the review risk score, review-site star ratings and the public-records score. |
| Quiet | The public-records street-noise score when present; otherwise noise words in reviews. |

**Unknowns** count as 50 in the overall score, so a listing is neither rewarded nor punished for
missing facts. `confidence` is the share of weight that is known and `range` is the overall score
if every unknown were 0 or 100. Rank only compares eligible listings: within the hard budget, no
failed must-have, not gone or rejected.

## Commute

A reverse Connection Scan over the GTFS timetable of one weekday finds, for every stop, the latest
departure that still arrives by `arrive_by`. Door-to-door time adds walking (straight line x 1.25 at
4.8 km/h) and 2 minutes of street-to-platform time, and is averaged over five arrival times
(0, 3, 6, 9 and 12 minutes early) to include typical waiting. The result is schedule-based: it
ignores delays, crowding and service changes. Grid cells more than 1 km from any stop and too far to
walk are left blank (rivers, parks, other states).

## Sun and view

**Buildings.** NYC uses the city's building footprints (photogrammetric roof height and ground
elevation per building). A footprint without a roof height takes PLUTO's number of floors x 3.2 m +
2 m, and only when that is missing too a 10 m default. Elsewhere, OpenStreetMap: `height`, else
`building:levels` x 3.2 m + 2 m, else 10 m. Every building records where its height came from
(`roof`, `pluto-floors`, `osm-height`, `osm-levels`, `default`) so a guessed blocker is visible as
one. Each building is a prism from its ground to its roof. Footprint outlines are simplified by
dropping vertices within 0.3 m of a straight line, so one wall drawn as several pieces is one facade.

**Light courts.** Inner rings of a footprint (light courts, courtyards) are kept. Their edges are
walls up to the roof, and the space inside is open air: a window on a court sees the court walls,
not the far side of the block.

**Party walls.** A facade of the unit's building whose outside lies inside another footprint is a
party wall. Points 0.5, 1.0 and 1.5 m outside the facade are tested at 24 places along it; if less
than 4 m of it is clear, the facade is marked shared and never chosen for the window. A partly
shared facade keeps its longest clear stretch, and the window goes in the middle of that stretch.
(In the example search this rejects, for instance, the 45 m stretch of Emerald Green's south side
built against 313 and 325 West 37th Street, a placement an earlier model had used by mistake.)

**Skyline and sun.** For a window point (facade, position along it, floor x 3.2 m + 1.6 m, 0.4 m
outside the wall) the model casts rays every 0.5 degrees of azimuth and records the highest
obstruction angle: the skyline. The sun reaches the window when it is above the skyline in its
direction and within 90 degrees of the window's facing. Sun positions use standard solar formulas
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

Not modelled: setbacks, crowns and spires (buildings are prisms to the roof), trees, reflected
light from glass towers, sky brightness, interior depth (except in the floor-plan view), and weather.

## Public records (NYC)

Counts over the last three years from NYC Open Data. The records score starts at 90 and subtracts
for HPD violations and complaints per 100 units per year and for open class B and C violations. The
street-noise score starts at 85 and subtracts for 311 noise requests within 150 m, requests at the
building per 100 units, and a high night share. Both are coarse screens to point you at the rows
worth reading, not ratings of the building.

## Data sources

NYC Open Data (PLUTO, HPD, DOB, ECB, DOB NOW, 311, NYPD, bedbug filings, building footprints, street
centerline, tax lots), NYC Planning Labs GeoSearch, US Census geocoder, OpenStreetMap (Nominatim,
Overpass, map tiles), and the transit agencies' GTFS feeds. Respect each source's terms; heavy use of the OpenStreetMap tile server
is not allowed, so set `search.tiles` to your own tile provider if you publish a busy dashboard.
