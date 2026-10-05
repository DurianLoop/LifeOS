"""Audit a user-supplied archive in an ignored, isolated workspace.

Reports contain counts, timings and test results only, never journal excerpts.
The input archive is read-only. No credentials are copied to the test workspace.
"""
from __future__ import annotations

import argparse
import ast
import base64
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'engine'))


def inspect_archive(path):
    from importers.base import guess_date
    dates, unknown, sections, files = [], [], Counter(), []
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            if Path(item.filename).suffix.lower() not in ('.md', '.markdown'):
                continue
            raw = archive.read(item)
            text = raw.decode('utf-8-sig')
            date = guess_date(item.filename, text)
            if date:
                dates.append(date)
            else:
                # Only filename structure, never titles or journal prose.
                stem = Path(item.filename).stem
                unknown.append({'shape': re.sub(r'[^0-9_.Ww\-]', 'x', stem),
                                'bytes': len(raw),
                                'heading_count': len(re.findall(r'^### ', text, re.M))})
            for name in re.findall(r'^### (.+)$', text, re.M):
                if name.strip() in ('日程', '日记', '心得与摘录', '习惯打卡', '本周总结', '下周计划'):
                    sections[name.strip()] += 1
            files.append({'name': item.filename, 'sha256': hashlib.sha256(raw).hexdigest(),
                          'bytes': len(raw), 'text': text, 'date': date})
    return files, {'markdown_files': len(files), 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                   'bytes': sum(x['bytes'] for x in files), 'dated': len(dates),
                   'distinct_dates': len(set(dates)), 'date_range': [min(dates), max(dates)] if dates else [],
                   'unknown_dates': unknown, 'sections': dict(sections)}


def initialize(workspace):
    from test_desktop_backend import prepare_workspace
    prepare_workspace(ROOT, workspace)
    # Force all imports/AI modules to bind to the disposable workspace.
    os.environ['LIFEOS_ROOT'] = str(workspace)
    os.environ['LIFEOS_RESOURCE_ROOT'] = str(ROOT)
    for key in list(os.environ):
        if key.endswith('_API_KEY') or key in ('OPENAI_BASE_URL', 'MEMORIAL_PUBLISH_TOKEN'):
            os.environ.pop(key, None)
    from engine import product_core as pc
    pc.set_settings({'ai.enabled': False, 'ai.allow_remote': False,
                     'poetry.auto_enabled': False, 'pet.allow_content': False,
                     'refresh.background_enabled': False}, workspace)
    from engine import rebuild_memory_engine
    rebuild_memory_engine.main()
    return pc


def import_archive(archive, workspace):
    from engine import import_pipeline
    start = time.perf_counter()
    preview = import_pipeline.preview_import(
        [{'name': archive.name, 'data_base64': base64.b64encode(archive.read_bytes()).decode('ascii')}],
        'local full-corpus acceptance', workspace)
    result = {'preview': preview['stats'], 'seconds': round(time.perf_counter() - start, 3)}
    if preview['stats'].get('needs_date') or preview['stats'].get('needs_review'):
        result['status'] = 'needs_resolution'
        return result
    committed = import_pipeline.commit_import(preview['job_id'], root=workspace)
    result.update(status='committed', saved=len(committed['changed']),
                  skipped=sum(x['status'] == 'skipped' for x in committed['results']),
                  seconds=round(time.perf_counter() - start, 3))
    from engine.incremental_index import refresh_derived_layers
    start = time.perf_counter()
    refreshed = refresh_derived_layers(root=workspace)
    result['derived_seconds'] = round(time.perf_counter() - start, 3)
    result['derived_published'] = not refreshed.get('superseded', False)
    return result


def http(base,path,payload=None,timeout=40):
    raw=None if payload is None else json.dumps(payload,ensure_ascii=False).encode('utf-8')
    request=urllib.request.Request(base+path,data=raw,headers={'Content-Type':'application/json'} if raw else {})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response=opener.open(request,timeout=timeout)
    except urllib.error.HTTPError as error:
        response=error
    with response:
        data=response.read();content_type=response.headers.get('Content-Type','')
        return response.status,json.loads(data.decode('utf-8')) if 'application/json' in content_type else data,len(data)


def verify_test_server(base,workspace):
    """Refuse to write to a server using a different user's data or remote host."""
    url=urllib.parse.urlsplit(base)
    if url.scheme!='http' or url.hostname not in ('127.0.0.1','localhost','::1') or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
        raise ValueError('acceptance requires a loopback test server')
    with sqlite3.connect(workspace/'.lifeos/core.db') as con:
        device=con.execute("SELECT value FROM settings WHERE key='device.id'").fetchone()
        local={x[0]:x[1] for x in con.execute('SELECT entry_id,current_revision_id FROM entries WHERE deleted_at IS NULL')}
    status,health,_=http(base,'/api/health')
    status_entries,entries,_=http(base,'/api/entries?limit=100000')
    remote={x['entry_id']:x['current_revision_id'] for x in entries.get('items',[])}
    if status!=200 or status_entries!=200 or not device or health.get('core',{}).get('device_id')!=device[0] or local!=remote:
        raise ValueError('server does not match the isolated audit workspace')
    if health.get('ai',{}).get('enabled') or health.get('ai',{}).get('allow_remote'):
        raise ValueError('remote AI must be disabled in the audit workspace')


def corpus_checks(files,workspace):
    from importers.base import guess_week
    from engine import product_core as pc,import_pipeline
    rows=pc.list_entries(100000,workspace)
    paths={x['source_path']:x for x in rows};errors=[];preserved=0
    for item in files:
        week=guess_week(item['name'])
        path=f'memories/weekly/{week[0]}/{week[0]}_{week[1]}.md' if week else f"memories/daily/{item['date'][:4]}/{item['date']}.md"
        entry=paths.get(path)
        if not entry:errors.append('missing source');continue
        content=pc.read_revision(entry['current_revision_id'],workspace)['content']
        # Unstructured markdown gains a journal section; original prose remains exact.
        normalize=lambda text:text.replace('\r\n','\n').replace('\r','\n').strip('\ufeff\n ')
        if normalize(item['text']) not in normalize(content):errors.append('source content changed')
        else:preserved+=1
        if normalize((workspace/'vault'/path).read_text(encoding='utf-8'))!=normalize(content):errors.append('revision/current mismatch')
    con=sqlite3.connect(workspace/'data/lifeos.db')
    indexed=con.execute('SELECT COUNT(*) FROM memories').fetchone()[0]
    integrity=con.execute('PRAGMA integrity_check').fetchone()[0]
    fk=len(con.execute('PRAGMA foreign_key_check').fetchall());con.close()
    if indexed!=len(files) or len(rows)!=len(files):errors.append('entry/index count mismatch')
    roundtrip=[]
    for fmt in ('markdown','json','csv'):
        exported=pc.export_entries(export_format=fmt,root=workspace)
        preview=import_pipeline.preview_import([{'name':exported['filename'],'data_base64':base64.b64encode(exported['data']).decode('ascii')}],'roundtrip acceptance',workspace)
        roundtrip.append({'format':fmt,'count':exported['count'],'bytes':len(exported['data']),'preview':preview['stats']})
        if preview['stats'].get('duplicate')!=len(files) or preview['stats']['total']!=len(files):errors.append(fmt+' roundtrip mismatch')
        import_pipeline.clear_import(preview['job_id'],workspace)
    return {'entries':len(rows),'daily':sum(x['kind']=='daily' for x in rows),'weekly':sum(x['kind']=='weekly' for x in rows),
            'preserved_originals':preserved,'indexed':indexed,'sqlite_integrity':integrity,'foreign_key_errors':fk,'roundtrip':roundtrip,'errors':errors}


def api_checks(base,workspace):
    source=ast.parse((ROOT/'backend/server.py').read_text(encoding='utf-8'))
    handler=next(x for x in source.body if isinstance(x,ast.ClassDef) and x.name=='Handler')
    get=next(x for x in handler.body if isinstance(x,ast.FunctionDef) and x.name=='api_get')
    routes=[]
    for node in ast.walk(get):
        if isinstance(node,ast.Compare) and isinstance(node.left,ast.Name) and node.left.id=='path':
            for value in node.comparators:
                if isinstance(value,ast.Constant) and isinstance(value.value,str) and value.value.startswith('/api/'):routes.append(value.value)
    routes+=['/api/attic/overview','/api/attic/review','/api/attic/ledger','/api/attic/month','/api/attic/lineage']
    status,entries,_=http(base,'/api/entries?limit=10000');assert status==200
    daily=next(x for x in entries['items'] if x['kind']=='daily')
    _,entry,_=http(base,'/api/entry?entry_id='+daily['entry_id'])
    _,skills,_=http(base,'/api/skills');skill=skills['items'][0]['name']
    _,ledger,_=http(base,'/api/attic/ledger?kind=decision&limit=1')
    with sqlite3.connect(workspace/'.lifeos/core.db') as con:
        job=con.execute("SELECT job_id FROM import_jobs WHERE status='committed' LIMIT 1").fetchone()[0]
    params={
        '/api/entry':{'entry_id':daily['entry_id']},'/api/revisions':{'entry_id':daily['entry_id']},
        '/api/revision':{'revision_id':entry['current']['revision_id']},'/api/import/job':{'job_id':job},
        '/api/journal':{'path':daily['source_path']},'/api/skill':{'name':skill},
        '/api/search':{'q':'学习'},'/api/retrieve':{'q':'学习'},'/api/reviews':{'scope':'skills'},
        '/api/attachments':{'entry_id':daily['entry_id']},'/api/poetry':{'date':daily['journal_date']},
        '/api/attic/month':{'month':daily['journal_date'][:7]},'/api/year-review':{'year':daily['journal_date'][:4]},
    }
    if ledger['items']:params['/api/attic/lineage']={'kind':'decision','id':ledger['items'][0]['id']}
    expected={'/api/memorial/qr':400,'/api/attachment':404}
    results=[];references=set()
    def sources(value):
        if isinstance(value,dict):
            for key,item in value.items():
                if key=='source_path' and isinstance(item,str) and item.startswith('memories/'):references.add(item)
                else:sources(item)
        elif isinstance(value,list):
            for item in value:sources(item)
    for route in sorted(set(routes)):
        start=time.perf_counter();path=route+('?' + urllib.parse.urlencode(params[route]) if route in params else '')
        try:
            status,data,size=http(base,path)
            sources(data)
            results.append({'route':route,'status':status,'bytes':size,'seconds':round(time.perf_counter()-start,3),'ok':status==expected.get(route,200)})
        except Exception as error:
            results.append({'route':route,'status':None,'seconds':round(time.perf_counter()-start,3),'ok':False,'error_type':type(error).__name__})
    valid={x['source_path'] for x in entries['items']}
    return {'total':len(results),'passed':sum(x['ok'] for x in results),'results':results,
            'source_references':len(references),'missing_sources':len(references-valid)}


def workflow_checks(base,workspace):
    results=[]
    def record(name,fn):
        started=time.perf_counter()
        try:
            detail=fn();results.append({'name':name,'ok':True,'seconds':round(time.perf_counter()-started,3),'detail':detail})
        except Exception as error:
            results.append({'name':name,'ok':False,'seconds':round(time.perf_counter()-started,3),'error_type':type(error).__name__})
    def request(path,payload=None):
        status,data,_=http(base,path,payload,timeout=90)
        if status!=200:raise AssertionError('HTTP '+str(status))
        return data
    entries=request('/api/entries?limit=10000')['items']
    daily=next(x for x in entries if x['kind']=='daily')
    def fingerprint():
        return {x['source_path']:hashlib.sha256((workspace/'vault'/x['source_path']).read_bytes()).hexdigest() for x in request('/api/entries?limit=10000')['items']}
    baseline=fingerprint()
    def read_all():
        for e in entries:
            data=request('/api/journal?'+urllib.parse.urlencode({'path':e['source_path']}))
            assert data['memory']['kind']==e['kind']
            assert data['product_entry']['entry_id']==e['entry_id']
            assert data['memory']['raw_text'].replace('\r\n','\n').replace('\r','\n')==(workspace/'vault'/e['source_path']).read_text(encoding='utf-8')
        return {'pages':len(entries),'weekly':sum(e['kind']=='weekly' for e in entries)}
    record('read every imported diary and weekly review',read_all)
    def search():
        for term in ('阅读','学习','产品','Python','旅行','2025'):
            data=request('/api/search?'+urllib.parse.urlencode({'q':term,'limit':30}))
            for item in data['items']:assert item['source_path'] in baseline
        return {'queries':6}
    record('search and source consistency',search)
    def calendar():
        data=request('/api/writer/dates')['items']
        assert len(data)==sum(e['kind']=='daily' for e in entries)
        assert len({x['date'] for x in data})==len(data)
        return {'dates':len(data)}
    record('writer calendar includes all daily dates',calendar)
    def history():
        original=request('/api/entry?entry_id='+daily['entry_id'])['current']
        saved=request('/api/entries/save',{'entry_id':daily['entry_id'],'journal_date':daily['journal_date'],
              'title':daily['title'] or '', 'tags':daily['tags'],
              'raw_markdown':original['content']+'\n### 本地功能验收\n版本恢复检查\n'})
        assert saved['result']['revision_id']!=original['revision_id']
        request('/api/revisions/restore',{'entry_id':daily['entry_id'],'revision_id':original['revision_id']})
        restored=request('/api/entry?entry_id='+daily['entry_id'])
        assert restored['current']['content']==original['content']
        assert len(restored['revisions'])>=3
        assert fingerprint()==baseline
        return {'history_preserved':True,'original_restored':True}
    record('edit real diary and restore its original revision',history)
    def attachments():
        content=b'LifeOS local acceptance attachment'
        name=f'acceptance-{time.time_ns()}.txt'
        attached=request('/api/attachments',{'entry_id':daily['entry_id'],'name':name,
                 'data_base64':base64.b64encode(content).decode('ascii'),'mime_type':'text/plain'})['attachment']
        _,body,_=http(base,'/api/attachment?attachment_id='+attached['attachment_id'])
        assert body==content
        from engine import product_core as pc
        exported=pc.export_entries(entry_ids=[daily['entry_id']],include_attachments=True,root=workspace)
        with zipfile.ZipFile(io.BytesIO(exported['data'])) as archive:
            names=[x for x in archive.namelist() if x.startswith('attachments/') and x.endswith('/'+name)]
            assert len(names)==1 and archive.read(names[0])==content
        return {'binary_download':True,'exported_attachment':True}
    # io imported lazily to keep the archive inspection small.
    import io
    record('attachments and selected-entry export',attachments)
    def local_ask():
        for cutoff in (None,'2025-12-31'):
            payload={'question':'学习和阅读','stage':'retrieve','limit':12}
            if cutoff:payload['cutoff']=cutoff
            data=request('/api/ask',payload)
            assert data['answer']['mode']=='evidence_review'
            for item in data['evidence']:
                assert item['source_path'] in baseline
                if cutoff:
                    assert item['provenance_type']=='daily_raw' and item.get('date') and item['date']<=cutoff
        return {'evidence_retrieval':True,'past_cutoff':True,'remote_calls':0}
    record('local AI evidence selection and historical cutoff',local_ask)
    def import_clear():
        preview=request('/api/import/preview',{'files':[{'name':'2099-01-02.md','content':'### 日记\n仅用于隔离副本验收\n'}]})
        request('/api/import/commit',{'job_id':preview['job_id']})
        assert len(request('/api/entries?limit=10000')['items'])==len(entries)+1
        cleared=request('/api/import/clear',{'job_id':preview['job_id']})
        assert cleared['restored'] is True and fingerprint()==baseline
        assert len(request('/api/journals?kind=daily&limit=2000')['items'])==sum(e['kind']=='daily' for e in entries)
        return {'restored_pages':len(entries),'payload_removed':cleared['removed_payload']}
    record('commit and clear an import while preserving the full archive',import_clear)
    def backup():
        before=request('/api/backups/create',{'reason':'full-corpus acceptance','include_derived':True})
        request('/api/entries/save',{'journal_date':'2099-01-03','sections':{'日记':'隔离备份恢复验收'}})
        request('/api/backups/restore',{'backup_id':before['backup_id']})
        assert fingerprint()==baseline
        return {'original_pages_restored':len(baseline)}
    record('backup and restore the complete corpus',backup)
    def refresh():
        data=request('/api/refresh/derived',{'run_now':True,'reason':'full-corpus acceptance'})
        assert fingerprint()==baseline
        return {'source_files_preserved':len(baseline)}
    record('rebuild derived features after restore',refresh)
    return {'total':len(results),'passed':sum(x['ok'] for x in results),'results':results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs' / 'qa_private_archive')
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--workflows', action='store_true')
    parser.add_argument('--workspace', type=Path)
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--base', default='http://127.0.0.1:8790')
    args = parser.parse_args()
    if args.serve:
        from test_desktop_backend import environment
        workspace=args.workspace.resolve()
        if not workspace.is_relative_to(args.output.resolve()):
            raise ValueError('serve requires an isolated audit workspace')
        env={**environment(ROOT,workspace),'LIFEOS_PORT':str(args.port)}
        return subprocess.call([sys.executable,str(ROOT/'desktop/server_bootstrap.py')],env=env,cwd=workspace)
    files, metadata = inspect_archive(args.archive)
    if args.inspect:
        print(json.dumps(metadata, ensure_ascii=False, indent=2))
        return
    if args.check or args.workflows:
        workspace=args.workspace.resolve()
        if not workspace.is_relative_to(args.output.resolve()):raise ValueError('check requires an isolated audit workspace')
        os.environ['LIFEOS_ROOT']=str(workspace)
        verify_test_server(args.base,workspace)
        report_path=args.output/'report.json'
        report=json.loads(report_path.read_text(encoding='utf-8'))
        if args.workflows:report['workflows']=workflow_checks(args.base,workspace)
        if args.check:
            report['corpus']=corpus_checks(files,workspace)
            report['api']=api_checks(args.base,workspace)
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        api=report.get('api',{});corpus=report.get('corpus',{});workflows=report.get('workflows',{})
        print(json.dumps({'corpus':corpus,'workflows':workflows,'api_total':api.get('total'),'api_passed':api.get('passed'),
                          'missing_sources':api.get('missing_sources'),'api_failures':[x for x in api.get('results',[]) if not x['ok']]},ensure_ascii=False,indent=2))
        failed=bool(corpus.get('errors')) or api.get('total')!=api.get('passed') or api.get('missing_sources',0)>0 or workflows.get('total')!=workflows.get('passed')
        return 1 if failed else 0
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    workspace = output / ('workspace-' + str(time.time_ns()))
    initialize(workspace)
    report = {'archive': metadata, 'workspace': str(workspace)}
    (output / 'state.json').write_text(json.dumps({'workspace': str(workspace)}, indent=2), encoding='utf-8')
    report['import'] = import_archive(args.archive, workspace)
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'files': metadata['markdown_files'], 'workspace': str(workspace),
                      'import': report['import']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.exit(main())
