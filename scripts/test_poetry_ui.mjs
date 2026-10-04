import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../app/poetry.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../app/v01.js', import.meta.url), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

function setup() {
  const events = {};
  const timers = [];
  const panel = { hidden: true };
  const why = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const context = {
    FEATURES: [], ROOMS: { NOW: { features: [] } }, FRONT_FEATURES: new Set(), DREAM_META: {},
    STATE: { feature: 'Daily Poetry' }, RENDERERS: {},
    render() {}, bindSpecific() {},
    document: {
      querySelectorAll() { return []; },
      querySelector(selector) { return { '#poetryWhy': why, '#poetryReason': panel }[selector]; },
    },
    window: { addEventListener(name, handler) { events[name] = handler; } },
    setTimeout(callback) { timers.push(callback); },
  };
  vm.runInNewContext(code, context, { filename: 'poetry.js' });
  return { context, events, timers, why, panel };
}

function settingsApp({available = true, failAuto = false} = {}) {
  const nodes = {}, timers = [], posts = [], settings = {'classical.style': 'biji', 'classical.strength': 'deep', 'classical.engine': 'model'};
  const state = {date: '2026-10-03', history: [], remaining: 100, auto_enabled: false, ai: {available}};
  const permission = {id: 'classical', enabled: available, available, reason: '请先允许 AI 文言化'};
  const button = {disabled: false};
  nodes.poetrySettingsForm = {querySelector: () => button};
  nodes.poetryPreferencesFeedback = {};
  nodes.poetryAuto = {checked: false, disabled: false};
  nodes.poetryClassicalStyle = {value: 'biji'};
  nodes.poetryClassicalStrength = {value: 'deep'};
  nodes.poetryClassicalEngine = {value: available ? 'model' : 'local'};
  let opened;
  const context = {
    FEATURES: [], ROOMS: {NOW: {features: []}}, FRONT_FEATURES: new Set(), DREAM_META: {},
    STATE: {feature: 'Daily Poetry'}, RENDERERS: {}, render() {}, bindSpecific() {},
    esc, pageWrap: text => text, localDateISO: () => '2026-10-03', toast() {},
    openFeature(name) { opened = name; },
    async api(url) {
      if (url.startsWith('/api/poetry')) return state;
      if (url === '/api/core/status') return {settings};
      if (url === '/api/ai/control') return {features: [permission]};
      if (url.startsWith('/api/journals')) return {items: []};
      throw new Error(`unexpected API ${url}`);
    },
    async post(url, payload) {
      posts.push({url, payload: JSON.parse(JSON.stringify(payload))});
      if (url === '/api/poetry/settings') {if (failAuto) throw new Error('offline'); state.auto_enabled = payload.auto_enabled;}
      if (url === '/api/product/settings') Object.assign(settings, payload.items);
      return {ok: true};
    },
    document: {querySelectorAll: () => [], querySelector: selector => nodes[selector.slice(1)]},
    window: {addEventListener() {}}, setTimeout(callback) { timers.push(callback); },
  };
  vm.runInNewContext(code, context, {filename: 'poetry.js'});
  timers[0]();
  context.window.lifeosPoetry.openSettings();
  const start = index.indexOf('async function renderClassicalChinese(){'), end = index.indexOf('\nconst RENDERERS=', start);
  context.pref = () => ''; context.moduleHead = () => ''; context.STATE.classicalSource = null;
  vm.runInNewContext(index.slice(start, end), context);
  return {nodes, posts, settings, state, context, permission, get opened() { return opened; }};
}

test('poetry settings restore saved preferences and provide the actual automatic recommendation switch', async () => {
  const app = settingsApp();
  const html = await app.context.RENDERERS['Daily Poetry']();
  assert.equal(app.opened, 'Daily Poetry');
  assert.match(html, /data-poetry-view="settings" aria-current="page"/);
  assert.match(html, /id="poetryAuto"/);
  assert.match(html, /value="biji" selected/);
  assert.match(html, /value="deep" selected/);
  app.context.bindSpecific();
  app.nodes.poetryAuto.checked = true;
  await app.nodes.poetryAuto.onchange();
  assert.deepEqual(app.posts[0], {url: '/api/poetry/settings', payload: {auto_enabled: true}});
  assert.equal(app.state.auto_enabled, true);
  assert.match(await app.context.RENDERERS['Daily Poetry'](), /id="poetryAuto" type="checkbox" checked/);
});

test('automatic recommendation rolls back the checkbox when saving fails', async () => {
  const app = settingsApp({failAuto: true});
  app.context.bindSpecific(); app.nodes.poetryAuto.checked = true;
  await app.nodes.poetryAuto.onchange();
  assert.equal(app.nodes.poetryAuto.checked, false);
  assert.equal(app.nodes.poetryAuto.disabled, false);
});

test('poetry language selection uses the existing shell writer and survives reopening', async () => {
  const app = settingsApp();
  app.nodes.poetryLanguagePreset = {value: 'poetic', disabled: false};
  app.nodes.languagePreset = {value: 'poetic'};
  const remembered = [];
  Object.assign(app.context, {select: app.nodes.languagePreset, state: {preset: 'poetic'},
    PRESETS: {poetic: {locale: 'zh-CN', copyMode: 'poetic'}, bilingual: {locale: 'zh-CN', copyMode: 'bilingual'}, en: {locale: 'en-US', copyMode: 'clear'}},
    remember(key, value) {remembered.push([key, value]);}, applyCoreCopy() {}});
  const start = shell.indexOf('select.onchange=async e=>{');
  const end = shell.indexOf('\n    };', start) + '\n    };'.length;
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(shell.slice(start, end), app.context);
  app.context.bindSpecific();
  for (const [preset, locale, copyMode] of [['bilingual', 'zh-CN', 'bilingual'], ['en', 'en-US', 'clear'], ['poetic', 'zh-CN', 'poetic']]) {
    app.nodes.poetryLanguagePreset.value = preset;
    await app.nodes.poetryLanguagePreset.onchange();
    assert.equal(app.context.state.preset, preset);
    assert.equal(app.nodes.poetryLanguagePreset.disabled, false);
    assert.deepEqual(app.posts.at(-1), {url: '/api/product/settings', payload: {items: {'ui.locale': locale, 'ui.copy_mode': copyMode, 'ui.language_preset': preset}}});
    assert.deepEqual(remembered.at(-1), ['languagePreset', preset]);
    assert.match(await app.context.RENDERERS['Daily Poetry'](), new RegExp(`value="${preset}" selected`));
  }
});

test('poetry preferences persist and are consumed by the actual classical conversion page', async () => {
  const app = settingsApp();
  app.context.bindSpecific();
  app.nodes.poetryClassicalStyle.value = 'chidu'; app.nodes.poetryClassicalStrength.value = 'light';
  app.nodes.poetryClassicalEngine.value = 'local';
  await app.nodes.poetrySettingsForm.onsubmit({preventDefault() {}});
  assert.deepEqual(app.posts[0], {url: '/api/product/settings', payload: {items: {'classical.style': 'chidu', 'classical.strength': 'light', 'classical.engine': 'local'}}});
  const html = await app.context.renderClassicalChinese();
  assert.match(html, /value="chidu" selected/); assert.match(html, /value="light" selected/);
  assert.match(html, /value="local" selected/);
});

test('unified AI permission disables model conversion in both poetry preferences and classical workspace', async () => {
  const app = settingsApp({available: false});
  const preferences = await app.context.RENDERERS['Daily Poetry']();
  const workspace = await app.context.renderClassicalChinese();
  assert.match(preferences, /value="model"\s+disabled/);
  assert.match(workspace, /value="model"\s+disabled/);
  assert.match(workspace, /value="local" selected/);
  assert.match(workspace, /请先允许 AI 文言化/);
});

test('classical controls save preferences and convert with the selected values while enforcing AI availability', async () => {
  const nodes = {}, posts = [];
  for (const id of ['classicalStyle', 'classicalStrength', 'classicalEngine', 'classicalInput', 'classicalInputCount', 'classicalRun', 'classicalOutput', 'classicalMode', 'classicalMeta', 'classicalCopy', 'classicalSwapAsk']) nodes[id] = {value: '', dataset: {}, classList: {toggle() {}}, textContent: ''};
  Object.assign(nodes.classicalStyle, {value: 'shizhuan'}); Object.assign(nodes.classicalStrength, {value: 'deep'});
  Object.assign(nodes.classicalEngine, {value: 'model', dataset: {aiReady: 'false'}}); nodes.classicalInput.value = '今天读书。';
  const start = index.indexOf(" if(STATE.feature==='文言化'){");
  const end = index.indexOf(" $$('[data-resume]')", start);
  const context = {STATE: {feature: '文言化'}, $: selector => nodes[selector.slice(1)], toast() {}, esc,
    async post(url, payload) {posts.push({url, payload: JSON.parse(JSON.stringify(payload))}); return {output: '今日读书。', remote: true};}};
  vm.runInNewContext(index.slice(start, end), context);
  await nodes.classicalStyle.onchange();
  assert.deepEqual(posts[0], {url: '/api/product/settings', payload: {items: {'classical.style': 'shizhuan', 'classical.strength': 'deep', 'classical.engine': 'model'}}});
  await nodes.classicalRun.onclick(); assert.equal(posts.length, 1);
  nodes.classicalEngine.dataset.aiReady = 'true'; await nodes.classicalRun.onclick();
  assert.deepEqual(posts[1], {url: '/api/classical-chinese', payload: {text: '今天读书。', style: 'shizhuan', strength: 'deep', engine: 'model'}});
  assert.equal(nodes.classicalOutput.textContent, '今日读书。');
});

for (const slowStartup of [false, true]) {
  test(`poetry controls bind after ${slowStartup ? 'delayed' : 'normal'} shell startup`, () => {
    const app = setup();
    if (slowStartup) app.timers[0]();
    // v012's copydeck boot replaces this global hook when its request finishes.
    let shellCalls = 0;
    app.context.bindSpecific = () => { shellCalls += 1; };
    app.events['lifeos:i2-ready']();
    if (!slowStartup) app.timers[0]();
    app.context.bindSpecific();
    assert.equal(shellCalls, 1);
    assert.equal(typeof app.why.onclick, 'function');
    app.why.onclick();
    assert.equal(app.panel.hidden, false);
    assert.equal(app.why.attributes['aria-expanded'], 'true');
    app.why.onclick();
    assert.equal(app.panel.hidden, true);
    assert.equal(app.why.attributes['aria-expanded'], 'false');
  });
}
