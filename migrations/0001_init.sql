-- Schema for the massage feedback app (Cloudflare D1 / SQLite).
-- Apply locally:  npm run db:migrate:local
-- Apply remotely: npm run db:migrate:remote

CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  service_id  TEXT REFERENCES services(id) ON DELETE SET NULL,
  nickname    TEXT DEFAULT 'Anonymous',
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  reply       TEXT,
  replied_at  INTEGER,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  approved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON reviews (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_rating
  ON reviews (rating, created_at DESC);

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

-- Used by the daily purge in the scheduled handler.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON rate_limits (window_start);
