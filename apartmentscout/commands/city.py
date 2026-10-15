"""`apartmentscout city`: tell a search which city it is in, and what that city does and does not have. [onboarding]

    apartmentscout city                          show this search's city, time zone, map centre, transit feeds and gaps
    apartmentscout city "Chicago, IL"            look the city up and set it (city id, name, time zone, map centre)
    apartmentscout city --starter                add the starter transit feeds listed for the city
    apartmentscout city --feed URL [--name N]    check a GTFS zip (a web address or a file) and add it
    apartmentscout city "Lisbon" --write-profile write config/cities/lisbon.yaml (to share the setup as a profile)

Setting a city edits criteria.yaml in place (comments stay; the old file goes to backups/). It never invents transit
feeds: the starter list in config/transit-feeds.yaml holds only feeds that were fetched and checked, and any other feed is
tested before it is written.
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import replace
from pathlib import Path

import yaml

from .. import cities as C
from ..criteria_check import check_text
from ..criteria_edit import add_transit_feeds, feeds_in, set_search_fields, write_with_backup


def _say(*a: object) -> None:
    print(*a, flush=True)


def _has_search(args: argparse.Namespace) -> bool:
    given = getattr(args, "search", None) or os.environ.get("APARTMENTSCOUT_SEARCH")
    return bool(given) and (Path(given).expanduser() / "criteria.yaml").exists()


def describe(info: C.CityInfo, feeds: list[dict], say=_say) -> None:
    """Print the city card: where it is, and what a search there has and lacks."""
    say(f"{info.name}  (city id: {info.id}{', profile: yes' if info.profile else ', no profile'})")
    if info.timezone:
        say(f"  time zone   {info.timezone}")
    if info.center:
        say(f"  map centre  {info.center[0]}, {info.center[1]}")
    if info.osm:
        say(f"  OpenStreetMap area  https://www.openstreetmap.org/{info.osm}")
    plan = C.coverage_notes(info, feeds)
    say("  works here:")
    for line in plan.have:
        say(f"    + {line}")
    if plan.missing:
        say("  not here (yet):")
        for line in plan.missing:
            say(f"    - {line}")


def feed_hints(info: C.CityInfo, say=_say) -> None:
    starters = C.starter_feeds(info)
    if starters and not info.profile:
        say("  Starter transit feeds for this city (fetched and checked; add them with `apartmentscout city --starter`):")
        for f in starters:
            say(f"    {f['name']}: {f['url']}")
    elif not starters and not info.profile:
        say("  No starter feed is listed for this city. Find your agency's GTFS zip:")
        for label, url in C.search_links(info):
            say(f"    {label}" + (f": {url}" if url else ""))
        say("  then: apartmentscout city --feed https://.../gtfs.zip")


def _write_profile(info: C.CityInfo, feeds: list[dict], force: bool) -> Path:
    path = C.CITIES_DIR / f"{info.id}.yaml"
    if path.exists() and not force:
        sys.exit(f"{path} already exists (use --force to replace it).")
    doc: dict = {"name": info.name.split(",")[0], "country": info.country, "center": info.center, "zoom": info.zoom,
                 "timezone": info.timezone, "osm_area": info.osm,
                 "transit_feeds": feeds or None,
                 "walk_model": "network"}
    doc = {k: v for k, v in doc.items() if v}
    head = (f"# City profile: {info.name}. Written by `apartmentscout city --write-profile`.\n"
            "# A minimal profile: time zone, map centre, transit feeds and the OpenStreetMap area. Add records, layers and\n"
            "# neighbourhood data as in config/cities/nyc.yaml (see docs/guides/new-city.md).\n")
    path.write_text(head + yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, default_flow_style=None, width=120), encoding="utf-8")
    return path


def cmd_city(args: argparse.Namespace) -> None:
    from ..cli import ws_from
    ws = ws_from(args) if _has_search(args) else None
    crit = ws.criteria() if ws else {}
    cur = (crit.get("search") or {}) if ws else {}
    place = (args.place or "").strip()

    if place:
        info = C.resolve_city(place)
        if info is None:
            sys.exit(f"Could not find {place!r} on OpenStreetMap (or the network is unavailable). Check the spelling, "
                     "add the state or country (\"Portland, Oregon\"), or set search.city, search.timezone and "
                     "search.map_center in criteria.yaml by hand.")
        if args.timezone:
            if not C.valid_timezone(args.timezone):
                sys.exit(f"{args.timezone!r} is not an IANA time zone (for example America/Chicago).")
            info = replace(info, timezone=args.timezone)
    elif ws:
        pid = cur.get("city")
        info = C.from_profile(pid) if pid and C.load_profile(pid) else C.CityInfo(
            id=pid or "generic", name=cur.get("city_name") or (pid or "generic"), lat=None, lon=None, timezone=cur.get("timezone"),
            osm=None, source="typed")
        mc = cur.get("map_center")
        if mc and info.center is None:
            info = replace(info, lat=float(mc[0]), lon=float(mc[1]))
    else:
        sys.exit("Give a city (apartmentscout city \"Chicago, IL\") or run this inside a search (--search DIR).")

    feeds = feeds_in(ws.criteria_path.read_text(encoding="utf-8")) if ws else []
    new_feeds: list[dict] = []
    for url in args.feed or []:
        chk = C.check_feed(url)
        if not chk.ok:
            sys.exit(f"{url}: {chk.detail}. Nothing was changed.")
        _say(f"  feed {url}: {chk.detail}" + (f", {chk.size_mb} MB" if chk.size_mb else ""))
        new_feeds.append(C.feed_entry(url, args.name, args.mode))
    if args.starter:
        starters = C.starter_feeds(info)
        if not starters:
            _say("  No starter feeds are listed for this city" + (" (its profile already has the feeds)" if info.profile else "") + ".")
        new_feeds += starters

    describe(info, feeds + new_feeds)
    if not (feeds or new_feeds):
        feed_hints(info)

    if args.write_profile:
        if not place:
            sys.exit("--write-profile needs a city name: apartmentscout city \"Lisbon\" --write-profile")
        _say(f"Wrote {_write_profile(info, new_feeds or C.starter_feeds(info), args.force)}")

    if not ws or args.dry_run or not (place or new_feeds):
        if place and not ws:
            _say("\nTo use it, run this inside a search (--search DIR) or put the id and time zone in criteria.yaml yourself.")
        return
    text = ws.criteria_path.read_text(encoding="utf-8")
    out = text
    if place:
        out = set_search_fields(out, C.search_fields(info)) or out
        if out == text and C.search_fields(info) != {k: cur.get(k) for k in C.search_fields(info)}:
            _say("  Could not edit the search block in place; set these under `search:` yourself:")
            for k, v in C.search_fields(info).items():
                _say(f"    {k}: {v}")
    if new_feeds:
        added = add_transit_feeds(out, new_feeds)
        if added is None:
            _say("  Could not edit commute.transit.feeds in place; add these yourself:")
            for f in new_feeds:
                _say(f"    - {f}")
        else:
            out = added
    rep = check_text(out)
    if not rep.ok:
        sys.exit("The edited criteria.yaml would not pass the checks, so nothing was written:\n  " + "\n  ".join(rep.errors))
    if out != text:
        backup = write_with_backup(ws.criteria_path, out)
        _say(f"\nSaved {ws.criteria_path}" + (f" (the old file is in backups/{backup.name})" if backup else ""))
        _say("Next: apartmentscout geocode, then apartmentscout commute (or apartmentscout all).")
    else:
        _say("\ncriteria.yaml already says this; nothing to change.")


def register(add) -> None:
    s = add("city", cmd_city, "set or show the city: time zone, map centre, transit feeds and what is missing for it")
    s.add_argument("place", nargs="?", help="a city name, for example \"Chicago, IL\" or \"Lisbon\"")
    s.add_argument("--feed", action="append", metavar="URL", help="a GTFS zip (web address or file) to check and add; repeatable")
    s.add_argument("--name", help="name for the --feed (default: taken from the address)")
    s.add_argument("--mode", choices=["subway", "bus", "rail", "ferry"], help="the --feed's mode (default: each route's GTFS route_type)")
    s.add_argument("--starter", action="store_true", help="add the starter transit feeds listed for the city")
    s.add_argument("--timezone", help="IANA time zone to use instead of the guess")
    s.add_argument("--write-profile", action="store_true", help="write config/cities/<id>.yaml (a minimal profile) for this city")
    s.add_argument("--force", action="store_true", help="replace an existing profile file")
    s.add_argument("--dry-run", action="store_true", help="show what would change without writing criteria.yaml")
