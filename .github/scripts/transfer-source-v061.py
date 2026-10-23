"""Reproduce the exact validated source ZIP on GitHub before uploading it."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import urllib.parse
import urllib.request

manifest=json.loads(Path('release-upload-manifest.json').read_text())
base='https://api.github.com/repos/DurianLoop/LifeOS'
headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'User-Agent':'LifeOS-release','Accept':'application/vnd.github+json'}
def api(path):
    with urllib.request.urlopen(urllib.request.Request(base+path,headers=headers),timeout=120) as response:
        return json.load(response)
ref=api('/git/ref/tags/v0.6.1')['object']
assert ref['type']=='commit' and ref['sha']==manifest['commit']
release=api('/releases/'+str(manifest['draft_release_id']))
assert release['draft'] and release['tag_name']=='v0.6.1' and release['target_commitish']==manifest['commit']
expected=manifest['source_archive']
file=Path(expected['name'])
subprocess.run(['git','archive','--format=zip','--prefix=LifeOS-0.6.1/','--output='+str(file),manifest['commit']],check=True)
assert file.stat().st_size==expected['bytes']
with file.open('rb') as stream:
    assert hashlib.file_digest(stream,'sha256').hexdigest()==expected['sha256'], 'Source ZIP is not byte-identical to the local validated archive'
existing=next((asset for asset in release['assets'] if asset['name']==file.name),None)
if existing:
    assert existing['size']==expected['bytes'] and existing['digest']=='sha256:'+expected['sha256']
else:
    with file.open('rb') as stream:
        request=urllib.request.Request(release['upload_url'].split('{')[0]+'?'+urllib.parse.urlencode({'name':file.name}),data=stream,method='POST',headers={**headers,'Content-Type':'application/octet-stream','Content-Length':str(file.stat().st_size)})
        with urllib.request.urlopen(request,timeout=900) as response:
            uploaded=json.load(response)
    assert uploaded['size']==expected['bytes'] and uploaded['digest']=='sha256:'+expected['sha256']
print(json.dumps({'ok':True,'source_archive_verified':file.name,'sha256':expected['sha256']}))
