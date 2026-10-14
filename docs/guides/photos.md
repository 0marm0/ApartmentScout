# Photos

Every card in the dashboard looks better with a picture, and a picture of the actual building helps a
renter remember which one it was. ApartmentScout keeps three kinds, in this order of preference:

1. **Listing photos** (`photos`): the unit itself, from the listing. Copyrighted by the portal, broker or
   landlord. Fine to look at in your own private search; never commit or publish them.
2. **Building photos** (`building_photos`): freely licensed photos of the building, or failing that of
   its block, each with its author, licence and a link back to the source. Safe to publish with credit.
3. **Aerial imagery**: the dashboard draws the map tile over the building when there is nothing else.

## Commands

```bash
apartmentscout photos                       # Wikimedia Commons building photos for every listing
apartmentscout photos gotham-west-536       # just these listings (the whole building is looked up)
apartmentscout photos --radius 40 --max 4   # tighter street radius, fewer photos per listing
apartmentscout photos --cache               # also save photos under <search>/media/ (private searches)
apartmentscout photos --source local        # only save photos, no Commons lookup
apartmentscout photos --source wikidata     # images of named towers from their Wikidata item
apartmentscout photos --source web          # listings with no photos: images from the listing's own page
```

Each run prints coverage: listings with listing photos, with building photos (of the building itself
or only its street), with either, and with neither.

`--cache` downloads the listing photos and the building photos into `<search>/media/<listing-id>/`
(a URL shared by several units is downloaded once and hard-linked), skips anything over 5 MB or not an
image, and records `photos_local` and `building_photos[].local`. `apartmentscout serve` maps `/media/`
to that folder for your own searches, so the dashboard keeps showing photos after the listing comes
down. The command refuses to cache inside `examples/`, which is committed.

## How Commons photos are chosen

Listings are grouped into buildings by location (about 10 m), so a tower with twenty units is looked
up once. For each building the MediaWiki API is asked for two things: files taken within `--radius`
metres (`geosearch`), and files within 400 m whose text mentions the house number or the building's
name (`nearcoord:` search). Commons coordinates are usually where the camera stood, not what it was
pointed at, so location alone proves nothing. A file is kept only when its words tie it to this
building:

| Scope | Evidence |
|---|---|
| `building` | Strong: the building's name in the file title, or this house number on this street in the title (camera within 250 m). Weaker, and only when the title is not about something else: a Commons category named after the building (within 250 m), this address as the first address the description gives, or a multi-word name opening the description. |
| `street` | Within `--radius` metres; the title names this street and nothing else but directions, cross streets, neighbourhoods and dates ("Looking east along 52d St", "Water Street in Lower Manhattan"); the photo names no other address. |

Dropped outright: maps, logos, plans, documents, interiors, people, vehicles, bicycles, animals, signs,
food, events, art, aerials, views *from* a building, construction sites, non-photo files, images under
600 x 400 px, photos whose title names a different address or a sibling ("One Waterline Square" for
building two), and photos whose title is about another building, shop, school, park or station.
One-word names ("The Cole", "Atlas") count only as a Commons category, because the bare word turns up
in too many captions, and names that are also neighbourhoods ("The Murray Hill") count only that way
too. Category- and description-only matches taken before 2012 are dropped: Commons files old photos
of a site under the name of the tower that later replaced them. A point shared by many different
addresses (a geocoder's fallback to the city centre) is skipped. The rule throughout: **no photo is
better than a wrong one.**

Results are best first: strongest evidence, then newer photos (in five-year steps), then the nearest
camera. Each run replaces the Commons entries and keeps entries from any other source.

API manners: a descriptive User-Agent, `maxlag=5`, one request at a time, backoff on 429 and 5xx,
and every response cached under `<search>/cache/photos/` so reruns cost nothing. Wikimedia allows
clients it cannot identify only 10 requests a minute: two requests and about 12 s per building, so the
215-building example took 43 minutes the first time and a second on every rerun. Set
`APARTMENTSCOUT_CONTACT` to an email address or a URL where you can be reached and it is added to the
User-Agent, which raises the limit to 200 a minute.

## More sources: Wikidata and listing pages

**`--source wikidata`** asks Wikidata (one SPARQL query per building, cached under `<search>/cache/photos/`)
for buildings with an image (P18) within 250 m. An item counts only when its label or an alias matches
the building's name, or its street address is this house number on this street. The item's image is then
read from Commons with its author and licence, and written to `building_photos` with
`source: "Wikidata / Wikimedia Commons"` and the item in `wikidata`. A file Commons already gave
the building is not repeated, a rerun replaces only the Wikidata entries, and `--max` caps the images per
building. These are licensed and credited like any Commons photo, so they may be used in the example search.

**`--source web`** is for private searches only. For each listing that has no `photos`, it does a plain GET of
the listing's own page (`links.listing`, then `links.secondary`) and reads the social-card
(`og:image`, `twitter:image`) and gallery images, skipping logos, icons, agents' headshots, maps and
thumbnails. A page whose URL names the unit stores its images in `photos`; a building, availability or
search page stores them in `building_photos` (`scope: building`, "private research copy"), because they
do not show this unit. A host that answers with a bot check or a block is reported once and not asked
again in that run; the command never solves CAPTCHAs, logs in or works around protection. Open the page
yourself and save what you want. Like `--cache`, it refuses to run inside `examples/`, because the images
belong to their owners.

## Licences and attribution

Commons hosts only freely licensed or public-domain files. Most building photos are CC BY or CC BY-SA:
you may show them anywhere, including a public dashboard, as long as you credit the author, name the
licence with a link, and link the source. ApartmentScout shows the thumbnail unaltered, so ShareAlike
asks nothing more. Public-domain and CC0 files need no credit; credit them anyway.

Render a credit line with every building photo, for example:

> Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons

where the author or "Wikimedia Commons" links to `page` and the licence links to `license_url`. Mark
`street` photos as the street, not the building ("On this block"). The repository's
`THIRD_PARTY_NOTICES` lists Wikimedia Commons as a source of hot-linked, separately licensed images.

## Privacy

- Listing photos, `photos_local` and everything under `<search>/media/` stay in your search folder,
  which is git-ignored. Do not copy them into `examples/`, `dashboard/data/` or any published build.
- Commons photos are public and licensed for reuse, so the committed example carries their URLs and
  credits (never the image files).
- Photos you take on a tour are yours: save them under `media/<id>/` and add the paths to `photos`.

## Adding photos found while sourcing

Agents often find better photos than Commons has: the building's own website, the management
company's gallery, a press release. Record them as `building_photos` entries with the exact scope
and where they came from:

```json
{"url": "https://building.example/gallery/facade.jpg", "page": "https://building.example/gallery",
 "author": "Building Example LLC", "license": "All rights reserved", "source": "Building website",
 "scope": "building"}
```

| Scope | Use when the photo shows |
|---|---|
| `exact-unit` | This unit (portal photos of the unit go in `photos` instead). |
| `same-line` | The same layout tier on another floor (`12B` photos for `7B`); views and light differ. |
| `building` | The outside, lobby or amenities of this building. |
| `street` | The block or the street outside, without this building as the subject. |
| `aerial` | An overhead or skyline view that picks out this building. |

Use `license: "All rights reserved"` for anything that is not openly licensed, and keep such photos
in private searches only. Never mark a photo `building` on location alone; if you cannot tell which
building it shows, leave it out.

## Limits

- Coverage is uneven. Landmarks and new towers are well photographed; ordinary walk-ups often have
  nothing. On the bundled example, 52 of 215 located buildings (201 of 732 listings) get a photo of
  the building itself and 12 more listings only a street photo.
- Commons coordinates are approximate, and descriptions can be wrong. Matching is conservative, so it
  misses some good photos rather than showing wrong ones.
- Building photos can be years old: scaffolding, new neighbours and renovations do not show. Show
  `year` next to the credit.
- Listing photo URLs expire. Run `--cache` soon after adding listings you care about.
