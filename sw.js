const CACHE = 'ecl-clips-workflow-v57';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.bundle.js',
  '/manifest.webmanifest',
  '/emma-portrait.jpg',
  '/ecl-avatar-image/emma.jpg',
  '/ecl-avatar-image/charlotte.jpg',
  '/ecl-avatar-image/louis.jpg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-64.png',
  '/uca-lab-logo.png'
];

self.addEventListener('install', event => {
  // A missing optional avatar or image must never prevent the updated
  // HTML/JS from installing on an iPhone's home-screen PWA.
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await Promise.allSettled(STATIC_ASSETS.map(async asset => {
      const response=await fetch(asset,{cache:'reload'});
      if(response.ok)await cache.put(asset,response);
    }));
  }));
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
    ['/anam-session', '/anam-health', '/chat', '/choices', '/tip', '/translate', '/health', '/vocab', '/study-news', '/study-slide-deck', '/study-media-script'].includes(url.pathname)
  ) {
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(res => {
        if (res && res.ok) {
          caches.open(CACHE).then(cache => cache.put(req, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
