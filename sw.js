const CACHE = 'camille-pwa-flat-v2';
const STATIC_ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest',
  '/camille-base.png', '/camille-talk-1.png', '/camille-talk-2.png', '/camille-blink.png',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon-64.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && (url.pathname === '/session' || url.pathname === '/translate')) return;
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
    if (res && res.ok) caches.open(CACHE).then(cache => cache.put(req, res.clone()));
    return res;
  }).catch(() => cached)));
});
