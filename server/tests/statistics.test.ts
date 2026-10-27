import test from 'node:test';
import assert from 'node:assert/strict';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate, encode } from '../db.js';
import { statistics } from '../statistics.js';

async function verifyBatchedStatistics(db: Knex) {
  await migrate(db);
  const timestamp = '2026-01-01T00:00:00.000Z';
  await db('users').insert(
    ['a', 'b', 'staff'].map((id) => ({
      id,
      email: `${id}@example.test`,
      name: id,
      password_hash: 'not-for-login',
      role: id === 'staff' ? 'teacher' : 'student',
      created_at: timestamp,
    })),
  );
  const attempts = [],
    reports = [];
  for (let i = 0; i < 605; i++) {
    const id = `batch-${String(i).padStart(4, '0')}`,
      userId = i < 603 ? 'a' : i === 603 ? 'b' : 'staff';
    // Latest scored rows lie in different PK pages and share a completion date.
    // A newer unscored report must not replace the latest available total score.
    const createdAt =
      i === 0 || i === 600 ? '2030-01-01T00:00:00.000Z' : i === 602 ? '2031-01-01T00:00:00.000Z' : timestamp;
    const totalScore = i === 0 ? 1400 : i === 600 ? 1600 : i === 10 ? 1500 : null;
    attempts.push({
      id,
      user_id: userId,
      mode: i % 2 ? 'practice' : 'full',
      status: 'completed',
      seed: 'synthetic-pagination',
      snapshot: '{}',
      started_at: timestamp,
    });
    reports.push({
      attempt_id: id,
      user_id: userId,
      created_at: createdAt,
      report: encode({
        total: i < 603 ? 2 : i === 603 ? 4 : 5,
        correct: i < 603 ? i % 3 : i === 603 ? 3 : 4,
        totalScore,
        review: [{ historicalPayload: 'x'.repeat(1024) }],
      }),
    });
  }
  for (let offset = 0; offset < attempts.length; offset += 50) {
    await db('attempts').insert(attempts.slice(offset, offset + 50));
    await db('score_results').insert(reports.slice(offset, offset + 50));
  }
  const reportBatches: number[] = [],
    queries: string[] = [];
  const onQuery = (q: any) => queries.push(q.sql);
  const onResponse = (rows: any, q: any) => {
    if (q.sql.includes('score_results') && q.sql.includes('report') && Array.isArray(rows))
      reportBatches.push(rows.length);
  };
  db.on('query', onQuery);
  db.on('query-response', onResponse);
  let result;
  try {
    result = await statistics(db);
  } finally {
    db.off('query', onQuery);
    db.off('query-response', onResponse);
  }
  assert.deepEqual(reportBatches, [250, 250, 105]);
  const reportQueries = queries.filter((q) => q.includes('score_results') && q.includes('report'));
  assert(reportQueries.every((q) => !/offset/i.test(q)));
  assert(reportQueries.slice(1).every((q) => q.includes('>')));
  assert.equal(result.summary.students, 2);
  assert.equal(result.summary.attempts, 605);
  assert.equal(result.summary.completedAttempts, 605);
  assert.equal(result.summary.questionsAnswered, 1215);
  assert.equal(result.summary.accuracy, 610 / 1215);
  const student = result.students.find((s) => s.id === 'a')!;
  assert.equal(student.attempts, 603);
  assert.equal(student.completedAttempts, 603);
  assert.equal(student.fullAttempts, 302);
  assert.equal(student.practiceAttempts, 301);
  assert.equal(student.questionsAnswered, 1206);
  assert.equal(student.accuracy, 0.5);
  assert.equal(student.latestScore, 1600);
  assert.equal(result.students.find((s) => s.id === 'b')!.latestScore, null);
}

test('SQLite statistics aggregates every keyset page with bounded report reads and latest scored date', async () => {
  const db = createDatabase(':memory:');
  try {
    await verifyBatchedStatistics(db);
  } finally {
    await db.destroy();
  }
});

test(
  'PostgreSQL statistics preserves totals and latest score across bounded PK pages',
  { skip: !process.env.PATHWISE_TEST_DATABASE_URL },
  async () => {
    const url = process.env.PATHWISE_TEST_DATABASE_URL!;
    const schema = `pathwise_stats_${randomUUID().replaceAll('-', '')}`;
    const control = knex({ client: 'pg', connection: url });
    await control.raw('CREATE SCHEMA ??', [schema]);
    const db = knex({
      client: 'pg',
      connection: { connectionString: url, options: `-c search_path=${schema}` },
    });
    try {
      await verifyBatchedStatistics(db);
    } finally {
      await db.destroy();
      await control.raw('DROP SCHEMA ?? CASCADE', [schema]);
      await control.destroy();
    }
  },
);
