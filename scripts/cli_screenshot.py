#!/usr/bin/env python3
"""Render docs/images/setup-cli.png: real output of a few `apartmentscout` commands on a scratch copy of the worked example.

    python scripts/cli_screenshot.py                 # writes docs/images/setup-cli.png
    python scripts/cli_screenshot.py --out /tmp/cli.png

The commands run on a temporary copy of examples/nyc-2026 (without its photos), so the example is never touched. The output is
drawn as it came back, in a dark terminal window, 1600 px wide; nothing is typed in by hand. Needs Pillow (the dev extras).
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMANDS = [
    ["apartmentscout", "city"],
    ["apartmentscout", "score", "--top", "10"],
]
FONTS = ["/System/Library/Fonts/Menlo.ttc", "/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
         "/usr/share/fonts/dejavu/DejaVuSansMono.ttf"]
BG, BAR, FG, DIM, PROMPT = (13, 15, 21), (26, 29, 39), (226, 229, 236), (139, 146, 163), (110, 231, 183)
W, PAD, SIZE, LINE = 1600, 40, 26, 36


def run(cmd: list[str], search: Path) -> list[str]:
    env = {**os.environ, "PYTHONPATH": str(ROOT), "APARTMENTSCOUT_SEARCH": str(search), "NO_COLOR": "1", "COLUMNS": "110"}
    out = subprocess.run([sys.executable, "-m", *cmd], env=env, capture_output=True, text=True, check=True, cwd=search).stdout
    return [ln.rstrip() for ln in out.splitlines()]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "images" / "setup-cli.png")
    a = ap.parse_args()
    from PIL import Image, ImageDraw, ImageFont
    font_path = next((f for f in FONTS if Path(f).is_file()), None)
    if font_path is None:
        sys.exit("cli_screenshot: no monospace font found (edit FONTS)")
    font = ImageFont.truetype(font_path, SIZE)
    bold = ImageFont.truetype(font_path, SIZE, index=1) if font_path.endswith(".ttc") else font
    with tempfile.TemporaryDirectory(prefix="as-cli-") as tmp:
        search = Path(tmp) / "nyc-2026"
        shutil.copytree(ROOT / "examples" / "nyc-2026", search, ignore=shutil.ignore_patterns("media"))
        blocks = [(cmd, run(cmd, search)) for cmd in COMMANDS]
    rows: list[tuple[str, str]] = []   # (kind, text)
    for cmd, lines in blocks:
        rows.append(("cmd", " ".join(cmd)))
        rows += [("out", ln) for ln in lines]
        rows.append(("out", ""))
    h = 64 + PAD + LINE * len(rows) + PAD // 2
    im = Image.new("RGB", (W, h), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 64], fill=BAR)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse([28 + i * 32, 22, 46 + i * 32, 40], fill=c)
    d.text((140, 32), "ApartmentScout  ·  examples/nyc-2026", font=font, fill=DIM, anchor="lm")
    y = 64 + PAD
    for kind, text in rows:
        if kind == "cmd":
            d.text((PAD, y), "$", font=bold, fill=PROMPT)
            d.text((PAD + 32, y), text, font=bold, fill=FG)
        else:
            d.text((PAD + 32, y), text, font=font, fill=FG if text[:1] != " " or text.strip()[:1].isdigit() else DIM)
        y += LINE
    a.out.parent.mkdir(parents=True, exist_ok=True)
    im.save(a.out, optimize=True)
    print(f"{a.out} ({im.width} x {im.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
