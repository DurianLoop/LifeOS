#!/usr/bin/env python3
from pathlib import Path
import json, subprocess, tempfile, sys
ROOT=Path(__file__).resolve().parents[1]
base=json.loads((ROOT/'config/features_141_baseline.json').read_text(encoding='utf-8'))
html=(ROOT/'app/index.html').read_text(encoding='utf-8')
expr=html.split('const FEATURES=',1)[1].split('.map((x,i)=>',1)[0].strip()
js='const arr='+expr+'; console.log(JSON.stringify(arr.map(x=>x[0])));'
# Keep the short-lived parser file inside the project.  Some Windows profiles
# deny Node the inherited user Temp path even though the project is writable.
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False,dir=ROOT) as f:
    f.write(js); name=f.name
try:
    out=subprocess.check_output(['node',name],text=True,encoding='utf-8')
    cur=json.loads(out)
finally:
    Path(name).unlink(missing_ok=True)
removed=[x for x in base if x not in cur]
added=[x for x in cur if x not in base]
dupes=sorted({x for x in cur if cur.count(x)>1})
order_preserved=cur[:len(base)]==base
ok=(order_preserved and not removed and added==['Daily Poetry'] and not dupes)
print(json.dumps({'ok':ok,'baseline':len(base),'current':len(cur),'removed':removed,'added':added,'duplicates':dupes,'order_preserved':order_preserved},ensure_ascii=False,indent=2))
sys.exit(0 if ok else 1)
