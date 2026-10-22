/**
 * Fixed-window counters keyed by a scoped, hashed visitor identity.
 *
 * Keys are namespaced by the caller (`review:<hash>`, `login:<hash>`) so one
 * kind of limit cannot consume another's budget.
 *
 * Every write is a single atomic upsert: a read-then-write pair would let two
 * concurrent requests both slip under the limit.
 */
import { IP_HASH_RETENTION_MS } from '../config/limits';
import type { RateLimitResult } from '../types';

export interface WindowState {
  count: number;
  /** Milliseconds until the current window resets. */
  retryAfterMs: number;
}

function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/** Read the current count without recording an attempt. */
export async function peek(
  db: D1Database,
  key: string,
  windowMs: number,
  now = Date.now()
): Promise<WindowState> {
  const windowStart = windowStartFor(now, windowMs);
  const row = await db
    .prepare('SELECT count FROM rate_limits WHERE ip_hash = ? AND window_start = ?')
    .bind(key, windowStart)
    .first<{ count: number }>();

  return {
    count: row?.count ?? 0,
    retryAfterMs: windowStart + windowMs - now
  };
}

/** Record one attempt and return the new count. */
export async function increment(
  db: D1Database,
  key: string,
  windowMs: number,
  now = Date.now()
): Promise<number> {
  const windowStart = windowStartFor(now, windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (ip_hash, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(ip_hash, window_start) DO UPDATE SET count = count + 1
       RETURNING count`
    )
    .bind(key, windowStart)
    .first<{ count: number }>();

  return row?.count ?? 1;
}

/** Increment and report whether the caller is still within `max`. */
export async function consume(
  db: D1Database,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now()
): Promise<RateLimitResult> {
  const count = await increment(db, key, windowMs, now);
  const windowStart = windowStartFor(now, windowMs);

  return {
    ok: count <= max,
    count,
    retryAfterMs: count <= max ? 0 : windowStart + windowMs - now
  };
}

/** Delete rows whose window closed longer than the retention period ago. */
export async function purgeExpired(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - IP_HASH_RETENTION_MS;
  const result = await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ?')
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}
