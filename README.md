# event-checkin

SvelteKit + Drizzle (SQLite) + better-auth.

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — SQLite file path, e.g. `local.db`
- `ORIGIN` — public base URL, e.g. `http://localhost:5173`
- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
- `PASSKEY_RP_ID` — hostname only, e.g. `localhost` (see [Passkeys](#passkeys))

Create the tables, then seed an admin and the guest list:

```sh
pnpm db:push
pnpm db:seed --admin ops@example.com data/attendees.json
pnpm dev            # or: pnpm dev:tailscale  (needs the tailscale CLI)
```

## How people get accounts

There is no sign-up. Accounts are seeded ahead of time and claimed in person.

1. `pnpm db:seed --admin <email> [attendees.json]` creates the initial admin — it
   prompts for their password — and seeds the guest list as **unclaimed** accounts.
   `--admin` is required. Re-running is safe: existing emails are left alone.
2. The admin signs in at `/login` with that password, and is prompted to add a passkey
   (skippable; it asks again next sign-in until they do).
3. At `/admin` a QR code is displayed. It **rotates every 30 seconds** — leave the page
   open on the check-in screen.
4. A guest scans it with their own phone, enters the email they were invited with, and
   is prompted to create a passkey. Only if their device can't do passkeys are they
   asked to set a password instead.
5. That's the account claimed. The guest signs in at `/login` from then on.

`data/attendees.json` (the `/data` dir is gitignored):

```json
[{ "email": "alice@corp.com", "firstName": "Alice", "lastName": "Ng" }]
```

### What the QR code actually proves

The code is an HMAC of the current 30-second time bucket — derived from the clock, not
stored anywhere. The claim route recomputes it and accepts the current bucket and the
previous one, so a scan that crosses a rotation still works.

It is deliberately **multi-use**: everyone who scans the code during its window can
claim, which is the point of leaving it on screen. What it proves is that the scanner
was looking at the check-in screen within the last half-minute — nothing more. On a
successful scan the guest gets a signed, short-lived presence cookie, so the code
rotating while they type their email costs them nothing.

Two things follow from this, both deliberate:

- **Closing the kiosk tab does not stop claiming.** Nobody can claim without having
  seen a code, but there is no off switch. The smallest fix, if it's ever wanted, is a
  `claim_open_until` timestamp the kiosk refreshes on each rotation.
- **Anyone who scans could try other people's addresses.** Unknown, already-claimed and
  not-on-the-list all return the same message, and the form is rate-limited per
  presence cookie, so it leaks nothing and probing is slow.

## Passkeys

`PASSKEY_RP_ID` must match the hostname in the browser's address bar — no scheme, no
port. Changing it later invalidates every passkey already registered, so settle it
before the event.

WebAuthn also needs a **secure context**: HTTPS, or `localhost` exactly. Guests scan on
their own phones, so plain-HTTP LAN or Tailscale testing will always fall through to
the password branch. That is the fallback working correctly, but it means the passkey
path can't be tested off `localhost` without `tailscale serve` or a real certificate.

Device support is detected with `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`.
That check misreports on private-mode browsers and managed devices, in both directions,
so the UI always keeps a manual way over to the password form.

## Commands

| Command                                          | What it does                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`                                       | Dev server                                                                |
| `pnpm build` / `pnpm preview`                    | Production build (adapter-node) / preview it                              |
| `pnpm check`                                     | `svelte-check`                                                            |
| `pnpm lint` / `pnpm format`                      | Prettier + ESLint                                                         |
| `pnpm test:unit` / `pnpm test:e2e` / `pnpm test` | Vitest / Playwright / both                                                |
| `pnpm auth:schema`                               | Regenerate `src/lib/server/db/auth.schema.ts` from the better-auth config |
| `pnpm db:push`                                   | Apply the schema straight to the DB (no migration files)                  |
| `pnpm db:seed`                                   | Seed the initial admin and the guest list                                 |
| `pnpm db:generate` / `pnpm db:migrate`           | Generate / apply migration files                                          |
| `pnpm db:studio`                                 | Drizzle Studio                                                            |

`pnpm auth:schema` needs `DATABASE_URL` set, because it loads `src/lib/server/auth.ts`,
which imports the db client. After changing the better-auth config, run `auth:schema`
then `db:push`.

`pnpm db:seed` runs through `scripts/run.js`, a five-line Vite SSR loader. Node can't
resolve SvelteKit's `$env/*` and `$lib/*` aliases on its own and SvelteKit ships no
script runner, so the seed script would otherwise need its own copy of the auth config.

Tests read `.env.test`, which points `DATABASE_URL` at a scratch database. Vite gives
`.env.test` precedence over `.env` in test mode, and `$env/dynamic/private` reads what
Vite loaded — so overriding `process.env` from inside a spec does **not** work.

## The `user.name` quirk

The user model has `first_name` and `last_name`. It also has a `name` column that
nothing should read. Here is why it still exists.

better-auth hardcodes `name` on its user model — it is not a default you can turn off:

- `@better-auth/core/dist/db/get-tables.mjs` builds the `user` table with `name` as a
  required field. `user.additionalFields` only adds fields, and `user.fields.name` only
  renames its column.
- `better-auth/dist/api/routes/sign-up.mjs` hardcodes `name: z.string()` in the
  `/sign-up/email` body schema, so it is required on every sign-up regardless.

So `src/lib/server/auth.ts` does the next best thing:

- `firstName` / `lastName` are required `user.additionalFields` → `first_name` /
  `last_name`, both `NOT NULL`. These are the real fields.
- `name` is overridden to `required: false, input: false`, making the column nullable
  and keeping it out of user-facing input.

Callers still have to pass `name` to `signUpEmail` because of the zod schema above, so
the sign-up action sets it to `` `${firstName} ${lastName}` ``. It is a write-only
display leftover — read `firstName` / `lastName` instead.

Two things that follow from this:

- **Nothing keeps `name` in sync on update.** A `databaseHooks.user.update.before` hook
  would, but adding `databaseHooks` to the config makes TypeScript give up on inferring
  the options generic, and `signUpEmail`'s body type and `auth.$Infer` collapse back to
  the base user type without the additional fields. Not worth it while nothing reads
  `name`.
- **`src/app.d.ts` infers `Locals` from `auth.$Infer.Session`**, not from
  `import type { User } from 'better-auth'`. The exported `User` is the base type and
  does not carry additional fields, so `locals.user.firstName` would not typecheck.

`src/lib/server/auth.spec.ts` pins all of this down.

## Schema notes

Everything the claim flow needs lives on better-auth's own tables. The only additions
are two columns on `user`, both declared in `src/lib/server/auth.ts` as
`additionalFields` with `input: false` so nobody can set them on themselves:

- `claimed_at` — `NULL` means the account is seeded but unclaimed. That single nullable
  timestamp is the whole "inactive account" concept.
- `role` — `attendee` or `admin`. Named `role` rather than `is_admin` so adopting
  better-auth's `admin` plugin later is a no-op instead of a migration.

Deliberately absent:

- No pending-user or invite table — a seeded row goes straight into `user`, so the
  `UNIQUE` constraint on email is the dedupe and passkeys can reference `user.id` at once.
- No claim-token table — the QR code is derived from the clock (see above).
- No `auth_method` column — a `passkey` row or a `credential` `account` row already says
  which one somebody used, and a copy of that can only drift.
- No "has the admin added a passkey" column — that is the `passkey` table.

Passwords (the admin's, and the guest fallback) go in better-auth's `account` table as
`provider_id = 'credential'`. Passkeys go in the `passkey` table from
`@better-auth/passkey`. Both arrive via `pnpm auth:schema`.
