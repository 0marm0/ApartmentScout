"""Where a search's photos can be fetched when they are not on this machine.

A search keeps its saved listing photos in ``<search>/media/``. The bundled example does not ship them (about 400 MB): git
holds a starter set in ``<search>/media-lite/`` and the full set is published with the demo. ``search.media_base_url`` in
``criteria.yaml`` names that published folder, for example ``https://0marm0.github.io/ApartmentScout/demo/media/``, so a
photo that is in neither local folder is fetched from ``<base><path under media/>``.

The order everywhere (``apartmentscout serve``, the static dashboard, the share pages): ``media/`` on this machine, then
``media-lite/``, then this base, then the photo's original link, then the aerial view or a glyph.
``dashboard/js/features/media-chain.js`` is the browser half of this; ``build`` writes the base into ``manifest.json``
as ``media_base_url`` so the page never carries a URL of its own.
"""
from __future__ import annotations

import urllib.parse
from pathlib import Path
from typing import Any

LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")
IMAGE_SUFFIXES = {".webp", ".jpg", ".jpeg", ".png", ".gif", ".avif"}


def normalize_base(value: Any) -> str | None:
    """A base URL with one trailing slash, or None when ``value`` is empty or not a usable https (or local http) URL."""
    if not isinstance(value, str) or not value.strip():
        return None
    u = urllib.parse.urlsplit(value.strip())
    ok = (u.scheme == "https" or (u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1"))) and bool(u.netloc)
    if not ok or u.query or u.fragment or u.username or u.password:
        return None
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path.rstrip("/") + "/", "", ""))


def media_base_url(criteria: dict[str, Any] | None) -> str | None:
    """``search.media_base_url`` of a loaded criteria mapping, normalised."""
    s = (criteria or {}).get("search")
    return normalize_base(s.get("media_base_url")) if isinstance(s, dict) else None


def remote_url(base: str | None, rel: str) -> str | None:
    """``base`` + the path under ``media/`` (``rel``), percent-encoded; None for anything that is not a plain image path."""
    if not base or not rel or rel.startswith(("/", "\\")) or "\\" in rel or any(ord(c) < 32 for c in rel):
        return None
    parts = rel.split("/")
    if any(p in ("", ".", "..") for p in parts) or Path(parts[-1]).suffix.lower() not in IMAGE_SUFFIXES:
        return None
    return base + "/".join(urllib.parse.quote(p, safe="") for p in parts)


def find_local(roots: list[Path | None], rel: str) -> Path | None:
    """The first of ``roots`` (``media/``, then ``media-lite/``) that holds ``rel`` as a file, never outside the root."""
    for root in roots:
        if root is None:
            continue
        base = root.resolve()
        target = (base / rel).resolve()
        if base in target.parents and target.is_file():
            return target
    return None
