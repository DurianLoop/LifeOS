#!/usr/bin/env python3
"""Smoke-test desktop source or packaged resources using an empty user workspace.

Source: python scripts/test_desktop_backend.py
Package: python scripts/test_desktop_backend.py --resources PATH --python PATH/python/python.exe
Only the standard library is required by this test runner.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


REPOSITORY = Path(__file__).resolve().parents[1]
TEST_TEXT = 'Desktop regression: a new local journal survives a complete backend restart. 本地日记重启后仍在。'


def environment(resources: Path, workspace: Path) -> dict:
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('LIFEOS_') and key not in (
               'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY',
               'OPENAI_BASE_URL', 'PYTHONHOME', 'PYTHONPATH')}
    search_paths = [resources]
    # Source mode can use the prepared pure-Python QR dependency without
    # installing anything into the host interpreter. Embedded Python loads its
    # own Lib/site-packages through its _pth file.
    for candidate in (resources / 'python' / 'Lib' / 'site-packages',
                      resources / 'desktop' / 'python-runtime' / 'Lib' / 'site-packages'):
        if candidate.is_dir():
            search_paths.append(candidate)
    env.update({
        'LIFEOS_ROOT': str(workspace), 'LIFEOS_RESOURCE_ROOT': str(resources),
        'LIFEOS_NO_BROWSER': '1', 'LIFEOS_HOST': '127.0.0.1',
        'PYTHONUNBUFFERED': '1', 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1',
        'PYTHONPATH': os.pathsep.join(map(str, search_paths)),
        'PYTHON_KEYRING_BACKEND': 'keyring.backends.null.Keyring',
    })
    return env


def prepare_workspace(resources: Path, workspace: Path) -> Path:
    for name in ('vault', 'data', '.lifeos'):
        (workspace / name).mkdir(parents=True)
    shutil.copytree(resources / 'config', workspace / 'config')
    pets = resources / 'app' / 'assets' / 'pets'
    shutil.copytree(pets, workspace / 'app' / 'assets' / 'pets')
    # This pet exists only in user data. Serving it from bundled app/assets
    # would fail, which catches the packaged custom-pet path regression.
    source_pet = next(folder for folder in pets.iterdir()
                      if (folder / 'spritesheet.webp').is_file() and (folder / 'pet.json').is_file())
    custom_pet = workspace / 'app' / 'assets' / 'pets' / 'qa-user-pet'
    custom_pet.mkdir()
    shutil.copy2(source_pet / 'spritesheet.webp', custom_pet / 'spritesheet.webp')
    manifest = json.loads((source_pet / 'pet.json').read_text(encoding='utf-8'))
    manifest.update({'id': 'qa-user-pet', 'displayName': 'Desktop regression pet'})
    (custom_pet / 'pet.json').write_text(json.dumps(manifest), encoding='utf-8')
    return custom_pet


def request(base: str, path: str, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(base + path, data=data,
                                 headers={'Content-Type': 'application/json'} if data else {})
    # Localhost must not go through a user's HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=10) as response:
            raw = response.read()
            if 'application/json' in response.headers.get('Content-Type', ''):
                return json.loads(raw.decode('utf-8'))
            return raw
    except urllib.error.HTTPError as exc:
        raise AssertionError(f'{path}: HTTP {exc.code}: {exc.read().decode("utf-8", "replace")[:1500]}') from exc


@contextlib.contextmanager
def server(python: Path, bootstrap: Path, env: dict, workspace: Path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    log_path = workspace / 'backend-test.log'
    process = None
    with log_path.open('ab') as log:
        try:
            process = subprocess.Popen(
                [str(python), str(bootstrap)], cwd=workspace,
                env={**env, 'LIFEOS_PORT': str(port)}, stdout=log, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
            deadline = time.monotonic() + 60
            last_error = None
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError(f'Backend exited during startup ({process.returncode})')
                try:
                    health = request(base, '/api/health')
                    assert health.get('ok') is True and health.get('mode') == 'local-first', health
                    break
                except (OSError, AssertionError) as exc:
                    last_error = exc
                    time.sleep(0.15)
            else:
                raise AssertionError(f'Backend startup timed out: {last_error}')
            yield base
        except Exception:
            log.flush()
            print(log_path.read_text(encoding='utf-8', errors='replace')[-16000:], file=sys.stderr)
            raise
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


def check_module_roots(python: Path, env: dict, workspace: Path) -> list[str]:
    probe = r'''
import json, os, sys
from pathlib import Path
root = Path(os.environ['LIFEOS_ROOT']).resolve()
sys.path.insert(0, os.environ['LIFEOS_RESOURCE_ROOT'])
from backend import ai_control, ai_integrations, ai_providers, secret_store
from engine import product_core, poetry_engine
modules = (ai_control, ai_integrations, ai_providers, secret_store, product_core, poetry_engine)
for module in modules:
    assert module.ROOT.resolve() == root, (module.__name__, str(module.ROOT))
secret_store._keyring = lambda: None
secret_store.set_secret('desktop.regression.fake', 'not-a-real-secret')
assert secret_store.get_secret('desktop.regression.fake')[0] == 'not-a-real-secret'
assert (root / '.lifeos' / 'secrets.json').is_file()
secret_store.delete_secret('desktop.regression.fake')
assert not secret_store.get_secret('desktop.regression.fake')[0]
product_core.set_settings({'ai.model': 'desktop-regression-model', 'ai.enabled': False, 'ai.allow_remote': False})
assert ai_providers.config().model == 'desktop-regression-model'
assert not ai_providers.privacy_status()['allow_remote']
print(json.dumps([module.__name__ for module in modules]))
'''
    result = subprocess.run([str(python), '-c', probe], cwd=workspace, env=env,
                            capture_output=True, text=True, encoding='utf-8', timeout=30,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def run(resources: Path, python: Path) -> dict:
    bootstrap = resources / 'server_bootstrap.py'
    if not bootstrap.is_file():
        bootstrap = resources / 'desktop' / 'server_bootstrap.py'
    assert bootstrap.is_file(), f'Bootstrap is missing: {bootstrap}'
    assert python.is_file(), f'Python executable is missing: {python}'
    checks = []
    with tempfile.TemporaryDirectory(prefix='lifeos-desktop-backend-') as folder:
        workspace = Path(folder)
        custom_pet = prepare_workspace(resources, workspace)
        env = environment(resources, workspace)
        assert not (workspace / 'data' / 'lifeos.db').exists()
        assert not (workspace / '.lifeos' / 'core.db').exists()
        with server(python, bootstrap, env, workspace) as base:
            assert (workspace / 'data' / 'lifeos.db').is_file()
            assert (workspace / '.lifeos' / 'core.db').is_file()
            checks.append('empty workspace bootstraps both databases and healthy local server')
            assert request(base, '/api/entries')['items'] == []
            for path in ('/api/core/status', '/api/copydeck', '/api/home',
                         '/api/memorial/config', '/api/memorial/status',
                         '/api/ai/control', '/api/ai/integrations',
                         '/api/attic/overview', '/api/attic/review', '/api/attic/ledger',
                         '/api/attic/month?month=2026-01'):
                request(base, path)
            empty_attic = request(base, '/api/attic/overview')
            assert empty_attic['pages'] == 0 and empty_attic['recorded_days'] == 0
            assert len(empty_attic['months']) == 12
            control = request(base, '/api/ai/control')
            assert {item['id'] for item in control['features']} == {'ask', 'past_me', 'classical', 'poetry', 'pet'}
            permissions = {f'ai.features.{item["id"]}': False for item in control['features']}
            saved_ai = request(base, '/api/ai/settings', {'items': permissions})
            assert saved_ai['ok'] and all(not item['feature_enabled'] for item in saved_ai['status']['features'].values())
            assert request(base, '/api/memorial/available')['items'] == []
            poetry = request(base, '/api/poetry')
            assert not poetry['auto_enabled'] and not poetry['has_journal']
            assert poetry['history'] == [] and poetry['remaining'] >= 30
            checks.append('first-run home, core, copydeck, poetry, memorial and AI control APIs')
            for path in ('/', '/poetry.js', '/poetry.css', '/white-noise.js',
                         '/white-noise.css', '/memorial.js', '/memorial.css',
                         '/ai-settings.js', '/ai-settings.css', '/attic.js', '/attic.css',
                         '/charts.js', '/charts.css'):
                assert request(base, path), f'Empty static asset: {path}'
            assert request(base, '/assets/pets/qa-user-pet/pet.json')['id'] == 'qa-user-pet'
            sprite = request(base, '/assets/pets/qa-user-pet/spritesheet.webp')
            assert hashlib.sha256(sprite).digest() == hashlib.sha256((custom_pet / 'spritesheet.webp').read_bytes()).digest()
            checks.append('bundled page assets and a pet stored only in user data')
            day = dt.date.today().isoformat()
            saved = request(base, '/api/entries/save', {
                'journal_date': day, 'sections': {'日记': TEST_TEXT}, 'title': 'Desktop regression',
            })
            assert saved['ok'] is True and saved['poetry_scheduled'] is False
            entry_id = saved['result']['entry_id']
            entry_path = '/api/entry?' + urllib.parse.urlencode({'entry_id': entry_id})
            entry = request(base, entry_path)
            assert TEST_TEXT in entry['current']['content']
            assert request(base, '/api/poetry')['has_journal'] is True
            assert request(base, '/api/memorial/available')['items'][0]['entry_id'] == entry_id
            assert (workspace / 'vault' / saved['result']['source_path']).is_file()
            attic = request(base, '/api/attic/overview')
            assert attic['pages'] == 1 and attic['recorded_days'] == 1, attic
            monthly = request(base, '/api/attic/month?month=' + day[:7])
            assert monthly['total'] == 1 and TEST_TEXT in monthly['items'][0]['excerpt'], monthly
            assert request(base, '/api/attic/review?year=' + day[:4])['total'] == 1
            checks.append('write a synthetic journal and read it through core, poetry and memorial')
        modules = check_module_roots(python, env, workspace)
        checks.append('ROOT and default storage arguments: ' + ', '.join(modules))
        with server(python, bootstrap, env, workspace) as base:
            entry = request(base, entry_path)
            assert TEST_TEXT in entry['current']['content']
            assert entry['entry']['entry_id'] == entry_id
            assert len(request(base, '/api/entries')['items']) == 1
            assert request(base, '/api/attic/overview')['pages'] == 1
            ai = request(base, '/api/ai/status')
            assert ai['model'] == 'desktop-regression-model'
            assert not ai['enabled'] and not ai['allow_remote']
            control = request(base, '/api/ai/control')
            assert all(not item['enabled'] for item in control['features'])
            connection_test = request(base, '/api/ai/test', {})
            assert not connection_test['ok'] and connection_test['status'] == 'unavailable'
            assert request(base, '/assets/pets/qa-user-pet/pet.json')['id'] == 'qa-user-pet'
            checks.append('journal, AI settings and user pet persist after a complete restart')
            weekly = request(base, '/api/import/preview', {'files': [{
                'name': '2099_1.md', 'content': '### 本周总结\nDesktop regression future review.\n',
            }]})
            assert weekly['stats']['new'] == 1 and weekly['stats']['needs_date'] == 0
            request(base, '/api/import/commit', {'job_id': weekly['job_id']})
            journals = request(base, '/api/journals?kind=weekly')['items']
            assert len(journals) == 1 and journals[0]['year'] == 2099
            historical = request(base, '/api/ask', {
                'question': 'Desktop regression', 'cutoff': day, 'stage': 'retrieve', 'limit': 20,
            })
            assert historical['evidence']
            assert all(e['provenance_type'] == 'daily_raw' and e['date'] <= day
                       for e in historical['evidence']), 'future or undated weekly review leaked into Past Me'
            unbounded = request(base, '/api/retrieve?q=Desktop%20regression&limit=20')
            assert any(e['provenance_type'] == 'weekly_review' for e in unbounded['evidence'])
            checks.append('weekly imports keep their identity; historical evidence excludes undated future reviews')
    return {'ok': True, 'resources': str(resources), 'python': str(python), 'checks': checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, default=REPOSITORY,
                        help='Source root or the unpacked application resources directory')
    parser.add_argument('--python', type=Path, default=Path(sys.executable),
                        help='Python used to launch the backend (e.g. resources/python/python.exe)')
    args = parser.parse_args()
    print(json.dumps(run(args.resources.resolve(), args.python.resolve()), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
