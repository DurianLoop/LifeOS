/* Today’s poem: a quiet reading surface over a locally curated anthology. */
(() => {
  'use strict';

  const NAME = 'Daily Poetry';
  const page = {view: 'today', selectedDate: null};
  const STYLES = {qingjian: '清简文言', biji: '笔记小品', shizhuan: '史传纪事', chidu: '尺牍书简'};
  const STRENGTHS = {light: '浅化 · 易读', medium: '中度 · 文言', deep: '凝练 · 古雅'};
  const preferences = settings => ({
    style: Object.hasOwn(STYLES, settings['classical.style']) ? settings['classical.style'] : 'qingjian',
    strength: Object.hasOwn(STRENGTHS, settings['classical.strength']) ? settings['classical.strength'] : 'medium',
    engine: settings['classical.engine'] === 'model' ? 'model' : 'local',
  });
  let installed = false;

  if (!FEATURES.some(item => item.name === NAME)) FEATURES.push({name: NAME, room: 'NOW', desc: '从今天的日记里遇见一首诗', no: FEATURES.length + 1});
  if (ROOMS.NOW?.features) ROOMS.NOW.features.push(NAME);
  FRONT_FEATURES.add(NAME);
  DREAM_META[NAME] = ['今日一诗', ''];

  const poemTitle = record => `${record.poem.author} ·《${record.poem.title}》`;
  const currentCard = record => {
    if (!record?.poem) return '';
    const p = record.poem;
    return `<article class="poetryTodayCard">
      <span class="poetrySeal" aria-hidden="true">诗</span>
      <div class="poetryCardTop"><span>今日所得 · ${esc(record.journal_date)}</span></div>
      <blockquote>${esc(p.quote)}</blockquote>
      <p class="poetryAttribution">${esc(poemTitle(record))}</p>
      <div class="poetryActions"><button type="button" id="poetryWhy" aria-expanded="false">看缘由 <span aria-hidden="true">⌄</span></button><button type="button" id="poetryReadFull">读全篇 <span aria-hidden="true">↗</span></button></div>
      <div class="poetryReason" id="poetryReason" hidden><p>${esc(record.reason)}</p></div>
    </article>`;
  };

  const emptyCard = state => {
    const aiReady = state.ai.available ?? (state.ai.configured && state.ai.enabled && state.ai.allow_remote);
    let title = '今日还没有诗';
    let note = '写下今天，才有一首真正与你有关的诗。';
    let action = '<button type="button" id="poetryWrite">去落笔</button>';
    if (state.has_journal && !aiReady) {
      title = '日记已经写好，先连接 AI';
      note = state.ai.reason || '';
      action = '<button type="button" id="poetryConfigure">配置 AI</button>';
    } else if (state.has_journal) {
      title = state.generating ? '正在为今天寻一首诗…' : '今天的日记，等着一首诗';
      note = state.generating ? '生成完成后会自动出现在这里。' : '点击后将当天日记发给已配置的 AI，由它在未读的诗里选一首。';
      action = state.generating ? '' : '<button type="button" id="poetryGenerate">生成今日一诗</button>';
    }
    return `<section class="poetryEmpty"><div class="poetryEmptyGlyph" aria-hidden="true">〝</div><h2>${esc(title)}</h2>${note ? `<p>${esc(note)}</p>` : ''}${action}${state.last_error ? `<small role="status">${esc(state.last_error)}</small>` : ''}</section>`;
  };

  const detail = record => {
    if (!record?.poem) return '<p class="poetryMissing">这首诗暂时无法读取。</p>';
    const p = record.poem;
    return `<article class="poetryFull"><h2>${esc(p.title)}</h2><p class="poetryFullAuthor">${esc(p.author)} · ${esc(record.journal_date)} 所得</p>
      <div class="poetryVerses">${p.lines.map(line => `<p>${esc(line)}</p>`).join('')}</div>
      <div class="poetryNotes"><span>注解</span><p>${esc(p.annotation)}</p></div>
      <div class="poetryNotes poetryNotesReason"><span>那天为何是它</span><p>${esc(record.reason)}</p></div>
    </article>`;
  };

  async function settingsPanel(state) {
    const [core, ai] = await Promise.all([api('/api/core/status', {noCache: true}), api('/api/ai/control', {noCache: true})]);
    const prefs = preferences(core.settings || {});
    const savedLanguage = core.settings?.['ui.language_preset'] || (core.settings?.['ui.locale'] === 'en-US' ? 'en' : core.settings?.['ui.copy_mode'] === 'bilingual' ? 'bilingual' : 'poetic');
    const language = document.querySelector('#languagePreset')?.value || savedLanguage;
    const classical = (ai.features || []).find(item => item.id === 'classical');
    const ready = classical?.available === true;
    const options = (items, value) => Object.entries(items).map(([id, label]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<section class="poetrySettings" aria-labelledby="poetrySettingsTitle"><div class="poetrySettingsHeading"><h2 id="poetrySettingsTitle">诗文设置</h2></div>
      <div class="poetrySettingRow"><div><h3>界面语言与文案</h3></div><select class="poetryLanguageSelect" id="poetryLanguagePreset" aria-label="界面语言与文案">${options({poetic: '诗文', bilingual: '中英文结合', en: 'English'}, language)}</select></div>
      <div class="poetrySettingRow"><div><h3>自动荐诗</h3><p>保存当天日记后，请 AI 从诗词库选一首。</p>${!state.ai.available ? '<small>启用 AI 荐诗后生效。</small>' : ''}</div><label class="poetrySettingCheck"><input id="poetryAuto" type="checkbox" ${state.auto_enabled ? 'checked' : ''}><span>保存后自动推荐</span></label></div>
      <form id="poetrySettingsForm"><div class="poetrySettingRow"><div><h3>文言化偏好</h3></div><button class="poetryTextButton" type="button" id="poetryClassical">打开文言化 ↗</button></div><div class="poetryPreferenceFields"><label>文体<select id="poetryClassicalStyle">${options(STYLES, prefs.style)}</select></label><label>程度<select id="poetryClassicalStrength">${options(STRENGTHS, prefs.strength)}</select></label><label>处理方式<select id="poetryClassicalEngine"><option value="local" ${prefs.engine !== 'model' || !ready ? 'selected' : ''}>本地草译</option><option value="model" ${prefs.engine === 'model' && ready ? 'selected' : ''} ${ready ? '' : 'disabled'}>AI 文言化</option></select></label></div>
      ${!ready ? `<p class="poetrySettingsHelp">${esc(classical?.reason || '连接并允许 AI 文言化后，即可选择 AI 处理。')} 本地草译始终可用。</p>` : ''}<div class="poetrySettingsFoot"><p id="poetryPreferencesFeedback" role="status" aria-live="polite"></p><button class="poetrySettingsSave" type="submit">保存偏好</button></div></form><button class="poetryTextButton" id="poetryAISettings" type="button">AI 连接与功能开关 ↗</button>
    </section>`;
  }

  async function renderPoetry() {
    const state = await api('/api/poetry?date=' + encodeURIComponent(localDateISO()), {noCache: true});
    const history = state.history || [];
    if (page.view === 'library' && !history.some(x => x.journal_date === page.selectedDate)) page.selectedDate = history[0]?.journal_date || null;
    const selected = history.find(x => x.journal_date === page.selectedDate);
    const settings = page.view === 'settings' ? await settingsPanel(state) : '';
    return pageWrap(`<section class="poetryPage">
      <header class="poetryHeader"><div><h1>今日一诗</h1></div><div class="poetryHeaderDate"><b>${esc(state.date.slice(8))}</b><span>${esc(state.date.slice(0,7))}</span></div></header>
      <nav class="poetryTabs" aria-label="今日一诗页面"><button type="button" data-poetry-view="today" ${page.view === 'today' ? 'aria-current="page"' : ''}>今日</button><button type="button" data-poetry-view="library" ${page.view === 'library' ? 'aria-current="page"' : ''}>诗词库 <small>${history.length}</small></button><button type="button" data-poetry-view="settings" ${page.view === 'settings' ? 'aria-current="page"' : ''}>诗文设置</button></nav>
      ${page.view === 'settings' ? settings : page.view === 'today' ? `<div class="poetryTodayLayout">${state.current ? currentCard(state.current) : emptyCard(state)}<aside class="poetrySideNote"><label class="poetryAuto"><input type="checkbox" id="poetryAuto" ${state.auto_enabled ? 'checked' : ''}><span><b>保存日记后自动荐诗</b><small>开启后，当天首次保存日记会发送当天正文给已配置的 AI。</small></span></label><small class="poetryRemain">诗词库还有 ${state.remaining} 首未曾相遇</small></aside></div>` : `<div class="poetryLibrary">${history.length ? `<div class="poetryLibraryList" aria-label="往日所得">${history.map(r => `<button type="button" data-poetry-day="${esc(r.journal_date)}" class="${r.journal_date === page.selectedDate ? 'active' : ''}"><time>${esc(r.journal_date)}</time><span>${esc(r.poem?.quote || '诗词资料暂缺')}</span><small>${esc(r.poem ? poemTitle(r) : '')}</small></button>`).join('')}</div>${detail(selected)}` : `<div class="poetryLibraryEmpty"><p>诗词库还是空的。今日遇见的诗，会自动留在这里。</p><button type="button" data-poetry-view="today">回到今日</button></div>`}</div>`}
    </section>`);
  }

  function bindPoetry() {
    if (STATE.feature === NAME) {
      document.querySelectorAll('[data-poetry-view]').forEach(button => button.onclick = () => {page.view = button.dataset.poetryView; render()});
      document.querySelectorAll('[data-poetry-day]').forEach(button => button.onclick = () => {page.selectedDate = button.dataset.poetryDay; render()});
      const why = document.querySelector('#poetryWhy');
      if (why) why.onclick = () => {const panel = document.querySelector('#poetryReason'); const open = panel.hidden; panel.hidden = !open; why.setAttribute('aria-expanded', String(open)); why.innerHTML = open ? '收起缘由 <span aria-hidden="true">⌃</span>' : '看缘由 <span aria-hidden="true">⌄</span>'};
      const full = document.querySelector('#poetryReadFull');
      if (full) full.onclick = () => {page.selectedDate = localDateISO(); page.view = 'library'; render()};
      const generateButton = document.querySelector('#poetryGenerate');
      if (generateButton) generateButton.onclick = async () => {generateButton.disabled = true; generateButton.textContent = '正在寻诗…'; try {await post('/api/poetry/generate', {date: localDateISO()}); await render()} catch (error) {toast(error.message); generateButton.disabled = false; generateButton.textContent = '生成今日一诗'}};
      const auto = document.querySelector('#poetryAuto');
      if (auto) auto.onchange = async () => {auto.disabled = true; try {await post('/api/poetry/settings', {auto_enabled: auto.checked}); toast(auto.checked ? '以后保存当天日记时会自动荐诗' : '已关闭自动荐诗')} catch (error) {auto.checked = !auto.checked; toast(error.message)} finally {auto.disabled = false}};
      const language = document.querySelector('#poetryLanguagePreset');
      if (language) language.onchange = async () => {
        const existing = document.querySelector('#languagePreset');
        if (!existing || typeof existing.onchange !== 'function') {
          toast('请在微调中的「语言与文案」切换。');
          document.querySelector('#allRail')?.click();
          return;
        }
        // Reuse the shell's preference writer and immediate copy refresh.
        existing.value = language.value;
        language.disabled = true;
        try { await existing.onchange({target: existing}); }
        finally { language.disabled = false; }
      };
      const settingsForm = document.querySelector('#poetrySettingsForm');
      if (settingsForm) settingsForm.onsubmit = async event => {
        event.preventDefault();
        const button = settingsForm.querySelector('button[type="submit"]'), message = document.querySelector('#poetryPreferencesFeedback');
        const items = {'classical.style': document.querySelector('#poetryClassicalStyle').value, 'classical.strength': document.querySelector('#poetryClassicalStrength').value, 'classical.engine': document.querySelector('#poetryClassicalEngine').value};
        button.disabled = true;
        try { await post('/api/product/settings', {items}); message.textContent = '偏好已保存'; }
        catch { message.textContent = '未能保存，请稍后重试。'; }
        finally { button.disabled = false; }
      };
      document.querySelector('#poetryClassical')?.addEventListener('click', () => openFeature('文言化'));
      document.querySelector('#poetryAISettings')?.addEventListener('click', () => openFeature('AI Settings'));
      document.querySelector('#poetryConfigure')?.addEventListener('click', () => openFeature('AI Settings'));
      document.querySelector('#poetryWrite')?.addEventListener('click', () => openProductDock('writer', {date: localDateISO()}));
      if (document.querySelector('.poetryEmpty')?.textContent.includes('正在为今天寻一首诗')) setTimeout(() => {if (STATE.feature === NAME) render()}, 2500);
    }
    if (STATE.feature === 'Home') mountHomeLink();
  }

  async function mountHomeLink() {
    const target = document.querySelector('.v01HomePrimary');
    if (!target || target.querySelector('.poetryHomeLink')) return;
    try {
      const state = await api('/api/poetry?date=' + encodeURIComponent(localDateISO()), {noCache: true});
      if (!target.isConnected || (!state.current && !state.has_journal)) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'poetryHomeLink';
      button.textContent = state.current ? '今日一诗 · 已得' : '今日一诗 · 待展';
      button.onclick = () => {page.view = 'today'; openFeature(NAME)};
      target.append(button);
    } catch (_) { /* Home remains usable if the local poetry service is unavailable. */ }
  }

  function install() {
    if (installed) return;
    installed = true;
    const priorBind = bindSpecific;
    bindSpecific = function(...args) {const result = priorBind.apply(this, args); bindPoetry(); return result};
    RENDERERS[NAME] = renderPoetry;
    if (STATE.feature === NAME) render();
  }

  RENDERERS[NAME] = renderPoetry;
  window.lifeosPoetry = {preferences, openSettings() {page.view = 'settings'; openFeature(NAME);}};
  // The asynchronous shell replaces bindSpecific when it becomes ready. If
  // the fallback already ran, install again around that final binding hook.
  window.addEventListener('lifeos:i2-ready', () => { installed = false; install(); }, {once: true});
  setTimeout(install, 1200);
})();
