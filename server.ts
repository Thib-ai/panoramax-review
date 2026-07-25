import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import type { Request, Response as ExpressResponse, NextFunction } from 'express';
import type {
  User, PictureItem, ReviewRecord, AppStats, AppSettings, ImportResult,
  ReviewStatus, PictureStatus,
} from './src/types.js';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'panoramax.db');
const NODE_ENV = process.env.NODE_ENV || 'development';

fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pictures (
      id TEXT PRIMARY KEY,
      picture_id TEXT UNIQUE NOT NULL,
      instance_url TEXT NOT NULL,
      sd_url TEXT NOT NULL,
      hd_url TEXT,
      thumb_url TEXT,
      location_name TEXT,
      lat REAL,
      lon REAL,
      date_captured TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      is_checked_off INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      review_count INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at TEXT,
      last_error_reason TEXT,
      last_comment TEXT,
      last_reviewer TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pictures_status ON pictures(status);
    CREATE INDEX IF NOT EXISTS idx_pictures_picture_id ON pictures(picture_id);
    CREATE INDEX IF NOT EXISTS idx_pictures_added_at ON pictures(added_at);

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      picture_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      status TEXT NOT NULL,
      error_reason TEXT,
      comment TEXT,
      reviewed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_picture_id ON reviews(picture_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_at ON reviews(reviewed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('global', '{"cacheSize":10,"instances":[],"activeInstance":"","autoFetchApi":true,"cellularSaverMode":false}');
  `);

  // Normalize all picture_id values to lowercase so lookups can use the UNIQUE index
  // (queries no longer wrap picture_id in LOWER(), which used to force full-table scans).
  // Safe under the picture_id UNIQUE constraint: any case collisions would have failed
  // to insert originally, so lowering cannot create new conflicts.
  sqlite.exec('UPDATE pictures SET picture_id = LOWER(picture_id) WHERE picture_id != LOWER(picture_id)');
}
migrate();

const stmts = {
  getUserById: sqlite.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByName: sqlite.prepare('SELECT * FROM users WHERE username = ?'),
  insertUser: sqlite.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?)'),
  getSession: sqlite.prepare('SELECT * FROM sessions WHERE token = ?'),
  deleteSession: sqlite.prepare('DELETE FROM sessions WHERE token = ?'),
  insertSession: sqlite.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  getPictureByPictureId: sqlite.prepare('SELECT * FROM pictures WHERE picture_id = ?'),
  getPictureById: sqlite.prepare('SELECT * FROM pictures WHERE id = ?'),
  getSettings: sqlite.prepare('SELECT value FROM settings WHERE key = ?'),
  upsertSettings: sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  insertPicture: sqlite.prepare(`INSERT INTO pictures (id, picture_id, instance_url, sd_url, hd_url, thumb_url, location_name, lat, lon, date_captured, status, added_at, review_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0)`),
  countPictures: sqlite.prepare('SELECT COUNT(*) as count FROM pictures'),
  countPendingByUser: sqlite.prepare(`SELECT COUNT(*) as count FROM pictures WHERE picture_id NOT IN (
    SELECT r.picture_id FROM reviews r WHERE r.user_id = ?
  )`),
  countPendingByUserAndInstance: sqlite.prepare(`SELECT COUNT(*) as count FROM pictures WHERE instance_url = ? AND picture_id NOT IN (
    SELECT r.picture_id FROM reviews r WHERE r.user_id = ?
  )`),
  insertReview: sqlite.prepare('INSERT INTO reviews (id, picture_id, user_id, user_name, status, error_reason, comment, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  updatePictureAfterReview: sqlite.prepare(`UPDATE pictures SET status = ?, review_count = review_count + 1, last_reviewed_at = ?, last_error_reason = ?, last_comment = ?, last_reviewer = ? WHERE picture_id = ?`),
  getReview: sqlite.prepare('SELECT * FROM reviews WHERE id = ?'),
  getReviewByPictureId: sqlite.prepare('SELECT * FROM reviews WHERE picture_id = ? ORDER BY reviewed_at DESC LIMIT 1'),
  deleteReview: sqlite.prepare('DELETE FROM reviews WHERE id = ?'),
  countReviewsForPicture: sqlite.prepare('SELECT COUNT(*) as count FROM reviews WHERE picture_id = ?'),
  getLatestReviewForPicture: sqlite.prepare('SELECT * FROM reviews WHERE picture_id = ? ORDER BY reviewed_at DESC LIMIT 1'),
  resetPictureAfterUndo: sqlite.prepare(`UPDATE pictures SET status = 'pending', review_count = 0, last_reviewed_at = NULL, last_error_reason = NULL, last_comment = NULL, last_reviewer = NULL, is_checked_off = 0 WHERE picture_id = ?`),
  updatePictureAfterUndo: sqlite.prepare(`UPDATE pictures SET review_count = ?, last_reviewed_at = ?, last_error_reason = ?, last_comment = ?, last_reviewer = ?, status = ?, is_checked_off = 0 WHERE picture_id = ?`),
  deleteReviewsByPictureId: sqlite.prepare('DELETE FROM reviews WHERE picture_id = ?'),
  deletePicture: sqlite.prepare('DELETE FROM pictures WHERE id = ? OR picture_id = ?'),
  toggleCheckoff: sqlite.prepare('UPDATE pictures SET is_checked_off = ? WHERE id = ? OR picture_id = ?'),
  resolveIfFlagged: sqlite.prepare("UPDATE pictures SET status = 'resolved' WHERE (id = ? OR picture_id = ?) AND status = 'flagged' AND ? = 1"),
  unresolveIfResolved: sqlite.prepare("UPDATE pictures SET status = 'flagged' WHERE (id = ? OR picture_id = ?) AND status = 'resolved' AND ? = 0"),
  // Bulk existence check used by import paths. Returns the set of picture_ids already stored.
  getPicturesByIds: (ids: string[]) => {
    if (ids.length === 0) return [] as Row[];
    const placeholders = ids.map(() => '?').join(',');
    return sqlite.prepare(`SELECT picture_id FROM pictures WHERE picture_id IN (${placeholders})`).all(...ids) as Row[];
  },
};

type Row = Record<string, unknown>;

function mapToUser(row: Row): User {
  return { id: row.id as string, username: row.username as string, role: row.role as 'admin', createdAt: row.created_at as string };
}

function mapToPictureItem(row: Row): PictureItem {
  return {
    id: row.id as string,
    pictureId: row.picture_id as string,
    instanceUrl: row.instance_url as string,
    sdUrl: row.sd_url as string,
    hdUrl: row.hd_url as string | undefined,
    thumbUrl: row.thumb_url as string | undefined,
    locationName: row.location_name as string | undefined,
    lat: row.lat as number | undefined,
    lon: row.lon as number | undefined,
    dateCaptured: row.date_captured as string | undefined,
    status: row.status as PictureStatus,
    isCheckedOff: Boolean(row.is_checked_off),
    addedAt: row.added_at as string,
    reviewCount: row.review_count as number,
    lastReviewedAt: row.last_reviewed_at as string | undefined,
    lastErrorReason: row.last_error_reason as string | undefined,
    lastComment: row.last_comment as string | undefined,
    lastReviewer: row.last_reviewer as string | undefined,
  };
}

function mapToReviewRecord(row: Row): ReviewRecord {
  return {
    id: row.id as string,
    pictureId: row.picture_id as string,
    userId: row.user_id as string,
    userName: row.user_name as string,
    status: row.status as ReviewStatus,
    errorReason: row.error_reason as string | undefined,
    comment: row.comment as string | undefined,
    reviewedAt: row.reviewed_at as string,
  };
}

function buildPanoramaxUrls(pictureId: string, instanceUrl: string): { sdUrl: string; hdUrl: string; thumbUrl: string } {
  if (pictureId.startsWith('http://') || pictureId.startsWith('https://')) {
    return { sdUrl: pictureId, hdUrl: pictureId, thumbUrl: pictureId };
  }
  const hex = pictureId.replace(/[^a-f0-9]/gi, '').toLowerCase();
  const base = instanceUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
  if (hex.length >= 32) {
    const p1 = hex.slice(0, 2), p2 = hex.slice(2, 4), p3 = hex.slice(4, 6), p4 = hex.slice(6, 8);
    const rest = pictureId.toLowerCase().replace(/^[a-f0-9]{8}-/, '');
    const cdnBase = base;
    return {
      hdUrl: `${cdnBase}/permanent/${p1}/${p2}/${p3}/${p4}/${rest}.jpg`,
      sdUrl: `${cdnBase}/derivatives/${p1}/${p2}/${p3}/${p4}/${rest}/sd.jpg`,
      thumbUrl: `${cdnBase}/derivatives/${p1}/${p2}/${p3}/${p4}/${rest}/thumb.jpg`,
    };
  }
  const apiBase = instanceUrl.replace(/\/$/, '');
  return {
    sdUrl: `${apiBase}/pictures/${pictureId}/sd.jpg`,
    hdUrl: `${apiBase}/pictures/${pictureId}/hd.jpg`,
    thumbUrl: `${apiBase}/pictures/${pictureId}/thumb.jpg`,
  };
}

function cleanPictureId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const uuidMatch = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (uuidMatch) return uuidMatch[0].toLowerCase();
  let cleaned = trimmed.replace(/^https?:\/\/[^\/]+/, '');
  cleaned = cleaned.replace(/\/pictures\//, '');
  cleaned = cleaned.replace(/\/sd\.jpg$/, '');
  cleaned = cleaned.replace(/\/hd\.jpg$/, '');
  cleaned = cleaned.replace(/\/thumb\.jpg$/, '');
  cleaned = cleaned.replace(/[\/\s]/g, '');
  return cleaned.toLowerCase();
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function upsertUser(username: string): User {
  const lowered = username.toLowerCase();
  const existing = stmts.getUserByName.get(lowered) as Row | undefined;
  if (existing) return mapToUser(existing);
  const id = `usr_${lowered}`;
  const now = new Date().toISOString();
  stmts.insertUser.run(id, lowered, 'admin', now);
  return { id, username: lowered, role: 'admin', createdAt: now };
}

function issueSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 86400 * 1000;
  stmts.insertSession.run(token, userId, expiresAt);
  return token;
}

declare global {
  namespace Express {
    interface Request {
      _issuedToken?: string;
      _user?: User;
    }
  }
}

function getAuthUser(req: Request): { user: User; issuedToken?: string } | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const session = stmts.getSession.get(token) as Row | undefined;
    if (session && Number(session.expires_at) > Date.now()) {
      const user = stmts.getUserById.get(session.user_id as string) as Row | undefined;
      if (user) return { user: mapToUser(user) };
    }
    if (session) stmts.deleteSession.run(token);
  }
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const ynhUser = req.headers['ynh-user'] as string | undefined;
  const remoteUser = ynhUser || req.headers['remote-user'] as string | undefined;
  if (typeof remoteUser === 'string' && remoteUser.trim()) {
    const user = upsertUser(remoteUser.trim());
    const issuedToken = issueSession(user.id);
    req._issuedToken = issuedToken;
    return { user, issuedToken };
  }
  if (NODE_ENV !== 'production' && isLocal && !remoteUser) {
    const user = upsertUser('devuser');
    const issuedToken = issueSession(user.id);
    req._issuedToken = issuedToken;
    return { user, issuedToken };
  }
  return null;
}

function requireAuth(req: Request, res: ExpressResponse): boolean {
  const auth = getAuthUser(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  req._user = auth.user;
  return true;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  next();
  if (req._issuedToken && !res.headersSent) {
    res.setHeader('X-Issued-Token', req._issuedToken);
  }
});

function readSettings(): AppSettings {
  const row = stmts.getSettings.get('global') as Row | undefined;
  if (!row) {
    return { cacheSize: 10, instances: [], activeInstance: '', autoFetchApi: true, cellularSaverMode: false };
  }
  return JSON.parse(row.value as string);
}

function wrap(handler: (req: Request, res: ExpressResponse) => void | Promise<void>) {
  return (req: Request, res: ExpressResponse, next: NextFunction) => {
    try {
      const result = handler(req, res);
      if (result instanceof Promise) result.catch((err) => {
        res.status(500).json({ error: String(err) });
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };
}

// GET /api/auth/me
app.get('/api/auth/me', wrap((req, res) => {
  const auth = getAuthUser(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ token: auth.issuedToken || '', user: auth.user });
}));

// POST /api/auth/logout
app.post('/api/auth/logout', wrap((req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    stmts.deleteSession.run(authHeader.substring(7));
  }
  res.json({ success: true });
}));

// GET /api/pictures/queue
app.get('/api/pictures/queue', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const instance = req.query.instance as string || '';
  const limit = Math.min(Math.max(Number(req.query.limit) || readSettings().cacheSize, 1), 500);
  const settings = readSettings();
  const cacheSize = Math.min(Math.max(settings.cacheSize, 5), 500);
  const effectiveLimit = Math.min(limit || cacheSize, 500);
  const userId = req._user!.id;

  // Optional client-supplied list of recently-shown picture_ids to exclude
  // from the next random sample (prevents immediate repeats on queue refill).
  const excludeRaw = req.query.exclude as string | undefined;
  const excludeIds = excludeRaw
    ? Array.from(new Set(excludeRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)))
    : [];

  const totalRow = stmts.countPictures.get() as Row;
  const totalPictures = totalRow.count as number;

  const totalPending = instance
    ? (stmts.countPendingByUserAndInstance.get(instance, userId) as Row).count as number
    : (stmts.countPendingByUser.get(userId) as Row).count as number;

  let queue: PictureItem[];
  if (totalPending > 0) {
    let sql = `SELECT * FROM pictures WHERE picture_id NOT IN (
      SELECT r.picture_id FROM reviews r WHERE r.user_id = ?
    )`;
    const params: unknown[] = [userId];
    if (instance) {
      sql += ' AND instance_url = ?';
      params.push(instance);
    }
    if (excludeIds.length > 0) {
      const placeholders = excludeIds.map(() => '?').join(',');
      sql += ` AND picture_id NOT IN (${placeholders})`;
      params.push(...excludeIds);
    }
    sql += ' ORDER BY RANDOM() LIMIT ?';
    params.push(effectiveLimit);
    const rows = sqlite.prepare(sql).all(...params) as Row[];
    queue = rows.map(mapToPictureItem);
  } else {
    let sql = 'SELECT * FROM pictures';
    const params: unknown[] = [];
    const where: string[] = [];
    if (instance) {
      where.push('instance_url = ?');
      params.push(instance);
    }
    if (excludeIds.length > 0) {
      const placeholders = excludeIds.map(() => '?').join(',');
      where.push(`picture_id NOT IN (${placeholders})`);
      params.push(...excludeIds);
    }
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY RANDOM() LIMIT ?';
    params.push(effectiveLimit);
    const rows = sqlite.prepare(sql).all(...params) as Row[];
    queue = rows.map(mapToPictureItem);
  }

  res.json({ queue, totalPending, totalPictures, cacheSize: effectiveLimit });
}));

// GET /api/pictures/next
app.get('/api/pictures/next', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const instance = req.query.instance as string || '';
  const userId = req._user!.id;

  const countRow = stmts.countPictures.get() as Row;
  if ((countRow.count as number) === 0) {
    res.status(444).json({ error: 'No pictures in database. Import pictures to start review.' });
    return;
  }

  const totalPending = instance
    ? (stmts.countPendingByUserAndInstance.get(instance, userId) as Row).count as number
    : (stmts.countPendingByUser.get(userId) as Row).count as number;

  let picture: PictureItem | null = null;
  let queueExhausted = false;

  if (totalPending > 0) {
    let sql = `SELECT * FROM pictures WHERE picture_id NOT IN (
      SELECT r.picture_id FROM reviews r WHERE r.user_id = ?
    )`;
    const params: unknown[] = [userId];
    if (instance) {
      sql += ' AND instance_url = ?';
      params.push(instance);
    }
    sql += ' ORDER BY RANDOM() LIMIT 1';
    const row = sqlite.prepare(sql).get(...params) as Row | undefined;
    if (row) picture = mapToPictureItem(row);
  }

  if (!picture) {
    queueExhausted = totalPending === 0;
    let sql = 'SELECT * FROM pictures';
    const params: unknown[] = [];
    if (instance) {
      sql += ' WHERE instance_url = ?';
      params.push(instance);
    }
    sql += ' ORDER BY RANDOM() LIMIT 1';
    const row = sqlite.prepare(sql).get(...params) as Row | undefined;
    if (row) picture = mapToPictureItem(row);
  }

  res.json({ picture, queueExhausted });
}));

// POST /api/pictures/import
app.post('/api/pictures/import', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const { pictureIds, instanceUrl } = req.body as { pictureIds: string[]; instanceUrl?: string };
  if (!Array.isArray(pictureIds)) {
    res.status(400).json({ error: 'pictureIds must be an array' });
    return;
  }
  if (pictureIds.length > 1000) {
    res.status(400).json({ error: 'pictureIds array too large (max 1000 per request)' });
    return;
  }
  const settings = readSettings();
  const baseUrl = (instanceUrl || settings.activeInstance || settings.instances[0] || '').replace(/\/$/, '');
  if (!baseUrl) {
    res.status(400).json({ error: 'instanceUrl is required (no instance configured in settings)' });
    return;
  }

  // Clean + lowercase + dedupe the incoming batch in JS so we only hit the DB once
  // for existence and once per genuinely-new row for insert. picture_id is stored
  // lowercased (see migration) and indexed UNIQUE, so this is an indexed equality lookup.
  const seen = new Set<string>();
  const cleanedIds: string[] = [];
  for (const rawId of pictureIds) {
    const cleaned = cleanPictureId(rawId);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    cleanedIds.push(cleaned);
  }

  let added = 0;
  let duplicatesSkipped = 0;
  const addedIds: string[] = [];

  if (cleanedIds.length > 0) {
    const existingIds = new Set(
      (stmts.getPicturesByIds(cleanedIds) as Row[]).map((r) => r.picture_id as string),
    );

    const toInsert = cleanedIds.filter((id) => {
      if (existingIds.has(id)) {
        duplicatesSkipped++;
        return false;
      }
      return true;
    });

    if (toInsert.length > 0) {
      const now = new Date().toISOString();
      const insertAll = sqlite.transaction((ids: string[]) => {
        for (const cleaned of ids) {
          const urls = buildPanoramaxUrls(cleaned, baseUrl);
          const internalId = `pic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          stmts.insertPicture.run(internalId, cleaned, baseUrl, urls.sdUrl, urls.hdUrl, urls.thumbUrl, null, null, null, null, now);
          added++;
          addedIds.push(cleaned);
        }
      });
      insertAll(toInsert);
    }
  }

  const totalRow = stmts.countPictures.get() as Row;
  res.json({ added, duplicatesSkipped, totalInDatabase: totalRow.count as number, addedIds } as ImportResult);
}));

// POST /api/pictures/fetch-panoramax
app.post('/api/pictures/fetch-panoramax', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const settings = readSettings();
  const instanceUrl = ((req.body?.instanceUrl as string) || settings.activeInstance || settings.instances[0] || '').replace(/\/$/, '');
  if (!instanceUrl) {
    res.status(400).json({ error: 'instanceUrl is required (no instance configured in settings)' });
    return;
  }
  const limit = Math.min(Math.max(Number(req.body?.limit) || 20, 1), 100);

  let response: Response;
  try {
    response = await fetch(`${instanceUrl}/search?limit=${limit}`);
  } catch (err) {
    res.status(500).json({ error: `Failed to query Panoramax API: ${String(err)}` });
    return;
  }

  if (!response.ok) {
    res.status(500).json({ error: `Failed to query Panoramax API: HTTP ${response.status}` });
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    res.status(500).json({ error: 'Failed to parse Panoramax API response' });
    return;
  }

  const features = data.features as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(features)) {
    res.status(500).json({ error: 'Panoramax API response missing features array' });
    return;
  }

  let added = 0;
  let duplicatesSkipped = 0;

  const baseForUrls = instanceUrl.replace(/\/search$/, '');

  // First pass: extract candidate picture_ids from features, dedupe within the batch.
  interface Candidate {
    pictureId: string;
    feature: Record<string, unknown>;
  }
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const feature of features) {
    const assets = (feature.assets as Record<string, unknown>) || {};

    let pictureId = (feature.id as string || '').toLowerCase();
    if (!pictureId) {
      const sdAsset = assets.sd as Record<string, unknown> | undefined;
      const href = (sdAsset?.href as string) || '';
      const extracted = cleanPictureId(href);
      if (!extracted) continue;
      pictureId = extracted;
    }
    if (seen.has(pictureId)) continue;
    seen.add(pictureId);
    candidates.push({ pictureId, feature });
  }

  // Set-based existence check against the DB (indexed, single query).
  const existingIds = candidates.length > 0
    ? new Set((stmts.getPicturesByIds(candidates.map((c) => c.pictureId)) as Row[]).map((r) => r.picture_id as string))
    : new Set<string>();
  duplicatesSkipped = candidates.length - existingIds.size;

  const toInsert = candidates.filter((c) => !existingIds.has(c.pictureId));

  if (toInsert.length > 0) {
    const insertAll = sqlite.transaction((items: Candidate[]) => {
      const now = new Date().toISOString();
      for (const { pictureId, feature } of items) {
        const props = (feature.properties as Record<string, unknown>) || {};
        const assets = (feature.assets as Record<string, unknown>) || {};
        const geometry = feature.geometry as Record<string, unknown> | null;

        const sdAsset = assets.sd as Record<string, unknown> | undefined;
        const hdAsset = assets.hd as Record<string, unknown> | undefined;
        const thumbAsset = assets.thumb as Record<string, unknown> | undefined;

        const sdUrl = (sdAsset?.href as string) || `${baseForUrls}/pictures/${pictureId}/sd.jpg`;
        const hdUrl = (hdAsset?.href as string) || `${baseForUrls}/pictures/${pictureId}/hd.jpg`;
        const thumbUrl = (thumbAsset?.href as string) || `${baseForUrls}/pictures/${pictureId}/thumb.jpg`;

        const coords = geometry?.coordinates as number[] | undefined;
        const lat = coords?.[1] ?? null;
        const lon = coords?.[0] ?? null;

        const dateCaptured = (props.datetime as string) || (props.created as string) || null;
        const seq = props['panoramax:sequence'] as string;
        const locationName = seq ? `Sequence ${seq.slice(0, 8)}` : `Panoramax Photo ${pictureId.slice(0, 8)}`;

        const internalId = `pic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        stmts.insertPicture.run(internalId, pictureId, instanceUrl, sdUrl, hdUrl, thumbUrl, locationName, lat, lon, dateCaptured, now);
        added++;
      }
    });
    insertAll(toInsert);
  }

  const totalRow = stmts.countPictures.get() as Row;
  res.json({ success: true, added, duplicatesSkipped, totalInDatabase: totalRow.count as number });
}));

// POST /api/reviews
app.post('/api/reviews', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const { pictureId, status, errorReason, comment } = req.body as {
    pictureId: string; status: ReviewStatus; errorReason?: string; comment?: string;
  };
  if (!pictureId || !status) {
    res.status(400).json({ error: 'pictureId and status are required' });
    return;
  }
  if (status === 'error' && !errorReason) {
    res.status(400).json({ error: 'errorReason is required when status is error' });
    return;
  }

  const picture = (stmts.getPictureByPictureId.get(pictureId) || stmts.getPictureById.get(pictureId)) as Row | undefined;
  if (!picture) {
    res.status(404).json({ error: 'Picture not found' });
    return;
  }

  const picPictureId = picture.picture_id as string;
  const now = new Date().toISOString();
  const reviewId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const newStatus: PictureStatus = status === 'ok' ? 'reviewed_ok' : 'flagged';
  const trimmedComment = comment?.trim() || null;

  const doReview = sqlite.transaction(() => {
    stmts.insertReview.run(reviewId, picPictureId, req._user!.id, req._user!.username, status, errorReason || null, trimmedComment, now);
    stmts.updatePictureAfterReview.run(newStatus, now, errorReason || null, trimmedComment, req._user!.username, picPictureId);
  });
  doReview();

  const review: ReviewRecord = {
    id: reviewId, pictureId: picPictureId, userId: req._user!.id,
    userName: req._user!.username, status, errorReason, comment: trimmedComment || undefined, reviewedAt: now,
  };

  const updatedPicture = mapToPictureItem(stmts.getPictureByPictureId.get(picPictureId) as Row);
  res.json({ success: true, review, picture: updatedPicture });
}));

// POST /api/reviews/undo
app.post('/api/reviews/undo', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const { reviewId, pictureId } = req.body as { reviewId?: string; pictureId?: string };

  let review: Row | undefined;
  if (reviewId) {
    review = stmts.getReview.get(reviewId) as Row | undefined;
  } else if (pictureId) {
    review = stmts.getReviewByPictureId.get(pictureId) as Row | undefined;
  }

  if (!review) {
    res.status(404).json({ error: 'Review not found' });
    return;
  }

  const picPictureId = review.picture_id as string;
  const removedReview = mapToReviewRecord(review);

  const doUndo = sqlite.transaction(() => {
    stmts.deleteReview.run(review.id);
    const remainingCount = (stmts.countReviewsForPicture.get(picPictureId) as Row).count as number;
    if (remainingCount === 0) {
      stmts.resetPictureAfterUndo.run(picPictureId);
    } else {
      const latest = stmts.getLatestReviewForPicture.get(picPictureId) as Row;
      const latestStatus: ReviewStatus = latest.status as ReviewStatus;
      const picStatus: PictureStatus = latestStatus === 'ok' ? 'reviewed_ok' : 'flagged';
      stmts.updatePictureAfterUndo.run(remainingCount, latest.reviewed_at, latest.error_reason, latest.comment, latest.user_name, picStatus, picPictureId);
    }
  });
  doUndo();

  const updatedPicture = mapToPictureItem(stmts.getPictureByPictureId.get(picPictureId) as Row);
  res.json({ success: true, removedReview, picture: updatedPicture });
}));

// GET /api/reviews
app.get('/api/reviews', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const statusFilter = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;

  let query = 'SELECT * FROM reviews WHERE 1=1';
  const params: unknown[] = [];

  if (statusFilter && (statusFilter === 'ok' || statusFilter === 'error')) {
    query += ' AND status = ?';
    params.push(statusFilter);
  }

  if (search) {
    query += ' AND (LOWER(picture_id) LIKE ? OR LOWER(user_name) LIKE ? OR LOWER(comment) LIKE ? OR LOWER(error_reason) LIKE ?)';
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY reviewed_at DESC';

  const rows = sqlite.prepare(query).all(...params) as Row[];
  res.json({ reviews: rows.map(mapToReviewRecord) });
}));

// GET /api/stats
app.get('/api/stats', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const totalRow = stmts.countPictures.get() as Row;
  const totalPictures = totalRow.count as number;
  const reviewedOk = (sqlite.prepare("SELECT COUNT(*) as count FROM pictures WHERE status = 'reviewed_ok'").get() as Row).count as number;
  const flaggedErrors = (sqlite.prepare("SELECT COUNT(*) as count FROM pictures WHERE status = 'flagged' OR status = 'resolved'").get() as Row).count as number;
  const checkedOffCount = (sqlite.prepare('SELECT COUNT(*) as count FROM pictures WHERE is_checked_off = 1 OR status = ?').get('resolved') as Row).count as number;
  const pendingQueue = (stmts.countPendingByUser.get(req._user!.id) as Row).count as number;
  const totalReviews = (sqlite.prepare('SELECT COUNT(*) as count FROM reviews').get() as Row).count as number;
  const userReviewCount = (sqlite.prepare('SELECT COUNT(*) as count FROM reviews WHERE user_id = ?').get(req._user!.id) as Row).count as number;

  res.json({ totalPictures, reviewedOk, flaggedErrors, checkedOffCount, pendingQueue, totalReviews, userReviewCount } as AppStats);
}));

// GET /api/settings
app.get('/api/settings', wrap((req, res) => {
  res.json(readSettings());
}));

// PUT /api/settings
app.put('/api/settings', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const current = readSettings();
  const update = req.body as Partial<AppSettings>;
  const merged = { ...current, ...update };
  if (merged.activeInstance && Array.isArray(merged.instances) && !merged.instances.includes(merged.activeInstance)) {
    merged.activeInstance = '';
  }
  merged.cacheSize = Math.min(Math.max(merged.cacheSize, 5), 500);
  stmts.upsertSettings.run('global', JSON.stringify(merged));
  res.json(merged);
}));

// GET /api/dashboard/pictures
app.get('/api/dashboard/pictures', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const status = req.query.status as string || 'all';
  const search = req.query.search as string || '';
  const instance = req.query.instance as string || '';
  const reason = req.query.reason as string || '';
  const checkedOff = req.query.checkedOff as string || 'all';
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 250);

  let query = 'SELECT * FROM pictures WHERE 1=1';
  const params: unknown[] = [];

  if (status !== 'all') {
    if (status === 'resolved') {
      query += ' AND (is_checked_off = 1 OR status = ?)';
      params.push('resolved');
    } else {
      query += ' AND status = ?';
      params.push(status);
    }
  }

  if (search) {
    query += ' AND (LOWER(picture_id) LIKE ? OR LOWER(last_comment) LIKE ? OR LOWER(last_reviewer) LIKE ?)';
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term, term);
  }

  if (instance) {
    query += ' AND LOWER(instance_url) LIKE ?';
    params.push(`%${instance.toLowerCase()}%`);
  }

  if (reason) {
    query += ' AND LOWER(last_error_reason) LIKE ?';
    params.push(`%${reason.toLowerCase()}%`);
  }

  if (checkedOff === 'checked') {
    query += ' AND is_checked_off = 1';
  } else if (checkedOff === 'unchecked') {
    query += ' AND is_checked_off = 0';
  }

  const countRow = sqlite.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as count')).get(...params) as Row;
  const filteredCount = countRow.count as number;

  query += ' ORDER BY added_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  const rows = sqlite.prepare(query).all(...params) as Row[];
  const pictures = rows.map(mapToPictureItem);

  const totalRow = stmts.countPictures.get() as Row;
  res.json({ pictures, totalCount: totalRow.count as number, filteredCount });
}));

// POST /api/pictures/toggle-checkoff
app.post('/api/pictures/toggle-checkoff', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const { pictureIds, checked } = req.body as { pictureIds: string[]; checked: boolean };
  if (!Array.isArray(pictureIds)) {
    res.status(400).json({ error: 'pictureIds must be an array' });
    return;
  }
  if (pictureIds.length > 1000) {
    res.status(400).json({ error: 'pictureIds array too large (max 1000 per request)' });
    return;
  }

  let updatedCount = 0;
  const doToggle = sqlite.transaction((ids: string[]) => {
    for (const pid of ids) {
      stmts.toggleCheckoff.run(checked ? 1 : 0, pid, pid);
      if (checked) stmts.resolveIfFlagged.run(pid, pid, 1);
      else stmts.unresolveIfResolved.run(pid, pid, 0);
      updatedCount++;
    }
  });
  doToggle(pictureIds);

  res.json({ success: true, updatedCount });
}));

// POST /api/pictures/delete-batch
app.post('/api/pictures/delete-batch', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const { pictureIds } = req.body as { pictureIds: string[] };
  if (!Array.isArray(pictureIds)) {
    res.status(400).json({ error: 'pictureIds must be an array' });
    return;
  }
  if (pictureIds.length > 1000) {
    res.status(400).json({ error: 'pictureIds array too large (max 1000 per request)' });
    return;
  }

  let removedCount = 0;
  const doDelete = sqlite.transaction((ids: string[]) => {
    for (const pid of ids) {
      const picture = (stmts.getPictureByPictureId.get(pid) || stmts.getPictureById.get(pid)) as Row | undefined;
      if (!picture) continue;
      const picPictureId = picture.picture_id as string;
      stmts.deleteReviewsByPictureId.run(picPictureId);
      stmts.deletePicture.run(pid, pid);
      removedCount++;
    }
  });
  doDelete(pictureIds);

  const totalRow = stmts.countPictures.get() as Row;
  res.json({ success: true, removedCount, remainingPictures: totalRow.count as number });
}));

// GET /api/export
app.get('/api/export', wrap((req, res) => {
  if (!requireAuth(req, res)) return;
  const format = (req.query.format as string || 'json').toLowerCase();
  const ids = req.query.ids ? String(req.query.ids).split(',') : null;
  const now = Date.now();

  let pictureQuery = 'SELECT * FROM pictures WHERE 1=1';
  const pictureParams: unknown[] = [];

  if (ids) {
    const placeholders = ids.map(() => '?').join(',');
    pictureQuery += ` AND (id IN (${placeholders}) OR picture_id IN (${placeholders}))`;
    pictureParams.push(...ids, ...ids);
  } else {
    const status = req.query.status as string || '';
    const search = req.query.search as string || '';
    const instance = req.query.instance as string || '';
    const reason = req.query.reason as string || '';
    const checkedOff = req.query.checkedOff as string || '';

    if (status && status !== 'all') {
      if (status === 'resolved') {
        pictureQuery += ' AND (is_checked_off = 1 OR status = ?)';
        pictureParams.push('resolved');
      } else {
        pictureQuery += ' AND status = ?';
        pictureParams.push(status);
      }
    }

    if (search) {
      pictureQuery += ' AND (LOWER(picture_id) LIKE ? OR LOWER(last_comment) LIKE ? OR LOWER(last_reviewer) LIKE ?)';
      const term = `%${search.toLowerCase()}%`;
      pictureParams.push(term, term, term);
    }

    if (instance) {
      pictureQuery += ' AND LOWER(instance_url) LIKE ?';
      pictureParams.push(`%${instance.toLowerCase()}%`);
    }

    if (reason) {
      pictureQuery += ' AND LOWER(last_error_reason) LIKE ?';
      pictureParams.push(`%${reason.toLowerCase()}%`);
    }

    if (checkedOff === 'checked') {
      pictureQuery += ' AND is_checked_off = 1';
    } else if (checkedOff === 'unchecked') {
      pictureQuery += ' AND is_checked_off = 0';
    }
  }

  pictureQuery += ' ORDER BY added_at DESC';

  const pictures = sqlite.prepare(pictureQuery).all(...pictureParams) as Row[];
  const pictureIds = pictures.map(p => p.picture_id);

  if (format === 'csv') {
    let reviews: Row[];
    if (pictureIds.length > 0) {
      const placeholders = pictureIds.map(() => '?').join(',');
      reviews = sqlite.prepare(`SELECT * FROM reviews WHERE picture_id IN (${placeholders}) ORDER BY reviewed_at DESC`).all(...pictureIds) as Row[];
    } else {
      reviews = [];
    }
    const escape = (s: unknown) => {
      const str = String(s ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };
    let csv = 'Review ID,Picture ID,Status,Error Reason,Comment,Reviewer,Reviewed At\n';
    for (const r of reviews) {
      csv += `${escape(r.id)},${escape(r.picture_id)},${escape(r.status)},${escape(r.error_reason)},${escape(r.comment)},${escape(r.user_name)},${escape(r.reviewed_at)}\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=panoramax_reviews_${now}.csv`);
    res.send(csv);
    return;
  }

  if (format === 'geojson') {
    const features = pictures.map((p) => {
      const feature: Record<string, unknown> = {
        type: 'Feature',
        properties: {
          pictureId: p.picture_id,
          status: p.status,
          instanceUrl: p.instance_url,
          sdUrl: p.sd_url,
          reviewCount: p.review_count,
          lastErrorReason: p.last_error_reason,
          lastComment: p.last_comment,
          lastReviewer: p.last_reviewer,
        },
      };
      if (p.lat != null && p.lon != null) {
        feature.geometry = { type: 'Point', coordinates: [p.lon, p.lat] };
      }
      return feature;
    });
    const geojson = { type: 'FeatureCollection', features };
    res.json(geojson);
    return;
  }

  // default: json
  let reviews: Row[];
  if (pictureIds.length > 0) {
    const placeholders = pictureIds.map(() => '?').join(',');
    reviews = sqlite.prepare(`SELECT * FROM reviews WHERE picture_id IN (${placeholders}) ORDER BY reviewed_at DESC`).all(...pictureIds) as Row[];
  } else {
    reviews = [];
  }
  res.json({
    exportedAt: new Date().toISOString(),
    totalPictures: pictures.length,
    pictures: pictures.map(mapToPictureItem),
    reviews: reviews.map(mapToReviewRecord),
  });
}));

// GET /api/proxy-image
app.get('/api/proxy-image', wrap(async (req, res) => {
  const url = req.query.url as string;
  if (!url) {
    res.status(400).send('Missing url parameter');
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch (err) {
    res.status(500).send(`Fetch error: ${String(err)}`);
    return;
  }

  if (!upstream.ok) {
    res.status(upstream.status).send(`Upstream returned ${upstream.status}`);
    return;
  }

  const contentType = upstream.headers.get('Content-Type') || 'image/jpeg';
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
}));

async function startServer() {
  if (NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*splat', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Panoramax Review Server on :${PORT}`));
}
startServer();
