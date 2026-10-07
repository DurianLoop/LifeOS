"""Validate that the supplied ViVi animations and attribution survive packaging."""
from pathlib import Path
import hashlib
import json
import tempfile
import unittest

from backend.vivi_pet import FILES, bundled_item

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'app/assets/pets/vivi'


class ViViPackageTests(unittest.TestCase):
    def test_all_original_animations_match_recorded_hashes(self):
        manifest = json.loads((PACKAGE / 'pet.json').read_text(encoding='utf-8'))
        originals = {item['asset']: item for item in manifest['actions']}
        self.assertEqual(len(originals), 14)
        self.assertEqual({path.name for path in PACKAGE.glob('*.gif')}, set(originals))
        for name, action in originals.items():
            self.assertEqual(hashlib.sha256((PACKAGE / name).read_bytes()).hexdigest(), action['sha256'])
            self.assertEqual(sum(action['frame_durations_ms']), action['duration_ms'])
            self.assertEqual(len(action['frame_durations_ms']), action['frames'])
        self.assertEqual(originals['special0.gif']['duration_ms'], 12200)
        self.assertEqual(originals['special0.gif']['frames'], 236)

    def test_metadata_keeps_native_actions_and_source(self):
        item = bundled_item(ROOT)
        self.assertEqual(item['renderer'], 'vivi-gif')
        self.assertEqual(len(item['actions']), 16)
        self.assertTrue({'walk_left', 'walk_right', 'special0', 'start', 'hide'} <= {a['id'] for a in item['actions']})
        self.assertEqual(item['source_url'], 'https://github.com/DurianLoop/ViVi_diary')
        self.assertTrue(item['builtin'])
        self.assertNotIn('MIT', item['license'])

    def test_new_workspace_copies_only_assets_and_preserves_existing_user_files(self):
        temp_root = ROOT / 'artifacts/v0.5.0'
        temp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='vivi-package-test-', dir=temp_root) as temporary:
            workspace = Path(temporary)
            item = bundled_item(workspace, ROOT)
            self.assertEqual(item['slug'], 'vivi--durianloop')
            folder = workspace / 'app/assets/pets/vivi'
            self.assertEqual({path.name for path in folder.iterdir()}, set(FILES))
            before = (folder / 'sit.gif').read_bytes()
            (folder / 'sit.gif').write_bytes(b'user-preserved-file')
            bundled_item(workspace, ROOT)
            self.assertEqual((folder / 'sit.gif').read_bytes(), b'user-preserved-file')
            self.assertGreater(len(before), 0)
            self.assertFalse((workspace / 'vault').exists())


if __name__ == '__main__':
    unittest.main()
