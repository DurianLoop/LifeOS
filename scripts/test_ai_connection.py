#!/usr/bin/env python3
from pathlib import Path
import os,json,urllib.request
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'.env'
if p.exists():
    for line in p.read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);os.environ.setdefault(k.strip(),v.strip())
key=os.getenv('LIFEOS_LLM_API_KEY','').strip()
base=os.getenv('LIFEOS_LLM_BASE_URL','https://api.deepseek.com').rstrip('/')
model=os.getenv('LIFEOS_LLM_MODEL','deepseek-v4-flash')
if not key: raise SystemExit('No LIFEOS_LLM_API_KEY. Run scripts/configure_ai.py first.')
payload={'model':model,'messages':[{'role':'user','content':'只回复：LifeOS AI 连接正常'}],'temperature':0}
req=urllib.request.Request(base+'/chat/completions',data=json.dumps(payload).encode('utf-8'),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(req,timeout=30) as r: data=json.loads(r.read().decode('utf-8'))
    print('OK ·',data.get('model',model),'·',data['choices'][0]['message']['content'].strip())
except Exception as e:
    raise SystemExit('Connection test failed: '+str(e))
