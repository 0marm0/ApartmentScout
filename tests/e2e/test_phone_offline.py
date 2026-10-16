"""Tour day's "Save for offline": the map tiles around today's stops, the destination and the saved homes are kept in the browser, the
worker answers the map from them when the network is down, and the size and a Clear button are on the screen. No real network: every tile
request is answered by the test (the page's and the service worker's alike), so the run also counts what was asked for, how many at once, and
how big the pack got. The built site is served from /ApartmentScout/demo/ like GitHub Pages (as in test_pwa.py).

The tile provider's terms decide what is allowed (js/features/native-core.js basemapPolicy):
  OpenFreeMap  an area may be saved: at most 3,000 tiles or 50 MB, four requests at a time (the pack stays under 1,500, 40 MB, four)
  Esri raster  no bulk saving: only the tiles the renter looks at are kept, up to a cap, and nothing is downloaded ahead

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_phone_offline.py -q
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
from pathlib import Path

import pytest
from conftest import block_foreign, settled, until
from phone_helpers import iphone_args
from test_pwa import MODE, PREFIX, Server, _need, _optimizer  # the built-site helpers

pytestmark = pytest.mark.e2e
ROOT = Path(__file__).resolve().parents[2]
DASH = ROOT / "dashboard"
OFM = "https://tiles.openfreemap.org"
VERSION = "20261011_080001_pt"
CORS = {"access-control-allow-origin": "*"}
LAYERS = ["landuse", "park", "water", "waterway", "building", "transportation", "transportation_name", "water_name", "place"]   # the source layers the style reads
PICKS = {"paramount-tower-25e": {"saved": True}, "orion-condominium-23a": {"saved": True}}


@pytest.fixture(scope="module")
def site(tmp_path_factory: pytest.TempPathFactory, esbuild_ready) -> Path:
    if not (os.environ.get("ESBUILD") or shutil.which("npx")):
        _need("Node (npx esbuild) is needed to build the optimised site")
    root = tmp_path_factory.mktemp("pages")
    demo = root / "ApartmentScout" / "demo"
    shutil.copytree(DASH, demo, ignore=shutil.ignore_patterns("media", "dist", "data-private", "_mockup"))
    _optimizer().optimize(demo)
    return root


@pytest.fixture(scope="module")
def server(site: Path):
    srv = Server(site)
    yield srv
    srv.shutdown()


def mvt(n: int) -> bytes:
    """A valid, empty Mapbox vector tile (one layer, no features) padded with an ignorable field to exactly n bytes, so MapLibre parses it."""
    layer = b"\x0a\x05water\x78\x02\x28\x80\x20"
    base = b"\x1a" + bytes([len(layer)]) + layer
    pad = n - len(base)
    assert pad > 8
    for head in range(3, 8):   # tag (2 bytes) + a length varint of 1-5 bytes
        body = pad - 2 - (head - 2)
        if body < 0:
            continue
        v, out = body, b""
        while True:
            out += bytes([v & 0x7F | (0x80 if v > 0x7F else 0)])
            v >>= 7
            if not v:
                break
        if len(out) == head - 2:
            return base + b"\x9a\x06" + out + b"\x00" * body
    raise AssertionError(n)


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


class Tiles:
    """What the stub map server was asked for."""

    def __init__(self, tile_bytes: int = 24_000) -> None:
        self.tile_bytes = tile_bytes
        self.tiles: list[str] = []
        self.json = 0
        self.glyphs = 0
        self.esri: list[str] = []
        self.down = False   # the connection is gone: a request that reaches the "network" fails (Playwright's set_offline does not stop routed requests)

    def install(self, ctx) -> None:
        def ofm(route) -> None:
            if self.down:
                route.abort("internetdisconnected")
                return
            url = route.request.url
            path = url[len(OFM):]
            if path.split("?")[0] == "/planet":
                self.json += 1
                route.fulfill(status=200, headers={**CORS, "content-type": "application/json"},
                              body=json.dumps({"tilejson": "3.0.0", "tiles": [f"{OFM}/planet/{VERSION}/{{z}}/{{x}}/{{y}}.pbf"], "vector_layers": [{"id": n, "fields": {}} for n in LAYERS]}))
            elif path.startswith("/fonts/"):
                self.glyphs += 1
                route.fulfill(status=200, headers={**CORS, "content-type": "application/x-protobuf"}, body=b"")
            elif re.search(r"/planet/[0-9a-z_]+/\d+/\d+/\d+\.pbf", path):
                self.tiles.append(url)
                route.fulfill(status=200, headers={**CORS, "content-type": "application/x-protobuf"}, body=mvt(self.tile_bytes))
            else:
                route.fulfill(status=404, headers=CORS, body=b"")

        def esri(route) -> None:
            if self.down:
                route.abort("internetdisconnected")
                return
            self.esri.append(route.request.url)
            route.fulfill(status=200, headers={**CORS, "content-type": "image/png"}, body=PNG)
        ctx.route(re.compile(r"^https://tiles\.openfreemap\.org/"), ofm)
        ctx.route(re.compile(r"^https://server\.arcgisonline\.com/"), esri)


@pytest.fixture
def open_tour(browser, server):
    """open_tour(query='', tiles=Tiles()) -> (page, tiles, ctx): the built site on an iPhone, the worker allowed, the saved homes picked,
    the stub map server answering, Tour day open."""
    ctxs = []

    def _open(query: str = "", tiles: Tiles | None = None, hash_: str = "#map"):
        tiles = tiles or Tiles()
        ctx = browser.new_context(**iphone_args(), reduced_motion="reduce")
        ctxs.append(ctx)
        block_foreign(ctx, server.origin)
        tiles.install(ctx)
        ctx.add_init_script(f"try {{ if (!localStorage.getItem('as:picks')) localStorage.setItem('as:picks', {json.dumps(json.dumps(PICKS))}); }} catch (e) {{}}")
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.goto(f"{server.origin}{PREFIX}?tourday=1{('&' + query) if query else ''}{hash_}")
        page.wait_for_selector("#cards .card", timeout=30000)
        page.evaluate("async () => { await navigator.serviceWorker.ready; }")
        page.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=20000)
        page.wait_for_selector("#tourDay [data-off]", timeout=20000)
        settled(page, 20000, 4)
        page.errors = errors
        return page, tiles, ctx

    yield _open
    for c in ctxs:
        c.close()


def pack_meta(page):
    return page.evaluate("() => JSON.parse(localStorage.getItem('as:offline-pack') || 'null')")


def cache_keys(page, name: str = "as-tiles") -> list[str]:
    return page.evaluate("async (n) => (await (await caches.open(n)).keys()).map((r) => r.url)", name)


def save_pack(page) -> dict:
    page.locator("[data-off-save]").tap()
    until(page, "() => !!JSON.parse(localStorage.getItem('as:offline-pack') || 'null')", timeout_ms=60000)
    page.wait_for_function("() => !!document.querySelector('#tourDay [data-off-clear]')")
    return pack_meta(page)


# ------------------------------------------------------------------ the pack
def test_save_for_offline_keeps_the_map_under_the_providers_limits(open_tour) -> None:
    page, tiles, _ = open_tour()
    box = page.locator("#tourDay [data-off]")
    txt = box.inner_text()
    assert "Offline map" in txt and "OpenFreeMap" in txt and "3,000 tiles or 50 MB" in txt and "four requests at a time" in txt
    assert "User-Agent" in txt, "the panel says a page cannot set one"
    assert page.locator("[data-off-save]").is_enabled() and not page.locator("[data-off-clear]").count()
    asked = len(tiles.tiles)   # what the map drew by itself: its own tiles
    assert not any(re.search(r"/planet/\d+/", k) for k in cache_keys(page)) and pack_meta(page) is None, "nothing is saved until the button is pressed"
    meta = save_pack(page)
    assert 1 <= meta["tiles"] <= 1500 and meta["bytes"] <= 40 * 1024 * 1024
    assert 0 <= len(tiles.tiles) - asked - meta["tiles"] <= 4, "one request per saved tile (the map may have asked for a few more of its own)"
    assert 1 <= meta["maxParallel"] <= 4, meta
    assert meta["places"] >= 2 and meta["capped"] is False
    keys = cache_keys(page)
    assert len(keys) == meta["tiles"] + 1 + 6, "the tiles, the TileJSON and the six label-font files"
    assert not any(re.search(r"/planet/\d{8}_", k) for k in keys), "saved without the weekly version folder"
    assert tiles.json >= 1 and tiles.glyphs >= 6
    shown = box.inner_text()
    assert f"{meta['tiles']} tiles" in shown and re.search(r"\d+(\.\d)? (KB|MB) on this phone", shown), shown
    assert page.locator("[data-off-clear]").is_visible() and page.locator("[data-off-save]").inner_text() == "Update"
    assert page.errors == []


def test_the_map_is_answered_from_the_pack_when_the_network_is_down(open_tour) -> None:
    page, tiles, ctx = open_tour()
    meta = save_pack(page)
    saved = [k for k in cache_keys(page) if re.search(r"/planet/\d+/\d+/\d+\.pbf$", k)][0]
    z, x, y = re.search(r"/planet/(\d+)/(\d+)/(\d+)\.pbf$", saved).groups()
    page.reload()                                    # now controlled from the first byte: the worker has served (and kept) everything this page needs
    page.wait_for_selector("#cards .card", timeout=30000)
    settled(page, 20000, 4)
    seen = len(tiles.tiles)
    tiles.down = True
    ctx.set_offline(True)
    # a newer weekly build asks for the same tile under a different version folder: the pack still answers
    url = f"{OFM}/planet/20271231_000000_pt/{z}/{x}/{y}.pbf"
    n = page.evaluate("async (u) => { const r = await fetch(u); return [r.status, (await r.arrayBuffer()).byteLength]; }", url)
    assert n == [200, 24000]
    page.evaluate("async () => { const r = await fetch('https://tiles.openfreemap.org/planet'); window.__tj = (await r.json()).tiles[0]; }")
    assert "/planet/" in page.evaluate("window.__tj"), "the TileJSON is answered too, so the style can load"
    failed = page.evaluate("async () => { try { await fetch('https://tiles.openfreemap.org/planet/20261011_080001_pt/14/1/1.pbf'); return false; } catch (e) { return true; } }")
    assert failed, "a tile that was not saved is not there"
    assert len(tiles.tiles) == seen, "nothing went to the network"
    # the app itself opens offline, and the map keeps its vector style (not the plain offline colour) because a pack is saved
    page.reload()
    page.wait_for_selector("#cards .card", timeout=30000)
    settled(page, 20000, 4)
    assert page.evaluate("document.getElementById('mapOffline').hidden") is True
    assert pack_meta(page)["tiles"] == meta["tiles"]


def test_a_slow_network_falls_back_to_the_saved_tile(open_tour) -> None:
    page, tiles, ctx = open_tour()
    save_pack(page)
    saved = [k for k in cache_keys(page) if re.search(r"/planet/\d+/\d+/\d+\.pbf$", k)][0]
    z, x, y = re.search(r"/planet/(\d+)/(\d+)/(\d+)\.pbf$", saved).groups()
    ctx.route(re.compile(rf"/planet/[0-9a-z_]+/{z}/{x}/{y}\.pbf$"), lambda r: None)   # never answered: a tunnel
    page.evaluate("window.__t0 = performance.now()")
    r = page.evaluate("async (u) => { const r = await fetch(u); return r.status; }", f"{OFM}/planet/{VERSION}/{z}/{x}/{y}.pbf")
    assert r == 200
    assert page.evaluate("performance.now() - window.__t0") < 8000, "the worker gives up on the network after about 3 s when it has a saved copy"


def test_clear_removes_everything_and_the_panel_goes_back_to_save(open_tour) -> None:
    page, _, _ = open_tour()
    save_pack(page)
    page.locator("[data-off-clear]").tap()
    until(page, "async () => !(await caches.keys()).includes('as-tiles')")
    page.wait_for_function("() => !!document.querySelector('#tourDay [data-off-save]') && !document.querySelector('#tourDay [data-off-clear]')")
    assert pack_meta(page) is None
    assert page.locator("[data-off-save]").inner_text() == "Save for offline"
    assert "Offline map cleared" in page.evaluate("document.getElementById('toast').textContent")


def test_the_pack_stops_at_the_size_budget(open_tour) -> None:
    page, tiles, _ = open_tour(tiles=Tiles(tile_bytes=2_500_000))   # 2.5 MB a tile: the 40 MB budget runs out first
    meta = save_pack(page)
    assert meta["bytes"] <= 40 * 1024 * 1024 and meta["capped"] is True and meta["tiles"] <= 16, meta
    assert "did not fit under the size limit" in page.locator("#tourDay [data-off]").inner_text()


def test_a_save_can_be_cancelled_and_leaves_no_pack(open_tour) -> None:
    page, tiles, ctx = open_tour()
    ctx.route(re.compile(r"/planet/[0-9a-z_]+/\d+/\d+/\d+\.pbf$"), lambda r: None)   # tiles never arrive: the download sits there
    page.locator("[data-off-save]").tap()
    page.wait_for_selector("[data-off-cancel]")
    assert page.locator("#tourDay [role=progressbar]").count() == 1
    page.locator("[data-off-cancel]").tap()
    page.wait_for_function("() => !!document.querySelector('#tourDay [data-off-save]')")
    assert pack_meta(page) is None


# ------------------------------------------------------------------ the provider that does not allow it
def test_the_esri_basemap_keeps_only_what_is_viewed_and_says_so(open_tour) -> None:
    page, tiles, ctx = open_tour(query="basemap=raster")
    box = page.locator("#tourDay [data-off]")
    page.wait_for_function("() => /Esri/.test(document.querySelector('#tourDay [data-off]').textContent)", timeout=20000)
    txt = box.inner_text()
    assert "do not allow saving a whole area" in txt and "only the part of the map you look at" in txt.lower()
    assert page.locator("[data-off-save]").count() == 0, "no bulk download for this basemap"
    # looking at the map caches the tiles the page asked for, and only those
    url = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/14/6156/4825"
    page.evaluate("async (u) => { const r = await fetch(u); await r.arrayBuffer(); }", url)
    page.wait_for_function("async (u) => !!(await (await caches.open('as-tiles-viewed')).match(u))", arg=url, timeout=10000)
    assert tiles.tiles == [] and page.evaluate("async () => (await caches.keys()).includes('as-tiles')") is False
    n = len(tiles.esri)
    tiles.down = True
    ctx.set_offline(True)
    ok = page.evaluate("async (u) => (await fetch(u)).status", url)
    assert ok == 200 and len(tiles.esri) == n, "the tile that was looked at is there offline"
    gone = page.evaluate("async () => { try { await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/14/1/1'); return false; } catch (e) { return true; } }")
    assert gone, "one that was not looked at is not"
    ctx.set_offline(False)
