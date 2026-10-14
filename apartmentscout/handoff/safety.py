"""Spreadsheet formula-injection guard and default privacy patterns.

A spreadsheet treats a cell that starts with ``=``, ``+``, ``-`` or ``@`` as a formula, so a listing named
``=HYPERLINK("http://evil","click")`` would run when the export is opened. Every text cell we write (xlsx and
csv) goes through :func:`safe_text`, which prefixes such strings with an apostrophe so they stay text. Tab and
carriage return are guarded too (OWASP CSV-injection guidance). Numbers are never altered.
"""
from __future__ import annotations

import re
from typing import Any

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_text(value: str) -> str:
    """Return ``value`` with a leading apostrophe if a spreadsheet would read it as a formula."""
    if value and value[0] in FORMULA_PREFIXES:
        return "'" + value
    return value


def safe_cell(value: Any) -> Any:
    """Guard strings; pass numbers, booleans, dates and None through unchanged."""
    return safe_text(value) if isinstance(value, str) else value


# Safe defaults for privacy scans: local home-directory paths and e-mail addresses. Owner-specific strings (names,
# employer, office address) never live in the repo; pass them in a pattern file outside it (see
# scripts/release_check.py and docs/RELEASE_CHECKLIST.md).
DEFAULT_PRIVACY_PATTERNS: tuple[tuple[str, str], ...] = (
    ("local-path", r"/Users/[A-Za-z0-9._-]+"),
    ("local-path", r"/home/[a-z][a-z0-9._-]+/"),
    ("local-path", r"[A-Za-z]:\\Users\\[A-Za-z0-9._-]+"),
    # the look-behind starts a match only at the head of a run, so long base64 blobs scan in linear time
    ("email", r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
)

# Addresses that are fine to publish: documentation placeholders and bot/no-reply senders.
EMAIL_ALLOW = re.compile(
    r"@(?:example\.(?:com|org|net)|[a-z0-9.-]*noreply[a-z0-9.-]*|users\.noreply\.github\.com)$|^(?:git|noreply)@",
    re.I)


def compile_patterns(extra: list[tuple[str, str]] | None = None) -> list[tuple[str, re.Pattern[str]]]:
    return [(name, re.compile(rx)) for name, rx in (*DEFAULT_PRIVACY_PATTERNS, *(extra or []))]


def privacy_hits(text: str, patterns: list[tuple[str, re.Pattern[str]]]) -> list[tuple[str, str]]:
    """(pattern name, matched text) for every hit, with allow-listed e-mail addresses removed."""
    out: list[tuple[str, str]] = []
    for name, rx in patterns:
        for m in rx.finditer(text):
            hit = m.group(0)
            if name == "email" and (EMAIL_ALLOW.search(hit) or _looks_like_asset(hit)):
                continue
            out.append((name, hit))
    return out


def _looks_like_asset(hit: str) -> bool:
    """`icon@2x.png`, `three@0.160.0`-style package pins and retina asset names are not e-mail addresses."""
    tail = hit.rsplit(".", 1)[-1].lower()
    return tail in {"png", "jpg", "jpeg", "svg", "webp", "gif", "js", "mjs", "css", "json"} or bool(
        re.search(r"@\d", hit))
