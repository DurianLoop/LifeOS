"""Ollama native-protocol integration on loopback, using synthetic text only."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from backend import ai_control, ai_providers as ai
from engine import product_core as pc


class OllamaDemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = {'requests': []}

        class OllamaFixture(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, data, status=200):
                raw = json.dumps(data).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                cls.fixture['requests'].append(('GET', self.path, dict(self.headers), None))
                if cls.fixture.get('redirect'):
                    self.send_response(302)
                    self.send_header('Location', '/must-not-follow')
                    self.end_headers()
                    return
                self.reply(cls.fixture.get('tags', {'models': [{'name': 'qwen3:4b'}, {'name': 'gemma3:1b'}]}))

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                cls.fixture['requests'].append(('POST', self.path, dict(self.headers), data))
                self.reply(cls.fixture.get('chat', {'message': {'role': 'assistant', 'content': '打开界面微调，选择编辑侧栏'},
                    'prompt_eval_count': 12, 'eval_count': 8, 'done': True}), cls.fixture.get('chat_status', 200))

        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), OllamaFixture)
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=3)

    def setUp(self):
        self.fixture.clear()
        self.fixture['requests'] = []
        folder = tempfile.TemporaryDirectory(prefix='lifeos-ollama-demo-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        # Retain Windows/Conda runtime variables required by SSL initialization;
        # model configuration still uses isolated explicit settings and no key.
        for item in (patch.object(ai, 'ROOT', self.root), patch.dict(os.environ, {
                'LIFEOS_AI_PROVIDER': '', 'LIFEOS_LLM_MODEL': '', 'LIFEOS_LLM_BASE_URL': '', 'LIFEOS_WIRE_API': ''})):
            item.start()
            self.addCleanup(item.stop)
        self.secret_patch = patch.object(ai, 'get_secret', return_value=('', 'not-configured'))
        self.secret = self.secret_patch.start()
        self.addCleanup(self.secret_patch.stop)
        pc.set_settings({'ai.mode': 'ollama', 'ai.config_source': 'settings', 'ai.enabled': True, 'ai.allow_remote': False,
            'ai.ollama_base_url': self.base, 'ai.ollama_model': 'qwen3:4b',
            'ai.provider': 'custom', 'ai.model': 'retained-api-model',
            'ai.base_url': 'https://retained.invalid/v1', 'ai.wire_api': 'responses'}, self.root)
        self.messages = [{'role': 'developer', 'content': 'Use only the supplied public product guide.'},
            {'role': 'user', 'content': '怎么调整侧边栏？'}]

    def test_native_tags_discovery_is_read_only_and_deduplicated(self):
        self.fixture['tags'] = {'models': [{'name': 'qwen3:4b'}, {'model': 'gemma3:1b'}, {'name': 'qwen3:4b'}, {}, {'name': '\n'},
            {'name': 'gpt-oss:120b-cloud'}, {'name': 'aliased-cloud', 'remote_host': 'https://ollama.com'}]}
        result = ai_control.ollama_models(root=self.root)
        self.assertTrue(result['ok'])
        self.assertEqual(result['models'], ['gemma3:1b', 'qwen3:4b'])
        self.assertEqual([(r[0], r[1]) for r in self.fixture['requests']], [('GET', '/api/tags')])
        self.assertEqual(pc.get_setting('ai.mode', root=self.root), 'ollama')
        self.assertEqual(pc.get_setting('ai.ollama_model', root=self.root), 'qwen3:4b')
        self.assertEqual(pc.ai_usage_summary(self.root)['totals']['calls'], 0)

    def test_native_chat_replies_without_key_remote_permission_or_extra_context(self):
        result = ai.chat(self.messages, feature='Pet Companion', temperature=.2, max_tokens=120)
        self.assertEqual(result['text'], '打开界面微调，选择编辑侧栏')
        self.assertEqual(result['provider'], 'ollama')
        self.assertFalse(result['remote'])
        self.assertEqual(result['usage'], {'prompt_tokens': 12, 'completion_tokens': 8})
        method, path, headers, payload = self.fixture['requests'][0]
        self.assertEqual((method, path), ('POST', '/api/chat'))
        self.assertNotIn('Authorization', headers)
        self.assertEqual(payload, {'model': 'qwen3:4b', 'stream': False, 'think': False, 'options': {'temperature': .2, 'num_predict': 120},
            'messages': [{'role': 'system', 'content': self.messages[0]['content']}, self.messages[1]]})
        self.secret.assert_not_called()
        self.assertEqual(pc.ai_usage_summary(self.root)['totals']['remote_calls'], 0)

    def test_existing_cache_is_used_but_permissions_are_checked_first(self):
        ai.chat(self.messages, feature='Pet Companion')
        self.assertTrue(ai.chat(self.messages, feature='Pet Companion')['cache_hit'])
        self.assertEqual(len(self.fixture['requests']), 1)
        pc.set_settings({'ai.features.pet': False}, self.root)
        self.assertIsNone(ai.chat(self.messages, feature='Pet Companion'))
        self.assertEqual(len(self.fixture['requests']), 1)

    def test_all_feature_gates_and_global_switch_prevent_local_calls(self):
        for feature, key in ai.FEATURE_ALIASES.items():
            with self.subTest(feature=feature):
                pc.set_settings({f'ai.features.{key}': False}, self.root)
                self.assertIsNone(ai.chat(self.messages, feature=feature))
                pc.set_settings({f'ai.features.{key}': True}, self.root)
        pc.set_settings({'ai.enabled': False}, self.root)
        self.assertIsNone(ai.chat(self.messages))
        self.assertEqual(self.fixture['requests'], [])

    def test_saved_api_and_environment_do_not_override_explicit_local_mode(self):
        with patch.dict(os.environ, {'LIFEOS_LLM_BASE_URL': 'https://must-not-call.invalid',
                'LIFEOS_LLM_MODEL': 'must-not-select', 'LIFEOS_LLM_API_KEY': 'must-not-send'}):
            ai_control.save_settings({'items': {'ai.mode': 'ollama', 'ai.ollama_model': 'gemma3:1b'}}, self.root)
            result = ai.chat(self.messages, use_cache=False)
        self.assertEqual(result['model'], 'gemma3:1b')
        self.assertEqual(pc.get_setting('ai.model', root=self.root), 'retained-api-model')
        self.assertEqual(pc.get_setting('ai.base_url', root=self.root), 'https://retained.invalid/v1')
        self.secret.assert_not_called()

    def test_returning_to_api_does_not_call_ollama_implicitly(self):
        ai_control.save_settings({'items': {'ai.mode': 'byok'}}, self.root)
        with patch.object(ai, '_json_request', return_value={'output_text': 'Remote fixture answer'}) as request:
            pc.set_settings({'ai.allow_remote': True}, self.root)
            self.secret.return_value = ('fixture-api-key', 'fixture')
            result = ai.chat(self.messages, use_cache=False)
        self.assertEqual(result['provider'], 'custom')
        self.assertEqual(request.call_args.args[0], 'https://retained.invalid/v1/responses')
        self.assertEqual(self.fixture['requests'], [])

    def test_remote_or_embedded_credentials_are_rejected_before_discovery(self):
        for base in ('http://192.168.1.4:11434', 'https://example.invalid',
                'http://localhost.attacker.invalid:11434', 'http://owner:secret@localhost:11434',
                'http://localhost:0', 'http://localhost:11434?key=secret'):
            with self.subTest(base=base):
                self.assertFalse(ai_control.ollama_models(base, self.root)['ok'])
                with self.assertRaises(ValueError):
                    ai_control.save_settings({'items': {'ai.ollama_base_url': base}}, self.root)
        self.assertEqual(self.fixture['requests'], [])

    def test_tampered_remote_local_config_fails_closed(self):
        pc.set_settings({'ai.ollama_base_url': 'https://example.invalid'}, self.root)
        self.assertEqual(ai.availability()['reason_code'], 'local_only')
        self.assertIsNone(ai.chat(self.messages))
        self.assertEqual(self.fixture['requests'], [])

    def test_redirects_are_never_followed(self):
        self.fixture['redirect'] = True
        self.assertFalse(ai_control.ollama_models(root=self.root)['ok'])
        self.assertEqual([r[1] for r in self.fixture['requests']], ['/api/tags'])

    def test_empty_or_invalid_tags_are_actionable_and_do_not_change_selection(self):
        self.fixture['tags'] = {'models': []}
        result = ai_control.ollama_models(root=self.root)
        self.assertTrue(result['ok'])
        self.assertIn('下载', result['message'])
        self.fixture['tags'] = {'error': 'SENSITIVE_UPSTREAM_BODY'}
        result = ai_control.ollama_models(root=self.root)
        self.assertFalse(result['ok'])
        self.assertNotIn('SENSITIVE', json.dumps(result))
        self.assertEqual(pc.get_setting('ai.ollama_model', root=self.root), 'qwen3:4b')

    def test_missing_model_and_upstream_failure_are_safe_and_retryable(self):
        for status in (404, 500):
            with self.subTest(status=status):
                self.fixture.update(chat={'error': 'SENSITIVE_DIARY_OR_KEY'}, chat_status=status)
                result = ai_control.test_connection(self.root)
                self.assertFalse(result['ok'])
                self.assertNotIn('SENSITIVE', json.dumps(result))
                self.assertIn('重选' if status == 404 else '重试', result['message'])
                self.assertNotIn('SENSITIVE', json.dumps(pc.ai_usage_summary(self.root)))
        self.fixture.pop('chat_status')
        self.fixture.pop('chat')
        self.assertTrue(ai_control.test_connection(self.root)['ok'])

    def test_connection_test_sends_only_the_synthetic_prompt(self):
        self.assertTrue(ai_control.test_connection(self.root)['ok'])
        payload = self.fixture['requests'][0][3]
        self.assertEqual(len(payload['messages']), 1)
        self.assertIn('这是连接测试', payload['messages'][0]['content'])
        self.assertEqual(payload['options']['num_predict'], 32)

    def test_unreachable_service_does_not_fallback_to_remote(self):
        with patch.object(ai, '_json_request', side_effect=ai.AIError('request_failed')) as request, \
                patch.object(ai, '_cloud_chat') as cloud, patch.object(ai, '_codex_chat') as codex:
            result = ai_control.test_connection(self.root)
            self.assertFalse(result['ok'])
            self.assertIn('启动本机 Ollama', result['message'])
            request.assert_called_once()
            cloud.assert_not_called()
            codex.assert_not_called()

    def test_local_key_and_missing_model_cannot_be_saved(self):
        for payload in ({'items': {'ai.ollama_model': ''}}, {'items': {}, 'key': 'fixture-api-key'},
                {'items': {'ai.ollama_model': 'gpt-oss:120b-cloud'}}):
            with self.assertRaises(ValueError):
                ai_control.save_settings(payload, self.root)
        self.assertEqual(pc.get_setting('ai.ollama_model', root=self.root), 'qwen3:4b')

    def test_cloud_descriptor_cannot_bypass_local_permission_or_cache(self):
        pc.set_settings({'ai.ollama_model': 'qwen3:cloud'}, self.root)
        self.assertEqual(ai.availability()['reason_code'], 'ollama_local_model_only')
        self.assertIsNone(ai.chat(self.messages))
        self.assertEqual(self.fixture['requests'], [])

    def test_public_help_explains_local_model_setup_on_demand(self):
        from backend import product_help
        for question in ('怎么用 Ollama 调用本地模型？', '本机模型在哪里选择？'):
            knowledge = product_help.retrieve([{'role': 'user', 'content': question}])
            self.assertTrue(knowledge['matched'])
            self.assertEqual(knowledge['sources'][0]['id'], 'ollama')
            self.assertIn('保存并测试', knowledge['sources'][0]['content'])


if __name__ == '__main__':
    unittest.main()
