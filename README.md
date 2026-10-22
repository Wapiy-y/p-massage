# Massage therapist feedback site

A mobile-first site for an independent massage therapist: a public page with services,
prices and client feedback, a standalone anonymous feedback form, and a moderation queue
for the therapist.

Built on **Cloudflare Workers** with **Hono**, **TypeScript** and **D1**.

- Live: <https://massage.wafiyabdullah39.workers.dev>
- Feedback form (unlisted): `/feedback`
- Admin: `/admin`

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

cp .dev.vars.example .dev.vars     # set ADMIN_TOKEN and IP_SALT
npm run db:migrate:local
npm run db:seed:local              # demo profile, 5 services, 8 reviews, 2 pending
npm run dev                        # http://localhost:8787
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
npx wrangler secret put ADMIN_TOKEN
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
- [ ] Star filter and "Load more" both work
- [ ] `/feedback` submits, shows the thank-you screen, and the review appears as pending
- [ ] `/admin` rejects a wrong passphrase, accepts the right one, publishes the review
- [ ] Published review appears on `/` without a reload
- [ ] Unknown path returns the 404 page

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

## Security

- **Stateless sessions.** `v1.<expiry>.<HMAC-SHA256>` in an `HttpOnly`, `SameSite=Lax`
  cookie, `Secure` off localhost only. Extending the expiry invalidates the signature.
- **Two gates on admin routes.** Cloudflare Access (when configured) or a valid cookie;
  the guard is attached per route so it cannot swallow unrelated paths.
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
- `/admin` uses a passphrase unless Cloudflare Access is configured in front of it.
