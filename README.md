# Massage therapist feedback site

A mobile-first site for an independent massage therapist: a public page with services,
prices and client feedback, a standalone anonymous feedback form, and a moderation queue
for the therapist.

Built on **Cloudflare Workers** with **Hono**, **TypeScript** and **D1**.

- Live: <https://massage.wafiyabdullah39.workers.dev>
- Feedback form (unlisted): `/feedback`
- Admin: `/<ADMIN_SLUG>` — a secret path, not `/admin` (see [Admin access](#admin-access))

---

## Contents

- [Stack](#stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Configuration](#configuration)
- [API](#api)
- [Database](#database)
- [Deployment](#deployment)
- [Testing](#testing)
- [Conventions](#conventions)
- [Security](#security)
- [Known limitations](#known-limitations)

---

## Stack

| Layer         | Choice                                           | Why                                                    |
| ------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Runtime       | Cloudflare Workers                               | Free tier, edge latency, no servers to maintain        |
| Framework     | Hono 4                                           | Small, typed, runs unchanged in tests                  |
| Language      | TypeScript (strict)                              | `noUncheckedIndexedAccess` on                          |
| Database      | Cloudflare D1 (SQLite)                           | SQL, migrations, same engine locally and in production |
| Frontend      | Vanilla HTML/CSS/ES modules                      | Four pages; a framework would be overhead              |
| Anti-spam     | Turnstile + honeypot + time-to-fill + rate limit | Layered, no single point of failure                    |
| Validation    | Plain functions                                  | Four shapes do not justify Zod's bundle cost           |
| Tests         | Vitest                                           | 22 unit tests over the pure layers                     |
| Lint / format | ESLint 9 (typed) + Prettier                      | `npm run check` runs everything                        |

Worker bundle: **~26 KB gzipped**, including Hono. Startup time ~7 ms.

---

## Architecture

Layers talk downward only. A route never writes SQL; a repository never formats a response.

```
src/
├─ index.ts                    Worker entry: app assembly, assets, errors, cron
├─ config/limits.ts            Every tunable number in one place
├─ domain/validation.ts        Pure input rules (no I/O, no framework)
├─ routes/
│  ├─ public.ts                /api/config, /api/profile, /api/reviews
│  └─ admin.ts                 /api/admin/*  (session + moderation)
├─ services/
│  ├─ reviews.ts               Submit pipeline, moderation workflow
│  └─ profile.ts               Profile + catalogue
├─ repositories/
│  ├─ reviews.ts               All review SQL
│  ├─ services.ts              All service SQL
│  ├─ profile.ts               All profile SQL
│  └─ rate-limit.ts            Atomic counters, purge
├─ middleware/
│  ├─ security-headers.ts      nosniff, DENY framing, referrer, permissions
│  └─ require-admin.ts         Access header or signed cookie
├─ lib/
│  ├─ auth.ts                  HMAC session cookies, constant-time compare
│  ├─ http.ts                  json helpers, body parsing, client IP
│  ├─ turnstile.ts             Challenge verification
│  ├─ ip-hash.ts               Salted visitor hash
│  └─ id.ts                    Time-prefixed record ids
└─ types/index.ts              Env bindings, DB rows, API DTOs
```

**Request flow** for `POST /api/reviews`:

```
route (public.ts)      parse body, verify Turnstile, hash IP
   ↓
service (reviews.ts)   validate → rate limit → insert as pending
   ↓
repository             INSERT INTO reviews …
```

Each layer is independently testable: `domain/` and `lib/` are pure and covered by unit
tests; `routes/` is a thin adapter; `repositories/` holds every SQL string.

**Static assets** live in `public/` and are served by the `ASSETS` binding. The Worker only
intercepts `/api/*` and the clean URLs (`/feedback`, `/admin`, `/privacy`).

---

## Getting started

Requires Node 20+ and npm. **No Cloudflare account needed** — Wrangler simulates D1, the
assets binding and the Worker locally.

```bash
git clone https://github.com/Wapiy-y/p-massage.git
cd p-massage
npm install

cp .dev.vars.example .dev.vars     # set ADMIN_SLUG, SESSION_SECRET, IP_SALT
npm run db:migrate:local           # schema + demo content + the seeded admin
npm run dev                        # http://localhost:8787

# Admin (local): http://localhost:8787/admin-local-dev
#   username: admin
#   password: whatever you seed with (see Admin access)
```

Local data is stored in `.wrangler/state/`. Delete that directory to start clean. Note the
local database file is keyed by the `database_id` in `wrangler.toml`, so changing that id
starts an empty local database — re-run the migrations if that happens.

---

## Scripts

| Script                                 | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `npm run dev`                          | Wrangler dev server (Worker + D1 + assets) |
| `npm run deploy`                       | Deploy to Cloudflare                       |
| `npm test`                             | Vitest unit tests                          |
| `npm run typecheck`                    | `tsc --noEmit`                             |
| `npm run lint` / `lint:fix`            | ESLint over the whole repo                 |
| `npm run format` / `format:check`      | Prettier                                   |
| `npm run check`                        | typecheck + lint + format:check + tests    |
| `npm run db:migrate:local` / `:remote` | Apply schema                               |
| `npm run db:seed:local`                | Load demo content                          |
| `npm run db:export`                    | Dump the remote database                   |

CI, if you add it back, should be `npm run check`.

---

## Configuration

**Variables** (`wrangler.toml` — public, committed):

| Name                 | Default | Meaning                                      |
| -------------------- | ------- | -------------------------------------------- |
| `RATE_LIMIT_MAX`     | `3`     | Reviews per connection per hour              |
| `TURNSTILE_SITE_KEY` | —       | Public widget key; empty disables the widget |

**Secrets** (`wrangler secret put`, never committed):

| Name               | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `ADMIN_TOKEN`      | Admin passphrase, also the session signing key                     |
| `IP_SALT`          | Salt for visitor hashing — rotate with care, it resets rate limits |
| `TURNSTILE_SECRET` | Server-side Turnstile key                                          |

`TURNSTILE_SECRET` and `IP_SALT` missing on a non-localhost host is a **hard failure**, not
a silent bypass: the form refuses submissions rather than running unprotected.

---

## API

| Method    | Path                                           | Auth      | Purpose                             |
| --------- | ---------------------------------------------- | --------- | ----------------------------------- |
| GET       | `/api/config`                                  | public    | Limits + Turnstile site key         |
| GET       | `/api/profile`                                 | public    | Profile + active services           |
| GET       | `/api/reviews?cursor=&rating=&service=&limit=` | public    | Published reviews, keyset paginated |
| GET       | `/api/reviews/summary`                         | public    | Average, count, distribution        |
| POST      | `/api/reviews`                                 | Turnstile | Create review as `pending`          |
| POST      | `/api/admin/login`                             | —         | Passphrase → signed cookie          |
| POST      | `/api/admin/logout`                            | —         | Clear cookie                        |
| GET       | `/api/admin/session`                           | —         | Is the caller authorised?           |
| GET       | `/api/admin/reviews?status=`                   | admin     | Queue + counts                      |
| PATCH     | `/api/admin/reviews/:id`                       | admin     | `{ status }` and/or `{ reply }`     |
| DELETE    | `/api/admin/reviews/:id`                       | admin     | Permanent delete                    |
| GET · PUT | `/api/admin/profile`                           | admin     | Read/update profile + services      |

### Submit pipeline

1. **Turnstile** — verified server-side when a secret is configured
2. **Validation** — rating 1–5, message 10–1000 chars, known service id, consent ticked,
   honeypot empty, at least 1.2 s spent on the form
3. **Rate limit** — atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, 3 per hour
4. **Insert** as `pending` — nothing is public until a human approves it

Bodies are capped at 16 KB and must be JSON objects. Validation failures cost no rate-limit
slot, so fixing a typo does not lock a real visitor out.

Pagination is keyset on `(created_at, id)` with a `<timestamp>.<id>` cursor — a dot
deliberately, because ids contain underscores and splitting on `_` would corrupt the cursor.

---

## Database

Two migrations, applied in order:

| File            | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `0001_init.sql` | `reviews`, `profile`, `services`, `rate_limits` + indexes |
| `0002_seed.sql` | Demo content for local development                        |

Migrations are idempotent and tracked in `d1_migrations`, so
`npm run db:migrate:remote` is safe to re-run. After changing the schema:

```bash
npx wrangler d1 migrations apply massage-feedback --remote
```

None of the automated paths run migrations — this is manual by design.

---

## Deployment

Production deploys run in **Cloudflare Workers Builds** (Worker `massage` → Settings →
Build), connected to this repository:

| Setting        | Value                     |
| -------------- | ------------------------- |
| Build command  | `npm ci && npm run check` |
| Deploy command | `npx wrangler deploy`     |
| Branch         | `main`                    |
| Root directory | _(repository root)_       |

`npm run check` in the build command means a failing typecheck, lint error or failing test
blocks the deploy.

To deploy by hand instead:

```bash
npx wrangler login
npx wrangler d1 migrations apply massage-feedback --remote
npx wrangler secret put ADMIN_SLUG        # e.g. admin-7m4x2q — the admin path
npx wrangler secret put SESSION_SECRET    # openssl rand -hex 32
npx wrangler deploy
```

**Infrastructure in use**

| Resource  | Identifier                                                  |
| --------- | ----------------------------------------------------------- |
| Worker    | `massage` (APAC account `9af6679d3d31d759e1c1a24e2e475bf7`) |
| D1        | `massage-feedback` / `ef09ab96-ad99-48ab-abdb-4b28509c0119` |
| Turnstile | widget `massage`, hostname-scoped to the Worker URL         |
| Cron      | `17 3 * * *` — purges IP hashes older than 30 days          |

The Worker is named `massage` while the database is `massage-feedback`; they were created at
different times. `wrangler.toml` must keep `name = "massage"` in step with the dashboard, or
a Git build and a CLI deploy target two different Workers.

---

## Testing

```bash
npm test        # 22 unit tests
npm run check   # everything
```

Covered: review and profile validation, the honeypot, the time-to-fill floor, service
id derivation, session signing, tampered-expiry rejection, constant-time comparison, cookie
parsing and the `Secure` flag.

Not covered by unit tests: the route and repository layers, which need a D1 instance. They
are exercised by running `npm run dev` and clicking through — see the manual checklist below.

**Manual checklist before release**

- [ ] `/` renders profile, services and published reviews
- [ ] The location button in the profile card opens directions in a new tab
- [ ] Feedback carousel advances on its own and pauses on hover/focus
- [ ] On a laptop the whole page fits one screen with no scrolling; on a phone it stacks
- [ ] `/feedback` submits, shows the thank-you screen, and the review appears as pending
- [ ] `/admin` and `/admin.html` both return 404
- [ ] `/<slug>` shows the login gate; wrong credentials are rejected, correct ones open the queue
- [ ] Eleven wrong sign-ins in a row return `429` with a `Retry-After` header
- [ ] Published review appears on `/` without a reload
- [ ] Unknown path returns the 404 page

---

## Layout

One page, two modes, driven purely by CSS:

| Viewport                | Behaviour                                                                        |
| ----------------------- | -------------------------------------------------------------------------------- |
| Mobile (< 900 px)       | Single stacked column, generous spacing, normal page scroll                      |
| Laptop (≥ 900 × 620 px) | Two columns, `height: 100dvh`, page scroll disabled — everything fits one screen |

The desktop rules live at the end of `public/styles.css`. They do not change any markup: the
same DOM renders both modes. Feedback is shown as a carousel — one card at a time, advancing
every 6 seconds — which pauses on hover, on keyboard focus, when the tab is hidden, and never
auto-advances at all when the visitor prefers reduced motion.

If content ever outgrows a very short laptop screen, the safe change is to lower the
`min-height` in that media query (letting it fall back to the phone layout) rather than
allowing the page to scroll in a mode that promises it won't.

---

## Conventions

Guidelines the codebase follows, so changes stay cheap:

- **Layers depend downward only.** Routes → services → repositories. No SQL in a route, no
  HTTP types in a service, no business rules in a repository.
- **Pure logic has no imports from `lib/` or `repositories/`.** That is what makes `domain/`
  unit-testable without a runtime.
- **Numbers live in `config/limits.ts`.** No magic constants scattered through handlers.
- **DTOs are separate from rows.** `PublicReview` is a deliberate subset of `ReviewRow`; a
  schema change cannot leak a column by accident.
- **Comments explain why, not what.** Ordering constraints (validate before rate limiting),
  the cursor separator, and the reason for the HMAC cookie are all documented at the point
  they matter.
- **A deprecation is deleted, not commented out.** The original Node implementation lives in
  git history only.
- **`npm run check` must pass** before a commit — it is the same gate the Cloudflare build
  runs.

---

## Admin access

There are **two independent barriers**, and they protect different things:

1. **A secret path.** The admin area lives at `/<ADMIN_SLUG>` (for example `/admin-7m4x2q`), and
   its API at `/api/<ADMIN_SLUG>/…`. Anything else — `/admin`, `/admin.html`, `/api/admin/*` —
   returns a plain `404`, so a scanner learns nothing about whether an admin area exists.
   The slug is a **Worker secret**, not a committed variable, and the admin page is bundled
   into the Worker rather than served from `public/`, so neither the URL nor the filename
   appears in this repository.

2. **A username and password.** One seeded account, verified against a PBKDF2-SHA256 hash in
   D1. There is no signup, no password reset email, and no account list.

Obscurity alone is not security. The slug keeps `wp-admin`-style scanners away; the password
and the 10-attempts-per-15-minutes limiter are what actually stop someone who has the URL.

### The seeded account

`migrations/0003_admin_users.sql` creates the `admins` table and seeds one row:

| Field    | Value                                                   |
| -------- | ------------------------------------------------------- |
| username | `admin`                                                 |
| password | **not in this repository** — only its hash is committed |
| hashing  | PBKDF2-SHA256, 10,000 iterations, 16-byte salt          |

Ask whoever deployed it for the password, or set a new one:

```bash
node scripts/hash-password.mjs 'a long new password'
# then:
npx wrangler d1 execute massage-feedback --remote --command \
  "UPDATE admins SET password_hash = '<printed hash>' WHERE username = 'admin'"
```

10,000 iterations is deliberate: PBKDF2 runs natively in Workers, but 100k risks the free
plan's 10 ms CPU budget and would make login fail outright. Online guessing is capped by the
attempt limiter, and the password is long and random, so the trade is sound.

To rotate the admin path itself: `npx wrangler secret put ADMIN_SLUG` and redeploy.

---

## Security

- **Stateless sessions.** `v1.<expiry>.<HMAC-SHA256>` in an `HttpOnly`, `SameSite=Lax`
  cookie, `Secure` off localhost only. Extending the expiry invalidates the signature.
- **Two gates on admin routes.** Cloudflare Access (when configured) or a valid cookie;
  the guard is attached per route so it cannot swallow unrelated paths.
- **Login attempts are throttled.** Ten wrong passphrases per 15 minutes per hashed caller,
  then `429` with `Retry-After`. Only _failures_ are counted, so a therapist signing in
  repeatedly is never locked out. The decision logic lives in `services/admin-auth.ts` with
  injected dependencies, so it is unit-tested without a database.
- **Raw IPs are never stored.** Only `SHA-256(salt + ip)`, purged after 30 days by cron.
- **Atomic rate limiting** closes the read-then-write race.
- **No `innerHTML` on user content.** Every review is rendered with `textContent`.
- **Fail closed.** A missing Turnstile secret or IP salt in production refuses submissions
  rather than quietly accepting them.
- **Hardening headers** on every response: `nosniff`, `DENY` framing, referrer policy,
  restrictive permissions policy.

---

## Known limitations

- Reviews cannot be edited or withdrawn by their author.
- No notification when a review arrives — check `/admin`.
- English only; no BM toggle.
- The feed filters by star rating only, not by service.
- No sitemap or OG share image.
- No analytics, deliberately.
- The admin area is protected by a secret URL plus password/attempt-throttling. Cloudflare
  Access is **not** configured: self-hosted Access apps need a hostname on a zone you own,
  and the Worker lives on `*.workers.dev`. Adding a custom domain would let you put Access in
  front of `/<slug>` as a third barrier.
- The secret slug is obscurity, not authorisation. Treat the password as the real control.
- There is no password reset flow and no way to change the password from the UI — rotation is
  the CLI command above.
