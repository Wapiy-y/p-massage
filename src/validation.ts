/**
 * Field rules. Plain functions rather than Zod so the Worker bundle stays tiny
 * (Zod adds ~60 KB for four shapes) — the plan's Zod step is optional here.
 */

export const LIMITS = {
  messageMin: 10,
  messageMax: 1000,
  nicknameMax: 30,
  replyMax: 500,
  bodyMax: 16 * 1024
} as const;

export type Errors = Record<string, string>;

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: Errors };

/** Strip control characters and trim. */
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

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

  // Honeypot: real people never fill this in, bots do.
  if (clean(input.website).length > 0) {
    errors._spam = 'Rejected.';
  }

  // Minimum time-to-fill.
  const elapsed = Number(input.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1200) {
    errors._spam = 'That was a little too fast — please try again.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: { rating, message, nickname: nickname || 'Anonymous', service_id: serviceId }
  };
}

export interface ProfileInput {
  name: string;
  tagline: string;
  bio: string;
  whatsapp: string;
  phone: string;
  address: string;
  map_url: string;
  instagram: string;
  note: string;
  hours: Array<{ label: string; value: string }>;
}

export function validateProfile(input: unknown): Validated<ProfileInput> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const errors: Errors = {};

  const name = clean(raw.name);
  if (!name) errors.name = 'Name is required.';

  const whatsapp = clean(raw.whatsapp).replace(/[^\d]/g, '');
  if (whatsapp.length < 8) {
    errors.whatsapp = 'Enter the WhatsApp number with country code, digits only.';
  }

  const hoursRaw = Array.isArray(raw.hours) ? raw.hours : [];
  const hours = hoursRaw
    .map((entry) => {
      const h = (entry ?? {}) as Record<string, unknown>;
      return { label: clean(h.label), value: clean(h.value) };
    })
    .filter((h) => h.label || h.value)
    .slice(0, 8);

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      tagline: clean(raw.tagline).slice(0, 120),
      bio: clean(raw.bio).slice(0, 1200),
      whatsapp,
      phone: clean(raw.phone).slice(0, 40),
      address: clean(raw.address).slice(0, 300),
      map_url: clean(raw.map_url).slice(0, 400),
      instagram: clean(raw.instagram).slice(0, 200),
      note: clean(raw.note).slice(0, 200),
      hours
    }
  };
}

export interface ServiceInput {
  id: string;
  name: string;
  duration_min: number | null;
  price_rm: number | null;
}

export function validateServices(input: unknown): ServiceInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .filter((s) => clean(s.name).length > 0)
    .slice(0, 20)
    .map((s, index) => {
      const name = clean(s.name).slice(0, 80);
      // Slug the supplied id, or the name when no id came through — never a
      // bare positional fallback, which would silently point reviews at the
      // wrong service after a reorder.
      const slug = (clean(s.id) || name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      const id = slug || `service-${index + 1}`;
      const duration = Number(s.duration_min);
      const price = Number(s.price_rm);
      return {
        id,
        name,
        duration_min: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
        price_rm: Number.isFinite(price) && price >= 0 ? Math.round(price) : null
      };
    });
}
