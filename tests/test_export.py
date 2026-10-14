"""`apartmentscout export --xlsx / --csv`: formula-injection guard, live-formula workbook, sheets."""
from __future__ import annotations

import csv
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from apartmentscout.cli import main
from apartmentscout.config import load_criteria
from apartmentscout.handoff.safety import safe_cell, safe_text

REPO = Path(__file__).resolve().parent.parent
EXAMPLE = REPO / "examples" / "nyc-2026"
EVIL = '=HYPERLINK("http://evil.example","click")'


def make_search(root: Path, listings: list[dict] | None = None) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    shutil.copy(EXAMPLE / "criteria.yaml", root / "criteria.yaml")
    if listings is None:
        listings = [
            {"id": "a-1", "building": "Alpha", "unit": "1", "address": "1 Alpha St, New York, NY", "sqft": 800,
             "price": {"gross": 4800, "fees_monthly": 20}, "amenities": {"in_unit_wd": True, "elevator": True},
             "status": "shortlist", "checked": "2026-10-01", "links": {"listing": "https://example.com/a1"},
             "commute": {"Office": {"minutes": 20}}},
            {"id": "b-2", "building": EVIL, "unit": "-2", "address": "+2 Beta St", "notes": "@mention me",
             "price": {"gross": 5100}, "amenities": {"in_unit_wd": True, "elevator": True}, "status": "new",
             "checked": "2026-10-02", "links": {"listing": "javascript:alert(1)"}},
            {"id": "c-3", "building": "Gamma", "unit": "3", "price": {"gross": 7000},
             "amenities": {"in_unit_wd": True, "elevator": True}, "status": "researching"},
            {"id": "d-4", "building": "Delta", "unit": "4", "price": {"gross": 4500}, "status": "rejected",
             "notes": "too dark"},
            {"id": "e-5", "building": "Epsilon", "unit": "5", "price": {"gross": 4600}, "status": "gone",
             "listed": "2026-09-01", "gone_date": "2026-09-04"},
        ]
    (root / "listings.json").write_text(json.dumps(listings, indent=1))
    return root


# --------------------------------------------------------------------------- guard
@pytest.mark.parametrize("raw,want", [
    ("=1+1", "'=1+1"), ("+44 20", "'+44 20"), ("-5 min", "'-5 min"), ("@sum", "'@sum"), ("\tx", "'\tx"),
    ("plain", "plain"), ("", ""), ("a=b", "a=b"),
])
def test_safe_text(raw: str, want: str) -> None:
    assert safe_text(raw) == want


def test_safe_cell_leaves_numbers_alone() -> None:
    assert safe_cell(-5) == -5 and safe_cell(2.5) == 2.5 and safe_cell(None) is None and safe_cell(True) is True


# --------------------------------------------------------------------------- csv
def test_csv_guards_text_and_keeps_numbers(tmp_path: Path) -> None:
    s = make_search(tmp_path / "s")
    out = tmp_path / "out.csv"
    main(["export", "--search", str(s), "--csv", str(out)])
    rows = list(csv.DictReader(out.open(encoding="utf-8-sig")))
    assert len(rows) == 5
    b = next(r for r in rows if r["ID"] == "b-2")
    assert b["Building"] == "'" + EVIL
    assert b["Unit"] == "'-2" and b["Notes"] == "'@mention me"
    assert b["Listing"] == ""                          # javascript: URLs are dropped
    a = next(r for r in rows if r["ID"] == "a-1")
    assert float(a["Vs target"]) < 0 and not a["Vs target"].startswith("'")
    assert rows[0]["ID"] == a["ID"] or rows[0]["Rank"] == "1"
    assert [r["Status"] for r in rows][-2:] == ["rejected", "gone"]


def test_export_needs_a_target(tmp_path: Path) -> None:
    s = make_search(tmp_path / "s")
    with pytest.raises(SystemExit, match="--xlsx"):
        main(["export", "--search", str(s)])


def test_export_never_writes_listings(tmp_path: Path) -> None:
    s = make_search(tmp_path / "s")
    before = (s / "listings.json").read_bytes()
    main(["export", "--search", str(s), "--csv", str(tmp_path / "x.csv")])
    assert (s / "listings.json").read_bytes() == before


# --------------------------------------------------------------------------- xlsx
openpyxl = pytest.importorskip("openpyxl")


def _book(tmp_path: Path, listings: list[dict] | None = None) -> tuple[Path, "openpyxl.Workbook"]:
    s = make_search(tmp_path / "s", listings)
    out = tmp_path / "out.xlsx"
    main(["export", "--search", str(s), "--xlsx", str(out)])
    return out, openpyxl.load_workbook(out)


def _cols(sh) -> dict[str, int]:
    return {c.value: c.column for c in sh[4] if c.value}


def test_xlsx_sheets_and_live_formulas(tmp_path: Path) -> None:
    out, wb = _book(tmp_path)
    assert wb.sheetnames[:3] == ["Read me", "Weights", "Listings"]
    for name in ("Outreach", "To verify", "Upfront charges", "Rejected or held", "Sources"):
        assert name in wb.sheetnames
    sh = wb["Listings"]
    ix = _cols(sh)
    assert sh.cell(5, ix["Score"]).value.startswith("=IFERROR(") and "SUMPRODUCT" in sh.cell(5, ix["Score"]).value
    assert "Weights!" in sh.cell(5, ix["Score"]).value
    assert "COUNTIFS" in sh.cell(5, ix["Rank"]).value
    assert sh.cell(5, ix["$ / sq ft"]).value.startswith("=IF(")
    assert sh.freeze_panes and sh.auto_filter.ref.startswith("A4:")
    assert sh.conditional_formatting  # colour scales and tier fills
    w = wb["Weights"]
    assert [w.cell(r, 1).value for r in range(5, 12)][:2] == ["Cost", "Space"]
    assert isinstance(w.cell(5, 2).value, (int, float)) and w.cell(5, 2).fill.fgColor.rgb.endswith("FFF2CC")
    assert wb.calculation.fullCalcOnLoad


def test_xlsx_injection_guard_and_links(tmp_path: Path) -> None:
    _, wb = _book(tmp_path)
    for sh in wb.worksheets:
        for row in sh.iter_rows(min_row=5):
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("="):
                    assert c.data_type == "f" and sh.title in ("Listings", "Weights", "To verify",
                                                                "Upfront charges"), (sh.title, c.coordinate)
                    assert "HYPERLINK" not in c.value
    sh = wb["Listings"]
    ix = _cols(sh)
    names = [sh.cell(r, ix["Building"]).value for r in range(5, sh.max_row + 1)]
    assert "'" + EVIL in names
    links = [sh.cell(r, ix["Listing"]) for r in range(5, sh.max_row + 1)]
    assert any(c.hyperlink and c.hyperlink.target == "https://example.com/a1" for c in links)
    assert not any(c.hyperlink and "javascript" in c.hyperlink.target for c in links)


def test_xlsx_rows_land_on_the_right_sheets(tmp_path: Path) -> None:
    _, wb = _book(tmp_path)
    ids = lambda sh: {sh.cell(r, _cols(sh)["ID"]).value for r in range(5, sh.max_row + 1)}  # noqa: E731
    assert ids(wb["Listings"]) == {"a-1", "b-2", "c-3"}
    held = ids(wb["Rejected or held"])
    assert {"c-3", "d-4"} <= held and "e-5" not in held          # c-3 is over the hard cap
    assert "Gone fast" in wb.sheetnames and ids(wb["Gone fast"]) == {"e-5"}
    gf = wb["Gone fast"]
    assert gf.cell(5, _cols(gf)["Days listed"]).value == 3
    o = wb["Outreach"]
    qs = o.cell(5, _cols(o)["Questions to ask"]).value
    assert qs.startswith("• ")
    tv = wb["To verify"]
    assert "Days since check" in _cols(tv)


def test_no_gone_fast_sheet_without_history(tmp_path: Path) -> None:
    Ls = [{"id": "a-1", "building": "Alpha", "unit": "1", "price": {"gross": 4800}, "status": "gone"}]
    _, wb = _book(tmp_path, Ls)
    assert "Gone fast" not in wb.sheetnames


def test_missing_openpyxl_message(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    s = make_search(tmp_path / "s")
    monkeypatch.setitem(sys.modules, "openpyxl", None)
    with pytest.raises(SystemExit, match=r'pip install -e "\.\[xlsx\]"'):
        main(["export", "--search", str(s), "--xlsx", str(tmp_path / "x.xlsx")])


@pytest.mark.skipif(not shutil.which("soffice") or not os.environ.get("APARTMENTSCOUT_LIBREOFFICE_TESTS"),
                    reason="LibreOffice recalculation test: set APARTMENTSCOUT_LIBREOFFICE_TESTS=1 (release_check does)")
def test_libreoffice_recalc_matches_score_and_weights_rerank(tmp_path: Path) -> None:
    """Open the workbook in LibreOffice: Score matches score.py within 0.1, and editing a weight re-ranks."""
    from apartmentscout.listings import load
    from apartmentscout.score import score_all
    s = tmp_path / "ex"
    s.mkdir()
    shutil.copy(EXAMPLE / "criteria.yaml", s / "criteria.yaml")
    Ls = load(EXAMPLE / "listings.json")[:120]
    (s / "listings.json").write_text(json.dumps(Ls))
    out = tmp_path / "a.xlsx"
    main(["export", "--search", str(s), "--xlsx", str(out)])
    wb = openpyxl.load_workbook(out)
    w = wb["Weights"]
    for r in range(5, 12):
        w.cell(r, 2).value = 100.0 if w.cell(r, 1).value == "Space" else 0.0
    wb.save(tmp_path / "b.xlsx")
    conv = tmp_path / "lo"
    subprocess.run(["soffice", f"-env:UserInstallation=file://{tmp_path / 'profile'}", "--headless", "--calc",
                    "--convert-to", "xlsx", "--outdir", str(conv), str(out), str(tmp_path / "b.xlsx")],
                   check=True, capture_output=True, timeout=240)
    crit = load_criteria(s / "criteria.yaml")
    score_all(Ls, crit)
    by = {L["id"]: L for L in Ls}
    sh = openpyxl.load_workbook(conv / "a.xlsx", data_only=True)["Listings"]
    ix = {c.value: c.column - 1 for c in sh[4] if c.value}
    n = 0
    for row in sh.iter_rows(min_row=5, values_only=True):
        L = by[row[ix["ID"]]]
        want = L["score"]["overall"]
        got = row[ix["Score"]]
        if want is None:
            assert got in (None, "")
        else:
            assert abs(got - want) <= 0.1 + 1e-9
            n += 1
        assert (row[ix["Rank"]] in (None, "")) == (L["score"].get("rank") is None)
    assert n > 50
    sb = openpyxl.load_workbook(conv / "b.xlsx", data_only=True)["Listings"]
    top = min((r for r in sb.iter_rows(min_row=5, values_only=True) if isinstance(r[ix["Rank"]], (int, float))),
              key=lambda r: r[ix["Rank"]])
    best_space = max(r[ix["Space score"]] or 0 for r in sb.iter_rows(min_row=5, values_only=True)
                     if r[ix["Eligible"]] == "yes")
    assert top[ix["Space score"]] == best_space
