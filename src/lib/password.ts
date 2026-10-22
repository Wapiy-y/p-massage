/**
 * Password verification for admin logins.
 *
 * Format: `pbkdf2$<iterations>$<salt base64>$<hash base64>` — the same string
 * scripts/hash-password.mjs produces, so seeding and rotation use one shape.
 *
 * PBKDF2 runs in WebCrypto (native, not JS), so the iteration count costs far
 * less CPU than a hand-rolled loop would on the Workers CPU budget.
 */
import { timingSafeEqual } from './auth';

const ALGORITHM = 'pbkdf2';
const KEY_BITS = 256;

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return false;

  const iterations = Number(parts[1]);
  const salt = base64ToBytes(parts[2] ?? '');
  const expected = parts[3] ?? '';
  if (!Number.isFinite(iterations) || iterations < 1 || !salt || !expected) return false;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BITS
  );

  return timingSafeEqual(bytesToBase64(new Uint8Array(derived)), expected);
}

/**
 * Constant-work placeholder used when the username does not exist, so a missing
 * account and a wrong password take comparable time.
 */
export const DUMMY_HASH =
  'pbkdf2$10000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
