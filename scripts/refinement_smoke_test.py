#!/usr/bin/env python3
from pathlib import Path
import importlib.util, json, subprocess, tempfile, sys
ROOT=Path(__file__).resolve().parents[1]
errors=[]
# backend import + retrieval
spec=importlib.util.spec_from_file_location('lifeos_backend',ROOT/'backend/server.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
con=mod.db()
try:
    cases=[
      ('我什么时候开始真正重视产品？','earliest'),
      ('我对产品和科研的看法是怎么变化的？','change'),
      ('过去一年我反复问自己的问题是什么？','recurring'),
    ]
    reports=[]
    for q,intent in cases:
        r=mod.retrieve(con,q,10)
        reports.append({'question':q,'intent':r.get('query_intent'),'count':r.get('count'),'coverage':r.get('coverage')})
        if r.get('query_intent')!=intent: errors.append(f'intent mismatch: {q}')
        if r.get('count',0)<5: errors.append(f'too little evidence: {q}')
        if len({e.get('date') for e in r.get('evidence',[])})<5: errors.append(f'poor date diversity: {q}')
        bad={'我什','法是怎','题是什'}
        if any(t in bad for e in r.get('evidence',[]) for t in e.get('matched_terms',[])): errors.append(f'question-grammar fragment leaked: {q}')
finally:
    con.close()
# exact feature parity
p=subprocess.run([sys.executable,str(ROOT/'scripts/feature_parity_audit.py')],capture_output=True,text=True)
if p.returncode: errors.append('feature parity audit failed')
# JS syntax
html=(ROOT/'app/index.html').read_text(encoding='utf-8')
js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:
    f.write(js); jsfile=Path(f.name)
try:
    n=subprocess.run(['node','--check',str(jsfile)],capture_output=True,text=True)
    if n.returncode: errors.append('frontend JavaScript syntax failed: '+n.stderr.strip())
finally:
    jsfile.unlink(missing_ok=True)
print(json.dumps({'ok':not errors,'errors':errors,'retrieval_cases':reports,'systems':140,'schema':10},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
