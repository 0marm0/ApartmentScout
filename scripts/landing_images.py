#!/usr/bin/env python3
"""Write the landing page's screenshots as WebP (and one social-card JPEG) into the site's images/ folder.

    python scripts/landing_images.py _site/images

The screenshots in docs/images/ are 1 MB PNGs, fine for the README and far too heavy for a web page. landing/index.html
names the files it wants (`images/<name>.webp`, and `images/<name>-800.webp` for the small step of a `srcset`); each is
made here from docs/images/<name>.png, so re-shooting a screenshot under the same name updates the page with no other
change. Only the files the page names are written, so the published site no longer carries all 80 PNGs.

    <name>.webp        the screenshot at its own size (never upscaled), quality 80
    <name>-800.webp    800 px wide; a tall screenshot (a long panel) is cropped to 16:10 from the top, which is all the page shows of it
    og.jpg             1200 x 630 social card cut from map-commute.png (WebP is not reliably accepted by link previews)

Needs Pillow (`pip install Pillow`, part of the dev extras).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "images"
HTML = ROOT / "landing" / "index.html"
SMALL = 800


def wanted(html: str) -> tuple[set[str], set[str]]:
    """(names wanted at full size, names wanted at the small step) from the page's image references."""
    full: set[str] = set()
    small: set[str] = set()
    for name, step in re.findall(r"images/([a-z0-9][a-z0-9-]*?)(-800)?\.webp", html):
        (small if step else full).add(name)
    return full, small


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path, help="the site's images folder (for example _site/images)")
    ap.add_argument("--html", type=Path, default=HTML)
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("landing_images: Pillow is needed (pip install Pillow)")
    full, small = wanted(a.html.read_text())
    a.out.mkdir(parents=True, exist_ok=True)
    missing = sorted(n for n in full | small if not (SRC / f"{n}.png").is_file())
    if missing:
        sys.exit(f"landing_images: docs/images has no PNG for: {', '.join(missing)}")
    total = 0
    for name in sorted(full | small):
        im = Image.open(SRC / f"{name}.png").convert("RGB")
        if name in full:
            p = a.out / f"{name}.webp"
            im.save(p, "WEBP", quality=80, method=6)
            total += p.stat().st_size
        if name in small:
            w, h = im.size
            if w > SMALL:
                s = im.crop((0, 0, w, int(w * 10 / 16))) if h > w * 1.2 else im   # a long panel: the top 16:10 is all the page shows of it
                s = s.resize((SMALL, round(s.height * SMALL / s.width)), Image.LANCZOS)
            else:
                s = im
            p = a.out / f"{name}-{SMALL}.webp"
            s.save(p, "WEBP", quality=76, method=6)
            total += p.stat().st_size
    card = Image.open(SRC / "map-commute.png").convert("RGB")
    card = card.crop((0, 0, card.width, int(card.width * 630 / 1200))).resize((1200, 630), Image.LANCZOS)
    card.save(a.out / "og.jpg", "JPEG", quality=84, optimize=True, progressive=True)
    total += (a.out / "og.jpg").stat().st_size
    print(f"landing images: {len(full)} full, {len(small)} small, og.jpg -> {a.out} ({total / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
