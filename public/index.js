import { api, starsHtml, relativeDate, money, initials, el } from '/lib.js';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- profile */

function waLink(number) {
  const digits = String(number || '').replace(/\D/g, '');
  const text = encodeURIComponent(
    'Hi! I would like to book a massage session. Is there a slot available?'
  );
  return `https://wa.me/${digits}?text=${text}`;
}

function renderProfile({ profile, services }) {
  if (!profile) return;

  document.title = `${profile.name} — massage therapy in Petaling Jaya`;
  $('monogram').textContent = initials(profile.name);
  $('top-name').textContent = profile.name;
  $('h-name').textContent = profile.name;

  const location = (profile.tagline || '').split('·').pop();
  $('top-loc').textContent = (location || 'Massage therapist').trim();
  $('p-tagline').textContent = profile.tagline || '';
  $('p-bio').textContent = profile.bio || '';
  $('wa-btn').href = waLink(profile.whatsapp);

  const serviceList = $('svc-list');
  serviceList.replaceChildren();
  for (const service of services) {
    serviceList.append(
      el('li', { class: 'svc' }, [
        el('div', {}, [
          el('div', { class: 'name', text: service.name }),
          el('div', {
            class: 'meta',
            text: service.duration_min ? `${service.duration_min} minutes` : ''
          })
        ]),
        el('div', { class: 'price', text: money(service.price_rm) })
      ])
    );
  }
  if (!services.length) {
    serviceList.append(el('li', { class: 'small muted', text: 'Contact for current services.' }));
  }

  const hours = $('hours-list');
  hours.replaceChildren();
  for (const entry of profile.hours || []) {
    hours.append(el('li', {}, [el('span', { text: entry.label }), el('span', { text: entry.value })]));
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
    contact.append(
      el('li', {}, [el('span', { text: 'Instagram' }), el('span', { text: profile.instagram })])
    );
  }
  if (profile.map_url) {
    const row = el('li', {}, [el('span', { text: 'Map' }), el('span', {}, [])]);
    row.lastChild.append(
      el('a', { href: profile.map_url, target: '_blank', rel: 'noopener', text: 'Open in Maps' })
    );
    contact.append(row);
  }
}

/* ---------------------------------------------------------------- summary */

function renderSummary(summary) {
  $('avg').textContent = summary.count ? summary.average.toFixed(1) : '—';
  $('avg-stars').innerHTML = starsHtml(summary.average, { size: 'lg' });
  $('review-count').textContent = summary.count
    ? `${summary.count} review${summary.count === 1 ? '' : 's'}`
    : 'No reviews yet';
  $('feed-count').textContent = summary.count ? `${summary.count} published` : '';
}

/* -------------------------------------------------------------- carousel */

const AUTOPLAY_MS = 6000;

function slide(review) {
  const head = el('div', { class: 'review-head' }, [
    el('span', { html: starsHtml(review.rating) }),
    el('div', { class: 'review-who' }, [
      el('span', { class: 'nick', text: review.nickname }),
      el('span', { class: 'when', text: relativeDate(review.created_at) })
    ])
  ]);

  const body = el('p', { class: 'body', text: review.message });
  const card = el('article', { class: 'review' }, [head, body]);

  if (review.service_name) card.append(el('span', { class: 'svc-tag', text: review.service_name }));

  if (review.reply) {
    card.append(
      el('div', { class: 'reply' }, [
        el('span', { class: 'who', text: 'Reply from the therapist' }),
        el('span', { class: 'small', text: review.reply })
      ])
    );
  }

  return el('div', { class: 'carousel-slide', role: 'group', 'aria-roledescription': 'slide' }, [card]);
}

function emptySlide(message) {
  return el('div', { class: 'carousel-slide' }, [el('div', { class: 'empty', text: message })]);
}

/**
 * One review at a time, advancing every few seconds.
 *
 * Autoplay stops on hover, focus, a hidden tab, or when the visitor asks for
 * reduced motion — and never starts again after a manual choice, so the card a
 * person picked does not slide away underneath them.
 */
function initCarousel(reviews) {
  const track = $('carousel-track');
  const dots = $('carousel-dots');
  const root = $('carousel');

  const slides = reviews.length
    ? reviews.map(slide)
    : [emptySlide('No feedback published yet.')];

  track.replaceChildren(...slides);
  dots.replaceChildren();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  let timer = null;
  let paused = false;
  let userChose = false;

  if (slides.length > 1 && !reducedMotion) {
    for (let i = 0; i < slides.length; i++) {
      const dot = el('button', {
        class: 'carousel-dot',
        type: 'button',
        'aria-label': `Show review ${i + 1} of ${slides.length}`,
        'aria-current': i === 0 ? 'true' : 'false'
      });
      dot.addEventListener('click', () => {
        userChose = true;
        stop();
        show(i);
      });
      dots.append(dot);
    }
  }

  function show(next) {
    index = (next + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;

    slides.forEach((node, i) => {
      node.setAttribute('aria-hidden', i === index ? 'false' : 'true');
    });
    dots.querySelectorAll('.carousel-dot').forEach((dot, i) => {
      dot.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
  }

  function start() {
    if (timer || userChose || paused || slides.length < 2) return;
    timer = window.setInterval(() => show(index + 1), AUTOPLAY_MS);
  }

  function stop() {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
  }

  root.addEventListener('mouseenter', () => {
    paused = true;
    stop();
  });
  root.addEventListener('mouseleave', () => {
    paused = false;
    start();
  });
  root.addEventListener('focusin', () => {
    paused = true;
    stop();
  });
  root.addEventListener('focusout', () => {
    paused = false;
    start();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    userChose = true;
    stop();
    show(index + (event.key === 'ArrowRight' ? 1 : -1));
  });

  show(0);
  start();
}

/* ------------------------------------------------------------------ boot */

(async function init() {
  const [profile, summary, reviews] = await Promise.all([
    api('/api/profile'),
    api('/api/reviews/summary'),
    api('/api/reviews?limit=12')
  ]);

  if (profile.ok && profile.data) renderProfile(profile.data);
  if (summary.ok && summary.data) renderSummary(summary.data);

  initCarousel(reviews.ok && reviews.data ? reviews.data.items || [] : []);
})();
