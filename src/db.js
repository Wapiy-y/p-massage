'use strict';
/**
 * DEPRECATED — superseded by the Cloudflare Worker in src/index.ts (Hono + D1).
 * Kept only as a reference for the original dependency-free Node implementation.
 * Nothing runs this file: `npm run dev` starts the Worker, `npm test` runs Vitest.
 */

/**
 * Data layer. Mirrors the D1 schema from the plan 1:1 so this can be ported to
 * Cloudflare D1 by swapping DatabaseSync for the D1 binding and awaiting queries.
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  service_id  TEXT REFERENCES services(id) ON DELETE SET NULL,
  nickname    TEXT DEFAULT 'Anonymous',
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  reply       TEXT,
  replied_at  INTEGER,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  approved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON reviews(status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS profile (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  duration_min INTEGER,
  price_rm     INTEGER,
  sort         INTEGER DEFAULT 0,
  active       INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash      TEXT,
  window_start INTEGER,
  count        INTEGER,
  PRIMARY KEY (ip_hash, window_start)
);
`;
db.exec(SCHEMA);

/* ---------------------------------------------------------------- profile */

const DEFAULT_PROFILE = {
  name: 'Aina Rahman',
  tagline: 'Traditional & deep tissue massage · Petaling Jaya',
  bio:
    'I have been practising massage for nine years, mostly with clients who sit at a desk all day. ' +
    'Sessions are slow and pressure is adjusted as we go, so you always leave looser than you arrived. ' +
    'Home studio, one client at a time, no rush.',
  whatsapp: '60123456789',
  phone: '+60 12-345 6789',
  address: '12A, Jalan SS2/61, Petaling Jaya, Selangor',
  map_url: 'https://maps.google.com/?q=Jalan+SS2/61+Petaling+Jaya',
  hours: [
    { label: 'Mon – Fri', value: '10:00 – 20:00' },
    { label: 'Saturday', value: '10:00 – 18:00' },
    { label: 'Sunday', value: 'By appointment' }
  ],
  instagram: '',
  note: 'Strictly therapeutic. Appointment only.'
};

const DEFAULT_SERVICES = [
  { id: 'traditional', name: 'Traditional Malay massage', duration_min: 60, price_rm: 90, sort: 1 },
  { id: 'deep-tissue', name: 'Deep tissue (back & shoulders)', duration_min: 60, price_rm: 110, sort: 2 },
  { id: 'foot', name: 'Foot reflexology', duration_min: 45, price_rm: 70, sort: 3 },
  { id: 'prenatal', name: 'Prenatal massage', duration_min: 60, price_rm: 120, sort: 4 },
  { id: 'sports', name: 'Sports recovery', duration_min: 90, price_rm: 150, sort: 5 }
];

function getProfileRow() {
  const row = db.prepare('SELECT json FROM profile WHERE id = 1').get();
  return row ? JSON.parse(row.json) : null;
}

function saveProfile(p) {
  db.prepare(
    'INSERT INTO profile (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json'
  ).run(JSON.stringify(p));
}

function getServices({ activeOnly = true } = {}) {
  const sql = activeOnly
    ? 'SELECT id, name, duration_min, price_rm, sort FROM services WHERE active = 1 ORDER BY sort, name'
    : 'SELECT id, name, duration_min, price_rm, sort, active FROM services ORDER BY sort, name';
  return db.prepare(sql).all().map((s) => ({
    id: s.id,
    name: s.name,
    duration_min: s.duration_min,
    price_rm: s.price_rm,
    sort: s.sort
  }));
}

function saveServices(list) {
  const next = Array.isArray(list) ? list : [];
  const keep = db.prepare('SELECT id FROM services').all().map((r) => r.id);
  const incoming = new Set(next.map((s) => s.id));
  for (const id of keep) {
    if (!incoming.has(id)) db.prepare('DELETE FROM services WHERE id = ?').run(id);
  }
  const up = db.prepare(`
    INSERT INTO services (id, name, duration_min, price_rm, sort, active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, duration_min = excluded.duration_min,
      price_rm = excluded.price_rm, sort = excluded.sort, active = 1
  `);
  next.forEach((s, i) => up.run(s.id, s.name, s.duration_min, s.price_rm, s.sort ?? i + 1));
}

/* ----------------------------------------------------------------- reviews */

const PUBLIC_COLUMNS = `
  r.id, r.rating, r.service_id, s.name AS service_name,
  r.nickname, r.message, r.reply, r.replied_at, r.created_at
`;

/**
 * Approved reviews, newest first. Keyset pagination on (created_at, id) so two
 * rows written in the same millisecond can never be skipped or repeated.
 */
function listApproved({ cursor, rating, service, limit = 20 } = {}) {
  const where = ["r.status = 'approved'"];
  const params = [];
  if (rating) {
    where.push('r.rating = ?');
    params.push(rating);
  }
  if (service) {
    where.push('r.service_id = ?');
    params.push(service);
  }
  if (cursor) {
    // Cursor is `<created_at>.<id>`. A dot is safe because ids never contain one,
    // and it avoids the underscore collision that ids like `r_a` would cause.
    const raw = String(cursor);
    const dot = raw.indexOf('.');
    const ts = dot > 0 ? Number(raw.slice(0, dot)) : NaN;
    const id = dot > 0 ? raw.slice(dot + 1) : '';
    if (Number.isFinite(ts) && id) {
      where.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
      params.push(ts, ts, id);
    }
  }
  const rows = db
    .prepare(`
      SELECT ${PUBLIC_COLUMNS}
      FROM reviews r LEFT JOIN services s ON s.id = r.service_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?
    `)
    .all(...params, limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(publicShape);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? `${last.created_at}.${last.id}` : null
  };
}

function publicShape(r) {
  return {
    id: r.id,
    rating: r.rating,
    service_id: r.service_id,
    service_name: r.service_name,
    nickname: r.nickname || 'Anonymous',
    message: r.message,
    reply: r.reply || null,
    created_at: r.created_at,
    replied_at: r.replied_at || null
  };
}

function summary() {
  const rows = db
    .prepare("SELECT rating, COUNT(*) AS n FROM reviews WHERE status = 'approved' GROUP BY rating")
    .all();
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    dist[r.rating] = r.n;
    count += r.n;
    sum += r.rating * r.n;
  }
  return {
    count,
    average: count ? Math.round((sum / count) * 10) / 10 : 0,
    distribution: dist
  };
}

function insertReview({ id, rating, service_id, nickname, message, ip_hash, created_at }) {
  db.prepare(`
    INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, rating, service_id || null, nickname || 'Anonymous', message, ip_hash, created_at);
}

function listForAdmin(status) {
  const rows = db
    .prepare(`
      SELECT r.*, s.name AS service_name
      FROM reviews r LEFT JOIN services s ON s.id = r.service_id
      WHERE r.status = ?
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 200
    `)
    .all(status);
  return rows.map((r) => ({
    ...r,
    nickname: r.nickname || 'Anonymous',
    service_name: r.service_name || null,
    reply: r.reply || null
  }));
}

function reviewById(id) {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  return r || null;
}

function setStatus(id, status) {
  const now = Date.now();
  db.prepare(
    'UPDATE reviews SET status = ?, updated_at = ?, approved_at = ? WHERE id = ?'
  ).run(status, now, status === 'approved' ? now : null, id);
}

function setReply(id, reply) {
  const now = Date.now();
  const clean = reply ? String(reply).trim().slice(0, 500) : null;
  db.prepare('UPDATE reviews SET reply = ?, replied_at = ?, updated_at = ? WHERE id = ?').run(
    clean || null,
    clean ? now : null,
    now,
    id
  );
}

function deleteReview(id) {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
}

function stats() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n;
  const byStatus = { pending: 0, approved: 0, rejected: 0 };
  for (const r of db
    .prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status')
    .all()) {
    byStatus[r.status] = r.n;
  }
  return { total, ...byStatus };
}

/* ------------------------------------------------------------- rate limit */

const WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX || 3);

function hashIp(ip) {
  const salt = process.env.IP_SALT || 'dev-only-salt';
  return crypto.createHash('sha256').update(`${salt}:${ip || 'unknown'}`).digest('hex');
}

/** Returns { ok, remaining, retryAfterMs }. Never stores the raw IP. */
function consumeRateLimit(ipHash, now = Date.now()) {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const row = db
    .prepare('SELECT count FROM rate_limits WHERE ip_hash = ? AND window_start = ?')
    .get(ipHash, windowStart);
  const used = row ? row.count : 0;
  if (used >= RATE_MAX) {
    return { ok: false, remaining: 0, retryAfterMs: windowStart + WINDOW_MS - now };
  }
  db.prepare(`
    INSERT INTO rate_limits (ip_hash, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(ip_hash, window_start) DO UPDATE SET count = count + 1
  `).run(ipHash, windowStart);
  return { ok: true, remaining: RATE_MAX - used - 1, retryAfterMs: 0 };
}

/** Purge ip_hash rows older than 30 days (the cron job from the plan). */
function purgeOldRateLimits(now = Date.now()) {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const row = db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(cutoff);
  return row.changes;
}

/* ------------------------------------------------------------------- seed */

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM services').get().n;
  if (!existing) {
    const ins = db.prepare(
      'INSERT INTO services (id, name, duration_min, price_rm, sort, active) VALUES (?, ?, ?, ?, ?, 1)'
    );
    for (const s of DEFAULT_SERVICES) ins.run(s.id, s.name, s.duration_min, s.price_rm, s.sort);
  }
  if (!getProfileRow()) saveProfile(DEFAULT_PROFILE);

  const reviewCount = db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n;
  if (reviewCount === 0) {
    const DAY = 24 * 60 * 60 * 1000;
    const t = Date.now();
    const seedRows = [
      {
        rating: 5,
        service: 'deep-tissue',
        nickname: 'Hafiz',
        message:
          'Shoulders were locked from months of sitting at a desk. Aina found the spots I did not know were sore and I could turn my head properly the next morning. Pressure was firm but she kept checking in.',
        reply: 'Thank you Hafiz — come back before the tension builds up again!',
        daysAgo: 3
      },
      {
        rating: 5,
        service: 'traditional',
        nickname: 'Anonymous',
        message:
          'Third visit. Clean studio, no rushing, and she actually remembers which side of my back gives me trouble. The 60 minutes felt longer than that.',
        daysAgo: 9
      },
      {
        rating: 4,
        service: 'foot',
        nickname: 'Mei',
        message:
          'Very good reflexology, the pressure on my arches was spot on. Only reason for four stars is the parking around SS2 is a nightmare on weekdays.',
        daysAgo: 16
      },
      {
        rating: 5,
        service: 'prenatal',
        nickname: 'Saraswathi',
        message:
          'Went at 32 weeks with terrible lower back pain. She adjusted the position with pillows and checked with me constantly. Slept properly for the first time in weeks.',
        reply: 'So glad it helped. Rest well and see you after the baby!',
        daysAgo: 24
      },
      {
        rating: 3,
        service: 'sports',
        nickname: 'Anonymous',
        message:
          'Technique was good and it did help my calf, but the room was a little warm and I would have liked a firmer pressure overall. Would still return.',
        daysAgo: 33
      },
      {
        rating: 5,
        service: 'deep-tissue',
        nickname: 'Kumar',
        message:
          'I have tried a few places around PJ and this is the only one where I leave feeling genuinely worked on rather than oiled up and sent home.',
        daysAgo: 41
      },
      {
        rating: 4,
        service: 'traditional',
        nickname: 'Nadia',
        message:
          'Easy to book over WhatsApp, replied within minutes. Massage itself was relaxing and the studio smells like a spa. Slightly hard to find the first time.',
        daysAgo: 52
      },
      {
        rating: 2,
        service: 'foot',
        nickname: 'Anonymous',
        message:
          'Timing ran over by about twenty minutes and I had to leave early. The massage was fine but I was already stressed about being late.',
        reply:
          'That was my fault and I am sorry — I have since stopped taking back-to-back bookings on Saturdays.',
        daysAgo: 61
      }
    ];
    const ins = db.prepare(`
      INSERT INTO reviews (id, rating, service_id, nickname, message, status, reply, replied_at,
                           ip_hash, created_at, approved_at)
      VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)
    `);
    for (const r of seedRows) {
      const created = t - r.daysAgo * DAY;
      const id = `r_${created.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
      ins.run(
        id,
        r.rating,
        r.service,
        r.nickname,
        r.message,
        r.reply || null,
        r.reply ? created + 3600_000 : null,
        'seed',
        created,
        created
      );
    }
    // Two pending reviews so the moderation queue is not empty on first login.
    const pend = db.prepare(`
      INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 'seed', ?)
    `);
    pend.run(
      `r_${(t - 1800_000).toString(36)}a1b2`,
      5,
      'traditional',
      'Anonymous',
      'Booked last minute for a stiff neck before a flight. She squeezed me in and I could actually sleep on the plane. Highly recommended.',
      t - 1800_000
    );
    pend.run(
      `r_${(t - 900_000).toString(36)}c3d4`,
      4,
      'deep-tissue',
      'Wei Ling',
      'Really good massage and very professional. Only suggestion is to add a small waiting area, I arrived early and stood outside.',
      t - 900_000
    );
  }
}

seed();

module.exports = {
  db,
  DB_PATH,
  getProfileRow,
  saveProfile,
  getServices,
  saveServices,
  listApproved,
  summary,
  insertReview,
  listForAdmin,
  reviewById,
  setStatus,
  setReply,
  deleteReview,
  stats,
  hashIp,
  consumeRateLimit,
  purgeOldRateLimits,
  RATE_MAX
};
