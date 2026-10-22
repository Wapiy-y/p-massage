/** Therapist-only HTTP surface: session handling and moderation. */
import { Hono } from 'hono';
import { LIMITS, LOGIN_WINDOW_MS } from '../config/limits';
import { checkPassphrase, buildCookie, clearCookie, issueSession } from '../lib/auth';
import { clientIp, isProduction, json, jsonWithCookie, readJson } from '../lib/http';
import { hashIp } from '../lib/ip-hash';
import * as rateLimitRepo from '../repositories/rate-limit';
import { authenticateAdmin, type AttemptCounter } from '../services/admin-auth';
import { hasAdminAccess, requireAdmin } from '../middleware/require-admin';
import { getEditableContent, updateContent } from '../services/profile';
import { deleteReview, moderationQueue, moderateReview } from '../services/reviews';
import { REVIEW_STATUSES, type AppEnv, type ReviewStatus } from '../types';

export const adminRoutes = new Hono<AppEnv>();

/* ------------------------------------------------------- session (no gate) */

adminRoutes.post('/api/admin/login', async (c) => {
  const body = await readJson(c, 2048);
  const expected = c.env.ADMIN_TOKEN ?? '';

  // Count failures per hashed caller, not per account: there is one account, so
  // throttling by caller is what actually slows a guessing attack.
  const key = `login:${await hashIp(clientIp(c), c.env.IP_SALT || 'dev-only-salt')}`;
  const counter: AttemptCounter = {
    peek: () => rateLimitRepo.peek(c.env.DB, key, LOGIN_WINDOW_MS),
    record: async () => {
      await rateLimitRepo.increment(c.env.DB, key, LOGIN_WINDOW_MS);
    }
  };

  const result = await authenticateAdmin({
    token: typeof body.token === 'string' ? body.token : '',
    expected,
    maxAttempts: LIMITS.loginAttemptMax,
    counter,
    verify: checkPassphrase
  });

  if (!result.ok) {
    if (result.reason === 'unconfigured') {
      return json(c, 500, { message: 'ADMIN_TOKEN is not configured.' });
    }
    if (result.reason === 'rate-limited') {
      const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60_000));
      const response = json(c, 429, {
        message: `Too many wrong passphrases. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      });
      response.headers.set('retry-after', String(Math.ceil(result.retryAfterMs / 1000)));
      return response;
    }
    return json(c, 401, { message: 'Wrong passphrase.' });
  }

  const { cookie, maxAge } = await issueSession(expected);
  return jsonWithCookie(200, { ok: true }, buildCookie(cookie, maxAge, isProduction(c)));
});

adminRoutes.post('/api/admin/logout', (c) =>
  jsonWithCookie(200, { ok: true }, clearCookie(isProduction(c)))
);

adminRoutes.get('/api/admin/session', async (c) =>
  json(c, 200, {
    authed: await hasAdminAccess(
      c.env,
      c.req.header('cookie'),
      c.req.header('cf-access-jwt-assertion')
    )
  })
);

/* ---------------------------------------------------- everything behind auth */

// Guarded routes live on their own router for readability only: the guard is
// attached per route rather than with use('*'), which on a sub-app mounted at
// '/' would also match unrelated paths and turn 404s into 401s.
const guarded = new Hono<AppEnv>();

guarded.get('/api/admin/reviews', requireAdmin, async (c) => {
  const status = (c.req.query('status') ?? 'pending') as ReviewStatus;
  if (!REVIEW_STATUSES.includes(status)) {
    return json(c, 400, { message: 'Unknown status.' });
  }

  const { items, counts } = await moderationQueue(c.env.DB, status);
  return json(c, 200, { items, stats: counts });
});

guarded.patch('/api/admin/reviews/:id', requireAdmin, async (c) => {
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

guarded.delete('/api/admin/reviews/:id', requireAdmin, async (c) => {
  const removed = await deleteReview(c.env.DB, c.req.param('id'));
  if (!removed) return json(c, 404, { message: 'Review not found.' });
  return json(c, 200, { ok: true });
});

guarded.get('/api/admin/profile', requireAdmin, async (c) =>
  json(c, 200, await getEditableContent(c.env.DB))
);

guarded.put('/api/admin/profile', requireAdmin, async (c) => {
  const body = await readJson(c, 32 * 1024);

  const result = await updateContent(c.env.DB, body);
  if (!result.ok) {
    return json(c, result.status, { errors: result.errors, message: 'Check the fields.' });
  }
  return json(c, 200, { ok: true });
});

adminRoutes.route('/', guarded);
