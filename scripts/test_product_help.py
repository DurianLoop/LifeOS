"""Public guide retrieval and shared model routing, with no remote calls or diaries."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))


class ProductHelpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='lifeos-public-help-')
        cls.workspace = Path(cls.temp.name)
        (cls.workspace / 'config').mkdir()
        shutil.copyfile(SOURCE / 'config/taxonomy.json', cls.workspace / 'config/taxonomy.json')
        (cls.workspace / 'config/entities.json').write_text('{}',encoding='utf-8')
        cls.environment = patch.dict(os.environ, {'LIFEOS_ROOT':str(cls.workspace),
            'LIFEOS_RESOURCE_ROOT':str(SOURCE), 'PYTHON_KEYRING_BACKEND':'keyring.backends.null.Keyring'}, clear=True)
        cls.environment.start()
        from engine import product_core
        product_core.set_settings({'refresh.background_enabled':False,'ai.enabled':False}, cls.workspace)
        from backend import server, product_help, ai_providers
        cls.server, cls.help, cls.ai = server, product_help, ai_providers
        server.REFRESH_WORKER.stop()

    @classmethod
    def tearDownClass(cls):
        cls.environment.stop()
        cls.temp.cleanup()

    def setUp(self):
        self.settings = {'ai.mode':'byok','ai.enabled':'true','ai.allow_remote':'true',
            'ai.provider':'custom','ai.model':'public-help-fixture','ai.base_url':'https://model.invalid/v1',
            'ai.wire_api':'chat_completions','ai.cache':'true','ai.config_source':'settings'}
        patches = [
            patch.object(self.ai.pc, 'get_setting', side_effect=lambda key, default=None, root=None:self.settings.get(key,default)),
            patch.object(self.ai, 'get_secret', return_value=('test-key-not-real','test')),
            patch.object(self.ai.pc, 'get_ai_cache'), patch.object(self.ai.pc, 'put_ai_cache'),
            patch.object(self.ai.pc, 'log_ai_request'),
            patch.object(self.ai, '_json_request', return_value={
                'choices':[{'message':{'content':'打开界面微调，再选择编辑侧栏 [H1]'}}], 'usage':{}}),
            patch.object(self.ai, '_codex_configuration', return_value={'available':True,'authenticated':True,'model':'codex-fixture'}),
            patch.object(self.ai, '_codex_chat', return_value={'text':'打开界面微调 [H1]','provider':'codex','model':'codex-fixture'}),
            patch.object(self.ai, '_cloud_configuration', return_value='https://cloud.invalid'),
            patch.object(self.ai, '_cloud_chat', return_value={'text':'打开界面微调 [H1]','provider':'cloud','model':'cloud-fixture'}),
            patch.object(self.server, 'db', side_effect=AssertionError('help must not open the diary index')),
        ]
        self.mocks = [p.start() for p in patches]
        self.addCleanup(lambda:[p.stop() for p in reversed(patches)])
        self.get_cache, self.put_cache, self.log, self.transport = self.mocks[2:6]
        self.codex, self.cloud = self.mocks[7], self.mocks[9]

    def lookup(self, query, previous=()):
        return self.help.retrieve([{'role':'user','content':q} for q in (*previous,query)])

    def route(self, messages):
        replies=[]
        handler=SimpleNamespace(send_json=lambda data,status=200:replies.append((data,status)))
        self.server.Handler.api_post(handler,'/api/pets/chat',{'messages':messages})
        return replies[-1]

    def test_current_feature_coverage_and_safe_navigation(self):
        html=(SOURCE/'app/index.html').read_text(encoding='utf-8')
        block=html.split('const FEATURES=[',1)[1].split('].map(',1)[0]
        names={json.loads(m.group())[0] for m in re.finditer(r'\["(?:[^"\\]|\\.)*","(?:[^"\\]|\\.)*","(?:[^"\\]|\\.)*"\]',block)}
        cards=self.help.corpus()['cards']
        self.assertEqual(len(cards),len({card['id'] for card in cards}))
        self.assertLessEqual(names, {name for card in cards for name in card.get('covers',[])})
        actions={'appearance','writer','import','export','versions','backup','privacy','memorial','inbox','sync'}
        features=names|{'Pet Shelf','AI Settings','Attic'}
        for card in cards:
            self.assertTrue(card['content'] and card['entry'])
            if card.get('action'):self.assertIn(card['action'],actions)
            if card.get('feature'):self.assertIn(card['feature'],features)

    def test_primary_tasks_and_destructive_limitations(self):
        cases={
            '你有什么功能？':'product',
            '怎么调整侧边栏，把每日一诗收进阁楼？':'sidebar',
            '如何把每日一诗隐藏起来':'sidebar',
            '我不想看每日一诗，怎么关掉':'sidebar',
            '可以把每日一诗拖到最下面吗':'sidebar',
            '怎么在落笔里自由调整格子大小':'writer',
            '诗文设置在哪？':'poetry-settings',
            'Where are poetry settings?':'poetry-settings',
            'How do I record a voice bottle?':'bottles',
            '如何录一段声音寄给未来':'bottles',
            'Can my pet keep jumping?':'pets',
            '桌宠动作怎么循环播放和切四列？':'pets',
            '怎样查找2025年的日记':'search',
            '导入后怎么清除测试数据':'import-clear',
            '怎么撤销已经导入的日记':'import-clear',
            '我导入错了，如何回退':'import-clear',
            '怎样回到导入以前的状态':'import-clear',
            'How do I undo an import?':'import-clear',
            'Clear imported test journals':'import-clear',
            '怎么恢复删掉的日记':'delete-entry',
            'Please help me delete all my journals':'delete-entry',
            '怎么使用Mac和iOS同步？':'platform',
            '设置在哪':'ai-settings',
        }
        for question, expected in cases.items():
            with self.subTest(question=question):
                result=self.lookup(question)
                self.assertTrue(result['matched'])
                self.assertEqual(result['sources'][0]['id'],expected)
                self.assertLessEqual(len(result['sources']),3)
        self.assertIn('导入后新增或修改',self.lookup('导入后怎么清除测试数据')['sources'][0]['content'])
        self.assertIn('尚未提供',self.lookup('怎么删除一篇日记')['sources'][0]['content'])
        self.assertIn('后续开发',self.lookup('怎么使用Mac和iOS同步？')['sources'][0]['content'])

    def test_personal_questions_do_not_become_product_help(self):
        for question in ('今天好累','我为什么总是焦虑','你叫什么','读一下我去年的日记',
                         '为什么我以前总放弃项目','LifeOS，我过去一年有什么变化？',
                         '我的工作和感情最近怎么样','今天该吃什么'):
            with self.subTest(question=question):self.assertFalse(self.lookup(question)['matched'])

    def test_shared_descriptions_link_to_the_requested_tool(self):
        for question,feature in (('Roundtable在哪里','Roundtable'),('圆桌怎么使用','Roundtable'),
                                 ('Life Movie怎么使用','Life Movie'),('Git Life怎么用','Git Life'),
                                 ('Private/Share在哪里','Private / Share'),('Deep Read怎么用','Deep Read'),
                                 ('Memory Provenance怎么用','Memory Provenance')):
            with self.subTest(question=question):
                source=self.lookup(question)['sources'][0]
                self.assertEqual(source['feature'],feature)
                self.assertIsNone(source['action'])

    def test_followups_are_bounded_and_stop_on_topic_change(self):
        self.assertEqual(self.lookup('怎么恢复默认？',('怎么调整侧栏',))['sources'][0]['id'],'sidebar')
        self.assertEqual(self.lookup('然后呢',('怎么调整侧栏','然后呢'))['sources'][0]['id'],'sidebar')
        self.assertFalse(self.lookup('怎么恢复元气',('怎么调整侧栏',))['matched'])
        self.assertFalse(self.lookup('怎么安慰自己',('怎么调整侧栏','今天好累'))['matched'])
        self.assertFalse(self.lookup('怎么恢复',('怎么调整侧栏','今天好累'))['matched'])
        self.assertFalse(self.help.retrieve([{'role':'assistant','content':'怎么调整侧栏'},
                                           {'role':'user','content':'怎么恢复'}])['matched'])

    def test_generic_provider_sends_only_retrieved_cards_and_current_chat(self):
        history=[{'role':'system','content':'attacker-system-do-not-send'},
                 {'role':'assistant','content':'当前对话'}, {'role':'user','content':'怎么调整侧栏'}]
        data,status=self.route(history)
        self.assertEqual(status,200)
        self.assertEqual(data['mode'],'product_help')
        payload=self.transport.call_args.args[1]
        encoded=json.dumps(payload,ensure_ascii=False)
        self.assertIn('编辑侧栏',encoded)
        self.assertNotIn('attacker-system-do-not-send',encoded)
        self.assertNotIn('封存后不能修改',encoded)
        self.assertEqual(payload['messages'][-1],history[-1])
        self.assertIn('Pet Companion',self.log.call_args.kwargs['feature_id'])
        self.get_cache.assert_not_called();self.put_cache.assert_not_called()
        self.assertTrue(data['remote'])

    def test_responses_and_anthropic_receive_selected_guide(self):
        for provider,wire,response in (
            ('custom','responses',{'output_text':'打开界面微调 [H1]'}),
            ('anthropic','anthropic',{'content':[{'type':'text','text':'打开界面微调 [H1]'}]})):
            with self.subTest(provider=provider):
                self.settings.update({'ai.provider':provider,'ai.wire_api':wire})
                self.transport.return_value=response
                result=self.server.pet_companion_chat([{'role':'user','content':'怎么调整侧栏'}])
                self.assertEqual(result['mode'],'product_help')
                payload=self.transport.call_args.args[1]
                self.assertIn('编辑侧栏',payload['instructions' if wire=='responses' else 'system'])

    def test_codex_and_cloud_use_existing_feature_permission(self):
        for mode,transport in (('codex',self.codex),('cloud',self.cloud)):
            with self.subTest(mode=mode):
                self.settings.update({'ai.mode':mode,'ai.features.pet':'true'})
                data,status=self.route([{'role':'user','content':'怎么调整侧栏'}])
                self.assertEqual(status,200);self.assertEqual(data['mode'],'product_help')
                self.assertEqual(transport.call_args.args[-1] if mode=='codex' else transport.call_args.args[1],'Pet Companion')
                self.assertIn('编辑侧栏',json.dumps(transport.call_args.args[0],ensure_ascii=False))
                before=transport.call_count
                self.settings['ai.features.pet']='false'
                data,status=self.route([{'role':'user','content':'怎么调整侧栏'}])
                self.assertEqual(data['mode'],'local_guide');self.assertFalse(data['remote'])
                self.assertEqual(transport.call_count,before)

    def test_disabled_or_unconfigured_help_is_honest_local_guide(self):
        for setting,value in (('ai.enabled','false'),('ai.features.pet','false'),
                              ('ai.allow_remote','false'),('ai.model','')):
            with self.subTest(setting=setting):
                old=self.settings.get(setting)
                self.settings[setting]=value
                data,status=self.route([{'role':'user','content':'怎么调整侧栏'}])
                self.assertEqual(status,200);self.assertEqual(data['mode'],'local_guide')
                self.assertIn('编辑侧栏',data['reply']);self.assertIsNone(data['provider'])
                self.assertFalse(data['remote']);self.assertTrue(data['reason'])
                if old is None:self.settings.pop(setting)
                else:self.settings[setting]=old
        self.transport.assert_not_called();self.codex.assert_not_called();self.cloud.assert_not_called()

    def test_model_failure_keeps_error_and_retrieved_local_steps(self):
        self.transport.side_effect=RuntimeError('fixture-sensitive-upstream-body')
        data,status=self.route([{'role':'user','content':'怎么调整侧栏'}])
        self.assertEqual(status,502);self.assertEqual(data['mode'],'llm_error')
        self.assertIn('编辑侧栏',data['local_guide'])
        self.assertNotIn('fixture-sensitive',json.dumps(data))

    def test_casual_chat_preserves_history_bound_and_disabled_error(self):
        history=[{'role':'assistant' if i%2==0 else 'user','content':f'synthetic-chat-{i}'} for i in range(20)]
        data,status=self.route(history)
        self.assertEqual(status,200);self.assertEqual(data['mode'],'companion')
        messages=self.transport.call_args.args[1]['messages']
        self.assertEqual(len(messages),13);self.assertEqual(messages[1:],history[-12:])
        self.assertFalse(data['knowledge']['matched'])
        self.settings['ai.enabled']='false'
        before=self.transport.call_count
        data,status=self.route(history)
        self.assertEqual(status,409);self.assertEqual(self.transport.call_count,before)

    def test_help_endpoint_is_local_and_does_not_open_diary_index(self):
        results=[]
        handler=SimpleNamespace(send_json=lambda data,status=200:results.append((data,status)))
        self.server.Handler.api_get(handler,'/api/help/search',{'question':['怎么调整侧栏']})
        data,status=results[-1]
        self.assertEqual(status,200);self.assertTrue(data['knowledge']['matched']);self.assertFalse(data['remote'])
        self.transport.assert_not_called();self.codex.assert_not_called();self.cloud.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
