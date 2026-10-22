"""Transfer public packages from successful native CI; leave publication local."""
from pathlib import Path
import base64
import concurrent.futures
import hashlib
import json
import os
import subprocess
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
patch_asset = next(asset for asset in release['assets'] if asset['name'] == manifest['android_transfer']['name'])
class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, response_headers, url):
        redirected = super().redirect_request(request, fp, code, message, response_headers, url)
        redirected.remove_header('Authorization')
        return redirected
request = urllib.request.Request(patch_asset['url'], headers={**headers, 'Accept': 'application/octet-stream'})
with urllib.request.build_opener(Redirect()).open(request, timeout=120) as response:
    patch_data = response.read()
assert hashlib.sha256(patch_data).hexdigest() == manifest['android_transfer']['sha256']
patch = json.loads(patch_data)
assert patch['format'] == 'lifeos-public-apk-records-v1' and not patch['private_credentials_included']
unsigned = Path('packages/android/LifeOS-0.6.0.apk')
with unsigned.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == patch['source_sha256']
signed = Path('packages/android/LifeOS-0.6.0-android.apk')
with unsigned.open('rb') as original, signed.open('wb') as output:
    for operation in patch['operations']:
        if 'literal' in operation:
            output.write(base64.b64decode(operation['literal']))
        else:
            assert 0 <= operation['offset'] <= unsigned.stat().st_size - operation['length']
            original.seek(operation['offset'])
            output.write(original.read(operation['length']))
assert signed.stat().st_size == patch['target_bytes']
with signed.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == patch['target_sha256']
print('Reconstructed the exact locally signed APK; no private credentials used', flush=True)
packages = []
for item in manifest['server_assets']:
    files = list(Path('packages').rglob(item['name']))
    assert len(files) == 1
    file = files[0]
    assert file.stat().st_size == item['bytes']
    with file.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == item['sha256']
    packages.append((file, item))
source_meta = manifest['source_archive']
source_zip = Path('packages') / source_meta['name']
subprocess.run(['git', 'archive', '--format=zip', '--prefix=LifeOS-0.6.0/',
                '--output=' + str(source_zip), manifest['commit']], check=True)
with source_zip.open('rb') as stream:
    source_matches = hashlib.file_digest(stream, 'sha256').hexdigest() == source_meta['sha256']
if source_matches:
    packages.append((source_zip, source_meta))
else:
    print('The exact source archive will be transferred by the local publisher', flush=True)

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
api('/releases/assets/' + str(patch_asset['id']), 'DELETE')
print(json.dumps({'ok': True, 'draft_release_id': release_id, 'verified_assets': result}))
