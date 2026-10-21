"""Vendor the original DSH animations at a pinned revision, with their asset terms."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'https://github.com/PC2005-cloud/dsh-pet'
REVISION = '15e59d2a42fa0d674720dd813480bc7aea786e86'
PACKAGE = ROOT / 'app/assets/pets/dsh-pet'


def fetch(path):
    url = f'https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/{REVISION}/' + urllib.parse.quote(path)
    request = urllib.request.Request(url, headers={'User-Agent': 'LifeOS-pet-import'})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def jsonc(text):
    """Remove comments outside strings; leave upstream strings and numbers intact."""
    output, index, quoted = [], 0, False
    while index < len(text):
        char = text[index]
        if quoted:
            output.append(char)
            if char == '\\' and index + 1 < len(text):
                index += 1
                output.append(text[index])
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
            output.append(char)
        elif text[index:index + 2] == '//':
            end = text.find('\n', index)
            index = len(text) if end < 0 else end
            output.append('\n')
            continue
        elif text[index:index + 2] == '/*':
            index = text.index('*/', index + 2) + 2
            output.append(' ')
            continue
        else:
            output.append(char)
        index += 1
    return json.loads(''.join(output))


def main():
    config = jsonc(fetch('dsh-pet/assets/config.jsonc').decode('utf-8'))
    request = urllib.request.Request(
        f'https://api.github.com/repos/PC2005-cloud/dsh-pet/git/trees/{REVISION}?recursive=1',
        headers={'User-Agent': 'LifeOS-pet-import'})
    with urllib.request.urlopen(request, timeout=45) as response:
        tree = json.load(response)['tree']
    assets = sorted((row for row in tree if row['path'].startswith('dsh-pet/assets/webm/')
                     and row['path'].endswith('.webm')), key=lambda row: row['path'])
    PACKAGE.mkdir(parents=True, exist_ok=True)
    pools = config['animations']
    groups = {name: category for category in pools['categories'] for name in category['actions']}

    def download(row):
        name = Path(row['path']).stem
        action_id = 'anim-' + hashlib.sha256(name.encode()).hexdigest()[:12]
        filename = action_id + '.webm'
        target = PACKAGE / filename
        content = target.read_bytes() if target.exists() else fetch(row['path'])
        blob = hashlib.sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
        if blob != row['sha']:
            raise ValueError('Upstream content mismatch: ' + name)
        if not target.exists():
            target.write_bytes(content)
        category = groups.get(name, {})
        return {'id': action_id, 'label': name, 'asset': filename,
                'source_path': row['path'], 'sha256': hashlib.sha256(content).hexdigest(),
                'bytes': len(content), 'group': category.get('id', '互动与状态'),
                'noMirror': category.get('noMirror', False)}

    with ThreadPoolExecutor(max_workers=6) as executor:
        actions = list(executor.map(download, assets))
    ids = {row['label']: row['id'] for row in actions}
    behavior = {
        'idle': [ids[name] for name in pools['idle']],
        'turn': [ids[name] for name in pools['turn']],
        'drag': [ids[name] for name in pools['drag']],
        'clicks': [ids[name] for name in pools['clicks']],
        'moves': [{'id': ids[row['name']], **pools['moves']['default'], **row.get('params', {})}
                  for row in pools['moves']['actions']],
        'categories': [{**{key: value for key, value in row.items() if key != 'actions'},
                        'actions': [ids[name] for name in row['actions']]} for row in pools['categories']],
        'weights': config['animationWeights'],
    }
    terms = ('Code: MIT. Animation assets: open-source use permitted; commercial use prohibited. '
             'All introductions, displays and distributions of derivative works must link to ' + REPOSITORY)
    manifest = {'id': 'dsh-pet--pc2005-cloud', 'displayName': 'DSH 小鲸', 'renderer': 'dsh-webm',
                'description': '蓝发小女仆，保留 106 段原版透明动画与随机陪伴动作',
                'source': {'repository': REPOSITORY, 'commit': REVISION, 'asset_terms': terms},
                'license': 'Non-commercial; attribution required', 'defaultAction': ids[pools['idle'][0]],
                'settings': {'autoBehavior': True}, 'behavior': behavior, 'actions': actions}
    (PACKAGE / 'pet.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (PACKAGE / 'LICENSE').write_bytes(fetch('LICENSE'))
    readme = fetch('README.md').decode('utf-8')
    license_section = readme[readme.rindex('## 许可'):].strip()
    (PACKAGE / 'ATTRIBUTION.md').write_text(
        f'# DSH 小鲸\n\nOriginal author: PC2005-cloud\n\nSource: {REPOSITORY}\n\n'
        f'Pinned revision: `{REVISION}`\n\n{license_section}\n\n'
        'LifeOS retains all 106 original VP9 alpha WebM files without transcoding. '
        'File names are mapped to stable action IDs in pet.json; source paths and SHA-256 hashes are recorded. '
        'The companion uses LifeOS chat and window controls.\n', encoding='utf-8')
    print(json.dumps({'count': len(actions), 'bytes': sum(row['bytes'] for row in actions), 'commit': REVISION}))


if __name__ == '__main__':
    main()
