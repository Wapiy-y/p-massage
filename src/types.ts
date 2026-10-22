/** Bindings, secrets and row shapes for the Worker. */

export interface Env {
  /** D1 database (see wrangler.toml). */
  DB: D1Database;
  /** Static asset binding for the public/ directory. */
  ASSETS: Fetcher;

  /** Vars — non-secret configuration. */
  RATE_LIMIT_MAX?: string;
  TURNSTILE_SITE_KEY?: string;

  /** Secrets — set with `wrangler secret put`. */
  ADMIN_TOKEN?: string;
  IP_SALT?: string;
  TURNSTILE_SECRET?: string;
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

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

/** What the public is allowed to see. */
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
  phone: string;
  address: string;
  map_url: string;
  instagram: string;
  note: string;
  hours: Array<{ label: string; value: string }>;
}

export interface Summary {
  count: number;
  average: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}
