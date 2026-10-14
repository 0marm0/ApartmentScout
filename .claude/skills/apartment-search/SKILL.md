---
name: apartment-search
description: Run or resume a full apartment search with ApartmentScout - intake the renter's criteria, source listings, score, shortlist and route to the deeper research skills. Use when someone wants help finding, comparing or deciding on rental apartments.
---

# Apartment search (orchestrator)

## 1. Find or create the search

- If `$APARTMENTSCOUT_SEARCH` or `./search/criteria.yaml` exists, resume it: read `criteria.yaml`,
  run `apartmentscout criteria --check` and `apartmentscout score --top 20`, and summarise where things
  stand (counts by status, top 10, open questions) before doing anything else.
- Otherwise start a new search with the intake below. The renter can also do it themselves, with no agent,
  in the dashboard's **New search** wizard (top bar, then *New search*) or with
  `apartmentscout init searches/<name> --city <city> --interactive`. All three ask the same questions in the
  same order, from `config/intake.yaml`, and write the same `criteria.yaml`.

## 2. Intake interview

`config/intake.yaml` is the questionnaire. Read it first: it lists seven steps (basics, places, money, home,
amenities, building and interior taste, weights), and for every question the wording to use (`ask`), why it
matters (`why`), the default to use when the renter has no preference (`default`) and the `criteria.yaml` key the
answer goes to (`maps_to`). Follow it:

1. Ask in the file's order, one step or two at a time, in plain language. Skip what the renter already told you or
   what you can infer, and say which defaults you are assuming. Never invent an answer: an unanswered question takes
   its default. Only `search.name` is required.
2. Show the renter a one-screen summary of what you heard (budget tiers and cap, size, must-haves, places, the top
   weights) and let them correct it. Criteria and weights are theirs to decide.
3. Write the file through the CLI rather than by hand-editing the template:

   ```bash
   # put the answers in a criteria file (the layout of config/criteria.example.yaml), then
   apartmentscout init searches/<short-name> --city <city> --criteria answers.yaml
   apartmentscout criteria --check searches/<short-name>/criteria.yaml
   ```

   `init --criteria` validates the file with the scorer's own rules, refuses to write anything if it has problems,
   and adds the city's transit feeds and time zone when missing (`--city nyc` for New York City, so the NYC data
   modules switch on). To start from the commented template instead, leave `--criteria` off and edit the file.
   Fix every `error` that `criteria --check` prints; read the `warning` lines with the renter.
4. Building and interior taste (luxury level, renovated interior, new appliances, view, light, quiet) becomes
   weights through the table under `steps: taste` in the questionnaire: each answered item (0 not important to 3
   essential) sets the weight of its dimension, and the weights on one dimension add up. Unanswered items change
   nothing. Buildings the renter already has a view on go under `building_ratings` (building name to a rating from
   1 to 5); more can be added as the search goes on.
5. Run `apartmentscout geocode` (fills destination coordinates) and copy the printed coordinates into
   `criteria.yaml` if you want them pinned.

Amenity keys the scorer understands are listed under `amenities:` in the questionnaire (and in
`apartmentscout/listings.py`, `AMENITY_KEYS`). New keys are fine; they just need to appear in listings too.

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
