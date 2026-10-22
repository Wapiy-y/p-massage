/** Server-side Turnstile verification. */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
}

/**
 * @param isProduction when true, a missing secret fails closed — an
 *   unprotected form must never be the silent default in production.
 */
export async function verifyTurnstile(
  token: unknown,
  secret: string | undefined,
  ip: string | undefined,
  isProduction: boolean
): Promise<TurnstileResult> {
  if (!secret) {
    return isProduction
      ? { ok: false, skipped: true, reason: 'Verification is not configured.' }
      : { ok: true, skipped: true };
  }

  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, skipped: false, reason: 'Missing challenge token.' };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const response = await fetch(VERIFY_URL, { method: 'POST', body });
    const data = await response.json<{ success?: boolean }>();
    return data.success
      ? { ok: true, skipped: false }
      : { ok: false, skipped: false, reason: 'Challenge failed. Please try again.' };
  } catch {
    // Fail closed in production, stay usable locally when offline.
    return isProduction
      ? { ok: false, skipped: false, reason: 'Could not verify the challenge.' }
      : { ok: true, skipped: true };
  }
}
