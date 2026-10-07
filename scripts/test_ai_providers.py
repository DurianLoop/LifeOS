"""Offline permission, transport and privacy regressions for the shared AI router."""
import io
import json
import os
import unittest
import urllib.error
from unittest.mock import Mock, patch

from backend import ai_providers as ai


class AIProviderTests(unittest.TestCase):
    def setUp(self):
        self.settings = {'ai.mode': 'byok', 'ai.provider': 'deepseek', 'ai.model': 'fixture-model',
                         'ai.base_url': 'https://example.invalid/v1', 'ai.enabled': 'true',
                         'ai.allow_remote': 'true', 'ai.cache': 'true'}
        self.key = 'fixture-secret-never-returned'
        self.messages = [{'role': 'system', 'content': 'Only answer the supplied question.'},
                         {'role': 'user', 'content': 'synthetic-private-input'}]
        self.cache = {}
        self.patches = [
            patch.dict(os.environ, {}, clear=True),
            patch.object(ai.pc, 'get_setting', side_effect=lambda key, default=None, root=None: self.settings.get(key, default)),
            patch.object(ai, 'get_secret', side_effect=lambda *args: (self.key, 'test-secret-store')),
            patch.object(ai.pc, 'get_ai_cache', side_effect=lambda key, root: self.cache.get(key)),
            patch.object(ai.pc, 'put_ai_cache', side_effect=lambda key, provider, model, value, root: self.cache.update({key: {'response': value}})),
            patch.object(ai.pc, 'log_ai_request'),
            patch.object(ai, '_cloud_configuration', return_value='https://cloud.invalid'),
            patch.object(ai, '_codex_configuration', return_value={'available': True, 'authenticated': True, 'model': 'codex-fixture'}),
            patch.object(ai, '_json_request', return_value={'choices': [{'message': {'content': 'fixture answer'}}], 'usage': {'prompt_tokens': 2, 'completion_tokens': 3}}),
            patch.object(ai, '_cloud_chat', return_value={'text': 'cloud answer', 'model': 'cloud-fixture', 'provider': 'cloud'}),
            patch.object(ai, '_codex_chat', return_value={'text': 'codex answer', 'model': 'codex-fixture', 'provider': 'codex'}),
        ]
        self.mocks = [item.start() for item in self.patches]
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
        self.secret, self.get_cache, self.put_cache, self.log = self.mocks[2:6]
        self.cloud_status, self.codex_status, self.request, self.cloud, self.codex = self.mocks[6:]

    def assert_no_transport(self):
        self.request.assert_not_called()
        self.cloud.assert_not_called()
        self.codex.assert_not_called()

    def test_global_switches_block_every_route_before_cache(self):
        for mode in ('byok', 'local', 'cloud', 'codex', 'ollama', 'disabled'):
            for setting in ('ai.enabled', 'ai.mode'):
                with self.subTest(mode=mode, switch=setting):
                    self.settings.update({'ai.enabled': 'true', 'ai.mode': mode})
                    if mode == 'local': self.settings['ai.base_url'] = 'http://127.0.0.1:11434/v1'
                    self.settings[setting] = 'false' if setting == 'ai.enabled' else 'disabled'
                    self.assertIsNone(ai.chat(self.messages, feature='Pet Companion'))
        self.get_cache.assert_not_called()
        self.assert_no_transport()

    def test_each_feature_switch_blocks_all_modes_and_aliases(self):
        for name, key in ai.FEATURE_ALIASES.items():
            for mode in ('byok', 'local', 'cloud', 'codex', 'ollama'):
                with self.subTest(feature=name, mode=mode):
                    self.settings.update({'ai.mode': mode, 'ai.base_url': 'http://localhost:11434/v1', f'ai.features.{key}': 'false'})
                    self.assertFalse(ai.availability(name)['feature_enabled'])
                    self.assertIsNone(ai.chat(self.messages, feature=name))
                    self.settings.pop(f'ai.features.{key}')
        self.get_cache.assert_not_called()
        self.assert_no_transport()

    def test_remote_denial_blocks_byok_cloud_and_codex(self):
        self.settings['ai.allow_remote'] = 'false'
        for mode in ('byok', 'cloud', 'codex'):
            self.settings['ai.mode'] = mode
            self.assertEqual(ai.availability()['reason_code'], 'remote_disabled')
            self.assertIsNone(ai.chat(self.messages))
        self.get_cache.assert_not_called()
        self.assert_no_transport()

    def test_local_model_works_without_key_and_without_remote_permission(self):
        self.key = ''
        self.settings.update({'ai.mode': 'local', 'ai.base_url': 'http://127.0.0.1:11434/v1', 'ai.allow_remote': 'false'})
        result = ai.chat(self.messages)
        self.assertEqual(result['text'], 'fixture answer')
        self.assertEqual(result['provider'], 'local')
        self.assertFalse(result['remote'])
        self.assertFalse(self.log.call_args.kwargs['sent_remote'])
        self.assertNotIn('Authorization', self.request.call_args.args[2])
        self.secret.assert_not_called()

    def test_local_provider_cannot_retain_remote_url_even_in_byok_mode(self):
        for mode in ('byok', 'local'):
            for address in ('https://api.deepseek.com', 'http://192.168.1.10:11434/v1',
                            'http://localhost.attacker.invalid/v1', 'http://user:secret@localhost/v1'):
                with self.subTest(mode=mode, address=address):
                    self.settings.update({'ai.mode': mode, 'ai.provider': 'local', 'ai.base_url': address})
                    self.assertFalse(ai.availability()['available'])
                    self.assertIsNone(ai.chat(self.messages))
        self.assert_no_transport()

    def test_ipv4_ipv6_and_localhost_loopbacks_are_supported(self):
        for address in ('http://127.0.0.1:11434/v1', 'http://[::1]:8080/v1', 'https://localhost/v1'):
            self.assertTrue(ai.is_loopback_url(address))
        for address in ('file:///tmp/model', 'http://localhost:bad', 'http://localhost:0',
                        'https://localhost/v1?key=secret', 'https://localhost/v1#fragment'):
            self.assertFalse(ai.is_loopback_url(address))

    def test_unknown_mode_provider_and_wire_fail_closed(self):
        for setting in ('ai.mode', 'ai.provider', 'ai.wire_api'):
            original = self.settings.get(setting)
            self.settings[setting] = 'unrecognized'
            self.assertIsNone(ai.chat(self.messages))
            if original is None: self.settings.pop(setting)
            else: self.settings[setting] = original
        self.assert_no_transport()

    def test_cache_cannot_bypass_later_permission_changes(self):
        ai.chat(self.messages, feature='Ask My Life')
        cached = ai.chat(self.messages, feature='Ask My Life')
        self.assertTrue(cached['cache_hit'])
        self.assertFalse(cached['remote'])
        self.assertFalse(self.log.call_args.kwargs['sent_remote'])
        self.assertEqual(self.request.call_count, 1)
        self.settings['ai.features.ask'] = 'false'
        reads = self.get_cache.call_count
        self.assertIsNone(ai.chat(self.messages, feature='Ask My Life'))
        self.assertEqual(self.get_cache.call_count, reads)
        self.settings['ai.features.ask'] = 'true'
        self.settings['ai.allow_remote'] = 'false'
        self.assertIsNone(ai.chat(self.messages, feature='Ask My Life'))
        self.assertEqual(self.get_cache.call_count, reads)

    def test_cloud_mode_uses_cloud_and_checks_its_own_configuration(self):
        self.key = ''
        self.settings['ai.mode'] = 'cloud'
        result = ai.chat(self.messages, temperature=.35, max_tokens=340, feature='今日一诗')
        self.assertEqual(result['text'], 'cloud answer')
        self.cloud.assert_called_once_with(self.messages, '今日一诗', temperature=.35, max_tokens=340)
        self.request.assert_not_called()
        self.cloud_status.return_value = ''
        self.assertEqual(ai.availability()['reason_code'], 'cloud_unconfigured')
        self.assertIsNone(ai.chat(self.messages))

    def test_codex_requires_authenticated_cli_and_uses_selected_model_metadata(self):
        self.key = ''
        self.settings.update({'ai.mode': 'codex', 'ai.codex_model': 'explicit-codex-model'})
        self.assertEqual(ai.availability()['model'], 'explicit-codex-model')
        result = ai.chat(self.messages, temperature=.1, max_tokens=120, feature='Past Me')
        self.assertEqual(result['provider'], 'codex')
        self.codex.assert_called_once_with(self.messages, .1, 120, 'Past Me')
        self.request.assert_not_called()
        self.codex_status.return_value = {'available': True, 'authenticated': False}
        self.assertEqual(ai.availability()['reason_code'], 'codex_unauthenticated')
        self.assertIsNone(ai.chat(self.messages))

    def test_responses_api_maps_instructions_budget_text_and_usage(self):
        self.settings.update({'ai.provider': 'custom', 'ai.wire_api': 'responses'})
        self.request.return_value = {'output': [{'type': 'reasoning', 'summary': []},
            {'type': 'message', 'content': [{'type': 'output_text', 'text': 'response answer'}]}],
            'usage': {'input_tokens': 4, 'output_tokens': 5}}
        result = ai.chat(self.messages, max_tokens=80)
        url, payload, headers = self.request.call_args.args
        self.assertEqual(url, 'https://example.invalid/v1/responses')
        self.assertEqual(payload['instructions'], self.messages[0]['content'])
        self.assertEqual(payload['input'], [self.messages[1]])
        self.assertEqual(payload['max_output_tokens'], 80)
        self.assertFalse(payload['store'])
        self.assertNotIn('temperature', payload)
        self.assertEqual(result['text'], 'response answer')
        self.assertEqual(result['usage'], {'prompt_tokens': 4, 'completion_tokens': 5})
        self.assertNotIn(self.key, json.dumps(result))

    def test_default_qwen_and_glm_return_text_with_small_budgets(self):
        def reply(url, payload, headers):
            direct = payload.get('enable_thinking') is False or payload.get('thinking') == {'type': 'disabled'}
            return {'choices': [{'message': {'content': 'OK' if direct else '', 'reasoning_content': 'thinking'}}]}
        self.request.side_effect = reply
        for provider in ('qwen', 'qwen-intl', 'qwen-us', 'glm'):
            with self.subTest(provider=provider):
                self.settings.update({'ai.provider': provider, 'ai.model': ai.PROVIDER_PRESETS[provider]['model']})
                result = ai.chat(self.messages, max_tokens=32, use_cache=False)
                self.assertEqual(result['text'], 'OK')
                self.assertEqual(self.request.call_args.args[1]['max_tokens'], 32)

    def test_vendor_thinking_options_are_not_sent_to_custom_models(self):
        for provider, model in (('custom', 'qwen-plus'), ('deepseek', 'deepseek-chat'), ('glm', 'glm-5.3'), ('qwen', 'custom-model')):
            with self.subTest(provider=provider, model=model):
                self.settings.update({'ai.provider': provider, 'ai.model': model})
                ai.chat(self.messages, max_tokens=32, use_cache=False)
                payload = self.request.call_args.args[1]
                self.assertNotIn('thinking', payload)
                self.assertNotIn('enable_thinking', payload)

    def test_openai_and_anthropic_do_not_duplicate_v1(self):
        for provider in ('openai', 'anthropic'):
            for base in ('https://example.invalid', 'https://example.invalid/v1'):
                with self.subTest(provider=provider, base=base):
                    self.settings.update({'ai.provider': provider, 'ai.base_url': base})
                    self.request.return_value = ({'content': [{'type': 'text', 'text': 'answer'}], 'usage': {}}
                        if provider == 'anthropic' else {'choices': [{'message': {'content': 'answer'}}]})
                    ai.chat(self.messages, use_cache=False)
                    self.assertEqual(self.request.call_args.args[0], base.rstrip('/v1') + ('/v1/messages' if provider == 'anthropic' else '/v1/chat/completions'))
                    if provider == 'anthropic':
                        self.assertEqual(self.request.call_args.args[1]['messages'], [self.messages[1]])
                        self.assertEqual(self.request.call_args.args[2]['x-api-key'], self.key)

    def test_explicit_settings_override_legacy_environment_and_prefer_stored_key(self):
        with patch.dict(os.environ, {'LIFEOS_AI_PROVIDER': 'openai', 'LIFEOS_LLM_MODEL': 'old-model',
                                     'LIFEOS_LLM_BASE_URL': 'https://old.invalid/v1'}):
            self.assertEqual(ai.config().model, 'old-model')
            self.settings['ai.config_source'] = 'settings'
            self.assertEqual(ai.config().model, 'fixture-model')
            self.assertEqual(ai.config().provider, 'deepseek')
            self.assertIsNone(self.secret.call_args.args[1])
            self.assertFalse(ai.privacy_status()['environment_override'])

    def test_settings_without_stored_key_keep_legacy_key_fallback(self):
        self.settings['ai.config_source'] = 'settings'
        self.secret.side_effect = lambda name, env, root: ('legacy-test-key', 'environment') if env else ('', 'not-configured')
        self.assertEqual(ai.config().api_key, 'legacy-test-key')

    def test_provider_error_does_not_reveal_response_messages_or_credentials(self):
        leaked = self.key + ' ' + self.messages[1]['content']
        for mode, transport in (('byok', self.request), ('cloud', self.cloud), ('codex', self.codex)):
            with self.subTest(mode=mode):
                self.settings['ai.mode'] = mode
                transport.side_effect = RuntimeError(leaked)
                with self.assertRaises(ai.AIError) as caught:
                    ai.chat(self.messages, use_cache=False)
                self.assertNotIn(self.key, str(caught.exception))
                self.assertNotIn(self.messages[1]['content'], str(caught.exception))
                self.assertNotIn(leaked, json.dumps(self.log.call_args.kwargs, default=str))
                transport.side_effect = None

    def test_error_response_body_is_not_treated_as_model_text(self):
        self.request.return_value = {'error': {'message': self.key + ' ' + self.messages[1]['content']}}
        with self.assertRaises(ai.AIError) as caught:
            ai.chat(self.messages)
        self.assertNotIn(self.key, str(caught.exception))
        self.put_cache.assert_not_called()

    def test_status_has_feature_availability_without_any_credentials(self):
        self.settings['ai.features.pet'] = 'false'
        status = ai.privacy_status()
        self.assertEqual(set(status['features']), set(ai.FEATURE_KEYS))
        self.assertFalse(status['features']['pet']['feature_enabled'])
        self.assertTrue(status['features']['ask']['available'])
        self.assertNotIn(self.key, json.dumps(status))

    def test_embeddings_follow_disabled_and_local_permissions(self):
        self.settings.update({'ai.embed_model': 'embed-fixture', 'ai.mode': 'disabled'})
        self.assertIsNone(ai.embeddings(['synthetic']))
        self.request.assert_not_called()
        self.settings.update({'ai.mode': 'local', 'ai.base_url': 'http://localhost:11434/v1', 'ai.allow_remote': 'false'})
        self.request.return_value = {'data': [{'index': 1, 'embedding': [2]}, {'index': 0, 'embedding': [1]}]}
        self.assertEqual(ai.embeddings(['a', 'b'])['vectors'], [[1], [2]])
        self.assertNotIn('Authorization', self.request.call_args.args[2])


class CloudGenerationBudgetTests(unittest.TestCase):
    def setUp(self):
        from cloud import p2_services
        from engine import p2_sync
        self.service, self.sync = p2_services, p2_sync
        self.messages = [{'role': 'user', 'content': 'Synthetic budget test.'}]
        self.connection = Mock()
        self.response = Mock()
        self.response.__enter__ = Mock(return_value=self.response)
        self.response.__exit__ = Mock(return_value=False)
        self.response.read.return_value = json.dumps({'choices': [{'message': {'content': 'Fixture cloud answer.'}}]}).encode()
        self.patches = [
            patch.dict(os.environ, {'LIFEOS_CLOUD_AI_PROVIDER': 'fixture', 'LIFEOS_CLOUD_AI_MODEL': 'fixture-model',
                                   'LIFEOS_CLOUD_AI_BASE_URL': 'https://provider.invalid/v1',
                                   'LIFEOS_CLOUD_AI_API_KEY': 'fixture-cloud-key'}, clear=True),
            patch.object(p2_services, 'subscription', return_value={'plan': 'plus', 'entitlements': {'cloud_ai': True}}),
            patch.object(p2_services.request, 'urlopen', return_value=self.response),
            patch.object(p2_sync, '_auth', return_value=('https://cloud.invalid', 'fixture-sync-token')),
            patch.object(p2_sync, '_request', side_effect=self.cloud_request),
        ]
        self.mocks = [item.start() for item in self.patches]
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
        self.upstream = self.mocks[2]

    def cloud_request(self, method, url, token, payload):
        self.assertEqual((method, url, token), ('POST', 'https://cloud.invalid/v2/ai/generate', 'fixture-sync-token'))
        status, response = self.service._cloud_ai(self.connection, 'fixture-user', payload)
        self.assertEqual(status, 200)
        return response

    def provider_payload(self):
        return json.loads(self.upstream.call_args.args[0].data.decode())

    def test_generation_options_reach_upstream_through_cloud_bridge(self):
        result = ai._cloud_chat(self.messages, '今日一诗', temperature=.35, max_tokens=340)
        self.assertEqual(result['text'], 'Fixture cloud answer.')
        payload = self.provider_payload()
        self.assertEqual(payload['messages'], self.messages)
        self.assertEqual(payload['temperature'], .35)
        self.assertEqual(payload['max_tokens'], 340)
        self.assertEqual(self.mocks[4].call_args.args[3]['feature'], '今日一诗')

    def test_legacy_cloud_call_receives_bounded_defaults(self):
        self.sync.cloud_ai(self.messages, 'legacy-feature', ai.ROOT)
        payload = self.provider_payload()
        self.assertEqual(payload['temperature'], .2)
        self.assertEqual(payload['max_tokens'], 4096)

    def test_invalid_generation_options_are_rejected_before_model_call(self):
        invalid = [('max_tokens', value) for value in (0, -1, 16385, True, 1.5, '32')]
        invalid += [('temperature', value) for value in (-.1, 2.1, True, '0.2', None, float('nan'), float('inf'))]
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                status, response = self.service._cloud_ai(self.connection, 'fixture-user', {'messages': self.messages, key: value})
                self.assertEqual(status, 400)
                self.assertIn(key, response['error'])
        self.upstream.assert_not_called()
        self.connection.execute.assert_not_called()

    def test_generation_option_boundaries_are_forwarded(self):
        for temperature, max_tokens in ((0, 1), (2, 16384)):
            with self.subTest(temperature=temperature, max_tokens=max_tokens):
                status, _ = self.service._cloud_ai(self.connection, 'fixture-user', {
                    'messages': self.messages, 'temperature': temperature, 'max_tokens': max_tokens})
                self.assertEqual(status, 200)
                payload = self.provider_payload()
                self.assertEqual((payload['temperature'], payload['max_tokens']), (temperature, max_tokens))


class AITransportTests(unittest.TestCase):
    def test_http_failure_omits_body_url_and_headers(self):
        body = io.BytesIO(b'fixture-secret fixture-private-text')
        body.read = Mock(wraps=body.read)
        error = urllib.error.HTTPError('https://secret.invalid?key=fixture-secret', 401, 'fixture-private-text',
                                       {'Authorization': 'fixture-secret'}, body)
        opener = Mock()
        opener.open.side_effect = error
        with patch.object(ai.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(ai.AIError) as caught:
                ai._json_request('https://example.invalid/v1/chat/completions', {'messages': []}, {})
        self.assertIn('401', str(caught.exception))
        self.assertNotIn('fixture', str(caught.exception))
        body.read.assert_not_called()
        self.assertTrue(body.closed)

    def test_local_transport_ignores_proxy_and_forbids_redirect(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{}'
        opener = Mock()
        opener.open.return_value = response
        with patch.object(ai.urllib.request, 'build_opener', return_value=opener) as build:
            ai._json_request('http://127.0.0.1:11434/v1/chat/completions', {}, {})
        handlers = build.call_args.args
        proxy = next(handler for handler in handlers if isinstance(handler, ai.urllib.request.ProxyHandler))
        self.assertEqual(proxy.proxies, {})
        redirect = next(handler for handler in handlers if isinstance(handler, ai._NoRedirect))
        with self.assertRaises(ai.AIError):
            redirect.redirect_request(None, None, 302, 'redirect', {}, 'https://remote.invalid')


if __name__ == '__main__':
    unittest.main()
