#!/usr/bin/env bash
# Download the example search's full photo set (examples/nyc-2026/media, about 400 MB of WebP) from the GitHub release
# named in examples/nyc-2026/MEDIA_RELEASE. The set is not in git, to keep clones small; the repository carries a 34 MB starter
# set instead (examples/nyc-2026/media-lite) and the live demo publishes the full one, so the example works without running this.
# Run it for an offline full set, for the Pages build, or before regenerating the starter set. Delete media/ to get the space back.
#
#   scripts/fetch_media.sh            # needs the GitHub CLI (gh) signed in, or GH_TOKEN set (as in Actions)
#
# Updating the photos: run scripts/dedupe_media.py examples/nyc-2026, then
#   tar -C examples/nyc-2026 -cf media-<date>.tar media && gh release create media-<date> media-<date>.tar
# write the new tag into examples/nyc-2026/MEDIA_RELEASE, and regenerate the starter set (python scripts/make_media_lite.py
# examples/nyc-2026; docs/RELEASE_CHECKLIST.md, "Example photos").
set -euo pipefail
cd "$(dirname "$0")/.."
SEARCH=examples/nyc-2026
TAG=$(tr -d '[:space:]' < "$SEARCH/MEDIA_RELEASE")
if [ -d "$SEARCH/media" ] && [ -n "$(ls -A "$SEARCH/media" 2>/dev/null)" ]; then
  echo "$SEARCH/media already has photos; delete it to download again."; exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gh release download "$TAG" --pattern "$TAG.tar" --dir "$TMP"
tar -C "$SEARCH" -xf "$TMP/$TAG.tar"
echo "$(find "$SEARCH/media" -type f | wc -l | tr -d ' ') photos in $SEARCH/media (release $TAG)"
