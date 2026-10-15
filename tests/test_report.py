"""`apartmentscout report --homes` and the decision-report template (dashboard/report/report.html).

The browser builds the same payload from the same template (dashboard/js/features/report-model.js); the parity test below runs it under
Node and compares. The page is checked for what it must contain and what it must never contain; the rules the page applies are tested
in tests/js/report.test.mjs, and the printed result in tests/e2e/test_decision_report.py.
"""
from __future__ import annotations

import base64
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from apartmentscout import pdfout
from apartmentscout import report_doc as rd
from apartmentscout import share as sh
from apartmentscout.cli import main
from apartmentscout.commands import report as cmd
from apartmentscout.config import Workspace
from apartmentscout.listings import load

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "nyc-2026"
DATA = ROOT / "dashboard" / "data"
IDS = ["paramount-tower-25e", "the-greywood-4b", "paramount-tower-41a"]
PICKS = {"paramount-tower-25e": {"saved": True, "tier": "S", "note": "private pick note", "tour": "2026-10-17T10:30"}}


@pytest.fixture(scope="module")
def search() -> tuple[Workspace, list[dict], dict]:
    ws = Workspace(EXAMPLE)
    return ws, load(ws.listings_path), ws.criteria()


def payload_of(html: str) -> dict:
    m = re.search(r'<script type="application/json" id="as-data">(.*?)</script>', html, re.S)
    assert m, "no as-data block"
    return json.loads(m.group(1))


def make(search, **kw):
    ws, listings, crit = search
    return rd.build_payload(listings, crit, kw.pop("ids", IDS), root=ws.root, with_photos=False, generated="2026-10-15", **kw)


# --------------------------------------------------------------------------- the payload
def test_a_report_holds_one_to_four_known_homes_best_first(search) -> None:
    p = make(search)
    assert [h["id"] for h in p["homes"]] == IDS                    # by fit under the criteria's weights
    assert p["v"] == 1 and p["paper"] == "letter" and p["move_in"] == {"earliest": "2026-10-15", "latest": "2026-11-01"}
    assert p["dests"] == [{"name": "Grand Central"}] and all("fit" in h and h["reasons"] and "Grand Central" in h["commutes"] for h in p["homes"])
    assert p["homes"][0]["plan"]["rooms"] and "plan" not in make(search, ids=["orion-condominium-43e"])["homes"][0]   # a plan only where the search has one
    with pytest.raises(rd.ReportError, match="No listing with id nope"):
        make(search, ids=["nope"])
    with pytest.raises(rd.ReportError, match="1 to 4"):
        make(search, ids=[L["id"] for L in search[1][:5]])
    assert len(make(search, ids=["the-greywood-4b", "the-greywood-4b"])["homes"]) == 1
    assert make(search, paper="a4")["paper"] == "a4" and make(search, paper="folio")["paper"] == "letter"


def test_only_the_schemas_fields_travel_and_notes_only_when_asked(search) -> None:
    findings = {IDS[0]: {"observed": "2026-10-14", "ceiling": 9, "note": "my private visit note", "visited_at": "2026-10-14T10:30"}}
    trail = [{"e": "star", "home": IDS[0], "at": "2026-10-14T10:00:00Z", "kind": "star", "from": None, "to": True, "why": "private reason"}]
    quiet = make(search, picks=PICKS, findings=findings, trail=trail)
    blob = json.dumps(quiet)
    assert quiet["notes"] is False
    for secret in ("private pick note", "my private visit note", "private reason", "2026-10-17T10:30", "10:30"):
        assert secret not in blob, secret
    assert quiet["homes"][0]["tour"]["observed"] == "2026-10-14"        # the visit's facts travel, its words do not
    loud = make(search, picks=PICKS, findings=findings, trail=trail, include_notes=True)
    assert loud["notes"] is True and loud["homes"][0]["pick"]["note"] == "private pick note" and loud["homes"][0]["tour"]["note"] == "my private visit note"
    assert "2026-10-17T10:30" not in json.dumps(loud), "tour times never leave"
    schema = sh.load_schema(rd.load_template())
    allowed = set(schema["listing"]) | {"pick", "reasons", "fit", "commutes", "lease", "plan", "questions", "tour", "trail", "photos", "still"}
    for h in loud["homes"]:
        assert set(h) <= allowed, set(h) - allowed
        assert set(h["score"]) <= set(schema["score"]), set(h["score"]) - set(schema["score"])
        assert not ({"claims", "photos_local", "commute", "stations"} & set(h))


def test_plans_are_cut_to_what_the_thumbnail_draws(search) -> None:
    plan = rd.prune_plan(json.loads((DATA / "plans" / "paramount-tower-25e.json").read_text()), {})
    assert plan["rooms"] and all(set(r) <= {"name", "kind", "poly"} for r in plan["rooms"]) and plan["windows"] and "up_bearing" in plan
    assert not ({"finishes", "fixtures", "layouts", "provenance"} & set(plan))
    assert rd.prune_plan({"rooms": []}, {}) is None and rd.prune_plan(None, {}) is None
    assert rd.prune_plan({"units": "m", "rooms": [{"name": "A", "poly": [[0.04, 0.05], [1, 0], [1, 1]]}], "windows": [{"a": [0, 0], "b": [1, 0]}, {"x1": 1, "y1": 1, "x2": 2, "y2": 2}, "x"]}, {}) == \
        {"units": "m", "rooms": [{"name": "A", "poly": [[0, 0.1], [1, 0], [1, 1]]}], "windows": [{"a": [0, 0], "b": [1, 0]}, {"x1": 1, "y1": 1, "x2": 2, "y2": 2}]}
    assert rd.load_plan(None, "x") is None and rd.load_plan(EXAMPLE, "../criteria") is None and rd.load_plan(EXAMPLE, "no-such-home") is None


def test_the_open_questions_are_the_ones_the_office_draft_asks(search) -> None:
    ws, listings, crit = search
    qs = rd.open_questions(next(L for L in listings if L["id"] == IDS[0]), crit)
    assert qs and all(set(q) == {"text", "kind"} and q["kind"] in ("dispute", "verify", "missing", "flag") for q in qs)
    assert make(search)["homes"][0]["questions"] == qs[:8]


# --------------------------------------------------------------------------- the page
def test_the_page_is_self_contained_and_escapes_what_it_embeds(search) -> None:
    ws, listings, crit = search
    html = rd.render(listings, crit, IDS, root=ws.root, with_photos=False)
    assert html.count('<script type="application/json" id="as-data">') == 1 and "null</script>" not in html.split('id="as-data">')[1][:12]
    assert "/*as-fonts*/" not in html and "data:font/woff2;base64," in html and 'font-family:"Geist"' in html
    assert "/Users/" not in html and "@font-face" in html
    assert re.search(r"<script[^>]+src=", html) is None and "<link " not in html, "nothing is fetched when the page opens"
    assert len(payload_of(html)["homes"]) == 3
    evil = dict(listings[0], id="evil-1", building="</script><script>alert(1)</script>", unit=" ", score=listings[0].get("score"))
    out = sh.inline_payload(rd.load_template(), rd.build_payload([evil] + listings, crit, ["evil-1"], with_photos=False))
    assert "</script><script>alert" not in out and "<\\/script>" in out


def test_the_font_is_the_dashboards_geist() -> None:
    css = rd.font_css()
    m = re.search(r'base64,([A-Za-z0-9+/=]+)"\)', css)
    assert m and base64.b64decode(m.group(1))[:4] == b"wOF2" and "font-weight:100 900" in css
    assert rd.font_css(Path("/nonexistent")) == "" and rd.inline_fonts("<style id=\"as-fonts\">/*as-fonts*/</style>", "") == '<style id="as-fonts"></style>'


# --------------------------------------------------------------------------- the command
def run(tmp_path: Path, *argv: str) -> Path:
    out = tmp_path / "r.html"
    main(["report", "--search", str(EXAMPLE), "--homes", *argv, "--out", str(out), "--no-stills", "--no-photos"])
    return out


def test_the_command_writes_the_html(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = run(tmp_path, *IDS, "--as-of", "2026-10-15", "--title", "Fall decision")
    say = capsys.readouterr().out
    p = payload_of(out.read_text())
    assert [h["id"] for h in p["homes"]] == IDS and p["generated"] == "2026-10-15" and p["title"] == "Fall decision" and p["notes"] is False
    assert f"Wrote {out}" in say and "3 homes" in say and "Print gives the PDF" in say


def test_the_command_takes_ids_or_unique_text_and_refuses_what_it_cannot_do(tmp_path: Path) -> None:
    p = payload_of(run(tmp_path, "paramount-tower-25e", "greywood-4b").read_text())
    assert {h["id"] for h in p["homes"]} == {"paramount-tower-25e", "the-greywood-4b"}
    with pytest.raises(SystemExit, match="More than one listing matches '25e'"):
        run(tmp_path, "25e", "greywood-4b")
    with pytest.raises(SystemExit, match="No listing matches 'zzz'"):
        run(tmp_path, "zzz", "greywood-4b")
    with pytest.raises(SystemExit, match="compares 2 to 4 homes"):
        run(tmp_path, "greywood-4b")
    with pytest.raises(SystemExit, match="compares 2 to 4 homes"):
        run(tmp_path, *[L["id"] for L in load(EXAMPLE / "listings.json")[:5]])
    assert cmd.resolve_ids([{"id": "a-1"}, {"id": "b-1"}], ["a-1", "a-1", "b"]) == ["a-1", "b-1"]


def test_notes_and_visit_photos_come_only_from_the_flags(tmp_path: Path) -> None:
    picks = tmp_path / "picks.json"
    picks.write_text(json.dumps({"version": 1, "picks": {IDS[0]: {"saved": True, "tier": "S", "note": "a note for me"}}, "findings": {IDS[0]: {"observed": "2026-10-14", "ceiling": 9, "note": "visit words"}}}))
    off = payload_of(run(tmp_path, *IDS, "--picks", str(picks)).read_text())
    assert off["homes"][0]["pick"] == {"tier": "S"} and "visit words" not in json.dumps(off) and "a note for me" not in json.dumps(off)
    on = payload_of(run(tmp_path, *IDS, "--picks", str(picks), "--notes").read_text())
    assert on["homes"][0]["pick"] == {"tier": "S", "note": "a note for me"} and on["homes"][0]["tour"]["note"] == "visit words" and on["notes"] is True


def test_without_a_browser_the_command_keeps_the_html(tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch) -> None:
    def no_browser(*a, **k):
        raise pdfout.BrowserUnavailable("no browser here")
    monkeypatch.setattr(pdfout, "html_to_pdf", no_browser)
    out = tmp_path / "x" / "report.pdf"
    main(["report", "--search", str(EXAMPLE), "--homes", *IDS[:2], "--out", str(out), "--no-stills", "--no-photos"])
    say = capsys.readouterr().out
    assert not out.exists() and (tmp_path / "x" / "report.html").is_file()
    assert "No PDF made (no browser here)" in say and "report.html" in say and "Save as PDF" in say


@pytest.mark.skipif(not pdfout.playwright_ready(), reason="Playwright's Chromium is not installed")
@pytest.mark.parametrize("paper,box", [("letter", (612, 792)), ("a4", (595, 842))])
def test_the_pdf_has_a_page_per_part_at_the_paper_size(tmp_path: Path, paper: str, box: tuple[int, int]) -> None:
    out = tmp_path / "report.pdf"
    main(["report", "--search", str(EXAMPLE), "--homes", *IDS, "--out", str(out), "--no-stills", "--paper", paper])
    data = out.read_bytes()
    assert data[:5] == b"%PDF-" and len(re.findall(rb"/Type\s*/Page[^s]", data)) == len(IDS) + 3     # cover, table, a page per home, checklist
    sizes = {tuple(round(float(x)) for x in m.split()[2:]) for m in re.findall(rb"/MediaBox\s*\[([^\]]*)\]", data) for m in [m.decode()]}
    assert sizes == {box}


# --------------------------------------------------------------------------- browser and CLI builders agree
@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize("notes", [False, True])
def test_the_browser_builder_makes_the_same_payload(notes: bool) -> None:
    listings = json.loads((DATA / "listings.json").read_text())
    crit = json.loads((DATA / "criteria.json").read_text())
    ids = ["paramount-tower-25e", "the-greywood-4b", "emerald-green-1211"]
    from apartmentscout import tours
    findings = {ids[0]: tours.normalize({"observed": "2026-10-14", "ceiling": 9, "water": 4, "note": "my visit note"})}
    py = rd.build_payload(listings, crit, ids, picks=PICKS, include_notes=notes, root=DATA, with_photos=False, findings=findings, generated="2026-10-15")
    cmd_ = ["node", str(ROOT / "tests" / "js" / "emit-report-payload.mjs"), ",".join(ids)] + (["--notes"] if notes else [])
    js = json.loads(subprocess.run(cmd_, check=True, capture_output=True, text=True, timeout=60).stdout)
    for d in (py, js):
        d.pop("source", None)
        for h in d["homes"]:
            h.pop("questions", None)    # the browser reads questions.json, the command asks the generator: tests/test_office_questions_builder.py holds those equal
    assert py["homes"] == js["homes"]
    assert py == js
