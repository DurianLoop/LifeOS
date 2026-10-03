#!/usr/bin/env python3
"""Offline Codex/CC Switch tests: only synthetic config and mocked processes."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend import ai_integrations as integrations


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='lifeos-integration-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.codex = self.root / 'codex config'
        self.codex.mkdir()
        self.environment = patch.dict(os.environ, {'CODEX_HOME': str(self.codex)}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.cc_folder = self.root / '.cc-switch'
        self.cc_folder.mkdir()
        (self.cc_folder / 'cc-switch.db').touch()
        locations = patch.object(integrations, '_cc_switch_roots', return_value=[self.cc_folder])
        locations.start()
        self.addCleanup(locations.stop)
        integrations._STATUS_CACHE.clear()

    def test_codex_config_alone_does_not_mean_cc_switch_is_installed(self):
        self.config()
        with patch.object(integrations, '_cc_switch_installed', return_value=False), \
                patch.object(integrations, '_connection') as connection:
            status = integrations.cc_switch_status()
        self.assertFalse(status['installed'])
        self.assertFalse(status['available'])
        self.assertFalse(status['importable'])
        connection.assert_not_called()

    def test_cc_switch_detection_only_checks_database_existence(self):
        with patch.object(Path, 'read_text', side_effect=AssertionError('must not read providers DB')):
            self.assertTrue(integrations._cc_switch_installed())

    def test_cc_switch_without_codex_config_is_not_ready(self):
        status = integrations.cc_switch_status()
        self.assertTrue(status['installed'])
        self.assertFalse(status['available'])
        self.assertFalse(status['importable'])

    def config(self, text=None):
        (self.codex / 'config.toml').write_text(text or '''model = "third-party-agent-model"
model_provider = "current"
[model_providers.current]
name = "Fixture provider"
base_url = "https://fixture.invalid/v1"
wire_api = "responses"
requires_openai_auth = true
''', encoding='utf-8')

    def test_import_keeps_api_protocol_and_model_but_status_never_exposes_auth(self):
        self.config()
        secret = 'fixture-secret-never-in-status'
        auth = {'OPENAI_API_KEY': secret, 'tokens': {'access_token': 'private-oauth-fixture'}}
        auth_path = self.codex / 'auth.json'
        auth_path.write_text(json.dumps(auth), encoding='utf-8')
        before = {path.name: path.read_bytes() for path in self.codex.iterdir()}
        status = integrations.cc_switch_status()
        self.assertTrue(status['importable'])
        self.assertEqual(status['wire_api'], 'responses')
        self.assertNotIn(secret, json.dumps(status))
        self.assertNotIn('private-oauth-fixture', json.dumps(status))
        result = integrations.import_cc_switch()
        self.assertEqual(result['key'], secret)
        self.assertEqual(result['items']['ai.model'], 'third-party-agent-model')
        self.assertEqual(result['items']['ai.wire_api'], 'responses')
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.codex.iterdir()})

    def test_oauth_only_credentials_cannot_be_imported_as_api_key(self):
        self.config()
        (self.codex / 'auth.json').write_text(json.dumps({'tokens': {'access_token': 'fixture-oauth'}}), encoding='utf-8')
        status = integrations.cc_switch_status()
        self.assertFalse(status['importable'])
        self.assertIn('Codex', status['reason'])
        with self.assertRaises(integrations.IntegrationError):
            integrations.import_cc_switch()

    def test_env_key_is_authoritative_and_does_not_fall_back_to_unrelated_openai_key(self):
        self.config('''model="fixture-model"
model_provider="current"
[model_providers.current]
base_url="http://127.0.0.1:9999/v1"
env_key="FIXTURE_PROVIDER_KEY"
wire_api="chat"
''')
        os.environ['OPENAI_API_KEY'] = 'unrelated-key'
        self.assertFalse(integrations.cc_switch_status()['importable'])
        os.environ['FIXTURE_PROVIDER_KEY'] = 'selected-fixture-key'
        imported = integrations.import_cc_switch()
        self.assertEqual(imported['key'], 'selected-fixture-key')
        self.assertEqual(imported['items']['ai.wire_api'], 'chat_completions')

    def test_malformed_or_credential_bearing_urls_fail_without_leaking_content(self):
        for text in ('not TOML = SECRET', 'model="m"\nmodel_provider="x"\n[model_providers.x]\nbase_url="https://user:password@fixture.invalid/v1?token=hidden"'):
            self.config(text)
            result = integrations.cc_switch_status()
            self.assertFalse(result['importable'])
            self.assertNotIn('password', json.dumps(result))
            self.assertNotIn('hidden', json.dumps(result))
            self.assertNotIn('SECRET', json.dumps(result))
        for url in ('http://remote.invalid/v1', 'https://fixture.invalid:bad/v1', 'https://[invalid/v1'):
            self.config('model="m"\nmodel_provider="x"\n[model_providers.x]\nbase_url=' + json.dumps(url))
            self.assertFalse(integrations.cc_switch_status()['importable'])
            with self.assertRaises(integrations.IntegrationError):
                integrations.import_cc_switch()

    def test_status_reports_only_version_login_state_and_model(self):
        self.config()
        with patch.object(integrations, '_find_codex', return_value=['fixture codex.exe']), patch.object(integrations, '_run', side_effect=[(0, 'codex-cli 0.159.2'), (0, 'Logged in using key SECRET')]) as run:
            status = integrations.codex_status(self.root)
        self.assertTrue(status['available'])
        self.assertTrue(status['authenticated'])
        self.assertEqual(status['model'], 'third-party-agent-model')
        self.assertNotIn('SECRET', json.dumps(status))
        self.assertEqual(run.call_args_list[1].args[0][-2:], ['login', 'status'])
        integrations._STATUS_CACHE.clear()
        with patch.object(integrations, '_find_codex', return_value=None):
            self.assertFalse(integrations.codex_status(self.root)['available'])

    def test_status_cache_avoids_repeated_processes_and_invalidates_when_config_changes(self):
        self.config()
        with patch.object(integrations, '_find_codex', return_value=['fixture']), patch.object(integrations, '_run', side_effect=[(0, 'codex-cli 0.159.2'), (0, 'authenticated'), (0, 'codex-cli 0.159.2'), (1, 'not authenticated')]) as run:
            self.assertTrue(integrations.codex_status(self.root)['authenticated'])
            self.assertTrue(integrations.codex_status(self.root)['authenticated'])
            self.assertEqual(run.call_count, 2)
            self.config('model="changed-model"')
            self.assertFalse(integrations.codex_status(self.root)['authenticated'])
            self.assertEqual(run.call_count, 4)

    def test_empty_model_override_follows_current_config_and_explicit_override_wins(self):
        config = {'model': 'current-agent-model'}
        self.assertEqual(integrations._model(self.root, config), 'current-agent-model')
        self.assertFalse((self.root / '.lifeos').exists(), 'status must not create a database')
        (self.root / '.lifeos').mkdir()
        connection = sqlite3.connect(self.root / '.lifeos/core.db')
        connection.execute('CREATE TABLE settings(key TEXT, value TEXT)')
        connection.execute('INSERT INTO settings VALUES(?,?)', ('ai.codex_model', 'explicit-model'))
        connection.commit()
        connection.close()
        self.assertEqual(integrations._model(self.root, config), 'explicit-model')

    def test_chat_uses_only_stdin_and_empty_workspace_with_tools_disabled(self):
        self.config()
        secret = 'fixture-key-not-in-argv'
        (self.codex / 'auth.json').write_text(json.dumps({'OPENAI_API_KEY': secret}), encoding='utf-8')
        messages = [{'role': 'system', 'content': 'Answer from this excerpt only.'}, {'role': 'user', 'content': 'Synthetic diary excerpt.'}]
        seen = {}

        def fake_run(argv, **kwargs):
            seen.update(argv=argv, **kwargs)
            self.assertEqual(list(Path(kwargs['cwd']).iterdir()), [])
            self.assertNotEqual(Path(kwargs['cwd']), ROOT)
            self.assertNotIn('Synthetic diary excerpt.', ' '.join(argv))
            self.assertNotIn(secret, ' '.join(argv))
            self.assertIn(json.dumps(messages, ensure_ascii=False), kwargs['input_text'])
            self.assertEqual(kwargs['env']['LIFEOS_CODEX_CONNECTION_KEY'], secret)
            output = Path(argv[argv.index('-o') + 1])
            output.write_text('A synthetic answer.', encoding='utf-8')
            return 0, json.dumps({'type': 'turn.completed', 'usage': {'input_tokens': 20, 'output_tokens': 5}})

        with patch.object(integrations, '_find_codex', return_value=['fixture codex.exe']), patch.object(integrations, '_run', side_effect=fake_run):
            answer = integrations.codex_chat(messages, max_tokens=300, root=self.root)
        self.assertEqual(answer['text'], 'A synthetic answer.')
        self.assertEqual(answer['model'], 'third-party-agent-model')
        self.assertEqual(answer['usage']['completion_tokens'], 5)
        self.assertFalse(Path(seen['cwd']).exists(), 'temporary prompt/output directory must be removed')
        for value in ('--ignore-user-config', '--ignore-rules', '--ephemeral', 'read-only', 'features.shell_tool=false', 'features.apps=false', 'features.plugins=false', 'features.hooks=false', 'features.multi_agent=false', 'mcp_servers={}', 'project_doc_max_bytes=0', 'web_search="disabled"'):
            self.assertIn(value, seen['argv'])

    def test_openai_connection_overrides_reach_cli_without_exposing_key(self):
        self.config('''model="fixture-openai-model"
model_provider="openai"
[model_providers.openai]
base_url="https://openai-override.invalid/v1"
env_key="FIXTURE_OPENAI_KEY"
wire_api="responses"
unrelated_option="must-not-be-copied"
''')
        secret = 'fixture-openai-secret-only-in-environment'
        os.environ['FIXTURE_OPENAI_KEY'] = secret
        seen = {}

        def fake_run(argv, **kwargs):
            seen.update(argv=argv, **kwargs)
            Path(argv[argv.index('-o') + 1]).write_text('Override answer.', encoding='utf-8')
            return 0, ''

        with patch.object(integrations, '_find_codex', return_value=['fixture']), patch.object(integrations, '_run', side_effect=fake_run):
            answer = integrations.codex_chat([{'role': 'user', 'content': 'Synthetic connection test.'}], root=self.root)
        self.assertEqual(answer['text'], 'Override answer.')
        self.assertEqual(answer['model'], 'fixture-openai-model')
        for value in ('model_provider="lifeos_connection"',
                      'model_providers.lifeos_connection.base_url="https://openai-override.invalid/v1"',
                      'model_providers.lifeos_connection.env_key="LIFEOS_CODEX_CONNECTION_KEY"',
                      'model_providers.lifeos_connection.wire_api="responses"'):
            self.assertIn(value, seen['argv'])
        self.assertEqual(seen['env']['LIFEOS_CODEX_CONNECTION_KEY'], secret)
        self.assertNotIn(secret, ' '.join(seen['argv']))
        self.assertNotIn('must-not-be-copied', ' '.join(seen['argv']))
        self.assertNotIn(secret, seen['input_text'])
        self.assertNotIn(secret, json.dumps(answer))

    def test_default_openai_oauth_keeps_builtin_provider(self):
        for config in ({'model': 'fixture-model'},
                       {'model_provider': 'openai', 'model_providers': {'openai': {'name': 'OpenAI'}}}):
            env = {}
            with patch.object(integrations, '_api_key', side_effect=AssertionError('default OAuth must remain managed by Codex')):
                overrides = integrations._overrides(config, self.root, env)
            self.assertNotIn('model_provider', overrides)
            self.assertFalse(any(key.startswith('model_providers.') for key in overrides))
            self.assertNotIn('LIFEOS_CODEX_CONNECTION_KEY', env)

    def test_openai_endpoint_override_preserves_default_oauth_authentication(self):
        config = {'model_provider': 'openai', 'model_providers': {'openai': {
            'base_url': 'https://openai-override.invalid/v1', 'wire_api': 'responses'}}}
        with patch.object(integrations, '_api_key', return_value=''):
            overrides = integrations._overrides(config, self.root, {})
        self.assertEqual(overrides['model_providers.lifeos_connection.base_url'], 'https://openai-override.invalid/v1')
        self.assertIs(overrides['model_providers.lifeos_connection.requires_openai_auth'], True)
        self.assertNotIn('model_providers.lifeos_connection.env_key', overrides)

    def test_model_failure_and_unexpected_tools_never_expose_raw_output(self):
        self.config('model="fixture-model"')
        for code, output in ((1, 'credential SECRET'), (0, '{"type":"turn.failed","error":{"message":"SECRET"}}'),
                             (0, '{"type":"item.completed","item":{"type":"command_execution","command":"SECRET"}}')):
            with patch.object(integrations, '_find_codex', return_value=['fixture']), patch.object(integrations, '_run', return_value=(code, output)):
                with self.assertRaises(integrations.IntegrationError) as caught:
                    integrations.codex_chat([{'role': 'user', 'content': 'hello'}], root=self.root)
                self.assertNotIn('SECRET', str(caught.exception))

    def test_timeout_terminates_only_the_spawned_process_and_returns_safe_error(self):
        proc = Mock()
        proc.communicate.side_effect = subprocess.TimeoutExpired(['SECRET'], timeout=1, stderr='SECRET')
        with patch.object(integrations.subprocess, 'Popen', return_value=proc), patch.object(integrations, '_stop_tree') as stop:
            with self.assertRaises(integrations.IntegrationError) as caught:
                integrations._run(['fixture'], cwd=self.root, timeout=1)
        stop.assert_called_once_with(proc)
        self.assertNotIn('SECRET', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
