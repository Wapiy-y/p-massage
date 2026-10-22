/**
 * Worker entry point: assembles the app from the route layers and exposes the
 * scheduled handler. Everything below this file is framework-agnostic except
 * the route and middleware layers.
 */
import { Hono } from 'hono';
import { PAGE_ALIASES } from './config/limits';
import { json } from './lib/http';
import { securityHeaders } from './middleware/security-headers';
import { purgeExpired } from './repositories/rate-limit';
import { adminRoutes } from './routes/admin';
import { publicRoutes } from './routes/public';
import type { AppEnv } from './types';

export const app = new Hono<AppEnv>();

app.use('*', securityHeaders);

app.route('/', publicRoutes);
app.route('/', adminRoutes);

/** Unknown API paths must answer as JSON, not fall through to an HTML page. */
app.all('/api/*', (c) => json(c, 404, { message: 'Not found.' }));

/** Clean URLs for the static pages (/feedback → /feedback.html). */
app.get('*', (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const alias = PAGE_ALIASES[path];

  if (alias) {
    return c.env.ASSETS.fetch(new Request(new URL(alias, url.origin).toString(), c.req.raw));
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  const status = (error as Error & { status?: number }).status ?? 500;
  if (status >= 500) console.error('unhandled error', error);

  return json(c, status, {
    message: status >= 500 ? 'Something went wrong.' : error.message
  });
});

app.notFound((c) => json(c, 404, { message: 'Not found.' }));

export default {
  fetch: app.fetch,

  /** Daily IP-hash purge — the cron trigger a Pages Function cannot have. */
  scheduled(_controller: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(
      purgeExpired(env.DB).then((removed) => {
        console.log(`purged ${removed} rate-limit row(s)`);
      })
    );
  }
} satisfies ExportedHandler<AppEnv['Bindings']>;
