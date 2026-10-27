import knex from 'knex';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { migrate } from '../server/db.ts';

// Explicit opt-in, disposable schema. Synthetic measurements are not production
// capacity estimates. This script never uses DATABASE_URL or dotenv.
const url = process.env.PATHWISE_TEST_DATABASE_URL;
if (!url) throw new Error('Set PATHWISE_TEST_DATABASE_URL to an isolated PostgreSQL server');
const schema = `pathwise_profile_${randomUUID().replaceAll('-', '')}`;
const control = knex({ client: 'pg', connection: url });
await control.raw('CREATE SCHEMA ??', [schema]);
const db = knex({ client: 'pg', connection: { connectionString: url, options: `-c search_path=${schema}` } });
try {
  await migrate(db);
  await db.raw(`INSERT INTO users(id,email,name,password_hash,role,created_at)
    SELECT 'synthetic-'||g, 'synthetic-'||g||'@example.test', 'Synthetic learner', 'unused', 'student', '2026-01-01T00:00:00.000Z'
    FROM generate_series(0,9) g`);
  await db.raw(`INSERT INTO attempts(id,user_id,mode,status,seed,snapshot,started_at)
    SELECT 'synthetic-attempt-'||g, 'synthetic-'||(g%10), 'practice', 'completed', 'profile', '{}',
      to_char(timestamp '2026-01-01' + g*interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    FROM generate_series(1,50000) g`);
  await db.raw(`INSERT INTO score_results(attempt_id,user_id,report,created_at)
    SELECT id,user_id,json_build_object('attemptId',id,'title','Synthetic profile only','review',ARRAY[]::text[],'padding',repeat('x',200))::text,started_at FROM attempts`);
  await db.raw('ANALYZE score_results');
  const query = db('score_results')
    .where({ user_id: 'synthetic-1' })
    .orderBy('created_at', 'desc')
    .limit(500)
    .toSQL();
  const explain = async (q = query) =>
    (await db.raw(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`, q.bindings)).rows[0]['QUERY PLAN'][0];
  async function measure(q = query) {
    await explain(q);
    const plans = [];
    for (let i = 0; i < 5; i++) plans.push(await explain(q));
    const times = plans.map((p) => p['Execution Time']).sort((a, b) => a - b);
    return { medianExecutionMs: times[2], executionMs: times, plan: plans[4].Plan };
  }
  await db.raw('DROP INDEX results_user_created_idx');
  await db.schema.alterTable('score_results', (t) => t.index('user_id'));
  const baseline = await measure();
  const baselineIds = (
    await db('score_results').where({ user_id: 'synthetic-1' }).orderBy('created_at', 'desc').limit(500)
  ).map((r) => r.attempt_id);
  const oldSize = Number(
    (await db.raw("SELECT pg_relation_size('score_results_user_id_index') AS bytes")).rows[0].bytes,
  );
  await db.schema.alterTable('score_results', (t) =>
    t.index(['user_id', 'created_at'], 'results_user_created_idx'),
  );
  await db.raw('DROP INDEX score_results_user_id_index');
  const optimized = await measure();
  const optimizedIds = (
    await db('score_results').where({ user_id: 'synthetic-1' }).orderBy('created_at', 'desc').limit(500)
  ).map((r) => r.attempt_id);
  assert.deepEqual(
    optimizedIds,
    baselineIds,
    'Index change must preserve the latest 500 report identities/order',
  );
  assert.equal(optimized.plan['Actual Rows'], 500);
  const nodes = (plan: any): any[] => [plan, ...(plan.Plans || []).flatMap(nodes)];
  assert(
    !nodes(optimized.plan).some((n) => n['Node Type'] === 'Sort'),
    'Composite ordering should remove the explicit sort on this synthetic workload',
  );
  const newSize = Number(
    (await db.raw("SELECT pg_relation_size('results_user_created_idx') AS bytes")).rows[0].bytes,
  );
  await db('domains').insert({
    id: 'profile-domain',
    section: 'math',
    name: 'Synthetic',
    percentage: 100,
    question_range: '1',
    position: 0,
  });
  await db('skills').insert({ id: 'profile-skill', domain_id: 'profile-domain', name: 'Synthetic' });
  await db('questions').insert({
    id: 'profile-question',
    public_id: 'profile-question',
    section: 'math',
    domain_id: 'profile-domain',
    skill_id: 'profile-skill',
    difficulty: 'easy',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  });
  await db('question_versions').insert({
    id: 'profile-version',
    question_id: 'profile-question',
    version: 1,
    content: '{}',
    created_at: '2026-01-01',
  });
  await db.raw(`INSERT INTO module_attempts(id,attempt_id,position,section,route,status,duration_seconds)
    SELECT 'module-'||id,id,0,'math','mixed','active',30 FROM attempts`);
  await db.raw(`INSERT INTO responses(id,attempt_id,module_id,question_id,version_id,position,updated_at)
    SELECT 'response-'||id,id,'module-'||id,'profile-question','profile-version',0,'2026-01-01' FROM attempts`);
  await db.raw('ANALYZE responses');
  await db.raw('ANALYZE question_versions');
  const moduleQuery = db('responses as r')
    .join('question_versions as v', 'v.id', 'r.version_id')
    .where('r.module_id', 'module-synthetic-attempt-25000')
    .select('r.*', 'v.content');
  const moduleBaseline = await measure(moduleQuery.toSQL());
  const moduleOptimizedQuery = moduleQuery.clone().where('r.attempt_id', 'synthetic-attempt-25000');
  const moduleOptimized = await measure(moduleOptimizedQuery.toSQL());
  assert.deepEqual(
    await moduleOptimizedQuery,
    await moduleQuery,
    'Adding the known parent must preserve module responses',
  );
  assert(
    nodes(moduleOptimized.plan).some(
      (n) => n['Relation Name'] === 'responses' && n['Node Type'].includes('Index'),
    ),
    'The parent+module query should use an existing leading-attempt response index',
  );
  const output = {
    generatedAt: new Date().toISOString(),
    postgres: (await db.raw('SHOW server_version')).rows[0].server_version,
    scope:
      'Synthetic 50,000 saved reports, 10 users, 5,000 reports/user; actual history query limit 500. Five warm-cache measured runs after one warmup; no concurrency or network capacity claim.',
    rows: 50000,
    baseline: { ...baseline, indexBytes: oldSize },
    optimized: { ...optimized, indexBytes: newSize },
    moduleResponseLookup: {
      syntheticResponses: 50000,
      baseline: moduleBaseline,
      optimized: moduleOptimized,
      addedIndexes: 0,
    },
    writeTradeoff:
      'The composite replaces the old leading-user index: one index maintained per result insert, with a larger key. No write-throughput claim was measured.',
  };
  await mkdir('.runtime', { recursive: true });
  await writeFile('.runtime/postgres-query-profile.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally {
  await db.destroy();
  await control.raw('DROP SCHEMA ?? CASCADE', [schema]);
  await control.destroy();
}
