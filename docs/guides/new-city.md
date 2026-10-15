# Adding a city profile and data modules

You do not need any of this to search in a new city: [getting started](getting-started.md) takes you from nothing to a ranked
map in Boston, Chicago, Lisbon or anywhere OpenStreetMap and a transit agency have data. `apartmentscout init --city "<city>"`
looks the city up, sets its time zone and map centre, and offers its transit feed. This page is for going further: sharing your
setup as a **city profile**, and adding the pieces only a profile can switch on (building records, a noise layer, neighbourhood
filters). Pull requests for new cities are welcome.

## What works in any city, with no profile

| Feature | How |
|---|---|
| Geocoding | US Census geocoder (US), then OpenStreetMap Nominatim (worldwide). |
| City, time zone, map centre | `apartmentscout city "<city>"` (OpenStreetMap lookup; time zone from the nearest of ~100 reference cities in `config/city-timezones.csv`, which you can override with `--timezone`). |
| Commute heat maps and per-home times | Any city with a GTFS feed. `apartmentscout city --starter` adds the one we have checked (`config/transit-feeds.yaml`), `--feed URL` any other; the feed is tested before it is written. |
| 3D site model, sun and view | `apartmentscout surroundings`: OpenStreetMap buildings, heights from `height` or `building:levels` (a 10 m default otherwise), streets, parks, trees and water. The command reports how many heights are defaults and which building each home was matched to. |
| Floor plans | Same everywhere ([getting started, step 7](getting-started.md#7-adding-your-floor-plans)). |
| Place filters (east of Main St, near a park) | Streets and parks from OpenStreetMap; neighbourhoods need a dataset named in a profile (section 4). |
| Building records, violations, noise | Agent-researched (the `building-dossier` and `noise-deep-dive` skills), or a records module / layer (sections 2 and 3). |

## 1. A city profile

A profile is `config/cities/<id>.yaml`. The quickest way to start one is from a search that already works:

```bash
apartmentscout city "Chicago, IL" --starter --write-profile      # writes config/cities/chicago.yaml: time zone, map centre, OSM area, feeds
```

That is a *minimal* profile: `name`, `center`, `zoom`, `timezone`, `osm_area` (the OpenStreetMap relation, for reference) and
`transit_feeds`. `search.city: chicago` then picks it up, and `init --city chicago` copies the feeds and time zone into new
searches. To grow it, copy sections from `nyc.yaml`:

- `aliases` (what a renter may type for the city), `walk_model: network` and `station_entrances: osm`, a `walk_grids` street-grid fit
  for walking where the network model cannot be used;
- `listing_sites`, `review_sites` and `landmarks` (names for the tallest towers so the 3D view labels them, matched within 120 m);
- `places:` for neighbourhood polygons (section 4); `records:`, `buildings:` and `layers:` once the modules below exist.

Until a profile names a records or footprint module, the search runs on the generic modules, and `criteria --check` says so.

## 2. A records module (optional)

Add `apartmentscout/records/<city>.py` with:

```python
def build_dossier(listing: dict, ws, log=print) -> dict:
    """Return the same keys as records/nyc.py: building_info, hpd_violations (or code_violations),
    hpd_complaints (or service_requests), construction, noise_311, crime, summary."""
```

Most US cities publish on Socrata (`data.<city>.gov`) or ArcGIS Hub. Useful datasets: code enforcement cases, building permits,
311 service requests, police incidents, assessor parcels and rental registries. Then route `cmd_dossier` in `cli.py` to your module
when `search.city` matches.

## 3. A noise or nuisance layer (optional)

Mirror `layers.nyc_noise_layer`: page through the dataset inside the search bounding box, bin points into the same grid format,
and save `layers/<name>.json` with `kind: "noise"`.

## 4. Place filters (optional)

`apartmentscout places` builds `places.json` for the search's area from OpenStreetMap streets and parks, so "east of Main
Street", "between 3rd and 5th avenue" and "near Riverside Park" work in any city once the listings are geocoded. Add a
`places:` block to the city profile to improve it (the NYC profile is the worked example):

```yaml
walk_grids:                     # optional, but gives "north" for a tilted street grid and the study area for street names
  - {name: Manhattan, bearing_deg: 29, polygon: [[lon, lat], ...]}
places:
  neighbourhoods:               # an open dataset of neighbourhood polygons on Socrata (omit it to skip "in <neighbourhood>")
    socrata: <dataset id>
    name: <name column>
    geom: <polygon column>
    id: <code column>
    where: "<optional SoQL filter>"
  aliases: {ues: Upper East Side}          # nickname -> area or group name
  groups: {Midtown: [Area A, Area B]}       # a name that spans several areas
  street_merge: [[6th Avenue, Avenue of the Americas]]   # one street under several names (the first is shown)
  street_keep: [Avenue A]                   # short streets people still name
```

Streets outside the `walk_grids` polygons are dropped so a same-named street in another borough or town is not matched; without
one, every street in the search's bounding box is kept. See the methodology's *Place filters* for what is kept and how "east of"
is decided.

## 5. Sharing it

Run `python scripts/release_check.py` before you open a pull request. Keep a profile to public data and public URLs: no keys, no
private search folders, no personal paths.
