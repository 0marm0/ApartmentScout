"""`apartmentscout handoff verify`: re-read a pack and check it against its manifest.

Checks: the zip opens and every member's CRC is good (``testzip``); MANIFEST.json exists and has a known schema;
the member names are exactly MANIFEST.json plus the files the manifest lists (nothing missing, nothing extra, no
duplicates); every file's byte count and sha256 match; no member name is absolute or climbs out with ``..``; and,
when a ``<pack>.sha256`` sidecar sits next to the zip, the zip's own sha256 matches it.
"""
from __future__ import annotations

import hashlib
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from . import PACK_SCHEMA


@dataclass
class VerifyResult:
    ok: bool
    sha256: str
    manifest: dict[str, Any] | None
    problems: list[str] = field(default_factory=list)
    checked: int = 0


def safe_member(name: str) -> bool:
    p = PurePosixPath(name)
    return bool(name) and not name.startswith(("/", "\\")) and ".." not in p.parts and ":" not in p.parts[0] \
        and "\\" not in name


def verify_pack(path: Path) -> VerifyResult:
    path = Path(path)
    problems: list[str] = []
    if not path.exists():
        return VerifyResult(False, "", None, [f"{path} does not exist"])
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    side = path.with_name(path.name + ".sha256")
    if side.exists():
        want = side.read_text().split()[0] if side.read_text().split() else ""
        if want != digest:
            problems.append(f"zip sha256 {digest[:12]}... does not match {side.name} ({want[:12]}...)")
    if not zipfile.is_zipfile(path):
        return VerifyResult(False, digest, None, problems + ["not a zip file"])
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            problems.append(f"corrupt member (CRC error): {bad}")
        names = z.namelist()
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            problems.append(f"duplicate members: {', '.join(dupes)}")
        unsafe = [n for n in names if not safe_member(n)]
        if unsafe:
            problems.append(f"unsafe member names: {', '.join(unsafe)}")
        if "MANIFEST.json" not in names:
            return VerifyResult(False, digest, None, problems + ["MANIFEST.json is missing"])
        try:
            manifest = json.loads(z.read("MANIFEST.json"))
        except ValueError as e:
            return VerifyResult(False, digest, None, problems + [f"MANIFEST.json is not valid JSON: {e}"])
        if manifest.get("schema") != PACK_SCHEMA:
            problems.append(f"unknown manifest schema {manifest.get('schema')!r} (expected {PACK_SCHEMA})")
        listed = {f.get("path"): f for f in manifest.get("files") or [] if isinstance(f, dict)}
        have = set(names) - {"MANIFEST.json"}
        for n in sorted(set(listed) - have):
            problems.append(f"missing from zip: {n}")
        for n in sorted(have - set(listed)):
            problems.append(f"not in manifest: {n}")
        checked = 0
        for n in sorted(have & set(listed)):
            data = z.read(n)
            f = listed[n]
            if len(data) != f.get("bytes"):
                problems.append(f"{n}: {len(data)} bytes, manifest says {f.get('bytes')}")
            if hashlib.sha256(data).hexdigest() != f.get("sha256"):
                problems.append(f"{n}: sha256 does not match the manifest (changed after packing)")
            checked += 1
    return VerifyResult(not problems, digest, manifest, problems, checked)
