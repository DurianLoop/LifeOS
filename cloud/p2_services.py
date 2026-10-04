#!/usr/bin/env python3
"""P2 services for the reference LifeOS cloud.

This remains a development/reference service, but the domain contracts are real:
profiles, entitlements, Memory Inbox, notifications, explicit share snapshots,
and an optional cloud-AI gateway. Production still needs managed storage, TLS,
secret management, observability, queues and a real billing provider.
"""
from __future__ import annotations
from pathlib import Path
from urllib import request,error
import datetime as dt,hashlib,json,os,secrets,time,uuid
from cloud import billing

ROOT=Path(__file__).resolve().parents[1]
CATALOG=ROOT/'marketplace'/'catalog.json'
CLOUD_AI_DEFAULT_MAX_TOKENS=4096
CLOUD_AI_MAX_TOKENS=16384

PLANS={
 'free':{'sync':True,'memory_inbox':True,'mobile':True,'shares_max':3,'cloud_ai':False,'marketplace':True,'notifications':True},
 'plus':{'sync':True,'memory_inbox':True,'mobile':True,'shares_max':100,'cloud_ai':True,'marketplace':True,'notifications':True},
 'pro':{'sync':True,'memory_inbox':True,'mobile':True,'shares_max':1000,'cloud_ai':True,'marketplace':True,'notifications':True,'priority_sync':True},
}

def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def new_id(p):return f'{p}_{uuid.uuid4().hex}'
def token_hash(t):return hashlib.sha256(t.encode()).hexdigest()

def ensure_schema(c):
 c.executescript('''
 CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY,display_name TEXT,locale TEXT NOT NULL DEFAULT 'zh-CN',timezone TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT PRIMARY KEY,plan TEXT NOT NULL DEFAULT 'free',status TEXT NOT NULL DEFAULT 'active',provider TEXT NOT NULL DEFAULT 'none',customer_ref TEXT,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS inbox_items(seq INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,cloud_item_id TEXT NOT NULL,item_type TEXT NOT NULL,title TEXT,body TEXT,source TEXT,source_ref TEXT,payload_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,cloud_item_id));
 CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,quiet_start TEXT,quiet_end TEXT,kinds_json TEXT NOT NULL DEFAULT '["old-letter","capsule","memory-echo"]',updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(seq INTEGER PRIMARY KEY AUTOINCREMENT,notification_id TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT,target_json TEXT NOT NULL DEFAULT '{}',scheduled_at TEXT,status TEXT NOT NULL DEFAULT 'unread',created_at TEXT NOT NULL,read_at TEXT);
 CREATE TABLE IF NOT EXISTS shares(share_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,entry_id TEXT,revision_id TEXT,title TEXT NOT NULL,content TEXT NOT NULL,expires_at INTEGER,revoked_at TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS usage_counters(user_id TEXT NOT NULL,metric TEXT NOT NULL,period TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,metric,period));
 CREATE TABLE IF NOT EXISTS ai_requests(request_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,provider TEXT,model TEXT,input_chars INTEGER NOT NULL DEFAULT 0,output_chars INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,created_at TEXT NOT NULL);
 ''')
 cols={r[1] for r in c.execute('PRAGMA table_info(subscriptions)')}
 if 'provider_subscription_ref' not in cols:
  c.execute('ALTER TABLE subscriptions ADD COLUMN provider_subscription_ref TEXT')
 for r in c.execute('SELECT user_id FROM users'):
  uid=r[0];ts=now();c.execute('INSERT OR IGNORE INTO profiles(user_id,created_at,updated_at) VALUES(?,?,?)',(uid,ts,ts));c.execute('INSERT OR IGNORE INTO subscriptions(user_id,updated_at) VALUES(?,?)',(uid,ts));c.execute('INSERT OR IGNORE INTO notification_preferences(user_id,updated_at) VALUES(?,?)',(uid,ts))
 c.commit()

def subscription(c,uid):
 ensure_schema(c);r=c.execute('SELECT * FROM subscriptions WHERE user_id=?',(uid,)).fetchone();plan=(r['plan'] if r else 'free');return {'plan':plan,'status':r['status'] if r else 'active','provider':r['provider'] if r else 'none','entitlements':PLANS.get(plan,PLANS['free'])}

def profile(c,uid):
 ensure_schema(c);r=c.execute('SELECT * FROM profiles WHERE user_id=?',(uid,)).fetchone();return dict(r) if r else {'user_id':uid}

def me(c,uid):return {'profile':profile(c,uid),'subscription':subscription(c,uid)}

def export_user_data(c,uid):
 """Return a portable JSON snapshot of one tenant's cloud-side LifeOS data.

 Password hashes, session tokens and other users' rows are deliberately excluded.
 Encrypted sync payloads remain encrypted in the export because the cloud never has
 the Recovery Key.
 """
 ensure_schema(c)
 user=c.execute('SELECT user_id,email,created_at FROM users WHERE user_id=?',(uid,)).fetchone()
 if not user:return None
 def rows(sql,args=(uid,),json_cols=()):
  out=[]
  for r in c.execute(sql,args):
   d=dict(r)
   for k in json_cols:
    if k in d:
     try:d[k[:-5] if k.endswith('_json') else k]=json.loads(d.pop(k) or '{}')
     except Exception:pass
   out.append(d)
  return out
 return {
  'format':'lifeos-cloud-export-v1','exported_at':now(),
  'account':dict(user),'profile':profile(c,uid),'subscription':subscription(c,uid),
  'operations':rows('SELECT remote_seq,operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,created_at FROM operations WHERE user_id=? ORDER BY remote_seq',(uid,),('payload_json',)),
  'entries':rows('SELECT entry_id,current_revision_id,payload_json,updated_at FROM cloud_entries WHERE user_id=? ORDER BY updated_at',(uid,),('payload_json',)),
  'attachments':rows('SELECT attachment_id,entry_id,payload_json,created_at FROM cloud_attachments WHERE user_id=? ORDER BY created_at',(uid,),('payload_json',)),
  'memory_inbox':rows('SELECT cloud_item_id,item_type,title,body,source,source_ref,payload_json,status,created_at,updated_at FROM inbox_items WHERE user_id=? ORDER BY seq',(uid,),('payload_json',)),
  'notifications':rows('SELECT notification_id,kind,title,body,target_json,scheduled_at,status,created_at,read_at FROM notifications WHERE user_id=? ORDER BY seq',(uid,),('target_json',)),
  'shares':rows('SELECT share_id,entry_id,revision_id,title,content,expires_at,revoked_at,created_at FROM shares WHERE user_id=? ORDER BY created_at'),
  'usage':rows('SELECT metric,period,value FROM usage_counters WHERE user_id=? ORDER BY period,metric'),
  'ai_requests':rows('SELECT request_id,provider,model,input_chars,output_chars,status,created_at FROM ai_requests WHERE user_id=? ORDER BY created_at'),
 }

def delete_user_data(c,uid):
 """Irreversibly remove one tenant after the HTTP layer has re-authenticated them."""
 ensure_schema(c)
 tables=('operations','cloud_entries','cloud_attachments','inbox_items','notifications','notification_preferences','shares','usage_counters','ai_requests','profiles','subscriptions','sessions')
 counts={}
 try:
  c.execute('BEGIN')
  for table in tables:
   n=c.execute(f'SELECT COUNT(*) FROM {table} WHERE user_id=?',(uid,)).fetchone()[0]
   counts[table]=n;c.execute(f'DELETE FROM {table} WHERE user_id=?',(uid,))
  counts['users']=c.execute('SELECT COUNT(*) FROM users WHERE user_id=?',(uid,)).fetchone()[0]
  c.execute('DELETE FROM users WHERE user_id=?',(uid,));c.commit()
 except Exception:
  c.rollback();raise
 return {'ok':True,'deleted':counts,'deleted_at':now()}

def _catalog():
 try:return json.loads(CATALOG.read_text(encoding='utf-8'))
 except Exception:return {'version':1,'items':[]}

def get(c,uid,path,query):
 ensure_schema(c)
 if path=='/v2/me':return 200,me(c,uid)
 if path=='/v2/subscription':return 200,subscription(c,uid)
 if path=='/v2/account/export':
  data=export_user_data(c,uid);return (200,data) if data else (404,{'error':'account not found'})
 if path=='/v2/marketplace':return 200,_catalog()
 if path=='/v2/inbox':
  since=int((query.get('since') or ['0'])[0]);items=[]
  for r in c.execute('SELECT * FROM inbox_items WHERE user_id=? AND seq>? ORDER BY seq LIMIT 500',(uid,since)):
   d=dict(r);meta=json.loads(d.pop('payload_json') or '{}');d.update({'attachment_ids':meta.get('attachment_ids') or [],'metadata':meta.get('metadata') or {}});items.append(d)
  return 200,{'items':items,'last_seq':items[-1]['seq'] if items else since}
 if path=='/v2/notifications':
  since=int((query.get('since') or ['0'])[0]);items=[]
  for r in c.execute('SELECT * FROM notifications WHERE user_id=? AND seq>? ORDER BY seq LIMIT 500',(uid,since)):
   d=dict(r);d['target']=json.loads(d.pop('target_json') or '{}');items.append(d)
  return 200,{'items':items,'last_seq':items[-1]['seq'] if items else since}
 if path=='/v2/shares':
  out=[]
  for r in c.execute('SELECT share_id,entry_id,revision_id,title,expires_at,revoked_at,created_at FROM shares WHERE user_id=? ORDER BY created_at DESC',(uid,)):out.append(dict(r))
  return 200,{'items':out}
 return 404,{'error':'unknown P2 endpoint'}

def public_get(c,path,query,base_url=''):
 ensure_schema(c)
 if path!='/v2/public/share':return None
 token=(query.get('token') or [''])[0]
 if not token:return 400,{'error':'share token required'}
 r=c.execute('SELECT * FROM shares WHERE token_hash=?',(token_hash(token),)).fetchone()
 if not r:return 404,{'error':'share not found'}
 if r['revoked_at']:return 410,{'error':'share revoked'}
 if r['expires_at'] and int(r['expires_at'])<int(time.time()):return 410,{'error':'share expired'}
 return 200,{'share_id':r['share_id'],'title':r['title'],'content':r['content'],'created_at':r['created_at'],'expires_at':r['expires_at'],'privacy':'This is an explicit share snapshot. Later journal edits do not silently change it.'}

def post(c,uid,path,b,base_url=''):
 ensure_schema(c);ts=now()
 if path=='/v2/profile':
  c.execute('INSERT INTO profiles(user_id,display_name,locale,timezone,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,locale=excluded.locale,timezone=excluded.timezone,updated_at=excluded.updated_at',(uid,(b.get('display_name') or '')[:120],b.get('locale') or 'zh-CN',b.get('timezone') or '',ts,ts));c.commit();return 200,me(c,uid)
 if path=='/v2/inbox':
  ent=subscription(c,uid)['entitlements']
  if not ent.get('memory_inbox'):return 403,{'error':'memory inbox not available on this plan'}
  item_type=str(b.get('item_type') or b.get('type') or 'text')[:32];iid=str(b.get('cloud_item_id') or new_id('cloudinbox'))
  payload={'attachment_ids':b.get('attachment_ids') or [],'metadata':b.get('metadata') or {}}
  c.execute('INSERT OR IGNORE INTO inbox_items(user_id,cloud_item_id,item_type,title,body,source,source_ref,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(uid,iid,item_type,str(b.get('title') or '')[:500],str(b.get('body') or ''),str(b.get('source') or 'mobile')[:80],str(b.get('source_ref') or '')[:500],json.dumps(payload,ensure_ascii=False),'pending',ts,ts));c.commit();r=c.execute('SELECT seq FROM inbox_items WHERE user_id=? AND cloud_item_id=?',(uid,iid)).fetchone();return 200,{'ok':True,'cloud_item_id':iid,'seq':r[0]}
 if path=='/v2/inbox/status':
  iid=str(b.get('cloud_item_id') or '');status=b.get('status') if b.get('status') in ('pending','accepted','dismissed','archived') else 'pending';c.execute('UPDATE inbox_items SET status=?,updated_at=? WHERE user_id=? AND cloud_item_id=?',(status,ts,uid,iid));c.commit();return 200,{'ok':True}
 if path=='/v2/notifications/preferences':
  c.execute('INSERT INTO notification_preferences(user_id,enabled,quiet_start,quiet_end,kinds_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,kinds_json=excluded.kinds_json,updated_at=excluded.updated_at',(uid,1 if b.get('enabled',True) else 0,b.get('quiet_start'),b.get('quiet_end'),json.dumps(b.get('kinds') or ['old-letter','capsule','memory-echo'],ensure_ascii=False),ts));c.commit();return 200,{'ok':True}
 if path=='/v2/notifications/read':
  nid=str(b.get('notification_id') or '');c.execute("UPDATE notifications SET status='read',read_at=? WHERE user_id=? AND notification_id=?",(ts,uid,nid));c.commit();return 200,{'ok':True}
 if path=='/v2/notifications/enqueue':
  if not subscription(c,uid)['entitlements'].get('notifications'):return 403,{'error':'notifications not available'}
  nid=str(b.get('notification_id') or new_id('note'));kind=str(b.get('kind') or 'system')[:48];title=str(b.get('title') or 'LifeOS')[:300];body=str(b.get('body') or '')[:2000];target=b.get('target') or {}
  c.execute('INSERT OR IGNORE INTO notifications(notification_id,user_id,kind,title,body,target_json,scheduled_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(nid,uid,kind,title,body,json.dumps(target,ensure_ascii=False),b.get('scheduled_at'),'unread',ts));c.commit();r=c.execute('SELECT seq FROM notifications WHERE user_id=? AND notification_id=?',(uid,nid)).fetchone();return 200,{'ok':True,'notification_id':nid,'seq':r[0] if r else None}
 if path=='/v2/shares':
  sub=subscription(c,uid);maxshares=int(sub['entitlements'].get('shares_max') or 0);active=c.execute('SELECT COUNT(*) FROM shares WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',(uid,int(time.time()))).fetchone()[0]
  if active>=maxshares:return 403,{'error':'active share limit reached for this plan','limit':maxshares}
  content=str(b.get('content') or '');
  if not content:return 400,{'error':'explicit share content required'}
  days=max(1,min(365,int(b.get('expires_in_days') or 30)));token=secrets.token_urlsafe(24);sid=new_id('share');exp=int(time.time())+days*86400
  c.execute('INSERT INTO shares(share_id,user_id,token_hash,entry_id,revision_id,title,content,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(sid,uid,token_hash(token),b.get('entry_id'),b.get('revision_id'),str(b.get('title') or 'LifeOS memory')[:300],content,exp,ts));c.commit();url=(base_url.rstrip('/')+'/v2/public/share?token='+token) if base_url else '/v2/public/share?token='+token;return 200,{'share_id':sid,'url':url,'token':token,'title':str(b.get('title') or 'LifeOS memory'),'expires_at':exp,'created_at':ts,'status':'active'}
 if path=='/v2/shares/revoke':
  sid=str(b.get('share_id') or '');c.execute('UPDATE shares SET revoked_at=? WHERE user_id=? AND share_id=?',(ts,uid,sid));c.commit();return 200,{'ok':True,'share_id':sid}
 if path=='/v2/billing/dev-plan':
  if os.getenv('LIFEOS_DEV_BILLING','0')!='1':return 403,{'error':'development billing switch disabled'}
  plan=b.get('plan') if b.get('plan') in PLANS else 'free';c.execute("INSERT INTO subscriptions(user_id,plan,status,provider,updated_at) VALUES(?,?, 'active','dev',?) ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,status='active',provider='dev',updated_at=excluded.updated_at",(uid,plan,ts));c.commit();return 200,subscription(c,uid)
 if path=='/v2/billing/checkout':
  plan=b.get('plan') if b.get('plan') in ('plus','pro') else 'plus';u=c.execute('SELECT email FROM users WHERE user_id=?',(uid,)).fetchone()
  try:return 200,billing.create_checkout(user_id=uid,email=u['email'] if u else '',plan=plan,success_url=b.get('success_url') or base_url+'/',cancel_url=b.get('cancel_url') or base_url+'/')
  except Exception as e:return 503,{'error':str(e),'configured':billing.configured()}
 if path=='/v2/ai/generate':return _cloud_ai(c,uid,b)
 return 404,{'error':'unknown P2 endpoint'}

def billing_webhook(c,raw_body:bytes,signature_header:str):
 """Apply a verified Stripe subscription event to entitlements.

 Authenticity comes from the Stripe webhook signature, not a user session.
 """
 try: event=billing.verify_stripe_webhook(raw_body,signature_header)
 except Exception as e:return 400,{'error':str(e)}
 typ=str(event.get('type') or '');obj=((event.get('data') or {}).get('object') or {});meta=obj.get('metadata') or {}
 uid=str(meta.get('lifeos_user_id') or '');plan=str(meta.get('lifeos_plan') or 'free')
 if typ=='checkout.session.completed':
  status='active';customer=obj.get('customer');subref=obj.get('subscription')
 elif typ in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'):
  status='canceled' if typ.endswith('.deleted') else str(obj.get('status') or 'active');customer=obj.get('customer');subref=obj.get('id')
 else:return 200,{'ok':True,'ignored':typ}
 if not uid:return 200,{'ok':True,'ignored':typ,'reason':'missing lifeos_user_id metadata'}
 if plan not in PLANS:plan='free'
 if status not in ('active','trialing'):plan='free'
 ensure_schema(c);ts=now();c.execute('''INSERT INTO subscriptions(user_id,plan,status,provider,customer_ref,provider_subscription_ref,updated_at) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,status=excluded.status,provider='stripe',customer_ref=excluded.customer_ref,provider_subscription_ref=excluded.provider_subscription_ref,updated_at=excluded.updated_at''',(uid,plan,status,'stripe',customer,subref,ts));c.commit()
 return 200,{'ok':True,'type':typ,'user_id':uid,'plan':plan,'status':status}

def enqueue_notification(c,uid,kind,title,body='',target=None,scheduled_at=None):
 ensure_schema(c);nid=new_id('note');c.execute('INSERT INTO notifications(notification_id,user_id,kind,title,body,target_json,scheduled_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(nid,uid,kind,title,body,json.dumps(target or {},ensure_ascii=False),scheduled_at,'unread',now()));c.commit();return nid

def _cloud_ai(c,uid,b):
 sub=subscription(c,uid)
 if not sub['entitlements'].get('cloud_ai'):return 403,{'error':'cloud AI is not enabled for this plan','plan':sub['plan']}
 messages=b.get('messages') or []
 if not isinstance(messages,list) or not messages:return 400,{'error':'messages required'}
 chars=sum(len(str(x.get('content') or '')) for x in messages if isinstance(x,dict))
 if chars>60000:return 400,{'error':'cloud AI request too large'}
 temperature=b.get('temperature',0.2)
 max_tokens=b.get('max_tokens')
 if max_tokens is None:max_tokens=CLOUD_AI_DEFAULT_MAX_TOKENS
 if isinstance(temperature,bool) or not isinstance(temperature,(int,float)) or not 0<=temperature<=2:
  return 400,{'error':'temperature must be a number between 0 and 2'}
 if isinstance(max_tokens,bool) or not isinstance(max_tokens,int) or not 1<=max_tokens<=CLOUD_AI_MAX_TOKENS:
  return 400,{'error':f'max_tokens must be an integer between 1 and {CLOUD_AI_MAX_TOKENS}'}
 provider=os.getenv('LIFEOS_CLOUD_AI_PROVIDER','mock');model=os.getenv('LIFEOS_CLOUD_AI_MODEL','lifeos-mock');rid=new_id('caireq');ts=now()
 try:
  if provider=='mock': text='[Cloud AI test] '+str(messages[-1].get('content') or '')[:500]
  else:
   base=os.getenv('LIFEOS_CLOUD_AI_BASE_URL','').rstrip('/');key=os.getenv('LIFEOS_CLOUD_AI_API_KEY','')
   if not (base and key):return 503,{'error':'cloud AI provider is not configured'}
   payload={'model':model,'messages':messages,'temperature':float(temperature),'max_tokens':max_tokens};raw=json.dumps(payload,ensure_ascii=False).encode();req=request.Request(base+'/chat/completions',data=raw,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
   with request.urlopen(req,timeout=90) as resp:data=json.loads(resp.read().decode());text=data['choices'][0]['message']['content']
  c.execute('INSERT INTO ai_requests(request_id,user_id,provider,model,input_chars,output_chars,status,created_at) VALUES(?,?,?,?,?,?,?,?)',(rid,uid,provider,model,chars,len(text),'ok',ts));period=ts[:7];c.execute('INSERT INTO usage_counters(user_id,metric,period,value) VALUES(?,?,?,1) ON CONFLICT(user_id,metric,period) DO UPDATE SET value=value+1',(uid,'cloud_ai_requests',period));c.commit();return 200,{'text':text,'provider':provider,'model':model,'request_id':rid,'privacy':'Only the messages explicitly supplied to this request were processed.'}
 except Exception as e:
  c.execute('INSERT INTO ai_requests(request_id,user_id,provider,model,input_chars,output_chars,status,created_at) VALUES(?,?,?,?,?,?,?,?)',(rid,uid,provider,model,chars,0,'error',ts));c.commit();return 502,{'error':str(e)}
