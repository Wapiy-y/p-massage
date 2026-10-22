# Massage therapist feedback site

A mobile-first public page for an independent massage therapist: profile, services and prices,
anonymous client feedback, and a moderation queue behind a login.

Runs on **Cloudflare Workers + Hono + TypeScript**, with **D1** (SQLite) for storage.
No photo uploads, no PWA — both were cut from scope deliberately.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers (V8 isolates) |
| Framework | Hono 4 |
| Language | TypeScript (strict) |
| Database | Cloudflare D1 (SQLite) with SQL migrations |
| Frontend | Vanilla HTML/CSS/ES modules — no framework, no build step |
| Anti-spam | Turnstile (optional) + honeypot + time-to-fill + per-IP rate limit |
| Admin auth | HMAC-signed cookie, with Cloudflare Access in front in production |
| Tests | Vitest (22 unit tests) + a scripted browser smoke test |

The Worker bundles to **~26 KB gzipped**, including Hono.

---

## Local development

Requires Node 20+ and npm. **No Cloudflare account is needed** — Wrangler simulates
D1, the assets binding and the Worker on your machine.

```bash
git clone https://github.com/Wapiy-y/p-massage.git
cd p-massage
npm install

cp .dev.vars.example .dev.vars      # then edit ADMIN_TOKEN and IP_SALT

npm run db:migrate:local            # create tables
npm run db:seed:local               # demo profile, 5 services, 8 reviews + 2 pending
npm run dev                         # http://localhost:8787
```

| Script | What it does |
|---|---|
| `npm run dev` | Wrangler dev server with local D1 + assets |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate:local` | Apply `migrations/0001_init.sql` locally |
| `npm run db:seed:local` | Apply `migrations/0002_seed.sql` locally |
| `npm run db:migrate:remote` | Apply the schema to your real D1 database |
| `npm run db:export` | Dump the remote database to `backup.sql` |
| `npm run deploy` | Deploy to Cloudflare |

Local data lives in `.wrangler/state/` (gitignored). Delete that directory to start over.

### Local secrets

`.dev.vars` (gitignored) supplies secrets in development:

```
ADMIN_TOKEN=change-me
IP_SALT=change-me-to-32-random-bytes
TURNSTILE_SECRET=
```

Leaving `TURNSTILE_SECRET` empty disables Turnstile locally. The Worker only fails
closed on a missing secret when the request is *not* for localhost.

---

## Deploying

```bash
# 1. Create the database and copy its id into wrangler.toml
npx wrangler d1 create massage-feedback
#    → [[d1_databases]] database_id = "..."

# 2. Apply the schema, then seed only if you want demo content
npm run db:migrate:remote
# npm run db:seed:local -- --remote    (optional demo data)

# 3. Secrets
npx wrangler secret put ADMIN_TOKEN    # long random string
npx wrangler secret put IP_SALT        # openssl rand -hex 32
npx wrangler secret put TURNSTILE_SECRET

# 4. Deploy
npm run deploy
```

`wrangler.toml` already carries the cron trigger for the 30-day IP-hash purge — the reason
this became a Worker rather than staying on Pages Functions, which cannot have cron triggers.

---

## Pages

| Path | What it is | Discoverable? |
|---|---|---|
| `/` | Single public page: profile, rating summary, services, hours, location, feedback feed with star filter | yes |
| `/feedback` | Standalone anonymous form — stars, optional session type, message, optional name | **no — URL only** |
| `/privacy` | Short privacy notice, linked from the form's consent line | yes |
| `/admin` | Moderation queue, replies, profile & services editor | no — passphrase / Access |

### The form is unlisted by design

`/feedback` is standalone: no site header, no navigation, no link back to the homepage, and
`noindex`. Nothing on `/` links to it, so a visitor can only reach it by being given the URL.

That means **the therapist distributes the link** — WhatsApp after a session, a QR code on a
card, or the appointment reminder. The trade-off: there is no in-page funnel from "reading
reviews" to "leaving one". Add a link on `/` and drop `noindex` if that ever matters more.

---

## Where it runs

- Worker: `massage` → <https://massage.wafiyabdullah39.workers.dev>
- D1: `massage-feedback` (`ef09ab96-ad99-48ab-abdb-4b28509c0119`, APAC)
- Turnstile widget: `massage`, hostname-scoped to the Worker above

The Worker is named `massage` while the database is `massage-feedback` — they were
named at different times. `wrangler.toml` must keep `name = "massage"` in step with the
dashboard, otherwise a Git build and a CLI deploy target two different Workers.

---

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/config` | public | Limits + optional Turnstile site key |
| GET | `/api/profile` | public | Profile + active services |
| GET | `/api/reviews?cursor=&rating=&service=&limit=` | public | Published reviews, keyset paginated |
| GET | `/api/reviews/summary` | public | Average, count, star distribution |
| POST | `/api/reviews` | Turnstile if configured | Create review as `pending` |
| POST | `/api/admin/login` · `/logout` | — | Signed-cookie session |
| GET | `/api/admin/session` | — | Is the current cookie valid? |
| GET | `/api/admin/reviews?status=` | admin | Moderation queue + counts |
| PATCH | `/api/admin/reviews/:id` | admin | `{status}` and/or `{reply}` |
| DELETE | `/api/admin/reviews/:id` | admin | Permanent delete |
| GET · PUT | `/api/admin/profile` | admin | Read/update profile and services |
| POST | `/api/admin/purge` | admin | Run the IP-hash purge now |

### Submit pipeline (`POST /api/reviews`)

1. **Turnstile** — verified server-side when a secret is configured
2. **Honeypot** — a hidden `website` field must be empty
3. **Time-to-fill** — anything under 1.2 s is rejected
4. **Validation** — rating 1–5, message 10–1000 chars, known service id, consent ticked
5. **Rate limit** — 3/hour per salted IP hash, one atomic `UPSERT … RETURNING`
6. **Insert** with status `pending`; nothing is public until a human approves it

Body cap 16 KB, `application/json` only. The raw IP is never stored — only
`SHA-256(salt + ip)`, purged after 30 days by the cron trigger.

---

## Layout

```
p-massage/
├─ src/
│  ├─ index.ts        # Hono app, routes, error handling, scheduled handler
│  ├─ db.ts           # every D1 query (async)
│  ├─ validation.ts   # field rules, typed
│  ├─ auth.ts         # HMAC cookie sessions, constant-time compare
│  ├─ turnstile.ts    # challenge verification
│  └─ types.ts        # Env bindings + row shapes
├─ public/            # static assets: index, feedback, admin, privacy, 404, styles, JS
├─ migrations/
│  ├─ 0001_init.sql
│  └─ 0002_seed.sql
├─ tests/             # vitest: validation + auth
├─ wrangler.toml
└─ tsconfig.json
```

---

## Security notes

- **Sessions are stateless.** Workers have no shared memory between isolates, so the cookie is
  `v1.<expiry>.<HMAC-SHA256>` and self-verifying. Changing the expiry invalidates it — covered
  by a test.
- **Admin routes check twice.** `Cf-Access-Jwt-Assertion` (Cloudflare Access) *or* a valid
  signed cookie. Access should still be the outer gate in production.
- **Rate limiting is atomic**, one `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so two
  concurrent requests cannot both slip through a read-then-write window.
- **Timing-safe comparisons** for the passphrase and the session signature.
- **All user text is rendered with `textContent`**; nothing goes through `innerHTML`.
- **Security headers** (`nosniff`, `DENY` framing, referrer policy, permissions policy) are
  added to every response.

---

## Automatic deploys (GitHub Actions)

Two workflows, one file: `.github/workflows/ci-cd.yml`.

| Trigger | What runs |
|---|---|
| Pull request | Install, typecheck, tests, `wrangler deploy --dry-run` — **no credentials**, so PRs from forks are safe |
| Push to `main` (a merged PR) | The same checks, then `wrangler d1 migrations apply --remote` and `wrangler deploy`, then a smoke test against the live URLs |

Migrations run before every deploy and are idempotent — D1 records what it has applied in
`d1_migrations`, so it only ever runs new files. Schema therefore lands ahead of the code
that needs it.

### One-time setup

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **Account → Workers Scripts → Edit** and **Account → D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | `9af6679d3d31d759e1c1a24e2e475bf7` |

Create the token at <https://dash.cloudflare.com/profile/api-tokens> → *Create Token* →
*Custom token*. Scope it to the one account; do not use a Global API Key.

Until both secrets exist the deploy job fails early with an explicit message rather than a
cryptic Wrangler error. Worker **secrets** (`ADMIN_TOKEN`, `IP_SALT`, `TURNSTILE_SECRET`) are
stored in Cloudflare and survive deploys — they are not part of this pipeline.

The `production` environment on the deploy job is a hook for later: add required reviewers
there to gate deploys without editing the workflow.

---

## Known gaps

- Reviews cannot be edited or withdrawn by their author (secret-link flow is a v2 idea)
- No email/Telegram notification when a review arrives — check `/admin`
- No BM/EN toggle; copy is English only
- Star filter only; no per-service filter in the feed
- No sitemap or OG share image
- No analytics, by design

---

## History

This started as a dependency-free Node + `node:sqlite` app (still in the git history). The
backend was then ported to Workers + Hono + TypeScript so it can actually be deployed, and
because Workers, unlike Pages Functions, support the cron trigger the privacy promise needs.
The frontend did not change: same HTML, CSS and ES modules.
