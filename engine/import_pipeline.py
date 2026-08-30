#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import base64, io, json, re, zipfile
from importers import parse_file, choose_importer
from engine import product_core as pc
from engine.incremental_index import reindex_paths

ROOT=Path(__file__).resolve().parents[1]

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
                for info in z.infolist():
                    if info.is_dir() or info.file_size>20_000_000: continue
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

def _duplicate(existing, draft, root):
    if not existing: return False
    cur=pc.read_revision(existing['current_revision_id'],root)
    if not cur: return False
    current=(cur.get('content') or '').strip(); incoming=(draft.content or '').strip()
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
                if not date:
                    action='needs_date';note='Could not confidently detect a journal date.'
                else:
                    existing=con.execute("SELECT * FROM entries WHERE kind='daily' AND journal_date=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",(date,)).fetchone()
                    if date in seen_dates:
                        action='needs_review';note=f"Another imported item already targets {date}."
                    elif existing:
                        ed=dict(existing)
                        action='duplicate' if _duplicate(ed,draft,root) else 'update'
                    seen_dates[date]=seen_dates.get(date,0)+1
                target_path=(existing['source_path'] if existing else (f'memories/daily/{date[:4]}/{date}.md' if date else None))
                item_id=pc.new_id('item');h=pc.sha_text(draft.content)
                con.execute('''INSERT INTO import_items(item_id,job_id,ordinal,source_name,source_format,journal_date,title,tags_json,content,content_hash,action,target_entry_id,target_source_path,note)
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(item_id,job_id,ordinal,draft.source_name,draft.source_format,date,draft.title,json.dumps(draft.tags,ensure_ascii=False),draft.content,h,action,existing['entry_id'] if existing else None,target_path,note or draft.note))
                stats[action]=stats.get(action,0)+1;stats['total']+=1
                items.append({'item_id':item_id,'ordinal':ordinal,'source_name':draft.source_name,'source_format':draft.source_format,'journal_date':date,'title':draft.title,'tags':draft.tags,'action':action,'target_entry_id':existing['entry_id'] if existing else None,'target_source_path':target_path,'note':note or draft.note,'chars':len(draft.content),'preview':draft.content[:360]})
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
            if action=='duplicate' or action=='skip':
                results.append({'item_id':item['item_id'],'status':'skipped','reason':action});continue
            if action in ('needs_date','needs_review') and not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',date or ''):
                raise ValueError(f"{item['source_name']} needs a confirmed date")
            title=ov.get('title',item['title'] or '');tags=ov.get('tags',item.get('tags') or [])
            existing=pc.get_entry(entry_id=item.get('target_entry_id'),root=root) if item.get('target_entry_id') else None
            if not existing and date:
                # Date may have been supplied as an override.
                existing=next((x for x in pc.list_entries(5000,root) if x.get('kind')=='daily' and x.get('journal_date')==date),None)
            if _lifeos_raw(item['content']):
                result=pc.save_entry(journal_date=date,sections={},entry_id=existing['entry_id'] if existing else None,title=title,tags=tags,timezone='',raw_markdown=item['content'],source='import',note=f"import job {job_id}: {item['source_name']}",root=root)
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

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('files',nargs='+');args=ap.parse_args()
    payload=[{'name':Path(x).name,'content':Path(x).read_text(encoding='utf-8')} for x in args.files]
    print(json.dumps(preview_import(payload,root=ROOT),ensure_ascii=False,indent=2))
