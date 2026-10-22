/**
 * Worker entry point: assembles the app from the route layers and exposes the
 * scheduled handler. Everything below this file is framework-agnostic except
 * the route and middleware layers.
 */
import { Hono } from 'hono';
import { adminPagePath } from './config/admin-path';
import { PAGE_ALIASES } from './config/limits';
import adminPageHtml from './pages/admin.html';
import { json } from './lib/http';
import { securityHeaders } from './middleware/security-headers';
import { purgeExpired } from './repositories/rate-limit';
import { purgeStaleUploads } from './services/images';
import { s3Config } from './lib/s3';
import { adminRoutes } from './routes/admin';
import { imageRoutes } from './routes/images';
import { publicRoutes } from './routes/public';
import type { AppEnv } from './types';

export const app = new Hono<AppEnv>();

app.use('*', securityHeaders);

app.route('/', publicRoutes);
app.route('/', adminRoutes);
app.route('/', imageRoutes);

/** Unknown API paths must answer as JSON, not fall through to an HTML page. */
app.all('/api/*', (c) => json(c, 404, { message: 'Not found.' }));

/**
 * Static pages, plus the admin page at the secret slug.
 *
 * The admin HTML is bundled into the Worker rather than served from public/:
 * a static file would be reachable at a guessable path and its name would leak
 * the slug in this repository.
 */
app.get('*', (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

  if (path === adminPagePath(c.env)) {
    return new Response(adminPageHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow'
      }
    });
  }

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

  /**
   * Daily housekeeping: expired IP hashes, and uploads that were presigned but
   * never confirmed (so they stop holding gallery slots and storage).
   */
  scheduled(_controller: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(
      purgeExpired(env.DB).then((removed) => {
        console.log(`purged ${removed} rate-limit row(s)`);
      })
    );

    const config = s3Config(env);
    if (config) {
      ctx.waitUntil(
        purgeStaleUploads(env.DB, config).then((removed) => {
          console.log(`purged ${removed} stale upload(s)`);
        })
      );
    }
  }
} satisfies ExportedHandler<AppEnv['Bindings']>;
