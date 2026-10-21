"""The pinned, attributed DSH WebM package, independent of its original host."""
from pathlib import Path
import json
import re
import shutil

SLUG = 'dsh-pet--pc2005-cloud'
ASSET = re.compile(r'^anim-[a-f0-9]{12}\.webm$')


def bundled_item(root: Path, source_root: Path | None = None):
    source = Path(source_root or root) / 'app/assets/pets/dsh-pet'
    destination = Path(root) / 'app/assets/pets/dsh-pet'
    manifest_path = source / 'pet.json'
    if not manifest_path.is_file():
        return None
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    files = {'pet.json', 'LICENSE', 'ATTRIBUTION.md', 'preview.png'}
    files.update(row['asset'] for row in manifest['actions'] if ASSET.fullmatch(row.get('asset', '')))
    if source.resolve() != destination.resolve():
        destination.mkdir(parents=True, exist_ok=True)
        for name in files:
            target, original = destination / name, source / name
            if not target.exists() and original.is_file():
                shutil.copy2(original, target)
    actions = [{**row, 'asset_url': '/assets/pets/dsh-pet/' + row['asset']}
               for row in manifest['actions']
               if ASSET.fullmatch(row.get('asset', '')) and (destination / row['asset']).is_file()]
    default = next((row for row in actions if row['id'] == manifest['defaultAction']), None)
    if not default:
        return None
    return {'slug': SLUG, 'folder': 'dsh-pet', 'name': manifest['displayName'],
            'author': 'PC2005-cloud', 'license': '素材禁止商用 · 须保留原作链接',
            'description': manifest['description'], 'renderer': 'dsh-webm',
            'manifest_url': '/assets/pets/dsh-pet/pet.json', 'asset_url': default['asset_url'],
            'preview_url': '/assets/pets/dsh-pet/preview.png', 'builtin': True,
            'primary_category': 'LifeOS', 'actions': actions,
            'settings': manifest['settings'], 'behavior': manifest['behavior'],
            'source_url': manifest['source']['repository'], 'source_commit': manifest['source']['commit'],
            'defaultAction': manifest['defaultAction']}
