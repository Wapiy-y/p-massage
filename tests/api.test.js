'use strict';
/**
 * DEPRECATED — superseded by the Cloudflare Worker in src/index.ts (Hono + D1).
 * Kept only as a reference for the original dependency-free Node implementation.
 * Nothing runs this file: `npm run dev` starts the Worker, `npm test` runs Vitest.
 */

/**
 * Smoke tests for the rules that matter: validation, honeypot and rate limiting.
 * Run: node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Isolated database per test run.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mfb-'));
process.env.RATE_LIMIT_MAX = '3';
process.env.IP_SALT = 'test-salt';

const store = require('../src/db');
const { validateReview, validateProfile } = require('../src/validation');

const base = {
  rating: 5,
  message: 'A perfectly reasonable length message.',
  consent: true,
  elapsed_ms: 4000
};

test('accepts a complete review', () => {
  const r = validateReview(base, { serviceIds: ['traditional'] });
  assert.equal(r.ok, true);
  assert.equal(r.value.nickname, 'Anonymous');
});

test('rejects missing rating, short message and missing consent', () => {
  const r = validateReview({ message: 'short', elapsed_ms: 4000 }, {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.rating);
  assert.ok(r.errors.message);
  assert.ok(r.errors.consent);
});

test('rejects a message over 1000 characters', () => {
  const r = validateReview({ ...base, message: 'x'.repeat(1001) }, {});
  assert.equal(r.ok, false);
  assert.match(r.errors.message, /under 1000/);
});

test('trims and caps the nickname, defaults when blank', () => {
  const r = validateReview({ ...base, nickname: '   ' }, {});
  assert.equal(r.value.nickname, 'Anonymous');
  const r2 = validateReview({ ...base, nickname: 'a'.repeat(31) }, {});
  assert.equal(r2.ok, false);
});

test('rejects unknown service ids', () => {
  const r = validateReview({ ...base, service_id: 'made-up' }, { serviceIds: ['traditional'] });
  assert.equal(r.ok, false);
});

test('silently rejects a filled honeypot', () => {
  const r = validateReview({ ...base, website: 'http://spam.example' }, {});
  assert.equal(r.ok, false);
  assert.ok(r.errors._spam);
});

test('rejects submissions that arrive too fast to be human', () => {
  const r = validateReview({ ...base, elapsed_ms: 200 }, {});
  assert.equal(r.ok, false);
  assert.ok(r.errors._spam);
});

test('profile validation requires name and a usable WhatsApp number', () => {
  assert.equal(validateProfile({ name: 'A', whatsapp: '60123456789' }).ok, true);
  assert.equal(validateProfile({ name: '', whatsapp: '60123456789' }).ok, false);
  assert.equal(validateProfile({ name: 'A', whatsapp: '123' }).ok, false);
});

test('rate limit allows three, blocks the fourth, then resets next window', () => {
  const ip = store.hashIp('203.0.113.9');
  const t0 = 1_700_000_000_000;
  assert.equal(store.consumeRateLimit(ip, t0).ok, true);
  assert.equal(store.consumeRateLimit(ip, t0 + 1000).ok, true);
  assert.equal(store.consumeRateLimit(ip, t0 + 2000).ok, true);
  const blocked = store.consumeRateLimit(ip, t0 + 3000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  // a different connection is unaffected
  assert.equal(store.consumeRateLimit(store.hashIp('198.51.100.4'), t0).ok, true);
  // new hourly window resets the counter
  assert.equal(store.consumeRateLimit(ip, t0 + 60 * 60 * 1000).ok, true);
});

test('ip hashing is salted and never returns the raw address', () => {
  const h = store.hashIp('203.0.113.9');
  assert.equal(h.length, 64);
  assert.ok(!h.includes('203.0.113.9'));
  assert.equal(h, store.hashIp('203.0.113.9'));
  assert.notEqual(h, store.hashIp('203.0.113.10'));
});

test('cursor pagination never repeats or skips a review', () => {
  // same-millisecond writes are the failure case this guards against
  const ts = Date.now();
  const ids = ['r_a', 'r_b', 'r_c', 'r_d', 'r_e'];
  for (const id of ids) {
    store.insertReview({
      id,
      rating: 5,
      service_id: null,
      nickname: 'T',
      message: 'Pagination probe message.',
      ip_hash: 'seed',
      created_at: ts
    });
  }
  store.db
    .prepare("UPDATE reviews SET status='approved' WHERE id IN ('r_a','r_b','r_c','r_d','r_e')")
    .run();

  const seen = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const page = store.listApproved({ cursor, limit: 2 });
    seen.push(...page.items.map((r) => r.id));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  assert.equal(new Set(seen).size, seen.length, 'no duplicates across pages');
  assert.equal(seen.filter((id) => ids.includes(id)).length, 5, 'all same-timestamp rows seen');
});

test('summary maths', () => {
  const s = store.summary();
  assert.ok(s.count > 0);
  assert.ok(s.average >= 1 && s.average <= 5);
  const distTotal = Object.values(s.distribution).reduce((a, b) => a + b, 0);
  assert.equal(distTotal, s.count);
});
