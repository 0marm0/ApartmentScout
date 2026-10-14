#!/usr/bin/env bash
# Rebuild dashboard/dist/app.bundle.js after editing dashboard/js/*.js (needs Node; fetches esbuild with npx).
set -euo pipefail
cd "$(dirname "$0")/.."
npx --yes esbuild@0.24.0 dashboard/js/app.js --bundle --format=esm --minify --target=es2020 \
  --external:three --external:'three/addons/*' --outfile=dashboard/dist/app.bundle.js
echo "wrote dashboard/dist/app.bundle.js"
