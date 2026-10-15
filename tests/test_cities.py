"""Setting up a search in a city that is not New York: the city lookup, time zone, starter transit feeds, the interview's
city, address and feed prompts, `apartmentscout city`, and the warnings for New York leftovers. No test touches the network:
the lookups are passed fakes (see tests/conftest.py)."""
from __future__ import annotations

import datetime as dt
import types
from pathlib import Path

import pytest
import yaml

from apartmentscout import cities as C
from apartmentscout import cli
from apartmentscout.commands import city as city_cmd
from apartmentscout.config import load_criteria
from apartmentscout.criteria_check import check_text
from apartmentscout.criteria_edit import add_transit_feeds, feeds_in
from apartmentscout.intake import Interview, Online, init_search, load_intake, next_steps, render_criteria, template_text

TODAY = dt.date(2026, 10, 14)
CHICAGO_ROW = {"place_id": 1, "osm_type": "relation", "osm_id": 122604, "lat": "41.8755616", "lon": "-87.6244212",
               "category": "boundary", "type": "administrative", "addresstype": "city", "name": "Chicago",
               "display_name": "Chicago, Cook County, Illinois, United States",
               "boundingbox": ["41.6439", "42.0230", "-87.9402", "-87.5240"],
               "address": {"city": "Chicago", "county": "Cook County", "state": "Illinois", "country": "United States", "country_code": "us"}}
PORTLAND_ME = {**CHICAGO_ROW, "osm_id": 1, "lat": "43.66", "lon": "-70.26", "name": "Portland",
               "address": {"city": "Portland", "state": "Maine", "country": "United States", "country_code": "us"}}


def fake_fetch(rows):
    return lambda url, params: rows


def chicago() -> C.CityInfo:
    info = C.lookup("Chicago, IL", fake_fetch([CHICAGO_ROW]))
    assert info is not None
    return info


# --------------------------------------------------------------------------- names, profiles, time zones
def test_lookup_turns_a_nominatim_row_into_a_city() -> None:
    c = chicago()
    assert (c.id, c.name, c.timezone, c.osm, c.country, c.state) == ("chicago", "Chicago, Illinois", "America/Chicago", "relation/122604", "us", "Illinois")
    assert c.center == [41.87556, -87.62442] and c.bbox == (-87.9402, 41.6439, -87.524, 42.023) and not c.profile


def test_lookup_returns_none_offline_or_without_a_match() -> None:
    assert C.lookup("Chicago", fake_fetch([])) is None
    assert C.lookup("   ") is None
    assert C.lookup("Chicago") is None, "the suite blocks the network: a failed request is None, not an exception"


@pytest.mark.parametrize("typed", ["nyc", "NYC", "New York", "new york city", "Brooklyn", "Manhattan, NY"])
def test_new_york_names_resolve_to_the_profile_without_the_network(typed: str) -> None:
    info = C.resolve_city(typed)
    assert info is not None and info.id == "nyc" and info.profile and info.timezone == "America/New_York" and info.center


def test_other_cities_are_not_mistaken_for_a_profile() -> None:
    assert C.match_profile("Chicago") is None and C.match_profile("Yorkshire") is None and C.match_profile("") is None


@pytest.mark.parametrize("name,lat,lon,tz", [("Boston", 42.36, -71.06, "America/New_York"), ("Chicago", 41.88, -87.63, "America/Chicago"),
                                             ("Denver", 39.74, -104.99, "America/Denver"), ("Seattle", 47.6, -122.3, "America/Los_Angeles"),
                                             ("Lisbon", 38.72, -9.14, "Europe/Lisbon"), ("Tokyo", 35.7, 139.7, "Asia/Tokyo"),
                                             ("Phoenix", 33.4, -112.0, "America/Phoenix")])
def test_time_zone_from_the_nearest_reference_city(name, lat, lon, tz) -> None:
    assert C.tz_for(lat, lon) == tz, name


def test_no_time_zone_in_the_middle_of_the_ocean() -> None:
    assert C.tz_for(0.0, -30.0) is None


def test_every_reference_zone_is_a_real_iana_name() -> None:
    assert all(C.valid_timezone(tz) for _, _, _, tz in C._tz_rows())


def test_slugs() -> None:
    assert C.slugify_city("São Paulo, Brazil") == "sao-paulo" and C.slugify_city("St. Louis, MO") == "st-louis"


# --------------------------------------------------------------------------- starter transit feeds
def test_starter_feeds_for_a_few_cities_and_none_for_others() -> None:
    boston = C.typed_city("Boston")
    assert [f["name"] for f in C.starter_feeds(boston)] == ["MBTA"]
    assert C.starter_feeds(chicago())[0]["url"].startswith("https://www.transitchicago.com/")
    assert C.starter_feeds(C.typed_city("Springfield")) == []


def test_a_shared_city_name_needs_the_right_state() -> None:
    oregon = C.CityInfo(id="portland", name="Portland, Oregon", lat=45.5, lon=-122.7, timezone="America/Los_Angeles", state="Oregon")
    maine = C.lookup("Portland, Maine", fake_fetch([PORTLAND_ME]))
    assert C.starter_feeds(oregon)[0]["name"] == "TriMet" and C.starter_feeds(maine) == []


def test_a_profile_city_gets_its_profile_feeds() -> None:
    assert len(C.starter_feeds(C.from_profile("nyc"))) == 3


def test_every_starter_feed_is_well_formed() -> None:
    data = yaml.safe_load(C.FEEDS_PATH.read_text())["cities"]
    for city, entry in data.items():
        for f in (entry["feeds"] if isinstance(entry, dict) else entry):
            assert f["url"].startswith("https://") and f["name"], city


class FakeResponse:
    def __init__(self, status=200, head=b"PK\x03\x04", size="12000000"):
        self.status_code, self._head, self.headers = status, head, {"content-length": size}

    def iter_content(self, n):
        yield self._head

    def close(self):
        pass


def test_a_feed_is_checked_by_its_first_bytes() -> None:
    ok = C.check_feed("https://x.example/gtfs.zip", lambda *a, **k: FakeResponse())
    assert ok.ok and ok.size_mb == 12.0 and ok.checked
    page = C.check_feed("https://x.example/developers", lambda *a, **k: FakeResponse(head=b"<!DOCT"))
    assert not page.ok and "web page" in page.detail
    assert not C.check_feed("https://x.example/g.zip", lambda *a, **k: FakeResponse(status=404)).ok
    assert not C.check_feed("not a url").ok


def test_an_unreachable_feed_is_kept_not_rejected() -> None:
    def down(*a, **k):
        raise C.requests.ConnectionError("down")
    r = C.check_feed("https://x.example/g.zip", down)
    assert r.ok and not r.checked


def test_a_local_zip_is_accepted(tmp_path: Path) -> None:
    z = tmp_path / "gtfs.zip"
    z.write_bytes(b"PK\x03\x04rest")
    assert C.check_feed(str(z)).ok
    z.write_bytes(b"hello")
    assert not C.check_feed(str(z)).ok
    assert C.feed_entry(str(z))["path"] == str(z) and "url" not in C.feed_entry(str(z))


# --------------------------------------------------------------------------- the interview in a new city
def online(geocoded: dict | None = None, feed_ok: bool = True) -> Online:
    return Online(resolve_city=lambda q: C.lookup(q, fake_fetch([CHICAGO_ROW])),
                  geocode=lambda addr, info: geocoded,
                  check_feed=lambda u: C.FeedCheck(feed_ok, "a zip file" if feed_ok else "that address is a web page, not a GTFS zip", 40.0))


def run_interview(answers, on=None, city=None):
    it = iter(answers)

    def ask(_p: str) -> str:
        return next(it)

    out: list[str] = []
    c = Interview(ask, out.append, TODAY, online=on, city=city).run()
    return c, out


def test_a_new_city_is_looked_up_and_sets_the_time_zone_map_centre_and_name() -> None:
    answers = ["Chicago 1BR", "Chicago, IL", "y", "", "", "", "", "",          # name, city, confirm, tz, earliest, latest, hard, map
               "y", "Work", "233 S Wacker Dr", "y", "", "", "", "",             # destination, found it: confirm, arrive, max, weight, mode
               "n",                                                             # another
               "y",                                                             # use the starter CTA feed
               ""]                                                              # no other feed
    answers += [""] * 40
    c, out = run_interview(answers, online({"lat": 41.87892, "lon": -87.636602, "label": "Willis Tower, Chicago"}))
    s = c["search"]
    assert (s["city"], s["city_name"], s["timezone"], s["map_center"]) == ("chicago", "Chicago, Illinois", "America/Chicago", [41.87556, -87.62442])
    d = c["commute"]["destinations"][0]
    assert (d["lat"], d["lon"], d["address"]) == (41.87892, -87.636602, "233 S Wacker Dr")
    assert c["commute"]["transit"]["feeds"][0]["name"] == "CTA"
    text = "\n".join(out)
    assert "Found Chicago, Illinois; time zone America/Chicago" in text and "no built-in city data" in text
    assert "Found: Willis Tower, Chicago" in text and "starter timetable feeds" in text


def test_the_written_file_has_no_new_york_left_in_it(tmp_path: Path) -> None:
    c, _ = run_interview(["Chicago 1BR", "Chicago, IL", "y", "", "", "", "", "", "n", "", ""] + [""] * 40, online())
    root = tmp_path / "chi"
    init_search(root, "chicago", render_criteria(c), info=chicago())
    rep = check_text((root / "criteria.yaml").read_text())
    assert rep.ok
    crit = load_criteria(root / "criteria.yaml")
    assert crit["search"]["timezone"] == "America/Chicago" and crit["search"]["map_center"][0] == pytest.approx(41.87556)
    assert not any("timezone" in w or "New York" in w or "map_center" in w for w in rep.warnings)


def test_a_city_that_cannot_be_found_is_asked_again_then_left_for_later() -> None:
    off = Online(resolve_city=lambda q: None, geocode=lambda a, i: None, check_feed=lambda u: C.FeedCheck(True, "x", None, False))
    c, out = run_interview(["Name", "Atlantis", "", "", "", "", "", "", "n", "", ""] + [""] * 40, off)
    assert any("I could not find 'Atlantis'" in line for line in out)
    assert c["search"]["city"] == "generic" and "city_name" not in c["search"]


def test_without_a_lookup_the_typed_city_is_kept_and_the_time_zone_is_asked() -> None:
    c, out = run_interview(["Name", "Lisbon", "Europe/Lisbon", "", "", "", "", "", "n", ""] + [""] * 40)
    assert c["search"]["city"] == "lisbon" and c["search"]["city_name"] == "Lisbon" and c["search"]["timezone"] == "Europe/Lisbon"
    assert any("no lookup here" in line for line in out)


def test_a_wrong_address_match_can_be_retyped() -> None:
    seen = []

    def geocode(addr, info):
        seen.append(addr)
        return {"lat": 1.0, "lon": 2.0, "label": "somewhere else" if len(seen) == 1 else "Willis Tower"}
    on = Online(lambda q: None, geocode, lambda u: C.FeedCheck(True, "x", None, False))
    c, _ = run_interview(["N", "generic", "", "", "", "", "", "y", "Work", "wacker", "n", "233 S Wacker Dr, Chicago", "y", "", "", "", "", "n", ""] + [""] * 40, on)
    assert seen == ["wacker", "233 S Wacker Dr, Chicago"] and c["commute"]["destinations"][0]["lat"] == 1.0


def test_a_pasted_web_page_is_refused_and_a_zip_is_added() -> None:
    answers = ["N", "generic", "", "", "", "", "", "n",                       # up to "add a destination?"
               "https://agency.example/developers",                            # a page: refused
               "https://agency.example/gtfs.zip", "Metro",                     # a zip and its name
               ""]                                                             # done
    pages = iter([False, True])
    on = Online(lambda q: None, lambda a, i: None, lambda u: C.FeedCheck(next(pages), "a zip file" if True else "", 5.0))
    c, out = run_interview(answers + [""] * 40, on)
    assert c["commute"]["transit"]["feeds"] == [{"name": "Metro", "url": "https://agency.example/gtfs.zip"}]


def test_a_profile_city_does_not_ask_for_feeds() -> None:
    c, out = run_interview(["N", "nyc"] + [""] * 3 + ["", "", "", "n"] + [""] * 40)
    assert "transit" not in c["commute"] and any("profile brings its 3 timetable feeds" in line for line in out)


def test_the_city_can_be_given_on_the_command_line_and_is_not_asked() -> None:
    c, out = run_interview(["Name"] + [""] * 6 + ["n"] + [""] * 40, online(), city=chicago())
    assert c["search"]["city"] == "chicago" and not any("Which city" in line for line in out)


# --------------------------------------------------------------------------- init and the template
def args(path: Path, **kw) -> types.SimpleNamespace:
    return types.SimpleNamespace(path=str(path), city=kw.get("city"), force=False, criteria=None, interactive=False,
                                 no_lookup=kw.get("no_lookup", False))


def test_init_with_a_city_name_looks_it_up_and_fills_the_template(tmp_path: Path, capsys) -> None:
    on = online()
    cli.cmd_init(args(tmp_path / "chi", city="Chicago, IL"), online=on)
    text = (tmp_path / "chi" / "criteria.yaml").read_text()
    s = yaml.safe_load(text)["search"]
    assert (s["city"], s["city_name"], s["timezone"]) == ("chicago", "Chicago, Illinois", "America/Chicago")
    assert s["map_center"] == [41.87556, -87.62442]
    out = capsys.readouterr().out
    assert "Next, in order" in out and "apartmentscout surroundings" in out and "apartmentscout plans" in out
    assert "walking only" in out, "the missing transit feeds are named up front"


def test_init_offline_says_what_it_could_not_set(tmp_path: Path, capsys) -> None:
    cli.cmd_init(args(tmp_path / "x", city="Lisbon"), online=Online(lambda q: None, lambda a, i: None, lambda u: C.FeedCheck(True, "", None, False)))
    text = (tmp_path / "x" / "criteria.yaml").read_text()
    assert "TEMPLATE DEFAULT" in text, "the New York time zone is flagged, not silently kept"
    assert "Could not look up 'Lisbon'" in capsys.readouterr().out


def test_template_dates_count_from_today_not_from_a_fixed_date() -> None:
    t = yaml.safe_load(template_text(None, today=dt.date(2031, 3, 3)))
    assert t["search"]["move_in"]["earliest"] == dt.date(2031, 3, 17) and t["search"]["move_in"]["latest"] == dt.date(2031, 5, 2)
    sd = t["commute"]["transit"]["service_date"]
    assert sd > dt.date(2031, 3, 10) and sd.weekday() in (1, 2, 3)


def test_next_steps_cover_listings_surroundings_and_floor_plans() -> None:
    steps = next_steps("searches/chi")
    assert [s["id"] for s in steps] == [a["id"] for a in load_intake()["after"]]
    ids = [s["id"] for s in steps]
    assert {"listings", "place", "surroundings", "floor_plans", "view"} <= set(ids)
    assert all("{search}" not in s["command"] and "searches/chi" in s["command"] for s in steps)
    fp = next(s for s in steps if s["id"] == "floor_plans")
    assert "New plan from image" in fp["why"] and "plans/<listing-id>.json" in fp["why"] and "3D" in fp["why"]


# --------------------------------------------------------------------------- criteria warnings for New York leftovers
BASE = """\
search: {name: X, city: chicago, timezone: America/New_York, map_center: [40.7549, -73.984]}
commute:
  destinations:
    - {name: Work, address: "1 Main St, Anytown", lat: 41.8789, lon: -87.6366}
"""


def test_new_york_leftovers_in_another_city_are_flagged() -> None:
    w = " | ".join(check_text(BASE).warnings)
    assert "placeholder" in w
    assert "timezone is America/New_York" in w and "America/Chicago" in w
    assert "New York default" in w and "km from your first destination" in w
    assert "feeds is empty" in w


def test_a_clean_new_city_search_has_only_the_no_profile_note() -> None:
    ok = BASE.replace("America/New_York", "America/Chicago").replace("40.7549, -73.984", "41.8756, -87.6244").replace("1 Main St, Anytown", "233 S Wacker Dr")
    ok += "  transit:\n    feeds: [{name: CTA, url: 'https://x.example/g.zip'}]\nbudget: {hard_max: 3500}\n"
    warnings = check_text(ok).warnings
    assert len(warnings) == 1 and warnings[0].startswith("search.city:") and "OpenStreetMap" in warnings[0]


def test_a_feed_with_a_local_path_is_valid() -> None:
    t = "search: {name: X}\ncommute:\n  transit:\n    feeds: [{name: Local, path: /data/gtfs.zip}]\n"
    assert check_text(t).ok


# --------------------------------------------------------------------------- editing feeds in place
TEMPLATE_FEEDS = "commute:\n  destinations: []\n  transit:\n    feeds: []                # add GTFS feeds\n    service_date: 2026-11-04 # keep\n"


def test_feeds_are_added_where_the_template_has_an_empty_list() -> None:
    out = add_transit_feeds(TEMPLATE_FEEDS, [{"name": "CTA", "url": "https://x.example/g.zip"}])
    assert out is not None and feeds_in(out)[0]["name"] == "CTA"
    assert "# add GTFS feeds" in out and "# keep" in out


def test_a_second_feed_goes_after_the_first_and_a_duplicate_is_skipped() -> None:
    one = add_transit_feeds(TEMPLATE_FEEDS, [{"name": "A", "url": "https://a.example/g.zip"}])
    two = add_transit_feeds(one, [{"name": "B", "url": "https://b.example/g.zip"}, {"name": "A again", "url": "https://a.example/g.zip"}])
    assert [f["name"] for f in feeds_in(two)] == ["A", "B"]
    assert add_transit_feeds(two, [{"name": "B", "url": "https://b.example/g.zip"}]) == two


def test_feeds_are_added_when_the_transit_block_or_the_key_is_missing() -> None:
    a = add_transit_feeds("commute:\n  destinations: []\n", [{"name": "A", "url": "https://a.example/g.zip"}])
    b = add_transit_feeds("commute:\n  transit:\n    walk_detour: 1.3\n", [{"name": "A", "url": "https://a.example/g.zip"}])
    assert feeds_in(a)[0]["name"] == "A" and feeds_in(b)[0]["name"] == "A"
    assert yaml.safe_load(b)["commute"]["transit"]["walk_detour"] == 1.3


def test_a_file_without_a_commute_block_cannot_be_edited_in_place() -> None:
    assert add_transit_feeds("search: {name: X}\n", [{"name": "A", "url": "https://a.example/g.zip"}]) is None


# --------------------------------------------------------------------------- apartmentscout city
def make_search(tmp_path: Path) -> Path:
    root = tmp_path / "s"
    init_search(root, "chicago")
    return root


def city_args(root: Path | None, place: str | None = None, **kw) -> types.SimpleNamespace:
    d = dict(search=str(root) if root else None, place=place, feed=None, name=None, mode=None, starter=False, timezone=None,
             write_profile=False, force=False, dry_run=False)
    d.update(kw)
    return types.SimpleNamespace(**d)


def test_city_command_sets_the_city_and_adds_the_starter_feed_in_place(tmp_path: Path, monkeypatch, capsys) -> None:
    root = make_search(tmp_path)
    monkeypatch.setattr(C, "_http_json", lambda url, params: [CHICAGO_ROW])
    city_cmd.cmd_city(city_args(root, "Chicago, IL", starter=True))
    text = (root / "criteria.yaml").read_text()
    c = yaml.safe_load(text)
    assert c["search"]["timezone"] == "America/Chicago" and c["search"]["city_name"] == "Chicago, Illinois"
    assert c["search"]["map_center"] == [41.87556, -87.62442]
    assert c["commute"]["transit"]["feeds"][0]["name"] == "CTA"
    assert "# a normal weekday" in text or "service_date" in text
    assert list((root / "backups").glob("criteria-*.yaml")), "the old file is kept"
    assert "Saved" in capsys.readouterr().out
    assert check_text(text).ok and not any("timezone" in w for w in check_text(text).warnings)


def test_city_command_rejects_a_feed_that_is_not_a_zip(tmp_path: Path, monkeypatch) -> None:
    root = make_search(tmp_path)
    monkeypatch.setattr(C, "check_feed", lambda u, get=None: C.FeedCheck(False, "that address is a web page, not a GTFS zip"))
    before = (root / "criteria.yaml").read_text()
    with pytest.raises(SystemExit) as e:
        city_cmd.cmd_city(city_args(root, None, feed=["https://agency.example/developers"]))
    assert "web page" in str(e.value) and (root / "criteria.yaml").read_text() == before


def test_city_command_adds_a_checked_feed(tmp_path: Path, monkeypatch) -> None:
    root = make_search(tmp_path)
    monkeypatch.setattr(C, "check_feed", lambda u, get=None: C.FeedCheck(True, "a zip file", 3.0))
    city_cmd.cmd_city(city_args(root, None, feed=["https://agency.example/gtfs.zip"], name="Metro", mode="rail"))
    assert feeds_in((root / "criteria.yaml").read_text()) == [{"name": "Metro", "url": "https://agency.example/gtfs.zip", "mode": "rail"}]


def test_city_command_unknown_place_exits_with_advice(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as e:
        city_cmd.cmd_city(city_args(make_search(tmp_path), "Atlantis"))
    assert "search.timezone" in str(e.value)


def test_city_command_dry_run_and_no_search_change_nothing(tmp_path: Path, monkeypatch, capsys) -> None:
    root = make_search(tmp_path)
    monkeypatch.setattr(C, "_http_json", lambda url, params: [CHICAGO_ROW])
    before = (root / "criteria.yaml").read_text()
    city_cmd.cmd_city(city_args(root, "Chicago", dry_run=True))
    assert (root / "criteria.yaml").read_text() == before
    monkeypatch.delenv("APARTMENTSCOUT_SEARCH", raising=False)
    city_cmd.cmd_city(city_args(None, "Chicago"))
    assert "inside a search" in capsys.readouterr().out


def test_city_command_can_write_a_minimal_profile(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(C, "CITIES_DIR", tmp_path)
    monkeypatch.setattr(C, "_http_json", lambda url, params: [CHICAGO_ROW])
    city_cmd.cmd_city(city_args(None, "Chicago", write_profile=True, starter=True))
    prof = yaml.safe_load((tmp_path / "chicago.yaml").read_text())
    assert prof["timezone"] == "America/Chicago" and prof["osm_area"] == "relation/122604" and prof["transit_feeds"][0]["name"] == "CTA"
    with pytest.raises(SystemExit):
        city_cmd.cmd_city(city_args(None, "Chicago", write_profile=True))
