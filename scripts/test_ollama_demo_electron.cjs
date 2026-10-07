'use strict';
// Actual LifeOS UI/backend and public Ollama protocol fixture, not a real model.
const {app, BrowserWindow, ipcMain} = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const runtime = require('../desktop/runtime.cjs');
const {createStore} = require('../desktop/workspace-store.cjs');
const {normalizeSettings, SETTINGS_KEY} = require('../desktop/pet-controller.cjs');
const {startOllamaFixture} = require('./ollama_demo_fixture.cjs');
const ROOT = path.resolve(__dirname, '..'), resourcesArg = process.argv.indexOf('--resources');
const resourceRoot = path.resolve(resourcesArg >= 0 ? process.argv[resourcesArg + 1] : process.env.QA_RESOURCES || ROOT);
const packagedResources = resourceRoot !== ROOT;
const out = path.join(ROOT, 'docs', 'qa_ollama', 'run-' + Date.now()), workspace = path.join(out, 'workspace');
fs.mkdirSync(workspace, {recursive: true}); runtime.prepareWorkspace({resourceRoot, dataRoot: workspace});
app.setPath('userData', path.join(out, 'profile'));
const store = createStore(workspace); store.operation({op: 'set', key: 'lifeos.welcome.v1', value: 'done'});
let settings = normalizeSettings({mode: 'in_app', visible: true, motion: false});
store.operation({op: 'set', key: SETTINGS_KEY, value: JSON.stringify(settings)});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms)), checks = [], errors = [], fixtureSessions = [];
let backend, win, base, fixture, blockedNetworkRequests = 0;
app.on('window-all-closed', () => {});
ipcMain.on('lifeos:storage', (event, command) => {
  try { event.returnValue = {ok: true, value: store.operation(command)}; }
  catch (error) { event.returnValue = {ok: false, error: error.message}; }
});
ipcMain.handle('lifeos:update-status', () => ({status: 'idle'}));
ipcMain.handle('lifeos:pet-settings-get', () => ({ok: true, settings}));
ipcMain.handle('lifeos:pet-settings-set', async (_event, patch) => {
  settings = normalizeSettings(patch, settings); store.operation({op: 'set', key: SETTINGS_KEY, value: JSON.stringify(settings)});
  const result = {ok: true, settings}; win.webContents.send('lifeos:pet-settings', result); return result;
});
ipcMain.handle('lifeos:pet-action', () => ({ok: true}));
ipcMain.handle('lifeos:pet-refresh', () => ({ok: true, settings}));
const js = code => win.webContents.executeJavaScript('(async()=>{' + code + '})()');
async function until(condition) {
  for (let attempt = 0; attempt < 200; attempt++) { if (await js('return ' + condition)) return; await wait(80); }
  throw new Error('Wait failed: ' + condition);
}
async function shot(name) {
  await wait(200); fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
async function request(url, payload) {
  const response = await fetch(base + url, payload === undefined ? undefined : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
  });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
}
async function run() {
  fixture = await startOllamaFixture(); fixtureSessions.push(fixture);
  const port = await runtime.availablePort(), paths = {dataRoot: workspace, resourceRoot, logFile: path.join(out, 'backend.log')};
  const env = {...process.env, PYTHON_KEYRING_BACKEND: 'keyring.backends.null.Keyring'};
  if (!packagedResources) env.LIFEOS_PYTHON = path.join(ROOT, 'desktop', 'python-runtime', 'python.exe'); else delete env.LIFEOS_PYTHON;
  for (const key of Object.keys(env)) if (key.endsWith('_API_KEY') || ['LIFEOS_AI_PROVIDER', 'LIFEOS_LLM_MODEL', 'LIFEOS_LLM_BASE_URL', 'LIFEOS_WIRE_API', 'PYTHONHOME', 'PYTHONPATH', 'ELECTRON_RUN_AS_NODE'].includes(key)) delete env[key];
  backend = runtime.startBackend(runtime.backendLaunch({...paths, isPackaged: packagedResources, env}), {...paths, port});
  base = 'http://127.0.0.1:' + port; await runtime.waitForServer(base + '/api/health', {failure: backend.failure});
  const retained = {'ai.mode': 'byok', 'ai.enabled': true, 'ai.allow_remote': false,
    'ai.provider': 'custom', 'ai.model': 'retained-api-model', 'ai.base_url': 'https://retained.invalid/v1', 'ai.wire_api': 'responses',
    'ai.ollama_base_url': fixture.base_url, 'ai.cache': true};
  assert.equal((await request('/api/ai/settings', {items: retained})).ok, true); assert.equal(fixture.requests.length, 0);
  checks.push('fixture address setup leaves API selected with no implicit local generation');
  const packagedPreload = path.join(resourceRoot, 'app.asar', 'preload.cjs');
  const preload = packagedResources && fs.existsSync(packagedPreload) ? packagedPreload : path.join(ROOT, 'desktop', 'preload.cjs');
  win = new BrowserWindow({width: 1320, height: 940, show: false, webPreferences: {
    preload, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
  }});
  win.webContents.on('console-message', details => { if (details.level === 'error' && !/net::ERR|Failed to load resource/.test(details.message)) errors.push(details.message); });
  win.webContents.session.webRequest.onBeforeRequest({urls: ['https://*/*', 'http://*/*']}, (details, callback) => {
    if (details.url.startsWith(base + '/')) return callback({}); blockedNetworkRequests++; callback({cancel: true});
  });
  await win.loadURL(base); await until('!!window.lifeosSidebar && !!window.lifeosPetRenderers'); await wait(1400);
  await js("await openFeature('AI Settings')"); await until('!!document.querySelector("#aiSettingsForm")');
  assert.equal(await js('return document.querySelector(\'input[name="aiConnection"][value="byok"]\').checked'), true);
  assert.equal(fixture.requests.length, 0);
  await js('const choice=document.querySelector(\'input[name="aiConnection"][value="ollama"]\');choice.checked=true;choice.dispatchEvent(new Event("change",{bubbles:true}))');
  await until('document.querySelector("#aiOllamaModel").options.length===2');
  assert.equal(await js('return document.querySelector("#aiApiFields").disabled'), true);
  await js('const model=document.querySelector("#aiOllamaModel");model.value="qwen-demo:fixture";model.dispatchEvent(new Event("change",{bubbles:true}))');
  await shot('Ollama-选择本机模型');
  checks.push('settings UI discovers native model tags and disables API key fields');
  await js('document.querySelector("#aiTestConnection").click()');
  await until('document.querySelector("#aiSettingsFeedback")?.textContent.includes("模型连接成功")');
  await until('!document.querySelector("#aiTestConnection").disabled');
  const status = await request('/api/ai/control');
  assert.equal(status.ai.mode, 'ollama'); assert.equal(status.ai.model, 'qwen-demo:fixture');
  assert.equal(status.ai.requires_remote, false); assert.equal(status.saved_connection.model, 'retained-api-model');
  assert.equal(fixture.requests.filter(row => row.path === '/api/chat').length, 1);
  const connection = fixture.requests.find(row => row.path === '/api/chat');
  assert.equal(connection.body.messages.length, 1); assert.match(connection.body.messages[0].content, /这是连接测试/);
  assert.equal(connection.authorization, false); await shot('Ollama-保存并测试成功');
  checks.push('save and test use the chosen model with synthetic input and no credentials');
  await js('window.dispatchEvent(new Event("lifeos:open-pet"))');
  await until('!!document.querySelector("#petPageCatalog .petPageCard")');
  await js('window.dispatchEvent(new Event("lifeos:open-pet-chat"))');
  await until('!!document.querySelector("#petChatInput")&&!document.querySelector("#lifePetChat").hidden');
  await js('document.querySelector("#petChatInput").value="怎么调整侧边栏？";document.querySelector("#petChatForm").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
  await until('Array.from(document.querySelectorAll(".petChatLine.assistant")).some(row=>row.textContent.includes("编辑侧栏"))');
  await until('!document.querySelector("#petChatSend").disabled');
  const productRequest = fixture.requests.filter(row => row.path === '/api/chat')[1];
  assert.ok(productRequest.body.messages.some(message => message.content.includes('怎么调整侧边栏')));
  assert.ok(productRequest.body.messages.some(message => message.content.includes('界面微调')));
  assert.equal(productRequest.authorization, false);
  assert.equal(await js('return document.querySelectorAll(".petChatSources button").length>0'), true);
  await shot('Ollama-灵犀产品问答');
  checks.push('real pet chat receives a local reply with the on-demand public product guide');
  await js('document.querySelector("#petChatClose").click();await openFeature("AI Settings")');
  await until('document.querySelector("#aiOllamaModel")?.options.length===2');
  fixture.setScenario('missing');
  await js('document.querySelector("#aiTestConnection").click()');
  await until('document.querySelector("#aiSettingsFeedback")?.textContent.includes("重选")');
  await until('!document.querySelector("#aiTestConnection").disabled'); await shot('Ollama-模型缺失提示');
  checks.push('missing models display a concise reselect action');
  const fixturePort = Number(new URL(fixture.base_url).port);
  await fixture.close(); fixture = null;
  await js('document.querySelector("#aiOllamaRefresh").click()');
  await until('document.querySelector("#aiOllamaFeedback")?.textContent.includes("启动本机 Ollama")');
  await until('!document.querySelector("#aiOllamaRefresh").disabled'); await shot('Ollama-服务未启动');
  fixture = await startOllamaFixture({port: fixturePort}); fixtureSessions.push(fixture);
  await js('document.querySelector("#aiOllamaRefresh").click()');
  await until('document.querySelector("#aiOllamaModel")?.options.length===2&&!document.querySelector("#aiOllamaFeedback").textContent');
  await js('document.querySelector("#aiTestConnection").click()');
  await until('document.querySelector("#aiSettingsFeedback")?.textContent.includes("模型连接成功")');
  await until('!document.querySelector("#aiTestConnection").disabled');
  checks.push('stopped service can restart, refresh its models and connect through actual controls');
  await js('const choice=document.querySelector(\'input[name="aiConnection"][value="byok"]\');choice.checked=true;choice.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#aiSettingsForm").requestSubmit()');
  await until('document.querySelector("#aiSettingsFeedback")?.textContent==="已保存"');
  const restored = await request('/api/ai/control');
  assert.equal(restored.ai.mode, 'byok'); assert.equal(restored.saved_connection.provider, 'custom');
  assert.equal(restored.saved_connection.model, 'retained-api-model'); assert.equal(restored.saved_connection.base_url, 'https://retained.invalid/v1');
  assert.equal(restored.saved_connection.wire_api, 'responses'); await shot('Ollama-切回原API配置');
  checks.push('switching to API restores retained provider, model, endpoint and protocol');
  const usage = await request('/api/ai/status'); assert.equal(usage.usage.totals.remote_calls, 0);
  assert.equal(fs.readdirSync(path.join(workspace, 'vault')).length, 0); assert.deepEqual(errors, []);
  checks.push('no real diaries, cloud requests, downloads or renderer script errors occur');
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ok: true, checks, resource_root: resourceRoot,
    packaged_resources: packagedResources, protocol_fixture: true, actual_ollama_model_tested: false,
    real_diaries_opened: 0, remote_ai_calls: 0, blocked_network_requests: blockedNetworkRequests,
    fixture_requests: fixtureSessions.flatMap(session => session.requests), errors}, null, 2));
  console.log(JSON.stringify({ok: true, checks: checks.length, out, packaged_resources: packagedResources}));
}
async function closeSession() {
  if (win && !win.isDestroyed()) {
    await js('document.querySelectorAll(".viviPetStage").forEach(stage=>lifeosPetRenderers.release(stage.parentElement));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)').catch(() => {});
    await win.loadURL('about:blank').catch(() => {}); win.webContents.stopPainting(); win.destroy(); win = null;
  }
  if (backend) {
    const child = backend.child;
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('close', resolve); backend.stop(); }); else backend.stop();
    backend = null;
  }
  if (fixture) { await fixture.close(); fixture = null; }
}
app.whenReady().then(run).then(async () => { await closeSession(); setImmediate(() => app.quit()); }).catch(async error => {
  fs.writeFileSync(path.join(out, 'failure.txt'), error.stack);
  if (win && !win.isDestroyed()) {
    await shot('failure').catch(() => {});
    fs.writeFileSync(path.join(out, 'failure-state.json'), JSON.stringify(await js('return {feature:STATE.feature,text:document.body.innerText,feedback:document.querySelector("#aiSettingsFeedback")?.textContent}').catch(() => null), null, 2));
  }
  console.error(error.stack); process.exitCode = 1; await closeSession(); setImmediate(() => app.quit());
});
