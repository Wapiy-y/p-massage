'use strict';
/**
 * DEPRECATED — superseded by the Cloudflare Worker in src/index.ts (Hono + D1).
 * Kept only as a reference for the original dependency-free Node implementation.
 * Nothing runs this file: `npm run dev` starts the Worker, `npm test` runs Vitest.
 */

/**
 * Zero-dependency HTTP server.
 * Route shapes match the plan's API table exactly so the Cloudflare Workers/D1
 * port is a binding swap: db.* -> await d1.prepare(...).bind(...).all()
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const store = require('./db');
const { validateReview, validateProfile, LIMITS } = require('./validation');

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const isProd = process.env.NODE_ENV === 'production';

/* --------------------------------------------------------------- utilities */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}

function readBody(req, limit = LIMITS.bodyMax) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* -------------------------------------------------------- admin sessions */
/* Locally replaced by Cloudflare Access in production (Cf-Access-Jwt-Assertion). */

const sessions = new Map(); // sid -> expiresAt
const SESSION_TTL = 12 * 60 * 60 * 1000;

function issueSession(res) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, Date.now() + SESSION_TTL);
  res.setHeader(
    'set-cookie',
    `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${isProd ? '; Secure' : ''}`
  );
  return sid;
}

function isAdmin(req) {
  // In production behind Cloudflare Access this header is authoritative.
  if (req.headers['cf-access-jwt-assertion']) return true;
  const sid = parseCookies(req).sid;
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(sid);
    return false;
  }
  return true;
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ------------------------------------------------------------- turnstile */

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: 'Missing challenge token.' };
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token) });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body
    });
    const data = await r.json();
    return data.success ? { ok: true } : { ok: false, reason: 'Challenge failed. Please retry.' };
  } catch {
    // Fail closed in production, open locally so the demo never bricks.
    return isProd ? { ok: false, reason: 'Could not verify challenge.' } : { ok: true, skipped: true };
  }
}

/* ----------------------------------------------------------------- routes */

function newId() {
  const t = Date.now();
  return `r_${t.toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

async function handleApi(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  /* ---- public ---- */

  if (p === '/api/config' && method === 'GET') {
    return json(res, 200, {
      turnstile_site_key: TURNSTILE_SITE_KEY || null,
      message_min: LIMITS.messageMin,
      message_max: LIMITS.messageMax,
      nickname_max: LIMITS.nicknameMax,
      rate_max: store.RATE_MAX
    });
  }

  if (p === '/api/profile' && method === 'GET') {
    return json(res, 200, {
      profile: store.getProfileRow(),
      services: store.getServices()
    });
  }

  if (p === '/api/reviews/summary' && method === 'GET') {
    return json(res, 200, store.summary());
  }

  if (p === '/api/reviews' && method === 'GET') {
    const rating = Number(url.searchParams.get('rating')) || null;
    const service = url.searchParams.get('service') || null;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 50);
    const result = store.listApproved({
      cursor: url.searchParams.get('cursor'),
      rating: rating && rating >= 1 && rating <= 5 ? rating : null,
      service,
      limit
    });
    return json(res, 200, result);
  }

  if (p === '/api/reviews' && method === 'POST') {
    const body = await readBody(req);
    const ip = clientIp(req);

    // 1. Turnstile
    const challenge = await verifyTurnstile(body.turnstile_token, ip);
    if (!challenge.ok) return json(res, 400, { errors: { _form: challenge.reason } });

    // 2. Honeypot + 3. validation
    const services = store.getServices().map((s) => s.id);
    const checked = validateReview(body, { serviceIds: services });
    if (!checked.ok) {
      const spam = checked.errors._spam;
      return json(res, spam ? 400 : 422, {
        errors: checked.errors,
        message: spam ? checked.errors._spam : 'Please check the highlighted fields.'
      });
    }

    // 4. Rate limit (salted hash only — the raw IP is never stored)
    const ipHash = store.hashIp(ip);
    const limit = store.consumeRateLimit(ipHash);
    if (!limit.ok) {
      const mins = Math.ceil(limit.retryAfterMs / 60000);
      return json(
        res,
        429,
        {
          errors: {
            _form: `You have already sent ${store.RATE_MAX} reviews in the last hour. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`
          }
        },
        { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) }
      );
    }

    const id = newId();
    store.insertReview({ id, ...checked.value, ip_hash: ipHash, created_at: Date.now() });
    return json(res, 201, { ok: true, id, status: 'pending' });
  }

  /* ---- admin ---- */

  if (p === '/api/admin/login' && method === 'POST') {
    const body = await readBody(req, 2048);
    if (!timingSafeEqualStr(body.token || '', ADMIN_TOKEN)) {
      return json(res, 401, { message: 'Wrong passphrase.' });
    }
    issueSession(res);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/admin/logout' && method === 'POST') {
    const sid = parseCookies(req).sid;
    if (sid) sessions.delete(sid);
    res.setHeader('set-cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (p === '/api/admin/session' && method === 'GET') {
    return json(res, 200, { authed: isAdmin(req) });
  }

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return json(res, 401, { message: 'Not signed in.' });

    if (p === '/api/admin/reviews' && method === 'GET') {
      const status = url.searchParams.get('status') || 'pending';
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return json(res, 400, { message: 'Unknown status.' });
      }
      return json(res, 200, { items: store.listForAdmin(status), stats: store.stats() });
    }

    const m = p.match(/^\/api\/admin\/reviews\/([A-Za-z0-9_]+)$/);
    if (m) {
      const id = m[1];
      const existing = store.reviewById(id);
      if (!existing) return json(res, 404, { message: 'Review not found.' });

      if (method === 'DELETE') {
        store.deleteReview(id);
        return json(res, 200, { ok: true });
      }
      if (method === 'PATCH') {
        const body = await readBody(req, 4096);
        if ('status' in body) {
          if (!['pending', 'approved', 'rejected'].includes(body.status)) {
            return json(res, 400, { message: 'Unknown status.' });
          }
          store.setStatus(id, body.status);
        }
        if ('reply' in body) {
          store.setReply(id, body.reply);
        }
        return json(res, 200, { ok: true, review: store.reviewById(id) });
      }
    }

    if (p === '/api/admin/profile' && method === 'GET') {
      return json(res, 200, {
        profile: store.getProfileRow(),
        services: store.getServices({ activeOnly: false })
      });
    }

    if (p === '/api/admin/profile' && method === 'PUT') {
      const body = await readBody(req, 32 * 1024);
      const checked = validateProfile(body.profile || body);
      if (!checked.ok) return json(res, 422, { errors: checked.errors, message: 'Check the fields.' });
      store.saveProfile(checked.value);
      if (Array.isArray(body.services)) {
        const clean = body.services
          .filter((s) => s && s.name)
          .map((s, i) => ({
            id: String(s.id || s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40),
            name: String(s.name).slice(0, 80),
            duration_min: Number(s.duration_min) || null,
            price_rm: Number(s.price_rm) || null,
            sort: i + 1
          }));
        store.saveServices(clean);
      }
      return json(res, 200, { ok: true });
    }

    if (p === '/api/admin/purge' && method === 'POST') {
      const removed = store.purgeOldRateLimits();
      return json(res, 200, { ok: true, removed });
    }

    return json(res, 404, { message: 'Unknown admin route.' });
  }

  return json(res, 404, { message: 'Not found.' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  if (rel === '/feedback') rel = '/feedback.html';

  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Clean URLs: /privacy -> /privacy.html
      const alt = path.join(PUBLIC_DIR, `${rel}.html`);
      if (alt.startsWith(PUBLIC_DIR) && fs.existsSync(alt)) {
        return fs.readFile(alt, (e2, d2) => {
          if (e2) {
            res.writeHead(404).end('Not found');
            return;
          }
          res.writeHead(200, { 'content-type': MIME['.html'] }).end(d2);
        });
      }
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>Page not found</h1><p><a href="/">Back to the homepage</a></p>');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url);
    } else {
      res.writeHead(405).end('Method not allowed');
    }
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('[error]', err);
    if (!res.headersSent) json(res, status, { message: status === 500 ? 'Something went wrong.' : err.message });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`massage-feedback listening on http://localhost:${PORT}`);
  console.log(`  db: ${store.DB_PATH}`);
  console.log(`  admin passphrase: ${ADMIN_TOKEN}${ADMIN_TOKEN === 'admin123' ? '  (default — set ADMIN_TOKEN)' : ''}`);
  console.log(`  turnstile: ${TURNSTILE_SECRET ? 'enabled' : 'disabled (dev)'}`);
});

// Lazy daily purge replaces the cron trigger until the Worker exists.
setInterval(() => store.purgeOldRateLimits(), 24 * 60 * 60 * 1000).unref();
