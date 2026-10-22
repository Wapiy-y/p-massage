/**
 * Fixed-window counters keyed by hashed visitor identity.
 *
 * One atomic upsert: a read-then-write pair would let two concurrent requests
 * both pass the limit.
 */
import { IP_HASH_RETENTION_MS, RATE_LIMIT_WINDOW_MS } from '../config/limits';
import type { RateLimitResult } from '../types';

export async function consume(
  db: D1Database,
  ipHash: string,
  max: number,
  now = Date.now()
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;

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
    retryAfterMs: count <= max ? 0 : windowStart + RATE_LIMIT_WINDOW_MS - now
  };
}

/** Delete expired windows. Returns the number of rows removed. */
export async function purgeExpired(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - IP_HASH_RETENTION_MS;
  const result = await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ?')
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}
