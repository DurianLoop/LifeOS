#!/usr/bin/env python3
"""Development/reference LifeOS cloud sync + Web Companion server.

This is deliberately small but real: PBKDF2 accounts, bearer sessions, tenant
isolation, optimistic revision conflict checks, append-only sync operations, and
a Web Companion surface. Production deployment still requires TLS, managed DB,
object storage, backups, observability and secrets management.
"""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import base64,hashlib,hmac,json,os,secrets,sqlite3,time,sys
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0,str(ROOT))
from cloud import p2_services,memorial
WEB=ROOT/'cloud'/'web';DB=Path(os.getenv('LIFEOS_CLOUD_DB',str(ROOT/'cloud'/'dev_cloud.db')));HOST=os.getenv('LIFEOS_CLOUD_HOST','127.0.0.1');PORT=int(os.getenv('LIFEOS_CLOUD_PORT','8790'))

def db():
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;c.execute('PRAGMA journal_mode=WAL');c.executescript('''
 CREATE TABLE IF NOT EXISTS users(user_id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(remote_seq INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,operation_id TEXT NOT NULL,entry_id TEXT NOT NULL,revision_id TEXT,base_revision_id TEXT,op_type TEXT NOT NULL,payload_json TEXT NOT NULL,device_id TEXT,created_at TEXT NOT NULL,UNIQUE(user_id,operation_id));
 CREATE TABLE IF NOT EXISTS cloud_entries(user_id TEXT NOT NULL,entry_id TEXT NOT NULL,current_revision_id TEXT,payload_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,entry_id));
 CREATE TABLE IF NOT EXISTS cloud_attachments(user_id TEXT NOT NULL,attachment_id TEXT NOT NULL,entry_id TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,attachment_id));
 ''');p2_services.ensure_schema(c);memorial.ensure_schema(c);c.commit();return c

def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def pw_hash(password,salt):return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),240000).hex()
def token_hash(t):return hashlib.sha256(t.encode()).hexdigest()
def json_response(h,obj,status=200):
 raw=json.dumps(obj,ensure_ascii=False).encode();h.send_response(status);h.send_header('Content-Type','application/json; charset=utf-8');h.send_header('Content-Length',str(len(raw)));h.send_header('Cache-Control','no-store');h.end_headers();h.wfile.write(raw)

def auth(h):
 a=h.headers.get('Authorization','');t=a[7:] if a.startswith('Bearer ') else ''
 if not t:return None
 c=db();r=c.execute('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?',(token_hash(t),int(time.time()))).fetchone();c.close();return r[0] if r else None

class H(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(WEB),**kw)
 def log_message(self,fmt,*args):print('[LifeOS Cloud]',fmt%args)
 def body(self):
  n=int(self.headers.get('Content-Length','0') or 0);return json.loads(self.rfile.read(n).decode() or '{}') if n else {}
 def base_url(self):
  configured=os.getenv('LIFEOS_PUBLIC_BASE_URL','').rstrip('/')
  if configured:return configured
  proto=self.headers.get('X-Forwarded-Proto') or 'http';host=self.headers.get('Host') or f'{HOST}:{PORT}';return proto+'://'+host
 def do_GET(self):
  u=urlparse(self.path)
  if u.path=='/v2/public/memorial':
   c=db()
   try:
    status,obj=memorial.public_get(c,parse_qs(u.query).get('id',[''])[0]);return json_response(self,obj,status)
   finally:c.close()
  if u.path=='/v2/public/share':
   c=db()
   try:
    res=p2_services.public_get(c,u.path,parse_qs(u.query),self.base_url())
    return json_response(self,res[1],res[0]) if res else json_response(self,{'error':'unknown'},404)
   finally:c.close()
  if u.path=='/health':return json_response(self,{'ok':True,'service':'LifeOS dev sync','web':'/'} )
  if u.path.startswith('/v2/'):
   uid=auth(self)
   if not uid:return json_response(self,{'error':'unauthorized'},401)
   c=db()
   try:
    if u.path=='/v2/memorial':
     status,obj=memorial.owner_get(c,uid,self.base_url());return json_response(self,obj,status)
    status,obj=p2_services.get(c,uid,u.path,parse_qs(u.query));return json_response(self,obj,status)
   finally:c.close()
  if u.path.startswith('/v1/'):
   uid=auth(self)
   if not uid:return json_response(self,{'error':'unauthorized'},401)
   c=db()
   try:
    if u.path=='/v1/pull':
     since=int(parse_qs(u.query).get('since',['0'])[0]);ops=[]
     for r in c.execute('SELECT * FROM operations WHERE user_id=? AND remote_seq>? ORDER BY remote_seq LIMIT 1000',(uid,since)):
      d=dict(r);d['payload']=json.loads(d.pop('payload_json'));ops.append(d)
     return json_response(self,{'operations':ops,'last_seq':ops[-1]['remote_seq'] if ops else since})
    if u.path=='/v1/entries':
     items=[]
     for r in c.execute('SELECT * FROM cloud_entries WHERE user_id=? ORDER BY updated_at DESC',(uid,)):
      d=json.loads(r['payload_json'])
      if isinstance(d,dict) and d.get('encrypted_envelope'):
       items.append({'entry_id':r['entry_id'],'current_revision_id':r['current_revision_id'],'encrypted_payload':d})
      else:
       d['current_revision_id']=r['current_revision_id'];items.append(d)
     return json_response(self,{'items':items})
    return json_response(self,{'error':'unknown'},404)
   finally:c.close()
  return super().do_GET()
 def do_POST(self):
  u=urlparse(self.path)
  length=int(self.headers.get('Content-Length','0') or 0)
  if u.path=='/v2/memorial' and length>22_000_000:return json_response(self,{'error':'memorial upload exceeds 22 MB'},413)
  if u.path=='/v2/public/memorial/ask' and length>2048:return json_response(self,{'error':'question request too large'},413)
  if u.path=='/v2/billing/webhook':
   n=int(self.headers.get('Content-Length','0') or 0);raw=self.rfile.read(n) if n else b'';c=db()
   try:
    status,obj=p2_services.billing_webhook(c,raw,self.headers.get('Stripe-Signature',''));return json_response(self,obj,status)
   finally:c.close()
  b=self.body()
  if u.path=='/v2/public/memorial/ask':
   c=db()
   try:
    status,obj=memorial.ask(c,str(b.get('id') or ''),b.get('question'),self.client_address[0]);return json_response(self,obj,status)
   finally:c.close()
  if u.path=='/v1/register':
   email=str(b.get('email') or '').lower().strip();pw=str(b.get('password') or '')
   if '@' not in email or len(pw)<8:return json_response(self,{'error':'valid email and 8+ character password required'},400)
   salt=secrets.token_hex(16);uid='user_'+secrets.token_hex(12);c=db()
   try:
    c.execute('INSERT INTO users(user_id,email,password_hash,salt,created_at) VALUES(?,?,?,?,?)',(uid,email,pw_hash(pw,salt),salt,now()));c.commit()
   except sqlite3.IntegrityError:return json_response(self,{'error':'email already registered'},409)
   finally:c.close()
   return self._session(uid)
  if u.path=='/v1/login':
   email=str(b.get('email') or '').lower().strip();pw=str(b.get('password') or '');c=db();r=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone();c.close()
   if not r or not hmac.compare_digest(pw_hash(pw,r['salt']),r['password_hash']):return json_response(self,{'error':'invalid credentials'},401)
   return self._session(r['user_id'])
  uid=auth(self)
  if not uid:return json_response(self,{'error':'unauthorized'},401)
  if u.path=='/v2/account/delete':
   password=str(b.get('password') or '');confirm=str(b.get('confirm') or '')
   if confirm!='DELETE MY LIFEOS':return json_response(self,{'error':'type DELETE MY LIFEOS to confirm'},400)
   c=db();r=c.execute('SELECT password_hash,salt FROM users WHERE user_id=?',(uid,)).fetchone()
   if not r or not hmac.compare_digest(pw_hash(password,r['salt']),r['password_hash']):c.close();return json_response(self,{'error':'password re-authentication failed'},401)
   try:
    public=c.execute('SELECT public_id FROM memorials WHERE user_id=?',(uid,)).fetchone()
    if public:c.execute('DELETE FROM memorial_questions WHERE public_id=?',(public['public_id'],))
    c.execute('DELETE FROM memorials WHERE user_id=?',(uid,));c.commit()
    result=p2_services.delete_user_data(c,uid);return json_response(self,result,200)
   finally:c.close()
  if u.path.startswith('/v2/'):
   c=db()
   try:
    if u.path=='/v2/memorial':
     status,obj=memorial.save(c,uid,b,self.base_url());return json_response(self,obj,status)
    if u.path=='/v2/memorial/unpublish':
     status,obj=memorial.unpublish(c,uid);return json_response(self,obj,status)
    status,obj=p2_services.post(c,uid,u.path,b,self.base_url());return json_response(self,obj,status)
   finally:c.close()
  if u.path=='/v1/push':
   ops=b.get('operations') or [];accepted=[];conflicts=[];c=db()
   try:
    for op in ops:
     opid=op.get('operation_id');eid=op.get('entry_id');rid=op.get('revision_id');base=op.get('base_revision_id');payload=op.get('payload') or {}
     if not (opid and eid):continue
     seen=c.execute('SELECT remote_seq FROM operations WHERE user_id=? AND operation_id=?',(uid,opid)).fetchone()
     if seen:accepted.append({'operation_id':opid,'remote_seq':seen[0],'duplicate':True});continue
     optype=op.get('op_type','upsert')
     if optype=='attachment':
      cur2=c.execute('INSERT INTO operations(user_id,operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(uid,opid,eid,rid,base,optype,json.dumps(payload,ensure_ascii=False),op.get('device_id'),op.get('created_at') or now()));seq=cur2.lastrowid
      # With E2EE the reference cloud intentionally cannot inspect attachment metadata/content.
      att=(payload.get('attachment') or {}) if isinstance(payload,dict) and not payload.get('encrypted_envelope') else {};aid=att.get('attachment_id')
      if aid:c.execute('INSERT OR REPLACE INTO cloud_attachments(user_id,attachment_id,entry_id,payload_json,created_at) VALUES(?,?,?,?,?)',(uid,aid,eid,json.dumps(payload,ensure_ascii=False),op.get('created_at') or now()))
      accepted.append({'operation_id':opid,'remote_seq':seq});continue
     cur=c.execute('SELECT current_revision_id FROM cloud_entries WHERE user_id=? AND entry_id=?',(uid,eid)).fetchone();current=cur[0] if cur else None
     if current is not None and current!=base and current!=rid:
      rr=c.execute('SELECT * FROM operations WHERE user_id=? AND entry_id=? AND revision_id=? ORDER BY remote_seq DESC LIMIT 1',(uid,eid,current)).fetchone();remote=None
      if rr:remote=dict(rr);remote['payload']=json.loads(remote.pop('payload_json'))
      conflicts.append({'operation_id':opid,'entry_id':eid,'current_revision_id':current,'incoming_revision_id':rid,'base_revision_id':base,'remote_operation':remote});continue
     cur2=c.execute('INSERT INTO operations(user_id,operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(uid,opid,eid,rid,base,optype,json.dumps(payload,ensure_ascii=False),op.get('device_id'),op.get('created_at') or now()))
     seq=cur2.lastrowid;c.execute('INSERT INTO cloud_entries(user_id,entry_id,current_revision_id,payload_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,entry_id) DO UPDATE SET current_revision_id=excluded.current_revision_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at',(uid,eid,rid,json.dumps(payload,ensure_ascii=False),op.get('created_at') or now()));accepted.append({'operation_id':opid,'remote_seq':seq})
    c.commit();return json_response(self,{'accepted':accepted,'conflicts':conflicts})
   finally:c.close()
  return json_response(self,{'error':'unknown'},404)
 def _session(self,uid):
  token=secrets.token_urlsafe(32);c=db();c.execute('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',(token_hash(token),uid,now(),int(time.time())+30*86400));c.commit();c.close();return json_response(self,{'token':token,'user_id':uid,'expires_in':30*86400})

if __name__=='__main__':
 DB.parent.mkdir(parents=True,exist_ok=True);db().close();print(f'LifeOS dev cloud: http://{HOST}:{PORT}');ThreadingHTTPServer((HOST,PORT),H).serve_forever()
