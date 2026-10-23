"""Run the unmodified desktop APIs in the application's private data sandbox."""
from __future__ import annotations
import base64
import hashlib
import hmac
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import sys
import threading
from urllib.parse import parse_qs, urlparse


class MobileRuntime:
    def __init__(self, data, platform, resources=None):
        self.root = Path(data) / 'workspace'
        self.resources = Path(resources or Path(__file__).parent / 'resources')
        self.platform = platform
        self.token = secrets.token_urlsafe(32)
        self.commands = queue.Queue()
        self.server = None

    def start(self):
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ('vault', 'data', '.lifeos'):
            (self.root / name).mkdir(exist_ok=True)
        for source in (self.resources / 'config').rglob('*'):
            if not source.is_file():
                continue
            target = self.root / source.relative_to(self.resources)
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists() or source.name in ('edition.json', 'copydeck.json', 'poetry_catalog.json', 'features_141_baseline.json'):
                shutil.copyfile(source, target)
        os.environ.update(LIFEOS_ROOT=str(self.root), LIFEOS_RESOURCE_ROOT=str(self.resources),
                          LIFEOS_HOST='127.0.0.1', LIFEOS_NO_BROWSER='1', LIFEOS_PLATFORM=self.platform)
        try:
            import certifi
            os.environ['SSL_CERT_FILE'] = certifi.where()
        except ImportError:
            pass
        sys.path[:0] = [str(self.resources), str(self.resources / 'engine')]
        from engine import durable_io
        durable_io.recover_restore(self.root)
        durable_io.recover_entry_writes(self.root)
        if not (self.root / 'data/lifeos.db').exists():
            from engine.rebuild_memory_engine import main as rebuild
            rebuild()
        from backend.server import Handler, ThreadingHTTPServer
        from lifeosmobile.storage import WorkspaceStorage
        self.storage = WorkspaceStorage(self.root)
        runtime = self

        class MobileHandler(Handler):
            def authorized(self):
                if self.headers.get('Host') != runtime.authority:
                    return False
                origin = self.headers.get('Origin')
                if origin and origin != runtime.origin:
                    return False
                cookie = SimpleCookie()
                try:
                    cookie.load(self.headers.get('Cookie', ''))
                    value = cookie.get('lifeos_native')
                    return value is not None and hmac.compare_digest(value.value, runtime.token)
                except Exception:
                    return False

            def do_GET(self):
                parsed = urlparse(self.path)
                if parsed.path == '/_mobile/start' and self.headers.get('Host') == runtime.authority:
                    supplied = parse_qs(parsed.query).get('token', [''])[0]
                    if hmac.compare_digest(supplied, runtime.token):
                        self.send_response(303)
                        self.send_header('Set-Cookie', f'lifeos_native={runtime.token}; HttpOnly; SameSite=Strict; Path=/')
                        self.send_header('Location', '/')
                        self.send_header('Content-Length', '0')
                        self.end_headers()
                        return
                if not self.authorized():
                    return self.send_json({'error': 'Native session required'}, 403)
                if parsed.path == '/_mobile/status':
                    return self.send_json({'ok': True, 'platform': runtime.platform, 'version': '0.6.1',
                                           'offline': True, 'export': True, 'overlay': False})
                if parsed.path in ('/', '/index.html'):
                    # The authenticated host owns platform detection, including
                    # accessibility/browser previews without a custom UA.
                    html = (runtime.resources / 'app/index.html').read_text(encoding='utf-8')
                    platform = runtime.platform if runtime.platform in ('android', 'ios') else ''
                    html = html.replace('<html ', f'<html data-native-platform="{platform}" ', 1)
                    return self.send_binary(html.encode('utf-8'), 'text/html; charset=utf-8')
                return super().do_GET()

            def do_HEAD(self):
                if not self.authorized():
                    return self.send_error(403)
                return super().do_HEAD()

            def do_POST(self):
                if not self.authorized():
                    return self.send_json({'error': 'Native session required'}, 403)
                path = urlparse(self.path).path
                if path.startswith('/_mobile/'):
                    try:
                        length = int(self.headers.get('Content-Length', '0'))
                        if length > 256 * 1024 * 1024:
                            return self.send_json({'error': 'Export exceeds 256 MB'}, 413)
                        data = self.body_json()
                        if path == '/_mobile/storage':
                            return self.send_json({'ok': True, 'value': runtime.storage.command(data)})
                        if path == '/_mobile/restart':
                            runtime.commands.put(('restart', None, None))
                            return self.send_json({'ok': True})
                        if path == '/_mobile/export':
                            content = base64.b64decode(data['base64'], validate=True)
                            name = Path(str(data.get('name') or 'LifeOS-export')).name
                            if not name or name in ('.', '..') or '/' in name or '\\' in name:
                                raise ValueError('Invalid filename')
                            export = runtime.root.parent / 'exports' / secrets.token_hex(8) / name
                            durable_io.atomic_bytes(export, content)
                            runtime.commands.put(('export', export, str(data.get('type') or 'application/octet-stream')))
                            return self.send_json({'ok': True, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
                        return self.send_json({'error': 'Unknown mobile operation'}, 404)
                    except (ValueError, KeyError, OSError) as error:
                        return self.send_json({'ok': False, 'error': str(error)}, 400)
                return super().do_POST()

            def log_message(self, fmt, *args):
                # The bootstrap URL includes a capability token; never log it.
                if not self.path.startswith('/_mobile/start'):
                    super().log_message(fmt, *args)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), MobileHandler)
        self.server.daemon_threads = False
        self.authority = f'127.0.0.1:{self.server.server_port}'
        self.origin = 'http://' + self.authority
        self.url = self.origin + '/_mobile/start?token=' + self.token
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True, name='LifeOS-local-engine')
        self.thread.start()
        return self.url

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        backend = sys.modules.get('backend.server')
        if backend and getattr(backend, 'REFRESH_WORKER', None):
            backend.REFRESH_WORKER.stop(timeout=30)
            if backend.REFRESH_WORKER.thread.is_alive():
                raise RuntimeError('档案索引仍在写入，请稍后重试')

    def restart(self):
        self.stop()
        # iOS cannot spawn another process. After all requests and indexing have
        # stopped, reload the engine so restore recovery sees the new workspace.
        for name in list(sys.modules):
            if name.split('.')[0] in ('engine', 'backend', 'connectors', 'importers'):
                del sys.modules[name]
        self.token = secrets.token_urlsafe(32)
        return self.start()
