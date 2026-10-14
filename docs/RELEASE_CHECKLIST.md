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
  gate again: it scans `dist/` too.

## 6. Notices and attribution

- `THIRD_PARTY_NOTICES.md` matches what the dashboard loads (check `dashboard/index.html` and `dashboard/js/map.js`
  for new CDN libraries, fonts or tile sources).
- The map attribution control is visible in published screenshots.
- Wikimedia Commons photos show author and licence wherever they appear.

## 7. Last look

- `git status` is clean and `git diff origin/main` contains only what you mean to publish.
- No handoff packs (`*.zip`), exports (`*.xlsx`, `*.csv`) or adjudication folders sit in tracked paths.
- CI is green on the branch.
