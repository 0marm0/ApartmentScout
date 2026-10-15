"""The bundled NYC example: price provenance and the backfilled history (real, dated, cited) hold together."""
import json
import re
from pathlib import Path

import pytest

from apartmentscout.config import Workspace
from apartmentscout.listings import PRICE_BASES, price_basis, price_unverified
from apartmentscout.quality.history import claim_date, history_doc, read_claims
from apartmentscout.quality.workspace import load_listings

ROOT = Path(__file__).resolve().parents[1] / "examples" / "nyc-2026"
pytestmark = pytest.mark.skipif(not (ROOT / "history" / "claims.jsonl").exists(), reason="example history not present")


@pytest.fixture(scope="module")
def ws():
    return Workspace(ROOT)


@pytest.fixture(scope="module")
def listings(ws):
    return load_listings(ws)


def test_every_claim_is_dated_cited_and_local(ws, listings):
    claims = read_claims(ROOT)
    ids = {L["id"] for L in listings}
    assert len(claims) > 200
    for c in claims:
        assert c["id"] in ids
        assert c["source"] and not re.search(r"/Users/|^[A-Za-z]:\\|^/", c["source"]), c      # relative citations only
        assert c["claimed_at"] and c["received_at"] and c["claimed_at"] <= c["received_at"], c
        assert claim_date(c).isoformat() <= "2026-10-14"


def test_history_has_real_price_series_and_no_false_disputes(ws, listings):
    doc = history_doc(ROOT, listings, ws.criteria(), today="2026-10-14")
    assert len(doc["price_history"]) >= 40
    byid = {L["id"]: L for L in listings}
    for lid, pts in doc["price_history"].items():
        assert [p["date"] for p in pts] == sorted(p["date"] for p in pts)
        assert all(p["source"] for p in pts)
    # a few series checked against the research record
    assert [p["gross"] for p in doc["price_history"]["the-lewis-10f"]] == [4980, 4835]
    assert [p["gross"] for p in doc["price_history"]["lana-condominium-11l"]] == [4700, 4900, 4975]
    assert [p["gross"] for p in doc["price_history"]["the-max-621"]][-3:] == [5085, 4995, 5085]
    # the only status disputes are real contradictions in the record: gone on one date, shown for rent by an independent check later
    disputes = {i: a for i, a in doc["availability"].items() if a["state"] == "status_dispute"}
    assert set(disputes) <= {"hollingsworth-1002", "hollingsworth-706", "hollingsworth-616"}
    assert all("said active" in a["reason"] for a in disputes.values())
    assert doc["summary"]["median_days_to_gone"] is not None
    assert byid["the-corinthian-9i"]["status"] != "gone"        # status is the renter's; the ladder reads the 10/8 claim instead
    assert doc["availability"]["the-corinthian-9i"]["state"] == "gone"


def test_weak_prices_are_marked_and_the_24d_case_is_fixed(listings):
    byid = {L["id"]: L for L in listings}
    for L in listings:
        b = (L.get("price") or {}).get("basis")
        if b is not None:
            assert price_basis(L) in PRICE_BASES, (L["id"], b)
            assert (L["price"].get("source") or "").strip(), L["id"]
    L = byid["emerald-green-24d"]
    assert price_unverified(L) and L["price"].get("net_effective") is None and L["price"]["range"] == [4318, 4652]
    cost = L["score"]["cost"]
    assert cost["rent"]["basis"] == "gross" and cost["monthly"] == 4652
    assert "unverified:price" in L["score"]["gates"]
    assert L["score"]["cost"]["monthly_expected"] >= 4652
    # a net with a stated term stays a net
    assert byid["the-max-621"]["score"]["cost"]["rent"]["net"] == pytest.approx(4661.25)
    # no active listing carries a net above its gross or a free month without a stated term unless the source gave none
    for L in listings:
        p = L.get("price") or {}
        if p.get("gross") and p.get("net_effective"):
            assert p["net_effective"] <= p["gross"] + 1, L["id"]


def test_no_absolute_paths_in_example_data():
    for name in ("listings.json", "history/claims.jsonl"):
        assert "/Users/" not in (ROOT / name).read_text(encoding="utf-8"), name
