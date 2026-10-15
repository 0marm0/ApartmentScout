"""Photo tiers on the Python side: `serve` answers /media/ from media/, then media-lite/, else redirects to the published
copy (search.media_base_url); `build` writes the base into manifest.json and keeps blur-up previews without the full set;
the standalone file leaves photos to the published copy. apartmentscout/mediabase.py has the rules."""
from __future__ import annotations

import http.client
import json
import threading
from pathlib import Path
from typing import Iterator

import pytest

from apartmentscout import cli, lqip
from apartmentscout.config import Workspace
from apartmentscout.criteria_check import check_text
from apartmentscout.intake import init_search
from apartmentscout.localapi import ServeState, make_server
from apartmentscout.mediabase import find_local, media_base_url, normalize_base, remote_url

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://photos.example.test/demo/media/"


# ------------------------------------------------------------------ mediabase
def test_base_urls_are_https_folders_with_a_trailing_slash() -> None:
    assert normalize_base("https://a.test/x/media") == "https://a.test/x/media/"
    assert normalize_base("  https://a.test/x/media///  ") == "https://a.test/x/media/"
    assert normalize_base("http://127.0.0.1:8000/media/") == "http://127.0.0.1:8000/media/"
    for bad in (None, "", "   ", "http://evil.test/m/", "ftp://a.test/", "https://a.test/m/?q=1", "https://u:p\x40a.test/m/", "javascript:alert(1)", 5):
        assert normalize_base(bad) is None
    assert media_base_url({"search": {"media_base_url": BASE}}) == BASE and media_base_url({"search": {}}) is None and media_base_url(None) is None


def test_remote_urls_are_plain_image_paths_under_the_base() -> None:
    assert remote_url(BASE, "shared/ab12.webp") == BASE + "shared/ab12.webp"
    assert remote_url(BASE, "a b/c#d.webp") == BASE + "a%20b/c%23d.webp"
    for bad in ("", "/etc/x.webp", "../x.webp", "a/../x.webp", "a//x.webp", "a\\x.webp", "a/x.html", "a/\x00.webp", "a/"):
        assert remote_url(BASE, bad) is None
    assert remote_url(None, "a.webp") is None


def test_find_local_prefers_the_first_root_and_stays_inside_it(tmp_path: Path) -> None:
    full, lite = tmp_path / "media", tmp_path / "media-lite"
    for root, body in ((full, b"full"), (lite, b"lite")):
        (root / "a").mkdir(parents=True)
        (root / "a/x.webp").write_bytes(body)
    (lite / "a/only-lite.webp").write_bytes(b"l")
    (tmp_path / "secret.webp").write_bytes(b"s")
    assert find_local([full, lite], "a/x.webp").read_bytes() == b"full"
    assert find_local([full, lite], "a/only-lite.webp").read_bytes() == b"l"
    assert find_local([None, lite], "a/x.webp").read_bytes() == b"lite"
    assert find_local([full, lite], "a/missing.webp") is None and find_local([full, lite], "../secret.webp") is None


# ------------------------------------------------------------------ serve
def _get(port: int, path: str, method: str = "GET") -> tuple[int, dict[str, str], bytes]:
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request(method, path, headers={"Host": f"127.0.0.1:{port}"})
    r = c.getresponse()
    body = r.read()
    c.close()
    return r.status, {k.lower(): v for k, v in r.getheaders()}, body


@pytest.fixture
def photo_server(tmp_path: Path) -> Iterator[tuple[int, Path]]:
    mine = tmp_path / "searches" / "mine"
    init_search(mine, "generic")
    for name, body in (("media", b"FULL-ONLY"), ("media-lite", b"LITE-ONLY")):
        (mine / name / "a-1").mkdir(parents=True)
        (mine / name / "a-1" / f"{name}.webp").write_bytes(body)
    (mine / "media" / "a-1" / "both.webp").write_bytes(b"FULL-WINS")
    (mine / "media-lite" / "a-1" / "both.webp").write_bytes(b"lite-loses")
    text = (mine / "criteria.yaml").read_text()
    (mine / "criteria.yaml").write_text(text.replace("search:\n", f"search:\n  media_base_url: {BASE}\n", 1))
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path / "searches", ws=None, data_dir=ROOT / "dashboard" / "data",
                       media_dir=None, export=lambda ws, out: None, rescore=lambda ws: None)
    state.activate(Workspace(mine))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    yield state.port, mine
    httpd.shutdown()
    httpd.server_close()


def test_media_is_served_from_the_full_set_first(photo_server) -> None:
    port, _ = photo_server
    assert _get(port, "/media/a-1/media.webp")[::2] == (200, b"FULL-ONLY")
    assert _get(port, "/media/a-1/both.webp")[::2] == (200, b"FULL-WINS")


def test_scripts_and_data_are_revalidated_photos_keep_default_caching(photo_server) -> None:
    """After an update the browser must not mix a cached old module with new ones: code and data say no-cache."""
    port, _ = photo_server
    for path in ("/js/app.js", "/css/app.css", "/dist/app.bundle.js", "/index.html"):
        status, headers, _ = _get(port, path)
        assert status == 200 and headers.get("cache-control") in ("no-cache", "no-store"), path
    status, headers, _ = _get(port, "/media/a-1/media.webp")
    assert status == 200 and "cache-control" not in headers


def test_media_falls_back_to_the_starter_set(photo_server) -> None:
    port, _ = photo_server
    status, headers, body = _get(port, "/media/a-1/media-lite.webp")
    assert (status, body) == (200, b"LITE-ONLY") and "location" not in headers
    assert _get(port, "/media/a-1/media-lite.webp", "HEAD")[0] == 200


def test_a_missing_photo_redirects_to_the_published_copy(photo_server) -> None:
    port, _ = photo_server
    status, headers, body = _get(port, "/media/shared/0123abcd.webp")
    assert status == 302 and headers["location"] == BASE + "shared/0123abcd.webp" and body == b""
    assert headers.get("cache-control") == "no-store"
    assert _get(port, "/media/a-1/some%20photo.webp", "HEAD")[1]["location"] == BASE + "a-1/some%20photo.webp"


def test_odd_media_requests_are_never_redirected_or_served_from_outside(photo_server) -> None:
    port, mine = photo_server
    (mine / "secret.webp").write_bytes(b"SECRET")
    for path in ("/media/../secret.webp", "/media/%2e%2e/secret.webp", "/media/a-1/x.html", "/media/"):
        status, headers, body = _get(port, path)
        assert b"SECRET" not in body and "location" not in headers, path
        assert status in (301, 403, 404)


def test_without_a_base_a_missing_photo_is_a_plain_404(tmp_path: Path) -> None:
    mine = tmp_path / "searches" / "mine"
    init_search(mine, "generic")
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path / "searches", ws=None, data_dir=ROOT / "dashboard" / "data",
                       media_dir=None, export=lambda ws, out: None, rescore=lambda ws: None)
    state.activate(Workspace(mine))
    assert state.media_base_url is None
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    try:
        status, headers, _ = _get(state.port, "/media/a/b.webp")
        assert status == 404 and "location" not in headers
    finally:
        httpd.shutdown()
        httpd.server_close()


# ------------------------------------------------------------------ criteria and the manifest
def _yaml(extra: str) -> str:
    return f"""search:
  name: T
  city: generic
{extra}budget:
  basis: monthly_cost
  tiers:
    - {{name: Target, max: 3000}}
  hard_max: 3400
unit: {{min_beds: 1, sqft_floor: 400, sqft_good: 650, sqft_great: 900}}
must_have: [in_unit_wd]
commute:
  destinations:
    - {{name: Work, address: 1 Main St, arrive_by: "09:00", max_minutes: 30, weight: 1}}
weights: {{cost: 30}}
"""


def test_criteria_check_accepts_a_published_folder_and_rejects_anything_else() -> None:
    assert not check_text(_yaml(f"  media_base_url: {BASE}\n")).errors
    assert not check_text(_yaml("")).errors
    rep = check_text(_yaml("  media_base_url: http://evil.test/m/\n"))
    assert any("search.media_base_url" in e for e in rep.errors)


def test_the_bundled_example_names_its_published_photos() -> None:
    from apartmentscout.config import load_criteria
    crit = load_criteria(ROOT / "examples" / "nyc-2026" / "criteria.yaml")
    assert media_base_url(crit) == "https://0marm0.github.io/ApartmentScout/demo/media/"


def test_build_writes_the_base_into_the_manifest(tmp_path: Path) -> None:
    mine = tmp_path / "mine"
    init_search(mine, "generic")
    ws = Workspace(mine)
    cli._export(ws, tmp_path / "out")
    assert "media_base_url" not in json.loads((tmp_path / "out" / "manifest.json").read_text())
    (mine / "criteria.yaml").write_text((mine / "criteria.yaml").read_text().replace("search:\n", f"search:\n  media_base_url: {BASE}\n", 1))
    cli._export(Workspace(mine), tmp_path / "out")
    assert json.loads((tmp_path / "out" / "manifest.json").read_text())["media_base_url"] == BASE


# ------------------------------------------------------------------ blur-up previews without the full set
def test_previews_come_from_the_starter_set_and_survive_a_rebuild_without_any_photos(tmp_path: Path) -> None:
    PIL = pytest.importorskip("PIL.Image")
    full, lite, out = tmp_path / "media", tmp_path / "media-lite", tmp_path / "out"
    out.mkdir()
    for root, name in ((full, "a-1/p-1.webp"), (lite, "a-2/p-1.webp")):
        (root / name).parent.mkdir(parents=True)
        PIL.new("RGB", (120, 80), (200, 90, 40)).save(root / name, "WEBP")
    listings = [{"id": "a-1", "photos_local": ["media/a-1/p-1.webp"]}, {"id": "a-2", "photos_local": ["media/a-2/p-1.webp"]},
                {"id": "a-3", "photos_local": ["media/a-3/p-1.webp"]}]
    side = lqip.build_sidecar(listings, full, out, fallback=[lite])
    assert set(side["items"]) == {"media/a-1/p-1.webp", "media/a-2/p-1.webp"}      # a-3 is in neither folder
    again = lqip.build_sidecar(listings, tmp_path / "nowhere", out, fallback=[tmp_path / "nowhere-lite"])
    assert again["items"] == side["items"]                                           # no photos on this machine: the same sidecar
    PIL.new("RGB", (60, 40), (1, 2, 3)).save(lite / "a-2/p-1.webp", "WEBP")           # a smaller re-encode of the same photo
    assert lqip.build_sidecar(listings, tmp_path / "nowhere", out, fallback=[lite])["items"] == side["items"], "an earlier preview beats the starter copy"
    (out / "lqip.json").unlink()
    assert lqip.build_sidecar(listings, tmp_path / "nowhere", out) is None


# ------------------------------------------------------------------ the standalone file
def test_standalone_leaves_photos_to_the_published_copy_when_the_search_names_one(tmp_path: Path) -> None:
    if not (ROOT / "dashboard" / "dist" / "app.bundle.js").exists():
        pytest.skip("no bundle (scripts/bundle.sh)")
    data = tmp_path / "data"
    data.mkdir()
    listings = [{"id": "a-1", "photos_local": ["media/a-1/p-1.webp"], "photos": ["https://x.test/1.jpg"]}]
    (data / "listings.json").write_text(json.dumps(listings))
    (data / "manifest.json").write_text(json.dumps({"media_base_url": BASE}))
    dest = tmp_path / "out" / "one.html"
    cli.standalone(data, dest)
    html = dest.read_text()
    assert '"photos_local":["media/a-1/p-1.webp"]' in html and '"media_local":false' in html and BASE in html
    (data / "manifest.json").write_text(json.dumps({}))
    cli.standalone(data, dest)
    assert '"photos_local"' not in dest.read_text()                                   # no published copy: the old behaviour
