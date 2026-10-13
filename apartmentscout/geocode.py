"""Address geocoding with a disk cache.

Providers (no API keys needed):

* ``nyc``      NYC Planning Labs GeoSearch. Also returns BBL and BIN, which unlock
               the NYC building-records modules.
* ``census``   US Census geocoder. Any US street address.
* ``nominatim``OpenStreetMap Nominatim. Worldwide; limited to 1 request per second.

``auto`` tries nyc (when the search city is nyc), then census, then nominatim.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

UA = {"User-Agent": "ApartmentScout/0.1 (+https://github.com/apartmentscout)"}


class Geocoder:
    def __init__(self, cache_file: Path | None = None, city: str | None = None):
        self.cache_file = cache_file
        self.city = (city or "").lower()
        self.cache: dict[str, dict] = {}
        if cache_file and cache_file.exists():
            self.cache = json.loads(cache_file.read_text())
        self._last_nominatim = 0.0

    def save(self) -> None:
        if self.cache_file:
            self.cache_file.write_text(json.dumps(self.cache, indent=1))

    def geocode(self, address: str, provider: str = "auto") -> dict | None:
        key = f"{provider}|{address.strip().lower()}"
        if key in self.cache:
            return self.cache[key]
        order = [provider] if provider != "auto" else (
            (["nyc"] if self.city == "nyc" else []) + ["census", "nominatim"])
        res = None
        for p in order:
            try:
                res = getattr(self, f"_{p}")(address)
            except requests.RequestException:
                res = None
            if res:
                res["provider"] = p
                break
        self.cache[key] = res
        return res

    # --- providers -------------------------------------------------------
    def _nyc(self, address: str) -> dict | None:
        r = requests.get("https://geosearch.planninglabs.nyc/v2/search",
                         params={"text": address, "size": 1}, headers=UA, timeout=20)
        r.raise_for_status()
        feats = r.json().get("features") or []
        if not feats:
            return None
        f = feats[0]
        lon, lat = f["geometry"]["coordinates"]
        props = f.get("properties", {})
        pad = props.get("addendum", {}).get("pad", {})
        return {"lat": lat, "lon": lon, "label": props.get("label"),
                "bbl": pad.get("bbl"), "bin": pad.get("bin"),
                "confidence": props.get("confidence")}

    def _census(self, address: str) -> dict | None:
        r = requests.get("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
                         params={"address": address, "benchmark": "Public_AR_Current", "format": "json"},
                         headers=UA, timeout=30)
        r.raise_for_status()
        m = r.json().get("result", {}).get("addressMatches") or []
        if not m:
            return None
        c = m[0]["coordinates"]
        return {"lat": c["y"], "lon": c["x"], "label": m[0].get("matchedAddress")}

    def _nominatim(self, address: str) -> dict | None:
        wait = 1.05 - (time.time() - self._last_nominatim)
        if wait > 0:
            time.sleep(wait)
        self._last_nominatim = time.time()
        r = requests.get("https://nominatim.openstreetmap.org/search",
                         params={"q": address, "format": "json", "limit": 1}, headers=UA, timeout=30)
        r.raise_for_status()
        js = r.json()
        if not js:
            return None
        return {"lat": float(js[0]["lat"]), "lon": float(js[0]["lon"]), "label": js[0].get("display_name")}


def geocode_listings(listings: list[dict], cache_file: Path, city: str | None,
                     provider: str = "auto", force: bool = False, log=print) -> int:
    g = Geocoder(cache_file, city)
    n = 0
    try:
        for L in listings:
            if not force and L.get("lat") is not None and L.get("lon") is not None and (city != "nyc" or L.get("bbl")):
                continue
            addr = L.get("address")
            if not addr:
                continue
            res = g.geocode(addr, provider)
            if not res:
                log(f"  no match: {addr}")
                continue
            if force or L.get("lat") is None:
                L["lat"], L["lon"] = round(res["lat"], 6), round(res["lon"], 6)
            for k in ("bbl", "bin"):
                if res.get(k):
                    L[k] = str(res[k])
            n += 1
    finally:
        g.save()
    return n
