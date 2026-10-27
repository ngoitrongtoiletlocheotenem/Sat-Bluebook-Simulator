import knex from 'knex';
import { saveAttempt, finishModule } from '../attempts.js';
import { withAttemptLock } from '../attempt-lock.js';

// This file deliberately runs in a separate Node process: no parent Promise
// queue or Knex pool is shared with another participant.
const db = knex({
  client: 'pg',
  connection: {
    connectionString: process.env.PATHWISE_TEST_DATABASE_URL,
    options: `-c search_path=${process.env.PATHWISE_TEST_SCHEMA}`,
  },
  pool: { min: 0, max: 2 },
});
process.send?.({ ready: true, pid: process.pid });
process.once('message', async (message: any) => {
  try {
    const { user, id, input, operation } = message;
    let value;
    if (operation === 'hold') {
      value = await withAttemptLock(db, user, id, async () => {
        process.send?.({ locked: true });
        await new Promise<void>((resolve) => process.once('message', () => resolve()));
        return { released: true };
      });
    } else if (operation === 'finish') {
      value = await finishModule(db, user, id, input.moduleId, input.expectedRevision);
    } else {
      value = await saveAttempt(db, user, id, input);
    }
    process.send?.({ ok: true, value });
  } catch (error: any) {
    process.send?.({ ok: false, status: error.status, code: error.code, message: error.message });
  } finally {
    await db.destroy();
    process.disconnect?.();
  }
});
