"""Finishes of a home from its photos: `apartmentscout finishes`. [finishes]

The 3D rooms of the dashboard (Unit 3D Inside, the Floor plan studio) draw a floor, paint, window frames and a kitchen. A plan's
``finishes`` block (schema and meaning: docs/guides/floor-plans.md, dashboard/js/plan/finishes.js) says what those are and where
each value came from (``basis``: renter, photos, listing_text, assumed). This module fills the block from evidence:

* the photos saved for the listing (``photos_local`` in listings.json, found in the search's ``media/`` set or the smaller
  ``media-lite/`` starter set): the floor's tone from the bottom band of interior shots, the wall colour from the upper wall,
  the window-frame colour from the ring of pixels around the bright window glass, the cabinets, counters and backsplash from
  the photos titled as kitchens;
* the words the listing and its photo review use ("herringbone oak", "black-framed windows", "granite kitchens"), which set the
  floor pattern and confirm or contradict the photo reading. Listings that share photos (several apartments of one building
  reuse the building's marketing images) share the text read from those photos.

A proposal is written with ``basis: photos`` (or ``listing_text``) and the photo numbers as ``evidence``. A value whose basis is
``renter`` is never replaced. Pillow is optional: without it the words alone are read.

A VISUAL PREVIEW: sampled tones come from lit, often virtually staged marketing photos and can be a shade off.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

PATTERNS = ("herringbone", "basket", "plank", "tile", "carpet", "concrete")
BASES = ("renter", "photos", "listing_text", "assumed")
LEGACY_FLOOR = {"basket": "basket", "parquet": "herringbone", "oak": "plank"}
SECTIONS = {"floor": "floor", "walls": "colour", "ceiling": "colour", "window_frames": "colour", "doors": "colour"}
GROUPS = {"kitchen": {"cabinets": "colour", "counters": "colour", "backsplash": "colour", "floor": "floor"},
          "bath": {"tile": "colour", "vanity": "colour", "floor": "floor"}}

# Kept equal to NAMED_TONES in dashboard/js/plan/finishes.js (a test compares the two).
NAMED_TONES = {
    "white": "#f7f4ef", "warm white": "#f6f0e6", "off white": "#f1eee7", "ivory": "#f1ead8", "cream": "#efe4cb", "beige": "#dccdb2", "greige": "#cbc4b8",
    "light grey": "#d6d6d4", "grey": "#b5b5b3", "dark grey": "#6b6c6e", "charcoal": "#4a4b4e", "black": "#222326", "matte black": "#25262a", "bronze": "#4a4034",
    "honey": "#dcb27a", "honey oak": "#d9a866", "oak": "#cfb38a", "light oak": "#dcc39c", "dark oak": "#7d5e3d", "natural": "#d2b48c", "maple": "#e0c08e", "ash": "#d7c3a3",
    "grey oak": "#a39d92", "walnut": "#7a5538", "espresso": "#4a3226", "cherry": "#9a5a3c", "mahogany": "#6b3b2a",
    "concrete": "#aaa8a3", "slate": "#5b6064", "black granite": "#2a2a2c", "granite": "#6a6a6c", "marble": "#e8e6e1", "white marble": "#ebe9e4", "carrara": "#e4e2de",
    "terrazzo": "#d8d3ca", "quartz": "#e9e7e2", "navy": "#2f3e5c", "sage": "#a9b8a0", "light blue": "#cfe0ee", "soft grey": "#e2e2e0",
}


# ------------------------------------------------------------------ the data model (the Python twin of dashboard/js/plan/finishes.js)
def parse_tone(v: Any) -> str | None:
    """``#rgb``, ``#rrggbb`` (the # optional) or a named tone as lowercase ``#rrggbb``; None when it is neither."""
    if isinstance(v, bool) or not isinstance(v, (str, int)):
        return None
    if isinstance(v, int):
        return f"#{v:06x}" if 0 <= v <= 0xFFFFFF else None
    s = v.strip()
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", s)
    if m:
        return "#" + m.group(1).lower()
    m = re.fullmatch(r"#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])", s)
    if m:
        return "#" + "".join(c * 2 for c in m.groups()).lower()
    return NAMED_TONES.get(re.sub(r"[-_\s]+", " ", s.lower()))


def _leaf_keys(kind: str) -> tuple[str, ...]:
    return ("pattern", "tone", "basis", "evidence", "confidence") if kind == "floor" else ("colour", "basis", "evidence", "confidence")


def _leaf_error(v: Any, kind: str, at: str) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return "" if (parse_tone(v) or (kind == "floor" and v in PATTERNS)) else f"{at} \"{v[:30]}\" is not a hex colour or a named tone"
    if not isinstance(v, dict):
        return f"{at} must be an object or a colour"
    for k in v:
        if k not in _leaf_keys(kind):
            return f"{at}: unsupported field {k}"
    if kind == "floor":
        if v.get("pattern") is not None and v["pattern"] not in PATTERNS:
            return f"{at}.pattern must be one of {', '.join(PATTERNS)}"
        if v.get("tone") is not None and not parse_tone(v["tone"]):
            return f"{at}.tone is not a hex colour or a named tone"
        if v.get("pattern") is None and v.get("tone") is None:
            return f"{at} needs a pattern or a tone"
    else:
        if v.get("colour") is None or not parse_tone(v["colour"]):
            return f"{at} needs a colour (a hex colour or a named tone)"
    if v.get("basis") is not None and v["basis"] not in BASES:
        return f"{at}.basis must be one of {', '.join(BASES)}"
    ev = v.get("evidence")
    if ev is not None and (not isinstance(ev, str) or len(ev) > 160 or re.search(r"[<>\x00-\x1f]", ev)):
        return f"{at}.evidence must be plain text up to 160 characters"
    if v.get("confidence") is not None and v["confidence"] not in ("low", "medium", "high"):
        return f"{at}.confidence must be low, medium or high"
    return ""


def finishes_error(raw: Any) -> str:
    """The first problem in a ``finishes`` block as a message, or '' when it is valid (the twin of ``finishesError`` in JS)."""
    if raw is None:
        return ""
    if not isinstance(raw, dict):
        return "finishes must be an object"
    for k in raw:
        if k not in SECTIONS and k not in GROUPS:
            return f"finishes: unsupported field {k}"
    for k, kind in SECTIONS.items():
        e = _leaf_error(raw.get(k), kind, f"finishes.{k}")
        if e:
            return e
    for g, leaves in GROUPS.items():
        if raw.get(g) is None:
            continue
        if not isinstance(raw[g], dict):
            return f"finishes.{g} must be an object"
        for k in raw[g]:
            if k not in leaves:
                return f"finishes.{g}: unsupported field {k}"
        for k, kind in leaves.items():
            e = _leaf_error(raw[g].get(k), kind, f"finishes.{g}.{k}")
            if e:
                return e
    return ""


def leaf_paths() -> list[tuple[str, ...]]:
    """Every leaf of the block as a key path: ('floor',), ('kitchen', 'cabinets'), ..."""
    return [(k,) for k in SECTIONS] + [(g, k) for g, leaves in GROUPS.items() for k in leaves]


def leaf_kind(path: tuple[str, ...]) -> str:
    return SECTIONS[path[0]] if len(path) == 1 else GROUPS[path[0]][path[1]]


def get_leaf(block: dict | None, path: tuple[str, ...]) -> dict | None:
    cur: Any = block or {}
    for k in path:
        cur = cur.get(k) if isinstance(cur, dict) else None
    return cur if isinstance(cur, dict) else None


def set_leaf(block: dict, path: tuple[str, ...], leaf: dict) -> None:
    cur = block
    for k in path[:-1]:
        cur = cur.setdefault(k, {})
    cur[path[-1]] = leaf


def merge_finishes(existing: dict | None, proposal: dict, legacy_floor: str | None = None, keep_photos: bool = False) -> tuple[dict, list[str], list[str]]:
    """Put a proposal into a plan's existing ``finishes``. A leaf whose basis is ``renter`` is never replaced; every other leaf is replaced by the
    proposal's (re-running the tool refreshes its own earlier readings), except with ``keep_photos`` (a run that read only the words), which leaves an
    earlier reading of the photos in place. Returns (finishes, changed, kept) with the dotted names of each."""
    out = json.loads(json.dumps(existing)) if isinstance(existing, dict) else {}
    changed: list[str] = []
    kept: list[str] = []
    for path in leaf_paths():
        new = get_leaf(proposal, path)
        if not new:
            continue
        old = get_leaf(out, path)
        name = ".".join(path)
        if old and old.get("basis") == "renter":
            kept.append(name)
            continue
        if keep_photos and old and old.get("basis") == "photos" and new.get("basis") != "photos":
            kept.append(name)
            continue
        if path == ("floor",) and legacy_floor in LEGACY_FLOOR and not new.get("pattern"):
            new = {**new, "pattern": LEGACY_FLOOR[legacy_floor]}   # the old floor_finish names the pattern the photos did not
        if old != new:
            changed.append(name)
        set_leaf(out, path, new)
    return out, changed, kept


_ANCHORS = ("floor_finish", "floor", "up_bearing")


def _top_level_key(text: str, key: str, indent: str) -> tuple[int, int, int] | None:
    """(start of the key's line, start of its value, end of its value) for a top-level ``"key":`` written at `indent`, or None."""
    m = re.search(rf'(?m)^{re.escape(indent)}"{re.escape(key)}"\s*:\s*', text)
    if not m:
        return None
    try:
        _, end = json.JSONDecoder().raw_decode(text, m.end())
    except ValueError:
        return None
    return m.start(), m.end(), end


def splice_finishes(text: str, finishes: dict) -> str:
    """The plan file's text with its ``finishes`` replaced (or added after ``floor_finish``, ``floor`` or ``up_bearing``), and every other byte as it was:
    plan files are written compactly by hand (polygons on one line), so rewriting the whole file would bury this change. Falls back to a full rewrite
    when the file's layout is not the usual one-key-per-line object."""
    doc = json.loads(text)
    if not isinstance(doc, dict):
        raise ValueError("a plan is a JSON object")
    first = next((ln for ln in text.splitlines()[1:6] if ln[:1] in " \t"), None)
    indent = first[: len(first) - len(first.lstrip(" \t"))] if first else " "
    unit = "\t" if indent.startswith("\t") else len(indent)
    body = json.dumps(finishes, indent=unit, ensure_ascii=False).replace("\n", "\n" + indent)
    found = _top_level_key(text, "finishes", indent)
    if found:
        out = text[: found[1]] + body + text[found[2]:]
    else:
        spot = next((_top_level_key(text, a, indent) for a in _ANCHORS if a in doc and _top_level_key(text, a, indent)), None)
        if not spot:
            return json.dumps({**doc, "finishes": finishes}, indent=unit, ensure_ascii=False) + ("\n" if text.endswith("\n") else "")
        out = text[: spot[2]] + f',\n{indent}"finishes": {body}' + text[spot[2]:]
    if json.loads(out).get("finishes") != finishes:   # never write a file that does not read back as intended
        raise ValueError("could not place finishes in the plan file")
    return out


# ------------------------------------------------------------------ words: what the listing and its photo review say
_COLOUR_WORD = r"(white|black|grey|gray|dark|espresso|walnut|oak|navy|cream|ivory|beige|natural|maple|cherry)"
_COLOUR_NORM = {"gray": "grey", "dark": "dark grey"}


@dataclass
class TextRead:
    """Values the words say, each with the sentence fragment that said it (kept as evidence)."""
    floor_pattern: tuple[str, str] | None = None
    frames: tuple[str, str] | None = None            # (colour name, fragment)
    doors: tuple[str, str] | None = None
    cabinets: tuple[str, str] | None = None
    counters: tuple[str, str] | None = None
    bath_tile: tuple[str, str] | None = None
    floor_tone: tuple[str, str] | None = None
    sources: list[str] = field(default_factory=list)


def _first(rx: str, text: str, flags: int = re.I) -> re.Match | None:
    return re.search(rx, text, flags)


def read_text(texts: Iterable[str]) -> TextRead:
    """Read finishes out of free text (a photo review's evidence, photo titles, the listing's features). Pure and conservative: a phrase must
    name the finish; "hardwood floors" alone names no pattern."""
    t = TextRead()
    blob = " ; ".join(s for s in texts if isinstance(s, str) and s.strip())
    if not blob:
        return t

    def frag(m: re.Match) -> str:
        """The few words around a match, inside its own clause (between ; , . and the brackets), cut at word boundaries."""
        a = max([blob.rfind(c, 0, m.start()) for c in ";,.()"] + [-1]) + 1
        b = min([i for i in (blob.find(c, m.end()) for c in ";,.()") if i >= 0] + [len(blob)])
        clause = re.sub(r"\s+", " ", blob[a:b]).strip()
        return clause if len(clause) <= 60 else " ".join(clause.split()[-8:])[:60]

    m = _first(r"herring-?bone|chevron", blob)
    if m:
        t.floor_pattern = ("herringbone", frag(m))
    else:
        m = _first(r"basket[- ]?weave|basket", blob)
        if m:
            t.floor_pattern = ("basket", frag(m))
        else:
            m = _first(r"parquet", blob)     # a bare "parquet" in a New York tower is block (basket-weave) parquet
            if m:
                t.floor_pattern = ("basket", frag(m) + " (read as block parquet)")
            else:
                m = _first(r"(?:wide[- ])?plank|strip floor", blob)
                if m:
                    t.floor_pattern = ("plank", frag(m))
                else:
                    m = _first(r"concrete floor|polished concrete", blob)
                    if m:
                        t.floor_pattern = ("concrete", frag(m))
                    else:
                        m = _first(r"carpeted|wall-to-wall carpet", blob)
                        if m:
                            t.floor_pattern = ("carpet", frag(m))
                        else:
                            m = _first(r"(?:porcelain |ceramic |stone )?tile[d]? floor", blob)
                            if m:
                                t.floor_pattern = ("tile", frag(m))
    m = _first(r"(black|dark|bronze)[- ](?:window[- ])?frame|(?:window[- ])?frames? in (black|bronze)|black[- ]framed", blob)
    if m:
        t.frames = ("black", frag(m))
    else:
        m = _first(r"white[- ](?:window[- ])?frame|white[- ]framed", blob)
        if m:
            t.frames = ("white", frag(m))
    m = _first(rf"{_COLOUR_WORD}(?: shaker| flat-panel| slab)? cabinet", blob)
    if m:
        t.cabinets = (_COLOUR_NORM.get(m.group(1).lower(), m.group(1).lower()), frag(m))
    m = _first(r"(black granite|granite|white quartz|quartz|marble|butcher[- ]block|concrete) (?:kitchen )?counter", blob) or _first(r"(granite|quartz|marble) kitchen", blob)
    if m:
        name = m.group(1).lower().replace("butcher-block", "butcher block")
        t.counters = ({"butcher block": "walnut", "white quartz": "quartz"}.get(name, name), frag(m))
    m = _first(r"marble bath|marble (?:tile|shower|vanity)", blob)
    if m:
        t.bath_tile = ("white marble", frag(m))
    m = _first(rf"{_COLOUR_WORD} doors?\b", blob)
    if m:
        t.doors = (_COLOUR_NORM.get(m.group(1).lower(), m.group(1).lower()), frag(m))
    return t


def listing_texts(listing: dict, others: Iterable[dict] = ()) -> list[str]:
    """The words about a listing's finishes: its photo review's evidence, its photo titles and its features, plus the same of every listing
    in ``others`` (the ones that share photos with it)."""
    out: list[str] = []
    for L in [listing, *others]:
        pr = L.get("photo_review") or {}
        if isinstance(pr, dict):
            for k in ("evidence", "floors", "finishes"):
                if isinstance(pr.get(k), str) and (k == "evidence" or "-" in pr[k] or " " in pr[k]):
                    out.append(pr[k])
        for m in L.get("photos_meta") or []:
            if isinstance(m, dict) and isinstance(m.get("title"), str):
                out.append(m["title"])
        feats = L.get("features") or {}
        if isinstance(feats, dict):
            out.extend(v for k, v in feats.items() if k in ("interior", "windows") and isinstance(v, str))
    seen: set[str] = set()
    return [s for s in out if not (s in seen or seen.add(s))]


# ------------------------------------------------------------------ pixels: what the photos show
def pillow_available() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return True


WIDTH = 320            # photos are read at this width: plenty for tones, fast for hundreds of photos
BAND = 0.38            # the bottom fraction of an interior shot that is mostly floor
WOOD_MIN = 0.12        # a photo shows a wood floor when this share of its bottom band is wood-coloured
ROOM_WORDS = {"kitchen": r"kitchen", "bath": r"bath", "bed": r"bed(?:room)?", "living": r"living|dining|great room|foyer|entry|hall"}


def _hsv(rgb):
    import numpy as np
    x = rgb.astype("float32") / 255.0
    mx, mn = x.max(axis=-1), x.min(axis=-1)
    d = mx - mn
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rc = nz & (mx == r)
    gc = nz & (mx == g) & ~rc
    bc = nz & ~rc & ~gc
    h[rc] = ((g - b)[rc] / d[rc]) % 6
    h[gc] = (b - r)[gc] / d[gc] + 2
    h[bc] = (r - g)[bc] / d[bc] + 4
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h * 60.0, s, mx


def hex_of(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(max(0, min(255, round(float(c))))) for c in rgb)


# What the room renderer does to a flat colour, measured in Unit 3D's Inside view at noon in Fast mode (a flat albedo `a` of 0-255 comes out as
# gain * a + lift): its light is warm and tone-mapped, so a tone read straight off a photo would be drawn paler and greyer than the photo. A plan's
# tone / colour is the colour the room DRAWS with, so the readings of the photos are mapped through the inverse of this before they are written.
FLOOR_XFER = ((0.77, 28.0), (0.91, 17.0), (1.06, 9.0))      # wood and tile floors, per channel (the floor takes the sun and the warm fill)
GREY_XFER = (0.78, 34.0)                                    # walls, cabinets, counters, frames


def to_albedo(rgb, family: str = "grey"):
    """The colour to write into a plan so the 3D room draws `rgb` (what a photo shows) back: the inverse of the renderer's transfer, clipped to 0-255."""
    import numpy as np
    c = np.asarray(rgb, float)
    if family == "floor":
        out = np.array([(c[i] - FLOOR_XFER[i][1]) / FLOOR_XFER[i][0] for i in range(3)])
    else:
        if c.max() < 90:   # near-black stone and glass: the cast of a photo's white balance is not the material's colour
            c = c.mean() + (c - c.mean()) * 0.3
        out = (c - GREY_XFER[1]) / GREY_XFER[0]
    return np.clip(out, 0, 255)


def _median(px):
    import numpy as np
    return np.median(px, axis=0)


def _mode_colour(px, shift: int = 4):
    """The densest colour of an (n, 3) pixel array: the mean of the pixels within one coarse cell of the fullest cell."""
    import numpy as np
    if len(px) < 40:
        return None
    q = (px >> shift).astype("int32")
    key = (q[:, 0] << 16) | (q[:, 1] << 8) | q[:, 2]
    vals, counts = np.unique(key, return_counts=True)
    best = vals[counts.argmax()]
    c = np.array([(best >> 16) & 255, (best >> 8) & 255, best & 255])
    near = np.abs(q - c).max(axis=1) <= 1
    return px[near].mean(axis=0) if near.sum() >= 30 else px[key == best].mean(axis=0)


def _lit_mean(px, pct: float, band: float = 12.0, upper: bool = False):
    """The mean colour of the pixels whose luminance sits near the `pct`-th percentile: the lit part of a surface (the median of a floor is its shadows)."""
    import numpy as np
    if len(px) < 40:
        return None
    lum = px.astype("float32") @ np.array([0.2126, 0.7152, 0.0722], dtype="float32")
    t = np.percentile(lum, pct)
    sel = px[lum >= t] if upper else px[np.abs(lum - t) <= band]
    return sel.mean(axis=0) if len(sel) >= 20 else px.mean(axis=0)


@dataclass
class PhotoRead:
    """What one photo shows, from its pixels. None where the photo does not say."""
    index: int                              # 1-based position in the listing's photos
    path: str
    room: str = ""                          # kitchen | bath | bed | living | '' (from its title)
    wood_share: float = 0.0
    wood: Any = None                        # lit RGB of the wood-coloured floor pixels
    floor_any: Any = None                   # lit RGB of the bottom edge of the picture, whatever its colour (grey or white-washed floors)
    wall: Any = None                        # mode RGB of the lit upper wall
    frame: str = ""                         # 'dark' | 'light' | '' (around the window glass)
    frame_n: int = 0
    frame_rgb: Any = None
    cabinets: Any = None
    counters: Any = None
    backsplash: Any = None
    kitchen_floor: Any = None
    white_point: float = 0.0                # 97th percentile of the luminance of the non-sky pixels
    interior: bool = True


def kitchen_room(room: str) -> bool:
    return room in ("kitchen", "bath")


def read_photo(path: Path, index: int, room: str = "") -> PhotoRead | None:
    """Read one photo with numpy and Pillow. None when it cannot be opened."""
    import numpy as np
    from PIL import Image
    try:
        with Image.open(path) as im:
            im.draft("RGB", (WIDTH * 2, WIDTH * 2))
            im = im.convert("RGB")
            w, h = im.size
            if w < 64 or h < 64:
                return None
            im = im.resize((WIDTH, max(1, round(WIDTH * h / w))), Image.LANCZOS)
            a = np.asarray(im)
    except Exception:
        return None
    H, W = a.shape[:2]
    hue, sat, val = _hsv(a)
    r = PhotoRead(index=index, path=str(path), room=room)
    sky = ((hue > 185) & (hue < 240) & (sat > 0.12) & (val > 0.5)) | ((val > 0.985) & (sat < 0.04) & (np.arange(H)[:, None] < H * 0.65))
    # a plan drawing or a facade is not an interior: mostly white with no wood, or the top third mostly sky
    top_sky = sky[: H // 3].mean()
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) / 255.0
    if top_sky > 0.55 or (sat < 0.05).mean() > 0.85:
        r.interior = False
        return r
    nonsky = ~sky
    if nonsky.sum() > 200:
        r.white_point = float(np.percentile(lum[nonsky], 97))
    rows = lambda a0, a1: slice(int(H * a0), int(H * a1))  # noqa: E731
    # floor: the wood-coloured pixels of the bottom band
    b = rows(1 - BAND, 1.0)
    wood = (hue[b] > 14) & (hue[b] < 48) & (sat[b] > 0.28) & (sat[b] < 0.82) & (val[b] > 0.30) & (val[b] < 0.96)
    r.wood_share = float(wood.mean())
    if r.wood_share >= WOOD_MIN and wood.sum() > 150:
        r.wood = _lit_mean(a[b][wood], 70)
    e = rows(0.86, 1.0)
    ok = nonsky[e] & (val[e] > 0.25) & (val[e] < 0.97)
    if ok.mean() > 0.5 and not kitchen_room(room):
        r.floor_any = _lit_mean(a[e][ok], 50)
    kitchen = room == "kitchen"
    # walls: the lit, unsaturated upper part of the picture, away from the glass
    if not kitchen:
        u = rows(0.04, 0.5)
        m = nonsky[u] & (val[u] > 0.5) & (sat[u] < 0.32)
        if m.sum() > 300:
            r.wall = _lit_mean(a[u][m], 60, upper=True)   # the lit part of the wall: the dark end is shadow, which the 3D room draws itself
    # window frames: the ring of pixels just outside the glass: mostly dark = black frames, mostly pale = white or silver frames
    glass = sky & (np.arange(H)[:, None] < H * 0.85)
    if glass.mean() > 0.012:
        def grow(m, k):
            g = m.copy()
            for dy in range(-k, k + 1):
                for dx in range(-k, k + 1):
                    g |= np.roll(np.roll(m, dy, 0), dx, 1)
            return g
        ring = grow(glass, 6) & ~grow(glass, 2)
        ring[:, :7] = ring[:, -7:] = False
        ring[:7] = ring[-7:] = False
        if ring.sum() > 120:
            rv, rs = val[ring], sat[ring]
            dark = float((rv < 0.30).mean())
            pale = (rv > 0.70) & (rs < 0.16)
            light = float(pale.mean())
            r.frame_n = int(ring.sum())
            r.frame = "dark" if dark >= 0.25 and light < 0.35 else "light" if light >= 0.40 and dark < 0.12 else ""
            if r.frame == "light" and pale.sum() > 60:
                r.frame_rgb = _median(a[ring][pale])
    if kitchen:
        up = rows(0.06, 0.45)
        m = nonsky[up] & (val[up] > 0.2)
        r.cabinets = _mode_colour(a[up][m]) if m.sum() > 400 else None
        bs = rows(0.38, 0.58)
        dk = (val[bs] < 0.32) & (sat[bs] < 0.45) & nonsky[bs]
        if dk.mean() >= 0.10:
            r.backsplash = _median(a[bs][dk])
        cs = rows(0.55, 0.82)
        dk = (val[cs] < 0.32) & (sat[cs] < 0.45) & nonsky[cs]
        if dk.mean() >= 0.10:
            r.counters = _median(a[cs][dk])
        fl = rows(0.84, 1.0)
        dk = (val[fl] < 0.30) & (sat[fl] < 0.45)
        if dk.mean() >= 0.30:
            r.kitchen_floor = _median(a[fl][dk])
    return r


# ------------------------------------------------------------------ a listing's photos
def find_photo(root: Path, rel: str) -> Path | None:
    """``media/<...>`` under the search folder, else the same file in ``media-lite/``."""
    if not isinstance(rel, str) or ".." in Path(rel).parts or Path(rel).is_absolute():
        return None
    for base in (root, root / "media-lite"):
        p = (base / rel) if base == root else (base / re.sub(r"^media/", "", rel))
        if p.is_file():
            return p
    return None


def photo_room(title: str) -> str:
    for room, rx in ROOM_WORDS.items():
        if re.search(rx, title or "", re.I):
            return room
    return ""


def span(nums: Iterable[int]) -> str:
    """[1, 2, 3, 5, 6, 9] -> "1-3, 5-6, 9"."""
    xs = sorted(set(nums))
    out, i = [], 0
    while i < len(xs):
        j = i
        while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1:
            j += 1
        out.append(str(xs[i]) if i == j else f"{xs[i]}-{xs[j]}")
        i = j + 1
    return ", ".join(out)


def photos_word(nums: Iterable[int]) -> str:
    """"photo 3" or "photos 1-3, 5"."""
    xs = sorted(set(nums))
    return f"photo{'s' if len(xs) != 1 else ''} {span(xs)}"


def _dist(a, b) -> float:
    import numpy as np
    return float(np.abs(np.asarray(a, float) - np.asarray(b, float)).max())


def _consensus(items: list[tuple[int, Any]], tol: float = 38.0):
    """(median colour, photo numbers) of the colours that agree: those within `tol` of the median, widened once."""
    import numpy as np
    if not items:
        return None, []
    arr = np.array([c for _, c in items], float)
    med = np.median(arr, axis=0)
    keep = [(i, c) for i, c in items if _dist(c, med) <= tol]
    if not keep:
        return None, []
    med = np.median(np.array([c for _, c in keep], float), axis=0)
    return med, [i for i, _ in keep]


def _lift(rgb, white_point: float):
    """Normalise a pale colour by the photo's white point: the brightest interior pixels of a marketing photo read 0.85-0.95, not 1, so a white wall
    reads grey. Scales so the white point lands on 0.97, by at most 25 %."""
    import numpy as np
    c = np.asarray(rgb, float)
    if white_point <= 0:
        return c
    k = min(1.25, max(1.0, 0.97 / white_point))
    return np.minimum(255.0, c * k)


@dataclass
class Proposal:
    finishes: dict
    notes: list[str]
    photos_total: int
    photos_read: int
    photos_missing: int


def propose(listing: dict, others: Iterable[dict] = (), root: Path | None = None, use_pixels: bool = True) -> Proposal:
    """The finishes a listing's photos and words support, as a ``finishes`` block (leaves only where there is evidence) plus notes for the renter."""
    notes: list[str] = []
    fin: dict = {}
    photos = [p for p in (listing.get("photos_local") or []) if isinstance(p, str)]
    meta = {m.get("local"): m for m in (listing.get("photos_meta") or []) if isinstance(m, dict)}
    text = read_text(listing_texts(listing, others))
    reads: list[PhotoRead] = []
    missing = 0
    can_read = use_pixels and pillow_available() and root is not None
    if use_pixels and not pillow_available():
        notes.append("Pillow is not installed (pip install -e '.[images]'): only the words were read, not the photos.")
    if can_read:
        for i, rel in enumerate(photos, 1):
            p = find_photo(root, rel)
            if p is None:
                missing += 1
                continue
            rd = read_photo(p, i, photo_room(str((meta.get(rel) or {}).get("title") or "")))
            if rd:
                reads.append(rd)
        if missing:
            notes.append(f"{missing} of {len(photos)} photos are not on disk (media/ or media-lite/), so they were not read.")
    interior = [r for r in reads if r.interior]
    wp = float(sorted([r.white_point for r in interior if r.white_point])[len([1 for r in interior if r.white_point]) // 2]) if any(r.white_point for r in interior) else 0.0

    # floor
    tone, used = _consensus([(r.index, r.wood) for r in interior if r.wood is not None and r.room != "kitchen"])
    floor: dict = {}
    floor_note = ""
    if tone is None and (text.floor_pattern or _hardwood(listing)):   # no warm wood anywhere: grey or white-washed boards, read from the foot of the picture
        tone, used = _consensus([(r.index, r.floor_any) for r in interior if r.floor_any is not None], tol=45.0)
        if tone is not None:
            floor_note = " (no warm wood tones in the photos: the foot of the picture)"
    if text.floor_pattern:
        floor["pattern"] = text.floor_pattern[0]
    if tone is not None and (text.floor_pattern is None or text.floor_pattern[0] in ("basket", "herringbone", "plank")):
        floor["tone"] = hex_of(to_albedo(tone, "floor"))
    if floor:
        bits = []
        if "tone" in floor:
            bits.append(f"tone sampled from the floor of {photos_word(used)}{floor_note}")
        if text.floor_pattern:
            bits.append(f"pattern from the listing's words: \"{text.floor_pattern[1]}\"")
        elif "tone" in floor:
            bits.append("no words name the pattern, so the room's default pattern is kept")
        floor["basis"] = "photos" if "tone" in floor else "listing_text"
        floor["evidence"] = "; ".join(bits)[:160]
        floor["confidence"] = "medium" if len(used) >= 3 else "low"
        fin["floor"] = floor

    # walls
    wall, wused = _consensus([(r.index, r.wall) for r in interior if r.wall is not None], tol=26.0)
    if wall is not None and len(wused) >= 1:
        fin["walls"] = {"colour": hex_of(to_albedo(_lift(wall, wp))), "basis": "photos", "evidence": f"upper walls of {photos_word(wused)}"[:160],
                        "confidence": "medium" if len(wused) >= 4 else "low"}

    # window frames: photos vote, the words decide when they speak
    dark = [r.index for r in interior if r.frame == "dark"]
    light = [r.index for r in interior if r.frame == "light"]
    frame_word = text.frames
    photo_frame = "black" if len(dark) >= 2 and len(dark) >= 2 * len(light) else "white" if len(light) >= 2 and len(light) >= 2 * len(dark) else None
    if frame_word:
        agree = photo_frame == frame_word[0]
        fin["window_frames"] = {"colour": NAMED_TONES["black"] if frame_word[0] == "black" else "#f4f2ee", "basis": "listing_text",
                                "evidence": (f"\"{frame_word[1]}\"" + (f"; {photos_word(dark if frame_word[0] == 'black' else light)} agree" if agree else
                                             f"; the photos read {photo_frame}" if photo_frame else ""))[:160]}
    elif photo_frame:
        n = dark if photo_frame == "black" else light
        fin["window_frames"] = {"colour": NAMED_TONES["black"] if photo_frame == "black" else hex_of(to_albedo(_consensus([(r.index, r.frame_rgb) for r in interior if r.frame == "light" and r.frame_rgb is not None], 40.0)[0] if any(r.frame_rgb is not None for r in interior) else (244, 242, 238))), "basis": "photos",
                                "evidence": f"{'dark' if photo_frame == 'black' else 'pale'} edge around the glass in {photos_word(n)}"[:160], "confidence": "medium" if len(n) >= 3 else "low"}

    # kitchen
    kit = [r for r in interior if r.room == "kitchen"]
    k: dict = {}
    cab, cused = _consensus([(r.index, r.cabinets) for r in kit if r.cabinets is not None], tol=34.0)
    if text.cabinets and (cab is None or _dist(cab, hex_rgb(parse_tone(text.cabinets[0]) or "#ffffff")) > 80):
        pass_text = True
    else:
        pass_text = False
    if cab is not None and len(cused) >= 1 and not pass_text:
        k["cabinets"] = {"colour": hex_of(to_albedo(_lift(cab, wp) if _is_pale(cab) else cab)), "basis": "photos",
                         "evidence": f"kitchen {photos_word(cused)}"[:160], "confidence": "medium" if len(cused) >= 2 else "low"}
    elif text.cabinets:
        k["cabinets"] = {"colour": parse_tone(text.cabinets[0]), "basis": "listing_text", "evidence": f"\"{text.cabinets[1]}\""[:160]}
    cnt, cnused = _consensus([(r.index, r.counters) for r in kit if r.counters is not None], tol=40.0)
    if cnt is not None:
        k["counters"] = {"colour": hex_of(to_albedo(cnt)), "basis": "photos", "evidence": f"dark counter in kitchen {photos_word(cnused)}"[:160], "confidence": "low"}
        if text.counters:
            k["counters"]["evidence"] = (k["counters"]["evidence"] + f"; words: {text.counters[0]}")[:160]
    elif text.counters and parse_tone(text.counters[0]):
        k["counters"] = {"colour": parse_tone(text.counters[0]), "basis": "listing_text", "evidence": f"\"{text.counters[1]}\""[:160]}
    bsp, bused = _consensus([(r.index, r.backsplash) for r in kit if r.backsplash is not None], tol=40.0)
    if bsp is not None:
        k["backsplash"] = {"colour": hex_of(to_albedo(bsp)), "basis": "photos", "evidence": f"dark backsplash in kitchen {photos_word(bused)}"[:160], "confidence": "low"}
    kf, kfused = _consensus([(r.index, r.kitchen_floor) for r in kit if r.kitchen_floor is not None], tol=40.0)
    if kf is not None and len(kfused) >= 1:
        k["floor"] = {"pattern": "tile", "tone": hex_of(to_albedo(kf, "floor")), "basis": "photos", "evidence": f"dark floor in kitchen {photos_word(kfused)}"[:160], "confidence": "low"}
    if k:
        fin["kitchen"] = k
    if text.bath_tile and parse_tone(text.bath_tile[0]):
        fin["bath"] = {"tile": {"colour": parse_tone(text.bath_tile[0]), "basis": "listing_text", "evidence": f"\"{text.bath_tile[1]}\""[:160]}}
    if text.doors and parse_tone(text.doors[0]):
        fin["doors"] = {"colour": parse_tone(text.doors[0]), "basis": "listing_text", "evidence": f"\"{text.doors[1]}\""[:160]}
    if can_read and not photos:
        notes.append("This home has no saved photos (photos_local): only its words were read.")
    elif can_read and not interior:
        notes.append("None of this home's saved photos could be read as an interior shot.")
    err = finishes_error(fin)
    if err:   # never write an invalid block: a bug in this module is reported, not saved
        raise ValueError(f"internal: proposed finishes are invalid: {err}")
    return Proposal(fin, notes, len(photos), len(reads), missing)


def _hardwood(listing: dict) -> bool:
    """The photo review grades the floors as wood ("hardwood", "wood", "oak")."""
    pr = listing.get("photo_review")
    return isinstance(pr, dict) and bool(re.search(r"wood|oak|plank|parquet", str(pr.get("floors") or ""), re.I))


def hex_rgb(h: str):
    n = int(h[1:], 16)
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


def _is_pale(rgb) -> bool:
    return bool(min(rgb) > 150)
