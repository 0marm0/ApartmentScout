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
