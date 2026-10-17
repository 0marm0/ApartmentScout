"""The landing page is self-contained: its fonts are the vendored Geist files, not Google Fonts; its screenshots are WebP made from
docs/images by scripts/landing_images.py."""
from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

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


def test_every_screenshot_the_landing_page_names_has_a_source_png() -> None:
    """The page asks for images/<name>.webp (and -800 steps); scripts/landing_images.py makes them from docs/images/<name>.png."""
    html = (ROOT / "landing" / "index.html").read_text()
    names = set(re.findall(r"images/([a-z0-9][a-z0-9-]*?)(?:-800)?\.webp", html))
    assert len(names) > 25
    missing = sorted(n for n in names if not (ROOT / "docs" / "images" / f"{n}.png").is_file())
    assert not missing, f"docs/images has no PNG for {missing}"
    assert not re.search(r"images/[\w-]+\.png", html), "the page names WebP files; the PNGs are for the README"


def test_landing_images_script_reads_the_page_and_writes_what_it_names(tmp_path: Path) -> None:
    pytest.importorskip("PIL")
    from PIL import Image
    spec = importlib.util.spec_from_file_location("landing_images", ROOT / "scripts" / "landing_images.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    full, small = mod.wanted('<img src="images/a-b.webp" srcset="images/a-b-800.webp 800w, images/a-b.webp 1600w"> images/c.webp')
    assert full == {"a-b", "c"} and small == {"a-b"}
    page = tmp_path / "page.html"
    page.write_text('<img src="images/phone-map.webp"> <img srcset="images/hero-map-800.webp 800w">')
    out = tmp_path / "images"
    subprocess.run([sys.executable, str(ROOT / "scripts" / "landing_images.py"), str(out), "--html", str(page)], check=True, capture_output=True)
    assert sorted(p.name for p in out.iterdir()) == ["hero-map-800.webp", "og.jpg", "phone-map.webp"]
    w, h = Image.open(ROOT / "docs" / "images" / "hero-map.png").size
    assert Image.open(out / "hero-map-800.webp").size == (800, round(800 * h / w))   # 800 px wide at the screenshot's own shape
    assert Image.open(out / "og.jpg").size == (1200, 630)
