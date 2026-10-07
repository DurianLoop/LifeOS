# Ollama 本地模型 Demo

LifeOS v0.5.1 可通过 Ollama 运行本机已下载的模型。LifeOS 不捆绑 Ollama、不安装模型，也不会在未选择 Ollama 时调用它。

1. 在电脑上安装并启动 Ollama，并在 Ollama 中下载一个模型
2. 打开左下设置齿轮 → AI 设置，选择 **Ollama Demo**
3. 选择自动发现的本机模型，点击 **保存并测试**
4. 在灵犀中问一个产品使用问题，或在人生问答中确认证据后生成回答

刷新按钮重新读取已下载模型。连接失败时先启动 Ollama 再重试；模型已删除时刷新并重选。无需 API Key，默认地址是 `http://localhost:11434`。API 与 Codex 连接独立保存，切换模式不会覆盖它们。

Demo 使用 Ollama 原生 `GET /api/tags` 和 `POST /api/chat`，目前一次返回完整文字，使用 `think: false` 请求直接回答。模型列表排除 Ollama Cloud 云模型。请求仅允许本机回环地址，不经系统代理、不跟随重定向。生成复用统一 AI 权限、功能开关、选中证据确认、本地缓存与脱敏记录，整个日记库不会自动附加。本地模型关闭或请求失败时不改用云端模型。

本机模型的速度、中文表现和证据引用质量取决于模型与硬件。若本机没有安装 Ollama，LifeOS 会提示启动服务；测试使用连接测试的合成短句，不发送日记或聊天历史。

验证命令：

```powershell
python -m unittest scripts.test_ollama_demo scripts.test_ai_providers scripts.test_ai_control
node scripts/test_ai_settings_ui.mjs
```

`test_ollama_demo` 在回环地址启动临时 HTTP 服务验证原生协议、缓存、权限和失败路径，不下载模型或调用外部服务。真实模型验收需在已安装 Ollama 且有模型的电脑上按上述步骤完成。
