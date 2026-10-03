#!/usr/bin/env python3
from pathlib import Path
import importlib.util, subprocess, tempfile, json, sys, re
ROOT=Path(__file__).resolve().parents[1]
errors=[];report={}
spec=importlib.util.spec_from_file_location('lifeos_backend',ROOT/'backend/server.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
con=mod.db()
try:
    # Compare: duplicate regression + normalized rates
    d=mod.compare(con,'2025','2026')
    names=[x['name'] for x in d['skill_delta']]
    if len(names)!=len(set(names)): errors.append('duplicate skill rows remain in Compare Me')
    if not d['skill_delta'] or 'rate_delta' not in d['skill_delta'][0]: errors.append('normalized compare fields missing')
    report['compare']={'skills':len(names),'unique':len(set(names)),'ratio':d['comparability']['recorded_day_ratio']}
    # Book representatives
    ch=mod.book_chapters(con)
    if ch and not any(x.get('representative_sources') for x in ch): errors.append('book representative sources missing')
    report['book']={'chapters':len(ch),'representative_sources':sum(len(x.get('representative_sources') or []) for x in ch)}
    # Projects dossier data
    gp=mod.grouped_projects(con)
    if gp and not {'monthly','artifacts','milestones','decisions','samples'}<=set(gp[0]): errors.append('project dossier enrichment missing')
    report['projects']={'groups':len(gp),'sample_rows':sum(len(x.get('samples') or []) for x in gp)}
    # People context
    r=con.execute("SELECT role FROM role_mentions GROUP BY role ORDER BY COUNT(DISTINCT memory_id) DESC LIMIT 1").fetchone()
    if r:
        pc=mod.people_context(con,'role',r['role'])
        if not pc or 'monthly' not in pc or 'early_window' not in pc or 'recent_window' not in pc: errors.append('people context refinement missing')
        report['people']={'role':r['role'],'months':len(pc.get('monthly') or []) if pc else 0}
finally: con.close()
html=(ROOT/'app/index.html').read_text(encoding='utf-8')
for marker in ['REFINEMENT V','CONTINUE','journalFind','coverageStrip','data-bookmode','data-skfilter','data-projfilter','Per 10 recorded days']:
    if marker not in html: errors.append('missing UI marker '+marker)
# frozen registry parity and renderer completeness
rm=re.search(r'const RENDERERS=\{(.*?)\n\};',html,re.S)
if not rm: errors.append('renderers object missing')
else:
    mapped=set(re.findall(r':(render[A-Za-z0-9_]+)',rm.group(1)));defs=set(re.findall(r'(?:async\s+)?function\s+(render[A-Za-z0-9_]+)\s*\(',html));missing=sorted(mapped-defs)
    report['renderer_parity']={'mapped':len(mapped),'missing':missing}
    if missing: errors.append('missing renderers: '+','.join(missing))
js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:f.write(js);name=f.name
try:
    n=subprocess.run(['node','--check',name],capture_output=True,text=True)
    if n.returncode: errors.append('JS syntax: '+n.stderr.strip())
finally: Path(name).unlink(missing_ok=True)
for script in ['feature_parity_audit.py','self_test.py','refinement_smoke_test.py','refinement_ii_smoke_test.py','refinement_iii_smoke_test.py','refinement_iv_smoke_test.py','verify_vault.py']:
    p=subprocess.run([sys.executable,str(ROOT/'scripts'/script)],capture_output=True,text=True)
    report[script]=p.returncode
    if p.returncode: errors.append(script+' failed: '+p.stdout[-1000:]+p.stderr[-1000:])
print(json.dumps({'ok':not errors,'systems':140,'schema':10,'errors':errors,'report':report},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
