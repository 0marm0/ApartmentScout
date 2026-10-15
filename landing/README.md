# Landing page

The product site for ApartmentScout, published on GitHub Pages next to the live dashboard demo.
It is plain HTML, CSS and a little JavaScript: no framework, and nothing to build to read or edit it (only the screenshots are converted to WebP when the site is assembled). It uses the same
design tokens as the dashboard (`dashboard/css/tokens.css`), so dark is native and light is a toggle.
The logo is the brand pin from `dashboard/assets/`, inlined in the nav and footer and coloured by
`--brand` and `--brand-tower`, so it follows the theme. Brand green is for the logo only; the UI
accent stays the tokens' `--accent`.

| File | What it is |
|---|---|
| `index.html` | The page: nav, hero, proof strip, how it works (agent, CLI, dashboard), a tour of the dashboard, the demo band, features, agents, the pipeline in detail, gallery, quick start, privacy, footer |
| `landing.css` | Page styles. Only token colours (and `color-mix` of them), self-hosted Geist (`fonts/`) |
| `landing.js` | Glass nav on scroll, theme toggle, the tour's tabs, copy buttons, gallery lightbox. The page works without it (the tour then shows every panel) |

The tour (`#tour`) is an ARIA tab set over six panels (map interactions, photos and the lightbox, decision tools, the new search wizard, light and 3D,
the installable app), each with a main screenshot, an inset, three points and a link to the same view in the demo. Without JavaScript the tabs are not
drawn and the six panels stack. The "Open the live demo" button is in the nav, the hero, the demo band and the closing section.

## How the site is assembled

`.github/workflows/pages.yml` runs `scripts/build_site.sh` on every push to `main`; run it yourself to get the same folder:

```bash
pip install Pillow                       # the screenshots are converted to WebP
NO_MEDIA=1 scripts/build_site.sh _site   # leave out NO_MEDIA to copy the 400 MB of example photos; needs Node for esbuild
python -m http.server 8000 --directory _site --bind 127.0.0.1
```

| Published path | Source |
|---|---|
| `/` (`index.html`, `landing.css`, `landing.js`) | `landing/` |
| `/tokens.css` | `dashboard/css/tokens.css` |
| `/images/` | the `docs/images/*.png` screenshots the page names, as WebP at full size and at 800 px (`scripts/landing_images.py` reads the page and writes only what it names), plus `og.jpg`, the 1200 x 630 social card |
| `/assets/` | `dashboard/assets/*.svg` (brand icon, favicon) and `dashboard/assets/pwa/` (app icons, used as favicons here too) |
| `/fonts/` | `dashboard/vendor/fonts/` (Geist and Geist Mono, `geist.css` and the OFL licence): the page makes no request to Google Fonts |
| `/demo/` | `dashboard/` with its example data, bundled, split and made installable by `scripts/optimize_site.py` (see the dashboard guide) |

It then replaces two placeholders in `index.html`: `__REPO__` becomes the repository URL
(`https://github.com/<owner>/<repo>`) and `__SITE__` becomes the Pages base URL (used for the
social preview image). If the page is ever served without that step, `landing.js` derives the
repository link from a `<owner>.github.io/<repo>/` address.

The result is published at `https://<owner>.github.io/<repo>/` with the dashboard demo at
`https://<owner>.github.io/<repo>/demo/`. The landing page and the demo share the theme choice
(`localStorage` key `as:theme`), so the demo opens in the theme picked on the landing page.

To turn it on: in the repository's settings, under Pages, set the source to **GitHub Actions**.

## Images and speed

The page names `images/<name>.webp` (and `images/<name>-800.webp` as the small step of a `srcset`); `scripts/landing_images.py` makes each from
`docs/images/<name>.png`, so re-shooting a screenshot under the same name updates the page with no other change, and the 1 MB PNGs stay for the README. Every
image has `width` and `height`, a descriptive `alt` and `loading="lazy"`, except the hero, which is preloaded with `fetchpriority="high"`. The first load is the
HTML, two small stylesheets, the Geist variable font and the hero (about 0.25 MB). `tests/e2e/test_landing_page.py` checks all of that, plus no sideways scroll
from 390 to 2200 px, no request to another origin, and axe-core (WCAG 2.1 AA) on every tour panel in both themes at phone and desktop widths.

## Screenshots

Hero and tour: `map-commute`, `mobile-map`, `map-route-preview`, `map-starred-lens`, `lightbox`, `lightbox-floor-plan`, `decision-tray`,
`share-decision-memo`, `wizard-basics`, `wizard-pick-on-map`, `unit-paramount`, `plan-light-tab`, `settings-menu`, `high-contrast`. Features and gallery:
`map-drawer`, `map-drawer-commute`, `map-3d`, `map-noise`, `shortlist`, `compare`, `research`, `research-media`, `tours`, `records`, `unit-orbit`,
`unit-window-21`, `unit-inside`, `plan-bird`. Desktop shots are laid out as 16:10 (any taller shot is cropped from the top) and the phone shot as 630 x 1350.
Re-shooting them with `scripts/screenshots.py` under the same names updates the landing page with no other change.
