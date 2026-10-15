# Example: Manhattan one-bedroom, fall 2026

A real search run with ApartmentScout and two AI agents, published as a worked example. Personal
details of the renter have been removed; everything else is as researched.

**Brief:** a one-bedroom in Manhattan for an October 15 to November 1 move-in. Must have in-unit
washer/dryer and an elevator; doorman and gym strongly preferred. Budget judged on monthly cost:
target $5,000, stretch $5,200, absolute $5,450. Door-to-door commute under 30 minutes to an office at
Grand Central, arriving by 9:00.

| File | Contents |
|---|---|
| `criteria.yaml` | The criteria above in ApartmentScout format. |
| `listings.json` | 732 units (430 active when last checked) with prices, amenities, review summaries, commute times, records and scores. |
| `history/claims.jsonl` | Dated price and status history taken from the research record: every point cites the file it came from, relative to the research folder (see [methodology](../../docs/guides/methodology.md#history)). Prices carry `price.basis`, `price.source` and `price.checked`. |
| `layers/commute-office.json` | Subway commute grid (150 m) to the office. |
| `layers/noise.json` | 311 noise complaints in the area over 12 months (335,923 requests). |
| `research/dossiers/` | NYC Open Data dossiers for the 23 shortlisted units. |
| `research/*.md` | Deep-dive notes: Emerald Green #1211 (due diligence, noise ledger, orientation audit, sound check) and Henry Hall (due diligence, reviews, 311). |
| `research/charts/` | Sun-path and sun-by-floor charts. |
| `sites/` | 3D site models for 8 finalists. |
| `media-lite/` | The starter photos (34 MB): a full gallery for the top twelve homes, one or two photos for every other home, every floor plan. The full 5,595-photo set is published with the demo (`search.media_base_url` in `criteria.yaml`); `scripts/fetch_media.sh` puts it in `media/` for offline use. See the [data model](../../docs/guides/data-model.md#where-a-saved-photo-comes-from-media-media-lite-media_base_url). |
| `plans/emerald-green-1211.json` | An approximate floor plan drawn from the listing's room sizes. |

Rebuild everything from this folder:

```bash
export APARTMENTSCOUT_SEARCH=examples/nyc-2026
apartmentscout all && apartmentscout dossier && apartmentscout site emerald-green-1211 --floor 12 --charts
apartmentscout serve
```

Prices and availability are a snapshot from late September and early October 2026; most of these
units have since been rented.
