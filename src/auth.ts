/**
 * Stateless admin session: an HMAC-signed cookie.
 *
 * Workers have no shared memory between isolates, so the old in-memory session
 * Map cannot work — the cookie has to be self-verifying instead.
 *
 * In production Cloudflare Access sits in front of /admin and /api/admin/*,
 * which makes this a second line of defence rather than the only one.
 */

const COOKIE_NAME = 'sid';
const VERSION = 'v1';
const TTL_MS = 12 * 60 * 60 * 1000;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toHex(signature);
}

/** Length-independent comparison, so a wrong cookie leaks no timing signal. */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function issueSession(
  secret: string,
  now = Date.now()
): Promise<{ cookie: string; maxAge: number }> {
  const expires = now + TTL_MS;
  const payload = `${VERSION}.${expires}`;
  const signature = await hmac(secret, payload);
  return { cookie: `${payload}.${signature}`, maxAge: Math.floor(TTL_MS / 1000) };
}

export async function verifySession(
  value: string | undefined,
  secret: string,
  now = Date.now()
): Promise<boolean> {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [version, expiresRaw, signature] = parts;
  if (version !== VERSION || !expiresRaw || !signature) return false;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < now) return false;

  const expected = await hmac(secret, `${VERSION}.${expiresRaw}`);
  return timingSafeEqual(expected, signature);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function buildCookie(value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(secure: boolean): string {
  const parts = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Verify the passphrase without leaking its length through timing. */
export async function checkPassphrase(input: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmac('compare', input), hmac('compare', expected)]);
  return timingSafeEqual(a, b);
}
