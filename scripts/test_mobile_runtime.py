"""Mobile runtime acceptance using an isolated synthetic workspace."""
from pathlib import Path
import base64
import http.cookiejar
import json
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'mobile/src'))
from lifeosmobile.runtime import MobileRuntime
from lifeosmobile.storage import WorkspaceStorage


def main():
    with tempfile.TemporaryDirectory(prefix='lifeos-mobile-acceptance-') as data:
        runtime = MobileRuntime(data, 'android', resources=ROOT)
        try:
            runtime.start()
            def session():
                client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                client.open(runtime.url).close()
                return client
            client = session()
            def request(path, body=None, headers=None):
                raw = None if body is None else json.dumps(body).encode()
                req = urllib.request.Request(runtime.origin + path, data=raw, headers={'Content-Type': 'application/json', **(headers or {})})
                with client.open(req, timeout=30) as response:
                    raw = response.read()
                    return json.loads(raw) if 'application/json' in response.headers.get('Content-Type', '') else raw
            assert request('/api/health')['ok']
            for req in (urllib.request.Request(runtime.origin + '/api/entries'),
                        urllib.request.Request(runtime.origin + '/api/entries', headers={'Cookie': 'lifeos_native=' + runtime.token, 'Origin': 'https://untrusted.invalid'})):
                try:
                    urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req)
                    raise AssertionError('Unauthenticated or foreign-origin request accepted')
                except urllib.error.HTTPError as error:
                    assert error.code == 403
            request('/_mobile/storage', {'op': 'set', 'key': 'lifeos.writer.draft', 'value': '移动端草稿'})
            saved = request('/api/entries/save', {'journal_date': '2026-10-01', 'title': 'Mobile acceptance', 'sections': {'日记': 'A local page. 本地保存。'}})
            assert saved['ok']
            entry = saved['result']['entry_id']
            content = b'attachment roundtrip\x00\xff'
            attachment = request('/api/attachments', {'entry_id': entry, 'name': 'acceptance.bin', 'data_base64': base64.b64encode(content).decode()})
            assert attachment.get('ok'), attachment
            assert request('/api/attachment?attachment_id=' + attachment['attachment']['attachment_id']) == content
            from engine import crypto_vault
            crypto_vault.create_recovery_key(runtime.root)
            envelope = crypto_vault.encrypt_json({'text': '加密同步'}, {'entry_id': entry}, runtime.root)
            assert crypto_vault.decrypt_json(envelope, runtime.root) == {'text': '加密同步'}
            backup = request('/api/backups/create', {'reason': 'mobile acceptance'})
            assert backup.get('backup_id'), backup
            before = runtime.origin
            runtime.restart()
            client = session()
            assert request('/api/entries')['items'][0]['entry_id'] == entry
            assert request('/_mobile/storage', {'op': 'snapshot'})['value']['lifeos.writer.draft'] == '移动端草稿'
            request('/_mobile/export', {'name': 'acceptance.bin', 'base64': base64.b64encode(content).decode()})
            operation, path, mime = runtime.commands.get_nowait()
            assert operation == 'export' and path.read_bytes() == content
            request('/api/entries/save', {'journal_date': '2026-10-02', 'sections': {'日记': 'Remove this page by restoring the earlier backup.'}})
            backups = request('/api/backups')['items']
            chosen = next(item for item in backups if item['reason'] == 'mobile acceptance')
            assert request('/api/backups/restore', {'backup_id': chosen['backup_id']})['restart_required']
            runtime.restart()
            client = session()
            assert len(request('/api/entries')['items']) == 1
            assert request('/_mobile/storage', {'op': 'snapshot'})['value']['lifeos.writer.draft'] == '移动端草稿'
            # Recover a damaged primary from the previous durable generation.
            runtime.storage.command({'op': 'set', 'key': 'lifeos.qa.one', 'value': 'one'})
            runtime.storage.command({'op': 'set', 'key': 'lifeos.qa.two', 'value': 'two'})
            runtime.storage.path.write_text('{damaged', encoding='utf-8')
            recovered = WorkspaceStorage(runtime.root)
            assert recovered.command({'op': 'get', 'key': 'lifeos.qa.one'}) == 'one'
            print(json.dumps({'ok': True, 'checks': ['local authentication', 'origin restriction', 'offline save', 'attachment upload', 'AES-GCM roundtrip', 'full engine restart', 'durable CJK draft', 'native export bytes', 'backup restore and restart', 'damaged draft recovery'], 'user_diaries_read': 0}))
        finally:
            runtime.stop()


if __name__ == '__main__':
    main()
