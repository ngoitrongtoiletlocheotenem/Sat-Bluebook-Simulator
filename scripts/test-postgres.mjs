import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (!process.env.PATHWISE_TEST_DATABASE_URL) {
  console.error(
    'Set PATHWISE_TEST_DATABASE_URL to an isolated test PostgreSQL database. No application DATABASE_URL fallback is used.',
  );
  process.exitCode = 1;
} else {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('tsx/package.json');
  const manifest = require(manifestPath);
  const result = spawnSync(
    process.execPath,
    [
      join(dirname(manifestPath), manifest.bin),
      '--test',
      'server/tests/postgres.test.ts',
      'server/tests/database-transfer.test.ts',
      'server/tests/statistics.test.ts',
    ],
    { stdio: 'inherit', env: process.env },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
