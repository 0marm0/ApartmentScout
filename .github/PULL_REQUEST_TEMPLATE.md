## What and why

<!-- One or two sentences: what changes, and what problem it solves for a renter or a contributor. Link the issue if there is one. -->

## How I tested it

Run the tests that cover your change, from the repository root:

```bash
python scripts/test_changed.py            # unit, JavaScript and browser tests your change touches (against main)
python scripts/test_changed.py --list     # which ones it would run, without running them
```

Before asking for review, also:

```bash
pytest -q --ignore=tests/e2e -n auto      # unit tests
node --test tests/js/                     # JavaScript unit tests
APARTMENTSCOUT_E2E=1 pytest -q tests/e2e/<files about your change> -n auto --dist loadgroup   # browser tests
python scripts/release_check.py --skip-tests    # privacy, image manifest, ignore rules
```

- [ ] `python scripts/test_changed.py` passes
- [ ] I changed `dashboard/js/` and ran `bash scripts/bundle.sh`, and committed `dashboard/dist/app.bundle.js`
- [ ] I changed the example data and rebuilt `dashboard/data/` (`APARTMENTSCOUT_SEARCH=examples/nyc-2026 apartmentscout score`, then `build`)
- [ ] A new browser test is listed in exactly one shard of `.github/workflows/tests.yml` and waits on conditions, not fixed sleeps
- [ ] I updated the docs a user would read (`README.md`, `docs/guides/`, `AGENTS.md`) when behaviour changed
- [ ] The commit messages are conventional (`feat:`, `fix:`, `docs:`, `test:`, `chore:` ...)

## Privacy and data

- [ ] No private search data, `searches/` contents, personal photos, secrets or tokens, and no absolute local paths
- [ ] Screenshots are only added to `docs/images/` for the landing page or gallery, shot from the example data
- [ ] Anything that reads a listing site respects its terms: no CAPTCHA or bot-check bypass, no logging in, no contacting anyone for the renter

## Screenshots

<!-- For a visible change, a before and after from the example search (not a private one). -->
