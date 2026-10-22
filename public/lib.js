/* Shared helpers: API access, star rendering, dates. No dependencies. */
const STAR_PATH =
  'M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z';

export function starSvg(filled) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${
    filled ? 'on' : 'off'
  }" fill="currentColor"><path d="${STAR_PATH}"/></svg>`;
}

/** Renders 5 stars, allowing halves visually via opacity on the last filled one. */
export function starsHtml(rating, { size = '' } = {}) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const filled = r >= i - 0.25;
    html += starSvg(filled);
  }
  const label = `${r} out of 5 stars`;
  return `<span class="stars ${size}" role="img" aria-label="${label}">${html}</span>`;
}

export function relativeDate(ts) {
  const diff = Date.now() - Number(ts);
  const day = 86400000;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3600000)} h ago`;
  if (diff < 2 * day) return 'yesterday';
  if (diff < 30 * day) return `${Math.floor(diff / day)} days ago`;
  const d = new Date(Number(ts));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    credentials: 'same-origin',
    ...options
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data, ok: res.ok };
}

export function money(rm) {
  return rm == null ? '' : `RM ${Number(rm).toFixed(0)}`;
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}
