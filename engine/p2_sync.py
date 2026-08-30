#!/usr/bin/env python3
"""P2 cloud companion sync: Memory Inbox, notifications, sharing and profile state."""
from __future__ import annotations
from pathlib import Path
from engine import product_core as pc
from engine import p2_core
from engine.sync_engine import _request, sync_token, status as sync_status
ROOT=Path(__file__).resolve().parents[1]

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

def cloud_ai(messages,feature='mobile-ask',root=ROOT):
    base,token=_auth(Path(root));return _request('POST',base+'/v2/ai/generate',token,{'messages':messages,'feature':feature})
