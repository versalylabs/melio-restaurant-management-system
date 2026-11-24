/*
 * Melio service worker: keeps the staff app on the device so the POS opens
 * without internet. Orders, menu and tables data are handled by the app's own
 * offline queue and cache; this never caches API responses.
 *
 * The build stamps its version into this file, so each deploy is a new
 * worker with a fresh cache. Pages already open keep the version they started
 * with until staff tap "Update".
 */
const VERSION = '__MELIO_SW_VERSION__';
const CACHE = `melio-app-${VERSION}`;
const SHELL = ['/index.html', '/manifest.webmanifest', '/pwa-192.png', '/pwa-512.png', '/pwa-maskable-512.png', '/favicon.svg', '/favicon.png'];

const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // Every script and stylesheet of this build, so any screen opens offline.
    const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('No asset manifest');
    const manifest = await res.json();
    const files = new Set();
    const entries = new Set();
    for (const entry of Object.values(manifest)) {
      if (entry.file && /\.(js|css)$/.test(entry.file)) files.add('/' + entry.file);
      if (entry.isEntry && entry.file) entries.add('/' + entry.file);
      for (const css of entry.css || []) files.add('/' + css);
    }
    const store = async (f) => {
      const r = await fetch(f, { cache: 'reload' });
      // Never keep an HTML page in place of a missing script.
      if (!r.ok || isHtml(r)) throw new Error(`Could not cache ${f}`);
      await cache.put(f, r);
    };
    // The app's entry files must be saved, or this version isn't installed;
    // the rest are best effort and cached later as screens are opened.
    await Promise.all([...entries].map(store));
    await Promise.all([...files].filter((f) => !entries.has(f)).map((f) => store(f).catch(() => undefined)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('melio-app-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const isAsset = (url) => url.pathname.startsWith('/assets/');
const isStatic = (url) => /\.(png|svg|ico|webmanifest|woff2?|jpg|jpeg|webp)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js' || url.pathname === '/asset-manifest.json') return;

  // Pages: the network when it answers within 4 s, otherwise the saved app.
  // The saved copy is only this build's own index.html, never replaced by
  // whatever a later deploy serves (that would point at files not saved here).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
        ]);
        if (res && res.status < 500) return res;
        throw new Error(`server error ${res && res.status}`);
      } catch {
        return (await cache.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Built files never change (their names carry a hash): saved copy first.
  if (isAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && !isHtml(res)) cache.put(req, res.clone()).catch(() => undefined);
      return res;
    })());
    return;
  }

  // Icons and images: saved copy at once, refreshed in the background.
  if (isStatic(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok && !isHtml(res)) cache.put(req, res.clone()).catch(() => undefined); return res; }).catch(() => hit);
      return hit || fresh;
    })());
  }
});
