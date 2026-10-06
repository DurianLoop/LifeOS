#!/usr/bin/env python3
"""Run the v0.4 release regressions against synthetic, temporary user data.

Usage: python scripts/run_v04_release_checks.py
       python scripts/run_v04_release_checks.py --backend-python desktop/python-runtime/python.exe

This suite needs Node.js and the project's Python dependencies. It does not
read a personal Vault, require the historical 550-entry fixture, or substitute
for the separate public release audit of a sanitized staging checkout.
"""
from __future__ import annotations

import argparse
import datetime as dt
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'qa_v04'
VERSION = '0.4.3'
CODE_DIRECTORIES = ('app', 'backend', 'cloud', 'connectors', 'desktop', 'engine',
                    'importers', 'memorial-site', 'mobile', 'netlify', 'scripts')
SKIP_DIRECTORIES = {'.git', '.venv', 'node_modules', '__pycache__', 'python-runtime',
                    'dist', 'build', 'server-dist', 'android', 'ios'}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def code_files():
    """Enumerate source code only; never descend into personal data or builds."""
    for directory in CODE_DIRECTORIES:
        for base, folders, names in os.walk(ROOT / directory):
            folders[:] = sorted(name for name in folders
                                if name not in SKIP_DIRECTORIES and not name.startswith('release-'))
            for name in sorted(names):
                yield Path(base) / name


def isolated_environment(workspace):
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('LIFEOS_') and key not in {
               'PYTHONHOME', 'PYTHONPATH', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
               'DEEPSEEK_API_KEY', 'OPENAI_BASE_URL', 'MEMORIAL_PUBLISH_TOKEN',
           }}
    shutil.copytree(ROOT / 'config', workspace / 'config')
    for folder in ('vault', 'data', '.lifeos'):
        (workspace / folder).mkdir()
    env.update({
        'LIFEOS_ROOT': str(workspace), 'LIFEOS_RESOURCE_ROOT': str(ROOT),
        'LIFEOS_NO_BROWSER': '1', 'PYTHONUTF8': '1',
        'PYTHONUNBUFFERED': '1', 'PYTHONDONTWRITEBYTECODE': '1',
        'PYTHONPATH': str(ROOT), 'PYTHON_KEYRING_BACKEND': 'keyring.backends.null.Keyring',
        'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost',
    })
    return env


def decoded(value):
    return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else (value or '')


def run_command(name, command, env, timeout=120):
    started = time.perf_counter()
    try:
        completed = subprocess.run(list(map(str, command)), cwd=ROOT, env=env,
                                   capture_output=True, text=True, encoding='utf-8',
                                   errors='replace', timeout=timeout)
        status = 'passed' if completed.returncode == 0 else 'failed'
        output = completed.stdout + ('\n[stderr]\n' + completed.stderr if completed.stderr else '')
        exit_code = completed.returncode
    except subprocess.TimeoutExpired as error:
        status, exit_code = 'timeout', None
        output = decoded(error.stdout) + decoded(error.stderr) + f'\nTimed out after {timeout}s\n'
    except OSError as error:
        status, exit_code, output = 'failed', None, str(error)
    (OUT / f'{name}.log').write_text(output, encoding='utf-8')
    return {'name': name, 'status': status, 'ok': status == 'passed',
            'seconds': round(time.perf_counter() - started, 3), 'exit_code': exit_code,
            'command': list(map(str, command)), 'log': f'docs/qa_v04/{name}.log'}


def static_result(name, started, checked, errors):
    return {'name': name, 'status': 'failed' if errors else 'passed', 'ok': not errors,
            'seconds': round(time.perf_counter() - started, 3),
            'details': {'checked': checked, 'errors': errors}}


def python_syntax(files):
    started, checked, errors = time.perf_counter(), 0, []
    for file in files:
        if file.suffix != '.py':
            continue
        checked += 1
        try:
            # compile() accepts source bytes and honors encoding declarations;
            # unlike compileall it cannot create .pyc files in the release.
            compile(file.read_bytes(), str(file), 'exec')
        except (OSError, SyntaxError, ValueError) as error:
            errors.append(f'{file.relative_to(ROOT)}: {error}')
    return static_result('python-syntax', started, checked, errors)


class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts, self.current, self.mode = [], None, 'commonjs'

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'script':
            return
        attributes = dict(attrs)
        kind = (attributes.get('type') or '').lower().strip()
        if 'src' in attributes or kind not in ('', 'module', 'text/javascript', 'application/javascript'):
            return
        self.current = []
        self.mode = 'module' if kind == 'module' else 'commonjs'

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == 'script' and self.current is not None:
            code = ''.join(self.current)
            if code.strip():
                self.scripts.append((self.mode, code))
            self.current = None


def javascript_syntax(files, node, env):
    started, checked, errors = time.perf_counter(), 0, []
    for file in files:
        if file.suffix not in ('.js', '.cjs', '.mjs', '.html'):
            continue
        units = []
        if file.suffix == '.html':
            parser = InlineScripts()
            parser.feed(file.read_text(encoding='utf-8-sig'))
            units = [(f'{file.relative_to(ROOT)} inline script {index}', mode, code)
                     for index, (mode, code) in enumerate(parser.scripts, 1)]
        else:
            units = [(str(file.relative_to(ROOT)), None, None)]
        for label, mode, code in units:
            checked += 1
            command = [node, '--check', str(file)] if mode is None else [node, '--check', f'--input-type={mode}']
            try:
                result = subprocess.run(command, cwd=ROOT, env=env, input=code,
                                        capture_output=True, text=True, encoding='utf-8',
                                        errors='replace', timeout=20)
                if result.returncode:
                    errors.append(f'{label}: {result.stderr.strip() or result.stdout.strip()}')
            except (OSError, subprocess.TimeoutExpired) as error:
                errors.append(f'{label}: {error}')
    return static_result('javascript-syntax', started, checked, errors)


def metadata():
    started, checked, errors = time.perf_counter(), 0, []
    for relative in ('desktop/package.json', 'desktop/package-lock.json'):
        checked += 1
        try:
            item = json.loads((ROOT / relative).read_text(encoding='utf-8-sig'))
            if item.get('version') != VERSION:
                errors.append(f'{relative}: version must be {VERSION}')
            if relative.endswith('package-lock.json') and item.get('packages', {}).get('', {}).get('version') != VERSION:
                errors.append(f'{relative}: root package version must be {VERSION}')
        except (OSError, ValueError) as error:
            errors.append(f'{relative}: {error}')
    checked += 1
    try:
        edition = json.loads((ROOT / 'config/edition.json').read_text(encoding='utf-8-sig'))
        if edition.get('display_name') != f'LifeOS v{VERSION}':
            errors.append(f'config/edition.json: display_name must identify v{VERSION}')
        if edition.get('contains_user_memory') is not False:
            errors.append('config/edition.json: contains_user_memory must be false')
    except (OSError, ValueError) as error:
        errors.append(f'config/edition.json: {error}')
    return static_result('release-metadata', started, checked, errors)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-python', type=Path, default=Path(sys.executable),
                        help='Interpreter used for desktop backend tests; accepts the bundled Python executable')
    args = parser.parse_args()
    backend_python = args.backend_python.expanduser()
    if not backend_python.is_absolute():
        backend_python = ROOT / backend_python
    backend_python = backend_python.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    started, results = now(), []
    node = shutil.which('node') or 'node'

    def save(completed=False):
        summary = {'total': len(results), 'passed': sum(item['ok'] for item in results),
                   'failed': sum(not item['ok'] for item in results)}
        report = {'ok': completed and bool(results) and summary['failed'] == 0,
                  'status': 'complete' if completed else 'running', 'release': VERSION,
                  'started_at': started, 'updated_at': now(), 'root': str(ROOT),
                  'python': sys.executable, 'backend_python': str(backend_python),
                  'summary': summary, 'checks': results}
        (OUT / 'checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return report

    def record(result):
        results.append(result)
        save()
        print(f"[{result['status'].upper():7}] {result['name']} ({result['seconds']}s)", flush=True)

    save()
    with tempfile.TemporaryDirectory(prefix='lifeos-v03-release-') as directory:
        env = isolated_environment(Path(directory))
        env['LIFEOS_TEST_PYTHON'] = str(backend_python)
        checks = [
            ('ai-control', [sys.executable, '-m', 'unittest', 'scripts.test_ai_providers', 'scripts.test_ai_control', 'scripts.test_ai_integrations', '-v']),
            ('ai-settings-ui', [node, 'scripts/test_ai_settings_ui.mjs']),
            ('ai-workflows', [sys.executable, 'scripts/test_ai_workflows.py']),
            ('ai-retrieval', [sys.executable, '-m', 'unittest', 'scripts.test_ai_retrieval', '-v']),
            ('ai-workflows-ui', [node, 'scripts/test_ai_workflows_ui.mjs']),
            ('cloud-ai-errors', [sys.executable, '-m', 'unittest', 'scripts.test_cloud_ai', '-v']),
            ('poetry-engine', [sys.executable, '-m', 'unittest', 'scripts.test_poetry_engine', '-v']),
            ('import-clear', [sys.executable, 'scripts/test_import_clear.py']),
            ('import-roundtrip', [sys.executable, 'scripts/test_import_roundtrip.py']),
            ('attic-serving', [sys.executable, 'scripts/test_attic.py']),
            ('archive-charts-ui', [node, 'scripts/test_archive_charts.mjs']),
            ('white-noise', [node, 'scripts/test_white_noise.mjs']),
            ('poetry-ui', [node, 'scripts/test_poetry_ui.mjs']),
            ('pet-ui', [node, 'scripts/test_pet_ui.mjs']),
            ('writer-layout-ui', [node, 'scripts/test_writer_layout.mjs']),
            ('writer-workflows-ui', [node, 'scripts/test_writer_workflows.mjs']),
            ('writer-calendar-ui', [node, 'scripts/test_writer_calendar.mjs']),
            ('journal-book-ui', [node, 'scripts/test_journal_book.mjs']),
            ('writer-dates', [sys.executable, 'scripts/test_writer_dates.py']),
            ('pet-window', [node, 'desktop/pet-window.test.cjs']),
            ('memorial-cloud', [sys.executable, 'scripts/test_memorial.py']),
            ('memorial-netlify', [node, 'scripts/test_netlify_memorial.mjs']),
            # Running the file directly retains node:test coverage and avoids
            # Node's extra test-runner child process on restricted Windows.
            ('drift-bottles', [sys.executable, 'scripts/test_drift_bottles.py']),
            ('bottle-reminders', [node, 'desktop/bottle-reminders.test.cjs']),
            ('desktop-startup', [node, 'desktop/startup.test.cjs']),
            ('desktop-reliability', [node, 'desktop/reliability.test.cjs']),
            ('recovery-reliability', [sys.executable, 'scripts/test_v042_reliability.py']),
            ('desktop-setup', [node, 'desktop/setup.test.cjs']),
            ('desktop-backend', [sys.executable, 'scripts/test_desktop_backend.py', '--python', backend_python]),
            ('feature-parity', [sys.executable, 'scripts/feature_parity_audit.py']),
        ]
        for name, command in checks:
            record(run_command(name, command, env))
        files = list(code_files())
        record(python_syntax(files))
        record(javascript_syntax(files, node, env))
        record(metadata())
    report = save(completed=True)
    print(json.dumps(report['summary'], ensure_ascii=False))
    print('Evidence: docs/qa_v04/checks.json')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
