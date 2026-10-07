'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {once, EventEmitter} = require('node:events');
const vm = require('node:vm');
const runtime = require('./runtime.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function mainLifecycle(isPackaged,{keepPet=false,saveSafe=true,deferBackendClose=false,platform='win32'}={}) {
  // Execute the actual entry point with only inert dependencies. No directories,
  // credentials, sockets, Python children, or Electron windows are opened.
  const ready = deferred(), healthy = deferred(), windows = [], failures = [];
  const handles = new Map(), scheduled = [], backendCalls = [], fileCalls = [], builtMenus = [], applicationMenus = [];
  const app = new EventEmitter(), ipcMain = new EventEmitter();
  const locations = {appData: path.resolve('fixture/application-data')};
  let quits = 0, stops = 0,petStops=0,relaunches=0;const petSender={},petCompletions=[],backendChild=new EventEmitter();
  backendChild.exitCode=null;backendChild.signalCode=null;
  Object.assign(app, {
    isPackaged, setName() {}, setPath(name, value) { locations[name] = value; },
    getPath: name => locations[name], whenReady: () => ready.promise,
    requestSingleInstanceLock: () => true, quit() { quits += 1;const event={prevented:false,preventDefault(){this.prevented=true}};app.emit('before-quit',event);if(!event.prevented)for(const window of windows)if(!window.isDestroyed())window.close(); },
    relaunch(){relaunches++},
  });
  ipcMain.handle = (name, handler) => handles.set(name, handler);
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.shows = 0; this.focuses = 0;this.destroyed=false;this.messages=[];
      this.webContents = {setWindowOpenHandler() {}, send:(...value)=>this.messages.push(value),executeJavaScript:async()=>saveSafe};
      windows.push(this);
    }
    async loadURL(url) { this.url = url; this.emit('ready-to-show'); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    isMaximized() { return false; }
    show() { this.shows += 1; }
    focus() { this.focuses += 1; }
    close(){const event={prevented:false,preventDefault(){this.prevented=true}};this.emit('close',event);if(!event.prevented){this.destroyed=true;this.emit('closed');if(windows.every(window=>window.destroyed))app.emit('window-all-closed')}}
    static fromWebContents(contents) { return windows.find(window => window.webContents === contents); }
  }
  const paths = {resourceRoot: path.resolve('fixture/resources'),
    dataRoot: path.resolve('fixture/test-data'), logFile: path.resolve('fixture/test-data/desktop.log')};
  const fakeRuntime = {
    runtimePaths: () => paths,
    prepareWorkspace(value) { backendCalls.push(['prepare', value]); },
    async availablePort() { return 48761; },
    backendLaunch(value) { backendCalls.push(['launch', value]); return {command: 'fixture-python'}; },
    startBackend() { backendCalls.push(['start']); return {child:backendChild,failure: new Promise(() => {}), stop() { stops += 1;if(!deferBackendClose)setImmediate(()=>{backendChild.exitCode=0;backendChild.emit('close',0,null)}) }}; },
    waitForServer(url) { backendCalls.push(['health', url]); return healthy.promise; },
  };
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({updateInfo: {version: 'fixture'}});
  const modules = {
    electron: {app, BrowserWindow: Window, ipcMain, shell: {openExternal() {}},
      Menu: {buildFromTemplate(template) {const menu={template};builtMenus.push(menu);return menu;},setApplicationMenu(menu) {applicationMenus.push(menu);}}, dialog: {showErrorBox(...args) { failures.push(args); },showMessageBox:async()=>({response:0})}},
    path,
    fs: new Proxy({}, {get: (_, method) => (...args) => {
      fileCalls.push([method, args]); throw new Error('Main lifecycle must not access the filesystem');
    }}),
    './runtime.cjs': fakeRuntime,
    './workspace-store.cjs': {createStore:()=>({operation:()=>null})},
    './storage-migration.cjs': {recoverLegacyStorage:async()=>{}},
    './close-guard.cjs': require('./close-guard.cjs'),
    './pet-controller.cjs': {createPetController:()=>({start:async()=>{},stop(){petStops++},keepAlive:()=>keepPet,snapshot:()=>({ok:true}),isSender:sender=>sender===petSender,completeAction:value=>petCompletions.push(value)})},
    './shared-pet-actions.cjs': {loadPetActions:()=>[['idle','待机']]},
    './update-controller.cjs': {createUpdateController:()=>({check:async()=>({ok:true}),snapshot:()=>({status:'idle'})})},
    './bottle-reminders.cjs': {startBottleReminders:()=>({stop(){}})},
    'builder-util-runtime': {CancellationToken:class {}},
    'node:http': {},
    'electron-updater': {autoUpdater: updater},
  };
  const context = {
    URL,
    __dirname, process: {env: {}, platform, resourcesPath: paths.resourceRoot},
    require(name) { assert.ok(Object.hasOwn(modules, name), `unexpected main dependency: ${name}`); return modules[name]; },
    setTimeout(callback, delay) { scheduled.push({callback, delay}); return scheduled.length; },
    setImmediate, console: {error(...args) { failures.push(args); }},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), context, {filename: 'main.cjs'});
  return {ready, healthy, windows, app, ipcMain, handles, backendCalls, fileCalls, failures, scheduled,petSender,petCompletions,backendChild,builtMenus,applicationMenus,
    get relaunches(){return relaunches},
    get quits() { return quits; }, get stops() { return stops; },get petStops(){return petStops}};
}

for(const isPackaged of [false,true])test(`${isPackaged?'packaged':'source'} macOS installs native app, editing and window menus before showing its window`,async()=>{
  const f=mainLifecycle(isPackaged,{platform:'darwin'}),flush=()=>new Promise(setImmediate);
  assert.equal(f.applicationMenus.length,0,'menus wait for Electron readiness');
  f.ready.resolve();await flush();
  assert.equal(f.builtMenus.length,1);
  assert.equal(f.applicationMenus[0],f.builtMenus[0],'the constructed native menu is installed');
  assert.deepEqual(Array.from(f.applicationMenus[0].template,item=>item.role),['appMenu','editMenu','windowMenu'],'Electron roles supply standard Mac editing, application and window shortcuts');
  assert.equal(f.windows.length,0,'menu creation does not bypass backend health');
  f.healthy.resolve();await flush();
  assert.equal(f.windows.length,1);assert.deepEqual(f.failures,[]);
  f.app.emit('activate');await flush();assert.equal(f.builtMenus.length,1,'Dock activation reuses the installed menu');
  f.app.quit();await flush();assert.equal(f.windows[0].destroyed,true);assert.equal(f.stops,1);assert.equal(f.petStops,1);
});

for(const platform of ['win32','linux'])test(`${platform} retains its custom window controls without a native menu`,async()=>{
  const f=mainLifecycle(true,{platform}),flush=()=>new Promise(setImmediate);
  f.ready.resolve();f.healthy.resolve();await flush();
  assert.deepEqual(f.applicationMenus,[null]);assert.equal(f.builtMenus.length,0);assert.deepEqual(f.failures,[]);
  assert.ok(f.handles.has('lifeos:window-control'));
  f.app.quit();await flush();assert.equal(f.stops,1);
});

test('macOS explicit quit preserves the application and backend when draft saving fails',async()=>{
  const f=mainLifecycle(true,{platform:'darwin',keepPet:true,saveSafe:false}),flush=()=>new Promise(setImmediate);
  f.ready.resolve();f.healthy.resolve();await flush();f.app.quit();await flush();
  assert.equal(f.windows[0].destroyed,false);assert.equal(f.stops,0);assert.equal(f.petStops,0);
  assert.equal(f.applicationMenus.length,1,'the standard menu remains installed after cancelled exit');
});

for (const isPackaged of [false, true]) {
  test(`${isPackaged ? 'packaged' : 'source'} defaults to one application window with trusted pet settings IPC`, async () => {
    const lifecycle = mainLifecycle(isPackaged);
    const flush = () => new Promise(setImmediate);
    assert.equal(lifecycle.windows.length, 0);
    lifecycle.ready.resolve();
    await flush();
    assert.equal(lifecycle.windows.length, 0, 'no window opens before backend health succeeds');
    assert.equal(lifecycle.backendCalls.filter(([name]) => name === 'start').length, 1);
    lifecycle.healthy.resolve({ok: true});
    await flush();
    assert.deepEqual(lifecycle.failures, []);
    assert.equal(lifecycle.windows.length, 1, 'startup creates exactly one native window');
    const main = lifecycle.windows[0];
    assert.equal(main.url, 'http://127.0.0.1:48761');
    assert.equal(main.shows, 1, 'the application is shown when its renderer is ready');
    assert.notEqual(main.options.transparent, true);
    assert.notEqual(main.options.alwaysOnTop, true);
    assert.equal(path.basename(main.options.webPreferences.preload), 'preload.cjs');
    assert.equal(main.options.webPreferences.contextIsolation, true);
    assert.equal(main.options.webPreferences.sandbox, true);
    lifecycle.app.emit('activate');
    lifecycle.app.emit('second-instance');
    await flush();
    assert.equal(lifecycle.windows.length, 1, 'activation and a second launch reuse the application window');
    assert.equal(main.focuses, 2);
    const channels = [...lifecycle.ipcMain.eventNames(), ...lifecycle.handles.keys()];
    assert.ok(channels.includes('lifeos:pet-settings-get'));
    assert.equal((await lifecycle.handles.get('lifeos:pet-settings-get')({sender:{}})).ok,false,'foreign renderer cannot control pets');
    lifecycle.ipcMain.emit('lifeos:pet-action-complete',{sender:{}},{slug:'fixture',requestId:'one'});assert.equal(lifecycle.petCompletions.length,0);
    lifecycle.ipcMain.emit('lifeos:pet-action-complete',{sender:lifecycle.petSender},{slug:'fixture',requestId:'one'});assert.equal(lifecycle.petCompletions.length,1,'only the owned native renderer may complete its action');
    assert.ok(lifecycle.handles.has('lifeos:window-control'), 'normal application IPC remains installed');
    assert.deepEqual(lifecycle.fileCalls, []);
    assert.equal(lifecycle.quits, 0);
    lifecycle.app.emit('before-quit');
    assert.equal(lifecycle.stops, 1, 'quitting still stops the owned backend');
  });
}

test('desktop keep-on-close preserves backend, reopens one main window, and explicit exit tears everything down',async()=>{
  const f=mainLifecycle(false,{keepPet:true}),flush=()=>new Promise(setImmediate);f.ready.resolve();f.healthy.resolve();await flush();
  const first=f.windows[0];first.close();assert.equal(first.destroyed,false,'close waits for saved draft');await flush();
  assert.equal(first.destroyed,true);assert.equal(f.quits,0);assert.equal(f.stops,0);
  f.app.emit('second-instance');f.app.emit('activate');await flush();
  assert.equal(f.windows.length,2,'concurrent reopen requests create one replacement');assert.equal(f.backendCalls.filter(([name])=>name==='start').length,1);
  f.app.quit();await flush();assert.equal(f.windows[1].destroyed,true);assert.equal(f.stops,1);assert.equal(f.petStops,1);
});
test('failed draft saving cancels an explicit exit and leaves background services available',async()=>{
  const f=mainLifecycle(false,{keepPet:true,saveSafe:false}),flush=()=>new Promise(setImmediate);f.ready.resolve();f.healthy.resolve();await flush();
  f.app.quit();await flush();assert.equal(f.windows[0].destroyed,false);assert.equal(f.stops,0);assert.equal(f.petStops,0);
});
test('closing the application without a retained desktop pet shuts down its backend',async()=>{
  const f=mainLifecycle(false),flush=()=>new Promise(setImmediate);f.ready.resolve();f.healthy.resolve();await flush();f.windows[0].close();await flush();assert.equal(f.windows[0].destroyed,true);assert.equal(f.stops,1);assert.equal(f.petStops,1);
});

for(const isPackaged of [false,true])test((isPackaged?'packaged':'source')+' recovery restart saves drafts and waits for the owned backend to close',async()=>{
  const f=mainLifecycle(isPackaged,{keepPet:true,deferBackendClose:true}),flush=()=>new Promise(setImmediate);
  f.ready.resolve();f.healthy.resolve();await flush();
  const restart=f.handles.get('lifeos:restart'),main=f.windows[0];
  assert.equal((await restart({sender:{}})).ok,false,'foreign sender cannot restart the app');
  const pending=restart({sender:main.webContents});await flush();
  assert.equal(f.stops,1);assert.equal(f.relaunches,0,'relaunch waits for backend close rather than an exit request');
  assert.equal((await restart({sender:main.webContents})).ok,false,'concurrent restart is ignored');
  f.backendChild.exitCode=0;f.backendChild.emit('close',0,null);
  assert.equal((await pending).ok,true);assert.equal(f.relaunches,1);await flush();
  assert.ok(main.destroyed);assert.equal(f.stops,1,'quitting does not stop the backend twice');assert.equal(f.petStops,1);
  assert.deepEqual(f.failures,[]);
});

test('recovery restart cancelled by failed draft saving preserves all services',async()=>{
  const f=mainLifecycle(false,{keepPet:true,saveSafe:false}),flush=()=>new Promise(setImmediate);
  f.ready.resolve();f.healthy.resolve();await flush();
  const result=await f.handles.get('lifeos:restart')({sender:f.windows[0].webContents});
  assert.equal(result.ok,false);assert.match(result.error,/草稿尚未保存/);
  assert.equal(f.stops,0);assert.equal(f.relaunches,0);assert.equal(f.petStops,0);assert.equal(f.windows[0].destroyed,false);
});

function workspace(t, beforeRemove = async () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LifeOS 启动测试 '));
  t.after(async () => {
    // Windows can retain cwd/stdio handles briefly after a child emits exit.
    // Always stop it and wait for close before retrying directory removal.
    await beforeRemove();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.promises.rm(directory, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
  });
  return directory;
}

function stopAfterClose(backend) {
  // Register immediately: failed spawns and short-lived children can close
  // before test teardown begins. A spawn error still emits close afterwards.
  const closed = new Promise(resolve => backend.child.once('close', resolve));
  return async () => {
    if (backend.child.exitCode === null && backend.child.signalCode === null) backend.stop();
    let timer;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test backend did not close within 10 seconds')), 10000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

async function server(t, handler) {
  const instance = http.createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => new Promise(resolve => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('packaged resources are outside app.asar and writable data is outside the installation', () => {
  const resourceRoot = path.resolve('fixture/Program Files/LifeOS/resources');
  const userData = path.resolve('fixture/用户/AppData/LifeOS');
  const result = runtime.runtimePaths({isPackaged: true, resourcesPath: resourceRoot, desktopDir: path.join(resourceRoot, 'app.asar'), userData, env: {}});
  assert.equal(result.resourceRoot, resourceRoot);
  assert.equal(result.dataRoot, path.join(userData, 'workspace'));
  assert.equal(result.logFile, path.join(userData, 'logs', 'desktop.log'));
});

test('source startup continues using the source checkout unless an explicit workspace is supplied', () => {
  const desktopDir = path.resolve('fixture/source/desktop');
  const userData = path.resolve('fixture/user');
  assert.equal(runtime.runtimePaths({isPackaged: false, desktopDir, userData, env: {}}).dataRoot, path.dirname(desktopDir));
  assert.equal(runtime.runtimePaths({isPackaged: false, desktopDir, userData, env: {LIFEOS_ROOT: userData}}).dataRoot, userData);
});

test('first run creates an empty workspace and updates shipped copy without overwriting personal data', t => {
  const base = workspace(t), resourceRoot = path.join(base, 'resources'), dataRoot = path.join(base, 'user');
  fs.mkdirSync(path.join(resourceRoot, 'config'), {recursive: true});
  fs.mkdirSync(path.join(resourceRoot, 'vault'), {recursive: true});
  fs.mkdirSync(path.join(resourceRoot, 'data'), {recursive: true});
  fs.writeFileSync(path.join(resourceRoot, 'config', 'taxonomy.json'), 'shipped taxonomy');
  fs.writeFileSync(path.join(resourceRoot, 'config', 'copydeck.json'), 'new copy');
  fs.writeFileSync(path.join(resourceRoot, 'vault', 'private.md'), 'must never be seeded');
  fs.writeFileSync(path.join(resourceRoot, 'data', 'lifeos.db'), 'must never be seeded');
  runtime.prepareWorkspace({resourceRoot, dataRoot});
  assert.deepEqual(fs.readdirSync(path.join(dataRoot, 'vault')), []);
  assert.deepEqual(fs.readdirSync(path.join(dataRoot, 'data')), []);
  fs.writeFileSync(path.join(dataRoot, 'config', 'taxonomy.json'), 'my taxonomy');
  fs.writeFileSync(path.join(dataRoot, 'config', 'copydeck.json'), 'old copy');
  fs.writeFileSync(path.join(dataRoot, 'vault', 'journal.md'), 'my journal');
  fs.writeFileSync(path.join(dataRoot, 'data', 'lifeos.db'), 'my index');
  runtime.prepareWorkspace({resourceRoot, dataRoot});
  assert.equal(fs.readFileSync(path.join(dataRoot, 'config', 'taxonomy.json'), 'utf8'), 'my taxonomy');
  assert.equal(fs.readFileSync(path.join(dataRoot, 'config', 'copydeck.json'), 'utf8'), 'new copy');
  assert.equal(fs.readFileSync(path.join(dataRoot, 'vault', 'journal.md'), 'utf8'), 'my journal');
  assert.equal(fs.readFileSync(path.join(dataRoot, 'data', 'lifeos.db'), 'utf8'), 'my index');
});

test('packaged startup requires a bundled runtime and selects the external bootstrap', t => {
  const resourceRoot = workspace(t), dataRoot = path.join(resourceRoot, 'user');
  const options = {resourceRoot, dataRoot, isPackaged: true, platform: 'win32', env: {}};
  assert.throws(() => runtime.backendLaunch(options), /内置 Python/);
  fs.mkdirSync(path.join(resourceRoot, 'python'));
  fs.writeFileSync(path.join(resourceRoot, 'python', 'python.exe'), 'fixture');
  const launch = runtime.backendLaunch(options);
  assert.equal(launch.command, path.join(resourceRoot, 'python', 'python.exe'));
  assert.deepEqual(launch.args, [path.join(resourceRoot, 'server_bootstrap.py')]);
  assert.equal(launch.env.LIFEOS_ROOT, dataRoot);
  assert.equal(launch.env.LIFEOS_RESOURCE_ROOT, resourceRoot);
  assert.equal(launch.env.LIFEOS_HOST, '127.0.0.1');
});

for (const platform of ['win32', 'linux', 'darwin']) {
  test(`source startup uses setup's local virtualenv on ${platform} and discards inherited Python paths`, t => {
    const resourceRoot = workspace(t), dataRoot = path.join(resourceRoot, 'user');
    const virtualenv = path.join(resourceRoot, 'desktop', '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    fs.mkdirSync(path.dirname(virtualenv), {recursive: true});
    fs.writeFileSync(virtualenv, 'fixture');
    const env = {PATH: 'system-bin', PYTHONHOME: 'unrelated-conda', PYTHONPATH: 'another-project', PyThOnHoMe: 'another-python', LIFEOS_PORT: '1234'};
    const launch = runtime.backendLaunch({resourceRoot, dataRoot, isPackaged: false, platform, env});
    assert.equal(launch.command, virtualenv);
    assert.deepEqual(launch.args, [path.join(resourceRoot, 'desktop', 'server_bootstrap.py')]);
    assert.equal(launch.env.PYTHONPATH, resourceRoot);
    assert.equal(Object.keys(launch.env).some(key => key.toUpperCase() === 'PYTHONHOME'), false);
    assert.equal(launch.env.LIFEOS_PORT, '1234');
    assert.equal(env.PYTHONHOME, 'unrelated-conda', 'the parent process environment remains untouched');
  });
}

test('source startup falls back to system Python until setup creates the virtualenv', t => {
  const resourceRoot = workspace(t), dataRoot = path.join(resourceRoot, 'user');
  for (const platform of ['win32', 'linux']) {
    const launch = runtime.backendLaunch({resourceRoot, dataRoot, isPackaged: false, platform, env: {PYTHONHOME: 'conda', PYTHONPATH: 'conda-packages'}});
    assert.equal(launch.command, platform === 'win32' ? 'python' : 'python3');
    assert.equal(launch.env.PYTHONPATH, resourceRoot);
    assert.equal('PYTHONHOME' in launch.env, false);
  }
});

test('an explicit Python executable with spaces overrides a local virtualenv without shell quoting', t => {
  const resourceRoot = workspace(t), dataRoot = path.join(resourceRoot, 'user');
  const virtualenv = path.join(resourceRoot, 'desktop', '.venv', 'Scripts', 'python.exe');
  fs.mkdirSync(path.dirname(virtualenv), {recursive: true});
  fs.writeFileSync(virtualenv, 'fixture');
  const explicit = path.join(resourceRoot, 'My Python', 'python.exe');
  const launch = runtime.backendLaunch({resourceRoot, dataRoot, isPackaged: false, platform: 'win32', env: {LIFEOS_PYTHON: explicit, PYTHONHOME: 'conda'}});
  assert.equal(launch.command, explicit);
  assert.equal('PYTHONHOME' in launch.env, false);
});

test('packaged startup ignores a source virtualenv and replaces inherited Python home and Windows Path casing', t => {
  const resourceRoot = workspace(t), dataRoot = path.join(resourceRoot, 'user');
  const virtualenv = path.join(resourceRoot, 'desktop', '.venv', 'Scripts', 'python.exe');
  fs.mkdirSync(path.dirname(virtualenv), {recursive: true});
  fs.writeFileSync(virtualenv, 'fixture');
  const options = {resourceRoot, dataRoot, isPackaged: true, platform: 'win32', env: {PYTHONHOME: 'conda', PYTHONPATH: 'conda-packages', Path: 'system-bin'}};
  assert.throws(() => runtime.backendLaunch(options), /内置 Python/);
  const pythonRoot = path.join(resourceRoot, 'python');
  fs.mkdirSync(pythonRoot);
  fs.writeFileSync(path.join(pythonRoot, 'python.exe'), 'fixture');
  const launch = runtime.backendLaunch(options);
  assert.equal(launch.command, path.join(pythonRoot, 'python.exe'));
  assert.equal(launch.env.PYTHONHOME, pythonRoot);
  assert.equal(launch.env.PYTHONPATH, resourceRoot);
  assert.equal('Path' in launch.env, false);
  assert.ok(launch.env.PATH.endsWith('system-bin'));
});

test('a busy configured port is replaced with a free localhost port', async t => {
  const url = await server(t, (_, res) => res.end());
  const busy = Number(new URL(url).port);
  const selected = await runtime.availablePort(busy);
  assert.notEqual(selected, busy);
  assert.ok(selected > 0);
  await assert.rejects(runtime.availablePort('not-a-port'), /LIFEOS_PORT/);
});

test('readiness rejects error pages and unrelated services before accepting LifeOS JSON', async t => {
  let status = 500;
  let content = {ok: true, mode: 'local-first'};
  const url = await server(t, (_, response) => {response.writeHead(status, {'content-type': 'application/json'}); response.end(JSON.stringify(content));});
  await assert.rejects(runtime.healthCheck(url), /服务尚未就绪/);
  status = 200;
  content = {ok: true};
  await assert.rejects(runtime.healthCheck(url), /服务尚未就绪/);
  content = {ok: true, mode: 'local-first'};
  assert.equal((await runtime.waitForServer(url)).ok, true);
});

test('hung health requests have a bounded timeout', async t => {
  const url = await server(t, () => {});
  await assert.rejects(runtime.healthCheck(url, 40), /超时/);
});

test('a missing interpreter produces a useful error instead of an unhandled spawn error', async t => {
  let stop = async () => {};
  const dataRoot = workspace(t, () => stop());
  const backend = runtime.startBackend({command: path.join(dataRoot, 'missing-python.exe'), args: [], env: process.env}, {dataRoot, logFile: path.join(dataRoot, 'logs', 'desktop.log'), port: 1});
  stop = stopAfterClose(backend);
  await assert.rejects(runtime.waitForServer('http://127.0.0.1:1/api/health', {timeout: 2000, interval: 10, failure: backend.failure}), /无法启动本地服务/);
  assert.match(fs.readFileSync(path.join(dataRoot, 'logs', 'desktop.log'), 'utf8'), /无法启动本地服务/);
});

test('backend failures capture stderr and stop readiness immediately', async t => {
  let stop = async () => {};
  const dataRoot = workspace(t, () => stop());
  const backend = runtime.startBackend({command: process.execPath, args: ['-e', 'console.error("fixture import error");process.exit(7)'], env: process.env}, {dataRoot, logFile: path.join(dataRoot, 'desktop.log'), port: 1});
  stop = stopAfterClose(backend);
  await assert.rejects(runtime.waitForServer('http://127.0.0.1:1/api/health', {timeout: 3000, interval: 10, failure: backend.failure}), /fixture import error/);
});

test('real backend initializes clean data, serves packaged assets, and preserves a journal across restart', {skip: !process.env.LIFEOS_TEST_PYTHON, timeout: 120000}, async t => {
  let stop = async () => {};
  const base = workspace(t, () => stop());
  const paths = {resourceRoot: path.resolve(__dirname, '..'), dataRoot: path.join(base, 'workspace'), logFile: path.join(base, 'logs', 'desktop.log')};
  runtime.prepareWorkspace(paths);
  const launch = runtime.backendLaunch({...paths, isPackaged: false, env: {...process.env, LIFEOS_PYTHON: process.env.LIFEOS_TEST_PYTHON}});
  let backend;
  const start = async () => {
    const port = await runtime.availablePort();
    backend = runtime.startBackend(launch, {...paths, port});
    stop = stopAfterClose(backend);
    const url = `http://127.0.0.1:${port}`;
    await runtime.waitForServer(url + '/api/health', {failure: backend.failure});
    return url;
  };
  let url = await start();
  assert.ok(fs.existsSync(path.join(paths.dataRoot, 'data', 'lifeos.db')));
  assert.ok(fs.existsSync(path.join(paths.dataRoot, '.lifeos', 'core.db')));
  assert.equal((await fetch(url + '/')).status, 200);
  assert.equal((await fetch(url + '/poetry.js')).status, 200);
  const saved = await fetch(url + '/api/entries/save', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({journal_date: '2026-09-28', title: '启动回归测试', sections: {'今天': '只保存在测试用户目录里的日记。'}})});
  assert.equal(saved.status, 200, await saved.text());
  const entries = await (await fetch(url + '/api/entries')).json();
  assert.equal(entries.items.length, 1);
  const originalId = entries.items[0].id || entries.items[0].entry_id;
  await stop();
  runtime.prepareWorkspace(paths);
  url = await start();
  const restartedEntries = await (await fetch(url + '/api/entries')).json();
  assert.equal(restartedEntries.items.length, 1);
  assert.equal(restartedEntries.items[0].id || restartedEntries.items[0].entry_id, originalId);
  assert.equal(restartedEntries.items[0].title, '启动回归测试');
  await stop();
});
