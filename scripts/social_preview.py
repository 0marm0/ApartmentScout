#!/usr/bin/env python3
"""Makes docs/images/social-preview.png, the 1280 x 640 image GitHub shows when the repository is shared (Settings > General > Social
preview). It is a Unit 3D shot from docs/images with the name and tagline over a dark gradient, set in the dashboard's own Geist font.

    python scripts/social_preview.py [--shot inside-skyline-dusk] [--out docs/images/social-preview.png]

GitHub's API cannot set the social preview: the repository owner uploads the PNG once in the repository's Settings.
Needs: pip install playwright && playwright install chromium.
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "dashboard" / "vendor" / "fonts"
W, H = 1280, 640

PIN = ('<svg viewBox="10 10 80 88" width="64" height="70" aria-hidden="true"><defs><clipPath id="h"><circle cx="50" cy="40" r="25"/></clipPath></defs>'
       '<path d="M50 95C50 95 15.5 57.5 15.5 40A34.5 34.5 0 1 1 84.5 40C84.5 57.5 50 95 50 95ZM75 40A25 25 0 1 1 25 40A25 25 0 1 1 75 40Z" fill="#12865f" fill-rule="evenodd"/>'
       '<path d="M49.25 29L50 16.5L50.75 29ZM48 29H52V36.6H48ZM46 36.6H54V39.2H46ZM44 39.2H56V42.2H44ZM42 42.2H58V47.8H42ZM40 47.8H60V70H40ZM45.3 41.6H46.7V70H45.3ZM49.3 41.6H50.7V70H49.3ZM53.3 41.6H54.7V70H53.3Z" fill="#fff" fill-rule="evenodd" clip-path="url(#h)"/></svg>')


def page(shot: Path) -> str:
    return f"""<!doctype html><meta charset="utf-8"><style>
@font-face {{ font-family: Geist; src: url("{(FONTS / 'Geist-Variable.woff2').as_uri()}"); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ width: {W}px; height: {H}px; overflow: hidden; background: #08090c; font-family: Geist, system-ui, sans-serif; color: #f3f5f8; }}
.shot {{ position: absolute; inset: 0; background: url("{shot.as_uri()}") 0 -78px / 1330px auto no-repeat; transform-origin: 0 0; }}
.fade {{ position: absolute; inset: 0; background:
  linear-gradient(90deg, rgba(8,9,12,.96) 0%, rgba(8,9,12,.90) 34%, rgba(8,9,12,.55) 58%, rgba(8,9,12,0) 82%),
  linear-gradient(0deg, rgba(8,9,12,.55), rgba(8,9,12,0) 30%); }}
.copy {{ position: absolute; left: 72px; top: 0; bottom: 0; width: 640px; display: flex; flex-direction: column; justify-content: center; }}
.brand {{ display: flex; align-items: center; gap: 18px; margin-bottom: 38px; }}
.brand b {{ font-size: 40px; font-weight: 600; letter-spacing: -.02em; }}
h1 {{ font-size: 62px; line-height: 1.04; font-weight: 650; letter-spacing: -.035em; }}
p {{ margin-top: 26px; font-size: 25px; line-height: 1.4; color: #c4cad6; max-width: 560px; }}
.url {{ position: absolute; left: 72px; bottom: 44px; font-size: 21px; color: #8b94a6; letter-spacing: .01em; }}
</style>
<div class="shot"></div><div class="fade"></div>
<div class="copy"><div class="brand">{PIN}<b>ApartmentScout</b></div>
<h1>Know the apartment<br>before you sign.</h1>
<p>Rank every listing on your own criteria, time the commute, read the building's records, and stand inside the unit.</p></div>
<div class="url">github.com/0marm0/ApartmentScout</div>"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shot", default="inside-skyline-dusk", help="a docs/images screenshot (without .png)")
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "images" / "social-preview.png")
    a = ap.parse_args()
    shot = ROOT / "docs" / "images" / f"{a.shot}.png"
    if not shot.is_file():
        raise SystemExit(f"no such screenshot: {shot}")
    with tempfile.TemporaryDirectory(prefix="as-social-") as d:
        html = Path(d) / "card.html"
        html.write_text(page(shot), encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            pg = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
            pg.goto(html.as_uri())
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(600)
            a.out.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(a.out))
            browser.close()
    print(f"{a.out} ({W} x {H})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
