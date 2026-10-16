"""Static checks that keep the sync feature honest: the only code that talks to GitHub is one file, the token is never logged, the privacy
documentation names everything that is synced, and a Content Security Policy (if the site ever sets one) lets sync reach api.github.com only.
The behaviour itself is tested in tests/js/sync*.test.mjs and tests/e2e/test_device_sync.py.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYNC = ROOT / "dashboard" / "js" / "sync"
GUIDE = ROOT / "docs" / "guides" / "sync.md"


def sync_files() -> list[Path]:
    return sorted(SYNC.glob("*.js"))


def code(path: Path) -> str:
    """The file without comments, so a sentence about a host is not mistaken for a call to it."""
    text = path.read_text()
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return "\n".join(re.sub(r"(^|\s)//.*$", "", line) for line in text.splitlines())


def test_only_the_gist_client_makes_network_calls() -> None:
    callers = [p.name for p in sync_files() if p.name != "gist-client.js" and re.search(r"\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource", code(p))]
    assert callers == [], f"network calls outside the gist client: {callers}"
    client = code(SYNC / "gist-client.js")
    assert "https://api.github.com" in client and not re.search(r"https?://(?!api\.github\.com|github\.com/settings|gist\.github\.com)", client.replace("w3.org", "")), "the client contacts api.github.com only"


def test_no_other_dashboard_code_mentions_the_github_api() -> None:
    hits = [str(p.relative_to(ROOT)) for p in (ROOT / "dashboard" / "js").rglob("*.js") if "api.github.com" in code(p) and p.parent != SYNC]
    assert hits == [], hits


def test_the_token_is_never_logged_or_put_in_a_url() -> None:
    for p in sync_files():
        for line in code(p).splitlines():
            if re.search(r"console\.", line):
                assert not re.search(r"token", line, re.I), f"{p.name}: a log line that could carry the token: {line.strip()}"
    client = code(SYNC / "gist-client.js")
    assert "?token" not in client and "access_token" not in client and "token=" not in client
    # the token is read in exactly one place, and only the sync layer may read it
    readers = [p.name for p in (ROOT / "dashboard" / "js").rglob("*.js") if "as:sync.token" in p.read_text() or "getToken" in code(p)]
    assert set(readers) <= {"sync-store.js", "engine.js"}, readers


def test_the_token_key_is_not_a_synced_key_and_survives_a_reset() -> None:
    model = (SYNC / "sync-model.js").read_text()
    assert "sync" not in re.findall(r"re: /\^\(?([a-z-]+)", model), "no rule matches the sync keys"
    html = (ROOT / "dashboard" / "index.html").read_text()
    assert re.search(r"var KEEP = /\^as:\([^\n]*sync\\\.\(config\|token\)", html), "the start-up recovery reset keeps the connection"


def test_a_content_security_policy_if_any_allows_only_api_github_com_for_sync() -> None:
    sources = [ROOT / "dashboard" / "index.html", *ROOT.joinpath("apartmentscout").rglob("localapi.py"), ROOT / "dashboard" / "sw.js"]
    for p in sources:
        for m in re.finditer(r"Content-Security-Policy[^\n]*", p.read_text(), re.I):
            policy = m.group(0)
            if "connect-src" in policy:
                assert "https://api.github.com" in policy, f"{p.name}: connect-src must allow api.github.com for sync: {policy[:200]}"
                assert not re.search(r"connect-src[^;]*\*(?!\.)", policy), "no wildcard hosts"


def test_the_guide_names_everything_that_is_synced_and_how_to_set_it_up() -> None:
    guide = GUIDE.read_text()
    model = (SYNC / "sync-model.js").read_text()
    prefixes: set[str] = set()
    for m in re.finditer(r"re: /\^\(?([^/]+?)\)?/", model):
        for alt in m.group(1).split("|"):
            alt = alt.replace("\\", "").replace("$", "").strip("()")
            if alt:
                prefixes.add(alt)
    assert len(prefixes) >= 20, prefixes
    missing = sorted(p for p in prefixes if p not in guide)
    assert missing == [], f"storage keys that sync but are not in the guide: {missing}"
    for phrase in ("secret", "unlisted", "api.github.com", "Gists", "Read and write", "iPhone", "Add to Home Screen", "tombstone", "Sync file", "apartmentscout serve", "never synced"):
        assert phrase.lower() in guide.lower(), phrase
    assert "docs/guides/sync.md" in (ROOT / "README.md").read_text(), "the README's privacy notes point to the guide"


def test_sync_sources_hold_no_local_paths_or_secrets() -> None:
    for p in [*sync_files(), GUIDE, ROOT / "tests" / "e2e" / "fake_github.py"]:
        text = p.read_text()
        assert "/Users/" not in text and not re.search(r"ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}", text), p.name
