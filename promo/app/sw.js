const CACHE = 'lifeos-pocket-v1';
const ROOT = new URL('./', self.location.href);
const FILES = ['index.html', 'styles.css', 'app.js', 'model.js', 'storage.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png', 'icons/apple-touch-icon.png'];
const ASSETS = FILES.map(path => new URL(path, ROOT).href);

self.addEventListener('install', event => {
  // An incomplete shell never replaces a working offline version.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('lifeos-pocket-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.headers.has('authorization') || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (event.request.mode === 'navigate' && [ROOT.pathname, `${ROOT.pathname}index.html`].includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(new URL('index.html', ROOT).href)) || fetch(event.request)));
    return;
  }
  url.search = ''; url.hash = '';
  if (!ASSETS.includes(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.href)) || fetch(event.request)));
});
