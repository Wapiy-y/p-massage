/**
 * Therapist-only HTTP surface, mounted under the secret admin slug:
 * `/api/<slug>/login`, `/api/<slug>/reviews`, …
 *
 * A wrong or missing slug answers 404 — never 401 — so the endpoint does not
 * advertise that an admin area exists.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { adminSlug } from '../config/admin-path';
import { LIMITS, LOGIN_WINDOW_MS } from '../config/limits';
import { buildCookie, clearCookie, issueSession } from '../lib/auth';
import { clientIp, httpError, isProduction, json, jsonWithCookie, readJson } from '../lib/http';
import { hashIp } from '../lib/ip-hash';
import { verifyPassword } from '../lib/password';
import { hasAdminAccess, requireAdmin } from '../middleware/require-admin';
import * as adminRepo from '../repositories/admins';
import * as rateLimitRepo from '../repositories/rate-limit';
import { authenticateAdmin, type AttemptCounter } from '../services/admin-auth';
import { getEditableContent, updateContent } from '../services/profile';
import { deleteReview, moderationQueue, moderateReview } from '../services/reviews';
import { REVIEW_STATUSES, type AppEnv, type ReviewStatus } from '../types';

export const adminRoutes = new Hono<AppEnv>();

/** Reject any scope that is not the configured slug, indistinguishably from 404. */
const requireSlug: MiddlewareHandler<AppEnv> = async (c, next) => {
  const slug = adminSlug(c.env);
  if (!slug || c.req.param('scope') !== slug) {
    throw httpError(404, 'Not found.');
  }
  await next();
};

/** Signing key for session cookies. ADMIN_TOKEN is the historical name. */
function sessionSecret(env: AppEnv['Bindings']): string | null {
  return env.SESSION_SECRET || env.ADMIN_TOKEN || null;
}

adminRoutes.use('/api/:scope/*', requireSlug);

/* ------------------------------------------------------- session (no gate) */

adminRoutes.post('/api/:scope/login', async (c) => {
  const secret = sessionSecret(c.env);
  if (!secret) throw httpError(500, 'Server is not configured.');

  const body = await readJson(c, 2048);
  const key = `login:${await hashIp(clientIp(c), c.env.IP_SALT || 'dev-only-salt')}`;

  const counter: AttemptCounter = {
    peek: () => rateLimitRepo.peek(c.env.DB, key, LOGIN_WINDOW_MS),
    record: async () => {
      await rateLimitRepo.increment(c.env.DB, key, LOGIN_WINDOW_MS);
    }
  };

  const result = await authenticateAdmin({
    username: typeof body.username === 'string' ? body.username : '',
    password: typeof body.password === 'string' ? body.password : '',
    maxAttempts: LIMITS.loginAttemptMax,
    counter,
    lookup: (username) => adminRepo.findByUsername(c.env.DB, username),
    verify: verifyPassword
  });

  if (!result.ok) {
    if (result.reason === 'rate-limited') {
      const minutes = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 60_000));
      const response = json(c, 429, {
        message: `Too many failed sign-ins. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      });
      response.headers.set('retry-after', String(Math.ceil((result.retryAfterMs ?? 0) / 1000)));
      return response;
    }
    return json(c, 401, { message: 'Wrong username or password.' });
  }

  const { cookie, maxAge } = await issueSession(secret);
  return jsonWithCookie(200, { ok: true }, buildCookie(cookie, maxAge, isProduction(c)));
});

adminRoutes.post('/api/:scope/logout', (c) =>
  jsonWithCookie(200, { ok: true }, clearCookie(isProduction(c)))
);

adminRoutes.get('/api/:scope/session', async (c) =>
  json(c, 200, {
    authed: await hasAdminAccess(
      sessionSecret(c.env),
      c.req.header('cookie'),
      c.req.header('cf-access-jwt-assertion')
    )
  })
);

/* ---------------------------------------------------- everything behind auth */

const guarded = new Hono<AppEnv>();

guarded.get('/api/:scope/reviews', requireAdmin, async (c) => {
  const status = (c.req.query('status') ?? 'pending') as ReviewStatus;
  if (!REVIEW_STATUSES.includes(status)) {
    return json(c, 400, { message: 'Unknown status.' });
  }

  const { items, counts } = await moderationQueue(c.env.DB, status);
  return json(c, 200, { items, stats: counts });
});

guarded.patch('/api/:scope/reviews/:id', requireAdmin, async (c) => {
  const body = await readJson(c, 4096);

  const changes: { status?: ReviewStatus; reply?: string | null } = {};
  if ('status' in body) {
    const status = body.status as ReviewStatus;
    if (!REVIEW_STATUSES.includes(status)) {
      return json(c, 400, { message: 'Unknown status.' });
    }
    changes.status = status;
  }
  if ('reply' in body) {
    changes.reply = typeof body.reply === 'string' ? body.reply : null;
  }

  const result = await moderateReview(c.env.DB, c.req.param('id'), changes);
  if (!result.ok) return json(c, result.status, { message: result.errors._form });

  return json(c, 200, { ok: true, review: result.value });
});

guarded.delete('/api/:scope/reviews/:id', requireAdmin, async (c) => {
  const removed = await deleteReview(c.env.DB, c.req.param('id'));
  if (!removed) return json(c, 404, { message: 'Review not found.' });
  return json(c, 200, { ok: true });
});

guarded.get('/api/:scope/profile', requireAdmin, async (c) =>
  json(c, 200, await getEditableContent(c.env.DB))
);

guarded.put('/api/:scope/profile', requireAdmin, async (c) => {
  const body = await readJson(c, 32 * 1024);

  const result = await updateContent(c.env.DB, body);
  if (!result.ok) {
    return json(c, result.status, { errors: result.errors, message: 'Check the fields.' });
  }
  return json(c, 200, { ok: true });
});

adminRoutes.route('/', guarded);
