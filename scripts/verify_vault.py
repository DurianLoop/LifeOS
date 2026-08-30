#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[1]; VAULT=ROOT/'vault'
manifest=json.loads((VAULT/'manifest.json').read_text(encoding='utf-8')); errors=[]
for item in manifest['files']:
    p=VAULT/item['vault_path']
    if not p.exists(): errors.append(f"MISSING {item['vault_path']}"); continue
    if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']: errors.append(f"HASH MISMATCH {item['vault_path']}")
print(f"Checked {len(manifest['files'])} files: {len(errors)} error(s)")
for e in errors: print(e)
sys.exit(1 if errors else 0)
