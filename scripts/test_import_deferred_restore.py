"""Deferred import restore stays safe with live SQLite handles and interruption."""
from pathlib import Path
import contextlib
import hashlib
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from engine import durable_io as io, import_pipeline as pipeline, product_core as pc, rebuild_memory_engine as index


def digest(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (root / 'vault').rglob('*.md')}


class ImportDeferredRestoreTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='lifeos-import-deferred-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        pc.set_settings({'refresh.background_enabled': False}, self.root)
        (self.root / 'data').mkdir()
        with contextlib.closing(sqlite3.connect(self.root / 'data/lifeos.db')) as con:
            index.schema(con); index.build_skill_defs(con); index.build_defaults(con); con.commit()
        pc.save_entry(journal_date='2026-10-01', sections={'日记': '合成的原有日记'}, root=self.root)
        self.before = digest(self.root)
        preview = pipeline.preview_import([{'name': '2026-10-02.md', 'content': '合成导入记录'}], root=self.root)
        self.job_id = preview['job_id']
        pipeline.commit_import(self.job_id, root=self.root)
        self.after = digest(self.root)
        self.payload = self.root / '.lifeos/imports' / self.job_id

    def test_clear_defers_replacement_with_live_core_and_index_handles(self):
        core = sqlite3.connect(self.root / '.lifeos/core.db')
        derived = sqlite3.connect(self.root / 'data/lifeos.db')
        try:
            core.execute('SELECT COUNT(*) FROM entries').fetchone()
            derived.execute('SELECT COUNT(*) FROM sqlite_master').fetchone()
            with patch.object(io, 'recover_restore', side_effect=AssertionError('live process must not restore')):
                result = pipeline.clear_import(self.job_id, self.root, defer=True)
            self.assertTrue(result['restart_required'])
            self.assertFalse(result['restored'])
            self.assertEqual(digest(self.root), self.after)
            self.assertEqual(pipeline.get_job(self.job_id, self.root)['status'], 'committed')
            self.assertTrue(self.payload.exists())
        finally:
            derived.close(); core.close()
        io.recover_restore(self.root)
        self.assertEqual(digest(self.root), self.before)
        self.assertIsNone(pipeline.get_job(self.job_id, self.root))
        self.assertFalse(self.payload.exists())
        with contextlib.closing(sqlite3.connect(self.root / '.lifeos/core.db')) as con:
            self.assertEqual(con.execute('SELECT COUNT(*) FROM import_items WHERE job_id=?', (self.job_id,)).fetchone()[0], 0)

    def test_rollback_marks_restored_job_after_restart_and_clear_preserves_later_edits(self):
        result = pipeline.rollback_import(self.job_id, self.root, defer=True)
        self.assertTrue(result['restart_required'])
        self.assertEqual(pipeline.get_job(self.job_id, self.root)['status'], 'committed')
        io.recover_restore(self.root)
        self.assertEqual(digest(self.root), self.before)
        self.assertEqual(pipeline.get_job(self.job_id, self.root)['status'], 'rolled_back')
        self.assertTrue(self.payload.exists())
        pc.save_entry(journal_date='2026-10-03', sections={'日记': '回滚之后写的新日记'}, root=self.root)
        later = digest(self.root)
        result = pipeline.clear_import(self.job_id, self.root, defer=True)
        self.assertFalse(result['restored'])
        self.assertFalse(result.get('restart_required', False))
        self.assertEqual(digest(self.root), later)
        self.assertIsNone(pipeline.get_job(self.job_id, self.root))

    def test_preview_only_clear_stays_immediate(self):
        preview = pipeline.preview_import([{'name': '2026-10-04.md', 'content': '合成预览'}], root=self.root)
        result = pipeline.clear_import(preview['job_id'], self.root, defer=True)
        self.assertFalse(result['restored'])
        self.assertFalse(result.get('restart_required', False))
        self.assertIsNone(pipeline.get_job(preview['job_id'], self.root))
        self.assertEqual(digest(self.root), self.after)

    def test_interruption_after_cleanup_retries_without_reviving_job(self):
        class Crash(BaseException):
            pass
        pipeline.clear_import(self.job_id, self.root, defer=True)
        def interrupt(phase):
            if phase == 'post_restore':
                raise Crash()
        with self.assertRaises(Crash):
            io.recover_restore(self.root, interrupt)
        pending = self.root / '.lifeos/pending-restore.json'
        self.assertEqual(json.loads(pending.read_text(encoding='utf-8'))['phase'], 'committed')
        self.assertIsNone(pipeline.get_job(self.job_id, self.root))
        io.recover_restore(self.root)
        self.assertFalse(pending.exists())
        self.assertEqual(digest(self.root), self.before)
        self.assertIsNone(pipeline.get_job(self.job_id, self.root))
        self.assertFalse(self.payload.exists())

    def test_interruption_during_replacement_keeps_import_job_and_payload(self):
        class Crash(BaseException):
            pass
        pipeline.clear_import(self.job_id, self.root, defer=True)
        def interrupt(phase):
            if phase == '.lifeos/core.db':
                raise Crash()
        with self.assertRaises(Crash):
            io.recover_restore(self.root, interrupt)
        io.recover_restore(self.root)
        self.assertEqual(digest(self.root), self.after)
        self.assertEqual(pipeline.get_job(self.job_id, self.root)['status'], 'committed')
        self.assertTrue(self.payload.exists())

    def test_background_bootstrap_does_not_apply_pending_restore(self):
        pipeline.clear_import(self.job_id, self.root, defer=True)
        with patch.object(io, 'recover_restore', side_effect=AssertionError('background must not restore')):
            pc.bootstrap_existing(self.root, recover_pending=False)
        self.assertTrue((self.root / '.lifeos/pending-restore.json').exists())
        self.assertEqual(digest(self.root), self.after)
        io.recover_restore(self.root)
        self.assertEqual(digest(self.root), self.before)

    def test_cleanup_identifiers_cannot_target_paths_or_arbitrary_tables(self):
        snapshot = pipeline.get_job(self.job_id, self.root)['snapshot_dir']
        for cleanup in ({'import_job_id': '../vault', 'action': 'clear'},
                        {'import_job_id': self.job_id, 'action': 'delete-all'},
                        {'import_job_id': self.job_id, 'action': 'clear', 'path': 'vault'}):
            with self.assertRaises(ValueError):
                pc.restore_backup(snapshot, self.root, defer=True, post_restore=cleanup)
        self.assertFalse((self.root / '.lifeos/pending-restore.json').exists())
        self.assertEqual(digest(self.root), self.after)


if __name__ == '__main__':
    unittest.main()
