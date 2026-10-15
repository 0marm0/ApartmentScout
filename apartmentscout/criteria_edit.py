"""Small, comment-preserving edits to a criteria.yaml, so a command can fill in what it found without rewriting the file.

``apartmentscout geocode`` finds the coordinates of each commute destination; this writes them next to the address
(``lat:`` and ``lon:``) and leaves every comment and every other line as it was. [onboarding]
"""
from __future__ import annotations

import datetime as dt
import shutil
from pathlib import Path
from typing import Any

import yaml


def _value(node: Any) -> Any:
    return node.value if isinstance(node, yaml.ScalarNode) else None


def _pair(m: yaml.MappingNode, key: str) -> tuple[yaml.Node, yaml.Node] | None:
    for k, v in m.value:
        if _value(k) == key:
            return k, v
    return None


def _destination_nodes(root: yaml.Node | None) -> list[yaml.MappingNode]:
    if not isinstance(root, yaml.MappingNode):
        return []
    com = _pair(root, "commute")
    if not com or not isinstance(com[1], yaml.MappingNode):
        return []
    dests = _pair(com[1], "destinations")
    if not dests or not isinstance(dests[1], yaml.SequenceNode):
        return []
    return [n for n in dests[1].value if isinstance(n, yaml.MappingNode)]


def _content_end(node: yaml.Node) -> int:
    """Character index where the node's own text ends. A block collection's end mark points at the start of the next token
    (the next line), so use the last scalar or flow collection inside it instead."""
    if isinstance(node, yaml.MappingNode) and not node.flow_style and node.value:
        return _content_end(node.value[-1][1])
    if isinstance(node, yaml.SequenceNode) and not node.flow_style and node.value:
        return _content_end(node.value[-1])
    return node.end_mark.index


def _num(v: float) -> str:
    return f"{round(float(v), 6):.6f}".rstrip("0").rstrip(".")


def set_destination_coords(text: str, coords: dict[str, tuple[float, float]]) -> str | None:
    """criteria.yaml text with lat/lon set on the named destinations, or None when the layout is one this cannot edit
    safely (the caller then prints the coordinates instead). Existing numbers are replaced; missing ones are added after
    the destination's last key. Comments, order and spacing everywhere else are untouched."""
    try:
        root = yaml.compose(text)
    except yaml.YAMLError:
        return None
    edits: list[tuple[int, int, str]] = []   # (start, end, replacement) character spans, applied last to first
    for m in _destination_nodes(root):
        name = _pair(m, "name")
        if not name or _value(name[1]) not in coords:
            continue
        lat, lon = coords[_value(name[1])]
        for key, val in (("lat", lat), ("lon", lon)):
            p = _pair(m, key)
            if p is None:
                continue
            v = p[1]
            if not isinstance(v, yaml.ScalarNode) or v.start_mark.index == v.end_mark.index:
                return None
            edits.append((v.start_mark.index, v.end_mark.index, _num(val)))
        have = {_value(k) for k, _ in m.value}
        missing = [(k, v) for k, v in (("lat", lat), ("lon", lon)) if k not in have]
        if not missing:
            continue
        if m.flow_style:
            end = m.end_mark.index - 1   # the closing brace
            if text[end] != "}":
                return None
            edits.append((end, end, "".join(f", {k}: {_num(v)}" for k, v in missing)))
            continue
        last = m.value[-1][1]
        eol = text.find("\n", _content_end(last))
        eol = len(text) if eol < 0 else eol
        pad = " " * m.value[0][0].start_mark.column
        edits.append((eol, eol, "".join(f"\n{pad}{k}: {_num(v)}" for k, v in missing)))
    if not edits:
        return text
    for a, b, rep in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:a] + rep + text[b:]
    try:
        yaml.safe_load(text)
    except yaml.YAMLError:
        return None
    return text


def set_search_fields(text: str, fields: dict[str, Any]) -> str | None:
    """Set scalar keys under ``search:`` (timezone, city, city_name, map_center ...) in place. A key that exists keeps its
    place and its trailing comment; a missing key is added at the end of the search block. None when the file has no
    block-style ``search:`` mapping to edit."""
    try:
        root = yaml.compose(text)
    except yaml.YAMLError:
        return None
    if not isinstance(root, yaml.MappingNode):
        return None
    s = _pair(root, "search")
    if not s or not isinstance(s[1], yaml.MappingNode) or s[1].flow_style:
        return None
    m = s[1]
    edits: list[tuple[int, int, str]] = []
    add: list[str] = []
    for key, val in fields.items():
        rendered = _scalar(val)
        p = _pair(m, key)
        v = p[1] if p is not None else None
        one_line = isinstance(v, yaml.ScalarNode) or (isinstance(v, (yaml.SequenceNode, yaml.MappingNode)) and v.flow_style)
        if v is not None and one_line and v.end_mark.index > v.start_mark.index:
            edits.append((v.start_mark.index, v.end_mark.index, rendered))
        elif p is not None:
            return None
        else:
            add.append(f"{key}: {rendered}")
    if add:
        last = m.value[-1][1]
        eol = text.find("\n", _content_end(last))
        eol = len(text) if eol < 0 else eol
        pad = " " * m.value[0][0].start_mark.column
        edits.append((eol, eol, "".join(f"\n{pad}{line}" for line in add)))
    for a, b, rep in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:a] + rep + text[b:]
    try:
        yaml.safe_load(text)
    except yaml.YAMLError:
        return None
    return text


def _scalar(v: Any) -> str:
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_scalar(x) for x in v) + "]"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return _num(v) if isinstance(v, float) else str(v)
    return yaml.safe_dump(str(v), default_style=None, width=10_000).split("\n...")[0].strip()


def _flow(entry: dict[str, Any]) -> str:
    return yaml.safe_dump(dict(entry), default_flow_style=True, sort_keys=False, width=10_000, allow_unicode=True).strip()


def feeds_in(text: str) -> list[dict[str, Any]]:
    """The commute.transit.feeds entries of a criteria.yaml text (empty when there are none)."""
    try:
        c = yaml.safe_load(text) or {}
    except yaml.YAMLError:
        return []
    transit = ((c.get("commute") or {}) if isinstance(c, dict) else {}).get("transit") or {}
    return [f for f in (transit.get("feeds") if isinstance(transit, dict) else None) or [] if isinstance(f, dict)]


def _eol(text: str, index: int) -> int:
    i = text.find("\n", index)
    return len(text) if i < 0 else i


def add_transit_feeds(text: str, feeds: list[dict[str, Any]]) -> str | None:
    """criteria.yaml text with ``feeds`` appended to commute.transit.feeds (entries whose url or path is already there are
    skipped), keeping comments. None when the layout cannot be edited safely: the caller then prints the lines to add."""
    have = {f.get("url") or f.get("path") for f in feeds_in(text)}
    new = [f for f in feeds if (f.get("url") or f.get("path")) not in have]
    if not new:
        return text
    try:
        root = yaml.compose(text)
    except yaml.YAMLError:
        return None
    if not isinstance(root, yaml.MappingNode):
        return None
    com = _pair(root, "commute")
    if not com or not isinstance(com[1], yaml.MappingNode) or com[1].flow_style or not com[1].value:
        return None
    tr = _pair(com[1], "transit")
    out: str | None = None
    if tr is None:
        pad = " " * com[1].value[0][0].start_mark.column
        eol = _eol(text, _content_end(com[1].value[-1][1]))
        block = f"\n{pad}transit:\n{pad}  feeds:" + "".join(f"\n{pad}    - {_flow(f)}" for f in new)
        out = text[:eol] + block + text[eol:]
    elif isinstance(tr[1], yaml.MappingNode) and not tr[1].flow_style and tr[1].value:
        pad = " " * tr[1].value[0][0].start_mark.column
        fp = _pair(tr[1], "feeds")
        if fp is None:
            eol = _eol(text, _content_end(tr[1].value[-1][1]))
            out = text[:eol] + f"\n{pad}feeds:" + "".join(f"\n{pad}  - {_flow(f)}" for f in new) + text[eol:]
        elif isinstance(fp[1], yaml.SequenceNode) and fp[1].value and not fp[1].flow_style:
            dash = " " * (fp[1].value[0].start_mark.column - 2)
            eol = _eol(text, _content_end(fp[1]))
            out = text[:eol] + "".join(f"\n{dash}- {_flow(f)}" for f in new) + text[eol:]
        elif isinstance(fp[1], yaml.SequenceNode) and not fp[1].value and fp[1].flow_style:   # `feeds: []`
            eol = _eol(text, fp[1].end_mark.index)
            items = "".join(f"\n{pad}  - {_flow(f)}" for f in new)
            out = text[:fp[1].start_mark.index].rstrip(" ") + text[fp[1].end_mark.index:eol] + items + text[eol:]
    if out is None:
        return None
    got = {f.get("url") or f.get("path") for f in feeds_in(out)}
    return out if got >= {f.get("url") or f.get("path") for f in new} else None


def write_with_backup(path: Path, text: str) -> Path | None:
    """Write ``text`` to ``path``, first copying the old file to backups/criteria-<stamp>.yaml beside it (the folder the
    dashboard's wizard uses). Returns the backup path."""
    backup = None
    if path.exists():
        bdir = path.parent / "backups"
        bdir.mkdir(exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = bdir / f"criteria-{stamp}.yaml"
        n = 1
        while backup.exists():
            n += 1
            backup = bdir / f"criteria-{stamp}-{n}.yaml"
        shutil.copy2(path, backup)
    path.write_text(text, encoding="utf-8")
    return backup
