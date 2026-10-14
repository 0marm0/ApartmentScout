# Landing page

The product site for ApartmentScout, published on GitHub Pages next to the live dashboard demo.
It is plain HTML, CSS and a little JavaScript: no framework, no build tools. It uses the same
design tokens as the dashboard (`dashboard/css/tokens.css`), so dark is native and light is a toggle.
The logo is the brand pin from `dashboard/assets/`, inlined in the nav and footer and coloured by
`--brand` and `--brand-tower`, so it follows the theme. Brand green is for the logo only; the UI
accent stays the tokens' `--accent`.

| File | What it is |
|---|---|
| `index.html` | The page: nav, hero, proof strip, features, agents, how it works, gallery, quick start, privacy, footer |
| `landing.css` | Page styles. Only token colours (and `color-mix` of them), self-hosted Geist (`fonts/`) |
| `landing.js` | Glass nav on scroll, theme toggle, copy buttons, gallery lightbox. The page works without it |

## How the site is assembled

`.github/workflows/pages.yml` copies files into `_site/` on every push to `main`:

| Published path | Source |
|---|---|
| `/` (`index.html`, `landing.css`, `landing.js`) | `landing/` |
| `/tokens.css` | `dashboard/css/tokens.css` |
| `/images/*.png` | `docs/images/*.png` |
| `/assets/*.svg` | `dashboard/assets/*.svg` (brand icon, favicon) |
| `/fonts/` | `dashboard/vendor/fonts/` (Geist and Geist Mono, `geist.css` and the OFL licence): the page makes no request to Google Fonts |
| `/demo/` | `dashboard/` as committed, with its example data |

It then replaces two placeholders in `index.html`: `__REPO__` becomes the repository URL
(`https://github.com/<owner>/<repo>`) and `__SITE__` becomes the Pages base URL (used for the
social preview image). If the page is ever served without that step, `landing.js` derives the
repository link from a `<owner>.github.io/<repo>/` address.

The result is published at `https://<owner>.github.io/<repo>/` with the dashboard demo at
`https://<owner>.github.io/<repo>/demo/`. The landing page and the demo share the theme choice
(`localStorage` key `as:theme`), so the demo opens in the theme picked on the landing page.

To turn it on: in the repository's settings, under Pages, set the source to **GitHub Actions**.

## Preview locally

Run the same copy step into a scratch folder and serve it:

```bash
rm -rf /tmp/as-site && mkdir -p /tmp/as-site/images /tmp/as-site/assets /tmp/as-site/fonts /tmp/as-site/demo
cp landing/index.html landing/landing.css landing/landing.js /tmp/as-site/
cp dashboard/css/tokens.css /tmp/as-site/tokens.css
cp docs/images/*.png /tmp/as-site/images/
cp dashboard/assets/*.svg /tmp/as-site/assets/
cp dashboard/vendor/fonts/* /tmp/as-site/fonts/
git ls-files dashboard | sed 's#^dashboard/##' | (cd dashboard && xargs -I{} rsync -R {} /tmp/as-site/demo/)
python -m http.server 8000 --directory /tmp/as-site --bind 127.0.0.1
```

`git ls-files` keeps local-only folders (private data, mockups) out of the preview, as the
published site does. Add `?theme=light` to the URL to open in the light theme.

## Screenshots

The page shows `map-commute.png` (hero), `mobile-map.png` (phone), `map-drawer.png`,
`shortlist.png`, `records.png`, `unit-orbit.png`, `unit-window-21.png`, `plan-bird.png` and
`compare.png` from `docs/images/`. Desktop shots are laid out as 16:10 (any taller shot is cropped
from the top) and the phone shot as 630 × 1350. Re-shooting them with `scripts/screenshots.py` under
the same names updates the landing page with no other change.
