---
name: building-dossier
description: Research a building end to end - public records (violations, complaints, permits, 311, crime), ownership and management, and resident reviews across Google, Yelp, Reddit, Openigloo and others - and write a sourced dossier. Use for every shortlisted building or when someone asks whether a building is any good.
---

# Building dossier

## 1. Public records

**NYC** (built in): `apartmentscout dossier <id>` pulls PLUTO, HPD violations and complaints, DOB
complaints, ECB/OATH violations, DOB NOW permits on the block, bedbug filings, 311 noise within
150 m and NYPD complaints within 300 m. It writes `research/dossiers/<id>.json` and `.md` and adds
`records.risk_score`, `records.noise_score` and `records.flags` to the listing.

Read the recent rows in the JSON, not just the counts:
- HPD class C = immediately hazardous, B = hazardous, A = non-hazardous. Open C violations matter.
- HPD complaint categories: repeated HEAT/HOT WATER, PESTS, WATER LEAK, ELEVATOR are the ones
  that predict your experience.
- Construction: anything with demolition, new building, vertical enlargement or excavation on the
  block means months of daytime noise. Note the filing dates and the address.
- Bedbug filings report infested units in the prior year; small counts in big buildings are common.
- 311 noise: read `noise_311.metrics`, not the raw count. Requests closed as duplicates are removed
  (`requests_ex_dupes`), `distinct_dates` shows whether it is one bad week or a pattern,
  `night_share_22_07` and `construction_share` say what kind of noise, `frontage` splits the
  streets the building faces, and `closure_classes` says how requests ended ("no violation
  observed" and "gone on arrival" are not "fixed"). The full ledger is in
  `research/<id>-noise-ledger.csv`. To compare with the renter's current home, run the same query
  window and filter on both and keep that building's details out of committed files.
- Receipts: `receipts` lists every dataset queried with rows, whether the row limit was hit, and
  when the dataset was last updated. A dataset last updated before the event you are judging (a
  registration renewal, a recent complaint) cannot show it; say so rather than reading absence as
  a clean record. A limit hit means rows were cut off: narrow the query.
- Rent stabilisation: check the unit listing, the lease rider and the DHCR rent history (the
  renter can request it). 421-a buildings often have stabilised units with riders that change
  renewal terms.

**Other cities**: find the equivalents on the city open-data portal (code enforcement cases,
building permits, 311 or service requests, police incidents) and the assessor (year built, units,
owner). Record dataset names, query URLs, row counts and the dataset's last-updated date in the
note so the next run can repeat it. Numbers taken from another agent's report must be reproduced
from a saved query before reuse; mark them "not auditable" otherwise. See
`docs/guides/new-city.md` to turn a repeatable query into a records module.

## 2. Ownership and management

Owner of record (PLUTO or assessor), the management company, and how that company behaves across
its portfolio: lawsuits (court records, state attorney general), news, tenant-union activity,
and the city's worst-landlord lists where they exist.

## 3. Reviews across platforms

Search each platform by building name **and** every address the building uses (towers often have
two street addresses):

- Google Maps reviews (sort by newest), Yelp (often has the longest tenant reviews), Reddit
  (search the city and neighbourhood subreddits and `"<building name>"`), Openigloo (NYC),
  ApartmentRatings, Birdeye and other aggregators, Niche, StreetEasy building Q&A, local forums.
- For each platform record rating, review count, date range and a link.
- Summarise recurring themes with counts and dates: staff, maintenance speed, noise (street,
  neighbours, mechanical), pests, heat/cooling, elevators, packages, amenities, fees and renewal
  increases, deposit returns, lease breaks, safety.
- Weight recent reviews more, flag single dramatic stories as single reports, and look for
  management replies.

If a site blocks automated reading, ask the renter to open it in their browser; do not bypass.

## 4. Write it up

Use `templates/research-note.md`. Put the bottom line first, then a table of risks with evidence
and a list of questions for the leasing office. Save as `research/<listing-id>.md` (or
`research/<building-slug>-reviews.md` for building-wide notes) and update the listing's
`reviews` block:

```json
"reviews": {"risk": "Street noise on 37th St side", "risk_score": 58,
            "summary": "...", "ratings": [{"label": "Google", "value": "4.0/5 · 35 reviews", "url": "..."}],
            "questions": "..."}
```

`risk_score` is your 0-100 judgement (higher is better) of how the building is likely to treat the
renter, given everything above. Then `apartmentscout score && apartmentscout build`.
