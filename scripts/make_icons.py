#!/usr/bin/env python3
"""Render the installable-app icons from the brand pin (the mark drawn in dashboard/index.html).

    python scripts/make_icons.py            # writes dashboard/assets/pwa/*.png and favicon.ico

The mark is the same two paths the top bar inlines (a pin with a tower in its hole), coloured with the dark theme's
`--brand` / `--brand-tower` (#12865f / #ffffff) on the dark ground and the light theme's (#05583f / #263533) on the
light ground. Chromium (Playwright) rasterises the SVG, so no imaging library is needed; the .ico is a PNG payload
in an ICO container, written by hand.

    icon-{192,512}.png            any purpose, dark tile with rounded corners (the manifest's icons)
    icon-light-{192,512}.png      the same on the light ground (light-scheme favicons; the manifest cannot switch by scheme)
    maskable-{192,512}.png        full-bleed dark square, mark inside the 80 % safe zone, for adaptive/maskable icons
    apple-touch-icon.png          180 px, opaque (iOS rounds it)
    favicon-32.png / favicon-32-light.png / favicon.ico   browser tab icons (PNG fallbacks for the SVG favicon)
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dashboard" / "assets" / "pwa"

PIN = "M50 95C50 95 15.5 57.5 15.5 40A34.5 34.5 0 1 1 84.5 40C84.5 57.5 50 95 50 95ZM75 40A25 25 0 1 1 25 40A25 25 0 1 1 75 40Z"
TOWER = ("M49.25 29L50 16.5L50.75 29ZM48 29H52V36.6H48ZM46 36.6H54V39.2H46ZM44 39.2H56V42.2H44ZM42 42.2H58V47.8H42ZM40 47.8H60V70H40Z"
         "M45.3 41.6H46.7V70H45.3ZM49.3 41.6H50.7V70H49.3ZM53.3 41.6H54.7V70H53.3Z")
THEMES = {"dark": {"ground": "#0b0d12", "ring": "#12865f", "tower": "#ffffff"},
          "light": {"ground": "#f4f4f1", "ring": "#05583f", "tower": "#263533"}}
# the pin spans x 15.5..84.5 and y 5.5..95 of the 100-unit box; its centre is (50, 50.25)
PIN_H, PIN_CY = 89.5, 50.25


def svg(size: int, theme: str, *, height_frac: float, radius_frac: float = 0.0) -> str:
    """A square icon: the ground (optionally rounded) and the mark `height_frac` of the side tall, centred."""
    c = THEMES[theme]
    k = size * height_frac / PIN_H                       # pixels per brand unit
    tx, ty = size / 2 - 50 * k, size / 2 - PIN_CY * k
    ground = (f'<rect width="{size}" height="{size}" rx="{size * radius_frac:.2f}" fill="{c["ground"]}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">{ground}'
            f'<defs><clipPath id="h"><circle cx="50" cy="40" r="25"/></clipPath></defs>'
            f'<g transform="translate({tx:.3f} {ty:.3f}) scale({k:.5f})">'
            f'<path d="{PIN}" fill="{c["ring"]}" fill-rule="evenodd"/>'
            f'<path d="{TOWER}" fill="{c["tower"]}" fill-rule="evenodd" clip-path="url(#h)"/></g></svg>')


def jobs() -> dict[str, str]:
    out: dict[str, str] = {}
    for s in (192, 512):
        out[f"icon-{s}.png"] = svg(s, "dark", height_frac=0.70, radius_frac=0.22)
        out[f"icon-light-{s}.png"] = svg(s, "light", height_frac=0.70, radius_frac=0.22)
        # maskable: the platform crops to a circle of diameter 80 % of the side, so the mark must sit inside radius 40 %
        # (the pin's farthest point from its centre is 44.75 units, so 72 % of the side tall puts it at radius 36 %, inside the 40 % safe zone)
        out[f"maskable-{s}.png"] = svg(s, "dark", height_frac=0.72)
    out["apple-touch-icon.png"] = svg(180, "dark", height_frac=0.70)
    out["favicon-32.png"] = svg(32, "dark", height_frac=0.78, radius_frac=0.22)
    out["favicon-32-light.png"] = svg(32, "light", height_frac=0.78, radius_frac=0.22)
    return out


def ico(png: bytes, size: int) -> bytes:
    """A one-image ICO whose payload is the PNG itself (supported since Windows Vista and by every browser)."""
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), 6 + 16)
    return header + entry + png


def main() -> int:
    from playwright.sync_api import sync_playwright
    OUT.mkdir(parents=True, exist_ok=True)
    made: dict[str, bytes] = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, markup in jobs().items():
            side = int(markup.split('width="')[1].split('"')[0])
            page = browser.new_page(viewport={"width": side, "height": side}, device_scale_factor=1)
            page.set_content(f'<!doctype html><style>html,body{{margin:0;background:transparent}}svg{{display:block}}</style>{markup}')
            made[name] = page.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": side, "height": side})
            page.close()
        browser.close()
    for name, data in made.items():
        (OUT / name).write_bytes(data)
        print(f"wrote {(OUT / name).relative_to(ROOT)}  ({len(data):,} bytes)")
    (OUT / "favicon.ico").write_bytes(ico(made["favicon-32.png"], 32))
    print(f"wrote {(OUT / 'favicon.ico').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
