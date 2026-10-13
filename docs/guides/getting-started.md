# Getting started

## 1. Install

```bash
git clone https://github.com/<you>/ApartmentScout.git
cd ApartmentScout
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e .
```

Python 3.10+. Dependencies: `requests`, `PyYAML`, `numpy`, `matplotlib`. No API keys are needed for
anything built in.

## 2. Look at the example

```bash
apartmentscout serve --search examples/nyc-2026
```

Your browser opens the dashboard with a real Manhattan search: 732 listings, a subway commute
heatmap, a 311 noise layer, 23 building dossiers, 3D site models and a floor plan.

## 3. Start your own search

```bash
apartmentscout init searches/my-search --city nyc     # or leave --city off outside NYC
export APARTMENTSCOUT_SEARCH=searches/my-search
```

Edit `searches/my-search/criteria.yaml`: budget tiers, must-haves, commute destinations, weights.
See [criteria](../../config/criteria.example.yaml) for every option.

## 4. Add listings

Three ways:

- **Ask your agent.** Open the repo in Claude Code, Cowork or Codex and say "help me find a
  one-bedroom near X under $Y". The agent reads `AGENTS.md` and the skills and does the rest.
- **CSV.** Fill `listings.template.csv` (one row per unit) and run `apartmentscout import file.csv`.
- **JSON.** Edit `listings.json` directly; see [data model](data-model.md).

## 5. Run the pipeline

```bash
apartmentscout all            # geocode, commute heatmap, city layers, score, build
apartmentscout dossier        # public records for every shortlisted unit (NYC built in)
apartmentscout site <id> --floor 12 --charts   # 3D site model, sun and view
apartmentscout report         # shortlist.md
apartmentscout serve          # dashboard
```

## 6. Publish your dashboard (optional)

The dashboard is static files. `apartmentscout build --out site/data` plus a copy of `dashboard/`
is a complete site you can host on GitHub Pages, Netlify or any web server. See
[dashboard](dashboard.md). Remember it will show your listings and notes to anyone with the link.
