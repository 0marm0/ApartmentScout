# Sync between your devices

Your picks, notes, tour findings and floor plan work are saved in the browser you used. This guide is about keeping them in step
between two browsers, typically the Mac you search on and the iPhone you tour with. There is no server of ours: the data goes
through **your own GitHub account** (a private gist) or through **a file you move by hand**, and you choose in **Menu > Data > Sync
across devices**.

Nothing is sent anywhere until you connect a gist or export a file. The app has no analytics and no telemetry.

## Set it up on your iPhone (about three minutes)

1. On the Mac, open the dashboard and choose **Menu > Data > Sync across devices**. Open GitHub's token page from the link in the
   panel and make a token: name it *ApartmentScout*, let it expire in a year, **Repository access: Public repositories**, and under
   **Account permissions** set **Gists** to **Read and write**. Leave everything else at *No access*. Copy the token, paste it into
   the panel and press **Connect and sync**. The app creates a *secret* gist in your account and sends your data.
2. On the iPhone, open the published dashboard in Safari and add it to the Home Screen (Share, then *Add to Home Screen*), then
   open it from there. (Use the Home Screen app, not a Safari tab: Safari clears the saved data of a site you have not opened for
   seven days, which would remove the token and anything not yet synced; the Home Screen app is exempt.)
3. Choose **Menu > Data > Sync across devices**. Paste the same token (send it to yourself in a password manager or Notes; do not
   email it) and press **Connect and sync**. The app finds your gist from the token alone, so there is nothing else to copy. Your
   picks, notes, numbers, tour findings and small copies of tour photos appear within a few seconds.
4. From now on both devices sync when you open them, a few seconds after every change, and when you come back to the app. The
   dot on the menu button and the line in the menu show the state: *Synced 2 min ago*, *Offline: will sync when you are back*.
   **Sync now** forces it.

If you would rather not use a token, choose **Sync file** instead: *Share or save to Files* on the first device (iCloud Drive
works well), then *Choose a sync file...* on the other one. Merging keeps the newest version of every item, so you can do it in
either direction as often as you like.

## What is synced, exactly

Sync works on **items**: one value at one place in the app's own browser storage. The list below is the complete registry
(`RULES` in `dashboard/js/sync/sync-model.js`); the panel shows the live counts under *What is synced*.

| Group | What an item is | Stored under |
|---|---|---|
| Picks | one field of one home: starred, tier, status, note, tour time | `picks` |
| Ranking weights and preset | one weight; the preset name | `weights`, `preset` |
| Compare | the list of up to four homes | `compare` |
| Tour findings | one field of one visit (rooms, noise, water, note, checks, promoted facts ...); one entry per photo (id, size, caption, time) | `findings:<search>` |
| Your numbers for unknowns | one number (size, price, fees, W/D, floor) with its day and source | `facts:<search>` |
| Decision history | one revision | `trail:<search>` |
| Leasing-office answers | one answer per home | `office:<search>` |
| Tour-day planner and checklist | the plan; one tick or note per home | `tourplan:<search>`, `tourday:<search>` |
| Search settings you edited in the browser | the applied profile; the commute mode and destination | `criteria:<search>`, `commute:<search>` |
| Floor plan studio | a layout, a light setup, the city options, extra furniture, the project library (one item per project), scenarios you sent to Unit 3D | `plan.*`, `plan-light.*`, `plan-city.*`, `furniture-extra.*`, `plan-projects.*`, `plan-scenario:*`, `compare-specs:*`, `unit-scenario-use:*` |
| View calibrations, model pins, measurements | one record per home | `view-cal:*`, `model-anchor:*`, `parts-assumed:*`, `measure.*` |
| Small copies of tour photos (optional) | one JPEG, at most 220 KB, up to 60 photos and 6 MB in all | `blob/...` |

**Never synced:** theme, accent, density, comfort switches, filters, list and panel layout, which rail sections are collapsed,
map layers, drafts, caches, the sync settings and **the token**. The listings, scores, plans and photos that ship with a search are
not yours: every device loads them from the page itself.

An item bigger than 500 KB (a very large traced plan) is not synced; the panel says how many items that is and they stay on the
device that has them.

## Where the data goes

- **Gist:** one secret gist in your GitHub account, written and read only through `api.github.com` (the code that does it is the
  single file `dashboard/js/sync/gist-client.js`). The data is a JSON document, cut into files of at most 800 KB because GitHub
  returns at most 1 MB of a gist file. Files are named `apartmentscout-sync.json`, `apartmentscout-sync-2.json` and so on.
- **File:** wherever you save it (Files, iCloud Drive, AirDrop, a USB stick).
- **Never:** ApartmentScout, an analytics service, or any other host. The page loads no third-party script for sync, and there is no
  Content Security Policy to widen: the site sets none, so `api.github.com` is simply the only host the sync code ever contacts. If
  you add a policy of your own, `connect-src https://api.github.com` is all sync needs.

### The honest limits of a secret gist

A secret gist is **unlisted, not private**: anyone who has its link can read it. The link is long and random, and the app never
shows or shares it, but treat it like a password. Your notes, numbers, tour findings and photo copies are in it, readable by
GitHub. If that is not acceptable, use the sync file instead, which goes nowhere you do not send it. You can delete the gist at
any time at gist.github.com; the devices keep their data.

### The token

- It is stored **only in this browser** (`localStorage`, key `as:sync.token`), separate from every setting and never inside synced
  data. Anyone who can open this browser on this device can read it. Use a token that expires and has **only the Gists
  permission** (the panel's steps do), and use a device lock.
- It is sent only in the `Authorization` header of requests to `api.github.com`: never in a URL, never in the synced data, never
  shown on the page after you paste it and never written to the console. **Remove token and disconnect** deletes it from the
  browser; revoke it at github.com/settings/personal-access-tokens when you stop syncing.
- A classic token with only the `gist` scope also works (the panel links to a pre-filled page). It is broader than a fine-grained
  one, so prefer the fine-grained token.

## How two devices are merged

Every item carries the **time it was last written** and the **device that wrote it**. Merging two copies keeps, per item, the
newest write. Items are small (a note, a star, one number), so edits to *different* things on two devices always both survive.

- **Same item on both:** the newer write wins on both devices. A tie (the same millisecond) is settled by device id, so every
  device reaches the same answer.
- **Deleting** is a write too (a tombstone). If you delete a note on the Mac and edit that note on the phone *later*, the edit
  wins and nothing is lost; if the edit was earlier, the deletion wins. An item that is merely *missing* from one copy is never
  treated as deleted. Tombstones are forgotten after 120 days; a device that was away longer than that could bring a deleted item
  back.
- **Clocks:** each device's clock never goes backwards and jumps past any time it has seen from another device, so an edit made
  after a sync is newer than what it replaced even if the phone's clock is a minute slow. A time more than a day in the future is
  treated as a wrong clock and ignored.
- **Offline:** changes are timestamped and queued in the browser first. Close the page, lose the network, or hit a GitHub error and
  they are still waiting; they are sent when the network returns, when you open the app, or with **Sync now**.
- **Rate limits and errors:** a GitHub pause (rate limit) is shown with the time it ends and honoured; a server error is retried
  with a growing pause; a revoked token, a deleted gist or a refusal stops syncing with a plain message and does not retry until
  you press **Sync now** or reconnect.
- **Two devices writing at the same moment:** GitHub gists have no compare-and-swap, so the later write can drop an item the
  earlier one added. Nothing is lost, because each device keeps its own copy and re-sends what the gist lacks on its next sync.

Photos: the entries are ordinary items. With *Include small copies of tour photos* on, each photo also travels as a JPEG copy (at
most 1280 px and 220 KB) so the other device can show it; the original stays where you took it. Deleting a photo removes its entry
and its copy everywhere. Turning the option off stops adding copies, and **Remove photo copies already on GitHub** deletes the
ones that are there.

## With `apartmentscout serve`

When the page is served by `apartmentscout serve`, **the search folder stays the source on the Mac**: tour findings and your
numbers are still written to `tours/<home>/findings.json`, `tours/<home>/photos/` and `renter_facts.json` as before. Sync merges
with the folder in both directions:

- What the folder holds (including a file you edited by hand) is read when the page opens, enters the browser's copy, and from
  there goes to the gist.
- What arrives from the gist is written through the local API into the folder, and photos that arrive as copies are stored in
  `tours/<home>/photos/` like a photo taken on the Mac.

Picks, weights and the other browser-only data live in the Mac's browser as before and travel through the gist.

## The sync file

*Export* writes `apartmentscout-sync-<date>.json`. It is a **picks backup with a `sync` block added**: `version: 2`, the
version-1 fields (`picks`, `weights`, `findings`, `facts`, `history`) that *Back up picks* has always written, and
`sync.items`, the items with their times. Older copies of the app that open it find their fields; the current app uses the
items.

```json
{
  "version": 2, "search": "My search",
  "picks": { "...": "version-1 fields, for older readers" },
  "sync": {
    "format": "apartmentscout-sync", "schema": 1, "device": "a1b2c3d4", "devices": { "a1b2c3d4": { "name": "iPhone", "at": "2026-10-15T09:00:00.000Z" } },
    "items": {
      "picks/<home>/note": { "t": "2026-10-15T09:00:00.123Z", "d": "a1b2c3d4", "v": "north light" },
      "picks/<home>/saved": { "t": "2026-10-15T09:05:00.000Z", "d": "a1b2c3d4", "x": 1 },
      "blob/findings:My search/<home>/<photo>": { "t": "...", "d": "...", "v": "data:image/jpeg;base64,..." }
    }
  }
}
```

*Import* accepts a sync file **or any picks backup, from any version**. A backup has no item times, so its items count as old:
anything you have changed since is kept, and anything you do not have yet is added. The result says how many items were new,
updated or removed and how many of your newer edits were kept.

## Troubleshooting

| You see | Meaning and fix |
|---|---|
| *GitHub does not accept this token* | It expired or was revoked. Make a new one and connect again (your data stays). |
| *This token is not allowed to use gists* | The token lacks the **Gists** permission (Read and write). |
| *GitHub cannot find the sync gist* | The gist was deleted, or this token cannot see it. Disconnect and connect again; the app makes a new one from this device's data. |
| *GitHub asked for a pause* | A rate limit. It resumes by itself at the time shown. |
| *Offline: will sync when you are back* | Nothing to do. |
| Photos missing on the other device | Copies are optional and capped (60 photos, 6 MB). The panel notes how many were left out. |
| The iPhone asks for the token again | Safari cleared a browser tab's data after a week without a visit. Use the Home Screen app, and connect again; your data comes back from the gist. |
| Something reset on one device | *Reset this browser's settings* in the start-up recovery card keeps your picks, findings, plans and sync connection; sync fills in anything else from the gist. |

For developers: the model and its tests are `dashboard/js/sync/sync-model.js` and `tests/js/sync.test.mjs`; the browser tests
(`tests/e2e/test_device_sync.py`) answer for `api.github.com` with `tests/e2e/fake_github.py` through Playwright routing and never
call the real API.
