# Third-party notices

ApartmentScout is MIT licensed (see `LICENSE`). It bundles, loads or queries the third-party software, fonts,
map data and open datasets below. Each keeps its own licence and terms; follow them when you publish a dashboard,
screenshots or exports. This file is a summary, not legal advice: the linked terms are authoritative.

## Software

| Component | How it is used | Licence |
|---|---|---|
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) 4.7.1 | Vendored unmodified in `dashboard/vendor/maplibre-gl/` (JS, CSS and `LICENSE.txt`) for the dashboard map; inlined into standalone files | BSD 3-Clause. Copyright (c) 2023 MapLibre contributors; portions (c) Mapbox. |
| [three.js](https://github.com/mrdoob/three.js) 0.160.0 | Vendored unmodified in `dashboard/vendor/three/` (`three.module.min.js`, the addons `OrbitControls`, `GLTFExporter`, `TextureUtils`, `RectAreaLightUniformsLib` and, for the photo and video renderer, `EffectComposer`, `GTAOPass`, `UnrealBloomPass`, `BokehPass`, `OutputPass` with their shaders and `SimplexNoise`, and `LICENSE`) for Unit 3D and the floor plan studio; inlined into standalone files | MIT. Copyright (c) 2010-2023 three.js authors. |
| [pdf.js](https://github.com/mozilla/pdf.js) (pdfjs-dist) 4.10.38 | Vendored unmodified in `dashboard/vendor/pdfjs/` (`pdf.min.mjs`, `pdf.worker.min.mjs` and `LICENSE`); the plan tracer imports it only when a PDF plan is chosen; inlined into standalone files | Apache 2.0. Copyright Mozilla Foundation. |
| [d3-contour](https://github.com/d3/d3-contour) 4.0.2 and [d3-array](https://github.com/d3/d3-array) 3.2.1 | Bundled in `dashboard/vendor/d3-contour.js` for commute contours | ISC. Copyright 2012-2023 Mike Bostock. |
| [axe-core](https://github.com/dequelabs/axe-core) 4.10.3 (tests only) | Vendored unmodified in `tests/e2e/vendor/axe.min.js` with its `LICENSE`; injected into the dashboard by the browser test suite, never shipped in the dashboard | Mozilla Public License 2.0. Copyright (c) Deque Systems, Inc. Source: the axe-core repository and npm package. |
| [Playwright](https://github.com/microsoft/playwright-python) (development only) | Browser test suite (`tests/e2e/`) and `scripts/screenshots.py` | Apache 2.0. |
| [openpyxl](https://foss.heptapod.net/openpyxl/openpyxl) (optional) | `apartmentscout export --xlsx` | MIT. |
| Python dependencies (requests, PyYAML, NumPy, Matplotlib) | Installed by pip, not bundled | Apache 2.0, MIT, BSD 3-Clause and the Matplotlib licence (PSF-style) respectively. |

The ISC, BSD and MIT licences require their copyright notice and licence text to accompany copies of the
software. The bundled d3 file keeps its header, and each folder under `dashboard/vendor/` and `tests/e2e/vendor/`
holds the licence file of what it contains. A standalone dashboard built with `apartmentscout build --standalone`
inlines MapLibre, three.js, pdf.js and the Geist fonts; keep this file with it when you share it.

## Fonts

| Font | How it is used | Licence |
|---|---|---|
| [Geist and Geist Mono](https://github.com/vercel/geist-font) 1.7.2 (variable) | Vendored in `dashboard/vendor/fonts/` (`Geist-Variable.woff2`, `GeistMono-Variable.woff2`, `geist.css`, `LICENSE.txt`) for the dashboard and inlined into standalone files; the landing page serves the same files from `/fonts/` (copied by the Pages workflow), with no Google Fonts request | SIL Open Font License 1.1. Copyright (c) 2023 Vercel, in collaboration with basement.studio. |

## Maps and imagery

| Source | How it is used | Terms and attribution |
|---|---|---|
| [OpenFreeMap](https://openfreemap.org) vector tiles and glyphs | Default dashboard basemap | Free to use; tiles are built from OpenStreetMap. Show "OpenFreeMap © OpenStreetMap contributors". |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) data | Basemap content; building footprints and heights outside NYC (via Overpass); Nominatim geocoding | Open Database License (ODbL) 1.0. Attribute "© OpenStreetMap contributors". Respect the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) (one request per second, identify your app) and the Overpass instance's fair-use rules. |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Optional satellite layer | Esri terms of use. Attribute "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community". Not for bulk download or offline caching. |
| Esri World Light and Dark Gray Canvas | Fallback raster basemap when vector tiles are off or unreachable | Esri terms of use. Attribute "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors". |

Keep the attribution control visible on every published map view and on screenshots that show a basemap.

## Open data

| Source | How it is used | Terms |
|---|---|---|
| [NYC Open Data](https://opendata.cityofnewyork.us/) (PLUTO, Building Footprints, HPD violations and complaints, DOB permits and job filings, ECB violations, 311 service requests, NYPD complaints, CSCL street centerlines) | Building dossiers, noise layer, 3D site models | [NYC Open Data Terms of Use](https://opendata.cityofnewyork.us/overview/#termsofuse). Data is provided as is; cite the dataset and its ID (the site models record them). 311 and HPD complaints are reports, not findings. |
| [NYC GeoSearch](https://geosearch.planninglabs.nyc/) | Geocoding and BBL/BIN lookup in NYC | Built on NYC open data (PAD); same terms. |
| [U.S. Census Geocoder](https://geocoding.geo.census.gov/) | Fallback geocoding in the U.S. | U.S. government work, public domain. |
| [MTA GTFS feeds](https://new.mta.info/developers) (subway and buses) | Commute router, transit lines layer | MTA developer [terms and conditions](https://new.mta.info/developers/terms-and-conditions). You must accept them to download the feeds; do not imply MTA endorsement. Route colours are the MTA's. |
| Other GTFS feeds you add to `criteria.yaml` | Commute router | The publishing agency's licence. |

## Photos

| Source | How it is used | Terms |
|---|---|---|
| [Wikimedia Commons](https://commons.wikimedia.org/) | `apartmentscout photos` adds building and street photos with author and licence | **Per-image licences** (CC BY, CC BY-SA, CC0, public domain and others). Each entry in `building_photos` stores `author`, `license`, `license_url` and the file `page`; show the credit line with every image and link it to the file page. CC BY-SA images keep their share-alike terms when you adapt them. |
| Listing photos and floor plans from portals or landlords | Private searches only | Copyright belongs to their owners. They are never committed: `scripts/release_check.py` fails if photos appear in tracked example data. |

## Screenshots and gallery images

Images in `docs/images/` and `docs/gallery/` are ApartmentScout screenshots and renders. Their publication status
is recorded in `docs/gallery/manifest.json`; only images marked `public` may be published. Screenshots that show a
basemap carry the basemap attribution above.

## pdf.js (Mozilla)

Apache License 2.0. pdfjs-dist 4.10.38 (`pdf.min.mjs` and `pdf.worker.min.mjs`) is vendored unmodified in `dashboard/vendor/pdfjs/` with its `LICENSE`, and loaded only when a PDF floor plan is opened in the plan tracer; standalone files inline it. Copyright Mozilla Foundation. https://github.com/mozilla/pdf.js
