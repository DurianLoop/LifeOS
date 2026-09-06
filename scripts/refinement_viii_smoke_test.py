#!/usr/bin/env python3
from pathlib import Path
import subprocess,tempfile,json,sys,sqlite3
ROOT=Path(__file__).resolve().parents[1]
errors=[];report={}
html=(ROOT/'app/index.html').read_text(encoding='utf-8')
for m in ['文言化','renderClassicalChinese','/api/classical-chinese','142 systems','REFINEMENT VIII']:
    if m not in html: errors.append('missing UI marker '+m)
p=subprocess.run([sys.executable,str(ROOT/'scripts/feature_parity_audit.py')],capture_output=True,text=True,encoding='utf-8',errors='replace')
if p.returncode: errors.append('feature parity failed '+p.stdout[-1000:]+p.stderr[-1000:])
else: report['feature_parity']=json.loads(p.stdout)
base140=json.loads((ROOT/'config/features_140_baseline.json').read_text(encoding='utf-8'))
base141=json.loads((ROOT/'config/features_141_baseline.json').read_text(encoding='utf-8'))
base142=json.loads((ROOT/'config/features_142_baseline.json').read_text(encoding='utf-8'))
if base141[:140]!=base140 or base141[140:]!=['文言化']: errors.append('141 baseline is not exact 140 + 文言化')
if base142[:141]!=base141 or base142[141:]!=['Other']: errors.append('142 baseline is not exact 141 + Other')
js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False,dir=ROOT) as f:
    f.write(js);name=f.name
try:
    n=subprocess.run(['node','--check',name],capture_output=True,text=True,encoding='utf-8',errors='replace')
    if n.returncode: errors.append('JS syntax '+n.stderr.strip())
finally:
    Path(name).unlink(missing_ok=True)
for rel in ['backend/server.py','engine/rebuild_memory_engine.py']:
    q=subprocess.run([sys.executable,'-m','py_compile',str(ROOT/rel)],capture_output=True,text=True,encoding='utf-8',errors='replace')
    if q.returncode: errors.append(rel+' compile '+q.stderr.strip())
con=sqlite3.connect(ROOT/'data/lifeos.db')
meta=dict(con.execute('select key,value from meta').fetchall())
counts=(con.execute("select count(*) from memories").fetchone()[0],con.execute("select count(*) from memories where kind='daily'").fetchone()[0],con.execute("select count(*) from memories where kind='weekly'").fetchone()[0])
con.close()
if meta.get('schema_version')!='10': errors.append('schema changed')
if not (counts[0]>=550 and counts[1]>=518 and counts[2]>=32 and counts[0]==counts[1]+counts[2]): errors.append('raw memory baseline was reduced or became inconsistent')
if not (meta.get('engine_version') or '').startswith('Memory Engine 11.'): errors.append('engine marker not Core IX / Memory Engine 11')
sys.path.insert(0,str(ROOT/'backend'))
import server
sample='今天我终于完成了PPT，但是还有一些问题需要继续修改。'
out=server.local_classical_draft(sample,'qingjian','medium')
report['local_sample']=out
if out==sample or '今日' not in out or 'PPT' not in out: errors.append('local converter did not transform conservatively')
print(json.dumps({'ok':not errors,'systems':142,'added':['文言化','Other'],'removed':[],'schema':10,'errors':errors,'report':report},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
