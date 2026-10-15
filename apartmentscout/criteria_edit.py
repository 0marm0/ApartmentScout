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
        eol = text.find("\n", last.end_mark.index)
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
        if p is not None and isinstance(p[1], yaml.ScalarNode) and p[1].end_mark.index > p[1].start_mark.index:
            edits.append((p[1].start_mark.index, p[1].end_mark.index, rendered))
        elif p is not None:
            return None
        else:
            add.append(f"{key}: {rendered}")
    if add:
        last = m.value[-1][1]
        eol = text.find("\n", last.end_mark.index)
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
