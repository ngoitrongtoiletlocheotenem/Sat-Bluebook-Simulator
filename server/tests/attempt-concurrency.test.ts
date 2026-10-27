import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../db.js';
import { seed } from '../seed.js';
import { createUser } from '../auth.js';
import { createAttempt, saveAttempt, finishModule, getAttempt, pauseAttempt } from '../attempts.js';
import { emptyResponse } from '../../shared/types.js';
import { ApiError } from '../validation.js';

test('attempt revisions reject stale answers and transitions, retain deadlines, and roll back partial writes', async () => {
  const db = createDatabase(':memory:');
  try {
    await migrate(db);
    await seed(db);
    const user = await createUser(db, {
      name: 'Concurrency learner',
      email: 'revision@example.test',
      password: 'Strong test password 2026',
    });
    const initial = await createAttempt(db, user, { mode: 'practice', section: 'rw', count: 2 });
    const moduleId = initial.module!.id;
    const qid = initial.module!.questions![0]!.id;
    const input = {
      moduleId,
      expectedRevision: initial.revision,
      responses: { [qid]: { ...emptyResponse(), answer: 'A', note: 'persisted annotation' } },
    };
    const writes = await Promise.allSettled([
      saveAttempt(db, user, initial.id, input),
      saveAttempt(db, user, initial.id, {
        ...input,
        responses: { [qid]: { ...emptyResponse(), answer: 'B' } },
      }),
    ]);
    assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = writes.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'ATTEMPT_REVISION_CONFLICT');
    const saved = await getAttempt(db, user, initial.id);
    assert.equal(saved.responses[qid]!.answer, 'A');
    assert.equal(saved.responses[qid]!.note, 'persisted annotation');
    await assert.rejects(
      pauseAttempt(db, user, initial.id, false, initial.revision),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
    // A valid first response followed by an invalid question must leave neither write behind.
    await assert.rejects(
      saveAttempt(db, user, initial.id, {
        moduleId,
        expectedRevision: saved.revision,
        responses: { [qid]: { ...emptyResponse(), answer: 'B' }, nonexistent: emptyResponse() },
      }),
    );
    assert.equal((await getAttempt(db, user, initial.id)).responses[qid]!.answer, 'A');
    const finishes = await Promise.allSettled([
      finishModule(db, user, initial.id, moduleId, saved.revision),
      finishModule(db, user, initial.id, moduleId, saved.revision),
    ]);
    assert.equal(finishes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      Number(
        (await db('score_results').where({ attempt_id: initial.id }).count({ count: '*' }).first())!.count,
      ),
      1,
    );
    await assert.rejects(
      saveAttempt(db, user, initial.id, input),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
    const pausedInitial = await createAttempt(db, user, { mode: 'practice', section: 'rw', count: 1 });
    const paused = await pauseAttempt(db, user, pausedInitial.id, false, pausedInitial.revision);
    assert(paused.revision > pausedInitial.revision);
    const resumed = await pauseAttempt(db, user, paused.id, true, paused.revision);
    assert(resumed.revision > paused.revision);
    assert.equal(resumed.status, 'active');
    const independent = await createAttempt(db, user, { mode: 'practice', section: 'rw', count: 1 });
    const independentWrites = await Promise.all([
      saveAttempt(db, user, resumed.id, {
        moduleId: resumed.module!.id,
        expectedRevision: resumed.revision,
        responses: {},
      }),
      saveAttempt(db, user, independent.id, {
        moduleId: independent.module!.id,
        expectedRevision: independent.revision,
        responses: {},
      }),
    ]);
    assert.equal(independentWrites.length, 2);
    const timed = await createAttempt(db, user, {
      mode: 'practice',
      section: 'rw',
      count: 1,
      timedSeconds: 30,
    });
    await db('module_attempts')
      .where({ id: timed.module!.id })
      .update({ deadline: new Date(Date.now() - 1000).toISOString() });
    await assert.rejects(
      saveAttempt(db, user, timed.id, {
        moduleId: timed.module!.id,
        expectedRevision: timed.revision,
        responses: {},
      }),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
    // Rejection still commits server-owned expiration and its saved report.
    assert.equal((await db('attempts').where({ id: timed.id }).first()).status, 'completed');
    assert.equal(
      Number(
        (await db('score_results').where({ attempt_id: timed.id }).count({ count: '*' }).first())!.count,
      ),
      1,
    );
  } finally {
    await db.destroy();
  }
});
