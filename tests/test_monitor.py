"""apartmentscout monitor: page readings, host policy, cache, digest and history claims. Fixtures only, no network."""
import datetime as dt
import json

import pytest
import yaml

from apartmentscout.cli import main
from apartmentscout.config import DEFAULT_WEIGHTS, Workspace
from apartmentscout.quality.history import history_doc, read_claims
from apartmentscout.quality.monitor import (Fetched, HostBlocked, HttpFetcher, PageError, apply_to_listings, digest_export,
                                            extract_observation, host_policy, plan_targets, read_observations, run_monitor)
from apartmentscout.quality.workspace import load_listings

TODAY = dt.date(2026, 10, 14)
NOW = dt.datetime(2026, 10, 14, 9, 0, 0)

UNIT_PAGE = """<html><head><title>Residence 12B | The Example Tower</title>
<script type="application/ld+json">{"@type": "Apartment", "offers": {"@type": "Offer", "price": "4,950", "priceCurrency": "USD",
 "availability": "https://schema.org/InStock"}}</script></head>
<body><h1>12B</h1><p>One bedroom. Available October 15. 1 month free on a 13-month lease. Security deposit $4,950.</p></body></html>"""

TEXT_PAGE = """<html><head><title>12B - Example Tower</title></head><body><h1>Unit 12B</h1>
<p>Rent: $4,800 per month. Application fee $20. Two months free on a 18-month lease. Net effective rent $4,267.</p>
<p>Available now.</p></body></html>"""

GONE_PAGE = """<html><head><title>12B - no longer available | Example Tower</title></head><body><p>This unit is no longer available.</p></body></html>"""

BUILDING_PAGE = """<html><body><h1>Availability</h1>
<ul><li>Unit 4A - 1 bed - $4,500/mo - available Nov 1</li>
<li>Unit 12B - 1 bed - $4,700/mo - available now</li>
<li>Unit 15C - 2 bed - $6,900/mo</li></ul></body></html>"""

NO_UNIT_PAGE = "<html><body><ul><li>Unit 4A - $4,500/mo</li><li>Unit 15C - $6,900/mo</li></ul></body></html>"
MANY_PRICES = "<html><body><p>Studios from $3,900/mo. One-bedrooms from $4,800/mo. Two-bedrooms from $6,900/mo.</p></body></html>"

CRIT = {"search": {"name": "Test", "move_in": {"earliest": "2026-10-15", "latest": "2026-11-01"}, "map_center": [40.75, -73.98]},
        "budget": {"tiers": [{"name": "Target", "max": 5000}], "hard_max": 5450}, "unit": {"min_beds": 1},
        "must_have": [], "commute": {"destinations": []}, "weights": dict(DEFAULT_WEIGHTS),
        "watchlist": [{"name": "The Example Tower", "address": "1 Example St, New York, NY", "url": "https://example-tower.test/availability"}]}


def L(id, unit, url, **kw):
    base = {"id": id, "building": "The Example Tower", "unit": unit, "address": "1 Example St, New York, NY", "status": "researching",
            "checked": "2026-10-01", "price": {"gross": 4950, "free_months": 1, "lease_months": 13},
            "available": "2026-10-15", "links": {"listing": url}, "amenities": {}}
    base.update(kw)
    return base


def search(tmp_path, listings, crit=CRIT):
    root = tmp_path / "s"
    root.mkdir(exist_ok=True)
    (root / "criteria.yaml").write_text(yaml.safe_dump(crit))
    (root / "listings.json").write_text(json.dumps(listings))
    return root


class FakePages:
    """A fetcher over a dict of URL -> HTML (or an exception to raise); counts the calls."""

    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def __call__(self, url):
        self.calls.append(url)
        page = self.pages[url]
        if isinstance(page, Exception):
            raise page
        return Fetched(url, 200, page)


# --------------------------------------------------------------------------- reading a page
def test_jsonld_unit_page():
    obs = extract_observation(UNIT_PAGE, "https://example-tower.test/units/12b", TODAY, "12B")
    assert obs["gross"] == 4950 and obs["status"] == "active" and obs["method"] == "jsonld"
    assert obs["free_months"] == 1 and obs["lease_months"] == 13 and obs["available"] == "2026-10-15"
    assert "net" not in obs                                      # the $4,950 deposit is not a rent


def test_text_page_reads_rent_concession_net_and_start():
    obs = extract_observation(TEXT_PAGE, "https://example-tower.test/units/12b", TODAY, "12B")
    assert obs["gross"] == 4800 and obs["net"] == 4267 and obs["free_months"] == 2 and obs["lease_months"] == 18
    assert obs["available"] == "now" and obs["status"] == "active"


def test_gone_page_and_http_404():
    assert extract_observation(GONE_PAGE, "https://example-tower.test/units/12b", TODAY, "12B")["status"] == "gone"


def test_building_page_uses_only_the_text_around_the_unit():
    obs = extract_observation(BUILDING_PAGE, "https://example-tower.test/availability", TODAY, "12B")
    assert obs["gross"] == 4700 and obs["available"] == "now"
    missing = extract_observation(NO_UNIT_PAGE, "https://example-tower.test/availability", TODAY, "12B")
    assert missing["status"] == "unclear" and "gross" not in missing     # a unit missing from a page is not gone


def test_unrelated_prices_give_no_price():
    obs = extract_observation(MANY_PRICES, "https://example-tower.test/units/12b", TODAY, "12B")
    assert "gross" not in obs and "several different prices" in obs["note"]


# --------------------------------------------------------------------------- targets and host policy
def test_targets_are_the_active_watchlist_units_and_portals_need_an_explicit_allow():
    ls = [L("t-12b", "12B", "https://example-tower.test/units/12b"),
          L("t-9a", "9A", "https://streeteasy.com/building/x/9a"),
          L("t-gone", "3C", "https://example-tower.test/units/3c", status="gone")]
    targets, entries, note = plan_targets(ls, CRIT, today=TODAY)
    assert note is None and [t.id for t in targets] == ["t-12b", "t-9a"]
    allowed, need = host_policy(CRIT, (), entries)
    assert "example-tower.test" in allowed and "streeteasy.com" not in allowed and "streeteasy.com" in need
    allowed2, _ = host_policy(CRIT, ["streeteasy.com"], entries)
    assert "streeteasy.com" in allowed2
    none, _, note = plan_targets(ls, {**CRIT, "watchlist": []}, today=TODAY)
    assert none == [] and "watchlist is empty" in note
    by_id, _, _ = plan_targets(ls, {**CRIT, "watchlist": []}, ids=["t-9a"], today=TODAY)
    assert [t.id for t in by_id] == ["t-9a"]


# --------------------------------------------------------------------------- a run
def run(root, ls, fetch, **kw):
    crit = kw.pop("crit", CRIT)
    now = kw.pop("now", NOW)
    targets, entries, note = plan_targets(ls, crit, today=now.date())
    return run_monitor(root, ls, crit, targets, fetch, today=now.date(), entries=entries, now=now, note=note, **kw)


def test_price_drop_is_found_recorded_and_reaches_history(tmp_path):
    ls = [L("t-12b", "12B", "https://example-tower.test/units/12b")]
    root = search(tmp_path, ls)
    fetch = FakePages({"https://example-tower.test/units/12b": TEXT_PAGE})
    res = run(root, ls, fetch)
    d = res.digest
    assert d["run"]["fetched"] == 1 and d["counts"]["price"] >= 1
    price = next(c for c in d["changes"] if c["type"] == "price" and c["field"] == "gross")
    assert (price["from"], price["to"], price["id"]) == (4950, 4800, "t-12b")
    root_files = {p.name for p in (root / "history" / "monitor").iterdir()}
    assert {"observations.jsonl", "cache", "digests", "digest.json"} <= root_files
    assert (root / "history" / "monitor" / "digests" / "2026-10-14.md").read_text().startswith("# Monitor digest, 2026-10-14")
    claims = read_claims(root)
    assert any(c["field"] == "gross" and c["value"] == 4800 and c["source_kind"] == "unit_page" and c["claimed_at"] == "2026-10-14"
               for c in claims)
    assert read_observations(root)[0]["observation"]["gross"] == 4800
    # a second run inside the cache window does not fetch, does not repeat claims or readings
    fetch2 = FakePages({})
    res2 = run(root, ls, fetch2, now=NOW + dt.timedelta(hours=2))
    assert fetch2.calls == [] and res2.digest["run"]["from_cache"] == 1
    assert len(read_claims(root)) == len(claims) and len(read_observations(root)) == 1


def test_second_reading_compares_with_the_first_and_feeds_the_price_history(tmp_path):
    ls = [L("t-12b", "12B", "https://example-tower.test/units/12b")]
    root = search(tmp_path, ls)
    run(root, ls, FakePages({"https://example-tower.test/units/12b": TEXT_PAGE}))
    cheaper = TEXT_PAGE.replace("$4,800", "$4,650")
    res = run(root, ls, FakePages({"https://example-tower.test/units/12b": cheaper}), now=NOW + dt.timedelta(days=1), refresh=True)
    gross = next(c for c in res.digest["changes"] if c["field"] == "gross")
    assert (gross["from"], gross["to"]) == (4800, 4650)
    ws = Workspace(root)
    doc = history_doc(root, load_listings(ws), CRIT, today="2026-10-16")
    pts = doc["price_history"]["t-12b"]
    assert [p["gross"] for p in pts if p["gross"]][-2:] == [4800, 4650]
    # --since compares with the reading on or before that day
    res3 = run(root, ls, FakePages({}), now=NOW + dt.timedelta(days=1, hours=1), since="2026-10-14", offline=True)
    assert any(c["field"] == "gross" and c["from"] == 4800 for c in res3.digest["changes"])


def test_gone_page_is_a_gone_event_and_a_claim(tmp_path):
    ls = [L("t-12b", "12B", "https://example-tower.test/units/12b")]
    root = search(tmp_path, ls)
    res = run(root, ls, FakePages({"https://example-tower.test/units/12b": GONE_PAGE}))
    assert res.digest["counts"] == {"gone": 1}
    assert any(c["field"] == "status" and c["value"] == "gone" for c in read_claims(root))


def test_portal_is_skipped_blocked_host_stops_and_is_reported(tmp_path):
    ls = [L("t-1", "1A", "https://example-tower.test/units/1a"), L("t-2", "2A", "https://example-tower.test/units/2a"),
          L("t-9", "9A", "https://streeteasy.com/building/x/9a", building="Portal Tower", address="2 Portal St, New York, NY")]
    crit = {**CRIT, "watchlist": CRIT["watchlist"] + [{"name": "Portal Tower", "address": "2 Portal St, New York, NY",
                                                       "url": "https://streeteasy.com/building/x"}]}
    root = search(tmp_path, ls, crit)
    fetch = FakePages({"https://example-tower.test/units/1a": HostBlocked("HTTP 403: bot check or block")})
    res = run(root, ls, fetch, crit=crit)
    assert fetch.calls == ["https://example-tower.test/units/1a"]                 # the second page of a blocked host is never asked for
    d = res.digest
    assert d["blocked_hosts"] == {"example-tower.test": "HTTP 403: bot check or block"}
    reasons = {s["id"]: s["reason"] for s in d["skipped"]}
    assert "bot check" in reasons["t-1"] and "host blocked" in reasons["t-2"] and "portal" in reasons["t-9"]
    # the block is cached: the next run does not try the host again
    fetch2 = FakePages({})
    run(root, ls, fetch2, now=NOW + dt.timedelta(hours=1), crit=crit)
    assert fetch2.calls == []


def test_unreadable_pages_are_reported_not_guessed(tmp_path):
    ls = [L("t-1", "1A", "https://example-tower.test/units/1a"), L("t-2", "2A", "https://example-tower.test/units/2a")]
    root = search(tmp_path, ls)
    res = run(root, ls, FakePages({"https://example-tower.test/units/1a": PageError("HTTP 500"),
                                   "https://example-tower.test/units/2a": "<html><body>Welcome</body></html>"}))
    assert {u["id"] for u in res.digest["unreadable"]} == {"t-1", "t-2"} and res.digest["changes"] == []


def test_dry_run_fetches_and_writes_nothing(tmp_path):
    ls = [L("t-12b", "12B", "https://example-tower.test/units/12b")]
    root = search(tmp_path, ls)
    fetch = FakePages({"https://example-tower.test/units/12b": TEXT_PAGE})
    res = run(root, ls, fetch, dry_run=True)
    assert fetch.calls == [] and res.digest["run"]["dry_run"] and res.digest["skipped"][0]["reason"].startswith("no cached reading")
    assert not (root / "history").exists()


def test_apply_updates_the_listing_but_never_revives(tmp_path):
    live = L("t-12b", "12B", "https://example-tower.test/units/12b")
    dead = L("t-3", "3C", "https://example-tower.test/units/3c", status="gone")
    res = run(search(tmp_path, [live, dead]), [live, dead],
              FakePages({"https://example-tower.test/units/12b": TEXT_PAGE}), write=False)
    ls = [live, dead]
    assert apply_to_listings(ls, res.looks, TODAY) == 1
    assert live["price"]["gross"] == 4800 and live["price"]["basis"] == "unit_page" and live["checked"] == "2026-10-14"
    revive = [{"id": "t-3", "status": "ok", "observation": {"gross": 4000, "status": "active"}}]
    apply_to_listings(ls, revive, TODAY)
    assert dead["status"] == "gone"


# --------------------------------------------------------------------------- fetcher and CLI
class FakeResponse:
    def __init__(self, status=200, text="", ctype="text/html"):
        self.status_code, self.text, self.headers = status, text, {"Content-Type": ctype}


class FakeSession:
    def __init__(self, routes):
        self.routes, self.headers, self.calls = routes, {}, []

    def get(self, url, **kw):
        self.calls.append(url)
        return self.routes[url]


def test_http_fetcher_stops_at_a_bot_check_and_obeys_robots():
    s = FakeSession({"https://a.test/robots.txt": FakeResponse(200, "User-agent: *\nDisallow: /private\n"),
                     "https://a.test/ok": FakeResponse(200, "<html>ok</html>"),
                     "https://a.test/private/x": FakeResponse(200, "secret"),
                     "https://b.test/robots.txt": FakeResponse(404, ""),
                     "https://b.test/wall": FakeResponse(403, "Access denied"),
                     "https://b.test/next": FakeResponse(200, "never asked")})
    f = HttpFetcher(pause=0, session=s)
    assert f("https://a.test/ok").text == "<html>ok</html>"
    with pytest.raises(HostBlocked, match="robots"):
        f("https://a.test/private/x")
    assert "https://a.test/private/x" not in s.calls
    with pytest.raises(HostBlocked, match="403"):
        f("https://b.test/wall")
    with pytest.raises(HostBlocked):
        f("https://b.test/next")
    assert "https://b.test/next" not in s.calls


def test_cli_dry_run_offline_and_digest_export(tmp_path, capsys):
    ls = [L("t-12b", "12B", "https://example-tower.test/units/12b")]
    root = search(tmp_path, ls)
    main(["monitor", "--search", str(root), "--dry-run", "--as-of", "2026-10-14"])
    out = capsys.readouterr().out
    assert "Dry run: 1 page(s) planned" in out and "t-12b" in out
    assert not (root / "history").exists()
    stub = digest_export(root, "2026-10-14")
    assert stub["run"] is None and stub["changes"] == []
    # seed a cache by running with the fake fetcher, then replay it offline through the CLI
    run(root, ls, FakePages({"https://example-tower.test/units/12b": TEXT_PAGE}), now=dt.datetime.now().replace(microsecond=0))
    main(["monitor", "--search", str(root), "--offline", "--json", "--as-of", "2026-10-14"])
    d = json.loads(capsys.readouterr().out)
    assert d["run"]["offline"] and d["run"]["from_cache"] == 1
    assert digest_export(root)["changes"]


def test_export_writes_digest_json(tmp_path):
    from apartmentscout.exports import digest as exp
    root = search(tmp_path, [L("t-12b", "12B", "https://example-tower.test/units/12b")])
    out = tmp_path / "out"
    out.mkdir()
    assert exp.export(Workspace(root), out) == ["digest.json"]
    assert json.loads((out / "digest.json").read_text())["changes"] == []
