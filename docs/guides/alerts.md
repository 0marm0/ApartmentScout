# Alerts: new listings and price drops on your phone, with no server of your own

ApartmentScout can tell you when something changed in your search: a new home that fits your criteria, a price drop, a home that is
gone, a home that jumped into your top ten. There are three pieces, and none of them needs a server you run.

| Piece | What it does | Reaches your iPhone as |
|---|---|---|
| `apartmentscout alerts` | Compares your search now with the last run and writes a short digest (text and JSON). | Nothing by itself: it is the data the other two use. |
| **GitHub issue** (a scheduled workflow) | Runs the digest once a day and opens one issue, assigned to you. | A push notification from the **GitHub app**, even when ApartmentScout is closed. |
| **What's new** in the dashboard | The same digest as a calm panel, a dot on the menu button, a badge on the Home Screen icon and an optional notification. | What you see and the badge you get **when you open the app**. |

Web Push (a notification that wakes the installed app by itself) is a possible next step. It needs a push server, so it is not built;
see [Web Push, later](#web-push-later).

## What can be watched automatically, and what cannot

The rule behind every row: ApartmentScout never gets around a bot check or a CAPTCHA, never logs in, and never contacts anyone.

| Can be checked automatically | How |
|---|---|
| **Known units, on pages that allow it.** Price, concession, "no longer available", start date. | `apartmentscout monitor`: a building's own availability page, a management company's unit page or a broker's page, **only** on hosts you allowed (`monitor.allow_hosts`), one page at a time, robots.txt respected. See [monitoring](monitoring.md). A GitHub run can do the same re-read first (`APARTMENTSCOUT_MONITOR=on`). |
| **Whatever you or your agent add.** A new listing, a corrected price, `status: gone`, a unit's answered question. | Edit `listings.json` (or `apartmentscout import`, `apartmentscout monitor --apply`, `apartmentscout handoff import`), run `apartmentscout score`, commit and push. The digest reports the difference. |
| **Price history you add.** | A dated price you read yourself goes in as a claim (`apartmentscout history claim`) or into the listing; the digest sees it once the listing's price changes. |
| **Public records** (NYC: HPD, DOB, 311) | They describe a building, not a listing, and change slowly. `apartmentscout dossier` refreshes them; they feed scores, so a home can move rank when a dossier changes. |

| Cannot be checked automatically | Why |
|---|---|
| **New listings on StreetEasy, Zillow, Apartments.com, RentHop, Corcoran and similar portals** | They block automated reads, and ApartmentScout does not try to get past that. `monitor` never fetches them unless you name the host yourself, and a bot check ends that host for the run. Use the portals' own saved-search alert emails and have your agent (or you) add the units. |
| **Anything behind a login** (a leasing portal, a broker's private inventory) | No logins, no forms. |
| **A unit missing from a building page** | It is "unclear", not gone. |
| **Discovering buildings you have not listed** | The digest watches the homes in your search. Adding a building to the watchlist is your decision (`watchlist:` in `criteria.yaml`). |

So the honest summary: the daily issue tells you what changed **in the data in your repository**, plus whatever `monitor` could
read from pages that allow it. New inventory from the big portals still reaches ApartmentScout through you, your agent, or the
portals' own alert emails.

## The digest: `apartmentscout alerts`

```bash
export APARTMENTSCOUT_SEARCH=searches/my-search
apartmentscout score                      # the digest reads the scores in listings.json
apartmentscout alerts                     # print it and make now the new baseline (the first run only records the baseline)
apartmentscout alerts --no-save           # print it, change nothing
apartmentscout alerts --format md         # Markdown, as the GitHub issue shows it; --json for the data
apartmentscout alerts --json-out d.json --md-out d.md      # also write files
apartmentscout alerts --baseline old.json # compare with a saved state instead of the default
apartmentscout build                      # alerts.json for the dashboard's What's new panel
```

Example output:

```text
ApartmentScout: 1 new, 1 now fits, 2 price drops, 1 price rise, 2 more

Changes since Oct 14: 7.
434 homes tracked, 302 fit your criteria.

New homes that fit (1)
  Example Tower 31F (Carnegie Hill): $4,650 a month, ranked #39

Now fit your criteria (1)
  Example Court 2512: $4,650 a month, ranked #76 (was over budget before; down from $5,295)

Price drops (2)
  Platt House 14G (FiDi): $4,875 to $4,625 (-$250)
  Orion 23A: $5,000 to $4,895 (-$105)
...
```

| Group | Means |
|---|---|
| `new` | A home that was not in the baseline and fits your criteria now. New homes that do not fit are only counted ("N other new homes did not fit"). |
| `fits` | A known home that did not fit and does: a price drop under the budget, a must-have confirmed. It says what was in the way, and the price move if there was one. |
| `drops`, `rises` | The advertised rent moved. With the rent unchanged, a concession or fee the listing itself states can move the monthly cost (basis "monthly cost"). Fees the scorer only *estimates* never count, so re-scoring on its own is silent. |
| `gone`, `back` | A home that fit or is on your shortlist became unavailable (your own *rejected* is not news; a unit deleted from `listings.json` counts as gone) / a gone home is listed again. |
| `jumps` | A home that fit before, below the top, is now in the top 10 (`--top N`). A new or newly fitting home that lands in the top 10 shows its rank in its own group instead. |
| `resolved` | A question the score had to guess (price, monthly fees, lease term, a must-have, size) now has an answer. |

Price moves, gone homes and resolved questions are reported for homes that fit or are on your shortlist (`shortlist`, `touring`,
`applied`); `--all` reports them for every active home.

**The baseline** is `history/alerts/state.json`: a small record of every listing (status, whether it fits, rank, rent, cost, open
questions). `alerts` makes the current state the new baseline unless you pass `--no-save`; `build` never moves it. Each run also
writes `history/alerts/digest.json` and, when something changed, `digests/DATE.md` and `.json` (the last 30 are kept). The JSON
digest has `title`, `headline`, `counts`, `groups`, `tracked`, `fitting`, `since`, a stable `id` and `schema_version: 1`.

## Turn on phone alerts through GitHub (the GitHub app notifies you)

A scheduled GitHub Actions workflow, `.github/workflows/alerts.yml`, runs the digest every day at 12:17 UTC (8:17 in Boston in
summer time) and opens **one issue per day**, titled like `ApartmentScout: 3 new, 2 price drops`, assigned to you. The GitHub iPhone
app sends a notification when an issue is assigned to you. On a day with no changes it opens nothing. A second run on the same day
(a manual one) edits that day's issue and adds a short comment, which notifies you again.

**It is off until you turn it on.** The workflow does nothing unless the repository variable `APARTMENTSCOUT_ALERTS` is `on`, so
forks, the public example and this project's own CI never open an issue. It uses only the automatic `GITHUB_TOKEN`
(`contents: read`, `issues: write`) and no secrets of yours.

Do this once, in a **private** repository (an issue in a public repository is public; it lists homes and prices, nothing about you):

1. Make a private repository from this project (fork it and set it to private, or create one from a clone) and push your search
   folder to it. `searches/` is ignored by default, so add it on purpose: `git add -f searches/my-search` (or remove the
   `searches/*` line from `.gitignore` in your private copy). Keep `listings.json` scored: run `apartmentscout score` before you
   commit. Do not commit credentials, documents or anything you would not show a leasing office.
2. In the repository, **Settings, Secrets and variables, Actions, Variables**, add:

   | Variable | Value | |
   |---|---|---|
   | `APARTMENTSCOUT_ALERTS` | `on` | turns the workflow on |
   | `APARTMENTSCOUT_SEARCH` | `searches/my-search` | the search folder in the repository (that is the default) |
   | `APARTMENTSCOUT_MONITOR` | `on` | optional: re-read the allowed pages of your watchlist before the digest (same host rules as `monitor`) |
   | `APARTMENTSCOUT_ALERTS_ASSIGNEE` | your GitHub login | optional: who gets the issue (default: the repository owner; use this for an organisation) |

3. In the **Actions** tab, open "Alerts for new listings and price drops", press **Run workflow**. The first run only records the
   baseline and opens one issue, "ApartmentScout: alerts are on", so you can see the notification arrive.
4. On your iPhone, install the **GitHub** app, sign in, and in **Settings, Notifications** allow notifications. In the app's
   notification settings keep issue activity on for your assigned issues. Assigned issues notify you by default.

From then on, change data in the repository (you or your agent add listings and push, or `monitor` finds a changed page) and the
next daily run reports it. The baseline lives in the Actions cache, saved only after the issue step succeeds. If the cache is
cleared, or unused for seven days, the next run starts a fresh baseline ("alerts are on" again) and reports nothing that day.
GitHub may start a scheduled run a few minutes late, and turns schedules off in a repository with no activity for 60 days; pushing a
commit or pressing Run workflow wakes it.

To stop: delete the `APARTMENTSCOUT_ALERTS` variable (or set it to anything but `on`).

## In the app: What's new, the badge and an optional notification

`apartmentscout build` writes `alerts.json` beside the other dashboard data (the change since the baseline, or the last saved
digest while it is under two weeks old). The dashboard shows it:

- **A dot** on the top-right menu button when there is something you have not seen, and a **What's new** row in the menu's *This search* section
  with the count.
- **The panel**: a popover on a desktop, a bottom sheet on a phone. Each change is a row; tapping a home opens it. Opening the panel
  marks the digest as seen in this browser (the dot and the badge go away until the next digest).
- **The app badge** on the Home Screen icon (Badging API) where the browser supports it: set to the number of changes when the app
  opens with an unseen digest, cleared when you open the panel.
- **A notification, only if you press the button.** In the panel's "On this device" block, **Turn on** asks the browser for
  permission (never before) and remembers your choice. After that, opening the installed app on a digest you have not seen shows one
  notification, once per digest; tapping it opens What's new. **Turn off** stops it.

On an iPhone (iOS 16.4 or later) these need the app on the Home Screen: open the site in Safari, Share, **Add to Home Screen**, open it
from there, then use Turn on. The icon badge also needs that permission. In an ordinary Safari tab the panel and the dot work, and the
panel says to add the app to the Home Screen for the rest.

The honest limit: a Home Screen web app cannot wake itself to look for news. The badge and the notification appear when the app is
**opened** and finds an unseen digest, and the digest in the app is as new as the last deploy of your site. For an alert while the app
is closed, use the GitHub issue above.

## Web Push, later

A notification that arrives while the app is closed is Web Push. It needs a **push server**: the service worker subscribes through the
browser's push service, something must hold that subscription and send a signed (VAPID) message when a digest has changes. A small
function on a free tier of a serverless host could do it (the workflow would call it after `alerts`, passing the headline), but it
means a server you deploy, a private key to keep and subscriptions to store, which this project deliberately does not ask of you.
The pieces it would reuse already exist: the digest JSON, the service worker's `notificationclick` handler and the panel's opt-in
button. Until then, GitHub's own push does the job.

## Files

| File | What |
|---|---|
| `apartmentscout/alerts.py`, `commands/alerts.py`, `exports/alerts.py` | The digest, the command and the dashboard export. |
| `<search>/history/alerts/` | `state.json` (baseline), `digest.json`, `digests/DATE.{json,md}`. Private with your search. |
| `dashboard/data/alerts.json` | The digest the dashboard reads (`manifest.extra` lists it). |
| `.github/workflows/alerts.yml` | The opt-in daily workflow. |
| `dashboard/js/features/whatsnew.js`, `whatsnew-model.js`, `css/whatsnew.css` | The panel, badge and notification. |
