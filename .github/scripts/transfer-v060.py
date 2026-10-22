"""Transfer public packages from successful native CI; leave publication local."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

manifest = json.loads(Path('release-upload-manifest.json').read_text())
base = 'https://api.github.com/repos/DurianLoop/LifeOS'
headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
           'User-Agent': 'LifeOS-release', 'Accept': 'application/vnd.github+json'}

def api(endpoint, method='GET'):
    endpoint += ('&' if '?' in endpoint else '?') + 'nocache=' + str(time.time_ns())
    request = urllib.request.Request(base + endpoint, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        value = response.read()
        return json.loads(value) if value else None

for field in ('mac_run', 'mobile_run'):
    run = api('/actions/runs/' + str(manifest[field]))
    assert run['head_sha'] == manifest['commit'] and run['conclusion'] == 'success'
release_id = manifest['draft_release_id']
release = api('/releases/' + str(release_id))
assert release['draft'] and release['tag_name'] == 'v0.6.0'
assert release['target_commitish'] == manifest['commit']
packages = []
for item in manifest['server_assets']:
    files = list(Path('packages').rglob(item['name']))
    assert len(files) == 1
    file = files[0]
    assert file.stat().st_size == item['bytes']
    with file.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == item['sha256']
    packages.append((file, item))

def transfer(pair):
    file, item = pair
    for attempt in range(3):
        current = api('/releases/' + str(release_id))
        assert current['draft'], 'Publication must wait for all transfers'
        existing = next((asset for asset in current['assets'] if asset['name'] == file.name), None)
        if existing and existing['size'] == item['bytes'] and existing.get('digest') == 'sha256:' + item['sha256']:
            return file.name
        if existing:
            api('/releases/assets/' + str(existing['id']), 'DELETE')
        try:
            with file.open('rb') as stream:
                request = urllib.request.Request(release['upload_url'].split('{')[0] + '?' +
                    urllib.parse.urlencode({'name': file.name}), data=stream, method='POST',
                    headers={**headers, 'Content-Type': 'application/octet-stream',
                             'Content-Length': str(item['bytes'])})
                with urllib.request.urlopen(request, timeout=900) as response:
                    uploaded = json.load(response)
            assert uploaded['size'] == item['bytes'] and uploaded['digest'] == 'sha256:' + item['sha256']
            print('Verified transfer: ' + file.name, flush=True)
            return file.name
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3)

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    result = list(pool.map(transfer, packages))
print(json.dumps({'ok': True, 'draft_release_id': release_id, 'verified_assets': result}))
