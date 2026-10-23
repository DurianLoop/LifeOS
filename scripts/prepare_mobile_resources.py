#!/usr/bin/env python3
"""Bundle only audited public application sources, never a user's workspace."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'mobile/src/lifeosmobile/resources'
ALLOW = {'app', 'backend', 'engine', 'importers', 'connectors', 'config', 'marketplace'}


def main():
    subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=ROOT, check=True, capture_output=True)
    subprocess.run([__import__('sys').executable, str(ROOT / 'scripts/public_release_audit.py')], cwd=ROOT, check=True)
    files = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().strip('\0').split('\0')
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    manifest = []
    for name in sorted(set(files)):
        path = Path(name)
        if path.parts[0] not in ALLOW or '__pycache__' in path.parts or 'pet-readme-previews' in path.parts:
            continue
        source = ROOT / path
        if source.is_symlink() or not source.is_file():
            raise ValueError(f'Invalid public resource: {name}')
        if source.suffix.lower() in ('.pyc', '.db', '.sqlite', '.env'):
            raise ValueError(f'Private/generated resource: {name}')
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        manifest.append({'path': name, 'bytes': source.stat().st_size, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    (OUT / 'bundle-manifest.json').write_text(json.dumps({'version': '0.6.1', 'files': manifest}, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'resources': len(manifest), 'bytes': sum(x['bytes'] for x in manifest)}))


if __name__ == '__main__':
    main()
