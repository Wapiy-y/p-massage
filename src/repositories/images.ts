/** Data access for image metadata. Objects themselves live in S3. */
import type { ImageKind, ImageRow } from '../types';

export async function insertPending(
  db: D1Database,
  input: {
    id: string;
    kind: ImageKind;
    objectKey: string;
    contentType: string;
    sort: number;
    createdAt: number;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (id, kind, object_key, content_type, sort, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(input.id, input.kind, input.objectKey, input.contentType, input.sort, input.createdAt)
    .run();
}

export async function markReady(
  db: D1Database,
  id: string,
  bytes: number,
  now = Date.now()
): Promise<void> {
  await db
    .prepare("UPDATE images SET status = 'ready', bytes = ?, updated_at = ? WHERE id = ?")
    .bind(bytes, now, id)
    .run();
}

export async function findById(db: D1Database, id: string): Promise<ImageRow | null> {
  return await db.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<ImageRow>();
}

export async function findByKey(db: D1Database, key: string): Promise<ImageRow | null> {
  return await db.prepare('SELECT * FROM images WHERE object_key = ?').bind(key).first<ImageRow>();
}

export async function listReady(db: D1Database, kind: ImageKind): Promise<ImageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM images
        WHERE kind = ? AND status = 'ready'
        ORDER BY sort, created_at
        LIMIT 20`
    )
    .bind(kind)
    .all<ImageRow>();
  return results ?? [];
}

export async function countReady(db: D1Database, kind: ImageKind): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM images WHERE kind = ? AND status = 'ready'")
    .bind(kind)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Slots in flight count against the limit, so two tabs cannot both take the last one. */
export async function countOccupied(db: D1Database, kind: ImageKind): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM images WHERE kind = ?')
    .bind(kind)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function nextSort(db: D1Database, kind: ImageKind): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM images WHERE kind = ?')
    .bind(kind)
    .first<{ next: number }>();
  return row?.next ?? 1;
}

export async function remove(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM images WHERE id = ?').bind(id).run();
}

/** Profile is a single image: clear the old one when a new upload lands. */
export async function listByKind(
  db: D1Database,
  kind: ImageKind,
  excludeId?: string
): Promise<ImageRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM images WHERE kind = ? AND id != ?')
    .bind(kind, excludeId ?? '')
    .all<ImageRow>();
  return results ?? [];
}

/** Uploads that were presigned but never confirmed. */
export async function listStalePending(db: D1Database, olderThan: number): Promise<ImageRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM images WHERE status = 'pending' AND created_at < ? LIMIT 50")
    .bind(olderThan)
    .all<ImageRow>();
  return results ?? [];
}
