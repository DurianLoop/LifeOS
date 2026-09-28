'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const {spawn} = require('node:child_process');

function runtimePaths({isPackaged, resourcesPath, desktopDir, userData, env = process.env}) {
  const resourceRoot = isPackaged ? resourcesPath : path.resolve(desktopDir, '..');
  const dataRoot = env.LIFEOS_ROOT || (isPackaged ? path.join(userData, 'workspace') : resourceRoot);
  return {resourceRoot, dataRoot: path.resolve(dataRoot), logFile: path.join(userData, 'logs', 'desktop.log')};
}

function copyMissing(source, target) {
  if (!fs.existsSync(source)) return;
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, {recursive: true});
    for (const name of fs.readdirSync(source)) copyMissing(path.join(source, name), path.join(target, name));
  } else if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}

function prepareWorkspace({resourceRoot, dataRoot}) {
  for (const name of ['vault', 'data', '.lifeos']) fs.mkdirSync(path.join(dataRoot, name), {recursive: true});
  if (path.resolve(resourceRoot) !== path.resolve(dataRoot)) {
    copyMissing(path.join(resourceRoot, 'config'), path.join(dataRoot, 'config'));
    for (const name of fs.readdirSync(path.join(resourceRoot, 'config'))) {
      if (/^(copydeck|edition|poetry_catalog|features_\d+_baseline)\.json$/.test(name)) {
        fs.copyFileSync(path.join(resourceRoot, 'config', name), path.join(dataRoot, 'config', name));
      }
    }
    copyMissing(path.join(resourceRoot, 'app', 'assets', 'pets'), path.join(dataRoot, 'app', 'assets', 'pets'));
  }
}

function backendLaunch({resourceRoot, dataRoot, isPackaged, platform = process.platform, env = process.env}) {
  const bundled = path.join(resourceRoot, 'python', platform === 'win32' ? 'python.exe' : 'bin/python3');
  const frozen = path.join(resourceRoot, platform === 'win32' ? 'lifeos-server.exe' : 'lifeos-server');
  const virtualenv = path.join(resourceRoot, 'desktop', '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  // A shell's Conda/other Python environment must not redirect the selected
  // interpreter's standard library or inject unrelated project modules.
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !['PYTHONHOME', 'PYTHONPATH'].includes(key.toUpperCase())));
  const backendEnv = {
    ...cleanEnv,
    LIFEOS_ROOT: dataRoot,
    LIFEOS_RESOURCE_ROOT: resourceRoot,
    LIFEOS_NO_BROWSER: '1',
    LIFEOS_HOST: '127.0.0.1',
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: resourceRoot,
  };
  if (isPackaged && fs.existsSync(frozen)) return {command: frozen, args: [], env: backendEnv};
  let command = env.LIFEOS_PYTHON;
  if (!command && !isPackaged && fs.existsSync(virtualenv) && fs.statSync(virtualenv).isFile()) command = virtualenv;
  if (!command && isPackaged && fs.existsSync(bundled)) {
    command = bundled;
    const pythonRoot = platform === 'win32' ? path.dirname(bundled) : path.resolve(path.dirname(bundled), '..');
    backendEnv.PYTHONHOME = pythonRoot;
    const inheritedPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
    for (const key of Object.keys(backendEnv)) if (key.toUpperCase() === 'PATH') delete backendEnv[key];
    backendEnv.PATH = [pythonRoot, path.join(pythonRoot, 'DLLs'), path.join(pythonRoot, 'Library', 'bin'), inheritedPath].join(path.delimiter);
  }
  if (!command && isPackaged) throw new Error('安装包缺少内置 Python 运行环境，请重新安装完整的 LifeOS 安装包。');
  return {
    command: command || (platform === 'win32' ? 'python' : 'python3'),
    args: [isPackaged ? path.join(resourceRoot, 'server_bootstrap.py') : path.join(resourceRoot, 'desktop', 'server_bootstrap.py')],
    env: backendEnv,
  };
}

function availablePort(preferred = 0) {
  const port = Number(preferred);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return Promise.reject(new Error('LIFEOS_PORT 必须是 1–65535 之间的端口。'));
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE' && port !== 0) availablePort().then(resolve, reject);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      const selected = server.address().port;
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
}

function healthCheck(url, requestTimeout = 1500) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 262144) request.destroy(new Error('健康检查响应过大。'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (response.statusCode !== 200 || result.ok !== true || result.mode !== 'local-first') throw new Error('服务尚未就绪。');
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(requestTimeout, () => request.destroy(new Error('健康检查超时。')));
    request.on('error', reject);
  });
}

async function waitForServer(url, {timeout = 60000, interval = 180, failure = () => null} = {}) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    if (failure()) throw failure();
    try {
      const result = await healthCheck(url, Math.min(1500, Math.max(1, until - Date.now())));
      if (failure()) throw failure();
      return result;
    } catch (error) { lastError = error; }
    if (failure()) throw failure();
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`本地服务启动超时：${lastError?.message || url}`);
}

function startBackend(launch, {dataRoot, logFile, port, onExit = () => {}}) {
  fs.mkdirSync(path.dirname(logFile), {recursive: true});
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) {
    fs.copyFileSync(logFile, `${logFile}.previous`);
    fs.truncateSync(logFile, 0);
  }
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] LifeOS backend starting on 127.0.0.1:${port}\n`);
  let failure = null;
  let tail = '';
  let stopping = false;
  const child = spawn(launch.command, launch.args, {
    cwd: dataRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...launch.env, LIFEOS_PORT: String(port)},
  });
  const record = chunk => {
    const text = String(chunk);
    tail = (tail + text).slice(-10000);
    try { fs.appendFileSync(logFile, text); } catch { /* Startup still reports the process failure. */ }
    if (process.env.LIFEOS_DESKTOP_DEBUG === '1') process.stderr.write(text);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.once('error', error => {
    failure = new Error(`无法启动本地服务：${error.message}。源码运行请先执行 setup_desktop；安装版请重新安装完整安装包。`);
    record(`${failure.message}\n`);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) failure = new Error(`本地服务已退出（${signal || code}）。${tail ? `\n${tail}` : ''}`);
    onExit(failure);
  });
  return {
    child,
    failure: () => failure,
    stop() { stopping = true; if (child.exitCode === null) child.kill(); },
  };
}

module.exports = {runtimePaths, copyMissing, prepareWorkspace, backendLaunch, availablePort, healthCheck, waitForServer, startBackend};
