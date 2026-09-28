// Offline support. The page itself is fetched network-first (so updates arrive
// as soon as you're online); build assets have content-hashed names and never
// change, so they are served from the cache once fetched.
const CACHE = 'blockhaven-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // version.json is how the page notices updates: never cache it.
  if (url.pathname.endsWith('/version.json')) return;
  // Videos (the trailer) stream straight from the network and are never cached.
  if (/\.(mp4|webm)$/.test(url.pathname)) return;
  const sameOrigin = url.origin === self.location.origin;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      // Only the game's own page is kept for offline play.
      if ((res.headers.get('content-type') ?? '').includes('text/html')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  if (!sameOrigin && !url.hostname.endsWith('fonts.gstatic.com')) return;
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
