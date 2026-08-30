#!/usr/bin/env python3
from pathlib import Path
from getpass import getpass
ROOT=Path(__file__).resolve().parents[1]
key=getpass('DeepSeek API key (input hidden): ').strip()
if not key:
    raise SystemExit('No key entered; nothing changed.')
lines=[
    'LIFEOS_HOST=127.0.0.1',
    'LIFEOS_PORT=8787',
    f'LIFEOS_LLM_API_KEY={key}',
    'LIFEOS_LLM_BASE_URL=https://api.deepseek.com',
    'LIFEOS_LLM_MODEL=deepseek-v4-flash',
]
(ROOT/'.env').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Saved locally to .env. This file is gitignored and should remain private.')
