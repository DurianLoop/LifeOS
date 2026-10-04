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
    if (['codex', 'local', 'cloud'].includes(mode)) return mode;
    return data.ai?.config_source !== 'settings' && !data.ai?.configured && ccAvailable(data) ? 'codex' : 'byok';
  }

  async function renderAISettings() {
    try {
      control = await api('/api/ai/control', {noCache: true});
      providers = catalog(control);
      const ai = control.ai || {}, cc = ccAvailable(control), connection = savedConnection(control);
      connectionMode = currentMode(control);
      const enabled = checked(ai.enabled) && ai.mode !== 'disabled';
      const features = (control.features || []).filter(item => Object.hasOwn(FEATURES_LABELS, item.id));
      const status = !enabled ? '已关闭' : ai.available ? '已就绪' : '待连接';
      return pageWrap(`<section class="aiSettingsPage" aria-labelledby="aiSettingsTitle">
        <header class="aiSettingsHeader"><div><h1 id="aiSettingsTitle">AI 设置</h1></div><span class="aiStatus">${status}</span></header>
        <form id="aiSettingsForm" autocomplete="off">
          <label class="aiEnableRow"><span>启用 AI</span><input id="aiEnabled" type="checkbox" ${enabled ? 'checked' : ''}></label>
          ${cc ? `<fieldset class="aiConnectionChoices"><legend class="aiScreenReader">连接方式</legend><label><input type="radio" name="aiConnection" value="byok" ${connectionMode === 'byok' ? 'checked' : ''}><span>模型 API</span></label><label><input type="radio" name="aiConnection" value="codex" ${connectionMode === 'codex' ? 'checked' : ''}><span>跟随 CC Switch</span></label></fieldset>` : ''}
          <div id="aiConnectionNote" class="aiConnectionNote"></div>
          <fieldset id="aiApiFields" class="aiApiFields" ${connectionMode === 'byok' ? '' : 'hidden'}><legend class="aiScreenReader">API 连接</legend>
            <div class="aiMainFields"><label class="aiField">服务商<select id="aiProvider">${providers.map(item => `<option value="${esc(item.id)}"${selected(connection.provider, item.id)}>${esc(item.label)}</option>`).join('')}</select></label><label class="aiField">API Key<input id="aiSecret" type="password" autocomplete="new-password" placeholder="${ai.configured ? '留空保留已有密钥' : '粘贴服务商提供的密钥'}" spellcheck="false"></label></div>
            <details class="aiAdvanced" id="aiAdvancedConnection" ${connection.provider === 'custom' ? 'open' : ''}><summary>自定义服务 <span>可选</span></summary><div class="aiAdvancedFields"><label class="aiField">模型<input id="aiModel" value="${esc(connection.model)}" maxlength="160" required spellcheck="false"></label><label class="aiField">服务地址<input id="aiBaseUrl" type="url" value="${esc(connection.base_url)}" required spellcheck="false"></label><label class="aiField">接口格式<select id="aiWireApi">${Object.entries(WIRES).map(([id, label]) => `<option value="${id}"${selected(connection.wire_api, id)}>${label}</option>`).join('')}</select></label></div></details>
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
    get('aiApiFields').hidden = !apiMode;
    get('aiApiFields').disabled = !apiMode;
    get('aiTestConnection').disabled = busy || !get('aiEnabled').checked;
    const note = get('aiConnectionNote');
    if (apiMode) note.textContent = '';
    else if (connectionMode === 'codex' && ccAvailable(control || {})) note.textContent = '已检测到 CC Switch，将使用它当前的 Codex 配置';
    else {
      const label = {local: '本地模型', cloud: 'Cloud', codex: 'Codex'}[connectionMode] || '模型';
      note.innerHTML = `当前连接：${label}<button class="aiTextButton" type="button" id="aiSwitchToAPI">改用模型 API</button>`;
    }
    note.hidden = apiMode;
  }

  function feedback(message, kind = 'info') {
    notice = {message, kind};
    const output = get('aiSettingsFeedback');
    if (output) { output.textContent = message; output.dataset.kind = kind; }
  }

  function settingsPayload() {
    const enabled = get('aiEnabled').checked;
    const items = {
      'ai.mode': connectionMode, 'ai.enabled': enabled, 'ai.allow_remote': enabled && connectionMode !== 'local',
      'ai.payload_preview': get('aiPayloadPreview').checked, 'ai.cache': get('aiUseCache').checked,
    };
    if (connectionMode === 'byok') Object.assign(items, {
      'ai.provider': get('aiProvider').value, 'ai.model': get('aiModel').value.trim(),
      'ai.base_url': get('aiBaseUrl').value.trim(), 'ai.wire_api': get('aiWireApi').value,
    });
    if (connectionMode === 'codex' && ccAvailable(control || {})) items['ai.codex_model'] = '';
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
    if (target.name === 'aiConnection') { connectionMode = target.value; get('aiSecret').value = ''; }
    updateMode(); feedback('有未保存的修改');
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button, [data-open-ai-settings]');
    if (!button) return;
    if (button.hasAttribute('data-open-ai-settings')) { event.preventDefault(); notice = null; openFeature(NAME); }
    else if (button.id === 'aiTestConnection') void save(true);
    else if (button.id === 'aiSettingsRetry') void render();
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
