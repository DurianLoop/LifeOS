"""Durable, private letters to the future. No diary indexing or AI calls."""
from __future__ import annotations

import datetime as dt
import hashlib
import re
import sqlite3
import uuid
from pathlib import Path
from engine import product_core as pc, p2_core, durable_io

MAX_MEDIA = 100 * 1024 * 1024
MAX_TEXT = 20000
THEMES = ('moon', 'dawn', 'dusk')
MIMES = {'audio/webm': '.webm', 'video/webm': '.webm', 'audio/ogg': '.ogg',
         'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mpeg': '.mp3',
         'audio/mp4': '.m4a', 'video/mp4': '.mp4', 'audio/flac': '.flac', 'video/quicktime': '.mov'}


class BottleError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return dt.datetime.now(dt.timezone.utc).timestamp()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{8,80}', value):
        raise BottleError('漂流瓶编号无效')
    return value


def migrate(root):
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            con.executescript('''
            CREATE TABLE IF NOT EXISTS drift_bottles(
              id TEXT PRIMARY KEY,kind TEXT NOT NULL DEFAULT 'text',title TEXT NOT NULL DEFAULT '',
              body TEXT NOT NULL DEFAULT '',theme TEXT NOT NULL DEFAULT 'moon',
              unlock_at REAL,sealed_at REAL,opened_at REAL,created_at REAL NOT NULL,updated_at REAL NOT NULL,
              media_name TEXT,mime TEXT,media_bytes INTEGER,sha256 TEXT,duration REAL,
              revision INTEGER NOT NULL DEFAULT 0,timezone TEXT NOT NULL DEFAULT '',native_notified_at REAL
            );
            CREATE INDEX IF NOT EXISTS idx_bottles_arrival ON drift_bottles(sealed_at,unlock_at);
            CREATE TABLE IF NOT EXISTS drift_legacy_migrations(id TEXT PRIMARY KEY);
            ''')
            con.commit()
        finally:
            con.close()


def migrate_legacy(root):
    """Called before rebuilding the disposable index; identity is deterministic."""
    root = Path(root)
    migrate(root)
    path = root / 'data/lifeos.db'
    if not path.exists():
        return 0
    old = sqlite3.connect(path)
    old.row_factory = sqlite3.Row
    try:
        if not old.execute("SELECT 1 FROM sqlite_master WHERE name='capsules'").fetchone():
            return 0
        records = old.execute('SELECT * FROM capsules').fetchall()
    finally:
        old.close()
    with pc._LOCK:
        con = pc.connect(root)
        try:
            count = 0
            con.execute("INSERT OR IGNORE INTO drift_legacy_migrations SELECT id FROM drift_bottles WHERE id LIKE 'legacy_%'")
            for r in records:
                key = hashlib.sha256(f"{r['id']}|{r['title']}|{r['body']}|{r['unlock_date']}".encode()).hexdigest()[:32]
                if not con.execute('INSERT OR IGNORE INTO drift_legacy_migrations VALUES(?)', ('legacy_' + key,)).rowcount:
                    continue
                try:
                    # Old capsules used the machine's local calendar, at midnight.
                    unlock = dt.datetime.fromisoformat(r['unlock_date']).astimezone().timestamp()
                except (TypeError, ValueError):
                    unlock = None
                stamp = now()
                cur = con.execute('''INSERT OR IGNORE INTO drift_bottles
                  (id,title,body,unlock_at,sealed_at,opened_at,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?)''', ('legacy_' + key, r['title'], r['body'], unlock,
                  stamp if unlock else None, stamp if unlock and r['status'] == 'open' and unlock <= stamp else None,
                  stamp, stamp))
                count += cur.rowcount
            con.commit()
            return count
        finally:
            con.close()


def _row(con, bid):
    r = con.execute('SELECT * FROM drift_bottles WHERE id=?', (identifier(bid),)).fetchone()
    if not r:
        raise BottleError('这只漂流瓶已不存在', 404)
    return dict(r)


def _state(r, stamp):
    return 'draft' if r['sealed_at'] is None else 'sealed' if r['unlock_at'] > stamp else 'opened' if r['opened_at'] else 'arrived'


def _public(r, stamp, content=False):
    state = _state(r, stamp)
    result = {k: r[k] for k in ('id', 'kind', 'title', 'theme', 'unlock_at', 'sealed_at', 'opened_at',
                               'created_at', 'updated_at', 'revision', 'duration', 'timezone')}
    result.update(state=state, has_media=bool(r['media_name']))
    if content and (state == 'draft' or state == 'opened'):
        result['body'] = r['body']
        result['media_url'] = '/api/bottles/' + r['id'] + '/media' if r['media_name'] else None
        result['mime'] = r['mime']
    return result


def list_bottles(root):
    migrate_legacy(root)
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            stamp = now()
            items = [_public(dict(r), stamp) for r in con.execute('SELECT * FROM drift_bottles ORDER BY created_at DESC')]
            return {'items': items, 'server_now': stamp, 'max_media_bytes': MAX_MEDIA, 'max_text': MAX_TEXT}
        finally:
            con.close()


def detail(root, bid, *, open_bottle=False):
    migrate(root)
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            r = _row(con, bid)
            stamp = now()
            if _state(r, stamp) == 'sealed':
                raise BottleError('还未到约定的时间', 423)
            if open_bottle and r['sealed_at'] is not None and not r['opened_at']:
                con.execute('UPDATE drift_bottles SET opened_at=? WHERE id=?', (stamp, bid))
                con.commit()
                r['opened_at'] = stamp
                p2_core.mark_notification('bottle_' + bid, root=root)
            return _public(r, stamp, content=True)
        finally:
            con.close()


def save_draft(root, value):
    migrate(root)
    bid = identifier(value.get('id') or 'bottle_' + uuid.uuid4().hex)
    kind = value.get('kind', 'text')
    theme = value.get('theme', 'moon')
    title, body = value.get('title', ''), value.get('body', '')
    if kind not in ('text', 'audio', 'video') or theme not in THEMES:
        raise BottleError('内容类型或背景无效')
    if not isinstance(title, str) or not isinstance(body, str) or len(title) > 100 or len(body) > MAX_TEXT:
        raise BottleError('标题限 100 字，正文限 20000 字')
    timezone = str(value.get('timezone') or '')[:80]
    unlock = value.get('unlock_at')
    if unlock is not None:
        if not isinstance(unlock, (int, float)) or not 0 < unlock < 253402214400:
            raise BottleError('开启时间无效')
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            existing = con.execute('SELECT * FROM drift_bottles WHERE id=?', (bid,)).fetchone()
            if existing and existing['sealed_at'] is not None:
                raise BottleError('封存后的内容不能更改', 409)
            if existing and value.get('revision') != existing['revision']:
                raise BottleError('草稿已在别处更新，请重新打开', 409)
            if existing and existing['kind'] != kind and existing['media_name']:
                raise BottleError('请先移除原来的录音或视频')
            stamp = now()
            con.execute('''INSERT INTO drift_bottles(id,kind,title,body,theme,unlock_at,created_at,updated_at,timezone,revision)
              VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,
              body=excluded.body,theme=excluded.theme,unlock_at=excluded.unlock_at,updated_at=excluded.updated_at,
              timezone=excluded.timezone,revision=drift_bottles.revision+1''',
              (bid, kind, title.strip(), body, theme, unlock, stamp, stamp, timezone))
            con.commit()
            return _public(_row(con, bid), stamp, content=True)
        finally:
            con.close()


def _signature(data, mime):
    if mime.endswith('/webm'): return data.startswith(b'\x1aE\xdf\xa3')
    if mime.endswith('/ogg'): return data.startswith(b'OggS')
    if mime in ('audio/wav', 'audio/x-wav'): return data.startswith(b'RIFF') and data[8:12] == b'WAVE'
    if mime == 'audio/mpeg': return data.startswith(b'ID3') or (len(data) > 1 and data[0] == 255 and data[1] & 224 == 224)
    if mime == 'audio/flac': return data.startswith(b'fLaC')
    return data[4:8] == b'ftyp'


def upload(root, bid, data, mime, duration=None):
    migrate(root)
    mime = mime.split(';')[0].strip().lower()
    if mime not in MIMES or not data or len(data) > MAX_MEDIA or not _signature(data[:32], mime):
        raise BottleError('请选择有效的录音或视频，单个文件不超过 100 MB')
    if duration is not None and (not isinstance(duration, (int, float)) or not 0 <= duration <= 86400):
        raise BottleError('媒体时长无效')
    with pc._LOCK:
        con = pc.connect(Path(root))
        path = None
        try:
            r = _row(con, bid)
            if r['sealed_at'] is not None: raise BottleError('已封存，无法替换内容', 409)
            if r['kind'] == 'text' or not mime.startswith(r['kind'] + '/'):
                raise BottleError('文件与所选内容类型不一致')
            name = uuid.uuid4().hex + MIMES[mime]
            path = Path(root) / '.lifeos/bottles/media' / name
            durable_io.atomic_bytes(path, data)
            con.execute('''UPDATE drift_bottles SET media_name=?,mime=?,media_bytes=?,sha256=?,duration=?,
              updated_at=?,revision=revision+1 WHERE id=?''',
              (name, mime, len(data), hashlib.sha256(data).hexdigest(), duration, now(), bid))
            con.commit()
            if r['media_name']: (path.parent / r['media_name']).unlink(missing_ok=True)
            return _public(_row(con, bid), now(), content=True)
        except Exception:
            if path and not con.execute('SELECT 1 FROM drift_bottles WHERE media_name=?', (path.name,)).fetchone():
                path.unlink(missing_ok=True)
            raise
        finally:
            con.close()


def media(root, bid):
    migrate(root)
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            r = _row(con, bid)
            if _state(r, now()) not in ('draft', 'opened'): raise BottleError('请在到期后开启漂流瓶', 423)
            if not r['media_name']: raise BottleError('没有录音或视频', 404)
            path = durable_io.inside(Path(root) / '.lifeos/bottles/media', r['media_name'])
            if not path.is_file() or path.stat().st_size != r['media_bytes']:
                raise BottleError('媒体文件缺失，请从备份恢复', 410)
            return path, r['mime']
        finally:
            con.close()


def remove_media(root, bid):
    migrate(root)
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            r = _row(con, bid)
            if r['sealed_at'] is not None: raise BottleError('已封存，无法移除内容', 409)
            con.execute('UPDATE drift_bottles SET media_name=NULL,mime=NULL,media_bytes=NULL,sha256=NULL,duration=NULL,revision=revision+1 WHERE id=?', (bid,))
            con.commit()
            if r['media_name']: (Path(root) / '.lifeos/bottles/media' / r['media_name']).unlink(missing_ok=True)
            return _public(_row(con, bid), now(), content=True)
        finally:
            con.close()


def seal(root, bid, revision):
    migrate(root)
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            r = _row(con, bid)
            stamp = now()
            if r['sealed_at'] is not None: return _public(r, stamp)  # network retries are safe
            if r['revision'] != revision: raise BottleError('草稿已更新，请重试', 409)
            if not r['unlock_at'] or r['unlock_at'] <= stamp: raise BottleError('请选择未来的开启时间')
            if not r['body'].strip() and not r['media_name']: raise BottleError('留下一段文字、录音或视频再封存')
            if r['kind'] != 'text' and not r['media_name']: raise BottleError('请先录制或选择媒体')
            if r['media_name']:
                path = Path(root) / '.lifeos/bottles/media' / r['media_name']
                if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != r['sha256']:
                    raise BottleError('媒体校验失败，请重新选择或录制')
            con.execute('UPDATE drift_bottles SET sealed_at=?,updated_at=?,revision=revision+1 WHERE id=?', (stamp, stamp, bid))
            con.commit()
            return _public(_row(con, bid), stamp)
        finally:
            con.close()


def delete(root, bid):
    migrate(root)
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            r = _row(con, bid)
            con.execute('DELETE FROM drift_bottles WHERE id=?', (bid,))
            con.commit()
            p2_core.mark_notification('bottle_' + bid, status='dismissed', root=root)
            if r['media_name']: (Path(root) / '.lifeos/bottles/media' / r['media_name']).unlink(missing_ok=True)
            return {'ok': True}
        finally:
            con.close()


def arrivals(root):
    migrate_legacy(root)
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            stamp = now()
            records = con.execute('SELECT * FROM drift_bottles WHERE sealed_at IS NOT NULL AND unlock_at<=? AND opened_at IS NULL ORDER BY unlock_at', (stamp,)).fetchall()
            items = [_public(dict(r), stamp) for r in records]
            for item in items:
                p2_core.add_notification('capsule', '一只漂流瓶抵达了', '',
                                        {'feature': 'Time Capsule', 'bottle_id': item['id']},
                                        root=root, notification_id='bottle_' + item['id'])
            prefs = p2_core.notification_preferences(root)
            local = dt.datetime.now().strftime('%H:%M')
            start, end = prefs.get('quiet_start'), prefs.get('quiet_end')
            quiet = bool(start and end and ((start <= local < end) if start < end else (local >= start or local < end)))
            notify = bool(prefs['enabled'] and 'capsule' in prefs['kinds'] and not quiet)
            pending = [r['id'] for r in records if r['native_notified_at'] is None] if notify else []
            return {'items': items, 'native_pending': pending, 'notify': notify, 'server_now': stamp}
        finally:
            con.close()


def acknowledge_native(root, ids):
    migrate(root)
    if not isinstance(ids, list) or len(ids) > 100: raise BottleError('提醒参数无效')
    with pc._LOCK:
        con = pc.connect(Path(root))
        try:
            for bid in ids:
                con.execute('UPDATE drift_bottles SET native_notified_at=? WHERE id=? AND sealed_at IS NOT NULL AND unlock_at<=?',
                            (now(), identifier(bid), now()))
            con.commit()
            return {'ok': True}
        finally: con.close()
