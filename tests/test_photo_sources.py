"""Extra photo sources: page images, bot-challenge detection and Wikidata building images. No network."""
from __future__ import annotations

import pytest

from apartmentscout import photo_sources as PS
from apartmentscout import photos as P


def target(**over) -> P.Target:
    L = {"id": "via-57-west-613", "building": "VIA 57 West", "unit": "613",
         "address": "625 West 57th Street, New York, NY", "lat": 40.7714, "lon": -73.9930}
    L.update(over)
    return next(iter(P.targets_for([L]).values()))


def binding(item: str, label: str, image: str, lon: float, lat: float, address: str | None = None,
            alias: str | None = None) -> dict:
    b = {"item": {"value": f"http://www.wikidata.org/entity/{item}"},
         "label": {"value": label},
         "image": {"value": f"http://commons.wikimedia.org/wiki/Special:FilePath/{image}"},
         "coord": {"value": f"Point({lon} {lat})"}}
    if address:
        b["address"] = {"value": address}
    if alias:
        b["alias"] = {"value": alias}
    return b


# --------------------------------------------------------------------------- page images
def test_page_images_prefers_social_cards_and_skips_logos_headshots_and_small():
    html = """
    <head><meta property="og:image" content="https://cdn.example.com/gallery/hero.jpg">
    <meta name="twitter:image" content="/img/hero-2.webp"></head>
    <body>
      <img src="/assets/logo.png">
      <img src="/team/agent-headshot.jpg" alt="Leasing agent">
      <img src="/gallery/kitchen.jpg" width="1200" height="800">
      <img src="/gallery/thumb.jpg" width="120" height="80">
      <img data-src="/gallery/bedroom.jpg" class="lazy">
      <img srcset="/g/living-640.jpg 640w, /g/living-1600.jpg 1600w">
      <img src="/maps/site-map.png">
      <img src="data:image/gif;base64,R0lGOD">
    </body>"""
    got = PS.page_images(html, "https://www.example-building.com/availability/")
    assert got == [
        "https://cdn.example.com/gallery/hero.jpg",
        "https://www.example-building.com/img/hero-2.webp",
        "https://www.example-building.com/gallery/kitchen.jpg",
        "https://www.example-building.com/gallery/bedroom.jpg",
        "https://www.example-building.com/g/living-1600.jpg",
    ]


@pytest.mark.parametrize("status,text,blocked", [
    (200, "<html><title>Unit 6B</title></html>", False),
    (403, "", True),
    (429, "", True),
    (406, "Not Acceptable", True),
    (200, "<div id='px-captcha'></div>", True),
    (200, "<title>Just a moment...</title>", True),
    (200, "Pardon Our Interruption", True),
    (404, "not found", False),
])
def test_is_challenge(status, text, blocked):
    assert PS.is_challenge(status, text) is blocked


class FakeResponse:
    def __init__(self, status: int, text: str):
        self.status_code, self.text = status, text
        self.headers = {"Content-Type": "text/html"}


class FakeSession:
    def __init__(self, responses: dict[str, FakeResponse]):
        self.responses, self.calls, self.headers = responses, [], {}

    def get(self, url, **kw):
        self.calls.append(url)
        return self.responses[url]


def test_page_fetcher_blocks_a_host_after_one_challenge():
    s = FakeSession({"https://blocked.example/a": FakeResponse(403, ""),
                     "https://ok.example/a": FakeResponse(200, "<html>fine</html>"),
                     "https://ok.example/missing": FakeResponse(404, "")})
    f = PS.PageFetcher(s, pause=0)
    with pytest.raises(PS.Blocked):
        f.get("https://blocked.example/a")
    with pytest.raises(PS.Blocked):
        f.get("https://blocked.example/b")      # not requested again
    assert s.calls == ["https://blocked.example/a"]
    assert f.get("https://ok.example/a") == "<html>fine</html>"
    with pytest.raises(PS.Blocked):
        f.get("https://ok.example/missing")
    assert "ok.example" not in f.blocked      # a 404 is about the page, not the host


# --------------------------------------------------------------------------- Wikidata
def test_sparql_near_puts_lon_first():
    q = PS.sparql_near(40.7714, -73.993, 250)
    assert "Point(-73.993000 40.771400)" in q and '"0.250"' in q and "wdt:P18" in q
    assert "wd:Q41176" in q  # buildings only: not neighbourhoods, teams or streets


def test_match_wikidata_by_name_or_address_only():
    t = target()
    rows = [
        binding("Q1", "VIA 57 West", "VIA_57_West.jpg", -73.9929, 40.7713),
        binding("Q1", "VIA 57 West", "VIA_57_West.jpg", -73.9929, 40.7713, alias="West 57"),
        binding("Q2", "625 West 57th Street", "Some_Tower.jpg", -73.9940, 40.7716),
        binding("Q7", "Dodger Stages", "Theatre.jpg", -73.9931, 40.7714, address="625 West 57th Street"),
        binding("Q3", "Hearst Tower", "Hearst.jpg", -73.9935, 40.7712),
        binding("Q4", "Unrelated", "Other.jpg", -73.9935, 40.7712, address="600 West 57th Street"),
    ]
    got = PS.match_wikidata(rows, t)
    assert [g["item"].rsplit("/", 1)[-1] for g in got] == ["Q1", "Q2"]
    assert got[0]["file"] == "VIA 57 West.jpg" and got[0]["distance_m"] < 20


def test_match_wikidata_one_word_name_needs_the_whole_label():
    t = target(building="The Cole", address="1 Example Place, New York, NY")
    rows = [binding("Q5", "Cole Hardware", "Cole_Hardware.jpg", -73.993, 40.7714),
            binding("Q6", "The Cole", "The_Cole.jpg", -73.993, 40.7714)]
    assert [g["label"] for g in PS.match_wikidata(rows, t)] == ["The Cole"]


def test_commons_file_entry_carries_credit_and_skips_small():
    page = {"title": "File:VIA 57 West.jpg", "imageinfo": [{
        "mime": "image/jpeg", "width": 4000, "height": 3000, "thumburl": "https://upload.wikimedia.org/t.jpg?utm_source=x",
        "thumbwidth": 960, "thumbheight": 720, "descriptionurl": "https://commons.wikimedia.org/wiki/File:VIA_57_West.jpg",
        "extmetadata": {"Artist": {"value": "<a>Jane Doe</a>"}, "LicenseShortName": {"value": "CC BY-SA 4.0"}}}]}
    e = PS.commons_file_entry(page, {"item": "http://www.wikidata.org/entity/Q1", "distance_m": 12})
    assert e["url"] == "https://upload.wikimedia.org/t.jpg" and e["author"] == "Jane Doe"
    assert e["license"] == "CC BY-SA 4.0" and e["scope"] == "building" and e["source"] == PS.WIKIDATA_SOURCE
    page["imageinfo"][0]["width"] = 300
    assert PS.commons_file_entry(page, {"item": "Q1", "distance_m": 1}) is None


def test_wikidata_photos_end_to_end_with_fakes(tmp_path):
    t = target()

    class FakeWD:
        def select(self, q):
            return [binding("Q1", "VIA 57 West", "VIA_57_West.jpg", -73.9929, 40.7713)]

    class FakeCommons:
        def _image_props(self):
            return {}

        def query(self, params):
            assert params["titles"] == "File:VIA 57 West.jpg"
            return {"query": {"pages": [{"title": "File:VIA 57 West.jpg", "imageinfo": [{
                "mime": "image/jpeg", "width": 2000, "height": 1500, "thumburl": "https://upload.wikimedia.org/v.jpg",
                "extmetadata": {}}]}]}}

    got = PS.wikidata_photos(t, FakeWD(), FakeCommons())
    assert len(got) == 1 and got[0]["wikidata"].endswith("Q1") and got[0]["author"] == "Unknown author"


def test_wikidata_cache_round_trip(tmp_path):
    class S:
        headers: dict = {}
        n = 0

        def get(self, url, params=None, timeout=None):
            S.n += 1

            class R:
                status_code = 200
                headers: dict = {}

                def raise_for_status(self):
                    pass

                def json(self):
                    return {"results": {"bindings": [{"item": {"value": "x"}}]}}
            return R()

    wd = PS.Wikidata(tmp_path, session=S(), pause=0)
    assert wd.select("SELECT 1") == [{"item": {"value": "x"}}]
    assert wd.select("SELECT 1") == [{"item": {"value": "x"}}]
    assert S.n == 1



# --------------------------------------------------------------------------- applying the sources
def test_merge_source_photos_replaces_only_its_own_and_skips_duplicates():
    commons = {"url": "https://u/1.jpg", "page": "https://commons/File:A.jpg", "source": "Wikimedia Commons", "scope": "building"}
    agent = {"url": "https://u/2.jpg", "source": "Building website", "scope": "exact-unit"}
    old_wd = {"url": "https://u/old.jpg", "page": "https://commons/File:Old.jpg", "source": PS.WIKIDATA_SOURCE, "scope": "building"}
    dup = {"url": "https://u/3.jpg", "page": "https://commons/File:A.jpg", "source": PS.WIKIDATA_SOURCE, "scope": "building"}
    new = {"url": "https://u/4.jpg", "page": "https://commons/File:B.jpg", "source": PS.WIKIDATA_SOURCE, "scope": "building"}
    got = PS.merge_source_photos([commons, old_wd, agent], [dup, new], PS.WIKIDATA_SOURCE)
    assert got == [agent, commons, new]          # other sources kept (best scope first), old Wikidata entry replaced, dup dropped


def test_commons_merge_does_not_repeat_a_file_wikidata_already_added():
    wd = {"url": "https://u/3.jpg", "page": "https://commons/File:A.jpg", "source": PS.WIKIDATA_SOURCE, "scope": "building"}
    commons = {"url": "https://u/1.jpg", "page": "https://commons/File:A.jpg", "source": P.SOURCE, "scope": "building"}
    other = {"url": "https://u/5.jpg", "page": "https://commons/File:C.jpg", "source": P.SOURCE, "scope": "street"}
    assert P.merge_building_photos([wd], [commons, other]) == [wd, other]


class FakeWD:
    requests = 0

    def select(self, q):
        self.requests += 1
        return [binding("Q1", "VIA 57 West", "VIA_57_West.jpg", -73.9929, 40.7713)]


class FakeCommons:
    def _image_props(self):
        return {}

    def query(self, params):
        return {"query": {"pages": [{"title": "File:VIA 57 West.jpg", "imageinfo": [{
            "mime": "image/jpeg", "width": 2000, "height": 1500, "thumburl": "https://upload.wikimedia.org/v.jpg",
            "descriptionurl": "https://commons.wikimedia.org/wiki/File:VIA_57_West.jpg", "extmetadata": {}}]}]}}


def test_add_wikidata_photos_writes_credited_entries_to_every_unit_of_the_building():
    a = {"id": "via-613", "building": "VIA 57 West", "unit": "613", "address": "625 West 57th Street, New York, NY",
         "lat": 40.7714, "lon": -73.9930}
    b = {**a, "id": "via-215", "unit": "215"}
    far = {"id": "other-1", "building": "Elsewhere Tower", "unit": "1", "address": "1 Nowhere Street, New York, NY",
           "lat": 40.70, "lon": -74.0}
    wd = FakeWD()
    st = PS.add_wikidata_photos([a, b, far], wd, FakeCommons(), limit=2, say=lambda *_: None)
    assert a["building_photos"] == b["building_photos"] and a["building_photos"][0]["source"] == PS.WIKIDATA_SOURCE
    assert a["building_photos"][0]["wikidata"].endswith("Q1")
    assert "building_photos" not in far
    assert st["buildings"] == 2 and st["with_photos"] == 1 and wd.requests == 2


PAGE = ('<head><meta property="og:image" content="https://cdn.example.com/hero.jpg"></head>'
        '<body><img src="/g/kitchen.jpg" width="1200" height="800"></body>')


def test_add_web_photos_unit_page_goes_to_photos_and_building_page_to_building_photos():
    unit_page = "https://www.example-building.com/units/613"
    bldg_page = "https://www.example-building.com/availability/"
    s = FakeSession({unit_page: FakeResponse(200, PAGE), bldg_page: FakeResponse(200, PAGE)})
    unit = {"id": "u613", "building": "Example", "unit": "613", "links": {"listing": unit_page}}
    bldg = {"id": "u9", "building": "Example", "unit": "9B", "links": {"listing": bldg_page}}
    has = {"id": "u1", "unit": "1A", "photos": ["https://x/p.jpg"], "links": {"listing": unit_page}}
    st = PS.add_web_photos([unit, bldg, has], PS.PageFetcher(s, pause=0), limit=5, say=lambda *_: None)
    assert unit["photos"] == ["https://cdn.example.com/hero.jpg", "https://www.example-building.com/g/kitchen.jpg"]
    assert "building_photos" not in unit
    assert "photos" not in bldg
    e = bldg["building_photos"][0]
    assert e["source"] == PS.WEB_SOURCE and e["scope"] == "building" and e["page"] == bldg_page and "private" in e["license"]
    assert has["photos"] == ["https://x/p.jpg"]                      # listings with photos are left alone
    assert s.calls == [unit_page, bldg_page]                         # and not fetched
    assert st["with_photos"] == 2 and st["blocked"] == {}


def test_add_web_photos_reports_a_blocked_host_once_and_does_not_retry():
    s = FakeSession({"https://blocked.example/a/1": FakeResponse(403, ""), "https://blocked.example/a/2": FakeResponse(403, "")})
    rows = [{"id": f"b{i}", "unit": str(i), "links": {"listing": f"https://blocked.example/a/{i}"}} for i in (1, 2)]
    said = []
    st = PS.add_web_photos(rows, PS.PageFetcher(s, pause=0), say=said.append)
    assert s.calls == ["https://blocked.example/a/1"] and list(st["blocked"]) == ["blocked.example"]
    assert st["with_photos"] == 0 and "photos" not in rows[0] and len([m for m in said if "blocked.example" in m]) == 1


def test_cli_photos_web_is_refused_inside_examples_and_wikidata_runs(tmp_path, monkeypatch):
    import json
    from pathlib import Path

    from apartmentscout.cli import main
    root = Path(__file__).resolve().parent.parent / "examples" / "nyc-2026"
    with pytest.raises(SystemExit) as e:
        main(["photos", "--search", str(root), "--source", "web"])
    assert "examples" in str(e.value)

    search = tmp_path / "s"
    main(["init", str(search), "--city", "nyc"])
    L = {"id": "via-613", "building": "VIA 57 West", "unit": "613", "address": "625 West 57th Street, New York, NY",
         "lat": 40.7714, "lon": -73.9930, "status": "researching"}
    (search / "listings.json").write_text(json.dumps([L]))
    monkeypatch.setattr(PS, "Wikidata", lambda *a, **k: FakeWD())
    monkeypatch.setattr(P, "Commons", lambda *a, **k: FakeCommons())
    main(["photos", "--search", str(search), "--source", "wikidata"])
    saved = json.loads((search / "listings.json").read_text())
    assert saved[0]["building_photos"][0]["source"] == PS.WIKIDATA_SOURCE
