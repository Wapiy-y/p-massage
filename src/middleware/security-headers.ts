/** Baseline hardening headers applied to every response. */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();

  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  c.header('x-frame-options', 'DENY');
  c.header('permissions-policy', 'geolocation=(), microphone=(), camera=()');
};
