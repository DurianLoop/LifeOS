"""Exercise catalog refresh without opening the user's archive or network."""
from __future__ import annotations

import ast
import datetime
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ast.parse((ROOT / "backend/server.py").read_text(encoding="utf-8"))
FUNCTIONS = ast.Module(body=[node for node in SOURCE.body if isinstance(node, ast.FunctionDef) and node.name in ("pet_license_allowed", "pet_catalog", "pet_status")], type_ignores=[])


class PetCatalogTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.snapshot = self.root / "workspace/config/pet_catalog_cache.json"
        self.bundle = self.root / "resources/config/pet_catalog_cache.json"
        self.bundle.parent.mkdir(parents=True)
        self.bundle.write_bytes((ROOT / "config/pet_catalog_cache.json").read_bytes())
        self.active = "selected-cat--author"
        self.calls = 0
        self.ns = {
            "time": time, "json": json, "os": os, "tempfile": tempfile,
            "Path": Path, "quote": quote, "datetime": datetime,
            "PET_CATALOG_LOCK": threading.RLock(),
            "PET_CATALOG_CACHE": {"at": 0, "items": [], "status": "offline", "checked_at": None},
            "PET_CATALOG_SNAPSHOT": self.snapshot, "PET_BUNDLED_CATALOG": self.bundle,
            "PET_CATALOG_URL": "https://example.test/catalog",
            "PET_PREVIEW_ROOT": self.root / "previews",
            "PET_SLUG": re.compile(r"^[a-z0-9][a-z0-9-]{1,110}$"),
            "ROOT": self.root, "pet_local_items": lambda: [{"slug": self.active}],
            "SOURCE_ROOT":self.root,"vivi_pet":type('ViVi',(),{'bundled_item':staticmethod(lambda *args:None)})(),
            "product": type("Product", (), {"get_setting": lambda _, *args: self.active})(),
        }
        exec(compile(FUNCTIONS, "backend/server.py", "exec"), self.ns)
        self.ns["pet_fetch_bytes"] = self.offline

    def tearDown(self):
        self.directory.cleanup()

    def offline(self, *args):
        self.calls += 1
        raise OSError("offline fixture")

    def test_packaged_offline_uses_bundled_snapshot_and_keeps_selection(self):
        status = self.ns["pet_status"]()
        self.assertEqual(len(status["catalog"]), 268)
        self.assertEqual(status["active_slug"], self.active)
        self.assertEqual(status["catalog_status"], "snapshot")
        self.assertFalse(self.snapshot.exists())
        self.ns["pet_status"]()
        self.assertEqual(self.calls, 0, "opening the shelf never waits for network when a bundled snapshot is available")

    def test_corrupt_working_snapshot_falls_back_to_package(self):
        self.snapshot.parent.mkdir(parents=True)
        self.snapshot.write_text("not valid JSON", encoding="utf-8")
        self.assertEqual(len(self.ns["pet_catalog"]()), 268)
        self.assertEqual(self.calls, 0)

    def test_working_snapshot_is_preferred_without_network(self):
        self.snapshot.parent.mkdir(parents=True)
        records = [{"slug": "new-cat--author", "license": "MIT", "spriteVersionNumber": 2}]
        self.snapshot.write_text(json.dumps(records), encoding="utf-8")
        status = self.ns["pet_status"]()
        self.assertEqual(status["catalog"][0]["slug"], records[0]["slug"])
        self.assertEqual(status["catalog_status"], "cached")
        self.assertEqual(self.calls, 0)

    def test_explicit_failed_refresh_does_not_replace_catalog_or_selection(self):
        original = self.ns["pet_status"]()
        with self.assertRaisesRegex(RuntimeError, "目录更新失败"):
            self.ns["pet_status"](True)
        self.assertEqual(self.ns["PET_CATALOG_CACHE"]["items"], original["catalog"])
        self.assertEqual(self.ns["pet_status"]()["active_slug"], self.active)

    def test_invalid_upstream_preserves_previous_cache(self):
        self.snapshot.parent.mkdir(parents=True)
        self.snapshot.write_bytes(self.bundle.read_bytes())
        before = self.snapshot.read_bytes()
        self.ns["pet_catalog"]()
        self.ns["pet_fetch_bytes"] = lambda *args: b'{"unexpected":"shape"}'
        with self.assertRaises(RuntimeError):
            self.ns["pet_catalog"](True)
        self.assertEqual(self.snapshot.read_bytes(), before)
        self.assertEqual(len(self.ns["PET_CATALOG_CACHE"]["items"]), 268)

    def test_successful_refresh_writes_cache_with_attribution_and_preserves_selection(self):
        records = [
            {"slug": "mit-cat--author", "name": "Cat", "author": "Author", "license": "MIT", "spriteVersionNumber": 2},
            {"slug": "open-cat--author", "license": "CC BY 4.0", "spriteVersionNumber": 1},
            {"slug": "private-cat--author", "license": "仅限非商业使用。", "spriteVersionNumber": 1},
            {"slug": "unknown-cat--author", "license": "Unknown license; no explicit repository redistribution license"},
            {"slug": "future-cat--author", "license": "MIT", "spriteVersionNumber": 3},
        ]
        self.ns["pet_fetch_bytes"] = lambda *args: json.dumps(records).encode()
        status = self.ns["pet_status"](True)
        self.assertEqual([x["slug"] for x in status["catalog"]], [x["slug"] for x in records[:3]])
        self.assertEqual(status["catalog_status"], "online")
        self.assertEqual(status["active_slug"], self.active)
        self.assertEqual(json.loads(self.snapshot.read_text()), records)
        self.assertEqual(status["catalog"][0]["author"], "Author")
        self.assertIn("/pets/mit-cat--author", status["catalog"][0]["source_url"])
        self.assertEqual(list(self.snapshot.parent.glob(".pet-catalog-*.tmp")), [])

    def test_locked_cache_and_failed_cleanup_still_return_online_catalog(self):
        records = [{"slug": "locked-cat--author", "license": "MIT", "spriteVersionNumber": 2}]
        self.ns["pet_fetch_bytes"] = lambda *args: json.dumps(records).encode()
        with patch("os.replace", side_effect=PermissionError("locked cache")), patch("pathlib.Path.unlink", side_effect=PermissionError("locked temporary file")):
            status = self.ns["pet_status"](True)
        self.assertEqual(status["catalog"][0]["slug"], records[0]["slug"])
        self.assertEqual(status["catalog_status"], "online")
        self.assertEqual(status["active_slug"], self.active)


if __name__ == "__main__":
    unittest.main()
