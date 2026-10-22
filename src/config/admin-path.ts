/**
 * The admin area lives at a secret, unguessable path.
 *
 * This is obscurity, not authorisation: it removes `/admin` from the set of
 * obvious URLs a scanner tries, nothing more. Authentication still has to hold
 * on its own — see services/admin-auth.ts.
 *
 * The slug is a Worker secret (not a committed var), so it is not published in
 * this repository, and the admin page is served by the Worker rather than as a
 * static file whose name would give it away.
 */
import type { Env } from '../types';

const PATTERN = /^[a-z0-9][a-z0-9-]{3,63}$/;

/** Returns the configured slug, or null when it is missing or malformed. */
export function adminSlug(env: Env): string | null {
  const raw = (env.ADMIN_SLUG ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return PATTERN.test(raw) ? raw : null;
}

/** Full page path, e.g. `/admin-7m4x2q`, or null when unconfigured. */
export function adminPagePath(env: Env): string | null {
  const slug = adminSlug(env);
  return slug ? `/${slug}` : null;
}

/** API prefix, e.g. `/api/admin-7m4x2q`, or null when unconfigured. */
export function adminApiPath(env: Env): string | null {
  const slug = adminSlug(env);
  return slug ? `/api/${slug}` : null;
}
