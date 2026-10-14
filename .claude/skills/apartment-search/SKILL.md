---
name: apartment-search
description: Run or resume a full apartment search with ApartmentScout - intake the renter's criteria, source listings, score, shortlist and route to the deeper research skills. Use when someone wants help finding, comparing or deciding on rental apartments.
---

# Apartment search (orchestrator)

## 1. Find or create the search

- If `$APARTMENTSCOUT_SEARCH` or `./search/criteria.yaml` exists, resume it: read `criteria.yaml`,
  run `apartmentscout score --top 20`, and summarise where things stand (counts by status, top 10,
  open questions) before doing anything else.
- Otherwise run `apartmentscout init searches/<short-name> --city <city>` (use `--city nyc` for
  New York City so the NYC data modules switch on) and do the intake below.

## 2. Intake interview

Ask only what you cannot infer, in one or two rounds. Capture the answers in `criteria.yaml`:

| Topic | Field | Ask about |
|---|---|---|
| Place | `search.city`, `search.map_center` | City, neighbourhoods in or out |
| Dates | `search.move_in` | Earliest and latest lease start |
| Money | `budget.tiers`, `budget.hard_max` | Target, stretch and absolute limits, judged on monthly cost |
| Size | `unit.min_beds`, `unit.sqft_*` | Bedrooms, square feet that would feel small / good / great |
| Must-haves | `must_have` | Deal-breakers (in-unit laundry, elevator, pets, outdoor space...) |
| Preferences | `strongly_prefer`, `nice_to_have` | Doorman, gym, roof, pool, dishwasher, game room... |
| Commute | `commute.destinations` | Every regular destination, arrive-by time, max minutes, weight |
| Priorities | `weights` | Relative weight of cost, space, commute, amenities, light, building, quiet |

Amenity keys the scorer understands are listed in `apartmentscout/listings.py` (`AMENITY_KEYS`).
New keys are fine; they just need to appear in listings too.

Then run `apartmentscout geocode` (fills destination coordinates) and copy the printed
coordinates into `criteria.yaml`.

## 3. Source, enrich, score

1. Follow `listing-sourcing` to collect candidates into `listings.json`, then
   `apartmentscout validate && apartmentscout lint` and fix errors and high flags.
2. `apartmentscout geocode && apartmentscout commute && apartmentscout layers`.
3. `apartmentscout score` and `apartmentscout report`. Read `shortlist.md` yourself before
   presenting it: check that the top ten make sense and that no unit ranks high only because
   facts are missing (look at `confidence` and `range`).
4. Present the top candidates to the renter as a short table and ask which to research deeply.
   Set their `status` to `shortlist`.

## 4. Deep research on the shortlist

For each shortlisted unit, in this order:

1. `lease-and-fees`: pin down monthly cost and terms (cheap to do, often decisive).
2. `building-dossier`: records, reviews, management, ownership.
3. `noise-deep-dive` if the dossier or reviews flag noise, or the unit faces a busy street.
4. `unit-light-and-view` once floor and exposure are known (or to find the exposure).
5. `floor-plan-model` if a plan is available and light inside the unit matters.

Write findings to `research/<id>.md`, update the listing fields, rescore, rebuild the dashboard.

Drive this with `apartmentscout coverage`: it lists, in priority order, what each finalist is still missing
or holds only as a stale fact, how far each gap could move the ranking, and the exact questions to send
(`apartmentscout coverage --id <id>`; the same generator feeds the call sheets and
`templates/landlord-questions.md`). Say "not a market census" when you report coverage: it describes the
listings captured, not the market. A finalist is ready to decide on when its coverage row has no missing or
stale facts.

## 5. Decide

Use `tour-and-decide` to plan tours (including night visits), compare finalists in the
dashboard's Compare view, and write the decision memo.

## Keeping it current

Re-check availability and price of every `shortlist`/`touring` unit at least daily during an
active search. Record `checked` dates. Mark vanished listings `gone`, never delete them.

- `apartmentscout history diff` shows what changed since the last build (new, relisted, price, concession,
  status, gone); each build records a snapshot under `history/snapshots/`.
- Log what other people tell you with `apartmentscout history claim` (see `listing-sourcing`).
  `apartmentscout history show <id>` gives the availability ladder (potential, conditional, unverified,
  over_budget, late, rejected, gone, status_dispute), which is separate from the renter's workflow status
  and never changed by their favourites.
- Buildings worth watching for new units go under `watchlist:` in `criteria.yaml` with a `reason` and a
  `trigger` (what would make it worth reopening); see `docs/guides/research-quality.md#watchlist`.
