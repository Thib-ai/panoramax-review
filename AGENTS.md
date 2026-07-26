# AGENTS.md

Single-repo full-stack TypeScript app for reviewing Panoramax street-level imagery. Vite + React frontend in `src/`, Express API server in `server.ts`, SQLite via `better-sqlite3`. Not a monorepo.

## Commands

- `npm run dev` — runs `tsx server.ts`. Starts Express on port 3000 with Vite in middleware mode (HMR). This is the normal dev loop; there is no separate frontend dev server.
- `npm run build` — `vite build` (frontend → `dist/`) **plus** `esbuild server.ts → dist/server.cjs` (CJS, externalized deps). Both halves are required for production.
- `npm start` — `node dist/server.cjs` (production server, serves built `dist/`).
- `npm run lint` — **`tsc --noEmit`**. This is typecheck-only; there is no ESLint/Prettier configured. Run this before claiming work is done.
- `npm run preview` — `vite preview` (rarely used; the dev server already covers preview).

There is **no test runner**. The only "tests" are the curl-based smoke checks in `.github/workflows/ci.yml` (auth → import → review → stats → export). To reproduce locally, see that workflow.

## Environment

- `PORT` (default 3000), `DATA_DIR` (default `./data`, gitignored — SQLite DB lives at `$DATA_DIR/panoramax.db`), `NODE_ENV`, `VITE_BASE_PATH` (sub-path installs; vite.config.ts rewrites `index.html` and `manifest.json` accordingly).
- SQLite runs in WAL mode; schema migrations execute on every server startup (`migrate()` in `server.ts`).
- Auth: in production, expects YunoHost SSO headers `ynh-user` or `remote-user`. In non-production **from localhost**, auto-logs in as `devuser` and issues a token returned via the `X-Issued-Token` response header — so `npm run dev` works with no auth setup. CI smoke tests run with `NODE_ENV=development` to exploit this shim.

## Architecture notes

- `server.ts` is the entire backend (~1050 lines): DB, auth, all `/api/*` routes, and the Vite/static-serving bootstrap in `startServer()`. Edits here touch everything.
- Frontend entry: `index.html` → `src/main.tsx` → `src/App.tsx`. Components in `src/components/`, services (api, session, cacheManager, offlineQueue, helpers) in `src/services/`.
- `src/services/api.ts` uses `import.meta.env.BASE_URL` to derive the API base, so sub-path installs work. Keep this pattern when adding API calls.
- `server.ts` imports types as `./src/types.js` (note the `.js` extension — ESM resolution quirk, the file is actually `.ts`). Match this when adding server-side type imports.
- Vite alias `@` → repo root (`vite.config.ts`). `tsconfig.json` has no path mapping for it, so prefer relative imports to avoid type errors under `tsc --noEmit`.
- `public/sw.js` is a service worker caching images and the app shell; changes to cached asset names need cache-version bumps there.
- `plan.md` and `review.md` are design/audit notes, not executable specs — trust code/config over them.

## Review & undo flow

- Submitting a review (`submitPictureReview` in `src/services/api.ts`, called from `handlePassOk` / `handleFlagErrorSubmit` in `src/App.tsx`) marks the reviewed picture as acted-on this session, records its `sdUrl` for later cache eviction (see Session-cache eviction below), and sets the single `UndoState` in `src/App.tsx`. `UndoState` carries the reviewed `PictureItem` snapshot plus a `previousUndo` link, so repeated undo presses walk back through the session's review history.
- Undo (`handleUndoReview` in `src/App.tsx`, triggered by the toast button or the `Z` / `U` / `Ctrl+Z` shortcut) calls `undoPictureReview`, restores the undone picture to `currentPicture`, pushes the displaced current picture back to the front of `queue`, and sets `undo` to `previousUndo` — so the user returns to where they were before advancing, and the undo button now targets the picture before that. The chain bottoms out at the session's first picture (never undoes past it). Undo state lives in memory only; a reload clears it (new session boundary).
- `src/components/UndoToast.tsx` renders a single fixed-position button that fades out ~5s after the most recent review; each new review resets the fade timer.

## Cache-first queue model

- The on-device cache is the primary source of truth for the displayed queue. `advanceToNextPicture` and `loadInitialAppData` in `src/App.tsx` pick the next picture from the in-memory `queue` first, then from the persistent `panoramax_cached_picture_queue` list in `localStorage` (`getCachedPictureQueue` / `mergeCachedPictureQueue` in `src/services/offlineQueue.ts`), skipping anything in `actedThisSessionRef` (reviews + skips both count). The server's `/api/pictures/queue` is a **background refill** used only when the cache runs dry (and, when online, to top the cache back up to `cacheSize`).
- This means the app keeps showing cached images offline even after the in-memory queue drains, instead of jumping to "Image not cached" placeholders. Reviews are stored locally via the existing offline-queue mechanism and synced when back online.

## Session-cache eviction

- On each review, the picture's `sdUrl` is appended to `panoramax_session_reviewed_urls` in `localStorage` (alongside a `panoramax_session_id` stamped on boot).
- On app boot (`enforceSessionBoundary` in `src/App.tsx`, called from `loadInitialAppData`): if the stored session id differs from a freshly generated one, the previously-reviewed URLs are evicted from the Cache API (`cacheManager.evictUrls` in `src/services/cacheManager.ts`), then the list is cleared and the new session id is written. Within a session, reviewed images stay cached (undo needs them); across a reload (new session), they're evicted.

## Settings cached-count badge

- `cacheManager.subscribe` in `src/services/cacheManager.ts` only pushes the count to a subscriber once the Cache API enumeration (`init`) has completed (tracked via the `initialized` flag), so the badge in `src/components/SettingsModal.tsx` no longer shows a stale 0 on first open after a refresh. `cacheManager.warmUp()` is called eagerly on app boot to make the count ready sooner.

## Release

Pushing to `main` triggers `.github/workflows/release.yml`: if a git tag `v{package.json.version}` does not already exist, it creates a GitHub release with generated notes. **Bumping `version` in `package.json` therefore publishes a release on the next push to main.**

## Style

- TypeScript strict mode. No formatter configured; follow existing style in the file you're editing.
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`); classes used directly in components.
- Don't add comments unless asked.
