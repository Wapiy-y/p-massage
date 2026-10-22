/**
 * Admin authentication: username + password against a seeded account, with
 * attempt throttling.
 *
 * Dependencies are injected so the decision logic is testable without a
 * database: the route supplies a D1-backed lookup and counter, tests supply
 * fakes. There is no signup flow by design — one account, seeded by migration.
 */
import { DUMMY_HASH } from '../lib/password';

/** Counts recent failed attempts for one caller. */
export interface AttemptCounter {
  peek(): Promise<{ count: number; retryAfterMs: number }>;
  record(): Promise<void>;
}

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
}

export interface AdminAuthCommand {
  username: string;
  password: string;
  /** Highest failed attempts allowed in the window. */
  maxAttempts: number;
  counter: AttemptCounter;
  lookup: (username: string) => Promise<AdminUser | null>;
  verify: (password: string, storedHash: string) => Promise<boolean>;
}

export type AdminAuthReason = 'rate-limited' | 'invalid';

export type AdminAuthResult =
  { ok: true; user: AdminUser } | { ok: false; reason: AdminAuthReason; retryAfterMs?: number };

/**
 * Verify credentials, throttling *failures* only.
 *
 * Successful logins do not consume budget, so the therapist is never locked out
 * by their own legitimate use; a guesser is capped.
 *
 * The credentials are not checked at all while throttled: verifying would leak
 * whether a guess was correct and let an attacker pace attempts around the cap.
 */
export async function authenticateAdmin(command: AdminAuthCommand): Promise<AdminAuthResult> {
  const { count, retryAfterMs } = await command.counter.peek();
  if (count >= command.maxAttempts) {
    return { ok: false, reason: 'rate-limited', retryAfterMs };
  }

  const user = await command.lookup(command.username.trim().toLowerCase());

  // Verify against a dummy hash when the account is unknown, so a missing user
  // and a wrong password cost the same time.
  const valid = await command.verify(command.password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !valid) {
    await command.counter.record();
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, user };
}
