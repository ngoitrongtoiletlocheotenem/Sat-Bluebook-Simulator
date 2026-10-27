import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import knex from 'knex';
import { migrate, SCHEMA_VERSION, json, encode } from '../db.js';
import { seed } from '../seed.js';
import { createAttempt, saveAttempt, finishModule, getAttempt, getResult } from '../attempts.js';
import { emptyResponse, type Attempt, type User } from '../../shared/types.js';
import { updateQuestion, findQuestion } from '../questions.js';
import { errorItems } from '../analytics.js';
import { statistics } from '../statistics.js';

const url = process.env.PATHWISE_TEST_DATABASE_URL;
const indexes = [
  'sessions_user_idx',
  'results_user_created_idx',
  'errors_user_created_idx',
  'attempts_user_started_idx',
  'responses_question_idx',
  'assets_owner_created_idx',
];

test(
  'PostgreSQL isolated schema, history, transactions and cross-process concurrency',
  { skip: !url, timeout: 120_000 },
  async (t) => {
    // Explicit opt-in URL only; a fresh random schema is the sole mutation target.
    // Never read DATABASE_URL or local dotenv configuration in this test.
    const schema = `pathwise_test_${randomUUID().replaceAll('-', '')}`;
    const control = knex({ client: 'pg', connection: url, pool: { min: 0, max: 2 } });
    await control.raw('CREATE SCHEMA ??', [schema]);
    const db = knex({
      client: 'pg',
      connection: { connectionString: url, options: `-c search_path=${schema}` },
      pool: { min: 0, max: 6 },
    });
    const children: ChildProcess[] = [];
    const user: User = {
      id: randomUUID(),
      name: 'Isolated synthetic learner',
      email: 'pg-test@example.test',
      role: 'student',
    };
    async function worker() {
      const child = fork(fileURLToPath(new URL('./postgres-worker.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, PATHWISE_TEST_DATABASE_URL: url, PATHWISE_TEST_SCHEMA: schema },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      children.push(child);
      await message(child, (m) => m.ready);
      return child;
    }
    function message(child: ChildProcess, predicate: (m: any) => boolean = () => true): Promise<any> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('PostgreSQL worker timed out'));
        }, 20_000);
        const onMessage = (m: any) => {
          if (predicate(m)) {
            cleanup();
            resolve(m);
          }
        };
        const onError = (e: Error) => {
          cleanup();
          reject(e);
        };
        const onExit = (code: number | null) => {
          cleanup();
          reject(new Error(`Worker exited before reply (${code})`));
        };
        const cleanup = () => {
          clearTimeout(timer);
          child.off('message', onMessage);
          child.off('error', onError);
          child.off('exit', onExit);
        };
        child.on('message', onMessage);
        child.on('error', onError);
        child.on('exit', onExit);
      });
    }
    async function race(attempt: Attempt, operation: 'save' | 'finish') {
      const a = await worker(),
        b = await worker();
      assert.notEqual(a.pid, b.pid);
      const input = {
        moduleId: attempt.module!.id,
        expectedRevision: attempt.revision,
        responses: { [attempt.module!.questions![0].id]: { ...emptyResponse(), answer: 'A' } },
      };
      const replies = [message(a), message(b)];
      a.send({ operation, id: attempt.id, user, input });
      b.send({ operation, id: attempt.id, user, input });
      return Promise.all(replies);
    }
    try {
      await t.test('fresh creation, idempotent migration, v2 upgrade and existing snapshots', async () => {
        await Promise.all([migrate(db), migrate(db)]);
        await migrate(db);
        assert.equal(
          Number((await db('schema_migrations').max({ v: 'version' }).first())?.v),
          SCHEMA_VERSION,
        );
        await db('users').insert({
          ...{ id: user.id, name: user.name, email: user.email },
          role: user.role,
          password_hash: 'not-used-for-login',
          created_at: new Date().toISOString(),
          profile: encode({ targetScore: 1400, text: 'Unicode π / 日本語' }),
        });
        for (const index of indexes) await db.raw('DROP INDEX ??', [index]);
        for (const [table, column] of [
          ['score_results', 'user_id'],
          ['error_logs', 'user_id'],
          ['attempts', 'user_id'],
          ['question_assets', 'owner_id'],
        ])
          await db.schema.alterTable(table!, (t) => t.index(column!));
        await db('schema_migrations').where({ version: 3 }).delete();
        const before = await db('users').where({ id: user.id }).first();
        await migrate(db);
        await migrate(db);
        assert.deepEqual(await db('users').where({ id: user.id }).first(), before);
        assert.equal(json<any>(before.profile).text, 'Unicode π / 日本語');
        const actual = (
          await db.raw('SELECT indexname FROM pg_indexes WHERE schemaname = ?', [schema])
        ).rows.map((r: any) => r.indexname);
        for (const name of indexes) assert(actual.includes(name), `Missing ${name}`);
        await assert.rejects(
          db('sessions').insert({
            token_hash: 'invalid',
            user_id: 'missing',
            csrf_token: 'test',
            expires_at: '2099-01-01T00:00:00.000Z',
          }),
          (e: any) => e.code === '23503',
        );
        await assert.rejects(
          db('users').insert({ ...before, id: randomUUID() }),
          (e: any) => e.code === '23505',
        );
        await seed(db);
      });
      await t.test(
        'cross-process simultaneous saves allow one revision and reject the stale writer',
        async () => {
          const attempt = await createAttempt(db, user, {
            mode: 'practice',
            section: 'rw',
            count: 2,
            seed: 'pg-save',
          });
          const replies = await race(attempt, 'save');
          assert.equal(replies.filter((r) => r.ok).length, 1);
          assert.equal(replies.find((r) => !r.ok).status, 409);
          assert.equal(replies.find((r) => !r.ok).code, 'ATTEMPT_REVISION_CONFLICT');
          assert.equal((await getAttempt(db, user, attempt.id)).revision, attempt.revision + 1);
          await assert.rejects(
            saveAttempt(db, user, attempt.id, {
              moduleId: attempt.module!.id,
              expectedRevision: attempt.revision,
            }),
            (e: any) => e.status === 409,
          );
        },
      );
      await t.test(
        'annotations, timing, original question version, report and duplicate finish',
        async () => {
          let attempt = await createAttempt(db, user, {
            mode: 'practice',
            section: 'rw',
            count: 2,
            seed: 'pg-history',
          });
          const question = attempt.module!.questions![0];
          const old = await findQuestion(db, { ...user, role: 'admin' }, question.id);
          await updateQuestion(db, { ...user, role: 'admin' }, question.id, {
            ...old.question,
            stem: `${old.question.stem}<p>New current version</p>`,
          });
          assert.equal((await getAttempt(db, user, attempt.id)).module!.questions![0].stem, question.stem);
          await db('module_attempts')
            .where({ id: attempt.module!.id })
            .update({ started_at: new Date(Date.now() - 3000).toISOString() });
          attempt = await saveAttempt(db, user, attempt.id, {
            moduleId: attempt.module!.id,
            expectedRevision: attempt.revision,
            responses: {
              [question.id]: {
                ...emptyResponse(),
                answer: 'A',
                marked: true,
                eliminated: ['B'],
                elapsedMs: 1200,
                note: 'π historical note',
                highlights: [
                  {
                    id: 'pg-h',
                    field: 'stem',
                    start: 0,
                    end: 1,
                    text: question.stem.slice(0, 1),
                    note: 'attached',
                    noteAttached: true,
                  },
                ],
              },
            },
          });
          const replies = await race(attempt, 'finish');
          assert.equal(replies.filter((r) => r.ok).length, 1);
          assert.equal(replies.find((r) => !r.ok).status, 409);
          const report = await getResult(db, user, attempt.id);
          const review = report.review.find((r) => r.question.id === question.id)!;
          assert.equal(review.question.stem, question.stem);
          assert.equal(review.question.version, question.version);
          assert.equal(review.response.note, 'π historical note');
          assert.equal(review.response.elapsedMs, 1200);
          assert.equal(review.response.highlights[0].note, 'attached');
          assert.equal(review.response.marked, true);
          const raw = (await db('score_results').where({ attempt_id: attempt.id }).first()).report;
          await getResult(db, user, attempt.id);
          assert.equal((await db('score_results').where({ attempt_id: attempt.id }).first()).report, raw);
          assert.equal(
            Number(
              (await db('score_results').where({ attempt_id: attempt.id }).count({ n: '*' }).first())?.n,
            ),
            1,
          );
          await assert.rejects(
            saveAttempt(db, user, attempt.id, {
              moduleId: attempt.module!.id,
              expectedRevision: (await getAttempt(db, user, attempt.id)).revision,
              responses: {},
            }),
            (e: any) => e.status === 409,
          );
          const completed = await getAttempt(db, user, attempt.id);
          assert.equal(
            (await finishModule(db, user, completed.id, attempt.module!.id, completed.revision)).status,
            'completed',
          );
          const queries: string[] = [];
          const listener = (q: any) => queries.push(q.sql);
          db.on('query', listener);
          const journal = await errorItems(db, user);
          db.off('query', listener);
          assert(journal.total >= 1);
          assert(queries.length <= 3, `Journal issued ${queries.length} queries`);
          const stats = await statistics(db);
          assert.equal(stats.students[0].completedAttempts, 1);
        },
      );
      await t.test('forced report failure rolls grading, result, mistakes and revision back', async () => {
        const attempt = await createAttempt(db, user, {
          mode: 'practice',
          section: 'math',
          count: 2,
          seed: 'pg-rollback',
        });
        await db.raw(
          `CREATE FUNCTION fail_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected report failure'; END $$`,
        );
        await db.raw(
          'CREATE TRIGGER fail_report BEFORE INSERT ON score_results FOR EACH ROW EXECUTE FUNCTION fail_report()',
        );
        const before = await db('attempts').where({ id: attempt.id }).first();
        await assert.rejects(
          finishModule(db, user, attempt.id, attempt.module!.id, attempt.revision),
          /injected report failure/,
        );
        assert.deepEqual(await db('attempts').where({ id: attempt.id }).first(), before);
        assert.equal(
          (await db('module_attempts').where({ id: attempt.module!.id }).first()).status,
          'active',
        );
        assert((await db('responses').where({ attempt_id: attempt.id })).every((r) => r.correct === null));
        assert.equal(
          Number((await db('error_logs').where({ attempt_id: attempt.id }).count({ n: '*' }).first())?.n),
          0,
        );
        await db.raw('DROP TRIGGER fail_report ON score_results');
        await db.raw('DROP FUNCTION fail_report()');
        assert.equal(
          (await finishModule(db, user, attempt.id, attempt.module!.id, attempt.revision)).status,
          'completed',
        );
      });
      await t.test(
        'expired writes persist authoritative completion and reject stale client work',
        async () => {
          const attempt = await createAttempt(db, user, {
            mode: 'practice',
            section: 'math',
            count: 1,
            timedSeconds: 30,
          });
          await db('module_attempts')
            .where({ id: attempt.module!.id })
            .update({ deadline: new Date(Date.now() - 1000).toISOString() });
          await assert.rejects(
            saveAttempt(db, user, attempt.id, {
              moduleId: attempt.module!.id,
              expectedRevision: attempt.revision,
              responses: { [attempt.module!.questions![0].id]: { ...emptyResponse(), answer: 'late' } },
            }),
            (e: any) => e.status === 409,
          );
          assert.equal((await db('attempts').where({ id: attempt.id }).first()).status, 'completed');
          assert.equal((await db('responses').where({ attempt_id: attempt.id }).first()).answer, '');
        },
      );
      await t.test('a locked attempt does not block a separate attempt across processes', async () => {
        const a = await createAttempt(db, user, { mode: 'practice', section: 'rw', count: 1 });
        const b = await createAttempt(db, user, { mode: 'practice', section: 'math', count: 1 });
        const holder = await worker();
        const locked = message(holder, (m) => m.locked);
        holder.send({ operation: 'hold', id: a.id, user });
        await locked;
        const writer = await worker();
        const saved = message(writer);
        writer.send({
          operation: 'save',
          id: b.id,
          user,
          input: { moduleId: b.module!.id, expectedRevision: b.revision },
        });
        assert.equal((await saved).ok, true);
        const released = message(holder, (m) => m.ok);
        holder.send({ release: true });
        await released;
      });
      await t.test(
        'opposite-order completions on shared questions retain mistake retries without deadlock',
        async () => {
          const initial = await createAttempt(db, user, {
            mode: 'practice',
            section: 'math',
            count: 2,
            seed: 'shared-errors',
          });
          const questionIds = initial.module!.questions!.map((q) => q.id);
          await finishModule(db, user, initial.id, initial.module!.id, initial.revision);
          const before = await db('error_logs').where({ attempt_id: initial.id });
          assert.equal(before.length, 2);
          const a = await createAttempt(db, user, {
            mode: 'practice',
            questionIds,
            count: 2,
            seed: 'shared-a',
          });
          const b = await createAttempt(db, user, {
            mode: 'practice',
            questionIds: [...questionIds].reverse(),
            count: 2,
            seed: 'shared-b',
          });
          for (const [index, id] of questionIds.entries()) {
            await db('responses').where({ attempt_id: a.id, question_id: id }).update({ position: index });
            await db('responses')
              .where({ attempt_id: b.id, question_id: id })
              .update({ position: 1 - index });
          }
          const first = await worker(),
            second = await worker();
          const replies = [message(first), message(second)];
          first.send({
            operation: 'finish',
            id: a.id,
            user,
            input: { moduleId: a.module!.id, expectedRevision: a.revision },
          });
          second.send({
            operation: 'finish',
            id: b.id,
            user,
            input: { moduleId: b.module!.id, expectedRevision: b.revision },
          });
          assert(
            (await Promise.all(replies)).every((r) => r.ok),
            'Both distinct attempts should finish',
          );
          const after = await db('error_logs').where({ attempt_id: initial.id });
          for (const error of after)
            assert.equal(error.retries, before.find((e) => e.id === error.id)!.retries + 2);
          assert.equal(
            Number(
              (await db('score_results').whereIn('attempt_id', [a.id, b.id]).count({ n: '*' }).first())?.n,
            ),
            2,
          );
        },
      );
      await t.test('full adaptive transition and completion preserve one saved report', async () => {
        let attempt = await createAttempt(db, user, { mode: 'full', breakSeconds: 0, seed: 'pg-full' });
        while (attempt.status !== 'completed') {
          const prior = attempt;
          attempt = await finishModule(db, user, attempt.id, attempt.module!.id, attempt.revision);
          if (prior.module!.index === 1 && prior.module!.section === 'rw')
            assert.equal(attempt.module!.route, 'lower');
        }
        const result = await getResult(db, user, attempt.id);
        assert.equal(result.total, 98);
        assert.equal(
          Number((await db('score_results').where({ attempt_id: attempt.id }).count({ n: '*' }).first())?.n),
          1,
        );
      });
    } finally {
      for (const child of children) if (child.connected) child.kill();
      await db.destroy();
      await control.raw('DROP SCHEMA ?? CASCADE', [schema]);
      await control.destroy();
    }
  },
);
