#!/usr/bin/env python3
"""Prepare a checksum-pinned, relocatable native Python for the Mac installer."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = '3.13.16'
RELEASE = '20261003'
BUILDS = {
    'arm64': ('aarch64', 'd8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933'),
    'x64': ('x86_64', '8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f'),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', choices=BUILDS, required=True)
    args = parser.parse_args()
    machine, expected = BUILDS[args.arch]
    native = 'arm64' if args.arch == 'arm64' else 'x86_64'
    if platform.system() != 'Darwin' or platform.machine() != native:
        raise SystemExit('Build Python on the matching native macOS runner')
    target = ROOT / 'desktop' / 'python-runtime'
    if target.exists():
        raise SystemExit('Refusing to overwrite an existing Python runtime')
    url = (f'https://github.com/astral-sh/python-build-standalone/releases/download/{RELEASE}/'
           f'cpython-{VERSION}%2B{RELEASE}-{machine}-apple-darwin-install_only.tar.gz')
    with tempfile.TemporaryDirectory(prefix='lifeos-python-') as folder:
        archive = Path(folder) / 'python.tar.gz'
        urllib.request.urlretrieve(url, archive)
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit('Python runtime archive checksum mismatch')
        with tarfile.open(archive) as bundle:
            bundle.extractall(folder, filter='data')
        runtime = Path(folder) / 'python'
        for link in runtime.rglob('*'):
            if link.is_symlink() and not link.resolve().is_relative_to(runtime.resolve()):
                raise SystemExit('Python runtime contains an external symbolic link')
        # rename cannot cross the runner's temporary filesystem boundary.
        import shutil
        shutil.copytree(runtime, target, symlinks=True)
    python = target / 'bin' / 'python3'
    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                    '-r', str(ROOT / 'requirements.txt'), 'Pillow==12.0.0'], check=True)
    subprocess.run([str(python), '-c',
                    'import ssl,sqlite3,cryptography,cffi,keyring,qrcode,PIL; '
                    'import platform; print("Bundled Python:", platform.machine())'], check=True)
    packages = json.loads(subprocess.check_output(
        [str(python), '-m', 'pip', 'list', '--format=json'], text=True))
    (target / 'LIFEOS_RUNTIME.json').write_text(json.dumps({
        'python': VERSION, 'arch': args.arch, 'source': url,
        'archive_sha256': expected, 'packages': packages,
    }, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
