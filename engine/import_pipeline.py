#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import os
import base64, io, json, re, shutil, zipfile
from importers import parse_file, choose_importer
from engine import product_core as pc
from engine.incremental_index import reindex_paths

ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])

def _decode_file(f):
    name=str(f.get('name') or 'untitled')
    if f.get('data_base64') is not None:
        raw=base64.b64decode(f['data_base64'])
        try: text=raw.decode(f.get('encoding') or 'utf-8-sig')
        except UnicodeDecodeError: text=raw.decode('utf-8',errors='replace')
    else:
        text=str(f.get('content') or '')
        raw=text.encode('utf-8')
    return name,text,raw,f.get('mime') or ''

def expand_payload(files):
    out=[]
    for f in files:
        name,text,raw,mime=_decode_file(f)
        if name.lower().endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                portable=False
                if 'manifest.json' in z.namelist():
                    try: portable=json.loads(z.read('manifest.json')).get('format')=='lifeos-portable-export-v1'
                    except (ValueError,AttributeError):pass
                for info in z.infolist():
                    if info.is_dir() or info.file_size>20_000_000: continue
                    if portable and not info.filename.startswith('entries/'):continue
                    inner=Path(info.filename).name
                    if not choose_importer(inner): continue
                    b=z.read(info)
                    try: t=b.decode('utf-8-sig')
                    except UnicodeDecodeError: t=b.decode('utf-8',errors='replace')
                    out.append({'name':info.filename,'content':t,'mime':'','container':name})
        else: out.append({'name':name,'content':text,'mime':mime,'container':None})
    return out

def _lifeos_raw(text):
    return '### 日记' in text or '### 日程' in text or 'lifeos_entry_id:' in text[:1000]

def _duplicate(existing, draft, root, con=None):
    if not existing: return False
    if con is not None:
        cur=con.execute('SELECT revision_file FROM revisions WHERE revision_id=?',(existing['current_revision_id'],)).fetchone()
        cur={'content':(root/cur['revision_file']).read_text(encoding='utf-8')} if cur and (root/cur['revision_file']).is_file() else None
    else:cur=pc.read_revision(existing['current_revision_id'],root)
    if not cur: return False
    normalize=lambda value:value.replace('\r\n','\n').replace('\r','\n').strip()
    current=normalize(cur.get('content') or ''); incoming=normalize(draft.content or '')
    if current==incoming: return True
    if incoming and incoming in current: return True
    return False

def preview_import(files, source_name='browser import', root:Path=ROOT):
    expanded=expand_payload(files)
    con=pc.connect(root);job_id=pc.new_id('import');now=pc.utcnow(); items=[];stats={'new':0,'update':0,'duplicate':0,'needs_date':0,'needs_review':0,'total':0}
    try:
        con.execute('INSERT INTO import_jobs(job_id,status,source_name,stats_json,created_at) VALUES(?,?,?,?,?)',(job_id,'preview',source_name,'{}',now))
        seen_dates={}
        ordinal=0
        for f in expanded:
            importer,drafts=parse_file(f['name'],f['content'],f.get('mime',''),{'container':f.get('container')})
            for draft in drafts:
                ordinal+=1;date=draft.journal_date;existing=None;action='new';note=''
                weekly=draft.kind=='weekly' and draft.week_year and draft.week
                proposed_path=f'memories/weekly/{draft.week_year}/{draft.week_year}_{draft.week}.md' if weekly else (f'memories/daily/{date[:4]}/{date}.md' if date else None)
                if not date and not weekly:
                    action='needs_date';note='Could not confidently detect a journal date.'
                else:
                    existing=con.execute("SELECT * FROM entries WHERE source_path=? AND deleted_at IS NULL",(proposed_path,)).fetchone() if weekly else con.execute("SELECT * FROM entries WHERE kind='daily' AND journal_date=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",(date,)).fetchone()
                    if proposed_path in seen_dates:
                        action='needs_review';note=f"Another imported item already targets {proposed_path}."
                    elif existing:
                        ed=dict(existing)
                        action='duplicate' if _duplicate(ed,draft,root,con) else 'update'
                    seen_dates[proposed_path]=seen_dates.get(proposed_path,0)+1
                target_path=existing['source_path'] if existing else proposed_path
                item_id=pc.new_id('item');h=pc.sha_text(draft.content)
                con.execute('''INSERT INTO import_items(item_id,job_id,ordinal,source_name,source_format,journal_date,title,tags_json,content,content_hash,action,target_entry_id,target_source_path,note)
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(item_id,job_id,ordinal,draft.source_name,draft.source_format,date,draft.title,json.dumps(draft.tags,ensure_ascii=False),draft.content,h,action,existing['entry_id'] if existing else None,target_path,note or draft.note))
                stats[action]=stats.get(action,0)+1;stats['total']+=1
                items.append({'item_id':item_id,'ordinal':ordinal,'source_name':draft.source_name,'source_format':draft.source_format,'kind':draft.kind,'journal_date':date,'title':draft.title,'tags':draft.tags,'action':action,'target_entry_id':existing['entry_id'] if existing else None,'target_source_path':target_path,'note':note or draft.note,'chars':len(draft.content),'preview':draft.content[:360]})
        con.execute('UPDATE import_jobs SET importer=?,stats_json=? WHERE job_id=?',('mixed' if len(set(x['source_format'] for x in items))>1 else (items[0]['source_format'] if items else 'none'),json.dumps(stats,ensure_ascii=False),job_id));con.commit()
    except Exception:
        con.rollback();raise
    finally: con.close()
    # Keep exact original payload after preview so import is auditable.
    idir=root/'.lifeos'/'imports'/job_id;idir.mkdir(parents=True,exist_ok=True)
    (idir/'manifest.json').write_text(json.dumps({'source_name':source_name,'files':[{'name':x.get('name'),'mime':x.get('mime','')} for x in files],'created_at':now},ensure_ascii=False,indent=2),encoding='utf-8')
    for i,f in enumerate(files,1):
        name,_,raw,_=_decode_file(f);safe=re.sub(r'[^\w.\- ()\[\]]+','_',Path(name).name)[:120] or f'file-{i}';(idir/f'{i:03d}-{safe}').write_bytes(raw)
    return {'job_id':job_id,'stats':stats,'items':items}

def get_job(job_id,root:Path=ROOT):
    con=pc.connect(root)
    try:
        j=con.execute('SELECT * FROM import_jobs WHERE job_id=?',(job_id,)).fetchone()
        if not j:return None
        job=dict(j);job['stats']=json.loads(job.pop('stats_json') or '{}');items=[]
        for r in con.execute('SELECT * FROM import_items WHERE job_id=? ORDER BY ordinal',(job_id,)):
            d=dict(r);d['tags']=json.loads(d.pop('tags_json') or '[]');items.append(d)
        job['items']=items;return job
    finally:con.close()

def commit_import(job_id, overrides=None, root:Path=ROOT):
    overrides=overrides or {};job=get_job(job_id,root)
    if not job:raise ValueError('import job not found')
    if job['status'] not in ('preview','failed'): raise ValueError(f"job is {job['status']}")
    backup=None
    if pc.get_setting('backup.auto_before_import','true',root)=='true': backup=pc.create_backup(f'pre-import {job_id}',root,include_derived=True)
    changed=[];results=[]
    con=pc.connect(root)
    try:
        con.execute("UPDATE import_jobs SET status='committing',snapshot_dir=? WHERE job_id=?",(backup['backup_id'] if backup else None,job_id));con.commit()
    finally:con.close()
    try:
        for item in job['items']:
            ov=overrides.get(item['item_id'],{}) if isinstance(overrides,dict) else {}
            action=ov.get('action',item['action']);date=ov.get('journal_date',item['journal_date'])
            kind='weekly' if item['source_format'].endswith('-weekly') else 'daily'
            if action=='duplicate' or action=='skip':
                results.append({'item_id':item['item_id'],'status':'skipped','reason':action});continue
            if action in ('needs_date','needs_review') and kind!='weekly' and not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',date or ''):
                raise ValueError(f"{item['source_name']} needs a confirmed date")
            title=ov.get('title',item['title'] or '');tags=ov.get('tags',item.get('tags') or [])
            existing=pc.get_entry(entry_id=item.get('target_entry_id'),root=root) if item.get('target_entry_id') else None
            if not existing and kind=='weekly':existing=pc.get_entry(source_path=item['target_source_path'],root=root)
            if not existing and date:
                # Date may have been supplied as an override.
                existing=next((x for x in pc.list_entries(5000,root) if x.get('kind')=='daily' and x.get('journal_date')==date),None)
            if _lifeos_raw(item['content']) or kind=='weekly':
                result=pc.save_entry(journal_date=date,sections={},entry_id=existing['entry_id'] if existing else None,title=title,tags=tags,timezone='',raw_markdown=item['content'],kind=kind,source_path=item['target_source_path'] if kind=='weekly' else None,source='import',note=f"import job {job_id}: {item['source_name']}",root=root)
            else:
                result=pc.save_entry(journal_date=date,sections={'日记':item['content']},entry_id=existing['entry_id'] if existing else None,title=title,tags=tags,timezone='',source='import',note=f"import job {job_id}: {item['source_name']}",root=root)
            changed.append(result['source_path']);results.append({'item_id':item['item_id'],'status':'saved',**result})
        index_report=reindex_paths(changed,root=root) if changed else {'changed':[]}
        con=pc.connect(root)
        try:con.execute("UPDATE import_jobs SET status='committed',committed_at=? WHERE job_id=?",(pc.utcnow(),job_id));con.commit()
        finally:con.close()
        return {'ok':True,'job_id':job_id,'backup':backup,'changed':changed,'results':results,'index':index_report}
    except Exception as e:
        con=pc.connect(root)
        try:con.execute("UPDATE import_jobs SET status='failed' WHERE job_id=?",(job_id,));con.commit()
        finally:con.close()
        if backup:
            try: pc.restore_backup(backup['backup_id'],root)
            except Exception: pass
        raise

def rollback_import(job_id,root:Path=ROOT):
    job=get_job(job_id,root)
    if not job:raise ValueError('import job not found')
    bid=job.get('snapshot_dir')
    if not bid: raise ValueError('job has no pre-import snapshot')
    out=pc.restore_backup(bid,root)
    con=pc.connect(root)
    try:con.execute("UPDATE import_jobs SET status='rolled_back',rolled_back_at=? WHERE job_id=?",(pc.utcnow(),job_id));con.commit()
    finally:con.close()
    return {'ok':True,'job_id':job_id,'restore':out}

def clear_import(job_id, root:Path=ROOT):
    """Remove one import test job and its staged payload safely.

    A committed job is restored from the pre-import snapshot before its job
    rows are removed.  The snapshot archive itself is retained as a normal
    backup so a user can still recover it later.  The job id is deliberately
    constrained to a single path component; callers can never provide an
    arbitrary filesystem path here.
    """
    job_id=str(job_id or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', job_id):
        raise ValueError('invalid import job id')
    payload_dir=(root/'.lifeos'/'imports'/job_id).resolve()
    imports_dir=(root/'.lifeos'/'imports').resolve()
    if payload_dir.parent != imports_dir:
        raise ValueError('invalid import payload location')
    job=get_job(job_id,root)
    if not job: raise ValueError('import job not found')

    restored=False
    status=job.get('status')
    snapshot=job.get('snapshot_dir')
    if status in ('committed','committing','failed') and not snapshot:
        raise ValueError('committed import has no pre-import snapshot; cannot safely clear')
    # A rolled-back job is already at its pre-import state. Re-restoring it
    # could discard legitimate edits made after the user clicked rollback.
    if snapshot and status in ('committed','committing','failed'):
        pc.restore_backup(snapshot,root)
        restored=True

    con=pc.connect(root)
    try:
        con.execute('DELETE FROM import_jobs WHERE job_id=?',(job_id,))
        con.commit()
    finally:
        con.close()

    removed_payload=payload_dir.exists()
    if removed_payload:
        shutil.rmtree(payload_dir)
    return {'ok':True,'job_id':job_id,'restored':restored,'removed_payload':removed_payload}

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('files',nargs='+');args=ap.parse_args()
    payload=[{'name':Path(x).name,'content':Path(x).read_text(encoding='utf-8')} for x in args.files]
    print(json.dumps(preview_import(payload,root=ROOT),ensure_ascii=False,indent=2))
