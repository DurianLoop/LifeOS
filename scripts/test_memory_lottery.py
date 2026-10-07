"""Local memory draws stay useful before indexing and open current source pages."""
from pathlib import Path
import ast
import hashlib
import json
import random
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import memory_lottery as lottery
from engine import product_core as product, rebuild_memory_engine as index
from engine import surprise_engine, discovery_engine


class MemoryLotteryTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='lifeos-memory-draw-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        product.set_settings({'refresh.background_enabled': False}, self.root)
        (self.root / 'data').mkdir()
        self.database = self.root / 'data/lifeos.db'
        self.con = sqlite3.connect(self.database)
        self.con.row_factory = sqlite3.Row
        self.addCleanup(self.con.close)
        index.schema(self.con)
        surprise_engine.ensure_schema(self.con)
        discovery_engine.ensure_schema(self.con)

    def save(self, day='2026-10-01', text='灯火下写了一页新日记', title='今晚', kind='daily'):
        kwargs = {'journal_date': day, 'sections': {'日记': text}, 'title': title, 'kind': kind, 'root': self.root}
        if kind == 'weekly':
            kwargs['source_path'] = 'memories/weekly/2026/2026_40.md'
        return product.save_entry(**kwargs)

    def indexed(self, day, text='原文里有一段共同的回忆', canonical=True):
        if canonical:
            saved = self.save(day, text)
            path = saved['source_path']
        else:
            path = f'memories/daily/{day[:4]}/{day}.md'
            file = self.root / 'vault' / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('### 日记\n' + text, encoding='utf-8')
        raw = (self.root / 'vault' / path).read_bytes()
        cur = self.con.execute('''INSERT INTO memories(kind,date,year,month,source_path,sha256,bytes,raw_text,provenance_type)
            VALUES('daily',?,?,?,?,?,?,?,'daily_raw')''', (day, int(day[:4]), int(day[5:7]), path,
            hashlib.sha256(raw).hexdigest(), len(raw), raw.decode()))
        mid = cur.lastrowid
        self.con.execute('INSERT INTO sections(memory_id,ordinal,name,normalized_name,content) VALUES(?,0,?,?,?)',
                         (mid, '日记', '日记', text))
        self.con.execute('INSERT INTO memory_metrics VALUES(?,?,?,?,0)', (mid, len(text), 1, 1))
        self.con.commit()
        return mid, path

    def echo(self, left, right):
        self.con.execute('''INSERT INTO memory_echoes(left_memory_id,right_memory_id,left_date,right_date,
            days_apart,score,shared_terms_json,reason) VALUES(?,?,'2025-01-01','2026-01-01',365,1,'["共同回忆"]','INTERNAL REASON')''',
            (left, right))
        self.con.commit()

    def route(self, path, query):
        # Execute the checked-in handler method without its process startup,
        # environment files, refresh worker, or access to the user's real Vault.
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'backend/server.py').read_text(encoding='utf-8'))
        handler = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
        method = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == 'api_get')
        def database():
            con = sqlite3.connect(self.database)
            con.row_factory = sqlite3.Row
            return con
        namespace = {'ROOT': self.root, 'db': database, 'memory_lottery': lottery, 'product': product,
                     'jrow': lambda row: dict(row) if row else None,
                     'rows': lambda result: [dict(row) for row in result],
                     'sections_for': lambda con, mid: {row['normalized_name']: row['content'] for row in
                         con.execute('SELECT normalized_name,content FROM sections WHERE memory_id=?', (mid,))},
                     'journal_context': lambda *args: {'indexed': True}}
        exec(compile(ast.Module(body=[method], type_ignores=[]), 'backend/server.py', 'exec'), namespace)
        class Receiver:
            def send_json(self, body, status=200):
                return body, status
        return namespace['api_get'](Receiver(), path, query)

    def test_empty_and_single_unindexed_entry(self):
        empty = lottery.draw(self.con, self.root, 'memory')
        self.assertIsNone(empty['item'])
        self.assertIn('导入', empty['empty_reason'])
        saved = self.save()
        draw = lottery.draw(self.con, self.root, 'memory')
        self.assertEqual(draw['available_count'], 1)
        self.assertEqual(draw['item']['source_path'], saved['source_path'])
        self.assertEqual(draw['sources'][0]['excerpt'], '灯火下写了一页新日记')
        self.assertEqual(set(draw['sources'][0]), {'source_path', 'date', 'kind', 'title', 'excerpt'})
        self.assertFalse(draw['repeated'])

    def test_many_entries_avoid_recent_draws_then_restart(self):
        for day in range(1, 4):
            self.save(f'2026-10-0{day}')
        seen = []
        for _ in range(3):
            draw = lottery.draw(self.con, self.root, 'memory', json.dumps(seen), random.Random(7))
            self.assertNotIn(draw['draw_id'], seen)
            self.assertFalse(draw['repeated'])
            seen.append(draw['draw_id'])
        self.assertTrue(lottery.draw(self.con, self.root, 'memory', seen)['repeated'])

    def test_single_entry_cycle_marks_repeated(self):
        self.save()
        first = lottery.draw(self.con, self.root, 'memory')
        again = lottery.draw(self.con, self.root, 'memory', [first['draw_id']])
        self.assertEqual(again['draw_id'], first['draw_id'])
        self.assertTrue(again['repeated'])

    def test_weekly_entries_and_raw_sources_are_drawable(self):
        self.save(kind='weekly')
        _, path = self.indexed('2025-12-31', canonical=False)
        pool = lottery._sources(self.con, self.root)
        self.assertEqual(len(pool), 2)
        weekly = next(value for value in pool.values() if value['kind'] == 'weekly')
        self.assertEqual(weekly['date'], '2026_W40')
        self.assertIn(path, pool)

    def test_blank_templates_do_not_occupy_pool(self):
        self.save(text='', title='')
        self.assertEqual(lottery.draw(self.con, self.root, 'memory')['available_count'], 0)

    def test_sources_use_current_original_and_stable_id_after_indexing(self):
        saved = self.save(text='最初的正文')
        first = lottery.draw(self.con, self.root, 'memory')
        self.indexed('2026-10-01', '更改后的正文')
        second = lottery.draw(self.con, self.root, 'memory')
        self.assertEqual(second['draw_id'], first['draw_id'])
        self.assertEqual(second['available_count'], 1)
        self.assertEqual(second['item']['excerpt'], '更改后的正文')
        self.assertEqual(second['item']['source_path'], saved['source_path'])

    def test_excerpt_removes_metadata_html_and_limits_text(self):
        self.save(text='<b>原文</b>\n' + '山' * 600)
        preview = lottery.draw(self.con, self.root, 'memory')['item']['excerpt']
        self.assertTrue(preview.startswith('原文 '))
        self.assertNotIn('lifeos_entry_id', preview)
        self.assertNotIn('<b>', preview)
        self.assertEqual(len(preview), 321)

    def test_deleted_missing_and_unsafe_sources_never_draw(self):
        _, deleted = self.indexed('2026-10-01')
        _, missing = self.indexed('2026-10-02')
        con = product.connect(self.root)
        try:
            con.execute('UPDATE entries SET deleted_at=? WHERE source_path=?', ('2026-10-03', deleted)); con.commit()
        finally:
            con.close()
        (self.root / 'vault' / missing).unlink()
        self.con.execute("UPDATE memories SET source_path='../secret.md' WHERE source_path=?", (missing,)); self.con.commit()
        self.assertEqual(lottery.draw(self.con, self.root, 'memory')['available_count'], 0)
        self.assertIsNone(lottery.current_source(self.root, deleted))
        for value in ('../secret.md', '/memories/daily/a.md', 'C:/secret.md', 'memories/daily/../secret.md',
                      'memories\\daily\\2026\\a.md', 'memories/daily/2026/a.txt', 'memories//daily/2026/a.md'):
            self.assertIsNone(lottery.source_file(self.root, value))

    def test_symlink_or_junction_cannot_escape_vault(self):
        target = self.root / 'outside'; target.mkdir()
        (target / '2026-10-07.md').write_text('私人外部文件', encoding='utf-8')
        link = self.root / 'vault/memories/daily/2026'; link.parent.mkdir(parents=True)
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            if sys.platform != 'win32':
                raise
            # Windows directory junctions expose the same escape without
            # requiring Developer Mode or administrator symlink privileges.
            import _winapi
            _winapi.CreateJunction(str(target), str(link))
        self.assertIsNone(lottery.source_file(self.root, 'memories/daily/2026/2026-10-07.md'))

    def test_echo_requires_two_existing_sources_and_preserves_old_item_fields(self):
        left, left_path = self.indexed('2025-01-01')
        right, right_path = self.indexed('2026-01-01')
        self.echo(left, right)
        draw = lottery.draw(self.con, self.root, 'echo')
        self.assertEqual(draw['type'], 'echo')
        self.assertEqual(draw['item']['left_source'], left_path)
        self.assertEqual(draw['item']['right_source'], right_path)
        self.assertEqual(len(draw['sources']), 2)
        self.assertNotIn('INTERNAL', draw['item']['reason'])
        (self.root / 'vault' / right_path).unlink()
        self.assertIsNone(lottery.draw(self.con, self.root, 'echo')['item'])

    def test_echo_pool_deduplicates_reversed_pairs(self):
        left, _ = self.indexed('2025-01-01')
        right, _ = self.indexed('2026-01-01')
        self.echo(left, right); self.echo(right, left)
        self.assertEqual(lottery.draw(self.con, self.root, 'echo')['available_count'], 1)

    def test_mixed_without_openable_clues_falls_back_to_memory(self):
        self.save()
        self.con.execute("INSERT INTO curiosity_cards(card_type,title,body,source_paths_json) VALUES('density','ENGLISH','internal','[\"../secret.md\"]')")
        mixed = lottery.draw(self.con, self.root)
        self.assertEqual(mixed['mode'], 'mixed')
        self.assertEqual(mixed['type'], 'memory')
        echo = lottery.draw(self.con, self.root, 'echo')
        self.assertIsNone(echo['item'])
        self.assertIn('抽一页日记', echo['empty_reason'])

    def test_mixed_cards_keep_valid_sources_and_chinese_display(self):
        saved = self.save()
        self.con.execute('INSERT INTO curiosity_cards(card_type,title,body,source_paths_json) VALUES(?,?,?,?)',
            ('density', 'ENGLISH INTERNAL', 'raw internals', json.dumps([saved['source_path'], '../secret.md'])))
        draw = lottery.draw(self.con, self.root)
        self.assertEqual(draw['type'], 'card')
        self.assertEqual(draw['item']['source_paths'], [saved['source_path']])
        self.assertEqual(draw['item']['title'], '浓墨一日')
        self.assertEqual(len(draw['sources']), 1)

    def test_unindexed_canonical_page_opens_via_journal_route(self):
        saved = self.save()
        draw, status = self.route('/api/serendipity', {'mode': ['memory']})
        self.assertEqual(status, 200)
        page, status = self.route('/api/journal', {'path': [draw['item']['source_path']]})
        self.assertEqual(status, 200)
        self.assertEqual(page['memory']['source_path'], saved['source_path'])
        self.assertEqual(page['sections']['日记'], '灯火下写了一页新日记')
        self.assertIn('灯火下写了一页新日记', page['memory']['raw_text'])
        self.assertEqual(len(page['revisions']), 1)
        self.assertIsNone(page['memory']['id'])

    def test_stale_index_journal_reads_current_canonical_text(self):
        _, path = self.indexed('2026-10-01', '旧内容')
        self.save(text='刚刚保存的新内容')
        page, status = self.route('/api/journal', {'path': [path]})
        self.assertEqual(status, 200)
        self.assertEqual(page['sections']['日记'], '刚刚保存的新内容')
        self.assertEqual(len(page['revisions']), 2)
        self.assertEqual(page['skills'], [])
        self.assertNotIn('indexed', page['context'])

    def test_current_derived_journal_keeps_indexed_context(self):
        mid, path = self.indexed('2026-10-01')
        page, status = self.route('/api/journal', {'path': [path]})
        self.assertEqual(status, 200)
        self.assertEqual(page['memory']['id'], mid)
        self.assertTrue(page['context']['indexed'])

    def test_raw_source_edit_reads_current_text_without_canonical_registration(self):
        _, path = self.indexed('2025-01-01', canonical=False)
        (self.root / 'vault' / path).write_text('### 日记\n原文件刚更新的正文', encoding='utf-8')
        page, status = self.route('/api/journal', {'path': [path]})
        self.assertEqual(status, 200)
        self.assertEqual(page['sections']['日记'], '原文件刚更新的正文')
        self.assertIsNone(page['product_entry'])
        self.assertEqual(page['revisions'], [])

    def test_journal_rejects_missing_deleted_and_outside_paths(self):
        _, path = self.indexed('2026-10-01')
        (self.root / 'vault' / path).unlink()
        for value in (path, '../secret.md', 'C:/secret.md'):
            self.assertEqual(self.route('/api/journal', {'path': [value]})[1], 404)

    def test_bounded_bad_history_and_invalid_mode_are_client_errors(self):
        for value in ('{bad', '{}', '[1]', json.dumps(['a'] * 121), json.dumps(['a' * 161]), 'x' * 20001):
            with self.assertRaises(ValueError):
                lottery.draw(self.con, self.root, 'memory', value)
            _, status = self.route('/api/serendipity', {'exclude': [value]})
            self.assertEqual(status, 400)
        self.assertEqual(self.route('/api/serendipity', {'mode': ['invalid']})[1], 400)

    def test_new_install_without_derived_tables_still_draws(self):
        self.save()
        empty = sqlite3.connect(':memory:'); empty.row_factory = sqlite3.Row
        try:
            self.assertEqual(lottery.draw(empty, self.root, 'memory')['available_count'], 1)
            self.assertEqual(lottery.draw(empty, self.root, 'mixed')['type'], 'memory')
            self.assertIsNone(lottery.draw(empty, self.root, 'echo')['item'])
        finally:
            empty.close()


if __name__ == '__main__':
    unittest.main()
