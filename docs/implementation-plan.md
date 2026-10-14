# Implementation and verification plan

6 October 2026. This plan describes intended implementation sequencing and acceptance evidence. It is not a completion certificate. The final requirement checklist, README validation results and test outputs determine shipped coverage.

## Decisions established before implementation

1. Keep the reference's React/TypeScript/Vite stack family and exam visual structure. Reimplement source/assets independently because the primary reference lacks a license. Leave both references untouched.
2. Build one self-hosted website under `Works`, using React/TypeScript/Vite frontend, Express/Node server and a relational SQLite database for this local deployment. The backend serves the production frontend from the same origin and owns authentication/authorization/scoring. Use Knex and portable migrations with a PostgreSQL adapter for operator-configured production deployments; distinguish that implementation from live PostgreSQL verification.
3. Use cookie-based sessions, server-side role/ownership checks, input schemas, sanitized rich content, restricted uploads/imports and original seed questions. No external AI service is needed for study recommendations.
4. Version questions, blueprints, scoring and adaptive settings. Snapshot content/model policies into each attempt so later edits cannot change history.
5. Distinguish strict Full SAT from Custom/Demo/practice. Estimated scores and seven-bar proficiency are internal approximations. Authorized Desmos loading is optional configuration with a working numerical fallback.

## Delivery phases

| Phase                 | Deliverables                                                                                                                         | Acceptance evidence                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 0: Audit/research     | `reference-audit.md`, source/licensing decision, live official/publisher research                                                    | Recursive reference inventory; inspected player/tools/editor/state/configuration; current source links; 2026 changes             |
| 1: Data/architecture  | Typed schema, migrations, original seeds, domain/skill data, service boundaries, architecture/database/SAT docs                      | Schema creates clean DB; relational ownership/version constraints; source/license coverage                                       |
| 2: Bank/authoring     | Search/pagination, private/global authorization, versioned editor, preview, templates and CSV/XLSX/JSON import/export                | Malformed/duplicate preview reports, confirmation before insertion, unauthorized writes rejected, historical version retained    |
| 3: Assessment engine  | Manual/reproducible random blueprints, standard SAT validation, routes and accommodations                                            | Seed reproducibility, sufficient-pool checks, domain/difficulty constraints, atomic locked transitions                           |
| 4: Player/reliability | Focused reference geometry, tools, module menu/review, autosave, refresh/resume, offline feedback                                    | Real persisted response tools; reload keeps state/deadline; closed module refuses writes; screenshots compare layout             |
| 5: Results/study loop | Estimated scoring/report, print, histories/charts, domain/skill/time analytics, error log/retry/bookmarks/due review/recommendations | Entire test produces immutable result; actual mistakes link to explanations/retry; history changes from real subsequent attempts |
| 6: Deployment/quality | `.env.example`, production build, server health, Docker/backup docs, Windows setup, automated/browser checks                         | Install/build/typecheck/lint/formatter/tests; real production server requests; E2E screenshots/print verification                |
| 7: Final audit        | Requirement-by-requirement implemented/partial/blocked matrix                                                                        | Each claim tied to file/service/test/manual evidence and known limits                                                            |

## Ownership and service boundaries

Auth service owns sessions/users/roles. Question service owns rich-content validation, publication/status, versions, metadata and legal provenance. Import service produces a staged preview/report and performs a confirmed transaction. Test assembly owns seed/constraints and immutable question ordering; adaptive routing owns versioned decision inputs/output; scoring owns validated answers and result model versions. Attempt service owns active modules, deadlines, response writes, sync and immutable transitions. Analytics/recommendations derive student-specific views from finalized results and responses.

The UI may optimistically update local answer/tool state for instant interactions, but local state cannot authorize global writes, invent scores, change module policies or extend strict timing. Student bank actions enforce private ownership at the backend. Question versions/history survive archive edits.

## Required automated verification

- Pure engine tests: MCQ scoring; blank/invalid/numeric fraction/decimal/Unicode-minus normalization; assembly seed reproducibility; filtering/constraints/insufficient pools; routing boundary cases; estimated score bounds; domain/skill statistics; import invalid rows, duplicates and unsafe HTML.
- Backend integration: register/login/logout and role failures; own/private versus shared/global access; create/edit/history; preview/confirm imports; manual/random blueprint; start/save/resume/navigation; module lock and deterministic branching; break; full completion/result/history; bookmarks/error retry ownership.
- Browser student journey: login → full/custom launch → answer/eliminate/highlight/note/review → navigator → refresh/resume → submit Module 1 → route → close RW → break → Math → results → printable report → wrong-item explanation/retry. Test offline/reconnect and stale-tab behavior where supported.
- Visual checks: desktop test/header/footer/RW split/Math/navigator/review/break/tool panels; tablet; score report two columns/seven bars; A4/Letter print. Capture actual output and inspect it, not just screenshot file existence.
- Deployment checks: production build/typecheck/lint; health/static/API same-origin requests; no hardcoded localhost client URLs; DB initialization; persistent restart; safe backup instructions.

Run broader tests only when new changes/failures justify them. Tests must exercise behavior/contracts rather than repeat implementation internals. Record passing and failing commands accurately; disclose unavailable browser/accessibility/license verification.

## Honest completion criteria

The primary user workflow is create an account, author/import legal questions, build/generate tests, use the focused tools, persist/resume, finish adaptive modules, receive clearly estimated scores and printable domain reports, inspect/retry mistakes, and see real history/recommendations. A polished homepage is insufficient.

Feature claims need concrete evidence. UI-only controls, placeholder menus, fixed fabricated analytics, unsaved edits, client-trusted authorization or scores, untested Desmos keys and hidden official calibration assumptions are incomplete. External publication requires an actual destination/operator configuration; successful local production deployment must not be described as a public internet deployment.

Potential bounded limitations to disclose after verification: no authorized official score mapping/IRT calibration, no acquired commercial Desmos entitlement, local SQLite operational constraints and untested external PostgreSQL deployment, no comprehensive third-party WCAG certification, and any unsupported authoring/builder/analytics details in the checklist.
