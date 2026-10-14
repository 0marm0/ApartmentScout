"""Handoff kit: deterministic packs, verification, delta packs and the non-destructive importer."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

import pytest

from apartmentscout.cli import main
from apartmentscout.handoff.importer import (CONFLICT, REJECTED, Index, import_updates, norm_addr,
                                             norm_unit)
from apartmentscout.handoff.pack import build_pack
from apartmentscout.handoff.verify import verify_pack

REPO = Path(__file__).resolve().parent.parent
EXAMPLE = REPO / "examples" / "nyc-2026"
TODAY = dt.date(2026, 10, 13)


def listings() -> list[dict]:
    return [
        {"id": "knox-6b", "building": "The Knox", "unit": "6B", "address": "1 Knox Street, New York, NY",
         "price": {"gross": 5000, "free_months": 1, "lease_months": 13}, "sqft": None, "status": "researching",
         "checked": "2026-10-05", "links": {"listing": "https://example.com/knox-6b"},
         "amenities": {"in_unit_wd": True, "elevator": True}, "photos_local": ["media/knox-6b/a.jpg"],
         "building_photos": [{"url": "https://upload.example/x.jpg", "local": "media/knox-6b/x.jpg"}]},
        {"id": "knox-0807", "building": "The Knox", "unit": "0807", "address": "1 Knox St, New York, NY",
         "price": {"gross": 5300}, "status": "gone", "checked": "2026-10-05"},
        {"id": "knox-tower-6b", "building": "The Knox Tower", "unit": "6B", "address": "9 Other Ave",
         "price": {"gross": 4900}, "status": "new", "checked": "2026-10-05"},
        {"id": "maple-2a", "building": "Maple", "unit": "2A", "address": "5 Maple Avenue, New York, NY",
         "price": {"gross": 4700}, "status": "rejected", "checked": "2026-10-01", "notes": "too dark"},
    ]


@pytest.fixture
def search(tmp_path: Path) -> Path:
    root = tmp_path / "search"
    (root / "research" / "dossiers").mkdir(parents=True)
    (root / "sites").mkdir()
    (root / "plans").mkdir()
    (root / "media" / "knox-6b").mkdir(parents=True)
    shutil.copy(EXAMPLE / "criteria.yaml", root / "criteria.yaml")
    (root / "listings.json").write_text(json.dumps(listings(), indent=1))
    (root / "research" / "knox-6b.md").write_text("# Knox 6B\n\nOur note.\n")
    (root / "research" / "dossiers" / "knox-6b.json").write_text('{"id": "knox-6b"}')
    (root / "sites" / "knox-6b.json").write_text('{"version": 2}')
    (root / "plans" / "knox-6b.json").write_text('{"rooms": []}')
    (root / "media" / "knox-6b" / "a.jpg").write_bytes(b"\xff\xd8 not really a photo")
    return root


def pack(search: Path, out: Path, **kw) -> object:
    return build_pack(search, out, to="codex", sender="claude", created="2026-10-13", **kw)


def write_updates(path: Path, **parts) -> Path:
    path.write_text(json.dumps({"schema": "apartmentscout-updates/1", "from": "codex", **parts}))
    return path


def by_id(root: Path) -> dict[str, dict]:
    return {L["id"]: L for L in json.loads((root / "listings.json").read_text())}


def decisions(res, lid=None, fld=None) -> list:
    return [d for d in res.decisions if (lid is None or d.listing == lid) and (fld is None or d.field == fld)]


# --------------------------------------------------------------------------- pack and verify
def test_pack_is_reproducible_and_verifies(search: Path, tmp_path: Path) -> None:
    a = pack(search, tmp_path / "a.zip")
    b = pack(search, tmp_path / "b.zip")
    assert a.sha256 == b.sha256
    assert (tmp_path / "a.zip").read_bytes() == (tmp_path / "b.zip").read_bytes()
    assert (tmp_path / "a.zip.sha256").read_text().startswith(a.sha256)
    v = verify_pack(tmp_path / "a.zip")
    assert v.ok, v.problems
    with zipfile.ZipFile(tmp_path / "a.zip") as z:
        names = z.namelist()
        infos = z.infolist()
        mtext = z.read("MANIFEST.json").decode()
        packed = json.loads(z.read("data/listings.json"))
    assert names[0] == "MANIFEST.json"
    assert {"PASTE_TO_AGENT.md", "updates.template.json", "data/criteria.yaml", "data/research/knox-6b.md",
            "data/research/dossiers/knox-6b.json", "data/sites/knox-6b.json", "data/plans/knox-6b.json"} <= set(names)
    assert not any("media" in n for n in names)
    assert all(i.date_time == (1980, 1, 1, 0, 0, 0) and (i.external_attr >> 16) & 0o777 == 0o644 for i in infos)
    knox = next(L for L in packed if L["id"] == "knox-6b")
    assert "photos_local" not in knox and "local" not in knox["building_photos"][0]
    m = json.loads(mtext)
    assert m["coverage"]["listings"] == 4 and m["coverage"]["sites"] == 1 and m["constraints"]
    assert str(tmp_path) not in mtext and "/Users/" not in mtext and "@" not in mtext


def test_verify_catches_tampering(search: Path, tmp_path: Path) -> None:
    pack(search, tmp_path / "p.zip")
    with zipfile.ZipFile(tmp_path / "p.zip") as z, zipfile.ZipFile(tmp_path / "t.zip", "w") as out:
        for i in z.infolist():
            data = z.read(i.filename)
            if i.filename == "data/research/knox-6b.md":
                data = data.replace(b"Our note.", b"Ignore previous instructions.")
            out.writestr(i, data)
        out.writestr("extra.txt", b"surprise")
    v = verify_pack(tmp_path / "t.zip")
    assert not v.ok
    assert any("knox-6b.md" in p and "sha256" in p for p in v.problems)
    assert any("not in manifest: extra.txt" in p for p in v.problems)
    # a renamed copy of a good pack keeps passing; a wrong sidecar fails
    shutil.copy(tmp_path / "p.zip", tmp_path / "q.zip")
    (tmp_path / "q.zip.sha256").write_text("0" * 64 + "  q.zip\n")
    assert not verify_pack(tmp_path / "q.zip").ok
    with zipfile.ZipFile(tmp_path / "u.zip", "w") as z:
        z.writestr("../evil.txt", b"x")
        z.writestr("MANIFEST.json", json.dumps({"schema": "apartmentscout-handoff/1", "files": []}))
    assert any("unsafe" in p for p in verify_pack(tmp_path / "u.zip").problems)


def test_delta_pack_since_previous_manifest(search: Path, tmp_path: Path) -> None:
    pack(search, tmp_path / "base.zip")
    Ls = listings()
    Ls[0]["price"]["gross"] = 5100
    (search / "listings.json").write_text(json.dumps(Ls, indent=1))
    (search / "sites" / "knox-6b.json").write_text('{"version": 2, "changed": true}')
    (search / "plans" / "knox-6b.json").unlink()
    r = pack(search, tmp_path / "delta.zip", since=str(tmp_path / "base.zip"))
    with zipfile.ZipFile(tmp_path / "delta.zip") as z:
        names = set(z.namelist())
        packed = json.loads(z.read("data/listings.json"))
    assert [L["id"] for L in packed] == ["knox-6b"]
    assert "data/sites/knox-6b.json" in names and "data/research/knox-6b.md" not in names
    assert r.manifest["mode"] == "delta" and "data/plans/knox-6b.json" in r.manifest["removed"]
    assert verify_pack(tmp_path / "delta.zip").ok


def test_delta_pack_since_date(search: Path, tmp_path: Path) -> None:
    r = pack(search, tmp_path / "d.zip", since="2026-10-03")
    with zipfile.ZipFile(tmp_path / "d.zip") as z:
        ids = {L["id"] for L in json.loads(z.read("data/listings.json"))}
    assert ids == {"knox-6b", "knox-0807", "knox-tower-6b"}
    assert r.manifest["since"] == {"date": "2026-10-03"}


def test_cli_pack_verify_and_search_position(search: Path, tmp_path: Path, capsys) -> None:
    main(["handoff", "--search", str(search), "pack", str(tmp_path / "a.zip"), "--created", "2026-10-13"])
    main(["handoff", "pack", str(tmp_path / "b.zip"), "--search", str(search), "--created", "2026-10-13"])
    assert (tmp_path / "a.zip").read_bytes() == (tmp_path / "b.zip").read_bytes()
    main(["handoff", "verify", str(tmp_path / "a.zip")])
    assert "OK" in capsys.readouterr().out
    (tmp_path / "a.zip.sha256").write_text("f" * 64 + "  a.zip\n")
    with pytest.raises(SystemExit):
        main(["handoff", "verify", str(tmp_path / "a.zip")])


# --------------------------------------------------------------------------- matching
def test_unit_and_address_normalisation() -> None:
    assert norm_unit("0807") == norm_unit("807") == norm_unit("Apt #807")
    assert norm_unit("PH-A") == "PHA"
    assert norm_addr("1 Knox Street, New York") == norm_addr("1 KNOX ST.")
    assert norm_addr("416 West 52nd Street") == norm_addr("416 W 52 St")


def test_index_never_joins_on_a_name_prefix() -> None:
    idx = Index(listings())
    L, method, amb = idx.match({"building": "The Knox", "unit": "6B"})
    assert L["id"] == "knox-6b" and method == "name+unit"
    L, _, _ = idx.match({"building": "The Kno", "unit": "6B"})
    assert L is None
    L, method, _ = idx.match({"address": "1 Knox Street", "unit": "807"})
    assert L["id"] == "knox-0807" and method == "address+unit"


# --------------------------------------------------------------------------- import rules
def test_null_never_clears_and_fills_unknowns(search: Path, tmp_path: Path) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-6b", "checked_at": "2026-10-12", "source": "https://example.com/s",
         "changes": {"price.gross": None, "sqft": 640, "price.fees_monthly": "$25"}}])
    res = import_updates(search, u, today=TODAY)
    L = by_id(search)["knox-6b"]
    assert L["price"]["gross"] == 5000 and L["sqft"] == 640 and L["price"]["fees_monthly"] == 25
    d = decisions(res, "knox-6b", "price.gross")[0]
    assert d.decision == REJECTED and "null" in d.reason
    assert L["checked"] == "2026-10-12" and "https://example.com/s" in L["sources"]
    assert L["claims"][-1]["from"] == "codex" and L["claims"][-1]["sqft"] == 640


def test_gone_listing_is_not_reactivated_by_an_older_claim(search: Path, tmp_path: Path) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-0807", "still_active": True, "checked_at": "2026-10-01", "source": "https://example.com/old"},
        {"id": "knox-tower-6b", "still_active": True, "source": "https://example.com/undated"}])
    res = import_updates(search, u, today=TODAY)
    assert by_id(search)["knox-0807"]["status"] == "gone"
    d = decisions(res, "knox-0807", "status")[0]
    assert d.decision == REJECTED and "cannot reactivate" in d.reason
    assert list((search / "handoff" / "conflicts").glob("knox-0807--status--*.json"))


def test_newer_active_claim_reactivates_with_conflict(search: Path, tmp_path: Path) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"building": "The Knox", "unit": "807", "address": "1 Knox Street", "still_active": True,
         "checked_at": "2026-10-12", "source": "https://example.com/new"}])
    res = import_updates(search, u, today=TODAY)
    assert by_id(search)["knox-0807"]["status"] == "researching"
    assert decisions(res, "knox-0807", "status")[0].decision == CONFLICT


def test_newer_value_wins_older_loses_and_both_keep_conflicts(search: Path, tmp_path: Path) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-6b", "checked_at": "2026-10-10", "source": "https://e.com/a", "changes": {"price.gross": 5150}},
        {"id": "knox-tower-6b", "checked_at": "2026-10-01", "source": "https://e.com/b",
         "changes": {"price.gross": 4500}}])
    res = import_updates(search, u, today=TODAY)
    Ls = by_id(search)
    assert Ls["knox-6b"]["price"]["gross"] == 5150 and Ls["knox-tower-6b"]["price"]["gross"] == 4900
    assert decisions(res, "knox-6b", "price.gross")[0].decision == CONFLICT
    assert decisions(res, "knox-tower-6b", "price.gross")[0].decision == REJECTED
    conflicts = sorted(p.name for p in (search / "handoff" / "conflicts").glob("*.json"))
    assert len(conflicts) == 2
    c = json.loads((search / "handoff" / "conflicts" / conflicts[0]).read_text())
    assert {"ours", "theirs", "source", "decision", "reason"} <= set(c)


def test_same_day_money_disagreement_keeps_the_less_favourable(search: Path, tmp_path: Path) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-6b", "checked_at": "2026-10-05", "source": "https://e.com/a",
         "changes": {"price.gross": 5200, "price.free_months": 2}}])
    res = import_updates(search, u, today=TODAY)
    p = by_id(search)["knox-6b"]["price"]
    assert p["gross"] == 5200 and p["free_months"] == 1
    assert decisions(res, "knox-6b", "price.gross")[0].decision == CONFLICT
    assert decisions(res, "knox-6b", "price.free_months")[0].decision == REJECTED


def test_workflow_generated_identity_and_sourceless_claims_are_rejected(search: Path, tmp_path: Path) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-6b", "checked_at": "2026-10-12", "source": "https://e.com/a",
         "changes": {"status": "shortlist", "score.overall": 99, "unit": "7C", "commute.Office.minutes": 3}},
        {"id": "knox-tower-6b", "changes": {"sqft": 700}},
        {"id": "does-not-exist", "source": "https://e.com", "changes": {"sqft": 1}}])
    res = import_updates(search, u, today=TODAY)
    L = by_id(search)["knox-6b"]
    assert L["status"] == "researching" and L["unit"] == "6B" and "score" not in L
    reasons = {d.field: d.reason for d in decisions(res, "knox-6b")}
    assert "renter" in reasons["status"] and "computed locally" in reasons["score.overall"]
    assert "identity" in reasons["unit"]
    assert [d.reason for d in res.decisions if d.claim == "u2"] == ["no source"]
    assert "no matching listing" in [d.reason for d in res.decisions if d.claim == "u3"][0]
    assert by_id(search)["knox-tower-6b"].get("sqft") is None


def test_new_units_reviews_notes_and_idempotent_reimport(search: Path, tmp_path: Path) -> None:
    u = write_updates(
        tmp_path / "u.json",
        new_units=[{"building": "Birch", "unit": "3C", "address": "7 Birch St", "price": {"gross": 4800},
                    "url": "https://example.com/birch-3c", "source": "https://example.com/birch-3c",
                    "checked_at": "2026-10-12"},
                   {"building": "The Knox", "unit": "0006B", "address": "1 Knox St", "sqft": 655,
                    "source": "https://example.com/k", "checked_at": "2026-10-12"},
                   {"building": "No Source", "unit": "1"}],
        reviews=[{"building": "The Knox", "label": "Google", "value": "4.2/5", "url": "https://g.example",
                  "checked_at": "2026-10-12"}],
        building_notes=[{"building": "The Knox", "note": "Lobby works until December.",
                         "source": "https://example.com/n", "checked_at": "2026-10-12"}])
    res = import_updates(search, u, today=TODAY)
    Ls = by_id(search)
    assert res.added == ["birch-3c"] and Ls["birch-3c"]["status"] == "new"
    assert Ls["birch-3c"]["sources"] == ["https://example.com/birch-3c"]
    assert Ls["knox-6b"]["sqft"] == 655          # 0006B matched the existing 6B, not a new listing
    assert {"label": "Google", "value": "4.2/5", "url": "https://g.example", "checked": "2026-10-12"} in \
        Ls["knox-0807"]["reviews"]["ratings"]
    assert "knox-tower-6b" not in {d.listing for d in res.decisions if d.claim == "r1"}
    note = (search / "research" / "the-knox-handoff-notes.md").read_text()
    assert "Lobby works until December." in note and "Source: https://example.com/n" in note
    assert [d.reason for d in res.decisions if d.claim == "n3"] == ["no source"]
    before = (search / "listings.json").read_bytes()
    again = import_updates(search, u, today=TODAY)
    assert (search / "listings.json").read_bytes() == before
    assert again.added == [] and again.changed == []
    assert (search / "research" / "the-knox-handoff-notes.md").read_text() == note


def test_dry_run_writes_nothing(search: Path, tmp_path: Path) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-6b", "checked_at": "2026-10-12", "source": "https://e.com", "changes": {"price.gross": 1}}],
        new_units=[{"building": "Birch", "unit": "1", "source": "https://e.com/b", "checked_at": "2026-10-12"}])
    snapshot = {p: p.read_bytes() for p in search.rglob("*") if p.is_file()}
    res = import_updates(search, u, dry_run=True, today=TODAY)
    assert res.dry_run and res.added == ["birch-1"] and not res.written
    assert {p: p.read_bytes() for p in search.rglob("*") if p.is_file()} == snapshot


def test_pack_round_trip_with_file_conflicts(search: Path, tmp_path: Path) -> None:
    """The other agent sends back a pack: our own data is a no-op; a changed note goes to conflicts/files."""
    other = tmp_path / "other"
    shutil.copytree(search, other)
    Ls = listings()
    Ls[2]["sqft"] = 610
    Ls[2]["checked"] = "2026-10-11"
    (other / "listings.json").write_text(json.dumps(Ls, indent=1))
    (other / "research" / "knox-6b.md").write_text("# Knox 6B\n\nTheir rewrite.\n")
    (other / "research" / "new-note.md").write_text("fresh")
    build_pack(other, tmp_path / "back.zip", to="claude", sender="codex", created="2026-10-13")
    res = import_updates(search, tmp_path / "back.zip", today=TODAY)
    assert by_id(search)["knox-tower-6b"]["sqft"] == 610
    assert res.changed == ["knox-tower-6b"]
    assert (search / "research" / "knox-6b.md").read_text() == "# Knox 6B\n\nOur note.\n"
    assert (search / "handoff" / "conflicts" / "files" / "research" / "knox-6b.md").read_text().endswith(
        "Their rewrite.\n")
    assert (search / "research" / "new-note.md").read_text() == "fresh"
    adj = list((search / "handoff" / "adjudications").glob("*.json"))
    assert len(adj) == 1 and json.loads(adj[0].read_text())["from"] == "codex"


def test_import_refuses_a_tampered_pack(search: Path, tmp_path: Path) -> None:
    pack(search, tmp_path / "p.zip")
    with zipfile.ZipFile(tmp_path / "p.zip", "a") as z:
        z.writestr("updates.json", json.dumps({"unit_updates": []}))
    before = (search / "listings.json").read_bytes()
    with pytest.raises(SystemExit, match="verification"):
        import_updates(search, tmp_path / "p.zip", today=TODAY)
    assert (search / "listings.json").read_bytes() == before


def test_claims_are_mirrored_into_the_history_log(search: Path, tmp_path: Path) -> None:
    pytest.importorskip("apartmentscout.quality.history")
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-6b", "still_active": False, "checked_at": "2026-10-12", "source": "https://e.com/gone",
         "changes": {"price.gross": 5050}}])
    import_updates(search, u, today=TODAY)
    lines = [json.loads(x) for x in (search / "history" / "claims.jsonl").read_text().splitlines()]
    fields = {(c["id"], c["field"], c["value"]) for c in lines}
    assert ("knox-6b", "status", "gone") in fields and ("knox-6b", "gross", 5050) in fields
    assert all(c["source_kind"] == "partner" and c["claimed_at"] == "2026-10-12" for c in lines)


def test_cli_import_prints_adjudication_table(search: Path, tmp_path: Path, capsys) -> None:
    u = write_updates(tmp_path / "u.json", unit_updates=[
        {"id": "knox-6b", "checked_at": "2026-10-12", "source": "https://e.com", "changes": {"sqft": 640}}])
    main(["handoff", "import", str(u), "--search", str(search), "--dry-run"])
    out = capsys.readouterr().out
    assert "| claim | listing | field | value | decision | reason |" in out
    assert "fills an unknown" in out and "Dry run" in out
    assert hashlib.sha256((search / "listings.json").read_bytes()).hexdigest() == \
        hashlib.sha256(json.dumps(listings(), indent=1).encode()).hexdigest()
