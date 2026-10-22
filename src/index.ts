import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { Env, ReviewStatus } from './types';
import {
  consumeRateLimit,
  deleteReview,
  getProfile,
  getServices,
  hashIp,
  insertReview,
  listApproved,
  listForAdmin,
  purgeOldRateLimits,
  rateLimitMax,
  reviewById,
  saveProfile,
  saveServices,
  setReply,
  setStatus,
  stats,
  summary
} from './db';
import { LIMITS, validateProfile, validateReview, validateServices } from './validation';
import {
  buildCookie,
  checkPassphrase,
  clearCookie,
  issueSession,
  parseCookies,
  verifySession
} from './auth';
import { verifyTurnstile } from './turnstile';

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

/* ------------------------------------------------------------------ helpers */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(c: Context<AppEnv>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, 'cache-control': 'no-store' } });
}

function clientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function isProduction(c: Context<AppEnv>): boolean {
  return !new URL(c.req.url).hostname.startsWith('localhost');
}

async function readJson(c: Context<AppEnv>, limit = LIMITS.bodyMax): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
  const raw = await c.req.text();
  if (raw.length > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw Object.assign(new Error('Expected a JSON object'), { status: 400 });
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function newId(): string {
  const time = Date.now().toString(36);
  const random = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `r_${time}${random}`;
}

const SESSION_COOKIE = 'sid';

async function isAdmin(c: Context<AppEnv>): Promise<boolean> {
  // Cloudflare Access in front of the route is the primary gate.
  if (c.req.header('cf-access-jwt-assertion')) return true;
  const secret = c.env.ADMIN_TOKEN;
  if (!secret) return false;
  const cookie = parseCookies(c.req.header('cookie'))[SESSION_COOKIE];
  return await verifySession(cookie, secret);
}

async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (!(await isAdmin(c))) return json(c, 401, { message: 'Not signed in.' });
  await next();
}

/* ------------------------------------------------------------------ headers */

app.use('*', async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  c.header('x-frame-options', 'DENY');
  c.header('permissions-policy', 'geolocation=(), microphone=(), camera=()');
});

/* ------------------------------------------------------------------- public */

app.get('/api/config', (c) =>
  json(c, 200, {
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
    message_min: LIMITS.messageMin,
    message_max: LIMITS.messageMax,
    nickname_max: LIMITS.nicknameMax,
    rate_max: rateLimitMax(c.env)
  })
);

app.get('/api/profile', async (c) => {
  const [profile, services] = await Promise.all([getProfile(c.env.DB), getServices(c.env.DB)]);
  return json(c, 200, { profile, services });
});

app.get('/api/reviews/summary', async (c) => json(c, 200, await summary(c.env.DB)));

app.get('/api/reviews', async (c) => {
  const ratingRaw = Number(c.req.query('rating'));
  const rating = Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null;
  const limit = Number(c.req.query('limit')) || 20;
  const result = await listApproved(c.env.DB, {
    cursor: c.req.query('cursor') ?? null,
    rating,
    service: c.req.query('service') ?? null,
    limit
  });
  return json(c, 200, result);
});

app.post('/api/reviews', async (c) => {
  const body = await readJson(c);
  const ip = clientIp(c);

  // 1. Turnstile
  const challenge = await verifyTurnstile(
    body.turnstile_token,
    c.env.TURNSTILE_SECRET,
    ip,
    isProduction(c)
  );
  if (!challenge.ok) return json(c, 400, { errors: { _form: challenge.reason } });

  // 2. Honeypot + 3. validation
  const services = await getServices(c.env.DB);
  const checked = validateReview(body, { serviceIds: services.map((s) => s.id) });
  if (!checked.ok) {
    const spam = checked.errors._spam;
    return json(c, spam ? 400 : 422, {
      errors: checked.errors,
      message: spam ? spam : 'Please check the highlighted fields.'
    });
  }

  // 4. Rate limit on a salted hash only
  const salt = c.env.IP_SALT ?? '';
  if (!salt && isProduction(c)) {
    return json(c, 500, { errors: { _form: 'Server is not configured.' } });
  }
  const ipHash = await hashIp(ip, salt || 'dev-only-salt');
  const max = rateLimitMax(c.env);
  const limit = await consumeRateLimit(c.env.DB, ipHash, max);
  if (!limit.ok) {
    const minutes = Math.ceil(limit.retryAfterMs / 60000);
    return new Response(
      JSON.stringify({
        errors: {
          _form: `You have already sent ${max} reviews in the last hour. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
        }
      }),
      {
        status: 429,
        headers: {
          ...JSON_HEADERS,
          'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)),
          'cache-control': 'no-store'
        }
      }
    );
  }

  const id = newId();
  await insertReview(c.env.DB, { id, ...checked.value, ip_hash: ipHash, created_at: Date.now() });
  return json(c, 201, { ok: true, id, status: 'pending' });
});

/* -------------------------------------------------------------------- admin */

app.post('/api/admin/login', async (c) => {
  const body = await readJson(c, 2048);
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return json(c, 500, { message: 'ADMIN_TOKEN is not configured.' });

  if (typeof body.token !== 'string' || !(await checkPassphrase(body.token, expected))) {
    return json(c, 401, { message: 'Wrong passphrase.' });
  }
  const { cookie, maxAge } = await issueSession(expected);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'cache-control': 'no-store',
      'set-cookie': buildCookie(cookie, maxAge, isProduction(c))
    }
  });
});

app.post('/api/admin/logout', (c) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'cache-control': 'no-store',
      'set-cookie': clearCookie(isProduction(c))
    }
  });
});

app.get('/api/admin/session', async (c) => json(c, 200, { authed: await isAdmin(c) }));

app.use('/api/admin/*', requireAdmin);

app.get('/api/admin/reviews', async (c) => {
  const status = (c.req.query('status') ?? 'pending') as ReviewStatus;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return json(c, 400, { message: 'Unknown status.' });
  }
  const [items, counts] = await Promise.all([
    listForAdmin(c.env.DB, status),
    stats(c.env.DB)
  ]);
  return json(c, 200, { items, stats: counts });
});

app.patch('/api/admin/reviews/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await reviewById(c.env.DB, id);
  if (!existing) return json(c, 404, { message: 'Review not found.' });

  const body = await readJson(c, 4096);
  if ('status' in body) {
    const status = body.status as ReviewStatus;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return json(c, 400, { message: 'Unknown status.' });
    }
    await setStatus(c.env.DB, id, status);
  }
  if ('reply' in body) {
    await setReply(c.env.DB, id, typeof body.reply === 'string' ? body.reply : null);
  }
  return json(c, 200, { ok: true, review: await reviewById(c.env.DB, id) });
});

app.delete('/api/admin/reviews/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await reviewById(c.env.DB, id))) return json(c, 404, { message: 'Review not found.' });
  await deleteReview(c.env.DB, id);
  return json(c, 200, { ok: true });
});

app.get('/api/admin/profile', async (c) => {
  const [profile, services] = await Promise.all([
    getProfile(c.env.DB),
    getServices(c.env.DB, { activeOnly: false })
  ]);
  return json(c, 200, { profile, services });
});

app.put('/api/admin/profile', async (c) => {
  const body = await readJson(c, 32 * 1024);
  const checked = validateProfile(body.profile ?? body);
  if (!checked.ok) return json(c, 422, { errors: checked.errors, message: 'Check the fields.' });

  await saveProfile(c.env.DB, checked.value);
  if (Array.isArray(body.services)) {
    await saveServices(c.env.DB, validateServices(body.services));
  }
  return json(c, 200, { ok: true });
});

app.post('/api/admin/purge', async (c) => {
  const removed = await purgeOldRateLimits(c.env.DB);
  return json(c, 200, { ok: true, removed });
});

/* ------------------------------------------------------------------- assets */

const PAGE_ALIASES: Record<string, string> = {
  '/feedback': '/feedback.html',
  '/admin': '/admin.html',
  '/privacy': '/privacy.html'
};

// Unknown /api routes should 404 as JSON, not fall through to an HTML page.
app.all('/api/*', (c) => json(c, 404, { message: 'Not found.' }));

// Clean URLs for the static pages.
app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const alias = PAGE_ALIASES[path];
  if (alias) {
    const assetUrl = new URL(alias, url.origin);
    return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

/* ------------------------------------------------------------------ errors */

app.onError((error, c) => {
  const status = (error as Error & { status?: number }).status ?? 500;
  if (status >= 500) console.error('unhandled', error);
  return json(c, status, {
    message: status >= 500 ? 'Something went wrong.' : (error as Error).message
  });
});

app.notFound((c) => json(c, 404, { message: 'Not found.' }));

/* ------------------------------------------------------------------ worker */

export default {
  fetch: app.fetch,

  /** 30-day IP-hash purge — the cron trigger a Pages Function cannot have. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      purgeOldRateLimits(env.DB).then((removed) => {
        console.log(`purged ${removed} rate-limit row(s)`);
      })
    );
  }
} satisfies ExportedHandler<Env>;

export { app };
