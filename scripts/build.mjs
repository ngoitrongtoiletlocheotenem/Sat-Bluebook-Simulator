import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Runtime may use development cookies for local HTTP. Build artifacts always
// use production React, independently of that runtime .env configuration.
const require = createRequire(import.meta.url);
for (const [name, executable, args] of [
  ['typescript', 'tsc', ['--noEmit']],
  ['vite', 'vite', ['build']],
  ['tsup', 'tsup', ['server/index.ts', '--format', 'esm', '--platform', 'node', '--out-dir', 'dist-server', '--external', 'better-sqlite3', '--external', 'pg', '--external', 'knex', '--external', 'exceljs']],
]) {
  const file = require.resolve(`${name}/package.json`);
  const manifest = require(file);
  const binary = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[executable];
  const result = spawnSync(process.execPath, [join(dirname(file), binary), ...args], {
    stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
