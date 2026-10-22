'use strict';
/**
 * Validation shared by the API. In the Cloudflare port this file becomes the
 * Zod schema (shared/schema.ts) referenced by both client and server.
 */

const LIMITS = {
  messageMin: 10,
  messageMax: 1000,
  nicknameMax: 30,
  replyMax: 500,
  bodyMax: 16 * 1024 // 16 KB, per plan
};

function clean(v) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim() : '';
}

/**
 * @returns {{ ok: true, value: object } | { ok: false, errors: Record<string,string> }}
 */
function validateReview(input, { serviceIds } = {}) {
  const errors = {};

  const rating = Number(input?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.rating = 'Choose a star rating from 1 to 5.';
  }

  const message = clean(input?.message);
  if (message.length === 0) {
    errors.message = 'Please write something.';
  } else if (message.length < LIMITS.messageMin) {
    errors.message = `Please write at least ${LIMITS.messageMin} characters (${message.length} so far).`;
  } else if (message.length > LIMITS.messageMax) {
    errors.message = `Please keep it under ${LIMITS.messageMax} characters.`;
  }

  let nickname = clean(input?.nickname);
  if (nickname.length > LIMITS.nicknameMax) {
    errors.nickname = `Please keep your name under ${LIMITS.nicknameMax} characters.`;
  }

  let serviceId = clean(input?.service_id) || null;
  if (serviceId && serviceIds && !serviceIds.includes(serviceId)) {
    errors.service_id = 'Choose a service from the list.';
  }

  if (input?.consent !== true) {
    errors.consent = 'Please tick the box to continue.';
  }

  // Honeypot: a hidden field real users never fill in.
  if (clean(input?.website).length > 0) {
    errors._spam = 'Rejected.';
  }

  // Minimum time-to-fill, catches naive scripted submissions.
  const elapsed = Number(input?.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1200) {
    errors._spam = 'That was a little too fast — please try again.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      rating,
      message,
      nickname: nickname || 'Anonymous',
      service_id: serviceId
    }
  };
}

function validateProfile(input) {
  const errors = {};
  const name = clean(input?.name);
  if (!name) errors.name = 'Name is required.';
  const whatsapp = clean(input?.whatsapp).replace(/[^\d]/g, '');
  if (!whatsapp || whatsapp.length < 8) errors.whatsapp = 'Enter the WhatsApp number with country code, digits only.';

  const hours = Array.isArray(input?.hours)
    ? input.hours
        .map((h) => ({ label: clean(h?.label), value: clean(h?.value) }))
        .filter((h) => h.label || h.value)
    : [];

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      tagline: clean(input?.tagline).slice(0, 120),
      bio: clean(input?.bio).slice(0, 1200),
      whatsapp,
      phone: clean(input?.phone).slice(0, 40),
      address: clean(input?.address).slice(0, 300),
      map_url: clean(input?.map_url).slice(0, 400),
      instagram: clean(input?.instagram).slice(0, 200),
      note: clean(input?.note).slice(0, 200),
      hours: hours.slice(0, 8)
    }
  };
}

module.exports = { LIMITS, validateReview, validateProfile, clean };
