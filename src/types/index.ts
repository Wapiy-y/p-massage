/**
 * Shared types: the Worker environment plus the shapes that cross layer
 * boundaries. Rows describe the database, DTOs describe what leaves the API —
 * keeping them apart stops a schema change from silently leaking to clients.
 */

/** Bindings and secrets available to the Worker (`wrangler.toml` + secrets). */
export interface Env {
  /** D1 database. */
  DB: D1Database;
  /** Static asset binding for `public/`. */
  ASSETS: Fetcher;

  /** Non-secret configuration. */
  RATE_LIMIT_MAX?: string;
  TURNSTILE_SITE_KEY?: string;

  /** Object storage (S3-compatible). Non-secret parts. */
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;

  /** Secrets, set with `wrangler secret put`. */
  ADMIN_SLUG?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  ADMIN_TOKEN?: string;
  SESSION_SECRET?: string;
  IP_SALT?: string;
  TURNSTILE_SECRET?: string;
}

/** Hono's env generic. */
export type AppEnv = { Bindings: Env };

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export const REVIEW_STATUSES: readonly ReviewStatus[] = ['pending', 'approved', 'rejected'];

/* ------------------------------------------------------------- database rows */

export interface ReviewRow {
  id: string;
  rating: number;
  service_id: string | null;
  service_name?: string | null;
  nickname: string | null;
  message: string;
  status: ReviewStatus;
  reply: string | null;
  replied_at: number | null;
  ip_hash: string;
  created_at: number;
  updated_at: number | null;
  approved_at: number | null;
}

export interface ServiceRow {
  id: string;
  name: string;
  duration_min: number | null;
  price_rm: number | null;
  sort: number;
}

export interface Profile {
  name: string;
  tagline: string;
  bio: string;
  whatsapp: string;
  address: string;
  map_url: string;
  hours: OpeningHours[];
}

export interface OpeningHours {
  label: string;
  value: string;
}

/* ------------------------------------------------------------------- DTOs */

/** A published review, as the public is allowed to see it. */
export interface PublicReview {
  id: string;
  rating: number;
  service_id: string | null;
  service_name: string | null;
  nickname: string;
  message: string;
  reply: string | null;
  created_at: number;
  replied_at: number | null;
}

export type ImageKind = 'profile' | 'gallery';

export interface ImageRow {
  id: string;
  kind: ImageKind;
  object_key: string;
  content_type: string;
  bytes: number | null;
  sort: number;
  status: 'pending' | 'ready';
  created_at: number;
}

/** What the public sees: a URL, never a bucket key. */
export interface PublicImage {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

export interface Summary {
  count: number;
  average: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface ReviewPage {
  items: PublicReview[];
  nextCursor: string | null;
}

export interface ReviewListOptions {
  cursor?: string | null;
  rating?: number | null;
  service?: string | null;
  limit?: number;
}

export interface ModerationCounts {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface RateLimitResult {
  ok: boolean;
  count: number;
  retryAfterMs: number;
}

/** Result of a service call: either a value or field-level errors. */
export type ServiceResult<T> =
  { ok: true; value: T } | { ok: false; errors: Record<string, string>; status: number };
