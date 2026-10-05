/* UBIDS Campus Map service worker
   - App shell: precached, so the app opens offline.
   - index.html: network first (3.5 s timeout) so edits to your places show up
     as soon as students are online, with the saved copy as the fallback.
   - Map tiles: cache first, so anything viewed or saved stays available offline.
   - Directions: always live from the network (the app draws a straight line if offline).
   Bump VERSION only when you change sw.js or the library files. */
const VERSION = 'v3';
const SHELL = 'ubids-shell-' + VERSION;
const RUNTIME = 'ubids-runtime-' + VERSION;
const TILES = 'ubids-tiles-v1';          // must match the name used in index.html
const MAX_TILES = 3000;

const INDEX = new URL('./index.html', self.registration.scope).href;
const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'
];
const CDN_PRECACHE = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet-routing-machine/3.2.12/leaflet-routing-machine.min.js'
];
const OPTIONAL_PRECACHE = ['./school-photo.jpg', './school-photo.jpeg'];
const CDN_HOSTS = ['cdnjs.cloudflare.com'];
const TILE_HOSTS = ['server.arcgisonline.com'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(async cache => {
        await cache.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })));
        // Libraries come from a CDN, so save them without failing the install if the CDN is slow.
        await Promise.all(CDN_PRECACHE.map(u =>
          fetch(u, { mode: 'no-cors' }).then(r => cache.put(u, r)).catch(() => {})));
        await Promise.all(OPTIONAL_PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![SHELL, RUNTIME, TILES].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function okToCache(res) { return res && (res.ok || res.type === 'opaque'); }

function networkFirst(request, cacheName, key, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const finish = res => { if (!settled && res) { settled = true; resolve(res); } };
    const timer = setTimeout(async () => { finish(await caches.match(key, { ignoreSearch: true })); }, timeoutMs);
    fetch(request).then(async res => {
      clearTimeout(timer);
      if (res.ok) { const c = await caches.open(cacheName); c.put(key, res.clone()); }
      finish(res);
    }).catch(async () => {
      clearTimeout(timer);
      const cached = await caches.match(key, { ignoreSearch: true });
      if (cached) finish(cached); else finish(Response.error());
    });
  });
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then(res => {
    if (okToCache(res)) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (okToCache(res)) { const c = await caches.open(cacheName); c.put(request, res.clone()); }
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
  }
}

async function tileFirst(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (okToCache(res)) { cache.put(request, res.clone()); if (Math.random() < 0.05) trimTiles(cache); }
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL, INDEX, 3500));
  } else if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith(tileFirst(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME));
  }
  // Anything else (the walking-route service) goes straight to the network.
});
