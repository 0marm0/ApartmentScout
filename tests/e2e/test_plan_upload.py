"""Adding a floor plan end to end, for a home that is not in New York: trace a PNG and a PDF plan in the tracer, save, and see
the plan in the Floor plan studio and in Unit 3D. The page is served by a real `apartmentscout serve` API on a temporary search
in Lisbon, so "Save to the search folder" writes plans/<listing-id>.json for real. The plan images are drawn here, no network."""
from __future__ import annotations

import json
import struct
import threading
import zlib
from pathlib import Path

import pytest
from conftest import block_foreign, frames, poll
from osm_stub import stub_osm

from apartmentscout import cli
from apartmentscout.config import Workspace
from apartmentscout.intake import init_search
from apartmentscout.listings import normalize, save
from apartmentscout.localapi import ServeState, make_server

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels except where a test says so: see conftest.NO_RASTER_JS

ROOT = Path(__file__).resolve().parents[2]
W, H = 400, 300


def plan_png() -> bytes:
    """A 400 x 300 greyscale PNG of a one-bedroom plan: an outer wall, one partition, and a printed dimension line along the bottom."""
    px = [[255] * W for _ in range(H)]

    def line(x0, y0, x1, y1):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                px[y][x] = 0
    line(40, 40, 360, 40); line(40, 260, 360, 260); line(40, 40, 40, 260); line(360, 40, 360, 260); line(240, 40, 240, 260)
    line(40, 285, 360, 285); line(40, 278, 40, 292); line(360, 278, 360, 292)         # the dimension line, 320 px long
    raw = b"".join(b"\x00" + bytes(row) for row in px)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def plan_pdf() -> bytes:
    """A one-page PDF (400 x 300 pt) with the same outer wall, partition and dimension line, with a real cross-reference table."""
    stream = (b"0 0 0 RG 2 w 40 40 320 220 re S 240 40 m 240 260 l S 40 15 m 360 15 l S 40 8 m 40 22 l S 360 8 m 360 22 l S "
              b"BT /F1 12 Tf 150 2 Td (16 ft) Tj ET")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream), b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


@pytest.fixture
def served(tmp_path: Path, browser, monkeypatch):
    stub_osm(monkeypatch)   # the buildings around each home come from a made-up OpenStreetMap, so Unit 3D has a site to open
    searches = tmp_path / "searches"
    mine = searches / "lisbon"
    init_search(mine, "generic")
    save([normalize({"building": "Rua Augusta", "unit": "3E", "address": "Rua Augusta 100, Lisboa", "status": "shortlist", "beds": 1, "sqft": 600,
                     "lat": 38.7106, "lon": -9.1394, "price": {"gross": 1900}, "floor": 3, "exposure": ["SW"]}),
          normalize({"building": "Alfama Court", "unit": "1A", "address": "Rua de Sao Tome 5, Lisboa", "status": "shortlist", "beds": 1, "sqft": 500,
                     "lat": 38.7115, "lon": -9.1294, "price": {"gross": 1700}, "floor": 1})], mine / "listings.json")
    for listing_id in ("rua-augusta-3e", "alfama-court-1a"):
        cli.main(["site", listing_id, "--search", str(mine)])
    state = ServeState(dash=ROOT / "dashboard", searches_dir=searches, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(mine))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    base = f"http://127.0.0.1:{state.port}"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce", accept_downloads=True)
    block_foreign(ctx, base)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    yield page, base, mine, errors
    ctx.close()
    httpd.shutdown()
    httpd.server_close()


# the image in plan units: pixels on the 400 x 300 drawing as fractions of the image's width and height
def click_img(page, px: float, py: float, **kw) -> None:
    box = page.evaluate("() => { const r = document.getElementById('trImg').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")
    page.mouse.click(box[0] + box[2] * px / W, box[1] + box[3] * py / H, **kw)


def drag_img(page, a: tuple[float, float], b: tuple[float, float]) -> None:
    box = page.evaluate("() => { const r = document.getElementById('trImg').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")
    at = lambda p: (box[0] + box[2] * p[0] / W, box[1] + box[3] * p[1] / H)   # noqa: E731
    page.mouse.move(*at(a)); page.mouse.down(); page.mouse.move(*at(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))); page.mouse.move(*at(b)); page.mouse.up()


def trace(page, file: dict, listing: str, close_to_unit: bool = True) -> None:
    """Load the image, set the scale from the printed dimension, orient it, trace two rooms with a window and a door, pick the listing."""
    page.wait_for_selector("#trNewBtn", timeout=30000)
    page.click("#trNewBtn")
    page.wait_for_selector("#trFile", state="attached", timeout=10000)
    page.click("[data-act=units][data-u=m]")                          # a Lisbon plan is in metres
    page.set_input_files("#trFile", files=[file])
    page.wait_for_selector("#trImg", timeout=30000)
    page.wait_for_function("""async () => { const h = document.getElementById('trImg')?.getAttribute('href'); if (!h) return false;
      const i = new Image(); i.src = h; try { await i.decode(); return true; } catch { return false; } }""", timeout=30000)   # the plan image has loaded
    frames(page)
    page.click("[data-step=scale]")
    click_img(page, 40, 285); click_img(page, 360, 285)               # both ends of the printed dimension
    page.fill("#trScaleLen", "8 m")
    page.click("[data-act=scale]")
    page.wait_for_function("() => /px per metre/.test(document.querySelector('.tr-shell, #trShell')?.textContent || '')", timeout=5000)
    page.click("[data-step=north]")
    page.click("[data-act=nmode][data-m=typed]")
    page.fill("#trBearing", "200")
    page.click("[data-step=rooms]")
    page.click("[data-tool=rect]")
    drag_img(page, (40, 40), (240, 260))                              # the living room
    drag_img(page, (240, 40), (360, 260))                             # the bedroom
    page.click("[data-step=openings]")
    page.click("[data-tool=window]")
    click_img(page, 120, 40)
    page.click("[data-tool=door]")
    click_img(page, 240, 200)
    page.click("[data-step=details]")
    page.select_option("#trListing", listing)
    page.click("[data-step=save]")


def test_a_png_plan_traced_for_a_lisbon_home_is_saved_into_the_search_and_shows_in_the_studio_and_unit_3d(served) -> None:
    page, base, mine, errors = served
    page.goto(f"{base}/#plan")
    trace(page, {"name": "plan.png", "mimeType": "image/png", "buffer": plan_png()}, "rua-augusta-3e")
    assert "Save to the search folder" in page.inner_text(".tr-actions")
    assert page.is_enabled("[data-act=save-folder]"), page.inner_text(".tr-issues") if page.query_selector(".tr-issues") else "save is disabled"
    page.click("[data-act=save-folder]")
    page.wait_for_function("() => location.hash.startsWith('#plan/rua-augusta-3e')", timeout=15000)
    f = mine / "plans" / "rua-augusta-3e.json"
    page.wait_for_selector("#planSel", timeout=30000)
    doc = json.loads(f.read_text())
    assert doc["id"] == "rua-augusta-3e" and doc["units"] == "m" and len(doc["rooms"]) == 2
    assert doc["provenance"]["trace"]["image"] == "plan.png" and doc["up_bearing"] == 200
    assert len(doc["windows"]) == 1 and len(doc["doors"]) == 1
    area = sum(r["w"] * r["h"] for r in doc["rooms"])
    assert area == pytest.approx(44, rel=0.06), "320 px = 8 m, so the 320 x 220 px drawing is 8 x 5.5 m"
    page.wait_for_function("() => document.getElementById('planSel')?.value === 'rua-augusta-3e'", timeout=20000)
    # the studio reads the saved file, not only the browser's library
    assert page.evaluate("() => localStorage.getItem('plan-projects.data') === null || !JSON.parse(localStorage.getItem('plan-projects.data'))['rua-augusta-3e']")
    # Unit 3D finds the plan for the listing
    page.goto(f"{base}/#unit/rua-augusta-3e")
    page.reload()
    page.wait_for_selector("a[href='#plan/rua-augusta-3e']", timeout=60000)
    assert not errors, errors


def test_replacing_a_saved_plan_needs_a_second_click(served) -> None:
    page, base, mine, errors = served
    (mine / "plans").mkdir(exist_ok=True)
    (mine / "plans" / "rua-augusta-3e.json").write_text(json.dumps({"schema": 2, "id": "rua-augusta-3e", "title": "Older", "units": "ft",
                                                                    "rooms": [{"name": "R", "x": 0, "y": 0, "w": 10, "h": 10}]}))
    page.goto(f"{base}/#plan")
    trace(page, {"name": "plan.png", "mimeType": "image/png", "buffer": plan_png()}, "rua-augusta-3e")
    page.click("[data-act=save-folder]")
    page.wait_for_selector(".toast, [role=status]:has-text('already exists')", timeout=10000)
    assert json.loads((mine / "plans" / "rua-augusta-3e.json").read_text())["title"] == "Older", "the first click does not overwrite"
    page.click("[data-act=save-folder]")
    page.wait_for_function("() => location.hash.startsWith('#plan/rua-augusta-3e')", timeout=15000)
    poll(lambda: (mine / "plans" / "rua-augusta-3e.json.bak").exists(), page, timeout=10)   # the first file is kept as .bak, then the new one is written
    assert json.loads((mine / "plans" / "rua-augusta-3e.json").read_text())["title"] != "Older"
    assert (mine / "plans" / "rua-augusta-3e.json.bak").exists()


def test_a_pdf_plan_traced_the_same_way_opens_in_the_studio(served) -> None:
    page, base, mine, errors = served
    page.goto(f"{base}/#plan")
    trace(page, {"name": "plan.pdf", "mimeType": "application/pdf", "buffer": plan_pdf()}, "alfama-court-1a")
    page.click("[data-act=save-folder]")
    page.wait_for_function("() => location.hash.startsWith('#plan/alfama-court-1a')", timeout=15000)
    page.wait_for_selector("#planSel", timeout=30000)
    doc = json.loads((mine / "plans" / "alfama-court-1a.json").read_text())
    assert doc["provenance"]["trace"]["image"] == "plan.pdf" and doc["provenance"]["trace"].get("page") == 1
    page.wait_for_function("() => document.getElementById('planSel')?.value === 'alfama-court-1a'", timeout=20000)
    assert not errors, errors
