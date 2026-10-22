/** Admin gate: Cloudflare Access header, or a valid signed session cookie. */
import type { MiddlewareHandler } from 'hono';
import { readSessionCookie, verifySession } from '../lib/auth';
import { json } from '../lib/http';
import type { AppEnv } from '../types';

export async function isAuthenticated(
  env: AppEnv['Bindings'],
  cookieHeader?: string
): Promise<boolean> {
  const secret = env.ADMIN_TOKEN;
  if (!secret) return false;
  return await verifySession(readSessionCookie(cookieHeader), secret);
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  // In production Cloudflare Access is the primary gate and sets this header.
  if (c.req.header('cf-access-jwt-assertion')) return await next();

  if (await isAuthenticated(c.env, c.req.header('cookie'))) return await next();

  return json(c, 401, { message: 'Not signed in.' });
};

/** True when Access or a valid cookie authorises the caller. */
export async function hasAdminAccess(
  env: AppEnv['Bindings'],
  cookieHeader?: string,
  accessHeader?: string
): Promise<boolean> {
  if (accessHeader) return true;
  return await isAuthenticated(env, cookieHeader);
}
