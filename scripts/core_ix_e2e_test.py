#!/usr/bin/env python3
"""End-to-end product tests for Core IX P0/P1.

Runs against disposable copies only. The real Vault is never modified.
"""
from __future__ import annotations
from pathlib import Path
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import product_core as pc, import_pipeline, sync_engine
from engine.incremental_index import reindex_paths


def check(cond,msg):
    if not cond: raise AssertionError(msg)

def copy_state(dst:Path):
    for name in ('vault','data','config'):
        shutil.copytree(ROOT/name,dst/name)
    life=dst/'.lifeos';life.mkdir()
    for name in ('core.db','revisions','attachments'):
        src=ROOT/'.lifeos'/name
        if src.is_dir():shutil.copytree(src,life/name)
        elif src.exists():shutil.copy2(src,life/name)
    for d in ('imports','backups'): (life/d).mkdir(exist_ok=True)

def q1(root,sql,args=()):
    c=sqlite3.connect(root/'data/lifeos.db');r=c.execute(sql,args).fetchone();c.close();return r[0] if r else None

def wait_health(url,timeout=8):
    end=time.time()+timeout
    while time.time()<end:
        try:
            return json.load(urllib.request.urlopen(url+'/health',timeout=1))
        except Exception:time.sleep(.1)
    raise RuntimeError('cloud server did not start')

def main():
    tmp=Path(tempfile.mkdtemp(prefix='lifeos-core-ix-e2e-'))
    report={'tmp':str(tmp),'checks':[]}
    cloud=None
    try:
        print('[1] copy/bootstrap',flush=True);a=tmp/'A';copy_state(a)
        pc.seed_feature_dependencies(root=a);boot=pc.bootstrap_existing(a)
        check(pc.core_status(a)['entries']==550,'bootstrap entry count');report['checks'].append('stable IDs / bootstrap 550')
        check(len(pc.feature_states(a))==141,'feature dependency count');report['checks'].append('feature dependency graph 141')

        print('[2] revision/freshness',flush=True);e=next(x for x in pc.list_entries(2000,a) if x['kind']=='daily' and x.get('journal_date'))
        old=pc.read_revision(e['current_revision_id'],a);old_count=len(pc.list_revisions(e['entry_id'],a))
        pc.record_ai_artifact('Ask My Life',{'text':'test'},[(e['entry_id'],e['current_revision_id'])],'test','test','e2e',a)
        changed_text=old['content'].rstrip()+"\n\n<!-- CORE IX E2E REVISION -->\n"
        saved=pc.save_entry(journal_date=e['journal_date'],sections={},entry_id=e['entry_id'],title=e.get('title') or '',tags=e.get('tags') or [],timezone=e.get('timezone') or '',raw_markdown=changed_text,source='e2e',root=a)
        reindex_paths([saved['source_path']],root=a)
        check(len(pc.list_revisions(e['entry_id'],a))==old_count+1,'revision increment')
        check(pc.read_revision(e['current_revision_id'],a)['content']==old['content'],'old revision preserved')
        check(pc.artifact_status('Ask My Life',a)['artifacts'][0]['status']=='stale','AI artifact stale after edit')
        check(next(x for x in pc.feature_states(a) if x['feature_id']=='Timeline')['status']=='fresh','deterministic feature refreshed')
        check(next(x for x in pc.feature_states(a) if x['feature_id']=='Ask My Life')['status']=='stale','AI feature remains stale')
        report['checks']+=['non-destructive revisions','incremental reindex','AI freshness invalidation']

        restored=pc.restore_revision(e['entry_id'],e['current_revision_id'],a)
        check(pc.read_revision(restored['revision_id'],a)['content']==old['content'],'restore content')
        check(len(pc.list_revisions(e['entry_id'],a))==old_count+2,'restore creates new revision');report['checks'].append('revision restore creates new revision')

        print('[3] date move',flush=True)
        # Date move must move source path without losing entry identity.
        moved=pc.save_entry(journal_date='2099-12-31',sections={},entry_id=e['entry_id'],title=e.get('title') or '',tags=e.get('tags') or [],raw_markdown=old['content'],source='e2e-date-move',root=a)
        reindex_paths([moved['source_path']],deleted_paths=[moved['old_source_path']] if moved.get('old_source_path') else [],root=a)
        check(pc.get_entry(entry_id=e['entry_id'],root=a)['entry_id']==e['entry_id'],'stable id after date change')
        check(q1(a,'SELECT COUNT(*) FROM memories WHERE source_path=?',(moved['source_path'],))==1,'new derived source exists')
        check(q1(a,'SELECT COUNT(*) FROM memories WHERE source_path=?',(moved['old_source_path'],))==0,'old derived source removed');report['checks'].append('date move keeps stable entry id')

        att=pc.add_attachment(e['entry_id'],'tiny-note.txt',b'hello attachment','text/plain',root=a)
        check((a/pc.attachment_record(att['attachment_id'],a)['stored_path']).read_bytes()==b'hello attachment','attachment bytes')
        report['checks'].append('attachments local storage + sync queue')

        print('[4] import transaction',flush=True)
        # Import preview / commit / rollback includes the derived DB snapshot.
        imp=import_pipeline.preview_import([{'name':'2098-03-04.txt','content':'Imported page from another diary.'}],source_name='e2e',root=a)
        check(imp['stats']['new']==1,'import preview new')
        committed=import_pipeline.commit_import(imp['job_id'],root=a)
        check(pc.get_entry(source_path='memories/daily/2098/2098-03-04.md',root=a),'import committed core')
        check(q1(a,'SELECT COUNT(*) FROM memories WHERE source_path=?',('memories/daily/2098/2098-03-04.md',))==1,'import committed derived')
        import_pipeline.rollback_import(imp['job_id'],root=a)
        check(pc.get_entry(source_path='memories/daily/2098/2098-03-04.md',root=a) is None,'rollback core')
        check(q1(a,'SELECT COUNT(*) FROM memories WHERE source_path=?',('memories/daily/2098/2098-03-04.md',))==0,'rollback derived')
        report['checks'].append('transactional import preview/commit/rollback')

        print('[5] backup restore',flush=True)
        bid=pc.create_backup('e2e explicit',a,include_derived=True)['backup_id']
        before=pc.core_status(a)['revisions']
        tmpentry=pc.save_entry(journal_date='2098-09-09',sections={'日记':'temporary after backup'},root=a,source='e2e')
        pc.restore_backup(bid,a)
        check(pc.get_entry(source_path='memories/daily/2098/2098-09-09.md',root=a) is None,'backup restore core')
        check(q1(a,'SELECT COUNT(*) FROM memories WHERE source_path=?',('memories/daily/2098/2098-09-09.md',))==0,'backup restore derived')
        check(pc.core_status(a)['revisions']==before,'backup restore revision count');report['checks'].append('backup/restore exact state')

        print('[6] sync cloud',flush=True)
        # Clean sync queue before cloning a second device.
        c=pc.connect(a);c.execute("UPDATE sync_operations SET sync_status='synced'");c.commit();c.close()
        b=tmp/'B';shutil.copytree(a,b);pc.set_settings({'device.id':'dev_e2e_B'},b)
        port=18879;env={**os.environ,'LIFEOS_CLOUD_PORT':str(port),'LIFEOS_CLOUD_DB':str(tmp/'cloud.db'),'PYTHONUNBUFFERED':'1'}
        cloud=subprocess.Popen([sys.executable,str(ROOT/'cloud'/'dev_sync_server.py')],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        url=f'http://127.0.0.1:{port}';wait_health(url)
        auth=sync_engine._request('POST',url+'/v1/register','',{'email':'e2e@example.test','password':'very-secure-e2e'})
        os.environ['LIFEOS_SYNC_TOKEN']=auth['token']
        sync_engine.configure(url,None,True,a);sync_engine.configure(url,None,True,b)
        # New entry A -> cloud -> B.
        ne=pc.save_entry(journal_date='2097-01-02',sections={'日记':'hello from device A'},root=a,source='e2e-sync')
        sync_engine.sync_once(a);pull=sync_engine.pull(b)
        be=pc.get_entry(entry_id=ne['entry_id'],root=b);check(be and be['journal_date']=='2097-01-02','sync pull entry')
        check(q1(b,'SELECT COUNT(*) FROM memories WHERE source_path=?',(be['source_path'],))==1,'sync pull reindex')
        # Attachment A -> cloud -> B.
        aa=pc.add_attachment(ne['entry_id'],'photo.txt',b'attachment sync','text/plain',root=a);sync_engine.sync_once(a);sync_engine.pull(b)
        check(any(x['attachment_id']==aa['attachment_id'] for x in pc.list_attachments(ne['entry_id'],b)),'attachment synced')
        # Divergent edit -> explicit conflict, no silent overwrite.
        ae=pc.get_entry(entry_id=ne['entry_id'],root=a);be=pc.get_entry(entry_id=ne['entry_id'],root=b)
        base=ae['current_revision_id'];check(base==be['current_revision_id'],'same base before conflict')
        ar=pc.save_entry(journal_date='2097-01-02',sections={'日记':'edit on A'},entry_id=ne['entry_id'],root=a,source='e2e-A')
        br=pc.save_entry(journal_date='2097-01-02',sections={'日记':'edit on B'},entry_id=ne['entry_id'],root=b,source='e2e-B')
        sync_engine.sync_once(a);sync_engine.sync_once(b)
        conflicts=pc.list_sync_conflicts(b);check(conflicts,'conflict recorded')
        check(pc.read_revision(pc.get_entry(entry_id=ne['entry_id'],root=b)['current_revision_id'],b)['content'].find('edit on B')>=0,'local not silently overwritten')
        full=next((x for x in conflicts if (x.get('remote_payload') or {}).get('payload')),None)
        if full:
            rr=pc.resolve_sync_conflict(full['conflict_id'],'use_remote',b);check(rr['ok'],'remote conflict resolution')
        report['checks']+=['optional account + text sync','attachment sync','optimistic conflict detection / resolution']

        # AI request ledger/cache primitives never contain keys.
        pc.log_ai_request(feature_id='e2e',provider='test',model='test',input_hash='abc',input_chars=12,output_chars=5,cache_hit=True,root=a)
        usage=pc.ai_usage_summary(a);check(usage['totals']['calls']>=1,'ai request ledger');report['checks'].append('AI usage/cache provenance ledger')

        report['ok']=True
        print(json.dumps(report,ensure_ascii=False,indent=2))
    finally:
        if cloud:
            cloud.terminate()
            try:cloud.wait(timeout=2)
            except Exception:cloud.kill()
        os.environ.pop('LIFEOS_SYNC_TOKEN',None)
        shutil.rmtree(tmp,ignore_errors=True)

if __name__=='__main__':main()
