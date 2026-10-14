"""Working with another agent: handoff packs, verification, update import, and the spreadsheet-safety helpers
shared with `apartmentscout export`.

    pack.py      deterministic, checksummed zip of a search (full or delta) for another agent
    verify.py    re-read a pack and check every file against its manifest
    importer.py  apply another agent's updates.json non-destructively and adjudicate each claim
    facts.py     missing facts, landlord questions and coverage counts (also used by export)
    safety.py    spreadsheet formula-injection guard and the default privacy patterns

See docs/guides/agents-handoff.md.
"""
from __future__ import annotations

PACK_SCHEMA = "apartmentscout-handoff/1"
UPDATES_SCHEMA = "apartmentscout-updates/1"
