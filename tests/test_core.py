import datetime as dt
import io
import zipfile
from zoneinfo import ZoneInfo

import pytest

from apartmentscout.commute.gtfs import door_to_door, load_network, reverse_scan, StopIndex
from apartmentscout.config import DEFAULT_WEIGHTS
from apartmentscout.listings import infer_floor, monthly_cost, net_effective, normalize
from apartmentscout.score import score_listing
from apartmentscout.sun import Skyline, at, sun_position


def crit(**over):
    c = {"search": {}, "budget": {"tiers": [{"name": "Target", "max": 5000}, {"name": "Stretch", "max": 5200}],
                                  "hard_max": 5450},
         "unit": {"min_beds": 1, "sqft_floor": 450, "sqft_good": 750, "sqft_great": 1050},
         "must_have": ["in_unit_wd", "elevator"], "strongly_prefer": ["doorman", "gym"], "nice_to_have": [],
         "commute": {"destinations": [{"name": "Office", "max_minutes": 30, "weight": 1}]},
         "weights": dict(DEFAULT_WEIGHTS)}
    c.update(over)
    return c


def test_net_effective_and_monthly_cost():
    p = {"gross": 5250, "free_months": 1, "lease_months": 12}
    assert net_effective(p) == pytest.approx(4812.5)
    L = {"price": {**p, "fees_monthly": 35, "fees_one_time": 1200}}
    assert monthly_cost(L) == pytest.approx(4812.5 + 35 + 100)


def test_normalize_flat_fields_and_floor():
    L = normalize({"building": "The Knox", "unit": "13C", "rent": "$5,725", "in_unit_wd": "Yes - unit",
                   "doorman": "24h staffed", "exposure": "N, W"})
    assert L["id"] == "the-knox-13c"
    assert L["price"]["gross"] == 5725
    assert L["amenities"]["in_unit_wd"] is True
    assert L["amenities"]["doorman"] == "full-time"
    assert L["exposure"] == ["N", "W"]
    assert L["floor"] == 13 and L["floor_inferred"]
    assert infer_floor("1211") == 12 and infer_floor("PH") is None


def test_score_gates_and_unknowns():
    good = {"price": {"gross": 4900}, "sqft": 800, "amenities": {"in_unit_wd": True, "elevator": True,
            "doorman": "full-time", "gym": True}, "commute": {"Office": {"minutes": 14}}, "status": "new"}
    s = score_listing(good, crit())
    assert s["eligible"] and s["budget_tier"] == "Target" and s["overall"] > 60
    bad = {**good, "amenities": {**good["amenities"], "in_unit_wd": False}}
    assert not score_listing(bad, crit())["eligible"]
    pricey = {**good, "price": {"gross": 6000}}
    assert "over_budget" in score_listing(pricey, crit())["gates"]
    sparse = {"price": {"gross": 4900}, "status": "new"}
    s2 = score_listing(sparse, crit())
    assert s2["confidence"] < 50 and s2["range"][0] < s2["overall"] < s2["range"][1]


def test_sun_position_new_york_solstice_noon():
    t = dt.datetime(2026, 6, 21, 12, 57, tzinfo=ZoneInfo("America/New_York"))
    az, alt = sun_position(t, 40.7549, -73.984)
    assert alt == pytest.approx(72.7, abs=0.7)
    assert az == pytest.approx(180, abs=6)


def test_skyline_blocks_toward_tall_building():
    # 100 m tower, 20 m wide, 30 m north of the window at 10 m height
    site = {"b": [[100, 0, 0, [-10, 30, 10, 30, 10, 50, -10, 50]]]}
    sky = Skyline(site)
    prof = sky.profile(0, 0, 10)
    assert at(prof, 0) == pytest.approx(71.6, abs=0.6)   # atan(90/30)
    assert at(prof, 180) == 0


def _tiny_gtfs() -> bytes:
    files = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA,A,http://a,America/New_York\n",
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                        "WK,1,1,1,1,1,0,0,20260101,20261231\n",
        "routes.txt": "route_id,route_short_name,route_type\nR1,X,1\n",
        "trips.txt": "route_id,service_id,trip_id\nR1,WK,t1\nR1,WK,t2\n",
        # three stops 1 km apart going north; trains every 10 min
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS1,South,40.700,-74.0\nS2,Mid,40.709,-74.0\nS3,North,40.718,-74.0\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                          "t1,08:30:00,08:30:00,S1,1\nt1,08:33:00,08:33:00,S2,2\nt1,08:36:00,08:36:00,S3,3\n"
                          "t2,08:40:00,08:40:00,S1,1\nt2,08:43:00,08:43:00,S2,2\nt2,08:46:00,08:46:00,S3,3\n",
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def test_gtfs_router(tmp_path):
    p = tmp_path / "f.zip"
    p.write_bytes(_tiny_gtfs())
    speed, detour = 4.8 / 3.6, 1.25
    net = load_network([("f", p)], dt.date(2026, 10, 14), 6 * 3600, 9 * 3600, speed, detour)
    assert len(net.conns) == 4
    arrive = 8 * 3600 + 50 * 60
    prof = reverse_scan(net, 40.718, -74.0, arrive, speed, detour)
    # from S1 you must catch t2 at 08:40 to arrive 08:46 + 0 walk
    assert prof.ld[0] == 8 * 3600 + 40 * 60
    m, best = door_to_door(40.700, -74.0, prof, StopIndex(net), (40.718, -74.0), speed, detour, 1200, 0)
    assert best["mode"] == "transit" and m == pytest.approx(10, abs=0.5)
