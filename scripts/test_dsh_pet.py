"""Check the original DSH package and its offline install/remove lifecycle."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend import dsh_pet
from scripts import test_pet_removal

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'app/assets/pets/dsh-pet'


class DSHPackageTests(unittest.TestCase):
    def test_original_assets_and_behavior_pools(self):
        manifest = json.loads((PACKAGE / 'pet.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['actions']), 106)
        self.assertEqual(len({row['id'] for row in manifest['actions']}), 106)
        self.assertEqual({row['asset'] for row in manifest['actions']}, {path.name for path in PACKAGE.glob('*.webm')})
        for row in manifest['actions']:
            self.assertEqual(hashlib.sha256((PACKAGE / row['asset']).read_bytes()).hexdigest(), row['sha256'])
        behavior = manifest['behavior']
        self.assertEqual(sum(behavior['weights'].values()) + sum(row['weight'] for row in behavior['categories']), 100)
        self.assertEqual(len(behavior['clicks']), 5)
        self.assertEqual(len(behavior['moves']), 3)
        self.assertTrue(next(row for row in behavior['categories'] if row['id'] == '文字')['noMirror'])

    def test_package_copy_preserves_user_files_and_restrictive_terms(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            item = dsh_pet.bundled_item(workspace, ROOT)
            self.assertEqual(item['renderer'], 'dsh-webm')
            self.assertEqual(len(item['actions']), 106)
            self.assertIn('禁止商用', item['license'])
            folder = workspace / 'app/assets/pets/dsh-pet'
            self.assertIn(item['source_url'], (folder / 'ATTRIBUTION.md').read_text(encoding='utf-8'))
            self.assertTrue((folder / 'preview.png').is_file())
            target = folder / item['actions'][0]['asset']
            target.write_bytes(b'preserved-user-asset')
            dsh_pet.bundled_item(workspace, ROOT)
            self.assertEqual(target.read_bytes(), b'preserved-user-asset')
            self.assertFalse((workspace / 'vault').exists())

    def test_offline_remove_restore_keeps_selected_pet_and_source_assets(self):
        fixture = test_pet_removal.RemovalTests()
        fixture.setUp()
        try:
            fixture.ns.update(dsh_pet=dsh_pet, SOURCE_ROOT=ROOT, APP=ROOT / 'app')
            fixture.ns['product'].set_settings({'pet.active_slug': dsh_pet.SLUG}, fixture.root)
            status = fixture.ns['pet_status']()
            self.assertEqual(status['active_slug'], dsh_pet.SLUG)
            self.assertEqual(status['catalog'][0]['source_url'], 'https://github.com/PC2005-cloud/dsh-pet')
            fixture.ns['uninstall_pet'](dsh_pet.SLUG)
            self.assertFalse(any(row['slug'] == dsh_pet.SLUG for row in fixture.ns['pet_local_items']()))
            fixture.ns['install_pet'](dsh_pet.SLUG)
            self.assertEqual(fixture.ns['pet_status']()['active_slug'], dsh_pet.SLUG)
        finally:
            fixture.tearDown()


if __name__ == '__main__':
    unittest.main()
