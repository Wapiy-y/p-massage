/**
 * Public image delivery. The bucket stays private: this route verifies that the
 * key belongs to a ready image and then streams it from S3 through the Worker.
 */
import { Hono } from 'hono';
import { s3Config, signedGet } from '../lib/s3';
import { httpError } from '../lib/http';
import * as imageRepo from '../repositories/images';
import type { AppEnv } from '../types';

export const imageRoutes = new Hono<AppEnv>();

imageRoutes.get('/img/:key', async (c) => {
  const config = s3Config(c.env);
  if (!config) throw httpError(503, 'Storage is not configured.');

  const key = c.req.param('key');
  const row = await imageRepo.findByKey(c.env.DB, key);
  if (!row || row.status !== 'ready') throw httpError(404, 'Not found.');

  // A cache hit skips S3 entirely; the key is content-addressed by id.
  const cache = caches.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await signedGet(config, key);
  if (!upstream.ok) throw httpError(502, 'Could not load the image.');

  const response = new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': row.content_type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff'
    }
  });

  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});
