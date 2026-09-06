#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import base64,hashlib,hmac,json,os,shutil,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error

ROOT=Path(__file__).resolve().parents[1]
os.environ.setdefault('PYTHON_KEYRING_BACKEND','keyring.backends.fail.Keyring')
import sys
sys.path.insert(0,str(ROOT))
from engine import product_core as pc,p2_core,p2_sync,sync_engine,crypto_vault
from engine.notification_engine import refresh_due
from connectors import CONNECTORS

def free_port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p

def copy_root(dst:Path):
 def ign(path,names):
  out=[]
  for n in names:
   if n in ('node_modules','.git'):out.append(n)
   if Path(path).name=='docs' and n.startswith('qa_'):out.append(n)
  return out
 shutil.copytree(ROOT,dst,ignore=ign)
 for f in (dst/'.lifeos'/'secrets.json',):
  if f.exists():f.unlink()
 con=pc.connect(dst)
 try:
  con.execute("DELETE FROM settings WHERE key='device.id'");con.execute('DELETE FROM devices');con.execute('DELETE FROM sync_operations');con.execute('DELETE FROM sync_conflicts');con.commit()
 finally:con.close()
 p2_core.migrate(dst)

def http(method,url,token=None,obj=None,expect=200):
 data=None if obj is None else json.dumps(obj,ensure_ascii=False).encode();headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(url,data=data,headers=headers,method=method)
 try:
  with urllib.request.urlopen(req,timeout=20) as r:code=r.status;body=json.loads(r.read().decode() or '{}')
 except urllib.error.HTTPError as e:code=e.code;body=json.loads(e.read().decode() or '{}')
 assert code==expect,(method,url,code,body)
 return body

def main():
 tmp=Path(tempfile.mkdtemp(prefix='lifeos-p2-e2e-'));a=tmp/'a';b=tmp/'b';copy_root(a);copy_root(b);checks=[]
 try:
  # Memory Inbox -> normal append-only Entry/Revision
  item=p2_core.add_inbox_item('text','口袋里的念头','今天突然想到一个新的方向。','test','',[],{'journal_date':'2031-01-02'},None,a)
  cv=p2_core.convert_inbox_to_entry(item['inbox_id'],root=a);assert cv['entry']['entry_id'];assert p2_core.get_inbox_item(item['inbox_id'],a)['status']=='accepted';checks.append('Memory Inbox text -> Entry + Revision')
  png=base64.b64encode(b'\x89PNG\r\n\x1a\nP2TEST').decode();photo=p2_core.add_inbox_item('photo','一张照片','','mobile-photo','',[],{'journal_date':'2031-01-03','name':'moment.png','mime_type':'image/png','data_base64':png},None,a);cvp=p2_core.convert_inbox_to_entry(photo['inbox_id'],root=a);assert cvp['attachments'] and pc.list_attachments(cvp['entry']['entry_id'],a);checks.append('Photo Inbox -> Entry + attachment')
  ics='BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:p2-test\nDTSTART:20310104T090000Z\nSUMMARY:见一个老朋友\nDESCRIPTION:喝咖啡\nLOCATION:Tokyo\nEND:VEVENT\nEND:VCALENDAR'
  drafts=list(CONNECTORS['calendar-ics'].ingest(ics));assert len(drafts)==1 and drafts[0].metadata['journal_date']=='2031-01-04';checks.append('Connector SDK / ICS normalization')
  ok=p2_core.install_addon({'id':'lifeos.test.safe','version':'1.0.0','name':'Safe'},'connector','test',a);assert ok['ok']
  try:p2_core.install_addon({'id':'lifeos.test.bad','version':'1','exec':'rm -rf /'},'connector','test',a);raise AssertionError('executable addon accepted')
  except ValueError:pass
  checks.append('Marketplace manifest install + executable rejection')
  key=crypto_vault.create_recovery_key(a);env=crypto_vault.encrypt_json({'secret':'只属于我'},{'entry_id':'x'},root=a);assert '只属于我' not in json.dumps(env,ensure_ascii=False);assert crypto_vault.decrypt_json(env,root=a)['secret']=='只属于我';crypto_vault.import_recovery_key(key,b);checks.append('AES-256-GCM recovery-key roundtrip')

  # Cloud reference server
  port=free_port();cloud_db=tmp/'cloud.db';envp=os.environ.copy();envp.update({'LIFEOS_CLOUD_DB':str(cloud_db),'LIFEOS_CLOUD_PORT':str(port),'LIFEOS_CLOUD_HOST':'127.0.0.1','LIFEOS_DEV_BILLING':'1','LIFEOS_CLOUD_AI_PROVIDER':'mock','LIFEOS_STRIPE_WEBHOOK_SECRET':'whsec_p2_test','PYTHONPATH':str(ROOT)})
  proc=subprocess.Popen([sys.executable,str(ROOT/'cloud/dev_sync_server.py')],cwd=ROOT,env=envp,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  base=f'http://127.0.0.1:{port}'
  try:
   for _ in range(60):
    try:http('GET',base+'/health');break
    except Exception:time.sleep(.1)
   else:raise RuntimeError('cloud server did not start')
   ra=http('POST',base+'/v1/register',obj={'email':'a@example.test','password':'password-A'});rb=http('POST',base+'/v1/register',obj={'email':'b@example.test','password':'password-B'});ta,tb=ra['token'],rb['token'];checks.append('Multi-user registration / bearer sessions')
   me=http('GET',base+'/v2/me',ta);assert me['subscription']['plan']=='free'
   plus=http('POST',base+'/v2/billing/dev-plan',ta,{'plan':'plus'});assert plus['plan']=='plus' and plus['entitlements']['cloud_ai'];ai=http('POST',base+'/v2/ai/generate',ta,{'messages':[{'role':'user','content':'hello P2'}]});assert ai['provider']=='mock' and 'hello P2' in ai['text'];http('POST',base+'/v2/ai/generate',tb,{'messages':[{'role':'user','content':'no'}]},expect=403);checks.append('Entitlements + Cloud AI plan gate')
   http('POST',base+'/v2/inbox',ta,{'item_type':'voice','title':'A voice','body':'tenant A only','source':'mobile'});ia=http('GET',base+'/v2/inbox?since=0',ta);ib=http('GET',base+'/v2/inbox?since=0',tb);assert len(ia['items'])==1 and len(ib['items'])==0;checks.append('P2 tenant isolation / Memory Inbox')
   # billing checkout is real-provider ready but not falsely configured
   no_checkout=http('POST',base+'/v2/billing/checkout',ta,{'plan':'plus','success_url':'https://example.test/s','cancel_url':'https://example.test/c'},expect=503);assert not no_checkout.get('configured');checks.append('Billing provider gate without production credentials')
   # Signed Stripe-style webhook can promote/cancel entitlements without a user bearer token.
   event={'id':'evt_p2','type':'customer.subscription.updated','data':{'object':{'id':'sub_p2','customer':'cus_p2','status':'active','metadata':{'lifeos_user_id':ra['user_id'],'lifeos_plan':'pro'}}}}
   raw=json.dumps(event,separators=(',',':')).encode();ts=int(time.time());sig=hmac.new(b'whsec_p2_test',str(ts).encode()+b'.'+raw,hashlib.sha256).hexdigest();req=urllib.request.Request(base+'/v2/billing/webhook',data=raw,headers={'Content-Type':'application/json','Stripe-Signature':f't={ts},v1={sig}'},method='POST')
   with urllib.request.urlopen(req,timeout=20) as rr: wh=json.loads(rr.read().decode())
   assert wh['ok'] and http('GET',base+'/v2/subscription',ta)['plan']=='pro';checks.append('Signed billing webhook -> entitlements')

   # Configure local sync A to account A and push existing new entries.
   sync_engine.configure(base,ta,True,a);sync_engine.configure(base,ta,True,b)
   first=sync_engine.push(a);assert first['accepted']>=2
   # Explicit share snapshot + public access + revocation.
   entry_id=cv['entry']['entry_id'];share=p2_sync.create_share(entry_id,expires_in_days=7,root=a);assert share['url'];pub=http('GET',share['url']);assert '口袋里的念头' in pub['title'] or '新的方向' in pub['content'];p2_sync.revoke_share(share['share_id'],a);http('GET',share['url'],expect=410);checks.append('Explicit immutable share snapshot + revoke')

   # E2EE entry sync. Payload stored by cloud must not contain plaintext.
   secret_text='P2-E2EE-SECRET-不要出现在云数据库明文里'
   out=pc.save_entry(journal_date='2031-01-05',sections={'日程':'','日记':secret_text,'自我探索':'','心得与摘录':'','体系构建':'','习惯打卡':''},title='Encrypted page',root=a)
   pushed=sync_engine.push(a);assert pushed['accepted']>=1
   cc=sqlite3.connect(cloud_db);rows=[r[0] for r in cc.execute("SELECT payload_json FROM operations WHERE user_id=? ORDER BY remote_seq DESC LIMIT 3",(ra['user_id'],))];cc.close();assert all(secret_text not in x for x in rows)
   pulled=sync_engine.pull(b);e=pc.get_entry(entry_id=out['entry_id'],root=b);assert e;txt=(b/'vault'/e['source_path']).read_text(encoding='utf-8');assert secret_text in txt;checks.append('Cross-device E2EE sync / cloud plaintext absence')

   # Notification engine -> cloud queue -> P2 pull.
   c=sqlite3.connect(a/'data/lifeos.db');old=c.execute("SELECT date FROM memories WHERE kind='daily' AND date IS NOT NULL ORDER BY date LIMIT 1").fetchone()[0];c.close();fake='2099'+old[4:];nr=refresh_due(a,fake);assert nr['created'];extra=p2_sync.pull_extras(a);assert extra.get('notifications_pushed',0)>=1;cloud_notes=http('GET',base+'/v2/notifications?since=0',ta);assert cloud_notes['items'];checks.append('Memory-native notifications -> cloud queue')
  finally:
   proc.terminate();
   try:proc.wait(timeout=4)
   except Exception:proc.kill()

  # Mobile/PWA and packaging static contracts.
  pkg=json.loads((ROOT/'mobile/package.json').read_text(encoding='utf-8'));html=(ROOT/'mobile/www/index.html').read_text(encoding='utf-8');assert pkg['dependencies']['@capacitor/core']=='8.5.0';assert html.count('data-tab=')>=5 and 'MediaRecorder' in html and 'encrypted_envelope' in html and 'photoInput' in html;checks.append('Capacitor iOS/Android + photo/voice/mobile E2EE static contract')
  web=(ROOT/'cloud/web/index.html').read_text(encoding='utf-8');assert 'lifeosWebRecoveryKey' in web and 'encryptPayload' in web and 'decryptEnvelope' in web and 'encrypted_payload' in web;checks.append('Web Companion client-side E2EE contract')
  # The historical lenses plus the Other room remain available in v0.2.
  baseline=json.loads((ROOT/'config/features_142_baseline.json').read_text(encoding='utf-8'));assert len(baseline)==142;checks.append('142 memory lenses preserved')
  print(json.dumps({'ok':True,'tmp':str(tmp),'checks':checks},ensure_ascii=False,indent=2))
 finally:
  shutil.rmtree(tmp,ignore_errors=True)

if __name__=='__main__':main()
