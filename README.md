# Pathwise · Digital SAT Studio

A runnable, independent Digital SAT study platform with a reference-inspired focused test player and an original study workspace. The product loop is **assess → analyze → practice → review mistakes → reassess**. Sample questions are original demonstration content. SAT scores and seven-segment mastery bands are explicitly labeled internal estimates.

## Windows quick start

Install Node.js 22.13 or later (Node 24 recommended), then use PowerShell:

```powershell
Set-Location 'C:\Users\dotua\Videos\Random project\SAT simulator\Works'
npm ci
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://127.0.0.1:5173`. Create an account. The development API runs on port 3001; Vite proxies `/api` and uploaded images. `.env.example` sets the expected development origin. Do not mix `localhost` and `127.0.0.1` origins.

The seed creates original questions covering all eight domains, Reading/Writing MCQ, Math MCQ/SPR, rationales and an original chart, plus a reusable full SAT blueprint. It creates no fabricated score history. Startup migrations and seeding are idempotent. SQLite and uploads live in ignored `data/`.

For an administrator, temporarily set **your own** `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ characters) and optional `ADMIN_NAME` in `.env`, run `npm run admin`, then remove `ADMIN_PASSWORD`. Alternatively, configured bootstrap values create an initial administrator on startup if the email does not exist. New public registrations always receive the student role. Administrators can grant teacher roles from User management. No built-in shared password exists.

## What to use

- **Overview:** genuine history, domain progress, saved session resume and rule-based next practice.
- **Practice studio:** tutor, custom sets, timed module, full adaptive SAT, mistakes, weak skills and bookmarks; configurable practice timing/seed/accommodations.
- **Question library:** paginated filtering, private/shared questions, versioned authoring, safe HTML/LaTeX, images, rationales, preview and archives; CSV/XLSX/JSON templates, validation preview and confirmed imports; JSON export.
- **Test builder:** teacher/admin manual pool selection/reordering, deterministic random pools, strict SAT or custom blueprints, threshold configuration, publication and duplication.
- **Test player:** focused header/timer/tools, original Reading/Writing split with a resizable notes panel, review mark, independent elimination, an explicitly activated Highlights & Notes mode with an underlined header button and floating palette with three pastel colors, solid/dashed/dotted underlines, autosaved excerpt cards in an inline notes panel, annotation deletion, anchored annotations, navigator, review page, scientific/graph calculator fallback, reference, line reader, keyboard tools, image viewer and reliable resume.
- **Results:** stored server-graded report, two-column Knowledge and Skills with seven segments, explanations/choice rationales, timing, route and skill/difficulty analysis, mistake retry and print/PDF through the browser.
- **History/journal:** trends, error reasons, retry/mastery tracking, bookmarks and recommendations.

## Commands

| Command                           | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                     | Vite and API development servers                                        |
| `npm run db:migrate`              | Versioned schema setup                                                  |
| `npm run db:seed`                 | Idempotent original sample questions and blueprint                      |
| `npm run admin`                   | Create admin using environment values                                   |
| `npm run typecheck`               | Strict TypeScript checks                                                |
| `npm run lint`                    | ESLint                                                                  |
| `npm run format` / `format:check` | Prettier                                                                |
| `npm test`                        | Pure engine and HTTP/database integration tests                         |
| `npx playwright install chromium` | Install test browser                                                    |
| `npm run test:desmos`             | Live Desmos and network-recovery smoke against an isolated built server |
| `npm run test:e2e`                | Isolated complete UI journey and screenshot/PDF evidence                |
| `npm run build`                   | Typecheck, optimized frontend, bundled server                           |
| `npm start`                       | Serve production assets and API together                                |

E2E tests own ports 5173/3001 and an isolated database. Stop your development servers first. Tests do not overwrite your normal local study database. See [verification](docs/verification.md) for current measured results and [requirements checklist](docs/requirements-checklist.md) for honest feature coverage.

## Serve the built application locally

```powershell
npm run build
# Change APP_ORIGIN in .env to http://127.0.0.1:3001
npm start
```

Open `http://127.0.0.1:3001`. Keep `NODE_ENV=development` for a local HTTP preview. An Internet deployment needs HTTPS, `NODE_ENV=production`, a matching public `APP_ORIGIN`, a managed process/reverse proxy, protected database and backups. Production mode uses Secure cookies.

Set `DATABASE_URL=postgresql://...` to use PostgreSQL instead of SQLite. Both use the shared Knex schema/migration and query boundary. `SEED_SAMPLE_DATA=false` disables sample questions. Deployment configuration, Docker/PostgreSQL Compose and backups are documented in [deployment](docs/deployment.md).

This workspace includes `scripts/start-local.ps1` and `scripts/stop-local.ps1` to run the built application as a hidden local process. The current workspace has local administrator details in the ignored `PRIVATE_LOCAL_ACCESS.md`; never publish this file.

Desmos Graphing Calculator is enabled in this workspace using the supplied `docs/API desmos.md` configuration. `VITE_DESMOS_API_KEY` is stored in ignored `.env`, and `VITE_DESMOS_API_VERSION` selects API v1.12. These are build-time values: rebuild after changing them. The calculator loads the official service when opened and supports panel resizing. If the network is unavailable, the original local calculator remains usable and offers Retry Desmos. Without a configured key, the local fallback works without an external service. Use your own appropriately authorized key for deployment. See [Desmos integration](docs/desmos.md).

## Documentation

[Reference audit](docs/reference-audit.md) · [research and sources](docs/research.md) · [SAT specification](docs/sat-spec.md) · [architecture/ER diagram](docs/architecture.md) · [database](docs/database.md) · [question import](docs/question-import.md) · [scoring assumptions](docs/scoring.md) · [deployment](docs/deployment.md) · [implementation phases](docs/implementation-plan.md) · [verification](docs/verification.md)

The unlicensed reference client source/fonts/assets were not copied. No College Board branding, copyrighted question bank or unauthorized scraper is included. The local reference projects remain intact.
