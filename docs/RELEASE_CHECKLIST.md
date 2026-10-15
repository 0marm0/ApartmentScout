# Release checklist

Run through this before making the repository public, before each push to a public remote, and before publishing
the GitHub Pages site or a standalone dashboard.

## 1. Run the gate

```bash
pip install -e ".[dev]"                      # pytest, openpyxl
python scripts/release_check.py              # privacy, images, ignore rules, photos, pytest + node tests
```

It must end with `OK to release`. WARN lines do not block; read them anyway. With LibreOffice installed the test
run also recalculates an exported workbook and checks its scores against `score.py`.

Then run the browser suite (CI runs it too, in the `e2e` job):

```bash
python -m playwright install chromium        # once
APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e -q -rs
```

It opens all eight views, the drawer, the settings sheet and the command palette in dark and light at 1440 and
390 px with every non-local request blocked (so the map must show its offline basemap). It fails on any page error,
any console error other than a blocked tile or photo fetch, any view that shows "This view could not load",
anything wider than a 390 px phone, a broken key interaction (open a listing, switch commute mode, drag a weight,
add to compare, switch research tabs) or a **critical** axe-core violation. Serious axe violations are listed as
warnings: read them. About 2 to 3 minutes. Without Chromium installed the suite skips itself unless
`APARTMENTSCOUT_E2E=1`; `APARTMENTSCOUT_E2E=0` turns it off.

Two more checks run in CI and are worth running before a release that touched the dashboard:

```bash
NO_MEDIA=1 scripts/build_site.sh /tmp/as-site          # the Pages build: bundles, splits, stamps the service worker
python scripts/perf_check.py --site /tmp/as-site --check --cpu 1 --net broadband   # first-load budget (scripts/perf_budget.json)
APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_pwa.py tests/e2e/test_landing_page.py -q   # install, offline, update prompt, landing page
```

- After changing `dashboard/js/`, run `scripts/bundle.sh` so the standalone file embeds the current code. The published site does not
  use that file (`scripts/optimize_site.py` builds from `dashboard/js/`).
- Installable app: open the published `/demo/` once, choose Install, switch the network off and reload; the app must open with the
  search data and the pages you had visited. Then deploy again with a change and check that *A new version is ready* appears.
- The perf budget only moves down: tighten `scripts/perf_budget.json` when numbers fall, and say why when one has to rise.

## 2. Keep your private strings outside the repo

The privacy scan always looks for local home-directory paths and e-mail addresses. Add the strings only you know
are private (your name, employer, school, office address, a broker's phone number) to a file **outside** the repo:

```text
# ~/.config/apartmentscout/privacy-patterns.txt
Jane Example
re:\b425\s+Example\s+Ave\b
allow:Simpson St        # a public phrase that contains one of your strings (reported as info, never fails)
```

Point to another file with `--patterns FILE` or `APARTMENTSCOUT_PRIVACY_PATTERNS`. Hits are masked in the output.
The built-in allow-list covers two public names that share words with common private strings: the Simpson St
subway station and the Harvard Club building in the NYC footprints.

## 3. Review every image

`docs/gallery/manifest.json` lists every image in `docs/images/` and `docs/gallery/` with a `publication_status`:

| Status | Meaning |
|---|---|
| `public` | Reviewed: no listing photos, no traced owner plans, no named private units, attribution visible. |
| `review` | Needs a human decision (named units, traced plans, third-party renders). Blocks the release. |
| `private` | Never publish (for example a listing's own render). Blocks the release until the file is removed. |

New screenshots are blocked until listed. `python scripts/release_check.py --only images --add-new-images` adds
them as `review`; change the status by hand after looking at each one. A changed file (new sha256) is blocked
until it is reviewed again: update its `sha256` in the manifest only after you look.

## 4. Check what is ignored

These must never be committed, and the gate checks they are ignored: `searches/` (your searches),
`_reference/` (private references), `HANDOFF.md` (private session notes) and `dashboard/data-private/` (a private
search with photos). If the gate warns that one is ignored only through `.git/info/exclude`, that is fine on this
machine but a fresh clone would not ignore it.

## 5. Example data and photos

- The bundled example (`examples/nyc-2026/`, `dashboard/data/`) carries no listing photos, no `photos` or
  `photos_local` fields and no local photo copies. Charts under `research/charts/` are fine.
- Rebuild the example dashboard from `examples/nyc-2026` (`apartmentscout build --search examples/nyc-2026`), not
  from a private search.
- Rebuild the standalone file (`scripts/bundle.sh`, then `apartmentscout build --standalone dist/...`) and run the
  gate again: it scans `dist/` too. The file inlines MapLibre, three.js, pdf.js and the Geist fonts from `dashboard/vendor/`,
  so it opens with no network; only map tiles still need one.

## 6. Notices and attribution

- `THIRD_PARTY_NOTICES.md` matches what the dashboard loads and vendors (check `dashboard/index.html`,
  `dashboard/vendor/` and `dashboard/js/map.js` for new libraries, fonts or tile sources). A new
  `three/addons/...` import must be copied into `dashboard/vendor/three/addons/` (a test checks this).
- The map attribution control is visible in published screenshots.
- Wikimedia Commons photos show author and licence wherever they appear.

## 7. Last look

- `git status` is clean and `git diff origin/main` contains only what you mean to publish.
- No handoff packs (`*.zip`), exports (`*.xlsx`, `*.csv`) or adjudication folders sit in tracked paths.
- CI is green on the branch.

## Example photos

The example's photos come in three tiers with the same relative paths (the order the dashboard tries them is in
[the data model](guides/data-model.md#where-a-saved-photo-comes-from-media-media-lite-media_base_url)):

| Tier | Where | In the repository? |
|---|---|---|
| Full set (about 400 MB) | the GitHub release named in `examples/nyc-2026/MEDIA_RELEASE`; the Pages workflow downloads it with `scripts/fetch_media.sh` and publishes it at `/demo/media/` (the public photo host, `search.media_base_url`) | no |
| Starter set (34 MB) | `examples/nyc-2026/media-lite/`, built by `scripts/make_media_lite.py` | yes, capped at 40 MB by `release_check.py` |
| Full set on a disk | `examples/nyc-2026/media/`, filled by `scripts/fetch_media.sh` for anyone who wants it offline | no (ignored; safe to delete) |

**After adding or changing photos, or after a re-score** (the top twelve are chosen by `score.rank`):

1. Put the new files in `examples/nyc-2026/media/` (a machine that has deleted the folder runs `scripts/fetch_media.sh` first) and run
   `scripts/dedupe_media.py examples/nyc-2026`.
2. Upload a new tar as a new release (see the header of `scripts/fetch_media.sh`) and write its tag into `examples/nyc-2026/MEDIA_RELEASE`.
3. Regenerate the starter set from the full one: `python scripts/make_media_lite.py examples/nyc-2026`. It prints the size by tier
   (target at most 35 MB) and the listings that got a full gallery; it only rewrites files that changed. If the total is over,
   lower `--lite-quality` or `--gallery-px` rather than dropping photos.
4. `python scripts/make_media_lite.py examples/nyc-2026 --check` and `python scripts/release_check.py --only photos` must pass; CI runs both.
5. Commit `MEDIA_RELEASE`, `listings.json`, `dashboard/data` (`apartmentscout build --search examples/nyc-2026`) and `media-lite/` together.
   The Pages deploy that follows publishes the new full set.

Only the release and `media-lite/` matter to anyone else: the owner's own `media/` folder can be deleted after step 3.
