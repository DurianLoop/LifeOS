"""The writer's calendar must reach old entries and skip deleted/weekly pages."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import product_core


class WriterDateIndexTests(unittest.TestCase):
    def test_monthly_content_markers_skip_empty_saved_pages(self):
        with tempfile.TemporaryDirectory(prefix='lifeos-writer-dates-') as directory:
            root = Path(directory)
            for day, title, body in [('01', '', ''), ('02', '', '<div><br>&nbsp;</div>'),
                                     ('03', '', '<b>有正文</b>'), ('04', '只有题名', '')]:
                product_core.save_entry(journal_date=f'2026-10-{day}', title=title,
                                        sections={'日记': body}, root=root, enqueue_sync=False)
            product_core.save_entry(journal_date='2026-09-01', sections={'日记': '上月'},
                                    root=root, enqueue_sync=False)
            result = product_core.list_daily_dates(root, '2026-10-01', '2026-10-31', True)
            self.assertEqual({item['date']: item['saved'] for item in result}, {
                '2026-10-01': False, '2026-10-02': False, '2026-10-03': True, '2026-10-04': True})

    def test_archive_dates_are_unlimited_deduplicated_and_current(self):
        with tempfile.TemporaryDirectory(prefix='lifeos-writer-dates-') as directory:
            root = Path(directory)
            con = product_core.connect(root)
            rows = []
            for index in range(2200):
                # Unique valid ISO dates, much older than the newest 2,000 entries.
                import datetime
                date = (datetime.date(2010, 1, 1) + datetime.timedelta(days=index)).isoformat()
                rows.append((f'entry-{index}', 'daily', date, f'memories/{index}.md', '2020-01-01', None))
            rows.extend([
                ('newest', 'daily', '2010-01-01', 'memories/newest.md', '2026-01-01', None),
                ('deleted', 'daily', '2001-01-01', 'memories/deleted.md', '2026-01-01', '2026-01-02'),
                ('weekly', 'weekly', '2002-01-01', 'memories/weekly.md', '2026-01-01', None),
                ('invalid', 'daily', 'not-a-date', 'memories/invalid.md', '2026-01-01', None),
            ])
            con.executemany('''INSERT INTO entries
                (entry_id, kind, journal_date, source_path, created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, '2020-01-01', ?, ?)''', rows)
            con.commit()
            con.close()
            result = product_core.list_daily_dates(root)
            self.assertEqual(len(result), 2200)
            self.assertEqual(result[-1], {'date': '2010-01-01', 'source_path': 'memories/newest.md', 'saved': True})
            self.assertTrue(all(item['saved'] for item in result))
            self.assertEqual([item['date'] for item in result], sorted({row[2] for row in rows[:2200]}, reverse=True))


if __name__ == '__main__':
    unittest.main()
