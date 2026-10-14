# CLAUDE.md

Read `AGENTS.md` first: it is the operating guide for apartment research in this repository.

Claude-specific notes:

- Skills for every stage live in `.claude/skills/`. Start with `apartment-search`; it routes to the others.
- When a listing portal blocks automated reads, open it in the browser tool only if the renter asks,
  and let the renter handle any login or bot check. Never solve CAPTCHAs.
- A new search starts from `config/intake.yaml` (see the `apartment-search` skill); the renter can also use the
  dashboard's New search wizard or `apartmentscout init --interactive`. Validate with `apartmentscout criteria --check`.
- Keep the renter in the loop at the decisions that are theirs: criteria and weights, which units to
  tour, what to send to landlords. Draft messages; do not send them.
- After any change to `listings.json`, run `apartmentscout score && apartmentscout build` and
  offer to open the dashboard (`apartmentscout serve`).
- The working search folder is `$APARTMENTSCOUT_SEARCH` (default `./search`). The NYC example in
  `examples/nyc-2026` is read-only reference data; do not edit it while helping someone else.
