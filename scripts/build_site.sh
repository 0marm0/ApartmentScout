#!/usr/bin/env bash
# Assemble the GitHub Pages site into a folder (default _site) exactly as .github/workflows/pages.yml publishes it.
#
#   scripts/build_site.sh [OUT]          # needs Node (esbuild via npx) for the optimised dashboard build
#   REPO_URL=https://github.com/me/app SITE_URL=https://me.github.io/app scripts/build_site.sh _site
#
# Layout (landing/README.md has the table):
#   /            landing/ (index.html, landing.css, landing.js)
#   /tokens.css  dashboard/css/tokens.css (shared design tokens)
#   /images/     the docs/images/*.png screenshots the landing page uses, as WebP (scripts/landing_images.py), plus og.jpg
#   /assets/     dashboard/assets/ (brand icon, favicon, app icons)
#   /fonts/      dashboard/vendor/fonts/ (self-hosted Geist, no Google Fonts)
#   /demo/       dashboard/ with its example data, bundled, split and made installable by scripts/optimize_site.py
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
PY="${PYTHON:-python3}"

rm -rf "$OUT" && mkdir -p "$OUT/images" "$OUT/assets" "$OUT/fonts" "$OUT/demo"
cp landing/index.html landing/landing.css landing/landing.js "$OUT/"
cp dashboard/css/tokens.css "$OUT/tokens.css"
"$PY" scripts/landing_images.py "$OUT/images"      # the screenshots the landing page names, as WebP (needs Pillow)
cp dashboard/assets/*.svg "$OUT/assets/"
cp -R dashboard/assets/pwa "$OUT/assets/pwa"      # the app icons: the landing page uses them as favicons too
cp dashboard/vendor/fonts/* "$OUT/fonts/"
cp -R dashboard/. "$OUT/demo/"
# listing photos of the example search (owner cleared; see docs/gallery/manifest.json policy)
if [ -d examples/nyc-2026/media ] && [ -z "${NO_MEDIA:-}" ]; then cp -R examples/nyc-2026/media "$OUT/demo/media"; fi   # NO_MEDIA=1: quick local build without the 400 MB of photos
# never publish private or scratch folders, even if they ever get committed
rm -rf "$OUT/demo/data-private" "$OUT/demo/_mockup" "$OUT/demo/dist"
# bundle and split the dashboard, slim its data, make it installable and available offline
"$PY" scripts/optimize_site.py "$OUT/demo"
if [ -n "${REPO_URL:-}" ] || [ -n "${SITE_URL:-}" ]; then
  sed -i.bak "s#__REPO__#${REPO_URL:-}#g; s#__SITE__#${SITE_URL:-}#g" "$OUT/index.html" && rm -f "$OUT/index.html.bak"
fi
touch "$OUT/.nojekyll"
