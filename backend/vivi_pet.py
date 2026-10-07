"""Metadata for the user-supplied ViVi GIF package; no diary/AI code is imported."""
from pathlib import Path
import json
import shutil

SLUG = 'vivi--durianloop'
FILES = ('pet.json', 'submission.json', 'LICENSE.md', 'preview.png',
         'sit.gif', 'move.gif', 'interact.gif', 'relax.gif', 'fly.gif',
         'sleep.gif', 'special.gif', 'special0.gif', 'special1.gif',
         'sweat.gif', 'hide.gif', 'jump.gif', 'die.gif', 'start.gif')


def bundled_item(root: Path, source_root: Path | None = None):
    """Ensure missing bundled files and return a normal pet record with renderer metadata.

    Existing user files are preserved. Only the fixed public package allowlist is
    copied, rather than the source diary application or arbitrary repository files.
    """
    root = Path(root)
    source_root = Path(source_root or root)
    source = source_root / 'app/assets/pets/vivi'
    destination = root / 'app/assets/pets/vivi'
    if source.resolve() != destination.resolve():
        destination.mkdir(parents=True, exist_ok=True)
        for name in FILES:
            target = destination / name
            original = source / name
            if not target.exists() and original.is_file():
                shutil.copy2(original, target)
    manifest_path = destination / 'pet.json'
    if not manifest_path.is_file():
        return None
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    actions = []
    for item in manifest.get('actions', []):
        asset = item.get('asset')
        if asset not in FILES or not asset.endswith('.gif'):
            continue
        if not (destination / asset).is_file():
            continue
        actions.append({**item, 'asset_url': '/assets/pets/vivi/' + asset})
    if not actions:
        return None
    return {'slug': SLUG, 'folder': 'vivi', 'name': 'ViVi', 'author': 'DurianLoop',
            'license': 'Author-provided assets; see package attribution',
            'description': 'ViVi Diary 的原生 GIF 桌宠，保留全部动作与自动陪伴交互',
            'renderer': 'vivi-gif', 'manifest_url': '/assets/pets/vivi/pet.json',
            'asset_url': '/assets/pets/vivi/sit.gif',
            'preview_url': '/assets/pets/vivi/preview.png', 'builtin': True,
            'primary_category': 'LifeOS', 'actions': actions,
            'settings': manifest.get('settings', {}), 'source_url': manifest['source']['repository'],
            'source_commit': manifest['source']['commit'], 'defaultAction': 'sit'}
