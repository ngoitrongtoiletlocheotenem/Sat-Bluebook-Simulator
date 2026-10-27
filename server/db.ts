import knex, { type Knex } from 'knex';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const SCHEMA_VERSION = 3;

function integerSetting(name: string, fallback: number, min: number, max: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

export function createDatabase(filename = process.env.SQLITE_PATH || './data/sat.sqlite'): Knex {
  if (process.env.DATABASE_URL && filename !== ':memory:') {
    return knex({
      client: 'pg',
      connection: {
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: integerSetting('PG_CONNECT_TIMEOUT_MS', 5000, 100, 120000),
        statement_timeout: integerSetting('PG_STATEMENT_TIMEOUT_MS', 30000, 100, 600000),
        // pg supports this startup setting; Knex's connection interface omits it.
        ...{ lock_timeout: integerSetting('PG_LOCK_TIMEOUT_MS', 5000, 100, 120000) },
        idle_in_transaction_session_timeout: integerSetting(
          'PG_IDLE_TRANSACTION_TIMEOUT_MS',
          30000,
          1000,
          600000,
        ),
        application_name: 'pathwise',
      },
      acquireConnectionTimeout: integerSetting('PG_ACQUIRE_TIMEOUT_MS', 10000, 100, 120000),
      pool: {
        min: 0,
        max: integerSetting('PG_POOL_MAX', 10, 1, 100),
        idleTimeoutMillis: integerSetting('PG_IDLE_TIMEOUT_MS', 30000, 1000, 600000),
      },
      compileSqlOnError: false,
    });
  }
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  return knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(connection: any, done: any) {
        connection.pragma('foreign_keys = ON');
        connection.pragma('journal_mode = WAL');
        done(null, connection);
      },
    },
  });
}

export const json = <T = any>(value: string | T): T =>
  typeof value === 'string' ? JSON.parse(value) : value;
export const now = () => new Date().toISOString();
export const encode = (value: unknown) => JSON.stringify(value);

export async function requireCurrentSchema(db: Knex) {
  const versions = (await db.schema.hasTable('schema_migrations'))
    ? (await db('schema_migrations').orderBy('version').select('version')).map((row) => Number(row.version))
    : [];
  if (versions.length !== SCHEMA_VERSION || versions.some((version, i) => version !== i + 1))
    throw new Error(
      'Database schema is out of date. Verify the release and run its one-shot migration command before starting the application.',
    );
}

// Portable, versioned migrations. JSON lives in text columns so that the
// same schema and immutable snapshots work in SQLite and PostgreSQL.
export async function migrate(db: Knex) {
  if (db.client.config.client === 'pg') {
    // Serialize explicit migrators across processes, including first ledger creation.
    // All DDL remains transactional; the lock is released on commit or rollback.
    await db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(734812, 1)');
      await applyMigrations(trx);
    });
  } else await applyMigrations(db);
}

async function applyMigrations(db: Knex) {
  if (!(await db.schema.hasTable('schema_migrations'))) {
    await db.schema.createTable('schema_migrations', (t) => {
      t.integer('version').primary();
      t.string('applied_at').notNullable();
    });
  }
  if (!(await db('schema_migrations').where({ version: 1 }).first())) {
    await db.transaction(async (trx) => {
      await trx.schema.createTable('users', (t) => {
        t.string('id').primary();
        t.string('email').notNullable().unique();
        t.string('name').notNullable();
        t.string('password_hash').notNullable();
        t.string('role').notNullable().defaultTo('student');
        t.string('created_at').notNullable();
        t.text('profile').notNullable().defaultTo('{}');
      });
      await trx.schema.createTable('sessions', (t) => {
        t.string('token_hash').primary();
        t.string('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.string('csrf_token').notNullable();
        t.string('expires_at').notNullable().index();
      });
      await trx.schema.createTable('domains', (t) => {
        t.string('id').primary();
        t.string('section').notNullable().index();
        t.string('name').notNullable();
        t.integer('percentage').notNullable();
        t.string('question_range').notNullable();
        t.integer('position').notNullable();
      });
      await trx.schema.createTable('skills', (t) => {
        t.string('id').primary();
        t.string('domain_id').notNullable().references('domains.id');
        t.string('name').notNullable();
      });
      await trx.schema.createTable('questions', (t) => {
        t.string('id').primary();
        t.string('public_id').notNullable().unique();
        t.string('section').notNullable().index();
        t.string('domain_id').notNullable().references('domains.id').index();
        t.string('skill_id').notNullable().references('skills.id').index();
        t.string('difficulty').notNullable().index();
        t.string('status').notNullable().defaultTo('published').index();
        t.string('owner_id').nullable().references('users.id');
        t.integer('version').notNullable().defaultTo(1);
        t.integer('usage_count').notNullable().defaultTo(0);
        t.string('created_at').notNullable();
        t.string('updated_at').notNullable();
      });
      await trx.schema.createTable('question_versions', (t) => {
        t.string('id').primary();
        t.string('question_id').notNullable().references('questions.id').index();
        t.integer('version').notNullable();
        t.text('content').notNullable();
        t.string('created_at').notNullable();
        t.unique(['question_id', 'version']);
      });
      await trx.schema.createTable('blueprints', (t) => {
        t.string('id').primary();
        t.string('name').notNullable();
        t.string('owner_id').nullable().references('users.id');
        t.boolean('published').notNullable().defaultTo(false);
        t.integer('version').notNullable().defaultTo(1);
        t.text('config').notNullable();
        t.string('created_at').notNullable();
        t.string('updated_at').notNullable();
      });
      await trx.schema.createTable('attempts', (t) => {
        t.string('id').primary();
        t.string('user_id').notNullable().references('users.id').index();
        t.string('blueprint_id').nullable().references('blueprints.id');
        t.string('mode').notNullable();
        t.string('status').notNullable().index();
        t.string('seed').notNullable();
        t.text('snapshot').notNullable();
        t.integer('active_module').notNullable().defaultTo(0);
        t.integer('current_question').notNullable().defaultTo(0);
        t.string('started_at').notNullable();
        t.string('completed_at').nullable();
        t.string('break_until').nullable();
        t.string('paused_at').nullable();
        t.integer('revision').notNullable().defaultTo(0);
      });
      await trx.schema.createTable('module_attempts', (t) => {
        t.string('id').primary();
        t.string('attempt_id').notNullable().references('attempts.id').onDelete('CASCADE').index();
        t.integer('position').notNullable();
        t.string('section').notNullable();
        t.string('route').notNullable();
        t.string('status').notNullable();
        t.integer('duration_seconds').notNullable();
        t.string('started_at').nullable();
        t.string('deadline').nullable();
        t.string('closed_at').nullable();
        t.text('routing_result').nullable();
        t.unique(['attempt_id', 'position']);
      });
      await trx.schema.createTable('responses', (t) => {
        t.string('id').primary();
        t.string('attempt_id').notNullable().references('attempts.id').onDelete('CASCADE').index();
        t.string('module_id').notNullable().references('module_attempts.id');
        t.string('question_id').notNullable().references('questions.id');
        t.string('version_id').notNullable().references('question_versions.id');
        t.integer('position').notNullable();
        t.text('answer').notNullable().defaultTo('');
        t.boolean('marked').notNullable().defaultTo(false);
        t.text('eliminated').notNullable().defaultTo('[]');
        t.text('highlights').notNullable().defaultTo('[]');
        t.text('notes').notNullable().defaultTo('[]');
        t.integer('time_spent_ms').notNullable().defaultTo(0);
        t.boolean('correct').nullable();
        t.string('updated_at').notNullable();
        t.unique(['attempt_id', 'module_id', 'question_id']);
      });
      await trx.schema.createTable('score_results', (t) => {
        t.string('attempt_id').primary().references('attempts.id').onDelete('CASCADE');
        t.string('user_id').notNullable().references('users.id').index();
        t.text('report').notNullable();
        t.string('created_at').notNullable();
      });
      await trx.schema.createTable('bookmarks', (t) => {
        t.string('id').primary();
        t.string('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.string('question_id').notNullable().references('questions.id');
        t.string('created_at').notNullable();
        t.unique(['user_id', 'question_id']);
      });
      await trx.schema.createTable('error_logs', (t) => {
        t.string('id').primary();
        t.string('user_id').notNullable().references('users.id').index();
        t.string('question_id').notNullable().references('questions.id');
        t.string('version_id').notNullable().references('question_versions.id');
        t.string('attempt_id').notNullable().references('attempts.id');
        t.text('selected_answer').notNullable();
        t.string('reason').nullable();
        t.string('status').notNullable().defaultTo('new');
        t.integer('retries').notNullable().defaultTo(0);
        t.text('note').notNullable().defaultTo('');
        t.string('due_at').notNullable();
        t.string('created_at').notNullable();
        t.string('updated_at').notNullable();
        t.unique(['user_id', 'attempt_id', 'question_id']);
      });
      await trx.schema.createTable('import_jobs', (t) => {
        t.string('id').primary();
        t.string('user_id').notNullable().references('users.id');
        t.string('status').notNullable();
        t.text('preview').notNullable();
        t.text('report').nullable();
        t.string('created_at').notNullable();
      });
      await trx('schema_migrations').insert({ version: 1, applied_at: now() });
    });
  }
  if (!(await db('schema_migrations').where({ version: 2 }).first())) {
    await db.transaction(async (trx) => {
      await trx.schema.createTable('question_assets', (t) => {
        t.string('id').primary();
        t.string('owner_id').notNullable().references('users.id').onDelete('CASCADE').index();
        t.string('name', 255).notNullable();
        t.string('url').notNullable().unique();
        t.integer('size').notNullable();
        t.string('mime_type').notNullable();
        t.string('created_at').notNullable();
      });
      await trx('schema_migrations').insert({ version: 2, applied_at: now() });
    });
  }
  if (!(await db('schema_migrations').where({ version: 3 }).first())) {
    await db.transaction(async (trx) => {
      // Actual leading predicates/orderings in auth, analytics, statistics and assets.
      for (const [table, columns, name] of [
        ['sessions', ['user_id'], 'sessions_user_idx'],
        ['score_results', ['user_id', 'created_at'], 'results_user_created_idx'],
        ['error_logs', ['user_id', 'created_at'], 'errors_user_created_idx'],
        ['attempts', ['user_id', 'started_at'], 'attempts_user_started_idx'],
        ['responses', ['question_id'], 'responses_question_idx'],
        ['question_assets', ['owner_id', 'created_at'], 'assets_owner_created_idx'],
      ] as const) {
        await trx.schema.alterTable(table, (t) => t.index([...columns], name));
      }
      // Composite indexes retain these leading-key lookups without duplicate writes.
      for (const [table, column] of [
        ['score_results', 'user_id'],
        ['error_logs', 'user_id'],
        ['attempts', 'user_id'],
        ['question_assets', 'owner_id'],
      ])
        await trx.schema.alterTable(table, (t) => t.dropIndex([column]));
      await trx('schema_migrations').insert({ version: 3, applied_at: now() });
    });
  }
}
