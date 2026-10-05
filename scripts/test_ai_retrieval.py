"""Source selection regressions for dates, named subjects and limited evidence."""
import contextlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

from scripts.test_ai_workflows import initialize


class RetrievalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='lifeos-retrieval-')
        cls.root=Path(cls.temp.name)
        initialize(cls.root)
        from backend import server
        cls.server=server
        cls.c=sqlite3.connect(':memory:');cls.c.row_factory=sqlite3.Row
        cls.c.executescript('''
        CREATE TABLE memories(id INTEGER PRIMARY KEY,date TEXT,year INTEGER,week INTEGER,
          source_path TEXT,provenance_type TEXT,kind TEXT,date_anomaly INTEGER);
        CREATE TABLE sections(id INTEGER PRIMARY KEY,memory_id INTEGER,normalized_name TEXT,content TEXT);
        CREATE TABLE question_candidates(section_id INTEGER,date TEXT);
        ''')
        cls.rows=[
          ('2030-01-02','日记','GitHub account renamed to FixtureLoop.'),
          ('2030-01-03','日记','记录日记，讨论记录与资料。'*80),
          ('2030-04-10','日记','负责管理 GitHub repository.'),
          ('2030-06-24','日记','PRD 用英文写，交给 Codex 实现。'),
          ('2030-07-15','日程','补 PRD 和原型图'),
          ('2030-07-27','日记','把资料上传 GitHub，希望对方会看。'),
          ('2030-08-04','日记','在 GitHub 找到一个仓库'),
          ('2030-08-12','日记','用 GitHub 描述一个设想'),
          ('2030-05-18','心得与摘录','——《第十二次取消发送》'),
          ('2030-06-14','日记','忘了取消打车订单'),
          (None,'本周复盘','GitHub weekly summary')]
        for i,(day,section,text) in enumerate(cls.rows,1):
            cls.c.execute('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?)',(i,day,2030,20,f'source-{i}.md','daily_raw' if day else 'weekly_review','daily' if day else 'weekly',0))
            cls.c.execute('INSERT INTO sections VALUES(?,?,?,?)',(i,i,section,text))
        cls.c.commit()

    @classmethod
    def tearDownClass(cls):
        cls.c.close();cls.server.REFRESH_WORKER.stop();cls.temp.cleanup()

    def retrieve(self,q,cutoff=None):return self.server.retrieve(self.c,q,12,cutoff)

    def test_explicit_day_does_not_include_other_days_in_same_month(self):
        for question in ('2030年1月2日 GitHub 名称是什么？','2030-01-02 GitHub','2030/1/2 GitHub'):
            with self.subTest(question=question):
                self.assertEqual([e['date'] for e in self.retrieve(question)['evidence']],['2030-01-02'])

    def test_cutoff_in_question_keeps_earlier_months_and_excludes_future(self):
        for question in ('截止2030年6月30日，GitHub 有什么记录？','截至2030-06-30，GitHub 有什么记录？','2030-06-30之前，GitHub 有什么记录？'):
            with self.subTest(question=question):
                dates={e['date'] for e in self.retrieve(question,'2030-06-30')['evidence']}
                self.assertEqual(dates,{'2030-01-02','2030-04-10'})

    def test_year_month_and_explicit_ranges_retain_their_bounds(self):
        self.assertEqual({e['date'] for e in self.retrieve('2030年7月 PRD')['evidence']},{'2030-07-15'})
        self.assertEqual({e['date'] for e in self.retrieve('2030-06-01至2030-07-31 PRD')['evidence']},{'2030-06-24','2030-07-15'})
        self.assertEqual({e['date'] for e in self.retrieve('2030年6月和2030年7月 PRD')['evidence']},{'2030-06-24','2030-07-15'})

    def test_explicit_names_beat_repeated_question_vocabulary(self):
        ret=self.retrieve('按先后顺序概括这些 GitHub 记录，区分资料和日记')
        self.assertTrue(ret['evidence']);self.assertTrue(all('GitHub' in e['excerpt'] for e in ret['evidence']))
        self.assertNotIn('source-2.md',{e['source_path'] for e in ret['evidence']})

    def test_chronological_pack_keeps_earliest_and_latest_named_records(self):
        ret=self.retrieve('按先后顺序概括 GitHub 记录')
        dates={e['date'] for e in ret['evidence']}
        self.assertIn('2030-01-02',dates);self.assertIn('2030-08-12',dates)
        self.assertEqual(ret['query_intent'],'change')

    def test_unknown_explicit_subject_has_no_unrelated_evidence(self):
        for question in ('ZebraWidget 有哪些日记记录和资料？','“不存在的主题”有哪些记录？'):
            with self.subTest(question=question):
                ret=self.retrieve(question)
                self.assertEqual(ret['evidence'],[])
                self.assertEqual(ret['count'],0)

    def test_quoted_subject_preserves_section_and_actual_event_wording(self):
        ret=self.retrieve('这两条“取消”记录分别是什么类型？')
        self.assertEqual({e['source_path'] for e in ret['evidence']},{'source-9.md','source-10.md'})
        self.assertTrue(any(e['section']=='心得与摘录' for e in ret['evidence']))
        self.assertTrue(any('忘了取消' in e['excerpt'] for e in ret['evidence']))

    def test_past_boundary_does_not_include_undated_weekly_record(self):
        ret=self.retrieve('GitHub',cutoff='2030-06-30')
        self.assertTrue(all(e['provenance_type']=='daily_raw' and e['date']<='2030-06-30' for e in ret['evidence']))

    def test_invalid_calendar_days_do_not_silently_become_month_queries(self):
        for q in ('2030-02-30 GitHub','2030年13月 GitHub'):
            with self.subTest(q=q),self.assertRaises(ValueError):self.retrieve(q)


if __name__=='__main__':unittest.main()
