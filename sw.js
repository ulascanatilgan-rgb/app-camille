const CACHE = 'camille-pwa-simli-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/camille-base.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-64.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (
    url.origin === self.location.origin &&
    ['/session', '/simli-session', '/translate', '/health'].includes(url.pathname)
  ) {
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached =>
      cached ||
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            caches.open(CACHE).then(cache => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => cached)
    )
  );
});
