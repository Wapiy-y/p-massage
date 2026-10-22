-- Admin accounts. A single seeded row, deliberately no signup flow: the
-- therapist rotates the password with scripts/hash-password.mjs.
--
-- The password itself is not in this repository — only a PBKDF2-SHA256 hash of
-- it (10k iterations, 16-byte salt — tuned for the free plan CPU budget).
--
--   node scripts/hash-password.mjs '<new password>'
--   npx wrangler d1 execute massage-feedback --remote --command \
--     "UPDATE admins SET password_hash = '<hash>' WHERE username = 'admin'"

CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER
);

INSERT INTO admins (id, username, password_hash, created_at)
SELECT 'admin_seed', 'admin', 'pbkdf2$10000$RrS7DYtpY1rDgKvL8MSzxw==$ws45Gp1omNK0pDVk24iea/7jdgYWhoX+DjY/0/cWQ+I=', CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM admins WHERE username = 'admin');
