#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import base64, io, json, os, socket, subprocess, sys, tempfile, time, urllib.request, urllib.error, zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import product_core as pc, import_pipeline
from importers import parse_file


def check(cond,msg):
    if not cond: raise AssertionError(msg)

def http(method,url,payload=None,token=''):
    data=None if payload is None else json.dumps(payload,ensure_ascii=False).encode('utf-8')
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(url,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        body=e.read().decode('utf-8',errors='replace')
        try:obj=json.loads(body or '{}')
        except Exception:obj={'raw':body}
        return e.code,obj

def free_port():
    s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p

def importer_matrix():
    cases=[
      ('2025-01-01.md','# hello\n',1,'markdown'),
      ('2025-01-02.txt','plain day',1,'text'),
      ('2025-01-03.html','<h1>Day</h1><p>Hello</p>',1,'html'),
      ('entries.csv','date,title,content,tags\n2025-01-04,A,CSV body,"x,y"\n',1,'csv'),
      ('entries.json',json.dumps([{'date':'2025-01-05','title':'J','content':'JSON body'}],ensure_ascii=False),1,'json'),
      ('dayone.json',json.dumps({'entries':[{'creationDate':'2025-01-06T09:00:00Z','text':'Day One body','tags':['one']}]}),1,'json'),
    ]
    out=[]
    for name,content,count,impname in cases:
        imp,drafts=parse_file(name,content)
        check(imp==impname,f'{name}: importer {imp}')
        check(len(drafts)==count,f'{name}: draft count')
        check(drafts[0].journal_date and drafts[0].content.strip(),f'{name}: normalized draft')
        out.append({'name':name,'importer':imp,'date':drafts[0].journal_date,'format':drafts[0].source_format})
    # ZIP expansion must preserve all supported inner files and ignore unsupported ones.
    bio=io.BytesIO()
    with zipfile.ZipFile(bio,'w') as z:
        z.writestr('folder/2025-02-01.md','zip md')
        z.writestr('folder/2025-02-02.txt','zip txt')
        z.writestr('folder/ignore.bin',b'\x00\x01')
    expanded=import_pipeline.expand_payload([{'name':'bundle.zip','data_base64':base64.b64encode(bio.getvalue()).decode('ascii')}])
    check(len(expanded)==2,'zip importer expansion')
    return out+ [{'name':'bundle.zip','expanded':len(expanded)}]

def cloud_tenant_test():
    port=free_port();tmp=Path(tempfile.mkdtemp(prefix='lifeos-cloud-audit-'));db=tmp/'cloud.db'
    env={**os.environ,'LIFEOS_CLOUD_PORT':str(port),'LIFEOS_CLOUD_DB':str(db),'PYTHONUNBUFFERED':'1'}
    p=subprocess.Popen([sys.executable,str(ROOT/'cloud'/'dev_sync_server.py')],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    base=f'http://127.0.0.1:{port}'
    try:
        end=time.time()+8
        while time.time()<end:
            try:
                if http('GET',base+'/health')[0]==200:break
            except Exception:pass
            time.sleep(.1)
        else: raise AssertionError('cloud health timeout')
        _,a=http('POST',base+'/v1/register',{'email':'a@example.test','password':'password-audit'})
        _,b=http('POST',base+'/v1/register',{'email':'b@example.test','password':'password-audit'})
        check(a.get('token') and b.get('token'),'account registration')
        op={'operation_id':'op_audit_1','entry_id':'entry_audit_1','revision_id':'rev_audit_1','base_revision_id':None,'op_type':'upsert','payload':{'entry':{'entry_id':'entry_audit_1','journal_date':'2025-03-04','source_path':'memories/daily/2025/2025-03-04.md'},'revision':{'revision_id':'rev_audit_1'},'content':'tenant A private content'},'device_id':'dev_audit'}
        st,pushed=http('POST',base+'/v1/push',{'operations':[op]},a['token']);check(st==200 and len(pushed.get('accepted',[]))==1,'tenant A push')
        _,ea=http('GET',base+'/v1/entries',None,a['token']);_,eb=http('GET',base+'/v1/entries',None,b['token'])
        check(len(ea.get('items',[]))==1,'tenant A sees entry');check(len(eb.get('items',[]))==0,'tenant B isolation')
        unauth,_=http('GET',base+'/v1/entries');check(unauth==401,'cloud protected endpoint')
        return {'tenant_a_entries':1,'tenant_b_entries':0,'unauthorized_status':401}
    finally:
        p.terminate()
        try:p.wait(timeout=2)
        except Exception:p.kill()
        import shutil;shutil.rmtree(tmp,ignore_errors=True)

def static_product_checks():
    app=(ROOT/'app/index.html').read_text(encoding='utf-8')
    main=(ROOT/'desktop/main.cjs').read_text(encoding='utf-8')
    pkg=json.loads((ROOT/'desktop/package.json').read_text(encoding='utf-8'))
    web=(ROOT/'cloud/web/index.html').read_text(encoding='utf-8')
    for label in ('写日记','导入','版本','备份','同步','隐私 / AI'):check(label in app,f'product dock missing {label}')
    check('重新整理高级观察' in app and '/api/refresh/derived' in app,'lazy refresh UI')
    check('PET_BLOCKED_KEYS' in main and 'evidence|answer|question|prompt|raw|sections' in main,'pet content firewall')
    check('electron-updater' in pkg.get('dependencies',{}),'desktop updater dependency')
    check('dist:win' in pkg.get('scripts',{}) and 'dist:mac' in pkg.get('scripts',{}),'Windows/macOS packaging scripts')
    check('/v1/entries' in web and '/v1/push' in web,'Web Companion sync client')
    return {'product_dock':6,'desktop_targets':['win','mac'],'web_companion':True,'pet_firewall':True}

def main():
    report={'ok':False,'checks':[]}
    core=pc.core_status(ROOT);features=pc.feature_states(ROOT)
    check(int(core['schema_version'])>=6,'Core schema v6+ compatibility');check(core['entries']>=550,'entry bootstrap');check(len(features)==141,'feature graph 141')
    report['checks'].append({'core':{'schema':core['schema_version'],'entries':core['entries'],'revisions':core['revisions'],'features':len(features),'refresh':core['derived_refresh']}})
    report['checks'].append({'importers':importer_matrix()})
    report['checks'].append({'static_product':static_product_checks()})
    report['checks'].append({'cloud_tenant':cloud_tenant_test()})
    e2e=subprocess.run([sys.executable,str(ROOT/'scripts'/'core_ix_e2e_test.py')],cwd=ROOT,capture_output=True,text=True,timeout=90)
    check(e2e.returncode==0,'Core IX E2E failed: '+(e2e.stderr or e2e.stdout)[-1000:])
    e2ej=json.loads(e2e.stdout[e2e.stdout.find('{'):])
    check(e2ej.get('ok'),'Core IX E2E report false')
    report['checks'].append({'core_ix_e2e':e2ej['checks']})
    report['ok']=True
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
