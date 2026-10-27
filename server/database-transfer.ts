import knex, { type Knex } from 'knex';
import { resolve } from 'node:path';
import { requireCurrentSchema } from './db.js';

// Only these controlled messages may be shown by the CLI; driver errors stay private.
export class TransferValidationError extends Error {}

// Dependency order; schema_migrations belongs to the independently migrated target.
export const transferTables = [
  'users',
  'sessions',
  'domains',
  'skills',
  'questions',
  'question_versions',
  'blueprints',
  'attempts',
  'module_attempts',
  'responses',
  'score_results',
  'bookmarks',
  'error_logs',
  'import_jobs',
  'question_assets',
] as const;
const jsonColumns: Record<string, string[]> = {
  users: ['profile'],
  question_versions: ['content'],
  blueprints: ['config'],
  attempts: ['snapshot'],
  module_attempts: ['routing_result'],
  responses: ['eliminated', 'highlights', 'notes'],
  score_results: ['report'],
  import_jobs: ['preview', 'report'],
};
const booleanColumns: Record<string, string[]> = {
  blueprints: ['published'],
  responses: ['marked', 'correct'],
};
function normalize(table: string, row: Record<string, unknown>) {
  const result = { ...row };
  for (const column of booleanColumns[table] || []) {
    if (result[column] !== null) {
      if (![true, false, 0, 1].includes(result[column] as boolean | number))
        throw new TransferValidationError(`Invalid boolean in ${table}.${column}; source is unchanged.`);
      result[column] = Boolean(result[column]);
    }
  }
  return result;
}
function identical(a: Record<string, unknown>, b: Record<string, unknown>) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) => value === b[key])
  );
}
export function openTransferSource(filename: string) {
  if (filename === ':memory:')
    throw new TransferValidationError('Transfer requires an existing SQLite file.');
  return knex({
    client: 'better-sqlite3',
    connection: { filename: resolve(filename), options: { readonly: true } },
    useNullAsDefault: true,
    pool: { min: 0, max: 1 },
    compileSqlOnError: false,
  });
}

/** No migrations, seeds, truncation, overwrite, or upload-file writes. */
export async function transferDatabase(
  source: Knex,
  target: Knex,
  mode: 'dry-run' | 'apply' | 'validate' = 'dry-run',
) {
  if (source.client.config.client !== 'better-sqlite3' || target.client.config.client !== 'pg')
    throw new TransferValidationError('Transfer requires a read-only SQLite source and a PostgreSQL target.');
  await requireCurrentSchema(source);
  await requireCurrentSchema(target);
  // Keep one consistent source snapshot throughout the target transaction.
  return source.transaction(async (read) => {
    if ((await read.raw('PRAGMA foreign_key_check')).length)
      throw new TransferValidationError(
        'Source foreign-key validation failed; repair a backup before transferring.',
      );
    return target.transaction(async (write) => {
      // Also prevents two concurrent transfer commands from both seeing an empty target.
      // Operators must stop application writers; this is not an online cutover tool.
      for (const table of transferTables)
        await write.raw('LOCK TABLE ?? IN SHARE ROW EXCLUSIVE MODE', [table]);
      const counts: Record<string, number> = {};
      for (const table of transferTables) {
        const sourceCount = Number((await read(table).count({ n: '*' }).first())!.n);
        const targetCount = Number((await write(table).count({ n: '*' }).first())!.n);
        counts[table] = sourceCount;
        if (mode !== 'validate' && targetCount !== 0)
          throw new TransferValidationError(`Target ${table} is not empty; nothing was overwritten.`);
        if (mode === 'validate' && targetCount !== sourceCount)
          throw new TransferValidationError(
            `Row count differs for ${table}; target is incomplete or changed.`,
          );
        const columns = await read(table).columnInfo();
        const targetColumns = await write(table).columnInfo();
        if (Object.keys(columns).sort().join() !== Object.keys(targetColumns).sort().join())
          throw new TransferValidationError(
            `Column mismatch in ${table}; migrate both databases to the same release.`,
          );
        const primary = table === 'sessions' ? 'token_hash' : table === 'score_results' ? 'attempt_id' : 'id';
        let cursor: string | undefined;
        while (true) {
          const query = read(table).select('*').orderBy(primary).limit(100);
          if (cursor !== undefined) query.where(primary, '>', cursor);
          const rows: Record<string, unknown>[] = await query;
          if (!rows.length) break;
          const normalized = rows.map((row) => normalize(table, row));
          for (const row of normalized) {
            for (const column of jsonColumns[table] || []) {
              if (row[column] !== null) {
                try {
                  JSON.parse(String(row[column]));
                } catch {
                  throw new TransferValidationError(
                    `Invalid JSON in ${table}.${column}; source is unchanged.`,
                  );
                }
              }
            }
            for (const [column, info] of Object.entries(targetColumns)) {
              const value = row[column];
              const maxLength = Number(info.maxLength);
              if (typeof value === 'string' && maxLength > 0 && [...value].length > maxLength)
                throw new TransferValidationError(
                  `Value exceeds PostgreSQL limit for ${table}.${column}; source is unchanged.`,
                );
              if (info.nullable === false && value === null)
                throw new TransferValidationError(
                  `Null value in required ${table}.${column}; source is unchanged.`,
                );
            }
          }
          if (mode === 'apply') await write(table).insert(normalized);
          if (mode !== 'dry-run') {
            const copied: Record<string, unknown>[] = await write(table).whereIn(
              primary,
              rows.map((row) => row[primary] as string),
            );
            const byKey = new Map(copied.map((row) => [row[primary], normalize(table, row)]));
            if (normalized.some((row) => !identical(row, byKey.get(row[primary]) || {})))
              throw new TransferValidationError(
                `Content verification failed for ${table}; transfer is rolled back.`,
              );
          }
          cursor = rows[rows.length - 1]![primary] as string;
        }
        if (mode === 'apply' && Number((await write(table).count({ n: '*' }).first())!.n) !== sourceCount)
          throw new TransferValidationError(
            `Row count verification failed for ${table}; transfer is rolled back.`,
          );
      }
      // Every application key is a supplied string, and migration versions are plain
      // integers. There are no serial/identity sequences to reset in this schema.
      return { mode, counts };
    });
  });
}
