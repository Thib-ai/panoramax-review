# 04 — Backend

The entire backend lives in **`server.ts`** at the repo root. It is a single Node/Express file (~500 lines target). It serves both the built SPA (`dist/`) and the JSON API (`/api/*`).

## Stack

- **Runtime:** Node.js 20 LTS.
- **Framework:** Express 4 (`express`).
- **Storage:** `better-sqlite3` (synchronous API — no `await` mess, no callback hell).
- **Build:** esbuild bundles `server.ts` to `dist/server.cjs` (CJS, platform=node, external `better-sqlite3` and `express`).
- **TypeScript:** strict mode. The same `tsconfig.json` covers frontend and backend.

## Environment variables

Read from process env (set by the systemd unit / YunoHost install script):

| Variable     | Required | Default                | Notes                                                            |
|--------------|----------|------------------------|------------------------------------------------------------------|
| `PORT`       | yes      | `3000`                 | TCP port to listen on. Must match nginx `proxy_pass`.            |
| `DATA_DIR`   | no       | `./data`               | Directory holding `panoramax.db`. Must be writable by the user.   |
| `NODE_ENV`   | no       | `development`          | `production` → serve `dist/` and skip Vite middleware.            |

No `GEMINI_API_KEY`, no Firebase config, no secrets beyond what YunoHost already manages.

## File layout

```ts
// server.ts — outline
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'panoramax.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// ── Migrations ──
function migrate() { /* CREATE TABLE IF NOT EXISTS ...; seed settings */ }
migrate();

// ── Typed row helpers ──
const stmts = {
  getUserById:    sqlite.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByName:  sqlite.prepare('SELECT * FROM users WHERE username = ?'),
  insertUser:     sqlite.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?)'),
  getSession:     sqlite.prepare('SELECT * FROM sessions WHERE token = ?'),
  deleteSession:  sqlite.prepare('DELETE FROM sessions WHERE token = ?'),
  insertSession:  sqlite.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  // ... pictures, reviews, settings prepared statements ...
};

// ── Helpers (see below) ──
function buildPanoramaxUrls(pictureId: string, instanceUrl?: string): { sdUrl, hdUrl, thumbUrl }
function cleanPictureId(input: string): string
function shuffleArray<T>(arr: T[]): T[]
function upsertUser(username: string): User
function issueSession(userId: string): string   // returns token
function getAuthUser(req): { user: User; issuedToken?: string } | null

// ── Express app ──
const app = express();
app.use(express.json({ limit: '10mb' }));

// Attach issued token to response if middleware set it
app.use((req, res, next) => {
  next();
  if ((req as any)._issuedToken) {
    res.setHeader('X-Issued-Token', (req as any)._issuedToken);
  }
});

// ── Routes (one app.METHOD per endpoint, in the order listed in 03-api.md) ──
//   GET  /api/auth/me
//   POST /api/auth/logout
//   GET  /api/pictures/queue
//   GET  /api/pictures/next
//   POST /api/pictures/import
//   POST /api/pictures/fetch-panoramax
//   POST /api/reviews
//   POST /api/reviews/undo
//   GET  /api/reviews
//   GET  /api/stats
//   GET  /api/settings
//   PUT  /api/settings
//   GET  /api/dashboard/pictures
//   POST /api/pictures/toggle-checkoff
//   POST /api/pictures/delete-batch
//   GET  /api/export
//   GET  /api/proxy-image

// ── SPA serving ──
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Panoramax Review Server on :${PORT}`));
}
startServer();
```

## Required helpers

### `buildPanoramaxUrls(pictureId, instanceUrl?)`

Given a Panoramax UUID and an instance base URL, return the three image URLs.

1. If `pictureId` starts with `http://` or `https://`, return all three URLs equal to it (it's already a direct URL).
2. Strip to hex: `const hex = pictureId.replace(/[^a-f0-9]/gi, '')`.
3. If `hex.length >= 32` (full UUID):
   - `p1 = hex[0:2]`, `p2 = hex[2:4]`, `p3 = hex[4:6]`, `p4 = hex[6:8]` (all lowercased)
   - `rest` = the second-through-fifth dash group of the UUID (e.g. for `5b29337b-9f93-4a69-89b2-3e28edcdb66b`, `rest = 9f93-4a69-89b2-3e28edcdb66b`)
   - `cdnBase = (instanceUrl or 'https://panoramax.mapcomplete.org').replace(/\/api\/?$/, '').replace(/\/$/, '')`
   - `hdUrl   = ${cdnBase}/permanent/${p1}/${p2}/${p3}/${p4}/${rest}.jpg`
   - `sdUrl   = ${cdnBase}/derivatives/${p1}/${p2}/${p3}/${p4}/${rest}/sd.jpg`
   - `thumbUrl= ${cdnBase}/derivatives/${p1}/${p2}/${p3}/${p4}/${rest}/thumb.jpg`
4. Otherwise (short UUID fallback): `${base}/pictures/${id}/sd.jpg` etc., where `base = (instanceUrl or '...api').replace(/\/$/, '')`.

This logic is shared between server and client (frontend uses it to display URLs when only an ID is known). Put it in `src/services/helpers.ts` and import on both sides (or duplicate — it's small).

### `cleanPictureId(input): string`
- Trim.
- If empty, return `''`.
- If `input` contains a UUID pattern (`/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i`), return the first match.
- Otherwise strip protocol + host, strip `/pictures/`, strip `/sd.jpg` suffix, strip whitespace and slashes.

### `shuffleArray<T>(arr): T[]`
Fisher-Yates on a copy.

### `upsertUser(username): User`
- Lowercase username.
- `SELECT * FROM users WHERE username = ?`. If found, return mapped.
- Otherwise insert with `id = 'usr_' + username.toLowerCase()`, `role = 'admin'`, `created_at = now`, and return.

### `issueSession(userId): string`
- `token = crypto.randomBytes(32).toString('hex')`
- `expires_at = Date.now() + 30 * 86400 * 1000`
- `INSERT INTO sessions ...`
- Return `token`.

### `getAuthUser(req)`
See `03-api.md` for the full algorithm. Returns `{ user, issuedToken? } | null`. Set `req._issuedToken = issuedToken` so the response middleware can add the `X-Issued-Token` header.

## Notes on prepared statements

`better-sqlite3` prepared statements are sync. Use them like:

```ts
const stmt = sqlite.prepare('SELECT * FROM pictures WHERE picture_id = ?');
const row = stmt.get(uuid);
```

For batch inserts/updates, use a transaction:

```ts
const insertMany = sqlite.transaction((items) => {
  for (const it of items) stmts.insertPicture.run(it);
});
insertMany(items);
```

## What the server must NOT do

- Do not use any `await` for SQLite operations — `better-sqlite3` is sync.
- Do not call any Google or Firebase SDK.
- Do not write to `process.env` or expect it to change at runtime.
- Do not log secrets. Log only startup info and errors with stack traces.
- Do not implement multi-user role checks — there is one user.
- Do not implement password hashing — auth is YunoHost's job.
- Do not add CORS headers. Same-origin only. nginx handles cross-origin if needed.
- Do not add rate limiting. Single user behind SSO.

## Robustness

- Wrap each route handler body in a `try/catch` and return `500` with `{ error: String(err) }` on unexpected exceptions. Never crash the process on a request error.
- `app.use(express.json({ limit: '10mb' }))` — the import endpoint can take large arrays.
- All date strings are ISO 8601 UTC (`new Date().toISOString()`).
- All `picture_id` comparisons are case-insensitive (store lowercased, query with `LOWER()`).
