#!/usr/bin/env python3
from pathlib import Path
import subprocess,tempfile,json,re,sys,sqlite3
ROOT=Path(__file__).resolve().parents[1]
errors=[];report={}
html=(ROOT/'app/index.html').read_text(encoding='utf-8')

markers=[
 'REFINEMENT VII','journalProgressKey','resumeJournalProgress','searchDeepRead','searchAsk',
 'retrieveAskEvidence','interpretAskEvidence','askSelectionHealth','projectNextUnreviewed',
 'skillNextUnreviewed','JOURNAL_SCROLL_TIMER'
]
for m in markers:
    if m not in html: errors.append('missing Refinement VII marker '+m)

p=subprocess.run([sys.executable,str(ROOT/'scripts/feature_parity_audit.py')],capture_output=True,text=True)
if p.returncode: errors.append('feature parity failed: '+p.stdout[-1000:]+p.stderr[-1000:])
else: report['feature_parity']=json.loads(p.stdout)

con=sqlite3.connect(ROOT/'data/lifeos.db')
meta=dict(con.execute('SELECT key,value FROM meta').fetchall())
count=con.execute('SELECT COUNT(*) FROM memories').fetchone()[0]
daily=con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily'").fetchone()[0]
weekly=con.execute("SELECT COUNT(*) FROM memories WHERE kind='weekly'").fetchone()[0]
con.close()
report['meta']={'engine_version':meta.get('engine_version'),'schema_version':meta.get('schema_version'),'memories':count,'daily':daily,'weekly':weekly}
if meta.get('schema_version')!='10': errors.append('schema changed')
if (count,daily,weekly)!=(550,518,32): errors.append('memory counts changed')
if not re.match(r'^Memory Engine (?:10|11)\.',meta.get('engine_version') or ''): errors.append('engine version is not a compatible historical/Core IX marker')

js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:
    f.write(js);name=f.name
try:
    n=subprocess.run(['node','--check',name],capture_output=True,text=True)
    if n.returncode: errors.append('JS syntax: '+n.stderr.strip())
finally:
    Path(name).unlink(missing_ok=True)

for m in ["$('#askRun').onclick=retrieveAskEvidence","$('#askInterpret').onclick=()=>interpretAskEvidence(false)"]:
    if m not in html: errors.append('Ask UI binding missing: '+m)
for m in ["name==='Universal Search'","STATE.searchQ=p.get('q')","p.set('q',STATE.searchQ)"]:
    if m not in html: errors.append('search URL state missing: '+m)

for script in ['self_test.py','verify_vault.py']:
    q=subprocess.run([sys.executable,str(ROOT/'scripts'/script)],capture_output=True,text=True,timeout=120)
    report[script]=q.returncode
    if q.returncode: errors.append(script+' failed: '+q.stdout[-1400:]+q.stderr[-1400:])

print(json.dumps({'ok':not errors,'systems':141,'schema':10,'errors':errors,'report':report},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
