"""The commute heat grid (stamped surface = the router at every cell centre) and the land model (water is blank,
walks do not cross rivers). Synthetic feeds and polygons only; no network."""
from __future__ import annotations

import json
import math

import numpy as np
import pytest

from apartmentscout.commute.gtfs import access_points, load_network, reverse_scan
from apartmentscout.commute.grid import GridSpec, surface
from apartmentscout.commute.land import build_land, label_components, land_source, rasterize
from apartmentscout.commute.run import (_Router, decode_minutes, encode_minutes, run_commute, DEFAULT_OFFSETS)
from apartmentscout.config import Workspace

from test_commute_modes import ARRIVE, DAY, DEST, DETOUR, HOME, SPEED, feeds  # noqa: F401  (fixture)

def _square(lon0, lat0, lon1, lat1):
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]]}}


# a west island (the line of stops at lon -74.0 sits on it) and an east island across a ~500 m channel
WEST = _square(-74.006, 40.695, -73.996, 40.735)
EAST = _square(-73.990, 40.695, -73.980, 40.735)
LAND = {"type": "FeatureCollection", "features": [WEST, EAST]}


@pytest.fixture()
def router(feeds):  # noqa: F811
    net = load_network(feeds, DAY, 6 * 3600, ARRIVE, SPEED, DETOUR, log=None)
    offsets = [0, 4, 8]
    profs = {k: [reverse_scan(net, *DEST, ARRIVE - 60 * o, SPEED, DETOUR, modes=s, egress_access=1.0) for o in offsets]
             for k, s in {"subway": ("subway",), "bus": ("bus",), "transit": None}.items()}
    return _Router(net, profs, DEST, SPEED, DETOUR, 1200)


def test_grid_spec_bbox_is_the_cell_extent():
    spec = GridSpec.cover((-74.01, 40.69, -73.98, 40.74), 100)
    lo0, la0, lo1, la1 = spec.bbox
    assert lo1 >= -73.98 and la1 >= 40.74  # covers the requested box
    assert (la1 - la0) == pytest.approx(spec.rows * spec.dlat) and (lo1 - lo0) == pytest.approx(spec.cols * spec.dlon)
    la, lo = spec.centres()
    assert la[0] == pytest.approx(la0 + spec.dlat / 2) and lo[-1] == pytest.approx(lo1 - spec.dlon / 2)


def test_surface_equals_the_router_at_every_cell_centre(router):
    spec = GridSpec.cover((-74.012, 40.695, -73.988, 40.731), 120)
    s = surface(router.net, router.profs, DEST, spec, 1200, router.walker)
    la, lo = spec.centres()
    for r in range(0, spec.rows, 3):
        for c in range(0, spec.cols, 2):
            res = router.minutes(la[r], lo[c])
            for k in router.profs:
                assert s.minutes[k][r, c] == pytest.approx(np.mean([x[0] for x in res[k]]), abs=1e-6)
    assert s.walk_min[0, 0] == pytest.approx(router.walk_s(la[0], lo[0])[0] / 60, rel=1e-9)


def test_minutes_round_trip_through_the_layer_encoding():
    m = np.array([[0.0, 12.26, np.nan], [119.7, 30.5, 7.74]])
    layer = {"values_u8": encode_minutes(m), "scale": 0.5}
    assert decode_minutes(layer) == [0.0, 12.5, -1.0, 119.5, 30.5, 7.5]
    assert decode_minutes({"values": [3, -1]}) == [3.0, -1.0]  # older layers still read


def test_rasterize_and_landmasses():
    bbox = (-74.01, 40.69, -73.975, 40.74)
    land = rasterize(LAND, bbox, 25)
    lab = label_components(land)
    assert lab.max() == 2  # two islands, the channel keeps them apart
    L = build_land(LAND, bbox, 25)
    w, e, water = L.at(40.71, -74.0), L.at(40.71, -73.985), L.at(40.71, -73.993)
    assert w > 0 and e > 0 and w != e and water == 0
    assert L.at(40.71, -73.9955) == w  # 40 m off the west shore snaps to it
    assert not L.is_land(40.71, -73.9955)
    hole = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [
        [[-74.006, 40.695], [-73.996, 40.695], [-73.996, 40.735], [-74.006, 40.735], [-74.006, 40.695]],
        [[-74.003, 40.70], [-73.999, 40.70], [-73.999, 40.71], [-74.003, 40.71], [-74.003, 40.70]]]}}
    hl = rasterize({"type": "FeatureCollection", "features": [hole]}, bbox, 25)
    assert not hl[int((40.705 - 40.69) / (25 / 110574)), int((-74.001 + 74.01) / (25 / (111320 * math.cos(math.radians(40.715)))))]


def test_no_walking_across_water(router):
    net = router.net
    home_east = (40.7092, -73.985)  # on the east island, ~1.25 km straight across the channel from S2 / B2
    before = access_points(net, *home_east, 1300, SPEED, DETOUR)
    assert len(before.js) > 0
    net.set_land(build_land(LAND, (-74.01, 40.69, -73.975, 40.74), 25))
    try:
        after = access_points(net, *home_east, 1300, SPEED, DETOUR)
        assert len(after.js) == 0  # every stop is on the other island
        assert len(access_points(net, *HOME, 1200, SPEED, DETOUR).js) > 0  # the home island keeps its stops
    finally:
        net.set_land(None)


def test_land_source_defaults():
    assert land_source({"search": {"city": "nyc"}}).startswith("https://data.cityofnewyork.us/")
    assert land_source({"search": {"city": "nyc"}, "commute": {"transit": {"land": False}}}) is None
    assert land_source({"search": {"city": "elsewhere"}}) is None
    assert land_source({}, {"land": "x.geojson"}) == "x.geojson"


def test_run_commute_blanks_water_and_matches_listings(tmp_path, feeds):  # noqa: F811
    ws = Workspace(tmp_path)
    land_file = tmp_path / "land.geojson"
    land_file.write_text(json.dumps(LAND))
    crit = {"commute": {
        "destinations": [{"name": "Office", "lat": DEST[0], "lon": DEST[1], "arrive_by": "09:00", "max_minutes": 30}],
        "transit": {"service_date": str(DAY), "land": str(land_file),
                    "feeds": [{"name": "Subway", "path": str(feeds[0][1]), "mode": "subway"},
                              {"name": "Bus", "path": str(feeds[1][1]), "mode": "bus", "exclude_routes": ["^BxM"]}]}}}
    listings = [{"id": "a", "lat": HOME[0], "lon": HOME[1]}, {"id": "b", "lat": 40.7091, "lon": -74.0005}]
    run_commute(ws, listings, crit, cell_m=100, pad_m=600, log=lambda *_: None)
    g = json.loads((ws.layers_dir / "commute-office.json").read_text())
    assert g["cell_m"] == 100 and g["water_masked"] and g["arrival_offsets_min"] == DEFAULT_OFFSETS
    v = decode_minutes(g)
    lo0, la0, lo1, la1 = g["bbox"]

    def at(lat, lon):
        r = int((lat - la0) / (la1 - la0) * g["rows"])
        c = int((lon - lo0) / (lo1 - lo0) * g["cols"])
        return v[r * g["cols"] + c]

    assert at(40.71, -73.993) == -1  # the channel is blank
    assert at(40.71, -74.0) >= 0
    # the cell holding a listing is within a cell's walk of the listing's own minutes
    m = listings[1]["commute"]["Office"]["minutes"]
    assert abs(at(listings[1]["lat"], listings[1]["lon"]) - m) < 2.5


def test_commute_ids_must_name_listings_in_the_search(tmp_path):
    import json

    from apartmentscout.cli import main
    search = tmp_path / "s"
    main(["init", str(search), "--city", "nyc"])
    (search / "listings.json").write_text(json.dumps([{"id": "a-1", "building": "A", "unit": "1", "lat": 40.75, "lon": -73.98}]))
    with pytest.raises(SystemExit) as e:
        main(["commute", "--search", str(search), "--ids", "nope"])
    assert "No unique listing matches 'nope'" in str(e.value)


def test_run_commute_only_rejects_unknown_ids_before_any_work(tmp_path):
    from apartmentscout.commute.run import run_commute
    with pytest.raises(ValueError, match="none of the requested listing ids"):
        run_commute(None, [{"id": "a-1", "lat": 40.75, "lon": -73.98}], {"commute": {"destinations": []}}, only=["zzz"])
