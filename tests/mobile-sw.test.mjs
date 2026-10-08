import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../promo/app/sw.js', import.meta.url), 'utf8');
const site = 'https://lifeos-diary.netlify.app';
const root = `${site}/app/`;
const shell = [
  'index.html', 'styles.css', 'app.js', 'model.js', 'storage.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png', 'icons/apple-touch-icon.png',
].map(path => `${root}${path}`);

function harness({ offline = false, failAsset = null, seed = {} } = {}) {
  const handlers = new Map(), network = [], matches = [], additions = [], deletions = [];
  const stores = new Map(Object.entries(seed).map(([name, records]) => [name, new Map(Object.entries(records))]));
  let claims = 0;
  const fetch = async request => {
    const url = typeof request === 'string' ? request : request.url;
    network.push(url);
    if (offline) throw new TypeError('Network unavailable');
    return new Response(`network:${url}`, { status: url === failAsset ? 404 : 200 });
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const records = stores.get(name);
      return {
        async addAll(urls) {
          additions.push([...urls]);
          const responses = await Promise.all(urls.map(fetch));
          if (responses.some(response => !response.ok)) throw new TypeError('Cache addAll failed');
          // Like Cache.addAll, the batch is committed only after every fetch succeeds.
          const texts = await Promise.all(responses.map(response => response.text()));
          urls.forEach((url, index) => records.set(url, texts[index]));
        },
        async match(input) {
          const url = typeof input === 'string' ? input : input.url;
          matches.push(url);
          return records.has(url) ? new Response(records.get(url)) : undefined;
        },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deletions.push(name); return stores.delete(name); },
  };
  const self = {
    location: { href: `${root}sw.js` },
    addEventListener(name, callback) { handlers.set(name, callback); },
    clients: { async claim() { claims++; } },
  };
  vm.runInNewContext(source, { self, caches, fetch, URL }, { filename: 'sw.js' });
  async function lifecycle(name) {
    let work;
    handlers.get(name)({ waitUntil(promise) { assert.equal(work, undefined); work = promise; } });
    assert.ok(work, `${name} must extend its event lifetime`);
    await work;
  }
  function request(path, { method = 'GET', mode = 'cors', headers = {} } = {}) {
    const input = { url: new URL(path, root).href, method, mode, headers: new Headers(headers) };
    let work;
    handlers.get('fetch')({ request: input, respondWith(promise) { assert.equal(work, undefined); work = Promise.resolve(promise); } });
    return { handled: work !== undefined, response: work, input };
  }
  return { lifecycle, request, stores, network, matches, additions, deletions, claims: () => claims };
}

function cachedSeed(extra = {}) {
  return { 'lifeos-pocket-v1': Object.fromEntries(shell.map(url => [url, `cached:${url}`])), ...extra };
}

test('install waits for all ten app assets and does not activate an incomplete shell', async () => {
  const worker = harness();
  await worker.lifecycle('install');
  assert.equal(worker.additions.length, 1);
  assert.deepEqual(worker.additions[0], shell);
  assert.deepEqual(worker.network, shell);
  assert.deepEqual([...worker.stores.get('lifeos-pocket-v1').keys()], shell);
  assert.equal(worker.claims(), 0);

  const failed = harness({ failAsset: `${root}storage.js`, seed: { 'lifeos-pocket-v0': { [`${root}index.html`]: 'working previous shell' } } });
  await assert.rejects(failed.lifecycle('install'), /Cache addAll failed/);
  assert.equal(failed.stores.get('lifeos-pocket-v1').size, 0);
  assert.equal(failed.stores.get('lifeos-pocket-v0').get(`${root}index.html`), 'working previous shell');
  assert.deepEqual(failed.deletions, []);
});

test('offline root and index navigations return the cached entry page', async () => {
  const worker = harness({ offline: true, seed: cachedSeed() });
  for (const path of ['/app/', '/app/index.html', '/app/?launch=homescreen', '/app/index.html?launch=browser']) {
    const request = worker.request(path, { mode: 'navigate' });
    assert.equal(request.handled, true);
    assert.equal(await (await request.response).text(), `cached:${root}index.html`);
  }
  assert.deepEqual(worker.network, []);
  assert.deepEqual(worker.matches, Array(4).fill(`${root}index.html`));
});

test('only the explicit same-origin GET shell assets are served from cache', async () => {
  const worker = harness({ offline: true, seed: cachedSeed() });
  for (const url of shell) {
    const request = worker.request(`${url}?revision=1`);
    assert.equal(request.handled, true);
    assert.equal(await (await request.response).text(), `cached:${url}`);
  }
  assert.deepEqual(worker.matches, shell);
  assert.deepEqual(worker.network, []);
});

test('other app paths, external resources and all AI endpoint requests bypass the worker', () => {
  const worker = harness({ offline: true, seed: cachedSeed() });
  for (const [url, options] of [
    ['/app/entries/private.json', {}], ['/app/diary', { mode: 'navigate' }],
    ['/app/icons/not-allowlisted.png', {}], ['/app-other/app.js', {}],
    ['/app/sw.js', {}], ['/', { mode: 'navigate' }],
    ['https://untrusted.example/app/app.js', {}],
    ['/.netlify/functions/mobile-ask', {}],
    ['/.netlify/functions/mobile-ask', { method: 'POST', headers: { Authorization: 'Bearer fake-test-key' } }],
    ['/app/app.js', { method: 'POST' }], ['/app/', { method: 'POST', mode: 'navigate' }],
  ]) {
    assert.equal(worker.request(url, options).handled, false, `${options.method || 'GET'} ${url}`);
  }
  assert.deepEqual(worker.matches, []);
  assert.deepEqual(worker.network, []);
});

test('Authorization-bearing requests bypass cache even for otherwise cacheable assets', () => {
  const worker = harness({ offline: true, seed: cachedSeed() });
  for (const [url, mode] of [['/app/', 'navigate'], ['/app/index.html', 'navigate'], ['/app/app.js', 'cors']]) {
    assert.equal(worker.request(url, { mode, headers: { Authorization: 'Bearer fake-test-key' } }).handled, false, url);
  }
  assert.deepEqual(worker.matches, []);
  assert.deepEqual(worker.network, []);
});

test('a missing shell asset falls back to network without caching response data', async () => {
  const worker = harness();
  for (const [url, mode] of [['/app/', 'navigate'], ['/app/app.js', 'cors']]) {
    const request = worker.request(url, { mode });
    assert.equal(request.handled, true);
    assert.equal(await (await request.response).text(), `network:${site}${url}`);
  }
  assert.deepEqual(worker.network, [`${root}`, `${root}app.js`]);
  assert.equal(worker.stores.get('lifeos-pocket-v1').size, 0);
  assert.deepEqual(worker.additions, []);
});

test('activation only removes older caches owned by this app and then claims clients', async () => {
  const worker = harness({ seed: cachedSeed({
    'lifeos-pocket-v0': { old: 'old shell' },
    'lifeos-pocket-obsolete': { old: 'another old shell' },
    'lifeos-website-v1': { public: 'website shell' },
    'another-app-cache': { data: 'unrelated data' },
  }) });
  await worker.lifecycle('activate');
  assert.deepEqual(worker.deletions.sort(), ['lifeos-pocket-obsolete', 'lifeos-pocket-v0']);
  assert.deepEqual([...worker.stores.keys()].sort(), ['another-app-cache', 'lifeos-pocket-v1', 'lifeos-website-v1']);
  assert.equal(worker.claims(), 1);
  assert.deepEqual(worker.network, []);
});
