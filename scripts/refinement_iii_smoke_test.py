#!/usr/bin/env python3
from pathlib import Path
import importlib.util, subprocess, tempfile, json, sys
ROOT=Path(__file__).resolve().parents[1]
errors=[];report={}
spec=importlib.util.spec_from_file_location('lifeos_backend',ROOT/'backend/server.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
con=mod.db()
try:
    pc=mod.place_context(con,'上海'); report['place_context']={'days':pc['memory_days'] if pc else 0,'topics':len(pc['topics']) if pc else 0}
    if not pc or not pc['topics']: errors.append('place dossier missing')
    yr=mod.year_review_bundle(con,'2026'); report['year_review']={'months':len(yr['months']),'dense':len(yr['dense_sources']),'artifacts':len(yr['artifacts'])}
    if len(yr['months'])<6 or not yr['dense_sources']: errors.append('year review too thin')
    g=mod.graph_data(con); report['graph']={'nodes':len(g['nodes']),'edges':len(g['edges'])}
    if len(g['nodes'])<10 or len(g['edges'])<10: errors.append('graph too thin')
finally:
    con.close()
p=subprocess.run([sys.executable,str(ROOT/'scripts/feature_parity_audit.py')],capture_output=True,text=True)
if p.returncode: errors.append('feature parity failed')
html=(ROOT/'app/index.html').read_text(encoding='utf-8')
for marker in ['searchWorkspace','dayShelf','candidateWorkspace','placeDossier','yearToolbar','graphDossier','provenanceLedger']:
    if marker not in html: errors.append('missing UI marker '+marker)
js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:
    f.write(js);name=f.name
try:
    n=subprocess.run(['node','--check',name],capture_output=True,text=True)
    if n.returncode: errors.append('JS syntax: '+n.stderr.strip())
finally:
    Path(name).unlink(missing_ok=True)
print(json.dumps({'ok':not errors,'errors':errors,'systems':140,'schema':10,'report':report},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
