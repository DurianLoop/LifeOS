#!/usr/bin/env python3
"""LifeOS P2 product services: Memory Inbox, notifications, connectors,
marketplace state, share records, subscription cache and mobile/cloud metadata.

The module intentionally keeps these product surfaces outside the 141 memory
lenses. They are workflow/infrastructure capabilities, not new observation
features.
"""
from __future__ import annotations
from pathlib import Path
import os
import datetime as dt, hashlib, json, re, uuid
from engine import product_core as pc

ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])

def utcnow(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def new_id(prefix): return f'{prefix}_{uuid.uuid4().hex}'

def migrate(root=ROOT):
    con=pc.connect(Path(root))
    try:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS memory_inbox(
          inbox_id TEXT PRIMARY KEY,item_type TEXT NOT NULL,title TEXT,body TEXT,source TEXT NOT NULL,
          source_ref TEXT,attachment_ids_json TEXT NOT NULL DEFAULT '[]',metadata_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',cloud_item_id TEXT,created_at TEXT NOT NULL,reviewed_at TEXT,converted_entry_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_status ON memory_inbox(status,created_at DESC);
        CREATE TABLE IF NOT EXISTS notification_preferences(
          profile_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,quiet_start TEXT,quiet_end TEXT,
          kinds_json TEXT NOT NULL DEFAULT '["old-letter","capsule","memory-echo"]',updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notifications(
          notification_id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT,target_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'unread',scheduled_at TEXT,created_at TEXT NOT NULL,read_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status,created_at DESC);
        CREATE TABLE IF NOT EXISTS connector_configs(
          connector_id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,config_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'disabled',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_sync_at TEXT
        );
        CREATE TABLE IF NOT EXISTS connector_runs(
          run_id TEXT PRIMARY KEY,connector_id TEXT NOT NULL,status TEXT NOT NULL,stats_json TEXT NOT NULL DEFAULT '{}',
          error TEXT,started_at TEXT NOT NULL,finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS addon_installs(
          addon_id TEXT NOT NULL,addon_type TEXT NOT NULL,version TEXT NOT NULL,source TEXT NOT NULL,
          manifest_json TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,installed_at TEXT NOT NULL,
          PRIMARY KEY(addon_id,addon_type)
        );
        CREATE TABLE IF NOT EXISTS share_records(
          share_id TEXT PRIMARY KEY,entry_id TEXT,revision_id TEXT,remote_share_id TEXT,url TEXT,title TEXT,
          status TEXT NOT NULL DEFAULT 'active',expires_at TEXT,created_at TEXT NOT NULL,revoked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS subscription_cache(
          profile_id TEXT PRIMARY KEY,plan TEXT NOT NULL DEFAULT 'free',status TEXT NOT NULL DEFAULT 'active',
          entitlements_json TEXT NOT NULL DEFAULT '{}',provider TEXT NOT NULL DEFAULT 'none',updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS p2_sync_state(
          scope TEXT PRIMARY KEY,last_seq INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL
        );
        ''')
        now=utcnow();con.execute("INSERT OR IGNORE INTO notification_preferences(profile_id,updated_at) VALUES('default',?)",(now,))
        con.execute("INSERT OR IGNORE INTO subscription_cache(profile_id,updated_at) VALUES('default',?)",(now,))
        con.execute("INSERT OR IGNORE INTO p2_sync_state(scope,last_seq,updated_at) VALUES('inbox',0,?)",(now,))
        con.execute("INSERT OR IGNORE INTO p2_sync_state(scope,last_seq,updated_at) VALUES('notifications',0,?)",(now,))
        con.commit()
    finally: con.close()
    return {'ok':True,'schema':'p2'}

def add_inbox_item(item_type='text',title='',body='',source='local',source_ref='',attachments=None,metadata=None,cloud_item_id=None,root=ROOT):
    migrate(root);con=pc.connect(Path(root));iid=new_id('inbox');now=utcnow()
    try:
        if cloud_item_id:
            old=con.execute('SELECT * FROM memory_inbox WHERE cloud_item_id=?',(cloud_item_id,)).fetchone()
            if old:return dict(old)
        con.execute('INSERT INTO memory_inbox(inbox_id,item_type,title,body,source,source_ref,attachment_ids_json,metadata_json,status,cloud_item_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          (iid,item_type or 'text',title or '',body or '',source or 'local',source_ref or '',json.dumps(attachments or [],ensure_ascii=False),json.dumps(metadata or {},ensure_ascii=False),'pending',cloud_item_id,now));con.commit()
        return get_inbox_item(iid,root)
    finally:con.close()

def get_inbox_item(inbox_id,root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:r=con.execute('SELECT * FROM memory_inbox WHERE inbox_id=?',(inbox_id,)).fetchone();return _decode_inbox(r) if r else None
    finally:con.close()

def _decode_inbox(r):
    d=dict(r);d['attachment_ids']=json.loads(d.pop('attachment_ids_json') or '[]');d['metadata']=json.loads(d.pop('metadata_json') or '{}');return d

def list_inbox(status='pending',limit=200,root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:
        sql='SELECT * FROM memory_inbox';args=[]
        if status:sql+=' WHERE status=?';args.append(status)
        sql+=' ORDER BY created_at DESC LIMIT ?';args.append(int(limit))
        return [_decode_inbox(r) for r in con.execute(sql,args)]
    finally:con.close()

def update_inbox_status(inbox_id,status,converted_entry_id=None,root=ROOT):
    if status not in ('pending','accepted','dismissed','archived'):raise ValueError('invalid inbox status')
    migrate(root);con=pc.connect(Path(root));now=utcnow()
    try:con.execute('UPDATE memory_inbox SET status=?,reviewed_at=?,converted_entry_id=COALESCE(?,converted_entry_id) WHERE inbox_id=?',(status,now,converted_entry_id,inbox_id));con.commit();return get_inbox_item(inbox_id,root)
    finally:con.close()

def convert_inbox_to_entry(inbox_id,journal_date=None,title=None,root=ROOT):
    item=get_inbox_item(inbox_id,root)
    if not item:raise ValueError('inbox item not found')
    date=journal_date or (item.get('metadata') or {}).get('journal_date') or dt.date.today().isoformat()
    body=item.get('body') or ''
    if item['item_type'] in ('photo','voice') and not body:
        body='（来自 '+('照片' if item['item_type']=='photo' else '语音')+'记忆收件箱；原始附件保留在收件箱记录中。）'
    sections={'日程':'','日记':body,'自我探索':'','心得与摘录':'','体系构建':'','习惯打卡':''}
    out=pc.save_entry(journal_date=date,sections=sections,title=title if title is not None else item.get('title') or '',tags=['memory-inbox',item['item_type']],source='memory-inbox',note=f"converted from {inbox_id}",root=Path(root))
    attached=[];meta=item.get('metadata') or {}
    if meta.get('data_base64'):
        import base64
        try:
            data=base64.b64decode(meta.get('data_base64') or '')
            if data:
                attached.append(pc.add_attachment(out['entry_id'],meta.get('name') or ('capture.'+('jpg' if item['item_type']=='photo' else 'webm')),data,meta.get('mime_type') or ('image/jpeg' if item['item_type']=='photo' else 'audio/webm'),out.get('revision_id'),Path(root)))
        except Exception: pass
    update_inbox_status(inbox_id,'accepted',out['entry_id'],root)
    return {'entry':out,'attachments':attached,'inbox':get_inbox_item(inbox_id,root)}

def notification_preferences(root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:r=con.execute("SELECT * FROM notification_preferences WHERE profile_id='default'").fetchone();d=dict(r);d['enabled']=bool(d['enabled']);d['kinds']=json.loads(d.pop('kinds_json') or '[]');return d
    finally:con.close()

def set_notification_preferences(enabled=True,quiet_start=None,quiet_end=None,kinds=None,root=ROOT):
    migrate(root);con=pc.connect(Path(root));now=utcnow()
    try:con.execute("INSERT INTO notification_preferences(profile_id,enabled,quiet_start,quiet_end,kinds_json,updated_at) VALUES('default',?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET enabled=excluded.enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,kinds_json=excluded.kinds_json,updated_at=excluded.updated_at",(1 if enabled else 0,quiet_start,quiet_end,json.dumps(kinds or ['old-letter','capsule','memory-echo'],ensure_ascii=False),now));con.commit();return notification_preferences(root)
    finally:con.close()

def add_notification(kind,title,body='',target=None,scheduled_at=None,root=ROOT,notification_id=None):
    migrate(root);con=pc.connect(Path(root));nid=notification_id or new_id('note');now=utcnow()
    try:con.execute('INSERT OR IGNORE INTO notifications(notification_id,kind,title,body,target_json,status,scheduled_at,created_at) VALUES(?,?,?,?,?,?,?,?)',(nid,kind,title,body,json.dumps(target or {},ensure_ascii=False),'unread',scheduled_at,now));con.commit();return nid
    finally:con.close()

def list_notifications(status=None,limit=100,root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:
        sql='SELECT * FROM notifications';args=[]
        if status:sql+=' WHERE status=?';args.append(status)
        sql+=' ORDER BY created_at DESC LIMIT ?';args.append(int(limit));out=[]
        for r in con.execute(sql,args):d=dict(r);d['target']=json.loads(d.pop('target_json') or '{}');out.append(d)
        return out
    finally:con.close()

def mark_notification(notification_id,status='read',root=ROOT):
    migrate(root);con=pc.connect(Path(root));now=utcnow()
    try:con.execute('UPDATE notifications SET status=?,read_at=? WHERE notification_id=?',(status,now if status=='read' else None,notification_id));con.commit();return {'ok':True}
    finally:con.close()

def install_addon(manifest:dict,addon_type:str,source='local',root=ROOT):
    migrate(root);aid=str(manifest.get('id') or '').strip();ver=str(manifest.get('version') or '0.0.0')
    if addon_type not in ('importer','pet','connector'):raise ValueError('unsupported addon type')
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,80}',aid):raise ValueError('invalid addon id')
    # P2 marketplace intentionally installs data/manifest packages only. Arbitrary
    # executable code is not auto-loaded from the marketplace.
    denied={'exec','shell','python_entry','node_entry','postinstall'}
    if denied.intersection(manifest):raise ValueError('executable addon manifests are not accepted')
    con=pc.connect(Path(root));now=utcnow()
    try:con.execute('INSERT INTO addon_installs(addon_id,addon_type,version,source,manifest_json,enabled,installed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(addon_id,addon_type) DO UPDATE SET version=excluded.version,source=excluded.source,manifest_json=excluded.manifest_json,enabled=1,installed_at=excluded.installed_at',(aid,addon_type,ver,source,json.dumps(manifest,ensure_ascii=False),1,now));con.commit();return {'ok':True,'id':aid,'type':addon_type,'version':ver}
    finally:con.close()

def list_addons(root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:
        out=[]
        for r in con.execute('SELECT * FROM addon_installs ORDER BY addon_type,addon_id'):
            d=dict(r);d['manifest']=json.loads(d.pop('manifest_json') or '{}');d['enabled']=bool(d['enabled']);out.append(d)
        return out
    finally:con.close()

def save_share_record(remote:dict,entry_id=None,revision_id=None,root=ROOT):
    migrate(root);con=pc.connect(Path(root));sid=remote.get('share_id') or new_id('share');now=utcnow()
    try:con.execute('INSERT OR REPLACE INTO share_records(share_id,entry_id,revision_id,remote_share_id,url,title,status,expires_at,created_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(sid,entry_id,revision_id,remote.get('share_id'),remote.get('url'),remote.get('title') or '',remote.get('status') or 'active',remote.get('expires_at'),remote.get('created_at') or now,remote.get('revoked_at')));con.commit();return sid
    finally:con.close()

def list_shares(root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:return [dict(r) for r in con.execute('SELECT * FROM share_records ORDER BY created_at DESC')]
    finally:con.close()

def set_subscription(plan,status,entitlements,provider='cloud',root=ROOT):
    migrate(root);con=pc.connect(Path(root));now=utcnow()
    try:con.execute("INSERT INTO subscription_cache(profile_id,plan,status,entitlements_json,provider,updated_at) VALUES('default',?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET plan=excluded.plan,status=excluded.status,entitlements_json=excluded.entitlements_json,provider=excluded.provider,updated_at=excluded.updated_at",(plan,status,json.dumps(entitlements or {},ensure_ascii=False),provider,now));con.commit();return subscription(root)
    finally:con.close()

def subscription(root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:r=con.execute("SELECT * FROM subscription_cache WHERE profile_id='default'").fetchone();d=dict(r);d['entitlements']=json.loads(d.pop('entitlements_json') or '{}');return d
    finally:con.close()

def sync_seq(scope,root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:r=con.execute('SELECT last_seq FROM p2_sync_state WHERE scope=?',(scope,)).fetchone();return int(r[0]) if r else 0
    finally:con.close()

def set_sync_seq(scope,seq,root=ROOT):
    migrate(root);con=pc.connect(Path(root));now=utcnow()
    try:con.execute('INSERT INTO p2_sync_state(scope,last_seq,updated_at) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET last_seq=excluded.last_seq,updated_at=excluded.updated_at',(scope,int(seq),now));con.commit()
    finally:con.close()

def status(root=ROOT):
    migrate(root);con=pc.connect(Path(root))
    try:
        return {
          'inbox_pending':con.execute("SELECT COUNT(*) FROM memory_inbox WHERE status='pending'").fetchone()[0],
          'notifications_unread':con.execute("SELECT COUNT(*) FROM notifications WHERE status='unread'").fetchone()[0],
          'addons':con.execute('SELECT COUNT(*) FROM addon_installs WHERE enabled=1').fetchone()[0],
          'shares_active':con.execute("SELECT COUNT(*) FROM share_records WHERE status='active'").fetchone()[0],
          'subscription':subscription(root),
        }
    finally:con.close()
