# Plan: Multi-Instance Panoramax Support

## Goal

Make the app instance-agnostic. Users configure which Panoramax instances to use in the web UI. Pictures, imports, review queues, and the dashboard all work per-instance. Remove all hardcoded references to `mapcomplete.org`.

---

## 1. Types (`src/types.ts`)

**`AppSettings`** — replace `instanceUrl: string` with `instances: string[]`:

```ts
export interface AppSettings {
  cacheSize: number;
  instances: string[];          // was instanceUrl: string
  activeInstance: string;       // which instance the user is currently reviewing for
  autoFetchApi: boolean;
  cellularSaverMode?: boolean;
}
```

- `activeInstance` is the instance the user selected in the review screen dropdown. Stored in settings so it persists.
- If `instances` is empty, the review screen shows a prompt to add an instance in Settings.
- The server-side `AppSettings` interface (currently only in `src/types.ts`, but also the shape returned by `readSettings()` and `PUT /api/settings`) must match.

---

## 2. Setter/Helper: `buildPanoramaxUrls`

**Both copies** — `server.ts:163-185` and `src/services/helpers.ts:1-22` — have the same change:

```ts
function buildPanoramaxUrls(pictureId: string, instanceUrl: string): { ... }
```

Remove the optional `instanceUrl?` and the `|| 'https://panoramax.mapcomplete.org'` fallback. The caller always passes an instance URL (stored in each picture's `instance_url` column). If somehow no URL is provided, throw/log instead of silently defaulting to mapcomplete.

---

## 3. Server (`server.ts`)

### 3a. Settings seed migration (line 83)

Replace:
```sql
INSERT OR IGNORE INTO settings (key, value) VALUES ('global', '{"cacheSize":10,"instanceUrl":"https://panoramax.mapcomplete.org/api","autoFetchApi":true,"cellularSaverMode":false}');
```
With:
```sql
INSERT OR IGNORE INTO settings (key, value) VALUES ('global', '{"cacheSize":10,"instances":[],"activeInstance":"","autoFetchApi":true,"cellularSaverMode":false}');
```

### 3b. `readSettings()` fallback (line 285-291)

Replace the hardcoded default object to match the new shape (empty `instances` array, no mapcomplete):

```ts
function readSettings(): AppSettings {
  const row = stmts.getSettings.get('global') as Row | undefined;
  if (!row) {
    return { cacheSize: 10, instances: [], activeInstance: '', autoFetchApi: true, cellularSaverMode: false };
  }
  return JSON.parse(row.value as string);
}
```

### 3c. `buildPanoramaxUrls` on server (line 163-185)

- Remove the default fallback on line 168 (`|| 'https://panoramax.mapcomplete.org'`).
- Remove the default fallback on line 179 (`|| 'https://panoramax.mapcomplete.org/api'`).
- Make `instanceUrl` a required parameter (already is at call sites).

### 3d. GET `/api/pictures/queue` — accept optional `instance` query param

Add an optional `instance` query parameter. When provided, filter the queue to only pictures from that instance:

```sql
-- In the WHERE clause for both pending and exhausted branches:
... AND instance_url = ?
```

### 3e. GET `/api/pictures/next` — accept optional `instance` query param

Same pattern — filter to a specific instance if `?instance=` is passed.

### 3f. POST `/api/pictures/import` (line 386)

The endpoint currently falls back to `settings.instanceUrl` when `instanceUrl` is missing from the body (line 395):

```ts
const baseUrl = instanceUrl || settings.instanceUrl;
```

Since `settings.instanceUrl` is being removed, this fallback must change. New behaviour:

```ts
const baseUrl = instanceUrl || settings.activeInstance || settings.instances[0];
if (!baseUrl) {
  res.status(400).json({ error: 'instanceUrl is required (no instance configured in settings)' });
  return;
}
```

Also strip trailing slash from `baseUrl` before storing/building URLs (the `buildPanoramaxUrls` helper already does this, but the stored `instance_url` should be normalized too).

### 3g. POST `/api/pictures/fetch-panoramax` (line 427)

Same situation — line 431 falls back to `settings.instanceUrl`:

```ts
const instanceUrl = (req.body?.instanceUrl as string || settings.instanceUrl).replace(/\/$/, '');
```

Replace with the same fallback chain (`req.body.instanceUrl || settings.activeInstance || settings.instances[0]`) and reject with a 400 if no instance is available.

### 3h. PUT `/api/settings` (line 642)

The merged object needs to accept `instances` (array of strings) and `activeInstance` (string). No special validation needed beyond the existing pattern.

### 3i. GET `/api/dashboard/pictures` (line 653)

Already has an `instance` filter param that does a `LIKE` on `instance_url`. This is fine — the dashboard already supports filtering by instance.

### 3j. GET `/api/export` (line 761)

Also already has an `instance` filter param. Good.

### 3k. Stats (`/api/stats`)

Optionally add per-instance breakdown to the stats response. The frontend Stats overview in the dashboard header (HistoryExplorer) currently shows totals across all instances. This could be extended later but is not required for the MVP.

---

## 4. Frontend API (`src/services/api.ts`)

### 4a. `fetchPictureQueue(limit, instance?)` (line 39)

Add optional `instance` param, pass as `&instance=` query string. The frontend passes `settings.activeInstance` when the user has selected a specific instance.

### 4b. `fetchNextPicture(instance?)` (line 43)

Same — add optional `instance` query param.

### 4c. `fetchAppSettings`, `updateAppSettings` (lines 183, 187)

Types change automatically via `AppSettings`. No code change needed unless the update function needs to merge `instances` specially (it doesn't — the server does `{ ...current, ...update }`).

---

## 5. App State (`src/App.tsx`)

### 5a. Default settings (line 29-34)

Replace:
```ts
const [settings, setSettings] = useState<AppSettings>({
  cacheSize: 10,
  instanceUrl: 'https://panoramax.mapcomplete.org/api',
  autoFetchApi: true,
  cellularSaverMode: false,
});
```
With:
```ts
const [settings, setSettings] = useState<AppSettings>({
  cacheSize: 10,
  instances: [],
  activeInstance: '',
  autoFetchApi: true,
  cellularSaverMode: false,
});
```

### 5b. Pass `activeInstance` to queue/next fetches

In `loadInitialAppData` (line 99), pass `settings.activeInstance` to `fetchPictureQueue` when it's non-empty.

In `advanceToNextPicture` (line 125), pass `settings.activeInstance` to `fetchPictureQueue` when it's non-empty.

### 5c. Instance selector UI in header

Add a compact dropdown in the header (next to the stats) showing:
- "All Instances" (value `''`)
- Each instance from `settings.instances`

When the user selects a different instance:
1. Set `settings.activeInstance` to the new value
2. Call `updateAppSettings({ activeInstance: newValue })` to persist
3. Reload the queue to fetch pictures from the selected instance

### 5d. Pass `defaultInstanceUrl` → `instances` to modals

- `ImportModal` currently receives `defaultInstanceUrl={settings.instanceUrl}`. Change to pass `instances={settings.instances}` and `activeInstance={settings.activeInstance}` so the import modal lets the user pick from known instances (or type a custom one).
- `SettingsModal` receives `settings` — already has the full settings object, so no prop change needed.

### 5e. Handle empty instances first-run state

When `settings.instances` is empty and the user opens the app, show a friendly prompt/modal nudging them to add their first Panoramax instance via Settings.

---

## 6. SettingsModal (`src/components/SettingsModal.tsx`)

**Major refactor**: replace the single "Default Panoramax Instance URL" text field with an instance list manager.

**New UI layout:**

1. **"Panoramax Instances" section** (replaces the single URL field):
   - List of known instances, each showing:
     - Instance URL
     - A "Remove" (×) button
     - A "Set Active" / checkmark indicator if this is the `activeInstance`
   - An "Add Instance" row: text input + "Add" button
   - A note: "Pictures are associated with the instance they were imported from."

2. **Cache settings** (unchanged — cache size slider, data saver toggle)

3. **Cache flush** (unchanged)

**State management in the modal:**
- Local copy of `instances` array, initialized from `settings.instances`
- `activeInstance` local copy
- On save: merge `instances` and `activeInstance` into settings

**Validation:**
- Reject duplicate instance URLs
- Validate URL format (must be a URL)
- Strip trailing slashes

---

## 7. ImportModal (`src/components/ImportModal.tsx`)

### 7a. Props change

Replace:
```ts
defaultInstanceUrl: string;
```
With:
```ts
instances: string[];
activeInstance: string;
```

### 7b. Instance selector in the modal

- Add a "Target Instance" dropdown/field at the top of the import modal (outside the text/STAC tabs, since both tabs need it):
  - Pre-populated with `instances`
  - "Custom..." option that reveals a text input for typing a URL not in the list
  - Default selection: `activeInstance` (or first in list if none active)

- When importing via text/file paste: use the selected instance URL as `instanceUrl` in `importPictureIds()` call.

- When importing via STAC sync: use the selected instance URL as the pre-filled URL in the STAC URL field (user can still edit it).

### 7c. Remove mapcomplete placeholder in textarea (line 185)

Change placeholder to not mention `mapcomplete.org`:
```
`5b29337b-9f93-4a69-89b2-3e28edcdb66b\nhttps://<instance>/api/pictures/.../sd.jpg`
```

---

## 8. HistoryExplorer (`src/components/HistoryExplorer.tsx`)

### 8a. Enhance instance filter

The current instance filter is a free-text input (line 295-297). Replace it with a dropdown populated from the known instances + "All" option. This requires the component to receive the list of known instances (via a new prop or by fetching settings).

Option A: Add a `knownInstances: string[]` prop.
Option B: Fetch settings inside the component.

Option A is simpler. Add prop:
```ts
interface HistoryExplorerProps {
  isOpen: boolean;
  onClose: () => void;
  stats: AppStats | null;
  knownInstances: string[];
}
```

Then in `App.tsx`, pass `settings.instances` to `<HistoryExplorer>`.

Replace the text input with:
```tsx
<select value={filters.instance} onChange={(e) => setFilters({ ...filters, instance: e.target.value })}>
  <option value="">All Instances</option>
  {knownInstances.map((url) => (
    <option key={url} value={url}>{url.replace('https://', '')}</option>
  ))}
</select>
```

---

## 9. ImageStage (`src/components/ImageStage.tsx`)

No changes needed. It already uses `picture.sdUrl` directly, which is stored per-picture at import time. The proxy fallback uses `getProxyImageUrl()` which is base-URL aware. Each picture correctly shows from its own instance.

---

## 10. Session (`src/services/session.ts`)

No changes needed (auth is instance-agnostic).

---

## 11. OfflineQueue (`src/services/offlineQueue.ts`)

No changes needed (offline queue stores reviews by pictureId, which is unique across instances).

---

## 12. CacheManager (`src/services/cacheManager.ts`)

No changes needed (caches by URL, which includes the instance hostname).

---

## 13. review.md references

The file `review.md` mentions `mapcomplete` in its discussion of C4 (settings JSON seed). Since the seed is being changed to empty `instances`, that issue becomes moot. The review.md can be left as-is (it's a historical audit) or patched to note the fix.

(Note: a `spec/` folder existed in an earlier revision of this repo but has since been deleted from the working tree — see `git status`. Do not add references to `spec/*.md` files; they are not part of the repo.)

---

## Summary of files to change

| File | Change |
|------|--------|
| `src/types.ts` | `AppSettings.instances[]` + `activeInstance` replace `instanceUrl` |
| `server.ts` | Seed, readSettings default, buildPanoramaxUrls defaults, queue/next accept `instance` param |
| `src/services/helpers.ts` | buildPanoramaxUrls: remove fallback, make instanceUrl required |
| `src/App.tsx` | Default settings shape, pass activeInstance to queue fetches, add instance selector in header, pass instance list to modals |
| `src/services/api.ts` | `fetchPictureQueue` + `fetchNextPicture` accept optional `instance` param |
| `src/components/SettingsModal.tsx` | Instance list manager UI replaces single URL field |
| `src/components/ImportModal.tsx` | Instance picker, remove mapcomplete placeholder |
| `src/components/HistoryExplorer.tsx` | Instance filter text input → dropdown, receive `knownInstances` prop |

## Migration order

1. **Types first** — `src/types.ts` so everything compiles after
2. **Server** — remove defaults, add instance filtering to endpoints, fix import/fetch-panoramax fallbacks (§3f, §3g)
3. **Helpers** — remove fallbacks
4. **API client** — add instance params
5. **SettingsModal** — instance list manager
6. **ImportModal** — instance picker
7. **App.tsx** — wire everything together, add instance selector in header
8. **HistoryExplorer** — instance dropdown
9. **Smoke test** — update `.github/workflows/ci.yml` (see §15)

---

## 15. CI smoke test (`.github/workflows/ci.yml`)

The smoke test currently relies on the mapcomplete default being present. Three concrete fixes:

### 15a. Settings check (line 47)

```bash
curl -s http://localhost:3000/api/settings | grep -q 'cacheSize' || { echo "FAIL: settings"; exit 1; }
```

Change `grep -q 'cacheSize'` to `grep -q '"instances"'` to assert the new settings shape is seeded. Optionally also assert `"activeInstance"` is present.

### 15b. Import call (line 50-52)

```bash
curl -s -X POST http://localhost:3000/api/pictures/import \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pictureIds":["5b29337b-9f93-4a69-89b2-3edcdb66b"]}' | grep -q '"added":1' || { echo "FAIL: import"; exit 1; }
```

Now that `instanceUrl` is no longer defaulted to mapcomplete, the import call must pass one explicitly, otherwise it will 400 (per §3f). Add an `instanceUrl` field to the JSON body. Use a real, publicly reachable Panoramax instance URL so the subsequent `next`/review/export steps still work against a picture that resolves to real URLs (or use a throwaway host — the proxy/CDN URLs aren't hit during the smoke test, only the DB record matters):

```bash
curl -s -X POST http://localhost:3000/api/pictures/import \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pictureIds":["5b29337b-9f93-4a69-89b2-3edcdb66b"],"instanceUrl":"https://panoramax.ign.fr/api"}' | grep -q '"added":1' || { echo "FAIL: import"; exit 1; }
```

(If you want the smoke test to be fully instance-agnostic and not depend on any real Panoramax host, instead seed a known instance via a `PUT /api/settings` call with `instances: ["https://example.test/api"]` and `activeInstance: "https://example.test/api"` before the import, then pass that same URL as `instanceUrl` in the import body. The picture URLs it builds won't resolve, but the smoke test never fetches them.)

### 15c. Optionally seed instances before the import

For a more realistic end-to-end test, insert a step before the import that PUTs a known instance list to settings:

```bash
curl -s -X PUT http://localhost:3000/api/settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"instances":["https://panoramax.ign.fr/api"],"activeInstance":"https://panoramax.ign.fr/api"}' \
  | grep -q '"instances"' || { echo "FAIL: settings put"; exit 1; }
```

Then the import call can omit `instanceUrl` and rely on the `activeInstance` fallback (verifying the §3f fallback chain works).
