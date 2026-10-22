/** Public HTTP surface: what the page and the feedback form call. */
import { Hono } from 'hono';
import { LIMITS } from '../config/limits';
import { hashIp } from '../lib/ip-hash';
import { clientIp, httpError, isProduction, json, readJson } from '../lib/http';
import { verifyTurnstile } from '../lib/turnstile';
import { getPublicContent } from '../services/profile';
import { listPublishedReviews, reviewSummary, submitReview } from '../services/reviews';
import type { AppEnv } from '../types';

export const publicRoutes = new Hono<AppEnv>();

/** Limits and the Turnstile site key, consumed by the feedback form. */
publicRoutes.get('/api/config', (c) =>
  json(c, 200, {
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
    message_min: LIMITS.messageMin,
    message_max: LIMITS.messageMax,
    nickname_max: LIMITS.nicknameMax,
    rate_max: rateLimitMaxOf(c.env)
  })
);

publicRoutes.get('/api/profile', async (c) => json(c, 200, await getPublicContent(c.env.DB)));

publicRoutes.get('/api/reviews/summary', async (c) => json(c, 200, await reviewSummary(c.env.DB)));

publicRoutes.get('/api/reviews', async (c) => {
  const ratingParam = Number(c.req.query('rating'));
  const rating =
    Number.isInteger(ratingParam) && ratingParam >= 1 && ratingParam <= 5 ? ratingParam : null;

  const page = await listPublishedReviews(c.env.DB, {
    cursor: c.req.query('cursor') ?? null,
    rating,
    service: c.req.query('service') ?? null,
    limit: Number(c.req.query('limit')) || LIMITS.pageSize
  });

  return json(c, 200, page);
});

publicRoutes.post('/api/reviews', async (c) => {
  const body = await readJson(c);
  const ip = clientIp(c);

  const challenge = await verifyTurnstile(
    body.turnstile_token,
    c.env.TURNSTILE_SECRET,
    ip,
    isProduction(c)
  );
  if (!challenge.ok) {
    return json(c, 400, { errors: { _form: challenge.reason } });
  }

  const salt = c.env.IP_SALT;
  if (!salt && isProduction(c)) {
    // Refuse rather than serve an unprotected form.
    throw httpError(500, 'Server is not configured.');
  }

  const result = await submitReview(c.env.DB, {
    body,
    ipHash: await hashIp(ip, salt || 'dev-only-salt'),
    rateLimitMax: rateLimitMaxOf(c.env)
  });

  if (!result.ok) {
    const response = json(c, result.status, {
      errors: result.errors,
      message: result.errors._form ?? 'Please check the highlighted fields.'
    });
    if (result.status === 429) {
      response.headers.set('retry-after', '3600');
    }
    return response;
  }

  return json(c, 201, { ok: true, id: result.value.id, status: 'pending' });
});

function rateLimitMaxOf(env: AppEnv['Bindings']): number {
  const parsed = Number(env.RATE_LIMIT_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LIMITS.rateLimitMax;
}
