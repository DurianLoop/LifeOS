#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import json,re,sqlite3,sys
ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'.lifeos'/'core.db'

def check(ok,msg):
    if not ok: raise AssertionError(msg)

def main():
    report={'ok':False,'release':'Core X P2','checks':{}}
    c=sqlite3.connect(DB);c.row_factory=sqlite3.Row
    try:
        settings=dict(c.execute('SELECT key,value FROM settings'))
        tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required={'entries','revisions','memory_inbox','notifications','connector_configs','addon_installs','share_records','subscription_cache','p2_sync_state'}
        check(required<=tables,'P2 core tables missing: '+str(required-tables))
        entries=c.execute('SELECT COUNT(*) FROM entries').fetchone()[0];revs=c.execute('SELECT COUNT(*) FROM revisions').fetchone()[0]
        check(entries>=550 and revs>=entries,f'release baseline expected at least 550 entries and append-only revisions, got {entries}/{revs}')
        check(int(settings.get('product.schema_version','0'))>=9,'P2 core schema < 9')
        report['checks']['core']={'schema':int(settings['product.schema_version']),'entries':entries,'revisions':revs,'p2_tables':sorted(required)}
    finally:c.close()
    baseline=json.loads((ROOT/'config/features_142_baseline.json').read_text(encoding='utf-8'));check(len(baseline)==142,'142 feature baseline changed');report['checks']['features']=142
    files=['engine/p2_core.py','engine/p2_sync.py','engine/crypto_vault.py','engine/notification_engine.py','connectors/base.py','connectors/formats.py','cloud/p2_services.py','cloud/billing.py','mobile/www/index.html','scripts/p2_portability_test.py','cloud/web/index.html','marketplace/catalog.json']
    missing=[x for x in files if not (ROOT/x).exists()];check(not missing,'P2 files missing: '+str(missing));report['checks']['p2_files']=len(files)
    mobile=(ROOT/'mobile/www/index.html').read_text(encoding='utf-8');check(all(f'data-tab="{x}"' in mobile for x in ('today','write','inbox','ask','me')),'mobile IA is not the five-surface contract');check('MediaRecorder' in mobile and 'photoInput' in mobile and 'encrypted_envelope' in mobile,'mobile capture/E2EE contract missing');check('indexedDB.open' in mobile and 'flushQueue' in mobile and '/v2/account/export' in mobile and '/v2/account/delete' in mobile,'mobile offline/data portability contract missing')
    web=(ROOT/'cloud/web/index.html').read_text(encoding='utf-8');check('lifeosWebRecoveryKey' in web and 'encryptPayload' in web and 'decryptEnvelope' in web,'Web Companion E2EE contract missing')
    cloud=(ROOT/'cloud/dev_sync_server.py').read_text(encoding='utf-8')+(ROOT/'cloud/p2_services.py').read_text(encoding='utf-8');check('/v2/billing/webhook' in cloud and 'billing_webhook' in cloud,'signed billing webhook missing');check('/v2/account/delete' in cloud and '/v2/account/export' in cloud and 'delete_user_data' in cloud,'account export/delete contract missing')
    market=json.loads((ROOT/'marketplace/catalog.json').read_text(encoding='utf-8'));check(market.get('items'),'marketplace catalog empty');report['checks']['surfaces']={'mobile_tabs':5,'mobile_offline_queue':True,'account_portability':True,'web_e2ee':True,'billing_webhook':True,'marketplace_items':len(market['items'])}
    dangerous=('exec','shell','postinstall','python_entry','node_entry')
    for item in market['items']:
        check(not any(k in item for k in dangerous),'bundled marketplace manifest contains executable field')
    # Release secret hygiene: no local env/secret/cloud-dev DB and no high-entropy sk-* token in text sources.
    forbidden=[ROOT/'.env',ROOT/'cloud'/'dev_cloud.db']
    check(not any(p.exists() for p in forbidden),'local secret/dev cloud file present in release tree')
    desktop=json.loads((ROOT/'desktop'/'package.json').read_text(encoding='utf-8'))
    packaged=[str(x.get('from','')) for x in desktop.get('build',{}).get('extraResources',[]) if isinstance(x,dict)]
    check(not any('.lifeos' in x.replace('\\','/').lower() for x in packaged),'runtime secrets directory must not be packaged')
    token_re=re.compile(r'(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}')
    hits=[]
    text_ext={'.py','.js','.cjs','.html','.md','.json','.toml','.yaml','.yml','.sh','.bat','.txt','.example'}
    for p in ROOT.rglob('*'):
        if not p.is_file() or p.suffix.lower() not in text_ext or 'node_modules' in p.parts or '.lifeos' in p.parts:continue
        try:t=p.read_text(encoding='utf-8',errors='ignore')
        except Exception:continue
        if token_re.search(t):hits.append(str(p.relative_to(ROOT)))
    check(not hits,'possible embedded API token(s): '+str(hits));report['checks']['secret_hygiene']='clean'
    report['ok']=True
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
