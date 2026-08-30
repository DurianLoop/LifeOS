#!/usr/bin/env python3
from pathlib import Path
import subprocess,tempfile,json,re,sys,sqlite3
ROOT=Path(__file__).resolve().parents[1]
errors=[];report={}
html=(ROOT/'app/index.html').read_text(encoding='utf-8')
markers=['REFINEMENT VI','CACHE_TTL=45000','RENDER_EPOCH','hydrateFromLocation','syncHistory','sourceReturn','journalFindPrev','journalFindNext','markRaw','prefers-reduced-motion','skipLink']
for m in markers:
    if m not in html: errors.append('missing UI reliability marker '+m)
# No feature growth
p=subprocess.run([sys.executable,str(ROOT/'scripts/feature_parity_audit.py')],capture_output=True,text=True)
if p.returncode: errors.append('feature parity failed: '+p.stdout[-1000:]+p.stderr[-1000:])
else: report['feature_parity']=json.loads(p.stdout)
# Version/schema/database integrity
con=sqlite3.connect(ROOT/'data/lifeos.db')
meta=dict(con.execute('SELECT key,value FROM meta').fetchall());count=con.execute('SELECT COUNT(*) FROM memories').fetchone()[0];con.close()
report['meta']={'engine_version':meta.get('engine_version'),'schema_version':meta.get('schema_version'),'memories':count}
if meta.get('schema_version')!='10': errors.append('schema changed')
if count!=550: errors.append('memory count changed')
if not re.match(r'^Memory Engine (?:10|11)\.',meta.get('engine_version') or ''): errors.append('engine version marker missing')
# Syntax
js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:f.write(js);name=f.name
try:
    n=subprocess.run(['node','--check',name],capture_output=True,text=True)
    if n.returncode: errors.append('JS syntax: '+n.stderr.strip())
finally: Path(name).unlink(missing_ok=True)
# Renderer completeness
rm=re.search(r'const RENDERERS=\{(.*?)\n\};',html,re.S)
if not rm: errors.append('renderers object missing')
else:
    mapped=set(re.findall(r':(render[A-Za-z0-9_]+)',rm.group(1)));defs=set(re.findall(r'(?:async\s+)?function\s+(render[A-Za-z0-9_]+)\s*\(',html));missing=sorted(mapped-defs);report['renderers']={'mapped':len(mapped),'missing':missing}
    if missing: errors.append('missing renderers: '+','.join(missing))
# Run prior regressions without recursing into V test (V itself runs older set)
for script in ['self_test.py','refinement_smoke_test.py','refinement_ii_smoke_test.py','refinement_iii_smoke_test.py','refinement_iv_smoke_test.py','verify_vault.py']:
    q=subprocess.run([sys.executable,str(ROOT/'scripts'/script)],capture_output=True,text=True,timeout=90)
    report[script]=q.returncode
    if q.returncode: errors.append(script+' failed: '+q.stdout[-1200:]+q.stderr[-1200:])
print(json.dumps({'ok':not errors,'systems':141,'schema':10,'errors':errors,'report':report},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
