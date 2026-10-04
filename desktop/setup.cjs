'use strict';

// Source setup always installs Python packages in this checkout's .venv.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');

const DESKTOP = __dirname;
const ROOT = path.dirname(DESKTOP);
const VENV = path.join(DESKTOP, '.venv');
const PYTHON = path.join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const REQUIREMENTS = path.join(ROOT, 'requirements.txt');
const SETUP_HINT = process.platform === 'win32' ? 'setup_desktop.bat --no-launch' : './setup_desktop.sh --no-launch';

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => ![
    'PYTHONHOME', 'PYTHONPATH', 'PIP_TARGET', 'PIP_PREFIX', 'PIP_USER',
    'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_SKIP_BINARY_DOWNLOAD',
  ].includes(key.toUpperCase())));
}

function venvEnvironment() {
  const env = cleanEnvironment();
  const configuration = path.join(VENV, 'pyvenv.cfg');
  let base = '';
  if (fs.existsSync(configuration)) base = fs.readFileSync(configuration, 'utf8').match(/^home\s*=\s*(.+)$/m)?.[1]?.trim() || '';
  const additions = [path.dirname(PYTHON)];
  if (base && process.platform === 'win32') additions.push(base, path.join(base, 'DLLs'), path.join(base, 'Library', 'bin'));
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = [...additions, env[pathKey] || ''].join(path.delimiter);
  return {...env, VIRTUAL_ENV: VENV, LIFEOS_PYTHON: PYTHON, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1'};
}

function run(command, args, {env = cleanEnvironment(), capture = false, timeout = 600000, windowsHide = true} = {}) {
  const result = spawnSync(command, args, {cwd: DESKTOP, env, windowsHide,
    stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', timeout});
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || (capture ? (result.stderr || result.stdout || '').trim() : 'See the error above.');
    throw new Error(`${path.basename(command)} failed (${result.status ?? 'not started'}): ${detail}`);
  }
  return result.stdout || '';
}

function npm(args, options) {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) return run(process.execPath, [cli, ...args], options);
  if (process.platform === 'win32') {
    // These are fixed internal npm verbs and flags, never user command text.
    if (args.some(value => !/^[a-z0-9=,-]+$/i.test(value))) throw new Error('Invalid internal npm argument');
    return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ' + args.join(' ')], options);
  }
  return run('npm', args, options);
}

function pythonProbe({dependencies = true} = {}) {
  if (!fs.existsSync(PYTHON)) throw new Error(`The project Python environment is missing. Run ${SETUP_HINT}.`);
  const code = [
    'import pathlib, sys',
    'assert sys.version_info >= (3, 10), "Python 3.10 or newer is required"',
    'assert pathlib.Path(sys.prefix).resolve() == pathlib.Path(sys.argv[1]).resolve(), "Python is outside desktop/.venv"',
    'assert sys.prefix != sys.base_prefix, "The project interpreter is not a virtual environment"',
    'cfg = (pathlib.Path(sys.prefix) / "pyvenv.cfg").read_text(encoding="utf-8").lower()',
    'assert "include-system-site-packages = true" not in cfg, "The project virtual environment must isolate system packages"',
    ...(dependencies ? ['import qrcode, keyring', 'from cryptography.fernet import Fernet', 'Fernet.generate_key()'] : []),
    'print(sys.executable)',
  ].join('\n');
  run(PYTHON, ['-c', code, VENV], {env: venvEnvironment(), capture: true, timeout: 30000});
  return PYTHON;
}

function electronProbe() {
  const localRequire = createRequire(path.join(DESKTOP, 'package.json'));
  const electronRoot = path.dirname(localRequire.resolve('electron'));
  const manifest = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
  const packageManifest = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
  if (manifest.version !== packageManifest.devDependencies.electron) throw new Error('Electron does not match desktop/package.json.');
  const relative = fs.readFileSync(path.join(electronRoot, 'path.txt'), 'utf8').trim();
  const expected = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  if (relative.replace(/\\/g, '/') !== expected) throw new Error('Electron path.txt does not identify the current platform binary.');
  const binary = path.resolve(electronRoot, 'dist', relative);
  if (!fs.statSync(binary).isFile() || fs.statSync(binary).size === 0) throw new Error('Electron executable is missing or empty.');
  // A clean child process avoids cached require paths after an installer repair.
  const resolved = run(process.execPath, ['-e', 'process.stdout.write(require("electron"))'], {capture: true});
  if (path.resolve(resolved) !== binary) throw new Error('The Electron module resolves to a different executable.');
  const version = run(binary, ['-e', 'process.stdout.write(process.versions.electron || "")'],
    {env: {...cleanEnvironment(), ELECTRON_RUN_AS_NODE: '1'}, capture: true, timeout: 30000}).trim();
  if (version !== manifest.version) throw new Error(`The Electron runtime is incomplete or has the wrong version (${version || 'unknown'}).`);
  localRequire.resolve('electron-updater');
  return binary;
}

function nodeDependenciesMatchLock() {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package-lock.json'), 'utf8'));
    const installed = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'node_modules', '.package-lock.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      if (JSON.stringify(manifest[field] || {}) !== JSON.stringify(lock.packages[''][field] || {})) return false;
    }
    for (const [name, record] of Object.entries(installed.packages || {})) {
      if (!name) continue;
      const expected = lock.packages[name];
      if (!expected || record.version !== expected.version || record.integrity !== expected.integrity) return false;
    }
    npm(['ls', '--all', '--json'], {capture: true, timeout: 120000});
    return true;
  } catch { return false; }
}

function setupPython() {
  let usable = false;
  try { pythonProbe({dependencies: false}); usable = true; } catch {}
  if (!usable) {
    const base = process.env.LIFEOS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    console.log('Creating an isolated Python environment in desktop/.venv...');
    run(base, ['-c', 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 or newer is required"'], {capture: true});
    run(base, ['-m', 'venv', VENV]);
    pythonProbe({dependencies: false});
  }
  const stamp = path.join(VENV, '.lifeos-requirements.sha256');
  const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(REQUIREMENTS)).digest('hex');
  let complete = false;
  try { pythonProbe(); complete = fs.readFileSync(stamp, 'utf8').trim() === fingerprint; } catch {}
  if (!complete) {
    console.log('Installing Python dependencies into desktop/.venv...');
    run(PYTHON, ['-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-user', '--prefix', VENV, '-r', REQUIREMENTS], {env: venvEnvironment()});
    pythonProbe();
    run(PYTHON, ['-m', 'pip', '--isolated', 'check'], {env: venvEnvironment()});
    fs.writeFileSync(stamp, fingerprint + '\n');
  } else {
    console.log('Project Python dependencies are already healthy.');
  }
}

function setupNode() {
  if (!nodeDependenciesMatchLock()) {
    console.log('Installing the locked desktop dependencies...');
    npm(['ci', '--no-audit', '--no-fund']);
  } else {
    console.log('Locked Node dependencies are already healthy.');
  }
  try { electronProbe(); return; } catch (error) {
    console.log(`Repairing the Electron binary: ${error.message}`);
  }
  const installer = path.join(DESKTOP, 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(installer)) throw new Error('Electron installer is missing after npm ci. Dependency setup did not finish.');
  // Removing the generated marker forces repair even if dependent DLLs are
  // missing while the main executable and version marker are still present.
  fs.rmSync(path.join(DESKTOP, 'node_modules', 'electron', 'path.txt'), {force: true});
  const env = cleanEnvironment();
  for (const key of Object.keys(env)) if (['NPM_CONFIG_PLATFORM', 'NPM_CONFIG_ARCH'].includes(key.toUpperCase())) delete env[key];
  try {
    run(process.execPath, [installer], {env});
    electronProbe();
  } catch (error) {
    throw new Error(`Electron binary download or verification failed. Check the network/proxy and rerun ${SETUP_HINT}.\n${error.message}`);
  }
}

function launch() {
  pythonProbe();
  const electron = electronProbe();
  console.log('Opening LifeOS with desktop/.venv...');
  run(electron, [DESKTOP], {env: venvEnvironment(), timeout: 0, windowsHide: false});
}

function main(argv = process.argv.slice(2)) {
  const [command, ...flags] = argv;
  if (!['setup', 'start', 'check'].includes(command) || flags.some(flag => flag !== '--no-launch')) {
    throw new Error('Usage: node desktop/setup.cjs setup [--no-launch] | start | check');
  }
  if (command === 'setup') {
    setupPython();
    setupNode();
    pythonProbe();
    electronProbe();
    console.log('Setup complete. The project Python environment and Electron binary are verified.');
    if (!flags.includes('--no-launch')) launch();
  } else if (command === 'check' || flags.includes('--no-launch')) {
    pythonProbe();
    electronProbe();
    console.log('Desktop dependencies are ready.');
  } else {
    launch();
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`\nLifeOS source setup/start failed: ${error.message}\nRun ${SETUP_HINT} to repair the project dependencies.`);
    process.exitCode = 1;
  }
}

module.exports = {pythonProbe, electronProbe, nodeDependenciesMatchLock, cleanEnvironment, venvEnvironment, setupPython, setupNode, main};
