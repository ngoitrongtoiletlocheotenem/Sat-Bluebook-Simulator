# Verification evidence

Latest browser verification: **9 October 2026, Asia/Saigon**. Initial project, reference and deployment checks below were recorded on 6 October 2026. Authored tests are not counted as passed until run.

## Reference checks

- Both reference trees recursively inspected: 100 primary client files; 47 study-resource files.
- `node --test` in `Idea Material/awesome-study-resources`: **69 passed, 0 failed**. These are catalog maintenance tests, not tests of the new app.
- Official College Board/publisher sources fetched live over HTTPS. The separate web search tool returned HTTP 500; research continued using direct publisher sources, with details in [research.md](research.md).

## Application verification status

Browser suite in `tests/student.spec.ts`: **6 passed, 0 failed, 0 skipped** in Chromium. It uses real registration/cookie sessions, real CSRF-authenticated API requests and real assessment persistence. No scoring or answer-key responses are stubbed. Playwright creates a uniquely named temporary SQLite DB and generated admin password for each run, preserving normal user data. The six journeys cover the complete adaptive test, offline/pause recovery, administrator bank/blueprint/import permissions, nested highlights/chart/tutor behavior, duplicate-tab takeover, and student authoring/import through the UI.

The 9 October six-test run passed with inline notes-sidebar behavior; its preserved JUnit results are in `test-results/e2e-suite-results.xml`. After the explicit Highlights & Notes mode and compact handle changes, the two affected journeys passed again in **55.76 seconds** including setup, recorded in `test-results/e2e-results.xml`. The latest full 98-question journey took 26.3 seconds; the annotation/notes-resize/chart/tutor journey took 18.8 seconds. The other four journeys were not repeated for these player changes. Tests also verify black eliminator icon lettering when inactive and white lettering when active using computed SVG fill.

Highlights & Notes starts off, including after refresh. Tests verify that selecting text while off creates no toolbar or annotation and that clicking saved highlights while off does not edit them. Explicit header activation enables the tool and displays a three-pixel black underline; turning it off closes the toolbar/sidebar while preserving saved notes. Closing only the notes panel keeps highlighting mode active.

With the mode active, the floating annotation toolbar opens from actual mouse text selection. Tests verify its compact dimensions, immediate color/underline saves, and persistence across reload for yellow/solid, blue/dashed and pink/dotted annotations spanning formatted text nodes. The notes panel opens after Add/Edit note and focuses the matching textarea; activating the tool or highlighting text alone does not create an empty panel. An empty attached note survives refresh; two annotations retain separate colored quotes and note text; deleting one note preserves its highlight and the other note. Deleting the last note hides the panel while retaining both highlights. Reactivating the mode reopens existing notes without a modal. Tests cover navigation/reload, close/reopen, and a contained tablet layout. The answer eliminator crosses a selected choice without changing the answer.

The notes-panel handle supports pointer drag, Arrow keys for 20-pixel changes, Shift for 60-pixel changes, Home/End limits and double-click reset to the default width. Tests verify a compact 16 × 30-pixel black grip inside a 28 × 44-pixel pointer target, positioned outside the notes rail within the question margin and clear of note cards. A 50-pixel drag of its right edge expands the notes panel and cards by 100 pixels while the passage and answer panels remain equal in width. The saved notes width survives refresh with both notes intact; reactivating the mode and closing/reopening notes retains the panel/card widths. The handle is present only while notes are visible. Tests also verify viewport containment and no horizontal overflow on tablets/mobile. The resize screenshots were generated and inspected: [notes resize handle](screenshots/notes-resize-handle.png), [expanded notes panel](screenshots/notes-panel-resized.png).

Screenshots were inspected: [annotation toolbar](screenshots/annotation-toolbar.png), [underline menu](screenshots/annotation-underline-menu.png), [inline note editor](screenshots/annotation-note.png), [notes sidebar](screenshots/notes-sidebar.png), [multiple notes](screenshots/notes-sidebar-multiple.png), [tablet sidebar](screenshots/notes-sidebar-tablet.png), [paired header icon](screenshots/highlights-notes-icon.png) and [option eliminator](screenshots/eliminator.png). These screenshots are generated from the implemented application, with original question content.

The full-test journey uses all **98 questions** with normal 32-/35-minute module deadlines. It submits modules through the player and uses the explicitly supported early-resume practice break control to avoid waiting ten minutes during automation. It checks hidden active answer keys, text selection through real mouse events, selection-independent elimination, notes/highlights/review, navigation, reload and deadline persistence, adaptive routes, Math calculator/reference, completed result/history, eight seven-segment domains, print layout, mistakes and retry. A separate journey checks offline edits/reconnect, pause/resume, keyboard menus/line reader and tablet overflow.

Screenshots and A4/Letter PDFs were generated in `docs/screenshots`. The final A4 and Letter PDFs each render as one page with readable metadata, two report columns, eight domains, and 56 performance segments. Screenshot creation is not a pixel-baseline regression certification. Visual review compares their structure with the measured reference geometry documented in [reference-audit.md](reference-audit.md).

## Command results

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test`: **14 passed, 0 failed**. This covers engines, validation, auth/CSRF/ownership, versioned questions, imports, blueprints, tutor/pause, weighted assembly, statistics, deadline races and the isolated calculator document's CSP/resource policy.
- `npm run build`: passed. The production frontend and `dist-server` bundle were generated successfully.
- `node scripts/smoke-local.mjs`: passed against the built local server at `http://127.0.0.1:3001`; health/static assets, guest authorization, administrator login, 352 seeded questions, the full blueprint, and clean initial history all verified.
- `npm audit`: 0 known vulnerabilities after dependency overrides/remediation.
- `node scripts/smoke-desmos.mjs`: **passed on 9 October 2026** against the built app on isolated port 3002 and a unique SQLite database. Real Desmos API v1.12 resolved to v1.12.0 with HTTP 200; real editor input rendered `y=x^2` on the graph canvas. Resize to 300 pixels and close/reopen passed. An aborted API request showed the local fallback, which calculated `sqrt(81)+2^3 = 17`; Retry Desmos then loaded the real API. The main CSP disallowed evaluation, the calculator's CSP stayed isolated, and the iframe sandbox allowed scripts only. No unexpected page/CSP errors occurred. The test listener was stopped after verification. Key-free results are in `.runtime/desmos-smoke.json`; [screenshots and setup details](desmos.md) document the actual output.

The configured Desmos integration was verified technically; its supplied key displays a Trial Key watermark, which remains visible. Commercial entitlement, official scoring calibration, an actual College Board test-day app and full assistive-technology/WCAG certification are outside the local automated checks. Both the real Desmos integration and its development fallback were tested without claiming official SAT affiliation or production licensing.
