#!/usr/bin/env python3
from pathlib import Path
import importlib.util, json, subprocess, tempfile, sys
ROOT=Path(__file__).resolve().parents[1]
errors=[]; report={}
spec=importlib.util.spec_from_file_location('lifeos_backend',ROOT/'backend/server.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
con=mod.db()
try:
    # Journal context must remain source-linked and navigable.
    r=con.execute("SELECT * FROM memories WHERE kind='daily' AND date='2026-08-11'").fetchone()
    jc=mod.journal_context(con,r['id'],r['kind'],r['date'],r['year'],r['week'])
    report['journal_context']={'signals':len(jc['signals']),'roles':len(jc['roles']),'artifacts':len(jc['artifacts']),'has_previous':bool(jc['previous'])}
    if not jc['previous']: errors.append('journal previous navigation missing')
    # People drill-in uses deterministic same-page context only.
    pc=mod.people_context(con,'role','老师')
    report['people_context']={'days':pc['memory_days'] if pc else 0,'topics':len(pc['topics']) if pc else 0,'skills':len(pc['skills']) if pc else 0}
    if not pc or pc['memory_days']<20 or not pc['topics']: errors.append('people role context too thin')
    # Project groups replace the flat-only reading without changing the Projects system.
    pg=mod.grouped_projects(con)
    report['project_groups']={'groups':len(pg),'largest':pg[0]['trigger'] if pg else None}
    if len(pg)<5: errors.append('project grouping missing')
    # Book must have multiple source-linked chapters.
    bc=mod.book_chapters(con)
    report['book']={'chapters':len(bc),'last':bc[-1]['title_seed'] if bc else None}
    if len(bc)<3 or not any(x['source_ribbon'] for x in bc): errors.append('book chapters/source ribbon missing')
    # Compare supports month windows in addition to years.
    cmp=mod.compare(con,'2026-05','2026-08')
    report['compare']={'skill_delta':len(cmp['skill_delta']),'topic_delta':len(cmp['topic_delta'])}
    if not cmp['skill_delta'] or not cmp['topic_delta']: errors.append('compare deltas missing')
finally:
    con.close()
# 140-system freeze
p=subprocess.run([sys.executable,str(ROOT/'scripts/feature_parity_audit.py')],capture_output=True,text=True)
if p.returncode: errors.append('feature parity failed')
# UI markers and JS parse
html=(ROOT/'app/index.html').read_text(encoding='utf-8')
for marker in ['data-jkind','data-projtrigger','data-personname','data-bookidx','answerWithEvidenceLinks','Skill Evidence','Compare Me']:
    if marker not in html: errors.append('UI refinement marker missing: '+marker)
js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:
    f.write(js); jsfile=Path(f.name)
try:
    n=subprocess.run(['node','--check',str(jsfile)],capture_output=True,text=True)
    if n.returncode: errors.append('frontend JavaScript syntax failed: '+n.stderr.strip())
finally:
    jsfile.unlink(missing_ok=True)
print(json.dumps({'ok':not errors,'errors':errors,'systems':140,'schema':10,'report':report},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
