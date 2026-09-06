#!/usr/bin/env python3
from pathlib import Path
import importlib.util, subprocess, tempfile, json, sys, re

ROOT=Path(__file__).resolve().parents[1]
errors=[]; report={}

def fail(msg): errors.append(msg)

spec=importlib.util.spec_from_file_location('lifeos_backend',ROOT/'backend/server.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
con=mod.db()
try:
    ret=mod.retrieve(con,'我对产品和科研的看法是怎么变化的？',10,None)
    health=mod.evidence_health(ret)
    report['ask_change']={
        'intent':ret.get('query_intent'),
        'count':ret.get('count'),
        'unique_dates':(ret.get('coverage') or {}).get('unique_dates'),
        'span_days':(ret.get('coverage') or {}).get('date_span_days'),
        'daily_raw_ratio':(ret.get('coverage') or {}).get('daily_raw_ratio'),
        'health':health.get('status')
    }
    if ret.get('query_intent')!='change': fail('change intent not detected')
    if (ret.get('count') or 0)<5: fail('change retrieval too thin')
    if (ret.get('coverage') or {}).get('unique_dates',0)<3: fail('change retrieval date coverage too thin')

    evidence=ret.get('evidence') or []
    if evidence:
        key=f"{evidence[0].get('source_path','')}||{evidence[0].get('section','')}"
        selected=mod.filter_selected_evidence(ret,[key])
        report['selected_evidence']={'count':selected.get('count'),'ids':[x.get('evidence_id') for x in selected.get('evidence') or []]}
        if selected.get('count')!=1: fail('manual evidence filtering failed')
        if (selected.get('evidence') or [{}])[0].get('evidence_id')!='E1': fail('selected evidence IDs not renumbered')

    # Review metadata roundtrip without committing to disk.
    original=mod.get_review_map(con,'projects')
    probe=dict(original); probe['__refinement_iv_smoke__']={'status':'candidate','note':'temporary'}
    mod.save_review_map(con,'projects',probe)
    got=mod.get_review_map(con,'projects')
    report['review_roundtrip']=got.get('__refinement_iv_smoke__')
    if '__refinement_iv_smoke__' not in got: fail('review app_settings roundtrip failed')
    con.rollback()
finally:
    con.close()

# v0.2 contract: the historical 141-system baseline plus the explicit Other room
# must remain intact and in order.
p=subprocess.run([sys.executable,str(ROOT/'scripts/feature_parity_audit.py')],capture_output=True,text=True,encoding='utf-8',errors='replace')
report['feature_parity_stdout']=p.stdout.strip()
if p.returncode: fail('feature parity failed')
else:
    try:
        parity=json.loads(p.stdout)
        report['feature_parity']=parity
        if parity.get('baseline')!=142 or parity.get('current')!=142 or parity.get('added') or parity.get('removed') or parity.get('duplicates') or not parity.get('order_preserved'): fail('feature freeze mismatch')
    except Exception as e: fail('feature parity JSON parse failed: '+str(e))

html=(ROOT/'app/index.html').read_text(encoding='utf-8')
for marker in ['function renderDeepRead(','function renderProjects(','HUMAN REVIEW','askEvidenceCheck','REVIEW_SCOPES']:
    if marker not in html and marker not in (ROOT/'backend/server.py').read_text(encoding='utf-8'):
        fail('missing implementation marker '+marker)

# Every renderer referenced by the frozen registry must exist.
m=re.search(r'const RENDERERS\s*=\s*\{(.*?)\n\s*\};',html,re.S) or re.search(r'RENDERERS\s*=\s*\{(.*?)\};',html,re.S)
if not m: fail('RENDERERS object not found')
else:
    mapped=set(re.findall(r':\s*(render[A-Za-z0-9_]+)',m.group(1)))
    defs=set(re.findall(r'function\s+(render[A-Za-z0-9_]+)\s*\(',html))
    missing=sorted(mapped-defs)
    report['renderers']={'mapped_unique':len(mapped),'defined':len(defs),'missing':missing}
    if missing: fail('missing renderer definitions: '+', '.join(missing))

# Schema freeze and engine marker.
con=mod.db()
try:
    meta={r['key']:r['value'] for r in con.execute("SELECT key,value FROM meta")}
    tables=con.execute("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").fetchone()['n']
    report['meta']={'schema_version':meta.get('schema_version'),'engine_version':meta.get('engine_version'),'tables':tables,'total':meta.get('total')}
    if meta.get('schema_version')!='10': fail('schema version changed')
    if not re.match(r'^Memory Engine (?:10|11)\.',meta.get('engine_version') or ''): fail('engine version marker missing')
finally: con.close()

# JavaScript syntax.
js=html.rsplit('<script>',1)[1].split('</script>',1)[0]
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False,dir=ROOT) as f:
    f.write(js); name=f.name
try:
    n=subprocess.run(['node','--check',name],capture_output=True,text=True,encoding='utf-8',errors='replace')
    report['node_check']='PASS' if n.returncode==0 else n.stderr.strip()
    if n.returncode: fail('JS syntax: '+n.stderr.strip())
finally:
    Path(name).unlink(missing_ok=True)

print(json.dumps({'ok':not errors,'errors':errors,'systems':142,'schema':10,'report':report},ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
