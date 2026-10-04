'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const {spawnSync} = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, 'setup.cjs'), 'utf8');
const platformBinary = process.platform === 'win32' ? 'electron.exe'
  : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'LifeOS setup 中文 '));
  const desktop = path.join(root, 'desktop');
  fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(root, 'requirements.txt'), 'qrcode\n');
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, desktop};
}

function load(desktop, execute) {
  const filename = path.join(desktop, 'setup.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(desktop);
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = name => name === 'node:child_process' ? {spawnSync: execute} : originalRequire(name);
  loaded._compile(source, filename);
  return loaded.exports;
}

function seedNode(desktop, {binary = true} = {}) {
  const manifest = {name: 'fixture', version: '1.0.0', devDependencies: {electron: '37.10.3'}, dependencies: {'electron-updater': '6.6.2'}};
  const packages = {
    '': manifest,
    'node_modules/electron': {version: '37.10.3', integrity: 'fixture-electron'},
    'node_modules/electron-updater': {version: '6.6.2', integrity: 'fixture-updater'},
  };
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(desktop, 'node_modules'), {recursive: true});
  fs.writeFileSync(path.join(desktop, 'package-lock.json'), JSON.stringify({packages}));
  fs.writeFileSync(path.join(desktop, 'node_modules', '.package-lock.json'), JSON.stringify({packages}));
  for (const [name, version] of [['electron', '37.10.3'], ['electron-updater', '6.6.2']]) {
    const target = path.join(desktop, 'node_modules', name);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({name, version, main: 'index.js'}));
    fs.writeFileSync(path.join(target, 'index.js'), '// module resolution fixture\n');
  }
  const electronRoot = path.join(desktop, 'node_modules', 'electron');
  const executable = path.join(electronRoot, 'dist', platformBinary);
  fs.mkdirSync(path.dirname(executable), {recursive: true});
  fs.writeFileSync(path.join(electronRoot, 'path.txt'), platformBinary);
  fs.writeFileSync(path.join(electronRoot, 'install.js'), '// installer fixture\n');
  if (binary) fs.writeFileSync(executable, 'synthetic executable');
  return {electronRoot, executable};
}

function result(stdout = '', status = 0, stderr = '') {
  return {stdout, stderr, status};
}

test('Electron package folders without a binary are repaired without reinstalling a healthy locked dependency tree', t => {
  const {desktop} = fixture(t);
  const {electronRoot, executable} = seedNode(desktop, {binary: false});
  const commands = [];
  const helper = load(desktop, (command, args, options) => {
    commands.push({command, args, options});
    if (args.includes(path.join(electronRoot, 'install.js'))) {
      fs.writeFileSync(executable, 'repaired fixture');
      fs.writeFileSync(path.join(electronRoot, 'path.txt'), platformBinary);
    }
    if (command === executable) return result('37.10.3');
    if (args[0] === '-e') return result(executable);
    return result('{}');
  });
  assert.throws(() => helper.electronProbe(), /ENOENT|missing/);
  helper.setupNode();
  assert.equal(helper.electronProbe(), executable);
  assert.equal(commands.filter(call => call.args.includes(path.join(electronRoot, 'install.js'))).length, 1);
  assert(!commands.some(call => call.args.includes('ci') || call.args.some(arg => /\bnpm ci\b/.test(arg))), 'repair must not remove the existing node_modules tree');
});

test('an existing but broken Electron runtime fails verification and a failed download cannot report setup success', t => {
  const {desktop} = fixture(t);
  const {electronRoot, executable} = seedNode(desktop);
  const helper = load(desktop, (command, args) => {
    if (args.includes(path.join(electronRoot, 'install.js'))) return result('', 1, 'download failed');
    if (command === executable) return result('', 1, 'missing dependent DLL');
    if (args[0] === '-e') return result(executable);
    return result('{}');
  });
  assert.throws(() => helper.electronProbe(), /failed/);
  assert.throws(() => helper.setupNode(), /Electron binary download or verification failed/);
});

test('an npm dependency install failure stops before Electron repair', t => {
  const {desktop} = fixture(t);
  fs.writeFileSync(path.join(desktop, 'package.json'), '{}');
  const commands = [];
  const helper = load(desktop, (command, args) => {
    commands.push({command, args});
    return result('', 1, 'fixture npm installation failed');
  });
  assert.throws(() => helper.setupNode(), /failed/);
  assert.equal(commands.length, 1);
  assert(commands[0].args.includes('ci') || commands[0].args.some(arg => /\bnpm ci\b/.test(arg)));
  assert(!commands.some(call => call.args.some(arg => arg.endsWith('install.js'))));
});

test('project Python is created in a Chinese path with spaces and pip failures never fall back to global installation', {timeout: 90000}, t => {
  const {desktop} = fixture(t);
  const base = process.env.LIFEOS_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const available = spawnSync(base, ['-c', 'import sys, venv; print(sys.executable)'], {encoding: 'utf8'});
  if (available.error || available.status !== 0) return t.skip('Python with venv is not available');
  const original = process.env.LIFEOS_PYTHON;
  process.env.LIFEOS_PYTHON = available.stdout.trim();
  t.after(() => {if (original === undefined) delete process.env.LIFEOS_PYTHON; else process.env.LIFEOS_PYTHON = original;});
  const venv = path.join(desktop, '.venv');
  const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const commands = [];
  const helper = load(desktop, (command, args, options) => {
    commands.push({command, args, options});
    if (args[0] === '-m' && args[1] === 'pip') return result('', 1, 'fixture pip installation failed');
    // Exercise real venv creation and isolation, without installing or downloading packages.
    if (args[0] === '-m' && args[1] === 'venv') {
      return spawnSync(command, ['-m', 'venv', '--without-pip', ...args.slice(2)], {...options, stdio: 'pipe'});
    }
    return spawnSync(command, args, {...options, stdio: 'pipe'});
  });
  assert.throws(() => helper.setupPython(), /failed/);
  assert.equal(helper.pythonProbe({dependencies: false}), python);
  assert.match(fs.readFileSync(path.join(venv, 'pyvenv.cfg'), 'utf8'), /include-system-site-packages\s*=\s*false/i);
  const installs = commands.filter(call => call.args[0] === '-m' && call.args[1] === 'pip');
  assert.equal(installs.length, 1);
  assert.equal(installs[0].command, python);
  assert(installs[0].args.includes('--isolated'));
  assert.equal(installs[0].options.env.LIFEOS_PYTHON, python);
  assert(!fs.existsSync(path.join(venv, '.lifeos-requirements.sha256')), 'failed installation must not create a success stamp');
  const config = path.join(venv, 'pyvenv.cfg');
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/include-system-site-packages\s*=\s*false/i, 'include-system-site-packages = true'));
  assert.throws(() => helper.pythonProbe({dependencies: false}), /isolate system packages/);
});

test('Windows entry scripts preserve failures without pausing in --no-launch mode, including Chinese and space paths', {skip: process.platform !== 'win32', timeout: 15000}, t => {
  const {root, desktop} = fixture(t);
  fs.writeFileSync(path.join(desktop, 'setup.cjs'), 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(23);\n');
  for (const name of ['setup_desktop.bat', 'start_desktop.bat']) {
    const target = path.join(root, name);
    fs.copyFileSync(path.join(__dirname, '..', name), target);
    const executed = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${target}" --no-launch"`], {
      cwd: root, env: process.env, windowsVerbatimArguments: true, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(executed.error);
    assert.equal(executed.status, 23, executed.stdout + executed.stderr);
    assert.match(executed.stdout, /--no-launch/);
    assert.doesNotMatch(executed.stdout, /Press any key|按任意键/i);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
    env.PATH = path.join(process.env.SystemRoot, 'System32');
    const missingNode = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${target}" --no-launch"`], {
      cwd: root, env, windowsVerbatimArguments: true, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(missingNode.error);
    assert.equal(missingNode.status, 1, missingNode.stdout + missingNode.stderr);
    assert.match(missingNode.stdout, /Node.js LTS is required/);
    assert.doesNotMatch(missingNode.stdout, /Press any key|按任意键/i);
  }
});
