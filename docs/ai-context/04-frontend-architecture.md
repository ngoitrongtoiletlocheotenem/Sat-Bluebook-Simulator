# Frontend architecture

[Context index](README.md) · [State and recovery](07-state-memory-persistence.md) · [Workflows](08-core-workflows.md)

This document describes the current source, including manual image repair inside each import-preview row. The client is a React application with ordinary component state and a small context; it does not use Redux, a query-cache library, or a browser database.

## Startup, routing, and shared context

[`client/main.tsx`](../../client/main.tsx) mounts `App` in `BrowserRouter` and imports the global stylesheet. [`App.tsx`](../../client/App.tsx) concurrently requests `/api/me` and `/api/taxonomy`. A boot failure offers a page reload; a missing authenticated user displays `Auth` instead of the workspace. Registration/login POST to their respective endpoints, then `refreshUser` fetches `/me`. This also initializes the API module's in-memory CSRF token. Authentication is a server cookie/session concern, not a localStorage user/token record.

`AppContext` in [`ui.tsx`](../../client/ui.tsx) carries `user`, database-derived `domains`, `refreshUser`, and a toast callback. Toasts expire after 4.5 seconds. Taxonomy is loaded once at startup; the administrator taxonomy editor explicitly asks the user to refresh after saving changed labels. `refreshUser` does not reload taxonomy.

| Route          | Component                | Purpose and access presentation                                                             |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `/`            | `Dashboard`              | Personal metrics, recommendations, active attempts, estimated score history                 |
| `/practice`    | `Practice`               | Configure a new attempt; recommendation query parameters initialize mode/domain/skill/count |
| `/history`     | `History`                | Completed sessions and score/history charts with period filters                             |
| `/errors`      | `Errors`                 | Personal mistake journal and retry controls                                                 |
| `/bank`        | `QuestionBank`           | Visible shared/private questions, authoring, import/export, bookmarks                       |
| `/tests`       | `TestBuilder`            | Published blueprint launch; teacher/admin blueprint editing                                 |
| `/users`       | `UsersPage`              | Administrator user-role management                                                          |
| `/statistics`  | `Statistics`             | Teacher/admin aggregate student and shared-question statistics                              |
| `/settings`    | `SettingsPage`           | Profile/target score; administrator taxonomy controls                                       |
| `/results/:id` | `Report`                 | Persisted personal result and question review                                               |
| `/test/:id`    | `PlayerRoute` → `Player` | Standalone focused assessment surface outside the sidebar shell                             |

Unknown workspace routes render `Dashboard`. The role-dependent navigation and component guards improve presentation; server authorization is still required for every protected operation. `PlayerRoute` supplies an attempt ID, dashboard exit callback, and result-navigation callback.

## API and loading conventions

[`api.ts`](../../client/api.ts) prefixes relative paths with `/api`, sends cookies with `credentials: 'same-origin'`, and adds `X-CSRF-Token` on explicitly non-GET requests. Successful responses containing `csrfToken` refresh an in-module variable. `json` constructs JSON requests; `ApiError` retains an HTTP status for player conflict handling. `download` uses a credentialed fetch and a temporary object URL.

`useLoad` in [`ui.tsx`](../../client/ui.tsx) is a component-scoped loader with `data`, `loading`, `error`, `reload`, and `setData`. A serial counter ignores obsolete requests after dependencies change or the component unmounts. It is not a persistent/global data cache. Pages generally reload explicitly after writes. Native `<dialog>` wrappers manage opening, Escape/click-away behavior, and restoration of focus.

## Study surfaces

[`Study.tsx`](../../client/Study.tsx) contains the personal learning pages:

| Major component          | Inputs/local state                                                                                                                                              | Server interactions and persistence                                                                                          | Modification points                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Dashboard`              | Context user/taxonomy, loaded dashboard, launch busy/error state                                                                                                | GET `/dashboard`; POST `/attempts` for full SAT; active attempt links resume stored state                                    | Dashboard layout/recommendation presentation; server `analytics.ts` owns calculations                         |
| `Practice`               | Initial search params; mode, section/domain/skill, difficulty, count, timing, multiplier, break, seed, unseen/wrong filters, tags/source, custom domain weights | POST `/attempts` with `AttemptInput`; successful creation navigates to `/test/:id`; the form itself is transient             | Configuration controls and input construction; server `attempts.ts` validates and assembles                   |
| `History` / `ScoreChart` | Period selection; dashboard result data                                                                                                                         | GET `/dashboard` optionally with days; links to `/results/:id`; no report recomputation in client                            | Chart/table/filter presentation                                                                               |
| `Errors`                 | Section/domain/skill/difficulty/status/date/page filters; selected journal entry                                                                                | GET `/errors`; PUT `/errors/:id` for reason/mastered state; POST `/attempts` for a single retry or wrong-question collection | Journal controls and review modal; scheduling/evidence belongs to server                                      |
| `QuestionReview`         | Question, optional answer/elapsed time, retry callback                                                                                                          | Renders correct/incorrect choices, explanation, timing, figures; bookmark toggle POST `/bookmarks/:id`                       | Shared review UI used by bank, journal, report; does not accept/display response highlights or attached notes |
| `SettingsPage`           | Form/busy/error state                                                                                                                                           | PUT `/profile`, then `refreshUser`; admin mounts `TaxonomySettings`                                                          | Account fields, internal-estimate notices                                                                     |

Related contracts are `AttemptInput`, `Dashboard`, `Performance`, `ErrorItem`, `Question`, `ReviewItem`, and `HistoryItem` in [`shared/types.ts`](../../shared/types.ts). Page, chart, form, review, and responsive styles are in [`styles.css`](../../client/styles.css).

## Question library, authoring, import, and blueprints

[`Bank.tsx`](../../client/Bank.tsx) groups the following components. Their form state is local; closing a draft editor does not save the question automatically.

| Component         | Responsibility / state                                                                                                                                   | Server interactions / persistence                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QuestionBank`    | Search/filter/page/scope state; selected preview/editor/import modal                                                                                     | GET `/questions`, GET `/questions/:id`; archive via DELETE; JSON export via `/questions/export`; launch a question as tutor attempt                                             |
| `QuestionEditor`  | `Partial<Question>` draft, scope, content-vs-preview tab, validation errors                                                                              | POST `/questions` or PUT `/questions/:id`; PUT creates a new question version; `/assets` uploads append returned URLs to the local draft                                        |
| `RichEditor`      | Textarea plus safe-HTML/math/table insertion helpers                                                                                                     | No independent save; edits feed the question draft; not a full document/WYSIWYG editor                                                                                          |
| `ImportQuestions` | File, private/shared destination, optional JSON column mapping, `ImportPreview`, selected repair row, failed browser image previews, final import report | POST `/imports/preview`; PATCH `/imports/:id/rows/:row/images`; POST `/imports/:id/confirm`; template downloads; row content is stored in an SQL import job before confirmation |
| `BlueprintEditor` | Blueprint draft, selected module, search/page, selected question ordering                                                                                | GET `/questions` for a section; POST/PUT `/blueprints`; no browser recovery for unsaved blueprint drafts                                                                        |
| `TestBuilder`     | Loaded blueprint cards, selected editor, launch state                                                                                                    | GET `/blueprints`; launch POST `/attempts` with blueprint ID and mode chosen from blueprint kind; author roles edit/duplicate/publish                                           |
| `UsersPage`       | User list and role change actions                                                                                                                        | Admin GET `/users`, PUT `/users/:id`; affected sessions are invalidated on the server                                                                                           |

`BlueprintEditor` supports full SAT and custom configurations. Full configurations include alternate second-module pools, rather than six modules all presented to one learner. Custom configuration supports flexible timing/counts. Starting a blueprint snapshots its configuration and selected versioned question pools on the server; later editing the card does not update a running attempt.

### Manual image repair is per question

[`QuestionImages.tsx`](../../client/QuestionImages.tsx) receives `questionId`, an image URL list, save/cancel callbacks, and a busy callback. It appears only for the selected import row. It keeps a draft list, tracks failed previews, accepts PNG/JPEG/WebP files of at most 5 MB each, limits the question to 10 images, uploads sequentially through `/assets`, and passes URLs to the row save callback. It does not require preparing a separate image library or changing an XLSX cell.

An unavailable reference must be removed before saving its replacement. `Save images` patches that preview row; `Cancel image changes` abandons the draft list but does not delete bytes already uploaded. Text/choices/answer/explanation are not rewritten by image repair. The outer preview shows **Repair images**, **Edit images**, or **Attach images manually**. Its confirm button is blocked while a row is being edited or an otherwise-ready row has a known failed browser thumbnail. If parsing the entire workbook fails, **Enter question manually** opens the question editor; its **Images and charts** field uploads figures directly into that question draft.

The manual repair editor and import preview are styled in `styles.css`. The server also validates references, media type, size, ownership of the import job, and destination permissions; browser checks are not the security boundary. Remote HTTPS availability is observed by browser previews, not fetched by the server. Upload URLs are publicly readable by anyone holding the link, including figures used in private questions.

## Focused player

[`Player.tsx`](../../client/Player.tsx) receives `attemptId`, `onExit`, and `onComplete`. Its `Attempt` data comes from the API. It coordinates the active module/question, answer controls, module review/navigation, marked/eliminated choices, calculator, line reader, zoom, timer, tutor feedback, annotations, and notes. It renders dedicated loading/error, duplicate-window, break, paused-practice, and completed states. Completion redirects to the stored result page.

The principal save pipeline is `updateResponse` → `enqueue` → localStorage pending snapshot → debounced `flush` → PATCH `/attempts/:id`. `recordElapsed` updates visible-question time, `navigate` saves position, `transition` flushes before a lifecycle POST, `load` overlays recoverable edits only for the same active module, and `takeOver` transfers the browser lease. The [state document](07-state-memory-persistence.md) is authoritative for exact timings, failure behavior, and the distinction between local queue revisions and server concurrency.

The player owns most editing state; child annotation/note components receive values/callbacks rather than saving independently. Layout lives in [`Player.css`](../../client/Player.css), with dedicated annotation/notes styles below. Keep the focused test layout and its split reading workspace when changing controls. Browser aids, calculator expression/history, open menus, line-reader position, and zoom are transient. Only notes-panel open/width preferences and the pending save/lease records use localStorage.

### Rich content, annotations, and notes

- [`RichText.tsx`](../../client/RichText.tsx): takes `html`/`content`, optional passage/stem field, highlights, interaction callbacks, and an enabled flag. DOMPurify sanitizes HTML, KaTeX renders delimited math with untrusted execution disabled, and highlights are reconstructed from the original sanitized prose. Stored `start`/`end` offsets must still match the stored excerpt; invalid/stale matches are not applied. Math-generated/accessibility nodes are excluded from prose selection. Inline images can open an accessible zoom/pan dialog.
- [`AnnotationToolbar.tsx`](../../client/AnnotationToolbar.tsx) + [`AnnotationToolbar.css`](../../client/AnnotationToolbar.css): floating palette, colors, solid/dashed/dotted/none underline controls, add-note/delete actions, keyboard navigation, and viewport fitting. Inputs are controlled annotation selection/style state and callbacks; it does not persist data itself.
- [`NotesPanel.tsx`](../../client/NotesPanel.tsx) + [`NotesPanel.css`](../../client/NotesPanel.css): inline excerpt/note cards, autofocus/selection, note deletion, and optional legacy general question note. Text changes immediately call Player. A note can stay attached while empty via `noteAttached`; deleting a note preserves its highlight.
- [`NotesResizeHandle.tsx`](../../client/NotesResizeHandle.tsx) + [`NotesResizeHandle.css`](../../client/NotesResizeHandle.css): bounded pointer/keyboard width adjustment and responsive stacking; Player persists width preference. It resizes the notes rail, not an independent passage/answer split.

Highlights & Notes starts off on every player mount. Turning it off hides tools/panel without deleting annotations. The panel is visible only when the mode is on, its open preference is true, and the current question has attached notes. New highlights are rejected in the UI if overlapping an existing highlight; server validation also checks payload limits/range direction. These are response data tied to an attempt/question version, not edits to the bank question.

## Calculator boundary

[`Calculator.tsx`](../../client/Calculator.tsx) is lazy-loaded by Player and uses ephemeral expression/history, graph settings, dimensions, and position. With configured `VITE_DESMOS_API_KEY`, it mounts `/desmos-calculator.html` in `sandbox="allow-scripts"`, initializes it by postMessage, and validates message shape/source using [`desmos.ts`](../../client/desmos.ts). It has a 20-second readiness timeout and retry/failure UI. Do not weaken the main application's CSP to accommodate the external calculator.

If the external calculator is unconfigured or fails, the local scientific parser and SVG graph are available. `evaluateExpression` is a limited parser, not JavaScript `eval`; the local fallback is not a claim of Desmos/SAT feature parity. Only environment-variable flow belongs in documentation; never paste a configured key.

## Report and staff surfaces

[`Report.tsx`](../../client/Report.tsx) loads a `Result` from `/attempts/:id/result`; its tab and selected review question are transient. Filters include all, wrong, marked, slow (>90 seconds), rapid (<3 seconds with an answer), and unanswered. It uses `QuestionReview`, launches retry attempts, and displays the report's saved scoring label/model version. The review modal displays the legacy general `response.note`, but does not pass saved highlights/attached notes to `QuestionReview`; those survive in report JSON without currently being rendered here. Both **Print report** and **Save as PDF** call `window.print()`; there is no separate generated-PDF API.

[`Statistics.tsx`](../../client/Statistics.tsx) loads `/statistics` for teacher/admin roles, displays student participation and shared-question performance, and returns an access explanation for students. It is an aggregate read view, not an editor of student attempts. [`TaxonomySettings.tsx`](../../client/TaxonomySettings.tsx), mounted only for admins in Settings, clones context taxonomy into a draft, preserves existing IDs/sections in its controls, PUTs `/taxonomy`, and requires a reload to refresh application context.

## Common change boundaries

| Change                                | Inspect first                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| New page/navigation/auth bootstrap    | `App.tsx`, `ui.tsx`, `api.ts`, server authorization                                       |
| Attempt save/recovery/timing behavior | `Player.tsx`, `shared/types.ts`, `server/attempts.ts`, `server/attempt-lock.ts`           |
| Annotation markup/offsets/styles      | `RichText.tsx`, Player annotation functions, toolbar/panel files and CSS                  |
| Imported figure repair                | `QuestionImages.tsx`, `Bank.tsx` import component, `server/imports.ts`, `/assets` handler |
| Question authoring/versioning         | `Bank.tsx` editor, `server/questions.ts`, `server/validation.ts`                          |
| Report/analytics semantics            | `Report.tsx`, `Study.tsx`, `server/attempts.ts`, `server/analytics.ts`, shared contracts  |

Source inspection verified these responsibilities; no browser verification was run as part of writing this document.
