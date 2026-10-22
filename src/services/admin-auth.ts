/**
 * Passphrase authentication with attempt throttling.
 *
 * Dependencies are injected so the decision logic is testable without a
 * database: the route supplies a D1-backed counter, tests supply a fake.
 */

/** Counts recent failed attempts for one caller. */
export interface AttemptCounter {
  /** Current failures in the active window, plus when it resets. */
  peek(): Promise<{ count: number; retryAfterMs: number }>;
  /** Record one failed attempt. */
  record(): Promise<void>;
}

export interface AdminAuthCommand {
  token: string;
  expected: string;
  /** Max failed attempts allowed in the window. */
  maxAttempts: number;
  counter: AttemptCounter;
  /** Injected for deterministic tests. */
  verify: (input: string, expected: string) => Promise<boolean>;
}

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; reason: 'rate-limited'; retryAfterMs: number }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'unconfigured' };

/**
 * Verify the passphrase, throttling *failures* only.
 *
 * Successful logins do not consume the budget, so a therapist who signs in
 * several times a day is never locked out; an attacker guessing is capped.
 * Attempts are recorded only after a wrong passphrase, which means a correct
 * one still works even when the caller is close to the limit.
 */
export async function authenticateAdmin(command: AdminAuthCommand): Promise<AdminAuthResult> {
  if (!command.expected) return { ok: false, reason: 'unconfigured' };

  const { count, retryAfterMs } = await command.counter.peek();
  if (count >= command.maxAttempts) {
    return { ok: false, reason: 'rate-limited', retryAfterMs };
  }

  const valid = await command.verify(command.token, command.expected);
  if (!valid) {
    await command.counter.record();
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true };
}
