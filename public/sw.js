const IMAGE_CACHE = 'panoramax-images-v1';
const SHELL_CACHE = 'panoramax-cache-v2';

const SHELL_ASSETS = [
  './',
  './index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== SHELL_CACHE && cacheName !== IMAGE_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = self.registration.scope;
  const apiBase = new URL('api/', scope).pathname;

  const isImage =
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.includes(`${apiBase}proxy-image`) ||
    url.hostname.includes('panoramax') ||
    event.request.destination === 'image';

  if (isImage) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(async () => {
          const proxyUrl = `${scope.replace(/\/$/, '')}${apiBase}proxy-image?url=${encodeURIComponent(event.request.url)}`;
          const proxyResp = await cache.match(proxyUrl);
          if (proxyResp) return proxyResp;
          const originalResp = await cache.match(event.request.url);
          if (originalResp) return originalResp;
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="100%" height="100%" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="sans-serif">Image not cached (Offline)</text></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        });
      })
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request, { ignoreSearch: true }) || await cache.match('./') || await cache.match('index.html');
        if (cached) return cached;
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const fallback = await cache.match('./') || await cache.match('index.html');
          if (fallback) return fallback;
          return new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' }, status: 503 });
        }
      })
    );
    return;
  }

  if (url.pathname.startsWith(apiBase)) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return new Response(
            JSON.stringify({ error: 'Network unavailable and not cached' }),
            { headers: { 'Content-Type': 'application/json' }, status: 503 }
          );
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const clone = networkResponse.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});
