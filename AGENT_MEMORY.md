# AGENT MEMORY — Pathwise

Source-verified orientation, 19 October 2026. This describes the working tree, including manual import-image repair additions. Source remains authoritative. This file is project documentation, not external AgentMemory configuration.

## 1. Product

Pathwise / Digital SAT Studio is an independent Digital SAT self-study application. Its loop is assess → analyze stored feedback → targeted practice → mistake review → reassess. Students take tests, author private questions, bookmark material and review history. Teachers manage shared content/forms and aggregate statistics; administrators additionally manage users/roles and taxonomy.

Preserve the focused Bluebook-like assessment player: timer, split Reading/Writing workspace, fixed footer, review flags, independent elimination, anchored highlights and inline notes. Study navigation is outside the player. This is not an official College Board product. Adaptive routing, score conversion and seven-segment knowledge levels are internal approximations. The default score must remain labeled estimated. Reference layout observation does not license reference source, questions, fonts or images; original seed material and documented content rights matter.

## 2. Stack

Node ESM, required Node `>=22.13`; package `pathwise-sat` 1.0.0. Lockfile versions: React/React DOM 19.3.0, React Router DOM 7.18.4, TypeScript 5.9.3, Vite 7.3.7, Express 5.2.1, Knex 3.3.0, better-sqlite3 12.11.1, pg 8.23.1, Zod 4.6.5, ExcelJS 4.4.0, Multer 2.4.0. Rich content uses sanitize-html, DOMPurify and KaTeX. Tests use Node/tsx, Supertest and Playwright. Build uses Vite and tsup; Docker uses Node 24 slim. `package.json` ranges are not locked versions.

SQLite is the default local database; `DATABASE_URL` selects PostgreSQL except explicit in-memory test databases. No ORM entities, Redis, service worker, semantic memory service or LLM tutor exists.

## 3. Repository map

The application Git root is `Works/`, inside the larger SAT simulator workspace. Adjacent reference/OCR/output folders are not application source.

- `client/`: `App` startup/auth/routes; `Study` dashboard/practice/history/journal; `Bank` authoring/imports/blueprints/users; `Player` assessment/recovery; `Report`; `Statistics`; `TaxonomySettings`; rich-text, calculator, annotation/notes/image helpers and CSS.
- `server/`: `app` HTTP/security/uploads; `auth`; `db` migrations; `questions`; `blueprints`; `attempts` and `attempt-lock`; `engines`; `scoring`; `imports`; `analytics`; `statistics`; taxonomy; seed; CLI.
- `shared/types.ts`: browser/server TypeScript payloads. Runtime validation remains separate.
- `server/tests/`: engines, integration, assets and import-image tests. `tests/`: student and manual-image Playwright journeys.
- `scripts/`: build, local start/stop, local and Desmos smoke. `public/`: original static assets and isolated calculator bridge. `docs/ai-context/`: detailed external context.

Use the [file responsibility map](docs/ai-context/14-file-responsibility-map.md) before searching broadly. Ignore dependencies, build output, runtime/test reports and databases when inventorying source. Preserve preexisting dirty/untracked changes.

## 4. Architecture

React calls same-origin `/api` through `client/api.ts`, including the CSRF header. Express middleware validates sessions/origin/roles, then handlers call domain services and Knex. Some profile, bookmark, journal and upload operations are inline in `server/app.ts`. `shared/types.ts` improves compile-time consistency but does not validate hostile requests; server schemas do.

Development runs Vite 5173 with proxies to Express 3001. Production Express serves built `dist`, SPA fallback, public assets and runtime `/uploads`. Startup loads environment, migrates, conditionally seeds and can bootstrap an administrator. It is not a read-only operation.

Desmos runs in an opaque `sandbox="allow-scripts"` iframe, initialized through source-checked messages. Only its document gets the required evaluation CSP permission. Keep the main app policy strict and bridge script resource policy compatible with the opaque frame. Key/version enter via Vite build-time environment; never copy actual key values into docs/tests. The original fallback calculator is a development tool, not equivalent to the external calculator.

## 5. State / memory model

React state holds current UI, loaded data and drafts. Player localStorage holds per-attempt pending response snapshots/current position, browser tab ownership and notes layout preferences. There is no IndexedDB or BroadcastChannel. Optional Web Locks supplements localStorage/storage-event ownership. The lease coordinates compatible tabs in the same browser profile, not different devices.

An edit updates React and local recovery, then debounced/periodic saves send module-bound response snapshots. The server synchronizes deadlines, checks ownership/active module and commits SQL; acknowledgement clears only the matching pending revision. Recovery is best effort and cannot override a closed module. Network loss/refresh can preserve eligible pending edits; clearing storage, closing before persistence or reconnecting after deadline can lose them. SQL survives a server restart; unsent browser work requires that browser to return.

SQL is authoritative for identity, roles, attempt status, deadlines, responses and saved history. Attempt snapshots freeze form/question/scoring content, while pause metadata in the snapshot can mutate. Durable evidence includes answer, elapsed time, elimination, mark, highlights and notes. Reports contain historical review; dashboard/skill metrics are derived from stored evidence. Uploaded bytes live outside SQL and must be preserved separately.

Do not confuse three revisions: local pending revision reconciles saves; question-head CAS guards overlapping writes but does not check the editor's submitted version; database attempt revision increments without an expected-revision save contract. A stale editor can replace newer content as another version, and sequential stale device writes can overwrite a response. See [state/persistence](docs/ai-context/07-state-memory-persistence.md).

## 6. Database

`server/db.ts` implements portable numbered migrations, not a migrations directory. Version 1 creates fourteen application tables; version 2 adds `question_assets`; with `schema_migrations` there are sixteen tables.

Identity/taxonomy: `users`, `sessions`, `domains`, `skills`. Bank/forms: `questions`, `question_versions`, `blueprints`. Assessment: `attempts`, `module_attempts`, `responses`, `score_results`. Learning/import/media: `bookmarks`, `error_logs`, `import_jobs`, `question_assets`. JSON is encoded into text columns; times are application-produced ISO strings.

`questions` is mutable metadata plus a current-version pointer; edits append `question_versions`. Responses reference the exact version. Blueprints overwrite current config and increment a counter; there is no blueprint history table. Started attempts retain their own blueprint, timing, scoring configuration and alternative question pools. Completed report JSON is stored once, not silently rescored.

SQLite enables foreign keys/WAL with one pooled connection. Attempt mutations use a process-local Promise queue and Knex transaction; no explicit `BEGIN IMMEDIATE` is issued despite a source comment. PostgreSQL also locks the owned attempt row with `FOR UPDATE`. Do not infer distributed SQLite safety or cross-device conflict resolution. See [database](docs/ai-context/06-database-data-model.md).

## 7. Attempt lifecycle

`createAttempt` filters visible published questions, assembles deterministic pools and snapshots selected versions/configuration. Full mode uses shared content and six disjoint pools: mixed module 1 and higher/lower module 2 for each section. Four modules/98 questions are taken. Standard times/counts are RW 27/32 minutes and Math 22/35 minutes; default section break is ten minutes. Timing multipliers and break inputs exist.

`synchronizeAttempt` advances expired modules/breaks at their actual boundaries, including long offline intervals. Saves require the current active module. Atomic close grades, chooses route, activates the next module/break or completes and stores results/mistakes. Default higher-route threshold is accuracy >=0.65, an internal rule. Attempt mode controls strict pause rejection and full scoring; blueprint kind alone does not.

Full attempts cannot pause; other modes support pause/resume. Untimed practice has no deadline. Normal active payloads remove answers/explanations/rationales; tutor mode provides explicit feedback. Numerical responses accept supported decimals/fractions, not arbitrary expressions, with fixed relative tolerance `1e-7`. Supplied score mappings must match exact question IDs and versions. Saved reports retain the scoring model/version used.

## 8. Major workflows

Authoring validates taxonomy, answer structure, explanation and license; private/shared ownership is enforced server-side. Edits append versions; deletion archives. Import parses CSV/XLSX/JSON → maps/validates preview → resolves duplicates and images → confirms valid rows. **Manual images belong directly on an affected preview row**, using Repair/Edit/Attach images; no mandatory spreadsheet-path copy step. An unreadable file offers manual question entry; the manual editor also uploads images. Image-only PATCH preserves other content, duplicate decisions and scope, and recomputes row/image errors. Confirm rechecks local files; server does not fetch HTTPS images.

Practice can target filters, manual IDs, domain weights, weak skills, mistakes or bookmarks. Full tests use strict structure; reports supply stored explanations, timing and skill/domain feedback. Mistake records preserve original version/answer with reason, retry/mastery and due fields; retries assemble current bank content. Recommendations are transparent heuristics. Browser printing implements Save as PDF.

Stored annotations survive in report JSON, but current report review does not redraw highlights/attached note cards; it displays the general response note. Journal due dates are stored but do not drive an automatic due-review queue, and journal `note` is not exposed in its DTO/UI. See [workflows](docs/ai-context/08-core-workflows.md) and [analytics](docs/ai-context/11-analytics-learning-memory.md).

## 9. Authentication/security

Passwords use bcrypt cost 12 with validated length/byte limits. Random opaque sessions last seven days; SQL stores SHA-256 token hashes. `sat_session` is HttpOnly, SameSite=Lax, Secure in production, path `/`; auth secrets never belong in localStorage. CSRF tokens are session-backed and required on authenticated mutations; origin/fetch-site checks also protect anonymous auth routes. Rate limiting, Helmet/CSP and runtime validation complement authorization.

Public health, taxonomy and nullable session bootstrap precede the authenticated API boundary. Student writes stay private. Staff manage shared/their own private content; admin does not bypass another private author's normal bank visibility. Attempt/result routes are owner-only. Role changes invalidate target sessions. Server sanitizes rich HTML; browser sanitizes rendering.

Uploads allow supported PNG/JPEG/WebP signatures with size/count limits and generated filenames. Owner-only asset metadata does **not** make `/uploads` private: bytes are public by URL. There is no asset deletion/garbage collector. A license string is required but is not legal verification. See [API/security](docs/ai-context/09-api-auth-security.md).

## 10. Critical invariants

- Server time and module state govern acceptance; never grant extra offline time.
- Preserve lock/transaction boundaries for save/close/route/score.
- Append question versions; preserve version references and attempt content snapshots.
- Do not silently rescore saved reports or substitute today's question content.
- Enforce ownership/roles server-side; students cannot promote private questions.
- Keep cookie secrets out of browser recovery; retain CSRF and both HTML sanitizers.
- Keep calculator evaluation permission isolated; verify message source.
- Repair image structure without inventing content, IDs or licenses.
- Distinguish full/custom/practice behavior and estimated/internal results.
- Update detailed context and this file when architecture/contracts change.

## 11. Commands

Run from the application root:

| Command                                                    | Purpose                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm ci`                                                   | Install lockfile dependencies                                              |
| `npm run dev`                                              | API + Vite development                                                     |
| `npm run db:migrate` / `npm run db:seed` / `npm run admin` | Schema, sample content, administrator bootstrap from environment           |
| `npm run typecheck` / `npm run lint` / `npm test`          | Type, lint and backend checks                                              |
| `npm run test:e2e`                                         | Isolated Playwright journeys; requires free 5173/3001                      |
| `npm run build` / `npm start`                              | Production bundle/start                                                    |
| `npm run check`                                            | Lint + typecheck + backend tests + build                                   |
| `npm run format:check`                                     | Existing source/doc format targets; check this root memory file separately |
| `npm run test:desmos`                                      | Configured isolated live calculator smoke                                  |

Use targeted formatting; broad `format` rewrites unrelated files. Smoke/startup/seed commands may mutate data. Playwright uses unique test DB/upload paths but does not reuse a running server; preserve the user's live app. Read [operations](docs/ai-context/13-build-runtime-deployment.md) before deployment or smoke.

## 12. Current limitations

Cross-device stale writes remain possible. Recovery is browser-dependent. SQLite scaling, process-local rate limits and shared-upload requirements constrain multiple instances. PostgreSQL/Docker configuration is implemented, but deployment/load/restore verification is separate. No official score calibration, password-reset email/MFA, complete accessibility certification, asset lifecycle or semantic memory exists. Large-bank performance is unbenchmarked. Remote images and Desmos depend on external availability; entitlement is not inferred from a configured key.

Older docs overstate some blueprint/revision/tolerance behavior and contain historical test counts. Consult [limitations/debt](docs/ai-context/16-known-limitations-and-debt.md) and the dated [verification](docs/ai-context/12-testing-verification.md), not a stale pass claim. This pack does not authorize production changes or replace source review.

## 13. Where to look

Start at the [context index](docs/ai-context/README.md). For deeper work read [system architecture](docs/ai-context/03-system-architecture.md), [state/persistence](docs/ai-context/07-state-memory-persistence.md), [file map](docs/ai-context/14-file-responsibility-map.md), [invariants](docs/ai-context/15-invariants-and-design-decisions.md) and [working guide](docs/ai-context/17-ai-agent-working-guide.md). Every detailed chapter links back to the index; inspect actual implementation and related tests before modifying it.
