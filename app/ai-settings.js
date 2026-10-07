/* Shared AI connection preferences. Passwords exist only in the form/request. */
(() => {
  'use strict';
  const NAME = 'AI Settings';
  const FALLBACK = [
    {id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', base_url: 'https://api.deepseek.com', wire_api: 'chat_completions'},
    {id: 'custom', label: '自定义服务', model: '', base_url: '', wire_api: 'chat_completions'},
  ];
  const WIRES = {chat_completions: 'Chat Completions', responses: 'Responses', anthropic: 'Anthropic Messages'};
  const FEATURES_LABELS = {ask: '人生问答', past_me: '以前的我', classical: 'AI 文言化', pet: '桌宠聊天'};
  const get = id => document.getElementById(id);
  const checked = value => value === true || value === 'true';
  const selected = (value, expected) => value === expected ? ' selected' : '';
  let control = null, providers = FALLBACK, connectionMode = 'byok', busy = false, notice = null;
  let localLoaded = false, localRequest = 0;

  if (!FEATURES.some(item => item.name === NAME)) FEATURES.push({name: NAME, room: 'ARCHIVE', desc: '模型连接与功能设置', no: FEATURES.length + 1});
  DREAM_META[NAME] = ['AI 设置', ''];

  function catalog(data) {
    const rows = Array.isArray(data.providers) ? data.providers.filter(item => item.id && item.label) : FALLBACK;
    const result = rows.length ? [...rows] : [...FALLBACK];
    if (!result.some(item => item.id === 'custom')) result.push(FALLBACK[1]);
    return result;
  }

  function savedConnection(data) {
    const saved = data.saved_connection || data.ai || {};
    const preset = providers.find(item => item.id === saved.provider) || providers[0];
    const known = preset.id === saved.provider;
    return {
      provider: preset.id,
      model: known ? saved.model || preset.model : preset.model,
      base_url: known ? saved.base_url || preset.base_url : preset.base_url,
      wire_api: known && Object.hasOwn(WIRES, saved.wire_api) ? saved.wire_api : preset.wire_api || 'chat_completions',
    };
  }

  function ccAvailable(data) { return data.integrations?.cc_switch?.installed === true && data.integrations?.codex?.available === true; }
  function currentMode(data) {
    const mode = data.ai?.mode;
    if (['codex', 'local', 'cloud', 'ollama'].includes(mode)) return mode;
    return data.ai?.config_source !== 'settings' && !data.ai?.configured && ccAvailable(data) ? 'codex' : 'byok';
  }

  async function renderAISettings() {
    try {
      control = await api('/api/ai/control', {noCache: true});
      providers = catalog(control);
      const ai = control.ai || {}, cc = ccAvailable(control), connection = savedConnection(control);
      connectionMode = currentMode(control);
      localLoaded = false; localRequest++;
      const enabled = checked(ai.enabled) && ai.mode !== 'disabled';
      const features = (control.features || []).filter(item => Object.hasOwn(FEATURES_LABELS, item.id));
      const status = !enabled ? '已关闭' : ai.available && notice?.kind !== 'error' ? '已就绪' : '待连接';
      return pageWrap(`<section class="aiSettingsPage" aria-labelledby="aiSettingsTitle">
        <header class="aiSettingsHeader"><div><h1 id="aiSettingsTitle">AI 设置</h1></div><span class="aiStatus" id="aiSettingsStatus">${status}</span></header>
        <form id="aiSettingsForm" autocomplete="off">
          <label class="aiEnableRow"><span>启用 AI</span><input id="aiEnabled" type="checkbox" ${enabled ? 'checked' : ''}></label>
          <fieldset class="aiConnectionChoices"><legend class="aiScreenReader">连接方式</legend><label><input type="radio" name="aiConnection" value="byok" ${connectionMode === 'byok' ? 'checked' : ''}><span>模型 API</span></label>${cc ? `<label><input type="radio" name="aiConnection" value="codex" ${connectionMode === 'codex' ? 'checked' : ''}><span>跟随 CC Switch</span></label>` : ''}<label><input type="radio" name="aiConnection" value="ollama" ${connectionMode === 'ollama' ? 'checked' : ''}><span>Ollama <small>Demo</small></span></label></fieldset>
          <div id="aiConnectionNote" class="aiConnectionNote"></div>
          <fieldset id="aiApiFields" class="aiApiFields" ${connectionMode === 'byok' ? '' : 'hidden'}><legend class="aiScreenReader">API 连接</legend>
            <div class="aiMainFields"><label class="aiField">服务商<select id="aiProvider">${providers.map(item => `<option value="${esc(item.id)}"${selected(connection.provider, item.id)}>${esc(item.label)}</option>`).join('')}</select></label><label class="aiField">API Key<input id="aiSecret" type="password" autocomplete="new-password" placeholder="${ai.configured ? '留空保留已有密钥' : '粘贴服务商提供的密钥'}" spellcheck="false"></label></div>
            <details class="aiAdvanced" id="aiAdvancedConnection" ${connection.provider === 'custom' ? 'open' : ''}><summary>自定义服务 <span>可选</span></summary><div class="aiAdvancedFields"><label class="aiField">模型<input id="aiModel" value="${esc(connection.model)}" maxlength="160" required spellcheck="false"></label><label class="aiField">服务地址<input id="aiBaseUrl" type="url" value="${esc(connection.base_url)}" required spellcheck="false"></label><label class="aiField">接口格式<select id="aiWireApi">${Object.entries(WIRES).map(([id, label]) => `<option value="${id}"${selected(connection.wire_api, id)}>${label}</option>`).join('')}</select></label></div></details>
          </fieldset>
          <fieldset id="aiOllamaFields" class="aiApiFields" ${connectionMode === 'ollama' ? '' : 'hidden'}><legend class="aiScreenReader">Ollama 本地模型</legend>
            <div class="aiLocalModelRow"><label class="aiField">本机模型<select id="aiOllamaModel" required><option value="${esc(control.ollama?.model || '')}">${esc(control.ollama?.model || '选择已下载的模型')}</option></select></label><button class="aiButton aiRefreshModels" type="button" id="aiOllamaRefresh" aria-label="刷新本机模型" title="刷新本机模型"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17"/></svg></button></div><p class="aiLocalFeedback" id="aiOllamaFeedback" role="status" aria-live="polite"></p>
          </fieldset>
          <div class="aiSaveBar"><p id="aiSettingsFeedback" role="status" aria-live="polite" ${notice ? `data-kind="${notice.kind}"` : ''}>${esc(notice?.message || '')}</p><div class="aiSaveActions"><button class="aiButton" type="button" id="aiTestConnection">保存并测试</button><button class="aiButton aiButtonPrimary" type="submit" id="aiSaveSettings">保存</button></div></div>
          <details class="aiFeatureSettings"><summary>功能设置 <span>${features.filter(item => checked(item.enabled)).length} 项已允许</span></summary><div class="aiFeatureGrid">${features.map(feature => `<label><span>${esc(FEATURES_LABELS[feature.id])}</span><input type="checkbox" data-ai-setting="${esc(feature.setting_key || `ai.features.${feature.id}`)}" ${checked(feature.enabled) ? 'checked' : ''}></label>`).join('')}<label><span>发送前显示证据摘要</span><input id="aiPayloadPreview" type="checkbox" ${checked(ai.payload_preview) ? 'checked' : ''}></label><label><span>复用本地 AI 缓存</span><input id="aiUseCache" type="checkbox" ${checked(ai.cache) ? 'checked' : ''}></label></div></details>
        </form>
      </section>`);
    } catch {
      return pageWrap('<section class="aiSettingsPage"><h1>暂时无法读取设置</h1><p>请检查本地服务后重试。</p><button class="aiButton" type="button" id="aiSettingsRetry">重新加载</button></section>');
    }
  }

  function updateMode() {
    if (!get('aiSettingsForm')) return;
    const apiMode = connectionMode === 'byok';
    const localMode = connectionMode === 'ollama';
    get('aiApiFields').hidden = !apiMode;
    get('aiApiFields').disabled = !apiMode;
    get('aiOllamaFields').hidden = !localMode;
    get('aiOllamaFields').disabled = !localMode;
    get('aiTestConnection').disabled = busy || !get('aiEnabled').checked;
    const note = get('aiConnectionNote');
    if (apiMode || localMode) note.textContent = '';
    else if (connectionMode === 'codex' && ccAvailable(control || {})) note.textContent = '已检测到 CC Switch，将使用它当前的 Codex 配置';
    else {
      const label = {local: '本地模型', cloud: 'Cloud', codex: 'Codex'}[connectionMode] || '模型';
      note.innerHTML = `当前连接：${label}<button class="aiTextButton" type="button" id="aiSwitchToAPI">改用模型 API</button>`;
    }
    note.hidden = apiMode || localMode;
    if (localMode && !localLoaded) void discoverModels();
  }

  async function discoverModels(clearError = false) {
    const form = get('aiSettingsForm'), model = get('aiOllamaModel'), button = get('aiOllamaRefresh'), output = get('aiOllamaFeedback');
    if (!form || !model || connectionMode !== 'ollama') return;
    localLoaded = true;
    const sequence = ++localRequest, previous = model.value;
    if (clearError && notice?.kind === 'error') feedback('');
    button.disabled = true; output.textContent = '正在读取本机模型…'; output.dataset.kind = 'info';
    try {
      const query = control?.ollama?.base_url ? `?base_url=${encodeURIComponent(control.ollama.base_url)}` : '';
      const result = await api('/api/ai/ollama/models' + query, {noCache: true});
      if (sequence !== localRequest || get('aiSettingsForm') !== form || connectionMode !== 'ollama') return;
      const names = result.ok && Array.isArray(result.models) ? result.models.filter(name => typeof name === 'string' && name) : [];
      const value = names.includes(previous) ? previous : names[0] || previous;
      model.innerHTML = names.length ? names.map(name => `<option value="${esc(name)}"${selected(value, name)}>${esc(name)}</option>`).join('') : `<option value="${esc(previous)}">${esc(previous || '暂无本机模型')}</option>`;
      model.value = value;
      output.textContent = result.message || (names.length ? '' : '请先在 Ollama 下载一个模型，再刷新');
      output.dataset.kind = names.length ? 'info' : 'error';
      if (!names.length && get('aiSettingsStatus')) get('aiSettingsStatus').textContent = '待连接';
    } catch {
      if (sequence === localRequest && get('aiSettingsForm') === form) { output.textContent = '请启动本机 Ollama，再刷新'; output.dataset.kind = 'error'; if (get('aiSettingsStatus')) get('aiSettingsStatus').textContent = '待连接'; }
    } finally {
      if (sequence === localRequest && get('aiSettingsForm') === form) button.disabled = busy;
    }
  }

  function feedback(message, kind = 'info') {
    notice = {message, kind};
    const output = get('aiSettingsFeedback');
    if (output) { output.textContent = message; output.dataset.kind = kind; }
  }

  function settingsPayload() {
    const enabled = get('aiEnabled').checked;
    const items = {
      'ai.mode': connectionMode, 'ai.enabled': enabled, 'ai.allow_remote': enabled && !['local', 'ollama'].includes(connectionMode),
      'ai.payload_preview': get('aiPayloadPreview').checked, 'ai.cache': get('aiUseCache').checked,
    };
    if (connectionMode === 'byok') Object.assign(items, {
      'ai.provider': get('aiProvider').value, 'ai.model': get('aiModel').value.trim(),
      'ai.base_url': get('aiBaseUrl').value.trim(), 'ai.wire_api': get('aiWireApi').value,
    });
    if (connectionMode === 'codex' && ccAvailable(control || {})) items['ai.codex_model'] = '';
    if (connectionMode === 'ollama') items['ai.ollama_model'] = get('aiOllamaModel').value;
    document.querySelectorAll('#aiSettingsForm [data-ai-setting]').forEach(input => { if (!input.disabled) items[input.dataset.aiSetting] = input.checked; });
    const payload = {items}, key = get('aiSecret').value.trim();
    if (key && connectionMode === 'byok') payload.key = key;
    return payload;
  }

  async function save(testConnection = false) {
    const form = get('aiSettingsForm');
    if (connectionMode === 'byok' && (!get('aiModel')?.value.trim() || !get('aiBaseUrl')?.value.trim())) get('aiAdvancedConnection').open = true;
    if (busy || !form || !form.reportValidity()) return;
    const payload = settingsPayload();
    busy = true;
    const controls = [...form.querySelectorAll('input, select, button')], disabled = controls.map(item => item.disabled);
    controls.forEach(item => { item.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    try {
      feedback(testConnection ? '正在保存并测试…' : '正在保存…');
      const saved = await post('/api/ai/settings', payload);
      if (saved.ok === false) throw new Error('save failed');
      get('aiSecret').value = '';
      feedback('已保存', 'success');
      if (testConnection) {
        try {
          const result = await post('/api/ai/test', {});
          feedback(result.message || (result.ok ? '连接成功' : '连接失败，请检查服务商与密钥。'), result.ok ? 'success' : 'error');
        } catch { feedback('已保存，但测试未完成。请稍后重试。', 'error'); }
      }
      if (STATE.feature === NAME) await render();
    } catch { feedback('未能保存，请检查设置后重试。', 'error'); }
    finally {
      busy = false;
      controls.forEach((item, i) => { item.disabled = disabled[i]; });
      form.removeAttribute('aria-busy'); updateMode();
    }
  }

  document.addEventListener('submit', event => { if (event.target.id === 'aiSettingsForm') { event.preventDefault(); void save(); } });
  document.addEventListener('input', event => { if (event.target.closest?.('#aiSettingsForm')) feedback('有未保存的修改'); });
  document.addEventListener('change', event => {
    const target = event.target;
    if (!target.closest?.('#aiSettingsForm')) return;
    if (target.id === 'aiProvider') {
      const preset = providers.find(item => item.id === target.value);
      if (preset) {
        get('aiModel').value = preset.model || ''; get('aiBaseUrl').value = preset.base_url || '';
        get('aiWireApi').value = preset.wire_api || 'chat_completions'; get('aiSecret').value = '';
        get('aiAdvancedConnection').open = preset.id === 'custom';
      }
    }
    if (target.name === 'aiConnection') { connectionMode = target.value; get('aiSecret').value = ''; localRequest++; localLoaded = false; }
    updateMode(); feedback('有未保存的修改');
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button, [data-open-ai-settings]');
    if (!button) return;
    if (button.hasAttribute('data-open-ai-settings')) { event.preventDefault(); notice = null; openFeature(NAME); }
    else if (button.id === 'aiTestConnection') void save(true);
    else if (button.id === 'aiSettingsRetry') void render();
    else if (button.id === 'aiOllamaRefresh') void discoverModels(true);
    else if (button.id === 'aiSwitchToAPI') {
      connectionMode = 'byok'; get('aiSecret').value = '';
      const choice = document.querySelector('#aiSettingsForm input[name="aiConnection"][value="byok"]');
      if (choice) choice.checked = true;
      updateMode(); feedback('有未保存的修改');
    }
  });

  function install() {
    RENDERERS[NAME] = renderAISettings;
    const prior = bindSpecific;
    if (prior.__aiSettings) return;
    bindSpecific = function(...args) { const result = prior.apply(this, args); if (STATE.feature === NAME) updateMode(); return result; };
    bindSpecific.__aiSettings = true;
    if (STATE.feature === NAME) render();
  }
  install();
  window.addEventListener('lifeos:i2-ready', install, {once: true});
})();
