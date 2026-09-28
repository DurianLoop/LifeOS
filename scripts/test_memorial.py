#!/usr/bin/env python3
"""Public memorial lifecycle and tenant isolation against a temporary cloud."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib import request, error

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import memorial, p2_sync, product_core as pc


def test_local_snapshot(root):
    assert p2_sync.memorial_status(root) == {'published': False, 'configured': False}
    public = pc.save_entry(journal_date='2030-01-02', sections={'日记': '主动公开的文字。'},
                           title='第一次', root=root)
    private = pc.save_entry(journal_date='2030-01-03', sections={'日记': '不应发布的私密文字。'}, root=root)
    pc.add_attachment(public['entry_id'], 'private.txt', b'private attachment', root=root)
    snapshot = memorial.build_snapshot([public['entry_id'], public['entry_id']], root)
    assert len(snapshot) == 1
    assert set(snapshot[0]) == {'entry_id', 'date', 'title', 'content'}
    assert private['entry_id'] not in json.dumps(snapshot)
    assert '不应发布' not in json.dumps(snapshot, ensure_ascii=False)
    changed = pc.save_entry(journal_date='2030-01-02', entry_id=public['entry_id'],
                            sections={'日记': '尚未再次发布的新文字。'}, root=root)
    assert '主动公开' in snapshot[0]['content']
    assert '尚未再次发布' in memorial.build_snapshot([public['entry_id']], root)[0]['content']
    for bad in ([], ['missing-entry'], [{}]):
        try:
            memorial.build_snapshot(bad, root)
        except ValueError:
            pass
        else:
            raise AssertionError('invalid selection must not produce a public snapshot')
    revision = pc.read_revision(changed['revision_id'], root)
    (root / revision['revision_file']).unlink()
    try:
        memorial.build_snapshot([public['entry_id']], root)
    except ValueError:
        pass
    else:
        raise AssertionError('missing revision must not publish an empty page')


def call(method, url, token=None, body=None, expected=200):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=10) as response:
            status, raw = response.status, response.read()
    except error.HTTPError as e:
        status, raw = e.code, e.read()
    assert status == expected, (method, url, status, raw[:300])
    return json.loads(raw)


def main():
    with tempfile.TemporaryDirectory(prefix='lifeos-memorial-') as tmp:
        test_local_snapshot(Path(tmp) / 'vault-fixture')
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        env = os.environ.copy()
        env.update({'LIFEOS_CLOUD_DB': str(Path(tmp) / 'cloud.db'), 'LIFEOS_CLOUD_HOST': '127.0.0.1',
                    'LIFEOS_CLOUD_PORT': str(port), 'PYTHONPATH': str(ROOT)})
        proc = subprocess.Popen([sys.executable, str(ROOT / 'cloud/dev_sync_server.py')], cwd=ROOT,
                                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        base = f'http://127.0.0.1:{port}'
        try:
            for _ in range(50):
                try:
                    call('GET', base + '/health')
                    break
                except Exception:
                    time.sleep(.1)
            else:
                raise RuntimeError('test cloud failed to start')
            a = call('POST', base + '/v1/register', body={'email': 'a@example.test', 'password': 'password-A'})['token']
            b = call('POST', base + '/v1/register', body={'email': 'b@example.test', 'password': 'password-B'})['token']
            assert call('GET', base + '/v2/memorial', b)['published'] is False
            call('POST', base + '/v2/memorial', a, {'entries': 'invalid'}, expected=400)
            payload = {'title': '留下的事', 'introduction': '写给后来的人。', 'ai_enabled': True,
                       'story_ids': ['day-1'], 'entries': [{'entry_id': 'day-1', 'date': '2030-01-02',
                       'title': '第一次', 'content': '今天出发了。'}]}
            published = call('POST', base + '/v2/memorial', a, payload)
            url = published['url']
            public = call('GET', base + '/v2/public/memorial?id=' + published['public_id'])
            assert public['entries'][0]['content'] == '今天出发了。'
            assert len(public['stories']) == 1
            assert call('GET', base + '/v2/memorial', a)['entry_ids'] == ['day-1']
            assert '今天出发了' not in json.dumps(call('GET', base + '/v2/memorial', b), ensure_ascii=False)
            call('POST', base + '/v2/public/memorial/ask', body={'id': published['public_id'], 'question': '何时出发？'}, expected=503)
            payload['entries'][0]['content'] = '今天到达了。'
            assert call('POST', base + '/v2/memorial', a, payload)['url'] == url
            assert call('GET', base + '/v2/public/memorial?id=' + published['public_id'])['entries'][0]['content'] == '今天到达了。'
            call('POST', base + '/v2/memorial/unpublish', a, {})
            call('GET', base + '/v2/public/memorial?id=' + published['public_id'], expected=410)
            assert call('POST', base + '/v2/memorial', a, payload)['url'] == url
            long_content = '完整长日记。' * 8000 + '末尾不应丢失。'
            payload['entries'][0]['content'] = long_content
            assert call('POST', base + '/v2/memorial', a, payload)['url'] == url
            assert call('GET', base + '/v2/public/memorial?id=' + published['public_id'])['entries'][0]['content'] == long_content
            payload['ai_enabled'] = False
            call('POST', base + '/v2/memorial', a, payload)
            call('POST', base + '/v2/public/memorial/ask', body={'id': published['public_id'], 'question': '何时出发？'}, expected=403)
            print('memorial lifecycle, stable URL, public snapshot, AI gate and tenant isolation: OK')
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == '__main__':
    main()
