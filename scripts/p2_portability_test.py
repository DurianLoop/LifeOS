#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import json,os,socket,subprocess,sys,tempfile,time,urllib.request,urllib.error,sqlite3
ROOT=Path(__file__).resolve().parents[1]

def free_port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p

def http(method,url,token=None,obj=None,expect=200):
 data=None if obj is None else json.dumps(obj,ensure_ascii=False).encode();h={'Content-Type':'application/json'}
 if token:h['Authorization']='Bearer '+token
 req=urllib.request.Request(url,data=data,headers=h,method=method)
 try:
  with urllib.request.urlopen(req,timeout=20) as r:code=r.status;body=json.loads(r.read().decode() or '{}')
 except urllib.error.HTTPError as e:code=e.code;body=json.loads(e.read().decode() or '{}')
 assert code==expect,(method,url,code,body);return body

def main():
 td=Path(tempfile.mkdtemp(prefix='lifeos-p2-portability-'));db=td/'cloud.db';port=free_port();env=os.environ.copy();env.update({'LIFEOS_CLOUD_DB':str(db),'LIFEOS_CLOUD_PORT':str(port),'LIFEOS_CLOUD_HOST':'127.0.0.1','PYTHONPATH':str(ROOT)})
 p=subprocess.Popen([sys.executable,str(ROOT/'cloud/dev_sync_server.py')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);base=f'http://127.0.0.1:{port}';checks=[]
 try:
  for _ in range(80):
   try:http('GET',base+'/health');break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('cloud did not start')
  a=http('POST',base+'/v1/register',obj={'email':'portable-a@example.test','password':'portable-password-a'});b=http('POST',base+'/v1/register',obj={'email':'portable-b@example.test','password':'portable-password-b'});ta,tb=a['token'],b['token']
  http('POST',base+'/v2/inbox',ta,{'item_type':'text','title':'A-ONLY-TITLE','body':'A-ONLY-BODY','source':'test'})
  http('POST',base+'/v2/inbox',tb,{'item_type':'text','title':'B-ONLY-TITLE','body':'B-ONLY-BODY','source':'test'})
  op={'operation_id':'op_portable_a','entry_id':'entry_portable_a','revision_id':'rev_portable_a','base_revision_id':None,'op_type':'upsert','device_id':'test','created_at':'2032-01-01T00:00:00Z','payload':{'entry':{'entry_id':'entry_portable_a','journal_date':'2032-01-01','title':'A PAGE'},'revision':{'revision_id':'rev_portable_a'},'content':'A-ONLY-CONTENT'}}
  http('POST',base+'/v1/push',ta,{'operations':[op]})
  exp=http('GET',base+'/v2/account/export',ta);blob=json.dumps(exp,ensure_ascii=False)
  assert exp['format']=='lifeos-cloud-export-v1' and exp['account']['user_id']==a['user_id'];assert 'A-ONLY-BODY' in blob and 'A-ONLY-CONTENT' in blob;assert 'B-ONLY-BODY' not in blob and b['user_id'] not in blob
  assert 'password_hash' not in blob and 'token_hash' not in blob
  checks.append('tenant-scoped portable export excludes credentials and other tenants')
  http('POST',base+'/v2/account/delete',ta,{'password':'wrong-password','confirm':'DELETE MY LIFEOS'},expect=401)
  assert http('GET',base+'/v2/me',ta)['profile']['user_id']==a['user_id'];checks.append('account deletion requires password re-authentication')
  deleted=http('POST',base+'/v2/account/delete',ta,{'password':'portable-password-a','confirm':'DELETE MY LIFEOS'});assert deleted['ok'] and deleted['deleted']['users']==1
  http('GET',base+'/v2/me',ta,expect=401);assert http('GET',base+'/v2/me',tb)['profile']['user_id']==b['user_id'];assert http('GET',base+'/v2/inbox?since=0',tb)['items'][0]['body']=='B-ONLY-BODY'
  checks.append('irreversible tenant delete clears A and preserves B')
  c=sqlite3.connect(db);tables=['users','sessions','operations','cloud_entries','cloud_attachments','profiles','subscriptions','inbox_items','notifications','shares','usage_counters','ai_requests'];left={t:c.execute(f'SELECT COUNT(*) FROM {t} WHERE '+('user_id=?' if t!='users' else 'user_id=?'),(a['user_id'],)).fetchone()[0] for t in tables};c.close();assert all(v==0 for v in left.values()),left
  checks.append('deleted tenant leaves no user-owned rows in reference cloud')
  mobile=(ROOT/'mobile/www/index.html').read_text(encoding='utf-8');assert 'indexedDB.open' in mobile and 'flushQueue' in mobile and 'queuePut' in mobile and '/v2/account/export' in mobile and '/v2/account/delete' in mobile
  checks.append('mobile offline queue + portability controls static contract')
  print(json.dumps({'ok':True,'checks':checks},ensure_ascii=False,indent=2))
 finally:
  p.terminate()
  try:p.wait(timeout=4)
  except Exception:p.kill()
  import shutil;shutil.rmtree(td,ignore_errors=True)
if __name__=='__main__':main()
