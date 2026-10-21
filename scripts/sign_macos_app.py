#!/usr/bin/env python3
"""Sign embedded native libraries and bundles from the inside out, ad-hoc."""
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile

app = Path(sys.argv[1]).resolve()
assert sys.platform == 'darwin' and app.name == 'LifeOS.app' and app.is_dir()
magic = {bytes.fromhex(value) for value in (
    'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca')}
signed = []
for file in sorted(app.rglob('*'), key=lambda p: len(p.parts), reverse=True):
    if file.is_symlink() or not file.is_file():
        continue
    with file.open('rb') as source:
        if source.read(4) not in magic:
            continue
    subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(file)], check=True)
    signed.append(file)
with tempfile.TemporaryDirectory(prefix='lifeos-entitlements-') as folder:
    entitlements = Path(folder) / 'entitlements.plist'
    entitlements.write_bytes(plistlib.dumps({
        'com.apple.security.cs.allow-jit': True,
        'com.apple.security.cs.allow-unsigned-executable-memory': True,
        'com.apple.security.cs.disable-library-validation': True,
        'com.apple.security.device.audio-input': True,
        'com.apple.security.device.camera': True,
    }))
    bundles = [p for p in app.rglob('*') if not p.is_symlink() and p.is_dir()
               and p.suffix in ('.app', '.framework')]
    for bundle in sorted(bundles, key=lambda p: len(p.parts), reverse=True) + [app]:
        subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none',
                        '--entitlements', str(entitlements), str(bundle)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
print(f'Verified ad-hoc signature: {len(signed)} native files and {len(bundles) + 1} bundles')
