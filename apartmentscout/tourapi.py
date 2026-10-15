"""The tour-findings half of the local API (see localapi.py for the guards every call passes first: loopback host, no foreign
Origin, the per-run token).

Findings are written to ``<search>/tours/<listing id>/findings.json`` and the photos the renter takes during a visit to
``<search>/tours/<listing id>/photos/<id>.webp``. Everything is validated before it touches the disk:

* a listing id is a plain slug, never a path (``tours.TOUR_ID``), and every resolved path must stay directly inside the
  tours folder;
* a photo is a raw image body of at most ``MAX_PHOTO_BYTES`` that Pillow can decode within ``MAX_PIXELS``; it is rotated by its
  EXIF orientation, shrunk to ``MAX_EDGE`` pixels, and written as WebP without any metadata (so no GPS position travels), never
  as the bytes the browser sent;
* a home holds at most ``tours.MAX['photos']`` photos and the whole tours folder at most ``MAX_TOTAL_BYTES``.
"""
from __future__ import annotations

import io
import os
import secrets
import threading
from pathlib import Path
from typing import Any

from . import tours

MAX_PHOTO_BYTES = 12 * 1024 * 1024      # what the browser may send for one photo
MAX_PIXELS = 60_000_000                  # decoded size we are willing to open (a 60 MP photo)
MAX_EDGE = 1600                          # longest side kept
WEBP_QUALITY = 82
MAX_TOTAL_BYTES = 400 * 1024 * 1024      # all visits in one search
ACCEPTED = {"JPEG", "PNG", "WEBP", "MPO"}


class TourError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status, self.message = status, message


def pillow_available() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return True


def reencode(data: bytes) -> tuple[bytes, int, int]:
    """Decode an uploaded image and return (WebP bytes, width, height). Raises TourError for anything that is not a photo."""
    try:
        from PIL import Image, ImageOps
    except ImportError as e:
        raise TourError(501, "Saving photos needs Pillow: pip install 'apartmentscout[images]'.") from e
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in ACCEPTED:
                raise TourError(415, "That is not a JPEG, PNG or WebP photo.")
            if im.width * im.height > MAX_PIXELS:
                raise TourError(413, "That photo has too many pixels.")
            im = ImageOps.exif_transpose(im)
            has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
            if has_alpha:
                rgba = im.convert("RGBA")
                bg = Image.new("RGB", rgba.size, (255, 255, 255))
                bg.paste(rgba, mask=rgba.getchannel("A"))
                im = bg
            else:
                im = im.convert("RGB")
            im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=WEBP_QUALITY, method=4)   # no exif= argument: metadata is dropped
            return buf.getvalue(), im.width, im.height
    except TourError:
        raise
    except Image.DecompressionBombError as e:
        raise TourError(413, "That photo has too many pixels.") from e
    except Exception as e:  # noqa: BLE001 - truncated or hostile files surface as many Pillow errors
        raise TourError(415, "That file could not be read as a photo.") from e


class TourFiles:
    """Reads and writes one search folder's ``tours/`` tree. All writes go through ``lock``."""

    def __init__(self, root: Path, lock: threading.RLock) -> None:
        self.root, self.lock = root.resolve(), lock

    # -- paths
    def _id(self, listing_id: Any) -> str:
        if not isinstance(listing_id, str) or not tours.TOUR_ID.match(listing_id) or listing_id.endswith("."):
            raise TourError(400, "Unknown listing id.")
        return listing_id

    def home_dir(self, listing_id: str) -> Path:
        d = (tours.tours_dir(self.root) / self._id(listing_id))
        base = tours.tours_dir(self.root).resolve()
        if d.is_symlink() or d.resolve().parent != base:
            raise TourError(403, "That folder is outside the tours folder.")
        return d

    def photo_path(self, listing_id: str, photo_id: str) -> Path:
        if not isinstance(photo_id, str) or not tours.PHOTO_ID.match(photo_id):
            raise TourError(400, "Unknown photo.")
        return self.home_dir(listing_id) / "photos" / f"{photo_id}.webp"

    # -- reads
    def _with_disk_photos(self, listing_id: str, f: dict[str, Any]) -> dict[str, Any]:
        """The record with its photo list limited to files that exist (a deleted file cannot linger in the list)."""
        have = [p for p in f.get("photos", []) if p.get("store") == "disk" and self.photo_path(listing_id, p["id"]).is_file()]
        out = {k: v for k, v in f.items() if k != "photos"}
        if have:
            out["photos"] = have
        return out

    def get(self, listing_id: str) -> dict[str, Any]:
        f = tours.read_findings(self.root, self._id(listing_id)) or {"v": tours.VERSION}
        return self._with_disk_photos(listing_id, f)

    def all(self) -> dict[str, dict[str, Any]]:
        out = {}
        for lid, f in tours.load_all(self.root).items():
            out[lid] = self._with_disk_photos(lid, f)
        return out

    # -- writes
    def save(self, listing_id: str, findings: Any) -> dict[str, Any]:
        """Validate and write one home's findings. Photos that are not files in this folder are dropped from the record: the
        photo endpoints are the only way a photo gets on the list."""
        self._id(listing_id)
        if not isinstance(findings, dict):
            raise TourError(400, "findings must be a JSON object.")
        with self.lock:
            n = tours.normalize({**findings, "photos": [p for p in findings.get("photos", []) if isinstance(p, dict)]})
            n["photos"] = [p for p in n.get("photos", []) if p.get("store") == "disk" and self.photo_path(listing_id, p["id"]).is_file()]
            if not n["photos"]:
                n.pop("photos")
            try:
                return tours.write_findings(self.root, listing_id, n)
            except (OSError, ValueError) as e:
                raise TourError(403, "Could not write that visit inside the search folder.") from e

    def _used_bytes(self) -> int:
        total = 0
        base = tours.tours_dir(self.root)
        if base.is_dir():
            for dirpath, _dirs, files in os.walk(base):
                for fn in files:
                    try:
                        total += (Path(dirpath) / fn).stat().st_size
                    except OSError:
                        continue
        return total

    def add_photo(self, listing_id: str, data: bytes) -> dict[str, Any]:
        """Re-encode a photo to WebP, store it, and add it to the home's record. Returns the photo's entry."""
        self._id(listing_id)
        if not data:
            raise TourError(400, "No photo was sent.")
        if len(data) > MAX_PHOTO_BYTES:
            raise TourError(413, f"That photo is larger than {MAX_PHOTO_BYTES // (1024 * 1024)} MB.")
        webp, w, h = reencode(data)
        with self.lock:
            cur = self.get(listing_id)
            if len(cur.get("photos", [])) >= tours.MAX["photos"]:
                raise TourError(409, f"A visit holds at most {tours.MAX['photos']} photos.")
            if self._used_bytes() + len(webp) > MAX_TOTAL_BYTES:
                raise TourError(507, "The tours folder is full. Delete photos you no longer need.")
            pid = secrets.token_hex(6)
            p = self.photo_path(listing_id, pid)
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.parent / f".{pid}.tmp"
            try:
                tmp.write_bytes(webp)
                os.replace(tmp, p)
            finally:
                tmp.unlink(missing_ok=True)
            entry = {"id": pid, "store": "disk", "w": w, "h": h, "bytes": len(webp), "at": tours_now()}
            rec = tours.write_findings(self.root, listing_id, {**cur, "photos": [*cur.get("photos", []), entry], "updated": tours_now()})
            return next(x for x in rec["photos"] if x["id"] == pid)

    def delete_photo(self, listing_id: str, photo_id: str) -> dict[str, Any]:
        with self.lock:
            p = self.photo_path(listing_id, photo_id)
            if not p.is_file():
                raise TourError(404, "No such photo.")
            p.unlink()
            cur = self.get(listing_id)
            return tours.write_findings(self.root, listing_id, {**cur, "photos": [x for x in cur.get("photos", []) if x["id"] != photo_id], "updated": tours_now()})


def tours_now() -> str:
    import datetime as dt
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
