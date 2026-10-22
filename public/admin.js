import { api, starsHtml, relativeDate } from '/lib.js';

const $ = (id) => document.getElementById(id);

// The admin area lives at a secret slug; the API mirrors it, so derive the
// base from the address this page was served from rather than hard-coding it.
const SLUG = location.pathname.replace(/^\/+|\/+$/g, '');
const API = `/api/${SLUG}`;

let currentStatus = 'pending';

/* ------------------------------------------------------------------ auth */

async function boot() {
  const { ok, data } = await api(`${API}/session`);
  if (ok && data?.authed) {
    $('gate').hidden = true;
    $('app').hidden = false;
    await Promise.all([loadQueue(), loadProfile()]);
  } else {
    $('gate').hidden = false;
    $('app').hidden = true;
  }
}

$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('gate-alert').textContent = '';
  const usernameInput = $('username');
  const passwordInput = $('password');

  const { res, data } = await api(`${API}/login`, {
    method: 'POST',
    body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
  });

  if (res.ok) {
    passwordInput.value = '';
    await boot();
  } else {
    $('gate-alert').textContent = data?.message || 'Sign in failed.';
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api(`${API}/logout`, { method: 'POST' });
  location.reload();
});

/* ----------------------------------------------------------------- queue */

function card(r) {
  const top = document.createElement('div');
  top.className = 'admin-card' + (r.status === 'pending' ? ' pending' : '');

  const head = document.createElement('div');
  head.className = 'review-head';
  head.innerHTML = starsHtml(r.rating);
  const when = document.createElement('span');
  when.className = 'tiny muted';
  when.textContent = relativeDate(r.created_at);
  head.append(when);

  const who = document.createElement('div');
  who.className = 'review-who';
  who.style.marginTop = '8px';
  const nick = document.createElement('span');
  nick.className = 'nick';
  nick.textContent = r.nickname;
  who.append(nick);

  const meta = document.createElement('span');
  meta.className = 'when';
  meta.textContent = [r.service_name || 'no service given', `#${r.id}`].join(' · ');
  who.append(meta);

  const body = document.createElement('p');
  body.className = 'body';
  body.style.marginTop = '8px';
  body.textContent = r.message;

  top.append(head, who, body);

  if (r.reply) {
    const rep = document.createElement('div');
    rep.className = 'reply';
    rep.innerHTML = '<span class="who">Your reply</span>';
    const t = document.createElement('span');
    t.className = 'small';
    t.textContent = r.reply;
    rep.append(t);
    top.append(rep);
  }

  /* actions */
  const actions = document.createElement('div');
  actions.className = 'admin-actions';

  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = `btn btn-sm ${cls}`;
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };

  if (r.status !== 'approved') {
    actions.append(
      mk('Publish', 'btn-primary', async () => {
        await api(`${API}/reviews/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
        refresh();
      })
    );
  }
  if (r.status !== 'rejected') {
    actions.append(
      mk(r.status === 'approved' ? 'Unpublish' : 'Hide', 'btn-ghost', async () => {
        await api(`${API}/reviews/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) });
        refresh();
      })
    );
  }
  actions.append(
    mk('Delete', 'btn-danger', async () => {
      if (!confirm('Delete this review permanently?')) return;
      await api(`${API}/reviews/${r.id}`, { method: 'DELETE' });
      refresh();
    })
  );
  top.append(actions);

  /* reply */
  const details = document.createElement('details');
  details.className = 'editor';
  details.style.marginTop = '10px';
  const sum = document.createElement('summary');
  sum.textContent = r.reply ? 'Edit reply' : 'Reply publicly';
  sum.style.fontSize = '0.85rem';
  const form = document.createElement('form');
  form.className = 'reply-form';
  const ta = document.createElement('textarea');
  ta.value = r.reply || '';
  ta.placeholder = 'Thank the client, or answer what they raised…';
  ta.maxLength = 500;
  const save = document.createElement('button');
  save.className = 'btn btn-ghost btn-sm';
  save.type = 'submit';
  save.textContent = 'Save reply';
  form.append(ta, save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api(`${API}/reviews/${r.id}`, { method: 'PATCH', body: JSON.stringify({ reply: ta.value }) });
    refresh();
  });
  details.append(sum, form);
  top.append(details);

  return top;
}

async function loadQueue() {
  const { ok, data } = await api(`${API}/reviews?status=${currentStatus}`);
  const queue = $('queue');
  queue.replaceChildren();
  if (!ok || !data) {
    queue.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Could not load.' }));
    return;
  }

  const s = data.stats || {};
  for (const st of ['pending', 'approved', 'rejected']) {
    const n = $(`n-${st}`);
    if (n) n.textContent = s[st] ? s[st] : '';
  }
  const stats = $('stats');
  stats.replaceChildren();
  const rows = [
    ['All reviews', s.total || 0],
    ['Published', s.approved || 0],
    ['Waiting for you', s.pending || 0],
    ['Hidden', s.rejected || 0]
  ];
  for (const [k, v] of rows) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${k}</span><span>${v}</span>`;
    stats.append(li);
  }

  if (!data.items.length) {
    queue.append(
      Object.assign(document.createElement('div'), {
        className: 'empty',
        textContent:
          currentStatus === 'pending' ? 'Nothing waiting. All caught up.' : 'Nothing here yet.'
      })
    );
    return;
  }
  for (const r of data.items) queue.append(card(r));
}

async function refresh() {
  await loadQueue();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-selected', 'true');
    currentStatus = tab.dataset.status;
    loadQueue();
  });
}

/* --------------------------------------------------------------- profile */

async function loadProfile() {
  const { ok, data } = await api(`${API}/profile`);
  if (!ok || !data) return;
  const p = data.profile || {};
  $('pf-name').value = p.name || '';
  $('pf-tagline').value = p.tagline || '';
  $('pf-bio').value = p.bio || '';
  $('pf-whatsapp').value = p.whatsapp || '';
  $('pf-phone').value = p.phone || '';
  $('pf-address').value = p.address || '';
  $('pf-map').value = p.map_url || '';
  $('pf-hours').value = (p.hours || []).map((h) => `${h.label} | ${h.value}`).join('\n');
  $('pf-services').value = (data.services || [])
    .map((s) => `${s.name} | ${s.duration_min ?? ''} | ${s.price_rm ?? ''}`)
    .join('\n');
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pf-err').textContent = '';
  $('pf-ok').textContent = '';

  const hours = $('pf-hours')
    .value.split('\n')
    .map((line) => line.split('|'))
    .filter((parts) => parts[0] && parts[0].trim())
    .map((parts) => ({ label: (parts[0] || '').trim(), value: (parts[1] || '').trim() }));

  const services = $('pf-services')
    .value.split('\n')
    .map((line) => line.split('|'))
    .filter((parts) => parts[0] && parts[0].trim())
    .map((parts) => ({
      id: parts[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: parts[0].trim(),
      duration_min: Number(parts[1]) || null,
      price_rm: Number(parts[2]) || null
    }));

  const profile = {
    name: $('pf-name').value,
    tagline: $('pf-tagline').value,
    bio: $('pf-bio').value,
    whatsapp: $('pf-whatsapp').value,
    phone: $('pf-phone').value,
    address: $('pf-address').value,
    map_url: $('pf-map').value,
    hours
  };

  const btn = $('pf-save');
  btn.disabled = true;
  const { res, data } = await api(`${API}/profile`, {
    method: 'PUT',
    body: JSON.stringify({ profile, services })
  });
  btn.disabled = false;

  if (res.ok) {
    $('pf-ok').textContent = 'Saved. The public page is updated.';
    loadProfile();
  } else {
    $('pf-err').textContent = data?.message || 'Could not save.';
    if (data?.errors) $('pf-err').textContent = Object.values(data.errors).join(' ');
  }
});

boot();
