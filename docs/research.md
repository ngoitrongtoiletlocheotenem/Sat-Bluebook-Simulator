# SAT and product research

Research date: **6 October 2026 (Asia/Saigon)**. Sources below were fetched live from their publishers. The web search/open tool failed with an HTTP 500 “channel does not support /v1/alpha/search”; direct HTTPS requests succeeded, so research continued through official pages and publisher links/sitemaps. No College Board or competitor questions, logos or illustrations were copied.

## Official test rules

The SAT has two adaptive sections: Reading and Writing, 54 questions over two 32-minute modules; Math, 44 questions over two 35-minute modules. A 10-minute break separates the sections. Module 1 mixes difficulty levels, and Module 2 difficulty is determined by Module 1 performance. Total working time is 134 minutes. Students can navigate and revise answers within an open module. [College Board: How the SAT Is Structured](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure).

Reading and Writing presents short passages or paired passages followed by one MCQ. Passages span literature, history/social studies, humanities and science, commonly 25–150 words. Similar skills are grouped and arranged by increasing difficulty. Math uses MCQ and student-produced responses; calculator access covers Math, not Reading and Writing. [Reading and Writing](https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing), [Math Overview](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/overview), [Calculator Policy](https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy).

Current official calculator policy permits Bluebook's graphing/scientific Desmos tools and prohibits calculators with built-in CAS. A web scientific fallback must evaluate numerical expressions without pretending to be an approved Bluebook graphing tool. Domain/skill taxonomy belongs in database seed data and is fully specified in [sat-spec.md](sat-spec.md). [College Board Content Domains](https://satsuite.collegeboard.org/practice/content-domains).

## Bluebook experience, tools and 2026 changes

Bluebook provides a hideable countdown, reference sheet, Highlights & Notes, mark-for-review, line reader, choice eliminator, question menu and zoom. Hidden timer becomes visible with a warning at five minutes. Tools are contextual; focused testing should contain no dashboard/sidebar/marketing navigation. [Official Testing Tools](https://bluebook.collegeboard.org/students/tools).

The **25 June 2026** release explicitly added a resizable on-screen Desmos calculator and image enlargement through a lightbox; it also added Greek/statistics palettes for applicable free-response exams. August 13 and September 3, 2026 were required routine updates. AP-specific free-response editors are not SAT requirements. The fetched version table contained older-looking build strings, so the implementation does not publish those as a current app-version assertion. [Bluebook Release Notes](https://bluebook.collegeboard.org/technology/updates-releases/releases).

Bluebook supports keyboard-only highlighting, keyboard moving of calculator/reference windows, screen-reader use and reduced-motion settings. Practice accommodation selection does not establish official permission to test with those accommodations. Our application exposes practice-time multipliers and break settings as simulation settings. [Accessing Bluebook Features and Content](https://bluebook.collegeboard.org/students/accommodations-assistive-technology/accessing-bluebook-features-content), [Practice Tests and Accommodations](https://satsuite.collegeboard.org/practice/practice-tests/bluebook).

### Keyboard comparison and browser adaptations

These are research mappings, not a claim every shortcut is implemented. The player’s shortcut help is the implemented contract. Native browser zoom, clipboard shortcuts and ordinary typing remain available.

| Action                   | Official Windows Bluebook | Official macOS Bluebook | Website design rule                                                        |
| ------------------------ | ------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| Back / Next              | Ctrl+Alt+B / X            | Cmd+Ctrl+B / X          | Equivalent modifier actions when platform permits                          |
| Question menu            | Ctrl+Alt+G                | Cmd+Ctrl+G              | Button and keyboard access                                                 |
| Mark review              | Ctrl+Alt+V                | Cmd+Shift+V             | Persist independently of response                                          |
| Timer                    | Ctrl+Alt+T                | Cmd+Option+T            | Cannot hide the five-minute warning                                        |
| Calculator / reference   | Ctrl+Alt+C / R            | Cmd+Option+C / R        | Math only, keyboard reachable                                              |
| Select A–D               | Ctrl+Shift+1–4            | Cmd+Ctrl+1–4            | Native radio selection remains available                                   |
| Eliminate A–D            | Ctrl+Alt+1–4              | Cmd+Option+1–4          | Does not clear selected answer                                             |
| Eliminator mode          | Ctrl+Alt+O                | Cmd+Ctrl+O              | Distinct toggle/action                                                     |
| Highlights / line reader | Ctrl+H / Ctrl+L           | Ctrl+H / Cmd+L          | Use browser-safe alternatives; Ctrl+H/L belong to browser History/Location |
| Exam regions / help      | F6, Shift+F6 / F1         | F6, Shift+F6 / F1       | Semantic regions, Tab focus and accessible help                            |

[Official Windows shortcuts](https://bluebook.collegeboard.org/help-center/windows-keyboard-shortcuts), [official macOS shortcuts](https://bluebook.collegeboard.org/help-center/macos-keyboard-shortcuts). Do not intercept text inputs/contenteditable or Desmos’s internal keyboard commands. Unsupported native-app shortcuts must not be advertised as working.

## Scoring and Knowledge and Skills

College Board uses IRT/item characteristics and response patterns. Equal raw correct counts can produce different scaled scores. Each module includes two unscored pretest questions. Public documentation does not reveal private item parameters or an official raw-count conversion. Our original-item estimated model therefore scores supplied items as internal practice items and labels results **Estimated SAT Score**. It does not invent official pretest status, percentile, private route threshold or route-specific score ceilings. Authorized form mappings/calibrated models require separate verified inputs. [How Are Scores Calculated?](https://satsuite.collegeboard.org/sat/scores/understanding-scores/how-scores-are-calculated).

Official domain performance reports use seven segments. For SAT, easy/medium/hard proficiency corresponds broadly to bars 1–3/4–5/6–7. Our seven-bar display is an approximate internal performance summary until authorized calibration exists; low sample counts must be visible. Domain rows include the official approximate proportion and question count. [Content Domains and Progress Bars](https://satsuite.collegeboard.org/practice/content-domains).

## Official practice-product patterns

Bluebook full-length practice is scored, offers accommodation setup and permits advancing before time expires. Its untimed test preview provides tool familiarization without a score. These are distinct from actual test-day restrictions and should be distinguished from strict simulation. [Full-Length Bluebook Practice](https://satsuite.collegeboard.org/practice/practice-tests/bluebook).

Student Question Bank supports assessment/section/domain/skill/difficulty filters. My Practice provides chronological practice scores, question review including each answer-choice rationale, tailored practice and downloadable summary reports. Chosen pattern: finish a test, inspect mistakes and domain results, then launch targeted practice. Official links remain links, not imported content or authorized API integrations. [Student Question Bank](https://satsuite.collegeboard.org/practice/student-question-bank), [My Practice 101](https://satsuite.collegeboard.org/practice/my-practice-101).

## Competitor product patterns

| Publisher source                                                                                                                                                 | Observed useful patterns                                                                                                                           | Chosen application behavior                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Khan Academy course](https://www.khanacademy.org/digital-sat) and [College Board's current Khan guide](https://satsuite.collegeboard.org/practice/khan-academy) | Foundations → Medium → Advanced, course diagnostics, skill quizzes/unit tests, question explanation-to-lesson connections                          | Transparent difficulty progression, practice by weak skill and mastery estimate. The direct Khan course was JS-challenged and its support page returned 403; current level/progression claims were verified through College Board’s guide. |
| [UWorld SAT](https://collegeprep.uworld.com/sat/)                                                                                                                | Detailed visual answer explanations, custom timed/topic tests, progress dashboard, flashcards with spaced repetition, personalized notes           | Per-choice rationales, configurable practice generation, error causes/notes and a lightweight due-review queue                                                                                                                             |
| [Test Innovators SAT](https://testinnovators.com/sat/)                                                                                                           | Adaptive practice tests, module reports, time-management analysis, question-level analysis, suggested follow-up exercises, topic-specific practice | Persist elapsed time per item; wrong/slow question review; modular deterministic routing; targeted follow-up recommendations                                                                                                               |
| [Princeton Review Digital SAT](https://www.princetonreview.com/college/free-digitalsat-practice-test)                                                            | Realistic test player, timer, calculator/reference, annotation, eliminator, review and keyboard tools                                              | Preserve the focused exam shell and make reports link directly to explanations/practice                                                                                                                                                    |

Only public product patterns were studied, not proprietary lesson/question content, private algorithms, branding or claimed score guarantees. The Princeton page includes legacy rollout guidance and scoring-cap wording; actual rules use the newer College Board sources above. No competitor guarantee or marketing improvement claim is reproduced as evidence of our platform's efficacy.

## Desmos integration and entitlement

Desmos's official API documentation specifies loading its calculator script with an operator-issued API key and creating/destroying a calculator instance inside an owned element. API v1.11 includes autosize/resize behavior, scientific/graphing constructors and accessibility support. Use an environment-configured key and lazy loading; never reuse the reference's key. [Desmos API documentation](https://www.desmos.com/api/v1.11/docs/index.html), [request/manage an API key](https://www.desmos.com/my-api).

The current API terms, version 1.0 updated **11 July 2025**, restrict the free Trial Tier to personal noncommercial use or a 90-day internal commercial evaluation. Production access by end users falls within commercial use under those terms; the operator must select an appropriate paid plan or contact Desmos for an agreement. Branding must remain visible. This was verified in the JavaScript-rendered terms page’s delivered bundle, because static HTML contains only a loading shell. No entitlement was acquired during development. [Desmos API Terms](https://www.desmos.com/api-terms?lang=en).

Chosen behavior: a working original numerical calculator when no key is configured; optional authorized Desmos integration through environment configuration; resizable tool panel and clear provider labeling. The fallback must not be advertised as a full graphing replacement. Full parity with licensed Desmos remains dependent on a valid deployment key/entitlement and live verification.

## Features chosen and rejected

Chosen: focused exam/player and two-column print report; legal original seed; data-driven SAT taxonomy; durable/versioned attempts; configurable deterministic adaptive models; estimated scoring with explicit uncertainty; explanations, bookmarks, error log, review queue and rule-based recommendations; permission-controlled import/editor/blueprints.

Rejected: official logos/affiliation, proprietary question scraping, invented IRT parameters/percentiles, copying unlicensed reference assets/fonts, client-trusted grades/roles, opaque AI tutoring dependency, wholesale productivity/catalog integration and claims of certification. The self-hosted deployment defaults to SQLite. A PostgreSQL connection adapter and portable migration schema support an operator-configured production database; this is not a claim that a live PostgreSQL deployment was tested in this session.

## Desmos integration update — 9 October 2026

The supplied calculator example was configured for Desmos API v1.12. Official v1.12 documentation was fetched live, and the built application was checked against the real service. The API resolves to v1.12.0, renders graphs, resizes and supports close/reopen. The original calculator remains available on a failed network load and Retry Desmos restores the service. Actual runtime evaluation is confined to a sandboxed calculator document; the main page keeps evaluation disabled. The supplied key displays Desmos's Trial Key badge, which remains visible. See [desmos.md](desmos.md) and [verification.md](verification.md) for current technical evidence and operator prerequisites.
