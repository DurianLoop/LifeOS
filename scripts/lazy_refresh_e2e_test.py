#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import json, shutil, tempfile, threading, time, sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import product_core as pc
from engine.incremental_index import reindex_paths, run_one_pending_refresh

def copy_state(dst:Path):
    for name in ('vault','data','config'):shutil.copytree(ROOT/name,dst/name)
    life=dst/'.lifeos';life.mkdir()
    shutil.copy2(ROOT/'.lifeos'/'core.db',life/'core.db')
    if (ROOT/'.lifeos'/'revisions').exists():shutil.copytree(ROOT/'.lifeos'/'revisions',life/'revisions')
    for d in ('attachments','imports','backups'):(life/d).mkdir(exist_ok=True)

def main():
    tmp=Path(tempfile.mkdtemp(prefix='lifeos-lazy-refresh-e2e-'))
    try:
        copy_state(tmp);pc.seed_feature_dependencies(root=tmp);pc.recover_refresh_state(tmp)
        # Reset queue markers in the isolated test copy while keeping the live derived DB snapshot.
        con=pc.connect(tmp)
        con.execute("UPDATE refresh_state SET requested_generation=0,completed_generation=0,status='fresh',reason='lazy refresh test baseline',requested_at=NULL,started_at=NULL,finished_at=NULL,last_duration_ms=NULL,error=NULL")
        con.commit();con.close();pc.mark_deterministic_fresh(tmp)
        e=next(x for x in pc.list_entries(2000,tmp) if x.get('journal_date'))
        cur=pc.read_revision(e['current_revision_id'],tmp);text=cur['content'].rstrip()+'\n\n<!-- LAZY REFRESH E2E -->\n'
        saved=pc.save_entry(journal_date=e['journal_date'],sections={},entry_id=e['entry_id'],title=e.get('title') or '',tags=e.get('tags') or [],raw_markdown=text,source='lazy-refresh-e2e',root=tmp)
        t=time.perf_counter();idx=reindex_paths([saved['source_path']],root=tmp);lat_ms=round((time.perf_counter()-t)*1000,1)
        if lat_ms>2500:raise AssertionError(f'base reindex blocked too long: {lat_ms}ms')
        states={x['feature_id']:x['status'] for x in pc.feature_states(tmp)}
        assert states['Timeline']=='fresh',states['Timeline'];assert states['Universal Search']=='fresh',states['Universal Search'];assert states['Topology Atlas']=='dirty',states['Topology Atlas'];assert states['Ask My Life']=='stale',states['Ask My Life']
        box={}
        def first():box['first']=run_one_pending_refresh(tmp)
        th=threading.Thread(target=first);th.start();time.sleep(1.0)
        mid=pc.request_derived_refresh('new edit arrived while corpus refresh was running',tmp)
        th.join(timeout=60);assert not th.is_alive(),'first derived refresh timeout'
        first_result=box['first'];assert first_result['ok'] and first_result['report']['superseded'] is True,first_result
        second=run_one_pending_refresh(tmp);assert second['ok'] and second['report']['superseded'] is False,second
        final=pc.derived_refresh_status(tmp);assert final['status']=='fresh' and final['pending_generations']==0,final
        states={x['feature_id']:x['status'] for x in pc.feature_states(tmp)};assert states['Topology Atlas']=='fresh';assert states['Ask My Life']=='stale'
        print(json.dumps({'ok':True,'base_reindex_ms':lat_ms,'first_generation':first_result['report']['target_generation'],'first_superseded':True,'second_generation':second['report']['target_generation'],'first_build_ms':first_result['report']['duration_ms'],'second_build_ms':second['report']['duration_ms'],'final':final,'ai_remains_stale':states['Ask My Life']=='stale'},ensure_ascii=False,indent=2))
    finally:shutil.rmtree(tmp,ignore_errors=True)
if __name__=='__main__':main()
