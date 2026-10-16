<h1 align="center">ApartmentScout</h1>

<p align="center"><b>Know the apartment before you sign.</b><br>
Rank every listing on your own criteria and its true monthly cost, time the commute, read the building's records, and stand
inside the exact unit, with your own furniture, in the real city around it.</p>

<p align="center">
<a href="https://github.com/0marm0/ApartmentScout/actions/workflows/tests.yml"><img alt="Tests" src="https://github.com/0marm0/ApartmentScout/actions/workflows/tests.yml/badge.svg"></a>
<a href="https://github.com/0marm0/ApartmentScout/actions/workflows/pages.yml"><img alt="Pages deploy" src="https://github.com/0marm0/ApartmentScout/actions/workflows/pages.yml/badge.svg"></a>
<a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/0marm0/ApartmentScout?color=informational"></a>
<img alt="Python 3.10 or newer" src="https://img.shields.io/badge/python-3.10%2B-informational">
<img alt="No API keys, accounts or servers" src="https://img.shields.io/badge/API%20keys-none-success">
</p>

<p align="center">
<a href="https://0marm0.github.io/ApartmentScout/demo/"><img alt="Try the live demo" src="https://img.shields.io/badge/%E2%96%B6%20%20Try%20the%20live%20demo-12865f?style=for-the-badge"></a>
<a href="docs/guides/iphone.md"><img alt="Install on iPhone" src="https://img.shields.io/badge/%F0%9F%93%B1%20%20Install%20on%20iPhone-2b3140?style=for-the-badge"></a>
<a href="#quick-start"><img alt="Quick start" src="https://img.shields.io/badge/%E2%9A%A1%20%20Quick%20start-2b3140?style=for-the-badge"></a>
</p>

<p align="center">
<a href="https://0marm0.github.io/ApartmentScout/demo/"><img src="docs/images/walkthrough.webp" width="820" alt="A 20-second walk-through: the commute map over Manhattan, a ranked card opening into its drawer, Unit 3D around Paramount Tower, then standing inside the living room, walking to the window, and the same view as the sun sets over a lit night city"></a><br>
<sub>Map, card, drawer, then inside the unit: walk to the window and watch the day turn to night. <a href="docs/images/walkthrough.mp4">Watch it in full quality (MP4)</a>.</sub>
</p>

ApartmentScout came out of a real search for a one-bedroom in Manhattan: 738 listings in 260 buildings, and the same questions
for every finalist. What does it cost a month once fees and free months are counted? How long is the trip door to door? What do
the city's records say about the building? How loud is the street, and will the window see the sky or a wall? This repository
turns that process into agent playbooks, a Python command line and a dashboard you own, for any city, with that search included
as a worked example.

## What you can do

Five steps, in the order a search goes. The [gallery](docs/GALLERY.md) shows every screen.

| | Journey | What you get |
|---|---|---|
| 1 | **[Find](docs/GALLERY.md#find)** | Every listing ranked on **your weights and true monthly cost** (fees and free months counted, unknowns kept unknown). **Door-to-door commute** by walk, subway, bus or the best of them, from a built-in GTFS router. A map that merges homes into bubbles, previews a pin, and takes plain-words search ("east of 3rd ave under 5k with w/d"). Price drops, a price audit, and a plain-language reason for every rank move. |
| 2 | **[Compare](docs/GALLERY.md#compare)** | Up to four finalists row by row, the best value marked and unknowns never counted as the worst. Two units side by side in 3D with their own direct-sun hours. A trade-off pad to drag cost against commute and space, and **unknowns that move this score**: type the real size or fee and see the rank you would get. |
| 3 | **[See inside](docs/GALLERY.md#see-inside)** | **Unit 3D** puts you in the exact unit with the furniture you own, finishes read from the listing photos, and the real city through the glass. Walk to the window, play the day and the year (sun, shadows, seasons), see it at night, measure, test "does it fit?", match a listing photo. Floor plans traced from the listing's PDF. |
| 4 | **[Decide](docs/GALLERY.md#decide)** | Building dossiers from public records and a 311 noise layer (New York built in). Questions for the leasing office, drafted and never sent. A phone **tour day** with directions, a one-hand checklist and a noise check that keeps one number and no audio. A tour planner, a share page, a decision memo, a typeset decision report for two to four homes, and a move planner with a calendar file. |
| 5 | **[Set up](docs/GALLERY.md#set-up)** | Any city OpenStreetMap knows, by a wizard in the dashboard, an interview in the terminal, or your agent. Plain files in a folder you own. The dashboard installs as an app and works offline. Nine agent skills, and checksummed handoff packs between agents. |

## How it works

Three parts, all yours, all plain files in a folder. No account, server or API key sits between you and your data.

```mermaid
flowchart LR
  subgraph you [You]
    R(["Renter"])
    AG["Your agent<br/>Claude Code · Codex · Cursor"]
  end
  SK[["9 skills<br/>.claude/skills"]]
  OD[("Open data<br/>OpenStreetMap · NYC Open Data<br/>GTFS · Census · Wikimedia")]
  CLI["apartmentscout CLI<br/>import · geocode · commute<br/>dossier · surroundings · score"]
  SF[("Search folder<br/>criteria.yaml · listings.json<br/>research · plans · sites")]
  B["build"]
  DD["Dashboard data<br/>JSON"]
  D["Static dashboard<br/>Map · Shortlist · Compare · 3D · Research"]
  L["apartmentscout serve<br/>on your machine"]
  P["GitHub Pages<br/>installable, offline"]
  F["One HTML file<br/>or a read-only share page"]

  R --> AG
  R --> CLI
  SK -. playbooks .-> AG
  AG -->|runs| CLI
  OD --> CLI
  CLI <--> SF
  SF --> B --> DD --> D
  D --> L
  D --> P
  D --> F
```

| | What it does |
|---|---|
| **Your agent** | Open the repository in Claude Code, Codex, Cursor or any agent that reads [`AGENTS.md`](AGENTS.md). Nine [skills](.claude/skills) walk it through intake, listing sourcing, commutes, building dossiers, noise, light and view, floor plans, lease and fees, and tours. It checks its own data with `validate`, `lint` and `coverage`, and drafts messages to leasing offices without sending them. |
| **The CLI** | Every stage is one command over files in your search folder: `geocode`, `commute`, `dossier`, `surroundings`, `score`, `build`, `export`, `share`. Repeatable, scriptable, and offline once the data is pulled. |
| **The dashboard** | Map, Shortlist, Compare, 3D and Research in one static page with one menu. Serve it, host it on GitHub Pages, open it as a single HTML file, or install it as an app. |

The [methodology](docs/guides/methodology.md) covers the money model, the scoring formula, the commute router and its validation,
and the sun and skyline model, and says what each one leaves out.

## Quick start

**Look first.** The [live demo](https://0marm0.github.io/ApartmentScout/demo/) is the dashboard on the worked example, running in
your browser: 738 Manhattan listings (434 active) in 260 buildings, commutes to an office near Grand Central, 16 3D site models,
9 floor plans and 30 building dossiers. Or run it on your own machine:

```bash
git clone --depth 1 https://github.com/0marm0/ApartmentScout.git   # --depth 1: today's files, not the whole history
cd ApartmentScout
python -m venv .venv && source .venv/bin/activate
pip install -e .                                       # ".[xlsx]" adds the workbook export, ".[dev]" the test tools
apartmentscout serve --search examples/nyc-2026
```

**Then your own search**, from nothing to a ranked map in about 15 minutes, in any city
([the full walk-through](docs/guides/getting-started.md)). It asks for your **city** (looked up, so the time zone and map are
right), your **places** (addresses are found and confirmed) and your **transit timetable** (a starter feed is offered where one has
been checked):

<!-- quickstart -->
```bash
apartmentscout init searches/my-search --city "Chicago, IL" --interactive
export APARTMENTSCOUT_SEARCH=searches/my-search
apartmentscout import searches/my-search/listings.csv   # fill the listings.template.csv that init wrote, or ask your agent
apartmentscout validate && apartmentscout lint         # catch bad data and listing traps early
apartmentscout all                                     # geocode, commute by mode, layers, places, score, build
apartmentscout surroundings                            # fetch the buildings around each shortlisted home (3D, sun, view)
apartmentscout plans                                   # floor plans: which homes have one, and how to add one
apartmentscout serve                                   # open the dashboard on your own data
```

Prefer to click? Run `apartmentscout serve`, open the menu at the top right and choose *New search*: a wizard asks the same
questions and writes the same `criteria.yaml`. Prefer to talk? Open the repository in Claude Code, Codex or Cursor and say
"help me find a one-bedroom near X under $Y": the agent reads [`AGENTS.md`](AGENTS.md) and interviews you. Requires Python 3.10+.
Floor plans: [adding your floor plans](docs/guides/getting-started.md#7-adding-your-floor-plans).

## On your phone

The dashboard is an installable app. On an iPhone, open the demo in Safari, tap Share, then **Add to Home Screen**: it opens
full screen and keeps working with no signal. On tour day it gives you today's visits in order with directions, a checklist at each
home and a noise check. The steps, what works offline and what stays on the phone are in the
[iPhone guide](docs/guides/iphone.md).

## Privacy

- **Your search stays yours.** Searches live in `searches/`, which git ignores. Your criteria, notes, saved picks, visit answers and
  tour-day checklist stay on your machine, and in the browser's own storage on your phone. There is no account, no analytics and no
  ApartmentScout server.
- **What the network sees.** Building a search reads public sources (OpenStreetMap, NYC Open Data, the US Census geocoder,
  transit agencies' feeds, Wikimedia Commons). The dashboard's map loads tiles from OpenFreeMap and Esri imagery, like any web map.
  The landing page loads nothing from other sites.
- **The example data.** [`examples/nyc-2026`](examples/nyc-2026) is a real Manhattan one-bedroom search, lightly anonymised: public
  listings, public records and open data. It contains no renter identity, income or documents. The saved picks and visit notes in the
  gallery are sample entries. Listing photos belong to their owners; Commons building photos carry their licence and author.
- **Sites' rules are respected.** Agents are told to use official APIs and open data, never to bypass a CAPTCHA or bot check, never
  to log in, and never to contact a landlord without your say-so. When a portal blocks automated reading, the agent stops and asks
  you to open the page yourself.
- **Sync is off until you turn it on.** It then sends your picks, notes, numbers, tour findings, floor plan work and (optionally)
  small copies of tour photos to **a secret gist in your own GitHub account** (unlisted, so anyone with its link can read it) or
  to a file you move by hand, and nowhere else: no server of ours, no telemetry. The GitHub token stays in the browser on the
  device and is sent only to `api.github.com`. See [the sync guide](docs/guides/sync.md).
- **Reports are not findings.** 311 calls, complaints and reviews are shown as reports. Commute, sun, money and score numbers are
  estimates, and coverage is of the listings you captured, not a market census. Check the important ones in person.
- **Publishing.** A Pages site, a standalone file or a workbook shows your listings and notes to whoever has it. Run
  `python scripts/release_check.py` first.

## FAQ

<details>
<summary><b>Does it work outside New York?</b></summary>

Yes. Any city OpenStreetMap knows gets the map, geocoding, walking times, 3D site models, sun and view, floor plans and ranking;
add a transit timetable (GTFS) for commutes by subway and bus. Building-records automation and the noise layer are New York only
for now. Elsewhere an agent researches records with the `building-dossier` skill. `apartmentscout city "Your City"` shows what your
city has, and [adding a city profile](docs/guides/new-city.md) is a short YAML file. You can also
[request or offer a city](https://github.com/0marm0/ApartmentScout/issues/new?template=new_city.yml).
</details>

<details>
<summary><b>Where does the data come from, and under what licences?</b></summary>

NYC Open Data, the US Census geocoder, OpenStreetMap (ODbL), MTA and other agencies' GTFS feeds, Esri imagery and Wikimedia
Commons photos, with MapLibre GL, three.js, d3-contour and the Geist fonts. Each keeps its own licence and attribution; they are
summarised in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Keep the map attribution visible on anything you publish and show the
credit line with every Commons photo. Listings are what you or your agent capture, within each source's terms.
</details>

<details>
<summary><b>Do I need an AI agent, an API key or an account?</b></summary>

No. Everything built in uses free public data and needs no key. You can run the CLI and the dashboard by hand, or use the wizard.
An agent (Claude Code, Codex, Cursor, anything that reads `AGENTS.md`) is optional: it does the sourcing and research legwork.
</details>

<details>
<summary><b>Does it work offline?</b></summary>

Once your data is built, yes: the CLI works on local files, and the hosted dashboard installs as an app that keeps its shell, data
and the 3D models you have opened in the browser's cache. Map tiles and photos you have not opened need a connection. A single-file
build (`apartmentscout build --standalone`) opens with no server at all. Details:
[the dashboard guide](docs/guides/dashboard.md#install-it-and-use-it-offline).
</details>

<details>
<summary><b>Does it work on a phone?</b></summary>

Yes. The layout follows the screen, Unit 3D has a phone layout, and Tour day is built for one hand. Add it to your Home Screen to
use it offline: see the [iPhone guide](docs/guides/iphone.md) (Android: Chrome's *Install app* in the dashboard's Help menu).
</details>

<details>
<summary><b>Can it contact landlords or apply for me?</b></summary>

No. It drafts questions and emails for you to copy; nothing is sent from the page or by an agent unless you explicitly ask it to.
</details>

<details>
<summary><b>How accurate are the sun, view and commute numbers?</b></summary>

They are models, and the [methodology](docs/guides/methodology.md) says what each one leaves out (trees are context and never count
as shade; heights default where OpenStreetMap has none; a commute is a timetable estimate, not a live route). Unknowns stay
unknown and are listed so you know what to ask or check on a visit.
</details>

## Documentation

| | |
|---|---|
| Start | [Getting started](docs/guides/getting-started.md) · [The dashboard](docs/guides/dashboard.md) · [iPhone guide](docs/guides/iphone.md) · [Sync between devices](docs/guides/sync.md) · [Other cities](docs/guides/new-city.md) |
| How it is computed | [Methodology](docs/guides/methodology.md) · [Data model](docs/guides/data-model.md) · [Research quality](docs/guides/research-quality.md) · [Leasing-office questions](docs/guides/leasing-office-questions.md) |
| 3D and photos | [Floor plans](docs/guides/floor-plans.md) · [Photos](docs/guides/photos.md) · [Gallery](docs/GALLERY.md) |
| Agents | [AGENTS.md](AGENTS.md) · [Skills](.claude/skills) · [Agent handoff](docs/guides/agents-handoff.md) · [Monitoring](docs/guides/monitoring.md) · [Alerts on your phone](docs/guides/alerts.md) |
| Project | [Roadmap](docs/ROADMAP.md) · [Release checklist](docs/RELEASE_CHECKLIST.md) · [Design system](docs/design/design-system.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) |

The worked example, [`examples/nyc-2026`](examples/nyc-2026), has 738 listings, commutes on the MTA timetables, a 311 noise layer,
30 building dossiers, 16 3D site models and 9 floor plans. Its photos are in two sets (a 34 MB starter set in the repository, the
full set on demand): see [photos](docs/guides/photos.md). The site, with the demo at `/demo/`, is published by
`.github/workflows/pages.yml` on every push to `main`.

## Contributing

Issues and pull requests are welcome, especially city profiles, records modules, GTFS feed lists and better floor-plan tooling.
Start with [CONTRIBUTING.md](CONTRIBUTING.md) (set-up and tests), use the [issue forms](https://github.com/0marm0/ApartmentScout/issues/new/choose)
for a bug, a feature or a new city, and follow the [code of conduct](CODE_OF_CONDUCT.md). Before you open a pull request:

```bash
pip install -e ".[dev]"
python scripts/test_changed.py         # runs the unit, JavaScript and browser tests your change touches
```

To report a security problem privately, see [SECURITY.md](SECURITY.md). If you use the project in research, [CITATION.cff](CITATION.cff)
has a citation.

## Licence

MIT, see [LICENSE](LICENSE). Data from the sources above remains under its own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
