#!/usr/bin/env python3
"""Append verified Mac installers to v0.5.2 without replacing existing assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

import yaml

BASE = 'https://api.github.com/repos/DurianLoop/LifeOS'
BASELINE = '1ca8858ea3fcb752b7af065aa0de8f4c11ff514a'


def api(path, method='GET', body=None):
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    request = urllib.request.Request(path if path.startswith('https://') else BASE + path,
        data=data, method=method, headers={
            'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
            'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'LifeOS-mac-release',
            'Content-Type': 'application/octet-stream' if isinstance(body, bytes) else 'application/json'})
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.load(response)


def tag_sha():
    obj = api('/git/ref/tags/v0.5.2')['object']
    if obj['type'] == 'tag':
        obj = api('/git/tags/' + obj['sha'])['object']
    return obj['sha']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    args = parser.parse_args()
    root = args.assets.resolve()
    reports = [json.loads((root / f'MACOS_RELEASE_VALIDATION-{arch}.json').read_text())
               for arch in ('arm64', 'x64')]
    assert all(report['ok'] and report['release_baseline'] == BASELINE for report in reports)
    assert len({report['mac_build_commit'] for report in reports}) == 1
    installers = [asset for report in reports for asset in report['assets']]
    expected = {f'LifeOS-0.5.2-mac-{arch}.{ext}' for arch in ('arm64', 'x64') for ext in ('dmg', 'zip')}
    assert {asset['name'] for asset in installers} == expected
    for asset in installers:
        data = (root / asset['name']).read_bytes()
        assert len(data) == asset['bytes'] and hashlib.sha256(data).hexdigest() == asset['sha256']
    # YAML may also be represented as JSON; electron-updater accepts both.
    metadata = [yaml.safe_load((root / f'latest-mac-{arch}.yml').read_text()) for arch in ('arm64', 'x64')]
    assert all(item['version'] == '0.5.2' for item in metadata)
    combined = {**metadata[1], 'files': [file for item in metadata for file in item['files']]}
    assert len({item['url'] for item in combined['files']}) == len(combined['files'])
    assert {item['url'] for item in combined['files']} <= expected
    assert {f'LifeOS-0.5.2-mac-{arch}.zip' for arch in ('arm64', 'x64')} <= {item['url'] for item in combined['files']}
    for item in combined['files']:
        import base64
        data = (root / item['url']).read_bytes()
        assert item['size'] == len(data)
        assert item['sha512'] == base64.b64encode(hashlib.sha512(data).digest()).decode()
    (root / 'latest-mac.yml').write_text(json.dumps(combined, indent=2) + '\n', encoding='utf-8')
    validation = {'ok': True, 'tag': 'v0.5.2', 'release_baseline': BASELINE,
                  'mac_build_commit': reports[0]['mac_build_commit'], 'architectures': reports,
                  'signature': 'ad-hoc', 'notarized': False, 'contains_user_memory': False}
    (root / 'MACOS_RELEASE_VALIDATION.json').write_text(json.dumps(validation, indent=2) + '\n', encoding='utf-8')
    files = [root / name for name in sorted(expected)] + [root / 'latest-mac.yml', root / 'MACOS_RELEASE_VALIDATION.json']
    sums = ''.join(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.name + '\n' for file in files)
    checksums = root / 'SHA256SUMS-macos-v0.5.2.txt'
    checksums.write_text(sums, encoding='utf-8')
    files.append(checksums)
    release = api('/releases/tags/v0.5.2')
    assert not release['draft'] and tag_sha() == BASELINE
    original = {item['name']: {'size': item['size'], 'digest': item.get('digest'), 'id': item['id']}
                for item in release['assets']}
    upload = release['upload_url'].split('{')[0]
    # Reject all conflicting retries before making any release mutation.
    for file in files:
        if file.name in original:
            data = file.read_bytes()
            assert original[file.name]['size'] == len(data)
            assert original[file.name]['digest'] == 'sha256:' + hashlib.sha256(data).hexdigest(), 'Existing asset differs: ' + file.name
    verified = []
    for file in files:
        data = file.read_bytes()
        digest = 'sha256:' + hashlib.sha256(data).hexdigest()
        if file.name in original:
            # A retry can keep an identical asset, but must never silently replace it.
            item = next(item for item in release['assets'] if item['name'] == file.name)
            assert item.get('digest') == digest and item['size'] == len(data), 'Existing asset differs: ' + file.name
        else:
            print('Uploading ' + file.name, flush=True)
            item = api(upload + '?' + urllib.parse.urlencode({'name': file.name}), 'POST', data)
        assert item['size'] == len(data) and item.get('digest') == digest, 'Uploaded asset integrity mismatch'
        verified.append({'name': file.name, 'bytes': len(data), 'sha256': digest[7:], 'url': item['browser_download_url']})
    remote = api('/releases/tags/v0.5.2')
    by_name = {item['name']: item for item in remote['assets']}
    for name, before in original.items():
        item = by_name[name]
        assert {'size': item['size'], 'digest': item.get('digest'), 'id': item['id']} == before
    for item in verified:
        assert by_name[item['name']]['size'] == item['bytes']
        assert by_name[item['name']]['digest'] == 'sha256:' + item['sha256']
    assert tag_sha() == BASELINE
    marker = '<!-- lifeos-macos-v0.5.2 -->'
    if marker not in remote['body']:
        note = ('\n\n' + marker + '\n## macOS 安装包\n\n'
                '- Apple Silicon（M1/M2/M3/M4 等）：`LifeOS-0.5.2-mac-arm64.dmg`\n'
                '- Intel Mac：`LifeOS-0.5.2-mac-x64.dmg`\n'
                '- 打开 DMG，把 LifeOS 拖入 Applications；已内置 Python，无需另装\n'
                '- 支持 macOS 11 及以上。此社区构建使用 ad-hoc 签名，未经过 Apple 公证；'
                '首次打开如被阻止，可在“系统设置 → 隐私与安全性”中允许打开\n'
                '- Mac 数据目录：`~/Library/Application Support/LifeOS/workspace/`\n'
                '- 两种架构均经过原生启动、打包后端、保存重启和签名校验；'
                '检查报告与校验值见 `MACOS_RELEASE_VALIDATION.json` 和 `SHA256SUMS-macos-v0.5.2.txt`\n')
        api('/releases/' + str(release['id']), 'PATCH', {'body': remote['body'] + note})
    (root / 'macos-published.json').write_text(json.dumps({'ok': True, 'release_url': remote['html_url'],
        'release_baseline': BASELINE, 'preserved_existing_assets': list(original), 'assets': verified}, indent=2) + '\n')
    print(json.dumps({'ok': True, 'assets': verified}))


if __name__ == '__main__':
    main()
