#!/usr/bin/env python3
"""Validate the final ZIP/DMG, relocated runtime, backend and native Mac app."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '1ca8858ea3fcb752b7af065aa0de8f4c11ff514a'


def run(*command, **kwargs):
    return subprocess.check_output(command, text=True, **kwargs).strip()


def inspect_app(app: Path, arch: str) -> dict:
    native = 'arm64' if arch == 'arm64' else 'x86_64'
    resources = app / 'Contents' / 'Resources'
    with (app / 'Contents' / 'Info.plist').open('rb') as source:
        info = plistlib.load(source)
    assert info['CFBundleShortVersionString'] == '0.5.2', info
    assert info['NSCameraUsageDescription'] and info['NSMicrophoneUsageDescription']
    assert native in run('lipo', '-archs', str(app / 'Contents' / 'MacOS' / 'LifeOS')).split()
    python = resources / 'python' / 'bin' / 'python3'
    assert native in run('lipo', '-archs', str(python)).split()
    assert run(str(python), '-c', 'import platform;print(platform.machine())') == native
    run(str(python), '-c', 'import ssl,sqlite3,cryptography,cffi,keyring,qrcode,PIL')
    for link in (resources / 'python').rglob('*'):
        if link.is_symlink():
            assert link.resolve().is_relative_to((resources / 'python').resolve()), str(link)
    run('codesign', '--verify', '--deep', '--strict', str(app))
    signature = subprocess.run(['codesign', '-dv', str(app)], capture_output=True, text=True, check=True)
    assert 'Signature=adhoc' in signature.stderr, signature.stderr
    for private in ('vault', 'data', '.lifeos', '.env'):
        assert not (resources / private).exists(), private
    assert not list(resources.rglob('*.db'))
    runtime = json.loads((resources / 'python' / 'LIFEOS_RUNTIME.json').read_text())
    assert runtime['arch'] == arch
    return {'version': info['CFBundleShortVersionString'], 'arch': arch,
            'minimum_macos': info.get('LSMinimumSystemVersion'), 'signature': 'ad-hoc',
            'notarized': False, 'runtime': runtime}


def native_smoke(app: Path, root: Path) -> dict:
    workspace = root / 'native-workspace'
    workspace.mkdir()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('LIFEOS_', 'PYTHON')) and key != 'ELECTRON_RUN_AS_NODE'}
    env.update(LIFEOS_ROOT=str(workspace), LIFEOS_PORT=str(port), LIFEOS_DESKTOP_DEBUG='1',
               ELECTRON_ENABLE_LOGGING='1',
               PYTHON_KEYRING_BACKEND='keyring.backends.null.Keyring')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    process = None
    with (root / 'native-launch.log').open('wb') as log:
        try:
            process = subprocess.Popen([str(app / 'Contents' / 'MacOS' / 'LifeOS')],
                                       env=env, stdout=log, stderr=log)
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                assert process.poll() is None, 'Final native LifeOS executable exited during startup'
                try:
                    with opener.open(f'http://127.0.0.1:{port}/api/health', timeout=2) as response:
                        health = json.load(response)
                    if health.get('ok') is True:
                        break
                except OSError:
                    pass
                time.sleep(.25)
            else:
                raise AssertionError('Final native LifeOS executable failed its health check')
            assert health['mode'] == 'local-first'
            assert (workspace / 'data' / 'lifeos.db').is_file()
            assert (workspace / '.lifeos' / 'core.db').is_file()
            with opener.open(f'http://127.0.0.1:{port}/api/entries', timeout=10) as response:
                assert json.load(response)['items'] == []
            return {'ok': True, 'checks': ['relocated final LifeOS executable starts its bundled backend',
                                           'first installation initializes an empty native workspace']}
        except Exception:
            log.flush()
            print((root / 'native-launch.log').read_text(errors='replace')[-16000:], file=sys.stderr)
            print('Native workspace directories:', sorted(p.name for p in workspace.iterdir()), file=sys.stderr)
            sample = root / 'native-sample.txt'
            if process is not None and process.poll() is None:
                subprocess.run(['sample', str(process.pid), '1', '1', '-file', str(sample)], timeout=15)
                if sample.exists():
                    print(sample.read_text(errors='replace')[:24000], file=sys.stderr)
            backend_log = Path.home() / 'Library' / 'Application Support' / 'LifeOS' / 'logs' / 'desktop.log'
            if backend_log.exists():
                print(backend_log.read_text(errors='replace')[-16000:], file=sys.stderr)
            raise
        finally:
            if process is not None:
                # Retain the runner's GUI session, and stop only this app's descendants.
                table = subprocess.check_output(['ps', '-axo', 'pid=,ppid='], text=True)
                owned = [process.pid]
                for parent in owned:
                    owned.extend(int(row.split()[0]) for row in table.splitlines()
                                 if len(row.split()) == 2 and int(row.split()[1]) == parent)
                for pid in reversed(owned[1:]):
                    try:
                        os.kill(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                try:
                    process.terminate()
                    process.wait(timeout=10)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        process.kill()
                    except ProcessLookupError:
                        pass


def ui_checks(app: Path, root: Path, phases=('first', 'restart'), evidence=None) -> tuple[list, Path]:
    electron = ROOT / 'desktop' / 'node_modules' / 'electron' / 'dist' / 'Electron.app' / 'Contents' / 'MacOS' / 'Electron'
    output = root / 'ui-qa'
    checks = []
    try:
        for phase in phases:
            env = {**os.environ, 'MACOS_APP_PATH': str(app), 'QA_OUTPUT': str(output), 'QA_PHASE': phase}
            env.pop('ELECTRON_RUN_AS_NODE', None)
            subprocess.run([str(electron), str(ROOT / 'scripts' / 'test_macos_app.cjs')],
                           env=env, check=True, timeout=120)
            report = json.loads((output / f'{phase}-report.json').read_text())
            assert report['ok']
            checks.extend(report['checks'])
    finally:
        if evidence and output.exists():
            import shutil
            shutil.copytree(output, evidence, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('workspace', 'application-data', 'profile'))
    return checks, output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', choices=('arm64', 'x64'), required=True)
    parser.add_argument('--dist', type=Path, default=ROOT / 'desktop' / 'dist')
    parser.add_argument('--native-app', type=Path, help='Run an early direct-executable smoke check before archives')
    args = parser.parse_args()
    assert platform.system() == 'Darwin'
    assert run('git', 'rev-parse', 'v0.5.2^{commit}', cwd=ROOT) == BASELINE
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASELINE, 'HEAD'], cwd=ROOT, check=True)
    if args.native_app:
        with tempfile.TemporaryDirectory(prefix='lifeos-mac-preflight-') as folder:
            inspect_app(args.native_app.resolve(), args.arch)
            ui_checks(args.native_app.resolve(), Path(folder), phases=('first',),
                      evidence=args.dist.resolve() / f'qa-macos-{args.arch}')
            print(json.dumps(native_smoke(args.native_app.resolve(), Path(folder))))
        return
    dist = args.dist.resolve()
    dmg = dist / f'LifeOS-0.5.2-mac-{args.arch}.dmg'
    archive = dist / f'LifeOS-0.5.2-mac-{args.arch}.zip'
    assert dmg.is_file() and archive.is_file()
    checks = []
    with tempfile.TemporaryDirectory(prefix='lifeos-mac-validation-') as folder:
        root = Path(folder)
        # Test after relocation out of the build directory, as with a real install.
        run('ditto', '-x', '-k', str(archive), str(root / 'Applications 生活记录'))
        app = root / 'Applications 生活记录' / 'LifeOS.app'
        info = inspect_app(app, args.arch)
        checks.append('final ZIP contains a correctly signed native app and relocatable Python')
        mount = plistlib.loads(subprocess.check_output(
            ['hdiutil', 'attach', '-nobrowse', '-readonly', '-plist', str(dmg)]))
        mounts = [entity['mount-point'] for entity in mount['system-entities'] if 'mount-point' in entity]
        assert len(mounts) == 1
        try:
            assert inspect_app(Path(mounts[0]) / 'LifeOS.app', args.arch) == info
            assert (Path(mounts[0]) / 'Applications').is_symlink()
            checks.append('DMG mounts read-only and offers the same app with an Applications shortcut')
        finally:
            run('hdiutil', 'detach', mounts[0])
        resources = app / 'Contents' / 'Resources'
        backend = json.loads(run('python3', str(ROOT / 'scripts' / 'test_desktop_backend.py'),
                                 '--resources', str(resources), '--python',
                                 str(resources / 'python' / 'bin' / 'python3')))
        assert backend['ok']
        checks.extend(backend['checks'])
        native = native_smoke(app, root)
        checks.extend(native['checks'])
        ui, output = ui_checks(app, root)
        checks.extend(ui)
        # Keep synthetic UI screenshots in CI evidence, outside distributable packages.
        import shutil
        shutil.copytree(output, dist / f'qa-macos-{args.arch}',
                        dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('workspace', 'application-data', 'profile'))
    assets = [{'name': file.name, 'bytes': file.stat().st_size,
               'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file in (dmg, archive)]
    report = {'ok': True, 'tag': 'v0.5.2', 'release_baseline': BASELINE,
              'mac_build_commit': run('git', 'rev-parse', 'HEAD', cwd=ROOT),
              **info, 'checks': checks, 'assets': assets, 'external_model_calls': 0,
              'contains_user_memory': False,
              'manual_checks_remaining': ['real microphone/camera system consent',
                                          'Gatekeeper consent on a newly downloaded community build']}
    (dist / f'MACOS_RELEASE_VALIDATION-{args.arch}.json').write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'arch': args.arch, 'checks': len(checks), 'assets': assets}))


if __name__ == '__main__':
    main()
