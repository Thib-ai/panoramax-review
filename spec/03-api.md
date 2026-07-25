# 03 — REST API

All endpoints are under `/api/*`. The server also serves the built SPA from `dist/` on any non-API path.

## Authentication model

There are two layers:

### Layer 1 — YunoHost SSO (external, nginx)
YunoHost's nginx config protects the entire app. Requests without a valid YunoHost LDAP session are redirected to `/yunohost/sso/?r=<original>` and never reach the Node backend. When authenticated, nginx injects `X-Remote-User: <username>` (only for proxied requests, which always originate from localhost).

### Layer 2 — In-app session bearer token (internal)
The Node backend trusts `X-Remote-User` **only when `req.ip === '127.0.0.1'` or `'::1'`**. When it sees a request with a valid `X-Remote-User` and either (a) no session token or (b) an invalid/expired one, it transparently issues a fresh session token for that user (upserting the user row) and includes it in the response body.

The SPA calls `GET /api/auth/me` once on load (with `credentials: 'same-origin'` so the YunoHost SSO cookie is sent). The response includes a `token` field. The SPA stores it (in-memory + `sessionStorage`) and attaches it as `Authorization: Bearer <token>` to all subsequent `/api/*` calls.

The bearer token is what authorizes requests — not the SSO cookie directly — because the SPA's `fetch` calls need a stateless auth header. The SSO cookie just lets the request reach the backend at all.

### Auth helper (server-side)

```ts
function getAuthUser(req): User | null {
  // First, try bearer token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const session = db.sessions.get(token);
    if (session && session.expires_at > Date.now()) {
      return db.users.get(session.user_id) ?? null;
    }
    if (session) db.sessions.delete(token); // expired
  }

  // No valid bearer. If request is from localhost and has X-Remote-User,
  // silently issue a session and stash the token for THIS response.
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const remoteUser = req.headers['x-remote-user'];
  if (isLocal && typeof remoteUser === 'string' && remoteUser.trim()) {
    const username = remoteUser.trim();
    const user = upsertUser(username);
    const token = issueSession(user.id);
    (req as any)._issuedToken = token; // attached to response in a small middleware
    return user;
  }

  return null;
}
```

A small middleware after each handler checks for `req._issuedToken` and, if present, adds `X-Issued-Token: <token>` to the response. The SPA reads this header (if present) as a fallback when the body doesn't include a `token` field — this handles non-`/api/auth/me` endpoints where the user arrived via SSO but has no bearer yet.

In practice, the SPA only hits an endpoint without a bearer during the initial `/api/auth/me` bootstrap. After that, all calls carry a bearer.

### Response: 401
Any endpoint that requires auth and gets `null` from `getAuthUser` returns `401` with `{ error: 'Unauthorized' }`. The SPA, on 401, clears the stored token and redirects to `/yunohost/sso/?r=/`.

---

## Endpoints

### `GET /api/auth/me`
**Auth:** automatic (SSO header) or bearer.

Returns the current user. If no bearer is present but `X-Remote-User` is valid and local, issues a new session.

**Response 200:**
```json
{
  "token": "abc123...hex...",
  "user": {
    "id": "usr_thibaultmol",
    "username": "thibaultmol",
    "role": "admin",
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

**Response 401:** `{ "error": "Unauthorized" }` (no SSO header and no valid bearer)

### `POST /api/auth/logout`
**Auth:** bearer (optional).

Invalidates the current bearer token (if present) in the `sessions` table. Returns `{ "success": true }`. The SPA then redirects to `/yunohost/sso/?action=logout` (or simply reloads, which will re-trigger SSO).

### `GET /api/pictures/queue?limit=N`
**Auth:** required.
Returns up to `N` pictures the current user has **not** reviewed, in randomized order. If all pictures have been reviewed by the user, returns random pictures from the full catalog. `N` defaults to `settings.cacheSize`.

**Response 200:**
```json
{
  "queue": [ PictureItem, PictureItem, ... ],
  "totalPending": 42,
  "totalPictures": 100,
  "cacheSize": 10
}
```

### `GET /api/pictures/next`
**Auth:** required.
Returns one random picture the current user hasn't reviewed. If none remain, returns a random picture from the full catalog with `queueExhausted: true`. If the database is empty, returns `444` with `{ "error": "No pictures in database. Import pictures to start review." }`.

**Response 200:**
```json
{
  "picture": PictureItem,
  "queueExhausted": false
}
```

### `POST /api/pictures/import`
**Auth:** required.
Body:
```json
{
  "pictureIds": ["uuid", "uuid", "https://.../pictures/uuid/sd.jpg", ...],
  "instanceUrl": "https://panoramax.mapcomplete.org/api"   // optional, defaults to settings.instanceUrl
}
```

Accepts an array of either:
- Raw Panoramax UUIDs (`5b29337b-9f93-4a69-89b2-3e28edcdb66b`)
- Full picture URLs (`https://panoramax.mapcomplete.org/api/pictures/.../sd.jpg`)

The server extracts the UUID via `cleanPictureId()`. Duplicates (case-insensitive on UUID) are skipped without error. For each new UUID, build `sd_url`, `hd_url`, `thumb_url` via `buildPanoramaxUrls()` (see `04-backend.md`).

**Response 200:**
```json
{
  "added": 8,
  "duplicatesSkipped": 2,
  "totalInDatabase": 50,
  "addedIds": ["uuid", "uuid", ...]
}
```

### `POST /api/pictures/fetch-panoramax`
**Auth:** required.
Body:
```json
{
  "instanceUrl": "https://panoramax.mapcomplete.org/api",  // optional
  "limit": 25                                              // optional, 1–100, default 20
}
```

Fetches `${instanceUrl}/search?limit=${limit}` from the Panoramax STAC API. The response is a GeoJSON FeatureCollection. For each feature:
- `picture_id` = `feature.id` (or extracted from `feature.assets.sd.href` if no id)
- `sd_url` = `feature.assets.sd.href` (or fallback `${instanceUrl}/pictures/<id>/sd.jpg`)
- `hd_url` = `feature.assets.hd.href` (or fallback `.../hd.jpg`)
- `thumb_url` = `feature.assets.thumb.href` (or fallback `.../thumb.jpg`)
- `lat` = `feature.geometry.coordinates[1]`, `lon` = `[0]` (if geometry is a Point)
- `date_captured` = `feature.properties.datetime` or `feature.properties.created`
- `location_name` = `Sequence <first 8 chars of properties['panoramax:sequence']>` or `Panoramax Photo <first 8 chars of id>`

Skip duplicates (case-insensitive UUID match against existing rows).

**Response 200:**
```json
{
  "success": true,
  "added": 18,
  "duplicatesSkipped": 7,
  "totalInDatabase": 50
}
```

**Response 500:** `{ "error": "Failed to query Panoramax API: <message>" }`

### `POST /api/reviews`
**Auth:** required.
Body:
```json
{
  "pictureId": "uuid",          // Panoramax UUID (or internal id; server matches either)
  "status": "ok" | "error",
  "errorReason": "privacy",      // required iff status === 'error'
  "comment": "optional text"     // optional, trimmed
}
```

Server behavior:
1. Find the picture by `picture_id` OR `id`. Return `404` if not found.
2. Insert a new `reviews` row.
3. Update the picture: `review_count += 1`, `last_reviewed_at = now`, `last_error_reason`, `last_comment`, `last_reviewer = <username>`, and `status` based on this review:
   - `ok` → `'reviewed_ok'`
   - `error` → `'flagged'` (even if it was previously `'resolved'`)
4. Commit.

**Response 200:**
```json
{
  "success": true,
  "review": ReviewRecord,
  "picture": PictureItem
}
```

### `POST /api/reviews/undo`
**Auth:** required.
Body:
```json
{ "reviewId": "rev_..." }     // OR
{ "pictureId": "uuid" }       // finds the most recent review for this picture
```

Server behavior:
1. Find the target review. Return `404` if not found.
2. Delete the review row.
3. Find its picture. Recompute `review_count = COUNT(reviews WHERE picture_id = ?)`.
4. If reviews remain:
   - `last_reviewed_at` = max remaining `reviewed_at`
   - `status`, `last_error_reason`, `last_comment`, `last_reviewer` = from the most recent remaining review
5. If no reviews remain:
   - `status = 'pending'`, clear `last_*` fields, `is_checked_off = 0`
6. Commit.

**Response 200:**
```json
{
  "success": true,
  "removedReview": ReviewRecord,
  "picture": PictureItem
}
```

### `GET /api/reviews?status=ok|error&search=...`
**Auth:** required.
Returns all reviews, sorted by `reviewed_at` DESC. Optional `status` filter and case-insensitive `search` across `picture_id`, `user_name`, `comment`, `error_reason`.

**Response 200:** `{ "reviews": [ ReviewRecord, ... ] }`

### `GET /api/stats`
**Auth:** required.

**Response 200:**
```json
{
  "totalPictures": 100,
  "reviewedOk": 45,
  "flaggedErrors": 12,
  "checkedOffCount": 8,
  "pendingQueue": 43,
  "totalReviews": 75,
  "userReviewCount": 75
}
```
`checkedOffCount` = pictures where `is_checked_off = 1` OR `status = 'resolved'`.
`flaggedErrors` = pictures where `status = 'flagged'` OR `status = 'resolved'`.
`userReviewCount` = `SELECT COUNT(*) FROM reviews WHERE user_id = ?` for the current user.

### `GET /api/settings`
**Auth:** not required (used during bootstrap). Returns the global settings row. If missing, returns defaults.

**Response 200:** `AppSettings`

### `PUT /api/settings`
**Auth:** required.
Body: partial `AppSettings` (any subset of `cacheSize`, `instanceUrl`, `autoFetchApi`, `cellularSaverMode`). Merge with existing row; persist as JSON in `settings.value`.

**Response 200:** the full updated `AppSettings`

### `GET /api/dashboard/pictures?status=&search=&instance=&reason=&checkedOff=`
**Auth:** required.
Returns all pictures, with optional filters applied server-side. Parameters:
- `status` — one of `all`, `pending`, `reviewed_ok`, `flagged`, `resolved`. `resolved` matches `is_checked_off = 1 OR status = 'resolved'`.
- `search` — case-insensitive substring across `picture_id`, `last_comment`, `last_reviewer`
- `instance` — case-insensitive substring on `instance_url`
- `reason` — case-insensitive substring on `last_error_reason`
- `checkedOff` — `all`, `checked` (`is_checked_off = 1`), `unchecked` (`is_checked_off = 0`)

The server pre-joins the last review info into each picture row (already stored as denormalized columns, so just project them).

**Response 200:**
```json
{
  "pictures": [ PictureItem, ... ],
  "totalCount": 100,
  "filteredCount": 42
}
```

### `POST /api/pictures/toggle-checkoff`
**Auth:** required.
Body:
```json
{
  "pictureIds": ["uuid", "uuid", ...],   // Panoramax UUID or internal id, mixed
  "checked": true                        // new state
}
```

For each matching picture (matched by `picture_id` OR `id`, case-insensitive):
- Set `is_checked_off = checked`.
- If `checked` and current `status = 'flagged'`, set `status = 'resolved'`.
- If `!checked` and current `status = 'resolved'`, set `status = 'flagged'`.

**Response 200:** `{ "success": true, "updatedCount": 3 }`

### `POST /api/pictures/delete-batch`
**Auth:** required.
Body: `{ "pictureIds": ["uuid", ...] }` (Panoramax UUID or internal id, mixed)

Deletes matching pictures. Also delete any `reviews` rows for those `picture_id`s (the dashboard's "delete" implies removing the catalog entry; review history can be retained or wiped — implementer's choice, but recommend deleting reviews too for tidiness).

**Response 200:**
```json
{
  "success": true,
  "removedCount": 3,
  "remainingPictures": 47
}
```

### `GET /api/export?format=json|csv|geojson`
**Auth:** required.
Exports all reviews and pictures.

- `format=json` (default): returns the full dataset as JSON:
  ```json
  {
    "exportedAt": "2026-...",
    "totalPictures": 100,
    "reviews": [ ReviewRecord, ... ],
    "pictures": [ PictureItem, ... ]
  }
  ```
  Sets `Content-Disposition: attachment; filename=panoramax_reviews_<epoch>.json`.
- `format=csv`: returns `Review ID,Picture ID,Status,Error Reason,Comment,Reviewer,Reviewed At` followed by one row per review. Properly escape `"` by doubling.
  Sets `Content-Type: text/csv` and `Content-Disposition: attachment; filename=panoramax_reviews_<epoch>.csv`.
- `format=geojson`: returns a `FeatureCollection` of all pictures, each with a Point geometry (if lat/lon present) and properties `{ pictureId, status, instanceUrl, sdUrl, reviewCount, reviews }`.

### `GET /api/proxy-image?url=<encoded-image-url>`
**Auth:** not required (called by `<img>` tags, which can't send bearer headers).

Important: this endpoint is **also gated by YunoHost SSO at the nginx layer**, so it's not actually public. The "no auth required" here just means the Node code doesn't check bearer tokens — nginx has already authenticated the user by the time the request reaches Node.

Server fetches the URL, streams the bytes back with the upstream `Content-Type` (or `image/jpeg` if missing) and `Cache-Control: public, max-age=86400`.

**Response 400:** if `url` is missing.
**Response upstream status:** if the upstream returns non-2xx, return that status.
**Response 500:** on fetch error.

This endpoint exists because some Panoramax instances don't send CORS headers; the SPA's `<img>` tag can load the proxy URL same-origin without CORS issues.
