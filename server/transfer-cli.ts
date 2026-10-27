import 'dotenv/config';
import knex, { type Knex } from 'knex';
import { openTransferSource, transferDatabase, TransferValidationError } from './database-transfer.js';

const args = process.argv.slice(2);
const filenames = args.filter((arg) => !arg.startsWith('--'));
const filename = filenames[0];
const flags = args.filter((arg) => arg.startsWith('--'));
if (
  !filename ||
  filenames.length !== 1 ||
  flags.some((arg) => !['--apply', '--validate'].includes(arg)) ||
  flags.length > 1 ||
  !process.env.TRANSFER_DATABASE_URL
) {
  console.error(
    'Usage: npm run db:transfer -- <existing-sqlite-file> [--apply | --validate]. Set TRANSFER_DATABASE_URL privately. Default is dry-run.',
  );
  process.exitCode = 1;
} else {
  let source: Knex | undefined;
  let target: Knex | undefined;
  try {
    source = openTransferSource(filename);
    target = knex({
      client: 'pg',
      connection: {
        connectionString: process.env.TRANSFER_DATABASE_URL,
        connectionTimeoutMillis: 5000,
        ...{ lock_timeout: 5000 },
      },
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: 10000,
      compileSqlOnError: false,
    });
    console.log(
      JSON.stringify(
        await transferDatabase(
          source,
          target,
          flags[0] === '--apply' ? 'apply' : flags[0] === '--validate' ? 'validate' : 'dry-run',
        ),
      ),
    );
  } catch (error) {
    // SQL/driver errors can embed parameters and student data. No arbitrary error text.
    console.error(
      error instanceof TransferValidationError
        ? error.message
        : 'Transfer failed; no partial transfer was committed. Check schema, source integrity and target emptiness. See docs/database-transfer.md.',
    );
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([source?.destroy(), target?.destroy()]);
  }
}
