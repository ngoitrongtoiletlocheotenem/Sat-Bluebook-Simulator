# State, memory, and persistence

[Context index](README.md) · [Frontend](04-frontend-architecture.md) · [Database](06-database-data-model.md) · [Workflows](08-core-workflows.md)

Here, memory means application state and stored learning evidence. Pathwise does not currently have an AI/semantic learning-memory service. Its state model is React presentation → browser recovery buffer → validated SQL attempt/history records → derived reports and recommendations.

## State layers and authority

| Layer                    | Actual storage                                              | Authority and lifetime                                                                                                                     |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| UI state                 | Component `useState`/`useRef`, `AppContext`                 | Open dialogs/tabs, form drafts, filters, zoom, line reader, calculator, selection, loaded API data; mostly lost on refresh                 |
| Pending attempt recovery | localStorage, one record per attempt                        | Latest unsent response snapshots and question position for one module; recoverable device state, never permission to override server state |
| Browser write ownership  | localStorage owner lease plus optional Web Locks API        | Same-origin/browser-profile tab coordination; not an account/device lock and not durable exam ownership                                    |
| Layout preference        | localStorage notes open/width keys                          | Optional per-attempt presentation preferences, not question notes themselves                                                               |
| Authentication           | `sat_session` HttpOnly cookie; `sessions` SQL rows          | Server authenticates token hash, expiry, and current user role per request; CSRF token stays in API-module memory                          |
| Live assessment          | `attempts`, `module_attempts`, `responses`                  | Server authority for ownership, status, module selection, deadlines, submitted answers/annotations/time and navigation                     |
| Question history         | `questions` head + append-only `question_versions`          | Mutable head/metadata; attempts bind response rows to historical version IDs                                                               |
| Attempt configuration    | `attempts.snapshot` JSON                                    | Creation-time blueprint, versioned candidate pools, scoring configuration, seed/timing configuration; pause adds remaining-time metadata   |
| Completed history        | `score_results.report` JSON                                 | Saved result/review/model version; returned as stored rather than silently rescored                                                        |
| Learning evidence        | Bookmarks and error logs, versioned response/report history | Durable user-owned collections, reasons, retry/review/mastery state                                                                        |
| Derived analytics        | Calculated by `analytics.ts`/`statistics.ts`                | Summaries/recommendations calculated from stored evidence, not a separate authoritative model of ability                                   |
| Imports                  | `import_jobs.preview`/`report` JSON                         | Durable preview/repair/confirmation job, separate from bank questions until confirmation                                                   |
| Figures                  | Public asset/upload files + `question_assets` metadata      | Files are required alongside database for recovery; question versions store URLs, not an immutable copy of remote/file bytes               |

The current client uses **localStorage only** for browser persistence. Source search finds no IndexedDB, sessionStorage, BroadcastChannel, service-worker cache, or offline application shell. A loaded player can retain edits while disconnected; opening the app entirely offline is not supported by this recovery queue.

## Browser keys and exact contents

All keys are created by [`Player.tsx`](../../client/Player.tsx):

| Key                               | Payload                                                                            | Purpose                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sat-attempt-pending:<attemptId>` | `{ moduleId, currentQuestion, responses: Record<questionId, Response>, revision }` | Coalesced unsent edits for the active module; each value is a whole `Response`, not a field patch or ordered event log |
| `sat-attempt-owner:<attemptId>`   | `{ owner: <random UUID for this player mount>, updated: <client epoch ms> }`       | Tab lease, refreshed every 5 seconds; another recent owner blocks initial claim for 15 seconds                         |
| `sat-notes-panel:<attemptId>`     | `open` / `closed`                                                                  | Notes-panel layout preference                                                                                          |
| `sat-notes-width:<attemptId>`     | Numeric pixel string                                                               | Notes width preference; loaded within 160–480 pixels and subsequently clamped for the workspace                        |

These keys do not contain session cookies/tokens. They do contain student answers/notes and are device/profile data. Clearing browser storage loses unacknowledged edits and preferences, not already saved account history. Keys are keyed by attempt ID rather than by user ID; server ownership validation remains mandatory. Logout does not enumerate/delete these recovery keys.

There is no browser persistence for unsaved authoring forms, blueprint drafts, practice configuration, image-repair draft lists, loaded dashboard responses, calculator history, zoom, open menus, timer visibility, or Highlights & Notes mode. An import preview is stored server-side, but the UI has no general list/resume control for recovering an old preview after closing/reloading its dialog.

## Answer, annotation, note, and navigation save pipeline

Primary implementation: Player's `updateResponse`, `enqueue`, `storePending`, `flush`, `load`; server `attemptSaveSchema` and `saveAttempt` in [`attempts.ts`](../../server/attempts.ts).

```mermaid
sequenceDiagram
    participant U as Learner
    participant P as Player React state
    participant L as localStorage buffer
    participant A as Attempt API
    participant D as SQL transaction
    U->>P: Answer / mark / eliminate / annotate / note
    P->>P: Merge into full Response immediately
    P->>L: Store latest response snapshot and queue revision
    Note over P: Debounce 500 ms; periodic record/flush every 10 s
    P->>A: PATCH moduleId + position + response snapshots
    A->>D: Lock, synchronize deadlines, validate active module, write
    D-->>A: Commit validated state
    A-->>P: Success (or conflict/error)
    P->>L: Remove acknowledged data; retain newer edits
```

1. `updateResponse` rejects local editing when not active, not browser owner, missing the question, or already past the displayed module deadline. It merges a partial UI change into the current full `Response`, updates React/attempt ref immediately, and calls `enqueue`.
2. `enqueue` creates/reuses the pending record for the current module, records question position, stores any changed whole response, increments a **local queue revision**, writes localStorage immediately, and restarts a 500 ms save timer.
3. `flush` serializes network saves through the `saving` promise and, when available, the browser's named Web Lock. If offline, it keeps pending data and throws a reconnect message. It sends a structured clone of the pending snapshot.
4. On success, the queue revision tells the client whether all data in that snapshot is still current. An unchanged queue is cleared. If newer edits occurred, only response snapshots that still exactly equal the acknowledged values are removed; the remaining queue is flushed again. This prevents an old success from clearing a newer local edit.
5. On failure, pending data remains and the UI says it is waiting to reconnect. Debounced HTTP 409 handling reloads server state; transitions also explicitly reload on 409. Periodic/background flush catches keep the queue for retry. A successful PATCH response is not applied as a fresh React snapshot; the client keeps its current local view until a load/transition reconciles it.

`Response` in [`shared/types.ts`](../../shared/types.ts) comprises `answer`, `eliminated`, `marked`, `highlights`, `note`, and `elapsedMs`. Answer choice selection, mark-for-review, elimination, highlight edits, attached-note text, and general question note all use the same queue. Navigation calls `recordElapsed`, updates `currentQuestion`, and enqueues position even if no response changed. Question time is therefore not maintained by an independent write endpoint.

### Server save rules

`saveAttempt` runs under `withAttemptLock`, calls `synchronizeAttempt`, requires active status and the currently active `moduleId`, rejects out-of-range question position and response IDs from other modules, validates choices/eliminations/highlight range direction, and updates response data plus attempt position in a transaction. The save schema applies payload size/count limits, including 100 highlights and bounded note/text lengths.

`responses.eliminated` and `.highlights` are JSON text. General `Response.note` is encoded in `responses.notes` as an array entry with ID `note`; `responseValue` maps the first entry back to the singular field. Attached notes remain properties of each serialized highlight, independently of that general field. Marking a question and eliminating choices do not change the answer automatically.

The server accepts elapsed time monotonically per response (`max(previous, incoming)`) and caps it to the lesser of elapsed wall time since module start and the module's duration, when timed. This is useful telemetry, not a proof of continuous attention or exact stopwatch accounting.

## Timing and visibility

- The displayed clock updates every second against the server-provided absolute deadline. A client clock change can affect display; server enforcement uses server time.
- `recordElapsed` runs on navigation/transitions, every 10 seconds, visibility changes, page hide, and cleanup. It attributes time to the previously visible active question only while not in module review, excludes intervals that began hidden, ignores intervals under 50 ms, and caps any one increment at 60 seconds.
- Hiding the page stores recovery state. It does **not** pause a strict test. A page-hide/unmount handler cannot promise a successful network save; it primarily records/stores local data.
- At five minutes remaining the timer is made visible. At displayed expiry the player attempts finish immediately and retries every 5 seconds; server transition logic remains authoritative.
- Untimed practice has no deadline. Timed non-full attempts may pause through an explicit successful server transition. Closing the tab is not an automatic practice pause.

## Refresh, disconnect, and reconnect

On player mount, the client claims/checks the browser lease, reads and minimally validates the pending record, then GETs the attempt. `load` uses server data as the base. If the same module is still active, it overlays queued responses whose IDs belong to that module and clamps saved question position to its bounds. It then attempts to flush. If the module differs or the server returns no active module, the stale queue is removed and cannot reopen a closed module.

On `offline`, the save indicator reflects local-only state. A learner can continue editing an already-loaded, still-active module before its deadline; lifecycle actions that need server confirmation cannot complete offline. On `online`, the client attempts `flush` then `load`; failures are retained for retry rather than guaranteed immediately reconciled. Reopening requires loading the application/API again, so a browser recovery record alone cannot render a complete offline question bank/player.

If device storage is unavailable or full, state can remain in memory and save over the network, but refresh/close recovery is unavailable. The player displays **Device storage unavailable. Keep this window open until saved.** Storage access failure also weakens browser lease coordination; server ownership, status, and deadlines still apply, but this is not equivalent to exclusive editor ownership.

## Same-browser duplicate tabs and takeover

Player uses a localStorage lease, the `storage` event, and `navigator.locks` where available. **There is no BroadcastChannel.**

1. Each player mount gets a random owner ID. An initial claim refuses a different lease updated within 15 seconds. A stale lease may be claimed by a new mount.
2. The owner refreshes its lease every 5 seconds. When another owner is observed through heartbeat/checks or a storage event, the old player becomes read-only, hides editing tools, and shows the another-window screen.
3. Every queue/network mutation checks `ownsWindow`. Optional named lock `sat-attempt-write:<attemptId>` serializes same-browser writes and takeover with an in-flight mutation.
4. **Continue here** runs `takeOver`: wait for that Web Lock if available, force claim ownership, reread the shared pending record, load current server state, flush valid pending changes, and reset the active-time baseline.
5. Page hide/cleanup removes this mount's lease if it still owns it. A blocked tab does not silently become owner just because another lease disappears; explicit takeover is available.

This is cooperative same-origin/browser-profile coordination. Separate devices, profiles, or storage partitions do not see each other's leases/Web Locks. It is not a distributed attempt lock.

## Server concurrency and the two different revisions

[`attempt-lock.ts`](../../server/attempt-lock.ts) queues operations by attempt ID within one Node process and wraps them in a database transaction. It checks attempt/user ownership; PostgreSQL additionally uses `FOR UPDATE` on the attempt row. SQLite writer serialization is provided at the database boundary. These mechanisms keep finish/save/route transitions from partially interleaving; they do not identify a unique learner device.

**Do not confuse three concepts:**

| Mechanism                    | Current behavior                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Pending.revision` in Player | Local counter for removing acknowledged queue snapshots; extra field is not a server compare-and-swap contract            |
| `attempts.revision` in SQL   | Incremented on saves and advancing modules; not exposed in `Attempt` and not compared against an incoming client revision |
| Question head `version`      | `updateQuestion` does use a compare-and-swap update and returns HTTP 409 for a concurrent head change                     |

The attempt-save schema has no expected-revision field. Cross-device active-module writes are serialized but a later whole response can overwrite the earlier device's answer, highlights, notes, mark, or eliminations. Elapsed time has the separate monotonic rule above. HTTP 409 currently protects lifecycle/module validity, not general stale-answer conflicts. No client push/polling continuously merges another device's edits. A future optimistic concurrency design would require an explicit API contract and reconciliation policy, not simply using the existing local queue counter.

Question-head CAS also has a boundary: `updateQuestion` compares the head it read during that request, not the editor's submitted version. It guards overlapping head changes but does not prevent a sequential stale form from replacing newer content as a fresh version. Historical version rows remain intact.

## Deadlines, breaks, practice pause, and server restart

`attempts.ts` persists absolute module deadlines, module status, active position, break-until, and snapshot configuration. `synchronizeAttempt` checks them whenever attempt operations require synchronization; there is no timer job that continuously advances all rows while nobody requests them. A GET can therefore cause durable deadline/route/completion work.

For active expired modules it closes at the **stored deadline**, grades persisted responses, chooses/installs the next historical pool, and derives the next boundary from that actual time. Expired section breaks start the next module at `break_until`. It repeats for up to 10 transitions, so reconnecting after a long interval may advance several modules or complete the full attempt. Offline edits from a module already closed on the server cannot be replayed into a new one. Even if an old PATCH receives a conflict, fetching the attempt synchronizes it and restores the valid state.

Explicit **continue** may end a break early and start the next module at server `now`. Strict full SAT (`mode === 'full'`) rejects pause with HTTP 409. For other active modes, pause snapshots remaining seconds and sets `paused`; synchronization returns paused attempts without deadline progression. Resume rebases a timed module's deadline to server now plus saved remaining seconds; untimed practice retains no deadline.

A server restart drops in-process queues, not SQL attempts/sessions/results. After restart, requests reconstruct active state and synchronize absolute deadlines; downtime grants no extra strict-test time. Persistence also requires the configured database and upload directory to survive restart/deployment.

## Historical integrity and completed reports

`createAttempt` snapshots the blueprint, all candidate versioned question pools, timing/break settings, and scoring configuration. `installQuestions` creates response rows with a `version_id` when a module becomes active. Consequently a question edit after attempt creation does not change question prose/answers used in the existing pool or its later selected adaptive route. Active API questions are redacted of answers/explanations/rationales and staff/calibration metadata. They are not live views of the newest bank version.

`closeModule` grades against linked version content, writes closed state, and routes/advances atomically. `scoreResult` checks for an existing result, builds a report containing review responses/content and model metadata, inserts `score_results`, updates mistake records, and completes the attempt. `getResult` returns stored JSON. Later scoring configuration changes do not silently recompute an old result; reports from legacy attempts without a scoring-model snapshot fall back to the then-current configuration at initial result creation.

Saved content/report snapshots are historically stable by design, but distinguish them from all metadata: the question head status/public identifier can change, current taxonomy labels may be used by current UI, and external image URL bytes are not copied/versioned inside the SQL snapshot. Deleting/moving upload files or altering remote content can break an otherwise intact historical report.

Completed attempts reject ordinary response writes because active status/module checks fail. Report JSON retains response highlights and attached notes, but the current `Report`/`QuestionReview` UI does not render those annotations/cards; its review modal only explicitly displays the legacy general `response.note`. This is a presentation gap, not lost SQL/report data. Reports do not become editable response sessions. Report page filters, modal selection, and print dialog settings are transient. Both PDF and print controls invoke the browser print flow; saving a PDF is not another database record.

## Learning history and derived state

Bookmarks are durable user/question links; they do not freeze a version by themselves. Error logs retain question/version/attempt references, selected answer, reason, status, retry count, due date, and a stored note field. Completed later attempts for the same question update prior mistake entries (including retries/status/due dates); wrong answers can create a new per-attempt entry. Tutor feedback can also create/update a mistake before an attempt finishes. The journal's `ErrorItem` response does not currently expose the stored journal note field.

`analytics.ts` derives accuracy, timing, domain/skill performance, history, trends, and recommendations from saved report review data. These values can be reconstructed from evidence, although query limits and current taxonomy affect summaries. Due dates are stored scheduling hints, not an automatic adaptive scheduling engine or notification service. See [analytics and learning memory](11-analytics-learning-memory.md).

Imports have another two-phase persistence boundary: parse creates an `import_jobs` preview; manual row image repair updates only that job; confirm validates/rechecks references and creates questions before storing a final report. Uploaded bytes exist before confirmation and can remain if a user cancels. Neither cancelling a repair nor archiving a question deletes those files.

## Failure scenario reference

| Event                       | Expected current behavior / boundary                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Refresh                     | Restore server session and attempt; overlay same-active-module pending edits; presentation aids mostly reset                      |
| Browser closes              | Already saved SQL survives; pending localStorage can recover later; final network delivery is not guaranteed                      |
| Network disconnect          | Loaded player coalesces edits locally; timer continues; no guaranteed offline app boot                                            |
| Network reconnect           | Try pending save then reload; expired modules invalidate stale queue, valid same-module data can replay                           |
| Server restart              | SQL/session/upload durability determines recovery; stored deadlines continue; synchronization runs on subsequent requests         |
| Another same-browser tab    | Cooperative lease blocks editing; explicit takeover reloads shared pending state with Web Lock where supported                    |
| Another device              | No shared browser lease; serialized server writes can overwrite stale same-module responses                                       |
| Deadline expires offline    | Player blocks edits/submission awaits connection; server closes/advances at historical boundaries and rejects stale module writes |
| Bank question edited        | New version/head; existing attempt pools and linked response content retain prior versions                                        |
| Scoring code/config changes | Existing stored result returned as saved; creation-time model snapshot used when finishing a new-format attempt                   |

Implementation is the source of truth. In particular, broad older wording about server “locking” in `docs/architecture.md` must not be interpreted as device exclusivity or expected-revision conflict detection; the actual mechanisms and limits are specified above. `docs/features.md` describes annotation fields persisting through completed reports: storage is implemented, but this must not be read as visible annotation rendering in the current report UI.
