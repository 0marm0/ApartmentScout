"""Does it fit? in a real browser: type a piece that is not in the catalogue ("Bookshelf 36 x 12 x 72 in") or pick a catalogue piece or
product, drop it into a room, read the answer for where it stands, and add it to the renter's furniture list (kept in the browser the way
layout edits are). Needs WebGL for the studio, otherwise skipped."""
from __future__ import annotations

import json

import pytest

pytestmark = pytest.mark.e2e

UNIT = "paramount-tower-25e"
SHOTS = "/private/tmp/claude-501/-Users-Omar-1-Developer-ApartmentScout/932198fc-4e74-474c-b7c4-6ec0ead28c53/scratchpad/agent-P"


def _studio(s) -> None:
    pg = s.page
    pg.goto(f"{s.origin}/#plan/{UNIT}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.getElementById('tfText')", timeout=90000)
    pg.evaluate("() => localStorage.clear()")
    pg.reload()
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.getElementById('tfText')", timeout=90000)
    pg.wait_for_timeout(500)


def _drop_text(pg, text: str) -> None:
    pg.fill("#tfText", text)
    pg.click("[data-tf=drop-text]")
    pg.wait_for_timeout(250)


def test_a_typed_piece_is_read_dropped_in_and_judged(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    n = pg.evaluate("() => window.__plan3d.items.length")
    # the line under the field says what it understood, as you type
    pg.fill("#tfText", "Bookshelf 36 x 12 x 72 in")
    assert "3' wide × 1' deep × 6' tall" in pg.inner_text("#tfNote")
    pg.fill("#tfText", "bookshelf")
    assert "size" in pg.inner_text("#tfNote")
    # nothing readable: nothing dropped
    pg.click("[data-tf=drop-text]")
    assert pg.evaluate("() => window.__plan3d.items.length") == n
    _drop_text(pg, "Bookshelf 36 x 12 x 72 in")
    it = pg.evaluate("() => window.__plan3d.items.at(-1)")
    assert (it["ref"], it["w"], it["d"], it["h"], it["label"]) == ("bookcase", 36, 12, 72, "Bookshelf")
    assert pg.evaluate("() => window.__plan3d.items.length") == n + 1
    # the answer: a verdict, the space on each side, and the walk from the door once it has been worked out
    card = pg.locator("#psFit .tf-card")
    assert card.is_visible()
    assert "Bookshelf" in card.inner_text()
    assert pg.locator("#psFit .tf-sides li").count() == 4
    pg.wait_for_function("() => !document.querySelector('#psFit .tf-wait')", timeout=15000)
    assert pg.locator("#psFit .tf-verdict").inner_text().startswith(("Fits", "Does not fit"))
    pg.screenshot(path=f"{SHOTS}/fit-card.png")
    assert not s.take()


def test_a_piece_that_cannot_fit_says_what_is_in_the_way(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    _drop_text(pg, "Wardrobe 200 x 80 x 90 in")
    pg.wait_for_function("() => document.querySelector('#psFit .tf-card.g-blocked')")
    txt = pg.locator("#psFit .tf-verdict").inner_text()
    assert txt.startswith("Does not fit here")
    assert pg.locator("#psFit .tf-rows li.g-blocked").count() >= 1
    # the studio's inspector agrees
    assert "blocked" in pg.inner_text("#psInsp").lower() or pg.locator("#psInsp .g-blocked").count() >= 1
    assert not s.take()


def test_a_catalogue_piece_or_a_product_can_be_dropped_at_its_real_size(open_page, webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    pg.select_option("#tfPick", "p:ikea-billy-bookcase")
    pg.click("[data-tf=drop-pick]")
    pg.wait_for_timeout(250)
    it = pg.evaluate("() => window.__plan3d.items.at(-1)")
    assert it["product"] == "ikea-billy-bookcase" and it["ref"] == "bookcase"
    # the maker's size (31.5 x 11 x 79.5 in), not the catalogue's generic one
    assert [pg.input_value("#psFw"), pg.input_value("#psFd"), pg.input_value("#psFh")] == ["31.5", "11", "79.5"]
    pg.select_option("#tfPick", "c:armchair")
    pg.click("[data-tf=drop-pick]")
    pg.wait_for_timeout(250)
    assert pg.evaluate("() => window.__plan3d.items.at(-1).ref") == "armchair"
    assert pg.locator("#psFit .tf-card").is_visible()
    assert not s.take()


def test_adding_to_the_furniture_list_is_remembered_and_downloadable(open_page, webgl: bool, tmp_path) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")
    s = open_page("#map", height=1000)
    pg = s.page
    _studio(s)
    before = pg.evaluate("() => window.__plan3d.inventory.pieces.length")
    _drop_text(pg, "Bookshelf 36 x 12 x 72 in")
    pg.click("#psFit [data-tf=add]")
    pg.wait_for_function("(n) => window.__plan3d.inventory.pieces.length === n + 1", arg=before)
    piece = pg.evaluate("() => window.__plan3d.inventory.pieces.at(-1)")
    assert (piece["ref"], piece["label"], piece["w"], piece["d"], piece["h"]) == ("bookcase", "Bookshelf", 36, 12, 72)
    assert piece["room"] in ("living", "bedroom", "dining", "office", "kitchen", "other")
    # the list shows it as placed, and the card now says it is in the list
    assert pg.locator("#psTab .iv-row", has_text="Bookshelf").count() == 1
    assert "In your furniture list" in pg.inner_text("#psFit")
    # downloadable in the furniture.json format
    with pg.expect_download() as dl:
        pg.click("#psFit [data-tf=download]")
    data = json.loads(open(dl.value.path()).read())
    assert data["kind"] == "apartmentscout-furniture" and any(p["label"] == "Bookshelf" for p in data["pieces"])
    assert "/Users/" not in json.dumps(data)
    # it survives a reload (browser storage, like the layout), in the list and in the layout
    pg.reload()
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0", timeout=90000)
    pg.wait_for_function("(n) => window.__plan3d.inventory && window.__plan3d.inventory.pieces.length === n + 1", arg=before)
    assert pg.evaluate("() => window.__plan3d.items.some((i) => i.label === 'Bookshelf' && i.w === 36)")
    assert not s.take()
