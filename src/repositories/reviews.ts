/** Data access for reviews. No business rules live here. */
import type {
  ModerationCounts,
  PublicReview,
  ReviewListOptions,
  ReviewRow,
  ReviewStatus,
  Summary
} from '../types';
import { LIMITS } from '../config/limits';

/** Columns safe to expose publicly. */
const PUBLIC_COLUMNS = `
  r.id, r.rating, r.service_id, s.name AS service_name, r.nickname,
  r.message, r.reply, r.replied_at, r.created_at
`;

function toPublicReview(row: ReviewRow): PublicReview {
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

export interface InsertReviewInput {
  id: string;
  rating: number;
  service_id: string | null;
  nickname: string;
  message: string;
  ip_hash: string;
  created_at: number;
}

export async function insertReview(db: D1Database, input: InsertReviewInput): Promise<void> {
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

/**
 * Published reviews, newest first, keyset paginated on (created_at, id).
 *
 * The cursor is `<created_at>.<id>`: a dot, because ids contain underscores and
 * splitting on `_` would corrupt the id and silently skip same-millisecond rows.
 */
export async function listPublished(
  db: D1Database,
  options: ReviewListOptions = {}
): Promise<{ items: PublicReview[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? LIMITS.pageSize, 1), LIMITS.pageSizeMax);
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
    const createdAt = dot > 0 ? Number(cursor.slice(0, dot)) : Number.NaN;
    const id = dot > 0 ? cursor.slice(dot + 1) : '';

    if (Number.isFinite(createdAt) && id) {
      where.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
      params.push(createdAt, createdAt, id);
    }
  }

  const { results } = await db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}
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
  const items = rows.slice(0, limit).map(toPublicReview);
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? `${last.created_at}.${last.id}` : null
  };
}

export async function summarise(db: D1Database): Promise<Summary> {
  const { results } = await db
    .prepare("SELECT rating, COUNT(*) AS n FROM reviews WHERE status = 'approved' GROUP BY rating")
    .all<{ rating: number; n: number }>();

  const distribution: Summary['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let total = 0;

  for (const row of results ?? []) {
    const key = row.rating as 1 | 2 | 3 | 4 | 5;
    distribution[key] = row.n;
    count += row.n;
    total += row.rating * row.n;
  }

  return {
    count,
    average: count ? Math.round((total / count) * 10) / 10 : 0,
    distribution
  };
}

export async function listByStatus(db: D1Database, status: ReviewStatus): Promise<ReviewRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, s.name AS service_name
         FROM reviews r
         LEFT JOIN services s ON s.id = r.service_id
        WHERE r.status = ?
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?`
    )
    .bind(status, LIMITS.moderationPageSize)
    .all<ReviewRow>();

  return results ?? [];
}

export async function findById(db: D1Database, id: string): Promise<ReviewRow | null> {
  return await db.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first<ReviewRow>();
}

export async function updateStatus(
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

export async function updateReply(
  db: D1Database,
  id: string,
  reply: string | null,
  now = Date.now()
): Promise<void> {
  await db
    .prepare('UPDATE reviews SET reply = ?, replied_at = ?, updated_at = ? WHERE id = ?')
    .bind(reply, reply ? now : null, now, id)
    .run();
}

export async function deleteById(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();
}

export async function countByStatus(db: D1Database): Promise<ModerationCounts> {
  const counts: ModerationCounts = { total: 0, pending: 0, approved: 0, rejected: 0 };
  const { results } = await db
    .prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status')
    .all<{ status: ReviewStatus; n: number }>();

  for (const row of results ?? []) {
    counts[row.status] = row.n;
    counts.total += row.n;
  }
  return counts;
}
