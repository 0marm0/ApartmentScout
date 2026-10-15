"""The photo tiers in a real browser, the way a fresh clone meets them: the dashboard is served by a plain static server with NO
media/ folder and the starter set (examples/nyc-2026/media-lite) beside it, and the manifest names a second local server as the
published full set. The top-ranked homes then show a full gallery from the starter set, every other home shows its one or two
starter photos and gets the rest from the "published" server, and nothing asks the same missing folder twice per photo.
(dashboard/js/features/media-chain.js is the code under test; tests/js/media-chain.test.mjs covers its logic without a browser.)
"""
from __future__ import annotations

import http.server
import io
import json
import threading
import urllib.parse
from pathlib import Path
from typing import Iterator

import pytest
from conftest import block_foreign
from conftest import settled

pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
DASH = ROOT / "dashboard"
LITE = ROOT / "examples" / "nyc-2026" / "media-lite"


def _webp() -> bytes:
    Image = pytest.importorskip("PIL.Image")
    buf = io.BytesIO()
    Image.new("RGB", (96, 64), (30, 90, 200)).save(buf, "WEBP")
    return buf.getvalue()


class Tiers:
    """Two servers: `page` (dashboard/ and /media-lite/, no /media/) and `published` (the full set: every /media/*.webp exists)."""

    def __init__(self) -> None:
        self.page_log: list[str] = []
        self.published_log: list[str] = []
        self.published_down = False
        self.image = _webp()
        tiers = self

        class Published(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                path = urllib.parse.unquote(self.path.split("?", 1)[0])
                tiers.published_log.append(path)
                if tiers.published_down or not path.startswith("/media/") or not path.endswith(".webp"):
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "image/webp")
                self.send_header("Content-Length", str(len(tiers.image)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(tiers.image)

        self.published = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Published)
        self.published_url = f"http://127.0.0.1:{self.published.server_address[1]}/media/"

        class Page(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw) -> None:
                super().__init__(*a, directory=str(DASH), **kw)

            def log_message(self, *a) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                route = urllib.parse.unquote(self.path.split("?", 1)[0])
                if route.startswith(("/media/", "/media-lite/")):
                    tiers.page_log.append(route)
                if route == "/data/manifest.json":   # the real manifest, pointed at the second server instead of the Pages site
                    m = json.loads((DASH / "data" / "manifest.json").read_text())
                    m["media_base_url"] = tiers.published_url
                    body = json.dumps(m).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                super().do_GET()

            def translate_path(self, path: str) -> str:
                clean = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
                if clean.startswith("/media-lite/"):
                    target = (LITE / clean[len("/media-lite/"):]).resolve()
                    return str(target if LITE.resolve() in target.parents else LITE / "__forbidden__")
                if clean.startswith("/media/"):
                    return str(DASH / "__no_media_folder_here__")   # this is the point: no full set beside the page
                return super().translate_path(path)

        http.server.ThreadingHTTPServer.request_queue_size = 128
        self.page = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
        self.page_url = f"http://127.0.0.1:{self.page.server_address[1]}"
        for srv in (self.published, self.page):
            threading.Thread(target=srv.serve_forever, daemon=True).start()

    def close(self) -> None:
        for srv in (self.published, self.page):
            srv.shutdown()


@pytest.fixture(scope="module")
def tiers() -> Iterator[Tiers]:
    if not LITE.is_dir():
        pytest.skip("no starter set in this checkout")
    t = Tiers()
    yield t
    t.close()


@pytest.fixture
def clone_page(browser, tiers: Tiers):
    """A page on the static server, with only the two local servers reachable. Yields (page, errors)."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1, reduced_motion="reduce", service_workers="block")
    block_foreign(ctx, tiers.page_url, tiers.published_url.rsplit("/media/", 1)[0])
    tiers.page_log.clear()
    tiers.published_log.clear()
    tiers.published_down = False
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(f"{tiers.page_url}/#map")
    page.wait_for_function("() => document.querySelector('#cards .card')", timeout=30000)
    yield page, errors
    ctx.close()


def _ids() -> tuple[str, str]:
    """A listing with a full starter gallery, and one with only its one or two starter photos but many more in the data."""
    man = json.loads((LITE / "MANIFEST.json").read_text())
    rows = {L["id"]: L for L in json.loads((DASH / "data" / "listings.json").read_text())}
    top = max((i for i in man["galleries"] if i in rows), key=lambda i: (len(rows[i].get("photos_local") or []), i))   # most saved photos of its own
    lite = next(i for i, L in rows.items() if i not in man["galleries"] and len(L.get("photos_local") or []) >= 8 and L.get("status") not in ("gone", "rejected"))
    return top, lite


def _drawer_sources(page, tiers: Tiers, id_: str) -> list[dict]:
    page.evaluate("async (id) => (await import('/js/app.js')).openDrawer(id, { instant: true })", id_)
    page.wait_for_selector("#drawer.open #dTrack img", timeout=15000)
    # slides after the second are lazy: ask for all of them now, then wait for every one to load or give up
    page.evaluate("() => document.querySelectorAll('#dTrack > img').forEach((i) => { i.loading = 'eager'; })")
    page.wait_for_function("""() => [...document.querySelectorAll('#dTrack > img')].every((i) => i.complete)""", timeout=20000)
    # slides that are links to other sites (licensed Commons building photos) are not saved photos: the test blocks them, leave them out
    return page.evaluate("""(local) => [...document.querySelectorAll('#dTrack > img')].map((i) => ({ src: i.currentSrc || i.src, ok: i.naturalWidth > 0, gone: i.dataset.mediaGone === '1' }))
      .filter((s) => local.some((p) => s.src.startsWith(p)))""", [tiers.page_url, tiers.published_url])


def test_top_homes_get_a_full_gallery_from_the_starter_set(clone_page, tiers: Tiers) -> None:
    page, errors = clone_page
    top, _ = _ids()
    slides = _drawer_sources(page, tiers, top)
    assert len(slides) >= 10, "a top home shows a real gallery"
    assert all(s["ok"] for s in slides), [s for s in slides if not s["ok"]]
    from_lite = [s for s in slides if "/media-lite/" in s["src"]]
    assert len(from_lite) >= len(slides) - 2, f"{len(from_lite)} of {len(slides)} slides came from media-lite"
    assert not tiers.published_log, f"a top home needs nothing from the published set: {tiers.published_log[:3]}"
    assert not errors


def test_the_rest_show_one_or_two_starter_photos_and_the_published_set_fills_in(clone_page, tiers: Tiers) -> None:
    page, errors = clone_page
    _, lite = _ids()
    slides = _drawer_sources(page, tiers, lite)
    assert len(slides) >= 6
    assert all(s["ok"] for s in slides), [s for s in slides if not s["ok"]]
    from_lite = [s for s in slides if "/media-lite/" in s["src"]]
    from_published = [s for s in slides if s["src"].startswith(tiers.published_url)]
    assert 1 <= len(from_lite) <= 3, f"the starter set holds the hero, one building photo and the floor plans: {len(from_lite)}"
    assert len(from_lite) + len(from_published) == len(slides) and len(from_published) >= len(slides) - 3
    assert not errors


def test_cards_show_their_hero_from_the_starter_set(clone_page, tiers: Tiers) -> None:
    page, _ = clone_page
    page.wait_for_function("""(page) => [...document.querySelectorAll('#cards .card .media > img')].filter((i) => i.complete && i.currentSrc.startsWith(page)).length >= 5""",
                           arg=tiers.page_url, timeout=20000)
    settled(page, 20000, ticks=4)
    shown = page.evaluate("""(page) => [...document.querySelectorAll('#cards .card .media > img')].filter((i) => i.complete && i.currentSrc.startsWith(page)).map((i) => ({ src: i.currentSrc, ok: i.naturalWidth > 0 }))""", tiers.page_url)
    assert len(shown) >= 5
    assert all(s["ok"] for s in shown), shown
    assert all("/media-lite/" in s["src"] for s in shown), "every hero is a starter photo; none needs the published set"
    assert not [p for p in tiers.published_log if p.startswith("/media/")], "the published set was not needed for the cards"


def test_a_missing_folder_is_not_asked_again_for_every_photo(clone_page, tiers: Tiers) -> None:
    page, _ = clone_page
    top, lite = _ids()
    page.wait_for_load_state("networkidle")   # every photo the first screen asks for has been asked for
    first = [p for p in tiers.page_log if p.startswith("/media/")]
    assert len(first) <= 40, f"{len(first)} requests for the folder that is not there"
    _drawer_sources(page, tiers, top)
    _drawer_sources(page, tiers, lite)
    later = [p for p in tiers.page_log if p.startswith("/media/")]
    assert later == first, f"{len(later) - len(first)} more requests for media/ after it was known to be missing"
    per_photo: dict[str, int] = {}
    for p in tiers.published_log:
        per_photo[p] = per_photo.get(p, 0) + 1
    assert per_photo and max(per_photo.values()) <= 2, per_photo


def test_when_nothing_answers_the_photo_is_marked_gone_not_retried_forever(clone_page, tiers: Tiers) -> None:
    page, errors = clone_page
    _, lite = _ids()
    tiers.published_down = True
    slides = _drawer_sources(page, tiers, lite)
    gone = [s for s in slides if s["gone"]]
    assert gone and len(gone) >= len(slides) - 3, "photos that no tier has end up marked, so the page can show its fallback"
    per_photo: dict[str, int] = {}
    for p in tiers.published_log:
        per_photo[p] = per_photo.get(p, 0) + 1
    assert max(per_photo.values()) <= 2, "one try per photo"
    assert not errors
