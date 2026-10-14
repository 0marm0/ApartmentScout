"""Research quality: validation, listing-trap lint, coverage, claims history and the watchlist.

Everything here is pure functions over listings and criteria, so the CLI commands
(``apartmentscout validate | lint | coverage | history``), the dashboard exports and the tests
share one implementation. Nothing here touches the network.
"""
from __future__ import annotations

SCHEMA_VERSION = 1  # listings.json shape this release understands (a bare list is version 1)
