"""The landing page in a real browser: self-hosted assets only, no horizontal scroll from a phone to a wide desktop, WCAG AA in both
themes (axe-core), the tour's tabs, the page without JavaScript, sized and lazy images, and a small first load.

The site is assembled like the Pages one (landing files, tokens, fonts, assets, and the screenshots as WebP via
scripts/landing_images.py), without the dashboard demo. Needs Pillow.

    APARTMENTSCOUT_E2E=1 pytest -m e2e tests/e2e/test_landing_page.py -q
"""
from __future__ import annotations

import http.server
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e
ROOT = Path(__file__).resolve().parents[2]
AXE = Path(__file__).parent / "vendor" / "axe.min.js"


@pytest.fixture(scope="module")
def site(tmp_path_factory: pytest.TempPathFactory) -> Path:
    pytest.importorskip("PIL", reason="Pillow converts the screenshots")
    out = tmp_path_factory.mktemp("landing")
    for name in ("index.html", "landing.css", "landing.js"):
        shutil.copy(ROOT / "landing" / name, out / name)
    shutil.copy(ROOT / "dashboard" / "css" / "tokens.css", out / "tokens.css")
    (out / "fonts").mkdir()
    for f in (ROOT / "dashboard" / "vendor" / "fonts").iterdir():
        shutil.copy(f, out / "fonts" / f.name)
    (out / "assets").mkdir()
    for f in (ROOT / "dashboard" / "assets").glob("*.svg"):
        shutil.copy(f, out / "assets" / f.name)
    shutil.copytree(ROOT / "dashboard" / "assets" / "pwa", out / "assets" / "pwa")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "landing_images.py"), str(out / "images")], check=True, capture_output=True)
    return out


@pytest.fixture(scope="module")
def origin(site: Path):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw) -> None:
            super().__init__(*a, directory=str(site), **kw)

        def log_message(self, *a) -> None:
            pass
    http.server.ThreadingHTTPServer.request_queue_size = 64
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def open_landing(browser, origin: str, width: int, height: int, theme: str, *, js: bool = True):
    ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, reduced_motion="reduce", java_script_enabled=js)
    foreign: list[str] = []

    def gate(route) -> None:
        if route.request.url.startswith((origin, "data:")):
            route.continue_()
        else:
            foreign.append(route.request.url)
            route.abort()
    ctx.route("**/*", gate)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(f"{origin}/?theme={theme}")
    return ctx, page, foreign, errors


def scroll_through(page) -> None:
    """Scroll to the bottom in steps, so every lazy image is requested."""
    # one round trip for the whole walk: a Python call per step took 16 s for this page on a busy machine, the walk itself 0.6 s
    page.evaluate("""async () => {
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60))); }
      window.scrollTo(0, 0);
    }""")
    page.wait_for_load_state("networkidle")   # the requests the walk started have finished


@pytest.mark.parametrize("width,theme", [(390, "dark"), (390, "light"), (768, "dark"), (1440, "dark"), (1440, "light"), (2200, "light")])
def test_no_horizontal_scroll_and_nothing_foreign(browser, origin, width: int, theme: str) -> None:
    ctx, page, foreign, errors = open_landing(browser, origin, width, 900, theme)
    page.wait_for_load_state("load")
    scroll_through(page)
    assert page.evaluate("() => { window.scrollTo(300, 0); return window.scrollX; }") == 0, "the page scrolls sideways"
    wide = page.evaluate("""() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('.tabs, .shots, pre, .code') && e.getBoundingClientRect().right > innerWidth + 1
        && getComputedStyle(e).position !== 'fixed' && !e.closest('.hero-shot') && !e.closest('.feat-media')).map((e) => e.className || e.tagName).slice(0, 5)""")
    assert wide == [], f"elements stick out past the right edge: {wide}"
    assert foreign == [], f"requests to other origins: {foreign}"
    assert errors == [], errors
    ctx.close()


@pytest.mark.parametrize("width,theme", [(390, "dark"), (390, "light"), (1440, "dark"), (1440, "light")])
def test_wcag_aa_in_both_themes(browser, origin, width: int, theme: str) -> None:
    ctx, page, _, _ = open_landing(browser, origin, width, 900, theme)
    page.wait_for_load_state("load")
    page.add_script_tag(path=str(AXE))
    for tab in ("tt-map", "tt-compare", "tt-3d", "tt-decide", "tt-setup"):        # the tour shows one panel at a time
        page.locator(f"#{tab}").click()
        res = page.evaluate("""async () => {
          const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
          return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
        }""")
        bad = [v for v in res if v["impact"] in ("critical", "serious", "moderate", "minor")]
        assert bad == [], f"{tab} at {width} {theme}: {bad}"
    ctx.close()


def test_the_tour_tabs_work_with_the_keyboard(browser, origin) -> None:
    ctx, page, _, errors = open_landing(browser, origin, 1440, 900, "dark")
    tabs = page.locator("#tour [role=tab]")
    assert tabs.count() == 5
    assert page.locator("#tp-map").is_visible() and not page.locator("#tp-compare").is_visible()
    tabs.nth(0).focus()
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.activeElement.id") == "tt-compare"
    assert page.locator("#tp-compare").is_visible() and not page.locator("#tp-map").is_visible()
    assert tabs.nth(1).get_attribute("aria-selected") == "true" and tabs.nth(0).get_attribute("aria-selected") == "false"
    page.keyboard.press("End")
    assert page.evaluate("document.activeElement.id") == "tt-setup" and page.locator("#tp-setup").is_visible()
    page.keyboard.press("ArrowRight")                    # wraps
    assert page.evaluate("document.activeElement.id") == "tt-map" and page.locator("#tp-map").is_visible()
    # exactly one panel is in the accessibility tree at a time, and each panel is labelled by its tab
    assert page.locator("#tour [role=tabpanel]:visible").count() == 1
    for t in range(5):
        assert page.evaluate("(i) => { const t = document.querySelectorAll('#tour [role=tab]')[i]; return document.getElementById(t.getAttribute('aria-controls')).getAttribute('aria-labelledby') === t.id; }", t)
    assert errors == []
    ctx.close()


def test_without_javascript_every_tour_panel_is_there_and_the_tabs_are_not(browser, origin) -> None:
    ctx, page, _, _ = open_landing(browser, origin, 1440, 900, "dark", js=False)
    assert page.locator("#tour [role=tabpanel]:visible").count() == 5
    assert page.locator("#tour [role=tablist]:visible").count() == 0
    assert page.locator("a[href='./demo/']:visible").count() >= 2
    ctx.close()


def test_open_the_demo_is_prominent(browser, origin) -> None:
    ctx, page, _, _ = open_landing(browser, origin, 1440, 900, "dark")
    first = page.locator(".nav a.btn.primary")
    assert first.is_visible() and first.get_attribute("href") == "./demo/"
    hero = page.locator(".hero .cta a.btn.primary")
    assert hero.is_visible() and "Open the live demo" in hero.inner_text()
    band = page.locator("#demo a.btn.primary")
    assert band.get_attribute("href") == "./demo/"
    box = band.bounding_box() or page.evaluate("0")
    page.evaluate("document.querySelector('#demo').scrollIntoView()")
    box = band.bounding_box()
    assert box and box["height"] >= 52, "the band's button is big"
    ctx.close()


def test_images_are_sized_lazy_and_exist(browser, origin, site: Path) -> None:
    ctx, page, foreign, _ = open_landing(browser, origin, 1440, 900, "dark")
    imgs = page.evaluate("""() => [...document.images].map((i) => ({ src: i.getAttribute('src'), srcset: i.getAttribute('srcset'), w: i.getAttribute('width'), h: i.getAttribute('height'),
        lazy: i.loading, alt: i.getAttribute('alt'), prio: i.getAttribute('fetchpriority'), inDialog: !!i.closest('dialog') }))""")
    assert len(imgs) > 30
    eager = [i for i in imgs if i["lazy"] != "lazy" and not i["inDialog"]]
    assert [i["src"] for i in eager] == ["images/hero-map.webp"], "only the hero image loads eagerly"
    assert eager[0]["prio"] == "high"
    for i in imgs:
        if i["inDialog"]:
            continue
        assert i["w"] and i["h"], f"{i['src']} has no width and height (layout shift)"
        assert i["alt"], f"{i['src']} has no alt text"
        assert i["src"].endswith(".webp"), i["src"]
    # every file the page names is on disk, including each srcset step and the social card
    html = (site / "index.html").read_text()
    for name in set(re.findall(r'images/[a-z0-9-]+\.webp', html)):
        assert (site / name).is_file(), name
    assert (site / "images" / "og.jpg").is_file() and "images/og.jpg" in html
    ctx.close()


def test_the_first_load_is_small(browser, origin) -> None:
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = ctx.new_page()
    sizes: list[tuple[str, int]] = []
    page.on("requestfinished", lambda r: sizes.append((r.url.replace(origin, ""), r.sizes()["responseBodySize"])))
    page.goto(f"{origin}/")
    page.wait_for_load_state("load")
    page.wait_for_timeout(500)
    total = sum(n for _, n in sizes)
    biggest = sorted(sizes, key=lambda x: -x[1])[:4]
    assert total < 900_000, f"{total:,} bytes on first load (uncompressed; the host gzips the text): {biggest}"
    assert not any(u.endswith(".png") for u, _ in sizes), "no PNG screenshots on the first load"
    ctx.close()


def test_the_page_makes_the_social_card_and_icons_available(origin, site: Path) -> None:
    html = (site / "index.html").read_text()
    assert 'property="og:image" content="__SITE__/images/og.jpg"' in html and 'name="twitter:image"' in html
    assert 'rel="apple-touch-icon" href="assets/pwa/apple-touch-icon.png"' in html
    assert (site / "assets" / "pwa" / "apple-touch-icon.png").is_file()
