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

function directionsLink(profile) {
  if (profile.map_url) return profile.map_url;
  if (!profile.address) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(profile.address)}`;
}

function renderAvatar(profile, image) {
  const node = $('avatar');
  node.replaceChildren();

  if (image) {
    const img = document.createElement('img');
    img.src = image.url;
    img.alt = `${profile.name}, massage therapist`;
    img.loading = 'eager';
    node.append(img);
    node.classList.add('has-photo');
    return;
  }

  node.textContent = initials(profile.name);
  node.classList.remove('has-photo');
}

function renderGallery(images) {
  const section = $('gallery-section');
  const strip = $('gallery-strip');

  if (!images.length) {
    section.hidden = true;
    strip.replaceChildren();
    return;
  }

  section.hidden = false;
  $('gallery-note').textContent = `${images.length} photo${images.length === 1 ? '' : 's'}`;
  strip.replaceChildren(
    ...images.map((image) => {
      const img = document.createElement('img');
      img.src = image.url;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    })
  );
}

function renderProfile({ profile, services }) {
  if (!profile) return;

  document.title = `${profile.name} — massage therapy in Petaling Jaya`;
  $('h-name').textContent = profile.name;
  $('p-tagline').textContent = profile.tagline || '';
  $('p-bio').textContent = profile.bio || '';
  $('wa-btn').href = waLink(profile.whatsapp);

  const directions = directionsLink(profile);
  const mapButton = $('map-btn');
  if (directions) {
    mapButton.href = directions;
  } else {
    // Keep the layout stable rather than showing a dead control.
    mapButton.hidden = true;
  }

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
  const viewport = $('carousel-track');
  const dots = $('carousel-dots');
  const root = $('carousel');

  const slides = reviews.length
    ? reviews.map(slide)
    : [emptySlide('No feedback published yet.')];

  viewport.replaceChildren(...slides);
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

    slides.forEach((node, i) => {
      const active = i === index;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-hidden', active ? 'false' : 'true');
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
  const [profile, summary, reviews, images] = await Promise.all([
    api('/api/profile'),
    api('/api/reviews/summary'),
    api('/api/reviews?limit=12'),
    api('/api/images')
  ]);

  if (profile.ok && profile.data) {
    renderProfile(profile.data);
    renderAvatar(profile.data.profile, images.ok ? images.data.profile : null);
  }
  renderGallery(images.ok && images.data ? images.data.gallery ?? [] : []);
  if (summary.ok && summary.data) renderSummary(summary.data);

  initCarousel(reviews.ok && reviews.data ? reviews.data.items || [] : []);
})();
