import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import knex from 'knex';
import { migrate } from '../db.js';

test(
  'production startup requires explicit migrations and never seeds or bootstraps accounts',
  { timeout: 30_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pathwise-startup-'));
    const filename = join(directory, 'startup.sqlite');
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      pool: { min: 0, max: 1 },
    });
    const environment = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: '',
      SQLITE_PATH: filename,
      UPLOAD_DIR: join(directory, 'uploads'),
      HOST: '127.0.0.1',
      PORT: '0',
      SEED_SAMPLE_DATA: 'true',
      ADMIN_EMAIL: 'never-created@example.test',
      ADMIN_PASSWORD: 'Synthetic startup test password 2026',
    };
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const missing = spawnSync(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /Database startup failed/);
      assert.equal(await db.schema.hasTable('schema_migrations'), false);
      await migrate(db);
      const listener = net.createServer();
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', resolve);
      });
      const port = (listener.address() as net.AddressInfo).port;
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        env: { ...environment, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Isolated startup timed out')), 10_000);
        child!.stdout!.on('data', (data: Buffer) => {
          if (data.toString().includes('listening on port')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child!.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Isolated startup exited unexpectedly'));
        });
        child!.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
      assert.equal(Number((await db('questions').count({ n: '*' }).first())!.n), 0);
      assert.equal(Number((await db('users').count({ n: '*' }).first())!.n), 0);
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
        child.kill();
        await exited;
      }
      await db.destroy();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('invalid PostgreSQL configuration never prints a connection URL at startup', { timeout: 15_000 }, () => {
  const secret = 'private-configuration-sentinel';
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: `postgres://${secret}@[invalid`,
      PG_CONNECT_TIMEOUT_MS: '100',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert(!`${result.stdout}${result.stderr}`.includes(secret));
  assert.match(result.stderr, /Database startup failed/);
});
