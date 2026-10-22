/** Constraints shared by validation, the API and the frontend's /api/config. */

export const LIMITS = {
  /** Shortest review worth publishing. */
  messageMin: 10,
  messageMax: 1000,
  nicknameMax: 30,
  replyMax: 500,
  bioMax: 1200,
  /** Largest request body accepted on any JSON endpoint. */
  bodyMax: 16 * 1024,
  /** Reviews per connection per rate-limit window. */
  rateLimitMax: 3,
  /** Page size for the public feed. */
  pageSize: 20,
  pageSizeMax: 50,
  /** Rows returned to the moderation queue. */
  moderationPageSize: 200,
  /** Failed admin logins allowed per window before throttling. */
  loginAttemptMax: 10
} as const;

/** Rate limiting counts in fixed one-hour windows. */
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Failed admin logins are counted over a shorter window. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** IP hashes older than this are purged by the scheduled handler. */
export const IP_HASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A real person cannot read the form, choose a rating and write a review this
 * fast. Anything quicker is treated as scripted.
 */
export const MIN_FILL_TIME_MS = 1200;

/** Paths that map onto a static page rather than a directory. */
export const PAGE_ALIASES: Record<string, string> = {
  '/feedback': '/feedback.html',
  '/admin': '/admin.html',
  '/privacy': '/privacy.html'
};
