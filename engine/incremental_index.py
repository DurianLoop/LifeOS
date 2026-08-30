#!/usr/bin/env python3
"""Fast incremental base index + generation-coalesced corpus refresh.

Writer/import/sync paths update the source-backed/index tables immediately, then
queue the expensive corpus-wide relational layers. A background worker builds
those layers on an isolated SQLite snapshot and only publishes it if no newer
source generation arrived while it was working.
"""
from __future__ import annotations
from pathlib import Path
import datetime, json, os, shutil, sqlite3, sys, tempfile, threading, time, uuid

ROOT=Path(__file__).resolve().parents[1]
ENGINE_DIR=ROOT/'engine'
if str(ENGINE_DIR) not in sys.path: sys.path.insert(0,str(ENGINE_DIR))

import engine.rebuild_memory_engine as rebuild_engine
from engine.rebuild_memory_engine import add_file, build_month_stats, CFG
from engine.surprise_engine import build_surprise_layer
from engine.discovery_engine import build_discovery_layer
from engine.timefold_engine import build_timefold_layer
from engine.mirror_engine import build_mirror_layer
from engine.compass_engine import build_compass_layer
from engine.topology_engine import build_topology_layer
from engine.footprint_engine import build_footprint_layer
from engine.lineage_engine import build_lineage_layer
from engine import product_core as product

# Protect only the short live-DB mutation/publish windows. Expensive corpus builds
# happen on a private snapshot and therefore never hold this lock.
_PUBLISH_LOCK=threading.RLock()


def kind_for_path(rel):
    rel=rel.replace('\\','/')
    return 'weekly' if '/weekly/' in '/'+rel else 'daily'


def rebuild_term_monthly(con):
    con.execute('DELETE FROM term_monthly')
    rows=con.execute("""SELECT m.id,m.date,s.normalized_name,s.content
                        FROM memories m JOIN sections s ON s.memory_id=m.id
                        WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL
                        ORDER BY m.id,s.ordinal""").fetchall()
    grouped={}
    for r in rows:
        if r['normalized_name']=='习惯打卡': continue
        grouped.setdefault((r['id'],r['date']),[]).append(r['content'] or '')
    for (_mid,date),parts in grouped.items():
        text='\n'.join(parts); month=date[:7]
        for term in CFG['word_terms']:
            c=text.lower().count(term.lower())
            if c:
                con.execute("""INSERT INTO term_monthly(month,term,mention_count) VALUES(?,?,?)
                    ON CONFLICT(month,term) DO UPDATE SET mention_count=mention_count+excluded.mention_count""",(month,term,c))


def refresh_meta(con, engine_version='Memory Engine 11.1 · Core IX lazy refresh'):
    def n(t): return con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
    vals={
      'daily':con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily'").fetchone()[0],
      'weekly':con.execute("SELECT COUNT(*) FROM memories WHERE kind='weekly'").fetchone()[0],
      'events':n('event_candidates'),'ideas':n('idea_candidates'),'questions':n('question_candidates'),
      'beliefs':n('belief_candidates'),'achievements':n('achievement_candidates'),'decisions':n('decision_candidates'),
      'projects':n('project_candidates'),'quotes':n('quote_candidates')}
    vals['total']=vals['daily']+vals['weekly']
    now=datetime.datetime.now().isoformat(timespec='seconds')
    con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('built_at',?)",(now,))
    con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('engine_version',?)",(engine_version,))
    for k,v in vals.items(): con.execute('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',(k,str(v)))
    return vals


def reindex_paths(paths, *, root:Path=ROOT, deleted_paths=None, queue_derived=True, reason=None):
    """Update only changed source/index rows and queue expensive corpus lenses.

    This function is intentionally suitable for the synchronous Writer request
    path. It does not run Topology/Lineage/etc.
    """
    db=root/'data/lifeos.db'; vault=root/'vault'; deleted_paths=deleted_paths or []
    if not db.exists(): raise FileNotFoundError('data/lifeos.db missing; run full rebuild first')
    changed=[]; removed=[]; counts={}
    with _PUBLISH_LOCK:
        con=sqlite3.connect(db,timeout=30);con.row_factory=sqlite3.Row;con.execute('PRAGMA foreign_keys=ON')
        try:
            for rel in sorted(set([str(x).replace('\\','/') for x in deleted_paths])):
                r=con.execute('SELECT id FROM memories WHERE source_path=?',(rel,)).fetchone()
                if r:
                    con.execute('DELETE FROM memory_fts WHERE memory_id=?',(r['id'],));con.execute('DELETE FROM memories WHERE id=?',(r['id'],));removed.append(rel)
            original_vault=rebuild_engine.VAULT
            rebuild_engine.VAULT=vault
            try:
                for rel in sorted(set([str(x).replace('\\','/') for x in paths])):
                    p=vault/rel
                    if not p.exists(): continue
                    old=con.execute('SELECT id FROM memories WHERE source_path=?',(rel,)).fetchone()
                    if old:
                        con.execute('DELETE FROM memory_fts WHERE memory_id=?',(old['id'],));con.execute('DELETE FROM memories WHERE id=?',(old['id'],))
                    add_file(con,p,kind_for_path(rel),True);changed.append(rel)
            finally:
                rebuild_engine.VAULT=original_vault
            # Small deterministic aggregates stay synchronous so Home/Search/date
            # lenses are current immediately after Save.
            con.execute('DELETE FROM month_stats');rebuild_term_monthly(con);build_month_stats(con)
            counts=refresh_meta(con);con.commit()
        except Exception:
            con.rollback();raise
        finally: con.close()
    product.mark_base_fresh(root)
    refresh=None
    if queue_derived and (changed or removed):
        refresh=product.request_derived_refresh(reason or f"base index changed: {len(changed)} changed / {len(removed)} removed",root)
    return {'changed':changed,'removed':removed,'counts':counts,'layers':'queued' if refresh else 'unchanged','derived_refresh':refresh}


def _snapshot_db(src:Path,dst:Path):
    srccon=sqlite3.connect(src,timeout=30); dstcon=sqlite3.connect(dst,timeout=30)
    try: srccon.backup(dstcon)
    finally: dstcon.close();srccon.close()


def _publish_db(snapshot:Path, live:Path):
    """Publish a fully built snapshot using SQLite's backup API.

    This avoids Windows rename/open-handle problems and keeps the live database
    file stable for short-lived API readers.
    """
    src=sqlite3.connect(snapshot,timeout=30);dst=sqlite3.connect(live,timeout=30)
    try:
        src.backup(dst)
    finally:
        dst.close();src.close()


def refresh_derived_layers(*, root:Path=ROOT, target_generation:int|None=None):
    """Build all expensive corpus layers on an isolated snapshot.

    If a newer source generation is requested while building, the snapshot is
    discarded instead of publishing stale mixed-generation derived data.
    """
    live=root/'data/lifeos.db'
    if not live.exists(): raise FileNotFoundError('data/lifeos.db missing')
    if target_generation is None:
        target_generation=int(product.derived_refresh_status(root)['requested_generation'])
    tmpdir=Path(tempfile.mkdtemp(prefix='lifeos-derived-',dir=str(root/'data')))
    snap=tmpdir/'lifeos.refresh.db'; started=time.perf_counter()
    try:
        # Snapshot the latest fully committed base DB. Base edits remain free to
        # continue against `live` while the expensive layer build runs here.
        with _PUBLISH_LOCK: _snapshot_db(live,snap)
        con=sqlite3.connect(snap,timeout=30);con.row_factory=sqlite3.Row;con.execute('PRAGMA foreign_keys=ON')
        try:
            reports={
              'curiosity':build_surprise_layer(con,CFG),
              'observatory':build_discovery_layer(con,CFG),
              'timefold':build_timefold_layer(con,CFG),
              'mirror':build_mirror_layer(con,CFG),
              'compass':build_compass_layer(con,CFG),
              'topology':build_topology_layer(con,CFG),
              'footprint':build_footprint_layer(con,CFG),
              'lineage':build_lineage_layer(con,CFG),
            }
            refresh_meta(con);con.commit()
        finally: con.close()
        # Only a generation built from the latest base snapshot is allowed to
        # replace the live derived DB.
        with _PUBLISH_LOCK:
            st=product.derived_refresh_status(root)
            superseded=int(st['requested_generation'])!=int(target_generation)
            if not superseded: _publish_db(snap,live)
        ms=round((time.perf_counter()-started)*1000)
        return {'ok':True,'target_generation':target_generation,'superseded':superseded,'duration_ms':ms,'layers':reports}
    finally:
        shutil.rmtree(tmpdir,ignore_errors=True)


def run_one_pending_refresh(root:Path=ROOT):
    claim=product.claim_derived_refresh(root)
    if not claim:return {'ok':True,'ran':False,'status':product.derived_refresh_status(root)}
    target=claim['target_generation']; started=time.perf_counter()
    try:
        report=refresh_derived_layers(root=root,target_generation=target)
        st=product.complete_derived_refresh(target,root=root,duration_ms=report['duration_ms'],superseded=report['superseded'])
        return {'ok':True,'ran':True,'report':report,'status':st}
    except Exception as e:
        ms=round((time.perf_counter()-started)*1000)
        st=product.complete_derived_refresh(target,root=root,error=str(e),duration_ms=ms)
        return {'ok':False,'ran':True,'error':str(e),'status':st}


def drain_pending_refresh(root:Path=ROOT,max_runs=5):
    out=[]
    for _ in range(max_runs):
        st=product.derived_refresh_status(root)
        if int(st['requested_generation'])<=int(st['completed_generation']):break
        r=run_one_pending_refresh(root);out.append(r)
        if not r.get('ok'):break
    return {'runs':out,'status':product.derived_refresh_status(root)}


if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('paths',nargs='*');ap.add_argument('--refresh',action='store_true');args=ap.parse_args()
    if args.refresh: print(json.dumps(drain_pending_refresh(ROOT),ensure_ascii=False,indent=2))
    else: print(json.dumps(reindex_paths(args.paths),ensure_ascii=False,indent=2))
