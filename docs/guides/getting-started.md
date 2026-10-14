# Getting started

## 1. Install

```bash
git clone https://github.com/<you>/ApartmentScout.git
cd ApartmentScout
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e .                                      # add ".[xlsx]" for the workbook export, ".[dev]" for tests
```

Python 3.10+. Dependencies: `requests`, `PyYAML`, `numpy`, `matplotlib` (and `openpyxl` for
`export --xlsx`). No API keys are needed for anything built in.

## 2. Look at the example

```bash
apartmentscout serve --search examples/nyc-2026
```

Your browser opens the dashboard on a real Manhattan search: 732 listings with walk, subway, bus and
best-of-transit commutes to a Midtown office near Grand Central, a 311 noise layer, 213 licensed building
photos, 23 building dossiers, 8 site models for Unit 3D and a floor plan with furniture presets. Press
`?` for the keyboard shortcuts and `1`–`8` to move between the views (see [dashboard](dashboard.md)).

## 3. Start your own search

```bash
apartmentscout init searches/my-search --city nyc     # or leave --city off outside NYC
export APARTMENTSCOUT_SEARCH=searches/my-search       # or pass --search to every command
```

Edit `searches/my-search/criteria.yaml`: budget tiers, must-haves, commute destinations and modes,
a weight preset and any weights you want to change. See [criteria](../../config/criteria.example.yaml)
for every option and the [methodology](methodology.md) for what each weight does. `searches/` is
git-ignored, so the folder stays on your machine.

## 4. Add listings

Three ways:

- **Ask your agent.** Open the repo in Claude Code, Cowork or Codex and say "help me find a
  one-bedroom near X under $Y". The agent reads `AGENTS.md` and the skills and does the rest.
- **CSV.** Fill the `listings.template.csv` that `init` wrote into your search folder (one row per unit) and run `apartmentscout import file.csv`.
- **JSON.** Edit `listings.json` directly; see [data model](data-model.md).

Then check it:

```bash
apartmentscout validate       # schema, ranges, duplicates, URLs, coordinates, prices
apartmentscout lint           # listing traps: junior 1BR, building laundry, fee as a price drop ...
```

## 5. Run the pipeline

```bash
apartmentscout all            # geocode, commute by mode, city layers, score, build
apartmentscout coverage       # missing and stale facts, what they could swing, questions to ask
apartmentscout dossier        # public records for every shortlisted unit (NYC built in)
apartmentscout photos         # licensed building photos from Wikimedia Commons, with credits
apartmentscout site <id> --floor 12 --charts   # 3D site model, sun and view
apartmentscout report         # shortlist.md
apartmentscout serve          # dashboard
```

`serve` builds your search into its own cache folder (`<search>/cache/dashboard-data/`) and serves
it from there, so nothing from a private search is written into the repo. If you want listing photos
to keep showing after the listings come down, run `apartmentscout photos --cache` to save copies under
`<search>/media/`; `serve` maps them in. More in [research quality](research-quality.md),
[photos](photos.md) and [floor plans](floor-plans.md).

## 6. Take it with you

```bash
apartmentscout export --xlsx my-search.xlsx         # workbook: edit the weights, scores and ranks recalculate
apartmentscout export --csv my-search.csv
apartmentscout build --standalone my-search.html    # the whole dashboard in one file
apartmentscout handoff pack out.zip --to codex      # hand the search to another agent
```

The standalone file opens with a double-click and embeds all your data, so share it only with people
who should see your listings and notes. Handoff packs are explained in
[working with another agent](agents-handoff.md).

## 7. Publish your dashboard (optional)

The dashboard is static files. `apartmentscout build --out <copy-of-dashboard>/data` plus a copy of
`dashboard/` is a complete site you can host on GitHub Pages, Netlify or any web server. See
[dashboard](dashboard.md). It will show your listings and notes to anyone with the link, so run
`python scripts/release_check.py` and read [the release checklist](../RELEASE_CHECKLIST.md) first.
