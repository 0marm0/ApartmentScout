"""View in your room (AR): the Floor plan studio offers the furnished room and each piece in AR Quick Look on iPhone and iPad (a real
`<a rel="ar">` link to a .usdz built in the page), a .usdz or .glb download on a desktop or Android phone, always from the Visual models
at true size. Needs WebGL, otherwise skipped."""
from __future__ import annotations

import base64
import io
import json
import struct
import zipfile

import pytest
from conftest import settled

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels: see conftest.NO_RASTER_JS

UNIT = "paramount-tower-25e"
IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
IN = 0.0254


def _need_webgl(webgl: bool) -> None:
    if not webgl:
        pytest.skip("no WebGL in this browser (SwiftShader unavailable)")


def _studio(browser, base_url: str, ua: str | None = None, width: int = 1500, height: int = 1000, touch: bool = False):
    """A fresh context (own user agent, foreign hosts blocked) with the studio open on the 25E plan; returns (context, page)."""
    kw = {"viewport": {"width": width, "height": height}, "service_workers": "block", "accept_downloads": True, "has_touch": touch}
    if ua:
        kw["user_agent"] = ua
    ctx = browser.new_context(**kw)
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith((base_url, "data:", "blob:")) else r.abort())
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    pg.goto(f"{base_url}/#plan/{UNIT}")
    pg.wait_for_function("() => window.__plan3d && window.__plan3d.items.length > 0 && !!document.querySelector('#psTab .ar')", timeout=90000)
    settled(pg, 20000, ticks=5)
    pg.errors = errors  # type: ignore[attr-defined]
    return ctx, pg


FETCH = """async (sel) => { const a = document.querySelector(sel), r = await fetch(a.href), b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return { type: r.headers.get('content-type'), b64: btoa(s) }; }"""


def _usdz(zbytes: bytes) -> zipfile.ZipFile:
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    infos = z.infolist()
    assert infos[0].filename == "model.usda", "the scene file is first"
    for zi in infos:
        assert zi.compress_type == zipfile.ZIP_STORED, f"{zi.filename} is stored, not compressed (USDZ)"
        assert (zi.header_offset + 30 + len(zi.filename.encode()) + len(zi.extra)) % 64 == 0, f"{zi.filename} starts on a 64-byte boundary"
    return z


def _glb(data: bytes) -> dict:
    magic, version, length = struct.unpack("<4sII", data[:12])
    assert magic == b"glTF" and version == 2 and length == len(data)
    n, kind = struct.unpack("<I4s", data[12:20])
    assert kind == b"JSON"
    return json.loads(data[20:20 + n])


def test_iphone_and_ipad_get_a_real_ar_quick_look_link_for_the_room_and_every_piece(browser, base_url: str, webgl: bool) -> None:
    _need_webgl(webgl)
    ctx, pg = _studio(browser, base_url, IOS_UA, 820, 1100, touch=True)
    try:
        assert "See it in your room" in pg.locator("#psTab .ar h3").text_content()
        pg.wait_for_function("() => document.querySelectorAll('#psTab a[rel=ar]').length === 11", timeout=120000)   # the room and the ten pieces
        room = pg.locator("#psTab .ar-room a[rel=ar]")
        assert "View in your room (AR)" in room.text_content()
        assert room.evaluate("a => a.firstElementChild.tagName") == "IMG", "Safari wants the link's first child to be an image"
        assert room.evaluate("a => a.relList.contains('ar') && a.getAttribute('href').startsWith('blob:') && a.getAttribute('download').endsWith('.usdz')")
        assert pg.locator("#psTab .ps-item .ar-row a[rel=ar]").count() == 10, "each piece in the list has its own AR link"
        assert pg.locator("#psTab [data-ar-dl]").count() == 0, "an iPhone is not offered a download instead"
        got = pg.evaluate(FETCH, "#psTab .ar-room a[rel=ar]")
        assert got["type"] == "model/vnd.usdz+zip"
        z = _usdz(base64.b64decode(got["b64"]))
        model = z.read("model.usda").decode()
        assert 'metersPerUnit = 1' in model and 'upAxis = "Y"' in model and "UsdPreviewSurface" in model
        assert model.count('def Xform "Object_') > 80, "the whole furnished room: every piece's meshes"
        assert any(n.startswith("textures/") for n in z.namelist()), "wood grain, weave and leather ride along as textures"
        assert "inputs:normal.connect" in model, "the leather's pebbled grain was baked to a normal map"
        # one piece: the futon, black leather on a black frame, with its own file
        futon = _usdz(base64.b64decode(pg.evaluate(FETCH, "#psTab .ps-item[data-id=futon] a[rel=ar]")["b64"]))
        fm = futon.read("model.usda").decode()
        assert fm.count("def Material") >= 3 and "inputs:normal.connect" in fm
        assert fm.count('def Xform "Object_') < model.count('def Xform "Object_') / 4
        # the selected piece's inspector carries the same link
        pg.click("#psTab [data-sel=desk]")
        pg.wait_for_function("() => !!document.querySelector('#psInsp .ps-ar a[rel=ar]')", timeout=60000)
        assert pg.locator("#psInsp .ps-ar a[rel=ar]").get_attribute("download") == "bestier-rotating-desk-51-in-chair-and-monitor.usdz"   # the file is named after the piece's label
        # moving a piece makes the room's file stale; a new one is built and the link changes
        before = room.get_attribute("href")
        pg.evaluate("() => { document.activeElement.blur(); }")
        pg.keyboard.press("ArrowLeft")
        pg.wait_for_function("(h) => { const a = document.querySelector('#psTab .ar-room a[rel=ar]'); return !!a && a.getAttribute('href') !== h; }", arg=before, timeout=60000)
        assert not pg.errors
    finally:
        ctx.close()


def test_the_ar_model_is_true_scale_visual_whatever_the_screen_draws(browser, base_url: str, webgl: bool) -> None:
    _need_webgl(webgl)
    ctx, pg = _studio(browser, base_url)
    try:
        pg.evaluate("""async () => { const Q = await import('/js/room3d/quality.js'); Q.quality.setMode('fast'); }""")
        info = pg.evaluate("""async () => { const S = await import('/js/plan/scene3d.js'), out = {};
          for (const id of ['dresser', 'futon', 'bed', 'tv', 'desk', 'nightstand-1', 'coffee', 'dining']) { const g = await S.arModel([id]); out[id] = { size: g.userData.ar.size, tris: g.userData.ar.triangles, mats: g.userData.ar.materials, tex: g.userData.ar.textures, min: g.userData.ar.min,
            untinted: g.children.filter((m) => m.material.map && m.material.color.getHex() !== 0xffffff).length }; }
          const room = await S.arModel(null); out.room = { size: room.userData.ar.size, tris: room.userData.ar.triangles, tex: room.userData.ar.textures };
          return out; }""")
        s = info["dresser"]["size"]
        assert abs(s[0] - 27.6 * IN) < 0.01 and abs(s[1] - 47.2 * IN) < 0.01 and abs(s[2] - 18.9 * IN) < 0.012, f"STORKLINTA is 70 x 120 x 48 cm ({[round(v / IN, 1) for v in s]} in)"
        assert abs(info["bed"]["size"][0] - 64 * IN) < 0.02 and abs(info["bed"]["size"][1] - 40 * IN) < 0.02, "the queen frame is 64 in wide and 40 in tall with its headboard"
        assert abs(info["tv"]["size"][0] - 48.4 * IN) < 0.02 and abs(info["tv"]["min"][1] - 32 * IN) < 0.03, "a 55-inch TV 32 in off the floor"
        assert abs(info["desk"]["size"][0] - 89.2 * IN) < 0.03, "the Bestier desk used straight, its shelf pivoted out: 89.2 in end to end"
        assert abs(info["futon"]["size"][0] - 73.2 * IN) < 0.06
        assert info["room"]["tris"] <= 40000, f"the whole room: {info['room']['tris']} triangles"
        for pid, v in info.items():
            if pid == "room":
                continue
            assert v["tris"] <= 8200, f"{pid}: {v['tris']} triangles (Visual 6,000 plus the back side of its cloth)"
        assert info["futon"]["tris"] > 3000 and info["bed"]["tris"] > 4000, "Fast is on screen, but AR gets the Visual models"
        assert all(v.get("untinted", 0) == 0 for v in info.values()), "a colour map is baked with its colour (Apple's importers ignore the texture scale), so every textured material is white"
        assert info["futon"]["tex"] >= 1 and info["dresser"]["tex"] >= 1 and info["desk"]["tex"] >= 2, "wood grain, leather and weave textures are in the AR models"
        rs = info["room"]["size"]
        assert 4 < rs[0] < 9 and 3 < rs[2] < 9 and 0.9 < rs[1] < 1.6, f"the whole room is a real apartment's footprint ({[round(v, 2) for v in rs]} m)"
        assert not pg.errors
    finally:
        ctx.close()


def test_a_desktop_downloads_the_usdz_and_the_glb_instead(browser, base_url: str, webgl: bool, tmp_path) -> None:
    _need_webgl(webgl)
    ctx, pg = _studio(browser, base_url)
    try:
        assert pg.locator("#psTab a[rel=ar]").count() == 0, "no AR link on a desktop"
        assert pg.locator("#psTab .ar-room [data-ar-dl]").count() == 2
        assert pg.locator("#psTab .ps-item .ar-row [data-ar-dl=usdz]").count() == 10
        with pg.expect_download(timeout=90000) as d:
            pg.click("#psTab .ar-room [data-ar-dl=usdz]")
        path = tmp_path / d.value.suggested_filename
        d.value.save_as(path)
        assert d.value.suggested_filename.endswith(".usdz")
        z = _usdz(path.read_bytes())
        assert "def Material" in z.read("model.usda").decode()
        with pg.expect_download(timeout=90000) as g:
            pg.click("#psTab .ps-item[data-id=dresser] [data-ar-dl=glb]")
        assert g.value.suggested_filename == "ikea-storklinta-6-drawer-dresser.glb"
        gp = tmp_path / "storklinta.glb"
        g.value.save_as(gp)
        j = _glb(gp.read_bytes())
        assert len(j["materials"]) >= 3 and len(j["meshes"]) >= 5 and j.get("images"), "materials with their textures"
        assert all("pbrMetallicRoughness" in m for m in j["materials"])
        # the Layout menu has the room as a .usdz too
        pg.click("#psFileBtn")
        with pg.expect_download(timeout=90000) as m:
            pg.click("#psMenu [data-f=ar-usdz]")
        assert m.value.suggested_filename.endswith(".usdz")
        assert not pg.errors
    finally:
        ctx.close()


def test_an_android_phone_is_offered_the_glb_first(browser, base_url: str, webgl: bool) -> None:
    _need_webgl(webgl)
    ctx, pg = _studio(browser, base_url, ANDROID_UA, 820, 1100, touch=True)
    try:
        assert pg.locator("#psTab a[rel=ar]").count() == 0
        first = pg.locator("#psTab .ar-room [data-ar-dl]").first
        assert first.get_attribute("data-ar-dl") == "glb" and ".glb" in first.text_content()
        assert not pg.errors
    finally:
        ctx.close()
