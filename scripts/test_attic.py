"""Serving regressions: real sources, unique writing dates, filtering and safe bounds."""
from pathlib import Path
import sqlite3
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import attic
from engine.rebuild_memory_engine import schema


class AtticTests(unittest.TestCase):
    def setUp(self):
        self.con=sqlite3.connect(':memory:')
        self.con.row_factory=sqlite3.Row
        schema(self.con)

    def tearDown(self):
        self.con.close()

    def memory(self,day,text='读书留下了新的问题',kind='daily',anomaly=0):
        mid=self.con.execute('SELECT COUNT(*)+1 FROM memories').fetchone()[0]
        self.con.execute('''INSERT INTO memories(id,kind,date,year,month,source_path,sha256,bytes,
            raw_text,date_anomaly,provenance_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
            (mid,kind,day,int(day[:4]),int(day[5:7]),f'fixture/{mid}.md','qa',len(text),text,anomaly,'user'))
        self.con.execute('INSERT INTO sections(memory_id,ordinal,name,normalized_name,content) VALUES(?,0,?,?,?)',
                         (mid,'日记','日记',text))
        return mid

    def topic(self,mid,name='阅读'):
        self.con.execute('INSERT INTO topic_mentions VALUES(?,?,1,?)',(mid,name,'[["读书",1]]'))

    def candidate(self,kind,mid,text):
        day=self.con.execute('SELECT date FROM memories WHERE id=?',(mid,)).fetchone()[0]
        self.con.execute(f'INSERT INTO {attic.TABLES[kind]}(memory_id,date,text,trigger,source_type) VALUES(?,?,?,?,?)',
                         (mid,day,text,'读书','raw'))

    def test_empty_archive_has_twelve_empty_months(self):
        d=attic.overview(self.con,'2026')
        self.assertEqual((d['pages'],d['recorded_days'],d['topics'],d['ledger']),(0,0,[],[]))
        self.assertEqual(len(d['months']),12)

    def test_counts_unique_dates_and_excludes_blank_weekly_anomalous(self):
        for args in [('2025-04-12','读书'),('2025-04-12','读书笔记'),('2025-04-13','读书'),
                     ('2025-04-14',''),('2025-04-15','读书','weekly'),('2030-01-01','读书','daily',1)]:
            self.topic(self.memory(*args))
        d=attic.overview(self.con)
        self.assertEqual(d['year'],'2025')
        self.assertEqual((d['recorded_days'],d['months'][3]['pages'],d['topics'][0]['days']),(2,3,2))
        self.assertEqual(d['topics'][0]['first']['source_path'],'fixture/1.md')
        self.assertEqual(d['topics'][0]['last']['source_path'],'fixture/3.md')

    def test_single_source_and_excerpt_uses_matched_alias(self):
        mid=self.memory('2025-01-01','普通记录')
        self.con.execute('INSERT INTO sections(memory_id,ordinal,name,normalized_name,content) VALUES(?,1,?,?,?)',
                         (mid,'随记','随记','<strong>读书留下的原句</strong>'))
        self.topic(mid)
        t=attic.overview(self.con)['topics'][0]
        self.assertEqual(t['first']['id'],t['last']['id'])
        self.assertEqual(t['first']['excerpt'],'读书留下的原句')

    def test_pagination_and_topic_year_filters(self):
        for day,name in [('2024-01-01','阅读'),('2025-01-01','阅读'),('2025-02-01','旅行')]:
            self.topic(self.memory(day),name)
        self.assertEqual(attic.review(self.con,'阅读','2025')['total'],1)
        first=attic.review(self.con,limit=1)
        second=attic.review(self.con,offset=1,limit=1)
        self.assertTrue(first['has_more'])
        self.assertNotEqual(first['items'][0]['id'],second['items'][0]['id'])
        self.assertEqual(attic.month_pages(self.con,'2025-02')['total'],1)

    def test_ledger_keeps_sources_separate_and_filters_categories(self):
        mid=self.memory('2025-01-01')
        for kind in attic.TABLES:
            self.candidate(kind,mid,f'{kind} 原句')
        result=attic.ledger(self.con,'project','2025')
        self.assertEqual(result['total'],1)
        self.assertEqual(result['items'][0]['source_path'],'fixture/1.md')
        self.assertEqual(len(attic.overview(self.con)['ledger']),3)
        for value in ('project','question','decision'):
            self.assertEqual(attic.lineage(self.con,value,1)['item']['text'],f'{value} 原句')
        self.assertIsNone(attic.lineage(self.con,'decision',999))

    def test_related_pages_require_same_topic_and_thirty_day_window(self):
        decision=self.memory('2025-01-01');self.topic(decision);self.candidate('decision',decision,'决定读书')
        self.topic(self.memory('2025-01-05'))
        self.topic(self.memory('2025-01-07'),'旅行')
        self.topic(self.memory('2025-03-01'))
        result=attic.lineage(self.con,'decision',1)
        self.assertEqual([r['date'] for r in result['related']],['2025-01-05'])

    def test_invalid_filter_cannot_select_arbitrary_table(self):
        with self.assertRaises(ValueError):attic.ledger(self.con,"project_candidates;DROP TABLE memories")
        with self.assertRaises(ValueError):attic.overview(self.con,'2025 OR 1=1')
        with self.assertRaises(ValueError):attic.month_pages(self.con,'2025-13')
        self.assertEqual(attic.page_args(-10,10000),(0,100))


if __name__=='__main__':
    unittest.main()
