"""Public connection presets. No credentials or per-user configuration."""

PROVIDER_PRESETS = {
    'deepseek': {'label': 'DeepSeek', 'model': 'deepseek-chat',
                 'base_url': 'https://api.deepseek.com', 'wire_api': 'chat_completions'},
    'qwen': {'label': 'Qwen · 中国大陆', 'model': 'qwen-plus',
             'base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'wire_api': 'chat_completions'},
    'qwen-intl': {'label': 'Qwen · 国际', 'model': 'qwen-plus',
                  'base_url': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'wire_api': 'chat_completions'},
    'qwen-us': {'label': 'Qwen · 美国', 'model': 'qwen-plus',
                'base_url': 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', 'wire_api': 'chat_completions'},
    'glm': {'label': 'GLM · 智谱', 'model': 'glm-4.7',
            'base_url': 'https://open.bigmodel.cn/api/paas/v4', 'wire_api': 'chat_completions'},
    'openai': {'label': 'OpenAI', 'model': 'gpt-4.1-mini',
               'base_url': 'https://api.openai.com/v1', 'wire_api': 'responses'},
    'anthropic': {'label': 'Anthropic', 'model': 'claude-sonnet-4-5',
                  'base_url': 'https://api.anthropic.com', 'wire_api': 'anthropic'},
}


def public_presets():
    return [{'id': provider, **fields} for provider, fields in PROVIDER_PRESETS.items()]
