"""Recover interrupted file/SQLite writes before indexing the workspace."""
from pathlib import Path
import base64, contextlib, hashlib, json, os, shutil, sqlite3, uuid, zipfile


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path, value):
    atomic_bytes(path, json.dumps(value, ensure_ascii=False).encode('utf-8'))


def inside(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('工作区路径无效')
    return path


def prepare_entry_write(root, entry_id, revision_id, relative, old_relative, revision_file=None):
    target = inside(root / 'vault', relative)
    journal = root / '.lifeos' / 'pending-writes' / (uuid.uuid4().hex + '.json')
    atomic_json(journal, {'entry_id': entry_id, 'revision_id': revision_id, 'path': relative,
                         'old_path': old_relative, 'revision_file': revision_file,
                         'previous': base64.b64encode(target.read_bytes()).decode('ascii') if target.exists() else None})
    return journal


def finish_entry_write(root, journal, con):
    value = json.loads(journal.read_text(encoding='utf-8'))
    row = con.execute('SELECT current_revision_id,source_path FROM entries WHERE entry_id=?',
                      (value['entry_id'],)).fetchone()
    committed = row and row[0] == value['revision_id'] and row[1] == value['path']
    target = inside(root / 'vault', value['path'])
    if committed:
        if value['old_path'] and value['old_path'] != value['path']:
            inside(root / 'vault', value['old_path']).unlink(missing_ok=True)
    else:
        if value['previous'] is None:
            target.unlink(missing_ok=True)
        else:
            atomic_bytes(target, base64.b64decode(value['previous']))
        if value.get('revision_file'):
            inside(root, value['revision_file']).unlink(missing_ok=True)
    journal.unlink()
    return bool(committed)


def recover_entry_writes(root):
    journals = list((root / '.lifeos' / 'pending-writes').glob('*.json'))
    if not journals:
        return
    with contextlib.closing(sqlite3.connect(root / '.lifeos' / 'core.db')) as con:
        for journal in journals:
            finish_entry_write(root, journal, con)


RESTORE_TARGETS = ('vault', '.lifeos/revisions', '.lifeos/attachments',
                   '.lifeos/draft-attachments', '.lifeos/bottles', '.lifeos/recovered-browser-state',
                   '.lifeos/ui-state.json', '.lifeos/ui-state.json.previous',
                   '.lifeos/core.db', '.lifeos/core.db-wal', '.lifeos/core.db-shm',
                   'data/lifeos.db', 'data/lifeos.db-wal', 'data/lifeos.db-shm')


def validate_backup(archive, destination):
    with zipfile.ZipFile(archive) as zipped:
        names = zipped.namelist()
        if len(names) != len(set(names)) or 'backup_manifest.json' not in names or '.lifeos/core.db' not in names:
            raise ValueError('备份格式无效')
        for name in names:
            if '\\' in name or name.startswith('/') or ':' in name or '..' in Path(name).parts:
                raise ValueError('备份路径无效')
            inside(destination, name)
        if zipped.testzip():
            raise ValueError('备份校验失败')
        manifest = json.loads(zipped.read('backup_manifest.json'))
        if manifest.get('format') != 'lifeos-backup-v1':
            raise ValueError('备份格式不支持')
        if 'sha256' in manifest and set(manifest['sha256']) != set(names) - {'backup_manifest.json'}:
            raise ValueError('备份文件清单不完整')
        for name, digest in manifest.get('sha256', {}).items():
            if hashlib.sha256(zipped.read(name)).hexdigest() != digest:
                raise ValueError('备份内容校验失败')
        zipped.extractall(destination)
    with contextlib.closing(sqlite3.connect(destination / '.lifeos' / 'core.db')) as con:
        if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('备份数据库损坏')
        con.execute('SELECT entry_id,current_revision_id,source_path FROM entries LIMIT 1')
    ui = destination / '.lifeos' / 'ui-state.json'
    if ui.exists():
        state = json.loads(ui.read_text(encoding='utf-8'))
        if state.get('format') != 1 or not isinstance(state.get('items'), dict):
            raise ValueError('备份草稿格式无效')


def rollback_restore(root, value):
    job = inside(root, value['job'])
    for relative in reversed(RESTORE_TARGETS):
        target = inside(root, relative)
        old = job / 'old' / relative
        if old.exists() or not value['existed'][relative]:
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink(missing_ok=True)
            if old.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(old, target)


def recover_restore(root, checkpoint=lambda phase: None):
    pending = root / '.lifeos' / 'pending-restore.json'
    if not pending.exists():
        return
    value = json.loads(pending.read_text(encoding='utf-8'))
    job = inside(root, value['job'])
    if value['phase'] == 'applying':
        rollback_restore(root, value)
    elif value['phase'] == 'prepared':
        value['existed'] = {name: inside(root, name).exists() for name in RESTORE_TARGETS}
        value['phase'] = 'applying'
        atomic_json(pending, value)
        try:
            for relative in RESTORE_TARGETS:
                target = inside(root, relative)
                old, staged = job / 'old' / relative, job / 'new' / relative
                if target.exists():
                    old.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(target, old)
                if staged.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(staged, target)
                checkpoint(relative)
            value['phase'] = 'committed'
            atomic_json(pending, value)
        except Exception:
            rollback_restore(root, value)
            pending.unlink()
            shutil.rmtree(job)
            raise
    elif value['phase'] != 'committed':
        raise ValueError('恢复记录损坏，请保留工作区')
    pending.unlink()
    shutil.rmtree(job, ignore_errors=True)
