"""Building photos (Wikimedia Commons) and local media caching. No network: the API and image hosts
are replaced by fakes fed from tests/fixtures/photos."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from apartmentscout import photos as P

FIX = Path(__file__).parent / "fixtures" / "photos" / "commons_pages.json"


@pytest.fixture(scope="module")
def fixture() -> dict:
    return json.loads(FIX.read_text())


def listing(**over) -> dict:
    L = {"id": "gotham-example-507", "building": "Gotham Example", "unit": "507",
         "address": "416 West 52nd Street, New York, NY", "lat": 40.75, "lon": -73.99}
    L.update(over)
    return L


def target_for(L: dict) -> P.Target:
    return next(iter(P.targets_for([L]).values()))


def by_title(fixture: dict) -> dict[str, dict]:
    return {p["title"]: p for p in fixture["pages"]}


# --------------------------------------------------------------------------- addresses and names
@pytest.mark.parametrize("addr,text,on_street,number", [
    ("416 West 52nd Street", "416 W 52nd St", True, "416"),
    ("416 West 52nd Street", "414-418 West 52nd Street", True, "414-418"),
    ("416 West 52nd Street", "Looking east along 52d St", True, None),
    ("416 West 52nd Street", "416 East 52nd Street", False, None),
    ("416 West 52nd Street", "355 W52 St", True, "355"),
    ("626 1 Ave", "626 First Avenue", True, "626"),
    ("626 1 Ave", "11th Avenue", False, None),
    ("445W35", "445 W 35th St", True, "445"),
    ("222 B'Way", "222 Broadway", True, "222"),
    ("1050 Sixth Ave", "Avenue of the Americas", True, None),
    ("85 East End Avenue", "East End Ave", True, None),
    ("305 East 86 St", "305 E. 86th Street", True, "305"),
])
def test_parse_address_matches_common_spellings(addr, text, on_street, number):
    a = P.parse_address(addr)
    assert a is not None
    assert a.street_in(text) is on_street
    assert a.number_on_street(text) == number


def test_address_ranges_and_non_addresses():
    a = P.parse_address("82-86 Washington Place")
    assert a.numbers == ("82", "86")
    assert a.matches_number("84") and a.matches_number("86-88") and not a.matches_number("80")
    assert P.parse_address(", New York, NY") is None
    assert P.parse_address("The Knox") is None
    # a date before an address is not a house-number range
    assert P.find_addresses("td (2018-04-06) 07 - 989 6th Avenue") == ["989 6th Avenue"]


@pytest.mark.parametrize("name,expect", [
    ("Gotham West", [("Gotham West", True)]),
    ("VIA 57 West", [("VIA 57 West", True)]),
    ("Hudson Hill Condominium", [("Hudson Hill", True)]),
    ("The Cole", [("Cole", False)]),
    ("American Copper Buildings (The Copper)", [("American Copper Buildings", True), ("Copper", False)]),
    ("The East", []), ("Sky", []), ("West 96th", []), ("95 Wall (UDR)", []), ("Owner", []), ("", []),
])
def test_name_patterns(name, expect):
    assert [(n.phrase, n.free_text) for n in P.name_patterns(name)] == expect


def test_targets_group_by_location_and_skip_geocoder_fallbacks():
    a = listing(id="a", unit="1")
    b = listing(id="b", unit="2", address="416 W 52nd St, New York, NY")
    junk = [listing(id=f"j{i}", building=f"Building {i}", address=f"{i}0 West {i + 20}th Street, New York, NY",
                    lat=40.70, lon=-74.01) for i in range(1, 6)]
    T = P.targets_for([a, b, *junk, {"id": "nocoords", "address": "1 Main St"}])
    assert len(T) == 1
    t = next(iter(T.values()))
    assert t.label == "Gotham Example" and len(t.addresses) == 1


# --------------------------------------------------------------------------- classification
def test_classify_scopes(fixture):
    t = target_for(listing())
    pages = by_title(fixture)

    def scope(title: str) -> str | None:
        c = P.classify(pages[title], t, radius=60)
        return c and c["scope"]

    assert scope("File:416 W 52nd St facade 2024.jpg") == "building"
    assert scope("File:From the west across Tenth Avenue.jpg") == "building"     # name as a Commons category
    assert scope("File:Looking east along 52d St jeh.jpg") == "street"
    assert scope("File:Brewery Building jeh.jpg") is None    # about 666 First Ave; ours only in the background
    assert scope("File:420 W 52nd St.jpg") is None           # another address on the same street
    assert scope("File:416 East 52nd Street.jpg") is None    # opposite side of Fifth Avenue
    assert scope("File:Bicycle locked on W 52nd St.jpg") is None
    assert scope("File:Hell's Kitchen map.svg") is None
    assert scope("File:416 W 52nd St tiny.jpg") is None
    assert scope("File:Empire Example Building from 52nd Street.jpg") is None   # another building as subject
    assert scope("File:416 W 52nd St far away.jpg") is None  # 1.1 km away: the same address elsewhere


def test_classify_record_has_credit_fields(fixture):
    c = P.classify(by_title(fixture)["File:416 W 52nd St facade 2024.jpg"], target_for(listing()), 60)
    assert c["url"].startswith("https://upload.wikimedia.org/") and "utm_" not in c["url"]
    assert c["page"] == "https://commons.wikimedia.org/wiki/File:416_W_52nd_St_facade_2024.jpg"
    assert c["author"] == "Example Photographer"
    assert c["license"] == "CC BY-SA 4.0"
    assert c["license_url"] == "https://creativecommons.org/licenses/by-sa/4.0"
    assert c["source"] == "Wikimedia Commons"
    assert c["distance_m"] < 30 and c["width"] == 960


def test_pick_orders_building_first_and_dedupes(fixture):
    t = target_for(listing())
    found = [c for c in (P.classify(p, t, 60) for p in fixture["pages"] * 2) if c]
    out = P.pick(found, limit=6)
    assert [p["scope"] for p in out] == ["building", "building", "street"]
    assert len({p["page"] for p in out}) == len(out)
    assert all("_rank" not in p for p in out)
    assert len(P.pick(found, limit=1)) == 1


# --------------------------------------------------------------------------- the API client
class FakeResponse:
    def __init__(self, payload=None, status=200, headers=None, body=b""):
        self.payload, self.status_code, self.headers, self.body = payload, status, headers or {}, body

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise P.requests.HTTPError(f"HTTP {self.status_code}", response=self)

    def iter_content(self, n):
        for i in range(0, len(self.body), n):
            yield self.body[i:i + n]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeSession:
    def __init__(self, responder):
        self.responder, self.headers, self.calls = responder, {}, []

    def get(self, url, params=None, **kw):
        self.calls.append((url, params))
        return self.responder(url, params)


def test_commons_query_caches_and_identifies_itself(tmp_path, fixture, monkeypatch):
    monkeypatch.delenv("APARTMENTSCOUT_CONTACT", raising=False)
    s = FakeSession(lambda u, p: FakeResponse({"query": {"pages": fixture["pages"]}}))
    api = P.Commons(tmp_path, session=s, pause=0)
    assert s.headers["User-Agent"] == "ApartmentScout/0.1 (open-source apartment research)"
    a = api.near(40.75, -73.99, 60)
    b = api.near(40.75, -73.99, 60)
    assert a == b and len(s.calls) == 1 and api.requests == 1
    params = s.calls[0][1]
    assert params["maxlag"] == "5" and params["ggsnamespace"] == "6" and params["iiurlwidth"] == "800"
    assert list(tmp_path.glob("commons-*.json"))
    api.search_near('416 OR "Gotham Example"', 40.75, -73.99, 400)
    assert s.calls[-1][1]["gsrsearch"].startswith("nearcoord:400m,40.750000,-73.990000 416 OR")


def test_commons_contact_and_pacing(monkeypatch):
    monkeypatch.setenv("APARTMENTSCOUT_CONTACT", "https://example.org/bot")
    assert P.user_agent() == "ApartmentScout/0.1 (open-source apartment research; https://example.org/bot)"
    assert P.Commons(None, session=FakeSession(None)).pause < 1
    monkeypatch.delenv("APARTMENTSCOUT_CONTACT")
    assert P.Commons(None, session=FakeSession(None)).pause >= 6  # 10 requests a minute when anonymous


def test_commons_retries_maxlag_and_busy_search(monkeypatch):
    monkeypatch.setattr(P.time, "sleep", lambda s: None)
    replies = [FakeResponse({"error": {"code": "maxlag"}}, headers={"Retry-After": "1"}),
               FakeResponse({"error": {"code": "cirrussearch-too-busy-error"}}),
               FakeResponse(status=503), FakeResponse({"query": {"pages": []}})]
    api = P.Commons(None, session=FakeSession(lambda u, p: replies.pop(0)), pause=0)
    assert api.near(40.75, -73.99, 60) == []
    assert api.requests == 4


class FakeCommons:
    requests = 0

    def __init__(self, pages):
        self.pages = pages

    def near(self, lat, lon, radius, limit=100):
        return self.pages

    def search_near(self, terms, lat, lon, radius, limit=50):
        return self.pages[:2]


def test_add_commons_photos_writes_each_listing_once_per_building(fixture):
    manual = {"url": "https://example.org/u.jpg", "source": "Building website", "scope": "exact-unit"}
    old = {"url": "https://upload.wikimedia.org/old.jpg", "source": "Wikimedia Commons", "scope": "street"}
    Ls = [listing(id="a", building_photos=[old, manual]), listing(id="b", unit="9"),
          listing(id="c", lat=None, lon=None)]
    st = P.add_commons_photos(Ls, FakeCommons(fixture["pages"]), radius=60, limit=6, say=lambda *_: None)
    assert st["buildings"] == 1 and st["with_photos"] == 1
    a, b, c = Ls
    assert a["building_photos"][0] == manual                       # agent-added photos survive
    assert old not in a["building_photos"]                          # stale Commons ones are replaced
    assert [p["scope"] for p in b["building_photos"]] == ["building", "building", "street"]
    assert "building_photos" not in c
    assert "photos" not in a                                        # listing photos are never touched


def test_merge_orders_by_scope():
    keep = [{"scope": "street", "source": "x"}, {"scope": "exact-unit", "source": "y"}]
    out = P.merge_building_photos(keep, [{"scope": "building", "source": "Wikimedia Commons"}])
    assert [p["scope"] for p in out] == ["exact-unit", "street", "building"]


# --------------------------------------------------------------------------- local media
JPEG = b"\xff\xd8\xff" + b"0" * 2000


def image_host(url, params=None):
    if "big" in url:
        return FakeResponse(status=200, headers={"Content-Type": "image/jpeg"}, body=b"0" * (P.MAX_BYTES + 10))
    if "page.html" in url:
        return FakeResponse(status=200, headers={"Content-Type": "text/html"}, body=b"<html>")
    if "gone" in url:
        return FakeResponse(status=404)
    return FakeResponse(status=200, headers={"Content-Type": "image/webp"}, body=JPEG)


def test_cache_media_downloads_dedupes_and_skips(tmp_path, monkeypatch):
    (tmp_path / "media" / "a").mkdir(parents=True)
    (tmp_path / "media" / "a" / "plan.jpg").write_bytes(JPEG)
    Ls = [{"id": "a", "photos": ["https://cdn.example.com/p/one.webp", "https://cdn.example.com/p/one.webp",
                                 "media/a/plan.jpg", "https://cdn.example.com/big.jpg",
                                 "https://cdn.example.com/page.html", "https://cdn.example.com/gone.jpg",
                                 "javascript:alert(1)"],
           "building_photos": [{"url": "https://upload.wikimedia.org/x/960px-front.jpg", "scope": "building"}]},
          {"id": "b", "building_photos": [{"url": "https://upload.wikimedia.org/x/960px-front.jpg"}]}]
    s = FakeSession(image_host)
    st = P.cache_media(Ls, tmp_path, session=s, pause=0, say=lambda *_: None)
    a, b = Ls
    assert a["photos_local"][0].startswith("media/a/one-") and a["photos_local"][0].endswith(".webp")
    assert a["photos_local"][1] == "media/a/plan.jpg"
    assert len(a["photos_local"]) == 2
    assert a["building_photos"][0]["local"].startswith("media/a/960px-front-")
    assert b["building_photos"][0]["local"].startswith("media/b/960px-front-")
    assert (tmp_path / b["building_photos"][0]["local"]).read_bytes() == JPEG
    assert st["reused"] == 2 and st["failed"] == 3
    assert not list(tmp_path.rglob("*.part"))
    assert not any("big" in p.name for p in tmp_path.rglob("*"))
    n = len(s.calls)
    P.cache_media(Ls, tmp_path, session=s, pause=0, say=lambda *_: None)   # second run: nothing re-fetched
    assert len(s.calls) - n == 3   # only the three failures are retried


def test_local_name_keeps_extension_or_derives_it():
    assert P._local_name("https://x.org/a/b/photo.JPG?w=1", "image/jpeg").endswith(".jpg")
    assert P._local_name("https://x.org/img?id=5", "image/png").endswith(".png")
    assert P._local_name("https://x.org/a/../../etc/passwd", "image/jpeg").startswith("passwd-")


def test_coverage_counts():
    Ls = [{"photos": ["u"]}, {"building_photos": [{"scope": "street"}]},
          {"building_photos": [{"scope": "building"}], "photos": ["u"], "photos_local": ["media/x/y.jpg"]}, {}]
    c = P.coverage(Ls)
    assert c == {"listings": 4, "listing_photos": 2, "building_photos": 2, "building_scope": 1, "street_only": 1,
                 "either": 3, "neither": 1, "photos_local": 1}
    lines = list(P.coverage_lines(c))
    assert lines[0].startswith("Photo coverage over 4 listings") and any("neither" in x for x in lines)


def test_cli_refuses_to_cache_inside_examples():
    from apartmentscout.cli import main
    root = Path(__file__).resolve().parent.parent / "examples" / "nyc-2026"
    with pytest.raises(SystemExit) as e:
        main(["photos", "--search", str(root), "--source", "local"])
    assert "examples" in str(e.value)


def _page(title: str, desc: str = "", cats: str = "", lat: float = 40.7501, lon: float = -73.9901) -> dict:
    return {"title": f"File:{title}.jpg", "coordinates": [{"lat": lat, "lon": lon}],
            "imageinfo": [{"mime": "image/jpeg", "width": 2000, "height": 1500, "thumburl": "https://x.org/t.jpg",
                           "descriptionurl": "https://commons.wikimedia.org/wiki/File:x.jpg",
                           "extmetadata": {"ImageDescription": {"value": desc}, "Categories": {"value": cats}}}]}


@pytest.mark.parametrize("title,desc,cats,building,scope", [
    # a sibling tower named in the title, or only "seen from near" ours in the description
    ("One Example Square 2024", "One Example Square, seen from near Two Example Square", "Example Square",
     "Two Example Square", None),
    ("Two Example Square 2024", "", "", "Two Example Square", "building"),
    # a building named after its neighbourhood is not matched on the neighbourhood's name
    ("Lexington and E 36th", "Looking up Lexington Avenue in Murray Hill", "Murray Hill, Manhattan",
     "The Murray Hill", None),
    # an old photo filed under the new building's category usually shows what stood there before
    ("Corner 43 10 jeh", "", "Gotham Example|New York City photographs taken on 2009-12-03",
     "Gotham Example", None),
    ("Corner 43 10 jeh", "", "Gotham Example|New York City photographs taken on 2019-12-03",
     "Gotham Example", "building"),
    # street photos: the title is only where it was taken
    ("West across 9th Av 52nd St jeh", "", "", "Nothing Special", "street"),
    ("Winter Lights on 52nd Street W", "", "", "Nothing Special", None),
    ("Freedom Plaza fr 52nd St 2023 jeh", "", "", "Nothing Special", None),
    ("Example Tower ViewFromFL53", "", "Gotham Example", "Gotham Example", None),
])
def test_scope_edge_cases(title, desc, cats, building, scope):
    t = target_for(listing(building=building))
    c = P.classify(_page(title, desc, cats), t, radius=60)
    assert (c and c["scope"]) == scope


def test_photo_year_and_ranking_prefers_newer():
    assert P.photo_year("X", ["New York City photographs taken on 2019-06-14"]) == 2019
    assert P.photo_year("X", ["August 2022 in Manhattan, New York City"]) == 2022
    assert P.photo_year("Via 57 West August 2022 002", []) == 2022
    assert P.photo_year("CitySpire Building 002", ["Built in New York City in 1987"]) is None
    t = target_for(listing())
    old = P.classify(_page("416 W 52nd St 2009"), t, 60)
    new = P.classify(_page("416 W 52nd St 2024", lat=40.7504), t, 60)
    assert old["year"] == 2009 and new["year"] == 2024
    assert P.pick([old, new], 2)[0]["year"] == 2024
