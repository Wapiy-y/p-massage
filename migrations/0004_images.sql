-- Images: one profile photo plus a gallery of at most ten.
-- Objects live in the S3-compatible bucket (Neon); only metadata is stored here.
--
-- `status` allows a row to be created at presign time and confirmed after the
-- browser finishes uploading: an upload that never completes stays 'pending'
-- and is purged, so a half-finished request cannot consume a gallery slot.

CREATE TABLE IF NOT EXISTS images (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('profile', 'gallery')),
  object_key   TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes        INTEGER,
  sort         INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_images_kind_status
  ON images (kind, status, sort);

CREATE INDEX IF NOT EXISTS idx_images_status_created
  ON images (status, created_at);
