"""The plan tracer reads a PDF floor plan with the vendored pdf.js: no CDN, so it works with the network blocked."""
from __future__ import annotations

import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.no_raster]   # reads no drawn pixels except where a test says so: see conftest.NO_RASTER_JS


def one_page_pdf() -> bytes:
    """A valid one-page PDF (a rectangle and a word) with a real cross-reference table."""
    stream = b"0.2 0.2 0.2 rg 40 40 320 220 re S BT /F1 18 Tf 60 140 Td (Plan) Tj ET"
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents 4 0 R "
            b"/Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
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


def test_a_pdf_plan_opens_in_the_tracer_offline(open_page) -> None:
    s = open_page("#plan")
    s.page.wait_for_selector("#trNewBtn", timeout=30000)
    s.page.click("#trNewBtn")
    s.page.wait_for_selector("#trFile", state="attached", timeout=10000)
    s.page.set_input_files("#trFile", files=[{"name": "plan.pdf", "mimeType": "application/pdf", "buffer": one_page_pdf()}])
    s.page.wait_for_selector("#trImg", timeout=30000)
    size = s.page.evaluate("() => { const i = document.getElementById('trImg'); return [+i.getAttribute('width'), +i.getAttribute('height')]; }")
    assert size[0] > size[1] > 0          # the 400 x 300 pt page, drawn landscape
    assert not s.take()
