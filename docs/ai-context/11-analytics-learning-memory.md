# Analytics and learning memory

[Context index](README.md) · [State and persistence](07-state-memory-persistence.md) · [Assessment engine](10-assessment-engine.md)

Inspected against current source on 19 October 2026. Primary code: [analytics.ts](../../server/analytics.ts), [statistics.ts](../../server/statistics.ts), [attempts.ts](../../server/attempts.ts), [engines.ts](../../server/engines.ts), [Study.tsx](../../client/Study.tsx), and [Report.tsx](../../client/Report.tsx).

“Learning memory” currently means owned SQL evidence and deterministic calculations. There is no model-driven learner profile, semantic/vector database, LLM recommendation call, or external AgentMemory dependency in the application.

## Stored evidence versus derived views

| Evidence/state                                                                       | Durable location       | How it is used                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| Attempt identity, mode, seed, lifecycle, dates                                       | `attempts`             | Active sessions, historical chronology, mode counts.                              |
| Selected modules, timing boundaries, route and routing inputs                        | `module_attempts`      | Timed recovery and the route trace.                                               |
| Answers, correctness, elapsed time, flags, eliminations, annotations, free-form note | `responses`            | Active attempt state and historical review; exact question version is referenced. |
| Immutable question content/key version                                               | `question_versions`    | Preserves the content seen in old responses and error records.                    |
| Completed report and calculated domain/skill/difficulty summaries                    | `score_results.report` | Stable score history, report review, and inputs for current analytics.            |
| Original wrong answer, reason, status, retry count, due timestamp, optional note     | `error_logs`           | Mistake journal and non-mastered question collection.                             |
| Saved question reference                                                             | `bookmarks`            | Owned bookmark list and practice source.                                          |
| Name and target score                                                                | `users` name/profile   | Account personalization; target is not a learned prediction.                      |

The dashboard is reconstructed on request; there is no dedicated aggregate/mastery table. `score_results.report` is a stored derived artifact, while dashboard summaries and recommendations are recalculated from those report snapshots. Editing a response or question later is not a mechanism for rewriting a saved report.

## History and dashboard windows

`history()` selects the latest 500 owned score results, then reverses them into chronological order for charts. It returns title, mode, completion date, total/section scores, accuracy, and total assessed questions. It is not limited by the dashboard day filter.

`dashboard()` reads up to 1,000 newest owned score results. An accepted `days` value of 7, 30, or 90 adds a result creation-time cutoff; other values mean all available results within that cap. It flattens each saved report's review items and computes current domain and skill performance using the current taxonomy. It also returns per-report domain history in chronological order. Retired or changed taxonomy labels can affect reconstructed grouping; already saved report summaries remain their historical snapshots.

Dashboard totals are precise about what they count:

- `questionsAnswered`: review entries with a nonblank answer; repeated attempts at the same question are separate evidence.
- `accuracy`: correct / all review entries, including unanswered entries as incorrect.
- `averageMs`: all recorded review milliseconds / all review entries.
- `studyDays`: distinct ISO completion-date strings; a stored result date uses UTC, not a personalized local-calendar model.
- `errors`: all owned non-mastered error records, including separate mistakes on the same question.
- `bookmarks`: all owned bookmark records.

The errors/bookmarks counts and active-attempt list are not constrained by the selected result date range. Up to 20 newest unfinished attempts are fetched. Each is passed through `getAttempt()`, which can synchronize deadlines and complete an expired attempt. Since dashboard results were queried earlier, a newly synchronized completion may appear in summary/history on the next request. A dashboard read is therefore not entirely side-effect free.

## Performance, mastery bars, and trends

`performance()` groups review items by domain, skill, or difficulty and computes attempts, correct, accuracy, and rounded average milliseconds. “Attempts” in this structure is the number of assessed response entries in the group, not whole test attempts.

Its seven-segment internal level is:

`0` when no responses exist; otherwise `max(1, min(7, round(accuracy × 6) + 1))`.

This accuracy proxy has no difficulty weighting, uncertainty model, or minimum-sample requirement. A single response can fill all seven segments. It is separate from a mistake row's manually controlled `mastered` status. Labels in the UI disclose that scores/mastery are internal estimates.

For each dashboard domain/skill, `recentAccuracy` uses its first 20 entries from the newest-first report list and `trend` subtracts accuracy of entries 21–40. If there is no prior block, trend is zero. Entries within each report remain in question/module order, so this is a report-order heuristic, not a globally time-sorted event stream or fixed-day trend.

`Report.tsx` adds transient review filters: slow means more than 90,000 ms; rapid means an answered question with elapsed time greater than zero and less than 3,000 ms. These are UI filters, not saved diagnostic flags or proof of guessing. Time is client-collected study telemetry with server caps, not proctoring evidence.

## Recommendations and weak-skill practice

Dashboard recommendations use these exact rules:

1. Keep skills with at least one assessed response.
2. Sort by ascending accuracy, breaking ties by descending average response time.
3. Take the first three skills. Count accessible published questions for each; if the count is nonzero, offer at most ten.
4. If any non-mastered error records exist, prepend a “Revisit recent mistakes” recommendation with count capped at ten.
5. If nothing remains, recommend a 27-question timed module to establish initial evidence.

This is a deterministic rule, not a model prediction. The accessible-question query accepts shared questions plus the current user's private questions. Recommendation count is an availability limit; it does not promise unseen items or use due dates. Error-record count can exceed the number of distinct available questions, so the resulting attempt can contain fewer questions than the recommendation count.

`createAttempt(mode: weak)` has a related but different window. If no domain/skill is explicitly supplied, it reads the latest **30** reports, calculates measured skill performance, sorts by the same accuracy/time rule, and selects the first skill. This selection does not scan onward for another available skill if the weakest one has no published questions. With no history it leaves the skill unrestricted. The count for weak/wrong/bookmark modes shrinks to available items; zero availability returns HTTP 422.

`wrong` mode and `includeWrong` filter by any non-mastered error row for the question. They do not schedule by due date and they select the current accessible published question version. Reading the journal shows the original error's version; retrying starts a new practice attempt against the current bank. This distinction matters if a question changed after the original mistake.

## Mistake lifecycle, retries, and due timestamps

At report creation, every wrong or blank response creates an owned error row tied to the attempt, question, and original version, with due time one day later. A unique user/attempt/question constraint prevents duplicates within the same attempt. Different attempts can produce multiple error rows for one question.

For every assessed question, completion also updates all prior error rows for that user/question:

| Outcome on later attempt | Prior error changes                                                               |
| ------------------------ | --------------------------------------------------------------------------------- |
| Correct                  | Increment retries; set `reviewing` unless already mastered; due in three days.    |
| Incorrect/blank          | Increment retries; set `new`, including previously mastered rows; due in one day. |

Tutor feedback can create an error immediately on a wrong check. A subsequent correct tutor check in that same attempt increments that row's retries, changes it to reviewing unless mastered, and moves due time three days forward. Repeated incorrect tutor checks do not create duplicate rows or increment that same row's retries. Retries measure these recorded transitions, not necessarily distinct standalone sessions or manual button clicks.

The journal API supports reason categories, optional note, and an explicit mastered boolean. Marking mastered sets status `mastered`; reopening sets `new`. It does not automatically change due time. Correct retry alone changes status to `reviewing`, not mastered. User reasons include concept gap, misread question, calculation error, grammar rule, vocabulary, time pressure, careless mistake, guessed, and other; the app does not infer the reason.

`errorItems()` returns at most 100 rows per page, newest first, with filters for section/domain/skill/difficulty, mistake date, and open/mastered/never-retried/still-wrong status. These taxonomy filters use current `questions` metadata, while displayed content comes from the error's version. `lastCorrect` is derived from retries/status rather than a dedicated answer event. The DTO includes `dueAt`, but the current journal UI neither displays nor orders/filters by it. The error note is accepted/stored by the write API but is absent from `ErrorItem` and the rendered journal editor; do not advertise a complete journal-note workflow.

## Teacher/admin statistics

`statistics()` is exposed only to teachers/admins. It returns student identity and attempt/completion counts, aggregate saved-report accuracy, latest available total score, and last attempt **start** time as `lastActivity`. Its field `questionsAnswered` sums report totals, including unanswered questions; it differs from the dashboard's nonblank-answer count.

Question statistics cover the top 1,000 shared questions by usage count. They join responses by logical question ID and count non-null correctness, so all users and question versions can contribute, including tutor-graded active responses. Usage increments when a pool is installed rather than whenever a question is viewed. Summary accuracy is derived from completed report totals. These statistics are neither a calibrated item-analysis system nor a per-class roster/assignment model.

## Future memory extension points — not implemented

Possible future architecture could add append-only `learning_events`, persisted `student_skill_state`, per-version `student_question_memory`, a due-date review queue, or optional semantic/AI explanations. None of those named tables or systems exists today. Any such change needs ownership checks, retention/export policy, historical version binding, explicit migration/backfill rules, and a clear distinction between stored evidence and recomputable predictions. Existing error `due_at` fields and response/report snapshots are useful inputs; they do not already constitute a spaced-repetition or AI memory engine.
