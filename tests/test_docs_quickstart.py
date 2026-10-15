"""The documented path really runs. The blocks marked `<!-- quickstart -->` in docs/guides/getting-started.md and README.md are
executed, command by command, in a temporary folder against a made-up city (tests/synthetic_city.py) with the network faked:
the city lookup, the geocoders, the transit feed download and the OpenStreetMap downloads. Every other `apartmentscout ...`
line in the README, AGENTS.md, the guides and the skills must at least parse against the real command line.
"""
from __future__ import annotations

import json
import re
import shlex
import types
import webbrowser
from pathlib import Path

import pytest
import yaml
from osm_stub import stub_osm
from synthetic_city import CHICAGO_ROW, LISTINGS_CSV, coords, small_feed

from apartmentscout import cities as C
from apartmentscout import cli, intake
from apartmentscout.commands import plans as plans_cmd  # noqa: F401  (registered by cli.build_parser)
from apartmentscout.config import load_criteria
from apartmentscout.criteria_check import check_file

ROOT = Path(__file__).resolve().parents[1]
GETTING_STARTED = ROOT / "docs" / "guides" / "getting-started.md"
README = ROOT / "README.md"
MARK = "<!-- quickstart -->"
PLAN = {"schema": 2, "id": "placeholder", "title": "Fixture plan", "units": "m", "up_bearing": 120, "source": "fixture",
        "rooms": [{"name": "Sala", "kind": "living", "x": 0, "y": 3, "w": 5, "h": 4}, {"name": "Quarto", "kind": "bedroom", "x": 0, "y": 0, "w": 3.2, "h": 3}],
        "windows": [{"room": "Sala", "x1": 1, "y1": 7, "x2": 3.5, "y2": 7, "sill": 0.8, "head": 2.2}],
        "doors": [{"x1": 4, "y1": 3, "x2": 4.9, "y2": 3, "kind": "entry"}]}


def runnable_blocks(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return [m.group(1) for m in re.finditer(re.escape(MARK) + r"\n```(?:bash|sh)\n(.*?)```", text, re.S)]


def command_lines(block: str) -> list[list[str]]:
    """The shell words of every command in a block: continuation lines joined, comments dropped, `&&` split."""
    out = []
    for raw in re.sub(r"\\\n\s*", " ", block).splitlines():
        line = re.sub(r"\s+#.*$", "", raw.strip())
        for part in filter(None, (p.strip() for p in re.split(r"\s+&&\s+", line))):
            if part.startswith(("apartmentscout ", "scout ", "export ")):   # other lines (python, yaml, shell tools) are not ours to run
                out.append(shlex.split(part))
    return out


# --------------------------------------------------------------------------- a world with no network
class FakeServer:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def serve_forever(self):
        return None


@pytest.fixture
def world(tmp_path, monkeypatch):
    from apartmentscout import localapi
    from apartmentscout.commute import run as commute_run
    from apartmentscout.geo import fetch as fetch_mod
    from apartmentscout.geo import places as places_mod
    from apartmentscout.geocode import Geocoder

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("APARTMENTSCOUT_SEARCH", raising=False)
    monkeypatch.setattr(C, "_http_json", lambda url, params: [CHICAGO_ROW])
    monkeypatch.setattr(C, "check_feed", lambda u, get=None: C.FeedCheck(True, "a zip file", 12.0))
    monkeypatch.setattr(intake, "live_online", lambda: intake.Online(
        resolve_city=C.resolve_city, geocode=lambda addr, info: coords(addr), check_feed=C.check_feed))
    monkeypatch.setattr(Geocoder, "geocode", lambda self, address, provider="auto": coords(address))

    def download(url, dest, max_age_days=14):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(small_feed())
        return dest

    monkeypatch.setattr(commute_run, "download_feed", download)
    stub_osm(monkeypatch)
    monkeypatch.setattr(fetch_mod, "overpass", lambda *a, **k: [])
    monkeypatch.setattr(places_mod, "overpass", lambda *a, **k: [])
    monkeypatch.setattr(localapi, "make_server", lambda state, port: FakeServer())
    monkeypatch.setattr(webbrowser, "open", lambda *a, **k: True)
    return tmp_path


# name, [city given with --city so not asked], time zone, earliest, latest, hard, map centre, then the destination
INIT_ANSWERS = ["Chicago 1BR", "", "", "", "", "",
                "y", "Work", "233 S Wacker Dr", "y", "", "", "", "", "n",   # destination, confirm the match, arrive, max, weight, mode, another
                "y", ""] + [""] * 40                                          # use the starter CTA feed, no other feed, then the defaults


def run_command(words: list[str], listing_id: str, monkeypatch) -> None:
    if words[0] == "export":
        k, _, v = words[1].partition("=")
        monkeypatch.setenv(k, v)
        return
    assert words[0] in ("apartmentscout", "scout"), words
    argv = [listing_id if w == "<listing-id>" else w for w in words[1:]]
    args = cli.build_parser().parse_args(argv)
    if args.fn is cli.cmd_init and args.interactive:
        it = iter(INIT_ANSWERS)
        args.fn(args, input_fn=lambda _p: next(it))
    else:
        args.fn(args)


def prepare(words: list[str], root: Path) -> None:
    """The things a person does between commands: fill in the listings spreadsheet, have a plan file."""
    joined = " ".join(words)
    if "listings.csv" in joined and words[1:2] == ["import"]:
        (root / "searches" / "my-search" / "listings.csv").write_text(LISTINGS_CSV, encoding="utf-8")
    if "the-plan.json" in joined:
        (root / "the-plan.json").write_text(json.dumps(PLAN), encoding="utf-8")


def follow(path: Path, root: Path, monkeypatch, capsys) -> str:
    blocks = runnable_blocks(path)
    assert blocks, f"{path.name} has no <!-- quickstart --> blocks"
    out = ""
    for block in blocks:
        for words in command_lines(block):
            prepare(words, root)
            try:
                run_command(words, "aqua-2504", monkeypatch)
            except SystemExit as e:
                raise AssertionError(f"`{' '.join(words)}` exited: {e.code}") from e
            out += capsys.readouterr().out
    return out


def assert_a_working_chicago_search(root: Path, out: str) -> None:
    s = root / "searches" / "my-search"
    crit = load_criteria(s / "criteria.yaml")
    assert (crit["search"]["city"], crit["search"]["city_name"], crit["search"]["timezone"]) == ("chicago", "Chicago, Illinois", "America/Chicago")
    assert crit["search"]["map_center"] == [41.87556, -87.62442]
    d = crit["commute"]["destinations"][0]
    assert (d["lat"], d["lon"]) == (41.87892, -87.636602)
    assert crit["commute"]["transit"]["feeds"][0]["name"] == "CTA"
    rep = check_file(s / "criteria.yaml")
    assert rep.ok and not any("timezone" in w or "New York" in w or "feeds is empty" in w for w in rep.warnings), rep.warnings
    listings = {L["id"]: L for L in json.loads((s / "listings.json").read_text())}
    assert set(listings) == {"aqua-2504", "presidential-towers-1210", "lake-point-tower-3108"}
    assert all(L["lat"] is not None for L in listings.values()), "every address was placed"
    assert all("Work" in L["commute"] for L in listings.values())
    assert any("subway" in L["commute"]["Work"]["modes"] for L in listings.values()), "the transit feed produced subway times"
    assert "WALKING times only" not in out
    assert (s / "layers" / "commute-work.json").exists()
    assert all(L.get("score") for L in listings.values())
    # the buildings around the shortlist, from OpenStreetMap alone
    assert sorted(p.stem for p in (s / "sites").glob("*.json")) == ["aqua-2504", "presidential-towers-1210"]
    assert "[1/2]" in out and "default 10 m height" in out and "Not available for this city" in out
    # the plan
    assert (s / "plans" / "aqua-2504.json").exists() and "Saved my-search/plans/aqua-2504.json" in out and "0 of 3 open homes have one" in out
    # the dashboard data lives in the search's own cache, never in the committed demo folder
    assert (s / "cache" / "dashboard-data" / "listings.json").exists()
    mf = json.loads((s / "cache" / "dashboard-data" / "manifest.json").read_text())
    assert "aqua-2504" in mf["plans"] and "aqua-2504" in mf["sites"]


def test_the_getting_started_path_runs_in_a_new_city(world, monkeypatch, capsys) -> None:
    demo = ROOT / "dashboard" / "data" / "listings.json"
    before = demo.stat().st_mtime_ns
    out = follow(GETTING_STARTED, world, monkeypatch, capsys)
    assert_a_working_chicago_search(world, out)
    assert demo.stat().st_mtime_ns == before, "the committed demo data was not touched"
    crit = yaml.safe_load((world / "searches" / "my-search" / "criteria.yaml").read_text())
    assert [f["name"] for f in crit["commute"]["transit"]["feeds"]] == ["CTA", "City Metro"], "the second block's --feed was added after the starter"
    # the doc's own claim: the plan was added from a file, id forced to the listing
    assert json.loads((world / "searches" / "my-search" / "plans" / "aqua-2504.json").read_text())["id"] == "aqua-2504"


def test_the_readme_quick_start_runs_the_same_way(world, monkeypatch, capsys) -> None:
    out = follow(README, world, monkeypatch, capsys)
    s = world / "searches" / "my-search"
    crit = load_criteria(s / "criteria.yaml")
    assert crit["search"]["city"] == "chicago" and crit["commute"]["transit"]["feeds"][0]["name"] == "CTA"
    assert (s / "sites" / "aqua-2504.json").exists() and (s / "cache" / "dashboard-data" / "manifest.json").exists()
    assert "1 of 3 open homes have one" not in out and "No floor plans" not in out and "0 of 3 open homes have one" in out


def test_the_two_documents_tell_the_same_story() -> None:
    """The README's commands for a new search are the getting-started path (init, import, validate, all, surroundings, plans, serve)."""
    def verbs(path: Path) -> list[str]:
        return [w[1] for b in runnable_blocks(path) for w in command_lines(b) if w[0] == "apartmentscout"]
    readme, guide = verbs(README), verbs(GETTING_STARTED)
    assert readme == ["init", "import", "validate", "lint", "all", "surroundings", "plans", "serve"]
    assert all(v in guide for v in readme)


# --------------------------------------------------------------------------- every documented command parses
DOCS = [README, ROOT / "AGENTS.md", *sorted((ROOT / "docs" / "guides").glob("*.md")), *sorted((ROOT / ".claude" / "skills").glob("*/SKILL.md"))]
SKIP = {"research-quality.md"}   # its command list is a table of commands followed by descriptions, not runnable lines


def documented_commands() -> list[tuple[str, list[str]]]:
    found = []
    for f in DOCS:
        if f.name in SKIP:
            continue
        for m in re.finditer(r"```(?:bash|sh|console|shell)?\n(.*?)```", f.read_text(encoding="utf-8"), re.S):
            for words in command_lines(m.group(1)):
                if words and words[0] in ("apartmentscout", "scout"):
                    found.append((f.name, words[1:]))
    return found


@pytest.mark.parametrize("doc,argv", documented_commands(), ids=lambda v: " ".join(v) if isinstance(v, list) else v)
def test_every_documented_command_parses(doc: str, argv: list[str]) -> None:
    try:
        args = cli.build_parser().parse_args(argv)
    except SystemExit as e:   # argparse already printed why
        raise AssertionError(f"{doc}: `apartmentscout {' '.join(argv)}` is not a valid command line") from e
    assert isinstance(args, types.SimpleNamespace) or hasattr(args, "fn")


def test_the_guides_document_the_new_commands() -> None:
    seen = {a[0] for _, a in documented_commands()}
    assert {"city", "surroundings", "plans", "init", "geocode", "commute", "all"} <= seen
