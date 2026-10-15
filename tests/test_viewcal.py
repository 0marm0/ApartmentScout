"""Photo matches of window views (apartmentscout/viewcal.py): the record's checks, saving and loading, the height that follows for another
floor, `apartmentscout viewcal import` / `list`, the local API that saves one into the search folder, and `build` carrying it to the page.
No network."""
from __future__ import annotations

import copy
import http.client
import json
import threading
import types
from pathlib import Path
from typing import Any, Iterator

import pytest

from apartmentscout import cli, viewcal
from apartmentscout.config import Workspace
from apartmentscout.intake import init_search
from apartmentscout.listings import save
from apartmentscout.localapi import ServeState, make_server

ROOT = Path(__file__).resolve().parents[1]

REC: dict[str, Any] = {
    "schema": 1, "kind": "apartmentscout-view-calibration", "site": "rua-augusta-3e", "saved": "2026-10-15T12:00:00.000Z",
    "photo": {"n": 1, "path": "media/shared/x.webp", "title": "32E living/dining (E line)", "scope": "same-line", "floor": 32, "aspect": 1.5, "source": "listing"},
    "eye": {"x": 34.0, "y": 0.4, "z": 72.4},
    "landmarks": [{"name": "A", "kind": "named", "x": 100.0, "y": 50.0, "z": 120.0, "u": 0.2, "v": 0.3},
                  {"name": "B", "kind": "picked", "x": 700.0, "y": -100.0, "z": 200.0, "u": 0.6, "v": 0.4}],
    "result": {"bearing_deg": 121.0, "tilt_deg": 4.0, "vfov_deg": 52.0, "hfov_deg": 73.0, "eye_height_m": 99.2, "eye_determined": True, "lens_determined": False,
               "sigma": {"bearing": 0.3, "tilt": 0.4, "vfov": 0, "eye": 2.5}, "rms_deg": 0.6, "max_deg": 0.9, "n": 2, "dof": 2, "quality": "good"},
    "applied": {"az_deg": 121.0, "floor": 24, "facade_offset_deg": 2.3},
}


def rec(**kw: Any) -> dict[str, Any]:
    r = copy.deepcopy(REC)
    r.update(kw)
    return r


# --------------------------------------------------------------------------- the record
def test_a_good_record_passes_and_text_loses_its_markup() -> None:
    out = viewcal.check(rec(photo={**REC["photo"], "title": "<img src=x onerror=1>32E"}))
    assert "<" not in out["photo"]["title"] and out["site"] == "rua-augusta-3e"


@pytest.mark.parametrize("mutate,needle", [
    (lambda r: r.update(kind="other"), "not an ApartmentScout"),
    (lambda r: r.update(schema=2), "schema"),
    (lambda r: r.update(site="../etc"), "site"),
    (lambda r: r.update(landmarks=r["landmarks"][:1]), "two to twelve"),
    (lambda r: r["photo"].update(floor=0), "photo.floor"),
    (lambda r: r["photo"].update(aspect=0), "aspect"),
    (lambda r: r["eye"].update(z="x"), "eye.z"),
    (lambda r: r["result"].update(bearing_deg=400), "bearing_deg"),
    (lambda r: r["result"].update(rms_deg=float("nan")), "rms_deg"),
    (lambda r: r["result"].update(quality="great"), "quality"),
    (lambda r: r["landmarks"][0].update(u=None), r"landmarks\[1\]"),
])
def test_a_record_with_a_bad_number_is_refused_whole(mutate, needle) -> None:
    r = copy.deepcopy(REC)
    mutate(r)
    with pytest.raises(viewcal.ViewCalError, match=needle):
        viewcal.check(r)


def test_not_a_mapping_is_refused() -> None:
    for bad in (None, "x", [], 3):
        with pytest.raises(viewcal.ViewCalError):
            viewcal.check(bad)


# --------------------------------------------------------------------------- files
def test_save_load_overwrite_and_backup(tmp_path: Path) -> None:
    out = viewcal.save(tmp_path, REC)
    assert out["path"] == "view-calibrations/rua-augusta-3e.json" and out["created"] is True and out["warnings"] == []
    assert viewcal.load(tmp_path, "rua-augusta-3e")["result"]["bearing_deg"] == 121.0
    assert viewcal.ids(tmp_path) == ["rua-augusta-3e"]
    with pytest.raises(viewcal.ViewCalError, match="already exists"):
        viewcal.save(tmp_path, REC, overwrite=False)
    r2 = rec(); r2["result"]["bearing_deg"] = 130.0
    again = viewcal.save(tmp_path, r2)
    assert again["created"] is False and (tmp_path / "view-calibrations" / "rua-augusta-3e.json.bak").exists()
    assert viewcal.load(tmp_path, "rua-augusta-3e")["result"]["bearing_deg"] == 130.0
    assert viewcal.load(tmp_path, "nobody") is None


def test_a_damaged_file_counts_as_none_and_warnings_say_what_was_not_measured(tmp_path: Path) -> None:
    (tmp_path / "view-calibrations").mkdir()
    (tmp_path / "view-calibrations" / "x.json").write_text("{not json")
    assert viewcal.load(tmp_path, "x") is None
    weak = rec(); weak["result"].update(eye_determined=False, quality="poor")
    w = viewcal.save(tmp_path, weak)["warnings"]
    assert any("poor" in m for m in w) and any("camera height" in m for m in w)


def test_a_symbolic_link_is_not_written_through(tmp_path: Path) -> None:
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "view-calibrations").symlink_to(tmp_path / "elsewhere")
    with pytest.raises(viewcal.ViewCalError, match="symbolic link"):
        viewcal.save(tmp_path, REC)


def test_the_height_follows_for_another_floor() -> None:
    # eye 99.2 m on floor 32 with the street at 0: slab 97.6, so 3.1484 m a floor and floor 24 has its eye at 23 * 3.1484 + 1.6
    assert viewcal.eye_at_floor(REC, 0.0, 24) == pytest.approx(23 * (97.6 / 31) + 1.6, abs=0.01)
    assert viewcal.eye_at_floor(REC, 0.0, 32) == pytest.approx(99.2, abs=0.01)
    assert viewcal.eye_at_floor(REC, 2.0, 1) == pytest.approx(2.0 + 1.6, abs=0.01)
    weak = rec(); weak["result"]["eye_determined"] = False
    assert viewcal.eye_at_floor(weak, 0.0, 24) is None


def test_the_command_to_carry_it_into_the_site_file() -> None:
    cmd = viewcal.site_command(REC, 0.0)
    assert cmd.startswith("apartmentscout site rua-augusta-3e --floor 24 --bearing 121.0 --eye-height 74.0")
    weak = rec(); weak["result"]["eye_determined"] = False
    assert "--eye-height" not in viewcal.site_command(weak, 0.0)
    note = viewcal.calibration_note(REC)
    assert note["photo"] == 1 and note["eye_height_m"] == 99.2 and note["photo_floor"] == 32
    assert viewcal.calibration_note(weak)["eye_height_m"] is None


# --------------------------------------------------------------------------- the command line
def make_search(tmp_path: Path) -> Path:
    root = tmp_path / "lisbon"
    init_search(root, "generic")
    save([{"id": "rua-augusta-3e", "building": "Rua Augusta", "unit": "3E", "status": "shortlist", "lat": 38.71, "lon": -9.137}], root / "listings.json")
    return root


def args(root: Path, action: str, file: str | None = None, replace: bool = False) -> types.SimpleNamespace:
    return types.SimpleNamespace(search=str(root), action=action, file=file, replace=replace)


def test_the_parser_knows_viewcal_and_site_has_its_switch() -> None:
    p = cli.build_parser()
    a = p.parse_args(["viewcal", "import", "x.view-calibration.json", "--replace"])
    assert a.action == "import" and a.replace is True
    assert p.parse_args(["site", "x", "--no-view-calibration"]).no_view_calibration is True


def test_import_and_list(tmp_path: Path, capsys) -> None:
    root = make_search(tmp_path)
    f = tmp_path / "rua-augusta-3e.view-calibration.json"
    f.write_text(json.dumps(REC))
    cli.cmd_viewcal(args(root, "list"))
    assert "No photo matches saved" in capsys.readouterr().out
    cli.cmd_viewcal(args(root, "import", str(f)))
    out = capsys.readouterr().out
    assert "saved view-calibrations/rua-augusta-3e.json" in out and "apartmentscout site rua-augusta-3e --floor 24 --bearing 121.0" in out
    with pytest.raises(SystemExit, match="--replace"):
        cli.cmd_viewcal(args(root, "import", str(f)))
    cli.cmd_viewcal(args(root, "import", str(f), replace=True))
    assert "replaced" in capsys.readouterr().out
    cli.cmd_viewcal(args(root, "list"))
    assert "photo 1 (floor 32), looks toward 121 deg" in capsys.readouterr().out
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"kind": "nope"}))
    with pytest.raises(SystemExit, match="Could not import"):
        cli.cmd_viewcal(args(root, "import", str(bad)))
    with pytest.raises(SystemExit, match="needs the exported file"):
        cli.cmd_viewcal(args(root, "import"))


def test_build_carries_the_folder_and_lists_it_in_the_manifest(tmp_path: Path) -> None:
    root = make_search(tmp_path)
    viewcal.save(root, REC)
    out = tmp_path / "out"
    cli._export(Workspace(root), out)
    assert (out / "view-calibrations" / "rua-augusta-3e.json").exists()
    assert json.loads((out / "manifest.json").read_text())["view_calibrations"] == ["rua-augusta-3e"]


# --------------------------------------------------------------------------- the local API
class Client:
    def __init__(self, port: int, token: str) -> None:
        self.port, self.token = port, token

    def post(self, path: str, body: Any, token: bool = True) -> tuple[int, Any]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/json"}
        if token:
            h["X-AS-Token"] = self.token
        c.request("POST", path, body=json.dumps(body).encode(), headers=h)
        r = c.getresponse()
        data = json.loads(r.read())
        c.close()
        return r.status, data


@pytest.fixture
def served(tmp_path: Path) -> Iterator[tuple[Client, ServeState, Path]]:
    root = make_search(tmp_path)
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=cli._export, rescore=cli._rescore)
    state.activate(Workspace(root))
    httpd = make_server(state, 0)
    threading.Thread(target=lambda: httpd.serve_forever(0.02), daemon=True).start()
    yield Client(state.port, state.token), state, root
    httpd.shutdown()
    httpd.server_close()


def test_the_page_saves_a_match_into_the_search_and_it_shows_without_a_rebuild(served) -> None:
    c, state, root = served
    status, body = c.post("/api/view-calibrations", {"record": REC})
    assert status == 200 and body["path"] == "view-calibrations/rua-augusta-3e.json" and body["created"] is True
    assert json.loads((root / "view-calibrations" / "rua-augusta-3e.json").read_text())["result"]["n"] == 2
    assert (state.data_dir / "view-calibrations" / "rua-augusta-3e.json").exists()
    assert "rua-augusta-3e" in json.loads((state.data_dir / "manifest.json").read_text())["view_calibrations"]
    assert any("apartmentscout site rua-augusta-3e" in n for n in body["next"])
    assert c.post("/api/view-calibrations", {"record": REC})[1]["created"] is False   # saving again replaces it (the page's Save is repeatable)
    assert c.post("/api/view-calibrations", {"record": {"kind": "nope"}})[0] == 422
    assert c.post("/api/view-calibrations", {"record": "x"})[0] == 422
    assert c.post("/api/view-calibrations", {"record": REC}, token=False)[0] == 401


def test_an_example_search_does_not_take_a_match(tmp_path: Path) -> None:
    state = ServeState(dash=ROOT / "dashboard", searches_dir=tmp_path, ws=None, data_dir=ROOT / "dashboard" / "data", media_dir=None,
                       export=lambda ws, out: None, rescore=lambda ws: None)
    state.ws = Workspace(ROOT / "examples" / "nyc-2026")
    from apartmentscout.localapi import ApiError
    with pytest.raises(ApiError) as e:
        state.save_view_calibration(REC, True)
    assert e.value.status == 403
    state.ws = None
    with pytest.raises(ApiError) as e2:
        state.save_view_calibration(REC, True)
    assert e2.value.status == 409
