/** Server-side Turnstile verification. */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
}

export async function verifyTurnstile(
  token: unknown,
  secret: string | undefined,
  ip: string | undefined,
  isProduction: boolean
): Promise<TurnstileResult> {
  // No secret configured: local development. Never silently skip in production.
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
    const data = (await response.json()) as { success?: boolean };
    return data.success
      ? { ok: true, skipped: false }
      : { ok: false, skipped: false, reason: 'Challenge failed. Please try again.' };
  } catch {
    // Fail closed in production, open locally so the dev loop keeps working.
    return isProduction
      ? { ok: false, skipped: false, reason: 'Could not verify the challenge.' }
      : { ok: true, skipped: true };
  }
}
