#!/usr/bin/env python3
"""One permission boundary for every LifeOS model request."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import hashlib, ipaddress, json, os, time
import urllib.error, urllib.parse, urllib.request
from backend.secret_store import get_secret
from backend.ai_catalog import PROVIDER_PRESETS
from engine import product_core as pc

ROOT = Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])
FEATURE_KEYS = ('ask', 'past_me', 'classical', 'poetry', 'pet')
FEATURE_ALIASES = {'Ask My Life':'ask', 'Past Me':'past_me', '文言化':'classical',
                   '今日一诗':'poetry', 'Daily Poetry':'poetry', 'Pet Companion':'pet'}
MODES = {'disabled', 'byok', 'local', 'cloud', 'codex', 'ollama'}
PROVIDERS = set(PROVIDER_PRESETS) | {'custom', 'local', 'ollama'}
WIRE_APIS = {'chat_completions', 'responses', 'anthropic'}
REASONS = {
    'ready':'', 'disabled':'AI 已关闭。', 'feature_disabled':'此功能的 AI 已关闭。',
    'remote_disabled':'尚未允许发送内容给远端 AI。', 'invalid_mode':'请选择有效的 AI 模式。',
    'invalid_provider':'请选择有效的模型提供商。', 'invalid_url':'模型地址无效，请检查 AI 设置。',
    'local_only':'本地模式只允许 localhost、127.0.0.1 或 ::1 等回环地址。',
    'missing_model':'请先填写模型名称。', 'missing_key':'请先配置此提供商的 API Key。',
    'invalid_wire_api':'请选择有效的模型接口协议。', 'cloud_unconfigured':'请先配置 LifeOS Cloud 地址并登录。',
    'codex_unavailable':'未检测到可用的 Codex CLI。', 'codex_unauthenticated':'请先在本机完成 Codex 登录或模型鉴权。',
    'invalid_messages':'模型消息格式无效。', 'invalid_response':'模型返回了无法读取的结果，请重试。',
    'request_failed':'模型请求失败，请检查连接、鉴权和模型配置后重试。',
    'ollama_unavailable':'请启动本机 Ollama，再重试',
    'ollama_model_missing':'本机未找到所选模型，请刷新模型列表后重选',
    'ollama_no_models':'Ollama 中还没有模型，请先在 Ollama 下载一个模型，再刷新',
    'ollama_failed':'本地模型未能完成，请检查 Ollama 和可用内存后重试',
    'ollama_local_model_only':'请选择本机下载的模型，暂不支持 Ollama 云模型',
}

@dataclass
class ProviderConfig:
    provider: str
    model: str
    base_url: str
    api_key: str
    key_source: str
    embed_model: str = ''
    wire_api: str = 'chat_completions'
    mode: str = 'byok'

class AIError(RuntimeError):
    """Only stable messages cross the UI/log boundary, never upstream bodies."""
    def __init__(self, code='request_failed', http_status=None):
        self.code = code if code in REASONS else 'request_failed'
        self.http_status = http_status if isinstance(http_status, int) and 100 <= http_status <= 599 else None
        message = REASONS[self.code]
        if self.http_status: message += f'（HTTP {self.http_status}）'
        super().__init__(message)

def _setting(name, default=''):
    value = pc.get_setting(name, default, ROOT)
    return default if value is None else value

def _boolean(name, default='true'):
    return str(_setting(name, default)).lower() == 'true'

def feature_key(feature='generic'):
    return feature if feature in FEATURE_KEYS else FEATURE_ALIASES.get(feature)

def config() -> ProviderConfig:
    mode = _setting('ai.mode', 'byok')
    if mode == 'ollama':
        # Separate fields preserve API/Codex preferences and cannot inherit a
        # remote environment URL or key when the user chooses a local model.
        return ProviderConfig('ollama', str(_setting('ai.ollama_model', '')).strip(),
            str(_setting('ai.ollama_base_url', 'http://localhost:11434')).strip().rstrip('/'),
            '', 'not-required', '', 'ollama', mode)
    settings_first = _setting('ai.config_source', 'environment') == 'settings'
    def value(setting, environment, default=''):
        if not settings_first and os.getenv(environment): return os.environ[environment]
        return str(_setting(setting, default) or '')
    provider = value('ai.provider', 'LIFEOS_AI_PROVIDER', 'deepseek')
    model = value('ai.model', 'LIFEOS_LLM_MODEL', 'deepseek-chat')
    base = value('ai.base_url', 'LIFEOS_LLM_BASE_URL', 'https://api.deepseek.com').strip().rstrip('/')
    wire = value('ai.wire_api', 'LIFEOS_WIRE_API', 'anthropic' if provider == 'anthropic' else 'chat_completions')
    embed = value('ai.embed_model', 'LIFEOS_EMBED_MODEL')
    if mode == 'local': provider = 'local'
    if mode in ('cloud', 'codex'):
        model = str(_setting('ai.codex_model' if mode == 'codex' else 'ai.cloud_model', '') or '')
        return ProviderConfig(mode, model, '', '', 'codex-login' if mode == 'codex' else 'sync-token', '', wire, mode)
    if provider == 'local':
        key, source = '', 'not-required'
    else:
        env_name = {'openai':'OPENAI_API_KEY', 'anthropic':'ANTHROPIC_API_KEY',
                    'qwen':'DASHSCOPE_API_KEY', 'qwen-intl':'DASHSCOPE_API_KEY',
                    'qwen-us':'DASHSCOPE_API_KEY', 'glm':'ZHIPUAI_API_KEY'}.get(provider, 'LIFEOS_LLM_API_KEY')
        key, source = get_secret(f'ai.{provider}.api_key', None if settings_first else env_name, ROOT)
        if settings_first and not key: key, source = get_secret(f'ai.{provider}.api_key', env_name, ROOT)
    return ProviderConfig(provider, model.strip(), base, key, source, embed, wire, mode)

def valid_base_url(value):
    try:
        url = urllib.parse.urlsplit(value)
        return bool(url.scheme in ('http','https') and url.hostname and url.port != 0
                    and not url.username and not url.password and not url.query and not url.fragment
                    and not any(character.isspace() for character in value))
    except (ValueError, TypeError): return False

def is_loopback_url(value):
    if not valid_base_url(value): return False
    hostname = urllib.parse.urlsplit(value).hostname
    if hostname == 'localhost': return True
    try: return ipaddress.ip_address(hostname).is_loopback
    except ValueError: return False

def _cloud_configuration():
    from engine import p2_sync
    try:
        base, _token = p2_sync._auth(ROOT)
        return base if valid_base_url(base) else ''
    except Exception: return ''

def _codex_configuration():
    try:
        from backend.ai_integrations import codex_status
        return codex_status(root=ROOT)
    except Exception: return {'available':False, 'authenticated':False}

def _availability(c, feature='generic', connection=None):
    enabled, allow_remote = _boolean('ai.enabled'), _boolean('ai.allow_remote')
    key = feature_key(feature)
    feature_enabled = key is None or _boolean(f'ai.features.{key}')
    local = c.mode in ('local', 'ollama') or (c.mode == 'byok' and c.provider == 'local')
    reason, base, model = 'ready', c.base_url, c.model
    if c.mode not in MODES: reason = 'invalid_mode'
    elif c.mode == 'cloud':
        base = _cloud_configuration() if connection is None else connection
        if not base: reason = 'cloud_unconfigured'
    elif c.mode == 'codex':
        state = _codex_configuration() if connection is None else connection
        model = c.model or state.get('model') or ''
        if not state.get('available'): reason = 'codex_unavailable'
        elif not state.get('authenticated'): reason = 'codex_unauthenticated'
    elif c.provider not in PROVIDERS or (c.provider == 'ollama' and c.mode != 'ollama'): reason = 'invalid_provider'
    elif not valid_base_url(base): reason = 'invalid_url'
    elif local and not is_loopback_url(base): reason = 'local_only'
    elif not model: reason = 'ollama_model_missing' if c.mode == 'ollama' else 'missing_model'
    elif c.mode == 'ollama' and not ollama_local_model(model): reason = 'ollama_local_model_only'
    elif c.mode == 'ollama' and c.wire_api != 'ollama': reason = 'invalid_wire_api'
    elif c.mode == 'ollama': pass
    elif c.wire_api not in WIRE_APIS or (c.wire_api == 'anthropic' and c.provider != 'anthropic'): reason = 'invalid_wire_api'
    elif not local and not c.api_key: reason = 'missing_key'
    configured = reason == 'ready'
    # Permissions precede every cache read and provider call.
    if c.mode == 'disabled' or not enabled: reason = 'disabled'
    elif not feature_enabled: reason = 'feature_disabled'
    elif not local and not allow_remote: reason = 'remote_disabled'
    available = reason == 'ready'
    return {'mode':c.mode, 'enabled':enabled, 'allow_remote':allow_remote, 'configured':configured,
            'available':available, 'allowed':available, 'reason_code':reason, 'reason':REASONS[reason],
            'feature_key':key, 'feature_enabled':feature_enabled, 'requires_remote':not local,
            'provider':c.provider, 'model':model, 'base_url':base if valid_base_url(base) else '',
            'wire_api':'anthropic' if c.provider == 'anthropic' else c.wire_api}

def availability(feature='generic'):
    return _availability(config(), feature)

def privacy_status():
    c = config()
    connection = _cloud_configuration() if c.mode == 'cloud' else _codex_configuration() if c.mode == 'codex' else None
    status = _availability(c, connection=connection)
    status.update({
        'payload_preview':_boolean('ai.payload_preview'), 'cache':_boolean('ai.cache'),
        'key_source':c.key_source, 'embed_model':c.embed_model, 'codex_model':_setting('ai.codex_model',''),
        'config_source':_setting('ai.config_source','environment'),
        'environment_override':c.mode != 'ollama' and _setting('ai.config_source','environment') != 'settings' and any(
            os.getenv(name) for name in ('LIFEOS_AI_PROVIDER','LIFEOS_LLM_MODEL','LIFEOS_LLM_BASE_URL','LIFEOS_WIRE_API')),
        'features':{key:_availability(c,key,connection) for key in FEATURE_KEYS},
        'policy':'Only the selected evidence/input for the current action is sent; the entire Vault is never attached automatically.',
    })
    return status

def remote_allowed(feature='generic'):
    """Compatibility name: also true for an authorized local-only model."""
    return availability(feature)['available']

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never redirect selected diary text or credentials to a different host.
        if fp is not None: fp.close()
        raise AIError('request_failed', code)

def _json_request(url, payload, headers, timeout=90):
    try:
        request = urllib.request.Request(url, data=json.dumps(payload,ensure_ascii=False).encode('utf-8'), headers=headers, method='POST')
        handlers = [_NoRedirect()]
        if is_loopback_url(url): handlers.append(urllib.request.ProxyHandler({}))
        opener = urllib.request.build_opener(*handlers)
        with opener.open(request,timeout=timeout) as response: return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        error.close()
        raise AIError('request_failed',error.code) from None
    except AIError: raise
    except Exception: raise AIError('request_failed') from None

def _endpoint(c, suffix):
    base = c.base_url.rstrip('/')
    if c.provider in ('openai','anthropic') and not urllib.parse.urlsplit(base).path.strip('/'): base += '/v1'
    return base + '/' + suffix

def ollama_local_model(name, metadata=None):
    """Ollama Cloud descriptors are not downloaded local inference models."""
    if not isinstance(name, str) or name.lower().endswith((':cloud', '-cloud')): return False
    metadata = metadata or {}
    details = metadata.get('details') or {}
    return not any(metadata.get(key) or (details.get(key) if isinstance(details, dict) else None)
                   for key in ('remote_host', 'remote_model', 'cloud'))

def ollama_models(base_url='http://localhost:11434'):
    """Read only model names from a local Ollama; no generation or download."""
    if not is_loopback_url(base_url): raise AIError('local_only')
    try:
        request = urllib.request.Request(base_url.rstrip('/') + '/api/tags',
            headers={'Accept':'application/json'}, method='GET')
        opener = urllib.request.build_opener(_NoRedirect(), urllib.request.ProxyHandler({}))
        with opener.open(request, timeout=4) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024: raise AIError('invalid_response')
        data = json.loads(raw.decode('utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('models'), list): raise AIError('invalid_response')
        names = []
        for item in data['models']:
            if not isinstance(item, dict): continue
            name = item.get('name') or item.get('model')
            if isinstance(name, str) and name.strip() and len(name) <= 160 and not any(c in name for c in '\r\n\x00') and ollama_local_model(name, item):
                names.append(name.strip())
        return sorted(set(names), key=str.casefold)
    except AIError: raise
    except urllib.error.HTTPError as error:
        error.close()
        raise AIError('ollama_failed', error.code) from None
    except (urllib.error.URLError, TimeoutError, OSError): raise AIError('ollama_unavailable') from None
    except Exception: raise AIError('invalid_response') from None

def _ollama_chat(c, messages, temperature, max_tokens):
    payload = {'model':c.model, 'messages':[
        {'role':'system' if m['role'] == 'developer' else m['role'], 'content':m['content']} for m in messages
    ], 'stream':False, 'think':False, 'options':{'temperature':temperature}}
    if max_tokens: payload['options']['num_predict'] = max_tokens
    try:
        data = _json_request(_endpoint(c, 'api/chat'), payload, {'Content-Type':'application/json'}, timeout=180)
    except AIError as error:
        if error.http_status == 404: raise AIError('ollama_model_missing') from None
        if error.http_status: raise AIError('ollama_failed', error.http_status) from None
        raise AIError('ollama_unavailable') from None
    if not isinstance(data, dict) or data.get('error'): raise AIError('ollama_failed')
    text = (data.get('message') or {}).get('content')
    if not isinstance(text, str) or not text.strip(): raise AIError('invalid_response')
    return {'text':text, 'provider':'ollama', 'model':c.model,
            'usage':{'prompt_tokens':data.get('prompt_eval_count'), 'completion_tokens':data.get('eval_count')}}

def _provider_chat(c, messages, temperature, max_tokens):
    headers = {'Content-Type':'application/json'}
    if c.api_key: headers['Authorization'] = 'Bearer ' + c.api_key
    if c.provider == 'anthropic':
        headers = {'x-api-key':c.api_key, 'anthropic-version':'2023-06-01', 'Content-Type':'application/json'}
        payload = {'model':c.model,'messages':[m for m in messages if m['role'] in ('user','assistant')],
                   'temperature':temperature,'max_tokens':max_tokens or 4096}
        instructions = '\n\n'.join(m['content'] for m in messages if m['role'] in ('system','developer'))
        if instructions: payload['system'] = instructions
        data = _json_request(_endpoint(c,'messages'),payload,headers)
        text = ''.join(item.get('text','') for item in data.get('content',[]) if item.get('type') == 'text')
        usage = data.get('usage') or {}
        usage = {'prompt_tokens':usage.get('input_tokens'),'completion_tokens':usage.get('output_tokens')}
    elif c.wire_api == 'responses':
        # Reasoning/Codex models commonly reject temperature on Responses.
        payload = {'model':c.model,'input':[m for m in messages if m['role'] in ('user','assistant')], 'store':False}
        instructions = '\n\n'.join(m['content'] for m in messages if m['role'] in ('system','developer'))
        if instructions: payload['instructions'] = instructions
        if max_tokens: payload['max_output_tokens'] = max_tokens
        data = _json_request(_endpoint(c,'responses'),payload,headers)
        text = data.get('output_text')
        if not isinstance(text,str):
            text = ''.join(part.get('text','') for item in data.get('output',[]) if item.get('type') == 'message'
                           for part in item.get('content',[]) if part.get('type') == 'output_text')
        usage = data.get('usage') or {}
        usage = {'prompt_tokens':usage.get('input_tokens'),'completion_tokens':usage.get('output_tokens')}
    else:
        payload = {'model':c.model,'messages':messages,'temperature':temperature}
        if max_tokens: payload['max_tokens'] = max_tokens
        # These presets support direct answers. Reasoning can otherwise consume
        # the small output budgets used by connection tests and poem selection.
        # Do not pass vendor extensions to an arbitrary custom model.
        preset = PROVIDER_PRESETS.get(c.provider, {})
        if c.model == preset.get('model'):
            if c.provider in ('qwen', 'qwen-intl', 'qwen-us'):
                payload['enable_thinking'] = False
            elif c.provider == 'glm':
                payload['thinking'] = {'type':'disabled'}
        data = _json_request(_endpoint(c,'chat/completions'),payload,headers)
        text = data['choices'][0]['message']['content']
        usage = data.get('usage') or {}
    if not isinstance(text,str) or not text.strip(): raise AIError('invalid_response')
    return {'text':text,'provider':c.provider,'model':c.model,'base_url':c.base_url,
            'usage':{'prompt_tokens':usage.get('prompt_tokens'),'completion_tokens':usage.get('completion_tokens')}}

def _cloud_chat(messages, feature, *, temperature=.2, max_tokens=None):
    from engine import p2_sync
    return p2_sync.cloud_ai(messages,feature,ROOT,temperature=temperature,max_tokens=max_tokens)

def _codex_chat(messages, temperature, max_tokens, feature):
    from backend.ai_integrations import codex_chat
    return codex_chat(messages,temperature=temperature,max_tokens=max_tokens,feature=feature,root=ROOT)

def chat(messages, temperature=.2, max_tokens=None, feature='generic', use_cache=True):
    c = config()
    status = _availability(c,feature)
    if not status['available']: return None
    if not isinstance(messages,list) or not messages or any(
            not isinstance(m,dict) or m.get('role') not in ('system','developer','user','assistant')
            or not isinstance(m.get('content'),str) for m in messages): raise AIError('invalid_messages')
    messages = [{'role':m['role'],'content':m['content']} for m in messages]
    normalized = {'mode':c.mode,'provider':c.provider,'model':status['model'],'base_url':status['base_url'],
                  'wire_api':status['wire_api'],'feature':feature,'messages':messages,
                  'temperature':temperature,'max_tokens':max_tokens}
    ih = hashlib.sha256(json.dumps(normalized,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()
    input_chars = sum(len(m['content']) for m in messages)
    cache_enabled = _boolean('ai.cache') and use_cache
    def log(response=None, *, cached=False, error=None, elapsed=0):
        response = response or {}; usage = response.get('usage') or {}
        pc.log_ai_request(feature_id=feature,provider=c.provider,model=response.get('model') or status['model'],
            input_hash=ih,input_chars=input_chars,output_chars=len(response.get('text') or ''),
            prompt_tokens=usage.get('prompt_tokens'),completion_tokens=usage.get('completion_tokens'),
            cache_hit=cached,sent_remote=status['requires_remote'] and not cached,elapsed_ms=elapsed,error=error,root=ROOT)
    if cache_enabled:
        hit = pc.get_ai_cache(ih,ROOT)
        if hit and isinstance(hit.get('response'),dict):
            response = {**hit['response'],'cache_hit':True,'remote':False}
            log(response,cached=True)
            return response
    started = time.perf_counter()
    try:
        if c.mode == 'cloud': response = _cloud_chat(messages,feature,temperature=temperature,max_tokens=max_tokens)
        elif c.mode == 'codex': response = _codex_chat(messages,temperature,max_tokens,feature)
        elif c.mode == 'ollama': response = _ollama_chat(c,messages,temperature,max_tokens)
        else: response = _provider_chat(c,messages,temperature,max_tokens)
        if not isinstance(response,dict) or not isinstance(response.get('text'),str) or not response['text'].strip():
            raise AIError('invalid_response')
        # Do not propagate upstream debug/error metadata into renderer or cache.
        response = {'text':response['text'],'provider':response.get('provider') or c.provider,
                    'model':response.get('model') or status['model'],'base_url':status['base_url'],
                    'usage':response.get('usage') or {},'cache_hit':False,'remote':status['requires_remote']}
        if cache_enabled: pc.put_ai_cache(ih,response['provider'],response['model'],response,ROOT)
        log(response,elapsed=round((time.perf_counter()-started)*1000))
        return response
    except Exception as error:
        safe = error if isinstance(error,AIError) else AIError('request_failed')
        log(error=str(safe),elapsed=round((time.perf_counter()-started)*1000))
        raise safe from None

def embeddings(texts:list[str]):
    c = config(); status = _availability(c,'ask')
    if not status['available'] or not c.embed_model or c.provider == 'anthropic' or c.mode in ('cloud','codex','ollama'): return None
    headers = {'Content-Type':'application/json'}
    if c.api_key: headers['Authorization'] = 'Bearer ' + c.api_key
    try:
        data = _json_request(_endpoint(c,'embeddings'),{'model':c.embed_model,'input':texts},headers)
        vectors = [item['embedding'] for item in sorted(data.get('data',[]),key=lambda item:item.get('index',0))]
        return {'vectors':vectors,'provider':c.provider,'model':c.embed_model}
    except Exception as error:
        raise (error if isinstance(error,AIError) else AIError('invalid_response')) from None

def payload_preview(items):
    return {'items':len(items),
            'characters':sum(len(str(item.get('excerpt') or item.get('content') or '')) for item in items),
            'sources':sorted({str(item.get('source_path') or item.get('source_name') or '') for item in items
                              if item.get('source_path') or item.get('source_name')})}
