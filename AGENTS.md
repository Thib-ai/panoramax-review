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

- Submitting a review (`submitPictureReview` in `src/services/api.ts`, called from `handlePassOk` / `handleFlagErrorSubmit` in `src/App.tsx`) advances the queue and pushes an `UndoItem` onto `undoStack` (capped at 3, shown by `src/components/UndoToast.tsx`). The `UndoItem` carries the reviewed `PictureItem` snapshot so undo can restore it to the stage.
- Undo (`handleUndoReview` in `src/App.tsx`, triggered by the toast button or the `Z` / `U` / `Ctrl+Z` shortcut) calls `undoPictureReview`, removes the item from `undoStack`, restores the undone picture to `currentPicture`, and pushes the displaced current picture back to the front of `queue` — so the user returns to where they were before advancing.
- The ring buffer `recentIdsRef` in `src/App.tsx` (limit 200) is sent as `exclude` to `/api/pictures/queue` so refills don't re-show images we just saw (both skip and review count). Undo does **not** re-add the picture's ID to this set, since the picture is being shown again by user action, not re-served by the queue.

## Release

Pushing to `main` triggers `.github/workflows/release.yml`: if a git tag `v{package.json.version}` does not already exist, it creates a GitHub release with generated notes. **Bumping `version` in `package.json` therefore publishes a release on the next push to main.**

## Style

- TypeScript strict mode. No formatter configured; follow existing style in the file you're editing.
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`); classes used directly in components.
- Don't add comments unless asked.
