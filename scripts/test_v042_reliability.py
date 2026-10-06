"""Fault injection and exact backup recovery, optionally on a private diary copy."""
from pathlib import Path
import argparse, contextlib, hashlib, json, shutil, sqlite3, sys, tempfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import product_core as pc, durable_io as io, draft_attachments as drafts


def digest(root):
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'vault').rglob('*.md')}


def run(root, corpus=None):
    if corpus:
        from scripts.test_ai_workflows import initialize
        initialize(root,corpus)
        if (corpus/'.lifeos/attachments').exists():shutil.copytree(corpus/'.lifeos/attachments',root/'.lifeos/attachments',dirs_exist_ok=True)
    else:
        pc.connect(root).close();pc.save_entry(journal_date='2026-10-06',sections={'日记':'first'},root=root)
    pc.set_settings({'backup.auto_before_restore':False},root)
    before=digest(root);entry=next(e for e in pc.list_entries(-1,root) if e['kind']=='daily');original=pc.export_entry(entry['entry_id'],root)['content'];checks=[]
    def check(label,condition):
        if not condition:raise AssertionError(label)
        checks.append(label)
    with patch.object(pc,'_enqueue_sync',side_effect=OSError('disk full')):
        try:pc.save_entry(entry_id=entry['entry_id'],journal_date=entry['journal_date'],sections={},raw_markdown=original+'\nfailure',root=root)
        except OSError:pass
        else:raise AssertionError('expected write failure')
    check('SQL failure restores Markdown and revision identity',digest(root)==before and pc.get_entry(entry_id=entry['entry_id'],root=root)['current_revision_id']==entry['current_revision_id'])
    journal=io.prepare_entry_write(root,entry['entry_id'],'rev_uncommitted',entry['source_path'],entry['source_path'])
    io.atomic_bytes(root/'vault'/entry['source_path'],b'partial')
    io.recover_entry_writes(root);check('interruption before commit recovers previous bytes',digest(root)==before)
    class Crash(BaseException):pass
    with patch.object(io,'finish_entry_write',side_effect=Crash):
        try:pc.save_entry(entry_id=entry['entry_id'],journal_date=entry['journal_date'],sections={},raw_markdown=original+'\ncommitted',root=root)
        except Crash:pass
    io.recover_entry_writes(root);check('interruption after commit retains new bytes',pc.export_entry(entry['entry_id'],root)['content'].endswith('committed'))
    pc.save_entry(entry_id=entry['entry_id'],journal_date=entry['journal_date'],sections={},raw_markdown=original,root=root)
    staged=drafts.stage(root,'fixture.txt',b'durable attachment','text/plain')
    check('unsubmitted attachment survives module reload',drafts.read(root,staged['id'])[1]==b'durable attachment')
    attachment_count=len(pc.list_attachments(entry['entry_id'],root))
    one=drafts.commit(root,staged['id'],entry['entry_id']);two=drafts.commit(root,staged['id'],entry['entry_id'])
    check('attachment retry is idempotent',one['attachment_id']==two['attachment_id'] and len(pc.list_attachments(entry['entry_id'],root))==attachment_count+1)
    state=root/'.lifeos/ui-state.json';io.atomic_json(state,{'format':1,'items':{'lifeos.writer.draft.2026-10-07':json.dumps({'sections':{'日记':original[:300]},'attachments':[staged]})}})
    saved_state=state.read_bytes();backup=pc.create_backup('reliability-test',root);baseline=digest(root)
    pc.save_entry(journal_date='2099-01-01',sections={'日记':'after backup'},root=root);io.atomic_bytes(state,b'{"format":1,"items":{}}')
    mutated=digest(root);pc.restore_backup(backup['backup_id'],root,defer=True)
    check('restore is deferred until restart',digest(root)==mutated)
    def interrupt(relative):
        if relative=='.lifeos/core.db':raise Crash()
    try:io.recover_restore(root,interrupt)
    except Crash:pass
    io.recover_restore(root)
    check('interrupted restore rolls back whole workspace',digest(root)==mutated and state.read_bytes()!=saved_state)
    pc.restore_backup(backup['backup_id'],root,defer=True);io.recover_restore(root)
    check('successful restore recovers exact originals and UI draft',digest(root)==baseline and state.read_bytes()==saved_state)
    check('draft attachment is included in backup',drafts.read(root,staged['id'])[1]==b'durable attachment')
    pc.bootstrap_existing(root)
    check('restored SQLite and revision files are consistent',pc.export_entry(entry['entry_id'],root)['content']==original)
    check('retained backups remain visible after restoring old SQLite',any(item['backup_id']==backup['backup_id'] for item in pc.list_backups(root)))
    # A malformed ZIP must not register pending state or mutate live data.
    archive=root/'.lifeos/backups'/backup['filename'];data=archive.read_bytes();archive.write_bytes(data[:64])
    try:pc.restore_backup(backup['backup_id'],root,defer=True)
    except Exception:pass
    else:raise AssertionError('damaged archive accepted')
    check('damaged backup leaves current data untouched',digest(root)==baseline and not (root/'.lifeos/pending-restore.json').exists())
    return {'ok':True,'checks':checks,'passed':len(checks),'diaries':len(baseline),'original_corpus_unchanged':digest(corpus)==before if corpus else None}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--corpus-workspace',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    if args.output:args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='lifeos-v042-',dir=args.output) as directory:
        result=run(Path(directory),args.corpus_workspace)
    if args.output:(args.output/'reliability.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='checks'}))
