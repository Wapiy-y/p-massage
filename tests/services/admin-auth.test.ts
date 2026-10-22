import { describe, expect, it, vi } from 'vitest';
import {
  authenticateAdmin,
  type AttemptCounter,
  type AdminUser
} from '../../src/services/admin-auth';

const USERNAME = 'admin';
const PASSWORD = 'correct-horse-battery-staple';
const WINDOW_MS = 15 * 60 * 1000;

const USER: AdminUser = {
  id: 'admin_seed',
  username: USERNAME,
  password_hash: 'stored-hash'
};

/** In-memory stand-in for the D1 attempt counter. */
function fakeCounter(initial = 0) {
  const state = { count: initial, recorded: 0 };
  const counter: AttemptCounter = {
    peek: () => Promise.resolve({ count: state.count, retryAfterMs: WINDOW_MS }),
    record: () => {
      state.count += 1;
      state.recorded += 1;
      return Promise.resolve();
    }
  };
  return { counter, state };
}

/** Fake password check: the stored hash is the password in this fixture. */
const verify = (password: string, storedHash: string) =>
  Promise.resolve(storedHash === 'stored-hash' && password === PASSWORD);

const lookup = (username: string) => Promise.resolve(username === USERNAME ? USER : null);

function attempt(
  credentials: { username?: string; password?: string },
  counter: AttemptCounter,
  overrides: { lookup?: typeof lookup; verify?: typeof verify } = {}
) {
  return authenticateAdmin({
    username: credentials.username ?? USERNAME,
    password: credentials.password ?? PASSWORD,
    maxAttempts: 3,
    counter,
    lookup: overrides.lookup ?? lookup,
    verify: overrides.verify ?? verify
  });
}

describe('authenticateAdmin', () => {
  it('accepts the seeded account on correct credentials', async () => {
    const { counter } = fakeCounter();
    const result = await attempt({}, counter);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.username).toBe(USERNAME);
  });

  it('rejects a wrong password and records the failure', async () => {
    const { counter, state } = fakeCounter();
    const result = await attempt({ password: 'wrong' }, counter);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(state.recorded).toBe(1);
  });

  it('rejects an unknown username and still records a failure', async () => {
    const { counter, state } = fakeCounter();
    const result = await attempt({ username: 'someone-else' }, counter);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(state.recorded).toBe(1);
  });

  it('still runs the password check for an unknown user, to avoid leaking which failed', async () => {
    const { counter } = fakeCounter();
    const spy = vi.fn(verify);
    await attempt({ username: 'ghost' }, counter, { verify: spy });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not spend budget on a successful login', async () => {
    const { counter, state } = fakeCounter();
    await attempt({}, counter);
    await attempt({}, counter);
    expect(state.recorded).toBe(0);
  });

  it('throttles once the failure budget is used, without checking credentials', async () => {
    const { counter } = fakeCounter(3);
    const spy = vi.fn(verify);

    const result = await attempt({}, counter, { verify: spy });

    expect(result).toMatchObject({ ok: false, reason: 'rate-limited' });
    expect(spy).not.toHaveBeenCalled();
    if (!result.ok) expect(result.retryAfterMs).toBe(WINDOW_MS);
  });

  it('allows a correct login while under the limit but near it', async () => {
    const { counter, state } = fakeCounter(2);
    const result = await attempt({}, counter);
    expect(result.ok).toBe(true);
    expect(state.count).toBe(2);
  });

  it('locks out after the configured number of failures', async () => {
    const { counter } = fakeCounter();
    for (let i = 0; i < 3; i++) {
      expect((await attempt({ password: 'wrong' }, counter)).ok).toBe(false);
    }
    const blocked = await attempt({}, counter);
    expect(blocked).toMatchObject({ ok: false, reason: 'rate-limited' });
  });
});
