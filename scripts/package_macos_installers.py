"""Create the native ZIP and a read-only DMG without a writable mount cycle."""
from pathlib import Path
import argparse
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--arch', choices=['arm64', 'x64'], required=True)
args = parser.parse_args()
dist = ROOT / 'desktop/dist'
app = next(dist.glob('*/LifeOS.app'))
subprocess.run(['npx', 'electron-builder', '--mac', 'zip', '--' + args.arch,
    '--config', 'electron-builder.mac.cjs', '--config.compression=normal',
    '--prepackaged', str(app), '--publish', 'never'], cwd=ROOT / 'desktop', check=True)
with tempfile.TemporaryDirectory(prefix='lifeos-dmg-source-') as folder:
    staging = Path(folder)
    subprocess.run(['ditto', str(app), str(staging / 'LifeOS.app')], check=True)
    (staging / 'Applications').symlink_to('/Applications', target_is_directory=True)
    subprocess.run(['hdiutil', 'create', '-volname', 'LifeOS', '-srcfolder', str(staging),
        '-ov', '-format', 'UDZO', str(dist / f'LifeOS-0.6.1-mac-{args.arch}.dmg')], check=True)
