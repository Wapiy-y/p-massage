/** HTTP helpers shared by the route layer. Framework-aware, business-free. */
import type { Context } from 'hono';
import { LIMITS } from '../config/limits';
import type { AppEnv } from '../types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

export function json(c: Context<AppEnv>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'cache-control': 'no-store' }
  });
}

/** A JSON response that also sets a cookie — used by login and logout. */
export function jsonWithCookie(status: number, body: unknown, cookie: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'cache-control': 'no-store', 'set-cookie': cookie }
  });
}

/**
 * Parse a JSON object body, refusing anything oversized or non-object.
 * Throws an Error carrying `status` so the app-level error handler can map it.
 */
export async function readJson(
  c: Context<AppEnv>,
  limit = LIMITS.bodyMax
): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > limit) throw httpError(413, 'Payload too large');

  const raw = await c.req.text();
  if (raw.length > limit) throw httpError(413, 'Payload too large');
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw httpError(400, 'Invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw httpError(400, 'Expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Cloudflare sets `cf-connecting-ip`; the fallback keeps local dev usable. */
export function clientIp(c: Context<AppEnv>): string {
  const direct = c.req.header('cf-connecting-ip');
  if (direct) return direct;
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return 'unknown';
}

/**
 * Local development runs on localhost; everything else is treated as
 * production, which is what makes secrets fail closed.
 */
export function isProduction(c: Context<AppEnv>): boolean {
  return !new URL(c.req.url).hostname.startsWith('localhost');
}
