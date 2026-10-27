# Node Effect backend template

Reusable backend starter: Node.js 26, Effect 4, PostgreSQL and Drizzle, with an
HTTP API, a persistent worker, and a production deployment to a single VPS
behind Cloudflare Tunnel. The users feature and the polling job are examples to
replace with your own.

Node runs the TypeScript sources directly: there is no build step. Packages
follow dependency boundaries and application code is grouped by feature. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for code placement, Effect composition and
testing conventions, and [READABILITY.md](./READABILITY.md) for the code style
that lint cannot check.

## Prerequisites

- **pnpm 12**, installed standalone (see
  [pnpm's installation guide](https://pnpm.io/installation)). The repository
  pins `pnpm@12.15.0` in `packageManager` and `devEngines`, and pnpm switches to
  that version by itself. A Corepack shim from an older Node also works through
  `packageManager`; Node 26 itself ships without Corepack.
- **No separate Node install.** `devEngines.runtime` pins Node `26.12.1`, and
  `pnpm install` downloads it into `node_modules`. Every `pnpm run` and
  `pnpm exec` uses that copy, whatever `node` your shell has.
- **Docker** with Compose, for PostgreSQL and the container stack.
- **Bash and curl**, for the Docker smoke test.

## Getting started

After creating a repository from this template, give it its own name before
making other changes:

```sh
pnpm run init my-project
cp .env.example .env
pnpm install
docker compose up -d --wait postgresql
pnpm db:migrate
```

- `pnpm run init` rewrites the package scope, database names, image and Compose
  project names, and service keys in every text file, then reformats the files
  it changed, because the new name changes line lengths. pnpm installs the
  dependencies first when `node_modules` is missing. Use `pnpm run init`:
  `pnpm init` is pnpm's own command.
- `pnpm install` links the renamed workspace packages and installs the Git
  hooks.
- Keep real secrets out of committed files; `.env` is ignored by Git.

Then run the applications in separate terminals:

```sh
pnpm dev:api
pnpm dev:worker
```

Both load `.env` with `node --env-file` and restart when a source file changes.
The API listens on `http://127.0.0.1:8000`; open `/docs` for Swagger UI.

### Environment

| Variable                                            | Default            | Used by                                                           |
| --------------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `DATABASE_URL`                                      | required           | API, worker, migrations, Drizzle Kit, PostgreSQL tests            |
| `API_HOST`                                          | `127.0.0.1`        | API                                                               |
| `API_PORT`                                          | `8000`             | API; Compose also publishes the container API on it               |
| `WORKER_POLL_INTERVAL_MS`                           | `5000`             | Worker: the pause after each pass of a job                        |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | see `.env.example` | Compose's PostgreSQL, and the database URL Compose gives the apps |
| `POSTGRES_PORT`                                     | `5432`             | The loopback port Compose publishes PostgreSQL on                 |

`packages/config` validates the application variables; `DATABASE_URL` stays
redacted in logs. If you change `POSTGRES_PORT` or the credentials, change
`DATABASE_URL` in `.env` to match.

## Application behavior

| Endpoint            | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `GET /health/live`  | Process liveness; never touches PostgreSQL                                       |
| `GET /health/ready` | PostgreSQL readiness (`select 1`, 5 second timeout); 503 when unavailable        |
| `GET /health`       | Alias for readiness                                                              |
| `GET /users`        | Up to `limit` users (1–100, default 50), newest first; 400 for any other `limit` |
| `GET /users/:id`    | One user; 400 for a malformed id, 404 when unknown                               |
| `POST /users`       | 201 with the user; 400 for invalid input, 409 for a taken email, 413 > 4 KiB     |
| `GET /openapi.json` | OpenAPI 3.1 document generated from the endpoint contracts                       |
| `GET /docs`         | Swagger UI for that document                                                     |

Every error response has the same shape, and the contract lists each code an
endpoint can return:

```json
{ "error": { "code": "USER_NOT_FOUND", "message": "User not found" } }
```

Invalid path parameters, query strings, headers, malformed JSON and unknown
fields are `400 INVALID_REQUEST`. A failed database operation is
`500 DATABASE_ERROR`; failed readiness is `503 DATABASE_UNAVAILABLE`. Responses
never carry the cause, and logs carry only safe diagnostics such as a SQLSTATE
code.

The API starts while the database is unavailable, because the connection pool
opens connections on demand. Liveness stays 200 during an outage; readiness and
user requests fail until PostgreSQL returns.

The worker runs each job on its own loop, waiting `WORKER_POLL_INTERVAL_MS`
after each pass. The example job reads up to five users and logs how many it
found. The first failure in any loop stops the worker with exit code 1, and the
process supervisor (Compose's `restart: unless-stopped`) starts it again. The
polling example provides no claims, leases, checkpoints or retries.

For one pass of every job, then exit:

```sh
pnpm sample:worker
# Or, with the container image built:
docker compose run --rm worker-once
```

## Scripts

| Script                                | What it does                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm run init <name>`                | Renames the template (run once, first)                                                                |
| `pnpm dev:api`, `pnpm dev:worker`     | Runs the API or worker with `.env`, restarting on changes                                             |
| `pnpm start:api`, `pnpm start:worker` | Runs the API or worker with `.env`, without watching                                                  |
| `pnpm sample:worker`                  | Runs one pass of every worker job, then exits                                                         |
| `pnpm db:generate --name=<change>`    | Generates a migration in `drizzle/` from schema changes (Drizzle Kit)                                 |
| `pnpm db:check`                       | Prints Drizzle Kit's migration check; it exits 0 even when the schema differs                         |
| `pnpm db:verify`                      | Fails when the schema files and the migrations in `drizzle/` differ; part of `pnpm check`             |
| `pnpm db:migrate`                     | Applies pending migrations with `packages/database/src/migrate.ts`                                    |
| `pnpm db:studio`                      | Opens Drizzle Studio                                                                                  |
| `pnpm openapi`                        | Prints the OpenAPI document: `pnpm --silent openapi > openapi.json`                                   |
| `pnpm fmt`                            | Formats every file with oxfmt                                                                         |
| `pnpm lint`                           | Lints with oxlint                                                                                     |
| `pnpm fix`                            | Formats, then applies safe lint fixes                                                                 |
| `pnpm typecheck`                      | Type-checks with `tsc`                                                                                |
| `pnpm test`                           | Runs the unit tests                                                                                   |
| `pnpm test:postgres`                  | Runs the tests that need PostgreSQL                                                                   |
| `pnpm check`                          | Format check, lint, type check, migration drift check and unit tests: what CI and the image build run |
| `pnpm smoke:docker`                   | Smoke-tests a built image against a real PostgreSQL                                                   |

## Toolchain

- **TypeScript without a build.** Node 26 strips types when it loads a `.ts`
  file. That rules out syntax that needs code generation: relative imports end
  in `.ts`, type-only imports use `import type`, and there are no enums,
  namespaces, parameter properties or `<T>value` assertions. `tsconfig.json`
  turns on `erasableSyntaxOnly` and `verbatimModuleSyntax`, so `tsc` reports
  these constructs, value imports used only as types, and relative imports
  without an extension. `tsc` accepts a relative import ending in `.js`, though,
  and Node then fails to load it, so lint rejects one.
- **Vite+ (`vp`)** is the one CLI for formatting (oxfmt), linting (oxlint) and
  tests (Vitest 5). `vp check` checks formatting and lint; `vp check --fix`
  formats, then applies lint fixes. `vite.config.ts` loads the rules from
  `.oxlintrc.json` and `.oxfmtrc.json`, so editors and the standalone `oxlint`
  and `oxfmt` binaries apply the same rules. It also defines the `unit` and
  `postgres` test projects and the pre-commit `staged` command.
- **Lint** turns on oxlint's correctness category plus explicit rules, and the
  anti-slop rules in `tools/oxlint/anti-slop`: vendored from Ekze, plus
  `blank-line-around-multiline-statements` added here. Don't edit them to make
  code pass. They enforce import order, a trailing export list, a `SAFETY:`
  comment before every type assertion, blank lines before `return` and around
  multi-line blocks and statements, no nested ternaries, and no module mocking,
  among others. [READABILITY.md](./READABILITY.md) says which of its rules lint
  enforces.
- **Config-only lint guards** in `.oxlintrc.json` reject `console`,
  `process.env` (read `AppConfig`) and `Effect.run*` (run effects with
  `NodeRuntime.runMain` in an entry point) in `apps/` and `packages/`. They
  reject imports of `@node-effect/database` and `effect/sql` in every folder
  under `apps/*/src/`, tests included; only the composition roots directly in
  `src/` may import them. Everywhere, they reject non-null assertions (`x!`),
  `{…} as T` object literal assertions and shadowed names. Tests,
  `*.postgres.ts`, `*.fixtures.ts` and `postgres.setup.ts` may use `console`,
  `process.env`, `Effect.run*` and `!`. The `Effect.run*` guard matches the call
  as written, so `import { runPromise } from "effect/Effect"` slips past it.
- **Formatting** follows `.oxfmtrc.json`: width 80, double quotes, semicolons,
  trailing commas, and Markdown prose wrapped at 80 columns. Import sorting is
  lint's job, in five groups: `node:` built-ins, packages, `@node-effect/*`,
  `../`, then `./`.
- **Type checking** uses `tsc` from TypeScript `7.1.0-beta` with the single root
  `tsconfig.json` (strict, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, and unused-code checks). Lint is not type-aware;
  `tsc` is the authoritative type check.
- **Git hooks.** `pnpm install` runs `prepare` (`vp config --no-agent`), which
  points Git's `core.hooksPath` at the dispatcher in `.vite-hooks/_`. The hooks
  themselves are `.vite-hooks/pre-commit` and `.vite-hooks/pre-push`. Before a
  commit, `vp staged` formats and lints the staged files; before a push, the
  hook runs the type check and unit tests. `pnpm exec vp hooks disable` turns
  them off for a clone, and `VP_GIT_HOOKS=0` skips both installing and running
  them.

## Testing

- **`pnpm test`** runs every `*.test.ts` under `apps/`, `packages/` and
  `scripts/`. These need no database or network. They use `@effect/vitest`
  (`it.effect`, and `TestClock` from `effect/testing`) and replace services with
  layers; module mocking fails lint. API tests check every response against the
  endpoint contract, and the served OpenAPI document against the one generated
  from the code. Database adapter tests run the real Drizzle queries against a
  fake PostgreSQL client.
- **`pnpm test:postgres`** runs every `*.postgres.ts` under `apps/` and
  `packages/`, one file at a time, against a real PostgreSQL. Each test creates
  a schema with a random name, applies the migrations in `drizzle/`, and drops
  the schema afterwards. It needs `DATABASE_URL`, from the environment or
  `.env`; with the local stack, `docker compose up -d --wait postgresql` is
  enough. It is not part of `pnpm check`; CI runs it as its own job.

## Database schema and migrations

```sh
pnpm db:generate --name=describe-change
pnpm db:verify
pnpm db:migrate
pnpm db:studio
```

Drizzle Kit generates migrations from the table definitions in every
`packages/database/src/<feature>/schema.ts` (the `schema` glob in
`drizzle.config.ts`), so a new feature's table file needs no config change. It
reads `.env` itself. Commit each generated `drizzle/<timestamp>_<name>/` folder.

`pnpm db:verify`, which `pnpm check` also runs, fails when a schema change has
no migration, including an index or constraint that no test would notice.
Drizzle Kit's own `check` reports that only as a warning and exits 0. The
verification reads files only and needs no database or `DATABASE_URL`.

`pnpm db:migrate`, the Compose `migrate` service and production releases all run
`packages/database/src/migrate.ts`. It applies pending migrations in one
transaction and records them in `drizzle.__drizzle_migrations`, the same journal
Drizzle Kit uses, so either tool skips what the other applied. Neither
application migrates at startup.

## Local container stack

The default Compose setup runs only PostgreSQL, published on
`127.0.0.1:${POSTGRES_PORT:-5432}` by `docker-compose.override.yml` for native
commands. For the complete stack:

```sh
docker compose --profile app up -d --build --wait
docker compose logs -f api worker
```

The image build runs `pnpm check`. Compose waits for PostgreSQL, runs `migrate`,
then starts the API and worker. The apps get a database URL built from
`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`, so use URL-safe
credentials. The API is published on `127.0.0.1:${API_PORT:-8000}`; do not run
the native and container APIs on the same port. Rebuild with the same command
after changes. To apply new migrations through the image, rebuild it and run
`docker compose run --rm migrate`.

Every container has a read-only root filesystem, no Linux capabilities and
`no-new-privileges`. The application containers can write only to a 16 MB `/tmp`
and run at most 128 processes and threads. PostgreSQL starts as the image's
`postgres` user and writes only to its volume, `/var/run/postgresql` and `/tmp`.
Code that writes files must use `/tmp` or a volume.

Database data survives container recreation and `docker compose down`; adding
`--volumes` deletes it.

### Docker image

The `Dockerfile` builds one image for the API (its default command), the worker,
the one-shot worker and migrations:

- A `check` stage installs every dependency and runs `pnpm check`. The runtime
  stage depends on it, so code that fails the checks never becomes an image.
- The runtime stage installs production dependencies only and runs as the
  image's non-root `node` user. The build fails if the base image's Node version
  differs from `devEngines.runtime`.
- `node` is PID 1 (`CMD ["node", "apps/api/src/main.ts"]`), so it receives stop
  signals directly. Never start a container through `pnpm`, which does not pass
  signals on to Node.
- The image also carries `deploy/vps` as `/app/deploy/vps`, from which the
  server's release script installs `compose.yml` and `bin/`. The `check` stage
  leaves `deploy/` out, so a deployment-only change does not rerun the checks.

### Smoke test

```sh
docker build -t node-effect-template:local .
pnpm smoke:docker
```

`scripts/smoke-docker.sh` starts the image in an isolated Compose project with a
fresh database. It checks liveness and readiness, runs `scripts/smoke-api.ts`
inside the API container (every endpoint, error status and the OpenAPI and docs
pages), and runs `worker-once` and `migrate` again. It checks that the worker
has completed a pass without restarting, then stops PostgreSQL to check that
liveness stays up, readiness returns 503 and the worker restarts. Finally it
restores the database and checks that the data and migration history survived
and that the worker completes a pass again. It removes only its own containers
and volume.

`scripts/smoke-api.ts` creates `ada@example.com` and expects to find her alone,
so run it only against a freshly migrated database, never production.

## Continuous integration

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on pull requests,
cancelling superseded runs. On `main` it runs once per push, as the first stage
of the Release workflow, which calls it as a reusable workflow. It has three
jobs:

| Job        | What it runs                                                        |
| ---------- | ------------------------------------------------------------------- |
| `check`    | `pnpm install --frozen-lockfile`, then `pnpm check`                 |
| `smoke`    | Builds the image (which runs `pnpm check` again) and the smoke test |
| `postgres` | `pnpm test:postgres` against a PostgreSQL service container         |

Every action is pinned to a commit SHA. Protect `main` with a ruleset that
requires the `check`, `smoke` and `postgres` checks; the
[VPS guide](./deploy/vps/README.md#7-github) has the settings. If you delete
`release.yml`, add `push: { branches: [main] }` to `ci.yml`'s triggers so `main`
keeps its CI.

## Deployment

Production is one x86-64 Linux VPS running the Docker Compose project in
[`deploy/vps/`](./deploy/vps/). Cloudflare Tunnel is the only ingress, and
nightly encrypted backups go to S3-compatible storage with restic. There is one
environment; local development and CI are the checks before production.

Every push to `main` starts
[the Release workflow](./.github/workflows/release.yml), which also runs on
manual dispatch. It runs the whole CI first, including the PostgreSQL tests,
then builds and smoke-tests the image, pushes it to GitHub Container Registry
tagged with the commit SHA, and sends that SHA over SSH to the server, whose
`bin/release` takes everything else from the image. The release script migrates
once, then restarts the API, worker and tunnel, and fails if the worker or
tunnel keeps restarting. See [the VPS guide](./deploy/vps/README.md) for server
setup, secrets, rollback, backups, restore drills and monitoring.

The release job runs only when the repository variable `PRODUCTION_HOST` is set,
so until the server exists, pushes to `main` run CI only. If you deploy another
way, delete `release.yml` and give `ci.yml` its push trigger back (see above).

## Editor

`.zed/settings.json` configures Zed with vtsls, the oxlint language server
(fixes as you type) and oxfmt (format on save). `.zed/debug.json` has debug
configurations for the API, the worker and the current Vitest file. All three
use the pinned Node in `node_modules/.bin/node`; the API and worker load `.env`.

## Exact dependency policy

- Node `26.12.1` (`devEngines.runtime`; the image uses
  `node:26.12.1-trixie-slim` pinned by digest)
- pnpm `12.15.0`
- `effect@4.0.6`, `@effect/platform-node@4.0.6`, `@effect/sql-pg@4.0.6`,
  `@effect/vitest@4.0.6`
- `drizzle-orm@1.0.0-rc.5`, `drizzle-kit@1.0.0-rc.5`
- `typescript@7.1.0-beta`, `@types/node@26.6.5`
- `vite-plus@1.4.0`, `vitest@5.0.5`, `oxlint@1.89.0`, `@oxlint/plugins@1.89.0`,
  `oxfmt@0.74.0`
- `pg@8.23.1`, for Drizzle Kit only
- `postgres:18.6-alpine`, pinned by digest

Every version is exact; there are no ranges. Dependencies shared by workspace
packages are declared once in the `catalog` of `pnpm-workspace.yaml` and
referenced as `catalog:`; workspace packages depend on each other with
`workspace:*`. The four Effect packages share one version, as do Drizzle ORM and
Kit. GitHub Actions are pinned by commit SHA and container images by digest. The
lockfile is committed, so indirect resolution is reproducible.

pnpm 12 does not resolve a version published less than a day ago unless you name
it exactly.

## Prerelease notes

- **Drizzle `1.0.0-rc.5`** is a release candidate. Unlike rc.4, it works with
  stable Effect 4 (`Schema.TaggedError`, `effect/sql`), so no patch is needed.
  `migrate.ts` uses its Effect migrator, `drizzle-orm/effect-postgres/migrator`.
- **TypeScript `7.1.0-beta`** is the Go-native compiler. Drizzle's declaration
  files do not type-check under it, so `skipLibCheck` must stay on.
- **Vite+ `1.4.0`** bundles Vitest. The `overrides` in `pnpm-workspace.yaml`
  keep one Vite (`vite-plus-core`) and one Vitest, so `vp test` and
  `@effect/vitest` share a runner. When upgrading Vite+, set them to the
  versions `pnpm exec vp toolchain` reports.
- **`@effect/platform-node`** declares `redis` as a required peer, although only
  its Redis module uses it; `packageExtensions` marks it optional.

## Caveats

- npm and npx refuse to run inside the repository (`EBADDEVENGINES`), because
  `devEngines` names pnpm. Use `pnpm exec` and `pnpm dlx`.
- A bare `node` in your shell is whatever is on your `PATH`, not the pinned
  `26.12.1`. Use `pnpm exec node` or a `pnpm` script.
- Signalling a `pnpm` process does not stop the Node process it started. Ctrl+C
  in a terminal signals both; process managers and containers must run `node`
  directly.
- `pnpm install` prints "Agent skills awaiting approval: drizzle-kit". It is a
  pnpm 12 notice; `pnpm approve` reviews it, and nothing else depends on it.
- A failed migration logs its safe diagnostics, such as the SQLSTATE code
  (`42P07`), but not PostgreSQL's message, which can contain stored values. Look
  up the code, or run the migration's SQL by hand against a local database.
- `actionlint` 1.7.12 reports the `queue` key under `concurrency` in
  `release.yml` as unknown. GitHub accepts it.
