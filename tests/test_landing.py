"""The landing page is self-contained: its fonts are the vendored Geist files, not Google Fonts."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_landing_page_makes_no_font_cdn_request() -> None:
    html = (ROOT / "landing" / "index.html").read_text()
    assert "fonts.googleapis.com" not in html and "fonts.gstatic.com" not in html
    assert 'href="fonts/geist.css"' in html


def test_pages_workflow_publishes_the_fonts_the_landing_page_names() -> None:
    flow = (ROOT / ".github" / "workflows" / "pages.yml").read_text()
    assert "scripts/build_site.sh" in flow, "the workflow assembles the site with the shared script"
    assemble = (ROOT / "scripts" / "build_site.sh").read_text()
    assert 'cp dashboard/vendor/fonts/* "$OUT/fonts/"' in assemble
    css = (ROOT / "dashboard" / "vendor" / "fonts" / "geist.css").read_text()
    for name in re.findall(r'url\("([^"]+)"\)', css):
        assert (ROOT / "dashboard" / "vendor" / "fonts" / name).is_file(), name
