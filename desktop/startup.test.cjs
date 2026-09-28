'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const runtime = require('./runtime.cjs');

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LifeOS 启动测试 '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
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
  const dataRoot = workspace(t);
  const backend = runtime.startBackend({command: path.join(dataRoot, 'missing-python.exe'), args: [], env: process.env}, {dataRoot, logFile: path.join(dataRoot, 'logs', 'desktop.log'), port: 1});
  t.after(() => backend.stop());
  await assert.rejects(runtime.waitForServer('http://127.0.0.1:1/api/health', {timeout: 2000, interval: 10, failure: backend.failure}), /无法启动本地服务/);
  assert.match(fs.readFileSync(path.join(dataRoot, 'logs', 'desktop.log'), 'utf8'), /无法启动本地服务/);
});

test('backend failures capture stderr and stop readiness immediately', async t => {
  const dataRoot = workspace(t);
  const backend = runtime.startBackend({command: process.execPath, args: ['-e', 'console.error("fixture import error");process.exit(7)'], env: process.env}, {dataRoot, logFile: path.join(dataRoot, 'desktop.log'), port: 1});
  t.after(() => backend.stop());
  await assert.rejects(runtime.waitForServer('http://127.0.0.1:1/api/health', {timeout: 3000, interval: 10, failure: backend.failure}), /fixture import error/);
});

test('real backend initializes clean data, serves packaged assets, and preserves a journal across restart', {skip: !process.env.LIFEOS_TEST_PYTHON, timeout: 120000}, async t => {
  const base = workspace(t);
  const paths = {resourceRoot: path.resolve(__dirname, '..'), dataRoot: path.join(base, 'workspace'), logFile: path.join(base, 'logs', 'desktop.log')};
  runtime.prepareWorkspace(paths);
  const launch = runtime.backendLaunch({...paths, isPackaged: false, env: {...process.env, LIFEOS_PYTHON: process.env.LIFEOS_TEST_PYTHON}});
  let backend;
  const stop = async () => {
    if (!backend || backend.child.exitCode !== null || backend.child.signalCode !== null) return;
    const exited = once(backend.child, 'exit');
    backend.stop();
    await exited;
  };
  t.after(stop);
  const start = async () => {
    const port = await runtime.availablePort();
    backend = runtime.startBackend(launch, {...paths, port});
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
