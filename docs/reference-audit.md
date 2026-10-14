# Local reference audit

Audit date: 6 October 2026, Asia/Saigon. Both supplied reference directories were recursively inventoried before implementation. Application source, configuration, routes, component families, state/persistence, fixtures, asset inventory, license files and study-resource data were examined. References remain intact.

## Reuse decision

| Reference                                       | License found                                                                                    | Reuse decision                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../Idea Material/Digital-SAT-simulator-client` | No project LICENSE or COPYING file found; `package.json` is private and does not grant a license | Independently implement its interaction/layout patterns. Do not copy its TSX, fixture questions, images, embedded fonts, logo or hardcoded Desmos key. Dependency licenses do not license the application's source.                 |
| `../Idea Material/awesome-study-resources`      | MIT, copyright 2026 StudentSuite                                                                 | Code/documentation reuse is permitted with its copyright and permission notice. This implementation extracts ideas only, so no code/assets are copied. The MIT grant does not extend to content hosted at linked third-party sites. |

The primary reference is a valuable visual reference but cannot legally be treated as licensed application scaffolding. A new React/TypeScript/Vite implementation preserves its stack family and key visual proportions. This is a specific licensing and reliability decision, not a framework replacement for fashion.

## Primary reference: Digital-SAT-simulator-client

The tree contains 100 files including hidden configuration: 59 TypeScript/TSX files, five TTF fonts, 20 PNGs, one WebP logo, one GIF, Storybook configuration, Vite/Tailwind configuration, mock API/data and a Yarn lockfile. The largest fixture is `mocks/mockDB/exams.ts`, approximately 4 MB, containing exam content and inline assets. None of those question texts/assets should enter the new seed.

### Framework and structure

- React 18.2, TypeScript 4.9, Vite 4.2, React Router 6.10.
- Tailwind 3.3 utility styling plus `src/styles/global.css`.
- Recoil 0.7 atoms/selectors for user, loading, module, answers, current section/module/question, annotations, review flags and elimination.
- React Query 3.39 and Axios for remote data; separate authenticated/non-authenticated Axios clients. Backend URL comes from `VITE_BACKEND_URL`.
- SunEditor 2.44 for authoring, KaTeX 0.16 for equations, `desmos-react` 1.2 for the calculator.
- MSW 1.2 development mocks; Storybook 7 includes one simulator story. There are no declared unit, integration, lint or E2E test scripts.
- Routes: login, student/teacher home, exam, editor and review. Route loaders check authentication. Teacher pages manage students and allocate tests; editor selects test, section, module and question.
- Vite build is `tsc && vite build`; existing GitHub Actions uploads `dist` to S3, supplies a backend URL from a secret and pins some actions to moving `main`/`master` branches. No backend, schema or migration implementation is present in this client tree.

### Visual contract to preserve

| Element          | Observed source geometry/behavior                                                                                                           | New implementation target                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Header           | Five-column grid, title spans two, timer one, tools two; 40 px horizontal and 20 px vertical padding                                        | Section/module left, true centered timer, compact tools right; no website sidebar   |
| Timer            | 24 px countdown, compact rounded Hide/Show control under it                                                                                 | Same hierarchy; force visible warning at five minutes using current official rules  |
| Separators       | 2 px gray dashed header/footer boundaries                                                                                                   | Preserve exam workspace boundaries                                                  |
| RW workspace     | 50:50 grid; separate overflow regions; content height `100vh - 186px`; right panel separated by 4 px gray rule                              | Balanced split passage/question layout with independent scrolling                   |
| Content inset    | 36 px padding; centered maximum 672 px text blocks                                                                                          | Preserve readable line lengths and generous exam whitespace                         |
| Typography       | Sans-serif interface; separate serif question font; base 16 px                                                                              | Use licensed/system sans and serif families; do not copy unidentified embedded TTFs |
| Question toolbar | Light gray, 32 px high; black numbered square left; bookmark label; eliminator right                                                        | Preserve number/review/eliminator grouping                                          |
| Choices          | Full-width outlined rows, 16 px gap, circular A–D labels; selected row gets blue outline and blue letter                                    | Preserve choice rhythm and selection hierarchy                                      |
| Footer           | Fixed white three-column grid; 32 px horizontal, 16 px vertical padding; student left, dark question pill center, blue pill Back/Next right | Preserve shape, grouping and fixed bottom navigation                                |
| Question menu    | Centered floating white panel 80 px above footer, 496 px desktop/360 px small width, thin shadow                                            | Current/answered/unanswered/review states with direct navigation and module review  |
| Module review    | “Check Your Work” and a question-state grid                                                                                                 | Explicit review before irreversible module submission                               |
| Break            | Dedicated dark screen, large remaining-break timer, Resume Testing                                                                          | Separate break state with saved timing, rather than dashboard navigation            |

These measurements come from `Simulator.Header*`, `Simulator.Question*`, `Simulator.Footer*`, `Simulator.Navigator`, `Simulator.Review`, `Simulator.Breaktime` and Tailwind configuration. They describe structure; they are not proprietary asset reuse. No standalone supplied score-report screenshot was found. The prompt's two-column seven-segment report description is therefore the report reference.

### Tools and reliability findings

The reference already demonstrates mark-for-review, cross-out/undo, navigator, timer visibility, MCQ/numeric answer input, text selection and annotation comments, module review, a break and a Desmos panel. The authoring editor supports passage, choices, correct answer, images and KaTeX.

Its behavior is not sufficient for production assessment delivery:

1. Answers/annotations are largely Recoil memory state. Only auth token/user identity use localStorage; refresh can lose the unfinished attempt. Final submission posts an accumulated answer array, not an event-backed, versioned attempt.
2. Annotation uses `Range.surroundContents`, inserts spans into mutable passage HTML and maintains a separate in-memory annotation list. Selections across element boundaries can fail, and stored question content is mutated. New annotations must be anchored to an immutable question version and saved independently.
3. Eliminating the currently selected answer explicitly clears it. The requested platform requires elimination to be independent of selected-answer state.
4. Passage, stem, choices and review render HTML with `dangerouslySetInnerHTML`; no sanitation layer is visible. New renderers sanitize rich HTML on both ingestion and display.
5. Radio inputs are visually hidden, some icon controls lack clear accessible labels, and the navigator/popups do not implement full dialog focus management. New native controls/focus handling are required.
6. Timer/module state is managed on the client. Break time is rebuilt on component mount. Server-issued deadlines and durable module transitions are required to resist reloads, disconnects and clock changes.
7. The calculator is a fixed overlay and the HTML/Storybook configuration includes a legacy hardcoded external key. This is neither proof of entitlement nor the 2026 resizable behavior.
8. No configurable adaptive branching, scoring abstraction, historical question versions, rich import pipeline, mastery model or relational backend exists in the supplied client.
9. Mocks and demo login credentials are demonstration fixtures, not production identity/security. No authorization guarantees can be inferred from hidden frontend controls.

## Secondary reference: awesome-study-resources

This is a curated links/documentation repository, not a self-study application. Its 47-file tree includes 578 JSON resource records, generated Markdown, MIT license, contributor/security guidance, SVG/PNG social branding, 14 `.mjs` maintenance/test files and GitHub workflows. There is no frontend framework, package.json, database, quiz engine or implemented mastery/spaced-repetition algorithm to merge.

`data/resources.json` is the source of truth. Each record has name, URL, description, section and optional subsection. Scripts validate records, reject duplicate/invalid entries, deterministically generate README, update counts and rotate pricing reviews. GitHub workflows cover tests, YAML/Markdown/list lint, link checks and review chores. Running `node --test` in this reference on 6 October 2026 passed all 69 tests, zero failures. This verifies its maintenance utilities only, not the new SAT application.

### Patterns chosen

| Pattern/resource category                   | SAT application use                                                                 | Reason                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Structured resource metadata and validation | Domains/skills/tags stored as data; import preview and duplicate checks             | Extensible banks with consistent search/reporting                              |
| Anki, SuperMemo and flashcard tools         | Small due-review queue for wrong/bookmarked questions                               | Repeat troublesome material without building a separate full flashcard product |
| Leveled Khan Academy practice               | Easy/medium/hard targeting and transparent skill recommendations                    | Make follow-up practice actionable                                             |
| Notes/bookmarks systems                     | Persist bookmarks, error causes and student notes independently of global questions | Personal study context with correct ownership                                  |
| Study planners/Pomodoro categories          | Short targeted practice sessions and visible next action                            | Useful scheduling pattern without intrusive calendar machinery                 |
| Content/link/provenance quality checks      | Source/license fields and explicit legal import expectations                        | The bank should accept supplied legal content, not scrape linked sites         |

Rejected: wholesale copying of the resource list, its branding, unrelated AP/IB/ACT course content, external notes/decks, AI dependencies, complex calendar integrations and universal productivity features. None is necessary for the central assess → analyze → practice → review → reassess loop.

## Verification boundaries

This is a source audit and a maintenance-test check. It is not a claim that the reference build or its live backend works. The reference source/settings have not been changed. Current official SAT rules and 2026 tool changes are independently researched in [research.md](research.md); implemented feature status belongs to the final requirement checklist and test evidence.
