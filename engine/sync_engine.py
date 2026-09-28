#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import os
import json, urllib.request, urllib.parse, urllib.error
from engine import product_core as pc
from engine.incremental_index import reindex_paths
from backend.secret_store import get_secret, set_secret
from engine import crypto_vault
ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])

def _settings(root=ROOT):return pc.settings_dict(root)

def sync_token(root=ROOT): return get_secret('sync.token','LIFEOS_SYNC_TOKEN',root)[0]

def set_sync_token(token,root=ROOT): return set_secret('sync.token',token,root)

def _request(method,url,token='',payload=None,timeout=45):
    data=None if payload is None else json.dumps(payload,ensure_ascii=False).encode('utf-8')
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(url,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as resp:return json.loads(resp.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:raise RuntimeError(f'sync HTTP {e.code}: '+e.read().decode('utf-8',errors='replace')[:1000])

def status(root=ROOT):
    s=_settings(root);c=pc.connect(root)
    try:
        return {'enabled':s.get('sync.enabled','false')=='true','url':s.get('sync.url',''),'configured':bool(sync_token(root)),'last_pull_seq':int(s.get('sync.last_pull_seq','0') or 0),'pending':c.execute("SELECT COUNT(*) FROM sync_operations WHERE sync_status='pending'").fetchone()[0],'conflicts':c.execute("SELECT COUNT(*) FROM sync_conflicts WHERE status='open'").fetchone()[0]}
    finally:c.close()

def register_account(url,email,password,root=ROOT):
    base=(url or '').rstrip('/')
    if not base: raise ValueError('sync URL required')
    data=_request('POST',base+'/v1/register','',{'email':email,'password':password})
    if data.get('token'): configure(base,data['token'],True,root)
    return {'ok':bool(data.get('token')),'user_id':data.get('user_id'),'expires_in':data.get('expires_in'),'status':status(root)}

def login_account(url,email,password,root=ROOT):
    base=(url or '').rstrip('/')
    if not base: raise ValueError('sync URL required')
    data=_request('POST',base+'/v1/login','',{'email':email,'password':password})
    if data.get('token'): configure(base,data['token'],True,root)
    return {'ok':bool(data.get('token')),'user_id':data.get('user_id'),'expires_in':data.get('expires_in'),'status':status(root)}

def configure(url,token=None,enabled=True,root=ROOT):
    pc.set_settings({'sync.url':url.rstrip('/'),'sync.enabled':enabled},root)
    if token:set_sync_token(token,root)
    return status(root)

def push(root=ROOT):
    st=status(root);url=st['url'];token=sync_token(root)
    if not (url and token):raise RuntimeError('sync URL/token not configured')
    con=pc.connect(root)
    try:ops=[]
    finally:pass
    try:
        for r in con.execute("SELECT * FROM sync_operations WHERE sync_status='pending' ORDER BY local_seq LIMIT 200"):
            d=dict(r);d['payload']=json.loads(d.pop('payload_json'));ops.append(crypto_vault.maybe_encrypt_operation(d,root))
    finally:con.close()
    if not ops:return {'accepted':0,'conflicts':[],'pending':0}
    data=_request('POST',url+'/v1/push',token,{'operations':ops})
    con=pc.connect(root)
    try:
        for a in data.get('accepted',[]):con.execute("UPDATE sync_operations SET sync_status='synced',remote_seq=? WHERE operation_id=?",(a.get('remote_seq'),a['operation_id']))
        for cf in data.get('conflicts',[]):
            op=next((x for x in ops if x['operation_id']==cf['operation_id']),None)
            if op:
                cid=pc.new_id('conflict');con.execute('INSERT OR IGNORE INTO sync_conflicts(conflict_id,entry_id,local_revision_id,remote_revision_id,base_revision_id,remote_payload_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)',(cid,op['entry_id'],op['revision_id'],cf.get('current_revision_id'),op.get('base_revision_id'),json.dumps(cf.get('remote_operation') or cf,ensure_ascii=False),'open',pc.utcnow()))
                con.execute("UPDATE sync_operations SET sync_status='conflict' WHERE operation_id=?",(op['operation_id'],))
        con.commit()
    finally:con.close()
    pc.set_settings({'sync.last_push_at':pc.utcnow()},root)
    return {'accepted':len(data.get('accepted',[])),'conflicts':data.get('conflicts',[]),'remote':data}

def pull(root=ROOT):
    st=status(root);url=st['url'];token=sync_token(root)
    if not (url and token):raise RuntimeError('sync URL/token not configured')
    since=st['last_pull_seq'];data=_request('GET',url+'/v1/pull?since='+str(since),token)
    applied=[];conflicts=[];changed=[];maxseq=since
    for op in data.get('operations',[]):
        maxseq=max(maxseq,int(op.get('remote_seq') or 0));op=crypto_vault.maybe_decrypt_operation(op,root);res=pc.apply_remote_operation(op,root)
        if res['status']=='applied':applied.append(res);changed.append(res['source_path'])
        elif res['status']=='applied_attachment':applied.append(res)
        elif res['status']=='conflict':conflicts.append(res)
    if changed:reindex_paths(changed,root=root)
    pc.set_settings({'sync.last_pull_seq':str(maxseq)},root)
    return {'applied':applied,'conflicts':conflicts,'last_pull_seq':maxseq}

def sync_once(root=ROOT):
    p=push(root);q=pull(root)
    extras=None
    try:
        from engine import p2_sync
        extras=p2_sync.pull_extras(root)
    except Exception as e:
        extras={'error':str(e)}
    return {'push':p,'pull':q,'extras':extras,'status':status(root),'encryption':crypto_vault.status(root)}

if __name__=='__main__':
    print(json.dumps(sync_once(ROOT),ensure_ascii=False,indent=2))
