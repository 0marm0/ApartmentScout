# Using ApartmentScout in another city

Everything except the NYC records module works anywhere.

| Feature | Outside NYC |
|---|---|
| Geocoding | US Census geocoder (US), then OpenStreetMap Nominatim (worldwide). |
| Commute heatmap | Any city with a GTFS feed. Add feeds under `commute.transit.feeds`. |
| 3D site model, sun and view | OpenStreetMap buildings via Overpass. Heights come from `height` or `building:levels`; check the nearest blockers and fix them in `sites/<id>.json` if OSM is missing them. |
| Floor plans | Same everywhere. |
| Building records | Agent-researched (see the `building-dossier` skill), or write a records module. |
| Noise layer | Write a layer for the city's 311 or noise-complaint dataset. |

## 1. A city profile

Create `config/cities/<city>.yaml` (copy `nyc.yaml`) with the timezone, GTFS feeds, listing and
review sites, and tall-building names for the 3D view. `apartmentscout init --city <city>` copies the
feeds and timezone into new searches.

## 2. A records module (optional)

Add `apartmentscout/records/<city>.py` with:

```python
def build_dossier(listing: dict, ws, log=print) -> dict:
    """Return the same keys as records/nyc.py: building_info, hpd_violations (or code_violations),
    hpd_complaints (or service_requests), construction, noise_311, crime, summary."""
```

Most US cities publish on Socrata (`data.<city>.gov`) or ArcGIS Hub. Useful datasets: code
enforcement cases, building permits, 311 service requests, police incidents, assessor parcels and
rental registries. Then route `cmd_dossier` in `cli.py` to your module when `search.city` matches.
Pull requests for new cities are welcome.

## 3. A noise or nuisance layer (optional)

Mirror `layers.nyc_noise_layer`: page through the dataset inside the search bounding box, bin
points into the same grid format, and save `layers/<name>.json` with `kind: "noise"`.
