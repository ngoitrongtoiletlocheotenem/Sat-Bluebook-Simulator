# Digital SAT simulation specification

Specification date: 6 October 2026. This document separates official public rules from this platform's configurable approximations. Actual implemented coverage is recorded in the requirement checklist and test evidence.

## Structure and timing

| Stage                        | Standard questions | Standard duration | Route                                 |
| ---------------------------- | ------------------ | ----------------- | ------------------------------------- |
| Reading and Writing Module 1 | 27                 | 32 minutes        | Balanced easy/medium/hard mix         |
| Reading and Writing Module 2 | 27                 | 32 minutes        | Higher or lower mix based on Module 1 |
| Break                        | —                  | 10 minutes        | Between sections                      |
| Math Module 1                | 22                 | 35 minutes        | Balanced easy/medium/hard mix         |
| Math Module 2                | 22                 | 35 minutes        | Higher or lower mix based on Module 1 |

Totals: 98 questions; 134 minutes of working time and a 10-minute standard break. Section timing remains independent. A Standard Full SAT blueprint enforces the counts and times above. A shorter technical/demo test must be labeled Custom/Demo, never Full SAT. [Official structure](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure).

Time accommodations: 1×, 1.5×, 2× and configured breaks. Accommodation choices configure practice only. Strict simulation disables pause by default and is configurable; normal practice allows pause/resume. Bluebook practice permits early progression; actual test-day timing must not be confused with that convenience. Store simulation policy with the attempt. Server deadlines, not browser intervals, define timed module closure. [Official Bluebook practice rules](https://satsuite.collegeboard.org/practice/practice-tests/bluebook).

## Domains and skills

The following values are metadata, not hard-coded labels in the UI. Percentages/question ranges describe whole sections, not every individual module. Command of Evidence is the parent skill; textual/quantitative evidence are useful subskills. Official terminology occasionally varies between guide pages; use consistent display labels below and preserve aliases for import.

| Section             | Domain                            | Approximate share | Expected count | Skills/subskills                                                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------- | ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading and Writing | Information and Ideas             | 26%               | 12–14          | Central Ideas and Details; Inferences; Command of Evidence → Textual Evidence, Quantitative Evidence                                                                                                                                                                                        |
| Reading and Writing | Craft and Structure               | 28%               | 13–15          | Words in Context; Text Structure and Purpose; Cross-Text Connections                                                                                                                                                                                                                        |
| Reading and Writing | Expression of Ideas               | 20%               | 8–12           | Rhetorical Synthesis; Transitions                                                                                                                                                                                                                                                           |
| Reading and Writing | Standard English Conventions      | 26%               | 11–15          | Boundaries; Form, Structure, and Sense                                                                                                                                                                                                                                                      |
| Math                | Algebra                           | 35%               | 13–15          | Linear equations in one variable; Linear functions; Linear equations in two variables; Systems of two linear equations in two variables; Linear inequalities in one or two variables                                                                                                        |
| Math                | Advanced Math                     | 35%               | 13–15          | Equivalent expressions; Nonlinear equations in one variable and systems of equations in two variables; Nonlinear functions                                                                                                                                                                  |
| Math                | Problem-Solving and Data Analysis | 15%               | 5–7            | Ratios, rates, proportional relationships and units; Percentages; One-variable data and center/spread; Two-variable data, models/scatterplots; Probability and conditional probability; Inference and margin of error; Evaluating statistical claims, observational studies and experiments |
| Math                | Geometry and Trigonometry         | 15%               | 5–7            | Area and volume; Lines, angles and triangles; Right triangles and trigonometry; Circles                                                                                                                                                                                                     |

[Official content-domain/skill definitions](https://satsuite.collegeboard.org/practice/content-domains), [Reading and Writing](https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing), [Math overview](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/overview). Whole-section approximate proportions/counts follow the supplied SAT blueprint requirements; supported seed IDs may organize related subskills under one parent.

## Questions and rendering

RW: single MCQ per short passage/passage pair; Math: MCQ or student-produced numerical response. Metadata includes section/domain/skill/subskill, difficulty/category and optional numeric difficulty/calibration, source/license/provenance, status, version, tags, calculator metadata, explanation, per-choice rationale, hint and strategy. Rich passage/stem/choices may include sanitized tables, images and LaTeX. Do not execute imported scripts, active SVG content or arbitrary URLs.

Student-produced answers normalize whitespace, Unicode minus, decimal and rational representations with server-side finite-value checks. Accepted answer sets and optional authored numerical tolerance are versioned with the question. This is an internal practice evaluator; it must not silently claim reproduction of every private Bluebook numeric-entry edge case. Empty/invalid expressions cannot become zero. Explanations/keys are withheld while an assessed module is open.

## Module lifecycle

1. Create an attempt with immutable blueprint, question versions, adaptive/scoring model versions, assembly seed and accommodation policy.
2. Open Module 1 with server start/deadline timestamps. Save answers, eliminations, review status, highlights/notes, elapsed time and current question.
3. Allow next/back/menu navigation and answer changes inside this open module. Eliminated choices are visual study state and do not modify the selected answer.
4. On authorized submission/timeout, atomically lock the module and evaluate responses server-side. Refuse writes to closed modules.
5. Evaluate the persisted routing model. Record input performance, model version, threshold and chosen higher/lower route. Module 2 questions become the active route; the unused route is not part of the student's scored responses.
6. After RW Module 2, enter the saved break. Open Math Module 1 after the configured break/allowed practice transition; route Math independently.
7. Close Math Module 2, compute an immutable result, create error records and expose report/history/review.

Refresh/resume preserves the open module and the same deadline. Network interruption retains a local pending journal, reports sync state and retries safely. A reconnect after deadline cannot reopen the module or extend strict time. Question edits/blueprint edits after attempt creation must not alter historical questions or grades.

## Adaptive and scoring assumptions

Public College Board information establishes multistage routing and IRT scoring; it does not supply private threshold/calibration parameters. The platform therefore uses an independently configurable, versioned deterministic route rule. Module 1 uses a difficulty mix; higher/lower routes use differing mixes. They are simulation difficulty routes, not College Board routes. [Official scoring/adaptive explanation](https://satsuite.collegeboard.org/sat/scores/understanding-scores/how-scores-are-calculated).

The scoring service has separate strategies for authorized form mappings, calibrated internal models and estimated practice scores. The default is estimated. Valid section range is 200–800; valid total range is 400–1600. Persist model version, per-section/total values, route, optional estimated range and uncertainty. Never label raw accuracy conversion as official, infer a percentile or apply an invented official route cap. College Board's unscored pretest questions are not secretly simulated using original seed items.

## Player and tools

- Exam-only full viewport shell: left section/module, centered timer and Hide/Show, contextual right tools, dashed boundaries, fixed footer.
- RW uses the primary reference's balanced passage/question split and separate scroll regions; Math uses readable centered workspace. Sans UI and serif question typography, outlined choice rows, circular labels and blue navigation preserve the reference proportions.
- Mark review, option elimination and question states persist per response. Question menu visually and accessibly identifies current/answered/unanswered/review.
- Highlights anchor saved text ranges/quotes to immutable content, survive navigation/reload, and support note edit/delete. Keyboard access must provide a practical text-range selection path; a disappearing overlay is not sufficient.
- Line reader focuses a movable line region; timer forces a visible five-minute warning and submits at zero.
- Calculator/reference are contextual Math tools. The panel resizes; image zoom/pan/reset uses a lightbox, reflecting June 2026 changes. Desmos requires valid operator configuration/entitlement; development fallback is an original numerical tool, not promised graphing parity.
- Use semantic regions/controls, keyboard focus, dialog focus return, accessible names, sufficient contrast, reduced motion and no override of browser zoom/editing shortcuts.

[Official tools](https://bluebook.collegeboard.org/students/tools), [2026 changes](https://bluebook.collegeboard.org/technology/updates-releases/releases), [accessibility and keyboard requirements](https://bluebook.collegeboard.org/students/accommodations-assistive-technology/accessing-bluebook-features-content).

## Results and analytics contract

Full-test report: white printable page with student/date/test metadata, “Estimated SAT Score”, total/range and section scores; Knowledge and Skills heading/subheading; RW left and Math right; each domain includes approximate SAT proportion/count and seven rectangular segments. Bars are **approximate internal performance**, not an official College Board report. No-attempt domains display no-data distinctly from a measured low level. [Official seven-bar interpretation](https://satsuite.collegeboard.org/practice/content-domains).

Web detail adds route, correct/answered/unanswered/marked counts, time used, difficulty/domain/skill summaries, slowest/wrong items, selected vs correct answers, all rationales, bookmarks, retry and notes. Report print excludes navigation/buttons, preserves the seven boxes, avoids splitting domain rows and supports browser Save as PDF for A4/Letter. It does not require a remote PDF service.

Longitudinal analytics use the student's real persisted responses/results, with empty states before enough evidence exists. Skill mastery, rapid-answer flags, time warnings, score ranges and rule-based recommendations are documented internal heuristics. Seven-/30-/90-day and all-time filters use attempt dates. Wrong answers enter an owned error log with causes, retry/due review and explicit mastered state.
