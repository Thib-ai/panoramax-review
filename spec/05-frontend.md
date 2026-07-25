# 05 — Frontend

React 19 SPA built with Vite. Single entry, no router — the whole app is one screen with modal overlays.

## Stack

- **React 19** (`react`, `react-dom`).
- **Vite 6** for dev server and build.
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin. `src/index.css` is just `@import "tailwindcss";`.
- **lucide-react** for icons.
- **TypeScript 5** strict.

No `firebase`, no `@google/genai`, no `motion` (the previous version imported it but barely used it — replace any `motion.*` with CSS transitions if encountered).

## Entry

`index.html` is the Vite entry. Loads `/src/main.tsx`, which:
1. Registers the service worker (`/sw.js`) in production only.
2. Captures `beforeinstallprompt` events globally (for the "Install PWA" button).
3. Renders `<App />` in `StrictMode`.

## `src/App.tsx` — top-level state machine

The App component owns all global state and renders one of:

1. **Loading splash** (`authChecking === true`)
2. **AuthScreen** (no user)
3. **Main review UI** (user present)

### State

```ts
const [user, setUser] = useState<User | null>(null);
const [authChecking, setAuthChecking] = useState(true);

const [currentPicture, setCurrentPicture] = useState<PictureItem | null>(null);
const [queue, setQueue] = useState<PictureItem[]>([]);
const [loadingPicture, setLoadingPicture] = useState(false);

const [stats, setStats] = useState<AppStats | null>(null);
const [settings, setSettings] = useState<AppSettings>({
  cacheSize: 10,
  instanceUrl: 'https://panoramax.mapcomplete.org/api',
  autoFetchApi: true,
});

const [isOnline, setIsOnline] = useState(navigator.onLine);
const [offlinePendingCount, setOfflinePendingCount] = useState(getOfflineCount());

const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
const [isImportModalOpen, setIsImportModalOpen] = useState(false);
const [isHistoryOpen, setIsHistoryOpen] = useState(false);
const [isSettingsOpen, setIsSettingsOpen] = useState(false);
const [submittingReview, setSubmittingReview] = useState(false);
const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
const [isUndoLoading, setIsUndoLoading] = useState(false);
```

### Boot sequence

On mount:
1. `bootstrapSession()` from `services/session.ts` — calls `GET /api/auth/me`. If 200, stores the token, sets `user`. If 401, leaves `user = null`. Either way, `setAuthChecking(false)`.
2. Register online/offline listeners and a 2.5s polling interval that refreshes `isOnline` and `offlinePendingCount`. When online and `offlinePendingCount > 0`, call `syncOfflineQueue()` and refresh stats.
3. Capture `beforeinstallprompt` to populate the Install button.

When `user` becomes non-null:
- `loadInitialAppData()` runs: parallel-fetch stats, settings, and the queue (limit = `settings.cacheSize`). Sets `currentPicture = queue[0]`. Calls `cacheManager.prefetchPictures(queue, cacheSize)` to warm the cache.

### Actions

- **`handlePassOk()`** — `submitPictureReview(currentPicture.pictureId, 'ok')`. Push the returned review onto the undo stack (cap 3). Call `advanceToNextPicture()`.
- **`handleFlagErrorSubmit(reasonId, comment)`** — `submitPictureReview(pictureId, 'error', reasonId, comment)`. Close modal. Push undo. Advance.
- **`advanceToNextPicture()`** — Remove `currentPicture` from queue. If queue still has items, set `currentPicture = queue[0]` and prefetch. Else fetch a new batch from `/api/pictures/queue`. Refresh stats.
- **`handleUndoReview(item)`** — `undoPictureReview(item.id, item.pictureId)`. On success, remove from undo stack, prepend the restored picture to the queue, set `currentPicture`. Refresh stats.
- **`handleLogout()`** — call `logoutUser()`, clear user state. The page reloads, which triggers SSO again.

### Keyboard shortcuts (global, when no modal open and not typing in an input)

| Key                                | Action            |
|------------------------------------|-------------------|
| `Enter` or `O`                     | Pass (OK)         |
| `E`, `F`, or `Delete`              | Open Flag modal   |
| `ArrowRight`, `ArrowDown`, `ArrowLeft`, `ArrowUp`, `S`, or `Space` | Skip / advance |
| `Z`, `Ctrl+Z`, `Cmd+Z`, or `U`     | Undo last review (if undo stack non-empty) |

## `src/services/session.ts`

Tiny module:

```ts
let token: string | null = null;
const KEY = 'panoramax_session_token';

export function getToken(): string | null {
  if (token) return token;
  token = sessionStorage.getItem(KEY);
  return token;
}
export function setToken(t: string) {
  token = t;
  sessionStorage.setItem(KEY, t);
}
export function clearToken() {
  token = null;
  sessionStorage.removeItem(KEY);
}

export async function bootstrapSession(): Promise<User | null> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.token) setToken(data.token);
  return data.user;
}
```

Token lives in `sessionStorage` (cleared when tab closes) — single-user, low stakes, but avoids leaving a long-lived token in `localStorage`. The server's 30-day session is still valid; if the SPA loses its token it just calls `/api/auth/me` again (SSO cookie re-issues a new one).

## `src/services/api.ts`

All server calls. Every function is a thin `fetch` wrapper. Each call that requires auth sends `Authorization: Bearer ${getToken()}`. On 401, clear the token and throw `new AuthError()` so the caller can redirect to SSO.

Exports (these are the names the components import — do not change):

- `logoutUser(): Promise<void>`
- `fetchPictureQueue(limit = 10): Promise<{ queue: PictureItem[]; totalPending: number }>`
- `fetchNextPicture(): Promise<{ picture: PictureItem | null; queueExhausted: boolean }>`
- `importPictureIds(pictureIds: string[], instanceUrl?: string, onProgress?: (processed: number, total: number) => void): Promise<ImportResult>`
- `fetchPanoramaxApiPictures(instanceUrl?: string, fetchLimit = 20): Promise<{ success: boolean; added: number; duplicatesSkipped: number; totalInDatabase: number }>`
- `submitPictureReview(pictureId, status: ReviewStatus, errorReason?: string, comment?: string): Promise<{ success: boolean; review: ReviewRecord; picture: PictureItem }>`
- `undoPictureReview(reviewId?: string, pictureId?: string): Promise<{ success: boolean; removedReview: ReviewRecord; picture: PictureItem }>`
- `fetchReviewHistory(status?: string, search?: string): Promise<ReviewRecord[]>`
- `fetchAppStats(): Promise<AppStats>`
- `fetchAppSettings(): Promise<AppSettings>`
- `updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings>`
- `fetchDashboardPictures(params): Promise<{ pictures: PictureItem[]; totalCount: number; filteredCount: number }>`
- `togglePictureCheckoff(pictureIds: string[], checked: boolean): Promise<{ success: boolean; updatedCount: number }>`
- `deleteBatchPictures(pictureIds: string[]): Promise<{ success: boolean; removedCount: number; remainingPictures: number }>`
- `syncOfflineQueue(): Promise<{ syncedCount: number; failedCount: number }>`
- `getProxyImageUrl(url: string): string` — returns `/api/proxy-image?url=${encodeURIComponent(url)}` (used by ImageStage as fallback when direct fetch fails)

`importPictureIds` should chunk into batches of 30 and call `onProgress(processed, total)` after each batch so the modal can show a progress bar. The server's `/api/pictures/import` accepts the whole array in one call, but reporting progress per-chunk on the client side is fine — just don't fire 30 separate requests.

## `src/services/offlineQueue.ts`

LocalStorage-backed queue of reviews to submit when back online.

Keys:
- `panoramax_offline_reviews_queue` — `OfflineReview[]`
- `panoramax_cached_picture_queue` — last successful queue response (for offline display)
- `panoramax_cached_app_stats` — last stats

API:
- `saveOfflineReview(data: { pictureId, status, errorReason?, comment? }): OfflineReview` — replaces any existing queued review for the same `pictureId`
- `removeOfflineReview(id: string)`
- `getOfflineReviews(): OfflineReview[]`
- `getOfflineCount(): number`
- `clearOfflineReviews()`
- `cachePictureQueue(data)`, `getCachedPictureQueue()`
- `cacheStats(stats)`, `getCachedStats()`

`syncOfflineQueue()` (in `api.ts`) iterates the queue, POSTs each to `/api/reviews`, removes successfully-synced items, leaves failed ones. Returns `{ syncedCount, failedCount }`.

**Important behavior**: when offline, `submitPictureReview` should NOT throw — it should call `saveOfflineReview(...)` and return a synthetic success object so the UI advances normally. Detect offline via `!navigator.onLine` OR the fetch throwing. The offline pill in the header then shows the pending count and triggers `syncOfflineQueue()` on reconnect.

## `src/services/cacheManager.ts`

A singleton `LocalCacheManager` that uses the Cache API (`caches.open('panoramax-images-v1')`) to prefetch upcoming queue images. Tracks a `Set<string>` of cached URLs in memory.

API:
- `prefetchPictures(pictures: PictureItem[], maxCount = 10): Promise<number>` — fetches in batches of 8, with 50ms delays between batches when total > 25. Skips if `cellularSaverActive` is true.
- `isCached(url): boolean`
- `getCachedCount(): number`
- `clearCache(): Promise<void>`
- `setCellularSaver(active: boolean)`, `getCellularSaver(): boolean`

Fetch strategy per image:
1. Try direct `fetch(url, { mode: 'cors' })`. If ok, store in cache.
2. If that throws (network error, CORS), fall back to `/api/proxy-image?url=...` and cache that.

## `src/services/helpers.ts`

`buildPanoramaxUrls` and `cleanPictureId` (mirrors of the server-side helpers). And `isMockId(id)` — a regex check against a known list of placeholder IDs used in seed data (can be a no-op in the new app since we don't seed mock data, but keep the export for safety).

## Components

See `06-ui-spec.md` for full layout, colors, and interactions of each component. Brief roles here:

- `AuthScreen.tsx` — full-screen "log in via YunoHost" page. One link to `/yunohost/sso/?r=/`.
- `ImageStage.tsx` — the zoomable/pannable image viewport with overlay controls.
- `ReviewControls.tsx` — bottom toolbar with OK / Flag / Skip buttons.
- `ErrorModal.tsx` — modal for selecting reason + comment when flagging.
- `ImportModal.tsx` — modal with two tabs: paste/upload IDs, or fetch from Panoramax STAC API.
- `HistoryExplorer.tsx` — full-screen modal with two tabs: Picture Catalog Dashboard (filterable table), Audit Review Timeline (paginated).
- `SettingsModal.tsx` — modal for cache size, instance URL, cellular saver, and "flush cache" button.
- `UndoToast.tsx` — floating toast showing up to 3 recent reviews with an Undo button; auto-fades after 5s.

## What the frontend must NOT do

- Do not import `firebase/*` or `@google/genai`.
- Do not store the bearer token in `localStorage` (use `sessionStorage`). The session is refreshable via SSO.
- Do not implement its own password UI. The only "auth" UI is the AuthScreen telling the user to log in via YunoHost.
- Do not call Panoramax APIs directly from the browser except for image loading (which the service worker caches). The STAC search goes through `/api/pictures/fetch-panoramax` so the server can add to the DB.
- Do not add `motion.*` animations. Use Tailwind's `transition-*`, `animate-*`, and `duration-*` utilities.
- Do not add React Router. The app is a single screen with modals.
