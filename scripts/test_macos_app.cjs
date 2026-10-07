'use strict';

// Run with the matching Electron executable on macOS, once for each QA_PHASE.
// This loads the final package's main/preload and bundled backend, without an
// offscreen window or an external server. Gatekeeper/signing are tested apart.
const {app, BrowserWindow, Menu, dialog, session, clipboard} = require('electron');
const fs = require('node:fs');
const originalFs = require('original-fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');

const phase = process.env.QA_PHASE || 'first';
const output = path.resolve(process.env.QA_OUTPUT || 'artifacts/qa-macos');
const appPath = path.resolve(process.env.MACOS_APP_PATH || 'desktop/dist/mac-arm64/LifeOS.app');
const resources = path.join(appPath, 'Contents', 'Resources');
const asar = path.join(resources, 'app.asar');
const workspace = path.join(output, 'workspace');
const applicationData = path.join(output, 'application-data');
const profile = path.join(applicationData, 'LifeOS');
const expectedFile = path.join(output, 'expected.json');
const uiStateFile = path.join(workspace, '.lifeos', 'ui-state.json');
const fixture = {
  date: '2099-01-05', title: 'macOS packaged journal QA',
  text: 'LifeOS macOS 0.5.2 synthetic journal. 今天仅用于安装包验收。',
  draftDate: '2099-01-06', draftText: 'LifeOS macOS synthetic draft survives a normal close',
};
const checks = [], backendChildren = [], blockedRequests = [], rendererErrors = [];
let mainWindow = null, packaged = null, completed = false, failing = false, finalizing = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = content => crypto.createHash('sha256').update(content).digest('hex');
const archiveHash = () => hash(originalFs.readFileSync(asar));
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

fs.mkdirSync(output, {recursive: true});
const watchdog = setTimeout(() => void fail(new Error('macOS packaged UI QA timed out')), 105000);

async function until(test, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (failing) throw new Error('QA has already failed');
    const value = await test();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Timed out: ' + description);
}

async function js(expression) {
  assert.ok(mainWindow && !mainWindow.isDestroyed(), 'actual main window is available');
  const result = await mainWindow.webContents.executeJavaScript(
    `(async()=>{try{return {value:await (${expression})}}catch(error){return {error:String(error.stack||error)}}})()`, true);
  if (result.error) throw new Error(result.error);
  return result.value;
}

const get = route => js(`api(${JSON.stringify(route)},{noCache:true})`);

async function screenshot(name) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const picture = await mainWindow.webContents.capturePage();
  assert.equal(picture.isEmpty(), false, 'native UI capture is not empty');
  const size = picture.getSize();
  assert.ok(size.width >= 900 && size.height >= 600, 'capture contains the visible application');
  fs.writeFileSync(path.join(output, name + '.png'), picture.toPNG());
}

function copyBackendLog() {
  const log = path.join(profile, 'logs', 'desktop.log');
  if (fs.existsSync(log)) fs.copyFileSync(log, path.join(output, phase + '-backend.log'));
}

async function childClosed(child, timeout = 12000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once('close', resolve)),
    delay(timeout).then(() => { throw new Error('owned bundled backend did not stop'); }),
  ]);
}

async function stopOwnedBackends() {
  for (const child of backendChildren) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGTERM');
    try { await childClosed(child, 5000); }
    catch { child.kill('SIGKILL'); await childClosed(child, 5000); }
  }
}

async function fail(error) {
  if (failing) return;
  failing = true;
  clearTimeout(watchdog);
  const message = String(error?.stack || error);
  try { await screenshot(phase + '-failure'); } catch { /* Startup can fail before a window exists. */ }
  try { await stopOwnedBackends(); } catch (cleanupError) { rendererErrors.push(String(cleanupError)); }
  try {
    copyBackendLog();
    writeJSON(path.join(output, phase + '-report.json'), {
      ok: false, phase, checks, error: message, renderer_errors: rendererErrors,
      blocked_external_requests: blockedRequests, backend_pids: backendChildren.map(child => child.pid),
    });
  } finally { process.stderr.write(message + '\n'); app.exit(1); }
}

process.on('uncaughtException', error => void fail(error));
process.on('unhandledRejection', error => void fail(error));
dialog.showErrorBox = (title, content) => void fail(new Error(title + ': ' + content));
dialog.showMessageBox = async (_window, options) => {
  void fail(new Error('Unexpected native save/startup dialog: ' + JSON.stringify(options)));
  return {response: 0};
};

function boundNetwork(target) {
  target.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (details, callback) => {
    const url = new URL(details.url);
    const allowed = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!allowed) blockedRequests.push({origin: url.origin, resource: details.resourceType});
    callback({cancel: !allowed});
  });
}

function menuRoles(menu) {
  return (menu?.items || []).flatMap(item => [String(item.role || '').toLowerCase(), ...menuRoles(item.submenu)]);
}

async function verifyEditMenu() {
  const menu = Menu.getApplicationMenu();
  const edit = menu?.items.find(item => String(item.role || '').toLowerCase() === 'editmenu');
  assert.ok(edit?.submenu, 'actual Cocoa application menu has Edit');
  const roles = menuRoles(edit.submenu);
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall']) {
    assert.ok(roles.includes(role), 'actual Edit menu contains ' + role);
    assert.ok(edit.submenu.items.find(item => String(item.role || '').toLowerCase() === role)?.enabled,
      'actual Edit menu enables ' + role);
  }
  mainWindow.show(); app.focus({steal: true}); mainWindow.focus();
  const marker = 'LifeOS native macOS copy and paste QA';
  await js(`(()=>{const field=document.createElement('textarea');field.id='lifeosQaClipboard';
    field.style.cssText='position:fixed;left:24px;bottom:24px;z-index:99999;width:360px;height:48px';
    field.value=${JSON.stringify(marker)};document.body.append(field);field.focus();field.select();return true})()`);
  Menu.sendActionToFirstResponder('copy:');
  await until(() => clipboard.readText() === marker, 'native menu copy', 10000);
  await js(`(()=>{const field=document.querySelector('#lifeosQaClipboard');field.value='';field.focus();return true})()`);
  Menu.sendActionToFirstResponder('paste:');
  await until(async () => await js(`document.querySelector('#lifeosQaClipboard').value`) === marker, 'native menu paste', 10000);
  Menu.sendActionToFirstResponder('undo:');
  await until(async () => await js(`document.querySelector('#lifeosQaClipboard').value`) === '', 'native menu undo', 10000);
  Menu.sendActionToFirstResponder('redo:');
  await until(async () => await js(`document.querySelector('#lifeosQaClipboard').value`) === marker, 'native menu redo', 10000);
  await js(`document.querySelector('#lifeosQaClipboard').remove()`);
  checks.push('real macOS Edit menu offers standard roles and native copy/paste/undo/redo work');
}

async function openWriter(date) {
  await js(`openProductDock('writer',{date:${JSON.stringify(date)}})`);
  await until(() => js(`!!document.querySelector('#writerForm')&&document.querySelector('#writerDate')?.value===${JSON.stringify(date)}&&!!document.querySelector('[data-rich-wsec="日记"]')`), 'rich writer for ' + date);
}

async function writeRich(text) {
  await js(`(()=>{const field=document.querySelector('[data-rich-wsec="日记"]');field.textContent=${JSON.stringify(text)};
    field.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  assert.ok(await js(`document.querySelector('[data-wsec="日记"]').value.includes(${JSON.stringify(text)})`), 'visible editor updates saved mirror');
}

async function readEntry() {
  const listing = await get('/api/entries?limit=-1');
  const entry = listing.items.find(item => item.journal_date === fixture.date && item.title === fixture.title);
  if (!entry) return false;
  const details = await get('/api/entry?entry_id=' + encodeURIComponent(entry.entry_id));
  if (!details.current?.content?.includes(fixture.text)) return false;
  return {entry, details};
}

function canonicalFile(source) {
  assert.equal(typeof source, 'string');
  const file = path.resolve(workspace, 'vault', source);
  assert.ok(inside(path.join(workspace, 'vault'), file), 'canonical journal stays in isolated vault');
  assert.ok(fs.statSync(file).isFile(), 'canonical Markdown exists');
  return file;
}

async function checkJournal(entry) {
  const journal = await get('/api/journal?path=' + encodeURIComponent(entry.source_path));
  assert.equal(journal.product_entry?.entry_id, entry.entry_id);
  assert.ok(journal.sections?.['日记']?.includes(fixture.text), 'journal endpoint returns canonical text');
  await js(`openJournal(${JSON.stringify(entry.source_path)})`);
  await until(() => js(`document.querySelector('.i2JournalVolume')?.dataset.path===${JSON.stringify(entry.source_path)}&&document.querySelector('.jbPageBody')?.textContent.includes(${JSON.stringify(fixture.text)})`), 'saved journal renders in the actual book UI');
  await screenshot(phase + '-journal');
}

async function verifyUI(window) {
  mainWindow = window;
  await until(() => js(`window.lifeosV01Ready===true&&typeof openProductDock==='function'&&typeof api==='function'`), 'production UI readiness');
  await until(() => window.isVisible(), 'real Mac window is shown');
  assert.equal(await js(`lifeosDesktop.platform`), 'darwin');
  assert.equal(await js(`typeof lifeosDesktop.storage`), 'function');
  assert.equal(app.getPath('userData'), profile);
  assert.equal(window.webContents.getLastWebPreferences().preload, path.join(asar, 'preload.cjs'));
  const health = await get('/api/health');
  assert.equal(health.ok, true); assert.equal(health.mode, 'local-first');
  assert.equal(backendChildren.length, 1, 'actual packaged main launches one bundled backend');
  checks.push('final app.asar main, sandboxed preload, visible Mac UI and bundled backend start together');
  // No credentials, personal diary, remote model, or local Ollama are needed.
  await js(`post('/api/product/settings',{items:{'ai.enabled':false,'ai.allow_remote':false,'ai.mode':'disabled','poetry.auto_enabled':false}})`);
  if (phase === 'first') {
    assert.deepEqual((await get('/api/entries?limit=-1')).items, [], 'new isolated installation starts empty');
    await until(() => js(`!!document.querySelector('#lifeosWelcome[open]')`), 'first-use welcome');
    await screenshot('first-welcome');
    await js(`document.querySelector('#lifeosWelcome [data-welcome="write"]').click()`);
    await until(() => js(`!document.querySelector('#lifeosWelcome')&&!!document.querySelector('#writerForm')`), 'welcome opens writer');
    assert.equal(await js(`localStorage.getItem('lifeos.welcome.v1')`), 'done');
    checks.push('empty first installation shows one minimal welcome and its write action opens the real writer');
    await verifyEditMenu();
    await openWriter(fixture.date);
    await writeRich(fixture.text);
    await js(`(()=>{const title=document.querySelector('#writerTitle');title.value=${JSON.stringify(fixture.title)};
      title.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#writerSave').click();return true})()`);
    const saved = await until(readEntry, 'UI save creates canonical journal and revision', 30000);
    assert.equal(saved.details.revisions.length, 1);
    assert.equal(saved.details.current.revision_id, saved.entry.current_revision_id);
    await until(() => js(`!localStorage.getItem('lifeos.writer.draft.${fixture.date}')`), 'committed draft is cleared');
    const file = canonicalFile(saved.entry.source_path);
    writeJSON(expectedFile, {fixture, entry_id: saved.entry.entry_id, revision_id: saved.entry.current_revision_id,
      source_path: saved.entry.source_path, canonical_sha256: hash(fs.readFileSync(file)),
      revision_sha256: hash(saved.details.current.content), asar_sha256: archiveHash()});
    checks.push('real writer save creates one canonical Markdown entry and revision, readable through both journal APIs');
    await until(() => js(`!document.querySelector('#productDock')?.classList.contains('open')`), 'successful save returns from writer');
    await checkJournal(saved.entry);
    await openWriter(fixture.draftDate);
    await writeRich(fixture.draftText);
    await screenshot('first-draft-before-close');
  } else {
    const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
    assert.deepEqual(expected.fixture, fixture);
    assert.equal(expected.asar_sha256, archiveHash(), 'restart uses the same final package');
    await delay(900);
    assert.equal(await js(`!!document.querySelector('#lifeosWelcome')`), false);
    assert.equal(await js(`localStorage.getItem('lifeos.welcome.v1')`), 'done');
    checks.push('a normal restart retains native preferences and does not repeat first-use welcome');
    await verifyEditMenu();
    const saved = await until(readEntry, 'canonical journal survives restart');
    assert.equal((await get('/api/entries?limit=-1')).items.length, 1);
    assert.equal(saved.entry.entry_id, expected.entry_id);
    assert.equal(saved.entry.current_revision_id, expected.revision_id);
    assert.equal(saved.entry.source_path, expected.source_path);
    assert.equal(saved.details.revisions.length, 1);
    assert.equal(hash(saved.details.current.content), expected.revision_sha256);
    assert.equal(hash(fs.readFileSync(canonicalFile(expected.source_path))), expected.canonical_sha256);
    await checkJournal(saved.entry);
    checks.push('restart preserves journal text, canonical file hash, stable entry ID and the original revision');
    await openWriter(fixture.draftDate);
    await until(() => js(`document.querySelector('[data-rich-wsec="日记"]')?.textContent.includes(${JSON.stringify(fixture.draftText)})`), 'normal close restores visible unsaved rich draft');
    await screenshot('restart-restored-draft');
    checks.push('native close guard persists an unsaved rich-text draft and the actual writer restores it');
  }
  assert.equal(rendererErrors.length, 0, 'no renderer crash or JavaScript error');
  completed = true;
  window.close(); // Production close guard and before-quit stop the real backend.
}

app.on('will-quit', event => {
  if (finalizing || failing) return;
  event.preventDefault(); finalizing = true;
  void (async () => {
    assert.equal(completed, true, 'native application did not quit before QA completed');
    await Promise.all(backendChildren.map(child => childClosed(child)));
    assert.ok(mainWindow?.isDestroyed(), 'normal close destroys the actual main window');
    const native = JSON.parse(fs.readFileSync(uiStateFile, 'utf8'));
    assert.equal(native.items['lifeos.welcome.v1'], 'done');
    assert.ok(native.items['lifeos.writer.draft.' + fixture.draftDate]?.includes(fixture.draftText));
    checks.push('actual window close finishes native persistence and stops its owned bundled backend');
    copyBackendLog();
    writeJSON(path.join(output, phase + '-report.json'), {
      ok: true, phase, checks, platform: process.platform, architecture: process.arch,
      electron_version: process.versions.electron, app_version: packaged.version,
      asar_sha256: archiveHash(), visible_native_window: true,
      external_models_enabled: false, auto_update_network_disabled: true,
      blocked_external_requests: blockedRequests, renderer_errors: rendererErrors,
      backend_stopped: true, signing_or_gatekeeper_test: false,
    });
    clearTimeout(watchdog);
    app.quit();
  })().catch(error => void fail(error));
});

app.on('browser-window-created', (_event, window) => {
  const preferences = window.webContents.getLastWebPreferences();
  if (preferences.preload !== path.join(asar, 'preload.cjs')) return;
  window.webContents.on('console-message', (_event, level, message) => {
    const details = typeof level === 'object' ? level : {level, message};
    if (details.level === 'error' || details.level >= 3) rendererErrors.push(details.message);
  });
  window.webContents.once('render-process-gone', (_event, details) => void fail(new Error('Renderer stopped: ' + JSON.stringify(details))));
  window.webContents.once('did-fail-load', (_event, code, description) => void fail(new Error('UI load failed: ' + code + ' ' + description)));
  window.webContents.once('did-finish-load', () => void verifyUI(window).catch(error => void fail(error)));
});

try {
  assert.equal(process.platform, 'darwin', 'this is an actual macOS runtime test, never a skipped Windows check');
  assert.ok(['first', 'restart'].includes(phase), 'QA_PHASE is first or restart');
  assert.ok(inside(output, workspace) && inside(output, applicationData));
  assert.ok(!inside(appPath, output) && output !== appPath, 'QA data must stay outside the final application');
  if (phase === 'first') {
    for (const directory of [workspace, applicationData]) {
      assert.ok(!fs.existsSync(directory) || fs.readdirSync(directory).length === 0, 'first run refuses existing data: ' + directory);
    }
    assert.equal(fs.existsSync(expectedFile), false, 'first run uses a new QA output');
  } else {
    assert.ok(fs.existsSync(expectedFile) && fs.existsSync(uiStateFile), 'restart requires first-run evidence');
  }
  packaged = JSON.parse(fs.readFileSync(path.join(asar, 'package.json'), 'utf8'));
  assert.equal(packaged.version, '0.5.2');
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'package.json'), 'utf8'));
  assert.equal(process.versions.electron, sourcePackage.build.electronVersion, 'harness and final package use the configured Electron runtime');
  const bundledPython = path.join(resources, 'python', 'bin', 'python3');
  assert.ok(fs.existsSync(bundledPython) || fs.existsSync(path.join(resources, 'lifeos-server')), 'final package includes its backend runtime');
  for (const key of Object.keys(process.env)) {
    if (/^LIFEOS_/i.test(key) || /(?:^|_)API_KEY$/i.test(key) || /^(?:PYTHONHOME|PYTHONPATH|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {LIFEOS_ROOT: workspace, LIFEOS_NO_BROWSER: '1',
    PYTHON_KEYRING_BACKEND: 'keyring.backends.null.Keyring', PYTHONUTF8: '1'});
  fs.mkdirSync(profile, {recursive: true});
  app.setPath('appData', applicationData);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  Object.defineProperty(app, 'isPackaged', {value: true});
  Object.defineProperty(process, 'resourcesPath', {value: resources});
  // Observe actual spawn calls unchanged, so failure cleanup only touches our child.
  const spawn = childProcess.spawn;
  childProcess.spawn = function (command, args, options) {
    if (options?.cwd === workspace) {
      assert.ok(inside(resources, path.resolve(command)), 'backend uses the final packaged executable');
      assert.equal(options.env.LIFEOS_ROOT, workspace);
      const child = Reflect.apply(spawn, this, [command, args, options]);
      backendChildren.push(child); return child;
    }
    return Reflect.apply(spawn, this, [command, args, options]);
  };
  app.on('session-created', boundNetwork);
  app.whenReady().then(() => boundNetwork(session.defaultSession)).catch(error => void fail(error));
  const updater = require(path.join(asar, 'node_modules', 'electron-updater')).autoUpdater;
  updater.checkForUpdates = async () => {
    updater.emit('update-not-available', {version: packaged.version});
    return {updateInfo: {version: packaged.version}};
  };
  require(path.join(asar, 'main.cjs'));
} catch (error) { void fail(error); }
