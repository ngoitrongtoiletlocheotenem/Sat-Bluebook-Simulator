import 'dotenv/config';
import { createDatabase, migrate, requireCurrentSchema } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { createUser, registerSchema } from './auth.js';

let database: ReturnType<typeof createDatabase> | undefined;
try {
  const db = (database = createDatabase());
  const production = process.env.NODE_ENV === 'production';
  if (production) await requireCurrentSchema(db);
  else await migrate(db);
  // Production content and privilege changes are explicit CLI operations only.
  if (!production && process.env.SEED_SAMPLE_DATA !== 'false') await seed(db);
  if (
    !production &&
    process.env.ADMIN_EMAIL &&
    process.env.ADMIN_PASSWORD &&
    !(await db('users').where({ email: process.env.ADMIN_EMAIL.toLowerCase() }).first())
  )
    await createUser(
      db,
      registerSchema.parse({
        email: process.env.ADMIN_EMAIL,
        name: process.env.ADMIN_NAME || 'Administrator',
        password: process.env.ADMIN_PASSWORD,
      }),
      'admin',
    );
  const port = Number(process.env.PORT || 3001);
  const server = createApp(db).listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`Pathwise SAT server listening on port ${port}`),
  );
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      // The normal drain closes Knex below. At the hard deadline process exit
      // also closes database sockets even if an in-flight query cannot drain.
      process.exit(1);
    }, 15000);
    timeout.unref();
    server.close(() => {
      void db.destroy().then(
        () => {
          clearTimeout(timeout);
          process.exit(0);
        },
        () => process.exit(1),
      );
    });
  }
  server.on('error', () => {
    console.error('HTTP server failed to start.');
    void db.destroy().finally(() => {
      process.exitCode = 1;
    });
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch {
  console.error('Database startup failed. Verify connectivity and run migrations before production startup.');
  await database?.destroy();
  process.exitCode = 1;
}
