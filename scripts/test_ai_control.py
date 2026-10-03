"""Validate the AI settings boundary without using credentials or remote models."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import ai_control, ai_providers
from engine import product_core


class AIControlTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.provider_root = patch.object(ai_providers, 'ROOT', self.root)
        self.provider_root.start()
        self.addCleanup(self.provider_root.stop)
        self.secret_read = patch.object(ai_providers, 'get_secret', return_value=('', 'not-configured'))
        self.secret_read.start()
        self.addCleanup(self.secret_read.stop)

    def test_invalid_provider_cannot_write_key(self):
        with patch.object(ai_control, 'set_secret') as store:
            with self.assertRaises(ValueError):
                ai_control.save_settings({'items': {'ai.provider': 'unsupported'}, 'key': 'test-credential-value'}, self.root)
            store.assert_not_called()
        self.assertEqual(product_core.get_setting('ai.provider', root=self.root), 'deepseek')

    def test_named_provider_fills_connection_without_user_technical_fields(self):
        for provider in ('qwen', 'qwen-intl', 'qwen-us', 'glm', 'openai'):
            with self.subTest(provider=provider), patch.object(ai_control, 'set_secret', return_value={'storage':'os-keychain'}) as store:
                result = ai_control.save_settings({'items': {'ai.mode':'byok', 'ai.provider':provider},
                                                   'key':'test-credential-value'}, self.root)
                preset = ai_control.PROVIDER_PRESETS[provider]
                saved = product_core.settings_dict(self.root)
                self.assertTrue(result['ok'])
                for field in ('base_url', 'model', 'wire_api'):
                    self.assertEqual(saved[f'ai.{field}'], preset[field])
                store.assert_called_once_with(f'ai.{provider}.api_key', 'test-credential-value', self.root)
                self.assertNotIn('test-credential-value', json.dumps(result))

    def test_explicit_custom_model_remains_possible_for_named_provider(self):
        ai_control.save_settings({'items': {'ai.mode':'byok', 'ai.provider':'qwen',
            'ai.model':'account-specific-model', 'ai.base_url':'https://example.com/v1'}}, self.root)
        saved = product_core.settings_dict(self.root)
        self.assertEqual(saved['ai.model'], 'account-specific-model')
        self.assertEqual(saved['ai.base_url'], 'https://example.com/v1')

    def test_invalid_boolean_is_rejected_before_mutation(self):
        with patch.object(ai_control, 'set_secret') as store, patch.object(product_core, 'set_settings') as settings:
            with self.assertRaises(ValueError):
                ai_control.save_settings({'items': {'ai.enabled': 'yes'}, 'key': 'test-credential-value'}, self.root)
            store.assert_not_called()
            settings.assert_not_called()

    def test_incompatible_anthropic_interface_cannot_write_settings_or_key(self):
        combinations = [('byok', name) for name in ('custom', 'local', 'deepseek', 'openai')]
        combinations += [('local', 'local'), ('local', 'anthropic')]
        for mode, provider in combinations:
            with self.subTest(mode=mode, provider=provider), \
                    patch.object(ai_control, 'set_secret') as store, \
                    patch.object(product_core, 'set_settings') as settings:
                with self.assertRaisesRegex(ValueError, 'Anthropic Messages 接口仅支持 Anthropic 提供方'):
                    ai_control.save_settings({'items': {'ai.mode': mode, 'ai.provider': provider,
                        'ai.wire_api': 'anthropic', 'ai.model': 'fixture-model',
                        'ai.base_url': 'http://127.0.0.1:11434/v1'},
                        'key': 'test-credential-value'}, self.root)
                store.assert_not_called()
                settings.assert_not_called()

    def test_anthropic_messages_configuration_remains_supported(self):
        result = ai_control.save_settings({'items': {'ai.mode': 'byok', 'ai.provider': 'anthropic',
            'ai.wire_api': 'anthropic', 'ai.model': 'fixture-model',
            'ai.base_url': 'https://api.anthropic.com'}}, self.root)
        self.assertTrue(result['ok'])
        self.assertEqual(result['status']['wire_api'], 'anthropic')
        self.assertEqual(product_core.get_setting('ai.provider', root=self.root), 'anthropic')

    def test_invalid_inactive_connection_does_not_prevent_disabling_ai(self):
        product_core.set_settings({'ai.config_source': 'settings', 'ai.provider': 'custom',
            'ai.wire_api': 'anthropic'}, self.root)
        result = ai_control.save_settings({'items': {'ai.mode': 'disabled', 'ai.enabled': False}}, self.root)
        self.assertTrue(result['ok'])
        self.assertFalse(result['status']['available'])
        self.assertEqual(product_core.get_setting('ai.mode', root=self.root), 'disabled')

    def test_unknown_settings_cannot_store_secrets_in_database(self):
        with self.assertRaises(ValueError):
            ai_control.save_settings({'items': {'ai.api_key': 'test-credential-value'}}, self.root)

    def test_saved_key_is_write_only_and_empty_key_preserves_it(self):
        with patch.object(ai_control, 'set_secret', return_value={'storage': 'os-keychain'}) as store:
            result = ai_control.save_settings({'items': {'ai.provider': 'deepseek'}, 'key': 'test-credential-value'}, self.root)
            store.assert_called_once_with('ai.deepseek.api_key', 'test-credential-value', self.root)
            self.assertNotIn('test-credential-value', json.dumps(result))
            store.reset_mock()
            ai_control.save_settings({'items': {'ai.cache': False}, 'key': ''}, self.root)
            store.assert_not_called()
        self.assertEqual(product_core.get_setting('ai.config_source', root=self.root), 'settings')

    def test_local_mode_does_not_accept_remote_address(self):
        with self.assertRaisesRegex(ValueError, '本地模型'):
            ai_control.save_settings({'items': {'ai.mode': 'local', 'ai.base_url': 'https://example.com/v1'}}, self.root)

    def test_local_mode_accepts_loopback_without_key_or_remote_permission(self):
        result = ai_control.save_settings({'items': {'ai.mode': 'local', 'ai.provider': 'local',
            'ai.base_url': 'http://127.0.0.1:11434/v1/', 'ai.model': 'local-model', 'ai.allow_remote': False}}, self.root)
        self.assertTrue(result['ok'])
        self.assertTrue(result['status']['available'])

    def test_url_cannot_contain_credentials_or_query(self):
        for base in ('https://user:pass@example.com/v1', 'https://example.com/v1?key=value',
                     'https://example.com/v1#secret', 'http://example.com/v1'):
            with self.subTest(base=base), self.assertRaises(ValueError):
                ai_control.save_settings({'items': {'ai.base_url': base}}, self.root)

    def test_all_feature_switches_are_saved_as_booleans(self):
        for feature_id, *_ in ai_control.FEATURES:
            setting_key = f'ai.features.{feature_id}'
            ai_control.save_settings({'items': {setting_key: False}}, self.root)
            self.assertEqual(product_core.get_setting(setting_key, root=self.root), 'false')

    def test_connection_check_respects_permissions(self):
        with patch.object(ai_providers, 'availability', return_value={'available':False, 'reason':'AI 已关闭'}), \
                patch.object(ai_providers, 'chat') as chat:
            result = ai_control.test_connection(self.root)
            self.assertFalse(result['ok'])
            chat.assert_not_called()

    def test_connection_check_sends_only_synthetic_input(self):
        with patch.object(ai_providers, 'availability', return_value={'available':True}), \
                patch.object(ai_providers, 'chat', return_value={'text':'连接成功', 'provider':'deepseek', 'model':'test-model'}) as chat:
            result = ai_control.test_connection(self.root)
            self.assertTrue(result['ok'])
            self.assertEqual(chat.call_args.kwargs['feature'], 'connection_test')
            self.assertFalse(chat.call_args.kwargs['use_cache'])
            self.assertEqual(len(chat.call_args.args[0]), 1)
            self.assertNotIn('text', result)

    def test_mock_cloud_does_not_pass_connection_check(self):
        with patch.object(ai_providers, 'availability', return_value={'available':True}), \
                patch.object(ai_providers, 'chat', return_value={'text':'mock', 'provider':'mock', 'model':'lifeos-mock'}):
            result = ai_control.test_connection(self.root)
            self.assertFalse(result['ok'])
            self.assertEqual(result['status'], 'mock')

    def test_unexpected_connection_errors_do_not_echo_sensitive_messages(self):
        with patch.object(ai_providers, 'availability', return_value={'available':True}), \
                patch.object(ai_providers, 'chat', side_effect=RuntimeError('test-credential-value')):
            result = ai_control.test_connection(self.root)
            self.assertNotIn('test-credential-value', json.dumps(result))

    def test_cc_switch_import_passes_key_to_secure_save_only(self):
        from backend import ai_integrations
        imported = {'items': {'ai.provider':'custom', 'ai.mode':'byok', 'ai.model':'test-model',
                             'ai.base_url':'https://example.com/v1', 'ai.wire_api':'responses'},
                    'key':'test-credential-value', 'message':'已导入'}
        with patch.object(ai_integrations, 'import_cc_switch', return_value=imported), \
                patch.object(ai_control, 'set_secret', return_value={'storage':'os-keychain'}) as store:
            result = ai_control.import_cc_switch(self.root)
            store.assert_called_once_with('ai.custom.api_key', 'test-credential-value', self.root)
            self.assertNotIn('test-credential-value', json.dumps(result))
            self.assertEqual(product_core.get_setting('ai.wire_api', root=self.root), 'responses')

    def test_codex_status_retains_saved_byok_connection_without_secrets(self):
        product_core.set_settings({'ai.mode': 'codex', 'ai.provider': 'custom', 'ai.model': 'saved-byok-model',
            'ai.base_url': 'https://gateway.example/v1', 'ai.wire_api': 'responses'}, self.root)
        with patch.object(ai_providers, '_codex_configuration', return_value={
                'available': True, 'authenticated': True, 'model': 'active-codex-model'}), \
                patch.object(ai_control, 'integrations_status', return_value={}), \
                patch.object(ai_control.p2_sync, 'memorial_config', return_value={'configured': False, 'url': ''}):
            result = ai_control.control_status(self.root)
        self.assertEqual(result['ai']['provider'], 'codex')
        self.assertEqual(result['ai']['model'], 'active-codex-model')
        self.assertEqual(result['saved_connection'], {'provider': 'custom', 'model': 'saved-byok-model',
            'base_url': 'https://gateway.example/v1', 'wire_api': 'responses'})
        self.assertEqual(set(result['saved_connection']), {'provider', 'model', 'base_url', 'wire_api'})

    def test_saved_connection_does_not_expose_legacy_url_credentials(self):
        for address in ('https://owner:fixture-secret@example.com/v1', 'https://example.com/v1?key=fixture-secret'):
            with self.subTest(address=address):
                product_core.set_settings({'ai.mode': 'codex', 'ai.base_url': address}, self.root)
                with patch.object(ai_providers, '_codex_configuration', return_value={
                        'available': False, 'authenticated': False}), \
                        patch.object(ai_control, 'integrations_status', return_value={}), \
                        patch.object(ai_control.p2_sync, 'memorial_config', return_value={'configured': False, 'url': ''}):
                    result = ai_control.control_status(self.root)
                self.assertEqual(result['saved_connection']['base_url'], '')
                self.assertNotIn('fixture-secret', json.dumps(result))

    def test_feature_only_save_preserves_effective_legacy_environment_connection(self):
        legacy = {'LIFEOS_AI_PROVIDER': 'custom', 'LIFEOS_LLM_MODEL': 'legacy-model',
                  'LIFEOS_LLM_BASE_URL': 'https://legacy.example/v1', 'LIFEOS_WIRE_API': 'responses'}
        with patch.dict(os.environ, legacy):
            ai_control.save_settings({'items': {'ai.features.pet': False}}, self.root)
            configuration = ai_providers.config()
        stored = product_core.settings_dict(self.root)
        self.assertEqual(stored['ai.config_source'], 'settings')
        self.assertEqual(stored['ai.features.pet'], 'false')
        self.assertEqual(configuration.provider, 'custom')
        self.assertEqual(configuration.model, 'legacy-model')
        self.assertEqual(configuration.base_url, 'https://legacy.example/v1')
        self.assertEqual(configuration.wire_api, 'responses')
        self.assertEqual(stored['ai.base_url'], 'https://legacy.example/v1')

    def test_saved_connection_uses_legacy_environment_even_while_codex_is_active(self):
        product_core.set_settings({'ai.mode': 'codex'}, self.root)
        legacy = {'LIFEOS_AI_PROVIDER': 'custom', 'LIFEOS_LLM_MODEL': 'legacy-model',
                  'LIFEOS_LLM_BASE_URL': 'https://legacy.example/v1', 'LIFEOS_WIRE_API': 'responses'}
        with patch.dict(os.environ, legacy), \
                patch.object(ai_providers, '_codex_configuration', return_value={
                    'available': True, 'authenticated': True, 'model': 'codex-model'}), \
                patch.object(ai_control, 'integrations_status', return_value={}), \
                patch.object(ai_control.p2_sync, 'memorial_config', return_value={'configured': False, 'url': ''}):
            result = ai_control.control_status(self.root)
        self.assertEqual(result['saved_connection'], {'provider': 'custom', 'model': 'legacy-model',
            'base_url': 'https://legacy.example/v1', 'wire_api': 'responses'})
        self.assertEqual(result['ai']['provider'], 'codex')

    def test_explicit_connection_edits_override_the_legacy_snapshot(self):
        legacy = {'LIFEOS_AI_PROVIDER': 'custom', 'LIFEOS_LLM_MODEL': 'old-model',
                  'LIFEOS_LLM_BASE_URL': 'https://old.example/v1', 'LIFEOS_WIRE_API': 'responses'}
        with patch.dict(os.environ, legacy):
            ai_control.save_settings({'items': {'ai.model': 'new-model', 'ai.base_url': 'https://new.example/v1'}}, self.root)
        stored = product_core.settings_dict(self.root)
        self.assertEqual(stored['ai.model'], 'new-model')
        self.assertEqual(stored['ai.base_url'], 'https://new.example/v1')
        self.assertEqual(stored['ai.provider'], 'custom')

    def test_disabling_and_reenabling_preserves_legacy_connection(self):
        legacy = {'LIFEOS_AI_PROVIDER': 'custom', 'LIFEOS_LLM_MODEL': 'legacy-model',
                  'LIFEOS_LLM_BASE_URL': 'https://legacy.example/v1', 'LIFEOS_WIRE_API': 'responses'}
        with patch.dict(os.environ, legacy):
            ai_control.save_settings({'items': {'ai.mode': 'disabled', 'ai.enabled': False}}, self.root)
        ai_control.save_settings({'items': {'ai.mode': 'byok', 'ai.enabled': True}}, self.root)
        configuration = ai_providers.config()
        self.assertEqual(configuration.provider, 'custom')
        self.assertEqual(configuration.model, 'legacy-model')
        self.assertEqual(configuration.base_url, 'https://legacy.example/v1')


if __name__ == '__main__':
    unittest.main()
