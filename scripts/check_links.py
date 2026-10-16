#!/usr/bin/env python3
"""Checks every link and image in the README, the guides, the landing page and the other Markdown files.

    python scripts/check_links.py            # local files and anchors, then external URLs
    python scripts/check_links.py --offline  # only the local part (what CI can rely on)

* A relative link must name a file or folder that exists; a `#fragment` on a Markdown file must match one of its headings
  (GitHub's slug rules), on an HTML file one of its ids.
* A link into this repository on GitHub (`.../blob/main/<path>`, `.../tree/main/<path>`) is checked against the working tree, so a
  link to a file that is not merged yet is still judged correctly. The landing page's `__REPO__` and `__SITE__` placeholders are
  filled in with the real addresses first.
* An external URL must answer 200 to 399. 401, 403, 429 and 999 are reported as "blocked" (the site refuses scripts, so the link is
  probably fine) and do not fail the run. Links to localhost, example domains and `mailto:` are skipped.

Exit status 1 when a local link is broken or an external URL answers 404, 410 or 5xx or cannot be reached.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import html
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://github.com/0marm0/ApartmentScout"
SITE = "https://0marm0.github.io/ApartmentScout"
SKIP_HOSTS = {"localhost", "127.0.0.1", "example.com", "www.example.com", "example.org"}
BLOCKED = {401, 403, 429, 999}
UA = "Mozilla/5.0 (compatible; ApartmentScout-link-check/1.0; +https://github.com/0marm0/ApartmentScout)"


def sources() -> list[Path]:
    out = [p for p in sorted(ROOT.glob("*.md"))]
    out += sorted((ROOT / "docs").rglob("*.md"))
    out += sorted((ROOT / ".github").rglob("*.md"))
    out += sorted((ROOT / ".claude" / "skills").glob("*/SKILL.md"))
    out += [ROOT / "landing" / "index.html", ROOT / "landing" / "README.md"]
    return [p for p in out if p.is_file() and "node_modules" not in p.parts]


def slug(heading: str) -> str:
    """GitHub's heading anchor: lower case, markup and punctuation dropped, spaces to hyphens."""
    t = re.sub(r"<[^>]+>", "", heading)
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = html.unescape(t).strip().lower().replace("`", "")
    t = re.sub(r"[^\w\- ]", "", t, flags=re.UNICODE)
    return t.replace(" ", "-")


_anchor_cache: dict[Path, set[str]] = {}


def anchors(path: Path) -> set[str]:
    if path not in _anchor_cache:
        text = path.read_text(encoding="utf-8", errors="replace")
        found: set[str] = set(re.findall(r"""\bid=["']([^"']+)["']""", text)) | set(re.findall(r"""<a\s+name=["']([^"']+)["']""", text))
        if path.suffix == ".md":
            seen: dict[str, int] = {}
            in_code = False
            for line in text.splitlines():
                if line.lstrip().startswith("```"):
                    in_code = not in_code
                m = None if in_code else re.match(r"^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$", line)
                if m:
                    s = slug(m.group(1))
                    n = seen.get(s, 0)
                    seen[s] = n + 1
                    found.add(s if n == 0 else f"{s}-{n}")
        _anchor_cache[path] = found
    return _anchor_cache[path]


def links(path: Path) -> list[tuple[int, str]]:
    """(line, target) for every link, image and srcset entry; fenced and inline code are skipped in Markdown."""
    text = path.read_text(encoding="utf-8", errors="replace")
    out: list[tuple[int, str]] = []
    if path.suffix == ".md":
        text = re.sub(r"```.*?```", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
        text = re.sub(r"`[^`\n]*`", "", text)
        for m in re.finditer(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)", text):
            out.append((text.count("\n", 0, m.start()) + 1, m.group(1)))
        for m in re.finditer(r"^\[[^\]]+\]:\s*(\S+)", text, re.M):
            out.append((text.count("\n", 0, m.start()) + 1, m.group(1)))
    for m in re.finditer(r"""\b(?:href|src|poster)=["']([^"']+)["']""", text):
        out.append((text.count("\n", 0, m.start()) + 1, html.unescape(m.group(1))))
    for m in re.finditer(r"""\bsrcset=["']([^"']+)["']""", text):
        for part in m.group(1).split(","):
            if part.strip():
                out.append((text.count("\n", 0, m.start()) + 1, part.strip().split()[0]))
    for m in re.finditer(r"""<(?:meta|link)\b[^>]*\b(?:content|href)=["'](https?://[^"']+|__SITE__[^"']*)["']""", text):
        out.append((text.count("\n", 0, m.start()) + 1, html.unescape(m.group(1))))
    return out


def local_target(src: Path, target: str) -> Path | None:
    """The working-tree file a URL points at, or None when it is not one of ours."""
    if target.startswith(("/",)):
        return ROOT / target.lstrip("/")
    for base in (f"{REPO}/blob/main/", f"{REPO}/tree/main/", f"{REPO}/raw/main/"):
        if target.startswith(base):
            return ROOT / urllib.parse.unquote(target[len(base):])
    return None


def check_local(src: Path, target: str) -> str | None:
    """None when fine, else the reason."""
    frag = ""
    url = target
    if "#" in url:
        url, frag = url.split("#", 1)
    url = url.split("?", 1)[0]
    dest = local_target(src, url) if re.match(r"https?://", url) or url.startswith("/") else None
    if dest is None and not re.match(r"^[a-z][a-z0-9+.-]*:", url):
        dest = src.parent / urllib.parse.unquote(url) if url else src
    if dest is None:
        return None
    dest = Path(str(dest).rstrip("/")) if str(dest) != str(ROOT) else dest
    if not dest.exists():
        # the landing page's own published paths (images/, assets/, fonts/, demo/, tokens.css) are made by scripts/build_site.sh
        if src.name == "index.html" and src.parent.name == "landing" and re.match(r"^(\./)?(images|assets|fonts|demo|tokens\.css)", url):
            return None
        return f"no such file: {url}"
    if frag and dest.is_file() and dest.suffix in (".md", ".html") and urllib.parse.unquote(frag) not in anchors(dest):
        return f"no heading or id #{frag} in {dest.relative_to(ROOT)}"
    return None


def fetch(url: str) -> tuple[int, str]:
    last = (0, "")
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.geturl()
        except urllib.error.HTTPError as e:
            last = (e.code, str(e))
            if method == "HEAD" and e.code in (400, 403, 404, 405, 501):
                continue
            return last
        except Exception as e:   # DNS, TLS, timeout
            last = (0, f"{type(e).__name__}: {e}")
            if method == "HEAD":
                continue
    return last


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--offline", action="store_true", help="skip external URLs")
    a = ap.parse_args()
    bad: list[str] = []
    external: dict[str, list[str]] = {}
    count = 0
    for src in sources():
        rel = src.relative_to(ROOT)
        for line, raw in links(src):
            target = raw.replace("__REPO__", REPO).replace("__SITE__", SITE)
            if target.startswith(("mailto:", "tel:", "data:", "javascript:")) or target == "#" or "{" in target or "<" in target or "$" in target:
                continue
            count += 1
            host = urllib.parse.urlparse(target).hostname or ""
            if host in SKIP_HOSTS:
                continue
            if re.match(r"https?://", target):
                dest = local_target(src, target.split("#", 1)[0].split("?", 1)[0])
                if dest is not None:                      # a link into this repository: judge it against the working tree
                    why = check_local(src, target)
                    if why:
                        bad.append(f"{rel}:{line}: {raw}: {why}")
                    continue
                if target.startswith(SITE):
                    external.setdefault(target.split("#", 1)[0], []).append(f"{rel}:{line}")
                    continue
                external.setdefault(target.split("#", 1)[0], []).append(f"{rel}:{line}")
                continue
            if re.match(r"^[a-z][a-z0-9+.-]*:", target):
                continue
            why = check_local(src, target)
            if why:
                bad.append(f"{rel}:{line}: {raw}: {why}")
    print(f"{count} links in {len(sources())} files; {len(bad)} local problem(s); {len(external)} distinct external URL(s)")
    blocked: list[str] = []
    if not a.offline:
        def one(u: str) -> tuple[str, int, str]:
            return (u, *fetch(u))
        with cf.ThreadPoolExecutor(max_workers=12) as ex:
            for u, code, info in ex.map(one, sorted(external)):
                where = ", ".join(external[u][:3])
                if 200 <= code < 400:
                    continue
                if code in BLOCKED:
                    blocked.append(f"{u} -> {code} ({where})")
                else:
                    bad.append(f"{where}: {u} -> {code or 'unreachable'} {info[:80]}")
    for b in blocked:
        print("blocked (site refuses scripts):", b)
    for b in bad:
        print("BROKEN:", b)
    if not bad:
        print("all links resolve" + (" (external URLs not checked)" if a.offline else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
