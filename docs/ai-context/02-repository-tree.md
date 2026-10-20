# 02. Repository tree

[Context index](README.md)

Logical inventory generated from `git ls-files --cached --others --exclude-standard` on 19 October 2026. It includes the current working source additions, not only committed HEAD (`585cb62`), and the new documentation pack itself. Files are shown once. Comments identify important responsibilities; the [file map](14-file-responsibility-map.md) gives cross-feature dependencies/tests.

```text
/
├── client/
│   ├── AnnotationToolbar.css
│   ├── AnnotationToolbar.tsx  # Highlight, underline and attached-note controls
│   ├── api.ts  # Same-origin fetch and CSRF handling
│   ├── App.tsx  # Session bootstrap and application routes
│   ├── Bank.tsx  # Question bank, authoring, imports and form builder
│   ├── Calculator.tsx  # Isolated Desmos shell and original fallback
│   ├── desmos.ts  # Bridge-message validation and API version
│   ├── main.tsx
│   ├── NotesPanel.css
│   ├── NotesPanel.tsx  # Excerpt cards and note editing
│   ├── NotesResizeHandle.css
│   ├── NotesResizeHandle.tsx  # Keyboard/pointer notes resizing
│   ├── Player.css
│   ├── Player.tsx  # Assessment UI, pending recovery and tab ownership
│   ├── QuestionImages.tsx  # Manual per-row figure repair and image previews
│   ├── Report.tsx  # Saved report review, timing filters and printing
│   ├── RichText.tsx  # Sanitization, math and anchored highlights
│   ├── Statistics.tsx  # Teacher/admin aggregate statistics
│   ├── Study.tsx  # Dashboard, practice, history, journal and profile
│   ├── styles.css
│   ├── TaxonomySettings.tsx  # Administrator taxonomy editor
│   └── ui.tsx
├── docs/
│   ├── ai-context/
│   │   ├── 01-project-overview.md
│   │   ├── 02-repository-tree.md
│   │   ├── 03-system-architecture.md
│   │   ├── 04-frontend-architecture.md
│   │   ├── 05-backend-architecture.md
│   │   ├── 06-database-data-model.md
│   │   ├── 07-state-memory-persistence.md
│   │   ├── 08-core-workflows.md
│   │   ├── 09-api-auth-security.md
│   │   ├── 10-assessment-engine.md
│   │   ├── 11-analytics-learning-memory.md
│   │   ├── 12-testing-verification.md
│   │   ├── 13-build-runtime-deployment.md
│   │   ├── 14-file-responsibility-map.md
│   │   ├── 15-invariants-and-design-decisions.md
│   │   ├── 16-known-limitations-and-debt.md
│   │   ├── 17-ai-agent-working-guide.md
│   │   └── README.md  # Detailed context entry point and chapter map
│   ├── architecture.md
│   ├── database.md
│   ├── deployment.md
│   ├── desmos.md
│   ├── features.md
│   ├── implementation-plan.md
│   ├── question-import.md
│   ├── reference-audit.md
│   ├── requirements-checklist.md
│   ├── research.md
│   ├── sat-spec.md
│   ├── scoring.md
│   ├── third-party-notices.md
│   └── verification.md
├── public/
│   ├── assets/
│   │   └── seedling-chart.svg
│   ├── desmos-calculator.html  # Sandbox document, separate from main app
│   ├── desmos-calculator.js  # External calculator loader and source-checked bridge
│   ├── favicon.svg
│   └── third-party-notices.txt
├── scripts/
│   ├── build.mjs  # Production TypeScript/Vite/tsup pipeline
│   ├── smoke-desmos.mjs  # Isolated live calculator/fallback/retry smoke
│   ├── smoke-local.mjs  # Built-local health/auth/content smoke
│   ├── start-local.ps1  # Start local built server
│   └── stop-local.ps1  # Stop managed local server
├── server/
│   ├── tests/
│   │   ├── assets.test.ts  # Migration/upload/auth/metadata/cleanup regression tests
│   │   ├── engines.test.ts  # Pure grading/assembly/score/validation cases
│   │   ├── import-images.test.ts  # Per-row image repair/preservation/recheck tests
│   │   └── integration.test.ts  # Real HTTP/SQLite lifecycle, auth, imports and deadlines
│   ├── analytics.ts  # Own-user history, journal and recommendations
│   ├── app.ts  # HTTP boundary, middleware, uploads and static hosting
│   ├── attempt-lock.ts  # Per-attempt queue, transaction and PostgreSQL row lock
│   ├── attempts.ts  # Attempt state machine, deadlines, response saves and reports
│   ├── auth.ts  # Password/session/CSRF/role enforcement
│   ├── blueprints.ts  # Form validation and mutable blueprint saves
│   ├── cli.ts  # Migration, seed and administrator commands
│   ├── db.ts  # Knex adapters, JSON helpers and migrations v1/v2
│   ├── engines.ts  # Seeded assembly, quotas, grading and internal performance
│   ├── imports.ts  # Parsers, mappings, previews, image repair, confirmation and JSON export
│   ├── index.ts  # Environment, migration/bootstrap and listener lifecycle
│   ├── questions.ts  # Visibility, authoring and append-only content versions
│   ├── scoring.ts  # Estimated/exact-form scoring engines and config snapshot
│   ├── seed.ts  # Idempotent original sample content/forms
│   ├── statistics.ts  # Staff aggregate statistics
│   ├── taxonomy-management.ts  # Database taxonomy loading and administration
│   ├── taxonomy.ts  # Default taxonomy and static standard quota inputs
│   └── validation.ts  # Question/response schemas, sanitization and ApiError
├── shared/
│   └── types.ts  # Cross-boundary TypeScript contracts
├── tests/
│   ├── image-import.spec.ts  # Five manual image repair browser journeys
│   └── student.spec.ts  # Six student/staff/browser journeys
├── .dockerignore
├── .env.example  # Safe configuration names and examples
├── .gitignore
├── .prettierrc.json
├── AGENT_MEMORY.md  # Compact first-read project orientation
├── compose.yaml  # Web and PostgreSQL deployment
├── Dockerfile  # Node build/runtime image
├── eslint.config.js
├── index.html
├── package-lock.json  # Exact dependency resolutions
├── package.json  # Scripts, dependency ranges and Node engine
├── playwright.config.ts  # Isolated test DB/uploads and owned dev ports
├── README.md  # Product/setup overview and AI-context links
├── tsconfig.json
└── vite.config.ts  # React build and development proxies
```

## Scope and exclusions

`Works/` is the application Git root. The parent workspace's reference material, OCR tools and generated workbook outputs are adjacent resources, not directories in this application tree. Existing reference research is indexed in `docs/reference-audit.md`; do not infer permission to copy those assets.

Excluded dependency/generated/private material includes `node_modules/`, `dist/`, `dist-server/`, `coverage/`, `test-results/`, `playwright-report/`, `.runtime/`, databases/uploads beneath `data/`, generated screenshots/PDFs, logs, `.env`, private local-access files and private calculator configuration. Runtime artifacts may supply dated test evidence, but are not source modules. The safe `.env.example` remains included.

## Working additions at review time

Manual image repair includes `client/QuestionImages.tsx`, `server/tests/assets.test.ts`, `server/tests/import-images.test.ts` and `tests/image-import.spec.ts` as nonignored working additions. Related tracked files also had preexisting modifications. Do not discard these simply because they are uncommitted. This documentation task adds `AGENT_MEMORY.md`, the eighteen files in this folder and a small root README link section; it does not change implementation.

Migration logic is in `server/db.ts`; there is no separate migration directory. There is no `src/`, generic controllers directory, ORM model directory or hidden AI-learning backend to locate. Routes live in `server/app.ts`, service logic in the named `server/` modules, and browser modules directly in `client/`.
