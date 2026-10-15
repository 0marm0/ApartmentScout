# Monitoring: re-check the watchlist and get a digest

`apartmentscout monitor` re-reads the pages of the listings you are watching, records what each page said on that
day, compares it with the previous reading, and writes a digest of what changed: price, concession, status
(gone or back), start date. It never contacts anyone, logs in, solves a bot check or edits `listings.json` unless
you ask (`--apply`).

```bash
export APARTMENTSCOUT_SEARCH=searches/my-search
apartmentscout monitor --dry-run             # the plan: which pages, which hosts are allowed or skipped; nothing fetched or written
apartmentscout monitor                       # the active units of every watchlist building
apartmentscout monitor --shortlist           # the shortlist / touring / applied units instead
apartmentscout monitor tower-12b tower-9a    # named listings
apartmentscout monitor --since 2026-10-10    # changes since the reading on or before that day (default: the previous reading)
apartmentscout score && apartmentscout build # the digest and history reach the dashboard
```

| Flag | What it does |
|---|---|
| `--dry-run` | Plan only: no network, nothing written. Reads the cache as it is, so it also shows what the last run found. |
| `--since DATE` | Compare with the reading on or before `DATE`. Without it: the previous reading; the first run compares with the listing's own record. |
| `--allow-host HOST` | Also fetch this host this run (repeatable). `monitor.allow_hosts` in criteria.yaml is the permanent list. |
| `--max-age-hours N` / `--refresh` | The cache window (default 12 hours) / ignore the cache. |
| `--offline` | No network: build the digest from the cache. |
| `--apply` | Also lay the fresh readings over `listings.json` (price fields, start date, a `gone` status; never a revival; `price.basis` becomes `unit_page`) and write today's snapshot. |
| `--pause S`, `--limit N`, `--json` | Seconds between requests (default 2), cap the pages, print the digest as JSON. |

## What it will and will not do

- **Allowed hosts only.** A page is fetched when its host is in `monitor.allow_hosts`, in `--allow-host`, or is the
  page of a watchlist entry. Every listing is read from the first of its pages on an allowed host (its own page, its
  `links.secondary` / `links.building_site`, then the entry's `url`). Known portals (StreetEasy, Zillow, RentHop,
  Apartments.com, Corcoran, CityRealty ...) block automated reads and are **never** fetched unless you name them
  yourself.
- **Bot checks end a host.** A challenge page, a 401, 403, 429 or 503, or a robots.txt `Disallow` stops that host for the
  run; the block is cached for the cache window and listed in the digest under "Skipped". Nothing tries again,
  works around it or signs in. When a site you need blocks, open the page yourself and paste what it says
  (`apartmentscout history claim`).
- **One page at a time**, with a pause, a User-Agent that can carry your contact (`APARTMENTSCOUT_CONTACT`), and robots.txt respected.
- **A page says only what it says.** A price comes from the page's structured data or from an amount followed by
  `/mo` or a rent word, never from a deposit or fee. On a building page only the text around the unit's label
  counts, and a unit that is not on the page is `unclear`, not gone. Several unrelated prices give no price.
  A 404 or 410 on a unit's own page is read as gone.
- **Cached.** Each URL's reading is reused for `--max-age-hours`; a re-run inside the window does not touch the host, and
  does not write the same claim twice.

## What it writes

Under `<search>/history/monitor/`: `observations.jsonl` (one line per page fetched), `cache/`, `digests/DATE.md` and
`.json`, and `digest.json` (the latest). Each change it finds is also appended to `history/claims.jsonl` (source =
the page, `method: "monitor"`, dated the day it was read), so it reaches `price_history`, the events list and the
availability ladder in `history.json` with no extra step. `apartmentscout build` copies `digest.json` to the dashboard
data folder; the schema is in the [data model](data-model.md#watchlist).

## Scheduling

The monitor is a plain command, so any scheduler works. These are examples to adapt; **nothing here is installed for
you.** Run it once by hand first and read the digest, then schedule it a few times a day at most (a listing page does not
change faster, and the cache stops repeat reads inside 12 hours).

cron (`crontab -e`), 8:15 and 17:15 on weekdays:

```cron
15 8,17 * * 1-5  cd /path/to/ApartmentScout && APARTMENTSCOUT_SEARCH=searches/my-search APARTMENTSCOUT_CONTACT=me@example.com .venv/bin/apartmentscout monitor >> searches/my-search/history/monitor/cron.log 2>&1
```

macOS launchd (`~/Library/LaunchAgents/com.example.apartmentscout-monitor.plist`, then
`launchctl load ~/Library/LaunchAgents/com.example.apartmentscout-monitor.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.apartmentscout-monitor</string>
  <key>WorkingDirectory</key><string>/path/to/ApartmentScout</string>
  <key>EnvironmentVariables</key><dict>
    <key>APARTMENTSCOUT_SEARCH</key><string>searches/my-search</string>
    <key>APARTMENTSCOUT_CONTACT</key><string>me@example.com</string>
  </dict>
  <key>ProgramArguments</key><array>
    <string>/path/to/ApartmentScout/.venv/bin/apartmentscout</string><string>monitor</string>
  </array>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>15</integer></dict>
    <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>15</integer></dict>
  </array>
  <key>StandardOutPath</key><string>/tmp/apartmentscout-monitor.log</string>
  <key>StandardErrorPath</key><string>/tmp/apartmentscout-monitor.log</string>
</dict></plist>
```

To stop: delete the crontab line, or `launchctl unload` the plist. The digest of the last run is always in
`history/monitor/digest.json`, and `apartmentscout monitor --offline --since YYYY-MM-DD` rebuilds a digest from the
cache without touching any site.
