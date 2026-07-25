# 07 — PWA: Manifest, Service Worker, Offline

The app is installedable as a PWA. After install, it opens in its own window (Android) or app container (desktop Chrome/Edge), with offline support for reviewed images and queued review submissions.

## `public/manifest.json`

```json
{
  "short_name": "Panoramax",
  "name": "Panoramax Image Reviewer",
  "description": "Mobile-friendly application to review, flag, and cache Panoramax street-level imagery with offline capabilities.",
  "icons": [
    {
      "src": "/icon-192.png",
      "type": "image/png",
      "sizes": "192x192",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "type": "image/png",
      "sizes": "512x512",
      "purpose": "any maskable"
    }
  ],
  "start_url": "/",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "display": "standalone",
  "orientation": "portrait-primary",
  "categories": ["utilities", "productivity", "photo"]
}
```

## Icons

The repo needs `public/icon-192.png` and `public/icon-512.png`. Generate them from the favicon SVG (`public/favicon.svg`) at 192×192 and 512×512. Any image conversion tool works (e.g. `sharp`, ImageMagick, or a quick script). They should look identical to the SVG.

## `index.html` meta tags

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes" />
<meta name="theme-color" content="#0f172a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Panoramax Review" />
<meta name="description" content="Mobile-friendly app to review, flag, and cache Panoramax street-level imagery." />
<link rel="manifest" href="/manifest.json" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/favicon.svg" />
```

`<body>` className: `bg-slate-900 text-slate-100 antialiased selection:bg-slate-700 selection:text-white` (gets overridden by the React app shell on first render, but useful for the brief pre-mount flash).

## `public/sw.js` — Service Worker

Cache **two** named caches:
- `panoramax-cache-v1` — app shell (HTML, JS, CSS) — currently the SW doesn't actively populate this; it's a placeholder for future pre-caching. The browser's HTTP cache handles SPA assets well enough for v1.
- `panoramax-images-v1` — image responses (used by `cacheManager` and the SW's fetch handler).

### Install
```js
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
```

### Activate
```js
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== 'panoramax-cache-v1' && cacheName !== 'panoramax-images-v1') {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
```

### Fetch
Three cases:

#### Image requests
Match on: URL ending in `.jpg` / `.png`, OR URL containing `/api/proxy-image`, OR hostname including `panoramax`, OR `event.request.destination === 'image'`.

Strategy: **cache-first with network fallback**.
```js
event.respondWith(
  caches.open('panoramax-images-v1').then((cache) => {
    return cache.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback: SVG placeholder
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="100%" height="100%" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="sans-serif">Image not cached (Offline)</text></svg>',
          { headers: { 'Content-Type': 'image/svg+xml' } }
        );
      });
    });
  })
);
```

#### API requests (`url.pathname.startsWith('/api/')`)
Strategy: **network-first with cache fallback**. Reviews can never be served stale (they'd be lost); but if the network is down, return whatever cached response exists, otherwise a 503 JSON error.
```js
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
```

#### Other requests
Let the browser handle them (no `respondWith` call).

## `src/main.tsx` — SW registration

Register `/sw.js` only in production:

```ts
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('PWA ServiceWorker registered with scope:', reg.scope))
      .catch((err) => console.warn('PWA ServiceWorker registration failed:', err));
  });
}
```

## Install button (beforeinstallprompt)

In `App.tsx`, capture `beforeinstallprompt` and store it. Show the "Install App" button in the header only when `deferredPrompt` is set. On click, call `deferredPrompt.prompt()` and check `userChoice.outcome`; if accepted, clear the prompt.

```ts
const handleInstallPwa = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') setDeferredPrompt(null);
};
```

iOS Safari does not fire `beforeinstallprompt`, so iOS users install via the Share → Add to Home Screen menu. The app should NOT show the install button on iOS (the `deferredPrompt` will be null, so this is automatic).

## Offline review queue

When the user submits a review and the network is unavailable (or the fetch throws), the SPA stores it in localStorage and advances to the next picture as if it succeeded.

### `OfflineReview` shape
```ts
interface OfflineReview {
  id: string;             // `offline_<epoch>_<rand>`
  pictureId: string;
  status: ReviewStatus;
  errorReason?: string;
  comment?: string;
  createdAt: string;      // ISO
}
```

### Behavior
- `saveOfflineReview({ pictureId, status, errorReason?, comment? })` — replaces any queued review with the same `pictureId` (the user's latest decision wins).
- Stored under `localStorage['panoramax_offline_reviews_queue']` as JSON.
- `getOfflineCount()` returns the array length.
- `syncOfflineQueue()` (in `api.ts`) iterates the queue, POSTs each to `/api/reviews`, removes successfully-synced items, leaves failed ones. Returns `{ syncedCount, failedCount }`.

### When to sync
- On `window.online` event.
- On a 2.5-second polling interval (in `App.tsx`) when `navigator.onLine` is true and `getOfflineCount() > 0`.
- After each successful sync, refresh `stats` so the header counter updates.

### Submit-failover logic
`submitPictureReview` should:
1. Try `fetch('/api/reviews', ...)`.
2. If `!navigator.onLine` OR the fetch throws OR returns 5xx, call `saveOfflineReview(...)` and return a **synthetic** success response:
   ```ts
   {
     success: true,
     review: {
       id: 'offline_' + Date.now() + '_' + rand,
       pictureId,
       userId: user.id,
       userName: user.username,
       status,
       errorReason,
       comment,
       reviewedAt: new Date().toISOString(),
     },
     picture: { ...currentPicture, status: status === 'ok' ? 'reviewed_ok' : 'flagged', reviewCount: currentPicture.reviewCount + 1, lastReviewedAt: ..., lastErrorReason: ..., lastComment: ..., lastReviewer: ... },
   }
   ```
3. The synthetic review's `id` is what goes on the undo stack. **Undo of an offline review** should remove it from the queue (via `removeOfflineReview(id)`) instead of calling `/api/reviews/undo`. Detect by `id.startsWith('offline_')`.

### Header offline indicator
Shown only when `!isOnline` OR `offlinePendingCount > 0`:
- Offline (`!isOnline`): amber pill, `bg-amber-500/15 text-amber-900 border-amber-300`, dot `bg-amber-500 animate-ping`, label "Offline ({n})" (label hidden on mobile).
- Online with pending (`offlinePendingCount > 0`): emerald pill, `bg-emerald-500/15 text-emerald-900 border-emerald-300`, dot `bg-emerald-500 animate-pulse`, label "Syncing {n}..." (label hidden on mobile).

## Image prefetch cache (client-side)

`src/services/cacheManager.ts` exposes a singleton `cacheManager` with `prefetchPictures`, `isCached`, `getCachedCount`, `clearCache`, `setCellularSaver`, `getCellularSaver`.

- Uses the Cache API (`caches.open('panoramax-images-v1')`) — same cache name as the service worker, so the SW can serve prefetched images instantly on next load.
- Keeps an in-memory `Set<string>` of cached URLs (initialized on first run by reading existing cache keys).
- `prefetchPictures(pictures, maxCount)`:
  - Skip entirely if `cellularSaverActive`.
  - Limit to `min(maxCount, 500)`.
  - Process in batches of 8 concurrently.
  - For each picture, fetch `sdUrl`:
    1. Try `fetch(url, { mode: 'cors' })`. If ok, `cache.put(url, response.clone())`.
    2. If that throws, try `fetch('/api/proxy-image?url=' + encodeURIComponent(url))` and cache that response under the **proxy URL** (and also mark the original URL as known so we don't retry).
  - Insert a 50ms delay between batches when total > 25 to avoid saturating the network.
- Abort early if `cellularSaverActive` flips on mid-prefetch.

### Cellular detection
The SettingsModal uses `navigator.connection` (Network Information API, where available) to detect `type === 'cellular'`, `saveData === true`, or `effectiveType` in `['2g', '3g']`. If detected, show a warning recommending the user enable Cellular Data Saver. This is a passive hint; the actual blocking is the user's toggle.

## Caching of API responses (optional, not required)

The service worker does NOT cache `/api/*` responses proactively. The network-first handler returns a cached response only if the network fails. This is acceptable for v1.

Do NOT cache:
- `POST /api/reviews` (review submission) — never serve stale.
- `POST /api/pictures/import` and similar — mutating endpoints.

It's fine if `GET /api/pictures/queue` and `GET /api/pictures/next` are served from cache when offline, even if stale — the SPA handles a missing picture gracefully.

## Cache eviction

For v1, do not implement LRU eviction. The Cache API will eventually evict if storage pressure gets extreme. If the user wants to clear the cache, the SettingsModal has a "Flush Local Image Cache" button that calls `cacheManager.clearCache()` (which `caches.delete('panoramax-images-v1')`).

## iOS Safari notes

- No `beforeinstallprompt` — install is manual via Share menu. That's fine.
- `apple-mobile-web-app-capable=yes` and `apple-mobile-web-app-status-bar-style=black-translucent` make the installed PWA feel native.
- The File System Access API is unavailable on iOS, but the app doesn't use it (only the Cache API and localStorage, both of which work).
- iOS has an aggressive 50MB localStorage quota in some cases — keep the offline queue small (it will be: it's just review records, not images).
