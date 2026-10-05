"""Regression tests for mixed daily/weekly exports and repeat imports."""
from pathlib import Path
import base64
import io
import json
import sqlite3
import sys
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import product_core as pc,import_pipeline as pipeline,rebuild_memory_engine as engine
from importers.base import guess_week,guess_date


def archive_payload(files):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,text in files.items():archive.writestr(name,text.encode('utf-8'))
    return [{'name':'journals.zip','data_base64':base64.b64encode(buffer.getvalue()).decode('ascii')}]


class ImportRoundtripTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='lifeos-roundtrip-')
        self.root=Path(self.temp.name)
        pc.set_settings({'refresh.background_enabled':False},self.root)
        (self.root/'data').mkdir()
        con=sqlite3.connect(self.root/'data/lifeos.db')
        engine.schema(con);engine.build_skill_defs(con);engine.build_defaults(con);con.commit();con.close()
        self.files={
            '2025-01-29.md':'### 日记\r\n学习记录,"一个完整句子"\r\n第二行\r\n',
            '2025-02-01.md':'一篇普通 Markdown\n\n逗号,引号"和换行\n',
            '2025_53.md':'### 本周总结\n周记引用了 2025-12-29，但属于 2025 年第 53 周。\n',
            '2026_1.md':'### 本周总结\n开始整理阅读笔记。\n',
        }

    def tearDown(self):self.temp.cleanup()

    def imported(self):
        preview=pipeline.preview_import(archive_payload(self.files),root=self.root)
        self.assertEqual(preview['stats']['new'],4)
        self.assertEqual(preview['stats']['needs_date'],0)
        pipeline.commit_import(preview['job_id'],root=self.root)
        return pc.list_entries(100,self.root)

    def test_daily_dates_and_week_identity_remain_distinct(self):
        self.assertIsNone(guess_week('2025-01-29.md'))
        self.assertIsNone(guess_week('2025_01_29.md'))
        self.assertEqual(guess_week('2025_53-周记.md'),(2025,53))
        self.assertIsNone(guess_week('2025_54.md'))
        self.assertIsNone(guess_date('invalid.json','',{'date':'2025-02-30'}))
        entries=self.imported()
        self.assertEqual(sum(x['kind']=='weekly' for x in entries),2)
        for entry in entries:
            if entry['kind']=='weekly':self.assertIsNone(entry['journal_date'])

    def test_repeat_import_does_not_lock_or_create_new_revisions(self):
        entries=self.imported()
        revisions={x['entry_id']:x['current_revision_id'] for x in entries}
        preview=pipeline.preview_import(archive_payload(self.files),root=self.root)
        self.assertEqual(preview['stats']['duplicate'],4)
        result=pipeline.commit_import(preview['job_id'],root=self.root)
        self.assertEqual(result['changed'],[])
        self.assertEqual({x['entry_id']:x['current_revision_id'] for x in pc.list_entries(100,self.root)},revisions)

    def test_all_export_formats_roundtrip_without_invented_entries(self):
        self.imported()
        for fmt in ('markdown','json','csv'):
            with self.subTest(format=fmt):
                export=pc.export_entries(export_format=fmt,root=self.root)
                preview=pipeline.preview_import([{'name':export['filename'],'data_base64':base64.b64encode(export['data']).decode('ascii')}],root=self.root)
                self.assertEqual(preview['stats']['total'],4)
                self.assertEqual(preview['stats']['duplicate'],4)
                self.assertEqual(sum(x['kind']=='weekly' for x in preview['items']),2)
                pipeline.clear_import(preview['job_id'],self.root)

    def test_mixed_line_endings_are_preserved_as_canonical_lines(self):
        self.imported()
        path=self.root/'vault/memories/daily/2025/2025-01-29.md'
        text=path.read_text(encoding='utf-8')
        self.assertEqual(text,self.files['2025-01-29.md'].replace('\r\n','\n'))
        self.assertNotIn(b'\r\r',path.read_bytes())

    def test_weekly_revision_restore_preserves_kind_and_path(self):
        entry=next(x for x in self.imported() if x['kind']=='weekly')
        old=entry['current_revision_id'];original=pc.read_revision(old,self.root)['content']
        pc.save_entry(journal_date=None,sections={},entry_id=entry['entry_id'],source_path=entry['source_path'],kind='weekly',raw_markdown='### 本周总结\n新的版本\n',root=self.root)
        restored=pc.restore_revision(entry['entry_id'],old,self.root)
        current=pc.get_entry(entry_id=entry['entry_id'],root=self.root)
        self.assertEqual(current['kind'],'weekly')
        self.assertEqual(current['source_path'],entry['source_path'])
        self.assertEqual(pc.read_revision(restored['revision_id'],self.root)['content'],original)

    def test_invalid_calendar_dates_cannot_be_saved(self):
        with self.assertRaises(ValueError):
            pc.save_entry(journal_date='2025-02-30',sections={'日记':'日期应有效'},root=self.root)
        self.assertEqual(pc.list_entries(10,self.root),[])


if __name__=='__main__':unittest.main()
