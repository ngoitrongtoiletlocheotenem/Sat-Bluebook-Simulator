# 01. Project overview

[Context index](README.md)

## Product and learning loop

Pathwise is a browser-based Digital SAT study platform, implemented as one TypeScript application with a React SPA and an Express/SQL backend. The learner loop is assessment → stored feedback → weak-skill or mistake practice → review → another assessment. Durable state is account-owned on the server; browser storage helps recover unfinished edits.

The player deliberately has a focused exam surface: centered timer, split Reading/Writing passage/question workspace, fixed navigation, review flags, elimination, highlights and attached notes. Preserve that structure when extending it. Study navigation and administrative pages are separate from the player layout. [client/Player.tsx](../../client/Player.tsx), [client/Player.css](../../client/Player.css) and [client/Report.tsx](../../client/Report.tsx) are the main interaction surfaces.

## Roles and actual access

| Role          | Implemented capabilities                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Student       | Own assessments/history/errors/bookmarks/profile; shared published question access; own private question authoring/import/export; published blueprints |
| Teacher       | Shared and own private question management; blueprint creation/editing subject to author checks; aggregate statistics; student capabilities            |
| Administrator | Teacher capabilities; role/user and taxonomy administration; administrator-only question metadata                                                      |

Server services enforce ownership. Even staff do not obtain another author's private bank through ordinary question queries. Students cannot promote their private questions by changing a request field. Read the complete [security contract](09-api-auth-security.md) for exceptions and exact routes.

## Implemented feature surface

- Authentication: student registration, login/logout, expiring opaque sessions, profile updates and administrator role changes.
- Question bank: pagination/filtering, HTML/math content, MCQ and Math student-produced responses, taxonomy, source/license fields, private/shared scope, append-only versions and archive behavior.
- Imports: CSV/XLSX/JSON parsing, canonical column mapping, preview validation, duplicate decisions and confirmation. Users manually upload or replace images directly on an affected preview row when parser paths fail. The manual editor also uploads images. An unreadable workbook offers manual question entry. This is a question repair workflow, not a requirement to copy an asset-library path into a spreadsheet.
- Forms and practice: deterministic assembly, manual/random blueprints, strict full mode, single timed modules, custom/tutor/weak/wrong/bookmark practice and practice pause/resume.
- Player: autosave/recovery, server deadlines, module review, adaptive routing, timed break, annotations/notes, accessible resizing controls, calculator, reference and line reader.
- Feedback: persisted result with historical question content and model label; explanations/rationales; timing filters; printable report; history/trends; mistake reasons, retries, due dates and mastery status.
- Operations: SQLite default, PostgreSQL selection, idempotent migration/seed, administrator CLI/bootstrap, local scripts, Docker/Compose and health endpoint.

See [workflows](08-core-workflows.md), [assessment](10-assessment-engine.md) and [analytics](11-analytics-learning-memory.md). Feature presence is distinct from a current passing browser or deployment check; see [verification](12-testing-verification.md).

## Official structure versus internal behavior

Full mode models the public two-stage structure: two 27-question/32-minute Reading/Writing modules and two 22-question/35-minute Math modules, with a default ten-minute section break. Assembly retains six disjoint alternative pools; a learner takes four modules/98 questions. Configurable timing accommodations and break inputs exist.

Adaptive routing is a configurable correctness threshold (default 0.65), and default scoring is an internal estimated linear mapping. These are not College Board routing, item-response theory calibration or official score conversion. Internal seven-segment domain levels and score ranges must retain their estimate/internal labels. Supplied exact-form score mappings are supported but do not establish official calibration.

## Content and integration boundaries

The existing [reference audit](../reference-audit.md) records that the adjacent visual reference lacks a project license; this app independently implements interaction patterns and does not inherit permission for reference questions, fonts or images. Seed content is original practice material. A nonempty import license is required by validation; that field alone does not prove redistribution rights. Do not invent academic content, taxonomy IDs or licenses during structural import repairs.

Desmos uses an operator-supplied build-time key through an isolated iframe bridge. Do not copy any local key into documentation, seed or tests. The original calculator fallback is a development tool with a smaller feature set. There is no LLM-backed tutor or semantic learning-memory service in the application; recommendations are deterministic code.

## Scope of this context pack

The Git application root is `Works/`; neighboring workspace research/import outputs are not part of the application source inventory. This pack describes the current working source, including the manual image-repair additions present on 19 October 2026. It does not change services, live learner data or behavior, and does not configure any external AgentMemory tool. [AGENT_MEMORY.md](../../AGENT_MEMORY.md) is a repository onboarding file.
