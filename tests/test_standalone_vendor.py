"""The standalone build inlines the vendored libraries, so the single file needs no CDN."""
from __future__ import annotations

import base64
import json
import re

from apartmentscout.cli import DASH, _inline_vendor


def test_inline_vendor_replaces_every_vendor_reference() -> None:
    html = _inline_vendor((DASH / "index.html").read_text())
    assert 'href="vendor/' not in html and 'src="vendor/' not in html
    assert "cdn.jsdelivr.net" not in html and "fonts.googleapis.com" not in html
    assert "data:font/woff2;base64," in html
    imap = json.loads(re.search(r'<script type="importmap">(.*?)</script>', html, re.S).group(1))["imports"]
    assert imap["three"].startswith("data:text/javascript;base64,")
    for used in ("controls/OrbitControls.js", "exporters/GLTFExporter.js", "lights/RectAreaLightUniformsLib.js"):
        assert "three/addons/" + used in imap
    # a data: module cannot resolve './../utils/TextureUtils.js': the exporter must ask the import map instead
    exporter = base64.b64decode(imap["three/addons/exporters/GLTFExporter.js"].split(",", 1)[1]).decode()
    assert "'three/addons/utils/TextureUtils.js'" in exporter and "./../utils" not in exporter
    assert "three/addons/utils/TextureUtils.js" in imap
    # the plan tracer's PDF reader and its worker are in the import map too
    assert imap["pdfjs-dist"].startswith("data:text/javascript;base64,")
    assert imap["pdfjs-dist/worker"].startswith("data:text/javascript;base64,")


def test_pdfjs_is_vendored_not_fetched_from_a_cdn() -> None:
    page = (DASH / "index.html").read_text()
    imap = json.loads(re.search(r'<script type="importmap">(.*?)</script>', page, re.S).group(1))["imports"]
    for name in ("pdfjs-dist", "pdfjs-dist/worker"):
        assert (DASH / imap[name]).is_file(), f"{name} must point at a vendored file"
    assert (DASH / "vendor" / "pdfjs" / "LICENSE").is_file()
    for f in (DASH / "js").rglob("*.js"):
        assert "cdn.jsdelivr.net" not in f.read_text(), f"{f.name} loads a library from a CDN"


def test_every_three_import_in_the_dashboard_is_vendored() -> None:
    used = set()
    for f in (DASH / "js").rglob("*.js"):
        used |= set(re.findall(r"three/addons/([\w/]+\.js)", f.read_text()))
    missing = [u for u in sorted(used) if not (DASH / "vendor" / "three" / "addons" / u).exists()]
    assert not missing, f"vendor these three.js addons into dashboard/vendor/three/addons/: {missing}"
