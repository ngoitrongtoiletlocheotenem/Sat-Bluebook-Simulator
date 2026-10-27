import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knex from 'knex';
import { migrate, createDatabase } from '../db.js';
import { seed } from '../seed.js';
import { openTransferSource, transferDatabase, transferTables } from '../database-transfer.js';
import { createAttempt, saveAttempt, finishModule } from '../attempts.js';
import { emptyResponse, type User } from '../../shared/types.js';

const url = process.env.PATHWISE_TEST_DATABASE_URL;
test(
  'SQLite transfer validates, preserves snapshots, rolls back and refuses overwrites',
  { skip: !url, timeout: 60_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pathwise-transfer-'));
    const filename = join(directory, 'source.sqlite');
    const schema = `pathwise_transfer_${randomUUID().replaceAll('-', '')}`;
    const control = knex({
      client: 'pg',
      connection: url,
      pool: { min: 0, max: 1 },
      compileSqlOnError: false,
    });
    await control.raw('CREATE SCHEMA ??', [schema]);
    const target = knex({
      client: 'pg',
      connection: { connectionString: url, options: `-c search_path=${schema}` },
      pool: { min: 0, max: 2 },
      compileSqlOnError: false,
    });
    // Explicit SQLite config cannot inherit a user's DATABASE_URL.
    const source = knex({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      pool: { min: 0, max: 1 },
    });
    let readonly: ReturnType<typeof openTransferSource> | undefined;
    try {
      await migrate(source);
      await migrate(target);
      await seed(source);
      const user: User = {
        id: randomUUID(),
        name: 'Transfer learner',
        email: 'transfer@example.test',
        role: 'student',
      };
      await source('users').insert({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        password_hash: 'synthetic',
        created_at: '2026-01-02T03:04:05.678Z',
        profile: '{"note":"é exact"}',
      });
      let attempt = await createAttempt(source, user, {
        mode: 'practice',
        count: 1,
        section: 'math',
        seed: 'transfer',
      });
      const question = attempt.module!.questions![0]!;
      attempt = await saveAttempt(source, user, attempt.id, {
        moduleId: attempt.module!.id,
        expectedRevision: attempt.revision,
        responses: {
          [question.id]: { ...emptyResponse(), answer: 'A', marked: true, note: 'preserve notes' },
        },
      });
      await finishModule(source, user, attempt.id, attempt.module!.id, attempt.revision);
      const report = (await source('score_results').first()).report;
      await source('question_assets').insert({
        id: randomUUID(),
        owner_id: user.id,
        name: 'Original image',
        url: '/uploads/synthetic.png',
        size: 8,
        mime_type: 'image/png',
        created_at: '2026-01-02T03:04:05.678Z',
      });
      readonly = openTransferSource(filename);
      const dry = await transferDatabase(readonly, target);
      assert.equal(dry.mode, 'dry-run');
      assert.equal(dry.counts.score_results, 1);
      assert.equal(Number((await target('users').count({ n: '*' }).first())!.n), 0);
      // Simulate a legacy inconsistent source, rather than failing in SQLite's
      // own enforcement before the transfer preflight can inspect it.
      await source.raw('PRAGMA foreign_keys = OFF');
      await source('sessions').insert({
        token_hash: 'orphan',
        user_id: 'missing',
        csrf_token: 'synthetic',
        expires_at: '2099-01-01T00:00:00.000Z',
      });
      await assert.rejects(transferDatabase(readonly, target), /foreign-key validation/);
      await source('sessions').where({ token_hash: 'orphan' }).delete();
      await source.raw('PRAGMA foreign_keys = ON');
      await source('users').where({ id: user.id }).update({ profile: 'invalid JSON' });
      await assert.rejects(transferDatabase(readonly, target), /Invalid JSON/);
      await source('users')
        .where({ id: user.id })
        .update({ profile: '{"note":"é exact"}', name: 'x'.repeat(256) });
      await assert.rejects(transferDatabase(readonly, target), /PostgreSQL limit/);
      await source('users').where({ id: user.id }).update({ name: user.name });
      // Force a late table failure to prove earlier inserted history is rolled back.
      await target.raw(
        `CREATE FUNCTION reject_transfer_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`,
      );
      await target.raw(
        'CREATE TRIGGER reject_asset BEFORE INSERT ON question_assets FOR EACH ROW EXECUTE FUNCTION reject_transfer_asset()',
      );
      await assert.rejects(transferDatabase(readonly, target, 'apply'));
      assert.equal(Number((await target('users').count({ n: '*' }).first())!.n), 0);
      await target.raw('DROP TRIGGER reject_asset ON question_assets');
      const copied = await transferDatabase(readonly, target, 'apply');
      assert.equal(copied.counts.question_assets, 1);
      assert.equal((await target('score_results').first()).report, report);
      assert.equal((await target('responses').first()).marked, true);
      assert.equal((await target('users').first()).created_at, '2026-01-02T03:04:05.678Z');
      for (const table of transferTables)
        assert.equal(
          Number((await target(table).count({ n: '*' }).first())!.n),
          Number((await source(table).count({ n: '*' }).first())!.n),
          table,
        );
      await transferDatabase(readonly, target, 'validate');
      await assert.rejects(transferDatabase(readonly, target, 'apply'), /not empty/);
      await target('responses').update({ notes: '[]' });
      await assert.rejects(transferDatabase(readonly, target, 'validate'), /Content verification/);
      await assert.rejects(readonly('users').update({ name: 'should fail' }), /readonly/);
    } finally {
      await readonly?.destroy();
      await source.destroy();
      await target.destroy();
      await control.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
      await control.destroy();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('transfer source requires a persistent file and memory test mode stays SQLite', async () => {
  assert.throws(() => openTransferSource(':memory:'), /existing SQLite file/);
  const memory = createDatabase(':memory:');
  try {
    assert.equal(memory.client.config.client, 'better-sqlite3');
  } finally {
    await memory.destroy();
  }
});
