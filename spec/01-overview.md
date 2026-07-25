# 01 — Overview

## What the app does

Panoramax Image Review is a tool for one person (the operator) to manually review street-level imagery served by [Panoramax](https://panoramax.fr/) instances. The operator imports a batch of Panoramax picture IDs (or fetches them live from a Panoramax STAC API), and the app presents them one at a time in a zoomable, pannable viewport. For each picture the operator makes a binary decision:

- **OK** — the image passes review.
- **Flag Issue** — the image has a defect; the operator picks a reason and optional comment.
- **Skip** — defer review, advance to the next picture without recording anything.

Each OK or Flag decision is persisted as a review record on the server, along with the picture's updated aggregated status (`pending` → `reviewed_ok` or `flagged`). The operator can undo the most recent 3 reviews via a toast that fades after 5 seconds.

A separate **Dashboard** view shows all pictures with filters, pagination, hover thumbnail previews, batch check-off (mark flagged items as "resolved"), batch delete, and CSV export of the filtered set. An **Audit Timeline** view lists every review record chronologically with pagination.

The operator can also configure:
- The default Panoramax instance URL (so picture IDs resolve to a specific server).
- The size of the client-side image prefetch cache (5–500 images).
- A "Cellular Data Saver" toggle that pauses background prefetching on mobile networks.

## Users

Exactly one user. The user is whoever is signed into the YunoHost instance the app is installed on. The app trusts YunoHost's `Remote-User` header and auto-creates / auto-logs-in that user on first request. There is no signup, no password screen, no roles UI. If the YunoHost user is `thibaultmol`, the app is logged in as `thibaultmol`.

If the app is accessed without a valid YunoHost session, the app shows a single screen telling the user to log in via YunoHost, with a link to `/yunohost/sso/?r=/`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser (PWA)                        │
│  React 19 SPA · Vite · Tailwind v4 · Service Worker          │
│  - Reads /api/auth/me on load → gets bearer session token    │
│  - Calls /api/* with Authorization: Bearer <token>           │
│  - Caches images in Cache API (panoramax-images-v1)          │
│  - Queues reviews in localStorage when offline               │
└─────────────────────────────────────────────────────────────┘
                          │  HTTPS (same origin)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    YunoHost nginx (SSO)                      │
│  - Terminates TLS, enforces auth_request to LDAP             │
│  - Sets $remote_user, forwards as X-Remote-User header       │
│  - Only reachable from localhost on the backend port         │
└─────────────────────────────────────────────────────────────┘
                          │  http://127.0.0.1:PORT (localhost only)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Node/Express backend (systemd)                  │
│  - Serves dist/ (built SPA) on /                             │
│  - JSON API on /api/*                                        │
│  - Auth: trusts X-Remote-User when req.ip === 127.0.0.1,     │
│          issues/refreshes a 30-day session token             │
│  - Image proxy on /api/proxy-image?url=... (CORS bypass)     │
│  - SQLite at /var/www/panoramax-review/data/panoramax.db     │
└─────────────────────────────────────────────────────────────┘
                          │  HTTPS (outbound)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Panoramax instance (e.g. mapcomplete)           │
│  - /api/search → STAC FeatureCollection                      │
│  - /permanent/<...>/<id>.jpg → full-res image                │
│  - /derivatives/<...>/<id>/sd.jpg → standard def             │
│  - /derivatives/<...>/<id>/thumb.jpg → thumbnail             │
└─────────────────────────────────────────────────────────────┘
```

## Repo layout (two repos)

### Repo 1: the app (this repo, rewritten)
```
panoramax-review/
├── index.html              # Vite entry
├── public/
│   ├── favicon.svg
│   ├── manifest.json
│   └── sw.js               # Service worker for image cache + offline API fallback
├── src/
│   ├── main.tsx            # React root + SW registration
│   ├── index.css           # @import "tailwindcss";
│   ├── App.tsx             # Top-level state machine
│   ├── types.ts            # All shared TS types and constants
│   ├── services/
│   │   ├── api.ts          # All server calls (REST)
│   │   ├── session.ts      # Bearer token store + bootstrapSession()
│   │   ├── helpers.ts      # buildPanoramaxUrls, cleanPictureId, isMockId
│   │   ├── cacheManager.ts # Client-side image prefetch cache (Cache API)
│   │   └── offlineQueue.ts # localStorage offline review queue
│   └── components/
│       ├── AuthScreen.tsx
│       ├── ImageStage.tsx
│       ├── ReviewControls.tsx
│       ├── ErrorModal.tsx
│       ├── ImportModal.tsx
│       ├── HistoryExplorer.tsx
│       ├── SettingsModal.tsx
│       └── UndoToast.tsx
├── server.ts               # The entire backend, one file
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Repo 2: the YunoHost package (separate repo, see `08-yunohost-package.md`)
```
panoramax-review_ynh/
├── manifest.toml
├── scripts/
│   ├── install
│   ├── remove
│   ├── upgrade
│   ├── backup
│   └── restore
└── conf/
    ├── nginx.conf
    └── systemd.service
```

## Key constraints

- **No Firebase.** No `firebase` or `firebase-admin` in `package.json`. No Firestore rules file.
- **No Gemini.** No `@google/genai`. The previous version declared it but never used it — drop entirely.
- **No external cloud quotas.** The only outbound calls are to the Panoramax instance (operator chooses the URL) and to the YunoHost LDAP for auth (handled by YunoHost, not the app).
- **Single user.** The `users` table will only ever have one row per YunoHost username that logs in. No password hashes anywhere in the new app.
- **One process.** Backend is a single Node process running under systemd. No workers, no queues, no Redis.
- **One file of persistent state.** `data/panoramax.db`. Backups copy this file.
- **Mobile-first.** The review viewport is the primary screen and must work well on phones in portrait. Modals are scrollable. All touch interactions work (pinch, drag, double-tap).
- **Offline-capable PWA.** Service worker caches images and the SPA shell. Reviews can be queued locally and synced when back online.
- **No analytics, no telemetry.** Don't add anything that phones home.
