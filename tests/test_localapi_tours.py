"""The tour half of the dashboard's local API (apartmentscout/tourapi.py): the same token and origin guards as the rest, ids that
cannot be paths, photo size limits, and photos re-encoded to metadata-free WebP."""
from __future__ import annotations

import http.client
import io
import json
import os
import threading
from pathlib import Path
from typing import Any, Iterator

import pytest

from apartmentscout import cli, localapi, tourapi, tours
from apartmentscout.config import Workspace
from apartmentscout.intake import init_search
from apartmentscout.localapi import ServeState, make_server

Image = pytest.importorskip("PIL.Image")
ROOT = Path(__file__).resolve().parents[1]
FINDINGS = {"observed": "2026-10-14", "water": 4, "noise": {"rating": 3, "db": 51}, "note": "quiet street", "bogus": "x",
            "checks": {"wd": {"verdict": "differs", "observed": False}}}


class Client:
    def __init__(self, port: int, token: str | None) -> None:
        self.port, self.token = port, token

    def call(self, method: str, path: str, body: Any = None, raw: bytes | None = None, ctype: str | None = None, token: bool = True,
             headers: dict[str, str] | None = None) -> tuple[int, Any, dict[str, str]]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"127.0.0.1:{self.port}"}
        if token and self.token:
            h["X-AS-Token"] = self.token
        data = raw
        if body is not None:
            data, ctype = json.dumps(body).encode(), "application/json"
        if ctype:
            h["Content-Type"] = ctype
        h.update(headers or {})
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        payload = r.read()
        hdrs = {k.lower(): v for k, v in r.getheaders()}
        c.close()
        try:
            return r.status, json.loads(payload), hdrs
        except ValueError:
            return r.status, payload, hdrs


def photo_bytes(size=(800, 600), fmt="JPEG", exif: bool = False, color=(180, 90, 40)) -> bytes:
    im = Image.new("RGB", size, color)
    buf = io.BytesIO()
    kw: dict[str, Any] = {}
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "FixtureCam"              # Make
        ex[0x8825] = {1: "N", 2: (40.0, 45.0, 0.0), 3: "W", 4: (73.0, 59.0, 0.0)}   # GPS IFD
        ex[0x0112] = 6                          # rotated: width and height swap on display
        kw["exif"] = ex
    im.save(buf, fmt, **kw)
    return buf.getvalue()


@pytest.fixture
def served(tmp_path: Path) -> Iterator[tuple[Client, ServeState, Path]]:
    searches = tmp_path / "searches"
    mine = searches / "mine"
    init_search(mine, "generic")
    state = ServeState(dash=ROOT / "dashboard", searches_dir=searches, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(mine))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    yield Client(state.port, state.token), state, mine
    httpd.shutdown()
    httpd.server_close()


def files_under(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


# --------------------------------------------------------------------------- guards
def test_every_tour_call_needs_the_token_and_the_dashboard_origin(served) -> None:
    c, state, mine = served
    for method, path, kw in [("GET", "/api/tours", {}), ("GET", "/api/tours/x", {}), ("POST", "/api/tours/x", {"body": {"findings": FINDINGS}}),
                             ("POST", "/api/tours/x/photos", {"raw": photo_bytes(), "ctype": "image/jpeg"}), ("POST", "/api/tours/x/photos/delete", {"body": {"photo": "abcdef"}})]:
        assert c.call(method, path, token=False, **kw)[0] == 401, path
        assert Client(c.port, "wrong-token").call(method, path, **kw)[0] == 401, path
        assert c.call(method, path, headers={"Host": "evil.example"}, **kw)[0] == 403, path
        assert c.call(method, path, headers={"Origin": "https://evil.example"}, **kw)[0] == 403, path
    assert not (mine / "tours").exists(), "nothing is written by a refused call"


def test_an_example_search_is_read_only(tmp_path: Path) -> None:
    example = ROOT / "examples" / "nyc-2026"
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=lambda *a: None, rescore=lambda *a: None)
    state.ws, state.data_dir, state.media_dir = Workspace(example), ROOT / "dashboard" / "data", example / "media"
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    try:
        c = Client(state.port, state.token)
        before = files_under(example)
        s, body, _ = c.call("POST", "/api/tours/emerald-green-24d", {"findings": FINDINGS})
        assert s == 403 and "read-only" in body["error"]
        assert c.call("POST", "/api/tours/emerald-green-24d/photos", raw=photo_bytes(), ctype="image/jpeg")[0] == 403
        assert files_under(example) == before
        sess = c.call("GET", "/api/session")[1]
        assert sess["tours"]["save"] is False and sess["tours"]["photos"] is False
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_session_says_what_can_be_saved(served) -> None:
    c, _, _ = served
    t = c.call("GET", "/api/session")[1]["tours"]
    assert t == {"save": True, "photos": True, "max_photo_bytes": tourapi.MAX_PHOTO_BYTES}


# --------------------------------------------------------------------------- findings
def test_findings_round_trip_and_are_validated(served) -> None:
    c, _, mine = served
    assert c.call("GET", "/api/tours")[1] == {"tours": {}}
    s, body, _ = c.call("POST", "/api/tours/emerald-green-24d", {"findings": FINDINGS})
    assert s == 200 and body["findings"] == {"v": 1, "observed": "2026-10-14", "water": 4, "noise": {"rating": 3, "db": 51}, "note": "quiet street",
                                              "checks": {"wd": {"verdict": "differs", "observed": False}}}
    on_disk = json.loads((mine / "tours" / "emerald-green-24d" / "findings.json").read_text())
    assert on_disk == body["findings"] and "bogus" not in on_disk
    assert c.call("GET", "/api/tours/emerald-green-24d")[1]["findings"] == body["findings"]
    assert list(c.call("GET", "/api/tours")[1]["tours"]) == ["emerald-green-24d"]
    assert c.call("POST", "/api/tours/emerald-green-24d", {"findings": "not an object"})[0] == 400
    assert c.call("POST", "/api/tours/emerald-green-24d", raw=b"{}", ctype="text/plain")[0] == 415
    big = {"findings": {"note": "x" * (300 * 1024)}}
    assert c.call("POST", "/api/tours/emerald-green-24d", big)[0] == 413


@pytest.mark.parametrize("bad", ["..", "%2e%2e", "a%2f..%2f..%2fb", "%2e%2e%2f%2e%2e%2fescape", "a..", ".hidden", "x" * 200, "a%00b", "a%5cb"])
def test_a_listing_id_is_never_a_path(served, bad: str) -> None:
    c, _, mine = served
    before = files_under(mine.parent)
    for method, tail, kw in [("POST", "", {"body": {"findings": FINDINGS}}), ("GET", "", {}), ("POST", "/photos", {"raw": photo_bytes(), "ctype": "image/jpeg"}),
                             ("POST", "/photos/delete", {"body": {"photo": "abcdef123456"}})]:
        s, _, _ = c.call(method, f"/api/tours/{bad}{tail}", **kw)
        assert s in (400, 403, 404), (bad, tail, s)
    assert files_under(mine.parent) == before


def test_a_symlinked_visit_folder_is_refused(served, tmp_path: Path) -> None:
    c, _, mine = served
    outside = tmp_path / "outside"
    outside.mkdir()
    (mine / "tours").mkdir()
    os.symlink(outside, mine / "tours" / "linked")
    assert c.call("POST", "/api/tours/linked", {"findings": FINDINGS})[0] == 403
    assert c.call("POST", "/api/tours/linked/photos", raw=photo_bytes(), ctype="image/jpeg")[0] == 403
    assert not list(outside.iterdir())


# --------------------------------------------------------------------------- photos
def test_a_photo_is_reencoded_to_webp_without_its_metadata(served) -> None:
    c, _, mine = served
    raw = photo_bytes((3000, 2000), exif=True)
    assert b"FixtureCam" in raw and Image.open(io.BytesIO(raw)).getexif().get(0x8825)
    s, body, _ = c.call("POST", "/api/tours/emerald-green-24d/photos", raw=raw, ctype="image/jpeg")
    assert s == 200, body
    ph = body["photo"]
    path = mine / "tours" / "emerald-green-24d" / "photos" / f"{ph['id']}.webp"
    data = path.read_bytes()
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP" and ph["bytes"] == len(data) and ph["store"] == "disk"
    im = Image.open(io.BytesIO(data))
    assert im.format == "WEBP" and max(im.size) == tourapi.MAX_EDGE
    assert (ph["w"], ph["h"]) == im.size
    assert im.size[1] > im.size[0], "the EXIF rotation was applied (the 3000x2000 frame was marked as turned)"
    assert not im.getexif() and b"FixtureCam" not in data and b"Exif" not in data
    rec = json.loads((mine / "tours" / "emerald-green-24d" / "findings.json").read_text())
    assert [p["id"] for p in rec["photos"]] == [ph["id"]] and rec["updated"]
    s, got, hdr = c.call("GET", f"/tours/emerald-green-24d/photos/{ph['id']}.webp")
    assert s == 200 and got == data and hdr["content-type"] == "image/webp"


def test_png_and_webp_are_accepted_and_a_transparent_png_is_flattened(served) -> None:
    c, _, mine = served
    png = io.BytesIO()
    Image.new("RGBA", (40, 30), (0, 0, 0, 0)).save(png, "PNG")
    for raw, ct in [(png.getvalue(), "image/png"), (photo_bytes(fmt="WEBP"), "image/webp")]:
        s, body, _ = c.call("POST", "/api/tours/h1/photos", raw=raw, ctype=ct)
        assert s == 200, body
    first = json.loads((mine / "tours" / "h1" / "findings.json").read_text())["photos"][0]
    px = Image.open(mine / "tours" / "h1" / "photos" / f"{first['id']}.webp").convert("RGB").getpixel((5, 5))
    assert px[0] > 240 and px[1] > 240 and px[2] > 240


def test_what_is_not_a_photo_is_refused(served) -> None:
    c, _, mine = served
    assert c.call("POST", "/api/tours/h1/photos", raw=b"GIF89a-not-really", ctype="image/gif")[0] == 415
    assert c.call("POST", "/api/tours/h1/photos", raw=b"<svg onload=alert(1)></svg>", ctype="image/svg+xml")[0] == 415
    assert c.call("POST", "/api/tours/h1/photos", raw=photo_bytes(), ctype="application/octet-stream")[0] == 415
    assert c.call("POST", "/api/tours/h1/photos", raw=photo_bytes()[:300], ctype="image/jpeg")[0] == 415, "truncated"
    assert c.call("POST", "/api/tours/h1/photos", raw=b"", ctype="image/jpeg")[0] == 400
    gif = io.BytesIO()
    Image.new("P", (10, 10)).save(gif, "GIF")
    assert c.call("POST", "/api/tours/h1/photos", raw=gif.getvalue(), ctype="image/gif")[0] == 415
    assert not (mine / "tours" / "h1" / "photos").exists() or not list((mine / "tours" / "h1" / "photos").iterdir())


def test_size_limits(served, monkeypatch: pytest.MonkeyPatch) -> None:
    c, _, mine = served
    monkeypatch.setattr(localapi, "MAX_PHOTO_BYTES", 5000)
    big = photo_bytes((1200, 900), color=(1, 2, 3))
    noisy = io.BytesIO()
    Image.effect_noise((400, 400), 80).convert("RGB").save(noisy, "JPEG", quality=95)
    assert len(noisy.getvalue()) > 5000
    assert c.call("POST", "/api/tours/h1/photos", raw=noisy.getvalue(), ctype="image/jpeg")[0] == 413
    monkeypatch.setattr(localapi, "MAX_PHOTO_BYTES", tourapi.MAX_PHOTO_BYTES)
    # too many pixels, though the file is small
    monkeypatch.setattr(tourapi, "MAX_PIXELS", 500_000)
    s, body, _ = c.call("POST", "/api/tours/h1/photos", raw=big, ctype="image/jpeg")
    assert s == 413 and "pixels" in body["error"]
    monkeypatch.setattr(tourapi, "MAX_PIXELS", 60_000_000)
    # photos per home
    monkeypatch.setitem(tours.MAX, "photos", 2)
    assert [c.call("POST", "/api/tours/h2/photos", raw=photo_bytes((80, 60)), ctype="image/jpeg")[0] for _ in range(3)] == [200, 200, 409]
    # the whole folder
    monkeypatch.setattr(tourapi, "MAX_TOTAL_BYTES", 10)
    assert c.call("POST", "/api/tours/h3/photos", raw=photo_bytes((80, 60)), ctype="image/jpeg")[0] == 507
    assert len(list((mine / "tours" / "h2" / "photos").iterdir())) == 2


def test_saved_findings_cannot_list_a_photo_that_is_not_a_file(served) -> None:
    c, _, _ = served
    forged = {"note": "x", "photos": [{"id": "abcdef123456", "store": "disk"}, {"id": "idbphoto12", "store": "idb"}]}
    s, body, _ = c.call("POST", "/api/tours/h1", {"findings": forged})
    assert s == 200 and "photos" not in body["findings"]
    ph = c.call("POST", "/api/tours/h1/photos", raw=photo_bytes(), ctype="image/jpeg")[1]["photo"]
    saved = c.call("POST", "/api/tours/h1", {"findings": {"note": "again", "photos": [ph, {"id": "abcdef123456", "store": "disk"}]}})[1]["findings"]
    assert [p["id"] for p in saved["photos"]] == [ph["id"]]


def test_delete_a_photo(served) -> None:
    c, _, mine = served
    ph = c.call("POST", "/api/tours/h1/photos", raw=photo_bytes(), ctype="image/jpeg")[1]["photo"]
    path = mine / "tours" / "h1" / "photos" / f"{ph['id']}.webp"
    assert path.is_file()
    assert c.call("POST", "/api/tours/h1/photos/delete", {"photo": "../findings"})[0] == 400
    assert c.call("POST", "/api/tours/h1/photos/delete", {"photo": "nosuchphoto1"})[0] == 404
    s, body, _ = c.call("POST", "/api/tours/h1/photos/delete", {"photo": ph["id"]})
    assert s == 200 and "photos" not in body["findings"] and not path.exists()
    assert c.call("GET", f"/tours/h1/photos/{ph['id']}.webp")[0] == 404


def test_only_photos_are_served_from_the_tours_folder(served) -> None:
    c, _, mine = served
    c.call("POST", "/api/tours/h1", {"findings": FINDINGS})
    ph = c.call("POST", "/api/tours/h1/photos", raw=photo_bytes(), ctype="image/jpeg")[1]["photo"]
    (mine / "tours" / "secret.txt").write_text("private")
    for path in ["/tours/h1/findings.json", "/tours/secret.txt", "/tours/../criteria.yaml", "/tours/h1/photos/../findings.json", "/tours/h1/photos/%2e%2e/findings.json",
                 "/tours/h1/photos/nothere12.webp", "/tours/h1/photos/" + ph["id"] + ".png", "/tours/"]:
        assert c.call("GET", path)[0] in (403, 404), path
    assert c.call("GET", f"/tours/h1/photos/{ph['id']}.webp")[0] == 200
    # a request for someone else's Host is refused before any file is read
    assert c.call("GET", f"/tours/h1/photos/{ph['id']}.webp", headers={"Host": "evil.example"})[0] == 403
