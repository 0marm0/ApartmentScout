"""Blur-up previews: a ~24 px wide WebP per leading photo, base64 in one sidecar file.

``apartmentscout build`` writes ``data/lqip.json`` next to ``listings.json``. The dashboard loads it lazily, paints
the tiny preview blurred the moment a card or the drawer renders and cross-fades to the full photo when it arrives.
Keeping the previews out of ``listings.json`` leaves the main data file as small as it was.

Which photos get a preview: the first photo of each lightbox group (unit, same line, building) of every listing,
in the order the dashboard shows them (``photo_groups`` mirrors ``dashboard/js/features/photos.js``). Floor plans are
white drawings that blur to nothing, and street photos are rarely the first thing anyone sees, so they get none.

Pillow is optional (``pip install 'apartmentscout[images]'``): without it the build says so and writes no sidecar.

Sidecar shape::

    {"v": 1, "w": 24, "fmt": "webp", "items": {"media/<id>/p-1.webp": [1500, 1000, "<base64 WebP>"]}}

Each item is ``[source width, source height, base64]``: the pixel size also gives the dashboard a layout ratio for
galleries before any full image has loaded.
"""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from typing import Callable, Iterable

SIDECAR = "lqip.json"
WIDTH = 24
QUALITY = 40
# the lightbox tabs, in display order; the previews cover the first three
GROUPS = ("unit", "line", "building", "plan", "street")
PREVIEW_GROUPS = ("unit", "line", "building")
_SCOPE = {"exact-unit": "unit", "exact": "unit", "unit": "unit", "same-line": "line", "line": "line",
          "same-building": "building", "building": "building", "same-property": "building",
          "street": "street", "block": "street"}


def scope_group(scope: object, default: str) -> str:
    """A photo's lightbox group from its ``scope`` string (``exact-unit``, ``same-line``, ``building``, ``street``)."""
    return _SCOPE.get(str(scope or "").strip().lower(), default)


def _is_flagged(L: dict, *keys: object) -> bool:
    flags = L.get("photo_flags") or {}
    return any(k and (flags.get(k) or {}).get("watermark") for k in keys)


def photo_groups(L: dict) -> dict[str, list[str]]:
    """The listing's saved (local) images by lightbox group, best first: clean before flagged inside a group.

    The same ordering the dashboard uses: the listing's own photos by their ``photos_meta`` scope (no metadata means
    the exact unit), then licensed building photos, then floor plans. Only local ``media/...`` paths are returned."""
    out: dict[str, list[tuple[bool, int, str]]] = {g: [] for g in GROUPS}
    seq = 0
    local = list(L.get("photos_local") or [])
    meta = L.get("photos_meta") or []
    for i, path in enumerate(local):
        m = meta[i] if i < len(meta) and isinstance(meta[i], dict) else {}
        g = scope_group(m.get("scope"), "unit")
        out[g].append((_is_flagged(L, path), seq, path))
        seq += 1
    for b in L.get("building_photos") or []:
        path = b.get("local") or (b.get("url") if str(b.get("url") or "").startswith("media/") else None)
        if not path:
            continue
        out[scope_group(b.get("scope"), "building")].append((_is_flagged(L, path, b.get("url")), seq, path))
        seq += 1
    for path in L.get("floorplan_images") or []:
        if str(path).startswith("media/"):
            out["plan"].append((_is_flagged(L, path), seq, path))
            seq += 1
    result: dict[str, list[str]] = {}
    for g, items in out.items():
        seen: set[str] = set()
        ordered = []
        for _flag, _seq, path in sorted(items, key=lambda t: (t[0], t[1])):
            if path not in seen:
                seen.add(path)
                ordered.append(path)
        result[g] = ordered
    return result


def lqip_targets(listings: Iterable[dict]) -> list[str]:
    """Paths that get a preview: the first image of each of the unit, same-line and building groups."""
    paths: dict[str, None] = {}
    for L in listings:
        groups = photo_groups(L)
        for g in PREVIEW_GROUPS:
            if groups[g]:
                paths.setdefault(groups[g][0], None)
    return list(paths)


def make_lqip(path: Path, width: int = WIDTH, quality: int = QUALITY) -> tuple[int, int, str] | None:
    """``(source width, source height, base64 WebP)`` for one image, or None when it cannot be read."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - guarded by build_sidecar
        return None
    try:
        with Image.open(path) as im:
            sw, sh = im.size
            if not sw or not sh:
                return None
            im.draft("RGB", (width * 4, width * 4))     # JPEG: decode at a fraction of the size
            small = im.convert("RGB").resize((width, max(1, round(width * sh / sw))), Image.LANCZOS)
        buf = io.BytesIO()
        small.save(buf, "WEBP", quality=quality, method=6)
    except Exception:  # a corrupt or unsupported file just gets no preview
        return None
    return sw, sh, base64.b64encode(buf.getvalue()).decode("ascii")


def pillow_available() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return True


def build_sidecar(listings: Iterable[dict], media_root: Path, out_dir: Path, cache_path: Path | None = None,
                  log: Callable[[str], None] = lambda s: None) -> dict | None:
    """Write ``out_dir/lqip.json`` for the listings' leading photos found under ``media_root``.

    Returns the sidecar dict, or None when Pillow is missing or there is nothing to preview (any stale sidecar is
    removed so the dashboard never reads a preview that no longer matches). Previews are cached by file size and
    modification time in ``cache_path`` so a rebuild only reads photos that changed."""
    dest = out_dir / SIDECAR
    if not pillow_available():
        dest.unlink(missing_ok=True)
        log("Blur-up previews skipped: Pillow is not installed (pip install 'apartmentscout[images]')")
        return None
    cache: dict[str, list] = {}
    if cache_path and cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text()).get("items", {})
        except (OSError, ValueError):
            cache = {}
    items: dict[str, list] = {}
    fresh: dict[str, list] = {}
    for rel in lqip_targets(listings):
        f = media_root / rel.removeprefix("media/")
        try:
            st = f.stat()
        except OSError:
            continue
        stamp = [st.st_size, int(st.st_mtime)]
        hit = cache.get(rel)
        if hit and hit[:2] == stamp:
            made = hit[2:]
        else:
            m = make_lqip(f)
            if m is None:
                continue
            made = list(m)
        fresh[rel] = stamp + made
        items[rel] = made
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"items": fresh}, separators=(",", ":")))
    if not items:
        dest.unlink(missing_ok=True)
        return None
    side = {"v": 1, "w": WIDTH, "fmt": "webp", "items": items}
    dest.write_text(json.dumps(side, separators=(",", ":")))
    log(f"Blur-up previews: {len(items)} photos, {dest.stat().st_size / 1024:.0f} KB -> {dest}")
    return side


def alias_remote(side: dict, listings: Iterable[dict]) -> dict:
    """A copy of the sidecar keyed by each photo's original link instead of its saved copy.

    The standalone file drops ``photos_local`` when no ``media/`` folder sits next to it, so its cards show the
    remote links; the previews must be found under those links."""
    items = dict(side.get("items") or {})
    out: dict[str, list] = {}
    for L in listings:
        for loc, web in zip(L.get("photos_local") or [], L.get("photos") or []):
            if loc in items and web:
                out[web] = items[loc]
    return {**side, "items": out}
