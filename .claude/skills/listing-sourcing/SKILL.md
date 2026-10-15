---
name: listing-sourcing
description: Find, capture and de-duplicate rental listings from portals, broker sites and building websites into ApartmentScout's listings.json with sources and check dates. Use when adding new listings, sweeping for new inventory, or re-verifying availability and prices.
---

# Listing sourcing

## Where to search

Work from broad to specific and record every query you ran as one line in `research/sweeps.jsonl`
(source, query, filters, observed_count, pages, pages_captured, unique_ids, duplicates, excluded, failed,
checked; format in `docs/guides/research-quality.md#sweep-receipts`). `apartmentscout coverage` only calls a
source complete when its receipts reconcile; never describe the inventory as the whole market.

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

## Photos

- **Listing photos** go in `photos` as a list of image URLs (or `media/<id>/<file>` paths for photos
  saved locally). They are the owner's copyright: keep them in the private search only, never in
  `examples/` or anything published.
- **Other photos you find** (building website gallery, management company, press) go in
  `building_photos` with credit and an honest scope:
  `{"url", "page", "author", "license", "source", "scope"}`, scope one of `exact-unit`, `same-line`,
  `building`, `street`, `aerial`. Use `"license": "All rights reserved"` unless the page states an open
  licence. Never mark a photo `building` on location alone.
- Then run `apartmentscout photos` for licensed Wikimedia Commons building photos (it keeps what you
  added), and `apartmentscout photos --cache` in a private search to save copies before listings come
  down. Details: `docs/guides/photos.md`.

## Sanity checks before scoring

- Net-effective vs gross: portals often advertise net-effective. Record the gross in
  `price.gross` and the concession in `free_months`/`lease_months`; if only the net figure is
  known, put it in `price.net_effective` and note it.
- Say where the price was read: `price.basis` (`unit_page`, `owner_page`, `leasing_office`, `renter_quote`,
  `broker_card`; or the weak `search_snippet`, `building_page`, `received`, `stale`, `estimate`), with
  `price.source` and `price.checked`. A price from a search-result snippet, a building list or an undated copy is
  ranked on gross with an `unverified:price` gate until you read the unit's own page. A snippet that shows a
  price range ("$4,318-$4,652") goes in `price.range`, never `net_effective`: a range has no lease term.
- Floor from unit number is a guess (`12B` is usually floor 12, `PH` is the top): the importer
  marks such floors `floor_inferred: true`.
- Studios and "flex" layouts listed as 1BR: check the floor plan for a real bedroom door and window.

- Never save a bot-check or CAPTCHA page as evidence (`apartmentscout lint` flags "Just a moment..." and
  similar text in notes and in `research/snapshots/<id>/`).

## Check your work

After every batch of new or edited rows:

1. `apartmentscout validate`: fix every error (duplicate ids, bad URLs, impossible prices, geocodes outside
   the search area). If two ids are one unit, declare the other id in `aliases`.
2. `apartmentscout lint`: resolve each `high` flag before scoring: junior/flex layouts counted as a bedroom,
   building laundry marked as in-unit, a fee that equals a price drop, a URL naming another building or
   unit, sale listings, expired concessions, plan labels for another unit, free months without a term.
   Fix the field or note why it stands; never silence a flag by deleting the text that raised it.
3. Things a source told you that you could not see yourself (partner sheet, email, cached page, phone call)
   go in the claims log, not straight into the row:
   `apartmentscout history claim <id> status leased --source <url> --kind partner --claimed-at <date the source
   says>`. `received_at` (today) is never the date a fact was true. An older or undated "active" claim must
   not turn a gone listing active again.
4. Re-verifying: `apartmentscout coverage` lists stale facts (checked more than 7 days ago) in priority order;
   `apartmentscout history diff` shows what changed since the last build. A changed available date or price
   is a change, not a new listing.

Finish with `apartmentscout geocode && apartmentscout commute && apartmentscout score`.
