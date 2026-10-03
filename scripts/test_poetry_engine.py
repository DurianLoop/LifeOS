import datetime as dt
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from engine import poetry_engine, product_core


class DailyPoetryTests(unittest.TestCase):
    def test_catalog_and_daily_history(self):
        poems = poetry_engine.catalog()
        self.assertGreaterEqual(len(poems), 30)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            calls = []
            days = ['2026-09-26', '2026-09-27']
            for day in days:
                product_core.save_entry(journal_date=day, sections={'日记': '今天经历了挫折，仍想继续前行。'}, root=root)

            def choose(messages, **_kwargs):
                choices = json.loads(messages[1]['content'])['candidates']
                calls.append(choices)
                result = {'poem_id': choices[0]['poem_id'], 'reason': '今日虽遇阻，仍有向前之念；取此诗相照，愿来日能见远处之光。'}
                return {'text': json.dumps(result, ensure_ascii=False)}

            first = poetry_engine.generate(days[0], root, chat=choose)['current']
            again = poetry_engine.generate(days[0], root, chat=choose)['current']
            second = poetry_engine.generate(days[1], root, chat=choose)['current']
            self.assertEqual(first['poem_id'], again['poem_id'])
            self.assertNotEqual(first['poem_id'], second['poem_id'])
            self.assertEqual(len(calls), 2)
            state = poetry_engine.status(days[1], root)
            self.assertEqual(len(state['history']), 2)
            self.assertEqual(state['remaining'], len(poems) - 2)
            self.assertFalse(state['auto_enabled'])

    def test_empty_journal_does_not_send(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            product_core.save_entry(journal_date=dt.date.today().isoformat(), sections={}, root=root)
            with self.assertRaises(poetry_engine.PoetryError):
                poetry_engine.generate(root=root, chat=lambda *_args, **_kwargs: self.fail('AI must not be called'))
            self.assertFalse(poetry_engine.schedule(dt.date.today().isoformat(), root))

    def test_auto_generation_is_opt_in_and_runs_once(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = dt.date.today().isoformat()
            product_core.save_entry(journal_date=day, sections={'日记': '今天虽然疲惫，仍觉得有希望。'}, root=root)
            self.assertFalse(poetry_engine.schedule(day, root))
            poetry_engine.set_auto(True, root)
            calls = []

            def choose(messages, **_kwargs):
                candidates = json.loads(messages[1]['content'])['candidates']
                calls.append(1)
                return {'text': json.dumps({'poem_id': candidates[0]['poem_id'],
                                             'reason': '今日虽有倦意，心中希望未灭；此句写向前之意，正与你今日所记相照。'},
                                            ensure_ascii=False)}

            with patch('backend.ai_providers.availability', return_value={'available':True,'configured':True,'enabled':True,'requires_remote':True,'reason':''}), patch('backend.ai_providers.chat', side_effect=choose):
                self.assertTrue(poetry_engine.schedule(day, root))
                self.assertFalse(poetry_engine.schedule(day, root))
                for _ in range(50):
                    if poetry_engine.status(day, root)['current']:
                        break
                    time.sleep(0.05)
            self.assertIsNotNone(poetry_engine.status(day, root)['current'])
            self.assertEqual(len(calls), 1)

    def test_ai_cannot_insert_an_unlisted_poem(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = dt.date.today().isoformat()
            product_core.save_entry(journal_date=day, sections={'日记': '今天想起了故乡。'}, root=root)
            fake = {'text': json.dumps({'poem_id': 'invented', 'reason': '今日日记写到故乡，此诗可与这份思念相照。'}, ensure_ascii=False)}
            with self.assertRaises(poetry_engine.PoetryError):
                poetry_engine.generate(day, root, chat=lambda *_args, **_kwargs: fake)
            self.assertEqual(poetry_engine.status(day, root)['history'], [])

    def test_invalid_model_json_is_rejected_with_a_retry_message(self):
        poem = poetry_engine.catalog()[0]
        for response in ('null', '[]', '42', '"a poem"', json.dumps({
            'poem_id': poem['id'], 'reason': ['Not a prose explanation'],
        })):
            with self.subTest(response=response):
                with self.assertRaisesRegex(poetry_engine.PoetryError, '格式无效'):
                    poetry_engine._parse_choice(response, [poem])

    def test_disabling_auto_cancels_a_queued_job(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = dt.date.today().isoformat()
            product_core.save_entry(journal_date=day, sections={'日记': '今日与家人相聚。'}, root=root)
            poetry_engine.set_auto(True, root)
            with patch('engine.poetry_engine.threading.Thread') as thread, \
                    patch('backend.ai_providers.availability', return_value={'available':True,'configured':True,'enabled':True,'requires_remote':True,'reason':''}), \
                    patch('backend.ai_providers.chat') as chat:
                self.assertTrue(poetry_engine.schedule(day, root))
                work = thread.call_args.kwargs['target']
                poetry_engine.set_auto(False, root)
                work()
                chat.assert_not_called()
            state = poetry_engine.status(day, root)
            self.assertFalse(state['auto_enabled'])
            self.assertFalse(state['generating'])
            self.assertIsNone(state['current'])
            self.assertFalse(poetry_engine.schedule(day, root))

    def test_existing_poem_is_available_with_ai_disabled(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = dt.date.today().isoformat()
            product_core.save_entry(journal_date=day, sections={'日记': '今日与家人相聚。'}, root=root)

            def choose(messages, **_kwargs):
                poem_id = json.loads(messages[1]['content'])['candidates'][0]['poem_id']
                return {'text': json.dumps({'poem_id': poem_id, 'reason': '今日与家人相聚，心有所归；此诗可与今日所记相照。'})}

            first = poetry_engine.generate(day, root, chat=choose)['current']
            with patch('backend.ai_providers.availability', return_value={'available':False,'configured':False,'enabled':False,'requires_remote':True,'reason':'AI已关闭'}), \
                    patch('backend.ai_providers.chat') as chat:
                again = poetry_engine.generate(day, root)
                state = poetry_engine.status(day, root)
                chat.assert_not_called()
            self.assertTrue(again['existing'])
            self.assertEqual(again['current'], first)
            self.assertEqual(state['history'], [first])

    def test_invalid_date_has_a_clear_validation_error(self):
        for day in ('2026-02-30', '20260928', 123):
            with self.subTest(day=day), self.assertRaisesRegex(poetry_engine.PoetryError, '日期格式'):
                poetry_engine.status(day)


if __name__ == '__main__':
    unittest.main()
