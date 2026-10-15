# Contributing

## Set up

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"            # pytest, pytest-xdist, Playwright, openpyxl, Pillow
python -m playwright install chromium   # only for the browser (e2e) tests
```

Node 22 is needed for the JavaScript tests (`node --test`) and for the tests that build the optimised site (esbuild runs through `npx`).

## Testing

**Before you commit, run the tests that cover what you changed:**

```bash
python scripts/test_changed.py            # your changes against main: committed, staged, unstaged and new files
python scripts/test_changed.py --list     # which tests that would run, and why, without running them
```

It maps changed paths to the unit, JavaScript and browser test files that cover them (a Python module to the tests that import it, a
dashboard file to the browser files in the table at the top of the script, a test file to itself) and runs the three groups side by side,
each in parallel. When it cannot tell which tests cover a path it runs the whole group, so a wrong guess costs time, not coverage. The full
suite runs in CI on every push and pull request; you do not need to run it locally.

The three suites on their own:

```bash
pytest -q --ignore=tests/e2e -n auto                                   # unit tests, about 15 s on 8 cores (35 s serial)
node --test tests/js/                                                  # JavaScript unit tests, a few seconds
APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e -n 8 --dist loadgroup    # browser tests: Chromium, headless, the example search
APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_lightbox.py         # one browser file, serially
```

`pytest-xdist` is optional: without it the same commands run in one process. For the browser tests use `--dist loadgroup`
(the default `load` also works, but then a file with an expensive module fixture is built once per worker that gets one of its tests).
`APARTMENTSCOUT_E2E=0` turns the browser tests off, `APARTMENTSCOUT_E2E_CPU_THROTTLE=6` slows every page down to about a GitHub runner,
`CI=1` selects software GL (SwiftShader) like the runners. See `tests/e2e/conftest.py`.

### Writing browser tests

Each xdist worker is its own process with its own Chromium, static server (a free port), temp folders and browser contexts, so tests
run in parallel as long as they follow a few rules:

* **Do not start Playwright yourself.** A second `sync_playwright()` in the same process fails inside the first one's event loop. Use the
  session `browser` (and `base_url`, `open_page`, `webgl`) from `conftest.py`.
* **No fixed ports, no shared folders.** Servers bind port 0 (`("127.0.0.1", 0)`), files go under `tmp_path` / `tmp_path_factory`.
  Service workers, storage and caches live in a browser context; make one per test (`open_page` does).
* **Never sleep for a fixed time.** Wait for the state the next assertion looks at: `page.wait_for_function(...)`,
  `wait_for_selector(..., state=...)`, or the helpers in `conftest.py`: `settled(page)` (the main thread is idle again),
  `frames(page)` (a `requestAnimationFrame` handler has run), `map_opened(page)`, `poll(fn, page)` (something outside the page, such as a
  file the local API writes), `until(page, js)` (an async predicate). A `wait_for_timeout` is right only when the test is about time itself
  (a debounce, an animation, "nothing happens").
* `wait_for_function` does not await a promise: an `async () => ...` predicate returned at once. `conftest.py` makes it await those, so
  `async (id) => (await import('/js/app.js')).S.sel === id` waits as it reads.
* Block foreign hosts with `block_foreign(ctx, base_url)`, not a Python handler that continues each request: a handler needs the test to be
  inside a Playwright call to answer, so a test busy in Python stalls its own page.
* A file with an expensive module-scoped fixture (a built site, a temp search) goes into `XDIST_GROUPED` in `conftest.py` so it stays on one worker.
* A new `tests/e2e/test_*.py` must be added to a shard in `.github/workflows/tests.yml`; the workflow fails when a file is in none.

## Pull requests

Conventional commit messages (`feat:`, `fix:`, `docs:`, `test:` ...). Run `python scripts/test_changed.py` before you push; CI runs the rest.
