#!/usr/bin/env python3
"""Run the reproducible LifeOS full release suite and persist all evidence.

The runner is intentionally repository-local: future development can rerun the
same checks without relying on chat history. It writes one log per check plus a
machine-readable JSON result and a human-readable Markdown report.
"""
from __future__ import annotations
from pathlib import Path
import argparse, datetime as dt, hashlib, json, os, re, sqlite3, subprocess, sys, tempfile, time
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs'/'qa_full'

TESTS=[
 ('vault-integrity',[sys.executable,'scripts/verify_vault.py'],60),
 ('feature-parity',[sys.executable,'scripts/feature_parity_audit.py'],60),
 ('add-only',[sys.executable,'scripts/add_only_audit.py'],60),
 ('memory-engine-self-test',[sys.executable,'scripts/self_test.py'],90),
 ('refinement-i',[sys.executable,'scripts/refinement_smoke_test.py'],60),
 ('refinement-ii',[sys.executable,'scripts/refinement_ii_smoke_test.py'],60),
 ('refinement-iii',[sys.executable,'scripts/refinement_iii_smoke_test.py'],60),
 ('refinement-iv',[sys.executable,'scripts/refinement_iv_smoke_test.py'],60),
 ('refinement-v',[sys.executable,'scripts/refinement_v_smoke_test.py'],60),
 ('refinement-vi',[sys.executable,'scripts/refinement_vi_smoke_test.py'],60),
 ('refinement-vii',[sys.executable,'scripts/refinement_vii_smoke_test.py'],60),
 ('refinement-viii',[sys.executable,'scripts/refinement_viii_smoke_test.py'],90),
 ('living-memory',[sys.executable,'scripts/living_memory_audit.py'],60),
 ('reading-ritual',[sys.executable,'scripts/reading_ritual_audit.py'],60),
 ('core-ix-e2e',[sys.executable,'scripts/core_ix_e2e_test.py'],120),
 ('lazy-refresh-race',[sys.executable,'scripts/lazy_refresh_e2e_test.py'],120),
 ('p0-p1-release',[sys.executable,'scripts/p0_p1_release_audit.py'],180),
 ('p2-e2e',[sys.executable,'scripts/p2_e2e_test.py'],180),
 ('p2-portability',[sys.executable,'scripts/p2_portability_test.py'],120),
 ('p2-release',[sys.executable,'scripts/p2_release_audit.py'],90),
]

def utcnow(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')

def run_one(name,cmd,timeout):
 start=time.perf_counter();env=os.environ.copy();test_tmp=OUT/'tmp';test_tmp.mkdir(parents=True,exist_ok=True)
 env.setdefault('PYTHONUTF8','1');env['PYTHON_KEYRING_BACKEND']='keyring.backends.fail.Keyring';env['TEMP']=str(test_tmp);env['TMP']=str(test_tmp)
 try:
  # The desktop host may use a GBK locale while every LifeOS check emits UTF-8.
  # Decode explicitly so a valid Unicode test report is never recorded as a
  # spurious release failure on Windows.
  p=subprocess.run(cmd,cwd=ROOT,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
  ok=p.returncode==0;status='passed' if ok else 'failed';out=(p.stdout or '')+(("\n[stderr]\n"+p.stderr) if p.stderr else '')
 except subprocess.TimeoutExpired as e:
  ok=False;status='timeout';out=(e.stdout or '')+(e.stderr or '')+f'\nTimed out after {timeout}s\n'
 elapsed=round(time.perf_counter()-start,3);(OUT/f'{name}.log').write_text(out,encoding='utf-8')
 result={'name':name,'status':status,'ok':ok,'seconds':elapsed,'command':' '.join(map(str,cmd)),'log':f'docs/qa_full/{name}.log'}
 (OUT/f'{name}.status.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 return result

def static_checks():
 results=[]
 # Python syntax/bytecode compilation without writing __pycache__ into release tree.
 py_files=[p for d in ('engine','backend','cloud','connectors','importers','scripts') for p in (ROOT/d).rglob('*.py')]
 bad=[]
 for p in py_files:
  try:compile(p.read_text(encoding='utf-8'),str(p),'exec')
  except Exception as e:bad.append(f'{p.relative_to(ROOT)}: {e}')
 results.append({'name':'python-syntax','ok':not bad,'status':'passed' if not bad else 'failed','details':{'files':len(py_files),'errors':bad}})
 # JS syntax: inline scripts + Electron CJS.
 if not shutil_which('node'):
  results.append({'name':'javascript-syntax','ok':False,'status':'failed','details':{'error':'node not installed'}})
 else:
  js_errors=[];checked=0
  targets=[ROOT/'app/index.html',ROOT/'mobile/www/index.html',ROOT/'cloud/web/index.html',ROOT/'desktop/pet.html']
  with tempfile.TemporaryDirectory(prefix='lifeos-js-check-',dir=OUT) as td:
   td=Path(td)
   for html in targets:
    text=html.read_text(encoding='utf-8');scripts=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>',text,re.I)
    for i,code in enumerate(scripts):
     if not code.strip():continue
     q=td/f'{html.stem}-{i}.js';q.write_text(code,encoding='utf-8');r=subprocess.run(['node','--check',str(q)],capture_output=True,text=True);checked+=1
     if r.returncode:js_errors.append(f'{html.relative_to(ROOT)} script#{i}: {r.stderr.strip()}')
   for js in (ROOT/'desktop/main.cjs',ROOT/'desktop/preload.cjs'):
    r=subprocess.run(['node','--check',str(js)],capture_output=True,text=True);checked+=1
    if r.returncode:js_errors.append(f'{js.relative_to(ROOT)}: {r.stderr.strip()}')
  results.append({'name':'javascript-syntax','ok':not js_errors,'status':'passed' if not js_errors else 'failed','details':{'units':checked,'errors':js_errors}})
 # JSON config validity.
 json_errors=[];json_files=[]
 for d in ('config','mobile','marketplace','docs/qa_p2'):
  base=ROOT/d
  if base.exists():json_files.extend(base.rglob('*.json'))
 for p in json_files:
  try:json.loads(p.read_text(encoding='utf-8'))
  except Exception as e:json_errors.append(f'{p.relative_to(ROOT)}: {e}')
 results.append({'name':'json-validity','ok':not json_errors,'status':'passed' if not json_errors else 'failed','details':{'files':len(json_files),'errors':json_errors}})
 # Secret and test-identity hygiene.
 token_re=re.compile(r'(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}');hits=[];text_ext={'.py','.js','.cjs','.html','.md','.json','.toml','.yaml','.yml','.sh','.bat','.txt','.example'}
 for p in ROOT.rglob('*'):
  if not p.is_file() or p.suffix.lower() not in text_ext or 'node_modules' in p.parts or '.lifeos' in p.parts:continue
  try:t=p.read_text(encoding='utf-8',errors='ignore')
  except Exception:continue
  if token_re.search(t):hits.append(str(p.relative_to(ROOT)))
 forbidden=[p for p in (ROOT/'.env',ROOT/'cloud/dev_cloud.db') if p.exists()]
 device_rows=[]
 db=ROOT/'.lifeos/core.db'
 if db.exists():
  c=sqlite3.connect(db)
  try:
   device_rows=c.execute("SELECT key,value FROM settings WHERE key='device.id'").fetchall()+[(f'devices:{r[0]}',r[0]) for r in c.execute('SELECT device_id FROM devices')]
  finally:c.close()
 desktop=json.loads((ROOT/'desktop/package.json').read_text(encoding='utf-8'));packaged=[str(x.get('from','')) for x in desktop.get('build',{}).get('extraResources',[]) if isinstance(x,dict)];runtime_excluded=not any('.lifeos' in x.replace('\\','/').lower() for x in packaged)
 ok=not hits and not forbidden and runtime_excluded
 results.append({'name':'release-hygiene','ok':ok,'status':'passed' if ok else 'failed','details':{'token_hits':hits,'forbidden_files':[str(x.relative_to(ROOT)) for x in forbidden],'runtime_state_packaged':not runtime_excluded,'runtime_device_rows_ignored':len(device_rows)}})
 # Baseline release counts.
 c=sqlite3.connect(ROOT/'.lifeos/core.db');entries=c.execute('SELECT COUNT(*) FROM entries').fetchone()[0];revs=c.execute('SELECT COUNT(*) FROM revisions').fetchone()[0];schema=int(c.execute("SELECT value FROM settings WHERE key='product.schema_version'").fetchone()[0]);c.close();features=len(json.loads((ROOT/'config/features_142_baseline.json').read_text(encoding='utf-8')))
 ok=(entries>=550 and revs>=entries and features==142 and schema>=9)
 results.append({'name':'release-baseline','ok':ok,'status':'passed' if ok else 'failed','details':{'entries':entries,'revisions':revs,'features':features,'schema':schema}})
 return results

def shutil_which(cmd):
 import shutil;return shutil.which(cmd)

def finalize(started=None):
 if started is None:
  stamps=[q.stat().st_mtime for q in OUT.glob('*.status.json')]
  started=dt.datetime.fromtimestamp(min(stamps),dt.timezone.utc).isoformat(timespec='seconds') if stamps else utcnow()
 suite=[];missing=[]
 for name,cmd,timeout in TESTS:
  q=OUT/f'{name}.status.json'
  if not q.exists():missing.append(name);continue
  suite.append(json.loads(q.read_text(encoding='utf-8')))
 suite.extend(static_checks())
 if missing:suite.append({'name':'suite-completeness','ok':False,'status':'failed','details':{'missing':missing}})
 passed=sum(1 for x in suite if x['ok']);failed=len(suite)-passed;ok=failed==0
 result={'ok':ok,'release':'Core X · Personal Memory Platform · P2','started_at':started,'finished_at':utcnow(),'summary':{'total':len(suite),'passed':passed,'failed':failed,'expected_dynamic':len(TESTS),'missing_dynamic':missing},'checks':suite}
 (OUT/'TEST_RESULTS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 lines=['# LifeOS Full Release Test Report','',f"- Release: **{result['release']}**",f"- Started: `{started}`",f"- Finished: `{result['finished_at']}`",f"- Result: **{'PASS' if ok else 'FAIL'}**",f"- Checks: **{passed}/{len(suite)} passed**",'', '## Results','', '| Check | Status | Time | Evidence |','|---|---:|---:|---|']
 for r in suite:
  ev=r.get('log','inline static audit');secs=f"{r.get('seconds','—')}s" if 'seconds' in r else '—';lines.append(f"| `{r['name']}` | {'PASS' if r['ok'] else 'FAIL'} | {secs} | `{ev}` |")
 lines+=['','## Notes','','- P2 tests use temporary copies/databases so the release Vault and baseline Core DB are not mutated.','- Browser screenshots from prior visual QA remain under `docs/qa_p2/`; this runner focuses on reproducible functional/regression/static evidence.','- Signing, notarization, App Store/Play publication, production TLS/cloud infrastructure, APNs/FCM and live Stripe credentials are external deployment requirements and are not simulated as completed.','']
 (OUT/'TEST_REPORT.md').write_text('\n'.join(lines),encoding='utf-8')
 print(json.dumps(result['summary'],ensure_ascii=False));return 0 if ok else 1

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--only',help='comma-separated dynamic test names');ap.add_argument('--reset',action='store_true');ap.add_argument('--finalize',action='store_true');args=ap.parse_args()
 OUT.mkdir(parents=True,exist_ok=True)
 if args.reset:
  for p in OUT.glob('*.log'):p.unlink()
  for p in OUT.glob('*.status.json'):p.unlink()
  for p in (OUT/'TEST_RESULTS.json',OUT/'TEST_REPORT.md'):
   if p.exists():p.unlink()
 if args.finalize:return finalize()
 selected=TESTS
 if args.only:
  wanted={x.strip() for x in args.only.split(',') if x.strip()};selected=[x for x in TESTS if x[0] in wanted]
  unknown=wanted-{x[0] for x in selected}
  if unknown:raise SystemExit('unknown tests: '+','.join(sorted(unknown)))
 for spec in selected:
  r=run_one(*spec);print(f"[{r['status'].upper():7}] {r['name']} {r['seconds']}s",flush=True)
 return 0 if all(json.loads((OUT/f'{x[0]}.status.json').read_text())['ok'] for x in selected) else 1
if __name__=='__main__':raise SystemExit(main())
