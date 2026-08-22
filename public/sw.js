// Minimal service worker for the My Drive PWA.
// Strategy:
//   - App shell (HTML/JS/CSS/manifest/icons) is cached on install and served
//     network-first with cache fallback, so updates are picked up when online
//     and the app still opens when offline.
//   - Hashed build assets (Vite emits /assets/*-<hash>.js|css) are served
//     network-first too: the filename already changes on every deploy, so
//     if the network works we always take the newest bytes; the cache is
//     only a fallback for offline.
//   - /api/* requests are always network-only. We never cache user data or
//     directory listings; stale files would be worse than an error message.

const CACHE = 'my-drive-shell-v3';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API — always hit the network for live data.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: try the network first, fall back to cached index.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Hashed build assets: filename changes on every deploy, so prefer the
  // network and only fall back to cache when offline. This kills the
  // classic PWA "still running old JS after deploy" bug that cache-first
  // causes when a browser was left open across a release.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.error()))
    );
    return;
  }

  // Other static assets (icons, manifest): cache-first, refresh in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
