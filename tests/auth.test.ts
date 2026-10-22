import { describe, expect, it } from 'vitest';
import {
  buildCookie,
  checkPassphrase,
  issueSession,
  parseCookies,
  timingSafeEqual,
  verifySession
} from '../src/auth';

const SECRET = 'test-secret-value';

describe('session cookies', () => {
  it('round-trips a valid session', async () => {
    const { cookie, maxAge } = await issueSession(SECRET);
    expect(maxAge).toBeGreaterThan(0);
    expect(await verifySession(cookie, SECRET)).toBe(true);
  });

  it('rejects a session signed with a different secret', async () => {
    const { cookie } = await issueSession(SECRET);
    expect(await verifySession(cookie, 'other-secret')).toBe(false);
  });

  it('rejects a tampered expiry — the whole point of the signature', async () => {
    const { cookie } = await issueSession(SECRET);
    const [version, expires, signature] = cookie.split('.');
    const extended = `${version}.${Number(expires) + 86_400_000}.${signature}`;
    expect(await verifySession(extended, SECRET)).toBe(false);
  });

  it('rejects an expired session', async () => {
    const past = Date.now() - 24 * 60 * 60 * 1000;
    const { cookie } = await issueSession(SECRET, past);
    expect(await verifySession(cookie, SECRET)).toBe(false);
  });

  it('rejects malformed or missing cookies', async () => {
    expect(await verifySession(undefined, SECRET)).toBe(false);
    expect(await verifySession('', SECRET)).toBe(false);
    expect(await verifySession('v1.123', SECRET)).toBe(false);
    expect(await verifySession('nonsense.value.here', SECRET)).toBe(false);
  });
});

describe('helpers', () => {
  it('compares strings without early exit', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('checks the passphrase exactly', async () => {
    expect(await checkPassphrase('hunter2', 'hunter2')).toBe(true);
    expect(await checkPassphrase('hunter3', 'hunter2')).toBe(false);
    expect(await checkPassphrase('', 'hunter2')).toBe(false);
  });

  it('parses a cookie header', () => {
    expect(parseCookies('sid=abc; other=1')).toEqual({ sid: 'abc', other: '1' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('marks the cookie Secure only when asked', () => {
    expect(buildCookie('v', 60, true)).toContain('Secure');
    expect(buildCookie('v', 60, false)).not.toContain('Secure');
    expect(buildCookie('v', 60, true)).toContain('HttpOnly');
  });
});
