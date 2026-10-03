"""The write-only settings and control surface for LifeOS AI features."""
from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
from urllib.parse import urlparse

from backend import ai_providers
from backend.ai_catalog import PROVIDER_PRESETS, public_presets
from backend.secret_store import set_secret
from engine import product_core as product, p2_sync

ROOT = product.ROOT
FEATURES = (
    ('ask', '人生问答', 'Ask My Life', '问题与本次选中的日记证据'),
    ('past_me', '以前的我', 'Past Me', '问题与截止日期内选中的证据'),
    ('classical', 'AI 文言化', '文言化', '本次载入或粘贴的文字；本地草译不受此开关影响'),
    ('poetry', '个性化荐诗', '今日一诗', '当日日记最多 6,000 字符与候选诗词；自动荐诗仍须单独开启'),
    ('pet', '桌宠聊天', 'Pet Companion', '当前聊天文字，不读取日记'),
)
MODES = {'disabled', 'byok', 'local', 'cloud', 'codex'}
PROVIDERS = set(PROVIDER_PRESETS) | {'custom', 'local'}
WIRE_APIS = {'chat_completions', 'responses', 'anthropic'}
BOOLEAN_KEYS = {'ai.enabled', 'ai.allow_remote', 'ai.payload_preview', 'ai.cache'} | {
    f'ai.features.{item[0]}' for item in FEATURES
}
STRING_KEYS = {'ai.mode', 'ai.provider', 'ai.model', 'ai.base_url', 'ai.embed_model',
               'ai.wire_api', 'ai.codex_model'}


def _boolean(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ('true', 'false'):
        return value.lower() == 'true'
    raise ValueError('开关必须为 true 或 false')


def _base_url(value, *, local=False):
    parsed = urlparse(value)
    try:
        parsed.port
    except ValueError:
        raise ValueError('模型网址的端口无效') from None
    loopback = parsed.hostname in ('localhost', '127.0.0.1', '::1')
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError('请输入不含密钥、用户名或查询参数的模型服务网址')
    if local and not loopback:
        raise ValueError('本地模型仅支持 localhost、127.0.0.1 或 ::1')
    if parsed.scheme == 'http' and not loopback:
        raise ValueError('远端模型服务必须使用 HTTPS')
    return value.rstrip('/')


def _connection_values(settings):
    """Resolve legacy connection overrides without reading any credential."""
    environment_first = settings.get('ai.config_source') != 'settings'
    mapping = {
        'provider': ('LIFEOS_AI_PROVIDER', 'deepseek'),
        'model': ('LIFEOS_LLM_MODEL', 'deepseek-chat'),
        'base_url': ('LIFEOS_LLM_BASE_URL', 'https://api.deepseek.com'),
        'wire_api': ('LIFEOS_WIRE_API', 'chat_completions'),
    }
    connection = {}
    for name, (variable, default) in mapping.items():
        value = os.getenv(variable) if environment_first else None
        connection[name] = value or str(settings.get(f'ai.{name}', default) or '')
    # Anthropic always uses Messages in the runtime, including legacy configs
    # that predate a separate wire_api setting.
    if connection['provider'] == 'anthropic':
        connection['wire_api'] = 'anthropic'
    return connection


def save_settings(payload, root=ROOT):
    """Validate the whole request before changing settings or credentials."""
    root = Path(root)
    supplied = payload.get('items', {})
    if not isinstance(supplied, dict):
        raise ValueError('设置格式无效')
    unknown = set(supplied) - BOOLEAN_KEYS - STRING_KEYS
    if unknown:
        raise ValueError('包含不支持的 AI 设置')
    items = {}
    for name, value in supplied.items():
        if name in BOOLEAN_KEYS:
            items[name] = _boolean(value)
        elif not isinstance(value, str) or len(value) > 1024 or any(c in value for c in '\r\n\x00'):
            raise ValueError('模型设置格式无效')
        else:
            items[name] = value.strip()
    existing = product.settings_dict(root)
    if (items or payload.get('key')) and existing.get('ai.config_source') != 'settings':
        # Preserve the effective environment-backed connection before making
        # UI settings authoritative, even when saving only a feature switch.
        snapshot = {f'ai.{name}': value for name, value in _connection_values(existing).items()}
        items = {**snapshot, **items}
    if supplied.get('ai.provider') in PROVIDER_PRESETS and supplied.get('ai.mode', existing.get('ai.mode')) == 'byok':
        # The simple form needs only a provider and a key. Explicit advanced
        # overrides remain supported, while a new provider never inherits
        # the previous provider's endpoint or model by accident.
        preset = PROVIDER_PRESETS[supplied['ai.provider']]
        changed = supplied['ai.provider'] != _connection_values(existing)['provider']
        for name in ('model', 'base_url', 'wire_api'):
            setting = f'ai.{name}'
            if setting not in supplied and (changed or not existing.get(setting)):
                items[setting] = preset[name]
    merged = {**existing, **items}
    mode = merged.get('ai.mode', 'byok')
    provider = merged.get('ai.provider', 'deepseek')
    if mode not in MODES or provider not in PROVIDERS:
        raise ValueError('不支持的 AI 模式或提供方')
    wire_api = merged.get('ai.wire_api', 'chat_completions')
    if wire_api not in WIRE_APIS:
        raise ValueError('不支持的模型接口类型')
    if mode in ('byok', 'local'):
        effective_provider = 'local' if mode == 'local' else provider
        if wire_api == 'anthropic' and effective_provider != 'anthropic':
            raise ValueError('Anthropic Messages 接口仅支持 Anthropic 提供方；请选择 Chat Completions 或 Responses')
        base = _base_url(merged.get('ai.base_url', ''), local=mode == 'local' or provider == 'local')
        if not merged.get('ai.model'):
            raise ValueError('请填写模型名称')
        if 'ai.base_url' in items:
            items['ai.base_url'] = base
    elif 'ai.base_url' in items and items['ai.base_url']:
        items['ai.base_url'] = _base_url(items['ai.base_url'])
    key = payload.get('key')
    if key is not None and not isinstance(key, str):
        raise ValueError('密钥格式无效')
    key = key.strip() if key else ''
    if key and (len(key) < 10 or len(key) > 4096 or any(c.isspace() for c in key)):
        raise ValueError('密钥格式无效，请检查是否多复制了空格或换行')
    # A deliberate save makes the UI authoritative over legacy process/.env settings.
    if items or key:
        items['ai.config_source'] = 'settings'
    storage = None
    if key:
        if mode == 'local' or provider == 'local':
            raise ValueError('本地模式不需要保存云 API 密钥')
        storage = set_secret(f'ai.{provider}.api_key', key, root).get('storage')
    if items:
        product.set_settings(items, root)
    return {'ok': True, 'storage': storage, 'status': ai_providers.privacy_status()}


def integrations_status(root=ROOT):
    from backend import ai_integrations
    return {'codex': ai_integrations.codex_status(root=Path(root)),
            'cc_switch': ai_integrations.cc_switch_status()}


def control_status(root=ROOT):
    ai = ai_providers.privacy_status()
    ai['usage'] = product.ai_usage_summary(root)
    features = []
    for feature_id, label, feature_name, scope in FEATURES:
        state = ai_providers.availability(feature_name)
        features.append({'id': feature_id, 'label': label, 'setting_key': f'ai.features.{feature_id}',
                         'enabled': state['feature_enabled'], 'available': state['available'],
                         'reason': state['reason'], 'needs_ai': True, 'data_scope': scope})
    memorial = p2_sync.memorial_config(root)
    saved = _connection_values(product.settings_dict(root))
    saved_provider = saved['provider']
    saved_wire = saved['wire_api']
    saved_base = saved['base_url']
    saved_connection = {
        'provider': saved_provider if saved_provider in PROVIDERS else 'deepseek',
        'model': saved['model'] or 'deepseek-chat',
        'base_url': saved_base if ai_providers.valid_base_url(saved_base) else '',
        'wire_api': saved_wire if saved_wire in WIRE_APIS else 'chat_completions',
    }
    return {'ai': ai, 'features': features, 'integrations': integrations_status(root),
            'providers': public_presets(),
            'saved_connection': saved_connection,
            'memorial': {'configured': memorial['configured'], 'url': memorial['url'],
                         'independent': True, 'provider': 'Netlify AI Gateway', 'model': 'gpt-5-mini',
                         'message': '公开分身使用独立的服务端配置；在纪念页中开启并发布生效。'}}


def test_connection(root=ROOT):
    state = ai_providers.availability('connection_test')
    if not state['available']:
        return {'ok': False, 'status': 'unavailable', 'message': state['reason']}
    try:
        reply = ai_providers.chat(
            [{'role': 'user', 'content': '这是连接测试。仅回复：连接成功。不要调用工具。'}],
            temperature=0, max_tokens=32, feature='connection_test', use_cache=False)
        if not reply or not str(reply.get('text', '')).strip():
            return {'ok': False, 'status': 'failed', 'message': '模型没有返回可用文字'}
        if reply.get('provider') == 'mock' or reply.get('model') == 'lifeos-mock':
            return {'ok': False, 'status': 'mock', 'message': '云服务仍是开发模拟模式，尚未连接真实模型'}
        return {'ok': True, 'status': 'connected', 'message': '模型连接成功，未发送日记或聊天记录',
                'provider': reply.get('provider'), 'model': reply.get('model'),
                'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    except ai_providers.AIError as error:
        return {'ok': False, 'status': 'failed', 'message': str(error)}
    except Exception:
        return {'ok': False, 'status': 'failed', 'message': '连接失败，请检查服务、登录、模型和额度'}


def import_cc_switch(root=ROOT):
    from backend import ai_integrations
    imported = ai_integrations.import_cc_switch()
    saved = save_settings({'items': imported['items'], 'key': imported.get('key')}, root)
    return {**saved, 'message': imported.get('message', '已导入当前 Codex 连接配置')}
