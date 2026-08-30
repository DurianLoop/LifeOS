#!/usr/bin/env python3
"""V0.1 acceptance gate for the user-owned 550-entry archive.

This gate intentionally treats the real archive as the baseline. It does not
rewrite Vault Markdown. Writer mutation semantics are tested in an isolated
fixture directory.
"""
from __future__ import annotations
from pathlib import Path
import hashlib, json, sqlite3, sys, tempfile, shutil

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import product_core as product

EXPECTED_DAILY=518
EXPECTED_WEEKLY=32
EXPECTED_TOTAL=550

checks=[]
def check(name, ok, detail=''):
    checks.append({'name':name,'ok':bool(ok),'detail':str(detail)})
    print(('PASS' if ok else 'FAIL')+f' · {name}'+(f' · {detail}' if detail else ''))
    return bool(ok)

# 1. Source corpus + manifest hashes.
vault=ROOT/'vault'; manifest=json.loads((vault/'manifest.json').read_text(encoding='utf-8'))
manifest_files=manifest.get('files') or []
hash_errors=[]
for item in manifest_files:
    p=vault/item['vault_path']
    if not p.exists(): hash_errors.append(f"missing:{item['vault_path']}"); continue
    if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:
        hash_errors.append(f"hash:{item['vault_path']}")
daily=list((vault/'memories/daily').glob('*/*.md'))
weekly=list((vault/'memories/weekly').glob('*/*.md'))
check('vault daily count',len(daily)==EXPECTED_DAILY,len(daily))
check('vault weekly count',len(weekly)==EXPECTED_WEEKLY,len(weekly))
check('vault total source count',len(daily)+len(weekly)==EXPECTED_TOTAL,len(daily)+len(weekly))
check('manifest source count',len(manifest_files)==EXPECTED_TOTAL,len(manifest_files))
check('manifest SHA-256 integrity',not hash_errors,', '.join(hash_errors[:3]) if hash_errors else '0 mismatches')

# 2. Durable product core must map one Entry to each baseline source.
boot=product.bootstrap_existing(ROOT)
core=product.core_status(ROOT)
check('core bootstrap sees 550 source files',boot.get('total')==EXPECTED_TOTAL,boot)
check('core entry baseline',core.get('entries')==EXPECTED_TOTAL,core.get('entries'))
check('each baseline entry has at least one revision',core.get('revisions',0)>=EXPECTED_TOTAL,core.get('revisions'))
entries=product.list_entries(5000,ROOT)
source_set={e['source_path'] for e in entries}
expected_sources={str(p.relative_to(vault)).replace('\\','/') for p in daily+weekly}
missing=sorted(expected_sources-source_set)
check('all Vault sources are addressable by Entry',not missing,', '.join(missing[:3]) if missing else 'complete')

# 3. Disposable Memory Engine coverage / local search substrate.
con=sqlite3.connect(ROOT/'data/lifeos.db')
try:
    by_kind=dict(con.execute('SELECT kind,COUNT(*) FROM memories GROUP BY kind').fetchall())
    covered=con.execute('SELECT COUNT(DISTINCT memory_id) FROM sections').fetchone()[0]
    fts_rows=con.execute('SELECT COUNT(*) FROM memory_fts').fetchone()[0]
    anomaly=con.execute("SELECT COUNT(*) FROM memories WHERE date_anomaly=1").fetchone()[0]
finally: con.close()
check('memory engine daily coverage',by_kind.get('daily')==EXPECTED_DAILY,by_kind.get('daily'))
check('memory engine weekly coverage',by_kind.get('weekly')==EXPECTED_WEEKLY,by_kind.get('weekly'))
check('all 550 sources have parsed sections',covered==EXPECTED_TOTAL,covered)
check('local search index is populated',fts_rows>EXPECTED_TOTAL,f'{fts_rows} FTS rows')
check('known date anomalies remain flagged, not rewritten',anomaly>=1,f'{anomaly} flagged')

# 4. Copy architecture must retain the three requested presets and poetic JSON source.
deck=json.loads((ROOT/'config/copydeck.json').read_text(encoding='utf-8'))
keys={x.get('key') for x in deck.get('core_surfaces',[])}
check('copydeck has writer surface','writer' in keys)
check('copydeck has search surface','search' in keys)
check('copydeck has 10 visual themes',len(deck.get('themes') or [])>=10,len(deck.get('themes') or []))
settings=product.settings_dict(ROOT)
check('locale setting exists',settings.get('ui.locale') in ('zh-CN','en-US'),settings.get('ui.locale'))
check('copy mode setting exists',settings.get('ui.copy_mode') in ('clear','poetic'),settings.get('ui.copy_mode'))

# 5. Writer semantics in an isolated fixture: save -> revision -> restore.
fixture_ok=True; fixture_detail=''
try:
    with tempfile.TemporaryDirectory(prefix='lifeos-v01-writer-') as td:
        r=Path(td);(r/'vault').mkdir(parents=True);(r/'config').mkdir();
        first=product.save_entry(journal_date='2026-08-29',sections={'日记':'第一笔'},title='fixture',root=r,enqueue_sync=False)
        second=product.save_entry(journal_date='2026-08-29',sections={'日记':'第二笔'},entry_id=first['entry_id'],title='fixture',root=r,enqueue_sync=False)
        revs=product.list_revisions(first['entry_id'],r)
        if len(revs)!=2: raise AssertionError(f'expected 2 revisions, got {len(revs)}')
        restored=product.restore_revision(first['entry_id'],first['revision_id'],r)
        revs2=product.list_revisions(first['entry_id'],r)
        if len(revs2)!=3: raise AssertionError(f'restore should append revision, got {len(revs2)}')
        if restored['revision_id']==first['revision_id']: raise AssertionError('restore reused old revision id')
        current=product.read_revision(restored['revision_id'],r)
        if '第一笔' not in current['content']: raise AssertionError('restored content mismatch')
        fixture_detail='2 saves + restore => 3 append-only revisions'
except Exception as e:
    fixture_ok=False;fixture_detail=repr(e)
check('writer is append-only and restore-safe',fixture_ok,fixture_detail)

result={'schema':'lifeos-v0.1-acceptance-v1','expected':{'daily':EXPECTED_DAILY,'weekly':EXPECTED_WEEKLY,'total':EXPECTED_TOTAL},'passed':sum(1 for x in checks if x['ok']),'failed':sum(1 for x in checks if not x['ok']),'checks':checks}
out=ROOT/'docs/qa_v0_1_iteration_1';out.mkdir(parents=True,exist_ok=True)
(out/'acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# LifeOS V0.1 · Iteration 1 Acceptance','',f"- Passed: **{result['passed']}**",f"- Failed: **{result['failed']}**",f"- Baseline: **{EXPECTED_DAILY} daily + {EXPECTED_WEEKLY} weekly = {EXPECTED_TOTAL} sources**",'']
for x in checks:lines.append(f"- {'✅' if x['ok'] else '❌'} **{x['name']}** — {x['detail']}")
(out/'ACCEPTANCE.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'passed':result['passed'],'failed':result['failed'],'report':str(out/'ACCEPTANCE.md')},ensure_ascii=False))
sys.exit(1 if result['failed'] else 0)
