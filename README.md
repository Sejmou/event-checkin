# event-checkin

SvelteKit + Drizzle (SQLite) + better-auth.

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — SQLite file path, e.g. `local.db`
- `ORIGIN` — base URL, e.g. `http://localhost:5173`
- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`

Create the tables, then run the dev server:

```sh
pnpm db:push
pnpm dev            # or: pnpm dev:tailscale  (needs the tailscale CLI)
```

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
| `pnpm db:generate` / `pnpm db:migrate`           | Generate / apply migration files                                          |
| `pnpm db:studio`                                 | Drizzle Studio                                                            |

`pnpm auth:schema` needs `DATABASE_URL` set, because it loads `src/lib/server/auth.ts`,
which imports the db client. After changing the better-auth config, run `auth:schema`
then `db:push`.

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
