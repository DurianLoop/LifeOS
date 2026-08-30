#!/usr/bin/env python3
"""Fail closed if a public LifeOS release tries to include private data."""
from __future__ import annotations

from pathlib import Path
import json
import re
import sqlite3
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
forbidden_prefixes = ('vault/memories/', 'data/', '.lifeos/', 'docs/qa_')
forbidden_exact = {'.env', 'DO_NOT_SHARE_PERSONAL.txt'}
allowed_placeholders = {'vault/.gitkeep', 'data/.gitkeep'}
tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True, encoding='utf-8').splitlines()
bad = [p for p in tracked if p in forbidden_exact or (p not in allowed_placeholders and p.startswith(forbidden_prefixes))]
if bad:
    raise SystemExit(f'private paths are tracked: {bad[:12]}')

edition = json.loads((ROOT / 'config' / 'edition.json').read_text(encoding='utf-8'))
if edition.get('contains_user_memory') is not False:
    raise SystemExit('public edition metadata must declare contains_user_memory=false')

vault_pages = list((ROOT / 'vault' / 'memories').rglob('*.md'))
if vault_pages:
    raise SystemExit(f'public Vault is not empty: {vault_pages[:3]}')

db = ROOT / 'data' / 'lifeos.db'
if db.exists():
    con = sqlite3.connect(db)
    try:
        count = con.execute('SELECT COUNT(*) FROM memories').fetchone()[0]
    finally:
        con.close()
    if count:
        raise SystemExit(f'public derived index includes {count} memories')

secret_pattern = re.compile(r'\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b', re.IGNORECASE)
for file in (p for p in ROOT.rglob('*') if p.is_file() and p.suffix.lower() in {'.py', '.js', '.cjs', '.html', '.css', '.md', '.json', '.bat', '.sh', '.txt'}):
    if file == Path(__file__) or any(part in {'.git', 'node_modules', 'build', 'server-dist'} for part in file.parts):
        continue
    text = file.read_text(encoding='utf-8', errors='ignore')
    if secret_pattern.search(text):
        raise SystemExit(f'potential API secret found in {file.relative_to(ROOT)}')

print(json.dumps({'ok': True, 'tracked_files': len(tracked), 'vault_pages': 0, 'derived_memories': 0}, ensure_ascii=False))
