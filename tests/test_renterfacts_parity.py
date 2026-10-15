"""The dashboard's browser-side re-scoring of a renter's typed values (dashboard/js/features/facts-model.js) against the scorer
(apartmentscout/score.py reading renterfacts.py), on the committed example's own listings.

Python scores the whole example with the facts supplied; node applies the same facts to each listing's stored score. The
dimensions the facts touch, eligibility, the gates the facts can change and the monthly cost must agree."""
from __future__ import annotations

import copy
import datetime as dt
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from apartmentscout.score import score_all

ROOT = Path(__file__).resolve().parents[1]
node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
DATA = ROOT / "dashboard" / "data"
LISTINGS = json.loads((DATA / "listings.json").read_text())
CRIT = json.loads((DATA / "criteria.json").read_text())
TODAY = dt.date.fromisoformat((CRIT.get("scoring") or {}).get("as_of") or json.loads((DATA / "manifest.json").read_text())["generated"][:10])
TOLERANCE = 0.15            # the browser rounds each recomputed part to a tenth, the scorer rounds the final numbers
MONEY_TOLERANCE = 1.01      # fee estimates are whole dollars on one side


def cases() -> dict[str, dict]:
    out: dict[str, dict] = {}

    def add(pred, n, facts):
        k = 0
        for L in LISTINGS:
            if k >= n:
                break
            if L["id"] not in out and pred(L):
                out[L["id"]] = facts(k) if callable(facts) else facts
                k += 1

    add(lambda x: "size_imputed" in x["score"]["flags"], 5, {"size": 480})
    add(lambda x: "size_estimated" in x["score"]["flags"] and "size_imputed" not in x["score"]["flags"], 3, {"size": 910})
    add(lambda x: x["score"]["cost"].get("fees_known") is False, 6, lambda k: {"fees": (0, 240)[k % 2]})
    add(lambda x: "price_dispute" in x["score"]["gates"], 4, {"price": 4300})
    add(lambda x: "price_unverified" in x["score"]["flags"], 4, {"price": 4100})
    add(lambda x: any(g.startswith("unverified:") and "in_unit_wd" in g for g in x["score"]["gates"]), 6, lambda k: {"wd": bool(k % 2)})
    add(lambda x: "light_hint" in x["score"] and not (x.get("site") or {}).get("sun_hours"), 8, lambda k: {"floor": (2, 14, 40, 7)[k % 4]})
    add(lambda x: x["score"]["cost"].get("fees_known") is False and "price_unverified" in x["score"]["flags"], 3, {"fees": 180, "price": 4650})
    return out


def python_scores(cs: dict[str, dict]) -> dict[str, dict]:
    Ls = copy.deepcopy(LISTINGS)
    for L in Ls:
        for k in ("score",):
            L.pop(k, None)
    facts = {i: {k: {"value": v} for k, v in f.items()} for i, f in cs.items()}
    # the example's tour findings are not part of this comparison: the baked scores already hold none (the folder has no tours/)
    score_all(Ls, copy.deepcopy(CRIT), today=TODAY, facts=facts)
    return {L["id"]: L["score"] for L in Ls if L["id"] in cs}


@node
def test_the_browser_rescoring_matches_the_scorer(tmp_path):
    cs = cases()
    assert len(cs) >= 25, "the example should offer a case for each kind of unknown"
    f = tmp_path / "cases.json"
    f.write_text(json.dumps(cs))
    js = json.loads(subprocess.run(["node", "tests/js/emit-facts-cases.mjs", str(f)], cwd=ROOT, capture_output=True, text=True, check=True, timeout=120).stdout)
    py = python_scores(cs)
    touched = {"size": ["space"], "fees": ["cost"], "price": ["cost", "renewal_risk"], "wd": ["amenities"], "floor": ["light_view"]}
    bad = []
    for lid, facts in cs.items():
        a, b = py[lid], js[lid]
        assert sorted(b["renter"]) == sorted(facts) == sorted(a["renter"]), lid
        for kind in facts:
            for dim in touched[kind]:
                x, y = a["parts"].get(dim), b["parts"].get(dim)
                if (x is None) != (y is None) or (x is not None and abs(x - y) > TOLERANCE):
                    bad.append(f"{lid} {kind}: {dim} scorer {x} browser {y}")
        if abs((a["overall"] or 0) - (b["overall"] or 0)) > TOLERANCE:
            bad.append(f"{lid} {facts}: overall scorer {a['overall']} browser {b['overall']}")
        if a["eligible"] != b["eligible"]:
            bad.append(f"{lid} {facts}: eligible scorer {a['eligible']} browser {b['eligible']}")
        mine = {"price_dispute", "unverified:price", "unverified:fees", "unverified:lease_term", "over_budget"}
        ga = {g for g in a["gates"] if g in mine or g.startswith(("fails:", "unverified:in_unit"))}
        gb = {g for g in b["gates"] if g in mine or g.startswith(("fails:", "unverified:in_unit"))}
        if ga != gb:
            bad.append(f"{lid} {facts}: gates scorer {sorted(ga)} browser {sorted(gb)}")
        if a["monthly_cost"] is not None and b["monthly_cost"] is not None and abs(a["monthly_cost"] - b["monthly_cost"]) > MONEY_TOLERANCE:
            bad.append(f"{lid} {facts}: monthly cost scorer {a['monthly_cost']} browser {b['monthly_cost']}")
    assert not bad, "\n".join(bad)
