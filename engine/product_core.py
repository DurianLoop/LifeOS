#!/usr/bin/env python3
"""LifeOS product metadata core.

The raw Vault remains human-readable source material. ``data/lifeos.db`` remains a
throw-away derived index. Product identity/history/sync metadata lives in the
separate ``.lifeos/core.db`` so a full Memory Engine rebuild never destroys
stable entry IDs or revision history.
"""
from __future__ import annotations
from pathlib import Path
import base64, csv, datetime as dt, hashlib, io, json, mimetypes, os, re, shutil, sqlite3, tempfile, threading, uuid, zipfile

ROOT = Path(__file__).resolve().parents[1]
LIFE = ROOT / '.lifeos'
CORE_DB = LIFE / 'core.db'
VAULT = ROOT / 'vault'
REV_DIR = LIFE / 'revisions'
IMPORT_DIR = LIFE / 'imports'
ATTACH_DIR = LIFE / 'attachments'
BACKUP_DIR = LIFE / 'backups'
_LOCK = threading.RLock()

DEFAULT_SETTINGS = {
    'product.schema_version': '9',
    'refresh.background_enabled': 'true',
    'refresh.debounce_ms': '700',
    'product.mode': 'local-first',
    'writer.autosave': 'true',
    'writer.default_timezone': '',
    'writer.default_template': 'blank',
    'ui.locale': 'zh-CN',
    # Poetry is the default surface; bilingual and English remain explicit
    # alternatives. Existing settings are never overwritten here.
    'ui.copy_mode': 'poetic',
    'ui.language_preset': 'poetic',
    'import.keep_originals': 'true',
    'backup.auto_before_import': 'true',
    'backup.auto_before_restore': 'true',
    'ai.enabled': 'true',
    'ai.allow_remote': 'true',
    'ai.payload_preview': 'true',
    'ai.cache': 'true',
    'ai.provider': 'deepseek',
    'ai.model': 'deepseek-v4-flash',
    'ai.base_url': 'https://api.deepseek.com',
    'pet.allow_content': 'false',
    'sync.enabled': 'false',
    'sync.url': '',
    'sync.last_pull_seq': '0',
    'sync.last_push_at': '',
    'privacy.telemetry': 'false',
    'notifications.enabled': 'true',
    'mobile.capture_to_inbox': 'true',
    'ai.mode': 'byok',
    'encryption.sync_enabled': 'false',
    'encryption.recovery_exported': 'false',
    'marketplace.allow_unsigned_local': 'false',
}

FEATURE_STRATEGIES = {
    'Home':'immediate','Journal':'immediate','Timeline':'immediate','On This Day':'immediate',
    'Universal Search':'index','Deep Read':'index','Quotes':'index','People':'index','Life Map':'index',
    'Memory Graph':'derived','Ideas':'index','Projects':'index','Questions':'index','Achievements':'index',
    'Ask My Life':'ai','Past Me':'ai','Roundtable':'ai','Future Me':'ai','Contradictions':'ai',
    'Year in Review':'derived','Memory Echoes':'derived','Hidden Chapters':'derived','Serendipity':'derived',
    'Memory Weather':'derived','Forgotten Doors':'derived','Skill Momentum':'derived','Thought → Artifact':'derived',
    '文言化':'ai',
}


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')

def sha_text(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"

def ensure_dirs(root: Path = ROOT) -> None:
    life = root / '.lifeos'
    for p in (life, life/'revisions', life/'imports', life/'attachments', life/'backups'):
        p.mkdir(parents=True, exist_ok=True)

def db_path(root: Path = ROOT) -> Path:
    return root / '.lifeos' / 'core.db'

def connect(root: Path = ROOT) -> sqlite3.Connection:
    ensure_dirs(root)
    con = sqlite3.connect(db_path(root), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA journal_mode=WAL')
    migrate(con)
    return con

def migrate(con: sqlite3.Connection) -> None:
    con.executescript('''
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries(
      entry_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'daily',
      journal_date TEXT,
      timezone TEXT,
      title TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_path TEXT NOT NULL UNIQUE,
      source_format TEXT NOT NULL DEFAULT 'markdown',
      source_ref TEXT,
      current_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(journal_date DESC);
    CREATE TABLE IF NOT EXISTS revisions(
      revision_id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(entry_id) ON DELETE CASCADE,
      parent_revision_id TEXT,
      content_hash TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      revision_file TEXT NOT NULL,
      source TEXT NOT NULL,
      note TEXT,
      base_revision_id TEXT,
      device_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revisions_entry ON revisions(entry_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS attachments(
      attachment_id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(entry_id) ON DELETE CASCADE,
      revision_id TEXT,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      bytes INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS import_jobs(
      job_id TEXT PRIMARY KEY,
      importer TEXT,
      status TEXT NOT NULL,
      source_name TEXT,
      stats_json TEXT NOT NULL DEFAULT '{}',
      snapshot_dir TEXT,
      created_at TEXT NOT NULL,
      committed_at TEXT,
      rolled_back_at TEXT
    );
    CREATE TABLE IF NOT EXISTS import_items(
      item_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES import_jobs(job_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      source_format TEXT,
      journal_date TEXT,
      title TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      action TEXT NOT NULL,
      target_entry_id TEXT,
      target_source_path TEXT,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS feature_dependencies(
      feature_id TEXT PRIMARY KEY,
      strategy TEXT NOT NULL,
      depends_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS feature_state(
      feature_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'fresh',
      dirty_since TEXT,
      last_refresh_at TEXT,
      reason TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_artifacts(
      artifact_id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      prompt_version TEXT,
      content_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'fresh',
      generated_at TEXT NOT NULL,
      stale_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_artifact_inputs(
      artifact_id TEXT NOT NULL REFERENCES ai_artifacts(artifact_id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      PRIMARY KEY(artifact_id,entry_id,revision_id)
    );
    CREATE TABLE IF NOT EXISTS ai_cache(
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_requests(
      request_id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      input_hash TEXT,
      input_chars INTEGER NOT NULL DEFAULT 0,
      output_chars INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      sent_remote INTEGER NOT NULL DEFAULT 0,
      elapsed_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifact_inputs_entry ON ai_artifact_inputs(entry_id);
    CREATE TABLE IF NOT EXISTS devices(
      device_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_operations(
      local_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      entry_id TEXT NOT NULL,
      revision_id TEXT,
      base_revision_id TEXT,
      op_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      device_id TEXT,
      remote_seq INTEGER,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_conflicts(
      conflict_id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      local_revision_id TEXT,
      remote_revision_id TEXT,
      base_revision_id TEXT,
      remote_payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS backups(
      backup_id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      reason TEXT,
      bytes INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embedding_jobs(
      job_id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS entry_embeddings(
      entry_id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refresh_state(
      scope TEXT PRIMARY KEY,
      requested_generation INTEGER NOT NULL DEFAULT 0,
      completed_generation INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      reason TEXT,
      requested_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      last_duration_ms INTEGER,
      error TEXT
    );
    ''')
    # Core IX v5: revisions are truly append-only. Reverting to an older content
    # hash is itself a new historical event, so content hashes must not be unique.
    rev_sql=(con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='revisions'").fetchone() or [''])[0] or ''
    if 'UNIQUE(entry_id,content_hash)' in rev_sql.replace(' ', '') or 'UNIQUE(entry_id, content_hash)' in rev_sql:
        con.execute('PRAGMA foreign_keys=OFF')
        con.executescript('''
        ALTER TABLE revisions RENAME TO revisions_v4_old;
        CREATE TABLE revisions(
          revision_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(entry_id) ON DELETE CASCADE,
          parent_revision_id TEXT, content_hash TEXT NOT NULL, bytes INTEGER NOT NULL, revision_file TEXT NOT NULL,
          source TEXT NOT NULL, note TEXT, base_revision_id TEXT, device_id TEXT, created_at TEXT NOT NULL
        );
        INSERT INTO revisions SELECT revision_id,entry_id,parent_revision_id,content_hash,bytes,revision_file,source,note,base_revision_id,device_id,created_at FROM revisions_v4_old;
        DROP TABLE revisions_v4_old;
        CREATE INDEX IF NOT EXISTS idx_revisions_entry ON revisions(entry_id,created_at DESC);
        ''')
        con.execute('PRAGMA foreign_keys=ON')
    now = utcnow()
    for k,v in DEFAULT_SETTINGS.items():
        con.execute('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)',(k,v,now))
    con.execute("INSERT INTO settings(key,value,updated_at) VALUES('product.schema_version','9',?) ON CONFLICT(key) DO UPDATE SET value='9',updated_at=excluded.updated_at",(now,))
    con.execute("INSERT OR IGNORE INTO refresh_state(scope,status) VALUES('derived-corpus','idle')")
    con.commit()


def get_setting(key: str, default=None, root: Path = ROOT):
    con=connect(root)
    try:
        r=con.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
        return r[0] if r else default
    finally: con.close()

def set_settings(items: dict, root: Path = ROOT):
    con=connect(root); now=utcnow()
    try:
        for k,v in items.items():
            if isinstance(v,bool): v='true' if v else 'false'
            elif not isinstance(v,str): v=json.dumps(v,ensure_ascii=False)
            con.execute('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',(k,v,now))
        con.commit()
    finally: con.close()

def settings_dict(root: Path = ROOT) -> dict:
    con=connect(root)
    try: return {r['key']:r['value'] for r in con.execute('SELECT key,value FROM settings')}
    finally: con.close()


def detect_kind_date(rel: str):
    rel=rel.replace('\\','/')
    m=re.search(r'memories/daily/(\d{4})/(\d{4}-\d{2}-\d{2})\.md$',rel)
    if m: return 'daily',m.group(2)
    m=re.search(r'memories/weekly/(\d{4})/(\d{4})_(\d{1,2})\.md$',rel)
    if m: return 'weekly',None
    m=re.search(r'(20\d{2}-\d{2}-\d{2})',Path(rel).stem)
    return 'daily',m.group(1) if m else None

def extract_frontmatter(text: str):
    meta={}
    if not text.startswith('---\n'): return meta
    end=text.find('\n---\n',4)
    if end<0: return meta
    for line in text[4:end].splitlines():
        if ':' not in line: continue
        k,v=line.split(':',1); k=k.strip(); v=v.strip()
        if k=='tags':
            if v.startswith('[') and v.endswith(']'):
                meta[k]=[x.strip().strip('"\'') for x in v[1:-1].split(',') if x.strip()]
            else: meta[k]=[x.strip() for x in v.split(',') if x.strip()]
        else: meta[k]=v.strip('"\'')
    return meta

def revision_path(root: Path, entry_id: str, revision_id: str) -> Path:
    return root/'.lifeos'/'revisions'/entry_id/f'{revision_id}.md'

def _write_revision_file(root: Path, entry_id: str, revision_id: str, text: str) -> str:
    p=revision_path(root,entry_id,revision_id); p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(text,encoding='utf-8')
    return str(p.relative_to(root)).replace('\\','/')

def _device_id(con: sqlite3.Connection) -> str:
    r=con.execute("SELECT value FROM settings WHERE key='device.id'").fetchone()
    if r: return r[0]
    did='dev_'+uuid.uuid4().hex
    name=os.environ.get('COMPUTERNAME') or os.environ.get('HOSTNAME') or 'LifeOS device'
    now=utcnow()
    con.execute('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)',('device.id',did,now))
    con.execute('INSERT OR IGNORE INTO devices(device_id,name,platform,created_at,last_seen_at) VALUES(?,?,?,?,?)',(did,name,os.name,now,now))
    return did

def seed_feature_dependencies(feature_names=None, root: Path = ROOT):
    if feature_names is None:
        baseline=root/'config'/'features_141_baseline.json'
        try:
            data=json.loads(baseline.read_text(encoding='utf-8'))
            if isinstance(data,list):
                feature_names=[x.get('name') if isinstance(x,dict) else x for x in data]
            elif isinstance(data,dict): feature_names=list(data)
        except Exception: feature_names=[]
    con=connect(root)
    try:
        for name in [x for x in feature_names if x]:
            strategy=FEATURE_STRATEGIES.get(name,'derived')
            deps={'immediate':['entry.content','entry.metadata'],'index':['memory_index'],'derived':['memory_index','corpus'],'ai':['memory_index','ai_provider']}.get(strategy,['memory_index'])
            con.execute('INSERT OR REPLACE INTO feature_dependencies(feature_id,strategy,depends_json) VALUES(?,?,?)',(name,strategy,json.dumps(deps,ensure_ascii=False)))
            con.execute('INSERT OR IGNORE INTO feature_state(feature_id,status,last_refresh_at) VALUES(?,?,?)',(name,'fresh',utcnow()))
        con.commit()
    finally: con.close()

def mark_features_dirty(reason: str, root: Path = ROOT, entry_id: str|None=None):
    con=connect(root); now=utcnow()
    try:
        for r in con.execute('SELECT feature_id,strategy FROM feature_dependencies'):
            status='stale' if r['strategy']=='ai' else 'dirty'
            con.execute('INSERT INTO feature_state(feature_id,status,dirty_since,reason) VALUES(?,?,?,?) ON CONFLICT(feature_id) DO UPDATE SET status=excluded.status,dirty_since=excluded.dirty_since,reason=excluded.reason',(r['feature_id'],status,now,reason))
        if entry_id:
            arts=[x[0] for x in con.execute('SELECT DISTINCT artifact_id FROM ai_artifact_inputs WHERE entry_id=?',(entry_id,))]
            for aid in arts: con.execute("UPDATE ai_artifacts SET status='stale',stale_at=? WHERE artifact_id=?",(now,aid))
        con.commit()
    finally: con.close()

def mark_base_fresh(root: Path = ROOT):
    """Mark only the fast, source/index-backed lenses fresh.

    Corpus-wide relational lenses intentionally stay dirty until the lazy refresh
    worker publishes a generation that includes the latest base index. AI lenses
    remain stale until explicitly regenerated.
    """
    con=connect(root); now=utcnow()
    try:
        con.execute("""UPDATE feature_state SET status='fresh',dirty_since=NULL,last_refresh_at=?,reason=NULL
                       WHERE feature_id IN (SELECT feature_id FROM feature_dependencies WHERE strategy IN ('immediate','index'))""",(now,))
        con.commit()
    finally: con.close()

def mark_derived_fresh(root: Path = ROOT):
    con=connect(root); now=utcnow()
    try:
        con.execute("""UPDATE feature_state SET status='fresh',dirty_since=NULL,last_refresh_at=?,reason=NULL
                       WHERE feature_id IN (SELECT feature_id FROM feature_dependencies WHERE strategy='derived')""",(now,))
        con.commit()
    finally: con.close()

def mark_deterministic_fresh(root: Path = ROOT):
    # Compatibility helper used by older scripts/full rebuilds.
    mark_base_fresh(root); mark_derived_fresh(root)

def request_derived_refresh(reason: str, root: Path = ROOT):
    """Coalesce corpus refreshes by generation. Safe to call after every edit."""
    con=connect(root); now=utcnow()
    try:
        con.execute('BEGIN IMMEDIATE')
        r=con.execute("SELECT * FROM refresh_state WHERE scope='derived-corpus'").fetchone()
        if not r:
            con.execute("INSERT INTO refresh_state(scope,status) VALUES('derived-corpus','idle')")
            r=con.execute("SELECT * FROM refresh_state WHERE scope='derived-corpus'").fetchone()
        gen=int(r['requested_generation'] or 0)+1
        status='running' if r['status']=='running' else 'queued'
        con.execute("""UPDATE refresh_state SET requested_generation=?,status=?,reason=?,requested_at=?,error=NULL
                       WHERE scope='derived-corpus'""",(gen,status,reason,now))
        # Derived lenses stay explicitly dirty while queued/running.
        con.execute("""UPDATE feature_state SET status='dirty',dirty_since=COALESCE(dirty_since,?),reason=?
                       WHERE feature_id IN (SELECT feature_id FROM feature_dependencies WHERE strategy='derived')""",(now,reason))
        con.commit()
        return derived_refresh_status(root)
    except Exception:
        con.rollback(); raise
    finally: con.close()

def derived_refresh_status(root: Path = ROOT):
    con=connect(root)
    try:
        r=con.execute("SELECT * FROM refresh_state WHERE scope='derived-corpus'").fetchone()
        if not r: return {'scope':'derived-corpus','status':'idle','requested_generation':0,'completed_generation':0,'pending_generations':0}
        d=dict(r); d['pending_generations']=max(0,int(d.get('requested_generation') or 0)-int(d.get('completed_generation') or 0))
        return d
    finally: con.close()

def recover_refresh_state(root: Path = ROOT):
    """A process restart must never leave a generation permanently `running`."""
    con=connect(root)
    try:
        r=con.execute("SELECT * FROM refresh_state WHERE scope='derived-corpus'").fetchone()
        if r and r['status']=='running':
            status='queued' if int(r['requested_generation'] or 0)>int(r['completed_generation'] or 0) else 'idle'
            con.execute("UPDATE refresh_state SET status=?,started_at=NULL,error='worker restarted before completion' WHERE scope='derived-corpus'",(status,));con.commit()
        return derived_refresh_status(root)
    finally: con.close()

def claim_derived_refresh(root: Path = ROOT):
    con=connect(root); now=utcnow()
    try:
        con.execute('BEGIN IMMEDIATE')
        r=con.execute("SELECT * FROM refresh_state WHERE scope='derived-corpus'").fetchone()
        if not r or r['status']=='running' or int(r['requested_generation'] or 0)<=int(r['completed_generation'] or 0):
            con.rollback(); return None
        target=int(r['requested_generation'])
        con.execute("UPDATE refresh_state SET status='running',started_at=?,error=NULL WHERE scope='derived-corpus'",(now,));con.commit()
        return {'target_generation':target,'reason':r['reason'],'requested_at':r['requested_at']}
    except Exception:
        con.rollback(); raise
    finally: con.close()

def complete_derived_refresh(target_generation: int, *, root: Path = ROOT, error: str|None=None, duration_ms: int|None=None, superseded=False):
    con=connect(root); now=utcnow()
    try:
        con.execute('BEGIN IMMEDIATE')
        r=con.execute("SELECT * FROM refresh_state WHERE scope='derived-corpus'").fetchone()
        requested=int(r['requested_generation'] or 0) if r else int(target_generation)
        completed=int(r['completed_generation'] or 0) if r else 0
        if error:
            status='queued' if requested>completed else 'failed'
            con.execute("""UPDATE refresh_state SET status=?,finished_at=?,last_duration_ms=?,error=?
                           WHERE scope='derived-corpus'""",(status,now,duration_ms,error[:2000]))
        elif superseded:
            # The worker built an older snapshot. It is deliberately discarded.
            con.execute("""UPDATE refresh_state SET status='queued',finished_at=?,last_duration_ms=?,error=NULL
                           WHERE scope='derived-corpus'""",(now,duration_ms))
        else:
            completed=max(completed,int(target_generation))
            status='queued' if requested>completed else 'fresh'
            con.execute("""UPDATE refresh_state SET completed_generation=?,status=?,finished_at=?,last_duration_ms=?,error=NULL
                           WHERE scope='derived-corpus'""",(completed,status,now,duration_ms))
        con.commit()
    except Exception:
        con.rollback(); raise
    finally: con.close()
    st=derived_refresh_status(root)
    if not error and not superseded and st['status']=='fresh': mark_derived_fresh(root)
    return st


def bootstrap_existing(root: Path = ROOT, copy_revision_files=True) -> dict:
    """Register Vault files without rewriting them. Safe to run repeatedly."""
    ensure_dirs(root); con=connect(root); created=0; updated=0; unchanged=0
    try:
        _device_id(con)
        paths=sorted((root/'vault').glob('memories/daily/*/*.md'))+sorted((root/'vault').glob('memories/weekly/*/*.md'))
        for p in paths:
            rel=str(p.relative_to(root/'vault')).replace('\\','/')
            text=p.read_text(encoding='utf-8'); h=sha_text(text); kind,jdate=detect_kind_date(rel); fm=extract_frontmatter(text)
            r=con.execute('SELECT * FROM entries WHERE source_path=?',(rel,)).fetchone()
            if not r:
                eid=fm.get('lifeos_entry_id') or new_id('entry'); now=utcnow(); rid=new_id('rev')
                revfile=_write_revision_file(root,eid,rid,text) if copy_revision_files else rel
                con.execute('INSERT INTO entries(entry_id,kind,journal_date,timezone,title,tags_json,source_path,source_format,current_revision_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,kind,jdate,fm.get('timezone'),fm.get('title'),json.dumps(fm.get('tags',[]),ensure_ascii=False),rel,'markdown',rid,now,now))
                con.execute('INSERT INTO revisions(revision_id,entry_id,content_hash,bytes,revision_file,source,device_id,created_at) VALUES(?,?,?,?,?,?,?,?)',(rid,eid,h,len(text.encode('utf-8')),revfile,'bootstrap',_device_id(con),now)); created+=1
            else:
                cur=con.execute('SELECT content_hash FROM revisions WHERE revision_id=?',(r['current_revision_id'],)).fetchone()
                if cur and cur[0]==h: unchanged+=1; continue
                rid=new_id('rev'); now=utcnow(); revfile=_write_revision_file(root,r['entry_id'],rid,text)
                con.execute('INSERT INTO revisions(revision_id,entry_id,parent_revision_id,content_hash,bytes,revision_file,source,base_revision_id,device_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(rid,r['entry_id'],r['current_revision_id'],h,len(text.encode('utf-8')),revfile,'external',r['current_revision_id'],_device_id(con),now))
                con.execute('UPDATE entries SET current_revision_id=?,journal_date=?,updated_at=?,deleted_at=NULL WHERE entry_id=?',(rid,jdate,now,r['entry_id'])); updated+=1
                mark_stale_in_connection(con,r['entry_id'],f'external change: {rel}')
        con.commit()
    finally: con.close()
    seed_feature_dependencies(root=root)
    return {'created':created,'updated':updated,'unchanged':unchanged,'total':created+updated+unchanged}

def mark_stale_in_connection(con,entry_id,reason):
    now=utcnow()
    for r in con.execute('SELECT feature_id,strategy FROM feature_dependencies'):
        status='stale' if r['strategy']=='ai' else 'dirty'
        con.execute('INSERT INTO feature_state(feature_id,status,dirty_since,reason) VALUES(?,?,?,?) ON CONFLICT(feature_id) DO UPDATE SET status=excluded.status,dirty_since=excluded.dirty_since,reason=excluded.reason',(r['feature_id'],status,now,reason))
    con.execute("UPDATE ai_artifacts SET status='stale',stale_at=? WHERE artifact_id IN (SELECT artifact_id FROM ai_artifact_inputs WHERE entry_id=?)",(now,entry_id))

def get_entry(entry_id=None, source_path=None, root: Path = ROOT):
    con=connect(root)
    try:
        if entry_id: r=con.execute('SELECT * FROM entries WHERE entry_id=?',(entry_id,)).fetchone()
        else: r=con.execute('SELECT * FROM entries WHERE source_path=?',(source_path,)).fetchone()
        if not r: return None
        d=dict(r); d['tags']=json.loads(d.pop('tags_json') or '[]')
        return d
    finally: con.close()

def list_entries(limit=1000, root: Path = ROOT):
    con=connect(root)
    try:
        out=[]
        for r in con.execute('SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY COALESCE(journal_date,updated_at) DESC LIMIT ?',(limit,)):
            d=dict(r);d['tags']=json.loads(d.pop('tags_json') or '[]');out.append(d)
        return out
    finally: con.close()

def export_entries(*, export_format: str='markdown', date_from: str='', date_to: str='', entry_ids=None,
                   include_attachments: bool=False, root: Path = ROOT):
    """Build a portable, current-version export without mutating the vault.

    The backup format is intentionally separate: an export is for reading or
    moving journals, while a backup remains the exact recovery mechanism.
    """
    export_format=(export_format or 'markdown').lower()
    if export_format not in {'markdown','json','csv'}:
        raise ValueError('export format must be markdown, json, or csv')
    for label, value in (('from',date_from),('to',date_to)):
        if value and not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',value):
            raise ValueError(f'export {label} date must be YYYY-MM-DD')
    selected={str(x) for x in (entry_ids or []) if str(x)}
    con=connect(root)
    try:
        where=['deleted_at IS NULL']; params=[]
        if date_from: where.append("COALESCE(journal_date,'')>=?");params.append(date_from)
        if date_to: where.append("COALESCE(journal_date,'')<=?");params.append(date_to)
        if selected:
            marks=','.join('?' for _ in selected);where.append(f'entry_id IN ({marks})');params.extend(sorted(selected))
        rows=list(con.execute('SELECT * FROM entries WHERE '+ ' AND '.join(where) +' ORDER BY COALESCE(journal_date,updated_at), entry_id',params))
        entries=[]
        for row in rows:
            e=dict(row); e['tags']=json.loads(e.pop('tags_json') or '[]')
            rev=con.execute('SELECT * FROM revisions WHERE revision_id=?',(e.get('current_revision_id'),)).fetchone()
            content=''
            if rev:
                rev=dict(rev); p=root/rev['revision_file'];content=p.read_text(encoding='utf-8') if p.exists() else ''
                e['revision']={k:rev.get(k) for k in ('revision_id','content_hash','bytes','created_at','source')}
            else: e['revision']=None
            e['content']=content
            e['attachments']=[dict(a) for a in con.execute('SELECT attachment_id,original_name,mime_type,bytes,content_hash,stored_path,created_at FROM attachments WHERE entry_id=? ORDER BY created_at',(e['entry_id'],))]
            entries.append(e)
    finally: con.close()
    stamp=dt.datetime.now().strftime('%Y%m%d')
    manifest={'format':'lifeos-portable-export-v1','created_at':utcnow(),'entry_count':len(entries),'date_from':date_from or None,'date_to':date_to or None,'attachments_included':bool(include_attachments)}
    if export_format=='json':
        public=[]
        for e in entries:
            public.append({k:e.get(k) for k in ('entry_id','kind','journal_date','timezone','title','source_path','source_format','created_at','updated_at','tags','revision','content','attachments')})
        return {'filename':f'LifeOS-日记导出-{stamp}.json','content_type':'application/json; charset=utf-8',
                'data':json.dumps({'manifest':manifest,'entries':public},ensure_ascii=False,indent=2).encode('utf-8'),'count':len(entries)}
    if export_format=='csv':
        out=io.StringIO(newline=''); writer=csv.writer(out);writer.writerow(['date','title','tags','entry_id','updated_at','markdown'])
        for e in entries: writer.writerow([e.get('journal_date') or '',e.get('title') or '',' | '.join(e.get('tags') or []),e.get('entry_id') or '',e.get('updated_at') or '',e.get('content') or ''])
        return {'filename':f'LifeOS-日记目录-{stamp}.csv','content_type':'text/csv; charset=utf-8',
                'data':('\ufeff'+out.getvalue()).encode('utf-8'),'count':len(entries)}
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('README.md', '# LifeOS 日记导出\n\n这是可直接阅读的 Markdown 副本。每一篇文件保留 LifeOS 元数据；它不是用于完整恢复版本历史的备份。\n')
        z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        used=set()
        for index,e in enumerate(entries,1):
            stem=re.sub(r'[^\w\- ]+','_',e.get('title') or '').strip()[:54] or '日记'
            base=f"{e.get('journal_date') or '未标日期'}-{stem}"
            name=base;serial=2
            while name in used: name=f'{base}-{serial}';serial+=1
            used.add(name); z.writestr(f'entries/{name}.md',e.get('content') or '')
            if include_attachments:
                for a in e.get('attachments') or []:
                    path=root/a['stored_path']
                    if path.exists() and path.is_file():
                        safe=re.sub(r'[^\w.\- ()\[\]]+','_',Path(a['original_name']).name) or a['attachment_id']
                        z.write(path,f'attachments/{name}/{safe}')
    return {'filename':f'LifeOS-日记-{stamp}.zip','content_type':'application/zip','data':buffer.getvalue(),'count':len(entries)}

def read_revision(revision_id: str, root: Path = ROOT):
    con=connect(root)
    try:
        r=con.execute('SELECT * FROM revisions WHERE revision_id=?',(revision_id,)).fetchone()
        if not r: return None
        p=root/r['revision_file']; d=dict(r); d['content']=p.read_text(encoding='utf-8') if p.exists() else ''
        return d
    finally: con.close()

def list_revisions(entry_id: str, root: Path = ROOT):
    con=connect(root)
    try: return [dict(r) for r in con.execute('SELECT * FROM revisions WHERE entry_id=? ORDER BY created_at DESC',(entry_id,))]
    finally: con.close()

def build_daily_markdown(entry_id: str, title: str, tags, timezone: str, sections: dict) -> str:
    # Frontmatter is optional metadata; the existing section parser ignores it.
    meta=['---',f'lifeos_entry_id: {entry_id}']
    if title: meta.append('title: '+title.replace('\n',' ').strip())
    if tags: meta.append('tags: ['+', '.join(str(x).replace(',', ' ') for x in tags)+']')
    if timezone: meta.append('timezone: '+timezone)
    meta+=['---','']
    order=['日程','日记','自我探索','心得与摘录','体系构建','习惯打卡']
    parts=[]
    for name in order:
        value=(sections or {}).get(name,'') or ''
        parts.append(f'### {name}\n{value.rstrip()}\n')
    for name,value in (sections or {}).items():
        if name not in order: parts.append(f'### {name}\n{(value or "").rstrip()}\n')
    return '\n'.join(meta+parts).rstrip()+'\n'

def _enqueue_sync(con,entry,revision,op_type='upsert'):
    payload={
        'entry':{k:entry.get(k) for k in ('entry_id','kind','journal_date','timezone','title','tags_json','source_path','source_format')},
        'revision':{k:revision.get(k) for k in ('revision_id','parent_revision_id','content_hash','source','created_at')},
        'content':revision.get('content','')
    }
    con.execute('INSERT INTO sync_operations(operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,created_at) VALUES(?,?,?,?,?,?,?,?)',(new_id('op'),entry['entry_id'],revision.get('revision_id'),revision.get('parent_revision_id'),op_type,json.dumps(payload,ensure_ascii=False),_device_id(con),utcnow()))

def save_entry(*, journal_date: str, sections: dict, entry_id: str|None=None, title: str='', tags=None, timezone: str='', source='writer', note='', root: Path = ROOT, raw_markdown: str|None=None, source_path: str|None=None, enqueue_sync=True):
    if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',journal_date or ''): raise ValueError('journal_date must be YYYY-MM-DD')
    tags=tags or []; con=connect(root)
    with _LOCK:
        try:
            existing=None
            if entry_id: existing=con.execute('SELECT * FROM entries WHERE entry_id=?',(entry_id,)).fetchone()
            if not existing:
                existing=con.execute("SELECT * FROM entries WHERE kind='daily' AND journal_date=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",(journal_date,)).fetchone()
            old_rel=existing['source_path'] if existing else None
            if existing:
                eid=existing['entry_id']; parent=existing['current_revision_id']
                if source_path:
                    rel=source_path
                elif existing['kind']=='daily' and existing['journal_date'] and existing['journal_date']!=journal_date and re.fullmatch(r'memories/daily/\d{4}/\d{4}-\d{2}-\d{2}\.md',existing['source_path'] or ''):
                    rel=f'memories/daily/{journal_date[:4]}/{journal_date}.md'
                else:
                    rel=existing['source_path']
            else:
                eid=entry_id or new_id('entry'); rel=source_path or f'memories/daily/{journal_date[:4]}/{journal_date}.md'; parent=None
            occupied=con.execute('SELECT entry_id FROM entries WHERE source_path=? AND entry_id<>? AND deleted_at IS NULL',(rel,eid)).fetchone()
            if occupied: raise ValueError(f'target journal path already belongs to another entry: {rel}')
            text=raw_markdown if raw_markdown is not None else build_daily_markdown(eid,title,tags,timezone,sections)
            h=sha_text(text)
            current=con.execute('SELECT content_hash FROM revisions WHERE revision_id=?',(parent,)).fetchone() if parent else None
            if current and current['content_hash']==h:
                rid=parent
                if old_rel!=rel:
                    target=root/'vault'/rel;target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_suffix(target.suffix+'.tmp');tmp.write_text(text,encoding='utf-8');os.replace(tmp,target)
                    oldp=root/'vault'/old_rel
                    if oldp.exists() and oldp!=target: oldp.unlink()
                con.execute('UPDATE entries SET journal_date=?,title=?,tags_json=?,timezone=?,source_path=?,current_revision_id=?,updated_at=?,deleted_at=NULL WHERE entry_id=?',(journal_date,title,json.dumps(tags,ensure_ascii=False),timezone,rel,rid,utcnow(),eid));con.commit()
                return {'entry_id':eid,'revision_id':rid,'source_path':rel,'old_source_path':old_rel if old_rel!=rel else None,'unchanged':True,'content_hash':h}
            now=utcnow(); rid=new_id('rev'); revfile=_write_revision_file(root,eid,rid,text)
            target=root/'vault'/rel; target.parent.mkdir(parents=True,exist_ok=True)
            # Atomic current-file replacement.
            tmp=target.with_suffix(target.suffix+'.tmp');tmp.write_text(text,encoding='utf-8');os.replace(tmp,target)
            if existing:
                con.execute('UPDATE entries SET kind=?,journal_date=?,timezone=?,title=?,tags_json=?,source_path=?,source_format=?,current_revision_id=?,updated_at=?,deleted_at=NULL WHERE entry_id=?',('daily',journal_date,timezone,title,json.dumps(tags,ensure_ascii=False),rel,'markdown',rid,now,eid))
            else:
                con.execute('INSERT INTO entries(entry_id,kind,journal_date,timezone,title,tags_json,source_path,source_format,current_revision_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,'daily',journal_date,timezone,title,json.dumps(tags,ensure_ascii=False),rel,'markdown',rid,now,now))
            con.execute('INSERT INTO revisions(revision_id,entry_id,parent_revision_id,content_hash,bytes,revision_file,source,note,base_revision_id,device_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,eid,parent,h,len(text.encode('utf-8')),revfile,source,note,parent,_device_id(con),now))
            mark_stale_in_connection(con,eid,f'{source}: {rel}')
            if enqueue_sync:
                er=dict(con.execute('SELECT * FROM entries WHERE entry_id=?',(eid,)).fetchone());rv=dict(con.execute('SELECT * FROM revisions WHERE revision_id=?',(rid,)).fetchone());rv['content']=text;_enqueue_sync(con,er,rv)
            con.commit()
            return {'entry_id':eid,'revision_id':rid,'source_path':rel,'old_source_path':old_rel if old_rel!=rel else None,'unchanged':False,'content_hash':h,'parent_revision_id':parent}
        except Exception:
            con.rollback(); raise
        finally: con.close()

def restore_revision(entry_id: str, revision_id: str, root: Path = ROOT):
    old=read_revision(revision_id,root)
    if not old or old['entry_id']!=entry_id: raise ValueError('revision not found for entry')
    e=get_entry(entry_id=entry_id,root=root)
    if not e: raise ValueError('entry not found')
    # restoring creates a NEW revision, preserving the whole history.
    return save_entry(journal_date=e['journal_date'],sections={},entry_id=entry_id,title=e.get('title') or '',tags=e.get('tags') or [],timezone=e.get('timezone') or '',raw_markdown=old['content'],source='restore',note=f"restored from {revision_id}",root=root)


def add_attachment(entry_id: str, name: str, data: bytes, mime_type=None, revision_id=None, root: Path = ROOT):
    e=get_entry(entry_id=entry_id,root=root)
    if not e: raise ValueError('entry not found')
    aid=new_id('att'); safe=re.sub(r'[^\w.\- ()\[\]]+','_',Path(name).name)[:120] or 'attachment'; rel=Path('.lifeos')/'attachments'/entry_id/f'{aid}_{safe}'; p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    con=connect(root)
    try:
        mime=mime_type or mimetypes.guess_type(name)[0] or 'application/octet-stream';created=utcnow();rid=revision_id or e['current_revision_id'];h=hashlib.sha256(data).hexdigest()
        con.execute('INSERT INTO attachments(attachment_id,entry_id,revision_id,original_name,mime_type,bytes,content_hash,stored_path,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(aid,entry_id,rid,name,mime,len(data),h,str(rel).replace('\\','/'),created))
        payload={'attachment':{'attachment_id':aid,'entry_id':entry_id,'revision_id':rid,'original_name':name,'mime_type':mime,'bytes':len(data),'content_hash':h,'created_at':created},'data_base64':base64.b64encode(data).decode('ascii')}
        con.execute('INSERT INTO sync_operations(operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,created_at) VALUES(?,?,?,?,?,?,?,?)',(new_id('op'),entry_id,rid,rid,'attachment',json.dumps(payload,ensure_ascii=False),_device_id(con),created));con.commit()
    finally: con.close()
    return {'attachment_id':aid,'name':name,'bytes':len(data),'mime_type':mime_type or mimetypes.guess_type(name)[0] or 'application/octet-stream'}

def list_attachments(entry_id: str, root: Path = ROOT):
    con=connect(root)
    try: return [dict(r) for r in con.execute('SELECT * FROM attachments WHERE entry_id=? ORDER BY created_at',(entry_id,))]
    finally: con.close()

def attachment_record(attachment_id: str, root: Path = ROOT):
    con=connect(root)
    try:
        r=con.execute('SELECT * FROM attachments WHERE attachment_id=?',(attachment_id,)).fetchone();return dict(r) if r else None
    finally: con.close()


def get_ai_cache(cache_key: str, root: Path = ROOT):
    con=connect(root)
    try:
        r=con.execute('SELECT * FROM ai_cache WHERE cache_key=?',(cache_key,)).fetchone()
        if not r:return None
        d=dict(r);d['response']=json.loads(d.pop('response_json') or '{}');return d
    finally:con.close()

def put_ai_cache(cache_key: str, provider: str, model: str, response, root: Path = ROOT):
    con=connect(root)
    try:
        con.execute('INSERT OR REPLACE INTO ai_cache(cache_key,provider,model,response_json,created_at) VALUES(?,?,?,?,?)',(cache_key,provider,model,json.dumps(response,ensure_ascii=False),utcnow()));con.commit()
    finally:con.close()

def log_ai_request(*,feature_id='generic',provider='',model='',input_hash='',input_chars=0,output_chars=0,prompt_tokens=None,completion_tokens=None,cache_hit=False,sent_remote=False,elapsed_ms=None,error=None,root: Path = ROOT):
    rid=new_id('aireq');con=connect(root)
    try:
        con.execute('INSERT INTO ai_requests(request_id,feature_id,provider,model,input_hash,input_chars,output_chars,prompt_tokens,completion_tokens,cache_hit,sent_remote,elapsed_ms,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(rid,feature_id,provider,model,input_hash,int(input_chars or 0),int(output_chars or 0),prompt_tokens,completion_tokens,1 if cache_hit else 0,1 if sent_remote else 0,elapsed_ms,error,utcnow()));con.commit()
        return rid
    finally:con.close()

def ai_usage_summary(root: Path = ROOT):
    con=connect(root)
    try:
        r=con.execute('SELECT COUNT(*) calls,COALESCE(SUM(sent_remote),0) remote_calls,COALESCE(SUM(cache_hit),0) cache_hits,COALESCE(SUM(input_chars),0) input_chars,COALESCE(SUM(output_chars),0) output_chars,COALESCE(SUM(prompt_tokens),0) prompt_tokens,COALESCE(SUM(completion_tokens),0) completion_tokens FROM ai_requests').fetchone()
        recent=[dict(x) for x in con.execute('SELECT request_id,feature_id,provider,model,input_chars,output_chars,cache_hit,sent_remote,elapsed_ms,error,created_at FROM ai_requests ORDER BY created_at DESC LIMIT 20')]
        return {'totals':dict(r),'recent':recent}
    finally:con.close()

def record_ai_artifact(feature_id: str, content, inputs: list[tuple[str,str]], provider: str, model: str, prompt_version='1', root: Path = ROOT):
    normalized=sorted((str(a),str(b)) for a,b in inputs); ih=hashlib.sha256(json.dumps(normalized,ensure_ascii=False).encode()).hexdigest(); aid=new_id('art'); con=connect(root)
    try:
        con.execute('INSERT INTO ai_artifacts(artifact_id,feature_id,input_hash,provider,model,prompt_version,content_json,status,generated_at) VALUES(?,?,?,?,?,?,?,?,?)',(aid,feature_id,ih,provider,model,prompt_version,json.dumps(content,ensure_ascii=False),'fresh',utcnow()))
        con.executemany('INSERT INTO ai_artifact_inputs(artifact_id,entry_id,revision_id) VALUES(?,?,?)',[(aid,e,r) for e,r in normalized]);con.execute("UPDATE feature_state SET status='fresh',dirty_since=NULL,last_refresh_at=?,reason=NULL WHERE feature_id=?",(utcnow(),feature_id));con.commit()
        return aid
    finally: con.close()

def artifact_status(feature_id=None, root: Path = ROOT):
    con=connect(root)
    try:
        if feature_id:
            fs=con.execute('SELECT * FROM feature_state WHERE feature_id=?',(feature_id,)).fetchone();arts=[dict(r) for r in con.execute('SELECT * FROM ai_artifacts WHERE feature_id=? ORDER BY generated_at DESC LIMIT 20',(feature_id,))]
        else:
            fs=None;arts=[dict(r) for r in con.execute('SELECT * FROM ai_artifacts ORDER BY generated_at DESC LIMIT 100')]
        return {'feature':dict(fs) if fs else None,'artifacts':arts}
    finally: con.close()

def feature_states(root: Path = ROOT):
    con=connect(root)
    try: return [dict(r) for r in con.execute('SELECT d.feature_id,d.strategy,d.depends_json,s.status,s.dirty_since,s.last_refresh_at,s.reason FROM feature_dependencies d LEFT JOIN feature_state s USING(feature_id) ORDER BY d.feature_id')]
    finally: con.close()


def create_backup(reason='manual', root: Path = ROOT, include_derived=False):
    ensure_dirs(root); bid=new_id('backup'); stamp=dt.datetime.now().strftime('%Y%m%d-%H%M%S'); out=root/'.lifeos'/'backups'/f'LifeOS-{stamp}-{bid[-8:]}.zip';tmpdb=None
    with _LOCK:
        # Consistent SQLite copy using backup API.
        tmpdir=Path(tempfile.mkdtemp(prefix='lifeos-backup-'))
        try:
            tmpdb=tmpdir/'core.db'; src=connect(root); dst=sqlite3.connect(tmpdb); src.backup(dst);dst.close();src.close()
            with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
                for p in (root/'vault').rglob('*'):
                    if p.is_file(): z.write(p,p.relative_to(root))
                z.write(tmpdb,Path('.lifeos')/'core.db')
                for folder in ('revisions','attachments'):
                    base=root/'.lifeos'/folder
                    if base.exists():
                        for p in base.rglob('*'):
                            if p.is_file(): z.write(p,p.relative_to(root))
                if include_derived and (root/'data/lifeos.db').exists(): z.write(root/'data/lifeos.db',Path('data/lifeos.db'))
                manifest={'created_at':utcnow(),'reason':reason,'format':'lifeos-backup-v1','include_derived':include_derived}
                z.writestr('backup_manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        finally: shutil.rmtree(tmpdir,ignore_errors=True)
    size=out.stat().st_size; con=connect(root)
    try: con.execute('INSERT INTO backups(backup_id,filename,reason,bytes,created_at) VALUES(?,?,?,?,?)',(bid,out.name,reason,size,utcnow()));con.commit()
    finally: con.close()
    return {'backup_id':bid,'filename':out.name,'bytes':size,'reason':reason}

def list_backups(root: Path = ROOT):
    con=connect(root)
    try: return [dict(r) for r in con.execute('SELECT * FROM backups ORDER BY created_at DESC')]
    finally: con.close()

def restore_backup(backup_id: str, root: Path = ROOT):
    con=connect(root)
    try: r=con.execute('SELECT * FROM backups WHERE backup_id=?',(backup_id,)).fetchone()
    finally: con.close()
    if not r: raise ValueError('backup not found')
    p=root/'.lifeos'/'backups'/r['filename']
    if not p.exists(): raise ValueError('backup file missing')
    if get_setting('backup.auto_before_restore','true',root)=='true': create_backup('pre-restore safety backup',root)
    tmp=Path(tempfile.mkdtemp(prefix='lifeos-restore-'))
    try:
        with zipfile.ZipFile(p) as z:
            names=z.namelist()
            if 'backup_manifest.json' not in names or '.lifeos/core.db' not in names: raise ValueError('not a LifeOS backup')
            z.extractall(tmp)
        # Replace product-controlled content. Backups folder itself is intentionally retained.
        for name in ('vault',):
            src=tmp/name
            if src.exists():
                dst=root/name; old=root/f'.{name}.restore-old';shutil.rmtree(old,ignore_errors=True)
                if dst.exists(): os.replace(dst,old)
                shutil.copytree(src,dst);shutil.rmtree(old,ignore_errors=True)
        for name in ('revisions','attachments'):
            src=tmp/'.lifeos'/name
            if src.exists():
                dst=root/'.lifeos'/name;shutil.rmtree(dst,ignore_errors=True);shutil.copytree(src,dst)
        shutil.copy2(tmp/'.lifeos'/'core.db',root/'.lifeos'/'core.db')
        derived=tmp/'data'/'lifeos.db'
        if derived.exists():
            (root/'data').mkdir(parents=True,exist_ok=True);shutil.copy2(derived,root/'data'/'lifeos.db')
    finally: shutil.rmtree(tmp,ignore_errors=True)
    return {'ok':True,'restart_required':True,'backup':dict(r)}


def export_entry(entry_id: str, root: Path = ROOT):
    e=get_entry(entry_id=entry_id,root=root)
    if not e: raise ValueError('entry not found')
    p=root/'vault'/e['source_path']; return {'entry':e,'content':p.read_text(encoding='utf-8') if p.exists() else ''}


def core_status(root: Path = ROOT):
    con=connect(root)
    try:
        # Status inspection must be side-effect free. A device identity is created
        # only when the device actually emits a syncable operation.
        device_row=con.execute("SELECT value FROM settings WHERE key='device.id'").fetchone()
        device_id=device_row[0] if device_row else None
        r=con.execute("SELECT * FROM refresh_state WHERE scope='derived-corpus'").fetchone()
        refresh=dict(r) if r else {'scope':'derived-corpus','status':'idle','requested_generation':0,'completed_generation':0}
        refresh['pending_generations']=max(0,int(refresh.get('requested_generation') or 0)-int(refresh.get('completed_generation') or 0))
        schema_row=con.execute("SELECT value FROM settings WHERE key='product.schema_version'").fetchone()
        return {
          'schema_version': schema_row[0] if schema_row else '9',
          'entries': con.execute('SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL').fetchone()[0],
          'revisions': con.execute('SELECT COUNT(*) FROM revisions').fetchone()[0],
          'attachments': con.execute('SELECT COUNT(*) FROM attachments').fetchone()[0],
          'pending_sync': con.execute("SELECT COUNT(*) FROM sync_operations WHERE sync_status='pending'").fetchone()[0],
          'open_conflicts': con.execute("SELECT COUNT(*) FROM sync_conflicts WHERE status='open'").fetchone()[0],
          'stale_ai': con.execute("SELECT COUNT(*) FROM ai_artifacts WHERE status='stale'").fetchone()[0],
          'device_id': device_id,
          'derived_refresh': refresh,
        }
    finally: con.close()

if __name__=='__main__':
    seed_feature_dependencies(root=ROOT)
    print(json.dumps({'bootstrap':bootstrap_existing(ROOT),'status':core_status(ROOT)},ensure_ascii=False,indent=2))

def apply_remote_operation(operation: dict, root: Path = ROOT):
    """Apply a sync operation while preserving remote entry/revision identity.

    Returns applied/already/conflict. It never silently overwrites a divergent
    local revision.
    """
    opid=operation.get('operation_id'); payload=operation.get('payload') or operation.get('payload_json') or {}
    if isinstance(payload,str): payload=json.loads(payload)
    ep=payload.get('entry') or {}; rv=payload.get('revision') or {}; content=payload.get('content') or ''
    eid=operation.get('entry_id') or ep.get('entry_id'); rid=operation.get('revision_id') or rv.get('revision_id'); base=operation.get('base_revision_id') or rv.get('parent_revision_id')
    if operation.get('op_type')=='attachment':
        att=payload.get('attachment') or {};aid=att.get('attachment_id');data=base64.b64decode(payload.get('data_base64') or '')
        if not (opid and eid and aid): raise ValueError('remote attachment operation missing identity')
        con=connect(root)
        try:
            if con.execute('SELECT 1 FROM sync_operations WHERE operation_id=?',(opid,)).fetchone() or con.execute('SELECT 1 FROM attachments WHERE attachment_id=?',(aid,)).fetchone():return {'status':'already_attachment','entry_id':eid,'attachment_id':aid}
            safe=re.sub(r'[^\w.\- ()\[\]]+','_',Path(att.get('original_name') or 'attachment').name)[:120] or 'attachment';rel=Path('.lifeos')/'attachments'/eid/f'{aid}_{safe}';fp=root/rel;fp.parent.mkdir(parents=True,exist_ok=True);fp.write_bytes(data)
            con.execute('INSERT INTO attachments(attachment_id,entry_id,revision_id,original_name,mime_type,bytes,content_hash,stored_path,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(aid,eid,att.get('revision_id') or rid,att.get('original_name') or safe,att.get('mime_type') or 'application/octet-stream',len(data),att.get('content_hash') or hashlib.sha256(data).hexdigest(),str(rel).replace('\\','/'),att.get('created_at') or utcnow()))
            con.execute('INSERT INTO sync_operations(operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,remote_seq,sync_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(opid,eid,rid,base,'attachment',json.dumps(payload,ensure_ascii=False),operation.get('device_id'),operation.get('remote_seq'),'remote_applied',operation.get('created_at') or utcnow()));con.commit();return {'status':'applied_attachment','entry_id':eid,'attachment_id':aid}
        except Exception:con.rollback();raise
        finally:con.close()
    if not (opid and eid and rid): raise ValueError('remote operation missing identity')
    con=connect(root)
    try:
        seen=con.execute('SELECT 1 FROM sync_operations WHERE operation_id=?',(opid,)).fetchone()
        if seen:return {'status':'already','entry_id':eid,'revision_id':rid}
        cur=con.execute('SELECT * FROM entries WHERE entry_id=?',(eid,)).fetchone()
        if cur and cur['current_revision_id']==rid:
            return {'status':'already','entry_id':eid,'revision_id':rid}
        if cur and cur['current_revision_id']!=base:
            cid=new_id('conflict')
            con.execute('INSERT INTO sync_conflicts(conflict_id,entry_id,local_revision_id,remote_revision_id,base_revision_id,remote_payload_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)',(cid,eid,cur['current_revision_id'],rid,base,json.dumps(operation,ensure_ascii=False),'open',utcnow()))
            con.execute('INSERT INTO sync_operations(operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,remote_seq,sync_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(opid,eid,rid,base,operation.get('op_type','upsert'),json.dumps(payload,ensure_ascii=False),operation.get('device_id'),operation.get('remote_seq'),'conflict',operation.get('created_at') or utcnow()))
            con.commit();return {'status':'conflict','conflict_id':cid,'entry_id':eid,'local_revision_id':cur['current_revision_id'],'remote_revision_id':rid}
        rel=ep.get('source_path') or (cur['source_path'] if cur else None) or (f"memories/daily/{(ep.get('journal_date') or '0000')[:4]}/{ep.get('journal_date')}.md")
        target=root/'vault'/rel;target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_suffix(target.suffix+'.tmp');tmp.write_text(content,encoding='utf-8');os.replace(tmp,target)
        now=operation.get('created_at') or utcnow();revfile=_write_revision_file(root,eid,rid,content);h=rv.get('content_hash') or sha_text(content)
        if not cur:
            con.execute('INSERT INTO entries(entry_id,kind,journal_date,timezone,title,tags_json,source_path,source_format,current_revision_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,ep.get('kind','daily'),ep.get('journal_date'),ep.get('timezone'),ep.get('title'),ep.get('tags_json') if isinstance(ep.get('tags_json'),str) else json.dumps(ep.get('tags_json') or [],ensure_ascii=False),rel,ep.get('source_format','markdown'),rid,now,now))
        else:
            con.execute('UPDATE entries SET kind=?,journal_date=?,timezone=?,title=?,tags_json=?,source_path=?,source_format=?,current_revision_id=?,updated_at=?,deleted_at=NULL WHERE entry_id=?',(ep.get('kind',cur['kind']),ep.get('journal_date',cur['journal_date']),ep.get('timezone',cur['timezone']),ep.get('title',cur['title']),ep.get('tags_json') if isinstance(ep.get('tags_json'),str) else json.dumps(ep.get('tags_json') or [],ensure_ascii=False),rel,ep.get('source_format',cur['source_format']),rid,now,eid))
        con.execute('INSERT OR IGNORE INTO revisions(revision_id,entry_id,parent_revision_id,content_hash,bytes,revision_file,source,note,base_revision_id,device_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,eid,base,h,len(content.encode('utf-8')),revfile,'sync','remote sync',base,operation.get('device_id'),now))
        mark_stale_in_connection(con,eid,'remote sync')
        con.execute('INSERT INTO sync_operations(operation_id,entry_id,revision_id,base_revision_id,op_type,payload_json,device_id,remote_seq,sync_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(opid,eid,rid,base,operation.get('op_type','upsert'),json.dumps(payload,ensure_ascii=False),operation.get('device_id'),operation.get('remote_seq'),'remote_applied',now))
        con.commit();return {'status':'applied','entry_id':eid,'revision_id':rid,'source_path':rel}
    except Exception:
        con.rollback();raise
    finally:con.close()

def list_sync_conflicts(root: Path = ROOT, status='open'):
    con=connect(root)
    try:
        q='SELECT * FROM sync_conflicts'
        args=()
        if status:
            q+=' WHERE status=?';args=(status,)
        q+=' ORDER BY created_at DESC'
        out=[]
        for r in con.execute(q,args):
            d=dict(r)
            try:d['remote_payload']=json.loads(d.pop('remote_payload_json') or '{}')
            except Exception:d['remote_payload']={}
            out.append(d)
        return out
    finally:con.close()

def resolve_sync_conflict(conflict_id: str, choice: str, root: Path = ROOT):
    con=connect(root)
    try:r=con.execute('SELECT * FROM sync_conflicts WHERE conflict_id=?',(conflict_id,)).fetchone()
    finally:con.close()
    if not r:raise ValueError('conflict not found')
    if choice=='keep_local':
        con=connect(root)
        try:con.execute("UPDATE sync_conflicts SET status='resolved_local',resolved_at=? WHERE conflict_id=?",(utcnow(),conflict_id));con.commit()
        finally:con.close()
        return {'ok':True,'choice':choice}
    if choice=='use_remote':
        op=json.loads(r['remote_payload_json']);eid=r['entry_id']
        # Explicit user choice authorizes a new local revision based on remote content.
        payload=op.get('payload') or {};content=payload.get('content') or '';e=get_entry(entry_id=eid,root=root);ep=payload.get('entry') or {}
        out=save_entry(journal_date=ep.get('journal_date') or e['journal_date'],sections={},entry_id=eid,title=ep.get('title') or e.get('title') or '',tags=json.loads(ep.get('tags_json') or '[]') if isinstance(ep.get('tags_json'),str) else ep.get('tags_json') or e.get('tags') or [],timezone=ep.get('timezone') or e.get('timezone') or '',raw_markdown=content,source='conflict-resolution',note=f'use remote {r["remote_revision_id"]}',root=root)
        con=connect(root)
        try:con.execute("UPDATE sync_conflicts SET status='resolved_remote',resolved_at=? WHERE conflict_id=?",(utcnow(),conflict_id));con.commit()
        finally:con.close()
        return {'ok':True,'choice':choice,'result':out}
    raise ValueError('choice must be keep_local or use_remote')
