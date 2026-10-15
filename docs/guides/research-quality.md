# Research quality

Four commands keep a search honest: `validate` (is the data well formed?), `lint` (does a listing look
better than it is?), `coverage` (what do we still not know, and does it matter?) and `history` (what
changed, and who said so?). They read the search folder and never touch the network.

```
apartmentscout validate                 schema and sanity checks; exit 1 on errors
apartmentscout lint                     listing traps, with code, severity, message and field
apartmentscout coverage                 completion standard, research queue, questions to ask
apartmentscout history diff             what changed since the last snapshot
apartmentscout history claim ID FIELD VALUE --source URL --claimed-at DATE
apartmentscout history show [ID]        availability ladder
```

`apartmentscout build` also writes `coverage.json`, `history.json` and `watchlist.json` for the
dashboard and records the day's snapshot (see [data model](data-model.md#history)).

## validate

Checks every listing against the [data model](data-model.md): required identity fields, enums
(`status`, `doorman`, exposure compass points, photo scopes, availability states), plausible ranges
(beds, baths, sqft, floor), duplicate ids, the same unit or unit page under two ids (unless declared in
`aliases`), URL schemes (only `http(s)` and relative `media/`, `photos/`, `plans/`, `research/` paths
without `..`, the same rule the dashboard's `safeUrl` applies), coordinates inside the search area
(`search.bbox` `[lon0, lat0, lon1, lat1]`, else `search.map_center` with `search.radius_km`, default 25),
a coordinate or BBL shared by three or more unrelated buildings (`shared_location`: a geocoder fallback, usually
from listings with a blank address; spellings of one address and units of one tower do not count),
impossible prices (non-positive, under $300, sale-sized, net above gross, a stated net that disagrees with
its own concession), future check dates, missing local files and stale ranks on gone listings. A
listings file may be a bare list or `{"schema_version": 1, "listings": [...]}`; a newer version than the
code understands is an error.

Errors exit 1 (`--strict` also fails on warnings), so `validate` can gate a script or a commit.

## lint

Each rule returns `{code, severity, message, field}`. Severity is `high` (likely wrong in a way that
changes the decision), `med` (check it) or `low` (worth knowing). Negations are respected ("no flex
walls allowed" is not a flex layout; "fitness studio" is not a studio).

| Code | Fires when |
|---|---|
| `junior_or_flex_1br` | A one-bedroom whose text says junior 1, flexed or convertible 1BR, pressurised wall, studio + alcove, converted studio, or "1 room"; a "flex 2" counted as two bedrooms. High when criteria need a bedroom. |
| `building_laundry_as_in_unit` | `in_unit_wd: true` but the text describes a laundry room, shared or building laundry, or hookups only. |
| `fee_is_price_drop` | A recorded fee equals a recent price drop (from `price_history`, received claims or "reduced by $X" text): the fee is probably the old price minus the new one. |
| `stale_or_cached_page` | The listing was never checked or was checked more than `quality.stale_days` (default 7) ago, or the evidence is a cached or crawled copy. An older crawl is not a fresh check. |
| `url_names_other_building` | The listing URL names a different house number (high on the same street, medium on another street, which may be an alias: record it in `address_aliases`) or a different unit. |
| `sale_not_rental` | A for-sale URL, a purchase-sized price or sale wording. |
| `challenge_page_evidence` | Captured text or a saved page under `research/snapshots/<id>/` is a bot check ("Just a moment...", CAPTCHA). Use `apartmentscout.quality.lint.is_challenge_page(text)` before saving any page. |
| `concession_expired_by_start` | The concession needs a lease start (`start_before`, `lease_start_by`, or "only for leases starting before 9/15") earlier than `search.move_in.earliest`, or the offer's `expires` / `sign_by` date has passed. |
| `plan_label_mismatch` | The plan is labelled for another unit (text "labeled Unit 9Y", `plan.printed_label`, or a plan JSON with `provenance.match: mismatch`). A line-only label ("J") is a low-severity representative plan. |
| `zero_fee_asserted` | A $0 fee with no `price.fees_basis` (`fee_schedule`, `lease_rider`, `written`, `owner_schedule`) or `price.fees_source`: an asserted $0 means unknown until a fee schedule is seen. |
| `concession_term_unstated` | Free months with no lease term (net unknown), or text that states "N months free" while no concession is recorded. |
| `doorman_overstated` | Doorman marked full-time but the text describes security, virtual or part-time staff. |
| `photos_not_this_unit` | Staged, model, sample or representative photos. |
| `no_unit_number` | An active listing without a unit number (an "indicative" ad). |

`lint` skips gone and rejected listings unless `--include-inactive` or `--id` is given. `--strict` exits 1
on any high flag.

## coverage

**Coverage describes the listings this search has captured. It is not a market census**: a source counted
here was searched, not exhausted, unless its sweep receipts reconcile.

The completion standard (what a finalist needs before the renter decides): gross rent, concession and
term, required monthly fees, one-time move-in costs, lease start date, size, the unit's own floor plan, an
enclosed bedroom (when `unit.min_beds` is 1 or more), confirmed must-haves, a stated floor, window
direction, photos or video of the unit itself, commute times, building records or reviews, and a recent
check. Rent, concession, fees, start date and status go *stale* when the listing's `checked` date is older
than `quality.stale_days`.

For every listing, `coverage` reports `have`, `missing` and `stale` facts, the questions to ask, lint
flags, and how much the gaps could move it: each missing fact is filled pessimistically and
optimistically and the listing is rescored with the search's own weights. `score_impact` is the overall
score swing in points; `rank_range` is the best and worst rank among the other eligible listings
(`null` worst = the pessimistic answer drops it out, for example unknown fees pushing it over the cap).
The assumed extremes are `quality.assumed_fee_monthly_max` (default 200) and
`quality.assumed_move_in_max` (default 2000); size runs from `unit.sqft_floor` to `unit.sqft_great`.

Priority: finalists with open facts first (status `shortlist`, `touring`, `applied`, a favourite, or rank
within `quality.finalists`, default 10), then listings that could reach the top if their gaps resolve
well, then the rest, then complete listings, then gone and rejected ones.

### Sweep receipts

Record each portal query in `research/sweeps.jsonl`, one JSON object per line:

```json
{"source": "StreetEasy", "query": "1BR, Manhattan below 96th, <= $5,450", "filters": "...",
 "observed_count": 50, "pages": 3, "pages_captured": 3, "unique_ids": 40, "duplicates": 5,
 "excluded": 4, "failed": 1, "checked": "2026-10-10"}
```

A receipt reconciles when every page was captured and `observed_count = unique_ids + duplicates +
excluded + failed`. A source is `complete` only when all its receipts reconcile, `partial` when some do,
`incomplete` when none do and `no receipts` when it was never logged. Coverage never calls a source
complete on any other basis.

## Questions

`apartmentscout/questions.py` is the one question generator: coverage, call sheets and the
[landlord questions template](../../templates/landlord-questions.md) use it.

```python
from apartmentscout.questions import questions, inquiry
questions(listing, criteria)   # [{"key", "group", "text"}], most decisive first
inquiry(listing, criteria)     # a ready-to-send message (written-confirmation items only)
```

Order: identity problems (wrong building, sale, no unit number), unconfirmed must-haves, flag-specific
questions (expired concession, building laundry, price drop), then missing and stale facts in standard
order, then tour tests. Groups are `confirm in writing`, `show me` and `tour test`. A known, fresh fact
never produces a question.

## History

`<search>/history/claims.jsonl` is append-only: one line per claim someone made about a unit.

```json
{"id": "tower-12b", "field": "status", "value": "gone", "source": "https://...", "source_kind": "portal_search",
 "claimed_at": "2026-10-08", "received_at": "2026-10-12", "method": "browser", "scope": null, "note": null,
 "logged_at": "2026-10-12T14:03:11"}
```

- `received_at` is the day the claim reached the search (we looked, or a message arrived).
- `claimed_at` is the day the source says the fact was true (the page's date, a partner's capture date).
  A writing or receipt date is never a check date: a claim without `claimed_at` is *undated* and can
  never outrank a dated one. The exception is our own look at a live unit or building page
  (`source_kind` `unit_page`, `building_site`, `leasing_office`, not `method: cached`): then the day we
  looked is the date.
- `field` is one of `status`, `gross`, `net`, `fees_monthly`, `fees_one_time`, `free_months`,
  `lease_months`, `available`, `sqft`, `concession`, `note`. Status values are normalised to `active`,
  `gone` (leased, in contract, off market...) or `unclear` (missing from a page is not gone).

Claims stored on a listing (`claims[]`, see the Money section of the data model) are read too, with
`observed_at` as `claimed_at`; `status: superseded` drops one.

### Availability ladder

Separate from the workflow `status` the renter sets, and never changed by a favourite tier:

| State | Meaning |
|---|---|
| `gone` | The latest dated gone evidence stands. An older or undated active claim never reactivates it. |
| `status_dispute` | A dated active claim is newer than the gone evidence: recheck before acting. |
| `rejected` | Screened out (status `rejected`). |
| `over_budget` | Monthly cost above `budget.hard_max`. |
| `late` | Available after `search.move_in.latest`. |
| `unverified` | Never checked, or last checked more than `quality.stale_days` ago. |
| `conditional` | A gate is open: unconfirmed must-have, unknown cost, or free months without a term. |
| `potential` | Active, in budget and window, gates confirmed. |

### Snapshots and diffs

`apartmentscout build` writes `history/snapshots/YYYY-MM-DD.json` (a rebuild the same day replaces it),
a compact fingerprint of status, prices, concession, available date and check date per listing. Turn it
off with `history: {snapshot_on_build: false}` in criteria.yaml; the bundled `examples/` are never
snapshotted. `apartmentscout history diff [--since DATE]` compares the current listings with the last
snapshot (before today, or on or before `DATE`) and lists new, relisted (same building and unit again, or
under a new id), price, concession, status and gone events, plus claims logged since. A changed available
date or price is a change, never a new listing.

## Watchlist

Buildings to watch for new units. Mark them in `criteria.yaml`:

```yaml
watchlist:
  - name: The Example Tower
    address: 1 Example St, New York, NY
    reason: Best layouts in the area; nothing in budget right now
    trigger: a 1BR at or under $5,000 with in-unit W/D
    url: https://example-tower.com/availability
    cadence: weekly          # daily | weekly | alert
    last_checked: 2026-10-01
```

or on any unit of the building in `listings.json`: `"watch": true` or
`"watch": {"reason": "...", "trigger": "...", "cadence": "daily"}`. Entries are merged by building.
`watchlist.json` adds every unit seen in the building, its last check and units that appeared since
then. `apartmentscout monitor` re-checks the watched units from their own pages and writes a digest of
what changed; see [monitoring](monitoring.md).

## For agents

- Run `apartmentscout validate && apartmentscout lint` after every batch of listing edits; fix errors and
  high flags before scoring.
- Before a call or email, take the questions from `apartmentscout coverage --id <id>` rather than
  writing new ones.
- When a source says something you cannot verify yourself (a partner sheet, an email, a cached page), log
  it with `apartmentscout history claim` instead of overwriting the listing.
- Never mark a listing active again on an older or undated claim; a newer one makes a `status_dispute`
  that needs a fresh look.
