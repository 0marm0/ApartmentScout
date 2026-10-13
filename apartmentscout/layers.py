"""City-wide map layers beyond commute: NYC 311 noise density (more cities can plug in here)."""
from __future__ import annotations

import datetime as dt
import json
import math
import time

import requests

PAGE = 20000


def nyc_noise_layer(ws, bbox: list[float], months: int = 12, cell_m: float = 150, log=print) -> dict:
    lon0, lat0, lon1, lat1 = bbox
    since = (dt.date.today() - dt.timedelta(days=30 * months)).isoformat()
    url = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
    where = (f"created_date >= '{since}' AND complaint_type like 'Noise%' AND "
             f"latitude between {lat0} and {lat1} AND longitude between {lon0} and {lon1}")
    dlat = cell_m / 110574
    dlon = cell_m / (111320 * math.cos(math.radians((lat0 + lat1) / 2)))
    rows, cols = int((lat1 - lat0) / dlat) + 1, int((lon1 - lon0) / dlon) + 1
    grid = [0] * (rows * cols)
    night = [0] * (rows * cols)
    offset, n = 0, 0
    while True:
        js = None
        for attempt in range(4):
            try:
                r = requests.get(url, params={"$where": where, "$select": "latitude,longitude,created_date",
                                              "$limit": PAGE, "$offset": offset, "$order": ":id"}, timeout=180)
                r.raise_for_status()
                js = r.json()
                break
            except requests.RequestException as e:
                log(f"    retry {attempt + 1}: {str(e)[:80]}")
                time.sleep(3 * (attempt + 1))
        if js is None:
            raise RuntimeError("311 API kept failing; try again later or with --months 6")
        for p in js:
            try:
                la, lo = float(p["latitude"]), float(p["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            ri, ci = int((la - lat0) / dlat), int((lo - lon0) / dlon)
            if 0 <= ri < rows and 0 <= ci < cols:
                grid[ri * cols + ci] += 1
                h = int(p["created_date"][11:13])
                if h >= 22 or h < 6:
                    night[ri * cols + ci] += 1
        n += len(js)
        log(f"    311 noise rows: {n:,}")
        if len(js) < PAGE:
            break
        offset += PAGE
    layer = {"kind": "noise", "name": "311 noise complaints", "months": months, "since": since,
             "bbox": bbox, "rows": rows, "cols": cols, "cell_m": cell_m, "values": grid, "night": night,
             "total": n, "generated": dt.datetime.now().isoformat(timespec="seconds"),
             "source": "https://data.cityofnewyork.us/d/erm2-nwe9"}
    (ws.layers_dir / "noise.json").write_text(json.dumps(layer, separators=(",", ":")))
    return layer
