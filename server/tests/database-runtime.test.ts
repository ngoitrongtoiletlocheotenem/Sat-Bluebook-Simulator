import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import { createDatabase, migrate, requireCurrentSchema, SCHEMA_VERSION } from '../db.js';

test('health verifies database connectivity and fails closed without database details', async () => {
  const db = createDatabase(':memory:');
  const app = createApp(db);
  await request(app).get('/api/health').expect(200, { status: 'ok', database: 'connected' });
  await db.destroy();
  const failed = await request(app).get('/api/health').expect(503);
  assert.deepEqual(failed.body, { status: 'unavailable', database: 'disconnected' });
  assert.equal(failed.headers['cache-control'], 'no-store');
});

test('schema readiness is read only and query indexes survive migration reruns', async () => {
  const db = createDatabase(':memory:');
  try {
    await assert.rejects(requireCurrentSchema(db), /out of date/);
    assert.equal(await db.schema.hasTable('schema_migrations'), false);
    await migrate(db);
    await requireCurrentSchema(db);
    const indexes = await db('sqlite_master').where({ type: 'index' }).select('name');
    for (const name of [
      'sessions_user_idx',
      'results_user_created_idx',
      'errors_user_created_idx',
      'attempts_user_started_idx',
      'responses_question_idx',
      'assets_owner_created_idx',
    ])
      assert(
        indexes.some((index) => index.name === name),
        name,
      );
    await migrate(db);
    assert.equal((await db('schema_migrations')).length, SCHEMA_VERSION);
    await db('schema_migrations').insert({
      version: SCHEMA_VERSION + 1,
      applied_at: new Date().toISOString(),
    });
    await assert.rejects(requireCurrentSchema(db), /Verify the release/);
  } finally {
    await db.destroy();
  }
});

test('PostgreSQL configuration is bounded and memory tests remain explicitly SQLite', async () => {
  const names = ['DATABASE_URL', 'PG_POOL_MAX', 'PG_STATEMENT_TIMEOUT_MS'];
  const before = names.map((name) => process.env[name]);
  try {
    process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
    process.env.PG_POOL_MAX = '4';
    process.env.PG_STATEMENT_TIMEOUT_MS = '12000';
    const pg = createDatabase();
    try {
      assert.equal(pg.client.config.pool.max, 4);
      assert.equal(pg.client.config.connection.statement_timeout, 12000);
      assert.equal(pg.client.config.compileSqlOnError, false);
    } finally {
      await pg.destroy();
    }
    process.env.PG_POOL_MAX = '0';
    assert.throws(() => createDatabase(), /PG_POOL_MAX/);
    const sqlite = createDatabase(':memory:');
    try {
      assert.equal(sqlite.client.config.client, 'better-sqlite3');
    } finally {
      await sqlite.destroy();
    }
  } finally {
    names.forEach((name, i) => {
      if (before[i] === undefined) delete process.env[name];
      else process.env[name] = before[i];
    });
  }
});
