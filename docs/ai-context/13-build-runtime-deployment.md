# Build, runtime, and deployment

[Context index](README.md) · [Testing](12-testing-verification.md) · [Security](09-api-auth-security.md)

Inspected on 19 October 2026. Commands below run from the `Works` repository root. Sources: [package.json](../../package.json), [build script](../../scripts/build.mjs), [startup](../../server/index.ts), [CLI](../../server/cli.ts), [database](../../server/db.ts), [Dockerfile](../../Dockerfile), [Compose](../../compose.yaml), and [environment example](../../.env.example). Local private configuration was not read for this inventory.

## Prerequisites and build boundary

`package.json` requires Node >=22.13. Docker selects Node 24 on Debian Bookworm. Use `npm ci` to install the lockfile, including native `better-sqlite3`; platform/compiler availability may matter if a matching native prebuild is unavailable. A local Node version or a historical document's “tested” statement is not a container/PostgreSQL certification.

`npm run build` executes TypeScript no-emit checks, Vite build, and tsup bundling of `server/index.ts`. It forces `NODE_ENV=production` for those child processes, independently of runtime cookie configuration. Outputs are `dist/` and `dist-server/`; these are generated artifacts. Knex, PostgreSQL, SQLite, and ExcelJS remain external server dependencies and must be installed at runtime.

The TypeScript configuration targets ES2022 with strict checks, bundler module resolution, and React's JSX transform. Vite builds browser assets and copies `public/`; tsup emits an ESM Node bundle. The server serves `dist/` and its SPA fallback only when `dist/index.html` exists. Running the backend without a frontend build still supplies API endpoints, not a complete built site.

## Development and database commands

```powershell
npm ci
# Create local environment configuration from .env.example, then set your own values.
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` runs `tsx watch server/index.ts` and Vite concurrently. The browser origin is port 5173; API default is port 3001. [vite.config.ts](../../vite.config.ts) proxies `/api`, `/uploads`, and the isolated calculator HTML/JS paths to `http://127.0.0.1:3001`. Changing API `PORT` alone does not change this hard-coded development proxy. Development browser requests remain same-origin to Vite.

`server/index.ts` automatically runs migrations at startup and seeds unless `SEED_SAMPLE_DATA` equals the literal string `false`. Manual migrate/seed commands also run migrations first. Seed is idempotent original example content plus the standard blueprint; it does not create student assessment history. Do not seed a live bank without understanding its current content and licensing.

`npm run admin` creates a new administrator using `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optional `ADMIN_NAME`. It rejects an already registered email and directs operators to role management; it is not an account-reset command. Normal startup can also create this configured admin if that email does not already exist. Supply unique credentials privately and remove bootstrap password configuration after use. The repository has no default login credentials or email/password-reset delivery service.

## Built local app and process helpers

```powershell
npm run build
# Use the built app's origin in your local configuration.
npm start
```

`npm start` runs `node dist-server/index.js`. Default host/port are loopback and 3001. For local plain HTTP use development-mode runtime cookies; production mode makes the session cookie Secure. Configure `APP_ORIGIN` to the actual browser origin (built local or public HTTPS), otherwise authenticated mutation-origin checks can fail. A production frontend build does not require production cookie settings for a local preview.

Windows helpers are [start-local.ps1](../../scripts/start-local.ps1) and [stop-local.ps1](../../scripts/stop-local.ps1):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
```

Start checks that frontend build output exists and that port 3001 is unused, starts hidden Node, writes `data/server.pid`, redirects logs to `data/server.log` and `data/server-error.log`, and polls local health. Stop verifies the saved PID's Node executable and exact server-entry command before stopping it. Helpers assume port 3001 even though normal startup supports a configured port; they are not a supervisor, automatic restart service, distributed process lock, or build step. If port/PID identity differs, inspect it rather than terminating an unrelated process. The server registers SIGINT/SIGTERM cleanup; `Stop-Process` is process termination and is not guaranteed to exercise that graceful path.

`GET /api/health` runs a database query and returns connection health. It does not prove writable uploads, authenticated flows, all migrations' semantic correctness, or external Desmos entitlement.

## Environment names and purposes

Values containing secrets are intentionally omitted. Defaults described elsewhere are public implementation behavior, not private configuration.

| Name                                                  | Consumer and purpose                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SQLITE_PATH`                                         | Database factory: SQLite filename when PostgreSQL is not selected.                                                    |
| `DATABASE_URL`                                        | Database factory: selects PostgreSQL for non-memory connections. Never log its credential-bearing value.              |
| `PORT`, `HOST`                                        | Server listener; Windows helpers/development proxy have their own fixed-port assumptions.                             |
| `APP_ORIGIN`                                          | Exact permitted mutation origin; also target origin for local smoke.                                                  |
| `NODE_ENV`                                            | Production Secure cookie and HTTPS-oriented CSP behavior; build script sets production in build children.             |
| `SEED_SAMPLE_DATA`                                    | Startup sample-content toggle; only literal `false` disables it.                                                      |
| `UPLOAD_DIR`                                          | Writable uploaded-image storage; resolve relative paths from the process working directory.                           |
| `TRUST_PROXY`                                         | Numeric Express trusted proxy-hop configuration; set only to match actual trusted infrastructure.                     |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`         | Optional initial admin/CLI bootstrap; smoke can use configured administrator authentication.                          |
| `VITE_DESMOS_API_KEY`                                 | Browser calculator build configuration; requires operator authorization. Rebuild after change. Never reproduce a key. |
| `VITE_DESMOS_API_VERSION`                             | Browser calculator API version selection at build time.                                                               |
| `SCORING_MODEL_FILE`                                  | Trusted local JSON exact-form/version scoring conversion; snapshotted into new attempts.                              |
| `POSTGRES_PASSWORD`                                   | Compose database setup/connection interpolation; not read directly by application source.                             |
| `PLAYWRIGHT_ADMIN_EMAIL`, `PLAYWRIGHT_ADMIN_PASSWORD` | Optional test-run bootstrap overrides; generated defaults in Playwright config are isolated from local data.          |
| `SMOKE_EXPECT_EMPTY_HISTORY`                          | Local smoke's optional fresh-deployment assertion; use only where history should actually be empty.                   |

Dotenv is loaded by server startup, CLI, and smoke scripts. Do not commit `.env` or local credential documentation. Vite values are browser build inputs, not hidden server secrets; inspect the intended client configuration flow rather than copying a private key-bearing source snippet.

## SQLite, PostgreSQL, and concurrency

SQLite defaults to `data/sat.sqlite`; `createDatabase()` creates its parent directory, enables foreign keys and WAL, and uses one connection. `:memory:` explicitly remains SQLite even if `DATABASE_URL` exists, supporting isolated tests. PostgreSQL uses `pg` through Knex with a pool of up to ten connections. Migrations store JSON as text to share the schema between these engines.

[attempt-lock.ts](../../server/attempt-lock.ts) uses a process-local promise queue per attempt plus a transaction, and adds `SELECT ... FOR UPDATE` for PostgreSQL. The SQLite comment mentions `BEGIN IMMEDIATE`, but the project implementation calls ordinary Knex transactions without explicitly requesting that mode; do not rely on the comment as an enforced cross-process guarantee. SQLite writes are constrained by its one-writer model and local connection pool. PostgreSQL row locking is designed for concurrent attempts, but this documentation task did not perform a live PostgreSQL race test.

No Redis or distributed queue/lease system is present. Browser duplicate-tab ownership is separate from SQL locking. There is no cross-device expected-revision conflict protocol; transactionally serialized writes can still overwrite another device's latest state. Migrations use existence/version checks, not a multi-instance migration coordinator; run first migration with a single startup process. Scaling needs review of shared upload storage, process-local auth/API rate limits, database workload, and client conflict behavior before adding replicas.

## Docker and public deployment

```powershell
docker compose build
docker compose up -d
docker compose ps
```

These are the commands supported by supplied configuration, not evidence that they were run here. Compose provisions PostgreSQL 17, a database health check, persistent `postgres-data` and `uploads` volumes, and an app listener published on host loopback port 3001. Supply the required password and public HTTPS origin privately before use. Place a TLS reverse proxy in front of it with the intended forwarded headers and trusted-hop count; direct public plain HTTP is incompatible with production Secure-session cookies.

The multi-stage image builds/prunes dependencies and runs as non-root `node`, with a health check and persistent writable `/app/data`. Compose explicitly defaults sample seeding to true, overriding the Dockerfile's false default; choose intentionally. Bootstrap admin and Desmos build inputs are forwarded by Compose. A scoring-model file is not automatically mounted/forwarded by the provided Compose service; add an explicit trusted file mount/configuration if using that feature.

[.dockerignore](../../.dockerignore) excludes local environment/credential files, data, generated outputs, reports/screenshots, Git metadata, and the private calculator configuration snippet. Do not infer that every future local file is automatically safe to copy into the image. Existing deployment docs state that Docker was unavailable in an earlier environment; current live container/PostgreSQL deployment remains unverified during this task.

## Backups, restore, and durable files

There are **no checked-in backup/restore scripts or CLI commands**. Existing [deployment guidance](../deployment.md) describes manual operations; `start-local.ps1` and `stop-local.ps1` only manage the local process. A generated backup filename in `data/` would not make an automated backup system.

Back up SQL and `UPLOAD_DIR` together. Database-only backup preserves asset metadata/references, but not the PNG/JPEG/WebP bytes. Uploads-only backup loses user ownership, questions, attempts, reports, and image metadata. `public/assets` holds version-controlled seed figures and is a separate source asset surface. Question JSON export is a content export, not an account/history/session backup.

For SQLite, use a consistent SQLite backup API or stop application writers before copying; copying only the main file from a live WAL database can omit committed data. For PostgreSQL, use operator-managed `pg_dump --format=custom` and `pg_restore` against a fresh target plus upload-volume backup. Keep credentials out of command/output logs. The repository does not automate off-host storage, encryption, retention, restore drills, or expired-session cleanup.

Restore with the app stopped, preserve access permissions, restore matching uploads and database, then run migrations deliberately and check health, login, images, an active saved attempt, and a stored report. Preserve historical report JSON; restoring is not permission to recompute old scores. Test restore into an isolated location first. A server restart preserves SQL/upload state; it does not preserve in-process queues or rate-limit counters, and elapsed assessment deadlines still apply at the next synchronized request.
