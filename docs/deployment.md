# Deployment and operations

## Runtime

Node 22.13+ (tested Node 24), compiled `dist/`, bundled `dist-server/`, native runtime dependencies and a writable database/upload location. Build with `npm ci` then `npm run build`. Run `npm start` from the project root. `/api/health` verifies the database connection and returns `{status:"ok",database:"connected"}`. No frontend URL is hardcoded; API requests are same-origin.

### Environment

| Name                                          | Use                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT` / `HOST`                               | 3001 / 127.0.0.1 default; Docker binds 0.0.0.0                                                                                                                 |
| `APP_ORIGIN`                                  | Exact permitted browser origin for mutation requests; dev `http://127.0.0.1:5173`, built local preview `http://127.0.0.1:3001`, production public HTTPS origin |
| `NODE_ENV`                                    | `production` enables Secure cookie/HTTPS CSP; keep development for local HTTP preview                                                                          |
| `SQLITE_PATH`                                 | Default `./data/sat.sqlite`; persistent writable storage                                                                                                       |
| `DATABASE_URL`                                | PostgreSQL connection string; overrides SQLite runtime                                                                                                         |
| `UPLOAD_DIR`                                  | Default `./data/uploads`; persistent image storage                                                                                                             |
| `SEED_SAMPLE_DATA`                            | `false` prevents original demo questions being seeded                                                                                                          |
| `TRUST_PROXY`                                 | Set hop count only behind a known reverse proxy                                                                                                                |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Optional initial bootstrap account; remove password afterward                                                                                                  |
| `VITE_DESMOS_API_KEY`                         | Optional build-time key, only with appropriate Desmos API rights                                                                                               |

Migrations run at startup; `npm run db:migrate` can run them before deployment. Seed is idempotent; no fake user history is created. Disable demo content after importing your legally supplied question bank if desired. Do not start multiple processes concurrently for a first migration.

## Docker + PostgreSQL

Docker is not installed in the inspected Windows execution environment. Configuration is provided; a live container/PostgreSQL deployment needs verification on the target host.

Set `POSTGRES_PASSWORD` and a public HTTPS `APP_ORIGIN` in ignored `.env`. Optional bootstrap administrator values must be unique and strong. Then:

```powershell
docker compose build
docker compose up -d
docker compose ps
```

Compose uses persistent named database/upload volumes and database health readiness. The web port is bound to 127.0.0.1 for an HTTPS reverse proxy. Production sessions use Secure cookies, so accessing the container over plain HTTP will not provide a working authenticated public deployment. Publish through TLS using Caddy/nginx/your hosting provider and proxy to 127.0.0.1:3001. Preserve Host/forwarded HTTPS headers. Set `TRUST_PROXY` to the actual trusted hop count. A public DNS name, TLS certificate and hosting account are external infrastructure, not supplied by this repository.

The Docker image runs as non-root and includes a health check. It excludes `.env`, private local credentials, database, generated screenshots and development artifacts from the build context. Desmos keys are optional build configuration; an API key alone does not establish permission to deploy commercially.

## Backups and restore

For SQLite, use a consistent backup through the SQLite backup API, or stop the application before copying the database. A live WAL database cannot be safely backed up by copying only the main `.sqlite` file. Copy `UPLOAD_DIR` alongside the database. Keep encrypted off-host backups with retention and restore drills.

For PostgreSQL, use `pg_dump --format=custom`, plus the upload volume; use `pg_restore` into a fresh database. Do not log/include credentials in backup scripts. Backups contain student information and session hashes and must have restricted access. Delete expired sessions periodically. JSON question export provides portable content backups, not a full student-history backup.

Restore with the application stopped, matching ownership and permissions, then run migrations and verify `/api/health`, login, question assets, a saved attempt and a historical report. Restore old reports as stored; do not silently rerun scoring.

## Security and operational limits

Authentication uses bcrypt, random HttpOnly SameSite session cookies, hashed stored tokens and CSRF checking. Server authorization protects shared content, roles and attempt ownership. Request/input/upload limits, MIME signatures, HTML sanitization, Helmet CSP and authentication/API rate limits are enabled. Uploaded SVG is rejected. Secrets belong in environment configuration, never source control.

Question search is paginated and indexed. Attempt changes are serialized per attempt and transactionally persist to relational storage. Full-test deadlines continue across offline periods; local queued actions remain subject to deadline rejection. This is a self-study application, not a proctoring/identity-verification system.

There is no email service, password-reset delivery or school-roster/assignment integration. Account recovery currently needs administrator operations; do not advertise automated email recovery. Before an Internet launch, run the PostgreSQL/container smoke suite, load testing, a manual screen-reader audit and your retention/privacy setup. These deployment requirements are documented limits, not implemented external services.

## Optional supplied models and concurrency

`SCORING_MODEL_FILE` accepts a trusted exact-form/version conversion model; when absent, scores use the documented estimated model. See scoring.md for its schema.

The player coordinates duplicate tabs in the same browser through an ownership lease and explicit takeover. Multiple independent devices editing the same active attempt remain a last-write conflict limitation; use one device per active test. Server deadlines, ownership and module locks still apply on every device.

To supply an authorized Desmos key to a Docker build, use `docker build --build-arg VITE_DESMOS_API_KEY=YOUR_AUTHORIZED_KEY -t pathwise .` or set the corresponding Compose build argument. Frontend environment values are embedded at build time. `VITE_DESMOS_API_VERSION` defaults to `1.12`; Compose forwards both calculator build arguments. No key is required for the original scientific/graph calculator fallback.

## Desmos v1.12 configuration

The supplied local `docs/API desmos.md` snippet is used to configure the key in ignored `.env`. This source file is excluded from Git and Docker build contexts. The application reads `VITE_DESMOS_API_KEY` and `VITE_DESMOS_API_VERSION` when Vite builds; the loader requests only the official `www.desmos.com` API host. The calculator runs in a separate sandboxed document with its own CSP allowing the official script/service host, blob workers and the code evaluation required by Desmos v1.12. The main application CSP keeps code evaluation disabled, with same-origin session and API protections. Desmos is loaded lazily when the calculator opens, not on every page. Network failures expose the local fallback and Retry Desmos. See [desmos.md](desmos.md) for verification and lifecycle behavior.
