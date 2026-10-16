"""The iOS home-screen assets: every apple-touch-startup-image link in dashboard/index.html names a file that exists with the pixel size its
media query promises (width x dpr by height x dpr), in both colour schemes; every touch icon size is there; the script's list of sizes and the
page's links agree. No browser: PNG sizes are read from the file header.
"""
from __future__ import annotations

import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import make_icons  # noqa: E402

HTML = (ROOT / "dashboard" / "index.html").read_text()
PWA = ROOT / "dashboard" / "assets" / "pwa"


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name} is not a PNG"
    return struct.unpack(">II", data[16:24])


def startup_links() -> list[tuple[str, str]]:
    return re.findall(r'<link rel="apple-touch-startup-image" media="([^"]+)" href="([^"]+)"', HTML)


def test_every_launch_screen_link_names_a_file_of_the_size_its_query_promises() -> None:
    links = startup_links()
    assert len(links) == 2 * len(make_icons.SPLASH_SIZES)
    for media, href in links:
        w, h, dpr = (int(x) for x in re.search(r"device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)\)", media).groups())
        assert "(orientation: portrait)" in media
        assert png_size(ROOT / "dashboard" / href) == (w * dpr, h * dpr), href


def test_each_screen_has_a_dark_and_a_light_launch_image_and_the_script_lists_the_same_sizes() -> None:
    by = {}
    for media, href in startup_links():
        scheme = re.search(r"prefers-color-scheme: (dark|light)", media).group(1)
        by.setdefault(href.split("splash-")[1].rsplit("-", 1)[0], set()).add(scheme)
    assert all(v == {"dark", "light"} for v in by.values()), by
    expected = {f"{w * d}x{h * d}" for (w, h, d) in make_icons.SPLASH_SIZES}
    assert set(by) == expected
    for (w, h, d) in make_icons.SPLASH_SIZES:
        for theme in ("dark", "light"):
            assert (PWA / make_icons.splash_name(w, h, d, theme)).is_file()


def test_the_touch_icons_come_in_every_size_iOS_asks_for() -> None:
    for size in (120, 152, 167, 180):
        assert f'rel="apple-touch-icon" sizes="{size}x{size}"' in HTML
    for size, name in ((120, "apple-touch-icon-120.png"), (152, "apple-touch-icon-152.png"), (167, "apple-touch-icon-167.png"), (180, "apple-touch-icon.png")):
        assert png_size(PWA / name) == (size, size)


def test_the_launch_screens_stay_small_enough_for_a_public_repository() -> None:
    total = sum(p.stat().st_size for p in PWA.glob("splash-*.png"))
    assert total < 1_200_000, f"{total:,} bytes of launch screens: keep them flat colour"


def test_status_bar_theme_colours_and_viewport_for_the_installed_app() -> None:
    assert '<meta name="apple-mobile-web-app-status-bar-style" content="default">' in HTML
    assert '<meta name="apple-mobile-web-app-capable" content="yes">' in HTML
    assert re.search(r'<meta name="theme-color" content="#08090c" media="\(prefers-color-scheme: dark\)">', HTML)
    assert re.search(r'<meta name="theme-color" content="#f4f4f1" media="\(prefers-color-scheme: light\)">', HTML)
    assert "viewport-fit=cover" in HTML and "interactive-widget=resizes-visual" in HTML
    assert 'maximum-scale' not in HTML and 'user-scalable' not in HTML, "pinch zoom stays available"


def test_no_stylesheet_reads_the_safe_area_directly() -> None:
    """Every phone rule goes through the --safe-* tokens (css/tokens.css), so a test can stand in a notch."""
    for css in (ROOT / "dashboard" / "css").rglob("*.css"):
        text = css.read_text()
        for m in re.finditer(r"env\(safe-area-inset", text):
            assert css.name == "tokens.css", f"{css.name} reads env(safe-area-inset...) directly: use var(--safe-t|r|b|l)"
