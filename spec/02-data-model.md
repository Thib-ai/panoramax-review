# 02 — Data Model

## SQLite schema

Single database file at `data/panoramax.db`. Created on first boot via `CREATE TABLE IF NOT EXISTS` migrations. All tables use the schema below.

### `users`
| column        | type     | notes                                            |
|---------------|----------|--------------------------------------------------|
| id            | TEXT PK  | Stable ID, e.g. `usr_<username>`                 |
| username      | TEXT U   | YunoHost username, from `X-Remote-User` header   |
| role          | TEXT     | Always `'admin'` for the single user              |
| created_at    | TEXT     | ISO 8601 timestamp of first login                |

There is no password hash column — auth is delegated to YunoHost.

### `sessions`
| column     | type     | notes                                                |
|------------|----------|------------------------------------------------------|
| token      | TEXT PK  | 32-byte random hex string                            |
| user_id    | TEXT     | FK → `users.id` (no enforced FK, app-level)          |
| expires_at | INTEGER  | Unix epoch ms, `now + 30 days`                       |

Sessions are created when the SPA calls `/api/auth/me` after SSO. They are bearer tokens returned in the JSON body and stored by the SPA in memory (and optionally in `sessionStorage`). The SPA sends them as `Authorization: Bearer <token>`.

### `pictures`
| column             | type     | notes                                                          |
|--------------------|----------|----------------------------------------------------------------|
| id                 | TEXT PK  | Internal ID, e.g. `pic_<epoch>_<rand>`                         |
| picture_id         | TEXT U   | The Panoramax UUID (lowercased)                                 |
| instance_url       | TEXT     | Base API URL of the Panoramax instance this picture came from  |
| sd_url             | TEXT     | Standard-definition image URL (or proxy URL)                    |
| hd_url             | TEXT     | High-definition image URL                                      |
| thumb_url          | TEXT     | Thumbnail URL                                                  |
| location_name      | TEXT     | Optional human label                                            |
| lat                | REAL     | Optional latitude                                               |
| lon                | REAL     | Optional longitude                                              |
| date_captured      | TEXT     | Optional ISO date from STAC                                     |
| status             | TEXT     | `'pending'` \| `'reviewed_ok'` \| `'flagged'` \| `'resolved'`  |
| is_checked_off     | INTEGER  | 0 or 1                                                         |
| added_at           | TEXT     | ISO timestamp when imported                                     |
| review_count       | INTEGER  | Number of reviews for this picture                              |
| last_reviewed_at   | TEXT     | ISO timestamp of last review                                    |
| last_error_reason  | TEXT     | Last review's `errorReason` (nullable)                         |
| last_comment       | TEXT     | Last review's `comment` (nullable)                             |
| last_reviewer      | TEXT     | Last reviewer's username                                        |

Indexes:
- `CREATE INDEX idx_pictures_status ON pictures(status)`
- `CREATE INDEX idx_pictures_picture_id ON pictures(picture_id)` (also covered by UNIQUE)
- `CREATE INDEX idx_pictures_added_at ON pictures(added_at)`

### `reviews`
| column        | type     | notes                                                          |
|---------------|----------|----------------------------------------------------------------|
| id            | TEXT PK  | e.g. `rev_<epoch>_<rand>`                                       |
| picture_id    | TEXT     | The Panoramax UUID being reviewed                               |
| user_id       | TEXT     | FK → `users.id`                                                |
| user_name     | TEXT     | Username of reviewer (denormalized for history display)        |
| status        | TEXT     | `'ok'` \| `'error'`                                             |
| error_reason  | TEXT     | Required when `status = 'error'`, null otherwise               |
| comment       | TEXT     | Optional free-text                                              |
| reviewed_at   | TEXT     | ISO timestamp                                                   |

Indexes:
- `CREATE INDEX idx_reviews_picture_id ON reviews(picture_id)`
- `CREATE INDEX idx_reviews_reviewed_at ON reviews(reviewed_at DESC)`
- `CREATE INDEX idx_reviews_user_id ON reviews(user_id)`

### `settings`
Single-row table. Primary key is always `'global'`.

| column  | type    | notes                              |
|---------|---------|------------------------------------|
| key     | TEXT PK | Always `'global'`                  |
| value   | TEXT    | JSON-encoded `AppSettings` object |

On migration, seed this row with the default settings if it doesn't exist:
```json
{
  "cacheSize": 10,
  "instanceUrl": "https://panoramax.mapcomplete.org/api",
  "autoFetchApi": true,
  "cellularSaverMode": false
}
```

## TypeScript types (shared by frontend and backend)

These live in `src/types.ts` and are imported by both server and client code.

```ts
export type ReviewStatus = 'ok' | 'error';
export type PictureStatus = 'pending' | 'reviewed_ok' | 'flagged' | 'resolved';

export interface User {
  id: string;
  username: string;
  role: 'reviewer' | 'admin';
  createdAt: string;
}

export interface PictureItem {
  id: string;
  pictureId: string;
  instanceUrl: string;
  sdUrl: string;
  hdUrl?: string;
  thumbUrl?: string;
  locationName?: string;
  lat?: number;
  lon?: number;
  dateCaptured?: string;
  status: PictureStatus;
  isCheckedOff?: boolean;
  addedAt: string;
  reviewCount: number;
  lastReviewedAt?: string;
  lastErrorReason?: string;
  lastComment?: string;
  lastReviewer?: string;
}

export interface ReviewRecord {
  id: string;
  pictureId: string;
  userId: string;
  userName: string;
  status: ReviewStatus;
  errorReason?: string;
  comment?: string;
  reviewedAt: string;
}

export interface AppStats {
  totalPictures: number;
  reviewedOk: number;
  flaggedErrors: number;
  checkedOffCount: number;
  pendingQueue: number;
  totalReviews: number;
  userReviewCount: number;
}

export interface AppSettings {
  cacheSize: number;            // 5 to 500
  instanceUrl: string;
  autoFetchApi: boolean;
  cellularSaverMode?: boolean;
}

export interface ImportResult {
  added: number;
  duplicatesSkipped: number;
  totalInDatabase: number;
  addedIds: string[];
}

export interface ErrorReasonOption {
  id: string;
  label: string;
  description: string;
  iconName: string;
}

export const COMMON_ERROR_REASONS: ErrorReasonOption[] = [
  { id: 'privacy',      label: 'Privacy Violation',         description: 'Unblurred face or license plate visible',         iconName: 'EyeOff' },
  { id: 'blur',         label: 'Blurry / Out of Focus',      description: 'Motion blur, bad focus, or smudged lens',         iconName: 'Aperture' },
  { id: 'lighting',     label: 'Dark / Overexposed',         description: 'Too dark, glare, or extreme lens flare',         iconName: 'SunDim' },
  { id: 'obstruction',  label: 'Obstructed / Dark Lens',    description: 'Hand, car frame, drop, or dirt blocking camera', iconName: 'ShieldAlert' },
  { id: 'orientation',  label: 'Sideways / Upside Down',    description: 'Incorrect camera angle or pitch',                 iconName: 'RotateCcw' },
  { id: 'location',     label: 'Incorrect Location / GPS',  description: 'Bad positioning or teleported GPS point',         iconName: 'MapPinOff' },
  { id: 'other',        label: 'Other Issue',               description: 'Custom problem described in notes',               iconName: 'HelpCircle' },
];
```

## Status transitions

```
                 +-----------+
   on import  -> |  pending  |
                 +-----------+
                       |
              submit review 'ok'
                       |
                       v
                 +------------+
                 | reviewed_ok|
                 +------------+
                       |
              submit review 'error'
                       v
                 +--------+
                 | flagged|-------+
                 +--------+       |
                       |          | operator toggles "checked off" in Dashboard
                       |          |
                       v          v
                 +----------+
                 | resolved |
                 +----------+
                       |
                 uncheck off (in Dashboard)
                       |
                       v
                 +--------+
                 | flagged|
                 +--------+
```

Submitting a new review on an already-reviewed picture **replaces** the picture's `lastReviewer`/`lastComment`/`lastErrorReason` and increments `reviewCount`. The picture's status reflects the latest review's status (ok → `reviewed_ok`, error → `flagged`), unless it's currently `resolved`, in which case submitting a new error review moves it back to `flagged`.

Undo (`POST /api/reviews/undo`) removes the most recent review for a given `reviewId` (or by `pictureId` if `reviewId` is omitted). If no reviews remain, the picture returns to `pending` and clears `lastReviewer`/`lastComment`/`lastErrorReason`/`is_checked_off`.
