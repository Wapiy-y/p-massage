/**
 * All D1 access lives here. Every function is async because D1 is async —
 * the shape the original SQLite layer was already written for.
 */
import type {
  Profile,
  PublicReview,
  ReviewRow,
  ReviewStatus,
  ServiceRow,
  Summary
} from './types';
import type { ProfileInput, ServiceInput } from './validation';

const WINDOW_MS = 60 * 60 * 1000;

export function rateLimitMax(env: { RATE_LIMIT_MAX?: string }): number {
  const parsed = Number(env.RATE_LIMIT_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

/* ------------------------------------------------------------------ profile */

export async function getProfile(db: D1Database): Promise<Profile | null> {
  const row = await db.prepare('SELECT json FROM profile WHERE id = 1').first<{ json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.json) as Profile;
  } catch {
    return null;
  }
}

export async function saveProfile(db: D1Database, profile: ProfileInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profile (id, json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`
    )
    .bind(JSON.stringify(profile))
    .run();
}

export async function getServices(
  db: D1Database,
  options: { activeOnly?: boolean } = {}
): Promise<ServiceRow[]> {
  const activeOnly = options.activeOnly !== false;
  const sql = activeOnly
    ? 'SELECT id, name, duration_min, price_rm, sort FROM services WHERE active = 1 ORDER BY sort, name'
    : 'SELECT id, name, duration_min, price_rm, sort FROM services ORDER BY sort, name';
  const { results } = await db.prepare(sql).all<ServiceRow>();
  return results ?? [];
}

/** Replace the service list in one pass. */
export async function saveServices(db: D1Database, list: ServiceInput[]): Promise<void> {
  const existing = await db.prepare('SELECT id FROM services').all<{ id: string }>();
  const keep = new Set(list.map((s) => s.id));

  const statements: D1PreparedStatement[] = [];
  for (const row of existing.results ?? []) {
    if (!keep.has(row.id)) {
      statements.push(db.prepare('DELETE FROM services WHERE id = ?').bind(row.id));
    }
  }
  list.forEach((service, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO services (id, name, duration_min, price_rm, sort, active)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             duration_min = excluded.duration_min,
             price_rm = excluded.price_rm,
             sort = excluded.sort,
             active = 1`
        )
        .bind(service.id, service.name, service.duration_min, service.price_rm, index + 1)
    );
  });

  if (statements.length) await db.batch(statements);
}

/* ------------------------------------------------------------------ reviews */

function toPublic(row: ReviewRow): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    service_id: row.service_id,
    service_name: row.service_name ?? null,
    nickname: row.nickname ?? 'Anonymous',
    message: row.message,
    reply: row.reply ?? null,
    created_at: row.created_at,
    replied_at: row.replied_at ?? null
  };
}

export interface ListOptions {
  cursor?: string | null;
  rating?: number | null;
  service?: string | null;
  limit?: number;
}

/**
 * Published reviews, newest first. Keyset pagination on (created_at, id) with a
 * dot separator — ids contain underscores, so `_` would corrupt the cursor.
 */
export async function listApproved(
  db: D1Database,
  options: ListOptions = {}
): Promise<{ items: PublicReview[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const where: string[] = ["r.status = 'approved'"];
  const params: unknown[] = [];

  if (options.rating) {
    where.push('r.rating = ?');
    params.push(options.rating);
  }
  if (options.service) {
    where.push('r.service_id = ?');
    params.push(options.service);
  }
  if (options.cursor) {
    const cursor = String(options.cursor);
    const dot = cursor.indexOf('.');
    const ts = dot > 0 ? Number(cursor.slice(0, dot)) : Number.NaN;
    const id = dot > 0 ? cursor.slice(dot + 1) : '';
    if (Number.isFinite(ts) && id) {
      where.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
      params.push(ts, ts, id);
    }
  }

  const { results } = await db
    .prepare(
      `SELECT r.id, r.rating, r.service_id, s.name AS service_name, r.nickname, r.message,
              r.reply, r.replied_at, r.created_at
       FROM reviews r
       LEFT JOIN services s ON s.id = r.service_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?`
    )
    .bind(...params, limit + 1)
    .all<ReviewRow>();

  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toPublic);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? `${last.created_at}.${last.id}` : null
  };
}

export async function summary(db: D1Database): Promise<Summary> {
  const { results } = await db
    .prepare(
      "SELECT rating, COUNT(*) AS n FROM reviews WHERE status = 'approved' GROUP BY rating"
    )
    .all<{ rating: number; n: number }>();

  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const row of results ?? []) {
    const key = row.rating as 1 | 2 | 3 | 4 | 5;
    distribution[key] = row.n;
    count += row.n;
    sum += row.rating * row.n;
  }
  return {
    count,
    average: count ? Math.round((sum / count) * 10) / 10 : 0,
    distribution
  };
}

export async function insertReview(
  db: D1Database,
  input: {
    id: string;
    rating: number;
    service_id: string | null;
    nickname: string;
    message: string;
    ip_hash: string;
    created_at: number;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(
      input.id,
      input.rating,
      input.service_id,
      input.nickname,
      input.message,
      input.ip_hash,
      input.created_at
    )
    .run();
}

export async function listForAdmin(
  db: D1Database,
  status: ReviewStatus
): Promise<ReviewRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, s.name AS service_name
       FROM reviews r
       LEFT JOIN services s ON s.id = r.service_id
       WHERE r.status = ?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 200`
    )
    .bind(status)
    .all<ReviewRow>();
  return results ?? [];
}

export async function reviewById(db: D1Database, id: string): Promise<ReviewRow | null> {
  return await db.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first<ReviewRow>();
}

export async function setStatus(
  db: D1Database,
  id: string,
  status: ReviewStatus,
  now = Date.now()
): Promise<void> {
  await db
    .prepare('UPDATE reviews SET status = ?, updated_at = ?, approved_at = ? WHERE id = ?')
    .bind(status, now, status === 'approved' ? now : null, id)
    .run();
}

export async function setReply(
  db: D1Database,
  id: string,
  reply: string | null,
  now = Date.now()
): Promise<void> {
  const trimmed = reply && reply.trim() ? reply.trim().slice(0, 500) : null;
  await db
    .prepare('UPDATE reviews SET reply = ?, replied_at = ?, updated_at = ? WHERE id = ?')
    .bind(trimmed, trimmed ? now : null, now, id)
    .run();
}

export async function deleteReview(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();
}

export async function stats(
  db: D1Database
): Promise<{ total: number; pending: number; approved: number; rejected: number }> {
  const out = { total: 0, pending: 0, approved: 0, rejected: 0 };
  const { results } = await db
    .prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status')
    .all<{ status: ReviewStatus; n: number }>();
  for (const row of results ?? []) {
    out[row.status] = row.n;
    out.total += row.n;
  }
  return out;
}

/* --------------------------------------------------------------- rate limit */

/** SHA-256(salt + ip). The raw address is never stored. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip || 'unknown'}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface RateResult {
  ok: boolean;
  count: number;
  retryAfterMs: number;
}

/**
 * One atomic upsert, so two requests in the same millisecond cannot both slip
 * through a read-then-write window.
 */
export async function consumeRateLimit(
  db: D1Database,
  ipHash: string,
  max: number,
  now = Date.now()
): Promise<RateResult> {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (ip_hash, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(ip_hash, window_start) DO UPDATE SET count = count + 1
       RETURNING count`
    )
    .bind(ipHash, windowStart)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return {
    ok: count <= max,
    count,
    retryAfterMs: count <= max ? 0 : windowStart + WINDOW_MS - now
  };
}

/** Delete IP hashes older than 30 days. Called by the scheduled handler. */
export async function purgeOldRateLimits(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const result = await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cutoff).run();
  return result.meta.changes ?? 0;
}
