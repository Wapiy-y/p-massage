import { describe, expect, it, vi } from 'vitest';
import { authenticateAdmin, type AttemptCounter } from '../../src/services/admin-auth';

const PASSPHRASE = 'correct-horse-battery-staple';
const WINDOW_MS = 15 * 60 * 1000;

/** In-memory stand-in for the D1 counter. */
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

const verify = (input: string, expected: string) => Promise.resolve(input === expected);

function attempt(token: string, counter: AttemptCounter) {
  return authenticateAdmin({
    token,
    expected: PASSPHRASE,
    maxAttempts: 3,
    counter,
    verify
  });
}

describe('authenticateAdmin', () => {
  it('accepts the correct passphrase', async () => {
    const { counter } = fakeCounter();
    await expect(attempt(PASSPHRASE, counter)).resolves.toEqual({ ok: true });
  });

  it('rejects a wrong passphrase and records the failure', async () => {
    const { counter, state } = fakeCounter();
    const result = await attempt('wrong', counter);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(state.recorded).toBe(1);
  });

  it('does not spend budget on a successful login', async () => {
    const { counter, state } = fakeCounter();
    await attempt(PASSPHRASE, counter);
    await attempt(PASSPHRASE, counter);
    expect(state.recorded).toBe(0);
  });

  it('throttles once the failure budget is used, without checking the token', async () => {
    const { counter } = fakeCounter(3); // budget is 3
    const spy = vi.fn(verify);

    const result = await authenticateAdmin({
      token: PASSPHRASE, // correct, and still refused
      expected: PASSPHRASE,
      maxAttempts: 3,
      counter,
      verify: spy
    });

    expect(result).toMatchObject({ ok: false, reason: 'rate-limited' });
    expect(spy).not.toHaveBeenCalled();
    if (!result.ok && result.reason === 'rate-limited') {
      expect(result.retryAfterMs).toBe(WINDOW_MS);
    }
  });

  it('still allows a correct passphrase while under the limit but near it', async () => {
    const { counter, state } = fakeCounter(2); // one attempt left
    await expect(attempt(PASSPHRASE, counter)).resolves.toEqual({ ok: true });
    expect(state.count).toBe(2);
  });

  it('locks out after the configured number of consecutive failures', async () => {
    const { counter } = fakeCounter();
    for (let i = 0; i < 3; i++) {
      expect((await attempt('wrong', counter)).ok).toBe(false);
    }
    const blocked = await attempt(PASSPHRASE, counter);
    expect(blocked).toMatchObject({ ok: false, reason: 'rate-limited' });
  });

  it('reports an unconfigured deployment rather than rejecting a valid token', async () => {
    const { counter } = fakeCounter();
    const result = await authenticateAdmin({
      token: 'anything',
      expected: '', // ADMIN_TOKEN not set
      maxAttempts: 3,
      counter,
      verify
    });
    expect(result).toEqual({ ok: false, reason: 'unconfigured' });
  });
});
