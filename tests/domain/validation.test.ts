import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/config/limits';
import { validateProfile, validateReview, validateServices } from '../../src/domain/validation';

const base = {
  rating: 5,
  message: 'A perfectly reasonable length message.',
  consent: true,
  elapsed_ms: 4000
};

describe('validateReview', () => {
  it('accepts a complete review and defaults the nickname', () => {
    const result = validateReview(base, { serviceIds: ['traditional'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nickname).toBe('Anonymous');
  });

  it('rejects a missing rating, a short message and missing consent', () => {
    const result = validateReview({ message: 'short', elapsed_ms: 4000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.rating).toBeTruthy();
      expect(result.errors.message).toBeTruthy();
      expect(result.errors.consent).toBeTruthy();
    }
  });

  it('rejects a message over the limit', () => {
    const result = validateReview({ ...base, message: 'x'.repeat(LIMITS.messageMax + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.message).toMatch(/under 1000/);
  });

  it('trims whitespace and rejects an overlong nickname', () => {
    const blank = validateReview({ ...base, nickname: '   ' });
    expect(blank.ok && blank.value.nickname).toBe('Anonymous');

    const long = validateReview({ ...base, nickname: 'a'.repeat(LIMITS.nicknameMax + 1) });
    expect(long.ok).toBe(false);
  });

  it('rejects an unknown service id', () => {
    const result = validateReview(
      { ...base, service_id: 'made-up' },
      { serviceIds: ['traditional'] }
    );
    expect(result.ok).toBe(false);
  });

  it('silently rejects a filled honeypot', () => {
    const result = validateReview({ ...base, website: 'http://spam.example' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors._spam).toBeTruthy();
  });

  it('rejects submissions that arrive too fast to be human', () => {
    const result = validateReview({ ...base, elapsed_ms: 200 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors._spam).toBeTruthy();
  });

  it('strips control characters from the message', () => {
    const result = validateReview({ ...base, message: 'hello\u0000\u0007 there friend' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.message).toBe('hello there friend');
  });
});

describe('validateProfile', () => {
  it('accepts a good profile and normalises the WhatsApp number', () => {
    const result = validateProfile({ name: 'Aina', whatsapp: '+60 12-345 6789' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.whatsapp).toBe('60123456789');
  });

  it('requires a name and a usable number', () => {
    expect(validateProfile({ name: '', whatsapp: '60123456789' }).ok).toBe(false);
    expect(validateProfile({ name: 'A', whatsapp: '123' }).ok).toBe(false);
  });

  it('drops empty opening-hours rows', () => {
    const result = validateProfile({
      name: 'A',
      whatsapp: '60123456789',
      hours: [
        { label: 'Mon', value: '10-6' },
        { label: '', value: '' }
      ]
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hours).toHaveLength(1);
  });
});

describe('validateServices', () => {
  it('builds slugs and drops nameless rows', () => {
    const services = validateServices([
      { name: 'Deep Tissue', duration_min: '60', price_rm: '110' },
      { name: '' }
    ]);
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ id: 'deep-tissue', duration_min: 60, price_rm: 110 });
  });

  it('returns an empty list for junk input', () => {
    expect(validateServices(null)).toEqual([]);
    expect(validateServices('nope')).toEqual([]);
  });
});
