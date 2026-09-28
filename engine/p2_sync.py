#!/usr/bin/env python3
"""P2 cloud companion sync: Memory Inbox, notifications, sharing and profile state."""
from __future__ import annotations
from pathlib import Path
from engine import product_core as pc
from engine import p2_core, memorial
from engine.sync_engine import _request, sync_token, status as sync_status
from backend.secret_store import get_secret, set_secret
import secrets
import os
from urllib.parse import urlparse
ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])

def _auth(root):
    st=sync_status(root);token=sync_token(root)
    if not (st.get('url') and token):raise RuntimeError('sync URL/token not configured')
    return st['url'].rstrip('/'),token

def pull_extras(root=ROOT):
    root=Path(root);base,token=_auth(root);out={}
    try:
        from engine.notification_engine import refresh_due
        refresh_due(root)
        pushed=0
        for n in p2_core.list_notifications('unread',100,root):
            _request('POST',base+'/v2/notifications/enqueue',token,{'notification_id':n['notification_id'],'kind':n['kind'],'title':n['title'],'body':n.get('body') or '','target':n.get('target') or {},'scheduled_at':n.get('scheduled_at')});pushed+=1
        out['notifications_pushed']=pushed
    except Exception as e: out['notification_push_error']=str(e)
    since=p2_core.sync_seq('inbox',root);data=_request('GET',f'{base}/v2/inbox?since={since}',token)
    for x in data.get('items',[]):
        p2_core.add_inbox_item(x.get('item_type'),x.get('title'),x.get('body'),x.get('source') or 'cloud',x.get('source_ref') or '',x.get('attachment_ids') or [],x.get('metadata') or {},x.get('cloud_item_id'),root)
    p2_core.set_sync_seq('inbox',data.get('last_seq',since),root);out['inbox']=len(data.get('items',[]))
    nsince=p2_core.sync_seq('notifications',root);nd=_request('GET',f'{base}/v2/notifications?since={nsince}',token)
    for x in nd.get('items',[]):p2_core.add_notification(x.get('kind') or 'system',x.get('title') or 'LifeOS',x.get('body') or '',x.get('target') or {},x.get('scheduled_at'),root,x.get('notification_id'))
    p2_core.set_sync_seq('notifications',nd.get('last_seq',nsince),root);out['notifications']=len(nd.get('items',[]))
    me=_request('GET',base+'/v2/me',token);sub=me.get('subscription') or {};p2_core.set_subscription(sub.get('plan','free'),sub.get('status','active'),sub.get('entitlements') or {},sub.get('provider','cloud'),root);out['me']=me
    return out

def push_inbox(item:dict,root=ROOT):
    base,token=_auth(Path(root));return _request('POST',base+'/v2/inbox',token,item)

def create_share(entry_id,revision_id=None,expires_in_days=30,title=None,root=ROOT):
    root=Path(root);base,token=_auth(root);entry=pc.get_entry(entry_id=entry_id,root=root)
    if not entry:raise ValueError('entry not found')
    rev=pc.read_revision(revision_id or entry['current_revision_id'],root)
    payload={'entry_id':entry_id,'revision_id':rev['revision_id'],'title':title if title is not None else entry.get('title') or entry.get('journal_date') or 'LifeOS memory','content':rev.get('content') or '','expires_in_days':int(expires_in_days)}
    out=_request('POST',base+'/v2/shares',token,payload);p2_core.save_share_record(out,entry_id,rev['revision_id'],root);return out

def revoke_share(share_id,root=ROOT):
    root=Path(root);base,token=_auth(root);out=_request('POST',base+'/v2/shares/revoke',token,{'share_id':share_id});
    con=pc.connect(root)
    try:con.execute("UPDATE share_records SET status='revoked',revoked_at=? WHERE remote_share_id=? OR share_id=?",(pc.utcnow(),share_id,share_id));con.commit()
    finally:con.close()
    return out


def memorial_status(root=ROOT):
    if not memorial_config(root).get('configured'):
        return {'published':False,'configured':False}
    base,token=_memorial_auth(Path(root))
    return {**_request('GET',base+'/v2/memorial',token),'configured':True}


def publish_memorial(title,introduction,entry_ids,story_ids,ai_enabled=False,root=ROOT):
    base,token=_memorial_auth(Path(root))
    entries=memorial.build_snapshot(entry_ids,root)
    return _request('POST',base+'/v2/memorial',token,{
        'title':title,'introduction':introduction,'entries':entries,
        'story_ids':story_ids,'ai_enabled':bool(ai_enabled)})


def unpublish_memorial(root=ROOT):
    base,token=_memorial_auth(Path(root))
    return _request('POST',base+'/v2/memorial/unpublish',token,{})


def memorial_config(root=ROOT):
    root=Path(root)
    settings=pc.settings_dict(root)
    token=get_secret('memorial.publish_token','LIFEOS_MEMORIAL_PUBLISH_TOKEN',root)[0]
    return {'url':settings.get('memorial.netlify_url',''),'configured':bool(token and settings.get('memorial.netlify_url')),
            'has_token':bool(token)}


def set_memorial_config(url=None,token=None,generate=False,root=ROOT):
    root=Path(root)
    if url is not None:
        parsed=urlparse(str(url).strip().rstrip('/'))
        if parsed.scheme!='https' or not parsed.hostname or not parsed.hostname.endswith('.netlify.app') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
            raise ValueError('请输入完整的 Netlify HTTPS 站点地址，例如 https://your-site.netlify.app')
        pc.set_settings({'memorial.netlify_url':parsed.geturl().rstrip('/')},root)
    issued=''
    if generate:
        issued=secrets.token_urlsafe(32)
        set_secret('memorial.publish_token',issued,root)
    elif token is not None:
        if len(str(token))<32:raise ValueError('发布密钥至少需要 32 个字符')
        set_secret('memorial.publish_token',str(token),root)
    return {**memorial_config(root),'generated_token':issued}


def _memorial_auth(root):
    config=memorial_config(root)
    token=get_secret('memorial.publish_token','LIFEOS_MEMORIAL_PUBLISH_TOKEN',root)[0]
    if not config['url'] or not token:
        raise RuntimeError('请先填写 Netlify 网址，并生成发布密钥')
    return config['url'],token

def cloud_ai(messages,feature='mobile-ask',root=ROOT):
    base,token=_auth(Path(root));return _request('POST',base+'/v2/ai/generate',token,{'messages':messages,'feature':feature})
