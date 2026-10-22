# Massage therapist feedback site — MVP 1

A mobile-first public page for an independent massage therapist: profile, services and
prices, anonymous client feedback, and a moderation queue behind a login.

Implements **MVP 1** of `massage-feedback-app-plan-v3.md`:
text-only feedback, no photo upload, no PWA.

- Zero dependencies, no build step — Node's standard library plus `node:sqlite`
- Runs on Node 22+ (`node:sqlite` is experimental; the flag below silences the warning)
- API shapes match the plan, so the Cloudflare Workers + D1 port is a binding swap

---

## Run it

```bash
git clone https://github.com/Wapiy-y/p-massage.git
cd p-massage
node src/server.js            # http://localhost:8787
```

Or with settings:

```bash
ADMIN_TOKEN=$(openssl rand -hex 16) IP_SALT=$(openssl rand -hex 32) RATE_LIMIT_MAX=3 \
  node --disable-warning=ExperimentalWarning src/server.js
```

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8787` | |
| `ADMIN_TOKEN` | `admin123` | Local `/admin` passphrase; replaced by Cloudflare Access in production |
| `IP_SALT` | `dev-only-salt` | Salt for the IP hash — **set a real one in production** |
| `RATE_LIMIT_MAX` | `3` | Published feedback per connection per hour |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | empty | Empty = disabled. Cloudflare test keys always pass |
| `DATA_DIR` / `DB_PATH` | `./data` | SQLite location |
| `NODE_ENV` | — | `production` makes cookies `Secure` and Turnstile fail closed |

The database creates and seeds itself on first run (`src/db.js`): a demo profile, five
services, eight published reviews and two waiting in the queue.

Delete `data/` to start over.

### Tests

```bash
node --test tests/api.test.js
```

Twelve checks covering validation, the honeypot, the time-to-fill check, the rate
limiter (including window reset), salted IP hashing, and keyset pagination across
same-millisecond rows.

---

## Pages

| Path | What it is | Discoverable? |
|---|---|---|
| `/` | Single public page: profile, rating summary, services, hours, location, feedback feed with star filter | yes |
| `/feedback` | Standalone anonymous form — stars, optional session type, message, optional name | **no — URL only** |
| `/privacy` | Short privacy notice (PDPA-friendly wording), linked from the form's consent line | yes |
| `/admin` | Moderation queue, replies, profile & services editor | no — passphrase / Access |

Local admin passphrase defaults to `admin123` — **change it** with `ADMIN_TOKEN` before putting this anywhere real.

### The form is unlisted by design

`/feedback` is a standalone page: no site header, no navigation, no link back to the
homepage, and `<meta name="robots" content="noindex">`. Nothing on `/` links to it, so a
visitor can only reach it by being given the URL.

That means **the therapist distributes the link** — send `https://your-domain/feedback`
over WhatsApp after a session, print it as a QR code on a card, or put it in the
appointment reminder. Nobody stumbles into it from the public page.

Trade-off worth knowing: there is no in-page funnel from "reading reviews" to "leaving
one". If that ever matters more than keeping the form unlisted, add a link on `/` and
delete the `noindex` tag.

---

## API

Everything the frontend uses, and nothing else.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/config` | public | Limits + optional Turnstile site key |
| GET | `/api/profile` | public | Profile + active services |
| GET | `/api/reviews?cursor=&rating=&service=&limit=` | public | Published reviews, keyset paginated |
| GET | `/api/reviews/summary` | public | Average, count, star distribution |
| POST | `/api/reviews` | Turnstile if configured | Create review as `pending` |
| POST | `/api/admin/login` · `/logout` | — | Local session (Cloudflare Access in prod) |
| GET | `/api/admin/reviews?status=` | admin | Moderation queue + counts |
| PATCH | `/api/admin/reviews/:id` | admin | `{status}` and/or `{reply}` |
| DELETE | `/api/admin/reviews/:id` | admin | Permanent delete |
| GET · PUT | `/api/admin/profile` | admin | Read/update profile and services |

### Submit pipeline (`POST /api/reviews`)

1. **Turnstile** — verified server-side if a secret is configured
2. **Honeypot** — a hidden `website` field must be empty
3. **Time-to-fill** — anything under 1.2 s is rejected
4. **Validation** — rating 1–5, message 10–1000 chars, known service id, consent ticked
5. **Rate limit** — 3/hour per salted IP hash, D1-style window table
6. **Insert** with status `pending`; nothing is public until a human approves it

Body limit 16 KB, `application/json` only. The raw IP is never stored — only
`sha256(salt + ip)`, purged after 30 days.

---

## Layout

```
p-massage/
├─ src/
│  ├─ server.js        # routing, static files, sessions, Turnstile
│  ├─ db.js            # schema, queries, seed (mirrors the D1 schema)
│  └─ validation.js    # field rules (becomes shared/schema.ts with Zod)
├─ public/
│  ├─ index.html/.js   # intro + feed
│  ├─ feedback.html/.js
│  ├─ admin.html/.js
│  ├─ privacy.html
│  ├─ lib.js           # api / stars / dates helpers
│  └─ styles.css       # tokens + components, 360px-first
├─ tests/api.test.js
└─ data/app.db         # created at runtime, gitignored
```

---

## Mobile decisions

- Design width 360 px, content column capped at 440 px and centred on desktop
- Tap targets ≥ 44 px (every button, chip and star is at least 44 px tall)
- 16 px form inputs so iOS does not zoom on focus
- Stars are real radio buttons — native keyboard support, no custom arrow-key JS
- Inline per-field errors, character counter, and a success screen instead of a toast
- All user text rendered with `textContent`; no `innerHTML` on review content

---

## Before this goes live (not done here)

1. **Move to Cloudflare** — Pages/Workers + D1 + Turnstile (see the plan's phases 0–2).
   `src/db.js` maps 1:1 onto D1; every query becomes `await env.DB.prepare(...).bind(...)`.
2. **Cloudflare Access** on `/admin` and `/api/admin/*`; then delete the local passphrase
   path and verify `Cf-Access-Jwt-Assertion` server-side.
3. **Turnstile keys** into Worker secrets, `TURNSTILE_SECRET` non-empty.
4. **Set `IP_SALT`** to 32 random bytes from the Worker secret store.
5. **Move the 30-day purge** off `setInterval` into a Worker cron trigger.
6. **Real content** — name, bio, services, prices, hours, WhatsApp number (all currently
   placeholder demo data).
7. **Backups** — `wrangler d1 export` on a weekly habit.

## Known gaps in MVP 1

- Reviews cannot be edited or withdrawn by the author (plan v2+ idea: secret link)
- No email/Telegram notification when a review arrives — check `/admin` manually
- No BM/EN toggle; copy is English only
- Single therapist, single location; no multi-service filtering in the feed (star filter only)
- No sitemap/OG share image yet
