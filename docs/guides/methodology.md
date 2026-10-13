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

Buildings come from city footprints (NYC: roof heights from photogrammetry) or OpenStreetMap
(`height` or `building:levels` x 3.2 m + 2 m, otherwise 10 m). Each building is a prism to its roof.
For a window point (facade, position, floor height x floor + 1.6 m), the model casts rays every
0.5 degrees of azimuth and records the highest obstruction angle: the skyline. The sun reaches the
window when it is above the skyline in its direction and within 90 degrees of the window's facing.
Sun positions use standard solar formulas (accuracy well under a degree). Direct sun hours are
computed every 6 minutes on the 15th of each month.

Not modelled: setbacks, spires, trees, reflected light from glass towers, sky brightness, interior
depth (except in the floor-plan view), and weather.

## Public records (NYC)

Counts over the last three years from NYC Open Data. The records score starts at 90 and subtracts
for HPD violations and complaints per 100 units per year and for open class B and C violations. The
street-noise score starts at 85 and subtracts for 311 noise requests within 150 m, requests at the
building per 100 units, and a high night share. Both are coarse screens to point you at the rows
worth reading, not ratings of the building.

## Data sources

NYC Open Data (PLUTO, HPD, DOB, ECB, DOB NOW, 311, NYPD, bedbug filings, building footprints), NYC
Planning Labs GeoSearch, US Census geocoder, OpenStreetMap (Nominatim, Overpass, map tiles), and the
transit agencies' GTFS feeds. Respect each source's terms; heavy use of the OpenStreetMap tile server
is not allowed, so set `search.tiles` to your own tile provider if you publish a busy dashboard.
