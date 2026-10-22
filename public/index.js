import { api, starsHtml, relativeDate, money, initials, el } from '/lib.js';

const state = { rating: null, cursor: null, loading: false, done: false, total: 0 };

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- profile */

function waLink(number) {
  const digits = String(number || '').replace(/\D/g, '');
  const text = encodeURIComponent('Hi! I would like to book a massage session. Is there a slot available?');
  return `https://wa.me/${digits}?text=${text}`;
}

function renderProfile({ profile, services }) {
  if (!profile) return;
  document.title = `${profile.name} — massage therapy in Petaling Jaya`;
  $('monogram').textContent = initials(profile.name);
  $('top-name').textContent = profile.name;
  $('h-name').textContent = profile.name;

  const loc = (profile.tagline || '').split('·').pop();
  $('top-loc').textContent = (loc || 'Massage therapist').trim();
  $('p-tagline').textContent = profile.tagline || '';
  $('p-bio').textContent = profile.bio || '';
  $('hero-note').textContent = profile.note || '';

  $('wa-btn').href = waLink(profile.whatsapp);
  $('call-btn').href = `tel:${String(profile.phone || '').replace(/\s/g, '')}`;

  const svcList = $('svc-list');
  svcList.replaceChildren();
  for (const s of services) {
    svcList.append(
      el('li', { class: 'svc' }, [
        el('div', {}, [
          el('div', { class: 'name', text: s.name }),
          el('div', {
            class: 'meta',
            text: s.duration_min ? `${s.duration_min} minutes` : ''
          })
        ]),
        el('div', { class: 'price', text: money(s.price_rm) })
      ])
    );
  }
  if (!services.length) svcList.append(el('li', { class: 'small muted', text: 'Contact for current services.' }));

  const hours = $('hours-list');
  hours.replaceChildren();
  for (const h of profile.hours || []) {
    hours.append(el('li', {}, [el('span', { text: h.label }), el('span', { text: h.value })]));
  }

  const contact = $('contact-rows');
  contact.replaceChildren();
  if (profile.address) {
    contact.append(el('li', {}, [el('span', { text: 'Address' }), el('span', { text: profile.address })]));
  }
  if (profile.phone) {
    contact.append(el('li', {}, [el('span', { text: 'Phone' }), el('span', { text: profile.phone })]));
  }
  if (profile.instagram) {
    contact.append(el('li', {}, [el('span', { text: 'Instagram' }), el('span', { text: profile.instagram })]));
  }
  if (profile.map_url) {
    const li = el('li', {}, [el('span', { text: 'Map' }), el('span', {}, [])]);
    li.lastChild.append(
      el('a', { href: profile.map_url, target: '_blank', rel: 'noopener', text: 'Open in Maps' })
    );
    contact.append(li);
  }
}

/* ---------------------------------------------------------------- summary */

function renderSummary(s) {
  $('avg').textContent = s.count ? s.average.toFixed(1) : '—';
  $('avg-stars').innerHTML = starsHtml(s.average, { size: 'lg' });
  $('review-count').textContent = s.count
    ? `${s.count} review${s.count === 1 ? '' : 's'}`
    : 'No reviews yet';
  $('feed-count').textContent = s.count ? `${s.count} published` : '';
  for (let i = 1; i <= 5; i++) {
    const node = $(`c${i}`);
    if (node) node.textContent = s.distribution[i] ? s.distribution[i] : '';
  }
}

/* ------------------------------------------------------------------- feed */

function reviewCard(r) {
  const head = el('div', { class: 'review-head' }, [
    el('div', { class: 'review-who' }, [
      el('span', { class: 'nick', text: r.nickname }),
      el('span', { class: 'when', text: relativeDate(r.created_at) })
    ])
  ]);
  head.insertBefore(el('span', { html: starsHtml(r.rating) }), head.firstChild);

  const card = el('article', { class: 'review' }, [head, el('p', { class: 'body', text: r.message })]);

  if (r.service_name) card.append(el('span', { class: 'svc-tag', text: r.service_name }));

  if (r.reply) {
    card.append(
      el('div', { class: 'reply' }, [
        el('span', { class: 'who', text: 'Reply from the therapist' }),
        el('span', { class: 'small', text: r.reply })
      ])
    );
  }
  return card;
}

async function loadFeed({ reset = false } = {}) {
  if (state.loading) return;
  state.loading = true;

  if (reset) {
    state.cursor = null;
    state.done = false;
    $('feed').replaceChildren(el('div', { class: 'sk sk-card' }), el('div', { class: 'sk sk-card' }));
  }

  const params = new URLSearchParams({ limit: '8' });
  if (state.rating) params.set('rating', state.rating);
  if (state.cursor) params.set('cursor', state.cursor);

  const { ok, data } = await api(`/api/reviews?${params}`);

  if (reset) $('feed').replaceChildren();

  if (!ok || !data) {
    $('feed').replaceChildren(el('div', { class: 'empty', text: 'Could not load feedback just now.' }));
    state.loading = false;
    return;
  }

  for (const r of data.items) $('feed').append(reviewCard(r));

  state.cursor = data.nextCursor;
  state.done = !data.nextCursor;

  if ($('feed').children.length === 0) {
    $('feed').append(
      el('div', {
        class: 'empty',
        text: state.rating
          ? `No ${state.rating}-star feedback yet.`
          : 'No feedback published yet. Be the first to write one.'
      })
    );
  }

  $('more-wrap').hidden = state.done;
  state.loading = false;
}

/* ------------------------------------------------------------------ wiring */

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  for (const c of $('chips').querySelectorAll('.chip')) c.setAttribute('aria-pressed', 'false');
  chip.setAttribute('aria-pressed', 'true');
  state.rating = chip.dataset.rating || null;
  loadFeed({ reset: true });
});

$('more-btn').addEventListener('click', () => loadFeed());

(async function init() {
  const [prof, sum] = await Promise.all([api('/api/profile'), api('/api/reviews/summary')]);
  if (prof.ok && prof.data) renderProfile(prof.data);
  if (sum.ok && sum.data) renderSummary(sum.data);
  await loadFeed({ reset: true });
})();
