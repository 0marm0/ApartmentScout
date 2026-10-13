---
name: listing-sourcing
description: Find, capture and de-duplicate rental listings from portals, broker sites and building websites into ApartmentScout's listings.json with sources and check dates. Use when adding new listings, sweeping for new inventory, or re-verifying availability and prices.
---

# Listing sourcing

## Where to search

Work from broad to specific and record which sources you swept and when (in `research/sweeps.md`).

1. **Portals**: the city's dominant rental portals (NYC: StreetEasy, Zillow, Apartments.com,
   RentHop; elsewhere: Zillow, Apartments.com, Craigslist, local equivalents). Filter with the
   renter's hard constraints only, so you see the full field.
2. **Broker and brokerage sites**: Corcoran, Compass, Douglas Elliman and local firms often show
   exclusive or earlier listings.
3. **Building websites and leasing offices**: large managed buildings list availability, floor
   plans, concessions and fees on their own sites. Search "<building> availability" and the
   management company's portfolio pages.
4. **Neighbourhood sweep**: for each target neighbourhood, list the large rental buildings that
   meet the must-haves (use the city footprints, reviews sites and the portals' building pages)
   and check each one's availability directly.

If a site blocks automated access, do not work around it. Ask the renter to open the page and
paste the details or a screenshot, or use the site's official export or alert emails.

## What to capture per unit

Minimum: `building`, `unit`, `address`, `price.gross`, `links.listing`, `checked` (date), `status`.
Then as many of these as the source states: `beds`, `baths`, `sqft`, `floor`, `exposure`,
`price.free_months`, `price.lease_months`, `price.fees_monthly`, `price.fees_one_time`,
`price.broker_fee`, `available`, `amenities.*`, `features.view/light/windows/interior`,
`links.floorplan`, `links.video`, `neighborhood`.

Use `null` (or omit) for anything not stated. "Pet friendly" in a building blurb is not the unit's
pet policy; "W/D in building" is not in-unit laundry. When sources disagree, keep the most specific
one (unit page beats building page beats portal summary) and note the conflict in `notes`.

## Writing the rows

- Add rows to a CSV using `searches/<name>/listings.template.csv` columns and run
  `apartmentscout import file.csv`, or edit `listings.json` directly.
- `id` = `slugify(building, unit)` (lower-case, hyphens). The importer creates it if missing.
- The same unit on several sites is one row: add the extra URLs under `links`
  (`links.listing`, `links.building_site`, `links.broker`).
- When a unit disappears, set `status: gone` and keep the row.

## Sanity checks before scoring

- Net-effective vs gross: portals often advertise net-effective. Record the gross in
  `price.gross` and the concession in `free_months`/`lease_months`; if only the net figure is
  known, put it in `price.net_effective` and note it.
- Floor from unit number is a guess (`12B` is usually floor 12, `PH` is the top): the importer
  marks such floors `floor_inferred: true`.
- Studios and "flex" layouts listed as 1BR: check the floor plan for a real bedroom door and window.

Finish with `apartmentscout geocode && apartmentscout commute && apartmentscout score`.
