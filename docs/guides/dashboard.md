# The dashboard

`dashboard/` is a static web app: plain HTML, CSS and ES modules, with Leaflet and three.js loaded
from public CDNs. There is no build step and no server code. It reads the JSON written by
`apartmentscout build` from `dashboard/data/`.

## Views

| Tab | What it shows |
|---|---|
| Map | Listing pins (coloured by score, budget tier or commute), commute heatmap per destination, 311 noise density, rent per ft² and score surfaces, filters and a ranked list. |
| Shortlist | Sortable table of every filtered listing with cost, size, commute, amenities and score. |
| Compare | Up to four listings side by side, a cost-against-size scatter of every eligible listing, and per-dimension score bars. |
| Unit 3D | The building and its neighbours in 3D with live sun and shadows, a camera at the window, a sun-path chart against the skyline, visible landmarks and direct-sun hours for every floor. |
| Floor plan | The unit's rooms in 3D with sun patches through the windows, blocked by neighbours when a site model exists. |
| Records | The public-records dossier with charts, plus the research notes for that building. |

## Run it

```bash
apartmentscout serve --search searches/my-search      # builds, serves and opens the browser
```

Or serve `dashboard/` with any static server after `apartmentscout build`.

URL options: `?data=path/to/data` loads another data folder, `?theme=dark`, `?layer=noise`,
`?open=<listing-id>` opens a listing; on the Unit 3D tab `?date=2026-12-21&min=780&floor=21&mode=window`.

## Host it

GitHub Pages: the workflow in `.github/workflows/pages.yml` publishes `dashboard/` (with the NYC
example data) on every push to `main`. To publish your own search instead, run
`apartmentscout build` locally, commit `dashboard/data`, and push. Anything in `data/` is public on a
public site, including notes, so build from a copy of your search without private notes if needed.

## Customise

Colours and fonts are CSS variables at the top of `dashboard/css/app.css` (light and dark).
Each view is one module in `dashboard/js/` and talks to the shared state in `app.js`
(`S.listings`, `S.crit`, `filtered()`, `openDrawer(id)`), so adding a view means one new module and
one tab link.

## Standalone file and dark mode

`apartmentscout build --standalone my-search.html` writes one self-contained HTML file with the
dashboard, its code and all data embedded. It opens with a double-click, in app preview panes and on
any host. The dashboard opens in dark mode; the button at the top right switches to light. Opening
`dashboard/index.html` directly as a file does **not** work (browsers block ES modules on file://), so
use `apartmentscout serve` or the standalone file.

After editing `dashboard/js/*.js`, run `scripts/bundle.sh` (Node + esbuild) to refresh
`dashboard/dist/app.bundle.js`, which the standalone build embeds.
