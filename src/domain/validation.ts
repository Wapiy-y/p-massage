/**
 * Pure input rules — no I/O, no framework types, so they are trivially testable.
 * Plain functions rather than Zod: four shapes do not justify the bundle cost.
 */
import { LIMITS, MIN_FILL_TIME_MS } from '../config/limits';
import type { OpeningHours } from '../types';

export type Errors = Record<string, string>;

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: Errors };

/**
 * Strip control characters (except tab, newline, carriage return) and trim.
 *
 * Done by code point rather than a regex literal: control characters inside a
 * regex are hard to read and easy to mangle when the file is edited.
 */
export function clean(value: unknown): string {
  if (typeof value !== 'string') return '';

  const kept = Array.from(value).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
    return !isControl;
  });

  return kept.join('').trim();
}

/** Lowercase, hyphen-separated, capped — safe as an id and a URL segment. */
export function slugify(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/* ------------------------------------------------------------------ reviews */

export interface ReviewInput {
  rating: number;
  message: string;
  nickname: string;
  service_id: string | null;
}

export interface ReviewRaw {
  rating?: unknown;
  message?: unknown;
  nickname?: unknown;
  service_id?: unknown;
  consent?: unknown;
  website?: unknown;
  elapsed_ms?: unknown;
}

export function validateReview(
  input: ReviewRaw,
  options: { serviceIds?: string[] } = {}
): Validated<ReviewInput> {
  const errors: Errors = {};

  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.rating = 'Choose a star rating from 1 to 5.';
  }

  const message = clean(input.message);
  if (message.length === 0) {
    errors.message = 'Please write something.';
  } else if (message.length < LIMITS.messageMin) {
    errors.message = `Please write at least ${LIMITS.messageMin} characters (${message.length} so far).`;
  } else if (message.length > LIMITS.messageMax) {
    errors.message = `Please keep it under ${LIMITS.messageMax} characters.`;
  }

  const nickname = clean(input.nickname);
  if (nickname.length > LIMITS.nicknameMax) {
    errors.nickname = `Please keep your name under ${LIMITS.nicknameMax} characters.`;
  }

  const serviceId = clean(input.service_id) || null;
  if (serviceId && options.serviceIds && !options.serviceIds.includes(serviceId)) {
    errors.service_id = 'Choose a service from the list.';
  }

  if (input.consent !== true) {
    errors.consent = 'Please tick the box to continue.';
  }

  // Honeypot: hidden from people, irresistible to naive bots.
  if (clean(input.website).length > 0) {
    errors._spam = 'Rejected.';
  }

  const elapsed = Number(input.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_TIME_MS) {
    errors._spam = 'That was a little too fast — please try again.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: { rating, message, nickname: nickname || 'Anonymous', service_id: serviceId }
  };
}

/* ------------------------------------------------------------------ profile */

export interface ProfileInput {
  name: string;
  tagline: string;
  bio: string;
  whatsapp: string;
  address: string;
  map_url: string;
  hours: OpeningHours[];
}

/** Digits only, so `+60 12-345 6789` and `60123456789` behave the same. */
export function normalisePhoneNumber(value: unknown): string {
  return clean(value).replace(/[^\d]/g, '');
}

export function validateProfile(input: unknown): Validated<ProfileInput> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const errors: Errors = {};

  const name = clean(raw.name);
  if (!name) errors.name = 'Name is required.';

  const whatsapp = normalisePhoneNumber(raw.whatsapp);
  if (whatsapp.length < 8) {
    errors.whatsapp = 'Enter the WhatsApp number with country code, digits only.';
  }

  const hours = (Array.isArray(raw.hours) ? raw.hours : [])
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return { label: clean(row.label), value: clean(row.value) };
    })
    .filter((row) => row.label || row.value)
    .slice(0, 8);

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      tagline: clean(raw.tagline).slice(0, 120),
      bio: clean(raw.bio).slice(0, LIMITS.bioMax),
      whatsapp,
      address: clean(raw.address).slice(0, 300),
      map_url: clean(raw.map_url).slice(0, 400),
      hours
    }
  };
}

/* ----------------------------------------------------------------- services */

export interface ServiceInput {
  id: string;
  name: string;
  duration_min: number | null;
  price_rm: number | null;
}

export function validateServices(input: unknown): ServiceInput[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
    )
    .filter((entry) => clean(entry.name).length > 0)
    .slice(0, 20)
    .map((entry, index) => {
      const name = clean(entry.name).slice(0, 80);
      // Derive from the name when the client sends no id; a positional fallback
      // would silently re-point existing reviews after a reorder.
      const id = slugify(entry.id ?? '') || slugify(name) || `service-${index + 1}`;

      const duration = Number(entry.duration_min);
      const price = Number(entry.price_rm);

      return {
        id,
        name,
        duration_min: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
        price_rm: Number.isFinite(price) && price >= 0 ? Math.round(price) : null
      };
    });
}
