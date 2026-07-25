# Review: panoramax-review (app)

Overall assessment: **strong implementation**. Lint passes, build succeeds, the smoke test (auth → import → review → undo → stats → export) works end-to-end. The architecture matches the spec: SQLite, YunoHost SSO auth, proper service worker.

Below are issues grouped by severity. Each has a specific fix request.

---

## CRITICAL — breaks core functionality

### C1. Keyboard "Skip" keys submit an OK review instead of skipping

**File:** `src/App.tsx:265-267`

The handler for `S`, arrow keys, and `Space` calls `handlePassOk()` instead of `advanceToNextPicture()`:

```ts
} else if ((key === 's' || key === 'S' || key === 'ArrowRight' || ... ) && !submittingReview) {
    e.preventDefault();
    handlePassOk();  // BUG: should be advanceToNextPicture()
}
```

This means pressing S, Space, or any arrow key submits an "OK" review instead of skipping. The user explicitly wants "the app needs to basically work fully offline" — and this bug makes every skip accidentally record a review.

**Fix:** Replace `handlePassOk()` with `advanceToNextPicture()` on that line.

### C2. Sub-path installs are broken (frontend side)

**File:** `src/services/api.ts:5`

The frontend uses absolute API paths:
```ts
const BASE = '';
```

When the app is installed at a sub-path (e.g. `/review`, which is the YunoHost package default), every API call hits `/api/...` instead of `/review/api/...` and 404s. (The matching nginx-side issue is documented in the YunoHost package review.)

**Fix:**
```ts
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
```
This makes `/api/...` become `/review/api/...` when built with `VITE_BASE_PATH=/review/`.

Also fix the proxy image fallback in `src/components/ImageStage.tsx:43`:
```ts
setDisplayUrl(`${import.meta.env.BASE_URL}api/proxy-image?url=${encodeURIComponent(picture?.sdUrl || '')}`);
```
(Or export `getProxyImageUrl` from api.ts and use that, since it would then use `BASE`.)

Note: the build step (handled in the YunoHost package scripts) must pass `VITE_BASE_PATH="$path/"` for this to take effect.

### C3. `fetch-panoramax` silently drops pictures when `feature.id` is empty

**File:** `server.ts:475-481`

```ts
const pictureId = (feature.id as string || '').toLowerCase();
if (!pictureId) {
    const sdAsset = assets.sd as Record<string, unknown> || {};
    const href = sdAsset.href as string || '';
    const extracted = cleanPictureId(href);
    if (!extracted) continue;
    // BUG: extracted is never assigned to pictureId
}
```

When a STAC feature has no `id` but has an `assets.sd.href`, the extracted ID is computed but never assigned back to `pictureId`. The code then falls through to `stmts.getPictureByPictureId.get(pictureId)` with `pictureId = ''`, which never matches, and inserts a picture with an empty ID.

**Fix:** Add `pictureId = extracted;` after the `if (!extracted) continue;` line.

### C4. Settings endpoint returns booleans as `0`/`1` instead of `true`/`false`

**File:** `server.ts:83-88`

SQLite's `JSON_OBJECT` stores booleans as integers:
```sql
INSERT OR IGNORE INTO settings (key, value) VALUES ('global', JSON_OBJECT(
    'cacheSize', 10, 'autoFetchApi', true, 'cellularSaverMode', false
));
```

Note: this was already fixed. The seed now uses a JSON string literal instead of `JSON_OBJECT()`:
```sql
INSERT OR IGNORE INTO settings (key, value) VALUES ('global', '{"cacheSize":10,"instances":[],"activeInstance":"","autoFetchApi":true,"cellularSaverMode":false}');
```

---

## IMPORTANT — degrades UX or correctness

### I1. `advanceToNextPicture` always fetches from the server, ignoring the local queue

**File:** `src/App.tsx:153-172`

```ts
const advanceToNextPicture = useCallback(async () => {
    setCurrentPicture(null);
    setLoadingPicture(true);
    try {
        const result = await fetchPictureQueue(settings.cacheSize);  // always fetches from server
        ...
```

The spec said: "If queue still has items, use them; else fetch a new batch." The current code always fetches from the server, which:
1. Breaks offline use (the user explicitly said "the app needs to basically work fully offline and just sync to the server side code").
2. Wastes network requests when the queue already has items.

Note: there's a `loadNext` function (lines 125-151) that does this correctly but is never called — it's dead code.

**Fix:** Replace `advanceToNextPicture` with logic that uses the local queue first. The simplest approach is to delete `advanceToNextPicture`, rename `loadNext` to `advanceToNextPicture`, and remove the dead code. Alternatively, rewrite `advanceToNextPicture` to use the local queue before falling back to a server fetch.

### I2. CSV export doesn't respect active filters

**File:** `src/components/HistoryExplorer.tsx:109-113`

```ts
const handleExportCsv = () => {
    const ids = Array.from(selectedIds);
    const format = ids.length > 0 ? `?format=csv&ids=${ids.join(',')}` : '?format=csv';
    window.open(`/api/export${format}`, '_blank');
};
```

Two problems:
1. The server's `/api/export` endpoint doesn't accept an `ids` parameter — it always exports ALL reviews. So "Export Selected" silently exports everything.
2. The export doesn't pass the active column filters (status, search, instance, reason, checkedOff), so "Export Full List" exports everything regardless of what's filtered on screen.

The user confirmed: "csv should respect filters (but not pagination obv)".

**Fix (both server and client):**

Server (`server.ts` `/api/export`): accept the same query params as `/api/dashboard/pictures` (status, search, instance, reason, checkedOff) and filter the pictures accordingly. For `format=csv`, export reviews for the filtered picture set. For `format=json` and `geojson`, also apply the filters. Add an optional `ids` param for selected-only export:

```ts
app.get('/api/export', wrap((req, res) => {
    if (!requireAuth(req, res)) return;
    const format = (req.query.format as string || 'json').toLowerCase();
    const ids = req.query.ids ? String(req.query.ids).split(',') : null;

    // Build the same filter logic as /api/dashboard/pictures
    let query = 'SELECT * FROM pictures WHERE 1=1';
    const params: unknown[] = [];
    if (ids) {
        const placeholders = ids.map(() => '?').join(',');
        query += ` AND (id IN (${placeholders}) OR LOWER(picture_id) IN (${placeholders}))`;
        params.push(...ids, ...ids.map((id: string) => id.toLowerCase()));
    }
    // ... apply status, search, instance, reason, checkedOff filters (same as dashboard) ...

    const pictures = sqlite.prepare(query).all(...params) as Row[];
    const pictureIds = pictures.map(p => p.picture_id);
    const placeholders = pictureIds.map(() => '?').join(',');
    const reviews = pictureIds.length > 0
        ? sqlite.prepare(`SELECT * FROM reviews WHERE picture_id IN (${placeholders}) ORDER BY reviewed_at DESC`).all(...pictureIds) as Row[]
        : [];

    // ... then format as csv/json/geojson using only these filtered pictures + reviews ...
}));
```

Client: pass filters and ids:
```ts
const handleExportCsv = () => {
    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (selectedIds.size > 0) {
        params.set('ids', Array.from(selectedIds).join(','));
    } else {
        // Pass active filters
        if (filters.status !== 'all') params.set('status', filters.status);
        if (filters.search) params.set('search', filters.search);
        if (filters.instance) params.set('instance', filters.instance);
        if (filters.reason) params.set('reason', filters.reason);
        if (filters.checkedOff !== 'all') params.set('checkedOff', filters.checkedOff);
    }
    window.open(`${import.meta.env.BASE_URL}api/export?${params.toString()}`, '_blank');
};
```

### I3. Dashboard tab label shows page size instead of total count

**File:** `src/components/HistoryExplorer.tsx:170, 180`

```tsx
Picture Catalog Dashboard ({pictures.length})    // shows page size (e.g. 25)
Audit Review Timeline ({reviews.length})          // shows all reviews (no pagination)
```

`pictures.length` is the current page's items (max `pageSize`), not the total filtered count. The spec said the label should show the total count.

**Fix:** Use `filteredCount` for the dashboard tab:
```tsx
Picture Catalog Dashboard ({filteredCount})
```

For the timeline tab: the current code loads ALL reviews without pagination. If there are thousands of reviews, this could be slow. Either:
- Add server-side pagination to `GET /api/reviews` (page, pageSize params) and show the total from a count response. Or:
- Keep loading all reviews (fine for a single-user app) but change the label to show `reviews.length` (which is already the total). This is currently correct — no fix needed for the timeline tab label.

---

## MINOR — cosmetic or nice-to-have

### M1. Dead code: `loadNext` function in App.tsx

**File:** `src/App.tsx:125-151`

The `loadNext` function is defined but never called. `advanceToNextPicture` is used instead. Either delete `loadNext` or use it to replace `advanceToNextPicture` (it has the correct "use local queue first" logic — see I1).

### M2. `clearOfflineReviews` imported but never called

**File:** `src/services/api.ts:2`

`clearOfflineReviews` is imported from `offlineQueue.ts` but never used. Not harmful, but dead imports clutter the code. Either remove the import or add a "clear all offline reviews" button somewhere (e.g. in Settings).

### M3. `HistoryExplorer` timeline tab has no pagination

**File:** `src/components/HistoryExplorer.tsx:384-426`

The dashboard tab has server-side pagination, but the timeline tab loads ALL reviews in one request with no pagination controls. For a single-user app this is probably fine (unlikely to have more than a few thousand reviews), but if the dataset grows, it could become slow. Consider adding the same pagination pattern as the dashboard tab.

---

## What's done well

- **Backend**: clean single-file server, proper SQLite migrations, WAL mode, prepared statements, transactions for batch operations, correct auth flow (bearer + Remote-User from localhost, dev shim gated by NODE_ENV).
- **Frontend services**: `session.ts`, `api.ts`, `offlineQueue.ts`, `cacheManager.ts` all match the spec. The offline review failover in `submitPictureReview` (synthetic success with `offline_*` id) and the `undoPictureReview` detection of `offline_*` ids are correctly implemented.
- **PWA**: manifest, service worker, icon generation, SW registration gated by production, install prompt capture — all correct.
- **UI components**: all 8 components exist with the right structure and Tailwind classes. The `ErrorModal` properly maps `COMMON_ERROR_REASONS` to lucide icons via `iconMap`.
- **CI**: the GitHub Actions workflow runs lint, build, and a real smoke test against the built server — exactly what the spec's acceptance checklist asked for.

---

# Multi-Instance Implementation Review

Reviewed the working-tree changes that implement `plan.md` (multi-instance Panoramax support). Lint (`tsc --noEmit`) passes. Below are issues found in the implementation, grouped by severity. None of the CRITICALs are blockers, but they should be fixed before merging.

---

## CRITICAL — correctness bugs in the new code

### C5. ~~`activeInstance` is not persisted when changed via the header dropdown~~ ✅ **FIXED**

`onChange` is now `async` and `await`s `updateAppSettings` before calling `loadInitialAppData`. The race condition is eliminated.

### C6. ~~ImportModal `defaultUrl` never updates when `activeInstance` changes~~ ✅ **FIXED**

Added a `useEffect` that syncs `selectedInstance`, `showCustomInstance`, `stacUrl`, and `customInstanceUrl` when `isOpen` flips to true, matching the same pattern SettingsModal already uses.

### C7. ~~Removing the active instance in SettingsModal leaves `activeInstance` pointing at a non-listed URL~~ ✅ **FIXED**

`handleSettingsSaved` in `App.tsx` now detects when `activeInstance` changed and calls `loadInitialAppData(s.activeInstance)` to reload the queue immediately.

---

## IMPORTANT — UX / correctness degradations

### I4. ~~SettingsModal "Add Instance" button disabled but Enter still fires~~ ✅ **FIXED**

The Enter handler now also checks `newInstanceUrl.trim()` before calling `addInstance()`, matching the button's `disabled` state.

**File:** `src/components/SettingsModal.tsx:166-167`

```tsx
onKeyDown={(e) => { if (e.key === 'Enter') addInstance(); }}
```

`addInstance` does `if (!url) return;` so it's safe, but the button shows `disabled={!newInstanceUrl.trim()}` while the input still responds to Enter. Minor inconsistency — pressing Enter on an empty input does nothing visible but also doesn't surface the validation message. Not a bug, but either also disable the Enter handler or let it show "Invalid URL format." for consistency.

### I5. ~~`PUT /api/settings` allows empty `instances` array with a non-empty `activeInstance`~~ ✅ **FIXED**

The server now sanitizes the merged settings: if `activeInstance` is not in `instances`, it falls back to `''`. No 400 error — just a silent fix-up.

### I6. ~~Header instance dropdown `value` can be a URL not in `instances`~~ ✅ **FIXED**

`value` now uses `settings.instances.includes(settings.activeInstance) ? settings.activeInstance : ''`.

### I7. ~~`countPendingByUser` doesn't respect the instance filter~~ ✅ **FIXED**

Added `countPendingByUserAndInstance` prepared statement, used in both `/api/pictures/queue` and `/api/pictures/next` when `?instance=` is provided.

### I8. ~~CI smoke test no longer asserts the seeded empty shape~~ ✅ **FIXED**

Now asserts `"instances":[]` and `"activeInstance":""` in the GET settings response.

### I9. ~~Smoke test doesn't verify per-instance filter~~ ✅ **FIXED**

Added three checks after import: `next?instance=<known>` returns a picture, `queue?instance=<known>` returns a queue, and `next?instance=<unknown>` returns `"picture":null`.

---

## MINOR — cosmetic / nice-to-have

### M4. ~~`ImportModal` "Target Instance" dropdown shows raw `https://` URLs~~ ✅ **FIXED**

Now uses `url.replace('https://', '')` for display, matching the header and HistoryExplorer.

### M5. `stacUrl` `onFocus` auto-fill is fragile

**File:** `src/components/ImportModal.tsx:282-284`

Still open. The `onFocus` handler only fires when `stacUrl` is empty. With the new `useEffect` syncing state on open (C6 fix), `stacUrl` is now initialized from `activeInstance`/`instances[0]` on each open, so the `onFocus` fallback is less likely to be needed. But the fragility remains in theory. Worth a follow-up: derive `stacUrl` directly from `instanceUrl` when the user switches to the STAC tab.

### M6. ~~`SettingsModal` doesn't show which instance is "active"~~ ✅ **FIXED**

An "Active" text badge now appears next to the active instance's URL in the instance list.

### M7. `review.md` has been updated to mark fixed items

The pre-existing sections (C1-C4, I1-I3, M1-M3) describe the codebase before multi-instance and remain accurate. The multi-instance review items C5-C7, I4-I9, M4, M6 have all been addressed in the working tree. Items still open: C1 (keyboard skip), C2 (sub-path installs), I1 (advanceToNextPicture always fetches), I2 (CSV export filters), I3 (dashboard label), M1 (dead code), M2 (unused import), M3 (timeline pagination), M5 (stacUrl fragility). These are pre-existing issues unrelated to the multi-instance feature.

---

## What's done well (multi-instance)

- **Types**: `AppSettings` correctly uses `instances: string[]` + `activeInstance: string`. `PictureItem.instanceUrl` was already present and is now the source of truth for per-picture instance.
- **Server `buildPanoramaxUrls`**: correctly made `instanceUrl` required (no fallback). Same change mirrored in `src/services/helpers.ts`.
- **Server endpoints**: `/api/pictures/queue` and `/api/pictures/next` correctly accept `?instance=` and filter via parameterized SQL (no injection). The dynamic SQL building is a bit verbose but correct.
- **Import/fetch-panoramax fallback chain**: `instanceUrl || settings.activeInstance || settings.instances[0]` with 400 on missing — exactly matches plan §3f/§3g.
- **Settings seed migration**: correctly seeds empty `instances` array and empty `activeInstance`. No mapcomplete anywhere in the seed.
- **First-run empty state**: amber banner in `App.tsx` nudging the user to Settings is a nice touch.
- **HistoryExplorer**: instance filter correctly upgraded from free-text input to dropdown populated from `knownInstances` prop.
- **CI smoke test**: correctly seeds an instance via PUT before import, and passes `instanceUrl` in the import body — exercises the new fallback chain.
- **No mapcomplete references remain in `src/` or `server.ts`** (verified via grep). The only remaining references are in `review.md`, `plan.md` (this file), and historical git log, which is expected.
