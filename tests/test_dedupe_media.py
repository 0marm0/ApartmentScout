"""scripts/dedupe_media.py: identical images stored once, every reference rewritten, idempotent."""
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("dedupe_media", REPO / "scripts" / "dedupe_media.py")
dm = importlib.util.module_from_spec(spec)
sys.modules["dedupe_media"] = dm
spec.loader.exec_module(dm)


def test_dedupe_moves_shared_images_and_rewrites_keys_and_values(tmp_path: Path) -> None:
    for d, name, data in (("a", "p-1.webp", b"same"), ("b", "p-1.webp", b"same"), ("b", "b-2.webp", b"same"),
                          ("a", "p-9.webp", b"unique")):
        (tmp_path / "media" / d).mkdir(parents=True, exist_ok=True)
        (tmp_path / "media" / d / name).write_bytes(data)
    listings = [{"id": "a", "photos_local": ["media/a/p-1.webp", "media/a/p-9.webp"],
                 "photo_flags": {"media/a/p-1.webp": {"watermark": True}}},
                {"id": "b", "building_photos": [{"local": "media/b/b-2.webp", "url": "https://x/y.jpg"}]}]
    (tmp_path / "listings.json").write_text(json.dumps(listings))
    assert dm.main([str(tmp_path)]) == 0
    out = json.loads((tmp_path / "listings.json").read_text())
    shared = out[0]["photos_local"][0]
    assert shared.startswith("media/shared/") and (tmp_path / shared).read_bytes() == b"same"
    assert out[0]["photos_local"][1] == "media/a/p-9.webp"
    assert out[1]["building_photos"][0]["local"] == shared and list(out[0]["photo_flags"]) == [shared]
    assert not (tmp_path / "media" / "b").exists() and not (tmp_path / "media" / "a" / "p-1.webp").exists()
    assert dm.plan(tmp_path) == {}            # a second run finds nothing to move
