import type { Knex } from 'knex';
import type { User } from '../shared/types.js';
import { ApiError } from './validation.js';

// The local queue supplements SQLite's single-connection writer serialization.
// PostgreSQL locks the owned attempt row before any child rows, coordinating
// separate processes while unrelated attempts can progress concurrently.
const queues = new Map<string, Promise<unknown>>();
export async function withAttemptLock<T>(
  db: Knex,
  user: User,
  id: string,
  action: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  const previous = queues.get(id) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() =>
      db.transaction(async (trx) => {
        let query = trx('attempts').where({ id, user_id: user.id });
        if (db.client.config.client === 'pg') query = query.forUpdate();
        if (!(await query.first())) throw new ApiError(404, 'Attempt not found');
        return action(trx);
      }),
    );
  queues.set(id, operation);
  try {
    return await operation;
  } finally {
    if (queues.get(id) === operation) queues.delete(id);
  }
}
