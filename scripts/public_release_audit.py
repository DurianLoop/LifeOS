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
forbidden_prefixes = ('vault/', 'data/', '.lifeos/', 'docs/qa_', 'artifacts/', 'desktop/python-runtime/', 'desktop/dist/', 'node_modules/', 'desktop/node_modules/', '.netlify/')
forbidden_exact = {'.env', 'DO_NOT_SHARE_PERSONAL.txt'}
allowed_placeholders = {'vault/.gitkeep', 'data/.gitkeep'}
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').strip('\0').split('\0')
bad = [p for p in tracked if p in forbidden_exact or p.endswith(('.db', '.db-wal', '.db-shm', '.exe', '.zip')) or (p not in allowed_placeholders and p.startswith(forbidden_prefixes))]
if bad:
    raise SystemExit(f'private paths are tracked: {bad[:12]}')

edition = json.loads((ROOT / 'config' / 'edition.json').read_text(encoding='utf-8'))
if edition.get('contains_user_memory') is not False:
    raise SystemExit('public edition metadata must declare contains_user_memory=false')

vault_pages = [p for p in (ROOT / 'vault').rglob('*') if p.is_file() and p.name != '.gitkeep']
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

if (ROOT / '.env').exists() or (ROOT / '.lifeos').exists():
    raise SystemExit('release staging contains local settings or credentials')

secret_pattern = re.compile(r'\b(?:(?:sk|rk|pk)[_-][A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b', re.IGNORECASE)
for file in (ROOT / p for p in tracked):
    if not file.is_file() or file.suffix.lower() not in {'.py', '.js', '.mjs', '.cjs', '.html', '.css', '.md', '.json', '.bat', '.sh', '.txt', '.toml', '.yml', '.yaml', '.example'}:
        continue
    text = file.read_text(encoding='utf-8', errors='ignore')
    if secret_pattern.search(text):
        raise SystemExit(f'potential API secret found in {file.relative_to(ROOT)}')

print(json.dumps({'ok': True, 'tracked_files': len(tracked), 'vault_pages': 0, 'derived_memories': 0}, ensure_ascii=False))
