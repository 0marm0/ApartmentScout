# Apartment dashboard and modeling inventory — 13 October 2026

## Main application

The existing `dashboard/` application is the most complete local implementation. Its inspected manifest records 732 listings, eight site models, one floor-plan model and 23 dossiers. Source generation is not current rental verification. The running app was verified at http://127.0.0.1:8771/ and also at port 8765; do not assume port 8765 uniquely identifies the older Codex board.

New `dashboard/studios.html` provides a model library: exact-unit links into the current application plus preserved Codex tools. The top bar now links to it. Preserved tool links are local development URLs; their sources remain outside this repo and are not implicitly packaged for public deployment.

The older Codex board at `../NYC Apartment/site/codex_dashboard.html` now links to the library and exact matching ApartmentScout Unit 3D/Records pages. Its model links use an explicit identity crosswalk; no sister-unit geometry or score migration is inferred. Newer application criteria, scoring and `as:*` state remain separate from that board.

## Best capabilities already present

| Area | Implementation | Useful features |
|---|---|---|
| Map and research | dashboard/js/map.js, list.js, compare.js | Commute/noise/transit layers, sortable research inventory, grouped listings, comparisons and distributions |
| City, outlook and sun | dashboard/js/unit3d.js; unit/scene.js; unit/charts.js; sun.js | Listing-specific city masses, window lens and camera controls, sun paths, daily/monthly/floor charts, source/assumption captions |
| Floor plan | dashboard/js/plan3d.js; plan/ modules | Synced 2D/3D drag, furniture catalogue, doors, clearance/HVAC/TV checks, eye/walk camera, layouts and JSON/PNG/GLB export |
| Dossiers | dashboard/js/records.js; records/ modules | Public record ledgers, timelines, report outcomes and noise charts |
| Tours | dashboard/js/tours.js | Tiered picks, appointments, building grouping, nearest/time ordering and printable call sheets |

Eight inspected site IDs: atlas-38d, emerald-green-1211, henry-hall-23j, lana-condominium-11l, orion-condominium-43e, the-knox-13c, the-maybury-2204, townsend-14c. The current floor-plan model is emerald-green-1211.

## Preserved tools and authorship

The earlier project gallery explicitly attributes the generalized ApartmentScout app and two cloud artifacts to Claude. It identifies the two-plan furniture viewer, corrected Emerald city viewer and Knox obstruction study as Codex work. Do not present archive copies as independent new creations.

- Claude Emerald light/view artifact: https://claude.ai/artifact/ENmgfhZHb5ZHWqJ5jtiydu . Gallery describes skyline/landmark sun paths and floor/month comparisons.
- Claude layout artifact: https://claude.ai/artifact/VMQBrxYyNxoSWDPJdgxiX1 . Gallery describes split 2D/3D, furniture drag, door swings, clearances and TV sightlines.
- Both cloud URLs were attempted but were inaccessible to the web tool. Their source implementations are unverified; they have not been imported.
- Codex detailed furniture: `../NYC Apartment/site/floorplan-3d/`. The archive and starter copies have identical HTML hashes.
- Codex corrected Emerald: `../NYC Apartment/research/emerald_green_2026-10-05/model_1211/`. Locally vendored libraries and exportable west scenarios. Former east placements are rejected shared-boundary artifacts.
- Codex Knox: `../NYC Apartment/research/research_round9/knox_light_view_model.html`. Adjustable hypothetical obstacle diagram, not a surveyed 3D city model.

## Preserved Radius data worth carrying forward

The old Claude `site/index.html` / `data/site_data_board_v26.json` is a dated 208-building/469-unit snapshot with 352 watches, 212 missed listings and 197 local media files. It has detailed commute legs/night/cab/access, HPD/review/pest summaries, research gaps, conflicts and unit interior/light/noise rationales. Its hardcoded September clock, old price-heavy scorer, typical-unit footage and inferred fees must not replace current verified facts or preferences.

Potential further integrations: a source/date-labeled received-evidence adapter, dedicated historical changes/gone-fast view, exact-scope gallery filters, renewal questions and research-gap disclosures. Match canonical identities; keep conflicting assertions and unknowns. Compact earlier intake did not expose every original rationale or field.

Cloud-only `site_data_core.json`, `se_media.json`, `enrich3.py`, `build_xlsx.py`, `media.py`, `build_site3.py` and `commute2.py` were not found in inspected source homes. Do not claim their full pipeline/media collection has been recovered.

## Geometry and validation notes

The older Codex heatmap used unrotated coordinate scaling for a rotated Manhattan diagram. It is corrected using an affine transform checked against 208 source building-coordinate pairs, maximum residual 0.661 m. This fixes placement only; it does not validate the original commute-time model.

The generic studio, the corrected legacy Emerald scenario and the newer ApartmentScout model use different geometry and placement hypotheses. In particular the newer Emerald exposure is marked listing-derived while its window location remains assumed. Neither resolves the earlier orientation questions or establishes actual sunlight hours. Scene illumination settings are visual controls, not measured lux. Preserve the distinctions when comparing model outputs.

Bounded verification for the new integration: existing canonical dashboard validator passed (731 records, complete rankings, 1,087 media references); corrected map opened without JavaScript exceptions. Browser checks cover model-library navigation and current model views separately. No data rebuild, score replacement or saved-state migration was performed.
