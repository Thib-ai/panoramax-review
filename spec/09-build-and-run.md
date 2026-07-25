# 09 — Build & Run

## Prerequisites

- **Node.js 20 LTS** (the YunoHost install script installs this; locally use `nvm`, `fnm`, or your distro's `nodejs` package).
- **npm** (bundled with Node) or **bun** (the original repo used Bun; either works for `npm ci` / `npm run build`).
- For `better-sqlite3` source builds: `python3`, `make`, `g++`.

## Environment variables

| Variable      | Required | Default              | Used by          |
|---------------|----------|----------------------|------------------|
| `PORT`        | no       | `3000`               | server           |
| `DATA_DIR`    | no       | `./data`             | server           |
| `NODE_ENV`    | no       | `development`        | server + Vite    |
| `VITE_BASE_PATH` | no   | `/`                  | vite build       |

No secrets. No API keys. No Firebase config.

## `package.json` (target)

```json
{
  "name": "panoramax-review",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs",
    "preview": "vite preview",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "better-sqlite3": "^11.3.0",
    "express": "^4.21.2",
    "lucide-react": "^0.546.0",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "vite": "^6.2.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "autoprefixer": "^10.4.21",
    "esbuild": "^0.25.0",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2"
  }
}
```

Dropped from the original: `firebase`, `firebase-admin`, `@google/genai`, `dotenv` (not needed — YunoHost/systemd injects env), `motion` (replaced with CSS transitions).

Added: `better-sqlite3` and `@types/better-sqlite3`.

## `tsconfig.json` (target)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node", "better-sqlite3"]
  },
  "include": ["src/**/*", "server.ts"]
}
```

## `vite.config.ts` (target)

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

## Development

```bash
# 1. Install deps
npm ci

# 2. Run the dev server (Vite middleware + Express on port 3000)
npm run dev
```

Open `http://localhost:3000`. Because dev mode bypasses YunoHost SSO, the server will see no `X-Remote-User` header and no `Authorization` header, so `/api/auth/me` returns 401.

For local development, the implementer should add a tiny dev-only shim: when `NODE_ENV !== 'production'`, if no auth header is present and the request is from localhost, treat it as user `devuser`. Put this in `getAuthUser()`:

```ts
if (process.env.NODE_ENV !== 'production' && !user && isLocal) {
  user = upsertUser('devuser');
  issuedToken = issueSession(user.id);
}
```

This is the only place the app deviates from the SSO-only rule, and it's gated by `NODE_ENV`. Document this clearly in `server.ts` with a comment.

Alternatively, the dev can manually set `X-Remote-User: devuser` in their browser (e.g. via a browser extension) and the prod code path will pick it up.

## Build

```bash
# Production build
npm run build
# Produces dist/ (SPA) and dist/server.cjs (Node backend, CJS, bundled)
```

## Run production locally

```bash
NODE_ENV=production PORT=3000 DATA_DIR=./data node dist/server.cjs
```

The server serves `dist/index.html` for any non-API path and `/api/*` for API calls. SQLite DB is created at `./data/panoramax.db`.

## Deploy via YunoHost

See `08-yunohost-package.md`. Once the package repo is ready:

```bash
# On your YunoHost box
sudo yunohost app install https://github.com/thibaultmol/panoramax-review_ynh
# Or from a local checkout
sudo yunohost app install /path/to/panoramax-review_ynh
```

The install script will ask for `domain` and `path` (defaults to `/panoramax`). After install, visit `https://<domain>/<path>/`, log in via YunoHost SSO when prompted, and the app starts empty.

## Upgrading

To deploy a new version of the app:

1. Tag the app repo: `git tag v1.0.1 && git push --tags`.
2. Update the YunoHost package repo's `manifest.toml` `version` and the `sources.main.url` + `sha256` to point at the new tarball.
3. On the YunoHost box: `sudo yunohost app upgrade panoramax-review -u https://github.com/thibaultmol/panoramax-review_ynh`

The upgrade script pulls the new source, rebuilds, and restarts the service. The SQLite DB is preserved (`--keep=data/`).

## Manual smoke test (after build, before deploy)

Run `node dist/server.cjs` locally and verify with `curl`:

```bash
# Auth bootstrap (dev shim auto-logs in as devuser)
curl -i http://localhost:3000/api/auth/me
# Expect: 200 with { token, user }

TOKEN=<token from above>

# Get settings
curl -s http://localhost:3000/api/settings

# Import a couple of test picture IDs (any Panoramax UUID works)
curl -s -X POST http://localhost:3000/api/pictures/import \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pictureIds":["5b29337b-9f93-4a69-89b2-3e28edcdb66b"]}'

# Get next picture
curl -s http://localhost:3000/api/pictures/next -H "Authorization: Bearer $TOKEN"

# Submit a review
curl -s -X POST http://localhost:3000/api/reviews \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pictureId":"5b29337b-9f93-4a69-89b2-3e28edcdb66b","status":"ok"}'

# Get stats
curl -s http://localhost:3000/api/stats -H "Authorization: Bearer $TOKEN"

# Export JSON
curl -s "http://localhost:3000/api/export?format=json" -H "Authorization: Bearer $TOKEN" | head -c 500
```

If all of these return sensible data, the backend is working. Then load `http://localhost:3000/` in a browser and click through the UI.

## Lint / typecheck

```bash
npm run lint
# Runs `tsc --noEmit`. Should exit 0.
```

## What not to do

- Don't add a separate `package-lock.json` if you commit `bun.lock` (or vice versa) — pick one and stick with it. YunoHost's `npm ci` requires `package-lock.json`, so commit that one. Delete `bun.lock`.
- Don't add `.env` files. Env comes from systemd.
- Don't add `dotenv` as a dependency.
- Don't add `nodemon` or `pm2` — the systemd unit handles process lifecycle.
- Don't commit `node_modules/`, `dist/`, or `data/`. The `.gitignore` should include all three.
