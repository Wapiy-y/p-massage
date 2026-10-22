import { api } from '/lib.js';

const $ = (id) => document.getElementById(id);
const RATE_HINTS = {
  1: 'Sorry to hear that — what went wrong?',
  2: 'Not great. What would have made it better?',
  3: 'Okay. What was missing?',
  4: 'Good. Anything that would make it a 5?',
  5: 'Great — what made it work for you?'
};

const startedAt = Date.now();
let messageMax = 1000;
let messageMin = 10;

/* ------------------------------------------------------- star picker state */

const picker = $('star-picker');
const radios = [...picker.querySelectorAll('input[name="rating"]')];

function paint(value) {
  radios.forEach((r) => {
    const on = Number(value) >= Number(r.value);
    r.closest('.star-opt').dataset.on = on ? '1' : '0';
  });
  $('rate-hint').textContent = value ? RATE_HINTS[value] : '';
}

picker.addEventListener('change', (e) => {
  if (e.target.name === 'rating') {
    paint(e.target.value);
    $('e-rating').textContent = '';
  }
});

// Preview on hover / keyboard focus, without committing the choice.
for (const label of picker.querySelectorAll('.star-opt')) {
  const input = label.querySelector('input');
  label.addEventListener('mouseenter', () => paint(input.value));
  input.addEventListener('focus', () => paint(input.value));
}
picker.addEventListener('mouseleave', () => paint(radios.find((r) => r.checked)?.value || ''));
picker.addEventListener('focusout', () => paint(radios.find((r) => r.checked)?.value || ''));

/* --------------------------------------------------------------- counter */

const messageEl = $('message');
const counterEl = $('counter');

function updateCounter() {
  const n = messageEl.value.trim().length;
  counterEl.textContent = `${n} / ${messageMax}`;
  counterEl.classList.toggle('over', n > messageMax);
  return n;
}
messageEl.addEventListener('input', updateCounter);

/* --------------------------------------------------------------- helpers */

function showErrors(errors = {}) {
  for (const key of ['rating', 'message', 'nickname', 'service_id', 'consent']) {
    const node = $(`e-${key}`);
    if (node) node.textContent = errors[key] || '';
  }
  const formLevel = errors._form || errors._spam || (errors._body ? String(errors._body) : '');
  const alert = $('form-alert');
  alert.textContent = formLevel || '';
  if (formLevel) alert.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // focus the first broken field
  const first = ['rating', 'message', 'nickname', 'consent'].find((k) => errors[k]);
  if (first === 'rating') picker.querySelector('input').focus();
  else if (first) $(first).focus();
}

function clearErrors() {
  for (const id of ['e-rating', 'e-message', 'e-nickname', 'e-service_id', 'e-consent']) $(id).textContent = '';
  $('form-alert').textContent = '';
}

/* ---------------------------------------------------------------- submit */

let turnstileToken = null;

$('fb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const rating = picker.querySelector('input:checked')?.value;
  const message = messageEl.value.trim();
  const localErrors = {};

  if (!rating) localErrors.rating = 'Tap a star rating first.';
  if (message.length < messageMin)
    localErrors.message = `Please write at least ${messageMin} characters (${message.length} so far).`;
  if (!$('consent').checked) localErrors.consent = 'Please tick the box to continue.';

  if (Object.keys(localErrors).length) {
    showErrors(localErrors);
    return;
  }

  const btn = $('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const payload = {
    rating: Number(rating),
    message,
    nickname: $('nickname').value.trim(),
    service_id: $('service').value || null,
    consent: true,
    website: $('website').value, // honeypot, must stay empty
    elapsed_ms: Date.now() - startedAt,
    turnstile_token: window.turnstile && turnstileToken ? turnstileToken : undefined
  };

  try {
    const { res, data } = await api('/api/reviews', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.status === 201) {
      $('form-view').hidden = true;
      $('done-view').hidden = false;
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    showErrors({ ...(data?.errors || {}), _form: data?.errors?._form || data?.message || 'Something went wrong. Please try again.' });
    if (window.turnstile) window.turnstile.reset();
    turnstileToken = null;
  } catch {
    showErrors({ _form: 'Network problem — please check your connection and try again.' });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publish my feedback';
  }
});

/* ------------------------------------------------------------------ init */

(async function init() {
  const { ok, data } = await api('/api/config');
  if (ok && data) {
    messageMax = data.message_max || messageMax;
    messageMin = data.message_min || messageMin;
    messageEl.maxLength = messageMax + 200;
    updateCounter();

    if (data.rate_max) {
      $('rate-note').textContent = `To keep this page honest, up to ${data.rate_max} reviews per hour can be sent from one connection.`;
    }

    if (data.turnstile_site_key) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      s.onload = () => {
        window.turnstile.render('#turnstile-slot', {
          sitekey: data.turnstile_site_key,
          callback: (token) => {
            turnstileToken = token;
          },
          'expired-callback': () => {
            turnstileToken = null;
          },
          theme: 'light'
        });
      };
      document.head.append(s);
    }
  }

  const prof = await api('/api/profile');
  if (prof.ok && prof.data?.services?.length) {
    const sel = $('service');
    for (const s of prof.data.services) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.duration_min ? `${s.name} · ${s.duration_min} min` : s.name;
      sel.append(opt);
    }
  }
  updateCounter();
})();
