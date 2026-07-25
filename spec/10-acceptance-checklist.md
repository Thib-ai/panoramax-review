# 10 — Acceptance Checklist

A verifiable list of criteria for "the implementation is done". Each item should be checkable by either running a command, clicking through the UI, or inspecting the produced files.

## Repo 1: `panoramax-review`

### Project setup
- [ ] `package.json` does NOT contain `firebase`, `firebase-admin`, `@google/genai`, `dotenv`, or `motion`.
- [ ] `package.json` contains `better-sqlite3`, `express`, `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `lucide-react`.
- [ ] `package-lock.json` exists (not `bun.lock`).
- [ ] `.gitignore` excludes `node_modules/`, `dist/`, `data/`.
- [ ] No files named `firebase-*`, `firestore.rules`, `metadata.json`, `patch_*.js`, `fix-server.js`, `server_new.ts`, `test-*.ts` remain.
- [ ] `tsconfig.json` has `"strict": true` and `"noEmit": true`.
- [ ] `npm run lint` exits 0.

### Backend (`server.ts`)
- [ ] Single file at repo root.
- [ ] Imports only: `express`, `path`, `fs`, `crypto`, `better-sqlite3`, `vite` (dev only).
- [ ] Reads `PORT`, `DATA_DIR`, `NODE_ENV` from env. No other env vars.
- [ ] On boot: creates `DATA_DIR` if missing, opens SQLite at `$DATA_DIR/panoramax.db`, runs migrations (`CREATE TABLE IF NOT EXISTS`), seeds default settings row.
- [ ] SQLite uses WAL journal mode.
- [ ] All five tables (`users`, `sessions`, `pictures`, `reviews`, `settings`) exist with the columns and indexes specified in `02-data-model.md`.
- [ ] All 17 endpoints from `03-api.md` are implemented and match the documented request/response shapes.
- [ ] `getAuthUser` correctly: (a) tries bearer token first; (b) falls back to `X-Remote-User` header **only when `req.ip` is loopback**; (c) issues a session and stashes `_issuedToken` in that case.
- [ ] A response middleware adds `X-Issued-Token` header when set.
- [ ] Dev-only shim: when `NODE_ENV !== 'production'`, localhost requests without any auth are treated as `devuser`. (Marked with a clear comment.)
- [ ] `/api/proxy-image` does not check bearer auth (only nginx SSO gates it in prod).
- [ ] `/api/settings` GET is public (no auth required, used during bootstrap).
- [ ] All mutating endpoints (`POST`, `PUT`) commit synchronously via `better-sqlite3` transactions.
- [ ] Every route handler is wrapped in `try/catch` returning `500 { error: String(err) }` on unexpected exceptions. The process never crashes on a request error.
- [ ] The server serves `dist/` in production mode and uses Vite middleware in dev mode.
- [ ] `npm run dev` starts the server on `:3000` and serves the SPA with hot reload.
- [ ] `npm run build` produces `dist/index.html` + assets + `dist/server.cjs`.
- [ ] `NODE_ENV=production node dist/server.cjs` serves the built SPA and API from a single port.

### Frontend
- [ ] No imports of `firebase/*` anywhere in `src/`.
- [ ] No imports of `@google/genai` anywhere.
- [ ] `src/services/firebase.ts` does NOT exist.
- [ ] `src/services/session.ts` exists with `getToken`, `setToken`, `clearToken`, `bootstrapSession`.
- [ ] `src/services/api.ts` uses `fetch` exclusively. Every exported function name from `05-frontend.md` is present with the documented signature.
- [ ] All authed API calls send `Authorization: Bearer ${getToken()}`. On 401, the token is cleared and the user is redirected to `/yunohost/sso/?r=/` (or shown the AuthScreen).
- [ ] `submitPictureReview` falls back to `saveOfflineReview` when offline or on fetch failure, returning a synthetic success response with an `offline_*` id.
- [ ] `undoPictureReview` detects `offline_*` ids and removes them from the localStorage queue instead of calling the server.
- [ ] `syncOfflineQueue` iterates the queue, POSTs each, removes successes, leaves failures.
- [ ] `src/services/offlineQueue.ts` matches the API in `05-frontend.md`.
- [ ] `src/services/cacheManager.ts` prefetches via the Cache API, falls back to `/api/proxy-image` on CORS failure, respects the cellular saver flag.
- [ ] `src/components/AuthScreen.tsx` contains NO Google logo, NO Google sign-in button, NO Firebase imports. Has a single link to `/yunohost/sso/?r=/`.
- [ ] `src/components/ImageStage.tsx` supports mouse wheel zoom, mouse drag pan, touch pinch, touch pan, double-tap toggle, rotation, and zoom controls.
- [ ] `src/components/ReviewControls.tsx` has the three buttons (OK, Flag, Skip) with the documented keyboard hints.
- [ ] `src/components/ErrorModal.tsx` lists all 7 `COMMON_ERROR_REASONS`, closes on `Escape`.
- [ ] `src/components/ImportModal.tsx` has both tabs (file/paste, STAC fetch) with progress bar.
- [ ] `src/components/HistoryExplorer.tsx` has both tabs (Picture Catalog, Audit Timeline), all column filters, pagination, batch check-off, batch delete, CSV export, hover thumbnail preview.
- [ ] `src/components/SettingsModal.tsx` has cache size slider with presets, cellular saver toggle with cellular detection warning, instance URL input, "Flush Local Image Cache" button.
- [ ] `src/components/UndoToast.tsx` shows up to 3 toasts, auto-dismisses after 5s, fades in the last 40% of its lifetime.
- [ ] `src/App.tsx` wires up the boot sequence, keyboard shortcuts, online/offline detection, undo stack, install prompt.
- [ ] All UI matches the layout/colors/spacing in `06-ui-spec.md` to a reasonable degree (pixel-perfect is not required, but structure and color choices should match).

### PWA
- [ ] `public/manifest.json` exists with the documented fields and icons.
- [ ] `public/icon-192.png` and `public/icon-512.png` exist (generated from the SVG).
- [ ] `public/sw.js` exists with the install/activate/fetch handlers described in `07-pwa.md`.
- [ ] `index.html` has the documented `<meta>` tags.
- [ ] `src/main.tsx` registers the service worker only in production.
- [ ] Install button appears in the header only when `beforeinstallprompt` has fired.
- [ ] In Chrome dev tools → Application → Service Workers, the SW is registered and controlling the page after first production build load.
- [ ] In Chrome dev tools → Application → Cache Storage, the `panoramax-images-v1` cache populates after images are prefetched.

### Offline behavior
- [ ] Open the app in production mode.
- [ ] Go to the Network tab in dev tools → set to "Offline".
- [ ] Submit a review (OK or Flag). The UI advances to the next picture; the header shows an amber "Offline (1)" pill.
- [ ] Submit two more reviews. Pill shows "Offline (3)".
- [ ] Click Undo on the toast. One review is removed; pill shows "Offline (2)".
- [ ] Set Network back to "Online". The pill turns emerald "Syncing 2...", then disappears. Stats refresh and review counter increments.
- [ ] Refresh the page while offline. The SPA shell loads (service worker serves it). The image viewport shows cached images or the "Image not cached (Offline)" SVG placeholder.

## Repo 2: `panoramax-review_ynh`

- [ ] `manifest.toml` exists with the fields documented in `08-yunohost-package.md`.
- [ ] `scripts/install`, `remove`, `upgrade`, `backup`, `restore` all exist and are executable.
- [ ] `conf/nginx.conf` exists and sets `X-Remote-User $remote_user`.
- [ ] `conf/systemd.service` exists and sets `NODE_ENV=production`, `PORT`, `DATA_DIR`, and runs `node dist/server.cjs` as the $app user.
- [ ] `yunohost app install <path-to-repo>` succeeds on a fresh YunoHost 11+ test VM.
- [ ] After install, visiting the app URL redirects to YunoHost SSO login when not signed in.
- [ ] After signing in to YunoHost, the app loads, the user is automatically logged in (the username in the header matches the YunoHost username).
- [ ] `yunohost app upgrade panoramax-review -u <new-version-repo>` succeeds and preserves the data directory.
- [ ] `yunohost backup create --apps panoramax-review` then `yunohost app remove panoramax-review` then `yunohost backup restore <backup>` results in a working app with data intact.
- [ ] `yunohost app remove panoramax-review` cleans up: service stops, files removed, nginx config removed, SSO entries removed.

## End-to-end smoke test on YunoHost

- [ ] Open the app on desktop Chrome. Log in via YunoHost SSO. The header shows the YunoHost username.
- [ ] Import a real Panoramax picture ID via the Import modal (paste a UUID).
- [ ] The next picture loads. Zoom in/out, pan, rotate. Reset.
- [ ] Submit "OK". The undo toast appears, the next picture loads, the Rev counter in the header increments.
- [ ] Submit "Flag Issue" with reason "privacy" and a comment. The next picture loads; stats show 1 flagged.
- [ ] Open Dashboard. The flagged picture appears. Filter by status = "Flagged Error" → 1 row. Filter by "Passed OK" → 1 row.
- [ ] Hover over a Picture ID → thumbnail preview appears.
- [ ] Select a row, click "Check Off Selected". Status updates to "Resolved".
- [ ] Click "Export CSV Report (Full List ...)". A CSV file downloads.
- [ ] Open Settings. Move the cache slider to 50. Save. The next batch prefetches more images.
- [ ] Toggle "Cellular Data Saver" in the header. Background prefetching pauses.
- [ ] Open the app on a mobile browser (same URL). After SSO login, the same data is visible (review counts match). The viewport is responsive, buttons are touch-friendly.
- [ ] Add the app to home screen (PWA install). Open from home screen icon: it opens standalone, no browser chrome.
- [ ] With the PWA open, turn on airplane mode. Submit a few reviews — they queue. Turn airplane mode off — they sync.
- [ ] Logout via the header button. The page redirects to YunoHost SSO login.
